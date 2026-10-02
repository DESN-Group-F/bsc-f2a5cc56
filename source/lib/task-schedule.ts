import { z } from "zod";
import { isDateOnly } from "./battery-age";

export const taskCategories = ["storage_review", "inventory_reconciliation", "storage_maintenance"] as const;
export const taskTargetKinds = ["inventory", "storage_area", "model", "group", "batteries"] as const;
export const taskTargetsByCategory = {
    storage_review: ["storage_area"],
    inventory_reconciliation: ["inventory", "model", "group", "batteries"],
    storage_maintenance: ["model", "group", "batteries"],
} as const;
export const taskTimeZone = "Australia/Sydney" as const;
const searchableCategoryLabels = {
    storage_review: "Storage area review",
    inventory_reconciliation: "Inventory reconciliation",
    storage_maintenance: "Storage maintenance review",
};
const searchableTargetLabels = { inventory: "Defined inventory", storage_area: "Storage area", model: "Battery model", group: "Defined group", batteries: "Selected batteries" };

/** Keep visible task searches and downloadable task scope consistent. */
export function taskPlanMatchesQuery(plan: Pick<TaskPlan, "title" | "description" | "basis" | "category" | "targetKind" | "targetRef" | "scopeNote" | "state">, query: string): boolean {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return true;
    return [plan.title, plan.description, plan.basis, plan.category, searchableCategoryLabels[plan.category], plan.targetKind,
        searchableTargetLabels[plan.targetKind], plan.targetRef, plan.scopeNote, plan.state].join(" ").toLowerCase().includes(normalized);
}
const dateOnly = z.string().refine(isDateOnly, "Use a real calendar date in YYYY-MM-DD format.");
const taskIdentifier = z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, "Use a valid record identifier.");
const optionalText = z.string().trim().max(120).nullable().default(null);

export const taskPlanSchema = z.object({
    category: z.enum(taskCategories),
    title: z.string().trim().min(2).max(160),
    description: z.string().trim().max(4000).default(""),
    basis: z.string().trim().max(2000).default(""),
    scopeNote: z.string().trim().max(2000).default(""),
    targetKind: z.enum(taskTargetKinds).default("inventory"),
    targetRef: optionalText,
    batteryIds: z.array(taskIdentifier).max(100).default([]).transform(values => [...new Set(values)].sort()),
    assigneeIds: z.array(taskIdentifier).max(100).default([]).transform(values => [...new Set(values)].sort()),
    firstDueOn: dateOnly.nullable().default(null),
    recurrenceBasis: z.enum(["calendar", "completion", "dates"]).default("calendar"),
    interval: z.number().int().min(1).max(120).default(1),
    unit: z.enum(["days", "weeks", "months", "years"]).default("weeks"),
    scheduledDates: z.array(dateOnly).max(500).default([]).transform(values => [...new Set(values)].sort()),
    reminderDaysBefore: z.number().int().min(0).max(365).default(0),
    reminderTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, "Use a valid local time in HH:mm format.").nullable().default(null),
    channels: z.array(z.enum(["messages", "email"])).min(1).max(2).default(["messages"]).transform(values => [...new Set(values)]),
    state: z.enum(["draft", "active", "paused"]).default("draft"),
    applicabilityConfirmed: z.boolean().default(false),
}).superRefine((plan, context) => {
    const issue = (path: string, message: string) => context.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });
    if (!plan.channels.includes("messages")) issue("channels", "Keep Messages enabled; email is an additional delivery channel.");
    if (plan.state !== "active") return;
    if (!plan.description) issue("description", "Describe the required task and completion evidence before activation.");
    if (!plan.basis) issue("basis", "Record the applicable source or confirmed local basis before activation.");
    if (!plan.applicabilityConfirmed) issue("applicabilityConfirmed", "Confirm that this task and interval apply to the selected target.");
    if (!plan.assigneeIds.length) issue("assigneeIds", "Assign at least one active staff account before activation.");
    if (!plan.reminderTime) issue("reminderTime", "Choose a Sydney reminder time before activation.");
    if (plan.recurrenceBasis === "dates") {
        if (!plan.scheduledDates.length) issue("scheduledDates", "Enter the actual teaching-period dates before activation.");
    } else if (!plan.firstDueOn) issue("firstDueOn", "Choose the first due date before activation.");
    if (["storage_area", "model", "group"].includes(plan.targetKind) && !plan.targetRef) issue("targetRef", "Select or define the target before activation.");
    if (plan.targetKind === "batteries" && !plan.batteryIds.length) issue("batteryIds", "Select at least one registered battery before activation.");
    if (plan.targetKind === "group" && !plan.batteryIds.length) issue("batteryIds", "Select the registered batteries that define this group before activation.");
    if (plan.targetKind === "inventory" && !plan.scopeNote) issue("scopeNote", "Describe the inventory covered by this task before activation.");
    const allowedTargets: readonly string[] = taskTargetsByCategory[plan.category];
    if (!allowedTargets.includes(plan.targetKind)) issue("targetKind", "Choose a target appropriate to this task category.");
    if (plan.category === "storage_review" && plan.batteryIds.length) issue("batteryIds", "A storage-area review covers the selected area; do not create per-battery review assignments.");
});

