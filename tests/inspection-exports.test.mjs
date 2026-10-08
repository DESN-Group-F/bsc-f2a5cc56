import { test } from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { createExport } from "../work/qa/exports.mjs";
import { createHumanReport } from "../work/qa/export-report.mjs";
import { excelBuffer, summaryCsv } from "../work/qa/downloads.mjs";
import { parseCsv } from "../work/qa/client-utils.mjs";

const asOf = new Date("2026-10-06T03:30:00.000Z");
function fixture() {
    const batteries = ["BAT-001", "BAT-002"].map((id, index) => ({
        id, name: id, lifecycleStatus: "active", lifecycleAt: null, manufacturedOn: "2026-01-01", firstUsedOn: "2026-02-01",
        ownerId: `staff-${index}`, ownerAccountId: index ? "other-staff" : "viewer", ownerName: "Current owner", loanId: null, model: null, chemistry: null,
    }));
    const loans = Array.from({ length: 220 }, (_, index) => ({ id: `loan-${index}`, battery_key: "scope/BAT-001", borrower_name: "Saved borrower", checked_out_at: "2026-10-01T00:00:00.000Z", returned_at: "2026-10-01T01:00:00.000Z", cancelled_at: null }));
    loans.push({ id: "active-loan", battery_key: "scope/BAT-001", borrower_name: "Saved borrower", checked_out_at: "2026-10-06T02:00:00.000Z", returned_at: null, cancelled_at: null });
    loans.push({ id: "voided-loan", battery_key: "scope/BAT-001", borrower_name: "Saved borrower", checked_out_at: "invalid", returned_at: null, cancelled_at: "2026-10-02T00:00:00.000Z" });
    const inspections = Array.from({ length: 225 }, (_, index) => ({
        id: `inspection-${index}`, batteryId: "BAT-001", kind: "visual_check", outcome: "no_concern_observed",
        performedAt: "2026-10-01T00:00:00.000Z", recordedAt: "2026-10-01T00:10:00.000Z", inspectorAccountId: "saved-inspector", inspectorName: "Historic inspector",
        method: "Visual inspection under room lighting", notes: "No visible damage observed", reference: `Inspection log ${index}`, capacityMah: null,
        voidedAt: index === 0 ? "2026-10-02T00:00:00.000Z" : null, voidedByAccountId: index === 0 ? "corrector-id" : null,
        voidedByName: index === 0 ? "Historic corrector" : null, voidReason: index === 0 ? "Wrong battery selected" : null,
    }));
    inspections.push({ ...inspections[1], id: "other-inspection", batteryId: "BAT-002", kind: "capacity_measurement", capacityMah: 1800, method: "Recorded bench test conditions" });
    const data = { snapshot: { batteries, people: [], rooms: [], buildings: [], actor: "Viewer" }, inspections, raw: {
        batteries: batteries.map(battery => ({ id: battery.id, key: `scope/${battery.id}`, manufactured_on: battery.manufacturedOn, first_used_on: battery.firstUsedOn })),
        loans, charges: [], observations: [], people: [], rooms: [], buildings: [],
        audit_events: batteries.map(battery => ({ id: `event-${battery.id}`, battery_id: battery.id, action: "inspection_recorded", actor_id: "viewer", actor_name: "Historic inspector", at: "2026-10-01T00:10:00.000Z", details_json: "{}" })),
    } };
    return { data, store: { viewerAccountId: "viewer", scope: "scope", exportData: async () => data } };
}

