import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Miniflare } from "miniflare";
import { LocationStore } from "../work/qa/server/inventory/location.mjs";
import { InventoryStore } from "../work/qa/store.mjs";
import { createExport } from "../work/qa/exports.mjs";
import { locationCaptureSchema, SIMULATED_LOCATION_SOURCE } from "../work/qa/location-observations.mjs";

const mf = new Miniflare({ modules: true, script: "export default {fetch(){return new Response('location-test')}}", compatibilityDate: "2026-05-15", d1Databases: { DB: "location-test" }, d1Persist: false });
const db = await mf.getD1Database("DB");
after(() => mf.dispose());
for (const entry of JSON.parse(await readFile("drizzle/meta/_journal.json", "utf8")).entries) {
  const sql = await readFile(`drizzle/${entry.tag}.sql`, "utf8");
  await db.batch(sql.split("--> statement-breakpoint").filter(value => value.trim()).map(value => db.prepare(value)));
}
const at = "2026-10-10T00:00:00.000Z";
const admin = { id: crypto.randomUUID(), name: "Location Administrator", role: "admin", authVersion: 1 };
const staff = { id: crypto.randomUUID(), name: "Location Staff", role: "staff", authVersion: 1 };
for (const actor of [admin, staff]) await db.prepare("INSERT INTO staff_accounts(id,username,display_name,role,password_hash,password_salt,hash_iterations,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)").bind(actor.id, actor.id, actor.name, actor.role, "test-only", "test-only", 600000, at, at).run();

async function fixture(name, dataset = "demo") {
  const scope = `location-${name}:${dataset}`;
  let now = new Date(at);
  const inventory = (actor = admin, database = db) => new InventoryStore(database, scope, dataset, actor, () => new Date(now));
  const locations = (actor = admin, database = db) => new LocationStore(database, scope, dataset, actor, () => new Date(now));
  await locations().list();
  const snapshot = await inventory().snapshot();
  const rooms = snapshot.rooms.filter(room => room.buildingId === "J18");
  const building = snapshot.buildings.find(item => item.id === "J18");
  await inventory().saveBattery({ id: "BAT-LOC", name: "Location test battery", tagId: `TAG-${name}`, ownerId: `staff-${admin.id}`, homeBuildingId: "J18", homeRoomId: null });
  const mapping = (id, room = rooms[0], extra = {}) => ({ action: "create", requestId: crypto.randomUUID(), id, label: `Room beacon ${id}`, identifier: `fixture-${name}-${id}`, roomId: room.id, roomVersion: room.version, buildingVersion: building.version, active: true, ...extra });
  const create = async (id, room = rooms[0]) => (await locations().saveBeacon(mapping(id, room))).beacon;
  const capture = (beacons, extra = {}) => ({ requestId: crypto.randomUUID(), source: "demo_room_scan", batteryId: "BAT-LOC", tagId: `TAG-${name}`, expectedBatteryVersion: 1, capturedAt: at, candidates: beacons.map(beacon => ({ beaconId: beacon.id, version: beacon.version, detectedAt: at, rssi: -60 })), ...extra });
  const rows = async table => (await db.prepare(`SELECT * FROM ${table} WHERE scope=? ORDER BY rowid`).bind(scope).all()).results;
  return { scope, inventory, locations, mapping, create, capture, rows, rooms, building, setTime: value => { now = new Date(value); } };
}

function beforeBatch(intervene) {
  let intercepted = false;
  return { prepare: sql => db.prepare(sql), batch: async statements => {
    if (!intercepted) { intercepted = true; await intervene(); }
    return db.batch(statements);
  } };
}

