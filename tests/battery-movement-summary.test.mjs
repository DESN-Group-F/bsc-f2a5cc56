import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Miniflare } from "miniflare";
import { InventoryStore } from "../work/qa/store.mjs";
import { buildBatteryMovementSummary, formatMovementDuration } from "../work/qa/battery-movement-summary.mjs";

const now = new Date("2026-10-04T03:30:00.000Z");
const loan = (overrides = {}) => ({ id: "loan-1", borrowerName: "Original Holder", borrowerAccountId: "staff-1", borrowerKind: "staff", checkedOutAt: "2026-10-04T00:00:00.000Z", returnedAt: null, cancelledAt: null, checkoutActorName: "Checkout Recorder", returnActorName: null, correctionReason: null, ...overrides });
const detail = (battery = {}, evidence = {}) => ({
  battery: { id: "BAT-ONE", registeredAt: "2026-10-03T00:00:00.000Z", lifecycleStatus: "active", lifecycleAt: null, loanId: null, borrowerName: null, ...battery },
  movementSummary: { activeLoan: null, latestReturn: null, recentLoans: [], registration: null, ...evidence },
});

test("current checkout uses the exact active loan and separates holder from recorder", () => {
  const active = loan();
  const result = buildBatteryMovementSummary(detail({ loanId: active.id, borrowerName: active.borrowerName }, { activeLoan: active, recentLoans: [active] }), now);
  assert.equal(result.status, "in_use");
  assert.equal(result.duration, "3h 30m");
  assert.equal(result.personName, "Original Holder");
  assert.equal(result.startedAt, active.checkedOutAt);
  assert.equal(result.timeline[0].actorName, "Checkout Recorder");
  assert.equal(result.timeline[0].borrowerName, "Original Holder");
  assert.equal(result.timeline[0].currentLoan, true);
  const mismatch = buildBatteryMovementSummary(detail({ loanId: "other-loan", borrowerName: "Other Holder" }, { activeLoan: active }), now);
  assert.equal(mismatch.duration, "Not available");
  assert.equal(mismatch.startedAt, null);
});

test("recorded return sets storage duration and its recorder, without substituting borrower", () => {
  const returned = loan({ returnedAt: "2026-10-04T01:00:00.000Z", returnActorName: "Return Recorder" });
  const result = buildBatteryMovementSummary(detail({}, { latestReturn: returned, recentLoans: [returned] }), now);
  assert.equal(result.status, "in_store");
  assert.equal(result.duration, "2h 30m");
  assert.equal(result.personName, "Return Recorder");
  assert.deepEqual(result.timeline.slice(0, 2).map(item => item.kind), ["return", "checkout"]);
  assert.equal(result.timeline[1].loanDuration, "1h");
  returned.returnActorName = null;
  assert.equal(buildBatteryMovementSummary(detail({}, { latestReturn: returned }), now).personName, "Not recorded");
});

test("registration remains distinct from check-in, including unknown historical actors", () => {
  const unknown = buildBatteryMovementSummary(detail(), now);
  assert.equal(unknown.duration, "No return recorded");
  assert.equal(unknown.personLabel, "Registered by");
  assert.equal(unknown.personName, "Not recorded");
  assert.equal(unknown.timeline[0].kind, "registration");
  const saved = buildBatteryMovementSummary(detail({}, { registration: { at: "2026-10-03T00:00:00.000Z", actorName: "Original Registrar" } }), now);
  assert.equal(saved.personName, "Original Registrar");
  assert.equal(saved.duration, "No return recorded");
});

test("elapsed duration uses UTC instants across Sydney spring and autumn clock changes", () => {
  const spring = loan({ checkedOutAt: "2026-10-04T01:30:00+10:00" });
  assert.equal(buildBatteryMovementSummary(detail({ loanId: spring.id }, { activeLoan: spring }), new Date("2026-10-04T03:30:00+11:00")).duration, "1h");
  const autumn = loan({ checkedOutAt: "2026-04-05T01:30:00+11:00" });
  assert.equal(buildBatteryMovementSummary(detail({ loanId: autumn.id }, { activeLoan: autumn }), new Date("2026-04-05T03:30:00+10:00")).duration, "3h");
  assert.equal(formatMovementDuration(25 * 3600_000 + 3 * 60_000), "1d 1h 3m");
  assert.equal(formatMovementDuration(59_999), "Less than 1m");
});

