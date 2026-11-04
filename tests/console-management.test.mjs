import { test } from "node:test";
import assert from "node:assert/strict";
import { summarizeOverview, dueState, dueLabel, openDueCycles, calendarDaysBetween, elapsedLabel } from "../work/qa/console/overview.mjs";
import { prepareBatteryEdit, parseFieldInput, effectiveChanges, changedFields, describeValue, draftIsStale } from "../work/qa/console/battery-edits.mjs";
import { readJournal, writeJournal, upsertEntries, removeEntry, journalKey, settleOutcome, unresolvedBatteryIds } from "../work/qa/console/edit-journal.mjs";
import { sortForColumn, contextFor, statusLabel, inspectionLabel, storageLabel } from "../work/qa/console/battery-columns.mjs";
import { consoleViews, viewById } from "../work/qa/console/views.mjs";
import { filterBatteries, defaultInventoryFilter } from "../work/qa/inventory-query.mjs";
import { verifyOperatorEditReceipt, operatorEditFingerprint } from "../work/qa/operator-edit.mjs";

const ownerAccount = "11111111-1111-4111-8111-111111111111";
const otherAccount = "22222222-2222-4222-8222-222222222222";
const viewer = "33333333-3333-4333-8333-333333333333";

function battery(overrides = {}) {
  return {
    registeredAt: "2026-10-01T00:00:00.000Z", lifecycleStatus: "active", lifecycleAt: null, lifecycleReason: null, lifecycleDestination: null, version: 3,
    id: "BAT-00000001", name: "Drone pack", chemistry: "LiPo", model: "3S 2200", capacityMah: 2200, voltage: 11.1, tagId: null,
    manufacturedOn: null, firstUsedOn: null, ownerId: "staff-owner", ownerName: "Olivia Owner", ownerAccountId: ownerAccount,
    homeBuildingId: "J18", homeBuildingName: "Willis Annexe", homeRoomId: null, homeRoomName: null, homeRoomNumber: null, homeRoomIsPlaceholder: null, homeRoomSelectable: null,
    loanId: null, borrowerId: null, borrowerName: null, borrowerAccountId: null, borrowerKind: null, checkedOutAt: null, lastCheckedOutAt: null,
    observedRoom: null, observedRoomId: null, observedBuilding: null, observationRoomSnapshot: null, observedAt: null, observationSource: null, chargedAt: null, chargeDurationMinutes: null,
    inspectionPreview: { validRecords: 0, concernRecords: 0, latest: null, latestConcern: null },
    ...overrides,
  };
}
const concern = (performedAt = "2026-11-01T01:00:00.000Z") => ({ validRecords: 2, concernRecords: 1, latest: { id: "i2", kind: "visual_check", outcome: "concern_observed", performedAt, recordedAt: performedAt, inspectorName: "Ivy" }, latestConcern: { id: "i2", kind: "visual_check", performedAt, recordedAt: performedAt, inspectorName: "Ivy" } });
const fine = (performedAt = "2026-11-02T01:00:00.000Z") => ({ validRecords: 2, concernRecords: 1, latest: { id: "i3", kind: "visual_check", outcome: "no_concern_observed", performedAt, recordedAt: performedAt, inspectorName: "Ivy" }, latestConcern: { id: "i1", kind: "visual_check", performedAt: "2026-10-01T00:00:00.000Z", recordedAt: "2026-10-01T00:00:00.000Z", inspectorName: "Ivy" } });

function snapshot(batteries, extra = {}) {
  return {
    dataset: "live", batteries, teachingGroups: [], events: [], actor: "Viewer", hardwareConnected: false,
    user: { id: viewer, displayName: "Viewer", role: "admin" },
    people: [
      { id: "staff-owner", name: "Olivia Owner", reference: "", role: "staff", accountId: ownerAccount, version: 4 },
      { id: "staff-other", name: "Oscar Other", reference: "", role: "staff", accountId: otherAccount, version: 2 },
      { id: "legacy", name: "Old borrower", reference: "", role: "borrower", accountId: null, version: 1 },
    ],
    staffDirectory: [{ id: ownerAccount, displayName: "Olivia Owner", username: "olivia", active: true }, { id: otherAccount, displayName: "Oscar Other", username: "oscar", active: false }],
    buildings: [{ id: "J18", name: "Willis Annexe", version: 7 }],
    rooms: [
      { id: "J18-101", name: "Store", building: "Willis Annexe", buildingId: "J18", number: "101", isPlaceholder: false, selectable: true, version: 5 },
      { id: "J18-OLD", name: "Closed store", building: "Willis Annexe", buildingId: "J18", number: "9", isPlaceholder: false, selectable: false, version: 1 },
    ],
    ...extra,
  };
}
const cycle = (overrides) => ({ id: crypto.randomUUID(), planId: "p", title: "Storage review", category: "storage_review", status: "open", dueOn: "2026-11-04", planRemoved: false, currentAssigneeIds: [viewer], canComplete: true, ...overrides });

