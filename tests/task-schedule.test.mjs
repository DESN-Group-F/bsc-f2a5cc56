import { test } from "node:test";
import assert from "node:assert/strict";
import {
    taskPlanSchema, taskTemplates, addTaskInterval, nextCycleDueOn,
    taskCycleCandidate, taskSchedulePreview, taskReminderAt,
} from "../work/qa/task-schedule.mjs";

const draft = extra => taskPlanSchema.parse({ category: "storage_review", title: "Storage review", ...extra });
const active = extra => draft({
    state: "active", applicabilityConfirmed: true, basis: "Confirmed local review procedure, revision 2.", description: "Review the selected area and record the result and any follow-up actions.",
    assigneeIds: ["native-staff-1"], targetKind: "storage_area", targetRef: "J18-ROOM-115",
    firstDueOn: "2026-01-31", reminderTime: "09:15", recurrenceBasis: "calendar", interval: 1, unit: "months", ...extra,
});

test("drafts retain unknown dates, reminder times and applicability instead of inventing operational defaults", () => {
    const plan = draft();
    assert.equal(plan.state, "draft");
    assert.equal(plan.firstDueOn, null);
    assert.equal(plan.reminderTime, null);
    assert.equal(plan.applicabilityConfirmed, false);
    assert.deepEqual(plan.assigneeIds, []);
    assert.deepEqual(plan.scheduledDates, []);
    assert.equal(taskSchedulePreview(plan).reminderStatus, "unconfigured");
    assert.equal(taskSchedulePreview(plan).nextDueOn, null);
});

test("activation requires a confirmed basis, applicability, assigned people, target and an actual schedule", () => {
    assert.equal(active().state, "active");
    for (const missing of [{ description: "" }, { basis: "" }, { applicabilityConfirmed: false }, { assigneeIds: [] }, { targetRef: null }, { firstDueOn: null }, { reminderTime: null }])
        assert.throws(() => active(missing), error => error.name === "ZodError");
    assert.throws(() => active({ category: "inventory_reconciliation", targetKind: "inventory", targetRef: null, scopeNote: "" }), /Describe the inventory/);
    assert.equal(active({ category: "inventory_reconciliation", targetKind: "inventory", targetRef: null, scopeNote: "All batteries in the confirmed J18 teaching inventory." }).targetKind, "inventory");
    assert.throws(() => active({ category: "storage_maintenance", targetKind: "batteries", targetRef: null, batteryIds: [] }), /registered battery/);
    assert.deepEqual(active({ category: "storage_maintenance", targetKind: "batteries", targetRef: null, batteryIds: ["BAT-001"] }).batteryIds, ["BAT-001"]);
    assert.equal(active({ recurrenceBasis: "dates", firstDueOn: null, scheduledDates: ["2026-02-20"] }).firstDueOn, null);
    assert.throws(() => active({ recurrenceBasis: "dates", scheduledDates: [] }), /teaching-period dates/);
});

test("active category targets distinguish one storage-area review from inventory reconciliation and asset maintenance", () => {
    assert.throws(() => active({ targetKind: "model", targetRef: "Known battery model" }), /appropriate to this task category/);
    assert.throws(() => active({ batteryIds: ["BAT-001"] }), /do not create per-battery/);
    assert.throws(() => active({ category: "storage_maintenance", targetKind: "storage_area" }), /appropriate to this task category/);
    assert.throws(() => active({ category: "inventory_reconciliation", targetKind: "storage_area" }), /appropriate to this task category/);
    assert.equal(active({ category: "storage_maintenance", targetKind: "model", targetRef: "Known battery model" }).targetKind, "model");
    assert.throws(() => active({ category: "storage_maintenance", targetKind: "group", targetRef: "Confirmed project group" }), /define this group/);
    assert.deepEqual(active({ category: "storage_maintenance", targetKind: "group", targetRef: "Confirmed project group", batteryIds: ["BAT-001"] }).batteryIds, ["BAT-001"]);
    assert.equal(draft({ category: "storage_maintenance", targetKind: "group", targetRef: null, batteryIds: [] }).state, "draft");
});

