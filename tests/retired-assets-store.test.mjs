import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Miniflare } from "miniflare";
import { InventoryStore } from "../work/qa/store.mjs";
import { verifyRetiredAssetReceipt } from "../work/qa/retired-asset-actions.mjs";
import { createExport } from "../work/qa/exports.mjs";

const mf = new Miniflare({ modules: true, script: "export default {fetch(){return new Response('retired-assets-test')}}", compatibilityDate: "2026-05-15", d1Databases: { DB: "retired-assets-test" }, d1Persist: false });
const db = await mf.getD1Database("DB");
for (const entry of JSON.parse(await readFile("drizzle/meta/_journal.json", "utf8")).entries) {
  const sql = await readFile(`drizzle/${entry.tag}.sql`, "utf8");
  await db.batch(sql.split("--> statement-breakpoint").filter(value => value.trim()).map(value => db.prepare(value)));
}
after(() => mf.dispose());
const at = "2026-10-08T05:00:00.000Z";
const admin = { id: crypto.randomUUID(), name: "Retired Actions Administrator", role: "admin", authVersion: 1 };
const staff = { id: crypto.randomUUID(), name: "Retired Actions Staff", role: "staff", authVersion: 1 };
for (const [index, actor] of [admin, staff].entries()) await db.prepare("INSERT INTO staff_accounts(id,username,display_name,role,password_hash,password_salt,hash_iterations,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)")
  .bind(actor.id, `retired-store-${index}`, actor.name, actor.role, "test-only", "test-only", 600000, at, at).run();
const rows = async (table, scope) => (await db.prepare(`SELECT * FROM ${table} WHERE scope=? ORDER BY rowid`).bind(scope).all()).results;
const rejected = error => error.status === 409 && error.code === "retired_asset_rejected_final";
async function fixture(name, dataset = "demo") {
  const scope = `retired-store-${name}:${dataset}`, store = (actor = admin, database = db) => new InventoryStore(database, scope, dataset, actor, () => new Date(at));
  await store().snapshot();
  for (const [id, tagId] of [["BAT-ONE", "0000-PRIVATE-EXACT-TAG"], ["BAT-TWO", null]]) await store().saveBattery({ id, name: "Target private battery name", chemistry: "LiPo", model: "MODEL-PRIVATE", capacityMah: 2200, voltage: 7.4, tagId, ownerId: `staff-${staff.id}`, homeBuildingId: "J18", homeRoomId: null, manufacturedOn: "2026-01-01", firstUsedOn: "2026-02-01" });
  const bindings = async (ids = ["BAT-ONE"]) => (await store().snapshot()).batteries.filter(battery => ids.includes(battery.id)).map(battery => ({ batteryId: battery.id, version: battery.version, tagId: battery.tagId }));
  const scrap = async (ids = ["BAT-ONE"], kind = "scrapped") => store(staff).lifecycle({ requestId: crypto.randomUUID(), kind, reason: "Private removal reason", destination: null, source: "manual_selection", items: await bindings(ids) });
  const payload = async (kind, ids = ["BAT-ONE"]) => ({ requestId: crypto.randomUUID(), kind, items: await bindings(ids) });
  return { scope, dataset, store, bindings, scrap, payload };
}
function beforeCommit(intervene, kind = "retired_asset") {
  const statementSql = new WeakMap(); let intercepted = false;
  return {
    prepare: sql => { const statement = db.prepare(sql); return { bind: (...values) => { const bound = statement.bind(...values); statementSql.set(bound, { sql, values }); return bound; } }; },
    batch: async statements => {
      if (!intercepted && statements.some(statement => { const record = statementSql.get(statement); return record?.sql.startsWith("INSERT INTO operations(") && (record.values[2] === kind || record.sql.includes(`'${kind}'`)); })) { intercepted = true; await intervene(); }
      return db.batch(statements);
    },
  };
}