test("due states use Sydney calendar days, including the day boundary", () => {
  assert.equal(calendarDaysBetween("2026-11-04", "2026-11-05"), 1);
  assert.equal(calendarDaysBetween("2026-02-30", "2026-03-01"), null);
  assert.deepEqual(dueState("2026-11-03", "2026-11-04"), { state: "overdue", days: -1 });
  assert.deepEqual(dueState("2026-11-04", "2026-11-04"), { state: "today", days: 0 });
  assert.deepEqual(dueState("2026-11-11", "2026-11-04"), { state: "soon", days: 7 });
  assert.deepEqual(dueState("2026-11-12", "2026-11-04"), { state: "upcoming", days: 8 });
  assert.equal(dueLabel({ state: "overdue", days: -3 }), "Overdue by 3 days");
  assert.equal(dueLabel({ state: "soon", days: 1 }), "Due tomorrow");
});

test("only open cycles of current plans are due work, most urgent first", () => {
  const cycles = [cycle({ title: "B", dueOn: "2026-11-06" }), cycle({ title: "A", dueOn: "2026-11-01" }), cycle({ status: "completed", dueOn: "2026-10-01" }), cycle({ planRemoved: true, dueOn: "2026-10-02" }), cycle({ title: "Other", dueOn: "2026-11-05", currentAssigneeIds: [ownerAccount] })];
  assert.deepEqual(openDueCycles(cycles, "2026-11-04").map((item) => item.cycle.title), ["A", "Other", "B"]);
  assert.deepEqual(openDueCycles(cycles, "2026-11-04", viewer).map((item) => item.cycle.title), ["A", "B"]);
});

test("overview counts follow the shared meanings and never invent loan due dates", () => {
  const now = new Date("2026-11-04T01:00:00.000Z"); // 12:00 in Sydney
  const batteries = [
    battery({ id: "BAT-1", inspectionPreview: concern() }),
    battery({ id: "BAT-2", loanId: "l1", borrowerAccountId: ownerAccount, borrowerName: "Olivia", checkedOutAt: "2026-11-01T01:00:00.000Z", inspectionPreview: fine() }),
    battery({ id: "BAT-3", loanId: "l2", borrowerAccountId: ownerAccount, borrowerName: "Olivia", checkedOutAt: "2026-11-03T01:00:00.000Z" }),
    battery({ id: "BAT-4", lifecycleStatus: "scrapped", inspectionPreview: concern() }),
  ];
  const summary = summarizeOverview({ snapshot: snapshot(batteries), cycles: [cycle({ dueOn: "2026-11-01" }), cycle({ dueOn: "2026-11-04" }), cycle({ dueOn: "2026-11-09", currentAssigneeIds: [] })], now });
  assert.equal(summary.today, "2026-11-04");
  assert.deepEqual([summary.active, summary.inStore, summary.inUse, summary.holders, summary.retired], [3, 1, 2, 1, 1]);
  assert.deepEqual(summary.tasks, { open: 3, overdue: 1, dueToday: 1, dueSoon: 1, mine: 2, mineUrgent: 2 });
  assert.deepEqual(summary.inspections.concern.map((item) => item.id), ["BAT-1"], "a later no-concern record and retired batteries are not current concerns");
  assert.equal(summary.inspections.neverInspected, 1);
  assert.deepEqual(summary.outstanding.map((item) => item.battery.id), ["BAT-2", "BAT-3"]);
  assert.equal(elapsedLabel(summary.outstanding[0].elapsedMs), "3 days");
});

