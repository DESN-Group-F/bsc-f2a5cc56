"use client";
import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { isActiveBattery } from "../../lib/battery-lifecycle.js";
import { useEffect, useRef, useState } from "react";
import { ScanLine, Trash2, Radio, Plus, RefreshCw } from "lucide-react";
import { Button } from "../ui/button.js";
import { Input } from "../ui/input.js";
import { Label } from "../ui/label.js";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "../ui/dialog.js";
import { Table, TableHeader, TableHead, TableRow, TableBody, TableCell } from "../ui/table.js";
import { RecordPicker } from "./record-picker.js";
import { BatteryFilterControls } from "./battery-filter-controls.js";
import { defaultInventoryFilter } from "../../lib/inventory-query.js";
import { getFilteredBatteries } from "../../lib/battery-selection-query.js";
import { shouldToggleSelection } from "../../lib/client/row-selection.js";
import { formatTime, reloadSessionPage } from "../../lib/client-utils.js";
import { captureMovementAttempt, movementFailureStatus, movementStorageKey, recoverMovementAttempt, verifyMovementReceipt } from "../../lib/movement-session.js";
import { acknowledgeWorkflowStorage } from "../../lib/client/workflow-storage.js";
export function MovementDialog({ draft, data, onClose, write }) {
    const storageKey = movementStorageKey(data.user.id, data.dataset, draft.kind);
    const [recovery] = useState(() => {
        try {
            const raw = window.__batteryWorkflowStorage.getItem(storageKey), attempt = recoverMovementAttempt(raw, data.user.id, data.dataset, draft.kind);
            return { attempt, invalidSaved: raw !== null && !attempt, message: raw !== null && !attempt ? "A saved movement request could not be recovered. No new movement will be sent or replace it. Preserve this tab and ask the administrator to investigate the saved request." : "" };
        }
        catch {
            return { attempt: null, invalidSaved: false, message: "Browser storage is unavailable. No movement can be sent until its exact request can be saved in this tab." };
        }
    });
    const [inventory, setInventory] = useState(data), [ids, setIds] = useState(recovery.attempt?.payload.batteryIds ?? draft.ids);
    const [reviewed, setReviewed] = useState(() => recovery.attempt ? Object.fromEntries(recovery.attempt.reviewed.map(battery => [battery.id, battery])) : Object.fromEntries(draft.ids.flatMap(id => {
        const battery = data.batteries.find(b => b.id === id);
        return battery ? [[id, battery]] : [];
    })));
    const [adding, setAdding] = useState(!recovery.attempt && !draft.ids.length), [allLoans, setAllLoans] = useState(false);
    const [tag, setTag] = useState(""), [picked, setPicked] = useState(""), [message, setMessage] = useState(recovery.message), [busy, setBusy] = useState(false);
    const [filters, setFilters] = useState(() => defaultInventoryFilter());
    const [searchReset, setSearchReset] = useState(0);
    const [attempt, setAttempt] = useState(recovery.attempt), [latestReview, setLatestReview] = useState(null);
    const captured = useRef(attempt), running = useRef(false);
    const locked = busy || !!attempt || recovery.invalidSaved;
    const checkout = draft.kind === "checkout";
    const groupReference = recovery.attempt?.payload.teachingGroup ?? draft.teachingGroup;
    const group = inventory.teachingGroups?.find(group => group.id === groupReference?.id && group.version === groupReference.version);
    const queued = ids.map(id => reviewed[id]).filter(Boolean);
    const allEligible = inventory.batteries.filter(b => (!groupReference || group?.batteryIds.includes(b.id)) && isActiveBattery(b) && (checkout ? !b.loanId : !!b.loanId));
    const eligible = allEligible.filter(b => checkout || allLoans || b.borrowerAccountId === data.user.id);
    const { batteries: candidates, error: filterError } = getFilteredBatteries(inventory, filters, eligible.filter(b => !ids.includes(b.id)));
    useEffect(() => {
        if (!busy && attempt?.status !== "uncertain" && !recovery.invalidSaved)
            return;
        const protect = (event) => { event.preventDefault(); event.returnValue = ""; };
        window.addEventListener("beforeunload", protect);
        return () => window.removeEventListener("beforeunload", protect);
    }, [busy, attempt?.status, recovery.invalidSaved]);
    function persist(next) {
        try {
            const raw = window.__batteryWorkflowStorage.getItem(storageKey), previous = recoverMovementAttempt(raw, data.user.id, data.dataset, draft.kind);
            if (raw !== null && (!previous || !next || JSON.stringify(previous.payload) !== JSON.stringify(next.payload) || JSON.stringify(previous.reviewed) !== JSON.stringify(next.reviewed)))
                throw new Error("The retained original movement changed. It has not been replaced.");
            if (next)
                window.__batteryWorkflowStorage.setItem(storageKey, JSON.stringify(next));
            else
                window.__batteryWorkflowStorage.removeItem(storageKey);
            captured.current = next;
            setAttempt(next);
            window.dispatchEvent(new Event("battery-movement-recovery"));
            return true;
        }
        catch {
            setMessage("Browser storage could not preserve or clear this request. No replacement request will be sent. Restore browser storage and retry the same operation.");
            return false;
        }
    }
    function close() {
        if (running.current || captured.current?.status === "uncertain" || recovery.invalidSaved)
            return;
        if (captured.current) {
            setMessage("Review the current records and deliberately discard the rejected request before closing.");
            return;
        }
        onClose(inventory !== data ? inventory : undefined);
    }
    async function acknowledge() {
        const raw = window.__batteryWorkflowStorage.getItem(storageKey);
        if (raw === null || !captured.current || JSON.stringify(recoverMovementAttempt(raw, data.user.id, data.dataset, draft.kind)) !== JSON.stringify(captured.current))
            throw new Error("The original movement request changed or is unavailable. Preserve recovery data before proceeding.");
        await acknowledgeWorkflowStorage({ remove: [storageKey], expected: { [storageKey]: raw } });
        captured.current = null;
        setAttempt(null);
        window.dispatchEvent(new Event("battery-movement-recovery"));
    }
    function addMany(batteries) {
        if (running.current || captured.current || recovery.invalidSaved)
            return;
        if (ids.length + batteries.length > 100) {
            setMessage("A movement can include up to 100 batteries. Confirm this list before starting another batch.");
            return;
        }
        setIds([...ids, ...batteries.map(b => b.id)]);
        setReviewed({ ...reviewed, ...Object.fromEntries(batteries.map(b => [b.id, b])) });
        setTag("");
        setPicked("");
        setMessage("");
        setLatestReview(null);
    }
    function add(id) {
        if (running.current || captured.current || recovery.invalidSaved)
            return;
        const battery = inventory.batteries.find(b => b.id === id);
        if (!battery) {
            setMessage("This battery is not registered in the inventory. No changes were made.");
            return;
        }
        if (groupReference && !group?.batteryIds.includes(id)) {
            setMessage("This battery is outside the reviewed teaching group. Reopen the group to review its members.");
            return;
        }
        if (!isActiveBattery(battery)) {
            setMessage(`${battery.id} has been retired or permanently removed.`);
            return;
        }
        if (checkout && battery.loanId) {
            setMessage(`${battery.id} is already in use by ${battery.borrowerName}.`);
            return;
        }
        if (!checkout && !battery.loanId) {
            setMessage(`${battery.id} has no active loan to return.`);
            return;
        }
        if (ids.includes(id)) {
            setMessage(`${id} is already in this list.`);
            return;
        }
        addMany([battery]);
    }
    function addTag() {
        const battery = inventory.batteries.find(b => b.tagId === tag.trim());
        if (battery)
            add(battery.id);
        else
            setMessage("This tag identifier is not registered. Check the identifier or register the battery first.");
    }
    function remove(id) { if (running.current || captured.current || recovery.invalidSaved)
        return; setIds(ids.filter(value => value !== id)); setLatestReview(null); }
    function changeFilters(patch) { if (running.current || captured.current || recovery.invalidSaved)
        return; setFilters(previous => ({ ...previous, ...patch })); }
    function clearFilters() { if (running.current || captured.current || recovery.invalidSaved)
        return; setFilters(defaultInventoryFilter()); setSearchReset(previous => previous + 1); }
    async function runAttempt(original, alreadyUncertain) {
        if (running.current || recovery.invalidSaved)
            return;
        running.current = true;
        setBusy(true);
        setMessage("");
        const sending = { ...original, status: "uncertain", message: "Waiting for the server to confirm this exact request." };
        try {
            if (!persist(sending))
                return;
            const result = await write("movement", sending.payload);
            verifyMovementReceipt(result, sending.payload, data.user.id);
            await acknowledge();
            onClose();
        }
        catch (error) {
            const status = movementFailureStatus(error, alreadyUncertain), statusCode = error?.status;
            const failed = { ...sending, status, message: status === "uncertain" ? `Result uncertain. ${error.message} Retry the original request before editing or closing.` : error.message, ...(statusCode ? { statusCode } : {}) };
            if (!persist(failed)) {
                captured.current = failed;
                setAttempt(failed);
            }
        }
        finally {
            running.current = false;
            setBusy(false);
        }
    }
    async function confirm() {
        if (running.current || captured.current || recovery.invalidSaved || groupReference && !group)
            return;
        try {
            await runAttempt(captureMovementAttempt(draft.kind, queued, data.user.id, data.dataset, crypto.randomUUID(), groupReference), false);
        }
        catch (error) {
            setMessage(error.message);
        }
    }
    async function reviewLatest() {
        if (running.current || captured.current?.status !== "rejected")
            return;
        running.current = true;
        setBusy(true);
        setMessage("");
        try {
            const response = await fetch(`/api/inventory?dataset=${data.dataset}`, { cache: "no-store" });
            if (response.status === 401)
                reloadSessionPage("/signin");
            const latest = await response.json();
            if (!response.ok)
                throw new Error(latest.error || "The latest loans could not be loaded.");
            if (latest.dataset !== data.dataset || latest.user?.id !== data.user.id || !Array.isArray(latest.batteries))
                throw new Error("The staff account or inventory changed. Restore the original sign-in before reviewing this captured request.");
            setLatestReview({ inventory: latest, changes: queued.map(before => ({ before, after: latest.batteries.find(b => b.id === before.id) })) });
        }
        catch (error) {
            setMessage(error.message);
        }
        finally {
            running.current = false;
            setBusy(false);
        }
    }
    async function acceptLatest() {
        if (!latestReview || running.current || captured.current?.status !== "rejected")
            return;
        try {
            await acknowledge();
        }
        catch (error) {
            setMessage(error.message);
            return;
        }
        const next = latestReview.changes.flatMap(({ after }) => after && isActiveBattery(after) && (checkout ? !after.loanId : !!after.loanId) ? [after] : []);
        setIds(next.map(b => b.id));
        setReviewed(Object.fromEntries(next.map(b => [b.id, b])));
        setInventory(latestReview.inventory);
        setLatestReview(null);
        setMessage(checkout ? "The latest reviewed batteries are now in your draft. Unavailable or batteries in use were removed. Review the updated list before confirming a new request." : "The reviewed latest loans are now in your draft. Batteries without an active loan were removed. Confirm only after reviewing the updated list.");
        if (!next.length)
            setAdding(true);
    }
    async function discardRejected() {
        if (!latestReview || running.current || captured.current?.status !== "rejected")
            return;
        try {
            await acknowledge();
        }
        catch (error) {
            setMessage(error.message);
            return;
        }
        onClose(latestReview.inventory);
    }
    return _jsx(Dialog, { open: true, onOpenChange: open => !open && close(), children: _jsxs(DialogContent, { className: "movement-dialog", showCloseButton: !locked, onEscapeKeyDown: event => { if (locked)
                event.preventDefault(); }, onInteractOutside: event => { if (locked)
                event.preventDefault(); }, children: [_jsxs(DialogHeader, { children: [_jsx(DialogTitle, { children: checkout ? "Check out batteries" : "Return batteries" }), _jsx(DialogDescription, { children: checkout ? "Review your selected batteries and confirm with your own staff account." : "Review each selected loan before confirming. You may receive batteries checked out by another staff member." })] }), checkout && _jsxs("div", { className: "detail-card", children: [_jsxs("div", { className: "key-value", children: [_jsx("span", { children: "Checked out to" }), _jsxs("strong", { children: [data.user.displayName, " \u00B7 ", data.user.username] })] }), _jsx("p", { children: "Your signed-in staff account is responsible for this checkout. The asset owner stays the same." })] }), groupReference && _jsxs("p", { className: "group-context-banner", children: ["Teaching group: ", _jsx("strong", { children: group?.name ?? "Previously reviewed group" }), " \u00B7 ", queued.length, " selected members. Review and confirm this operation; its group name and actual members are recorded in shared Activity."] }), groupReference && !group && !attempt && _jsx("p", { className: "form-error", role: "alert", children: "The reviewed teaching group changed or is unavailable. Cancel and reopen the group to review its current members before starting a new operation." }), !!draft.excludedIds?.length && _jsxs("p", { className: "field-hint", children: ["Members unavailable for this ", checkout ? "checkout" : "return", ": ", draft.excludedIds.join(", "), ". They will remain unchanged. Only the review list below will be processed."] }), _jsxs("div", { className: "review-title", children: [_jsx("strong", { children: "Review list" }), _jsxs("span", { children: [queued.length, " ", queued.length === 1 ? "battery" : "batteries"] })] }), _jsxs("div", { className: "review-list", children: [_jsxs(Table, { children: [_jsx(TableHeader, { children: _jsxs(TableRow, { children: [_jsx(TableHead, { children: "BATTERY" }), _jsx(TableHead, { children: checkout ? "RESPONSIBLE OWNER" : "CURRENT HOLDER" }), _jsx(TableHead, { children: _jsx("span", { className: "sr-only", children: "Remove" }) })] }) }), _jsx(TableBody, { children: queued.map(b => _jsxs(TableRow, { children: [_jsxs(TableCell, { children: [_jsx("strong", { children: b.id }), _jsx("span", { className: "cell-secondary", children: b.name })] }), _jsx(TableCell, { children: checkout ? b.ownerName : _jsxs(_Fragment, { children: [b.borrowerName, _jsxs("span", { className: "cell-secondary", children: ["Checked out ", formatTime(b.checkedOutAt)] })] }) }), _jsx(TableCell, { children: _jsx(Button, { variant: "ghost", size: "icon", "aria-label": `Remove ${b.id}`, disabled: locked, onClick: () => remove(b.id), children: _jsx(Trash2, { size: 16 }) }) })] }, b.id)) })] }), !queued.length && _jsxs("div", { className: "queue-empty", children: [_jsx(ScanLine, { size: 26 }), _jsxs("p", { children: ["Add registered batteries below to prepare this ", checkout ? "checkout" : "return", "."] })] })] }), _jsx(Button, { variant: "outline", className: "justify-start", "aria-expanded": adding, "aria-controls": "movement-add-more", onClick: () => setAdding(!adding), disabled: locked, children: adding ? "− Hide additional batteries" : "+ Add more batteries" }), adding && _jsxs("div", { id: "movement-add-more", className: "form-stack", children: [_jsx("p", { className: "time-note", children: "Add already registered batteries to this review list. These optional inputs do not create new battery records." }), !checkout && _jsxs(_Fragment, { children: [_jsxs("div", { className: "flex flex-wrap gap-2", role: "group", "aria-label": "Available return loans", children: [_jsx(Button, { variant: allLoans ? "outline" : "default", onClick: () => { setAllLoans(false); setPicked(""); }, disabled: locked, children: "My outstanding loans" }), _jsx(Button, { variant: allLoans ? "default" : "outline", onClick: () => { setAllLoans(true); setPicked(""); }, disabled: locked, children: "All batteries in use" })] }), _jsx("p", { className: "time-note", children: allLoans ? "Any staff member may receive these loans. The original holder and your return action remain recorded." : "Showing active loans linked to your staff account. Explicitly selected batteries stay in the review list." })] }), _jsx(BatteryFilterControls, { data: inventory, filters: filters, onChange: changeFilters, onClear: clearFilters, disabled: locked, fixedGroup: !!groupReference, showLifecycle: false, scopeNote: `Filters narrow the available ${checkout ? "in-store batteries" : allLoans ? "active loans" : "loans linked to your account"}${groupReference ? " within this teaching group" : ""}. Your review list and exact tag lookup stay unchanged.` }), filterError && _jsx("p", { className: "form-error", role: "alert", children: filterError }), _jsxs("p", { className: "field-hint", children: [candidates.length, " matching batteries available to add."] }), _jsxs("div", { className: "reader-entry", children: [_jsxs("div", { className: "form-field", children: [_jsx(Label, { htmlFor: "movement-battery", children: "Choose a matching battery" }), _jsx(RecordPicker, { id: "movement-battery", options: candidates.map(b => ({ id: b.id, label: `${b.id} · ${b.name}${!checkout ? ` · ${b.borrowerName}` : ""}` })), value: picked, onChange: id => { setPicked(id); if (id)
                                                add(id); }, placeholder: "Choose a battery\u2026", disabled: locked, resetKey: searchReset, showClearFilters: false })] }), _jsxs("div", { className: "form-field", children: [_jsx(Label, { htmlFor: "tag-input", children: "Existing tag identifier (optional)" }), _jsxs("div", { className: "inline-input", children: [_jsx(Input, { id: "tag-input", value: tag, onChange: event => setTag(event.target.value), onKeyDown: event => { if (event.key === "Enter") {
                                                        event.preventDefault();
                                                        addTag();
                                                    } }, placeholder: data.dataset === "demo" ? "e.g. DEMO-TAG-001" : "Enter a registered tag identifier", disabled: locked }), _jsxs(Button, { variant: "outline", onClick: addTag, disabled: !tag.trim() || locked, children: [_jsx(Plus, {}), "Add"] })] })] })] }), !checkout && _jsxs(_Fragment, { children: [_jsxs("div", { className: "review-title", children: [_jsx("strong", { children: allLoans ? "Available batteries in use" : "Your outstanding batteries" }), _jsx("span", { children: candidates.length })] }), candidates.length ? _jsx("div", { className: "review-list", children: _jsxs(Table, { children: [_jsx(TableHeader, { children: _jsxs(TableRow, { children: [_jsx(TableHead, { children: "BATTERY" }), _jsx(TableHead, { children: "CURRENT HOLDER" }), _jsx(TableHead, { children: _jsx("span", { className: "sr-only", children: "Add" }) })] }) }), _jsx(TableBody, { children: candidates.slice(0, 100).map(b => _jsxs(TableRow, { className: !locked && ids.length < 100 ? "cursor-pointer" : undefined, onClick: event => { if (!locked && ids.length < 100 && shouldToggleSelection(event))
                                                        add(b.id); }, children: [_jsxs(TableCell, { children: [_jsx("strong", { children: b.id }), _jsx("span", { className: "cell-secondary", children: b.name })] }), _jsxs(TableCell, { children: [b.borrowerName, _jsxs("span", { className: "cell-secondary", children: ["Checked out ", formatTime(b.checkedOutAt)] })] }), _jsx(TableCell, { children: _jsxs(Button, { variant: "outline", size: "sm", onClick: () => add(b.id), disabled: locked || ids.length >= 100, "aria-label": `Add ${b.id}`, children: [_jsx(Plus, { size: 16 }), "Add"] }) })] }, b.id)) })] }) }) : _jsx("p", { className: "time-note", children: allLoans ? "No additional active loans match these filters. Clear filters to review all available loans." : "No additional loans linked to your account match these filters. Clear filters, or choose All batteries in use to receive another holder's loan." }), candidates.length > 100 && _jsx("p", { className: "time-note", children: "The list shows the first 100 available batteries. Search above to find any other registered battery." })] }), _jsxs("div", { className: "connection-message", children: [_jsx(Radio, { size: 18 }), _jsxs("span", { children: [_jsx("strong", { children: "RFID reader not connected." }), " Entering a tag identifier manually looks up an existing record; it does not read an RFID device."] })] }), data.dataset === "demo" && _jsx(Button, { variant: "outline", className: "demo-reading-button", onClick: () => { const sample = candidates.slice(0, Math.min(2, 100 - ids.length)); if (sample.length)
                                addMany(sample);
                            else
                                setMessage("No additional eligible demo batteries."); }, disabled: locked || ids.length >= 100, children: "Add demo records" })] }), ids.length > 100 && _jsx("p", { role: "alert", className: "form-error", children: "A checkout or return can include up to 100 batteries. Remove batteries from this review list before confirming. No changes have been saved." }), message && _jsx("p", { role: "status", className: "form-message", children: message }), attempt && _jsxs("div", { className: "detail-card", role: "alert", children: [_jsx("h3", { children: busy ? "Submitting captured request…" : attempt.status === "uncertain" ? "Movement result uncertain" : "Movement rejected" }), _jsx("p", { children: attempt.message }), _jsxs("p", { className: "field-hint", children: ["Captured request: ", attempt.payload.requestId, ". Your reviewed batteries and loan IDs remain locked until this request is resolved. Recovery is available in this browser tab."] }), attempt.status === "uncertain" ? _jsxs(Button, { onClick: () => { const saved = captured.current; if (saved)
                                void runAttempt(saved, true); }, disabled: busy, children: [_jsx(RefreshCw, { size: 16 }), "Retry same request"] }) : _jsxs(Button, { variant: "outline", onClick: reviewLatest, disabled: busy, children: [_jsx(RefreshCw, { size: 16 }), "Review current records"] })] }), latestReview && _jsxs("div", { className: "detail-card", children: [_jsx("h3", { children: "Review changes before updating this draft" }), latestReview.changes.map(({ before, after }) => _jsxs("div", { className: "history-entry", children: [_jsx("strong", { children: before.id }), _jsxs("p", { children: ["Previously reviewed: ", before.loanId ? `${before.borrowerName} · ${formatTime(before.checkedOutAt)}` : "In store"] }), _jsxs("p", { children: ["Latest: ", !after ? "Battery unavailable; it will be removed from the new draft." : after.loanId ? `${after.borrowerName} · ${formatTime(after.checkedOutAt)}${after.loanId !== before.loanId ? " · Different loan" : " · Same loan"}${checkout ? " · Will be removed from the checkout list" : ""}` : checkout ? "In store; available for a new checkout review." : "No active loan; this battery will be removed from the return list."] })] }, before.id)), _jsxs("div", { className: "flex flex-wrap gap-2", children: [_jsx(Button, { variant: "outline", onClick: acceptLatest, disabled: busy, children: "Accept reviewed changes" }), _jsx(Button, { variant: "outline", onClick: discardRejected, disabled: busy, children: "Discard rejected request" })] }), _jsx("p", { className: "field-hint", children: "Accepting changes prepares a new draft for your confirmation. Discarding performs no movement." })] }), _jsxs(DialogFooter, { children: [_jsx(Button, { variant: "outline", onClick: close, disabled: locked, children: "Cancel" }), _jsx(Button, { onClick: confirm, disabled: locked || !queued.length || ids.length > 100 || !!groupReference && !group, children: busy ? "Saving…" : `${checkout ? "Confirm checkout" : "Confirm return"} (${queued.length})` })] })] }) });
}
