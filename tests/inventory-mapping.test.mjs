import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Miniflare } from "miniflare";
import { InventoryStore } from "../work/qa/store.mjs";
import { filterBatteries } from "../work/qa/inventory-query.mjs";
import { getMappingRooms, mappingBucket, mappingUnknownReason, UNKNOWN_MAPPING_ROOM } from "../work/qa/inventory-mapping.mjs";
import { createExport } from "../work/qa/exports.mjs";
import { createHumanReport } from "../work/qa/export-report.mjs";

const mf = new Miniflare({ modules: true, script: "export default {fetch(){return new Response('mapping-test')}}", compatibilityDate: "2026-05-15", d1Databases: { DB: "mapping-test" }, d1Persist: false });
const db = await mf.getD1Database("DB");
after(() => mf.dispose());
for (const entry of JSON.parse(await readFile("drizzle/meta/_journal.json", "utf8")).entries)
  await db.batch((await readFile(`drizzle/${entry.tag}.sql`, "utf8")).split("--> statement-breakpoint").filter(sql => sql.trim()).map(sql => db.prepare(sql)));
const now = "2026-10-10T03:00:00.000Z";
const actor = { id: "mapping-admin", name: "Mapping administrator", role: "admin", authVersion: 1 };
await db.prepare("INSERT INTO staff_accounts(id,username,display_name,role,password_hash,password_salt,hash_iterations,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)").bind(actor.id, actor.id, actor.name, actor.role, "test-only-no-login", "test-only-no-login", 600000, now, now).run();

async function fixture(name) {
  const store = new InventoryStore(db, `mapping-${name}`, "demo", actor, () => new Date(now));
  const snapshot = await store.snapshot();
  const [roomA, roomB] = getMappingRooms(snapshot.rooms);
  for (let index = 1; index <= 14; index++) {
    const id = `BAT-${String(index).padStart(3, "0")}`;
    await store.saveBattery({ id, name: "Mapping battery", ownerId: `staff-${actor.id}`, homeBuildingId: "J18", homeRoomId: roomA.id });
    if (index <= 12) await store.observation({ requestId: crypto.randomUUID(), batteryId: id, roomId: roomB.id, observedAt: "2026-10-10T01:00:00.000Z" });
  }
  await store.observation({ requestId: crypto.randomUUID(), batteryId: "BAT-001", roomId: roomA.id, observedAt: "2026-10-09T01:00:00.000Z" });
  return { store, roomA, roomB };
}

test("the map partitions latest observations by stable identity without inferring storage home or freshness", () => {
  const rooms = [
    { id: "A", name: "Same label", number: "1", buildingId: "J18", selectable: true },
    { id: "B", name: "Same label", number: "2", buildingId: "J18", selectable: true },
    { id: "OTHER", name: "Other building", buildingId: "E10", selectable: true },
  ];
  const base = { observedAt: null, observedRoomId: null, homeRoomId: "A" };
  assert.equal(mappingBucket(base, rooms), UNKNOWN_MAPPING_ROOM);
  assert.equal(mappingUnknownReason(base), "No observation recorded");
  assert.equal(mappingBucket({ ...base, observedAt: "2000-01-01T00:00:00Z", observedRoomId: "B", observationRoomSnapshot: "unavailable" }, rooms), "B");
  assert.equal(mappingBucket({ ...base, observedAt: now, observedRoomId: "OTHER" }, rooms), UNKNOWN_MAPPING_ROOM);
  assert.equal(mappingBucket({ ...base, observedAt: "invalid", observedRoomId: "A" }, rooms), UNKNOWN_MAPPING_ROOM);
  assert.deepEqual(getMappingRooms(rooms).map(room => room.id), ["A", "B"]);
});

