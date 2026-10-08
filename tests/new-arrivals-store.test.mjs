import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Miniflare } from "miniflare";
import { InventoryStore } from "../work/qa/store.mjs";
import { IntakeStore } from "../work/qa/intake-store.mjs";
import { MobileRegistrationStore } from "../work/qa/server/inventory/mobile-registration.mjs";

const mf = new Miniflare({ modules: true, script: "export default {fetch(){return new Response('new-arrivals-test')}}", compatibilityDate: "2026-05-15", d1Databases: { DB: "new-arrivals-test" }, d1Persist: false });
const db = await mf.getD1Database("DB");
after(() => mf.dispose());
const journal = JSON.parse(await readFile("drizzle/meta/_journal.json", "utf8")).entries;
async function migrate(entry) {
  const sql = await readFile(`drizzle/${entry.tag}.sql`, "utf8");
  await db.batch(sql.split("--> statement-breakpoint").filter(value => value.trim()).map(value => db.prepare(value)));
}
for (const entry of journal.filter(entry => entry.idx < 19)) await migrate(entry);
const at = "2026-10-08T05:00:00.000Z";
const admin = { id: crypto.randomUUID(), name: "Shared Staff Name", role: "admin", authVersion: 1 };
const staff = { id: crypto.randomUUID(), name: "Shared Staff Name", role: "staff", authVersion: 1 };
const importer = { id: crypto.randomUUID(), name: "Arrival Import Administrator", role: "admin", authVersion: 1 };
async function account(actor) {
  await db.prepare("INSERT INTO staff_accounts(id,username,display_name,role,password_hash,password_salt,hash_iterations,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)")
    .bind(actor.id, `arrival-${actor.id}`, actor.name, actor.role, "test-only", "test-only", 600000, at, at).run();
}
for (const actor of [admin, staff, importer]) await account(actor);
const batteryInput = (id, extra = {}) => ({ id, name: `Battery ${id}`, tagId: null, chemistry: "LiPo", voltage: 7.4, capacityMah: 2200, manufacturedOn: null, firstUsedOn: null, ownerId: `staff-${staff.id}`, homeBuildingId: "J18", homeRoomId: null, ...extra });
const historicalScope = "arrival-historical:demo";
const historical = actor => new InventoryStore(db, historicalScope, "demo", actor, () => new Date(at));
await historical(admin).initializeDemo();
await historical(staff).saveBattery(batteryInput("OLD-NATIVE"));
await historical(admin).saveBattery(batteryInput("OLD-SELF"));
await historical({ id: "unknown-historical-actor", name: "Unverified old actor", role: "staff" }).saveBattery(batteryInput("OLD-UNKNOWN"));
await db.prepare("INSERT INTO audit_events(id,scope,action,battery_id,actor_id,actor_name,at,details_json) VALUES(?,?,'battery_registered','OLD-NATIVE',?,?,?,'{}')")
  .bind(crypto.randomUUID(), historicalScope, staff.id, staff.name, at).run();
for (const entry of journal.filter(entry => entry.idx >= 19)) await migrate(entry);
const rows = async (table, scope) => (await db.prepare(`SELECT * FROM ${table} WHERE scope=? ORDER BY rowid`).bind(scope).all()).results;
async function fixture(name, dataset = "demo") {
  const scope = `arrivals-${name}:${dataset}`;
  let now = new Date(at);
  const store = (actor = admin, database = db) => new InventoryStore(database, scope, dataset, actor, () => new Date(now));
  await store().snapshot();
  return {
    scope, dataset, store, clock: () => new Date(now), setTime: value => { now = new Date(value); },
    register: (id, actor = staff, extra = {}) => store(actor).saveBattery(batteryInput(id, extra)),
    arrivals: async (actor = admin) => (await store(actor).snapshot()).newArrivals,
    bindings: async id => {
      const battery = (await store().detail(id)).battery;
      return [{ batteryId: id, version: battery.version, tagId: battery.tagId }];
    },
  };
}
function beforeAcknowledgement(intervene) {
  const statementSql = new WeakMap(); let intercepted = false;
  return {
    prepare: sql => { const statement = db.prepare(sql); return { bind: (...values) => { const bound = statement.bind(...values); statementSql.set(bound, sql); return bound; } }; },
    batch: async statements => {
      if (!intercepted && statements.some(statement => (statementSql.get(statement) ?? "").startsWith("INSERT INTO inventory_arrival_acknowledgements"))) { intercepted = true; await intervene(); }
      return db.batch(statements);
    },
  };
}

