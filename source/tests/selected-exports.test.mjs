import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Miniflare } from "miniflare";
import ExcelJS from "exceljs";
import { InventoryStore } from "../work/qa/store.mjs";
import { createExport } from "../work/qa/exports.mjs";
import { excelBuffer, summaryCsv } from "../work/qa/downloads.mjs";
import { parseCsv } from "../work/qa/client-utils.mjs";

const mf = new Miniflare({ modules: true, script: "export default {fetch(){return new Response('test')}}", compatibilityDate: "2026-05-15", d1Databases: { DB: "selected-export-test" }, d1Persist: false });
const db = await mf.getD1Database("DB");
const journal = JSON.parse(await readFile("drizzle/meta/_journal.json", "utf8"));
for (const entry of journal.entries) {
    const sql = await readFile(`drizzle/${entry.tag}.sql`, "utf8");
    await db.batch(sql.split("--> statement-breakpoint").filter(statement => statement.trim()).map(statement => db.prepare(statement)));
}
after(() => mf.dispose());

const now = new Date("2026-10-02T02:00:00.000Z");
const actor = { id: "export-review-admin", name: "Export Review Administrator", role: "admin", authVersion: 1 };
const otherActor = { id: "export-unrelated-staff", name: "Unrelated Staff", role: "staff", authVersion: 1 };
for (const value of [actor, otherActor]) await db.prepare("INSERT INTO staff_accounts(id,username,display_name,role,password_hash,password_salt,hash_iterations,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)")
    .bind(value.id, value.id, value.name, value.role, "test-only-no-login", "test-only-no-login", 600000, now.toISOString(), now.toISOString()).run();
const scope = "selected-exports:demo";
const store = new InventoryStore(db, scope, "demo", actor, () => now);
const selectedIds = ["BAT-001", "BAT-005"];
const uuid = () => crypto.randomUUID();
const status = code => error => error.status === code;
const sorted = values => [...values].sort();
const rowIds = rows => sorted(rows.map(row => row.battery_id));
const request = overrides => ({ dataset: "demo", mode: "detail", range: "selected", batteryIds: selectedIds, ...overrides });
const move = async (kind, batteryIds, source = store) => {
    const expectedLoans = kind === "return" ? batteryIds.map(id => ({ batteryId: id, loanId: null })) : undefined;
    if (expectedLoans) {
        const snapshot = await source.snapshot();
        for (const expected of expectedLoans) expected.loanId = snapshot.batteries.find(battery => battery.id === expected.batteryId).loanId;
    }
    return source.movement({ requestId: uuid(), kind, batteryIds, ...(expectedLoans ? { expectedLoans } : {}) });
};

await store.initializeDemo();
await store.saveRoom({ id: "unrelated-room", name: "Unrelated Room", buildingId: "J18", number: "UNRELATED", isPlaceholder: true, selectable: true });
const control = (await store.snapshot()).batteries.find(battery => battery.id === "BAT-002");
await store.saveBattery({ ...control, expectedVersion: control.version, ownerId: `staff-${otherActor.id}`, homeBuildingId: "J18", homeRoomId: "unrelated-room" }, true);
await move("checkout", ["BAT-001"]);
await move("return", ["BAT-001"]);
await move("checkout", ["BAT-001"]);
await move("checkout", ["BAT-005"]);
await move("return", ["BAT-005"]);
await move("checkout", ["BAT-002"], new InventoryStore(db, scope, "demo", otherActor, () => now));
await move("checkout", ["BAT-003", "BAT-004"]);
for (const [batteryId, roomId] of [["BAT-001", "J18-DEMO-ROOM"], ["BAT-005", "J18-DEMO-WORKSPACE"], ["BAT-002", "unrelated-room"]]) {
    await store.observation({ requestId: uuid(), batteryId, roomId, observedAt: "2026-10-02T01:00:00.000Z" });
    await store.charge({ requestId: uuid(), batteryId, completedAt: "2026-10-02T00:00:00.000Z", durationMinutes: 45 });
}
// A detail view is capped at 200 charge rows; downloads must still include every selected record.
await db.batch(Array.from({ length: 205 }, (_, index) => db.prepare("INSERT INTO charges(id,scope,battery_key,completed_at,duration_minutes,recorded_at,actor_id,actor_name) VALUES(?,?,?,?,?,?,?,?)")
    .bind(uuid(), scope, `${scope}/BAT-001`, "2026-10-01T00:00:00.000Z", 10 + index, now.toISOString(), actor.id, actor.name)));

async function expectedHistory(table) {
    const rows = await db.prepare(`SELECT record.id FROM ${table} record JOIN batteries battery ON battery.key=record.battery_key WHERE battery.scope=? AND battery.id IN (?,?) ORDER BY record.id`)
        .bind(scope, ...selectedIds).all();
    return rows.results.map(row => row.id);
}

