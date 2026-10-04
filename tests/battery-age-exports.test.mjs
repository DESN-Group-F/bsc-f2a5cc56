import { test } from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { createExport } from "../work/qa/exports.mjs";
import { excelBuffer, summaryCsv } from "../work/qa/downloads.mjs";
import { parseCsv } from "../work/qa/client-utils.mjs";

const exportInstant = new Date("2026-10-01T14:30:00.000Z");
const makeStore = (beforeRead = () => {}) => {
    const batteries = Array.from({ length: 11 }, (_, index) => ({
        id: `AGE-${String(index + 1).padStart(3, "0")}`, name: `Age export battery ${index + 1}`,
        manufacturedOn: index === 0 ? "2026-09-01" : null, firstUsedOn: index === 0 ? "2026-10-01" : null,
        loanId: null, ownerId: "OWNER", ownerName: "Responsible staff", borrowerName: null,
        homeBuildingId: "J18", homeBuildingName: "Mechanical Engineering", homeRoomId: null,
        homeRoomNumber: null, homeRoomName: null, chemistry: null, model: null, tagId: null,
    }));
    const rawBatteries = batteries.map(battery => ({
        id: battery.id, key: `age-test/${battery.id}`, scope: "age-test", name: battery.name,
        manufactured_on: battery.manufacturedOn, first_used_on: battery.firstUsedOn,
        created_at: "2020-01-01T00:00:00.000Z", version: 1,
    }));
    return { exportData: async () => {
        beforeRead();
        return { snapshot: { batteries, people: [], buildings: [], rooms: [], actor: "Age review staff" }, raw: {
            batteries: rawBatteries, people: [], buildings: [], rooms: [], loans: [], charges: [], observations: [], audit_events: [],
        } };
    } };
};

test("a slow export uses one Sydney age date and distinguishes unknown human ages from blank source evidence", async context => {
    context.mock.timers.enable({ apis: ["Date"], now: exportInstant });
    const store = makeStore(() => context.mock.timers.tick(24 * 60 * 60 * 1000));
    const document = await createExport(store, { dataset: "live", mode: "summary", filter: { building: "J18" } });
    assert.equal(document.metadata.exported_at_utc, "2026-10-01T14:30:00.000Z");
    assert.equal(document.metadata.age_as_of_date, "2026-10-02");
    assert.equal(document.metadata.age_date_timezone, "Australia/Sydney");
    assert.ok(document.tables.Inventory.every(row => row.age_as_of_date === "2026-10-02"));
    assert.equal(document.tables.Inventory[0].manufacturing_age_days, 31);
    assert.equal(document.tables.Inventory[0].time_in_service_days, 1);
    assert.equal(document.tables.Inventory[1].manufacturing_age_days, null);
    assert.equal(document.tables.Inventory[1].time_in_service_days, null);
    const humanCsv = parseCsv(summaryCsv(document));
    assert.equal(humanCsv[0]["Age since manufacture (days)"], "31");
    assert.equal(humanCsv[1]["Age since manufacture (days)"], "Not recorded");
    assert.equal(humanCsv[1]["Time in service (days)"], "Not recorded");

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await excelBuffer(document));
    const worksheet = workbook.getWorksheet("Evidence Inventory");
    const columns = new Map();
    worksheet.getRow(4).eachCell((cell, index) => columns.set(cell.value, index));
    assert.equal(worksheet.getRow(5).getCell(columns.get("manufacturing_age_days")).value, 31);
    assert.equal(worksheet.getRow(6).getCell(columns.get("manufacturing_age_days")).value, "");
    assert.equal(worksheet.getRow(5).getCell(columns.get("age_as_of_date")).value, "2026-10-02");
    const human = workbook.getWorksheet("Inventory"), humanColumns = new Map();
    human.getRow(4).eachCell((cell, index) => humanColumns.set(cell.value, index));
    assert.equal(human.getRow(5).getCell(humanColumns.get("Age since manufacture (days)")).value, 31);
    assert.equal(human.getRow(6).getCell(humanColumns.get("Age since manufacture (days)")).value, "Not recorded");
    assert.equal(human.getRow(6).getCell(humanColumns.get("Time in service (days)")).value, "Not recorded");
    assert.equal(human.getRow(5).getCell(humanColumns.get("Age calculated on (Sydney date)")).value.toISOString(), "2026-10-02T00:00:00.000Z");
});

test("selected details include ages only in specifications and preserve single and page scopes", async context => {
    context.mock.timers.enable({ apis: ["Date"], now: exportInstant });
    const store = makeStore();
    const selected = await createExport(store, { dataset: "live", mode: "detail", batteryId: "AGE-001", sections: ["loans"] });
    assert.deepEqual(Object.keys(selected.tables), ["Batteries", "Loans"]);
    assert.deepEqual(selected.tables.Batteries, [{ battery_id: "AGE-001" }]);
    const detailed = await createExport(store, { dataset: "live", mode: "detail", batteryId: "AGE-001", sections: ["specifications"] });
    assert.equal(detailed.tables.Batteries[0].manufacturing_age_days, 31);
    assert.equal(detailed.tables.Batteries[0].time_in_service_days, 1);
    assert.equal(detailed.tables.Batteries[0].age_as_of_date, detailed.metadata.age_as_of_date);
    const page = await createExport(store, { dataset: "live", mode: "summary", range: "page", page: 1, pageSize: "10" });
    assert.equal(page.metadata.matching_batteries, 11);
    assert.equal(page.metadata.exported_batteries, 1);
    assert.equal(page.tables.Inventory[0].battery_id, "AGE-011");
    assert.equal(page.tables.Inventory[0].manufacturing_age_days, null);
});

test("battery record downloads retain lifecycle dates without inventing an age from registration time", async context => {
    context.mock.timers.enable({ apis: ["Date"], now: exportInstant });
    const document = await createExport(makeStore(), { dataset: "live", mode: "records", kind: "batteries", search: "AGE-00" });
    assert.equal(document.tables.batteries.length, 9);
    assert.equal(document.tables.batteries[0].manufactured_on, "2026-09-01");
    assert.equal(document.tables.batteries[0].first_used_on, "2026-10-01");
    assert.equal(document.tables.batteries[1].manufactured_on, null);
    assert.equal(document.tables.batteries[1].first_used_on, null);
    assert.equal(document.tables.batteries[1].created_at, "2020-01-01T00:00:00.000Z");
    assert.ok(!("manufacturing_age_days" in document.tables.batteries[1]));
});