test("staff recovery in both datasets preserves specifications, dates, original scrap evidence and exact retry", async () => {
  for (const dataset of ["demo", "live"]) {
    const context = await fixture(`recover-${dataset}`, dataset), initial = (await context.store().detail("BAT-ONE")).battery;
    await context.scrap(); const payload = await context.payload("recover"), receipt = await context.store(staff).retiredAsset(payload);
    assert.deepEqual(verifyRetiredAssetReceipt(receipt, { actorAccountId: staff.id, dataset, payload }), receipt);
    assert.deepEqual(await context.store(staff).retiredAsset(payload), { ...receipt, replayed: true });
    const detail = await context.store().detail("BAT-ONE");
    for (const field of ["name", "model", "tagId", "chemistry", "capacityMah", "voltage", "ownerAccountId", "homeBuildingId", "manufacturedOn", "firstUsedOn", "registeredAt"]) assert.equal(detail.battery[field], initial[field]);
    assert.equal(detail.battery.lifecycleStatus, "active"); assert.equal(detail.battery.lifecycleAt, null); assert.equal(detail.battery.version, initial.version + 2);
    assert.ok(detail.events.some(event => event.action === "battery_scrapped")); assert.ok(detail.events.some(event => event.action === "battery_recovered" && event.actorName === staff.name));
    assert.deepEqual(await rows("retired_asset_context", context.scope), []);
    await context.store(staff).movement({ requestId: crypto.randomUUID(), kind: "checkout", batteryIds: ["BAT-ONE"] });
  }
});

test("purge requires active native administrator and only currently reviewed Scrapped assets", async () => {
  const context = await fixture("authority"); await context.scrap(); const payload = await context.payload("purge");
  await assert.rejects(context.store(staff).retiredAsset(payload), error => error.status === 403);
  await assert.rejects(context.store({ ...admin, authVersion: undefined }).retiredAsset(payload), error => error.status === 401);
  await assert.rejects(context.store().retiredAsset(await context.payload("recover", ["BAT-TWO"])), rejected);
  await context.scrap(["BAT-TWO"], "permanently_removed");
  await assert.rejects(context.store(staff).retiredAsset(await context.payload("recover", ["BAT-TWO"])), rejected);
  await assert.rejects(context.store().retiredAsset({ ...payload, requestId: crypto.randomUUID(), items: [{ ...payload.items[0], tagId: "different exact tag" }] }), rejected);
  assert.equal((await context.store().detail("BAT-ONE")).battery.lifecycleStatus, "scrapped");
});