test("missing, impossible, unzoned, future and reversed movement dates never create a duration", () => {
  for (const invalid of [null, "", "invalid", "2026-02-30T00:00:00Z", "2026-10-04", "2026-10-04T00:00:00", "2026-10-04T24:00:00Z", "2026-10-04T04:00:00Z"]) {
    const active = loan({ checkedOutAt: invalid });
    assert.equal(buildBatteryMovementSummary(detail({ loanId: active.id }, { activeLoan: active }), now).duration, "Not available", String(invalid));
  }
  for (const invalid of ["2026-10-03T23:00:00Z", "2026-10-04T04:00:00Z", "bad"]) {
    const returned = loan({ returnedAt: invalid });
    const result = buildBatteryMovementSummary(detail({}, { latestReturn: returned, recentLoans: [returned] }), now);
    assert.equal(result.duration, "Not available");
    assert.equal(result.timeline.find(item => item.kind === "return").at, null);
  }
  for (const input of [null, -1, NaN, Infinity]) assert.equal(formatMovementDuration(input), "Not available");
});

test("voided loans never appear and terminal assets stop movement timing", () => {
  const cancelled = loan({ returnedAt: "2026-10-04T01:00:00Z", cancelledAt: "2026-10-04T02:00:00Z" });
  assert.equal(buildBatteryMovementSummary(detail({}, { latestReturn: cancelled, recentLoans: [cancelled] }), now).timeline.length, 1);
  for (const lifecycleStatus of ["scrapped", "permanently_removed"]) {
    const terminal = detail({ lifecycleStatus, lifecycleAt: "2026-10-04T01:30:00Z" });
    const result = buildBatteryMovementSummary(terminal, now);
    assert.equal(result.status, lifecycleStatus);
    assert.equal(result.duration, "Tracking ended");
    assert.deepEqual(buildBatteryMovementSummary(terminal, new Date("2026-10-05T03:30:00Z")), result);
  }
});

test("equal movement timestamps have a stable event order independent of input order", () => {
  const first = loan({ id: "first", returnedAt: "2026-10-04T01:00:00Z" });
  const second = loan({ id: "second", returnedAt: "2026-10-04T12:00:00+11:00" });
  const forward = buildBatteryMovementSummary(detail({}, { recentLoans: [first, second] }), now).timeline;
  const reverse = buildBatteryMovementSummary(detail({}, { recentLoans: [second, first] }), now).timeline;
  assert.deepEqual(forward, reverse);
  assert.deepEqual(forward.slice(0, 2).map(item => item.id), ["first:return", "second:return"]);
});

const runtime = new Miniflare({ modules: true, script: "export default {fetch(){return new Response('movement-summary-test')}}", compatibilityDate: "2026-05-15", d1Databases: { DB: "movement-summary-test" }, d1Persist: false });
const db = await runtime.getD1Database("DB");
const journal = JSON.parse(await readFile("drizzle/meta/_journal.json", "utf8"));
for (const entry of journal.entries) {
  const sql = await readFile(`drizzle/${entry.tag}.sql`, "utf8");
  await db.batch(sql.split("--> statement-breakpoint").filter(value => value.trim()).map(value => db.prepare(value)));
}
after(() => runtime.dispose());
const admin = { id: "summary-admin", name: "Original Administrator", role: "admin", authVersion: 1 };
const staff = { id: "summary-staff", name: "Original Staff", role: "staff", authVersion: 1 };
for (const actor of [admin, staff]) await db.prepare("INSERT INTO staff_accounts(id,username,display_name,role,password_hash,password_salt,hash_iterations,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)")
  .bind(actor.id, actor.id, actor.name, actor.role, "test-only-no-login", "test-only-no-login", 600000, now.toISOString(), now.toISOString()).run();

