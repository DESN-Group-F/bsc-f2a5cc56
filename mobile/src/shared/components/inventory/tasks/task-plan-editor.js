"use client";
import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useRef, useState } from "react";
import { Button } from "../../ui/button.js";
import { Input } from "../../ui/input.js";
import { Textarea } from "../../ui/textarea.js";
import { Label } from "../../ui/label.js";
import { Checkbox } from "../../ui/checkbox.js";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem, } from "../../ui/select.js";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, } from "../../ui/dialog.js";
import { getRolePermissions } from "../../../lib/permissions.js";
import { taskCategories, taskPlanSchema, taskSchedulePreview, taskTargetsByCategory, } from "../../../lib/task-schedule.js";
import { currentSydneyDate } from "../../../lib/battery-age.js";
import { defaultInventoryFilter } from "../../../lib/inventory-query.js";
import { getFilteredBatteries } from "../../../lib/battery-selection-query.js";
import { BatteryFilterControls } from "../battery-filter-controls.js";
import { hasRowTextSelection } from "../../../lib/client/row-selection.js";
import { formatDateOnly, roomLabel, staffIdentityLabel, } from "../../../lib/client-utils.js";
import { isSelectableRoom } from "../../../lib/location-catalog.js";
import { captureTaskCreate, recoverTaskCreate, taskCreateFailureStatus, taskCreateStorageKey, verifyTaskCreateReceipt, } from "../../../lib/task-create-session.js";
import { taskRequest, } from "../../../lib/client/task-api.js";
import { assignmentNames, taskCategoryLabels, targetLabels, } from "./task-presentation.js";
import styles from "./task-plan-editor.module.css";
export function TaskPlanEditor({ original, data, cycles, onClose, onSaved, }) {
    const { manageTaskPlans } = getRolePermissions(data.user.role);
    const existing = "id" in original ? original : null;
    const storageKey = taskCreateStorageKey(data.user.id, data.dataset);
    const [recovery] = useState(() => {
        if (existing)
            return { attempt: null, error: "" };
        try {
            const raw = window.__batteryWorkflowStorage.getItem(storageKey), attempt = recoverTaskCreate(raw, data.user.id, data.dataset);
            return {
                attempt,
                error: raw && !attempt
                    ? "The saved task creation request cannot be recovered. No new request will replace it; preserve this tab and ask the administrator to investigate."
                    : "",
            };
        }
        catch {
            return {
                attempt: null,
                error: "Browser storage is unavailable. No task creation can be sent until its exact request can be preserved.",
            };
        }
    });
    const [draft, setDraft] = useState(() => recovery.attempt?.input.payload ??
        (!existing && original.category === "custom" && original.title === ""
            ? structuredClone(original)
            : taskPlanSchema.parse(original))), [expectedVersion, setExpectedVersion] = useState(existing?.version);
    const [busy, setBusy] = useState(false), [error, setError] = useState(recovery.error || recovery.attempt?.message || ""), [conflict, setConflict] = useState(false), [latest, setLatest] = useState(null);
    const [creation, setCreation] = useState(recovery.attempt);
    const captured = useRef(creation), running = useRef(false);
    const attempt = useRef({ signature: "", requestId: "" });
    const [batteryFilters, setBatteryFilters] = useState(() => ({ ...defaultInventoryFilter(), lifecycle: "all" })), [datesText, setDatesText] = useState((recovery.attempt?.input.payload ?? original).scheduledDates.join("\n"));
    const [reviewedCycles, setReviewedCycles] = useState(cycles), [latestCycles, setLatestCycles] = useState(null);
    const openCycle = existing
        ? reviewedCycles.find((cycle) => cycle.planId === existing.id && cycle.status === "open")
        : undefined;
    const lastCycle = existing
        ? reviewedCycles
            .filter((cycle) => cycle.planId === existing.id)
            .sort((a, b) => b.dueOn.localeCompare(a.dueOn))[0]
        : undefined;
    const validation = taskPlanSchema.safeParse({
        ...draft,
        scheduledDates: datesText.split(/[\s,;]+/).filter(Boolean),
    });
    const previewValidation = taskPlanSchema.safeParse({
        ...draft,
        state: "draft",
        scheduledDates: datesText.split(/[\s,;]+/).filter(Boolean),
    });
    let preview = null, previewError = "";
    if (previewValidation.success) {
        try {
            preview = taskSchedulePreview(previewValidation.data, {
                lastDueOn: lastCycle?.dueOn,
                completedOn: lastCycle?.completedAt
                    ? currentSydneyDate(new Date(lastCycle.completedAt))
                    : null,
            });
        }
        catch (error) {
            previewError = error.message;
        }
    }
    const rooms = data.rooms.filter(isSelectableRoom), models = [
        ...new Set(data.batteries.map((battery) => battery.model).filter(Boolean)),
    ].sort();
    const filteredBatteries = getFilteredBatteries(data, batteryFilters), visibleBatteries = filteredBatteries.batteries;
    const placeholderArea = draft.targetKind === "storage_area" &&
        data.rooms.find((room) => room.id === draft.targetRef)?.isPlaceholder;
    const activeBlockedByPlaceholder = data.dataset === "live" && draft.state === "active" && placeholderArea;
    const locked = busy || !!creation || !!recovery.error || !manageTaskPlans;
    useEffect(() => {
        if (!busy && creation?.status !== "uncertain")
            return;
        const protect = (event) => {
            event.preventDefault();
            event.returnValue = "";
        };
        window.addEventListener("beforeunload", protect);
        return () => window.removeEventListener("beforeunload", protect);
    }, [busy, creation?.status]);
    function persistCreation(next) {
        try {
            if (next) {
                const raw = window.__batteryWorkflowStorage.getItem(storageKey);
                if (raw && !captured.current)
                    throw new Error("An unresolved task creation is already saved in this tab. Reopen Periodic tasks to recover it before creating another plan.");
                window.__batteryWorkflowStorage.setItem(storageKey, JSON.stringify(next));
            }
            else
                window.__batteryWorkflowStorage.removeItem(storageKey);
            captured.current = next;
            setCreation(next);
            return true;
        }
        catch (error) {
            setError(`${error.message} Browser storage must preserve the original task request before another creation can be sent.`);
            return false;
        }
    }
    function close() {
        if (running.current || captured.current || recovery.error)
            return;
        onClose();
    }
    function reviewRejectedCreation() {
        if (running.current ||
            captured.current?.status !== "rejected" ||
            !persistCreation(null))
            return;
        setError("The submitted task creation was rejected. Review its targets and assignments before submitting a new request.");
    }
    async function sendCreation(originalAttempt, alreadyUncertain) {
        if (!manageTaskPlans || running.current || recovery.error)
            return;
        running.current = true;
        setBusy(true);
        setError("");
        const sending = {
            ...originalAttempt,
            status: "uncertain",
            message: "Waiting for the server to confirm this exact task creation.",
        };
        let saved = false;
        try {
            if (!persistCreation(sending))
                return;
            const body = await taskRequest("/api/task-plans", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(sending.input),
            });
            if (body.ok !== true)
                throw new Error("The task creation response could not be verified.");
            verifyTaskCreateReceipt(body.result, sending);
            if (!persistCreation(null))
                return;
            saved = true;
            await onSaved();
        }
        catch (error) {
            if (saved) {
                setError("The task plan was saved. Refresh the task list if its shared status has not updated.");
                return;
            }
            const status = taskCreateFailureStatus(error, alreadyUncertain);
            const failed = {
                ...sending,
                status,
                message: status === "uncertain"
                    ? `Result uncertain. ${error.message} Retry the original request before editing or closing.`
                    : error.message,
            };
            if (!persistCreation(failed)) {
                captured.current = failed;
                setCreation(failed);
            }
            setError(failed.message);
        }
        finally {
            running.current = false;
            setBusy(false);
        }
    }
    function update(patch, reconfirm = true) {
        if (!manageTaskPlans || running.current || captured.current || recovery.error)
            return;
        if (!conflict)
            setError("");
        setDraft((previous) => ({
            ...previous,
            ...patch,
            ...(reconfirm ? { applicabilityConfirmed: false } : {}),
        }));
    }
    function toggleId(key, id, checked) {
        update({
            [key]: checked
                ? [...new Set([...draft[key], id])]
                : draft[key].filter((value) => value !== id),
        });
    }
    function assignOwners() {
        const targets = ["batteries", "group"].includes(draft.targetKind)
            ? data.batteries.filter((battery) => draft.batteryIds.includes(battery.id))
            : draft.targetKind === "model"
                ? data.batteries.filter((battery) => battery.model === draft.targetRef)
                : draft.targetKind === "storage_area"
                    ? data.batteries.filter((battery) => battery.homeRoomId === draft.targetRef)
                    : draft.targetKind === "inventory"
                        ? data.batteries
                        : [];
        update({
            assigneeIds: [
                ...new Set(targets.flatMap((battery) => battery.ownerAccountId &&
                    data.staffDirectory.some((staff) => staff.id === battery.ownerAccountId && staff.active)
                    ? [battery.ownerAccountId]
                    : [])),
            ],
        });
    }
    async function save(event) {
        event.preventDefault();
        if (!manageTaskPlans || running.current || captured.current || recovery.error)
            return;
        setError("");
        if (!validation.success) {
            setError(validation.error.issues.map((issue) => issue.message).join(" "));
            return;
        }
        if (previewError) {
            setError(previewError);
            return;
        }
        if (draft.state === "active" &&
            preview &&
            ["ambiguous", "nonexistent"].includes(preview.reminderStatus)) {
            setError("Choose a reminder time that is valid and unambiguous in Sydney before activation.");
            return;
        }
        if (activeBlockedByPlaceholder) {
            setError("Confirm the actual storage area before activating a working-inventory plan. This room is a placeholder.");
            return;
        }
        if (!existing) {
            try {
                await sendCreation(captureTaskCreate(validation.data, data.user.id, data.dataset, crypto.randomUUID()), false);
            }
            catch (error) {
                setError(error.message);
            }
            return;
        }
        running.current = true;
        setBusy(true);
        try {
            const input = {
                dataset: data.dataset,
                action: existing ? "update" : "create",
                payload: {
                    ...validation.data,
                    ...(existing ? { id: existing.id, expectedVersion } : {}),
                },
            };
            const signature = JSON.stringify(input);
            if (attempt.current.signature !== signature)
                attempt.current = { signature, requestId: crypto.randomUUID() };
            await taskRequest("/api/task-plans", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    ...input,
                    requestId: attempt.current.requestId,
                }),
            });
            await onSaved();
        }
        catch (error) {
            setError(error.message);
            if (error.status === 409)
                setConflict(true);
        }
        finally {
            running.current = false;
            setBusy(false);
        }
    }
    async function loadLatest() {
        if (!existing)
            return;
        setBusy(true);
        try {
            const body = await taskRequest(`/api/task-plans?dataset=${data.dataset}`);
            const plan = body.plans.find((plan) => plan.id === existing.id);
            if (!plan)
                throw new Error("This plan is no longer available. Your draft is preserved.");
            setLatest(plan);
            setLatestCycles(body.cycles);
        }
        catch (error) {
            setError(error.message);
        }
        finally {
            setBusy(false);
        }
    }
    function acceptLatest() {
        if (!latest)
            return;
        setDraft(taskPlanSchema.parse(latest));
        setDatesText(latest.scheduledDates.join("\n"));
        setExpectedVersion(latest.version);
        if (latestCycles)
            setReviewedCycles(latestCycles);
        setLatestCycles(null);
        setLatest(null);
        setConflict(false);
        setError("");
    }
    return (_jsx(Dialog, { open: true, onOpenChange: (open) => !open && close(), children: _jsxs(DialogContent, { className: `record-dialog ${styles.dialog}`, showCloseButton: !busy && !creation && !recovery.error, onEscapeKeyDown: (event) => {
                if (running.current || captured.current || recovery.error)
                    event.preventDefault();
            }, onInteractOutside: (event) => {
                if (running.current || captured.current || recovery.error)
                    event.preventDefault();
            }, children: [_jsxs(DialogHeader, { className: styles.header, children: [_jsx(DialogTitle, { children: existing ? "Edit recurring task" : "Create recurring task" }), _jsxs(DialogDescription, { children: [taskCategoryLabels[draft.category], ". Review the five sections below. Save your work as a draft, or confirm the plan to activate reminders."] })] }), _jsxs("form", { className: styles.form, onSubmit: save, children: [_jsxs("div", { className: styles.body, children: [_jsxs("section", { className: styles.section, "aria-labelledby": "task-instructions-heading", children: [_jsxs("div", { className: styles.sectionHeading, children: [_jsx("span", { "aria-hidden": "true", children: "1" }), _jsx("h3", { id: "task-instructions-heading", children: "Task instructions" })] }), _jsxs("div", { className: "form-field", children: [_jsx(Label, { children: "Task type" }), _jsxs(Select, { value: draft.category, onValueChange: (value) => update({ category: value }), disabled: locked, children: [_jsx(SelectTrigger, { "aria-label": "Task type", children: _jsx(SelectValue, {}) }), _jsx(SelectContent, { children: taskCategories.map((category) => (_jsx(SelectItem, { value: category, children: taskCategoryLabels[category] }, category))) })] }), _jsx("p", { className: "field-hint", children: draft.category === "custom"
                                                        ? "Write your own task and use any supported target. No template wording or operating requirement is imposed."
                                                        : "This task type provides suggested target choices. Choose Custom task to use any supported target; your current instructions and schedule are retained." })] }), _jsxs("div", { className: "form-field", children: [_jsx(Label, { htmlFor: "task-title", children: "Task title" }), _jsx(Input, { id: "task-title", value: draft.title, onChange: (event) => update({ title: event.target.value }), maxLength: 160, required: true, disabled: locked })] }), _jsxs("div", { className: "form-field", children: [_jsx(Label, { htmlFor: "task-description", children: "What must be done" }), _jsx(Textarea, { id: "task-description", value: draft.description, onChange: (event) => update({ description: event.target.value }), maxLength: 4000, disabled: locked })] }), _jsxs("div", { className: "form-field", children: [_jsx(Label, { htmlFor: "task-basis", children: "Applicable instruction or management basis" }), _jsx(Textarea, { id: "task-basis", value: draft.basis, onChange: (event) => update({ basis: event.target.value }), maxLength: 2000, disabled: locked })] }), _jsx("p", { className: "field-hint", children: draft.category === "custom"
                                                ? "Record the local procedure, teaching need or other reason for this task. Confirm the scope and timing before activation."
                                                : "Template instructions and timing are starting points. Edit them to match the applicable requirement before activating this plan." })] }), _jsxs("section", { className: styles.section, "aria-labelledby": "task-targets-heading", children: [_jsxs("div", { className: styles.sectionHeading, children: [_jsx("span", { "aria-hidden": "true", children: "2" }), _jsx("h3", { id: "task-targets-heading", children: "Targets and scope" })] }), _jsxs("div", { className: "form-field", children: [_jsx(Label, { children: "Applies to" }), !taskTargetsByCategory[draft.category].includes(draft.targetKind) && (_jsx("p", { className: "form-error", children: "Your previous target is retained. Choose a target for this task type, or choose Custom task to keep all target options available." })), _jsxs(Select, { value: draft.targetKind, onValueChange: (value) => update({
                                                        targetKind: value,
                                                        targetRef: null,
                                                        batteryIds: [],
                                                    }), disabled: locked, children: [_jsx(SelectTrigger, { "aria-label": "Periodic task target", children: _jsx(SelectValue, {}) }), _jsx(SelectContent, { children: taskTargetsByCategory[draft.category].map((id) => (_jsx(SelectItem, { value: id, children: targetLabels[id] }, id))) })] })] }), draft.targetKind === "storage_area" && (_jsxs("div", { className: "form-field", children: [_jsx(Label, { children: "Storage area" }), _jsxs(Select, { value: draft.targetRef ?? "__unset", onValueChange: (value) => update({ targetRef: value === "__unset" ? null : value }), disabled: locked, children: [_jsx(SelectTrigger, { "aria-label": "Periodic task storage area", children: _jsx(SelectValue, {}) }), _jsxs(SelectContent, { children: [_jsx(SelectItem, { value: "__unset", children: "Area not selected" }), rooms.map((room) => (_jsx(SelectItem, { value: room.id, children: roomLabel(room) }, room.id)))] })] }), placeholderArea && (_jsx("p", { className: "field-hint", children: data.dataset === "demo"
                                                        ? "This is a demonstration placeholder, suitable only for a labelled prototype task."
                                                        : "This area is a placeholder. Working-inventory activation requires a confirmed actual storage area." }))] })), draft.targetKind === "model" && (_jsxs("div", { className: "form-field", children: [_jsx(Label, { children: "Registered battery model" }), _jsxs(Select, { value: draft.targetRef ?? "__unset", onValueChange: (value) => update({ targetRef: value === "__unset" ? null : value }), disabled: locked, children: [_jsx(SelectTrigger, { "aria-label": "Periodic task model", children: _jsx(SelectValue, {}) }), _jsxs(SelectContent, { children: [_jsx(SelectItem, { value: "__unset", children: "Model not selected" }), models.map((model) => (_jsx(SelectItem, { value: model, children: model }, model)))] })] }), !models.length && (_jsx("p", { className: "field-hint", children: "No models are recorded yet. Keep this plan as a draft." }))] })), draft.targetKind === "group" && (_jsxs("div", { className: "form-field", children: [_jsx(Label, { htmlFor: "task-group", children: "Defined group name" }), _jsx(Input, { id: "task-group", value: draft.targetRef ?? "", onChange: (event) => update({ targetRef: event.target.value || null }), maxLength: 120, disabled: locked }), _jsx("p", { className: "field-hint", children: "Select the registered batteries belonging to this group below; a name alone does not define membership or applicability." })] })), ["batteries", "group"].includes(draft.targetKind) && (_jsxs("fieldset", { className: "detail-card", children: [_jsxs("legend", { className: "text-sm font-semibold", children: ["Registered batteries \u00B7 ", draft.batteryIds.length, " selected"] }), _jsx(BatteryFilterControls, { data: data, filters: batteryFilters, onChange: (patch) => { if (!locked && !running.current)
                                                        setBatteryFilters(previous => ({ ...previous, ...patch })); }, onClear: () => { if (!locked && !running.current)
                                                        setBatteryFilters({ ...defaultInventoryFilter(), lifecycle: "all" }); }, disabled: locked, defaultLifecycle: "all", scopeNote: "Filter the registered batteries available for this task. Clearing filters keeps your selected batteries and task draft." }), filteredBatteries.error && _jsx("p", { className: "form-error", role: "alert", children: filteredBatteries.error }), _jsxs("p", { className: "field-hint", children: [visibleBatteries.length, " matching batteries \u00B7 ", draft.batteryIds.filter(id => !visibleBatteries.some(battery => battery.id === id)).length, " selected outside these filters"] }), _jsxs("div", { className: "my-2 flex flex-wrap gap-2", children: [_jsx(Button, { type: "button", variant: "outline", size: "sm", onClick: () => update({
                                                                batteryIds: [
                                                                    ...new Set([
                                                                        ...draft.batteryIds,
                                                                        ...visibleBatteries.map((battery) => battery.id),
                                                                    ]),
                                                                ],
                                                            }), disabled: locked ||
                                                                !visibleBatteries.length ||
                                                                new Set([
                                                                    ...draft.batteryIds,
                                                                    ...visibleBatteries.map((battery) => battery.id),
                                                                ]).size > 100, children: "Select filtered batteries" }), _jsx(Button, { type: "button", variant: "ghost", size: "sm", onClick: () => update({ batteryIds: [] }), disabled: locked, children: "Clear battery selection" })] }), _jsxs("div", { className: "max-h-44 overflow-y-auto", children: [visibleBatteries.map((battery) => (_jsxs("label", { className: `export-option ${styles.selectionRow}`, onClick: event => { if (hasRowTextSelection(event))
                                                                event.preventDefault(); }, "data-selected": draft.batteryIds.includes(battery.id), children: [_jsx(Checkbox, { checked: draft.batteryIds.includes(battery.id), onCheckedChange: (value) => toggleId("batteryIds", battery.id, value === true), disabled: locked ||
                                                                        (!draft.batteryIds.includes(battery.id) &&
                                                                            draft.batteryIds.length >= 100) }), _jsxs("span", { children: [_jsxs("strong", { children: [battery.id, " \u00B7 ", battery.name] }), _jsx("small", { children: battery.model || "Model not recorded" })] })] }, battery.id))), !visibleBatteries.length && (_jsx("p", { className: "field-hint", children: "No matching registered batteries." }))] }), _jsx("p", { className: "field-hint", children: "Explicit battery and group selections support up to 100 batteries. A model-based plan can cover the applicable registered model without individually selecting its batteries." })] })), _jsxs("div", { className: "form-field", children: [_jsx(Label, { htmlFor: "task-scope", children: "Scope and applicability" }), _jsx(Textarea, { id: "task-scope", value: draft.scopeNote, onChange: (event) => update({ scopeNote: event.target.value }), maxLength: 2000, disabled: locked, placeholder: "Describe the actual area, inventory or assets covered, and why this requirement applies." })] })] }), _jsxs("section", { className: styles.section, "aria-labelledby": "task-assignees-heading", children: [_jsxs("div", { className: styles.sectionHeading, children: [_jsx("span", { "aria-hidden": "true", children: "3" }), _jsx("h3", { id: "task-assignees-heading", children: "Assigned staff" })] }), _jsxs("p", { className: "field-hint", children: [draft.assigneeIds.length, " selected. Select people below, or use the responsible owners of the selected targets. One completion closes the shared cycle for all assignees."] }), _jsx(Button, { type: "button", variant: "outline", size: "sm", onClick: assignOwners, disabled: locked, children: "Use responsible owners" }), _jsx("div", { className: "max-h-44 overflow-y-auto", children: data.staffDirectory
                                                .filter((staff) => staff.active || draft.assigneeIds.includes(staff.id))
                                                .map((staff) => (_jsxs("label", { className: `export-option ${styles.selectionRow}`, onClick: event => { if (hasRowTextSelection(event))
                                                    event.preventDefault(); }, "data-selected": draft.assigneeIds.includes(staff.id), children: [_jsx(Checkbox, { checked: draft.assigneeIds.includes(staff.id), onCheckedChange: (value) => toggleId("assigneeIds", staff.id, value === true), disabled: locked ||
                                                            (!staff.active && !draft.assigneeIds.includes(staff.id)) }), _jsxs("span", { children: [_jsx("strong", { children: staffIdentityLabel(staff.displayName, staff.username, staff.id) }), _jsx("small", { children: staff.active
                                                                    ? staff.id === data.user.id
                                                                        ? "Your account"
                                                                        : "Active staff account"
                                                                    : "Disabled account; remove or reassign before activation" })] })] }, staff.id))) }), draft.assigneeIds.some((id) => !data.staffDirectory.some((staff) => staff.id === id)) && (_jsx("p", { className: "form-error", children: "An assigned account is unavailable. Use responsible owners or choose reviewed staff assignments to replace it." }))] }), _jsxs("section", { className: styles.section, "aria-labelledby": "task-schedule-heading", children: [_jsxs("div", { className: styles.sectionHeading, children: [_jsx("span", { "aria-hidden": "true", children: "4" }), _jsx("h3", { id: "task-schedule-heading", children: "Schedule and reminders" })] }), _jsxs("fieldset", { className: "detail-card", children: [_jsx("legend", { className: "text-sm font-semibold", children: "Task due rule" }), _jsxs("div", { className: "form-field", children: [_jsx(Label, { children: "Recurrence" }), _jsxs(Select, { value: draft.recurrenceBasis, onValueChange: (value) => update({
                                                                recurrenceBasis: value,
                                                            }), disabled: locked, children: [_jsx(SelectTrigger, { "aria-label": "Task recurrence basis", children: _jsx(SelectValue, {}) }), _jsxs(SelectContent, { children: [_jsx(SelectItem, { value: "calendar", children: "Fixed calendar interval" }), _jsx(SelectItem, { value: "completion", children: "Interval after actual completion" }), _jsx(SelectItem, { value: "dates", children: "Specific dates / one-off task" })] })] })] }), draft.recurrenceBasis === "dates" ? (_jsxs("div", { className: "form-field mt-3", children: [_jsx(Label, { htmlFor: "task-dates", children: "Confirmed due dates" }), _jsx(Textarea, { id: "task-dates", value: datesText, onChange: (event) => {
                                                                if (locked)
                                                                    return;
                                                                setDatesText(event.target.value);
                                                                update({});
                                                            }, placeholder: "YYYY-MM-DD, one per line", disabled: locked }), _jsx("p", { className: "field-hint", children: "Enter one date for a one-off task, or several confirmed dates. No teaching-period dates are inferred." })] })) : (_jsxs("div", { className: "form-grid", children: [_jsxs("div", { className: "form-field full-width", children: [_jsx(Label, { htmlFor: "task-first-date", children: "First due date / calendar anchor" }), _jsx(Input, { id: "task-first-date", type: "date", value: draft.firstDueOn ?? "", onChange: (event) => update({ firstDueOn: event.target.value || null }), disabled: locked })] }), _jsxs("div", { className: "form-field", children: [_jsx(Label, { htmlFor: "task-interval", children: "Repeat every" }), _jsx(Input, { id: "task-interval", type: "number", min: 1, max: 120, step: 1, value: draft.interval, onChange: (event) => update({ interval: Number(event.target.value) }), disabled: locked })] }), _jsxs("div", { className: "form-field", children: [_jsx(Label, { children: "Calendar unit" }), _jsxs(Select, { value: draft.unit, onValueChange: (value) => update({ unit: value }), disabled: locked, children: [_jsx(SelectTrigger, { "aria-label": "Task recurrence unit", children: _jsx(SelectValue, {}) }), _jsx(SelectContent, { children: ["days", "weeks", "months", "years"].map((unit) => (_jsx(SelectItem, { value: unit, children: unit }, unit))) })] })] })] })), _jsx("p", { className: "field-hint", children: "Months and years use calendar dates. Six months is not converted to 180 days." })] }), _jsxs("fieldset", { className: "detail-card", children: [_jsx("legend", { className: "text-sm font-semibold", children: "Reminder rule \u00B7 Australia/Sydney" }), _jsxs("div", { className: "form-grid", children: [_jsxs("div", { className: "form-field", children: [_jsx(Label, { htmlFor: "task-reminder-advance", children: "Calendar days before due" }), _jsx(Input, { id: "task-reminder-advance", type: "number", min: 0, max: 365, step: 1, value: draft.reminderDaysBefore, onChange: (event) => update({ reminderDaysBefore: Number(event.target.value) }), disabled: locked })] }), _jsxs("div", { className: "form-field", children: [_jsx(Label, { htmlFor: "task-reminder-time", children: "Reminder time" }), _jsx(Input, { id: "task-reminder-time", type: "time", value: draft.reminderTime ?? "", onChange: (event) => update({ reminderTime: event.target.value || null }), disabled: locked })] })] }), _jsx("p", { className: "field-hint", children: "Choose the local time explicitly. Changing reminder settings does not change the task due date." }), _jsxs("label", { className: "export-option", children: [_jsx(Checkbox, { checked: true, disabled: true }), _jsxs("span", { children: [_jsx("strong", { children: "Messages" }), _jsx("small", { children: "Required persistent inbox channel" })] })] }), _jsxs("label", { className: "export-option", children: [_jsx(Checkbox, { checked: draft.channels.includes("email"), onCheckedChange: (value) => update({
                                                                channels: value === true ? ["messages", "email"] : ["messages"],
                                                            }, false), disabled: locked }), _jsxs("span", { children: [_jsx("strong", { children: "Prefer email too" }), _jsx("small", { children: "Email delivery is unavailable; this saves a preference and does not send an email." })] })] })] }), _jsxs("div", { className: "detail-card", children: [_jsx("h3", { children: "Schedule preview \u00B7 Sydney" }), openCycle && (_jsxs("p", { children: [_jsx("strong", { children: "Recorded open cycle:" }), " due", " ", formatDateOnly(openCycle.dueOn), "; reminder", " ", formatDateOnly(openCycle.reminderOn), " ", openCycle.reminderTime || "time unavailable", ". Its recorded deadline remains unchanged."] })), _jsxs("div", { className: "key-value", children: [_jsx("span", { children: "Next due" }), _jsx("strong", { children: preview?.nextDueOn
                                                                ? formatDateOnly(preview.nextDueOn)
                                                                : preview?.calculationRule === "awaiting_actual_completion"
                                                                    ? "After the current task is completed"
                                                                    : "Not configured" })] }), _jsxs("div", { className: "key-value", children: [_jsx("span", { children: "Next reminder" }), _jsx("strong", { children: preview?.nextReminderOn
                                                                ? `${formatDateOnly(preview.nextReminderOn)}${preview.reminderTime ? ` at ${preview.reminderTime}` : " · choose a time"}`
                                                                : "Not configured" })] }), preview &&
                                                    ["ambiguous", "nonexistent"].includes(preview.reminderStatus) && (_jsxs("p", { className: "form-error", children: ["This reminder time is", " ", preview.reminderStatus === "ambiguous"
                                                            ? "ambiguous"
                                                            : "unavailable", " ", "during a Sydney daylight-saving transition. Choose another time before activation."] })), previewError && _jsx("p", { className: "form-error", children: previewError }), _jsx("p", { children: "Messages are generated while the system is in use; unattended scheduling is unavailable." })] }), openCycle && (_jsx("p", { className: "field-hint", children: "The preview estimates a future cycle. The current cycle must be completed first; its actual completion date can change the next due date." }))] }), _jsxs("section", { className: styles.section, "aria-labelledby": "task-review-heading", children: [_jsxs("div", { className: styles.sectionHeading, children: [_jsx("span", { "aria-hidden": "true", children: "5" }), _jsx("h3", { id: "task-review-heading", children: "Review and save" })] }), _jsxs("fieldset", { className: styles.stateChoices, children: [_jsx("legend", { children: "Plan status after saving" }), [
                                                    { value: "draft", title: "Draft", description: "Save progress without reminders." },
                                                    { value: "active", title: "Active", description: "Generate Messages while the system is in use." },
                                                    { value: "paused", title: "Paused", description: "Stop new cycles and future reminders." },
                                                ].map((state) => (_jsxs("label", { "data-selected": draft.state === state.value, children: [_jsx("input", { type: "radio", name: "task-plan-state", value: state.value, checked: draft.state === state.value, onChange: () => update({ state: state.value }, false), disabled: locked }), _jsxs("span", { children: [_jsx("strong", { children: state.title }), _jsx("small", { children: state.description })] })] }, state.value)))] }), _jsxs("label", { className: `export-option ${styles.selectionRow}`, "data-selected": draft.applicabilityConfirmed, children: [_jsx(Checkbox, { checked: draft.applicabilityConfirmed, onCheckedChange: (value) => update({ applicabilityConfirmed: value === true }, false), disabled: locked }), _jsxs("span", { children: [_jsx("strong", { children: "Confirm the plan before activation" }), _jsxs("small", { children: ["I have confirmed its basis, applicability, targets, dates, reminder time and staff assignments.", " ", data.dataset === "demo"
                                                                    ? "This is a labelled demonstration configuration."
                                                                    : "Placeholder locations do not establish actual storage areas."] })] })] }), existing && (_jsx("p", { className: "field-hint", children: "Edits retain the current cycle's recorded content, due date and history. Assignment and plan state affect future reminder routing." })), !validation.success && draft.state === "active" && (_jsxs("div", { className: styles.requirements, children: [_jsx("strong", { children: "Before activation" }), _jsx("ul", { children: validation.error.issues.map((issue, index) => _jsx("li", { children: issue.message }, index)) }), _jsx("p", { children: "You can choose Draft to save while these details are incomplete." })] }))] }), latest && (_jsxs("div", { className: "detail-card", children: [_jsxs("h3", { children: ["Latest saved version ", latest.version] }), _jsxs("p", { children: [latest.title, " \u00B7 ", latest.state, " \u00B7", " ", assignmentNames(latest.assigneeIds, data)] }), _jsxs("p", { children: ["First due: ", formatDateOnly(latest.firstDueOn), " \u00B7 Reminder time:", " ", latest.reminderTime || "Not selected"] }), _jsx(Button, { type: "button", variant: "outline", onClick: acceptLatest, disabled: locked, children: "Replace draft with latest saved task" })] })), creation && (_jsxs("div", { className: "detail-card", role: "status", children: [_jsx("h3", { children: creation.status === "uncertain"
                                                ? "Unconfirmed task creation"
                                                : "Rejected task creation" }), _jsx("p", { children: creation.status === "uncertain"
                                                ? "The submitted plan and request identifier are preserved in this tab. Retry that exact request before editing, closing or preparing another task. Reopening Periodic tasks after a reload restores this request."
                                                : "The rejected request is preserved. Return to the draft to review its targets and assignments before creating a new request." }), _jsxs("p", { children: ["Request: ", creation.input.requestId] })] })), !manageTaskPlans && (_jsx("p", { className: "field-hint", role: "status", children: "Administrator access is required to change this plan. Any saved request remains preserved in this tab." }))] }), _jsxs("div", { className: styles.footer, children: [error && (_jsxs("div", { className: styles.error, children: [_jsx("p", { className: "form-error", role: "alert", children: error }), conflict && existing && (_jsxs(_Fragment, { children: [_jsx("p", { className: "field-hint", children: "Your draft is preserved. Load and review the latest saved task before replacing this draft." }), _jsx(Button, { type: "button", variant: "outline", onClick: loadLatest, disabled: locked, children: "Load latest saved task" })] }))] })), _jsx("p", { className: styles.saveHint, children: creation || recovery.error
                                        ? "Resolve the saved request before editing or leaving this form."
                                        : draft.state === "active"
                                            ? "Active plans generate Messages while the system is in use."
                                            : draft.state === "paused"
                                                ? "Saving as paused stops new cycles and future reminders."
                                                : "A draft saves your progress without generating reminders." }), _jsxs(DialogFooter, { children: [_jsx(Button, { type: "button", variant: "outline", onClick: close, disabled: busy || !!creation || !!recovery.error, children: "Cancel" }), creation?.status === "uncertain" ? (_jsx(Button, { type: "button", onClick: () => void sendCreation(creation, true), disabled: busy || !manageTaskPlans, children: busy ? "Checking…" : "Retry original task creation" })) : creation?.status === "rejected" ? (_jsx(Button, { type: "button", variant: "outline", onClick: reviewRejectedCreation, disabled: busy, children: "Return to task draft" })) : (_jsx(Button, { type: "submit", disabled: locked || conflict, children: busy
                                                ? "Saving…"
                                                : draft.state === "active"
                                                    ? existing ? "Save active plan" : "Create and activate"
                                                    : draft.state === "paused"
                                                        ? existing ? "Save paused plan" : "Create paused plan"
                                                        : existing ? "Save draft" : "Create draft" }))] })] })] })] }) }));
}
