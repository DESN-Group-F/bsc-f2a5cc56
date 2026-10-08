import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Miniflare } from "miniflare";
import { InventoryStore } from "../work/qa/store.mjs";
import { inspectionSchema } from "../work/qa/battery-inspections.mjs";
import { summarizeBatteryUsage } from "../work/qa/battery-usage.mjs";

const mf = new Miniflare({ modules: true, script: "export default {fetch(){return new Response('inspection-test')}}", compatibilityDate: "2026-05-15", d1Databases: { DB: "inspection-test" }, d1Persist: false });
const db = await mf.getD1Database("DB");
for (const entry of JSON.parse(await readFile("drizzle/meta/_journal.json", "utf8")).entries) {
  const sql = await readFile(`drizzle/${entry.tag}.sql`, "utf8");
  await db.batch(sql.split("--> statement-breakpoint").filter(value => value.trim()).map(value => db.prepare(value)));
}
after(() => mf.dispose());
const instant = new Date("2026-10-06T04:00:00.000Z");
const admin = { id: "inspection-admin", name: "Inspection Admin", role: "admin", authVersion: 1 };
const staff = { id: "inspection-staff", name: "Inspection Staff", role: "staff", authVersion: 1 };
const colleague = { id: "inspection-colleague", name: "Inspection Staff", role: "staff", authVersion: 1 };
for (const actor of [admin, staff, colleague]) await db.prepare("INSERT INTO staff_accounts(id,username,display_name,role,password_hash,password_salt,hash_iterations,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)").bind(actor.id, actor.id, actor.name, actor.role, "isolated-no-login", "isolated-no-login", 600000, instant.toISOString(), instant.toISOString()).run();
const store = (scope, actor = staff, clock = () => instant, database = db) => new InventoryStore(database, scope, "demo", actor, clock);
const input = (extra = {}) => ({ requestId: crypto.randomUUID(), batteryId: "CHECK-001", expectedBatteryVersion: 1, kind: "visual_check", outcome: "no_concern_observed", performedAt: "2026-10-06T13:00:00+11:00", ...extra });
const status = expected => error => error.status === expected;
async function fixture(scope) {
  const inventory = store(scope);
  await inventory.saveBattery({ id: "CHECK-001", name: "Inspection verification asset", ownerId: `staff-${staff.id}`, homeBuildingId: "J18" });
  return inventory;
}

test("staff record attributed factual checks exactly once and every staff account sees shared evidence", async () => {
  const scope = "inspection-shared", inventory = await fixture(scope), payload = input({ notes: "Enclosure and connector viewed.", reference: "Lab record 17" });
  const receipt = await inventory.inspection(payload), retry = await inventory.inspection(payload);
  assert.equal(receipt.replayed, false); assert.equal(retry.replayed, true); assert.equal(receipt.inspectionId, retry.inspectionId);
  const detail = await store(scope, colleague).detail("CHECK-001");
  assert.equal(detail.inspections.length, 1); assert.equal(detail.inspectionSummary.totalRecords, 1); assert.equal(detail.inspectionSummary.validRecords, 1);
  const record = detail.inspections[0];
  assert.equal(record.inspectorAccountId, staff.id); assert.equal(record.inspectorName, staff.name); assert.equal(record.performedAt, "2026-10-06T02:00:00.000Z");
  assert.equal(record.recordedAt, instant.toISOString()); assert.equal(record.capacityMah, null); assert.equal(record.voidedAt, null);
  assert.equal(detail.events.filter(event => event.action === "inspection_recorded").length, 1);
  assert.deepEqual((await store(scope, colleague).exportData()).inspections, detail.inspections);
  await assert.rejects(inventory.inspection({ ...payload, notes: "Different payload" }), error => error.code === "idempotency_conflict");
  await assert.rejects(store(scope, colleague).inspection(payload), error => error.code === "idempotency_conflict");
  await assert.rejects(store("inspection-other").detail("CHECK-001"), status(404));
  assert.equal((await store("inspection-other").exportData()).inspections.length, 0);
});

