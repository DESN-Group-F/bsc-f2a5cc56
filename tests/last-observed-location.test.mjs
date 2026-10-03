import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Miniflare } from "miniflare";
import ts from "typescript";
import { InventoryStore } from "../work/qa/store.mjs";
import * as query from "../work/qa/inventory-query.mjs";
import { createExport } from "../work/qa/exports.mjs";
import * as client from "../work/qa/client-utils.mjs";
import * as catalog from "../work/qa/location-catalog.mjs";

const mf = new Miniflare({ modules: true, script: "export default {fetch(){return new Response('location-test')}}", compatibilityDate: "2026-05-15", d1Databases: { DB: "location-test" }, d1Persist: false });
const db = await mf.getD1Database("DB"); after(() => mf.dispose());
for (const entry of JSON.parse(await readFile("drizzle/meta/_journal.json", "utf8")).entries) await db.batch((await readFile(`drizzle/${entry.tag}.sql`, "utf8")).split("--> statement-breakpoint").filter(sql => sql.trim()).map(sql => db.prepare(sql)));
const at = "2026-10-03T05:00:00.000Z", actor = { id: "location-admin", name: "Location administrator", role: "admin", authVersion: 1 };
await db.prepare("INSERT INTO staff_accounts(id,username,display_name,role,password_hash,password_salt,hash_iterations,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)").bind(actor.id, actor.id, actor.name, actor.role, "test-only-no-login", "test-only-no-login", 600000, at, at).run();
async function fixture(name) {
    const scope = `last-location-${name}`, store = new InventoryStore(db, scope, "demo", actor, () => new Date(at));
    const base = await store.snapshot(), [first, second] = base.rooms;
    for (const id of ["BAT-A", "BAT-B", "BAT-C"]) await store.saveBattery({ id, name: "Location test battery", ownerId: `staff-${actor.id}`, homeBuildingId: "J18", homeRoomId: first.id });
    await store.observation({ requestId: crypto.randomUUID(), batteryId: "BAT-A", roomId: first.id, observedAt: "2026-10-02T02:00:00Z" });
    await store.observation({ requestId: crypto.randomUUID(), batteryId: "BAT-A", roomId: second.id, observedAt: "2026-10-03T01:00:00Z" });
    await store.observation({ requestId: crypto.randomUUID(), batteryId: "BAT-A", roomId: first.id, observedAt: "2026-10-01T01:00:00Z" });
    await store.observation({ requestId: crypto.randomUUID(), batteryId: "BAT-B", roomId: first.id, observedAt: "2026-10-02T03:00:00Z" });
    return { scope, store, first, second };
}
const ids = (records, filter) => query.filterBatteries(records, filter, "2026-10-03", actor.id).map(battery => battery.id);

test("last observed location uses the latest observation's stable room identity, separately from registered home and receipt order", async () => {
    const { store, first, second } = await fixture("latest");
    const snapshot = await store.snapshot(), a = snapshot.batteries.find(battery => battery.id === "BAT-A");
    assert.equal(a.homeRoomId, first.id); assert.equal(a.observedRoomId, second.id); assert.equal(a.observedAt, "2026-10-03T01:00:00.000Z");
    assert.equal(a.observationSource, "Demo observation");
    assert.deepEqual(ids(snapshot.batteries, { observedRoom: second.id }), ["BAT-A"]);
    assert.deepEqual(ids(snapshot.batteries, { room: first.id, observedRoom: second.id }), ["BAT-A"]);
    assert.deepEqual(ids(snapshot.batteries, { room: second.id, observedRoom: second.id }), []);
    assert.deepEqual(ids(snapshot.batteries, { observedRoom: "__not_observed" }), ["BAT-C"]);
    assert.equal((await store.detail("BAT-A")).observations.length, 3);
});

test("missing observation and missing recorded address stay distinct and never use current directory labels as historical evidence", () => {
    const fields = { name: "Battery", chemistry: "", model: "", ownerName: "Staff", observedAt: null, observedRoomId: null, observationRoomSnapshot: null };
    const records = [{ ...fields, id: "NO-READ", homeRoomId: "ROOM" }, { ...fields, id: "OLD-READ", observedAt: at, observedRoomId: "ROOM", observedRoom: "Room ID: ROOM", observedBuilding: null, observationRoomSnapshot: "unavailable" }, { ...fields, id: "KNOWN", observedAt: at, observedRoomId: "OTHER", observedRoom: "Saved room", observedBuilding: "J18 - Saved building", observationRoomSnapshot: "recorded" }];
    assert.deepEqual(ids(records, { observedRoom: "__not_observed" }), ["NO-READ"]);
    assert.deepEqual(ids(records, { observedRoom: "__unavailable" }), ["OLD-READ"]);
    assert.deepEqual(ids(records, { observedRoom: "ROOM" }), ["OLD-READ"]);
    assert.equal(query.lastObservedLocations(records).find(location => location.id === "ROOM").label, "Room ID: ROOM · Recorded address unavailable");
    assert.equal(query.defaultInventoryFilter().observedRoom, "all");
    const identicalNames = query.lastObservedLocations([records[2], { ...records[2], id: "ANOTHER", observedRoomId: "DISTINCT" }]);
    assert.equal(identicalNames.length, 2); assert.ok(identicalNames.every(location => location.label.includes(`Room ID: ${location.id}`)));
});

