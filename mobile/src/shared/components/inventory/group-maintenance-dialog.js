"use client";
import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useRef, useState } from "react";
import { acknowledgeWorkflowStorage } from "../../lib/client/workflow-storage.js";
import { Button } from "../ui/button.js";
import { MotionDisclosure } from "../ui/workspace-motion.js";
import { Input } from "../ui/input.js";
import { Label } from "../ui/label.js";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select.js";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "../ui/dialog.js";
import { RecordPicker } from "./record-picker.js";
import { groupMaintenanceKey, captureGroupMaintenance, recoverGroupMaintenance, verifyGroupMaintenance } from "../../lib/group-maintenance.js";
import { fromSydneyInput, staffIdentityLabel } from "../../lib/client-utils.js";
import { roomPickerOptions } from "../../lib/location-catalog.js";
import { getRolePermissions } from "../../lib/permissions.js";
export function GroupMaintenanceDialog({ data, group, ids, write, onClose, onChanged }) {
    const [context] = useState(() => ({ accountId: data.user.id, dataset: data.dataset }));
    const key = groupMaintenanceKey(context.accountId, context.dataset);
    const [recovery] = useState(() => { try {
        const raw = window.__batteryWorkflowStorage.getItem(key), attempt = recoverGroupMaintenance(raw, context.accountId, context.dataset);
        return { attempt, invalid: raw !== null && !attempt };
    }
    catch {
        return { attempt: null, invalid: true };
    } });
    const [attempt, setAttempt] = useState(recovery.attempt), pending = useRef(attempt), running = useRef(false), live = useRef(true);
    const [kind, setKind] = useState("owner"), [ownerId, setOwnerId] = useState(""), [roomId, setRoomId] = useState("__unspecified"), [time, setTime] = useState(""), [duration, setDuration] = useState("");
    const [busy, setBusy] = useState(false), [error, setError] = useState(""), [storageError, setStorageError] = useState("");
    const [saved, setSaved] = useState(false);
    const [reviewed] = useState(() => ids.map(id => data.batteries.find(b => b.id === id)).filter(b => !!b).map(b => ({ batteryId: b.id, version: b.version, tagId: b.tagId })));
    const contextChanged = context.accountId !== data.user.id || context.dataset !== data.dataset;
    const permissions = getRolePermissions(data.user.role);
    const operation = attempt?.payload.kind ?? kind;
    const permitted = operation === "charge" ? permissions.recordCharges : operation === "observation" ? permissions.recordDemoObservations && data.dataset === "demo" : permissions.editBatteryRecords;
    useEffect(() => { live.current = !contextChanged; return () => { live.current = false; }; }, [contextChanged]);
    const locked = busy || !!attempt || !!storageError || recovery.invalid || contextChanged;
    const fieldsLocked = locked || saved || !permitted;
    function preserve(next) {
        try {
            const raw = window.__batteryWorkflowStorage.getItem(key);
            if (raw !== null && raw !== JSON.stringify(next))
                throw new Error("The original group operation changed. It has not been replaced.");
            if (next)
                window.__batteryWorkflowStorage.setItem(key, JSON.stringify(next));
            else
                window.__batteryWorkflowStorage.removeItem(key);
            pending.current = next;
            setAttempt(next);
            setStorageError("");
            window.dispatchEvent(new Event("battery-group-maintenance-recovery"));
            return true;
        }
        catch {
            pending.current = next || pending.current;
            setAttempt(pending.current);
            setStorageError("Restore browser storage and retry this exact operation before leaving.");
            return false;
        }
    }
    async function save(retry = false) {
        if ((!permitted && !retry) || saved || running.current || busy || recovery.invalid || contextChanged || !retry && locked || retry && !pending.current)
            return;
        running.current = true;
        setBusy(true);
        setError("");
        let captured = pending.current;
        try {
            if (!captured) {
                if (!group || reviewed.length !== ids.length)
                    throw new Error("Reopen the group and review all selected members.");
                const base = { requestId: crypto.randomUUID(), teachingGroup: { id: group.id, version: group.version }, items: reviewed };
                const fields = kind === "owner" ? { ownerId } : kind === "storage" ? { homeBuildingId: "J18", homeRoomId: roomId === "__unspecified" ? null : roomId } : kind === "charge" ? { completedAt: fromSydneyInput(time), durationMinutes: Number(duration) } : { roomId, observedAt: fromSydneyInput(time) };
                captured = captureGroupMaintenance(context.accountId, context.dataset, { ...base, kind, ...fields });
            }
            if (!preserve(captured))
                return;
            const receipt = await write("group_maintenance", captured.payload);
            verifyGroupMaintenance(receipt, captured);
            if (!live.current)
                return;
            await acknowledgeWorkflowStorage({ remove: [key], expected: { [key]: JSON.stringify(captured) } });
            pending.current = null;
            setAttempt(null);
            setStorageError("");
            window.dispatchEvent(new Event("battery-group-maintenance-recovery"));
            setSaved(true);
            try {
                await onChanged();
            }
            catch {
                setError("The group operation was saved. The display could not refresh; close this dialog and refresh before another update.");
                return;
            }
            onClose();
        }
        catch (error) {
            if (!live.current)
                return;
            const rejected = error.code === "group_operation_rejected_final";
            if (rejected && captured) {
                try {
                    await acknowledgeWorkflowStorage({ remove: [key], expected: { [key]: JSON.stringify(captured) } });
                    pending.current = null;
                    setAttempt(null);
                }
                catch (storageFailure) {
                    setStorageError(storageFailure.message);
                }
            }
            setError(error.issues?.[0]?.message || error.message);
        }
        finally {
            running.current = false;
            if (live.current)
                setBusy(false);
        }
    }
    return _jsx(Dialog, { open: true, onOpenChange: open => { if (!open && !locked)
            onClose(); }, children: _jsxs(DialogContent, { showCloseButton: !locked, children: [_jsxs(DialogHeader, { children: [_jsx(DialogTitle, { children: "Update teaching group batteries" }), _jsx(DialogDescription, { children: "Review one common change for the selected members. All changes are saved together with their recorded group context." })] }), _jsxs("p", { className: "group-context-banner", children: [_jsx("strong", { children: group?.name ?? "Preserved group operation" }), " \u00B7 ", attempt?.payload.items.length ?? reviewed.length, " batteries"] }), recovery.invalid && _jsx("p", { className: "form-error", children: "This tab could not recover its earlier group operation. Restore storage access and reopen with the same account and inventory." }), contextChanged && _jsx("p", { className: "form-error", children: "Restore the original staff account and inventory to resolve this request." }), !permitted && _jsx("p", { className: "form-error", role: "alert", children: "New group updates require administrator access. Any unconfirmed request remains preserved; its exact retry is checked by the server and may require restoring the original administrator access." }), _jsx(MotionDisclosure, { open: !attempt && !saved && permitted, children: _jsx("fieldset", { disabled: fieldsLocked, className: "min-w-0 border-0 p-0", children: _jsxs("div", { className: "form-stack", children: [_jsx(Label, { children: "Operation" }), _jsxs(Select, { value: kind, onValueChange: value => { if (!locked) {
                                        setKind(value);
                                        setRoomId("__unspecified");
                                    } }, disabled: fieldsLocked, children: [_jsx(SelectTrigger, { "aria-label": "Group update operation", children: _jsx(SelectValue, {}) }), _jsxs(SelectContent, { children: [permissions.editBatteryRecords && _jsxs(_Fragment, { children: [_jsx(SelectItem, { value: "owner", children: "Change responsible owner" }), _jsx(SelectItem, { value: "storage", children: "Change registered storage" })] }), permissions.recordCharges && _jsx(SelectItem, { value: "charge", children: "Record charging" }), data.dataset === "demo" && permissions.recordDemoObservations && _jsx(SelectItem, { value: "observation", children: "Record demo location" })] })] }), _jsxs("div", { className: "group-maintenance-fields", children: [_jsx(MotionDisclosure, { open: kind === "owner", children: _jsx(RecordPicker, { id: "group-update-owner", value: ownerId, onChange: setOwnerId, disabled: fieldsLocked || kind !== "owner", placeholder: "Choose responsible owner\u2026", options: data.people.filter(p => p.role === "staff" && p.accountId && data.staffDirectory.some(a => a.id === p.accountId && a.active)).map(p => ({ id: p.id, label: staffIdentityLabel(p.name, data.staffDirectory.find(a => a.id === p.accountId)?.username, p.accountId) })) }) }), _jsxs(MotionDisclosure, { open: kind === "storage" || kind === "observation", children: [_jsxs(Label, { children: ["J18 room", kind === "storage" ? " — optional" : ""] }), _jsx(RecordPicker, { id: "group-update-room", value: roomId, onChange: setRoomId, disabled: fieldsLocked || kind !== "storage" && kind !== "observation", placeholder: "Choose J18 room\u2026", options: [...(kind === "storage" ? [{ id: "__unspecified", label: "Room not specified" }] : []), ...roomPickerOptions(data.rooms, "J18")] }), _jsx("p", { className: "field-hint", children: "Registered storage and dated location evidence remain separate. Demo rooms are unverified placeholders." })] }), _jsxs(MotionDisclosure, { open: kind === "charge" || kind === "observation", children: [_jsxs(Label, { htmlFor: "group-update-time", children: [kind === "charge" ? "Charging completed" : "Demo observation time", " \u00B7 Sydney time"] }), _jsx(Input, { id: "group-update-time", type: "datetime-local", value: time, onChange: event => setTime(event.target.value), disabled: fieldsLocked || kind !== "charge" && kind !== "observation" })] }), _jsxs(MotionDisclosure, { open: kind === "charge", children: [_jsx(Label, { htmlFor: "group-update-duration", children: "Duration for each selected battery (minutes)" }), _jsx(Input, { id: "group-update-duration", type: "number", min: "1", max: "525600", value: duration, onChange: event => setDuration(event.target.value), disabled: fieldsLocked || kind !== "charge" })] })] }), _jsxs("details", { children: [_jsx("summary", { children: "Review selected battery IDs" }), _jsx("p", { children: reviewed.map(item => item.batteryId).join(", ") })] })] }) }) }), attempt && _jsxs("div", { className: "detail-card", children: [_jsx("p", { children: "The outcome of this exact request is unconfirmed. Reopening this dialog restores it without sending automatically." }), _jsxs("p", { children: [attempt.payload.kind, " \u00B7 ", attempt.payload.items.map(item => item.batteryId).join(", ")] }), _jsx(Button, { onClick: () => save(true), disabled: busy || recovery.invalid || contextChanged, children: "Retry exact group operation" })] }), (error || storageError) && _jsx("p", { className: "form-error", role: "alert", children: storageError || error }), _jsxs(DialogFooter, { children: [_jsx(Button, { variant: "outline", disabled: locked, onClick: onClose, children: saved ? "Close" : "Cancel" }), !saved && permitted && _jsx(Button, { onClick: () => save(), disabled: locked || !group || !reviewed.length, children: busy ? "Saving…" : `Confirm update (${reviewed.length})` })] })] }) });
}
