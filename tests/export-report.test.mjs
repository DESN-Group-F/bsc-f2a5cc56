import { test } from "node:test";
import assert from "node:assert/strict";
import { createHumanReport, reportDate, reportTimestamp } from "../work/qa/export-report.mjs";
import { createExport } from "../work/qa/exports.mjs";
import { excelBuffer } from "../work/qa/downloads.mjs";
import ExcelJS from "exceljs";

const metadata = { mode: "detail", dataset: "demo", exported_at_utc: "2026-10-04T03:00:00.000Z", operator: "Current administrator", range: "selected", exported_batteries: 1, filters: null, selection_filter_context: { personalScope: "all" } };
const document = tables => ({ metadata, tables });
const sheet = (report, name) => report.sheets.find(item => item.name === name);

test("readable report dates use Sydney DST while date-only values stay exact and unknowns explicit", () => {
    assert.equal(reportTimestamp("2026-10-03T15:59:00Z").toISOString(), "2026-10-04T01:59:00.000Z");
    assert.equal(reportTimestamp("2026-10-03T16:00:00Z").toISOString(), "2026-10-04T03:00:00.000Z");
    assert.equal(reportTimestamp("2026-04-04T15:59:00Z").toISOString(), "2026-04-05T02:59:00.000Z");
    assert.equal(reportTimestamp("2026-04-04T16:00:00Z").toISOString(), "2026-04-05T02:00:00.000Z");
    assert.equal(reportDate("2026-10-04").toISOString(), "2026-10-04T00:00:00.000Z");
    assert.equal(reportDate(null), "Not recorded");
    assert.match(reportDate("2026-02-31"), /^Invalid recorded date/);
    assert.match(reportTimestamp("invalid"), /^Invalid recorded timestamp/);
});

test("human inventory shows meaningful labels without mixing current storage with historical evidence", () => {
    const source = document({ Inventory: [{ battery_id: "BAT-001", name: "Teaching battery", status: "In store", owner_name: "Current owner", current_borrower_name: null, storage_building_code: "J18", storage_building_name: "Willis Annexe", storage_room_name: "Renamed room", storage_room_is_placeholder: true, observed_at_utc: "2026-10-01T00:00:00Z", last_observed_room: "Old room label", last_observed_building: "Saved building", observation_label_status: "recorded", observation_source: "Demo observation", capacity_mah: null, voltage: 3.7, manufactured_on: null, current_loan_id: "secret-loan-id", responsible_owner_account_id: "account-id" }] });
    const original = structuredClone(source), report = createHumanReport(source), row = sheet(report, "Inventory").rows[0];
    assert.equal(row["Current status"], "In store");
    assert.equal(row["Responsible owner (current name)"], "Current owner");
    assert.equal(row["Current borrower (name at checkout)"], "No active checkout");
    assert.match(row["Registered storage home"], /Renamed room.*Placeholder/);
    assert.equal(row["Last observed location (saved evidence)"], "Saved building · Old room label");
    assert.equal(row["Capacity (mAh)"], "Not recorded");
    assert.equal(row["Voltage (V)"], 3.7);
    assert.equal(row["Manufactured on"], "Not recorded");
    assert.ok(!JSON.stringify(row).includes("secret-loan-id"));
    assert.ok(!JSON.stringify(row).includes("account-id"));
    assert.deepEqual(source, original, "Report projection must not alter complete source evidence");
});

test("restricted detail sections do not acquire unrequested battery fields", () => {
    const report = createHumanReport(document({ Batteries: [{ battery_id: "BAT-001" }], Loans: [] }));
    assert.deepEqual(sheet(report, "Battery details").rows, [{ "Battery ID": "BAT-001" }]);
    assert.deepEqual(sheet(report, "Check-in and checkout").rows, []);
    assert.equal(report.sheets.length, 2);
});