test("observed-location exports use the same sorted/page/personal boundaries and retain complete location time/source evidence", async () => {
    const { store, first } = await fixture("export");
    const filter = { observedRoom: first.id, sortDirection: "desc" };
    const summary = await createExport(store, { dataset: "demo", mode: "summary", filter });
    assert.deepEqual(summary.tables.Inventory.map(row => row.battery_id), ["BAT-B"]); assert.equal(summary.metadata.filters.observedRoom, first.id);
    const detail = await createExport(store, { dataset: "demo", mode: "detail", filter, sections: ["latest", "observations"] });
    assert.equal(detail.tables.Batteries[0].last_observed_room_id, first.id); assert.equal(detail.tables.Batteries[0].observation_source, "Demo observation"); assert.ok(detail.tables.Batteries[0].observed_at_utc);
    assert.equal(detail.tables.Observations.length, 1);
    const page = await createExport(store, { dataset: "demo", mode: "summary", range: "page", page: 0, pageSize: "10", filter });
    assert.deepEqual(page.tables.Inventory.map(row => row.battery_id), ["BAT-B"]);
    await assert.rejects(createExport(store, { dataset: "demo", mode: "summary", range: "page", page: 1, pageSize: "10", filter }), { status: 400 });
    const selected = await createExport(store, { dataset: "demo", mode: "detail", range: "selected", batteryIds: ["BAT-A"], filter, sections: ["latest", "observations"] });
    assert.equal(selected.tables.Observations.length, 3);
    assert.deepEqual(selected.tables.Batteries.map(row => row.battery_id), ["BAT-A"]);
    assert.deepEqual(ids((await store.snapshot()).batteries, { observedRoom: first.id, personalScope: "responsible" }), ["BAT-B"]);
});

test("renaming a room does not change its last-observation filter identity or saved labels, and reads leave all business rows unchanged", async () => {
    const { store, scope, first } = await fixture("rename");
    const before = (await store.snapshot()).batteries.find(battery => battery.id === "BAT-B");
    await store.saveRoom({ id: first.id, expectedVersion: first.version, name: "Renamed directory room", number: first.number, buildingId: first.buildingId, isPlaceholder: first.isPlaceholder, selectable: first.selectable }, true);
    const tables = ["batteries", "loans", "observations", "audit_events"], raw = async () => Promise.all(tables.map(async name => (await db.prepare(`SELECT * FROM ${name} WHERE scope=? ORDER BY rowid`).bind(scope).all()).results));
    const recorded = await raw(), snapshot = await store.snapshot(), after = snapshot.batteries.find(battery => battery.id === "BAT-B");
    assert.equal(after.observedRoomId, first.id); assert.equal(after.observedRoom, before.observedRoom); assert.equal(after.observedBuilding, before.observedBuilding);
    assert.deepEqual(ids(snapshot.batteries, { observedRoom: first.id }), ["BAT-B"]);
    assert.ok(!query.lastObservedLocations(snapshot.batteries).find(location => location.id === first.id).label.includes("Renamed directory room"));
    await createExport(store, { dataset: "demo", mode: "summary", filter: { observedRoom: first.id } });
    assert.deepEqual(await raw(), recorded);
});

test("the actual collapsed Location controls expose observation criteria, removable Applied filters and independent storage criteria", async () => {
    const source = await readFile("components/inventory/inventory-filter-panel.tsx", "utf8"), code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } }).outputText.replace(/^import .*;\r?\n/gm, "").replace(/^export /gm, "");
    const ui = Object.fromEntries(["Search", "X", "Button", "Input", "Select", "SelectTrigger", "SelectValue", "SelectContent", "SelectItem"].map(name => [name, name])), bindings = { ...ui, ...query, ...client, ...catalog }, names = Object.keys(bindings);
    const jsx = (type, props, key) => ({ type, props: props || {}, key });
    const { InventoryFilterPanel, appliedFilterChips } = new Function(...names, "_jsx", "_jsxs", `${code}\nreturn {InventoryFilterPanel,appliedFilterChips};`)(...names.map(name => bindings[name]), jsx, jsx);
    const { store, second } = await fixture("ui"), data = { ...(await store.snapshot()), user: actor }, filter = query.inventoryFilterSchema.parse({ observedRoom: second.id, room: "__unspecified" }), changes = [];
    const tree = InventoryFilterPanel({ data, filters: filter, asOfOn: "2026-10-03", onChange: patch => changes.push(patch) });
    const nodes = (node, result = []) => { if (Array.isArray(node)) node.forEach(item => nodes(item, result)); else if (node && typeof node === "object") { result.push(node); nodes(node.props?.children, result); } return result; };
    const control = nodes(tree).find(node => node.type === "Select" && nodes(node).some(child => child.props["aria-label"] === "Filter by last observed location"));
    assert.equal(control.props.value, second.id); control.props.onValueChange("__not_observed"); assert.deepEqual(changes, [{ observedRoom: "__not_observed" }]);
    const chip = appliedFilterChips(filter, data).find(item => item.key === "observedRoom"); assert.ok(chip.label.includes("Last observed location")); assert.deepEqual(chip.reset, { observedRoom: "all" });
    assert.deepEqual(appliedFilterChips(filter, data).find(item => item.key === "room").reset, { room: "all" });
    assert.ok(nodes(tree).filter(node => node.type === "details").every(node => node.props.open === undefined));
});