test("inventory concern preview retains older factual concerns, shares detail ordering and excludes corrected entries", async () => {
  const scope = "inspection-inventory-preview", inventory = await fixture(scope);
  const empty = (await inventory.snapshot()).batteries.find(battery => battery.id === "CHECK-001");
  assert.deepEqual(empty.inspectionPreview, { validRecords: 0, concernRecords: 0, latest: null, latestConcern: null });
  const older = await inventory.inspection(input({ outcome: "concern_observed", notes: "Observed a damaged connector in this software fixture.", performedAt: "2026-10-03T02:00:00Z" }));
  const latestConcern = await inventory.inspection(input({ outcome: "concern_observed", notes: "A separate recorded concern.", performedAt: "2026-10-04T02:00:00Z" }));
  const latest = await inventory.inspection(input({ outcome: "no_concern_observed", performedAt: "2026-10-05T02:00:00Z" }));
  await fixture("inspection-preview-other-scope");
  await store("inspection-preview-other-scope").inspection(input({ outcome: "concern_observed", notes: "Other inventory's recorded evidence." }));
  const current = (await store(scope, colleague).snapshot()).batteries.find(battery => battery.id === "CHECK-001");
  assert.equal(current.inspectionPreview.validRecords, 3);
  assert.equal(current.inspectionPreview.concernRecords, 2);
  assert.equal(current.inspectionPreview.latest.id, latest.inspectionId);
  assert.equal(current.inspectionPreview.latestConcern.id, latestConcern.inspectionId);
  assert.equal(current.loanId, null);
  assert.equal(current.lifecycleStatus, "active");
  assert.equal(current.version, empty.version);
  const detail = await inventory.detail("CHECK-001");
  assert.deepEqual(detail.battery.inspectionPreview, current.inspectionPreview);
  assert.equal(detail.inspectionSummary.latest.id, current.inspectionPreview.latest.id);
  const exported = (await inventory.exportData()).snapshot.batteries.find(battery => battery.id === "CHECK-001");
  assert.deepEqual(exported.inspectionPreview, current.inspectionPreview);
  await store(scope, admin).voidInspection({ requestId: crypto.randomUUID(), batteryId: "CHECK-001", inspectionId: latestConcern.inspectionId, reason: "Entered against the wrong battery." });
  const corrected = (await inventory.snapshot()).batteries.find(battery => battery.id === "CHECK-001");
  assert.equal(corrected.inspectionPreview.validRecords, 2);
  assert.equal(corrected.inspectionPreview.concernRecords, 1);
  assert.equal(corrected.inspectionPreview.latestConcern.id, older.inspectionId);
  await store(scope, admin).voidInspection({ requestId: crypto.randomUUID(), batteryId: "CHECK-001", inspectionId: older.inspectionId, reason: "Earlier entry also used the wrong battery." });
  const noCurrentConcern = (await inventory.snapshot()).batteries.find(battery => battery.id === "CHECK-001");
  assert.equal(noCurrentConcern.inspectionPreview.concernRecords, 0);
  assert.equal(noCurrentConcern.inspectionPreview.latestConcern, null);
  assert.equal((await inventory.detail("CHECK-001")).inspections.length, 3);
});

test("inspection schema requires explicit outcomes, measurements and explanatory evidence without accepting actor substitution", () => {
  for (const change of [
    { outcome: undefined }, { outcome: "safe" }, { kind: "other", notes: " " }, { outcome: "concern_observed" },
    { kind: "capacity_measurement", method: "Load test" }, { kind: "capacity_measurement", capacityMah: 500 },
    { capacityMah: 500 }, { kind: "capacity_measurement", capacityMah: 0, method: "Load test" },
    { inspectorAccountId: colleague.id }, { expectedBatteryVersion: undefined }, { performedAt: "2026-10-06T13:00:00" },
  ]) assert.equal(inspectionSchema.safeParse(input(change)).success, false, JSON.stringify(change));
  assert.equal(inspectionSchema.safeParse(input({ kind: "capacity_measurement", capacityMah: 1980, method: "Measured under the documented test conditions", outcome: "inconclusive" })).success, true);
});

test("future and stale battery requests remain finally rejected even if later retried", async () => {
  const scope = "inspection-rejections", inventory = await fixture(scope);
  const future = input({ performedAt: "2026-10-06T04:00:00.001Z" });
  await assert.rejects(inventory.inspection(future), error => error.code === "inspection_rejected_final" && error.status === 400);
  await assert.rejects(store(scope, staff, () => new Date("2026-10-07T04:00:00Z")).inspection(future), error => error.code === "inspection_rejected_final");
  const stale = input({ expectedBatteryVersion: 2 });
  await assert.rejects(inventory.inspection(stale), error => error.code === "inspection_rejected_final" && error.status === 409);
  await db.prepare("UPDATE batteries SET name=?,version=version+1 WHERE key=?").bind("Updated test asset", `${scope}/CHECK-001`).run();
  await assert.rejects(inventory.inspection(stale), error => error.code === "inspection_rejected_final");
  assert.equal((await inventory.detail("CHECK-001")).inspectionSummary.totalRecords, 0);
  assert.equal((await inventory.fullActivity()).filter(event => event.action === "inspection_recorded").length, 0);
});

