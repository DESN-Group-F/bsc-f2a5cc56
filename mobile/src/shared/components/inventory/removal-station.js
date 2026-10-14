import { WorkflowBoundary } from "../../../business/workflow-boundary.jsx";
"use client";
import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useRef, useState } from "react";
import { BatteryFilterControls } from "./battery-filter-controls.js";
import { defaultInventoryFilter } from "../../lib/inventory-query.js";
import { getFilteredBatteries } from "../../lib/battery-selection-query.js";
import { hasRowTextSelection, shouldToggleSelection } from "../../lib/client/row-selection.js";
import { CheckCircle2, LogOut, ScanLine, Trash2 } from "lucide-react";
import { Button } from "../ui/button.js";
import { ReceiptAction } from "../ui/receipt-action.js";
import { Checkbox } from "../ui/checkbox.js";
import { Input } from "../ui/input.js";
import { Label } from "../ui/label.js";
import { Textarea } from "../ui/textarea.js";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select.js";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table.js";
import { formatTime } from "../../lib/client-utils.js";
import { captureLifecycleAttempt, lifecycleFailureStatus, lifecycleStorageKey, recoverLifecycleSession, verifyLifecycleReceipt } from "../../lib/lifecycle-session.js";
import { captureRemovalDraft, recoverRemovalDraft, removalDraftStorageKey } from "../../lib/removal-draft.js";
import { getRolePermissions } from "../../lib/permissions.js";
import { recoverRetiredAssetAttempt, retiredAssetStorageKey } from "../../lib/retired-asset-actions.js";
import { RetiredAssetActionDialog } from "./retired-asset-action-dialog.js";
import historyStyles from "./retired-asset-action-dialog.module.css";
function browserAttempt(attempt) {
    if (attempt?.payload.source === "native_nfc")
        throw new Error("Resume this preserved native NFC removal in the mobile application. Its original evidence has not been changed.");
    return attempt;
}
function captureBrowserDraft(input) {
    const draft = captureRemovalDraft(input);
    if (draft.source === "native_nfc")
        throw new Error("Native NFC evidence requires the mobile removal workflow.");
    return draft;
}
function recoverBrowserDraft(raw, accountId, dataset) {
    const draft = recoverRemovalDraft(raw, accountId, dataset);
    if (draft?.source === "native_nfc")
        throw new Error("Resume this preserved native NFC removal in the mobile application. Its original evidence has not been changed.");
    return draft;
}
function failureMessage(error) {
    return error?.issues?.[0]?.message || error?.message || "The removal could not be confirmed.";
}
function lifecycleLabel(status) { return status === "scrapped" ? "Scrapped" : status === "permanently_removed" ? "Permanently removed" : "Active"; }
function eligible(battery) { return battery.lifecycleStatus === "active" && !battery.loanId; }
function sameBinding(battery, item) {
    return !!battery && eligible(battery) && battery.version === item.version && battery.tagId === item.tagId;
}
function withExactRequest(draft, attempt, data) {
    const capturedIds = new Set(attempt.payload.items.map(item => item.batteryId));
    const items = [...draft.items.filter(item => !capturedIds.has(item.batteryId)), ...attempt.payload.items.map(item => ({ ...item, name: draft.items.find(saved => saved.batteryId === item.batteryId)?.name || data.batteries.find(battery => battery.id === item.batteryId)?.name || "Recorded battery" }))];
    return captureBrowserDraft({ ...draft, kind: attempt.payload.kind, source: attempt.payload.source, reason: attempt.payload.reason, destination: attempt.payload.destination || "", items, selectedIds: [...new Set([...draft.selectedIds, ...capturedIds])], teachingGroup: attempt.payload.teachingGroup });
}
function SharedRemovalStation({ data, write, onChanged, onDetail, paused = false, onBusyChange, onExit, initialIds = [], teachingGroup }) {
    const [context] = useState(() => ({ actorAccountId: data.user.id, dataset: data.dataset }));
    const contextMatches = context.actorAccountId === data.user.id && context.dataset === data.dataset;
    const storageKey = lifecycleStorageKey(context.actorAccountId, context.dataset);
    const draftKey = removalDraftStorageKey(context.actorAccountId, context.dataset);
    const [recovery] = useState(() => {
        try {
            const raw = window.__batteryWorkflowStorage.getItem(storageKey), savedDraft = window.__batteryWorkflowStorage.getItem(draftKey);
            const attempt = browserAttempt(recoverLifecycleSession(raw, context.actorAccountId, context.dataset)), draft = recoverBrowserDraft(savedDraft, context.actorAccountId, context.dataset);
            const invalid = raw !== null && !attempt || savedDraft !== null && !draft;
            const base = draft && (draft.items.length || !initialIds.length) ? draft : { ...context, source: "manual_selection", kind: "scrapped", reason: "", destination: "", items: [], selectedIds: [], ...(teachingGroup ? { teachingGroup } : {}) };
            if ((!draft || !draft.items.length) && !attempt && initialIds.length) {
                base.items = initialIds.flatMap(id => { const b = data.batteries.find(b => b.id === id); return b && eligible(b) ? [{ batteryId: b.id, version: b.version, tagId: b.tagId, name: b.name }] : []; });
                base.selectedIds = base.items.map(item => item.batteryId);
            }
            return { attempt, draft: attempt && !invalid ? withExactRequest(base, attempt, data) : base, invalid, message: invalid ? "The saved removal request or review draft could not be recovered. No new request will replace it. Preserve this tab and ask the administrator to review the saved records." : "" };
        }
        catch {
            return { attempt: null, draft: { ...context, source: "manual_selection", kind: "scrapped", reason: "", destination: "", items: [], selectedIds: [] }, invalid: true, message: "This tab could not read its saved removal request or review draft. No new request will replace any earlier unresolved removal. Restore browser storage access, then reopen this workflow or reload this tab with the same account and inventory." };
        }
    });
    const currentDraft = useRef(recovery.draft);
    const initialDraftPreserved = useRef(false);
    const [queue, setQueue] = useState(recovery.draft.items);
    const queueRef = useRef(queue);
    const [selected, setSelected] = useState(recovery.draft.selectedIds);
    const [source, setSource] = useState(recovery.draft.source);
    const [kind, setKind] = useState(recovery.draft.kind);
    const [reason, setReason] = useState(recovery.draft.reason);
    const [destination, setDestination] = useState(recovery.draft.destination);
    const [filters, setFilters] = useState(() => defaultInventoryFilter()), [tag, setTag] = useState("");
    const [attempt, setAttempt] = useState(recovery.attempt);
    const pending = useRef(attempt), running = useRef(false), storageBlocked = useRef(false), live = useRef(true);
    const [storageCandidate, setStorageCandidate] = useState(null);
    const [draftCandidate, setDraftCandidate] = useState(null);
    const [busy, setBusy] = useState(false), [error, setError] = useState(recovery.message), [storageError, setStorageError] = useState("");
    const [notice, setNotice] = useState(""), [completed, setCompleted] = useState([]);
    const contextLocked = paused || !contextMatches || recovery.invalid;
    const locked = busy || contextLocked || !!attempt || !!storageCandidate || !!draftCandidate || !!storageError;
    const completedIds = new Set(completed.flatMap(receipt => receipt.items.map(item => item.batteryId)));
    const groupRef = recovery.draft.teachingGroup;
    const group = data.teachingGroups?.find(group => group.id === groupRef?.id && group.version === groupRef.version);
    const candidates = data.batteries.filter(battery => (!groupRef || group?.batteryIds.includes(battery.id)) && eligible(battery) && !completedIds.has(battery.id) && !queue.some(item => item.batteryId === battery.id));
    const { batteries: matching, error: filterError } = getFilteredBatteries(data, filters, candidates);
    const stale = queue.filter(item => !sameBinding(data.batteries.find(battery => battery.id === item.batteryId), item));
    const lastReceipt = completed.at(-1);
    const removalConfirmation = lastReceipt ? { identity: lastReceipt.requestId, count: lastReceipt.items.length, text: `${lastReceipt.items.length} ${lastReceipt.items.length === 1 ? "battery" : "batteries"} ${lifecycleLabel(lastReceipt.kind).toLowerCase()}` } : null;
    const removalReviewKey = `${kind}|${queue.map(item => item.batteryId).join("|")}|${selected.join("|")}`;
    useEffect(() => { live.current = contextMatches; return () => { live.current = false; }; }, [contextMatches, data.dataset, data.user.id]);
    useEffect(() => { onBusyChange?.(busy || !!attempt || !!storageCandidate || !!draftCandidate || !!storageError || recovery.invalid); }, [busy, attempt, storageCandidate, draftCandidate, storageError, recovery.invalid, onBusyChange]);
    useEffect(() => () => { onBusyChange?.(false); }, [onBusyChange]);
    useEffect(() => {
        if (!busy && !attempt && !storageCandidate && !draftCandidate)
            return;
        const protect = (event) => { event.preventDefault(); event.returnValue = ""; };
        window.addEventListener("beforeunload", protect);
        return () => window.removeEventListener("beforeunload", protect);
    }, [busy, attempt, storageCandidate, draftCandidate]);
    function canEdit() { return live.current && !locked && !running.current && !pending.current && !storageBlocked.current; }
    function applyDraft(draft) {
        currentDraft.current = draft;
        queueRef.current = draft.items;
        setQueue(draft.items);
        setSelected(draft.selectedIds);
        setSource(draft.source);
        setKind(draft.kind);
        setReason(draft.reason);
        setDestination(draft.destination);
    }
    function persistDraft(next) {
        let captured;
        try {
            captured = captureBrowserDraft(next);
        }
        catch (error) {
            setError(failureMessage(error));
            return false;
        }
        try {
            window.__batteryWorkflowStorage.setItem(draftKey, JSON.stringify(captured));
            applyDraft(captured);
            setDraftCandidate(null);
            storageBlocked.current = false;
            setStorageError("");
            return true;
        }
        catch {
            storageBlocked.current = true;
            setDraftCandidate(captured);
            setStorageError("This tab could not preserve the removal review draft. No replacement queue change or confirmation will be accepted. Restore browser storage to retain the exact review.");
            return false;
        }
    }
    function changeDraft(patch) { if (canEdit())
        persistDraft({ ...currentDraft.current, ...patch }); }
    function addBattery(battery) {
        if (groupRef && !group?.batteryIds.includes(battery.id)) {
            setError("This battery is outside the reviewed group, or the group changed. Reopen the group to review its members.");
            return;
        }
        if (!canEdit())
            return;
        const current = data.batteries.find(item => item.id === battery.id);
        if (!current || !eligible(current) || completedIds.has(current.id)) {
            setError("Only active batteries that are not in use can enter this queue. Return a borrowed battery first.");
            return;
        }
        if (queueRef.current.some(item => item.batteryId === current.id)) {
            setNotice(`${current.id} is already queued.`);
            return;
        }
        if (queueRef.current.length >= 100) {
            setError("Confirm this queue before adding more batteries. A request supports up to 100 batteries.");
            return;
        }
        if (persistDraft({ ...currentDraft.current, items: [...queueRef.current, { batteryId: current.id, version: current.version, tagId: current.tagId, name: current.name }], selectedIds: [...currentDraft.current.selectedIds, current.id] })) {
            setError("");
            setNotice(`${current.id} added to the reviewed queue. Nothing has been removed yet.`);
        }
    }
    function readTag() {
        if (!canEdit() || source !== "tag_entry")
            return;
        const exact = tag.trim(), matches = data.batteries.filter(battery => battery.tagId === exact);
        if (!exact) {
            setError("Enter a registered tag identifier.");
            return;
        }
        if (matches.length !== 1) {
            setError("This tag does not identify exactly one registered battery in this inventory.");
            return;
        }
        addBattery(matches[0]);
        setTag("");
    }
    function removeQueued(id) {
        if (!canEdit())
            return;
        if (persistDraft({ ...currentDraft.current, items: queueRef.current.filter(item => item.batteryId !== id), selectedIds: currentDraft.current.selectedIds.filter(item => item !== id) }))
            setError("");
    }
    function persist(next) {
        try {
            if (next)
                window.__batteryWorkflowStorage.setItem(storageKey, JSON.stringify(next));
            else
                window.__batteryWorkflowStorage.removeItem(storageKey);
            pending.current = next;
            storageBlocked.current = false;
            setAttempt(next);
            setStorageCandidate(null);
            setStorageError("");
            return true;
        }
        catch {
            storageBlocked.current = true;
            setStorageCandidate(next || pending.current);
            setStorageError("This tab could not preserve or clear the exact removal request. No new request will be sent. Restore browser storage and retry the preserved request.");
            return false;
        }
    }
    function restoreRecovery() {
        if (busy || contextLocked)
            return;
        const captured = storageCandidate || pending.current, review = draftCandidate || currentDraft.current;
        if (captured) {
            if (!persistDraft(withExactRequest(review, captured, data)) || !persist(captured))
                return;
        }
        else if (draftCandidate)
            persistDraft(draftCandidate);
    }
    async function confirm(ids, retry = false) {
        if (!live.current || busy || running.current || contextLocked || (!retry && !canEdit()) || (retry && !pending.current))
            return;
        running.current = true;
        setBusy(true);
        setError("");
        setNotice("");
        let captured = pending.current;
        try {
            if (!captured) {
                const items = queueRef.current.filter(item => ids.includes(item.batteryId));
                if (!items.length)
                    throw new Error("Choose at least one queued battery to confirm.");
                if (items.some(item => !sameBinding(data.batteries.find(battery => battery.id === item.batteryId), item)))
                    throw new Error("A queued battery changed or is now unavailable. Remove that queue item, review its current record and add it again before confirming.");
                const review = currentDraft.current;
                captured = browserAttempt(captureLifecycleAttempt(context.actorAccountId, context.dataset, { requestId: crypto.randomUUID(), kind: review.kind, reason: review.reason, destination: review.kind === "permanently_removed" ? review.destination.trim() || null : null, source: review.source, items: items.map(({ batteryId, version, tagId }) => ({ batteryId, version, tagId })), ...(review.teachingGroup ? { teachingGroup: review.teachingGroup } : {}) }));
                if (!persistDraft(review)) {
                    setStorageCandidate(captured);
                    return;
                }
                if (!persist(captured))
                    return;
            }
            const result = await write("lifecycle", captured.payload), receipt = verifyLifecycleReceipt(result, captured);
            if (!live.current) {
                try {
                    const saved = recoverLifecycleSession(window.__batteryWorkflowStorage.getItem(storageKey), context.actorAccountId, context.dataset);
                    if (saved?.payload.requestId === captured.payload.requestId) {
                        const review = recoverBrowserDraft(window.__batteryWorkflowStorage.getItem(draftKey), context.actorAccountId, context.dataset);
                        if (review) {
                            const committed = new Set(receipt.items.map(item => item.batteryId));
                            window.__batteryWorkflowStorage.setItem(draftKey, JSON.stringify(captureBrowserDraft({ ...review, items: review.items.filter(item => !committed.has(item.batteryId)), selectedIds: review.selectedIds.filter(id => !committed.has(id)) })));
                            window.__batteryWorkflowStorage.removeItem(storageKey);
                        }
                    }
                }
                catch { /* Retain the verified request for exact replay when storage cannot be cleared. */ }
                return;
            }
            setCompleted(receipts => receipts.some(saved => saved.requestId === receipt.requestId) ? receipts : [...receipts, receipt]);
            const committed = new Set(receipt.items.map(item => item.batteryId));
            setNotice(`${receipt.items.length} ${receipt.items.length === 1 ? "battery" : "batteries"} recorded as ${lifecycleLabel(receipt.kind).toLowerCase()}. ${receipt.replayed ? "Saved result recovered." : "The queue is ready for the next review."}`);
            if (!persistDraft({ ...currentDraft.current, items: queueRef.current.filter(item => !committed.has(item.batteryId)), selectedIds: currentDraft.current.selectedIds.filter(id => !committed.has(id)) }))
                return;
            persist(null);
            try {
                await onChanged?.();
            }
            catch {
                if (live.current)
                    setError("The removal was recorded, but the inventory display could not refresh. Its verified receipt remains below.");
            }
        }
        catch (error) {
            if (!live.current)
                return;
            if (captured && lifecycleFailureStatus(error) === "rejected")
                persist(null);
            setError(captured && lifecycleFailureStatus(error) === "unknown" ? `${failureMessage(error)} The outcome is unconfirmed. Retry this exact removal before confirming another request.` : failureMessage(error));
        }
        finally {
            running.current = false;
            if (live.current)
                setBusy(false);
        }
    }
    useEffect(() => {
        if (initialDraftPreserved.current)
            return;
        initialDraftPreserved.current = true;
        if (initialIds.length && recovery.draft.items.length && !recovery.invalid && !recovery.attempt)
            persistDraft(currentDraft.current);
    });
    return _jsxs("section", { className: "removal-station", "aria-busy": busy, children: [groupRef && _jsxs("p", { className: "group-context-banner", children: ["Teaching group: ", _jsx("strong", { children: group?.name ?? "Previously reviewed group" }), ". Removal records retain the reviewed group and actual members."] }), _jsxs("div", { className: "scan-station-header station-exit-bar", children: [_jsxs("div", { children: [_jsx("h2", { children: "Retire or remove batteries" }), _jsx("p", { children: "Queue active batteries, optionally add a reason and confirm all or selected items. Both staff and administrators may use this workflow." }), _jsx("p", { className: "station-exit-hint", children: locked ? "Resolve the current confirmation or storage issue before leaving this workflow." : "Choose Exit removal to restore sidebar navigation. Your reviewed queue is kept in this tab." })] }), onExit && _jsxs(Button, { type: "button", size: "lg", className: "station-exit-button", disabled: locked, onClick: () => { if (!locked && !running.current)
                            onExit(); }, children: [_jsx(LogOut, { size: 20 }), "Exit removal"] })] }), _jsxs("div", { className: "scan-station-info connection-message", children: [_jsx(ScanLine, { size: 18 }), _jsxs("span", { children: [_jsx("strong", { children: "No real RFID reader is connected." }), " Manual selection and tag entry only prepare a reviewed queue. This tab preserves the queue and settings for the same account and inventory. Confirmation preserves each asset and its complete history; it never returns an active loan automatically."] })] }), !contextMatches && _jsx("p", { role: "alert", className: "form-error", children: "The account or inventory changed. Reopen this workflow with the original account and inventory to resolve the captured request." }), _jsxs("div", { className: "scan-station-toolbar detail-card asset-station-guide", children: [_jsxs("div", { children: [_jsx("strong", { children: "Add batteries \u2192 Review final status \u2192 Confirm" }), _jsx("p", { className: "field-hint", children: "Review up to 100 batteries before confirming. Return any active loans through Scan return first." })] }), _jsxs("span", { className: "asset-station-progress", children: [queue.length, " queued \u00B7 ", selected.length, " selected \u00B7 ", completed.reduce((total, receipt) => total + receipt.items.length, 0), " completed"] })] }), _jsxs("div", { className: "removal-columns", children: [_jsxs("div", { className: "removal-panel", children: [_jsx("h3", { children: "Add batteries to the queue" }), _jsxs("div", { className: "removal-actions", children: [_jsx(Button, { type: "button", variant: source === "manual_selection" ? "default" : "outline", onClick: () => { if (canEdit() && !queueRef.current.length) {
                                            changeDraft({ source: "manual_selection" });
                                            setError("");
                                        } }, disabled: locked || !!queue.length, children: "Manual selection" }), _jsx(Button, { type: "button", variant: source === "tag_entry" ? "default" : "outline", onClick: () => { if (canEdit() && !queueRef.current.length) {
                                            changeDraft({ source: "tag_entry" });
                                            setError("");
                                        } }, disabled: locked || !!queue.length, children: "Tag entry" })] }), _jsx("p", { className: "field-hint", children: "A queue uses one input source. Clear or confirm its items before switching sources. Batteries in use must be returned first." }), source === "manual_selection" ? _jsxs(_Fragment, { children: [_jsx(BatteryFilterControls, { data: data, filters: filters, onChange: patch => { if (canEdit())
                                            setFilters(previous => ({ ...previous, ...patch })); }, onClear: () => { if (canEdit())
                                            setFilters(defaultInventoryFilter()); }, disabled: locked, fixedGroup: !!groupRef, showLifecycle: false, scopeNote: "Only active batteries in store can be queued. Filters do not change the reviewed queue or exact tag entry." }), filterError && _jsx("p", { className: "form-error", role: "alert", children: filterError }), _jsxs("p", { className: "field-hint", children: [matching.length, " available batteries"] }), _jsxs("div", { className: "removal-candidates", children: [matching.map(battery => _jsxs(Button, { type: "button", variant: "outline", className: "removal-candidate", onClick: event => { if (source === "manual_selection" && !hasRowTextSelection(event))
                                                    addBattery(battery); }, disabled: locked || queue.length >= 100, "aria-label": `Queue ${battery.id}`, children: [_jsxs("strong", { children: [battery.id, " \u00B7 ", battery.name] }), _jsxs("span", { children: [battery.model || "Model not recorded", " \u00B7 ", battery.tagId || "No tag assigned"] }), _jsxs("small", { children: [battery.ownerName, " \u00B7 In store"] })] }, battery.id)), !matching.length && _jsx("p", { className: "empty-hint", children: "No matching available batteries. Clear filters or return an active loan first." })] })] }) : _jsxs("div", { className: "form-field", children: [_jsx(Label, { htmlFor: "removal-tag", children: "Registered tag identifier" }), _jsx(Input, { id: "removal-tag", value: tag, onChange: event => { if (canEdit())
                                            setTag(event.target.value); }, onKeyDown: event => { if (event.key === "Enter") {
                                            event.preventDefault();
                                            readTag();
                                        } }, placeholder: "Enter an exact registered tag\u2026", disabled: contextLocked, readOnly: locked }), _jsx(Button, { type: "button", variant: "outline", onClick: readTag, disabled: locked || !tag.trim(), children: "Add tag to queue" })] })] }), _jsxs("div", { className: "removal-panel", children: [_jsxs("div", { className: "removal-panel-heading", children: [_jsx("h3", { children: "Reviewed queue" }), _jsxs("span", { children: [queue.length, "/100 queued \u00B7 ", selected.length, " selected"] })] }), _jsxs("div", { className: "removal-actions", children: [_jsx(Button, { type: "button", variant: "outline", size: "sm", onClick: () => { changeDraft({ selectedIds: queueRef.current.map(item => item.batteryId) }); }, disabled: locked || !queue.length, children: "Select all queued" }), _jsx(Button, { type: "button", variant: "outline", size: "sm", onClick: () => { changeDraft({ selectedIds: [] }); }, disabled: locked || !selected.length, children: "Deselect all queued" }), _jsx(Button, { type: "button", variant: "outline", size: "sm", onClick: () => { if (canEdit() && persistDraft({ ...currentDraft.current, items: [], selectedIds: [] })) {
                                            setNotice("");
                                            setError("");
                                        } }, disabled: locked || !queue.length, children: "Clear queue" })] }), _jsxs("div", { className: "removal-queue", children: [queue.map(item => _jsxs("div", { className: "removal-queue-item battery-selection-row", "data-selectable": !locked, "data-selected": selected.includes(item.batteryId), "data-state": selected.includes(item.batteryId) ? "selected" : undefined, onClick: event => { if (canEdit() && shouldToggleSelection(event))
                                            changeDraft({ selectedIds: currentDraft.current.selectedIds.includes(item.batteryId) ? currentDraft.current.selectedIds.filter(id => id !== item.batteryId) : [...currentDraft.current.selectedIds, item.batteryId] }); }, children: [_jsxs("label", { htmlFor: `removal-queued-${item.batteryId}`, onClick: event => { if (locked || hasRowTextSelection(event))
                                                    event.preventDefault(); }, children: [_jsx(Checkbox, { id: `removal-queued-${item.batteryId}`, checked: selected.includes(item.batteryId), disabled: locked, onCheckedChange: checked => { changeDraft({ selectedIds: checked === true ? [...new Set([...currentDraft.current.selectedIds, item.batteryId])] : currentDraft.current.selectedIds.filter(id => id !== item.batteryId) }); } }), _jsxs("span", { children: [_jsxs("strong", { children: [item.batteryId, " \u00B7 ", item.name] }), _jsxs("small", { children: ["Reviewed version ", item.version, " \u00B7 ", item.tagId || "No tag assigned"] }), stale.some(stale => stale.batteryId === item.batteryId) && _jsx("small", { className: "form-error", children: "Current record changed; review again before a new confirmation." })] })] }), _jsxs("div", { children: [onDetail && _jsx(Button, { type: "button", size: "sm", variant: "ghost", onClick: () => onDetail(item.batteryId), disabled: busy, children: "Details" }), _jsx(Button, { type: "button", size: "sm", variant: "ghost", onClick: () => removeQueued(item.batteryId), disabled: locked, "aria-label": `Remove ${item.batteryId} from queue`, children: _jsx(Trash2, { size: 15 }) })] })] }, item.batteryId)), !queue.length && _jsx("p", { className: "empty-hint", children: "Choose batteries to begin. No removal is recorded by adding a queue item." })] }), _jsxs("div", { className: "form-field", children: [_jsx(Label, { htmlFor: "removal-kind", children: "Final status" }), _jsxs(Select, { value: kind, disabled: locked, onValueChange: (next) => { changeDraft({ kind: next }); }, children: [_jsx(SelectTrigger, { id: "removal-kind", children: _jsx(SelectValue, {}) }), _jsxs(SelectContent, { children: [_jsx(SelectItem, { value: "scrapped", children: "Scrapped" }), _jsx(SelectItem, { value: "permanently_removed", children: "Permanently removed" })] })] }), _jsx("p", { className: "field-hint", children: "Scrapped records a battery retired from use. Permanently removed records stock that has left this inventory. Neither deletes history or certifies physical disposal." })] }), _jsxs("div", { className: "form-field", children: [_jsx(Label, { htmlFor: "removal-reason", children: "Reason \u2014 optional" }), _jsx(Textarea, { id: "removal-reason", value: reason, onChange: event => { changeDraft({ reason: event.target.value }); }, disabled: locked, maxLength: 1000, placeholder: "Add a reason for this batch, if available\u2026" })] }), kind === "permanently_removed" && _jsxs("div", { className: "form-field", children: [_jsx(Label, { htmlFor: "removal-destination", children: "Destination \u2014 optional" }), _jsx(Input, { id: "removal-destination", value: destination, onChange: event => { changeDraft({ destination: event.target.value }); }, disabled: locked, maxLength: 200, placeholder: "Known transfer or disposal destination\u2026" })] }), _jsxs("div", { className: "removal-actions", children: [_jsx(ReceiptAction, { type: "button", pending: busy, confirmation: removalConfirmation, reviewKey: removalReviewKey, actionLabel: "Confirm selected", onClick: () => confirm(currentDraft.current.selectedIds), disabled: locked || !selected.length, children: "Confirm selected" }), _jsx(ReceiptAction, { type: "button", variant: "outline", pending: busy, confirmation: removalConfirmation, reviewKey: removalReviewKey, actionLabel: "Confirm all queued", onClick: () => confirm(currentDraft.current.items.map(item => item.batteryId)), disabled: locked || !queue.length, children: "Confirm all queued" })] })] })] }), attempt && _jsxs("div", { className: "removal-pending", children: [_jsxs("strong", { children: ["Preserved removal: ", attempt.payload.items.length, " batteries \u00B7 ", lifecycleLabel(attempt.payload.kind)] }), _jsx("p", { className: "field-hint", children: "The original account, inventory, reason, bindings and request ID are retained. This result may already be saved. Resolve this exact request before preparing another confirmation." }), _jsx(Button, { type: "button", variant: "outline", onClick: () => confirm([], true), disabled: busy || contextLocked, children: "Retry exact removal" })] }), notice && _jsxs("div", { role: "status", className: "removal-success", children: [_jsx(CheckCircle2, { size: 17 }), _jsx("span", { children: notice })] }), error && _jsx("p", { role: "alert", className: "form-error", children: error }), storageError && _jsxs("div", { role: "alert", className: "form-error", children: [_jsx("p", { children: storageError }), (storageCandidate || draftCandidate || attempt) && _jsx(Button, { type: "button", variant: "outline", size: "sm", onClick: restoreRecovery, disabled: busy || contextLocked, children: "Restore request recovery" })] }), completed.length > 0 && _jsxs("div", { className: "removal-panel", children: [_jsx("h3", { children: "Recorded this session" }), _jsx("div", { className: "removal-results", children: _jsxs(Table, { children: [_jsx(TableHeader, { children: _jsxs(TableRow, { children: [_jsx(TableHead, { children: "BATTERY" }), _jsx(TableHead, { children: "STATUS" }), _jsx(TableHead, { children: "RECORDED AT" }), _jsx(TableHead, { children: "SOURCE" })] }) }), _jsx(TableBody, { children: completed.flatMap(receipt => receipt.items.map(item => _jsxs(TableRow, { children: [_jsx(TableCell, { children: onDetail ? _jsx("button", { type: "button", className: "record-link", onClick: () => onDetail(item.batteryId), children: item.batteryId }) : item.batteryId }), _jsx(TableCell, { children: lifecycleLabel(item.status) }), _jsx(TableCell, { children: formatTime(receipt.at) }), _jsx(TableCell, { children: receipt.source === "tag_entry" ? "Staff tag entry" : "Staff manual selection" })] }, `${receipt.requestId}/${item.batteryId}`))) })] }) })] })] });
}
function readRetiredReview(data, enabled) {
    if (!enabled || typeof window.__batteryWorkflowStorage === "undefined")
        return { review: null, error: "" };
    try {
        const raw = window.__batteryWorkflowStorage.getItem(retiredAssetStorageKey(data.user.id, data.dataset));
        const attempt = recoverRetiredAssetAttempt(raw, data.user.id, data.dataset);
        if (raw && !attempt)
            return { review: null, error: "The saved retired battery request could not be read. It has not been replaced or discarded. Restore readable recovery before starting another action." };
        return { review: attempt ? { kind: attempt.payload.kind, batteries: attempt.payload.items.flatMap(item => data.batteries.find(battery => battery.id === item.batteryId) ?? []), attempt } : null, error: "" };
    }
    catch (error) {
        return { review: null, error: `Saved retired battery recovery is unavailable: ${failureMessage(error)}` };
    }
}
export function RemovalHistory({ data, onDetail, onDownload, write, onChanged, onBusyChange, paused = false }) {
    const [filters, setFilters] = useState(() => ({ ...defaultInventoryFilter(), lifecycle: "all" }));
    const [selection, setSelection] = useState(() => ({ context: `${data.user.id}/${data.dataset}`, ids: [] }));
    const [recovery, setRecovery] = useState(() => readRetiredReview(data, !!write));
    const [review, setReview] = useState(recovery.review);
    const historyContext = `${data.user.id}/${data.dataset}`;
    const priorContext = useRef(historyContext);
    const retired = data.batteries.filter(battery => battery.lifecycleStatus !== "active");
    const knownIds = new Set(retired.map(battery => battery.id));
    const selected = selection.context === historyContext ? selection.ids.filter(id => knownIds.has(id)) : [];
    const selectedAssets = retired.filter(battery => selected.includes(battery.id));
    const { batteries: matching, error: filterError } = getFilteredBatteries(data, filters, retired);
    const permissions = getRolePermissions(data.user.role);
    const operationEligible = selected.length > 0 && selected.length <= 100 && selectedAssets.every(battery => battery.lifecycleStatus === "scrapped" && !battery.loanId);
    const selectionLocked = paused || !!review || !!recovery.error;
    useEffect(() => {
        if (priorContext.current !== historyContext) {
            priorContext.current = historyContext;
            setSelection({ context: historyContext, ids: [] });
            const next = readRetiredReview(data, !!write);
            setRecovery(next);
            setReview(next.review);
        }
    }, [historyContext, data, write]);
    useEffect(() => { if (recovery.error)
        onBusyChange?.(true); return () => { if (recovery.error)
        onBusyChange?.(false); }; }, [recovery.error, onBusyChange]);
    function changeSelection(id, checked) {
        if (selectionLocked || !knownIds.has(id))
            return;
        setSelection(previous => {
            const ids = previous.context === historyContext ? previous.ids.filter(value => knownIds.has(value)) : [];
            const include = checked ?? !ids.includes(id);
            return { context: historyContext, ids: include ? [...new Set([...ids, id])] : ids.filter(value => value !== id) };
        });
    }
    function selectMatching(checked) {
        if (selectionLocked)
            return;
        const ids = matching.map(battery => battery.id);
        setSelection(previous => ({ context: historyContext, ids: checked ? [...new Set([...(previous.context === historyContext ? previous.ids.filter(id => knownIds.has(id)) : []), ...ids])] : (previous.context === historyContext ? previous.ids : []).filter(id => knownIds.has(id) && !ids.includes(id)) }));
    }
    function openAction(kind) {
        if (selectionLocked || !write || !operationEligible || !(kind === "purge" ? permissions.purgeRetiredBatteries : permissions.recoverRetiredBatteries))
            return;
        const saved = readRetiredReview(data, true);
        setRecovery(saved);
        if (saved.error)
            return;
        setReview(saved.review ?? { kind, batteries: structuredClone(selectedAssets) });
    }
    function restoreRecovery() {
        const saved = readRetiredReview(data, !!write);
        setRecovery(saved);
        if (saved.review)
            setReview(saved.review);
    }
    const outside = selected.filter(id => !matching.some(battery => battery.id === id)).length;
    return _jsxs("section", { className: "removal-panel", children: [_jsxs("div", { className: "removal-panel-heading", children: [_jsxs("div", { children: [_jsx("h2", { children: "Removal history" }), _jsx("p", { className: "field-hint", children: "Retired assets remain available for details, recorded evidence and complete-history downloads." })] }), onDownload && _jsx(Button, { type: "button", variant: "outline", onClick: () => onDownload(matching.map(battery => battery.id)), disabled: !matching.length, children: "Download matching records" })] }), _jsx(BatteryFilterControls, { data: data, filters: filters, onChange: patch => setFilters(previous => ({ ...previous, ...patch })), onClear: () => setFilters({ ...defaultInventoryFilter(), lifecycle: "all" }), defaultLifecycle: "all", scopeNote: "This view contains retired records only. Search also includes the recorded removal reason and destination. Downloads include every matching record. Filters do not clear selected records." }), filterError && _jsx("p", { className: "form-error", role: "alert", children: filterError }), _jsxs("div", { className: historyStyles.historyToolbar, children: [_jsxs("span", { className: historyStyles.selectionSummary, children: [_jsxs("strong", { children: [selected.length, " selected"] }), " \u00B7 ", matching.length, " matching records", outside > 0 && ` · ${outside} selected outside current filters`] }), _jsx(Button, { variant: "outline", size: "sm", onClick: () => selectMatching(true), disabled: selectionLocked || !matching.length, children: "Select matching" }), _jsx(Button, { variant: "ghost", size: "sm", onClick: () => { if (!selectionLocked)
                            setSelection({ context: historyContext, ids: [] }); }, disabled: selectionLocked || !selected.length, children: "Clear selections" }), onDownload && _jsx(Button, { variant: "outline", size: "sm", onClick: () => onDownload([...selected]), disabled: !selected.length, children: "Download selected records" }), write && permissions.recoverRetiredBatteries && _jsxs(Button, { size: "sm", onClick: () => openAction("recover"), disabled: selectionLocked || !operationEligible, children: ["Recover selected (", selected.length, ")"] }), write && permissions.purgeRetiredBatteries && _jsxs(Button, { variant: "outline", size: "sm", onClick: () => openAction("purge"), disabled: selectionLocked || !operationEligible, children: ["Delete selected records (", selected.length, ")"] })] }), selected.length > 100 && _jsx("p", { className: "field-hint", children: "Recover or delete up to 100 reviewed batteries per operation. Downloads retain every selected record." }), selectedAssets.some(battery => battery.lifecycleStatus !== "scrapped") && _jsx("p", { className: "field-hint", children: "Only scrapped batteries can be recovered or deleted here. Permanently removed records remain available for details and full downloads." }), recovery.error && _jsxs("div", { className: "form-error", role: "alert", children: [_jsx("p", { children: recovery.error }), _jsx(Button, { variant: "outline", onClick: restoreRecovery, children: "Restore request recovery" })] }), _jsx("div", { className: "removal-results", children: _jsxs(Table, { className: historyStyles.historyTable, children: [_jsx(TableHeader, { children: _jsxs(TableRow, { children: [_jsx(TableHead, { className: "checkbox-cell", children: _jsx(Checkbox, { "aria-label": "Select all matching retired records", checked: matching.length > 0 && matching.every(battery => selected.includes(battery.id)) ? true : matching.some(battery => selected.includes(battery.id)) ? "indeterminate" : false, onCheckedChange: checked => selectMatching(checked === true), disabled: selectionLocked || !matching.length }) }), _jsx(TableHead, { children: "Battery" }), _jsx(TableHead, { children: "Status" }), _jsx(TableHead, { children: "Reason / destination" }), _jsx(TableHead, { children: "Recorded at" })] }) }), _jsx(TableBody, { children: matching.map(battery => _jsxs(TableRow, { className: "battery-selection-row", "data-selected": selected.includes(battery.id), "data-selectable": !selectionLocked, "aria-selected": selected.includes(battery.id), onClick: event => { if (shouldToggleSelection(event))
                                    changeSelection(battery.id); }, children: [_jsx(TableCell, { className: "checkbox-cell", children: _jsx(Checkbox, { "aria-label": `Select retired battery ${battery.id}`, checked: selected.includes(battery.id), onCheckedChange: checked => changeSelection(battery.id, checked === true), disabled: selectionLocked }) }), _jsxs(TableCell, { children: [onDetail ? _jsx("button", { type: "button", className: "record-link", onClick: () => onDetail(battery.id), children: battery.id }) : _jsx("strong", { children: battery.id }), _jsx("span", { className: "cell-secondary", children: battery.name })] }), _jsx(TableCell, { children: lifecycleLabel(battery.lifecycleStatus) }), _jsxs(TableCell, { children: [battery.lifecycleReason || "Not recorded", battery.lifecycleDestination && _jsxs("span", { className: "cell-secondary", children: ["Destination: ", battery.lifecycleDestination] })] }), _jsx(TableCell, { children: battery.lifecycleAt ? formatTime(battery.lifecycleAt) : "Not recorded" })] }, battery.id)) })] }) }), !matching.length && _jsx("p", { className: "empty-hint", children: "No retired records match these filters." }), !!data.purgedBatteries?.length && _jsxs("details", { className: historyStyles.deletionEvidence, children: [_jsxs("summary", { children: [_jsx("span", { children: "Deletion evidence" }), _jsxs("span", { children: [data.purgedBatteries.length, " ", data.purgedBatteries.length === 1 ? "record" : "records"] })] }), _jsx("p", { children: "Only the battery ID, deleting account and deletion time remain. Detailed records and history were deleted. These battery IDs remain reserved." }), _jsx("div", { className: historyStyles.deletionEvidenceTable, children: _jsxs(Table, { children: [_jsx(TableHeader, { children: _jsxs(TableRow, { children: [_jsx(TableHead, { children: "Battery ID" }), _jsx(TableHead, { children: "Deleting account ID" }), _jsx(TableHead, { children: "Deleted at" })] }) }), _jsx(TableBody, { children: data.purgedBatteries.map(record => _jsxs(TableRow, { children: [_jsx(TableCell, { children: _jsx("span", { className: historyStyles.identifier, children: record.id }) }), _jsx(TableCell, { children: _jsx("span", { className: historyStyles.accountId, children: record.actorAccountId }) }), _jsx(TableCell, { children: formatTime(record.at) })] }, record.id)) })] }) })] }), review && write && _jsx(RetiredAssetActionDialog, { data: data, review: review, write: write, onChanged: onChanged ?? (() => undefined), onClose: () => { setReview(null); setRecovery({ review: null, error: "" }); }, paused: paused, onBusyChange: onBusyChange, onVerified: receipt => setSelection(previous => ({ context: previous.context, ids: previous.ids.filter(id => !receipt.items.some(item => item.batteryId === id)) })) })] });
}

export function RemovalStation(props) { return _jsx(WorkflowBoundary, {children:_jsx(SharedRemovalStation, {...props})}); }