test("migration backfills native first-registration evidence once and starts existing and new accounts without historical alerts", async () => {
  const snapshot = await historical(admin).snapshot();
  assert.equal(snapshot.newArrivals.unreadCount, 0);
  assert.equal(snapshot.newArrivals.throughSequence, 2);
  assert.equal(snapshot.newArrivals.acknowledgedThroughSequence, 2);
  assert.deepEqual(snapshot.newArrivals.items.map(item => item.batteryId).sort(), ["OLD-NATIVE", "OLD-SELF"]);
  assert.equal((await rows("inventory_arrivals", historicalScope)).length, 2);
  const newcomer = { id: crypto.randomUUID(), name: "New Native Staff", role: "staff", authVersion: 1 };
  await account(newcomer);
  assert.equal((await historical(newcomer).snapshot()).newArrivals.unreadCount, 0);
  await historical(staff).saveBattery(batteryInput("AFTER-ACCOUNT"));
  assert.equal((await historical(newcomer).snapshot()).newArrivals.unreadCount, 1);
  assert.equal((await historical(newcomer).snapshot()).newArrivals.items.length, 3);
});

test("native identity and dataset determine unread alerts while own registrations keep the same 48-hour label", async () => {
  const context = await fixture("native"), live = await fixture("native", "live");
  for (const id of ["NEW-ONE", "NEW-TWO", "NEW-THREE"]) await context.register(id);
  await context.register("OWN-NEW", admin);
  const snapshot = await context.arrivals();
  assert.equal(snapshot.items.length, 4); assert.equal(snapshot.unreadCount, 3);
  assert.equal(snapshot.items.find(item => item.batteryId === "OWN-NEW").isUnread, false);
  assert.equal((await context.arrivals(staff)).unreadCount, 1, "same display names must not merge native actors");
  await context.store().acknowledgeNewArrivals({ throughSequence: snapshot.throughSequence });
  assert.equal((await context.arrivals()).unreadCount, 0);
  assert.equal((await context.arrivals()).items.length, 4, "acknowledgement must not remove recent registration labels");
  assert.equal((await context.arrivals(staff)).unreadCount, 1, "another account's reading state stays independent");
  await live.register("LIVE-NEW");
  assert.equal((await live.arrivals()).unreadCount, 1);
  assert.equal((await context.arrivals()).unreadCount, 0);
  assert.deepEqual(await new InventoryStore(db, context.scope, context.dataset, admin, context.clock).acknowledgeNewArrivals({ throughSequence: snapshot.throughSequence }), { dataset: "demo", actorAccountId: admin.id, acknowledgedThroughSequence: snapshot.throughSequence });
});

test("48-hour expiry uses confirmed server registration time and active lifecycle, independently of manufacture, loans and acknowledgement", async () => {
  const context = await fixture("expiry");
  await context.register("AGED-PHYSICAL", staff, { manufacturedOn: "2020-01-01", firstUsedOn: "2021-01-01" });
  const start = await context.arrivals();
  await context.store(staff).movement({ requestId: crypto.randomUUID(), kind: "checkout", batteryIds: ["AGED-PHYSICAL"] });
  const loanId = (await context.store().detail("AGED-PHYSICAL")).battery.loanId;
  await context.store(staff).movement({ requestId: crypto.randomUUID(), kind: "return", batteryIds: ["AGED-PHYSICAL"], expectedLoans: [{ batteryId: "AGED-PHYSICAL", loanId }] });
  assert.equal((await context.arrivals()).throughSequence, start.throughSequence);
  context.setTime(new Date(new Date(at).getTime() + 48 * 60 * 60 * 1000 - 1));
  assert.equal((await context.arrivals()).items.length, 1); assert.equal((await context.arrivals()).unreadCount, 1);
  context.setTime(new Date(new Date(at).getTime() + 48 * 60 * 60 * 1000));
  assert.deepEqual((await context.arrivals()).items, []); assert.equal((await context.arrivals()).unreadCount, 0);
  assert.equal((await context.store().detail("AGED-PHYSICAL")).battery.registeredAt, at);
  assert.equal((await rows("inventory_arrivals", context.scope)).length, 1, "expiry is a view, not erased registration evidence");
});