function worksheetRows(workbook, name) {
    const sheet = workbook.getWorksheet(name);
    assert.ok(sheet, `Missing ${name} worksheet`);
    const columns = [];
    sheet.getRow(1).eachCell((cell, number) => { columns[number - 1] = cell.value; });
    const rows = [];
    sheet.eachRow((row, number) => {
        if (number > 1) rows.push(Object.fromEntries(columns.map((column, index) => [column, row.getCell(index + 1).value])));
    });
    return rows;
}

test("selected summary exports exactly the checked batteries, even outside the filter and page", async () => {
    const document = await createExport(store, request({ mode: "summary", batteryIds: ["BAT-005", "BAT-001", "BAT-005"], filter: { status: "out", building: "E10" }, page: 4, pageSize: "10" }));
    assert.equal((await store.snapshot()).batteries.length, 6);
    assert.deepEqual(rowIds(document.tables.Inventory), selectedIds);
    assert.equal(document.metadata.range, "selected");
    assert.equal(document.metadata.matching_batteries, 2);
    assert.equal(document.metadata.exported_batteries, 2);
    assert.deepEqual(document.metadata.selected_battery_ids, selectedIds);
    assert.equal(document.metadata.filters, null);
    assert.equal(document.metadata.selection_filter_context.status, "out");
    assert.equal(document.metadata.selection_filter_context.building, "E10");
    assert.equal(document.metadata.page, null);
    assert.equal(document.metadata.page_size, null);
    const csv = parseCsv(summaryCsv(document));
    assert.deepEqual(rowIds(csv), selectedIds);
    assert.ok(csv.every(row => row.export_record_count === "2"));
    assert.equal(csv.find(row => row.battery_id === "BAT-001").status, "On loan");
    assert.equal(csv.find(row => row.battery_id === "BAT-005").status, "In store");
});

test("selected detail includes complete linked histories and only referenced directories", async () => {
    const document = await createExport(store, request());
    assert.deepEqual(rowIds(document.tables.Batteries), selectedIds);
    assert.deepEqual(sorted(Object.keys(document.tables)), sorted(["Batteries", "Loans", "Observations", "Charges", "Operations", "People", "Rooms", "Buildings"]));
    for (const [table, source] of [["Loans", "loans"], ["Charges", "charges"], ["Observations", "observations"]]) {
        assert.deepEqual(sorted(document.tables[table].map(row => row.id)), await expectedHistory(source));
        assert.ok(document.tables[table].every(row => selectedIds.includes(row.battery_id)));
    }
    assert.equal((await store.detail("BAT-001")).charges.length, 200);
    assert.equal(document.tables.Charges.filter(row => row.battery_id === "BAT-001").length, 207);
    const operations = await db.prepare("SELECT id FROM audit_events WHERE scope=? AND battery_id IN (?,?) ORDER BY id").bind(scope, ...selectedIds).all();
    assert.deepEqual(sorted(document.tables.Operations.filter(row => row.battery_id !== null).map(row => row.id)), operations.results.map(row => row.id));
    assert.ok(document.tables.Operations.every(row => row.battery_id === null || selectedIds.includes(row.battery_id)));
    assert.deepEqual(sorted(document.tables.People.map(row => row.id)), [`staff-${actor.id}`]);
    assert.deepEqual(sorted(document.tables.Rooms.map(row => row.id)), ["J18-DEMO-ROOM", "J18-DEMO-WORKSPACE"]);
    assert.deepEqual(document.tables.Buildings.map(row => row.id), ["J18"]);
    const json = JSON.parse(JSON.stringify(document));
    assert.deepEqual(rowIds(json.tables.Batteries), selectedIds);
    assert.deepEqual(sorted(json.tables.Charges.map(row => row.id)), await expectedHistory("charges"));
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await excelBuffer(document));
    assert.deepEqual(rowIds(worksheetRows(workbook, "Batteries")), selectedIds);
    assert.deepEqual(sorted(worksheetRows(workbook, "Charges").map(row => row.id)), await expectedHistory("charges"));
    assert.deepEqual(sorted(worksheetRows(workbook, "Loans").map(row => row.id)), await expectedHistory("loans"));
});

test("selected information sections and staff-readable exports retain their original permissions", async () => {
    const staff = new InventoryStore(db, scope, "demo", { id: "export-review-staff", name: "Export Review Staff", role: "staff" }, () => now);
    const document = await createExport(staff, request({ sections: ["loans"] }));
    assert.deepEqual(Object.keys(document.tables), ["Batteries", "Loans"]);
    assert.deepEqual(document.tables.Batteries.map(row => Object.keys(row)), [["battery_id"], ["battery_id"]]);
    assert.deepEqual(sorted(document.tables.Loans.map(row => row.id)), await expectedHistory("loans"));
    assert.equal(document.metadata.operator, "Export Review Staff");
    await assert.rejects(createExport(store, request({ sections: [] })), status(400));
});