test("room beacon directory provisions reference rooms without pretending hardware is available", async () => {
  const context = await fixture("directory");
  const snapshot = await context.locations().list();
  assert.deepEqual(snapshot.capabilities, { hardwareIngestion: false, demoSimulation: true, manageBeacons: true });
  assert.ok(context.rooms.length >= 2);
  assert.deepEqual((await context.locations(staff).list()).capabilities, { hardwareIngestion: false, demoSimulation: false, manageBeacons: false });
  await assert.rejects(context.locations(staff).saveBeacon(context.mapping("A01")), error => error.status === 403);
  const beacon = await context.create("A01");
  assert.equal(beacon.hardwareValidated, false);
  await assert.rejects(context.locations().saveBeacon({ ...context.mapping("A02"), hardwareValidated: true }), /Unrecognized key/);
  await assert.rejects(context.locations(staff).record(context.capture([beacon])), error => error.status === 403);
  await assert.rejects(context.locations(staff).record(context.capture([beacon], { source: "phone_ble_scan" })), error => error.status === 501 && error.code === "location_hardware_unavailable");
  const live = await fixture("working", "live");
  await assert.rejects(live.locations().saveBeacon(live.mapping("A01")), error => error.status === 400);
  await assert.rejects(live.locations().record(live.capture([], { source: "phone_ble_scan" })), error => error.status === 501);
  await assert.rejects(live.locations().record(live.capture([])), error => error.status === 400);
  assert.equal((await live.rows("observations")).length, 0);
});

test("beacon edits require reviewed versions and preserve exact receipts plus attributed history", async () => {
  const context = await fixture("edits"), payload = context.mapping("A01");
  const created = await context.locations().saveBeacon(payload);
  assert.equal((await context.locations().saveBeacon(payload)).replayed, true);
  const update = { ...payload, action: "update", requestId: crypto.randomUUID(), expectedVersion: 1, label: "Moved room beacon", roomId: context.rooms[1].id, roomVersion: context.rooms[1].version };
  const edited = await context.locations().saveBeacon(update);
  assert.equal(edited.beacon.version, 2);
  assert.equal(edited.beacon.roomId, context.rooms[1].id);
  assert.equal((await context.locations().saveBeacon(payload)).beacon.roomId, created.beacon.roomId);
  await assert.rejects(context.locations().saveBeacon({ ...update, requestId: crypto.randomUUID() }), error => error.code === "location_rejected_final");
  await assert.rejects(context.locations().saveBeacon({ ...payload, label: "Different request" }), error => error.code === "idempotency_conflict");
  await assert.rejects(context.locations().saveBeacon({ ...context.mapping("A02"), roomVersion: 99 }), error => error.code === "location_rejected_final");
  const events = (await context.rows("audit_events")).filter(row => row.action.startsWith("location_beacon"));
  assert.equal(events.length, 2);
  assert.equal(JSON.parse(events[1].details_json).before.roomId, context.rooms[0].id);
  assert.equal(JSON.parse(events[1].details_json).after.roomId, context.rooms[1].id);
});

test("same-room beacons produce one dated observation, no loan or registered-home mutation", async () => {
  const context = await fixture("record"), one = await context.create("A01"), two = await context.create("A02");
  const before = (await context.inventory().detail("BAT-LOC")).battery;
  const payload = context.capture([one, two]);
  const result = await context.locations().record(payload);
  assert.equal(result.outcome, "recorded");
  assert.equal(result.source, SIMULATED_LOCATION_SOURCE);
  const [observation] = await context.rows("observations");
  assert.equal(observation.id, result.observationId);
  assert.equal(observation.observed_at, at);
  assert.equal(observation.received_at, at);
  assert.match(observation.room_name, /Placeholder/);
  const after = (await context.inventory().detail("BAT-LOC")).battery;
  for (const field of ["homeRoomId", "homeBuildingId", "version", "loanId", "ownerAccountId"]) assert.equal(after[field], before[field]);
  assert.equal(after.observedRoomId, one.roomId);
  assert.equal((await context.rows("loans")).length, 0);
  const report = await createExport(context.inventory(), { dataset: "demo", mode: "detail", batteryId: "BAT-LOC", sections: ["observations"] });
  assert.equal(report.tables.Observations.length, 1);
  assert.equal(report.tables.Observations[0].source, SIMULATED_LOCATION_SOURCE);
});

