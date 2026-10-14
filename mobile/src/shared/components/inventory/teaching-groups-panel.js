"use client";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useRef, useState } from "react";
import { Button } from "../ui/button.js";
import { MotionDisclosure } from "../ui/workspace-motion.js";
import { Input } from "../ui/input.js";
import { Textarea } from "../ui/textarea.js";
import { Checkbox } from "../ui/checkbox.js";
import { Label } from "../ui/label.js";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "../ui/dialog.js";
import { batteryStatusLabel } from "../../lib/battery-lifecycle.js";
import { defaultInventoryFilter } from "../../lib/inventory-query.js";
import { getFilteredBatteries } from "../../lib/battery-selection-query.js";
import { BatteryFilterControls } from "./battery-filter-controls.js";
import { hasRowTextSelection } from "../../lib/client/row-selection.js";
import { buildTeachingGroupReplacement, captureTeachingGroupAttempt, recoverTeachingGroupAttempt, teachingGroupStorageKey, teachingGroupFailureStatus, verifyTeachingGroupReceipt } from "../../lib/teaching-groups.js";
export function TeachingGroupsPanel({ data, initialIds = [], initialGroup, initialReplacement, initialCreate = false, addToExisting = false, onClose, onChanged, onSaved, onFilter, onSelect }) {
    const [context] = useState(() => ({ accountId: data.user.id, dataset: data.dataset }));
    const storageKey = teachingGroupStorageKey(context.accountId, context.dataset);
    const [recovery] = useState(() => {
        try {
            const raw = window.__batteryWorkflowStorage.getItem(storageKey), attempt = recoverTeachingGroupAttempt(raw, context.accountId, context.dataset);
            return { attempt, blocked: !!raw && !attempt };
        }
        catch {
            return { attempt: null, blocked: true };
        }
    });
    const [attempt, setAttempt] = useState(recovery.attempt), pending = useRef(attempt), running = useRef(false), live = useRef(true);
    const [busy, setBusy] = useState(false), [storageError, setStorageError] = useState(""), [error, setError] = useState(recovery.blocked ? "This tab could not recover its group request. Restore storage access and reopen with the same account and inventory before saving." : "");
    const [replacement] = useState(initialReplacement);
    const [mode, setMode] = useState(attempt ? attempt.payload.action === "remove" ? "remove" : "edit" : initialReplacement ? "replacement" : initialGroup || initialCreate || initialIds.length && !addToExisting ? "edit" : "list");
    const [form, setForm] = useState(() => {
        if (attempt)
            return attempt.payload.action === "remove" ? { id: attempt.payload.id, name: "Saved group", notes: "", batteryIds: [], expectedVersion: attempt.payload.expectedVersion } : { ...attempt.payload, expectedVersion: attempt.payload.action === "update" ? attempt.payload.expectedVersion : undefined };
        if (initialGroup && initialReplacement) {
            const change = buildTeachingGroupReplacement(initialGroup, initialReplacement.originalBatteryId, initialReplacement.replacementBatteryId, crypto.randomUUID());
            if (change.action !== "update")
                throw new Error("A permanent replacement must update the reviewed default group.");
            return { ...change };
        }
        return initialGroup ? { ...initialGroup, batteryIds: [...initialGroup.batteryIds], expectedVersion: initialGroup.version } : { id: crypto.randomUUID(), name: "", notes: "", batteryIds: [...new Set(initialIds)] };
    });
    const [query, setQuery] = useState("");
    const [batteryFilters, setBatteryFilters] = useState(() => ({ ...defaultInventoryFilter(), lifecycle: "all" }));
    const contextChanged = context.accountId !== data.user.id || context.dataset !== data.dataset;
    useEffect(() => { live.current = !contextChanged; return () => { live.current = false; }; }, [contextChanged]);
    const locked = busy || !!attempt || !!storageError || recovery.blocked || contextChanged;
    const groups = data.teachingGroups ?? [], matching = groups.filter(group => `${group.name} ${group.notes}`.toLowerCase().includes(query.trim().toLowerCase()));
    const filtered = getFilteredBatteries(data, batteryFilters), choices = filtered.batteries;
    function updateBatteryFilters(patch) { if (!locked && !running.current)
        setBatteryFilters(previous => ({ ...previous, ...patch })); }
    function clearBatteryFilters() { if (!locked && !running.current)
        setBatteryFilters({ ...defaultInventoryFilter(), lifecycle: "all" }); }
    function edit(group, remove = false) {
        if (locked || running.current)
            return;
        setForm(group ? { id: group.id, name: group.name, notes: group.notes, batteryIds: [...group.batteryIds], expectedVersion: group.version } : { id: crypto.randomUUID(), name: "", notes: "", batteryIds: [...new Set(initialIds)] });
        setMode(remove ? "remove" : "edit");
        clearBatteryFilters();
        setError("");
    }
    function update(patch) { if (!locked && !running.current)
        setForm(previous => ({ ...previous, ...patch })); }
    function preserve(value) {
        try {
            if (value)
                window.__batteryWorkflowStorage.setItem(storageKey, JSON.stringify(value));
            else
                window.__batteryWorkflowStorage.removeItem(storageKey);
            pending.current = value;
            setAttempt(value);
            setStorageError("");
            return true;
        }
        catch {
            pending.current = value || pending.current;
            setAttempt(pending.current);
            setStorageError("This tab could not preserve or clear its exact group request. Restore storage access, then retry the preserved request.");
            return false;
        }
    }
    async function save(retry = false) {
        if (busy || running.current || recovery.blocked || contextChanged || (!retry && locked) || (retry && !pending.current))
            return;
        running.current = true;
        setBusy(true);
        setError("");
        let captured = pending.current;
        try {
            if (!captured)
                captured = captureTeachingGroupAttempt(context.accountId, context.dataset, mode === "remove" ? { action: "remove", requestId: crypto.randomUUID(), id: form.id, expectedVersion: form.expectedVersion } : { action: form.expectedVersion ? "update" : "create", requestId: crypto.randomUUID(), id: form.id, name: form.name, notes: form.notes, batteryIds: form.batteryIds, ...(form.expectedVersion ? { expectedVersion: form.expectedVersion } : {}) });
            if (!preserve(captured))
                return;
            const response = await fetch("/api/teaching-groups", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dataset: context.dataset, payload: captured.payload }) });
            const body = await response.json();
            if (!response.ok)
                throw Object.assign(new Error(body.error || "The group could not be saved."), { status: response.status, code: body.code });
            const receipt = verifyTeachingGroupReceipt(body.result, captured);
            if (!live.current) {
                try {
                    const stored = recoverTeachingGroupAttempt(window.__batteryWorkflowStorage.getItem(storageKey), context.accountId, context.dataset);
                    if (stored?.payload.requestId === captured.payload.requestId)
                        window.__batteryWorkflowStorage.removeItem(storageKey);
                }
                catch { /* Preserve the exact request for replay if cleanup is unavailable. */ }
                return;
            }
            if (!preserve(null))
                return;
            setMode("list");
            setQuery("");
            setBatteryFilters({ ...defaultInventoryFilter(), lifecycle: "all" });
            try {
                await onChanged?.();
            }
            catch {
                setError("Your group change was saved, but the display could not refresh. Reopen your groups after refreshing the inventory.");
                return;
            }
            if (live.current && receipt.group.state === "active")
                onSaved?.(receipt.group);
        }
        catch (error) {
            if (!live.current)
                return;
            const message = error.issues?.[0]?.message || error.message;
            if (captured && teachingGroupFailureStatus(error) === "rejected")
                preserve(null);
            setError(captured && teachingGroupFailureStatus(error) === "unknown" ? `${message} The outcome is unconfirmed. Retry the exact request.` : message);
        }
        finally {
            running.current = false;
            if (live.current)
                setBusy(false);
        }
    }
    return _jsx(Dialog, { open: true, onOpenChange: open => { if (!open && !busy && !storageError)
            onClose(); }, children: _jsxs(DialogContent, { className: "teaching-groups-dialog", children: [_jsxs(DialogHeader, { children: [_jsx(DialogTitle, { children: "My teaching groups" }), _jsx(DialogDescription, { children: "Save fixed battery selections for teaching. Groups are private to your account and this inventory; stock, responsibility and current use remain shared." })] }), contextChanged && _jsx("p", { className: "form-error", role: "alert", children: "Reopen with the original account and inventory to resolve this group request." }), _jsxs("div", { className: "teaching-group-mode-content", children: [_jsx(MotionDisclosure, { open: mode === "list", children: _jsxs("fieldset", { disabled: mode !== "list", className: "min-w-0 border-0 p-0", children: [_jsxs("div", { className: "teaching-group-toolbar", children: [_jsx(Input, { "aria-label": "Search my teaching groups", value: query, onChange: event => setQuery(event.target.value), placeholder: "Search group name or notes\u2026" }), _jsx(Button, { variant: "outline", onClick: () => setQuery(""), disabled: !query, children: "Clear filters" }), _jsx(Button, { onClick: () => edit(), disabled: locked, children: "New group" })] }), addToExisting && _jsxs("p", { className: "group-context-banner", children: [initialIds.length, " selected batteries. Choose an existing group to review their addition, or create a new group."] }), query && _jsxs("p", { className: "field-hint", children: ["Applied filters: Search: ", query] }), _jsxs("p", { className: "field-hint", children: [matching.length, " matching groups"] }), _jsxs("div", { className: "teaching-group-list", children: [matching.map(group => _jsxs("article", { className: "teaching-group-card", children: [_jsx("strong", { children: group.name }), group.notes && _jsx("p", { children: group.notes }), _jsxs("p", { className: "field-hint", children: [group.batteryIds.length, " batteries \u00B7 ", group.batteryIds.filter(id => data.batteries.find(battery => battery.id === id)?.loanId).length, " in use \u00B7 ", group.batteryIds.filter(id => data.batteries.find(battery => battery.id === id)?.lifecycleStatus !== "active").length, " retired"] }), _jsxs("div", { className: "teaching-group-actions", children: [addToExisting && _jsx(Button, { size: "sm", disabled: locked || new Set([...group.batteryIds, ...initialIds]).size > 100, onClick: () => { if (!locked) {
                                                                    edit(group);
                                                                    setForm(previous => ({ ...previous, batteryIds: [...new Set([...group.batteryIds, ...initialIds])] }));
                                                                } }, children: "Add selected batteries" }), _jsx(Button, { variant: "outline", size: "sm", onClick: () => { onFilter(group); onClose(); }, disabled: busy, children: "Filter group" }), _jsx(Button, { size: "sm", onClick: () => { onSelect(group); onClose(); }, disabled: busy, children: "Select group batteries" }), _jsx(Button, { variant: "ghost", size: "sm", onClick: () => edit(group), disabled: locked, children: "Edit" }), _jsx(Button, { variant: "ghost", size: "sm", onClick: () => edit(group, true), disabled: locked, children: "Remove group" })] })] }, group.id)), !matching.length && _jsx("p", { className: "empty-hint", children: groups.length ? "No matching groups. Clear filters to see your saved groups." : "Select batteries in the inventory and choose Save as teaching group, or create a group here." })] })] }) }), _jsx(MotionDisclosure, { open: mode === "remove", children: _jsxs("div", { className: "detail-card", children: [_jsxs("h3", { children: ["Remove ", form.name] }), _jsx("p", { children: "Remove this shortcut from your saved groups. Battery records and their history remain in the shared inventory." })] }) }), _jsx(MotionDisclosure, { open: mode === "replacement", children: _jsxs("div", { className: "detail-card", children: [_jsx("h3", { children: "Make replacement permanent" }), _jsx("p", { children: _jsxs("strong", { children: [replacement?.originalBatteryId, " \u2192 ", replacement?.replacementBatteryId] }) }), _jsxs("p", { children: ["Replace this one default member in ", form.name, ", starting with future checkouts. Current loans and previous checkout records remain unchanged. The original battery stays in the shared inventory."] }), _jsxs("p", { className: "field-hint", children: ["Reviewed group version ", form.expectedVersion, " \u00B7 ", form.batteryIds.length, " default members. All other members, their order, the group name and notes are retained."] }), _jsxs("p", { className: "field-hint", children: ["Future default members: ", form.batteryIds.join(", ")] })] }) }), _jsx(MotionDisclosure, { open: mode === "edit", children: _jsx("fieldset", { disabled: mode !== "edit", className: "min-w-0 border-0 p-0", children: _jsxs("div", { className: "form-stack", children: [_jsxs("div", { className: "form-field", children: [_jsx(Label, { htmlFor: "teaching-group-name", children: "Group name" }), _jsx(Input, { id: "teaching-group-name", value: form.name, onChange: event => update({ name: event.target.value }), maxLength: 80, disabled: locked, placeholder: "e.g. Week 3 teaching set" })] }), _jsxs("div", { className: "form-field", children: [_jsx(Label, { htmlFor: "teaching-group-notes", children: "Notes \u2014 optional" }), _jsx(Textarea, { id: "teaching-group-notes", value: form.notes, onChange: event => update({ notes: event.target.value }), maxLength: 500, disabled: locked })] }), _jsx(BatteryFilterControls, { data: data, filters: batteryFilters, onChange: updateBatteryFilters, onClear: clearBatteryFilters, disabled: locked, defaultLifecycle: "all", scopeNote: "Filter the registered batteries available to add. Clearing filters keeps the group name, notes and selected members." }), filtered.error && _jsx("p", { className: "form-error", role: "alert", children: filtered.error }), _jsxs("p", { className: "field-hint", children: [choices.length, " matching batteries \u00B7 ", form.batteryIds.filter(id => !choices.some(battery => battery.id === id)).length, " selected outside these filters"] }), _jsxs("div", { className: "teaching-group-actions", children: [_jsxs("strong", { children: [form.batteryIds.length, "/100 selected"] }), _jsx(Button, { variant: "ghost", size: "sm", onClick: () => update({ batteryIds: [] }), disabled: locked || !form.batteryIds.length, children: "Clear selection" }), form.expectedVersion && _jsx(Button, { variant: "outline", size: "sm", onClick: () => { const latest = groups.find(group => group.id === form.id); if (latest)
                                                        edit(latest);
                                                    else
                                                        setError("This group is no longer available. Your draft remains here for review."); }, disabled: locked, children: "Load latest group" })] }), _jsxs("div", { className: "teaching-group-batteries", children: [choices.map(battery => _jsxs("label", { className: "export-option", onClick: event => { if (hasRowTextSelection(event))
                                                        event.preventDefault(); }, children: [_jsx(Checkbox, { checked: form.batteryIds.includes(battery.id), disabled: locked || !form.batteryIds.includes(battery.id) && form.batteryIds.length >= 100, onCheckedChange: checked => update({ batteryIds: checked === true ? [...new Set([...form.batteryIds, battery.id])] : form.batteryIds.filter(id => id !== battery.id) }) }), _jsxs("span", { children: [_jsxs("strong", { children: [battery.id, " \u00B7 ", battery.name] }), _jsxs("small", { children: [battery.model || "Model not recorded", " \u00B7 ", batteryStatusLabel(battery)] })] })] }, battery.id)), !choices.length && _jsx("p", { className: "empty-hint", children: "No matching batteries. Clear filters to review the inventory." })] }), _jsx("p", { className: "field-hint", children: "Save up to 100 batteries. Retired members remain recorded in the group and must be reviewed before a movement." })] }) }) })] }), error && _jsx("p", { className: "form-error", role: "alert", children: error }), storageError && _jsx("p", { className: "form-error", role: "alert", children: storageError }), attempt && _jsxs("div", { className: "detail-card", children: [_jsx("p", { children: "The original group request is preserved. Reopening with the same account and inventory restores it without automatically sending." }), _jsx(Button, { variant: "outline", onClick: () => save(true), disabled: busy || recovery.blocked || contextChanged, children: "Retry exact group request" })] }), _jsxs(DialogFooter, { children: [_jsx(Button, { variant: "outline", onClick: mode === "list" || mode === "replacement" ? onClose : () => { if (!locked) {
                                setMode("list");
                                setError("");
                            } }, disabled: busy || !!storageError || mode !== "list" && locked, children: mode === "replacement" ? "Cancel replacement" : mode === "list" ? "Close" : "Back to groups" }), mode !== "list" && _jsx(Button, { onClick: () => save(), disabled: locked || mode === "edit" && (!form.name.trim() || !form.batteryIds.length || form.batteryIds.length > 100), children: busy ? "Saving…" : mode === "replacement" ? "Confirm permanent replacement" : mode === "remove" ? "Remove saved group" : form.expectedVersion ? "Save changes" : "Save new group" })] })] }) });
}
