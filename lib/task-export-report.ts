import type { StaffUser } from "./accounts";
import type { Dataset } from "./domain";
import type { ExportDocument } from "./exports";
import type { HumanReport } from "./export-report";
import { reportDate, reportTimestamp } from "./export-report";
import type { TaskPlanStore, TaskPlanRecord, TaskCycleRecord, InboxMessage } from "./task-plans";
import type { TaskPlan } from "./task-schedule";

type Directory = Awaited<ReturnType<TaskPlanStore["list"]>>["staffDirectory"];
type TaskRecords = Awaited<ReturnType<TaskPlanStore["list"]>> & { metadata: Record<string, unknown> };
type MessageRecords = Awaited<ReturnType<TaskPlanStore["messages"]>> & { metadata: Record<string, unknown> };
type StorageArea = { id: string; name: string; number: string | null; buildingId: string; buildingName: string; isPlaceholder: boolean };
type ReportContext = { dataset: Dataset; operator: Pick<StaffUser, "id" | "displayName" | "username">; staffDirectory: Directory; storageAreas?: StorageArea[] };
const categoryLabels: Record<TaskPlan["category"], string> = { custom: "Custom task", storage_review: "Storage area review", inventory_reconciliation: "Inventory reconciliation", storage_maintenance: "Storage maintenance review" };
const titleCase = (value: string) => value ? value[0].toUpperCase() + value.slice(1) : "Not recorded";
const text = (value: unknown) => value == null || value === "" ? "Not recorded" : String(value);
function personName(id: string | null, people: Directory) {
    if (!id) return "Not recorded";
    const person = people.find(candidate => candidate.id === id);
    return person ? `${person.displayName} (@${person.username})${person.active ? "" : " · inactive"}` : "Account name unavailable; see evidence";
}
function assignmentNames(ids: string[], people: Directory) { return ids.length ? ids.map(id => personName(id, people)).join("; ") : "Not assigned"; }
function schedule(plan: TaskPlan) {
    if (plan.recurrenceBasis === "dates") return plan.scheduledDates.length ? `${plan.scheduledDates.length === 1 ? "One-off" : "Specific dates"}: ${plan.scheduledDates.join(", ")}` : "Due dates not chosen";
    return `Every ${plan.interval} ${plan.unit}${plan.recurrenceBasis === "completion" ? " after actual completion" : " from the calendar anchor"}`;
}
function target(plan: TaskPlan, snapshot?: Record<string, unknown>, currentAreas?: StorageArea[]) {
    if (plan.targetKind === "inventory") return plan.scopeNote || "Inventory scope not described";
    if (plan.targetKind === "batteries") return plan.batteryIds.length ? plan.batteryIds.join(", ") : "Batteries not selected";
    if (plan.targetKind === "group") return `${plan.targetRef || "Group not named"}${plan.batteryIds.length ? `: ${plan.batteryIds.join(", ")}` : " · no batteries selected"}`;
    if (plan.targetKind === "model") return plan.targetRef ? `Model: ${plan.targetRef}` : "Model not selected";
    const room = snapshot?.room as Partial<StorageArea> | undefined ?? currentAreas?.find(area => area.id === plan.targetRef);
    return room ? `${[room.buildingId, room.buildingName, room.number, room.name].filter(Boolean).join(" · ")}${room.isPlaceholder ? " · Placeholder (not verified storage)" : ""}` : plan.targetRef ? `Storage-area ID: ${plan.targetRef} (name unavailable)` : "Storage area not selected";
}
function planRow(plan: TaskPlanRecord, people: Directory, storageAreas?: StorageArea[]) {
    return {
        "Task title": plan.title, "Task type": categoryLabels[plan.category], "Plan status": titleCase(plan.state), "Location in app": plan.removedAt ? "Removed" : "Current plans",
        "What must be done": text(plan.description), "Applicable instruction or local basis": text(plan.basis), "Targets and scope (current labels)": target(plan, undefined, storageAreas),
        "Assigned staff": assignmentNames(plan.assigneeIds, people), "Schedule": schedule(plan), "First due date": reportDate(plan.firstDueOn),
        "Next due date": reportDate(plan.preview.nextDueOn), "Next reminder date": reportDate(plan.preview.nextReminderOn), "Reminder time (Sydney)": text(plan.reminderTime),
        "Days before due": plan.reminderDaysBefore, "Applicability confirmed": plan.applicabilityConfirmed ? "Yes" : "No",
        "Created by": personName(plan.createdBy, people), "Created at (Sydney)": reportTimestamp(plan.createdAt), "Last changed by": personName(plan.updatedBy, people),
        "Last changed at (Sydney)": reportTimestamp(plan.updatedAt), "Removed at (Sydney)": reportTimestamp(plan.removedAt),
    };
}
function cycleRow(cycle: TaskCycleRecord, people: Directory) {
    return {
        "Recorded task title": cycle.title, "Recorded task type": categoryLabels[cycle.category], "Task completion": titleCase(cycle.status), "Due date": reportDate(cycle.dueOn),
        "Recorded instructions": text(cycle.description), "Recorded basis": text(cycle.basis), "Recorded targets": target(cycle, cycle.targetSnapshot),
        "Original assignees (current names)": assignmentNames(cycle.assigneeIds, people), "Currently assigned staff": assignmentNames(cycle.currentAssigneeIds, people),
        "Reminder date": reportDate(cycle.reminderOn), "Reminder time (Sydney)": text(cycle.reminderTime),
        "Completed at (Sydney)": reportTimestamp(cycle.completedAt), "Completed by (recorded name)": text(cycle.completedByName), "Completion notes": text(cycle.completionNotes),
        "Cycle created at (Sydney)": reportTimestamp(cycle.createdAt), "Current plan removed": cycle.planRemoved ? "Yes" : "No", "Plan removed at (Sydney)": reportTimestamp(cycle.planRemovedAt),
    };
}
const glossary = [
    { term: "Plan and cycle", meaning: "A plan is the current configuration. A cycle is one recorded occurrence with its own deadline and completion. Changing a plan does not rewrite a cycle's recorded instructions or deadline." },
    { term: "Read status and completion", meaning: "Reading or removing a message does not complete its task. Task completion requires a separate confirmed action." },
    { term: "Dates and times", meaning: "Dates are due dates without a time. Columns marked Sydney show Australia/Sydney local time, including daylight saving. Exact UTC timestamps are retained in the evidence appendix." },
    { term: "Staff names", meaning: "Assignment names use the current staff directory; account identifiers remain in the evidence appendix. Completed by uses the name recorded at completion." },
    { term: "Not recorded", meaning: "No value is recorded. This does not mean zero, a passed check, or a completed task." },
    { term: "Reminder delivery", meaning: "Messages are generated while the system is in use. Unattended scheduling and email delivery are unavailable; email settings record preferences only." },
    { term: "Safety evidence", meaning: "A task completion is a staff-entered record. It is not an automatic safety certification or proof of an unrecorded physical test." },
];
function base(source: { metadata: Record<string, unknown>; capabilities: Record<string, unknown>; generationIssues: unknown[] }, context: ReportContext) {
    const document: ExportDocument = { metadata: { ...source.metadata, dataset: context.dataset, exported_at_utc: source.metadata.generatedAt, operator: context.operator.displayName }, tables: { Capabilities: [source.capabilities], GenerationIssues: source.generationIssues as Record<string, unknown>[] } };
    const exportedAt = reportTimestamp(source.metadata.generatedAt);
    const facts = [
        { label: "Inventory", value: context.dataset === "demo" ? "Demonstration inventory" : "Working inventory" },
        { label: "Prepared for", value: `${context.operator.displayName} (@${context.operator.username})` },
        { label: "Report created (Sydney)", value: exportedAt instanceof Date ? new Intl.DateTimeFormat("en-AU", { timeZone: "UTC", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(exportedAt) : exportedAt },
        { label: "Scheduling issues requiring review", value: source.generationIssues.length },
    ];
    return { document, facts };
}
export function createTaskReportDocument(source: TaskRecords, context: ReportContext): { document: ExportDocument; report: HumanReport } {
    const { document, facts } = base(source, context);
    document.tables = { Plans: source.plans, Cycles: source.cycles, StaffDirectory: source.staffDirectory, ...document.tables };
    return { document, report: {
        title: "Task report", description: "Current plan settings and complete recorded cycles for the chosen task filters.",
        facts: [...facts, { label: "Scope", value: `Shared task records · ${text(source.metadata.visibility)} plans` }, { label: "Search", value: source.metadata.search ? String(source.metadata.search) : "No search filter" }, { label: "Plans included", value: source.plans.length }, { label: "Recorded cycles included", value: source.cycles.length }],
        sheets: [
            { name: "Task plans", description: "Current configuration and current location labels for each matching plan. These can differ from the instructions and labels captured for an earlier cycle.", rows: source.plans.map(plan => planRow(plan, context.staffDirectory, context.storageAreas)), columns: ["Task title", "Task type", "Plan status", "Location in app"] },
            { name: "Task history", description: "All recorded cycles for these plans, including completed and open occurrences. Missing completions are not inferred.", rows: source.cycles.map(cycle => cycleRow(cycle, context.staffDirectory)), columns: ["Recorded task title", "Recorded task type", "Task completion", "Due date"] },
            { name: "Scheduling issues", description: "Problems reported while generating task cycles or reminders. A missing cycle does not establish that a check was completed or unnecessary.", rows: source.generationIssues.map(issue => ({ "Task title": source.plans.find(plan => plan.id === issue.planId)?.title ?? "Task title unavailable; see evidence", "Issue requiring review": issue.message })), columns: ["Task title", "Issue requiring review"] },
        ], glossary,
    } };
}
export function createMessageReportDocument(source: MessageRecords, context: ReportContext): { document: ExportDocument; report: HumanReport } {
    const { document, facts } = base(source, context), cycles = [...new Map(source.messages.map(message => [message.cycleId, message.cycle])).values()];
    document.tables = { Messages: source.messages, Cycles: cycles, ...document.tables };
    const filters = source.metadata.filters as Record<string, unknown>;
    const messageRow = (message: InboxMessage) => ({
        "Message title": message.title, "Recipient": `${context.operator.displayName} (@${context.operator.username})`, "Message text": message.body,
        "Inbox location": message.removedAt ? "Removed" : "Inbox", "Read status": message.readAt ? "Read" : "Unread", "Task completion": titleCase(message.taskStatus),
        "Task title": message.cycle.title, "Due date": reportDate(message.dueOn), "Created at (Sydney)": reportTimestamp(message.createdAt), "Read at (Sydney)": reportTimestamp(message.readAt),
        "Removed at (Sydney)": reportTimestamp(message.removedAt), "Task completed at (Sydney)": reportTimestamp(message.cycle.completedAt), "Completed by (recorded name)": text(message.cycle.completedByName),
    });
    return { document, report: {
        title: "Personal Messages report", description: "Only the signed-in account's messages matching the chosen filters, across all pages.",
        facts: [...facts, { label: "Scope", value: "Your own messages only" }, { label: "Inbox location", value: text(filters.visibility) }, { label: "Read status filter", value: text(filters.readState) }, { label: "Task completion filter", value: text(filters.taskStatus) }, { label: "Search", value: filters.search ? String(filters.search) : "No search filter" }, { label: "Messages included", value: source.messages.length }, { label: "Unread in your current inbox (all filters)", value: source.unreadCount }],
        sheets: [
            { name: "Messages", description: "Your filtered inbox records. Read status and task completion are independent; Removed messages remain recoverable in the app.", rows: source.messages.map(messageRow), columns: ["Message title", "Recipient", "Message text", "Inbox location", "Read status", "Task completion"] },
            { name: "Related task history", description: "The recorded task occurrence linked to each included message, shown once per cycle. Other recipients' messages are not included.", rows: cycles.map(cycle => cycleRow(cycle, context.staffDirectory)), columns: ["Recorded task title", "Recorded task type", "Task completion", "Due date"] },
            { name: "Scheduling issues", description: "Shared scheduling issues reported by the service when this inbox was read. These are separate from your message filters; missing messages do not prove that tasks are complete.", rows: source.generationIssues.map(issue => ({ "Task title": cycles.find(cycle => cycle.planId === issue.planId)?.title ?? "Task title unavailable in these messages; see evidence", "Issue requiring review": issue.message })), columns: ["Task title", "Issue requiring review"] },
        ], glossary,
    } };
}