test("new arrivals in the overview exclude retired assets and keep the 48-hour window", () => {
  const now = new Date("2026-11-04T01:00:00.000Z");
  const arrivals = { serverNow: now.toISOString(), throughSequence: 3, acknowledgedThroughSequence: 1, unreadCount: 2, items: [
    { batteryId: "BAT-1", sequence: 1, registeredAt: "2026-11-03T01:00:00.000Z", isUnread: false },
    { batteryId: "BAT-2", sequence: 2, registeredAt: "2026-11-03T02:00:00.000Z", isUnread: true },
    { batteryId: "BAT-4", sequence: 3, registeredAt: "2026-11-03T03:00:00.000Z", isUnread: true },
  ] };
  const summary = summarizeOverview({ snapshot: snapshot([battery({ id: "BAT-1" }), battery({ id: "BAT-2" }), battery({ id: "BAT-4", lifecycleStatus: "scrapped" })]), cycles: [], now, newArrivals: arrivals });
  assert.deepEqual(summary.newArrivals, { recent: 2, unread: 1 });
});

test("cell input parsing mirrors the server limits and keeps unknown values null", () => {
  assert.deepEqual(parseFieldInput("capacityMah", " "), { ok: true, value: null });
  assert.deepEqual(parseFieldInput("capacityMah", "2200"), { ok: true, value: 2200 });
  assert.equal(parseFieldInput("capacityMah", "0").ok, false);
  assert.equal(parseFieldInput("voltage", "1001").ok, false);
  assert.equal(parseFieldInput("name", "x").ok, false);
  assert.deepEqual(parseFieldInput("model", "  "), { ok: true, value: "" });
  assert.deepEqual(parseFieldInput("tagId", ""), { ok: true, value: null });
  assert.equal(parseFieldInput("manufacturedOn", "2026-02-30").ok, false);
  assert.deepEqual(parseFieldInput("homeRoomId", ""), { ok: true, value: null });
});

test("a reviewed edit carries the exact loaded record and directory versions", async () => {
  const record = battery({ homeRoomId: "J18-101", homeRoomName: "Store", homeRoomNumber: "101", homeRoomIsPlaceholder: false, homeRoomSelectable: true });
  const requestId = crypto.randomUUID();
  const prepared = prepareBatteryEdit({ battery: record, changes: { name: "Drone pack A", capacityMah: 2200, ownerId: "staff-owner" }, snapshot: snapshot([record]), requestId, now: new Date("2026-11-04T00:00:00Z") });
  assert.equal(prepared.ok, true);
  assert.deepEqual(prepared.fields, ["name"], "unchanged values are not edits");
  assert.equal(prepared.setsBuilding, false);
  assert.deepEqual(prepared.payload.before, { name: "Drone pack", model: "3S 2200", chemistry: "LiPo", capacityMah: 2200, voltage: 11.1, tagId: null, ownerId: "staff-owner", homeRoomId: "J18-101", manufacturedOn: null, firstUsedOn: null, homeBuildingId: "J18", version: 3, registeredAt: "2026-10-01T00:00:00.000Z" });
  assert.deepEqual(prepared.payload.directoryBindings, { ownerVersion: 4, ownerAccountId: ownerAccount, buildingVersion: 7, roomVersion: 5 });
  const receipt = { kind: "metadata_edit", requestId, dataset: "live", actorAccountId: viewer, batteryId: record.id, at: "2026-11-04T00:00:01.000Z", replayed: false, before: prepared.payload.before, after: { ...prepared.payload.fields, version: 4, registeredAt: record.registeredAt }, directoryBindings: prepared.payload.directoryBindings };
  assert.deepEqual(verifyOperatorEditReceipt(receipt, prepared.payload, viewer, "live"), receipt, "the server's receipt shape verifies against the prepared payload");
  assert.match(await operatorEditFingerprint(prepared.payload, viewer, "live"), /^sha256:/);
});