test("loan history preserves recorded names, voided evidence and open duration semantics", () => {
    const report = createHumanReport(document({ Loans: [
        { battery_id: "BAT-001", borrower_name: "Name at checkout", checked_out_at: "2026-10-04T00:00:00Z", returned_at: "2026-10-04T01:30:00Z", checkout_actor_name: "Original checkout staff", return_actor_name: "Original return staff", correction_reason: null },
        { battery_id: "BAT-002", borrower_name: "Old borrower", checked_out_at: "2026-10-04T00:00:00Z", returned_at: null },
        { battery_id: "BAT-003", checked_out_at: "2026-10-04T00:00:00Z", cancelled_at: "2026-10-04T02:00:00Z", correction_reason: "Mistaken identity" },
    ], People: [{ id: "staff-account", name: "New display name", account_id: "opaque-account", role: "staff" }] }));
    const rows = sheet(report, "Check-in and checkout").rows;
    assert.equal(rows[0]["Borrower (name at checkout)"], "Name at checkout");
    assert.equal(rows[0]["Time out (hours)"], 1.5);
    assert.equal(rows[0]["Checkout recorded by"], "Original checkout staff");
    assert.equal(rows[1]["Loan status"], "In use");
    assert.equal(rows[1]["Time out (hours)"], 3);
    assert.match(rows[1]["Duration measured to"], /Report creation/);
    assert.equal(rows[2]["Loan status"], "Checkout voided");
    assert.equal(rows[2]["Time out (hours)"], "Not applicable: checkout voided");
    assert.equal(rows[2]["Correction reason"], "Mistaken identity");
    const person = sheet(report, "People directory").rows[0];
    assert.equal(person.Name, "New display name");
    assert.equal(person["Owner ID for imports"], "staff-account");
    assert.ok(!JSON.stringify(person).includes("opaque-account"));
});

test("location and charging reports retain missing historical labels, sources and legacy unknown duration", () => {
    const report = createHumanReport(document({
        Observations: [{ battery_id: "BAT-001", room_key: "current-room-key", room_name: null, room_building: null, observed_at: "2026-10-01T00:00:00Z", received_at: "2026-10-01T00:01:00Z", source: "Simulated return confirmation" }],
        Rooms: [{ id: "demo-room", name: "Current renamed room", building_name: "Current building", is_placeholder: 1, selectable: 0 }],
        Charges: [{ battery_id: "BAT-001", completed_at: "2026-10-01T00:00:00Z", duration_minutes: null, percentage: 65, actor_name: "Saved operator" }],
    }));
    assert.equal(sheet(report, "Location history").rows[0]["Saved location"], "Recorded address unavailable");
    assert.equal(sheet(report, "Location history").rows[0]["Evidence source"], "Simulated return confirmation");
    assert.equal(sheet(report, "Charging history").rows[0]["Duration (minutes)"], "Not recorded");
    assert.equal(sheet(report, "Charging history").rows[0]["Legacy recorded charge (%)"], 65);
    assert.equal(sheet(report, "Rooms directory").rows[0].Placeholder, "Yes");
    assert.equal(sheet(report, "Rooms directory").rows[0]["Available for selection"], "No");
});

test("activity explanations preserve history and make unknown operations explicitly uninterpreted", () => {
    const events = [
        { battery_id: "BAT-001", action: "checkout", actor_name: "Historic operator", at: "2026-10-01T00:00:00Z", details_json: JSON.stringify({ loanId: "opaque-loan", borrower: "Historic borrower" }) },
        { battery_id: "BAT-001", action: "return", actor_name: "Return operator", at: "2026-10-01T01:00:00Z", details_json: JSON.stringify({ borrower: "Historic borrower", returnPlacement: { roomName: "Original room", building: "Original building", source: "Staff return confirmation", observedAt: "2026-10-01T01:00:00Z" } }) },
        { action: "unknown_future_operation", actor_name: "Historic operator", at: "2026-10-01T02:00:00Z", details_json: JSON.stringify({ important: "retain this original value" }) },
        { action: "checkout", actor_name: "Historic operator", at: "2026-10-01T03:00:00Z", teaching_group_name: "Original class", affected_battery_count: 100 },
    ];
    const source = document({ Activity: events }), report = createHumanReport(source), rows = sheet(report, "Activity").rows;
    assert.equal(rows.length, 4);
    assert.equal(rows[0]["Recorded by (name at operation)"], "Historic operator");
    assert.match(rows[0]["What happened"], /Historic borrower/);
    assert.ok(!JSON.stringify(rows).includes("opaque-loan"));
    assert.match(rows[1]["What happened"], /Original building · Original room/);
    assert.equal(rows[2].Operation, "Other recorded operation");
    assert.match(rows[2]["What happened"], /no additional interpretation/);
    assert.equal(rows[3]["Affected batteries"], 100);
    assert.equal(rows[3]["Teaching group (name at operation)"], "Original class");
    assert.equal(source.tables.Activity[2].details_json, events[2].details_json);
});