async function fixture(name, dataset = "demo") {
  const scope = `summary-${name}:${dataset}`;
  let at = new Date("2026-10-03T20:00:00Z");
  const store = (actor = admin, database = db) => new InventoryStore(database, scope, dataset, actor, () => at);
  await store().snapshot();
  await store(staff).saveBattery({ id: "BAT-ONE", name: "Summary test battery", ownerId: `staff-${admin.id}`, homeBuildingId: "J18", homeRoomId: null });
  return { scope, store, setTime: value => { at = new Date(value); } };
}
async function checkout(context) {
  await context.store(staff).movement({ requestId: crypto.randomUUID(), kind: "checkout", batteryIds: ["BAT-ONE"] });
  return (await context.store().detail("BAT-ONE")).battery.loanId;
}
async function returnCurrent(context) {
  const loanId = (await context.store().detail("BAT-ONE")).battery.loanId;
  await context.store().movement({ requestId: crypto.randomUUID(), kind: "return", batteryIds: ["BAT-ONE"], expectedLoans: [{ batteryId: "BAT-ONE", loanId }] });
}

test("D1 summary and registration bypass 200-row histories without changing any evidence", async () => {
  const context = await fixture("long-history");
  context.setTime("2026-10-03T21:00:00Z");
  const validId = await checkout(context);
  context.setTime("2026-10-03T22:00:00Z");
  await returnCurrent(context);
  const statements = [];
  for (let index = 0; index < 205; index++) {
    const at = new Date(Date.parse("2026-10-03T23:00:00Z") + index * 1000).toISOString();
    statements.push(db.prepare("INSERT INTO loans(id,scope,battery_key,borrower_key,borrower_name,borrower_account_id,checked_out_at,cancelled_at,checkout_actor_id,checkout_actor_name) VALUES(?,?,?,?,?,?,?,?,?,?)")
      .bind(crypto.randomUUID(), context.scope, `${context.scope}/BAT-ONE`, `${context.scope}/staff-${staff.id}`, staff.name, staff.id, at, at, staff.id, staff.name));
    statements.push(db.prepare("INSERT INTO audit_events(id,scope,action,battery_id,actor_id,actor_name,at,details_json) VALUES(?,?,?,?,?,?,?,?)")
      .bind(crypto.randomUUID(), context.scope, "battery_updated", "BAT-ONE", admin.id, admin.name, at, "{}"));
  }
  for (let index = 0; index < statements.length; index += 80) await db.batch(statements.slice(index, index + 80));
  const before = (await db.prepare("SELECT * FROM loans WHERE scope=? ORDER BY rowid").bind(context.scope).all()).results;
  const record = await context.store().detail("BAT-ONE");
  assert.equal(record.loans.length, 200);
  assert.ok(record.loans.every(item => item.cancelledAt !== null));
  assert.ok(record.events.every(item => item.action !== "battery_registered"));
  assert.equal(record.movementSummary.latestReturn.id, validId);
  assert.deepEqual(record.movementSummary.recentLoans.map(item => item.id), [validId]);
  assert.equal(record.movementSummary.registration.actorName, staff.name);
  const result = buildBatteryMovementSummary(record, now);
  assert.equal(result.duration, "5h 30m");
  assert.equal(result.personName, admin.name);
  assert.equal(result.timeline.length, 3);
  assert.deepEqual((await db.prepare("SELECT * FROM loans WHERE scope=? ORDER BY rowid").bind(context.scope).all()).results, before);
});

