import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Miniflare } from "miniflare";
import { InventoryStore } from "../work/qa/store.mjs";
import { TeachingGroupStore } from "../work/qa/teaching-group-store.mjs";
import { TeachingCheckoutStore } from "../work/qa/server/inventory/teaching-checkouts.mjs";

const mf = new Miniflare({ modules: true, script: "export default {fetch(){return new Response('teaching-checkout-test')}}", compatibilityDate: "2026-05-15", d1Databases: { DB: "teaching-checkout-test" }, d1Persist: false });
const db = await mf.getD1Database("DB");
after(() => mf.dispose());
for (const entry of JSON.parse(await readFile("drizzle/meta/_journal.json", "utf8")).entries) await db.batch((await readFile(`drizzle/${entry.tag}.sql`, "utf8")).split("--> statement-breakpoint").filter(sql => sql.trim()).map(sql => db.prepare(sql)));
const at = "2026-10-08T06:00:00.000Z", a = { id: "checkout-staff-a", name: "Same Name", role: "staff", authVersion: 1 }, b = { id: "checkout-staff-b", name: "Same Name", role: "staff", authVersion: 1 }, admin = { id: "checkout-admin", name: "Administrator", role: "admin", authVersion: 1 };
for (const actor of [a, b, admin]) await db.prepare("INSERT INTO staff_accounts(id,username,display_name,role,password_hash,password_salt,hash_iterations,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)").bind(actor.id, actor.id, actor.name, actor.role, "test-only-no-login", "test-only-no-login", 600000, at, at).run();
async function fixture(name, extras = {}) {
  const scope = `checkouts-${name}:demo`, inventory = (actor = a, database = db) => new InventoryStore(database, scope, "demo", actor, () => new Date(at)), groups = (actor = a) => new TeachingGroupStore(db, scope, "demo", actor, () => new Date(at)), checkouts = (actor = a, database = db) => new TeachingCheckoutStore(database, scope, "demo", actor, () => new Date(at));
  await inventory().snapshot();
  for (const id of ["ORIGINAL", "FREE", "ALTERNATIVE", "SECOND"]) await inventory(admin).saveBattery({ id, name: `Teaching ${id}`, model: "PACK-A", chemistry: "LiPo", capacityMah: 2200, voltage: 7.4, ownerId: `staff-${a.id}`, homeBuildingId: "J18", ...extras[id] });
  const group = (await groups().save({ action: "create", requestId: crypto.randomUUID(), id: crypto.randomUUID(), name: "Class set", batteryIds: ["ORIGINAL", "SECOND"] })).group;
  await inventory(b).movement({ kind: "checkout", requestId: crypto.randomUUID(), batteryIds: ["ORIGINAL"] });
  const binding = async id => { const battery = (await inventory().detail(id)).battery; return { batteryId: id, tagId: battery.tagId, version: battery.version }; };
  const draft = async (method = "automatic", actual = "FREE", source = { kind: "selection" }) => ({ action: "checkout", requestId: crypto.randomUUID(), teachingGroup: { id: group.id, version: group.version }, personalScope: "all", mappings: [{ original: await binding("ORIGINAL"), actual: await binding(actual), originalLoanId: (await inventory().detail("ORIGINAL")).battery.loanId, method, source }] });
  return { scope, inventory, groups, checkouts, group, binding, draft };
}
function intercept(intervene) {
  const sqls = new WeakMap(); let once = false;
  return { prepare(sql) { const statement = db.prepare(sql); return { bind(...values) { const bound = statement.bind(...values); sqls.set(bound, sql); return bound; } }; }, async batch(statements) { if (!once && statements.some(statement => sqls.get(statement)?.startsWith("INSERT INTO operations"))) { once = true; await intervene(); } return db.batch(statements); } };
}
const rejected = error => error.code === "teaching_checkout_rejected_final";
test("strict temporary replacement saves original mapping and exact loans without changing either private group or old loan", async () => {
  const f = await fixture("strict"), payload = await f.draft(), result = await f.checkouts().save(payload);
  assert.equal(result.run.mappings[0].actual.batteryId, "FREE"); assert.equal(result.run.mappings[0].specificationMatch, true);
  assert.equal(result.run.mappings[0].originalLoanId, payload.mappings[0].originalLoanId);
  assert.equal((await f.inventory().detail("ORIGINAL")).battery.borrowerAccountId, b.id);
  assert.equal((await f.inventory().detail("FREE")).battery.loanId, result.run.mappings[0].loanId);
  assert.deepEqual((await f.groups().list())[0].batteryIds, f.group.batteryIds);
  assert.equal((await f.checkouts().list()).length, 1); assert.deepEqual(await f.checkouts(b).list(), []); assert.deepEqual(await f.checkouts(admin).list(), []);
  const replay = await f.checkouts().save(payload); assert.equal(replay.replayed, true); assert.deepEqual(replay.run, result.run);
  await assert.rejects(f.checkouts().save({ ...payload, personalScope: "responsible" }), error => error.code === "idempotency_conflict");
});
test("manual alternative keeps explicit differences and unknowns; strict automatic matching rejects them durably", async () => {
  const f = await fixture("manual", { ALTERNATIVE: { model: "OTHER", chemistry: "", capacityMah: null, voltage: null } });
  const automatic = await f.draft("automatic", "ALTERNATIVE"); await assert.rejects(f.checkouts().save(automatic), rejected);
  const saved = await f.checkouts().save(await f.draft("manual", "ALTERNATIVE"));
  assert.equal(saved.run.mappings[0].method, "manual"); assert.equal(saved.run.mappings[0].specificationMatch, false); assert.equal(saved.run.mappings[0].differences.length, 4);
  await assert.rejects(f.checkouts().save(automatic), rejected);
});
test("partial returns and ordinary returns use the recorded loans after group editing and archive; later loans are never returned", async () => {
  const f = await fixture("returns"), payload = await f.draft(); payload.mappings.push({ original: await f.binding("SECOND"), actual: await f.binding("SECOND"), originalLoanId: null, method: "original", source: { kind: "selection" } });
  const saved = await f.checkouts().save(payload);
  await f.groups().save({ action: "update", requestId: crypto.randomUUID(), id: f.group.id, expectedVersion: 1, name: "Changed set", batteryIds: ["ORIGINAL"] });
  await f.groups().save({ action: "remove", requestId: crypto.randomUUID(), id: f.group.id, expectedVersion: 2 });
  const first = saved.run.mappings[0], request = { action: "return", requestId: crypto.randomUUID(), runId: saved.run.id, personalScope: "all", items: [{ ...await f.binding(first.actual.batteryId), loanId: first.loanId }] };
  await f.checkouts(b).save(request); assert.equal((await f.checkouts().list())[0].items[0].status, "returned"); assert.equal((await f.checkouts().list())[0].items[1].status, "outstanding");
  assert.equal((await f.checkouts(b).save(request)).replayed, true);
  const second = saved.run.mappings[1]; await f.inventory(b).movement({ kind: "return", requestId: crypto.randomUUID(), batteryIds: [second.actual.batteryId], expectedLoans: [{ batteryId: second.actual.batteryId, loanId: second.loanId }] });
  await f.inventory(b).movement({ kind: "checkout", requestId: crypto.randomUUID(), batteryIds: [first.actual.batteryId] });
  assert.equal((await f.checkouts().list())[0].items[1].status, "returned");
  await assert.rejects(f.checkouts().save({ ...request, requestId: crypto.randomUUID() }), rejected);
  assert.equal((await f.inventory().detail(first.actual.batteryId)).battery.borrowerAccountId, b.id);
});
test("two teachers competing for one candidate create exactly one checkout; final rejection prevents a delayed success", async () => {
  const f = await fixture("concurrent"), ownGroup = (await f.groups(b).save({ action: "create", requestId: crypto.randomUUID(), id: crypto.randomUUID(), name: "Other class", batteryIds: ["SECOND"] })).group;
  await f.inventory(a).movement({ kind: "checkout", requestId: crypto.randomUUID(), batteryIds: ["SECOND"] });
  const p1 = await f.draft(), p2 = { ...await f.draft(), teachingGroup: { id: ownGroup.id, version: 1 }, mappings: [{ original: await f.binding("SECOND"), actual: await f.binding("FREE"), originalLoanId: (await f.inventory().detail("SECOND")).battery.loanId, method: "automatic", source: { kind: "selection" } }] };
  const outcomes = await Promise.allSettled([f.checkouts(a).save(p1), f.checkouts(b).save(p2)]); assert.equal(outcomes.filter(result => result.status === "fulfilled").length, 1); assert.equal(outcomes.filter(result => result.status === "rejected").length, 1);
  const loser = outcomes[0].status === "rejected" ? [a, p1] : [b, p2], battery = (await f.inventory().detail("FREE")).battery;
  await f.inventory().movement({ kind: "return", requestId: crypto.randomUUID(), batteryIds: ["FREE"], expectedLoans: [{ batteryId: "FREE", loanId: battery.loanId }] });
  await assert.rejects(f.checkouts(loser[0]).save(loser[1]), rejected);
  assert.equal((await f.inventory().detail("FREE")).battery.loanId, null);
});
test("atomic guards reject candidate versions, null tags, original loans and private-group changes at the final batch", async () => {
  for (const change of ["version", "null-tag", "original-loan", "group"]) {
    const f = await fixture(`guard-${change}`), payload = await f.draft();
    const hooked = intercept(async () => {
      if (change === "group") await f.groups().save({ action: "update", requestId: crypto.randomUUID(), id: f.group.id, expectedVersion: 1, name: "Updated", batteryIds: f.group.batteryIds });
      else if (change === "original-loan") await f.inventory().movement({ kind: "return", requestId: crypto.randomUUID(), batteryIds: ["ORIGINAL"], expectedLoans: [{ batteryId: "ORIGINAL", loanId: payload.mappings[0].originalLoanId }] });
      else { const current = (await f.inventory().detail("FREE")).battery; await f.inventory(admin).saveBattery({ id: "FREE", name: change === "version" ? "Changed name" : current.name, chemistry: current.chemistry, model: current.model, capacityMah: current.capacityMah, voltage: current.voltage, ownerId: current.ownerId, homeBuildingId: "J18", tagId: change === "null-tag" ? "new-tag" : null, expectedVersion: current.version }, true); }
    });
    await assert.rejects(f.checkouts(a, hooked).save(payload), rejected); assert.equal((await f.inventory().detail("FREE")).battery.loanId, null);
  }
});
test("manual native NFC preserves adopted raw evidence and exact tag binding; tag source cannot claim hardware", async () => {
  const f = await fixture("nfc", { FREE: { tagId: "nfc:uid:00112233" }, ALTERNATIVE: { tagId: "nfc:uid:44556677" } });
  const evidence = { attemptId: crypto.randomUUID(), source: "native-nfc-reader", platform: "android", startedAt: at, endedAt: at, adoptedAt: at, tagId: "nfc:uid:00112233", result: { uidHex: "00112233", technology: "NFC-A", ndefStatus: "unknown", capacityBytes: null, records: [], observedAt: at } };
  const saved = await f.checkouts().save(await f.draft("manual", "FREE", { kind: "native_nfc", evidence }));
  assert.deepEqual(saved.run.mappings[0].source.evidence, evidence);
  await assert.rejects(f.checkouts().save(await f.draft("manual", "ALTERNATIVE", { kind: "native_nfc", evidence })), error => error.name === "ZodError");
  await assert.rejects(f.checkouts().save(await f.draft("manual", "ALTERNATIVE", { kind: "tag", evidence })), error => error.name === "ZodError");
});
test("replacement queues reject duplicate actual candidates and mixed manual sources without writing loans", async () => {
  const f = await fixture("duplicate", { FREE: { tagId: "registered-free" } });
  const payload = await f.draft("manual", "FREE", { kind: "tag" }); payload.mappings.push({ ...payload.mappings[0], original: await f.binding("SECOND") });
  await assert.rejects(f.checkouts().save(payload), rejected);
  assert.equal((await f.inventory().detail("FREE")).battery.loanId, null);
  await f.inventory(b).movement({ kind: "checkout", requestId: crypto.randomUUID(), batteryIds: ["SECOND"] });
  const mixed = await f.draft("manual", "FREE", { kind: "tag" }); mixed.mappings.push({ original: await f.binding("SECOND"), actual: await f.binding("ALTERNATIVE"), originalLoanId: (await f.inventory().detail("SECOND")).battery.loanId, method: "manual", source: { kind: "selection" } });
  await assert.rejects(f.checkouts().save(mixed), rejected);
});
test("same-inventory, responsible personal scope and exact native account authority apply to original and replacement assets", async () => {
  const f = await fixture("scope", { FREE: { ownerId: `staff-${b.id}` } }), payload = await f.draft();
  await assert.rejects(f.checkouts().save({ ...payload, personalScope: "responsible" }), rejected);
  await assert.rejects(f.checkouts(b).save({ ...payload, requestId: crypto.randomUUID() }), rejected);
  const outside = await f.draft(); outside.mappings[0].actual.batteryId = "NOT-IN-INVENTORY"; await assert.rejects(f.checkouts().save(outside), rejected);
  const adminPayload = await f.draft(), hook = intercept(async () => { await db.prepare("UPDATE staff_accounts SET version=version+1,auth_version=auth_version+1 WHERE id=?").bind(a.id).run(); });
  await assert.rejects(f.checkouts(a, hook).save(adminPayload), error => error.status === 409);
  a.authVersion += 1;
  assert.equal((await f.inventory().detail("FREE")).battery.loanId, null);
});
test("purging original or actual assets removes structured teaching snapshots and source evidence while retaining minimum run identity", async () => {
  for (const target of ["ORIGINAL", "FREE"]) {
    const f = await fixture(`purge-${target}`, { FREE: { tagId: "nfc:uid:00112233" } });
    const evidence = { attemptId: crypto.randomUUID(), source: "native-nfc-reader", platform: "android", startedAt: at, endedAt: at, adoptedAt: at, tagId: "nfc:uid:00112233", result: { uidHex: "00112233", technology: "NFC-A", ndefStatus: "unknown", capacityBytes: null, records: [], observedAt: at } };
    const payload = await f.draft("manual", "FREE", { kind: "native_nfc", evidence });
    const saved = await f.checkouts().save(payload), battery = (await f.inventory().detail(target)).battery;
    await f.inventory().movement({ requestId: crypto.randomUUID(), kind: "return", batteryIds: [target], expectedLoans: [{ batteryId: target, loanId: battery.loanId }] });
    await f.inventory().lifecycle({ requestId: crypto.randomUUID(), kind: "scrapped", reason: "", destination: null, source: "manual_selection", items: [await f.binding(target)] });
    await f.inventory(admin).retiredAsset({ requestId: crypto.randomUUID(), kind: "purge", items: [await f.binding(target)] });
    const listed = (await f.checkouts().list())[0];
    assert.equal(listed.id, saved.run.id);
    assert.deepEqual(target === "ORIGINAL" ? listed.mappings[0].original : listed.mappings[0].actual, { batteryId: target, deleted: true });
    assert.deepEqual(listed.mappings[0].differences, []); assert.equal(listed.mappings[0].specificationMatch, null);
    if (target === "FREE") { assert.equal(listed.mappings[0].source, undefined); assert.equal(listed.mappings[0].loanId, null); assert.equal(listed.items[0].status, "deleted"); assert.doesNotMatch(JSON.stringify(listed), /00112233/); }
    else { assert.equal(listed.mappings[0].originalLoanId, null); assert.equal(listed.items[0].status, "outstanding"); }
    const exported = await f.checkouts().export(saved.run.id);
    assert.deepEqual(exported.run, listed);
    if (target === "FREE") { assert.deepEqual(exported.loans, []); assert.deepEqual(exported.events, []); assert.doesNotMatch(JSON.stringify(exported), /00112233/); }
    else { assert.equal(exported.loans[0].id, saved.run.mappings[0].loanId); assert.equal(exported.events.length, 1); assert.deepEqual(JSON.parse(exported.events[0].details_json).teachingCheckout.mappings[0].original, { batteryId: target, deleted: true }); }
    await assert.rejects(f.checkouts().save(payload), rejected);
  }
});