test("purge clears asset records, every evidence family, fingerprints and single-asset lifecycle details while retaining minimum evidence", async () => {
  const context = await fixture("clear");
  await context.store(staff).movement({ requestId: crypto.randomUUID(), kind: "checkout", batteryIds: ["BAT-ONE"] });
  const loan = (await context.store().detail("BAT-ONE")).battery.loanId;
  await context.store(staff).movement({ requestId: crypto.randomUUID(), kind: "return", batteryIds: ["BAT-ONE"], expectedLoans: [{ batteryId: "BAT-ONE", loanId: loan }] });
  await context.store().charge({ requestId: crypto.randomUUID(), batteryId: "BAT-ONE", completedAt: at, durationMinutes: 30 });
  await context.store().observation({ requestId: crypto.randomUUID(), batteryId: "BAT-ONE", roomId: "J18-DEMO-ROOM", observedAt: at });
  const inspectionPayload = { requestId: crypto.randomUUID(), batteryId: "BAT-ONE", expectedBatteryVersion: (await context.bindings())[0].version, kind: "visual_check", outcome: "concern_observed", performedAt: at, notes: "Target private inspection note" };
  const inspection = await context.store(staff).inspection(inspectionPayload);
  await context.store().voidInspection({ requestId: crypto.randomUUID(), batteryId: "BAT-ONE", inspectionId: inspection.inspectionId, reason: "Target private correction reason" });
  await context.scrap(); const payload = await context.payload("purge"), receipt = await context.store().retiredAsset(payload);
  assert.deepEqual(verifyRetiredAssetReceipt(receipt, { actorAccountId: admin.id, dataset: context.dataset, payload }), receipt);
  assert.deepEqual(await context.store().retiredAsset(payload), { ...receipt, replayed: true });
  for (const table of ["loans", "charges", "observations", "battery_inspections", "battery_inspection_voids"]) assert.deepEqual(await rows(table, context.scope), []);
  assert.deepEqual((await rows("audit_events", context.scope)).filter(event => event.battery_id === "BAT-ONE"), []);
  const operations = await rows("operations", context.scope);
  assert.ok(operations.every(operation => !operation.fingerprint.includes("0000-PRIVATE-EXACT-TAG")));
  const reservations = operations.filter(operation => operation.id !== `${context.scope}/${payload.requestId}` && JSON.parse(operation.result_json).purgedBatteryIds?.includes("BAT-ONE"));
  assert.ok(reservations.length >= 7);
  assert.ok(reservations.every(operation => !operation.result_json.includes("Private removal reason") && !operation.result_json.includes("private inspection") && !operation.result_json.includes("Target private battery name")));
  assert.deepEqual((await context.store().snapshot()).purgedBatteries, [{ id: "BAT-ONE", actorAccountId: admin.id, at }]);
  assert.deepEqual(Object.keys((await rows("purged_batteries", context.scope))[0]).sort(), ["actor_id", "at", "id", "key", "scope"]);
  await assert.rejects(context.store().detail("BAT-ONE"), error => error.status === 404);
  await assert.rejects(createExport(context.store(), { dataset: context.dataset, mode: "detail", batteryId: "BAT-ONE" }), error => error.status === 404);
  await assert.rejects(context.store(staff).inspection(inspectionPayload), error => error.code === "inspection_rejected_final");
  assert.deepEqual((await db.prepare("PRAGMA foreign_key_check").all()).results, []);
});

test("concurrent recovery wins over a stale purge without partial deletion and the old request remains rejected", async () => {
  const context = await fixture("recover-purge-race"); await context.scrap(["BAT-ONE", "BAT-TWO"]);
  const purge = await context.payload("purge", ["BAT-ONE", "BAT-TWO"]), recover = await context.payload("recover");
  const proxy = beforeCommit(() => context.store(staff).retiredAsset(recover));
  await assert.rejects(context.store(admin, proxy).retiredAsset(purge), rejected);
  assert.equal((await context.store().detail("BAT-ONE")).battery.lifecycleStatus, "active"); assert.equal((await context.store().detail("BAT-TWO")).battery.lifecycleStatus, "scrapped");
  assert.deepEqual(await rows("purged_batteries", context.scope), []);
  await context.scrap(); await assert.rejects(context.store().retiredAsset(purge), rejected);
});

test("concurrent purge wins over recovery and minimum receipts cannot replay a deleted recovery as active", async () => {
  const context = await fixture("purge-recover-race"); await context.scrap();
  const recover = await context.payload("recover"), purge = await context.payload("purge");
  const proxy = beforeCommit(() => context.store().retiredAsset(purge));
  await assert.rejects(context.store(staff, proxy).retiredAsset(recover), error => error.code === "retired_asset_rejected_final");
  await assert.rejects(context.store().detail("BAT-ONE"), error => error.status === 404);
  const second = await fixture("prior-recovery"); await second.scrap(); const successfulRecovery = await second.payload("recover");
  await second.store(staff).retiredAsset(successfulRecovery); await second.scrap(); await second.store().retiredAsset(await second.payload("purge"));
  await assert.rejects(second.store(staff).retiredAsset(successfulRecovery), error => error.code === "retired_asset_rejected_final");
});