export type TaskPlan = z.infer<typeof taskPlanSchema>;
export type TaskIntervalUnit = TaskPlan["unit"];
export type TaskCycleCandidate = { nextDueOn: string | null; skippedPeriods: number; calculationRule: string };
export type TaskReminderStatus = "scheduled" | "ambiguous" | "nonexistent" | "unconfigured";
export type TaskReminder = {
    nextReminderOn: string | null;
    reminderTime: string | null;
    timeZone: typeof taskTimeZone;
    reminderStatus: TaskReminderStatus;
    reminderAtUtc: string | null;
};
const dayMilliseconds = 86_400_000;

function requireDate(value: string) {
    if (!isDateOnly(value)) throw new RangeError("Use a real calendar date in YYYY-MM-DD format.");
    return new Date(`${value}T00:00:00.000Z`);
}

function dateString(date: Date): string {
    const result = date.toISOString().slice(0, 10);
    if (!isDateOnly(result)) throw new RangeError("This schedule falls outside the supported calendar date range.");
    return result;
}

/** Add a calendar interval directly to its anchor, retaining the original day where possible. */
export function addTaskInterval(anchorOn: string, interval: number, unit: TaskIntervalUnit): string {
    if (!Number.isInteger(interval) || interval < 0) throw new RangeError("The calendar interval must be a nonnegative integer.");
    const date = requireDate(anchorOn);
    if (unit === "days" || unit === "weeks") date.setUTCDate(date.getUTCDate() + interval * (unit === "weeks" ? 7 : 1));
    else if (unit === "months" || unit === "years") {
        const day = date.getUTCDate();
        date.setUTCDate(1);
        date.setUTCMonth(date.getUTCMonth() + interval * (unit === "years" ? 12 : 1));
        const lastDay = new Date(date);
        lastDay.setUTCMonth(lastDay.getUTCMonth() + 1);
        lastDay.setUTCDate(0);
        date.setUTCDate(Math.min(day, lastDay.getUTCDate()));
    } else throw new RangeError("Choose days, weeks, months or years.");
    return dateString(date);
}

function calendarIndexAfter(plan: TaskPlan, cutoffOn: string): number {
    const anchorOn = plan.firstDueOn!;
    if (cutoffOn < anchorOn) return 0;
    if (plan.unit === "days" || plan.unit === "weeks") {
        const stepDays = plan.interval * (plan.unit === "weeks" ? 7 : 1);
        return Math.floor((requireDate(cutoffOn).getTime() - requireDate(anchorOn).getTime()) / dayMilliseconds / stepDays) + 1;
    }
    const [anchorYear, anchorMonth] = anchorOn.split("-").map(Number), [cutoffYear, cutoffMonth] = cutoffOn.split("-").map(Number);
    const stepMonths = plan.interval * (plan.unit === "years" ? 12 : 1);
    let index = Math.max(0, Math.floor(((cutoffYear - anchorYear) * 12 + cutoffMonth - anchorMonth) / stepMonths));
    if (addTaskInterval(anchorOn, index * plan.interval, plan.unit) <= cutoffOn) index++;
    return index;
}