test("D1 summary follows returns, reopen corrections and voids while retaining original audit", async () => {
  const context = await fixture("corrections");
  context.setTime("2026-10-03T21:00:00Z");
  const loanId = await checkout(context);
  let record = await context.store().detail("BAT-ONE");
  assert.equal(record.movementSummary.activeLoan.id, loanId);
  context.setTime("2026-10-03T22:00:00Z");
  await returnCurrent(context);
  record = await context.store().detail("BAT-ONE");
  assert.equal(record.movementSummary.activeLoan, null);
  assert.equal(record.movementSummary.latestReturn.returnActorName, admin.name);
  await context.store().correctLoan({ requestId: crypto.randomUUID(), loanId, action: "return_reopened", expectedReturnedAt: "2026-10-03T22:00:00.000Z", reason: "Wrong battery returned by mistake." });
  record = await context.store().detail("BAT-ONE");
  assert.equal(record.movementSummary.latestReturn, null);
  assert.equal(record.movementSummary.activeLoan.id, loanId);
  const reopened = buildBatteryMovementSummary(record, now);
  assert.equal(reopened.duration, "6h 30m");
  assert.ok(reopened.timeline.every(item => item.kind !== "return"));
  assert.ok(record.events.some(item => item.action === "return"));
  assert.ok(record.events.some(item => item.action === "return_reopened"));
  await context.store().correctLoan({ requestId: crypto.randomUUID(), loanId, action: "checkout_voided", expectedReturnedAt: null, reason: "Checkout was also entered in error." });
  record = await context.store().detail("BAT-ONE");
  assert.equal(record.movementSummary.activeLoan, null);
  assert.equal(record.movementSummary.recentLoans.length, 0);
  assert.equal(buildBatteryMovementSummary(record, now).duration, "No return recorded");
  assert.equal(record.loans[0].id, loanId);
  assert.ok(record.loans[0].cancelledAt);
});

test("D1 summary is scoped to the chosen inventory and shares the battery snapshot batch", async () => {
  const demo = await fixture("scope", "demo"), live = await fixture("scope", "live");
  const loanId = await checkout(demo);
  const saved = await live.store().detail("BAT-ONE");
  assert.equal(saved.movementSummary.activeLoan, null);
  assert.equal(saved.movementSummary.recentLoans.length, 0);
  const batches = [], wrapper = { prepare: sql => db.prepare(sql), batch: statements => { batches.push(statements.length); return db.batch(statements); } };
  const scoped = await demo.store(admin, wrapper).detail("BAT-ONE");
  assert.equal(scoped.battery.loanId, loanId);
  assert.equal(scoped.movementSummary.activeLoan.id, loanId);
  // Inspection evidence and complete usage history join the same snapshot batch.
  assert.equal(batches.at(-1), 11);
  assert.equal(scoped.movementSummary.registration.actorName, staff.name);
});

test("D1 latest return and timeline use actual instants when historical timestamps have different offsets", async () => {
  const context = await fixture("offsets");
  for (const [id, checkedOut, returned] of [
    ["older-return", "2026-10-04T11:00:00+11:00", "2026-10-04T12:00:00+11:00"],
    ["newer-return", "2026-10-04T01:30:00Z", "2026-10-04T02:30:00Z"],
  ]) await db.prepare("INSERT INTO loans(id,scope,battery_key,borrower_key,borrower_name,borrower_account_id,checked_out_at,returned_at,checkout_actor_id,checkout_actor_name,return_actor_id,return_actor_name) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)")
    .bind(id, context.scope, `${context.scope}/BAT-ONE`, `${context.scope}/staff-${staff.id}`, staff.name, staff.id, checkedOut, returned, staff.id, staff.name, admin.id, admin.name).run();
  const record = await context.store().detail("BAT-ONE");
  assert.equal(record.movementSummary.latestReturn.id, "newer-return");
  assert.deepEqual(record.movementSummary.recentLoans.map(item => item.id), ["newer-return", "older-return"]);
  const result = buildBatteryMovementSummary(record, now);
  assert.equal(result.duration, "1h");
  assert.deepEqual(result.timeline.slice(0, 4).map(item => item.id), ["newer-return:return", "newer-return:checkout", "older-return:return", "older-return:checkout"]);
});
