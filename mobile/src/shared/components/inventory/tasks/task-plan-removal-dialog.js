"use client";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useRef, useState } from "react";
import { Button } from "../../ui/button.js";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, } from "../../ui/dialog.js";
import { getRolePermissions } from "../../../lib/permissions.js";
import { taskRequest, } from "../../../lib/client/task-api.js";
import { captureTaskRecordAction, saveTaskRecordAction, clearTaskRecordAction, taskRecordActionFinallyRejected, verifyTaskRecordActionReceipt, } from "../../../lib/client/task-record-action.js";
export function TaskPlanRemovalDialog({ original, data, onClose, onSaved, }) {
    const { manageTaskPlans } = getRolePermissions(data.user.role);
    const [reviewed, setReviewed] = useState(original);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [conflict, setConflict] = useState(false);
    const [uncertain, setUncertain] = useState(false);
    const [latest, setLatest] = useState(null);
    const attempt = useRef(null);
    const mounted = useRef(true);
    useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
        };
    }, []);
    const action = original.removedAt ? "restore" : "remove";
    const restoring = action === "restore";
    const applicable = restoring ? !!reviewed.removedAt : !reviewed.removedAt;
    const locked = busy || uncertain;
    async function save() {
        if (busy || conflict || !applicable || !manageTaskPlans)
            return;
        attempt.current ??= captureTaskRecordAction(data.dataset, action, reviewed);
        const input = attempt.current;
        try {
            saveTaskRecordAction("plans", data.user.id, input);
        }
        catch (error) {
            setError(`The request could not be preserved. No change was sent. ${error.message}`);
            return;
        }
        setBusy(true);
        setError("");
        try {
            const body = await taskRequest("/api/task-plans", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(input),
            });
            verifyTaskRecordActionReceipt(body.result, input, data.user.id);
            clearTaskRecordAction("plans", data.user.id, input);
            setUncertain(false);
            if (mounted.current)
                await onSaved();
        }
        catch (error) {
            const status = error.status;
            setError(error.message);
            const rejected = taskRecordActionFinallyRejected(error);
            setUncertain(!rejected);
            setConflict(rejected && status === 409);
            if (rejected) {
                try {
                    clearTaskRecordAction("plans", data.user.id, input);
                }
                catch (storageFailure) {
                    setUncertain(true);
                    setConflict(false);
                    setError(storageFailure.message);
                }
            }
        }
        finally {
            setBusy(false);
        }
    }
    async function loadLatest() {
        setBusy(true);
        try {
            const response = await taskRequest(`/api/task-plans?dataset=${data.dataset}&visibility=all`);
            const found = response.plans.find((plan) => plan.id === reviewed.id);
            if (!found)
                throw new Error("This plan is unavailable. Close this review and refresh task records.");
            setLatest(found);
        }
        catch (error) {
            setError(error.message);
        }
        finally {
            setBusy(false);
        }
    }
    return (_jsx(Dialog, { open: true, onOpenChange: (open) => {
            if (!open && !locked)
                onClose();
        }, children: _jsxs(DialogContent, { className: "record-dialog", showCloseButton: !locked, onEscapeKeyDown: (event) => {
                if (locked)
                    event.preventDefault();
            }, onInteractOutside: (event) => {
                if (locked)
                    event.preventDefault();
            }, children: [_jsxs(DialogHeader, { children: [_jsx(DialogTitle, { children: restoring ? "Restore recurring plan" : "Remove recurring plan" }), _jsx(DialogDescription, { children: reviewed.title })] }), _jsxs("div", { className: "detail-card", children: [_jsx("p", { children: restoring
                                ? `Restore this plan with its previous ${reviewed.state} status. Its original pending tasks become available again.`
                                : "Move this shared plan to Removed. It will stop generating tasks and reminders, and its pending tasks cannot be completed while the plan is removed." }), _jsx("p", { children: restoring
                                ? "An active plan can generate due tasks and reminders when the system is next used. Paused and draft plans retain those states."
                                : "An administrator can restore the plan later. This affects all staff assigned to it." }), _jsx("p", { children: "Existing messages, deadlines and completion history are retained. No task is recorded as completed by this action." })] }), !applicable && (_jsxs("p", { className: "field-hint", role: "status", children: ["This plan is already ", restoring ? "current" : "removed", ". Close this review and refresh task records."] })), !manageTaskPlans && (_jsx("p", { className: "field-hint", role: "status", children: "Only an administrator can remove or restore a shared plan. Any unresolved request remains preserved in this tab." })), error && (_jsxs("div", { role: "alert", children: [_jsx("p", { className: "form-error", children: error }), uncertain && (_jsx("p", { className: "field-hint", children: "The result has not been confirmed. Keep this review open and retry the original request." })), conflict && (_jsx(Button, { variant: "outline", onClick: loadLatest, disabled: busy, children: "Load latest plan state" }))] })), latest && (_jsxs("div", { className: "detail-card", children: [_jsxs("p", { children: [latest.title, " \u00B7 ", latest.removedAt ? "Removed" : latest.state] }), _jsx(Button, { variant: "outline", disabled: busy, onClick: () => {
                                setReviewed(latest);
                                setLatest(null);
                                setConflict(false);
                                setUncertain(false);
                                setError("");
                                attempt.current = null;
                            }, children: "Accept reviewed plan state" })] })), _jsxs(DialogFooter, { children: [_jsx(Button, { variant: "outline", disabled: locked, onClick: onClose, children: "Cancel" }), _jsx(Button, { variant: restoring ? "default" : "destructive", onClick: save, disabled: busy || conflict || !applicable || !manageTaskPlans, children: busy
                                ? "Saving…"
                                : uncertain
                                    ? `Retry original ${restoring ? "restoration" : "removal"}`
                                    : restoring
                                        ? "Restore plan"
                                        : "Remove plan" })] })] }) }));
}