test("deleted IDs and exact tag hashes cannot be reused by manual registration, metadata edits or imports", async () => {
  const context = await fixture("identity"); await context.scrap(); await context.store().retiredAsset(await context.payload("purge"));
  const remaining = (await context.store().detail("BAT-TWO")).battery;
  const fresh = { name: "Independent replacement", ownerId: `staff-${staff.id}`, homeBuildingId: "J18", homeRoomId: null };
  await assert.rejects(context.store().saveBattery({ ...fresh, id: "BAT-ONE", tagId: null }), error => error.status === 409);
  await assert.rejects(context.store().saveBattery({ ...fresh, id: "NEW-TAG", tagId: "0000-PRIVATE-EXACT-TAG" }), error => error.status === 409);
  await assert.rejects(context.store().saveBattery({ ...remaining, expectedVersion: remaining.version, tagId: "0000-PRIVATE-EXACT-TAG" }, true), error => error.status === 409);
  await assert.rejects(context.store().importRecords("batteries", [{ ...fresh, id: "BATCH-NEW", tagId: "0000-PRIVATE-EXACT-TAG" }]), error => error.status === 409);
  assert.equal((await rows("batteries", context.scope)).length, 1);
  assert.deepEqual(await rows("retired_asset_context", context.scope), []);
  await assert.rejects(db.prepare("DELETE FROM purged_batteries WHERE scope=?").bind(context.scope).run(), /minimum permanent deletion evidence/);
});

test("a new structured reference at commit changes the revision and prevents incomplete purge", async () => {
  const context = await fixture("evidence-race"); await context.scrap(); const payload = await context.payload("purge"), eventId = crypto.randomUUID();
  const proxy = beforeCommit(() => db.prepare("INSERT INTO audit_events(id,scope,action,battery_id,actor_id,actor_name,at,details_json) VALUES(?,?,'model_reference_recorded','BAT-TWO',?,?,?,?)").bind(eventId, context.scope, admin.id, admin.name, at, JSON.stringify({ sourceBindings: [{ id: "BAT-ONE", name: "Concurrent source identity" }], independentNotes: "Independent notes about BAT-ONE remain." })).run());
  await assert.rejects(context.store(admin, proxy).retiredAsset(payload), rejected);
  assert.equal((await context.store().detail("BAT-ONE")).battery.lifecycleStatus, "scrapped");
  assert.deepEqual(await rows("purged_batteries", context.scope), []);
  await context.store().retiredAsset({ ...payload, requestId: crypto.randomUUID() });
  const retained = JSON.parse((await rows("audit_events", context.scope)).find(event => event.id === eventId).details_json);
  assert.deepEqual(retained.sourceBindings, [{ id: "BAT-ONE", deleted: true }]);
  assert.equal(retained.independentNotes, "Independent notes about BAT-ONE remain.");
});

test("a reviewed 100-asset purge commits complete minimum receipts without per-item binding overflow", async () => {
  const context = await fixture("maximum");
  const extra = Array.from({ length: 98 }, (_, index) => ({ id: `BAT-BATCH-${String(index).padStart(3, "0")}`, name: "Reviewed batch asset", ownerId: `staff-${staff.id}`, homeBuildingId: "J18", tagId: null }));
  await context.store().importRecords("batteries", extra);
  const ids = (await context.store().snapshot()).batteries.map(battery => battery.id);
  await context.scrap(ids); const payload = await context.payload("purge", ids), receipt = await context.store().retiredAsset(payload);
  assert.equal(receipt.items.length, 100); verifyRetiredAssetReceipt(receipt, { actorAccountId: admin.id, dataset: context.dataset, payload });
  assert.equal((await rows("purged_batteries", context.scope)).length, 100); assert.deepEqual(await rows("batteries", context.scope), []);
  assert.deepEqual((await context.store().snapshot()).batteries, []);
  assert.deepEqual(await context.store().retiredAsset(payload), { ...receipt, replayed: true });
});