test("shared schema rejects unsupported task types, invalid dates, intervals, reminder times and delivery channels", () => {
    for (const invalid of [
        { category: "daily_observation" }, { category: "battery_issue" }, { category: "record_correction" },
        { firstDueOn: "2026-02-29" }, { scheduledDates: ["2026-04-31"] }, { interval: 0 }, { interval: 121 },
        { interval: 1.5 }, { unit: "hours" }, { reminderDaysBefore: -1 }, { reminderDaysBefore: 366 },
        { reminderTime: "24:00" }, { reminderTime: "9:00" }, { reminderTime: "09:60" },
        { channels: [] }, { channels: ["email"] }, { channels: ["sms"] },
        { assigneeIds: ["not/a/native/id"] }, { assigneeIds: Array.from({ length: 101 }, (_, index) => `staff-${index}`) },
    ]) assert.throws(() => draft(invalid), error => error.name === "ZodError");
    const plan = draft({ assigneeIds: ["staff-b", "staff-a", "staff-a"], batteryIds: ["BAT-002", "BAT-001", "BAT-001"], scheduledDates: ["2026-12-01", "2026-03-01", "2026-03-01"], channels: ["messages", "messages"] });
    assert.deepEqual(plan.assigneeIds, ["staff-a", "staff-b"]);
    assert.deepEqual(plan.batteryIds, ["BAT-001", "BAT-002"]);
    assert.deepEqual(plan.scheduledDates, ["2026-03-01", "2026-12-01"]);
    assert.deepEqual(plan.channels, ["messages"]);
});

test("calendar month recurrence retains the original day through short months and leap years", () => {
    const monthly = active();
    assert.equal(nextCycleDueOn(monthly), "2026-01-31");
    assert.equal(nextCycleDueOn(monthly, "2026-01-31"), "2026-02-28");
    assert.equal(nextCycleDueOn(monthly, "2026-02-28"), "2026-03-31");
    assert.equal(nextCycleDueOn(monthly, "2026-03-31"), "2026-04-30");
    const annual = active({ firstDueOn: "2024-02-29", interval: 1, unit: "years" });
    assert.equal(nextCycleDueOn(annual, "2024-02-29"), "2025-02-28");
    assert.equal(nextCycleDueOn(annual, "2027-02-28"), "2028-02-29");
    assert.equal(addTaskInterval("2026-08-31", 6, "months"), "2027-02-28");
    assert.equal(addTaskInterval("2026-08-31", 12, "months"), "2027-08-31");
});

test("six months and one week use their stated calendar units", () => {
    assert.equal(addTaskInterval("2026-01-31", 6, "months"), "2026-07-31");
    assert.notEqual(addTaskInterval("2026-01-31", 6, "months"), addTaskInterval("2026-01-31", 180, "days"));
    assert.equal(addTaskInterval("2026-09-28", 1, "weeks"), "2026-10-05");
    assert.equal(addTaskInterval("2024-02-28", 1, "days"), "2024-02-29");
    assert.throws(() => addTaskInterval("2026-02-29", 1, "months"), RangeError);
    assert.throws(() => addTaskInterval("2026-01-31", -1, "months"), RangeError);
    assert.throws(() => addTaskInterval("9999-12-31", 1, "days"), RangeError);
});

test("late completion skips calendar periods for future planning without counting them as completed", () => {
    const plan = active(), initial = taskCycleCandidate(plan);
    assert.deepEqual(initial, { nextDueOn: "2026-01-31", skippedPeriods: 0, calculationRule: "initial_due_date" });
    const completed = taskCycleCandidate(plan, "2026-01-31", "2026-05-02");
    assert.deepEqual(completed, { nextDueOn: "2026-05-31", skippedPeriods: 3, calculationRule: "calendar_anchor_after_completion" });
    assert.equal(nextCycleDueOn(plan, "2026-05-31", "2026-05-03"), "2026-06-30");
    assert.equal(taskCycleCandidate(plan, "2026-01-31", "2026-02-28").skippedPeriods, 1);
    const weekly = active({ firstDueOn: "2026-01-01", interval: 1, unit: "weeks" });
    assert.deepEqual(taskCycleCandidate(weekly, "2026-01-01", "2026-01-20"), { nextDueOn: "2026-01-22", skippedPeriods: 2, calculationRule: "calendar_anchor_after_completion" });
});

test("completion recurrence advances from actual completion and cannot infer it from a due date", () => {
    const plan = active({ recurrenceBasis: "completion" });
    assert.equal(nextCycleDueOn(plan), "2026-01-31");
    assert.equal(nextCycleDueOn(plan, "2026-01-31"), null);
    assert.equal(taskCycleCandidate(plan, "2026-01-31").calculationRule, "awaiting_actual_completion");
    assert.equal(nextCycleDueOn(plan, "2026-01-31", "2026-02-28"), "2026-03-28");
    const sixMonthly = active({ recurrenceBasis: "completion", interval: 6, unit: "months" });
    assert.equal(nextCycleDueOn(sixMonthly, "2026-01-31", "2026-03-15"), "2026-09-15");
    assert.equal(taskCycleCandidate(sixMonthly, "2026-01-31", "2026-03-15").skippedPeriods, 0);
});