test("native staff authentication is required and a stale account cannot replay a saved inspection", async () => {
  const scope = "inspection-authority", inventory = await fixture(scope), payload = input();
  await assert.rejects(store(scope, { ...staff, authVersion: undefined }).inspection(payload), status(401));
  await assert.rejects(store(scope, { ...staff, authVersion: 99 }).inspection(payload), status(403));
  const receipt = await inventory.inspection(payload);
  await assert.rejects(store(scope, { ...staff, authVersion: 99 }).inspection(payload), status(403));
  assert.equal((await inventory.detail("CHECK-001")).inspections[0].id, receipt.inspectionId);
});

test("rename retains original inspector name and later inspections use the current account name", async () => {
  const scope = "inspection-rename", inventory = await fixture(scope);
  await inventory.inspection(input());
  await db.prepare("UPDATE staff_accounts SET display_name=?,version=version+1,updated_at=? WHERE id=?").bind("Renamed Inspector", instant.toISOString(), colleague.id).run();
  await store(scope, colleague).inspection(input());
  const records = (await inventory.detail("CHECK-001")).inspections;
  assert.equal(records.find(record => record.inspectorAccountId === colleague.id).inspectorName, "Renamed Inspector");
  assert.equal(records.find(record => record.inspectorAccountId === staff.id).inspectorName, staff.name);
});

test("admin marks a record entered in error without deleting original evidence, latest falls back by performed time", async () => {
  const scope = "inspection-correction", inventory = await fixture(scope);
  const older = await inventory.inspection(input({ performedAt: "2026-10-04T02:00:00Z" }));
  const newer = await inventory.inspection(input());
  const payload = { requestId: crypto.randomUUID(), batteryId: "CHECK-001", inspectionId: newer.inspectionId, reason: "Entered against the wrong asset." };
  await assert.rejects(inventory.voidInspection(payload), status(403));
  const corrected = await store(scope, admin).voidInspection(payload);
  assert.equal(corrected.action, "inspection_void"); assert.equal((await store(scope, admin).voidInspection(payload)).replayed, true);
  const detail = await inventory.detail("CHECK-001");
  assert.equal(detail.inspectionSummary.totalRecords, 2); assert.equal(detail.inspectionSummary.validRecords, 1); assert.equal(detail.inspectionSummary.latest.id, older.inspectionId);
  const original = detail.inspections.find(record => record.id === newer.inspectionId);
  assert.equal(original.outcome, "no_concern_observed"); assert.equal(original.voidReason, payload.reason); assert.equal(original.voidedByAccountId, admin.id);
  assert.equal(detail.events.filter(event => event.action === "inspection_voided").length, 1);
  await assert.rejects(store(scope, admin).voidInspection({ ...payload, requestId: crypto.randomUUID() }), error => error.code === "inspection_rejected_final");
  await assert.rejects(store(scope, admin).voidInspection({ ...payload, reason: "Another correction reason" }), error => error.code === "idempotency_conflict");
});

test("retired batteries retain inspection history and permit admin evidence correction but no new checks", async () => {
  const scope = "inspection-retired", inventory = await fixture(scope), original = await inventory.inspection(input());
  await db.prepare("UPDATE batteries SET lifecycle_status='scrapped',lifecycle_at=?,lifecycle_reason=?,version=version+1 WHERE key=?").bind(instant.toISOString(), "Isolated retirement fixture", `${scope}/CHECK-001`).run();
  await assert.rejects(inventory.inspection(input({ expectedBatteryVersion: 2 })), error => error.code === "inspection_rejected_final");
  await store(scope, admin).voidInspection({ requestId: crypto.randomUUID(), batteryId: "CHECK-001", inspectionId: original.inspectionId, reason: "Wrong asset was selected before retirement." });
  const detail = await inventory.detail("CHECK-001");
  assert.equal(detail.inspections.length, 1); assert.equal(detail.inspectionSummary.latest, null);
  assert.equal((await inventory.exportData()).inspections.length, 1);
});

