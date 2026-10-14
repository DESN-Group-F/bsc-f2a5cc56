"use client";
import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useRef, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { Button } from "../../ui/button.js";
import { Textarea } from "../../ui/textarea.js";
import { Label } from "../../ui/label.js";
import { Checkbox } from "../../ui/checkbox.js";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, } from "../../ui/dialog.js";
import { formatDateOnly, formatTime } from "../../../lib/client-utils.js";
import { taskRequest, } from "../../../lib/client/task-api.js";
import { assignmentNames, taskCategoryLabels, targetSummary, cycleState, reminderLimitation, } from "./task-presentation.js";
export function TaskCycleDialog({ cycle, data, onClose, onSaved, onDetail, }) {
    const [reviewed, setReviewed] = useState(cycle), [notes, setNotes] = useState(""), [confirmed, setConfirmed] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(""), [conflict, setConflict] = useState(false), [uncertain, setUncertain] = useState(false), [latest, setLatest] = useState(null);
    const attempt = useRef({ signature: "", requestId: "" });
    const snapshotBatteries = Array.isArray(reviewed.targetSnapshot.batteries)
        ? reviewed.targetSnapshot.batteries.flatMap((item) => item &&
            typeof item === "object" &&
            "id" in item &&
            typeof item.id === "string"
            ? [
                {
                    id: item.id,
                    name: "name" in item && typeof item.name === "string"
                        ? item.name
                        : "",
                },
            ]
            : [])
        : reviewed.batteryIds.map((id) => ({ id, name: "" }));
    const room = reviewed.targetSnapshot.room;
    const recordedTarget = room &&
        typeof room === "object" &&
        "name" in room &&
        typeof room.name === "string"
        ? room.name
        : targetSummary(reviewed, data);
    async function complete() {
        if (busy ||
            conflict ||
            !confirmed ||
            !reviewed.canComplete ||
            reviewed.planRemoved)
            return;
        setBusy(true);
        setError("");
        try {
            const input = {
                dataset: data.dataset,
                action: "complete",
                payload: {
                    cycleId: reviewed.id,
                    expectedVersion: reviewed.version,
                    notes,
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
            const status = error.status;
            setUncertain(!status || status >= 500 || status < 400);
            if (status === 409)
                setConflict(true);
        }
        finally {
            setBusy(false);
        }
    }
    async function reload() {
        setBusy(true);
        try {
            const body = await taskRequest(`/api/task-plans?dataset=${data.dataset}&visibility=all`);
            const found = body.cycles.find((item) => item.id === reviewed.id);
            if (!found)
                throw new Error("This recorded task is unavailable. Your notes are preserved.");
            setLatest(found);
        }
        catch (error) {
            setError(error.message);
        }
        finally {
            setBusy(false);
        }
    }
    return (_jsx(Dialog, { open: true, onOpenChange: (open) => !open && !busy && !uncertain && onClose(), children: _jsxs(DialogContent, { className: "record-dialog task-cycle-dialog", showCloseButton: !busy && !uncertain, onEscapeKeyDown: (event) => {
                if (busy || uncertain)
                    event.preventDefault();
            }, onInteractOutside: (event) => {
                if (busy || uncertain)
                    event.preventDefault();
            }, children: [_jsxs(DialogHeader, { children: [_jsx(DialogTitle, { children: reviewed.title }), _jsxs(DialogDescription, { children: [taskCategoryLabels[reviewed.category], " \u00B7", " ", reviewed.status === "completed"
                                    ? "Completed"
                                    : reviewed.planRemoved
                                        ? "Plan removed"
                                        : cycleState(reviewed)] })] }), _jsxs("div", { className: "task-cycle-body", children: [_jsxs("div", { className: "task-cycle-summary", children: [_jsxs("p", { children: [_jsx("strong", { children: "Due:" }), " ", formatDateOnly(reviewed.dueOn), " \u00B7", " ", _jsx("strong", { children: "Target:" }), " ", recordedTarget] }), _jsxs("p", { children: [_jsx("strong", { children: "Assigned staff:" }), " ", assignmentNames(reviewed.currentAssigneeIds, data)] })] }), reviewed.status === "completed" ? (_jsxs("div", { className: "detail-card", children: [_jsxs("h3", { children: [_jsx(CheckCircle2, { size: 17 }), "Recorded completion"] }), _jsxs("p", { children: [formatTime(reviewed.completedAt), " \u00B7 ", reviewed.completedByName] }), _jsx("p", { className: "whitespace-pre-wrap", children: reviewed.completionNotes || "No completion notes." })] })) : reviewed.planRemoved ? (_jsx("p", { className: "field-hint", role: "status", children: "This plan has been removed. Completion is unavailable until an administrator restores the plan. Existing task requirements and history are retained." })) : reviewed.canComplete ? (_jsxs("div", { className: "form-stack", children: [_jsxs("div", { className: "form-field", children: [_jsx(Label, { htmlFor: "task-completion-notes", children: "Completion notes (optional)" }), _jsx(Textarea, { id: "task-completion-notes", "aria-describedby": "task-completion-notes-hint", value: notes, onChange: (event) => {
                                                if (busy || uncertain)
                                                    return;
                                                setNotes(event.target.value);
                                                setConfirmed(false);
                                            }, maxLength: 2000, disabled: busy || uncertain, placeholder: "Add findings or follow-up actions, if needed." }), _jsx("p", { id: "task-completion-notes-hint", className: "field-hint", children: "You can leave this blank. Maximum 2,000 characters." })] }), _jsxs("label", { className: "export-option", children: [_jsx(Checkbox, { checked: confirmed, onCheckedChange: (value) => {
                                                if (!busy && !uncertain)
                                                    setConfirmed(value === true);
                                            }, disabled: busy || uncertain }), _jsxs("span", { children: [_jsx("strong", { children: "I have completed this task." }), _jsx("small", { children: "Completion records the actual task review; it is not a battery safety certification." })] })] }), !busy && !conflict && (_jsx("p", { className: "field-hint", role: "status", children: !confirmed
                                        ? "Tick the confirmation above to enable Record completion. Editing notes clears this confirmation."
                                        : "Ready to record completion." }))] })) : (_jsx("p", { className: "field-hint", children: "Only a currently assigned staff member or an administrator can record this task's completion." })), _jsxs("details", { className: "detail-card task-requirements", children: [_jsx("summary", { children: "Recorded task requirements and assets" }), _jsx("p", { className: "whitespace-pre-wrap", children: reviewed.description }), _jsxs("p", { children: [_jsx("strong", { children: "Basis:" }), " ", reviewed.basis] }), _jsxs("p", { children: [_jsx("strong", { children: "Recorded target:" }), " ", recordedTarget] }), _jsxs("p", { children: [_jsx("strong", { children: "Scope:" }), " ", reviewed.scopeNote || recordedTarget] }), _jsxs("p", { children: [_jsx("strong", { children: "Assigned staff:" }), " ", assignmentNames(reviewed.currentAssigneeIds, data)] }), _jsxs("p", { children: [_jsx("strong", { children: "Due:" }), " ", formatDateOnly(reviewed.dueOn), " \u00B7", " ", _jsx("strong", { children: "Reminder:" }), " ", formatDateOnly(reviewed.reminderOn), " ", reviewed.reminderTime || "time unavailable", " Sydney"] }), reminderLimitation(reviewed.reminderStatus) && (_jsx("p", { className: "form-error", children: reminderLimitation(reviewed.reminderStatus) })), snapshotBatteries.length > 0 && (_jsxs(_Fragment, { children: [_jsx("p", { children: "Registered assets recorded when this cycle was created:" }), _jsx("div", { className: "mt-3 flex max-h-44 flex-wrap gap-2 overflow-y-auto", children: snapshotBatteries.map(({ id, name }) => onDetail ? (_jsx(Button, { variant: "outline", size: "sm", onClick: () => onDetail(id), disabled: busy || uncertain, title: name, children: id }, id)) : (_jsxs("span", { children: [id, name ? ` · ${name}` : ""] }, id))) })] }))] }), error && (_jsxs("div", { children: [_jsx("p", { className: "form-error", role: "alert", children: error }), uncertain && (_jsx("p", { className: "field-hint", children: "The result has not been confirmed. Your notes and original request are locked; retry to confirm the recorded outcome." })), conflict && (_jsxs(_Fragment, { children: [_jsx("p", { className: "field-hint", children: "Your notes are preserved. Review the latest task state before completing this cycle." }), _jsx(Button, { variant: "outline", onClick: reload, disabled: busy || uncertain, children: "Load latest task state" })] }))] })), latest && (_jsxs("div", { className: "detail-card", children: [_jsx("h3", { children: "Latest recorded task state" }), _jsxs("p", { children: [latest.title, " \u00B7 ", cycleState(latest), " \u00B7 due", " ", formatDateOnly(latest.dueOn)] }), _jsxs("p", { children: ["Assigned staff:", " ", assignmentNames(latest.currentAssigneeIds, data)] }), _jsx(Button, { variant: "outline", onClick: () => {
                                        setReviewed(latest);
                                        setLatest(null);
                                        setConflict(false);
                                        setUncertain(false);
                                        setConfirmed(false);
                                        setError("");
                                    }, disabled: busy || uncertain, children: "Accept reviewed task state" })] })), _jsx("p", { className: "field-hint", children: "Marking a message as read does not complete this task. Recorded deadlines and prior completion evidence remain available." })] }), _jsxs(DialogFooter, { className: "task-cycle-footer", children: [_jsx(Button, { variant: "outline", onClick: onClose, disabled: busy || uncertain, children: "Close" }), reviewed.status !== "completed" &&
                            !reviewed.planRemoved &&
                            reviewed.canComplete && (_jsx(Button, { onClick: complete, disabled: busy || conflict || !confirmed, children: busy
                                ? "Saving…"
                                : uncertain
                                    ? "Retry original completion"
                                    : "Record completion" }))] })] }) }));
}
