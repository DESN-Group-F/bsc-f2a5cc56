import { after, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Miniflare } from "miniflare";
import { InventoryStore } from "../work/qa/store.mjs";
import { TeachingGroupStore } from "../work/qa/teaching-group-store.mjs";
import { TeachingCheckoutStore } from "../work/qa/server/inventory/teaching-checkouts.mjs";
import { validateTeachingNfcTag } from "../work/qa/teaching-nfc.mjs";
import { nativeNfcCapability } from "../work/qa/native-nfc-capability.mjs";

const mf = new Miniflare({ modules: true, script: "export default {fetch(){return new Response('native-teaching-controlled-test')}}", compatibilityDate: "2026-05-15", d1Databases: { DB: "native-teaching-controlled-test" }, d1Persist: false });
const db = await mf.getD1Database("DB");
after(() => mf.dispose());
const journal = JSON.parse(await readFile("drizzle/meta/_journal.json", "utf8"));
assert.equal(journal.entries.length, 23);
for (const entry of journal.entries) await db.batch((await readFile(`drizzle/${entry.tag}.sql`, "utf8")).split("--> statement-breakpoint").filter(sql => sql.trim()).map(sql => db.prepare(sql)));
const at = "2026-10-13T04:00:00.000Z", actor = { id: crypto.randomUUID(), name: "Controlled teaching staff", role: "staff", authVersion: 1 };
await db.prepare("INSERT INTO staff_accounts(id,username,display_name,role,password_hash,password_salt,hash_iterations,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)").bind(actor.id, "native-teaching-staff", actor.name, actor.role, "test-only-no-login", "test-only-no-login", 600000, at, at).run();
const rows = async (table, scope) => (await db.prepare(`SELECT * FROM ${table} WHERE scope=? ORDER BY rowid`).bind(scope).all()).results;
const proof = uid => ({ attemptId: crypto.randomUUID(), source: "native-nfc-reader", platform: "android", startedAt: at, endedAt: at, adoptedAt: at, tagId: `nfc:uid:${uid}`, result: { uidHex: uid, technology: "Controlled NFC-A evidence", ndefStatus: "readOnly", capacityBytes: 144, records: [{ tnf: 1, typeHex: "54", idHex: "00", payloadHex: "0000AB" }], observedAt: at } });
async function fixture(name, dataset = "live") {
  const scope = `native-teaching-${name}:${dataset}`;
  const inventory = (user = actor) => new InventoryStore(db, scope, dataset, user, () => new Date(at));
  const checkouts = (user = actor) => new TeachingCheckoutStore(db, scope, dataset, user, () => new Date(at));
  await inventory().snapshot();
  for (const [id, tagId] of [["ORIGINAL", null], ["SECOND", null], ["ACTUAL", "nfc:uid:0004AB00"], ["ALTERNATIVE", "nfc:uid:0004AB01"]]) await inventory().saveBattery({ id, name: `Controlled ${id}`, model: "", chemistry: "", capacityMah: null, voltage: null, tagId, ownerId: `staff-${actor.id}`, homeBuildingId: "J18", homeRoomId: null });
  const group = (await new TeachingGroupStore(db, scope, dataset, actor).save({ action: "create", requestId: crypto.randomUUID(), id: crypto.randomUUID(), name: "Controlled teaching group", batteryIds: ["ORIGINAL", "SECOND"] })).group;
  const binding = async id => { const battery = (await inventory().detail(id)).battery; return { batteryId: id, version: battery.version, tagId: battery.tagId }; };
  const checkout = async (source = { kind: "selection" }) => ({ action: "checkout", requestId: crypto.randomUUID(), teachingGroup: { id: group.id, version: group.version }, personalScope: "all", mappings: [{ original: await binding("ORIGINAL"), actual: await binding("ACTUAL"), originalLoanId: null, method: "manual", source }] });
  return { scope, inventory, checkouts, group, binding, checkout };
}
const blocked = error => error.status === 400 && error.code === "teaching_checkout_rejected_final" && /demonstration-only/.test(error.message);

test("new Working native teaching checkout is durably rejected while selection and typed-tag workflows remain available", async () => {
  const f = await fixture("checkout"), payload = await f.checkout({ kind: "native_nfc", evidence: proof("0004AB00") });
  await assert.rejects(f.checkouts().save(payload), blocked);
  await assert.rejects(f.checkouts().save(payload), blocked);
  assert.equal((await rows("loans", f.scope)).length, 0);
  assert.equal((await rows("audit_events", f.scope)).filter(row => row.action === "checkout").length, 0);
  assert.equal((await rows("operations", f.scope)).filter(row => row.kind === "teaching_checkout").length, 1);
  await assert.rejects(f.checkouts().save({ ...payload, mappings: [{ ...payload.mappings[0], source: { kind: "selection" } }] }), error => error.code === "idempotency_conflict");
  const saved = await f.checkouts().save(await f.checkout({ kind: "tag" }));
  assert.equal(saved.run.mappings[0].source.kind, "tag");
  assert.equal((await rows("loans", f.scope)).length, 1);
});