test("edits that the server would refuse are stopped before review", () => {
  const record = battery({ tagId: null });
  const snap = snapshot([record, battery({ id: "BAT-2", tagId: "TAG-9" }), battery({ id: "BAT-R", lifecycleStatus: "scrapped" })]);
  const prepare = (changes, target = record) => prepareBatteryEdit({ battery: target, changes, snapshot: snap, requestId: crypto.randomUUID(), now: new Date("2026-11-04T00:00:00Z") });
  assert.deepEqual(prepare({}).ok, false);
  assert.match(prepare({ tagId: "TAG-9" }).errors.join(" "), /already assigned to BAT-2/);
  assert.match(prepare({ ownerId: "staff-other" }).errors.join(" "), /active staff account/);
  assert.match(prepare({ ownerId: "legacy" }).errors.join(" "), /staff account/);
  assert.match(prepare({ homeRoomId: "J18-OLD" }).errors.join(" "), /available J18 room/);
  assert.match(prepare({ manufacturedOn: "2099-01-01" }).errors.join(" "), /future/);
  assert.match(prepare({ manufacturedOn: "2026-05-01", firstUsedOn: "2026-04-01" }).errors.join(" "), /earlier than the manufacture date/);
  assert.match(prepare({ name: "Other" }, snap.batteries[2]).errors.join(" "), /Retired batteries/);
});

test("an inactive owner may be kept, and a missing building is recorded as J18", () => {
  const record = battery({ ownerId: "staff-other", ownerAccountId: otherAccount, homeBuildingId: null, homeBuildingName: null });
  const prepared = prepareBatteryEdit({ battery: record, changes: { model: "4S" }, snapshot: snapshot([record]), requestId: crypto.randomUUID() });
  assert.equal(prepared.ok, true);
  assert.equal(prepared.setsBuilding, true);
  assert.equal(prepared.payload.before.homeBuildingId, null);
  assert.equal(prepared.payload.fields.homeBuildingId, "J18");
});

test("draft helpers detect stale bases and only report real changes", () => {
  const record = battery();
  assert.deepEqual(effectiveChanges(record, { name: "Drone pack", voltage: 12 }), { voltage: 12 });
  assert.deepEqual(changedFields(record, { name: "Drone pack", voltage: 12 }), ["voltage"]);
  assert.equal(draftIsStale(3, record), false);
  assert.equal(draftIsStale(2, record), true);
  assert.equal(draftIsStale(3, undefined), true);
  const snap = snapshot([record]);
  assert.equal(describeValue("ownerId", "staff-owner", snap), "Olivia Owner");
  assert.equal(describeValue("homeRoomId", "J18-101", snap), "101 · Store");
  assert.equal(describeValue("capacityMah", null, snap), "Not recorded");
});

function memoryStorage() {
  const values = new Map();
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: (key) => values.delete(key), values };
}

test("the edit journal keeps exact requests per account and inventory and reports damage", async () => {
  const storage = memoryStorage();
  const record = battery();
  const prepared = prepareBatteryEdit({ battery: record, changes: { name: "Renamed" }, snapshot: snapshot([record]), requestId: crypto.randomUUID() });
  const entry = { requestId: prepared.payload.requestId, batteryId: record.id, payload: prepared.payload, preparedAt: "2026-11-04T00:00:00.000Z", state: "prepared", lastError: null };
  writeJournal(storage, viewer, "live", upsertEntries([], [entry]));
  assert.deepEqual(readJournal(storage, viewer, "live"), { entries: [entry], error: "" });
  assert.deepEqual(readJournal(storage, viewer, "demo").entries, [], "the other inventory is separate");
  assert.deepEqual([...unresolvedBatteryIds([entry])], [record.id]);
  const sent = upsertEntries([entry], [{ ...entry, state: "sent" }]);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].state, "sent");
  writeJournal(storage, viewer, "live", removeEntry(sent, entry.requestId));
  assert.equal(storage.values.has(journalKey(viewer, "live")), false);
  storage.setItem(journalKey(viewer, "live"), "{broken");
  const damaged = readJournal(storage, viewer, "live");
  assert.equal(damaged.entries.length, 0);
  assert.match(damaged.error, /could not be read/);
  assert.equal(storage.values.get(journalKey(viewer, "live")), "{broken", "damaged storage is left untouched");
  const tampered = [{ ...entry, batteryId: "BAT-OTHER" }];
  storage.setItem(journalKey(viewer, "live"), JSON.stringify(tampered));
  assert.match(readJournal(storage, viewer, "live").error, /could not be read/);
});