test("D1 latest observation, room counts and ordinary filters use the same Mapping scope", async () => {
  const { store, roomA, roomB } = await fixture("query");
  const snapshot = await store.snapshot();
  assert.equal(getMappingRooms(snapshot.rooms).length, 3);
  const read = input => filterBatteries(snapshot.batteries, input, "2026-10-10", actor.id, [], undefined, snapshot.rooms);
  assert.equal(read({ mappingRoom: roomA.id }).length, 0);
  assert.equal(read({ mappingRoom: roomB.id }).length, 12);
  assert.equal(read({ mappingRoom: UNKNOWN_MAPPING_ROOM }).length, 2);
  assert.deepEqual(read({ mappingRoom: roomB.id, search: "BAT-001" }).map(b => b.id), ["BAT-001"]);
  const record = snapshot.batteries.find(b => b.id === "BAT-001");
  assert.equal(record.homeRoomId, roomA.id);
  assert.equal(record.observedRoomId, roomB.id);
  assert.equal((await store.detail("BAT-001")).observations.length, 2);
  const retired = { ...record, id: "RETIRED", lifecycleStatus: "scrapped" };
  assert.equal(filterBatteries([retired], { mappingRoom: roomB.id }, "2026-10-10", actor.id, [], undefined, snapshot.rooms).length, 0);
  assert.equal(filterBatteries([retired], { mappingRoom: roomB.id, lifecycle: "all" }, "2026-10-10", actor.id, [], undefined, snapshot.rooms).length, 1);
});

test("all-page, page, selected and single downloads retain the fixed room boundary and complete history", async () => {
  const { store, roomB } = await fixture("export");
  const filter = { mappingRoom: roomB.id };
  const all = await createExport(store, { dataset: "demo", mode: "summary", filter });
  assert.equal(all.tables.Inventory.length, 12);
  const page = await createExport(store, { dataset: "demo", mode: "summary", range: "page", page: 1, pageSize: "10", filter });
  assert.deepEqual(page.tables.Inventory.map(b => b.battery_id), ["BAT-011", "BAT-012"]);
  const selected = await createExport(store, { dataset: "demo", mode: "detail", range: "selected", batteryIds: ["BAT-001"], filter: { ...filter, search: "not-matching" }, sections: ["latest", "observations"] });
  assert.equal(selected.tables.Observations.length, 2);
  assert.equal(selected.metadata.fixed_mapping_scope.roomId, roomB.id);
  assert.match(JSON.stringify(createHumanReport(selected)), /Last-observation room scope/);
  const single = await createExport(store, { dataset: "demo", mode: "detail", batteryId: "BAT-001", filter, sections: ["observations"] });
  assert.equal(single.tables.Observations.length, 2);
  await assert.rejects(createExport(store, { dataset: "demo", mode: "summary", range: "selected", batteryIds: ["BAT-001", "BAT-014"], filter }), { status: 409 });
  await assert.rejects(createExport(store, { dataset: "demo", mode: "detail", batteryId: "BAT-014", filter }), { status: 404 });
  const unknown = await createExport(store, { dataset: "demo", mode: "summary", filter: { mappingRoom: UNKNOWN_MAPPING_ROOM } });
  assert.equal(unknown.tables.Inventory.length, 2);
});

test("directory navigation can change without rewriting evidence; a new observation changes fixed-scope downloads", async () => {
  const { store, roomA, roomB } = await fixture("change");
  const savedLabel = (await store.snapshot()).batteries.find(b => b.id === "BAT-001").observedRoom;
  await store.saveRoom({ ...roomB, name: "Updated directory label", expectedVersion: roomB.version }, true);
  const before = (await store.snapshot()).batteries.find(b => b.id === "BAT-001");
  assert.equal(before.observedRoom, savedLabel);
  const summary = await createExport(store, { dataset: "demo", mode: "summary", filter: { mappingRoom: roomB.id } });
  assert.equal(summary.metadata.fixed_mapping_scope.directoryLabel, "Updated directory label");
  await store.observation({ requestId: crypto.randomUUID(), batteryId: "BAT-001", roomId: roomA.id, observedAt: "2026-10-10T02:00:00.000Z" });
  await assert.rejects(createExport(store, { dataset: "demo", mode: "detail", range: "selected", batteryIds: ["BAT-001"], filter: { mappingRoom: roomB.id } }), { status: 409 });
  assert.equal((await store.detail("BAT-001")).observations.length, 3);
});