test("summary borrowing totals use complete history, exclude voids and give readable CSV units", async context => {
    context.mock.timers.enable({ apis: ["Date"], now: asOf });
    const { store } = fixture();
    const report = await createExport(store, { dataset: "demo", mode: "summary" });
    const row = report.tables.Inventory[0];
    assert.equal(row.total_checkouts, 221);
    assert.equal(row.completed_checkouts, 220);
    assert.equal(row.active_checkouts, 1);
    assert.equal(row.total_checked_out_seconds, 221.5 * 3600);
    assert.equal(row.invalid_duration_count, 0);
    assert.equal(row.usage_as_of_utc, report.metadata.exported_at_utc);
    assert.equal(report.tables.Inventory[1].total_checkouts, 0);
    assert.equal(report.tables.Inventory[1].total_checked_out_seconds, 0);
    const csv = parseCsv(summaryCsv(report));
    assert.equal(csv[0]["Total checkouts"], "221");
    assert.equal(csv[0]["Total checked-out time (hours)"], "221.5");
    assert.match(report.metadata.usage_meaning, /not charge\/discharge cycles/);
    const detail = await createExport(store, { dataset: "demo", mode: "detail", batteryId: "BAT-001", sections: ["responsibility"] });
    assert.equal(detail.tables.Batteries[0].total_checked_out_seconds, row.total_checked_out_seconds);
    assert.ok(!("Loans" in detail.tables));
});

test("an inconsistent duration remains unavailable without losing the valid checkout count", async context => {
    context.mock.timers.enable({ apis: ["Date"], now: asOf });
    const { store, data } = fixture();
    data.raw.loans[0].returned_at = "2026-09-01T00:00:00.000Z";
    const report = await createExport(store, { dataset: "demo", mode: "summary" });
    assert.equal(report.tables.Inventory[0].total_checkouts, 221);
    assert.equal(report.tables.Inventory[0].total_checked_out_seconds, null);
    assert.equal(report.tables.Inventory[0].invalid_duration_count, 1);
    assert.match(createHumanReport(report).sheets[0].rows[0]["Total checked-out time (hours)"], /Unavailable/);
});

test("borrowing uses a post-read clock so concurrent recorded movements stay valid and Excel durations agree", async context => {
    context.mock.timers.enable({ apis: ["Date"], now: asOf });
    const { store, data } = fixture();
    store.exportData = async () => {
        context.mock.timers.tick(60 * 60 * 1000);
        data.raw.loans = [
            { id: "concurrent-return", battery_key: "scope/BAT-001", checked_out_at: "2026-10-06T03:45:00.000Z", returned_at: "2026-10-06T04:00:00.000Z", cancelled_at: null },
            { id: "concurrent-checkout", battery_key: "scope/BAT-001", checked_out_at: "2026-10-06T04:00:00.000Z", returned_at: null, cancelled_at: null },
        ];
        return data;
    };
    const document = await createExport(store, { dataset: "demo", mode: "detail", batteryId: "BAT-001", sections: ["responsibility", "loans"] });
    assert.equal(document.metadata.exported_at_utc, "2026-10-06T03:30:00.000Z");
    assert.equal(document.metadata.usage_as_of_utc, "2026-10-06T04:30:00.000Z");
    assert.equal(document.tables.Batteries[0].usage_as_of_utc, document.metadata.usage_as_of_utc);
    assert.equal(document.tables.Batteries[0].total_checked_out_seconds, 2700);
    assert.equal(document.tables.Batteries[0].invalid_duration_count, 0);
    const report = createHumanReport(document), loans = report.sheets.find(sheet => sheet.name === "Check-in and checkout").rows;
    assert.deepEqual(loans.map(row => row["Time out (hours)"]), [0.25, 0.5]);
    assert.equal(report.sheets[0].rows[0]["Total checked-out time (hours)"], 0.75);
    assert.ok(report.facts.some(fact => fact.label === "Borrowing calculated as of (Sydney)"));
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await excelBuffer(document));
    const loanSheet = workbook.getWorksheet("Check-in and checkout"), durationColumn = loanSheet.getRow(4).values.indexOf("Time out (hours)");
    assert.equal(loanSheet.getRow(6).getCell(durationColumn).value, 0.5);
});