test("captured acknowledgement cannot swallow a concurrent registration or regress after a later tab acknowledgement", async () => {
  const context = await fixture("ack-race"); await context.register("SEEN");
  const seen = await context.arrivals();
  const database = beforeAcknowledgement(async () => {
    context.setTime(new Date(new Date(at).getTime() - 1000));
    await context.register("CONCURRENT-OLDER-TIME");
    context.setTime(at);
  });
  await context.store(admin, database).acknowledgeNewArrivals({ throughSequence: seen.throughSequence });
  const after = await context.arrivals();
  assert.equal(after.unreadCount, 1); assert.equal(after.throughSequence, seen.throughSequence + 1);
  assert.equal(after.items.find(item => item.batteryId === "CONCURRENT-OLDER-TIME").isUnread, true);
  await context.store().acknowledgeNewArrivals({ throughSequence: after.throughSequence });
  assert.equal((await context.store().acknowledgeNewArrivals({ throughSequence: seen.throughSequence })).acknowledgedThroughSequence, after.throughSequence);
  assert.equal((await context.arrivals()).unreadCount, 0);
  await assert.rejects(context.store().acknowledgeNewArrivals({ throughSequence: after.throughSequence + 1 }), error => error.status === 409);
  assert.equal((await context.arrivals()).acknowledgedThroughSequence, after.throughSequence);
});

test("acknowledgement guards native authority at commit and rejects account injection without changing business evidence", async () => {
  const context = await fixture("authority"); await context.register("REVIEWED");
  const seen = await context.arrivals();
  await assert.rejects(context.store({ ...admin, authVersion: undefined }).acknowledgeNewArrivals({ throughSequence: seen.throughSequence }), error => error.status === 401);
  await assert.rejects(context.store().acknowledgeNewArrivals({ throughSequence: seen.throughSequence, accountId: staff.id }), error => error.name === "ZodError");
  const revocable = { id: crypto.randomUUID(), name: "Revocable Staff", role: "staff", authVersion: 1 };
  await account(revocable); await context.register("AFTER-REVOCABLE-ACCOUNT");
  const snapshot = await context.arrivals(revocable), evidence = await rows("audit_events", context.scope);
  const database = beforeAcknowledgement(() => db.prepare("UPDATE staff_accounts SET active=0,version=version+1,auth_version=auth_version+1,updated_at=? WHERE id=?").bind(at, revocable.id).run());
  await assert.rejects(context.store(revocable, database).acknowledgeNewArrivals({ throughSequence: snapshot.throughSequence }), error => error.status === 409);
  assert.equal((await context.arrivals(revocable)).acknowledgedThroughSequence, seen.throughSequence);
  assert.deepEqual(await rows("audit_events", context.scope), evidence);
});

test("manual, CSV, demo intake and mobile registration enter the same first-registration sequence without replay duplicates", async () => {
  const context = await fixture("sources");
  await context.register("MANUAL");
  await context.store(importer).importRecords("batteries", [batteryInput("CSV-ONE"), batteryInput("CSV-TWO")]);
  const common = batteryInput("IGNORED-ID"); delete common.id; delete common.tagId;
  const actor = { id: staff.id, displayName: staff.name, role: staff.role, authVersion: staff.authVersion };
  const intake = new IntakeStore(db, context.scope, "demo", actor, context.clock);
  const intakePayload = { requestId: crypto.randomUUID(), sessionId: crypto.randomUUID(), tagId: "DEMO-INTAKE-ARRIVAL", common, firstUseMode: "at_registration" };
  const demoReceipt = await intake.register(intakePayload);
  await intake.register(intakePayload);
  const mobile = new MobileRegistrationStore(db, context.scope, "demo", actor, context.clock);
  const mobilePayload = { requestId: crypto.randomUUID(), sessionId: crypto.randomUUID(), source: "operator-entered-registration", tagId: null, common, firstUseMode: "at_registration" };
  const mobileReceipt = await mobile.register(mobilePayload);
  await mobile.register(mobilePayload);
  const snapshot = await context.arrivals();
  assert.equal(snapshot.items.length, 5); assert.equal(snapshot.unreadCount, 5); assert.equal(snapshot.throughSequence, 5);
  assert.deepEqual(new Set(snapshot.items.map(item => item.batteryId)), new Set(["MANUAL", "CSV-ONE", "CSV-TWO", demoReceipt.batteryId, mobileReceipt.batteryId]));
  await db.prepare("INSERT INTO audit_events(id,scope,action,battery_id,actor_id,actor_name,at,details_json) VALUES(?,?,'battery_registered','MANUAL',?,?,?,'{}')").bind(crypto.randomUUID(), context.scope, staff.id, staff.name, at).run();
  assert.equal((await context.arrivals()).throughSequence, 5);
  assert.equal((await rows("inventory_arrivals", context.scope)).length, 5);
  await assert.rejects(context.store(importer).importRecords("batteries", [batteryInput("ROLLBACK"), batteryInput("MANUAL")]), error => error.status === 409);
  assert.equal((await context.arrivals()).throughSequence, 5);
  assert.equal((await context.arrivals()).items.some(item => item.batteryId === "ROLLBACK"), false);
});