test("concurrent exact retries create only one observation and preserve a captured mapping after later edits", async () => {
  const context = await fixture("retry"), beacon = await context.create("A01"), payload = context.capture([beacon]);
  const results = await Promise.all([context.locations().record(payload), context.locations().record(payload)]);
  assert.equal(results[0].observationId, results[1].observationId);
  assert.equal((await context.rows("observations")).length, 1);
  await context.locations().saveBeacon({ ...context.mapping(beacon.id), action: "update", expectedVersion: 1, active: false });
  assert.equal((await context.locations().record(payload)).replayed, true);
  assert.equal((await context.rows("audit_events")).filter(event => event.action === "location_observation_recorded").length, 1);
  await assert.rejects(context.locations().record({ ...payload, tagId: "changed" }), error => error.code === "idempotency_conflict");
});

test("unknown and ambiguous scans retain their own outcomes without replacing a definite observation", async () => {
  const context = await fixture("ambiguity"), first = await context.create("A01"), other = await context.create("A03", context.rooms[1]);
  const clear = await context.locations().record(context.capture([first]));
  const ambiguous = await context.locations().record(context.capture([first, other]));
  assert.equal(ambiguous.outcome, "ambiguous"); assert.equal(ambiguous.observationId, null); assert.equal(ambiguous.room, null);
  const unknown = await context.locations().record(context.capture([]));
  assert.equal(unknown.outcome, "unresolved"); assert.equal(unknown.room, null);
  assert.equal((await context.rows("observations")).length, 1);
  assert.equal((await context.inventory().detail("BAT-LOC")).battery.observedRoomId, clear.room.id);
  assert.equal((await context.rows("audit_events")).filter(row => row.action === "location_scan_unresolved").length, 2);
});

test("late uploads preserve scan time, receipt time and chronological latest location", async () => {
  const context = await fixture("late"), first = await context.create("A01"), later = await context.create("A03", context.rooms[1]);
  context.setTime("2026-10-10T02:00:00.000Z");
  await context.locations().record(context.capture([later], { capturedAt: "2026-10-10T01:00:00.000Z", candidates: [{ beaconId: later.id, version: 1, detectedAt: "2026-10-10T01:00:00.000Z" }] }));
  const delayed = await context.locations().record(context.capture([first]));
  assert.equal(delayed.capturedAt, at); assert.equal(delayed.receivedAt, "2026-10-10T02:00:00.000Z");
  assert.equal((await context.inventory().detail("BAT-LOC")).battery.observedRoomId, later.roomId);
  assert.equal((await context.rows("observations")).length, 2);
  assert.equal(locationCaptureSchema.safeParse(context.capture([first], { candidates: [{ beaconId: first.id, version: 1, detectedAt: "2026-10-09T23:59:00.000Z" }] })).success, false);
  await assert.rejects(context.locations().record(context.capture([first], { capturedAt: "2026-10-11T00:00:00.000Z", candidates: [] })), error => error.code === "location_rejected_final");
});

test("room renaming never backfills observation labels or old exact receipts", async () => {
  const context = await fixture("labels"), beacon = await context.create("A01"), payload = context.capture([beacon]);
  const saved = await context.locations().record(payload);
  const room = context.rooms[0];
  await context.inventory().saveRoom({ id: room.id, name: "Renamed provisional room", buildingId: "J18", number: room.number ?? "QA-1", expectedVersion: room.version, isPlaceholder: true }, true);
  const observation = (await context.rows("observations"))[0];
  assert.equal(observation.room_name, saved.room.name);
  assert.equal((await context.inventory().detail("BAT-LOC")).battery.observedRoom, saved.room.name);
  assert.equal((await context.locations().record(payload)).room.name, saved.room.name);
  await assert.rejects(context.locations().saveBeacon({ ...context.mapping("A02"), roomVersion: room.version }), error => error.code === "location_rejected_final");
});

test("mapping and battery binding failures reserve the original request against later state changes", async () => {
  const context = await fixture("stale"), beacon = await context.create("A01");
  const wrongBinding = context.capture([beacon], { expectedBatteryVersion: 99 });
  await assert.rejects(context.locations().record(wrongBinding), error => error.code === "location_rejected_final");
  const stale = context.capture([beacon]);
  await context.locations().saveBeacon({ ...context.mapping("A01"), action: "update", expectedVersion: 1, active: false });
  await assert.rejects(context.locations().record(stale), error => error.code === "location_rejected_final");
  await context.locations().saveBeacon({ ...context.mapping("A01"), action: "update", expectedVersion: 2 });
  await assert.rejects(context.locations().record(stale), error => error.code === "location_rejected_final");
  const outside = await fixture("outside");
  await assert.rejects(outside.locations().record(context.capture([beacon])), error => error.code === "location_rejected_final");
  assert.equal((await context.rows("observations")).length, 0);
});