test("teaching-period dates are explicit and exhausted lists do not invent another date", () => {
    const plan = active({ recurrenceBasis: "dates", firstDueOn: null, scheduledDates: ["2026-03-01", "2026-07-01", "2026-10-01"] });
    assert.equal(nextCycleDueOn(plan), "2026-03-01");
    assert.equal(nextCycleDueOn(plan, "2026-03-01"), "2026-07-01");
    assert.deepEqual(taskCycleCandidate(plan, "2026-03-01", "2026-08-01"), { nextDueOn: "2026-10-01", skippedPeriods: 1, calculationRule: "explicit_dates_after_completion" });
    assert.equal(nextCycleDueOn(plan, "2026-10-01", "2026-10-02"), null);
    assert.equal(nextCycleDueOn(draft({ recurrenceBasis: "dates" })), null);
});

test("reminder preview subtracts calendar days and resolves the selected Sydney time", () => {
    const plan = active({ firstDueOn: "2026-10-04", reminderDaysBefore: 1, reminderTime: "09:00" });
    const preview = taskSchedulePreview(plan);
    assert.equal(preview.nextDueOn, "2026-10-04");
    assert.equal(preview.nextReminderOn, "2026-10-03");
    assert.equal(preview.reminderTime, "09:00");
    assert.equal(preview.timeZone, "Australia/Sydney");
    assert.equal(preview.reminderStatus, "scheduled");
    assert.equal(preview.reminderAtUtc, "2026-10-02T23:00:00.000Z");
    assert.equal(taskReminderAt("2026-10-04", 0, "09:00").reminderAtUtc, "2026-10-03T22:00:00.000Z");
    assert.equal(taskReminderAt("2026-01-31", 3, "12:45").nextReminderOn, "2026-01-28");
    assert.equal(taskReminderAt("2026-01-31", 3, "12:45").reminderAtUtc, "2026-01-28T01:45:00.000Z");
});

test("ambiguous and nonexistent Sydney daylight-saving times never claim a UTC instant", () => {
    const spring = taskReminderAt("2026-10-04", 0, "02:30");
    assert.equal(spring.reminderStatus, "nonexistent");
    assert.equal(spring.reminderAtUtc, null);
    const autumn = taskReminderAt("2026-04-05", 0, "02:30");
    assert.equal(autumn.reminderStatus, "ambiguous");
    assert.equal(autumn.reminderAtUtc, null);
    assert.equal(taskReminderAt("2026-10-04", 0, "03:30").reminderAtUtc, "2026-10-03T16:30:00.000Z");
    assert.equal(taskReminderAt("2026-04-05", 0, "03:30").reminderAtUtc, "2026-04-04T17:30:00.000Z");
    assert.equal(taskReminderAt("2026-10-04", 0, null).reminderStatus, "unconfigured");
    assert.equal(taskReminderAt(null, 0, "09:00").reminderAtUtc, null);
    assert.throws(() => taskReminderAt("2026-01-31", 366, "09:00"), RangeError);
});

test("future preview is pure and does not alter the plan or a caller's pending-cycle evidence", () => {
    const plan = active({ firstDueOn: "2026-06-30" });
    const before = structuredClone(plan), openCycle = Object.freeze({ dueOn: "2026-01-31", title: "Original storage review", reminderTime: "10:00" });
    const preview = taskSchedulePreview(plan, { lastDueOn: openCycle.dueOn, completedOn: "2026-06-03" });
    assert.equal(preview.nextDueOn, "2026-06-30");
    assert.equal(openCycle.dueOn, "2026-01-31");
    assert.equal(openCycle.reminderTime, "10:00");
    assert.deepEqual(plan, before);
});

test("the three provisional templates contain no fabricated teaching dates, assignments or reminder time", () => {
    assert.equal(taskTemplates.length, 3);
    assert.deepEqual(taskTemplates.map(template => template.plan.category).sort(), ["inventory_reconciliation", "storage_maintenance", "storage_review"]);
    for (const template of taskTemplates) {
        assert.equal(taskPlanSchema.parse(template.plan).state, "draft");
        assert.equal(template.plan.applicabilityConfirmed, false);
        assert.equal(template.plan.firstDueOn, null);
        assert.equal(template.plan.reminderTime, null);
        assert.deepEqual(template.plan.assigneeIds, []);
        assert.deepEqual(template.plan.scheduledDates, []);
        assert.ok(template.plan.basis.includes("confirm") || template.plan.basis.includes("Confirm"));
        assert.ok(template.description.length > 10);
    }
    const maintenance = taskTemplates.find(template => template.plan.category === "storage_maintenance").plan;
    assert.equal(maintenance.interval, 6);
    assert.equal(maintenance.unit, "months");
    const reconciliation = taskTemplates.find(template => template.plan.category === "inventory_reconciliation").plan;
    assert.equal(reconciliation.recurrenceBasis, "dates");
});