test("report guide explains real selection, human filter labels and purpose without raw metadata objects", () => {
    const source = { metadata: { ...metadata, mode: "summary", range: "filtered", filters: { lifecycle: "active", owner: "opaque-owner", personalScope: "responsible", capacityMinMah: 2000, capacityMaxMah: 4000 }, filter_labels: { owner: "Teaching staff" } }, tables: { Inventory: [{ battery_id: "BAT-001" }] } };
    const report = createHumanReport(source), fact = label => report.facts.find(item => item.label === label).value;
    assert.match(fact("Filters"), /Responsible owner: Teaching staff/);
    assert.match(fact("Filters"), /2000 to 4000 mAh/);
    assert.ok(!fact("Filters").includes("opaque-owner"));
    assert.equal(fact("Personal scope"), "Batteries for which I am responsible");
    assert.match(fact("Using this workbook"), /not extra tasks/);
    assert.match(fact("Dates and times"), /Australia\/Sydney/);
    const selected = createHumanReport({ ...source, metadata: { ...source.metadata, range: "selected" } });
    assert.match(selected.facts.find(item => item.label === "Filters").value, /ordinary filters do not remove selected records/);
});

test("additional tables retain every value and avoid collisions between normalized headings", () => {
    const source = document({ Custom: [{ field_name: "first", "field name": "second", complex: { all: [1, 2, 3] }, value: 0, blank: null }] });
    const row = createHumanReport(source).sheets[0].rows[0];
    assert.equal(row["Field name"], "first");
    assert.equal(row["Field name (field name)"], "second");
    assert.deepEqual(row.Complex, { all: [1, 2, 3] });
    assert.equal(row.Value, 0);
    assert.equal(row.Blank, "Not recorded");
});

test("single activity detail includes that battery and only its requested complete history", async () => {
    const batteries = [{ id: "BAT-001", name: "Selected battery", ownerId: "staff-user", ownerName: "Staff", lifecycleStatus: "active", loanId: null, model: "", chemistry: "" }, { id: "BAT-002", name: "Other battery", ownerId: "staff-user", ownerName: "Staff", lifecycleStatus: "active", loanId: null, model: "", chemistry: "" }];
    const store = { viewerAccountId: "staff-user", scope: "test-scope", exportData: async () => ({ snapshot: { batteries, people: [], rooms: [], buildings: [], staffDirectory: [], actor: "Staff" }, raw: {
        batteries: batteries.map(battery => ({ id: battery.id, key: `scope/${battery.id}` })), people: [], rooms: [], buildings: [], observations: [], charges: [],
        loans: batteries.map(battery => ({ id: `loan-${battery.id}`, battery_key: `scope/${battery.id}`, borrower_name: "Original borrower", checked_out_at: "2026-10-01T00:00:00Z" })),
        audit_events: batteries.map(battery => ({ id: `event-${battery.id}`, battery_id: battery.id, action: "checkout", actor_id: "staff-user", actor_name: "Staff", at: "2026-10-01T00:00:00Z", details_json: "{}" })),
    } }) };
    const result = await createExport(store, { dataset: "demo", mode: "activity", activityIds: ["event-BAT-001"], activityDepth: "battery_details", sections: ["loans"] });
    assert.deepEqual(result.tables.Batteries, [{ battery_id: "BAT-001" }]);
    assert.deepEqual(result.tables.Loans.map(row => row.id), ["loan-BAT-001"]);
    assert.deepEqual(result.tables.ActivityMembers, []);
    assert.ok(!("People" in result.tables));
    assert.equal(createHumanReport(result).sheets.find(item => item.name === "Check-in and checkout").rows[0]["Borrower (name at checkout)"], "Original borrower");
});

test("Excel business cells preserve leading-zero identifiers and source evidence as text", async () => {
    const source = document({ Batteries: [{ battery_id: "BAT-001", tag_id: "00001234", name: "=literal label", capacity_mah: 2400, registered_at_utc: "2026-10-04T00:00:00Z" }] });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await excelBuffer(source));
    const row = (name, label) => {
        const target = workbook.getWorksheet(name), fields = target.getRow(4).values;
        return target.getRow(5).getCell(fields.indexOf(label));
    };
    assert.equal(row("Battery details", "RFID tag").value, "00001234");
    assert.equal(row("Battery details", "RFID tag").numFmt, "@");
    assert.equal(row("Battery details", "Battery name").value, "=literal label");
    assert.equal(row("Battery details", "Capacity (mAh)").value, 2400);
    assert.ok(row("Battery details", "Registered (Sydney)").value instanceof Date);
    assert.equal(row("Evidence Batteries", "tag_id").value, "00001234");
    assert.equal(row("Evidence Batteries", "registered_at_utc").value, "2026-10-04T00:00:00Z");
    assert.equal(workbook.getWorksheet("Evidence Batteries").state, "hidden");
    assert.equal(workbook.getWorksheet("Battery details").state, "visible");
});
