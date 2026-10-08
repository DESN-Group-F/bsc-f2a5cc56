"use client";
import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useRef, useState } from "react";
import { CalendarDays, Download, Pencil, Plus, RefreshCw, Trash2, Undo2, } from "lucide-react";
import { Button } from "../ui/button.js";
import { Input } from "../ui/input.js";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, } from "../ui/dialog.js";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell, } from "../ui/table.js";
import { Tabs, TabsList, TabsTrigger } from "../ui/tabs.js";
import { Skeleton } from "../ui/skeleton.js";
import { getRolePermissions } from "../../lib/permissions.js";
import { createCustomTaskPlan, taskPlanMatchesQuery, taskTemplates, } from "../../lib/task-schedule.js";
import { formatDateOnly, formatTime, } from "../../lib/client-utils.js";
import { recoverTaskCreate, taskCreateStorageKey, } from "../../lib/task-create-session.js";
import { taskRequest } from "../../lib/client/task-api.js";
import { readTaskRecordAction, saveTaskRecordAction, clearTaskRecordAction, verifyTaskRecordActionReceipt, taskRecordActionFinallyRejected, } from "../../lib/client/task-record-action.js";
import { useTaskEndpoint } from "../../hooks/use-task-endpoint.js";
import { TaskPlanEditor } from "./tasks/task-plan-editor.js";
import { TaskPlanRemovalDialog } from "./tasks/task-plan-removal-dialog.js";
import { TaskCycleDialog } from "./tasks/task-cycle-dialog.js";
import { TaskPlanDetails } from "./tasks/task-plan-details.js";
import { TaskDownloadDialog } from "./tasks/task-download-dialog.js";
import { TaskDeliveryNotice, TaskGenerationWarnings, } from "./tasks/task-notices.js";
import { assignmentNames, taskCategoryLabels, targetSummary, cycleState, reminderLimitation, } from "./tasks/task-presentation.js";
export function TaskPlansPanel({ data, onChanged, onDetail }) {
    const [actionRecovery, setActionRecovery] = useState(() => readTaskRecordAction("plans", data.user.id, data.dataset));
    const [recoveringAction, setRecoveringAction] = useState(false);
    const mounted = useRef(true);
    useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
        };
    }, []);
    const actionBlocked = !!actionRecovery.input || !!actionRecovery.error || recoveringAction;
    const [visibility, setVisibility] = useState("current");
    const [removalPlan, setRemovalPlan] = useState(null);
    const [selectedPlan, setSelectedPlan] = useState(null);
    const [choosingTemplate, setChoosingTemplate] = useState(false);
    const [createRecovery] = useState(() => {
        try {
            const raw = window.__batteryWorkflowStorage.getItem(taskCreateStorageKey(data.user.id, data.dataset));
            const attempt = recoverTaskCreate(raw, data.user.id, data.dataset);
            return {
                attempt,
                error: raw && !attempt
                    ? "A saved task creation request could not be recovered. New task creation is blocked. Preserve this tab and ask the administrator to investigate the saved request."
                    : "",
            };
        }
        catch {
            return {
                attempt: null,
                error: "Browser storage is unavailable. New task creation is blocked until the submitted request can be preserved in this tab.",
            };
        }
    });
    const [draft, setDraft] = useState(createRecovery.attempt?.input.payload ?? null), [selectedCycle, setSelectedCycle] = useState(null);
    const [query, setQuery] = useState(""), [notice, setNotice] = useState(""), [downloadBusy, setDownloadBusy] = useState(false);
    const [downloadRequest, setDownloadRequest] = useState(null);
    const resource = useTaskEndpoint(`/api/task-plans?dataset=${data.dataset}&visibility=${visibility}`, data.user.id, data.events.map((event) => event.id).join("|"), choosingTemplate || !!draft || !!selectedCycle || !!selectedPlan || !!removalPlan || !!downloadRequest || actionBlocked);
    const { manageTaskPlans } = getRolePermissions(data.user.role);
    const createBlocked = !manageTaskPlans || resource.loading || !!createRecovery.error || !!draft || actionBlocked;
    const plans = resource.payload?.plans ?? [], cycles = resource.payload?.cycles ?? [];
    const matching = plans.filter((plan) => taskPlanMatchesQuery(plan, query));
    const matchingPlanIds = new Set(matching.map((plan) => plan.id)), matchingCycles = cycles.filter((cycle) => matchingPlanIds.has(cycle.planId));
    async function changed() {
        if (!mounted.current)
            return;
        resource.refresh();
        try {
            await onChanged?.();
        }
        catch {
            setNotice("The task change was saved. Refresh the inventory if its shared status has not updated.");
        }
    }
    async function retrySavedPlanAction() {
        const input = actionRecovery.input;
        if (!input ||
            recoveringAction ||
            actionRecovery.error ||
            input.dataset !== data.dataset)
            return;
        setRecoveringAction(true);
        setNotice("");
        try {
            saveTaskRecordAction("plans", data.user.id, input);
            const response = await taskRequest("/api/task-plans", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(input),
            });
            verifyTaskRecordActionReceipt(response.result, input, data.user.id);
            clearTaskRecordAction("plans", data.user.id, input);
            setActionRecovery({ input: null, error: "" });
            setNotice(input.action === "remove"
                ? "The original plan removal was confirmed."
                : "The original plan restoration was confirmed.");
            await changed();
        }
        catch (error) {
            setNotice(error.message);
            if (taskRecordActionFinallyRejected(error)) {
                try {
                    clearTaskRecordAction("plans", data.user.id, input);
                    setActionRecovery({ input: null, error: "" });
                    if (mounted.current)
                        resource.refresh();
                }
                catch (storageFailure) {
                    setActionRecovery({
                        input,
                        error: storageFailure.message,
                    });
                }
            }
        }
        finally {
            setRecoveringAction(false);
        }
    }
    function create(template) {
        if (createBlocked)
            return;
        setChoosingTemplate(false);
        setDraft({
            ...template.plan,
            batteryIds: [...template.plan.batteryIds],
            assigneeIds: template.plan.category === "storage_maintenance" ? [] : [data.user.id],
            channels: [...template.plan.channels],
            scheduledDates: [...template.plan.scheduledDates],
        });
    }
    function createCustom() {
        if (createBlocked)
            return;
        setChoosingTemplate(false);
        setDraft({ ...createCustomTaskPlan(), assigneeIds: [data.user.id] });
    }
    function download() {
        setDownloadRequest({
            url: `/api/task-plans?${new URLSearchParams({ dataset: data.dataset, visibility, search: query })}`,
            filename: `periodic-task-report-${data.dataset}`,
            title: "Download task report",
            scope: "Includes every matching plan and all of its recorded cycles, across all pages.",
        });
    }
    return (_jsxs(_Fragment, { children: [_jsx(TaskDeliveryNotice, {}), _jsx(TaskGenerationWarnings, { issues: resource.payload?.generationIssues ?? [] }), actionRecovery.error && (_jsxs("div", { className: "load-error", role: "alert", children: [_jsx("span", { children: actionRecovery.error }), _jsx(Button, { variant: "outline", disabled: recoveringAction, onClick: () => setActionRecovery(readTaskRecordAction("plans", data.user.id, data.dataset)), children: "Retry saved request recovery" })] })), actionRecovery.input && (_jsxs("div", { className: "load-error", role: "alert", children: [_jsxs("span", { children: ["A saved plan", " ", actionRecovery.input.action === "remove"
                                ? "removal"
                                : "restoration", " ", "has not been confirmed. Resolve the original request for this account and inventory before changing another plan."] }), _jsx(Button, { variant: "outline", onClick: retrySavedPlanAction, disabled: recoveringAction || !!actionRecovery.error, children: recoveringAction
                            ? "Confirming…"
                            : `Retry original plan ${actionRecovery.input.action === "remove" ? "removal" : "restoration"}` })] })), createRecovery.error && (_jsx("p", { className: "form-error", role: "alert", children: createRecovery.error })), _jsxs("section", { className: "inventory-panel", children: [_jsxs("div", { className: "panel-top", children: [_jsxs("div", { children: [_jsx("h2", { children: "Shared periodic plans" }), _jsx("p", { className: "field-hint", children: manageTaskPlans
                                            ? "Manage plans and assignments, or record completion for any eligible task."
                                            : "View all plans and recorded cycles. Complete tasks assigned to you; an administrator manages plans and assignments." }), _jsx(Tabs, { value: visibility, onValueChange: (value) => setVisibility(value), children: _jsxs(TabsList, { "aria-label": "Plan location", children: [_jsx(TabsTrigger, { value: "current", disabled: downloadBusy, children: "Current" }), _jsx(TabsTrigger, { value: "removed", disabled: downloadBusy, children: "Removed" })] }) })] }), _jsxs("div", { className: "panel-actions", children: [manageTaskPlans && (_jsxs(Button, { onClick: () => !createBlocked && setChoosingTemplate(true), disabled: createBlocked, children: [_jsx(Plus, { size: 16 }), "Create task"] })), _jsxs(Button, { variant: "outline", onClick: resource.refresh, disabled: resource.loading, children: [_jsx(RefreshCw, { size: 16 }), "Refresh tasks"] }), _jsxs(Button, { variant: "outline", onClick: download, disabled: resource.loading ||
                                            !!resource.error ||
                                            !matching.length ||
                                            downloadBusy, children: [_jsx(Download, { size: 16 }), downloadBusy ? "Preparing…" : "Download filtered task records"] })] })] }), _jsxs("div", { className: "table-toolbar", children: [_jsx(Input, { "aria-label": "Search periodic tasks", placeholder: "Search task, category, target or status\u2026", value: query, onChange: (event) => setQuery(event.target.value), maxLength: 200, disabled: downloadBusy }), _jsx(Button, { type: "button", variant: "outline", size: "sm", onClick: () => setQuery(""), disabled: !query || resource.loading || downloadBusy, children: "Clear filters" }), _jsx("span", { children: resource.loading
                                    ? "Loading complete records…"
                                    : resource.error
                                        ? "Task records unavailable"
                                        : `${matching.length} matching ${matching.length === 1 ? "plan" : "plans"}` })] }), notice && (_jsx("p", { className: "form-message px-5", role: "status", children: notice })), resource.error && (_jsxs("div", { className: "load-error", role: "alert", children: [_jsx("span", { children: resource.error }), _jsx(Button, { variant: "outline", onClick: resource.refresh, children: "Retry tasks" })] })), resource.loading ? (_jsxs("div", { className: "loading-panel", role: "status", children: [_jsx("p", { children: "Loading shared plans and recorded cycles\u2026" }), _jsx(Skeleton, { className: "h-24 w-full" })] })) : (!resource.error && (_jsxs(_Fragment, { children: [_jsxs(Table, { children: [_jsx(TableHeader, { children: _jsxs(TableRow, { children: [_jsx(TableHead, { children: "TASK / TARGET" }), _jsx(TableHead, { children: "STATUS" }), _jsx(TableHead, { children: "CURRENT DUE / REMINDER" }), _jsx(TableHead, { children: "ASSIGNMENT" })] }) }), _jsx(TableBody, { children: matching.map((plan) => {
                                            const open = cycles.find((cycle) => cycle.planId === plan.id && cycle.status === "open");
                                            const reminderOn = open
                                                ? open.reminderOn
                                                : plan.preview.nextReminderOn, reminderTime = open
                                                ? open.reminderTime
                                                : plan.preview.reminderTime;
                                            return (_jsxs(TableRow, { children: [_jsxs(TableCell, { children: [_jsx("strong", { children: plan.title }), _jsxs("span", { className: "cell-secondary", children: [taskCategoryLabels[plan.category], " \u00B7", " ", targetSummary(plan, data)] }), _jsxs("div", { className: "flex flex-wrap gap-2", children: [_jsx(Button, { variant: "outline", size: "sm", onClick: () => setSelectedPlan(plan), "aria-label": `View plan: ${plan.title}`, children: "View plan" }), open && (_jsx(Button, { variant: "outline", size: "sm", onClick: () => setSelectedCycle(open), children: open.planRemoved
                                                                            ? "View task"
                                                                            : open.canComplete
                                                                                ? "Complete task"
                                                                                : "View task" })), manageTaskPlans && !plan.removedAt && (_jsxs(Button, { variant: "outline", size: "sm", onClick: () => setDraft(plan), disabled: actionBlocked, "aria-label": `Edit plan: ${plan.title}`, children: [_jsx(Pencil, { size: 16 }), "Edit plan"] })), manageTaskPlans && (_jsxs(Button, { variant: "outline", size: "sm", onClick: () => setRemovalPlan(plan), disabled: actionBlocked, "aria-label": `${plan.removedAt ? "Restore" : "Remove"} plan: ${plan.title}`, children: [plan.removedAt ? (_jsx(Undo2, { size: 16 })) : (_jsx(Trash2, { size: 16 })), plan.removedAt ? "Restore" : "Remove"] }))] })] }), _jsxs(TableCell, { children: [_jsx("span", { className: `status-badge ${!plan.removedAt && plan.state === "active" ? "in" : "out"}`, children: plan.removedAt
                                                                    ? "Removed"
                                                                    : plan.state === "active"
                                                                        ? "Active"
                                                                        : plan.state === "paused"
                                                                            ? "Paused"
                                                                            : "Draft" }), plan.removedAt && (_jsxs("span", { className: "cell-secondary", children: ["Removed ", formatTime(plan.removedAt), " \u00B7 previous status: ", plan.state] }))] }), _jsxs(TableCell, { children: [plan.removedAt && (_jsx("strong", { className: "cell-secondary", children: "Generation stopped" })), _jsx("strong", { children: open
                                                                    ? formatDateOnly(open.dueOn)
                                                                    : plan.preview.nextDueOn
                                                                        ? formatDateOnly(plan.preview.nextDueOn)
                                                                        : "Not configured" }), _jsxs("span", { className: "cell-secondary", children: ["Reminder: ", formatDateOnly(reminderOn), reminderTime
                                                                        ? ` at ${reminderTime} Sydney`
                                                                        : " · time not selected"] }), reminderLimitation(open?.reminderStatus ?? plan.preview.reminderStatus) && (_jsx("span", { className: "cell-secondary", children: reminderLimitation(open?.reminderStatus ??
                                                                    plan.preview.reminderStatus) })), open && (_jsx("span", { className: "cell-secondary", children: "Recorded open cycle" }))] }), _jsx(TableCell, { children: assignmentNames(plan.assigneeIds, data) })] }, plan.id));
                                        }) })] }), !matching.length && (_jsxs("div", { className: "empty-state", children: [_jsx(CalendarDays, {}), _jsx("h3", { children: plans.length
                                            ? "No matching plans"
                                            : visibility === "removed"
                                                ? "No removed plans"
                                                : "No periodic plans saved" }), _jsx("p", { children: plans.length
                                            ? "Try another search."
                                            : visibility === "removed"
                                                ? "Removed plans remain available here for an administrator to restore."
                                                : manageTaskPlans
                                                    ? "Select Create task to start from scratch or use an optional template, then set its schedule and assignments."
                                                    : "An administrator can create a plan and assign the required staff. Shared plans will appear here." })] }))] }))), _jsx("div", { className: "panel-footer", children: "Plans and cycles are shared business records. Removing a plan stops task generation and blocks its pending tasks until an administrator restores it. Recorded deadlines and completion history are retained." })] }), !resource.loading && !resource.error && matchingCycles.length > 0 && (_jsxs("section", { className: "inventory-panel mt-5", children: [_jsxs("div", { className: "section-heading", children: [_jsx("h2", { children: "Recorded task cycles" }), _jsxs("span", { className: "toolbar-meta", children: [matchingCycles.length, " ", matchingCycles.length === 1 ? "cycle" : "cycles", " \u00B7 Sydney time"] })] }), _jsxs(Table, { children: [_jsx(TableHeader, { children: _jsxs(TableRow, { children: [_jsx(TableHead, { children: "TASK" }), _jsx(TableHead, { children: "DUE DATE" }), _jsx(TableHead, { children: "STATE" }), _jsx(TableHead, { children: "RECORDED COMPLETION" }), _jsx(TableHead, { children: "DETAILS" })] }) }), _jsx(TableBody, { children: matchingCycles.map((cycle) => (_jsxs(TableRow, { children: [_jsxs(TableCell, { children: [_jsx("strong", { children: cycle.title }), _jsx("span", { className: "cell-secondary", children: taskCategoryLabels[cycle.category] })] }), _jsx(TableCell, { children: formatDateOnly(cycle.dueOn) }), _jsx(TableCell, { children: cycle.status === "completed"
                                                ? "Completed"
                                                : cycle.planRemoved
                                                    ? "Plan removed"
                                                    : cycleState(cycle) }), _jsx(TableCell, { children: cycle.completedAt ? (_jsxs(_Fragment, { children: [formatTime(cycle.completedAt), _jsx("span", { className: "cell-secondary", children: cycle.completedByName })] })) : ("Not completed") }), _jsx(TableCell, { children: _jsx(Button, { variant: "outline", size: "sm", onClick: () => setSelectedCycle(cycle), children: cycle.status === "completed"
                                                    ? "View completion"
                                                    : !cycle.planRemoved && cycle.canComplete
                                                        ? "Complete task"
                                                        : "View task" }) })] }, cycle.id))) })] })] })), downloadRequest && _jsx(TaskDownloadDialog, { request: downloadRequest, onClose: () => setDownloadRequest(null), onBusyChange: setDownloadBusy }), manageTaskPlans && choosingTemplate && (_jsx(Dialog, { open: true, onOpenChange: (open) => !open && setChoosingTemplate(false), children: _jsxs(DialogContent, { className: "task-cycle-dialog w-[min(960px,calc(100vw-32px))]! max-w-none!", children: [_jsxs(DialogHeader, { children: [_jsx(DialogTitle, { children: "Create a recurring task" }), _jsx(DialogDescription, { children: "Start from scratch, or save time with an optional template. Set your own instructions, targets, schedule and staff assignments in the editor before saving." })] }), _jsxs("div", { className: "task-cycle-body grid gap-3 md:grid-cols-3", children: [_jsxs("section", { className: "detail-card mb-0! md:col-span-3 flex flex-wrap items-center justify-between gap-4", children: [_jsxs("div", { className: "min-w-0 flex-1", children: [_jsx("h3", { children: "Custom task" }), _jsx("p", { children: "Begin with a blank form. Define the work and choose any supported target, without template restrictions." })] }), _jsxs(Button, { onClick: createCustom, disabled: createBlocked, children: [_jsx(Plus, { size: 16 }), "Start from scratch"] })] }), _jsx("p", { className: "field-hint md:col-span-3", children: "Optional templates \u00B7 All content and scheduling can be edited." }), taskTemplates.map((template) => (_jsxs("section", { className: "detail-card mb-0! flex flex-col", children: [_jsx("h3", { children: template.label }), _jsx("p", { children: template.description }), _jsx("p", { className: "field-hint", children: template.basis }), _jsxs(Button, { variant: "outline", className: "mt-auto", onClick: () => create(template), disabled: createBlocked, "aria-label": `Choose template: ${template.label}`, children: [_jsx(Plus, { size: 16 }), "Use this template"] })] }, template.id)))] }), _jsx(DialogFooter, { children: _jsx(Button, { variant: "outline", onClick: () => setChoosingTemplate(false), children: "Cancel" }) })] }) })), removalPlan && (_jsx(TaskPlanRemovalDialog, { original: removalPlan, data: data, onClose: () => setRemovalPlan(null), onSaved: async () => {
                    setRemovalPlan(null);
                    await changed();
                } })), draft && (_jsx(TaskPlanEditor, { original: draft, data: data, cycles: cycles, onClose: () => setDraft(null), onSaved: async () => {
                    setDraft(null);
                    await changed();
                } }, "id" in draft ? draft.id : `new-${draft.category}`)), selectedCycle && (_jsx(TaskCycleDialog, { cycle: selectedCycle, data: data, onDetail: onDetail, onClose: () => setSelectedCycle(null), onSaved: async () => {
                    setSelectedCycle(null);
                    await changed();
                } })), selectedPlan && (_jsx(TaskPlanDetails, { plan: selectedPlan, data: data, onClose: () => setSelectedPlan(null), onDetail: onDetail }))] }));
}
