import test from "node:test";
import assert from "node:assert/strict";
import { defaultInventoryFilter, filterBatteries, inventoryFilterSchema } from "../work/qa/inventory-query.mjs";
import { createExport } from "../work/qa/exports.mjs";

const asOfOn = "2026-10-02";
const asset = (id, fields = {}) => ({
    version: 1, id, name: `Battery ${id}`, chemistry: "", model: "", capacityMah: null, voltage: null, tagId: null,
    manufacturedOn: null, firstUsedOn: null, ownerId: "owner", ownerName: "Asset owner",
    homeBuildingId: "J18", homeBuildingName: "Willis Annex", homeRoomId: null, homeRoomName: null, homeRoomNumber: null,
    loanId: null, borrowerId: null, borrowerName: null, borrowerAccountId: null, borrowerKind: null,
    checkedOutAt: null, lastCheckedOutAt: null, observedAt: null, chargedAt: null,
    ...fields,
});
const ids = (records, filter = {}) => filterBatteries(records, filter, asOfOn).map(b => b.id);

test("legacy filter payloads receive expanded defaults and preserve existing status, location and owner semantics", () => {
    const records = [asset("A", { ownerId: "owner-a", homeRoomId: "room-a" }), asset("B", { loanId: "loan", homeBuildingId: "E10" }), asset("C")];
    assert.deepEqual(ids(records), ["A", "B", "C"]);
    assert.deepEqual(ids(records, { status: "in", building: "J18", room: "__unspecified", owner: "owner", search: "" }), ["C"]);
    assert.equal(defaultInventoryFilter().chemistry, null);
    assert.equal(inventoryFilterSchema.parse({ status: "out" }).capacityMode, "any");
});

test("chemistry and model filters use saved values and keep unknowns distinct from names or purposes", () => {
    const records = [asset("A", { chemistry: "LiPo", model: "R-1" }), asset("B", { chemistry: "Li-ion", model: "R-2" }), asset("C", { name: "LiPo robotics pack" }), asset("D", { chemistry: "all", model: "__unknown" })];
    assert.deepEqual(ids(records, { chemistry: "LiPo" }), ["A"]);
    assert.deepEqual(ids(records, { chemistryUnknown: true }), ["C"]);
    assert.deepEqual(ids(records, { model: "R-2" }), ["B"]);
    assert.deepEqual(ids(records, { modelUnknown: true }), ["C"]);
    assert.deepEqual(ids(records, { chemistry: "all", model: "__unknown" }), ["D"]);
});

test("staff holder filtering uses authenticated account IDs and never same-name directory or legacy records", () => {
    const records = [
        asset("A", { loanId: "loan-a", borrowerKind: "staff", borrowerAccountId: "account-a", borrowerId: "person-a", borrowerName: "Same Name" }),
        asset("B", { loanId: "loan-b", borrowerKind: "staff", borrowerAccountId: "account-b", borrowerName: "Same Name" }),
        asset("C", { loanId: "loan-c", borrowerKind: "legacy", borrowerId: "account-a", borrowerName: "Same Name" }),
        asset("D", { borrowerKind: "staff", borrowerAccountId: "account-a", borrowerName: "Same Name" }),
    ];
    assert.deepEqual(ids(records, { holder: "account-a" }), ["A"]);
    assert.deepEqual(ids(records, { holder: "person-a" }), []);
    assert.deepEqual(ids(records, { holder: "__legacy" }), ["C"]);
    assert.deepEqual(ids(records, { holder: "account-b", status: "out" }), ["B"]);
});

test("capacity and voltage bounds are inclusive; missing values need an explicit unknown filter", () => {
    const records = [asset("A", { capacityMah: 2200, voltage: 7.4 }), asset("B", { capacityMah: 5000, voltage: 11.1 }), asset("C")];
    assert.deepEqual(ids(records, { capacityMinMah: 2200, capacityMaxMah: 5000 }), ["A", "B"]);
    assert.deepEqual(ids(records, { capacityMode: "known", voltageMax: 7.4 }), ["A"]);
    assert.deepEqual(ids(records, { capacityMode: "unknown", voltageMode: "unknown" }), ["C"]);
    assert.deepEqual(ids(records, { voltageMin: 7.4, voltageMax: 7.4 }), ["A"]);
});

test("manufacturing age uses one supplied calendar date, includes day zero and never guesses from first use", () => {
    const records = [asset("A", { manufacturedOn: "2026-10-02" }), asset("B", { manufacturedOn: "2026-10-01" }), asset("C", { firstUsedOn: "2020-01-01" }), asset("D", { manufacturedOn: "2026-10-03" })];
    assert.deepEqual(ids(records, { ageMinDays: 0, ageMaxDays: 0 }), ["A"]);
    assert.deepEqual(ids(records, { ageMinDays: 1, ageMaxDays: 1 }), ["B"]);
    assert.deepEqual(ids(records, { ageMode: "unknown" }), ["C", "D"]);
    assert.deepEqual(filterBatteries(records, { ageMinDays: 1, ageMaxDays: 1 }, "2026-10-03").map(b => b.id), ["A"]);
});