test("checkout exports retain exact return actors and correction history while excluding later loans", async () => {
  const f = await fixture("complete-export"), saved = await f.checkouts().save(await f.draft()), loanId = saved.run.mappings[0].loanId;
  await f.inventory(b).movement({ kind: "return", requestId: crypto.randomUUID(), batteryIds: ["FREE"], expectedLoans: [{ batteryId: "FREE", loanId }] });
  let exported = await f.checkouts().export(saved.run.id);
  assert.equal(exported.loans.length, 1); assert.equal(exported.loans[0].return_actor_id, b.id); assert.equal(exported.loans[0].returned_at, at);
  assert.deepEqual(exported.events.map(event => event.action), ["checkout", "return"]);
  const receiverExport = await f.checkouts(b).export(saved.run.id);
  assert.deepEqual(receiverExport.operator, { accountId: b.id, name: b.name }); assert.equal(receiverExport.run.actorAccountId, a.id);
  await f.inventory(admin).correctLoan({ requestId: crypto.randomUUID(), loanId, action: "return_reopened", expectedReturnedAt: at, reason: "The check-in was entered in error." });
  exported = await f.checkouts().export(saved.run.id);
  assert.equal(exported.run.items[0].status, "outstanding"); assert.equal(exported.loans[0].returned_at, null);
  const reopened = exported.events.find(event => event.action === "return_reopened");
  assert.equal(reopened.actor_id, admin.id); assert.equal(JSON.parse(reopened.details_json).before.return_actor_id, b.id);
  await f.inventory(admin).correctLoan({ requestId: crypto.randomUUID(), loanId, action: "checkout_voided", expectedReturnedAt: null, reason: "The checkout was entered in error." });
  await f.inventory(b).movement({ kind: "checkout", requestId: crypto.randomUUID(), batteryIds: ["FREE"] });
  const laterLoanId = (await f.inventory().detail("FREE")).battery.loanId;
  exported = await f.checkouts().export(saved.run.id);
  assert.equal(exported.run.items[0].status, "cancelled"); assert.equal(exported.loans[0].cancelled_at, at);
  assert.deepEqual(exported.loans.map(loan => loan.id), [loanId]);
  assert.deepEqual(exported.events.map(event => event.action), ["checkout", "return", "return_reopened", "checkout_voided"]);
  assert.ok(exported.events.every(event => JSON.parse(event.details_json).loanId === loanId));
  assert.doesNotMatch(JSON.stringify(exported), new RegExp(laterLoanId));
});
test("100-member checkout and return retain all exact loans with bounded JSON guard parameters", async () => {
  const scope = "checkouts-max100:demo", inventory = new InventoryStore(db, scope, "demo", a, () => new Date(at));
  await inventory.snapshot();
  const ids = Array.from({ length: 100 }, (_, index) => `CLASS-${String(index + 1).padStart(3, "0")}`);
  await inventory.importRecords("batteries", ids.map(id => ({ id, name: `Class battery ${id}`, model: "PACK", chemistry: "LiPo", capacityMah: 2200, voltage: 7.4, ownerId: `staff-${a.id}`, homeBuildingId: "J18" })));
  const group = (await new TeachingGroupStore(db, scope, "demo", a, () => new Date(at)).save({ action: "create", requestId: crypto.randomUUID(), id: crypto.randomUUID(), name: "Full class", batteryIds: ids })).group;
  const batteries = (await inventory.snapshot()).batteries;
  const mapping = battery => { const binding = { batteryId: battery.id, tagId: battery.tagId, version: battery.version }; return { original: binding, actual: binding, originalLoanId: null, method: "original", source: { kind: "selection" } }; };
  const store = new TeachingCheckoutStore(db, scope, "demo", a, () => new Date(at));
  const saved = await store.save({ action: "checkout", requestId: crypto.randomUUID(), teachingGroup: { id: group.id, version: group.version }, personalScope: "responsible", mappings: batteries.map(mapping) });
  assert.equal(saved.run.mappings.length, 100); assert.equal(new Set(saved.run.mappings.map(item => item.loanId)).size, 100);
  const list = (await store.list())[0]; assert.equal(list.items.filter(item => item.status === "outstanding").length, 100);
  await store.save({ action: "return", requestId: crypto.randomUUID(), runId: list.id, personalScope: "borrowed", items: list.items.map(item => ({ batteryId: item.batteryId, tagId: item.tagId, version: item.version, loanId: item.loanId })) });
  assert.equal((await store.list())[0].items.filter(item => item.status === "returned").length, 100);
});
test("partial return rejects exact binding and loan changes at commit without switching to a newer loan", async () => {
  for (const change of ["tag", "loan"]) {
    const f = await fixture(`return-race-${change}`), saved = await f.checkouts().save(await f.draft());
    const mapping = saved.run.mappings[0], request = { action: "return", requestId: crypto.randomUUID(), runId: saved.run.id, personalScope: "all", items: [{ ...await f.binding("FREE"), loanId: mapping.loanId }] };
    const hooked = intercept(async () => {
      if (change === "loan") {
        await f.inventory().movement({ kind: "return", requestId: crypto.randomUUID(), batteryIds: ["FREE"], expectedLoans: [{ batteryId: "FREE", loanId: mapping.loanId }] });
        await f.inventory(b).movement({ kind: "checkout", requestId: crypto.randomUUID(), batteryIds: ["FREE"] });
      } else {
        const current = (await f.inventory().detail("FREE")).battery;
        await f.inventory(admin).saveBattery({ id: current.id, name: current.name, model: current.model, chemistry: current.chemistry, capacityMah: current.capacityMah, voltage: current.voltage, ownerId: current.ownerId, homeBuildingId: "J18", tagId: "new-return-tag", expectedVersion: current.version }, true);
      }
    });
    await assert.rejects(f.checkouts(a, hooked).save(request), rejected);
    const current = (await f.inventory().detail("FREE")).battery;
    assert.ok(current.loanId); if (change === "loan") assert.notEqual(current.loanId, mapping.loanId); else assert.equal(current.loanId, mapping.loanId);
  }
});
test("a response lost after atomic commit replays the original source and exact loan without a duplicate operation", async () => {
  const f = await fixture("lost-response"), payload = await f.draft();
  const commands = new WeakMap(); let lost = false;
  const hooked = { prepare(sql) { const statement = db.prepare(sql); return { bind(...values) { const bound = statement.bind(...values); commands.set(bound, sql); return bound; } }; }, async batch(statements) { const result = await db.batch(statements); if (!lost && statements.some(statement => commands.get(statement)?.startsWith("INSERT INTO operations"))) { lost = true; throw new Error("Test-only transport interruption after D1 committed"); } return result; } };
  const result = await f.checkouts(a, hooked).save(payload); assert.equal(result.replayed, true);
  const retry = await f.checkouts().save(payload); assert.deepEqual(retry.run, result.run); assert.equal((await f.checkouts().list()).length, 1);
  const loans = await db.prepare("SELECT id FROM loans WHERE scope=? AND battery_key=?").bind(f.scope, `${f.scope}/FREE`).all(); assert.equal(loans.results.length, 1);
});