test("selected inspection exports keep complete void evidence and personal scope without adding unrequested histories", async context => {
    context.mock.timers.enable({ apis: ["Date"], now: asOf });
    const { store, data } = fixture();
    const original = structuredClone(data.inspections);
    const report = await createExport(store, { dataset: "demo", mode: "detail", range: "selected", batteryIds: ["BAT-001"], filter: { personalScope: "responsible", search: "does not match" }, sections: ["inspections"] });
    assert.deepEqual(Object.keys(report.tables), ["Batteries", "Inspections"]);
    assert.deepEqual(report.tables.Batteries, [{ battery_id: "BAT-001" }]);
    assert.equal(report.tables.Inspections.length, 225);
    assert.equal(report.tables.Inspections[0].voidedByAccountId, "corrector-id");
    assert.equal(report.tables.Inspections[0].inspectorName, "Historic inspector");
    assert.ok(report.tables.Inspections.every(record => record.batteryId === "BAT-001"));
    assert.deepEqual(data.inspections, original);
    await assert.rejects(createExport(store, { dataset: "demo", mode: "detail", range: "selected", batteryIds: ["BAT-002"], filter: { personalScope: "responsible" }, sections: ["inspections"] }), error => error.status === 409);
    const activity = await createExport(store, { dataset: "demo", mode: "activity", activityIds: ["event-BAT-001"], activityDepth: "battery_details", sections: ["inspections"] });
    assert.equal(activity.tables.Inspections.length, 225);
    assert.ok(activity.tables.Inspections.every(record => record.batteryId === "BAT-001"));
});

test("Excel inspection history is readable while hidden evidence keeps exact original record values", async context => {
    context.mock.timers.enable({ apis: ["Date"], now: asOf });
    const { store } = fixture();
    const document = await createExport(store, { dataset: "demo", mode: "detail", batteryId: "BAT-001", sections: ["inspections"] });
    const report = createHumanReport(document), inspectionSheet = report.sheets.find(sheet => sheet.name === "Inspection history");
    assert.equal(inspectionSheet.rows[0]["Record status"], "Voided: retained for history");
    assert.equal(inspectionSheet.rows[0]["Inspector (name at recording)"], "Historic inspector");
    assert.equal(inspectionSheet.rows[0]["Recorded outcome"], "No concern observed");
    assert.equal(inspectionSheet.rows[0]["Measured capacity (mAh)"], "Not recorded");
    assert.match(inspectionSheet.description, /not automatic safety certification/);
    assert.ok(!JSON.stringify(inspectionSheet.rows).includes("saved-inspector"));
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await excelBuffer(document));
    const human = workbook.getWorksheet("Inspection history"), evidence = workbook.getWorksheet("Evidence Inspections");
    assert.equal(human.state, "visible");
    assert.equal(evidence.state, "hidden");
    assert.equal(human.rowCount, 229);
    const field = label => evidence.getRow(5).getCell(evidence.getRow(4).values.indexOf(label)).value;
    assert.equal(field("inspectorAccountId"), "saved-inspector");
    assert.equal(field("voidedByAccountId"), "corrector-id");
    assert.equal(field("performedAt"), "2026-10-01T00:00:00.000Z");
    assert.equal(field("voidReason"), "Wrong battery selected");
});

test("retired service age stops at its saved Sydney retirement date while manufacture age continues", async context => {
    context.mock.timers.enable({ apis: ["Date"], now: asOf });
    const { store, data } = fixture();
    Object.assign(data.snapshot.batteries[0], { lifecycleStatus: "scrapped", lifecycleAt: "2026-10-01T14:30:00.000Z", firstUsedOn: "2026-10-01", manufacturedOn: "2026-09-01" });
    const report = await createExport(store, { dataset: "demo", mode: "summary", filter: { lifecycle: "all" } });
    const row = report.tables.Inventory[0];
    assert.equal(row.time_in_service_days, 1);
    assert.equal(row.service_age_as_of_date, "2026-10-02");
    assert.equal(row.manufacturing_age_days, 35);
    assert.equal(row.age_as_of_date, "2026-10-06");
    const detailed = await createExport(store, { dataset: "demo", mode: "detail", batteryId: "BAT-001", sections: ["specifications"] });
    assert.equal(detailed.tables.Batteries[0].time_in_service_days, 1);
    data.snapshot.batteries[0].lifecycleAt = null;
    const unknown = await createExport(store, { dataset: "demo", mode: "summary", filter: { lifecycle: "all" } });
    assert.equal(unknown.tables.Inventory[0].time_in_service_days, null);
});