test("D1 rejects updates, deletes, replace and upsert attempts against inspection and void evidence", async () => {
  const scope = "inspection-immutable", inventory = await fixture(scope), receipt = await inventory.inspection(input());
  await store(scope, admin).voidInspection({ requestId: crypto.randomUUID(), batteryId: "CHECK-001", inspectionId: receipt.inspectionId, reason: "Wrong test record selected." });
  for (const table of ["battery_inspections", "battery_inspection_voids", "operations", "audit_events"]) {
    const condition = table === "operations" ? " AND kind='inspection'" : table === "audit_events" ? " AND action='inspection_recorded'" : "";
    const row = await db.prepare(`SELECT * FROM ${table} WHERE scope=?${condition}`).bind(scope).first();
    const columns = Object.keys(row), placeholders = columns.map(() => "?").join(",");
    for (const operation of [
      db.prepare(`UPDATE ${table} SET scope=scope WHERE id=?`).bind(row.id),
      db.prepare(`DELETE FROM ${table} WHERE id=?`).bind(row.id),
      db.prepare(`INSERT OR REPLACE INTO ${table}(${columns.join(",")}) VALUES(${placeholders})`).bind(...Object.values(row)),
      db.prepare(`INSERT INTO ${table}(${columns.join(",")}) VALUES(${placeholders}) ON CONFLICT(id) DO UPDATE SET scope=excluded.scope`).bind(...Object.values(row)),
    ]) await assert.rejects(operation.run(), /immutable|cannot be deleted|replacement forbidden/);
    assert.deepEqual(await db.prepare(`SELECT * FROM ${table} WHERE id=?`).bind(row.id).first(), row);
  }
});

test("concurrent duplicate requests commit a single inspection and receipt", async () => {
  const scope = "inspection-concurrent", inventory = await fixture(scope), payload = input();
  const results = await Promise.all([inventory.inspection(payload), inventory.inspection(payload)]);
  assert.equal(results[0].inspectionId, results[1].inspectionId);
  assert.equal((await inventory.detail("CHECK-001")).inspectionSummary.totalRecords, 1);
});

test("a battery edit or account revocation at the D1 commit boundary saves neither check nor audit", async () => {
  for (const target of ["battery", "account"]) {
    const scope = `inspection-race-${target}`, inventory = await fixture(scope);
    let mutate = true;
    const raced = { prepare: sql => db.prepare(sql), batch: async statements => {
      if (mutate && statements.length === 3) {
        mutate = false;
        if (target === "battery") await db.prepare("UPDATE batteries SET version=version+1,name=? WHERE key=?").bind("Concurrent asset change", `${scope}/CHECK-001`).run();
        else await db.prepare("UPDATE staff_accounts SET active=0,auth_version=auth_version+1,version=version+1,updated_at=? WHERE id=?").bind(instant.toISOString(), staff.id).run();
      }
      return db.batch(statements);
    } };
    try {
      await assert.rejects(store(scope, staff, () => instant, raced).inspection(input()), status(target === "battery" ? 409 : 403));
      assert.equal((await inventory.detail("CHECK-001")).inspections.length, 0);
      assert.equal((await inventory.fullActivity()).filter(event => event.action === "inspection_recorded").length, 0);
    } finally {
      if (target === "account") {
        await db.prepare("UPDATE staff_accounts SET active=1,auth_version=auth_version+1,version=version+1,updated_at=? WHERE id=?").bind(instant.toISOString(), staff.id).run();
        staff.authVersion = Number((await db.prepare("SELECT auth_version FROM staff_accounts WHERE id=?").bind(staff.id).first()).auth_version);
      }
    }
  }
});

test("failure after the receipt rolls back the inspection and audit together", async () => {
  const scope = "inspection-atomic", inventory = await fixture(scope), payload = input();
  let inject = true;
  const broken = { prepare: sql => db.prepare(sql), batch: async statements => {
    if (inject && statements.length === 3) { inject = false; return db.batch([...statements, db.prepare("INSERT INTO operations(id,scope,kind,fingerprint,result_json,created_at,guard) VALUES('deliberate-guard-failure','test','test','test','{}','2026-10-06',0)")]); }
    return db.batch(statements);
  } };
  await assert.rejects(store(scope, staff, () => instant, broken).inspection(payload), error => error.code === "inspection_rejected_final");
  assert.equal((await inventory.detail("CHECK-001")).inspections.length, 0);
  assert.equal((await inventory.fullActivity()).filter(event => event.action === "inspection_recorded").length, 0);
});