test("scrapping suppresses arrivals, recovery keeps the original clock, and purge clears its ledger without reusing the cursor", async () => {
  const context = await fixture("lifecycle"); await context.register("RECOVER"); await context.register("DELETE");
  const initial = await context.arrivals();
  for (const id of ["RECOVER", "DELETE"]) await context.store(staff).lifecycle({ requestId: crypto.randomUUID(), kind: "scrapped", reason: "", destination: null, source: "manual_selection", items: await context.bindings(id) });
  assert.equal((await context.arrivals()).unreadCount, 0); assert.deepEqual((await context.arrivals()).items, []);
  await context.store(staff).retiredAsset({ requestId: crypto.randomUUID(), kind: "recover", items: await context.bindings("RECOVER") });
  const recovered = await context.arrivals();
  assert.equal(recovered.throughSequence, initial.throughSequence); assert.equal(recovered.items[0].registeredAt, at);
  await context.store().retiredAsset({ requestId: crypto.randomUUID(), kind: "purge", items: await context.bindings("DELETE") });
  assert.deepEqual((await rows("inventory_arrivals", context.scope)).map(item => item.battery_key), [`${context.scope}/RECOVER`]);
  assert.equal((await context.arrivals()).throughSequence, initial.throughSequence);
  await context.store().acknowledgeNewArrivals({ throughSequence: initial.throughSequence });
  await context.register("AFTER-PURGE");
  assert.equal((await context.arrivals()).throughSequence, initial.throughSequence + 1);
  assert.equal((await context.arrivals()).unreadCount, 1);
  assert.equal((await context.store().snapshot()).purgedBatteries.length, 1);
  await assert.rejects(db.prepare("DELETE FROM inventory_arrivals WHERE scope=?").bind(context.scope).run(), /authenticated battery purge/);
  await assert.rejects(db.prepare("UPDATE inventory_arrival_counters SET last_sequence=1 WHERE scope=?").bind(context.scope).run(), /advance monotonically/);
  assert.deepEqual((await db.prepare("PRAGMA foreign_key_check").all()).results, []);
});

test("arrivals and exports are complete beyond the 200-event activity preview and never depend on directory labels", async () => {
  const context = await fixture("uncapped");
  await context.store(importer).importRecords("batteries", Array.from({ length: 200 }, (_, index) => batteryInput(`NEW-${String(index).padStart(3, "0")}`)));
  await context.register("NEW-201", importer);
  const snapshot = await context.store().snapshot();
  assert.equal(snapshot.events.length, 200); assert.equal(snapshot.newArrivals.items.length, 201); assert.equal(snapshot.newArrivals.unreadCount, 201);
  const exported = await context.store().exportData();
  assert.equal(exported.snapshot.newArrivals.items.length, 201);
  assert.equal(exported.raw.batteries.length, 201); assert.equal(exported.raw.audit_events.length, 202);
  assert.deepEqual(exported.inspections, []);
  await context.store().acknowledgeNewArrivals({ throughSequence: snapshot.newArrivals.throughSequence });
  assert.equal((await context.arrivals()).items.length, 201); assert.equal((await context.arrivals()).unreadCount, 0);
});