test("latest checkout and charge filters use Sydney calendar boundaries across standard and daylight-saving time", () => {
    const records = [
        asset("A", { lastCheckedOutAt: "2026-10-01T13:59:59Z", chargedAt: "2026-10-05T12:59:59Z" }),
        asset("B", { lastCheckedOutAt: "2026-10-01T14:00:00Z", chargedAt: "2026-10-05T13:00:00Z" }),
        asset("C", { checkedOutAt: "2026-10-01T14:00:00Z" }),
    ];
    assert.deepEqual(ids(records, { checkoutFrom: "2026-10-02", checkoutTo: "2026-10-02" }), ["B"]);
    assert.deepEqual(ids(records, { checkoutMode: "unknown" }), ["C"]);
    assert.deepEqual(ids(records, { chargeFrom: "2026-10-06", chargeTo: "2026-10-06" }), ["B"]);
    assert.deepEqual(ids(records, { chargeMode: "known", chargeTo: "2026-10-05" }), ["A"]);
});

test("search covers stored battery ID, name, model and tag identifiers", () => {
    const records = [asset("ID-unique", { name: "Teaching pack", model: "MODEL-X", tagId: "TAG-123" }), asset("B")];
    for (const search of ["id-UNIQUE", "teaching pack", "model-x", "tag-123"])
        assert.deepEqual(ids(records, { search }), ["ID-unique"]);
});

test("invalid, nonfinite and contradictory ranges are rejected instead of silently changing the query", () => {
    const invalid = [
        { capacityMinMah: 0 }, { capacityMaxMah: Infinity }, { voltageMin: -1 }, { voltageMax: NaN },
        { capacityMinMah: 5000, capacityMaxMah: 2200 }, { voltageMin: 11.1, voltageMax: 7.4 },
        { ageMinDays: -1 }, { ageMaxDays: 1.5 }, { ageMinDays: 10, ageMaxDays: 2 },
        { checkoutFrom: "2026-02-30" }, { chargeTo: "2026-10-02T00:00:00Z" },
        { checkoutFrom: "2026-10-03", checkoutTo: "2026-10-02" },
        { chargeFrom: "2026-10-03", chargeTo: "2026-10-02" },
        { ageMode: "unknown", ageMinDays: 1 }, { checkoutMode: "unknown", checkoutTo: "2026-10-02" },
        { chemistryUnknown: true, chemistry: "LiPo" }, { modelUnknown: true, model: "R-1" },
    ];
    for (const filter of invalid) assert.equal(inventoryFilterSchema.safeParse(filter).success, false, JSON.stringify(filter));
});

test("filtered summary counts and page scope use the same query while selected export preserves IDs outside the filters", async () => {
    const batteries = Array.from({ length: 25 }, (_, index) => asset(`BAT-${String(index).padStart(2, "0")}`, { chemistry: index < 23 ? "LiPo" : "Li-ion", capacityMah: 2200, manufacturedOn: "2020-01-01" }));
    const store = { exportData: async () => ({ snapshot: { batteries, actor: "Review staff", people: [], buildings: [], rooms: [] }, raw: { audit_events: [], batteries: [], loans: [], observations: [], charges: [], people: [], buildings: [], rooms: [] } }) };
    const filter = inventoryFilterSchema.parse({ chemistry: "LiPo", capacityMinMah: 2200 });
    const matching = filterBatteries(batteries, filter), visible = matching.slice(10, 20);
    const summary = await createExport(store, { dataset: "demo", mode: "summary", filter });
    assert.equal(summary.metadata.matching_batteries, matching.length);
    assert.deepEqual(summary.tables.Inventory.map(row => row.battery_id), matching.map(b => b.id));
    const page = await createExport(store, { dataset: "demo", mode: "summary", range: "page", page: 1, pageSize: "10", filter });
    assert.equal(page.metadata.matching_batteries, 23);
    assert.deepEqual(page.tables.Inventory.map(row => row.battery_id), visible.map(b => b.id));
    const selected = await createExport(store, { dataset: "demo", mode: "summary", range: "selected", batteryIds: ["BAT-00", "BAT-24"], filter });
    assert.deepEqual(selected.tables.Inventory.map(row => row.battery_id), ["BAT-00", "BAT-24"]);
    assert.equal(selected.metadata.filters, null);
    assert.deepEqual(selected.metadata.selection_filter_context, filter);
});