test("detail summaries use full histories while visible inspection and loan lists retain a 200 row limit", async () => {
  const scope = "inspection-full-history", inventory = await fixture(scope);
  const statements = [];
  for (let index = 0; index < 205; index++) {
    const inspectionId = crypto.randomUUID(), requestId = crypto.randomUUID(), at = instant.toISOString();
    const result = { requestId, dataset: "demo", actorAccountId: staff.id, batteryId: "CHECK-001", inspectionId, action: "inspection", at, replayed: false };
    statements.push(db.prepare("INSERT INTO operations(id,scope,kind,fingerprint,result_json,created_at,guard) VALUES(?,?,'inspection','fixture',?,?,1)").bind(`${scope}/${requestId}`, scope, JSON.stringify(result), at));
    statements.push(db.prepare("INSERT INTO battery_inspections(id,scope,battery_key,expected_battery_version,operation_id,kind,outcome,performed_at,recorded_at,inspector_account_id,inspector_auth_version,inspector_name) VALUES(?,?,?,1,?,'visual_check','inconclusive',?,?,?,?,?)").bind(inspectionId, scope, `${scope}/CHECK-001`, `${scope}/${requestId}`, at, at, staff.id, staff.authVersion, staff.name));
    statements.push(db.prepare("INSERT INTO loans(id,scope,battery_key,borrower_key,borrower_name,borrower_account_id,checked_out_at,returned_at,checkout_actor_id,checkout_actor_name,return_actor_id,return_actor_name) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)").bind(crypto.randomUUID(), scope, `${scope}/CHECK-001`, `${scope}/staff-${staff.id}`, staff.name, staff.id, "2026-10-04T01:00:00Z", "2026-10-04T02:00:00Z", staff.id, staff.name, staff.id, staff.name));
  }
  for (let index = 0; index < statements.length; index += 60) await db.batch(statements.slice(index, index + 60));
  const detail = await inventory.detail("CHECK-001");
  assert.equal(detail.inspections.length, 200); assert.equal(detail.inspectionSummary.totalRecords, 205); assert.equal(detail.inspectionSummary.validRecords, 205);
  assert.equal(detail.loans.length, 200); assert.equal(detail.usageSummary.totalCheckouts, 205); assert.equal(detail.usageSummary.totalCheckedOutSeconds, 205 * 3600);
  const exported = await inventory.exportData();
  assert.equal(exported.inspections.length, 205); assert.equal(exported.raw.loans.length, 205);
});

test("usage summary excludes cancelled loans, includes ongoing duration and calculates DST offsets in absolute time", () => {
  const asOf = "2026-10-04T05:00:00Z";
  const summary = summarizeBatteryUsage([
    { checkedOutAt: "2026-10-04T01:30:00+10:00", returnedAt: "2026-10-04T03:30:00+11:00", cancelledAt: null },
    { checkedOutAt: "2026-10-04T04:00:00Z", returnedAt: null, cancelledAt: null },
    { checkedOutAt: "bad date", returnedAt: null, cancelledAt: "2026-10-04T04:00:00Z" },
  ], asOf);
  assert.deepEqual(summary, { asOf: "2026-10-04T05:00:00.000Z", totalCheckouts: 2, completedCheckouts: 1, activeCheckouts: 1, totalCheckedOutSeconds: 7200, invalidDurationCount: 0 });
  assert.equal(summarizeBatteryUsage([], asOf).totalCheckedOutSeconds, 0);
});

test("usage reporting time follows the read so a movement committed during a slow read is not future evidence", async () => {
  const scope = "inspection-usage-clock", inventory = await fixture(scope);
  const afterCommit = new Date(instant.getTime() + 1000);
  await store(scope, staff, () => afterCommit).movement({ requestId: crypto.randomUUID(), kind: "checkout", batteryIds: ["CHECK-001"] });
  let clock = instant;
  const delayed = { prepare: sql => db.prepare(sql), batch: async statements => {
    if (statements.length === 11) clock = afterCommit;
    return db.batch(statements);
  } };
  const detail = await store(scope, staff, () => clock, delayed).detail("CHECK-001");
  assert.equal(detail.usageSummary.asOf, afterCommit.toISOString());
  assert.equal(detail.usageSummary.invalidDurationCount, 0);
  assert.equal(detail.usageSummary.totalCheckedOutSeconds, 0);
  assert.equal((await inventory.detail("CHECK-001")).usageSummary.totalCheckouts, 1);
});

test("usage duration stays unknown when any noncancelled record has missing, future, unzoned or negative timing", () => {
  for (const loan of [
    { returnedAt: null }, { checkedOutAt: "2026-10-04T04:00:00Z" },
    { checkedOutAt: "2026-10-04T04:00:00", returnedAt: null },
    { checkedOutAt: "2026-10-04T06:00:00Z", returnedAt: null },
    { checkedOutAt: "2026-10-04T04:00:00Z", returnedAt: "2026-10-04T03:00:00Z" },
    { checkedOutAt: "2026-10-04T04:00:00Z", returnedAt: "2026-10-04T06:00:00Z" },
  ]) {
    const summary = summarizeBatteryUsage([loan], "2026-10-04T05:00:00Z");
    assert.equal(summary.totalCheckouts, 1); assert.equal(summary.totalCheckedOutSeconds, null); assert.equal(summary.invalidDurationCount, 1);
  }
});