/** Calculate future planning only. A stored open cycle remains the caller's unchanged evidence. */
export function taskCycleCandidate(plan: TaskPlan, lastDueOn: string | null = null, completedOn: string | null = null): TaskCycleCandidate {
    if (lastDueOn) requireDate(lastDueOn);
    if (completedOn) requireDate(completedOn);
    const cutoffOn = [lastDueOn, completedOn].filter((value): value is string => value !== null).sort().at(-1) ?? null;
    if (plan.recurrenceBasis === "dates") {
        const dates = [...new Set(plan.scheduledDates)].sort();
        dates.forEach(requireDate);
        const nextDueOn = dates.find(date => !cutoffOn || date > cutoffOn) ?? null;
        const skippedPeriods = completedOn ? dates.filter(date => (!lastDueOn || date > lastDueOn) && date <= completedOn).length : 0;
        return { nextDueOn, skippedPeriods, calculationRule: cutoffOn ? completedOn ? "explicit_dates_after_completion" : "explicit_dates_after_previous_due" : "initial_explicit_date" };
    }
    if (!plan.firstDueOn) return { nextDueOn: null, skippedPeriods: 0, calculationRule: "schedule_unconfigured" };
    if (plan.recurrenceBasis === "completion") {
        if (completedOn) return { nextDueOn: addTaskInterval(completedOn, plan.interval, plan.unit), skippedPeriods: 0, calculationRule: "completion_date_plus_interval" };
        return { nextDueOn: lastDueOn ? null : plan.firstDueOn, skippedPeriods: 0, calculationRule: lastDueOn ? "awaiting_actual_completion" : "initial_due_date" };
    }
    if (!cutoffOn) return { nextDueOn: plan.firstDueOn, skippedPeriods: 0, calculationRule: "initial_due_date" };
    const nextIndex = calendarIndexAfter(plan, cutoffOn), previousNextIndex = lastDueOn ? calendarIndexAfter(plan, lastDueOn) : 0;
    return {
        nextDueOn: addTaskInterval(plan.firstDueOn, nextIndex * plan.interval, plan.unit),
        skippedPeriods: completedOn ? Math.max(0, nextIndex - previousNextIndex) : 0,
        calculationRule: completedOn ? "calendar_anchor_after_completion" : "calendar_anchor_after_previous_due",
    };
}

export function nextCycleDueOn(plan: TaskPlan, lastDueOn: string | null = null, completedOn: string | null = null): string | null {
    return taskCycleCandidate(plan, lastDueOn, completedOn).nextDueOn;
}