test("mapping changes during commit roll back the observation and audit together", async () => {
  const context = await fixture("race"), beacon = await context.create("A01");
  const intercepted = beforeBatch(() => context.locations().saveBeacon({ ...context.mapping("A01"), action: "update", expectedVersion: 1, active: false }));
  await assert.rejects(context.locations(admin, intercepted).record(context.capture([beacon])), error => error.code === "location_rejected_final");
  assert.equal((await context.rows("observations")).length, 0);
  assert.equal((await context.rows("audit_events")).filter(row => row.action === "location_observation_recorded").length, 0);
});

test("account authority is rechecked in the observation transaction after an earlier successful request authentication", async () => {
  const context = await fixture("account-race"), beacon = await context.create("A01");
  const actor = { id: crypto.randomUUID(), name: "Revocable Location Administrator", role: "admin", authVersion: 1 };
  await db.prepare("INSERT INTO staff_accounts(id,username,display_name,role,password_hash,password_salt,hash_iterations,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)").bind(actor.id, actor.id, actor.name, actor.role, "test-only", "test-only", 600000, at, at).run();
  const intercepted = beforeBatch(() => db.prepare("UPDATE staff_accounts SET auth_version=auth_version+1,version=version+1,updated_at=? WHERE id=?").bind(at, actor.id).run());
  await assert.rejects(context.locations(actor, intercepted).record(context.capture([beacon])), error => error.status === 403);
  assert.equal((await context.rows("observations")).length, 0);
  assert.equal((await context.rows("audit_events")).filter(row => row.action === "location_observation_recorded").length, 0);
});

test("database guards block replacement, version bypass and cross-inventory mappings", async () => {
  const context = await fixture("triggers"), beacon = await context.create("A01"), outside = await fixture("trigger-outside");
  const key = `${context.scope}/${beacon.id}`;
  await assert.rejects(db.prepare("INSERT OR REPLACE INTO location_beacons SELECT * FROM location_beacons WHERE key=?").bind(key).run(), /cannot be replaced/);
  await assert.rejects(db.prepare("UPDATE location_beacons SET label='Changed' WHERE key=?").bind(key).run(), /version must advance/);
  await assert.rejects(db.prepare("UPDATE location_beacons SET version=version+1,room_key=? WHERE key=?").bind(`${outside.scope}/${outside.rooms[0].id}`, key).run(), /same inventory/);
  await assert.rejects(db.prepare("DELETE FROM location_beacons WHERE key=?").bind(key).run(), /deactivate room beacons/);
  assert.deepEqual((await db.prepare("PRAGMA foreign_key_check").all()).results, []);
});

test("authorized purge clears observations and related capture snapshots while retaining request reservations", async () => {
  const context = await fixture("purge"), beacon = await context.create("A01"), payload = context.capture([beacon]);
  await context.locations().record(payload);
  await context.inventory(staff).lifecycle({ requestId: crypto.randomUUID(), kind: "scrapped", reason: "", destination: null, source: "manual_selection", items: [{ batteryId: "BAT-LOC", version: 1, tagId: payload.tagId }] });
  await context.inventory().retiredAsset({ requestId: crypto.randomUUID(), kind: "purge", items: [{ batteryId: "BAT-LOC", version: 2, tagId: payload.tagId }] });
  assert.equal((await context.rows("observations")).length, 0);
  assert.equal((await context.rows("location_beacons")).length, 1);
  const receipt = (await context.rows("operations")).find(row => row.id === `${context.scope}/${payload.requestId}`);
  assert.match(receipt.fingerprint, /^sha256:/);
  assert.doesNotMatch(receipt.result_json, /roomName|Simulated phone|TAG-/);
  await assert.rejects(context.locations().record(payload), error => error.code === "location_rejected_final");
  assert.deepEqual((await db.prepare("PRAGMA foreign_key_check").all()).results, []);
});