test("Working native continuation, exchange acquisition, outgoing hand-back and return are gated without changing existing loans", async () => {
  const f = await fixture("changes"), saved = await f.checkouts().save(await f.checkout());
  const held = saved.run.mappings[0], native = { kind: "native_nfc", evidence: proof("0004AB00") };
  const outgoing = { ...await f.binding("ACTUAL"), loanId: held.loanId };
  const continuation = { action: "continue", requestId: crypto.randomUUID(), runId: saved.run.id, expectedRevision: 1, teachingGroup: { id: f.group.id, version: f.group.version }, personalScope: "all", mappings: [{ original: await f.binding("SECOND"), actual: await f.binding("ALTERNATIVE"), originalLoanId: null, method: "manual", source: { kind: "native_nfc", evidence: proof("0004AB01") } }] };
  const exchange = { action: "exchange", requestId: crypto.randomUUID(), runId: saved.run.id, expectedRevision: 1, personalScope: "all", originalBatteryId: "ORIGINAL", outgoing, actual: await f.binding("ALTERNATIVE"), actualLoanId: null, returnOutgoing: true, source: { kind: "native_nfc", evidence: proof("0004AB01") } };
  const nativeOutgoing = { ...exchange, requestId: crypto.randomUUID(), source: { kind: "selection" }, outgoing: { ...outgoing, source: native } };
  const returning = { action: "return", requestId: crypto.randomUUID(), runId: saved.run.id, personalScope: "all", items: [{ ...outgoing, source: native }] };
  const before = await rows("loans", f.scope);
  for (const payload of [continuation, exchange, nativeOutgoing, returning]) { await assert.rejects(f.checkouts().save(payload), blocked); await assert.rejects(f.checkouts().save(payload), blocked); assert.deepEqual(await rows("loans", f.scope), before); }
  const manualReturn = { ...returning, requestId: crypto.randomUUID(), items: [outgoing] };
  await f.checkouts().save(manualReturn);
  assert.ok((await rows("loans", f.scope))[0].returned_at);
  await assert.rejects(f.checkouts().save(returning), blocked, "A later hand-back cannot turn the original terminal rejection into success");
});

test("Demonstration teaching native checkout and hand-back retain full source and exact receipts", async () => {
  const f = await fixture("demo", "demo"), source = { kind: "native_nfc", evidence: proof("0004AB00") }, payload = await f.checkout(source);
  const saved = await f.checkouts().save(payload);
  assert.deepEqual(saved.run.mappings[0].source, source);
  assert.deepEqual(await f.checkouts().save(payload), { ...saved, replayed: true });
  const returning = { action: "return", requestId: crypto.randomUUID(), runId: saved.run.id, personalScope: "all", items: [{ ...await f.binding("ACTUAL"), loanId: saved.run.mappings[0].loanId, source }] };
  const receipt = await f.checkouts().save(returning);
  assert.deepEqual(receipt.returnedItems[0].source, source);
  assert.deepEqual(await f.checkouts().save(returning), { ...receipt, replayed: true });
  assert.equal((await rows("observations", f.scope)).length, 0);
});

test("a saved legacy Working native success replays before the new gate without adding another loan or rewriting evidence", async () => {
  const f = await fixture("legacy"), payload = await f.checkout({ kind: "native_nfc", evidence: proof("0004AB00") });
  // Reproduce the earlier server's missing scope gate only while creating historical test evidence.
  const legacy = f.checkouts();
  legacy.checkSource = (source, tagId) => { if (source.kind === "native_nfc") validateTeachingNfcTag(source.evidence, tagId); };
  const saved = await legacy.save(payload), before = await rows("loans", f.scope);
  assert.deepEqual(await f.checkouts().save(payload), { ...saved, replayed: true });
  assert.deepEqual(await rows("loans", f.scope), before);
  await assert.rejects(f.checkouts().save({ ...payload, requestId: crypto.randomUUID() }), error => error.code === "teaching_checkout_rejected_final");
  assert.deepEqual(await rows("loans", f.scope), before);
});

test("capability descriptions are explicit and read-only; native scope cannot bypass current account authority", async () => {
  const f = await fixture("capability"), before = await rows("operations", f.scope);
  for (const dataset of ["demo", "live"]) {
    const capability = nativeNfcCapability(dataset);
    assert.equal(capability.version, 1); assert.equal(capability.enabled, dataset === "demo");
    assert.deepEqual(capability.enabledDatasets, ["demo"]); assert.equal(capability.physicalAcceptance, false);
    assert.equal(capability.evidenceSource, "device-reported"); assert.ok(capability.operations.includes("teaching_checkout"));
  }
  assert.deepEqual(await rows("operations", f.scope), before);
  await assert.rejects(f.checkouts({ ...actor, authVersion: 2 }).save(await f.checkout({ kind: "native_nfc", evidence: proof("0004AB00") })), error => error.status === 403 && /access changed/.test(error.message));
  assert.equal((await rows("loans", f.scope)).length, 0);
  assert.deepEqual(await rows("operations", f.scope), before);
});