const sydneyFormatter = new Intl.DateTimeFormat("en-AU", { timeZone: taskTimeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
function sydneyWallTime(date: Date): string {
    const parts = sydneyFormatter.formatToParts(date), part = (type: string) => parts.find(value => value.type === type)!.value;
    return `${part("year").padStart(4, "0")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}:${part("second")}`;
}

/** Resolve a chosen Sydney wall time only when it identifies exactly one instant. */
export function taskReminderAt(dueOn: string | null, daysBefore: number, reminderTime: string | null): TaskReminder {
    if (!Number.isInteger(daysBefore) || daysBefore < 0 || daysBefore > 365) throw new RangeError("Reminder advance must be between 0 and 365 calendar days.");
    if (reminderTime !== null && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(reminderTime)) throw new RangeError("Choose a valid reminder time in HH:mm format.");
    let nextReminderOn: string | null = null;
    if (dueOn) { const date = requireDate(dueOn); date.setUTCDate(date.getUTCDate() - daysBefore); nextReminderOn = dateString(date); }
    const result: TaskReminder = { nextReminderOn, reminderTime, timeZone: taskTimeZone, reminderStatus: "unconfigured", reminderAtUtc: null };
    if (!nextReminderOn || !reminderTime) return result;
    const requested = `${nextReminderOn}T${reminderTime}:00`, nominalUtc = Date.parse(`${requested}Z`), offsets = new Set<number>();
    // Inspect the offsets surrounding the local date rather than assuming a fixed daylight-saving offset.
    for (let hours = -48; hours <= 48; hours += 6) {
        const sample = new Date(nominalUtc + hours * 3_600_000);
        offsets.add(Date.parse(`${sydneyWallTime(sample)}Z`) - sample.getTime());
    }
    const matches = [...offsets].map(offset => new Date(nominalUtc - offset)).filter(date => sydneyWallTime(date) === requested);
    if (matches.length === 1) return { ...result, reminderStatus: "scheduled", reminderAtUtc: matches[0].toISOString() };
    return { ...result, reminderStatus: matches.length > 1 ? "ambiguous" : "nonexistent" };
}

export function taskSchedulePreview(plan: TaskPlan, context: { lastDueOn?: string | null; completedOn?: string | null } = {}) {
    const candidate = taskCycleCandidate(plan, context.lastDueOn ?? null, context.completedOn ?? null);
    return { ...candidate, ...taskReminderAt(candidate.nextDueOn, plan.reminderDaysBefore, plan.reminderTime) };
}

const templatePlan = (input: Partial<TaskPlan> & Pick<TaskPlan, "category" | "title" | "description" | "basis">): TaskPlan => taskPlanSchema.parse({
    targetKind: "storage_area", targetRef: null, batteryIds: [], assigneeIds: [], firstDueOn: null,
    recurrenceBasis: "calendar", interval: 1, unit: "weeks", scheduledDates: [], reminderDaysBefore: 0,
    reminderTime: null, channels: ["messages", "email"], state: "draft", applicabilityConfirmed: false, ...input,
});

export const taskTemplates: { id: string; label: string; description: string; basis: string; plan: TaskPlan }[] = [
    {
        id: "weekly-storage-review", label: "Weekly storage-area review",
        description: "Review a defined storage area and record findings, decisions and follow-up actions.",
        basis: "Provisional weekly interval from the design discussion. Confirm applicable site guidance and responsibility before activation.",
        plan: templatePlan({ category: "storage_review", title: "Storage-area review", description: "Review the selected storage area against its applicable local requirements. Record the review outcome and any follow-up actions.", basis: "Provisional weekly interval from the design discussion. Confirm applicable site guidance and responsibility before activation.", interval: 1, unit: "weeks" }),
    },
    {
        id: "teaching-period-reconciliation", label: "Teaching-period inventory reconciliation",
        description: "Reconcile the confirmed inventory at dates selected for actual teaching periods.",
        basis: "Teaching-period dates and inventory coverage require local confirmation. No dates are inferred from a university calendar.",
        plan: templatePlan({ category: "inventory_reconciliation", title: "Teaching-period inventory reconciliation", description: "Compare recorded inventory and responsibility with the agreed physical review. Record discrepancies and the reconciliation outcome.", basis: "Teaching-period dates and inventory coverage require local confirmation. No dates are inferred from a university calendar.", targetKind: "inventory", recurrenceBasis: "dates", scheduledDates: [], interval: 1, unit: "months" }),
    },
    {
        id: "six-month-storage-maintenance", label: "Six-month storage maintenance review",
        description: "Review a confirmed storage-maintenance requirement for applicable models, groups or batteries.",
        basis: "Provisional six-calendar-month interval from the design discussion. Confirm the manufacturer's model-specific instructions and local procedure; this is not a universal charging instruction.",
        plan: templatePlan({ category: "storage_maintenance", title: "Storage maintenance review", description: "Review only the selected assets covered by a confirmed storage-maintenance procedure. Record the requirement, completed review and any action specified by that procedure.", basis: "Provisional six-calendar-month interval from the design discussion. Confirm the manufacturer's model-specific instructions and local procedure; this is not a universal charging instruction.", targetKind: "model", interval: 6, unit: "months" }),
    },
];