test("outcomes settle only against the original request", async () => {
  const record = battery();
  const prepared = prepareBatteryEdit({ battery: record, changes: { name: "Renamed" }, snapshot: snapshot([record]), requestId: crypto.randomUUID() });
  const payload = prepared.payload;
  const receipt = { kind: "metadata_edit", requestId: payload.requestId, dataset: "live", actorAccountId: viewer, batteryId: record.id, at: "2026-11-04T00:00:01.000Z", replayed: true, before: payload.before, after: { ...payload.fields, version: 4, registeredAt: record.registeredAt }, directoryBindings: payload.directoryBindings };
  assert.deepEqual(await settleOutcome({ state: "confirmed", receipt }, payload, viewer, "live"), { kind: "saved", at: receipt.at, version: 4 });
  assert.deepEqual(await settleOutcome({ state: "missing", requestId: payload.requestId, dataset: "live", actorAccountId: viewer }, payload, viewer, "live"), { kind: "not-received" });
  const fingerprint = await operatorEditFingerprint(payload, viewer, "live");
  assert.deepEqual(await settleOutcome({ state: "rejected", requestId: payload.requestId, dataset: "live", actorAccountId: viewer, batteryId: record.id, at: receipt.at, code: "metadata_edit_rejected_final", error: "Changed elsewhere", fingerprint }, payload, viewer, "live"), { kind: "not-saved", message: "Changed elsewhere" });
  await assert.rejects(settleOutcome({ state: "confirmed", receipt: { ...receipt, after: { ...receipt.after, name: "Something else" } } }, payload, viewer, "live"));
  await assert.rejects(settleOutcome({ state: "missing", requestId: payload.requestId, dataset: "demo", actorAccountId: viewer }, payload, viewer, "live"));
});

test("console views are criteria of the shared query, including the inspection criterion", () => {
  const batteries = [battery({ id: "BAT-1", inspectionPreview: concern() }), battery({ id: "BAT-2", inspectionPreview: fine() }), battery({ id: "BAT-3" }), battery({ id: "BAT-4", lifecycleStatus: "scrapped" }), battery({ id: "BAT-5", loanId: "l", borrowerAccountId: ownerAccount, borrowerKind: "staff" })];
  const ids = (view) => filterBatteries(batteries, viewById.get(view).filter(), "2026-11-04", ownerAccount).map((item) => item.id);
  assert.deepEqual(ids("attention"), ["BAT-1"]);
  assert.deepEqual(ids("uninspected"), ["BAT-3", "BAT-5"]);
  assert.deepEqual(ids("in-use"), ["BAT-5"]);
  assert.deepEqual(ids("retired"), ["BAT-4"]);
  assert.deepEqual(ids("everything"), ["BAT-1", "BAT-2", "BAT-3", "BAT-4", "BAT-5"]);
  assert.deepEqual(ids("mine"), ["BAT-1", "BAT-2", "BAT-3", "BAT-5"]);
  assert.equal(defaultInventoryFilter().inspection, "all");
  for (const view of consoleViews) assert.doesNotThrow(() => view.filter());
});

test("column sorting keeps unknown values last in both directions with Battery ID ties", () => {
  const snap = snapshot([]);
  const context = { ...contextFor(snap), today: "2026-11-04" };
  const rows = [battery({ id: "BAT-10", capacityMah: null }), battery({ id: "BAT-2", capacityMah: 1000 }), battery({ id: "BAT-3", capacityMah: 3000 }), battery({ id: "BAT-1", capacityMah: 1000 })];
  assert.deepEqual(sortForColumn(rows, "capacity", "asc", context).map((item) => item.id), ["BAT-1", "BAT-2", "BAT-3", "BAT-10"]);
  assert.deepEqual(sortForColumn(rows, "capacity", "desc", context).map((item) => item.id), ["BAT-3", "BAT-1", "BAT-2", "BAT-10"]);
  assert.equal(statusLabel(battery({ loanId: "x" })), "In use");
  assert.equal(inspectionLabel(battery()), "None recorded");
  assert.equal(storageLabel(battery()), "J18 · Room not specified");
});