test("selected exports reject empty, malformed and contradictory selection scopes", async () => {
    for (const input of [request({ batteryIds: undefined }), request({ batteryIds: [] }), request({ batteryId: "BAT-001" }), request({ range: "filtered" }), request({ range: "page" }), request({ range: "filtered", batteryIds: [] }), request({ mode: "activity" }), request({ mode: "records", kind: "batteries" })]) {
        await assert.rejects(createExport(store, input), status(400));
    }
    for (const batteryIds of ["BAT-001", [null], [""], ["BAT-001, BAT-005"], ["../BAT-001"], ["A".repeat(65)]]) {
        await assert.rejects(createExport(store, request({ batteryIds })), error => error.name === "ZodError" || error.status === 400);
    }
});

test("a missing or different-inventory selected battery rejects the entire export", async () => {
    const foreign = new InventoryStore(db, "selected-foreign:demo", "demo", actor, () => now);
    await foreign.initializeDemo();
    await foreign.saveBattery({ id: "FOREIGN-ONLY", name: "Foreign Inventory Battery", ownerId: `staff-${actor.id}`, homeBuildingId: "J18" });
    for (const missing of ["MISSING", "FOREIGN-ONLY"]) {
        await assert.rejects(createExport(store, request({ batteryIds: ["BAT-001", missing] })), status(409));
        await assert.rejects(createExport(store, request({ mode: "summary", batteryIds: [missing] })), status(409));
    }
});

test("single, filtered and current-page summary and detail exports retain their scopes", async () => {
    const single = await createExport(store, { dataset: "demo", mode: "detail", batteryId: "BAT-005", sections: ["loans"] });
    assert.equal(single.metadata.range, "single");
    assert.deepEqual(rowIds(single.tables.Batteries), ["BAT-005"]);
    assert.ok(single.tables.Loans.every(row => row.battery_id === "BAT-005"));
    const filtered = await createExport(store, { dataset: "demo", mode: "summary", filter: { status: "in" } });
    assert.deepEqual(rowIds(filtered.tables.Inventory), ["BAT-005", "BAT-006"]);
    const detail = await createExport(store, { dataset: "demo", mode: "detail", filter: { owner: `staff-${otherActor.id}` }, sections: ["loans"] });
    assert.deepEqual(rowIds(detail.tables.Batteries), ["BAT-002"]);
    assert.ok(detail.tables.Loans.every(row => row.battery_id === "BAT-002"));
    await assert.rejects(createExport(store, { dataset: "demo", mode: "summary", range: "page", page: 1, pageSize: "10" }), status(400));
});

test("selected scope retains cross-page choices and exports more than 200 IDs without truncation", async () => {
    const paged = new InventoryStore(db, "selected-large:demo", "demo", actor, () => now);
    await paged.initializeDemo();
    const additions = Array.from({ length: 201 }, (_, index) => ({ id: `EXTRA-${String(index + 1).padStart(3, "0")}`, name: "Additional Test Battery", ownerId: `staff-${actor.id}`, homeBuildingId: "J18" }));
    await paged.importRecords("batteries", additions.slice(0, 200));
    await paged.importRecords("batteries", additions.slice(200));
    const firstPage = await createExport(paged, { dataset: "demo", mode: "summary", range: "page", page: 0, pageSize: "10" });
    const secondPage = await createExport(paged, { dataset: "demo", mode: "summary", range: "page", page: 1, pageSize: "10" });
    assert.equal(firstPage.tables.Inventory.length, 10);
    assert.equal(secondPage.tables.Inventory.length, 10);
    const acrossPages = [firstPage.tables.Inventory[0].battery_id, secondPage.tables.Inventory[0].battery_id];
    assert.equal(new Set(acrossPages).size, 2);
    const crossPage = await createExport(paged, request({ mode: "summary", batteryIds: acrossPages, page: 1, pageSize: "10", filter: { search: "not-in-this-inventory" } }));
    assert.deepEqual(rowIds(crossPage.tables.Inventory), sorted(acrossPages));
    assert.equal(crossPage.metadata.page, null);
    const large = await createExport(paged, request({ mode: "summary", batteryIds: additions.map(row => row.id) }));
    assert.equal(large.metadata.exported_batteries, 201);
    assert.deepEqual(rowIds(large.tables.Inventory), additions.map(row => row.id));
    assert.deepEqual(large.metadata.selected_battery_ids, additions.map(row => row.id));
});
