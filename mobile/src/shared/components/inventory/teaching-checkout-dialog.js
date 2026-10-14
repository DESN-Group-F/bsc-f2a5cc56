import { WorkflowBoundary } from "../../../business/workflow-boundary.jsx";
"use client";
import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useRef, useState } from "react";
import { ArrowRight, RefreshCw } from "lucide-react";
import { Button } from "../ui/button.js";
import { Checkbox } from "../ui/checkbox.js";
import { Label } from "../ui/label.js";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../ui/dialog.js";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table.js";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select.js";
import { BatteryFilterControls } from "./battery-filter-controls.js";
import { TeachingNfcInput } from "./teaching-nfc-input.js";
import { defaultInventoryFilter } from "../../lib/inventory-query.js";
import { getFilteredBatteries } from "../../lib/battery-selection-query.js";
import { formatTime, teachingSpecificationDifferenceLabel } from "../../lib/client-utils.js";
import { inventoryResponse } from "../../lib/client/inventory-request.js";
import { teachingSpecificationDifferences } from "../../lib/teaching-checkouts.js";
import { initialTeachingSelection, suggestTeachingReplacements, eligibleTeachingAlternatives } from "../../lib/teaching-checkout-selection.js";
import { captureTeachingCheckoutAttempt, recoverTeachingCheckoutAttempt, persistTeachingCheckoutAttempt, teachingCheckoutStorageKey, teachingCheckoutFailureStatus, verifyTeachingCheckoutReceipt } from "../../lib/client/teaching-checkout-request.js";
import { persistTeachingCheckoutDraft, recoverTeachingCheckoutDraft, reviewedTeachingCheckoutAttempt, teachingCheckoutDraftSchema, teachingCheckoutDraftStorageKey } from "../../lib/client/teaching-checkout-draft.js";
import styles from "./teaching-checkout.module.css";
function specifications(battery) {
    return `${battery.model || "Model not recorded"} · ${battery.chemistry || "Chemistry not recorded"} · ${battery.capacityMah === null ? "Capacity not recorded" : `${battery.capacityMah} mAh`} · ${battery.voltage === null ? "Voltage not recorded" : `${battery.voltage} V`}`;
}
function binding(battery) { return { batteryId: battery.id, tagId: battery.tagId, version: battery.version }; }
function lastObservation(battery) {
    if (!battery.observedAt)
        return "Last observation: none recorded.";
    return `Last observation: ${battery.observationRoomSnapshot === "unavailable" ? "Historical address unavailable" : [battery.observedBuilding, battery.observedRoom].filter(Boolean).join(" · ") || "Unknown room"} · ${formatTime(battery.observedAt)} · ${battery.observationSource || "Source unavailable"}. This does not confirm the current location.`;
}
async function flushRecoveryStorage() {
    await window.__batteryWorkflowStorage?.flush();
}
function SharedTeachingCheckoutDialog({ data, draft, onClose, onChanged, onLockedChange }) {
    const storageKey = teachingCheckoutStorageKey(data.user.id, data.dataset);
    const [recovery] = useState(() => {
        try {
            const raw = window.__batteryWorkflowStorage.getItem(storageKey), attempt = draft.kind === "recover" ? draft.attempt : recoverTeachingCheckoutAttempt(raw, data.user.id, data.dataset);
            const saved = attempt ? reviewedTeachingCheckoutAttempt(attempt) : draft.kind === "resume" ? draft.saved : recoverTeachingCheckoutDraft(window.__batteryWorkflowStorage.getItem(teachingCheckoutDraftStorageKey(data.user.id, data.dataset)), data.user.id, data.dataset);
            return { attempt, saved, blocked: false, message: "" };
        }
        catch (failure) {
            return { attempt: null, saved: null, blocked: true, message: `The preserved teaching workflow could not be read safely. ${failure.message} Restore access before starting another operation.` };
        }
    });
    const recoveredReview = recovery.saved;
    const [inventory, setInventory] = useState(data);
    const [group] = useState(draft.kind === "checkout" || draft.kind === "continue" ? draft.group : recoveredReview?.group);
    const [run] = useState(draft.kind === "return" || draft.kind === "continue" || draft.kind === "exchange" ? draft.run : recoveredReview?.run);
    const action = recovery.attempt?.payload.action ?? recoveredReview?.kind ?? (draft.kind === "recover" || draft.kind === "resume" ? "checkout" : draft.kind);
    const checkout = action === "checkout" || action === "continue", exchanging = action === "exchange";
    const separateCheckout = recoveredReview?.separateCheckout ?? (draft.kind === "checkout" && !!draft.separateCheckout);
    const personalScope = recovery.attempt?.payload.personalScope ?? recoveredReview?.personalScope ?? (draft.kind === "recover" || draft.kind === "resume" ? "all" : draft.personalScope);
    const [slots, setSlots] = useState(() => recoveredReview?.slots ?? (draft.kind === "checkout" || draft.kind === "continue" ? initialTeachingSelection(data, draft.group, draft.ids, draft.personalScope) : []));
    const [exchange, setExchange] = useState(() => recoveredReview?.exchange ?? (draft.kind === "exchange" ? { originalBatteryId: draft.item.originalBatteryId ?? (draft.run.currentMappings ?? draft.run.mappings).find(mapping => mapping.loanId === draft.item.loanId)?.original.batteryId ?? draft.item.batteryId, outgoing: draft.item, actual: null, returnOutgoing: false } : undefined));
    const [excludedIds, setExcludedIds] = useState(recoveredReview?.excludedIds ?? []);
    const [selectedReturnIds, setSelectedReturnIds] = useState(() => recovery.attempt?.payload.action === "return" ? recovery.attempt.payload.items.map(item => item.batteryId) : recoveredReview?.selectedReturnIds ?? (draft.kind === "return" ? draft.run.items.filter(item => item.status === "outstanding").map(item => item.batteryId) : []));
    const [manualOriginalId, setManualOriginalId] = useState(recoveredReview?.manualOriginalId ?? ""), [inputSource, setInputSource] = useState(recoveredReview?.inputSource ?? "selection");
    const [pendingSource, setPendingSource] = useState(null);
    const [filters, setFilters] = useState(() => recoveredReview?.filters ?? ({ ...defaultInventoryFilter(), personalScope })), [page, setPage] = useState(0);
    const [attempt, setAttempt] = useState(recovery.attempt), [busy, setBusy] = useState(false), [readerBusy, setReaderBusy] = useState(false), [message, setMessage] = useState(recovery.message);
    const [latest, setLatest] = useState(null), [storageBlocked, setStorageBlocked] = useState(false);
    const captured = useRef(attempt), running = useRef(false), mounted = useRef(true), finished = useRef(false);
    const locked = busy || !!attempt || recovery.blocked || storageBlocked, actionLocked = locked || readerBusy;
    const included = slots.filter(slot => !excludedIds.includes(slot.originalId)), unresolved = included.filter(slot => !slot.actual);
    const originalsMissing = included.filter(slot => !slot.original).map(slot => slot.originalId);
    const canReplace = (slot) => !!slot.original && (separateCheckout || !slot.original.loanId || slot.original.borrowerAccountId !== data.user.id) && slot.original.lifecycleStatus === "active" && !slot.issue?.includes("personal scope");
    const alternativeSlots = slots.filter(canReplace), selectedSlot = slots.find(slot => slot.originalId === manualOriginalId);
    const candidatePool = exchanging ? inventory.batteries.filter(battery => battery.lifecycleStatus === "active" && battery.id !== exchange?.outgoing.batteryId && (!battery.loanId || battery.borrowerAccountId === data.user.id) && !run?.items.some(item => item.batteryId === battery.id && item.status === "outstanding")) : selectedSlot ? eligibleTeachingAlternatives(inventory, slots.filter(slot => !excludedIds.includes(slot.originalId) || slot.originalId === manualOriginalId), personalScope, manualOriginalId, separateCheckout) : [];
    const { batteries: candidates, error: filterError } = getFilteredBatteries(inventory, { ...filters, personalScope }, candidatePool);
    const pages = Math.max(1, Math.ceil(candidates.length / 25)), currentPage = Math.min(page, pages - 1), visible = candidates.slice(currentPage * 25, currentPage * 25 + 25);
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
    function savedDraft() {
        return teachingCheckoutDraftSchema.parse({ actorAccountId: data.user.id, dataset: data.dataset, kind: action, ...(separateCheckout ? { separateCheckout: true } : {}), ...(group ? { group } : {}), ...(run ? { run } : {}), ...(exchange ? { exchange } : {}), slots, personalScope, excludedIds, selectedReturnIds, inputSource, manualOriginalId, filters });
    }
    function saveDraft() {
        try {
            persistTeachingCheckoutDraft(data.user.id, data.dataset, savedDraft());
            setStorageBlocked(false);
            return true;
        }
        catch (failure) {
            setStorageBlocked(true);
            setMessage(`The reviewed draft could not be saved. ${failure.message} No business request will be sent until storage is restored.`);
            return false;
        }
    }
    useEffect(() => {
        if (!recovery.blocked && !captured.current && !finished.current)
            saveDraft();
        // Each changed review is saved with the complete bindings and acquisition evidence.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [slots, excludedIds, selectedReturnIds, inputSource, manualOriginalId, filters, exchange]);
    useEffect(() => { onLockedChange?.(actionLocked); return () => onLockedChange?.(false); }, [actionLocked, onLockedChange]);
    useEffect(() => {
        if (!attempt && !busy && !readerBusy && !recovery.blocked)
            return;
        const protect = (event) => { event.preventDefault(); event.returnValue = ""; };
        window.addEventListener("beforeunload", protect);
        return () => window.removeEventListener("beforeunload", protect);
    }, [attempt, busy, readerBusy, recovery.blocked]);
    function persist(next) {
        try {
            persistTeachingCheckoutAttempt(data.user.id, data.dataset, next);
            captured.current = next;
            setAttempt(next);
            return true;
        }
        catch {
            if (next) {
                captured.current = next;
                setAttempt(next);
            }
            setMessage("Browser storage could not preserve or clear this exact request. No replacement request will be sent. Restore storage, then retry the same request.");
            return false;
        }
    }
    function clearDraft() {
        try {
            persistTeachingCheckoutDraft(data.user.id, data.dataset, null);
            return true;
        }
        catch (failure) {
            setMessage(`The preserved draft could not be cleared. ${failure.message} Restore storage before closing.`);
            return false;
        }
    }
    async function close() {
        if (running.current || captured.current || readerBusy || recovery.blocked)
            return;
        running.current = true;
        setBusy(true);
        try {
            await acknowledgeConfirmedTeachingRequest(false);
            finished.current = true;
            onClose(inventory !== data ? inventory : undefined);
        }
        catch (failure) {
            saveDraft();
            setMessage(`The reviewed draft could not be cleared from device storage. ${failure.message}`);
        }
        finally {
            running.current = false;
            if (mounted.current)
                setBusy(false);
        }
    }
    function selectAlternative(actual, source) {
        if (running.current || captured.current || recovery.blocked || storageBlocked)
            throw new Error("Resolve the preserved request before choosing an alternative.");
        if (!selectedSlot || !canReplace(selectedSlot))
            throw new Error("Choose an eligible original member first. To exchange a battery already held by you, continue its existing loan before reviewing an exchange.");
        if (source.kind !== inputSource)
            throw new Error(`This review list uses ${inputSource === "selection" ? "inventory selection" : inputSource === "tag" ? "entered tags" : "native NFC"}. Switch its input source explicitly before selecting this alternative.`);
        if (!candidatePool.some(candidate => candidate.id === actual.id))
            throw new Error("This battery is unavailable, already selected, or outside the current inventory and personal scope. No alternative was added.");
        setSlots(previous => previous.map(slot => slot.originalId === manualOriginalId ? { ...slot, actual, method: "manual", source, existingLoanId: actual.loanId ?? undefined } : slot));
        setExcludedIds(previous => previous.filter(id => id !== manualOriginalId));
        setMessage("");
    }
    function selectTag(tagId, source) {
        const matches = inventory.batteries.filter(battery => battery.tagId === tagId);
        if (matches.length !== 1)
            throw new Error("This exact tag is not registered in this inventory. Check the identifier; no new asset or alternative was created.");
        selectAlternative(matches[0], source);
    }
    function requestSource(source) {
        if (actionLocked || source === inputSource)
            return;
        if (slots.some(slot => slot.method === "manual" && slot.actual && !excludedIds.includes(slot.originalId)))
            setPendingSource(source);
        else {
            setInputSource(source);
            setPendingSource(null);
        }
    }
    function acceptSource() {
        if (actionLocked || !pendingSource)
            return;
        setSlots(previous => previous.map(slot => slot.method === "manual" ? { ...slot, actual: null, method: "original", source: { kind: "selection" }, existingLoanId: undefined } : slot));
        setInputSource(pendingSource);
        setPendingSource(null);
        setMessage("The manual choices were cleared for this explicit source change. Fixed members and automatic alternatives were retained. Review the empty slots again.");
    }
    function toggleExcluded(slot) {
        if (actionLocked)
            return;
        if (excludedIds.includes(slot.originalId) && slot.actual && slot.method === "manual" && slot.source.kind !== inputSource) {
            setMessage("This excluded alternative uses a different input source. Switch back to its source, or remove it and choose a new alternative before including this member.");
            return;
        }
        if (excludedIds.includes(slot.originalId) && slot.actual && slots.some(other => other.originalId !== slot.originalId && !excludedIds.includes(other.originalId) && other.actual?.id === slot.actual.id)) {
            setMessage(`${slot.actual.id} is already selected for another member. Remove that alternative before including this member.`);
            return;
        }
        setExcludedIds(previous => previous.includes(slot.originalId) ? previous.filter(id => id !== slot.originalId) : [...previous, slot.originalId]);
    }
    function suggest() {
        if (actionLocked)
            return;
        const suggestions = suggestTeachingReplacements(inventory, included, personalScope);
        const added = suggestions.filter(slot => slot.actual && !included.find(previous => previous.originalId === slot.originalId)?.actual).length;
        setSlots(previous => previous.map(slot => suggestions.find(updated => updated.originalId === slot.originalId) ?? slot));
        setMessage(added ? `${added} automatic alternative${added === 1 ? "" : "s"} added to the review list. Known recorded specifications match. Unfilled slots need manual selection or explicit exclusion. Locations are not used to infer present availability.` : "No strict automatic alternatives are available for the unresolved members. Choose manual alternatives or explicitly exclude those members.");
    }
    async function acknowledgeConfirmedTeachingRequest(clearRequest = true) {
        const storage = window.__batteryWorkflowStorage;
        if (!storage?.transact) throw new Error("Durable atomic recovery acknowledgement is unavailable. Keep and retry the original request.");
        await storage.transact(entries => {
            if (clearRequest) delete entries[teachingCheckoutStorageKey(data.user.id, data.dataset)];
            delete entries[teachingCheckoutDraftStorageKey(data.user.id, data.dataset)];
        });
        if (clearRequest) { captured.current = null; setAttempt(null); }
        window.dispatchEvent(new Event("battery-teaching-checkout-recovery"));
    }
    async function send(original, wasUncertain) {
        if (running.current || recovery.blocked)
            return;
        running.current = true;
        setBusy(true);
        setMessage("");
        const sending = { ...original, status: "uncertain", message: "Waiting for the server to confirm this exact request." };
        try {
            if (!persist(sending))
                return;
            await flushRecoveryStorage();
            const result = await inventoryResponse(await fetch("/api/teaching-checkouts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dataset: sending.dataset, payload: sending.payload }) }));
            verifyTeachingCheckoutReceipt(result.result, sending);
            if (!mounted.current) return;
            await acknowledgeConfirmedTeachingRequest();
            finished.current = true;
            try {
                await onChanged();
            }
            catch {
                setMessage("The request was confirmed, but inventory refresh failed. Refresh before starting another operation.");
            }
            onClose();
        }
        catch (failure) {
            if (!mounted.current)
                return;
            const status = teachingCheckoutFailureStatus(failure, wasUncertain);
            const failed = { ...sending, status, message: status === "uncertain" ? `Result uncertain. ${failure.message} Retry only this original request.` : failure.message };
            persist(failed);
        }
        finally {
            running.current = false;
            if (mounted.current)
                setBusy(false);
        }
    }
    async function confirm() {
        if (actionLocked || pendingSource || originalsMissing.length || checkout && (!group || !included.length || unresolved.length))
            return;
        try {
            let payload;
            if (checkout && group) {
                const common = { requestId: crypto.randomUUID(), teachingGroup: { id: group.id, version: group.version }, personalScope, mappings: included.map(slot => ({ original: binding(slot.original), actual: binding(slot.actual), originalLoanId: slot.original.loanId, ...(slot.existingLoanId ? { existingLoanId: slot.existingLoanId } : {}), method: slot.method, source: slot.source })) };
                if (action === "continue") {
                    if (!run)
                        throw new Error("The existing checkout is unavailable. No request was sent.");
                    payload = { action: "continue", ...common, runId: run.id, expectedRevision: run.revision ?? 1 };
                }
                else
                    payload = { action: "checkout", ...common, ...(separateCheckout ? { separateCheckout: true } : {}) };
            }
            else if (exchanging) {
                if (!run || !exchange?.actual || !exchange.outgoing.loanId || exchange.outgoing.version === null || exchange.outgoing.status !== "outstanding" || exchange.outgoing.pendingReturn)
                    throw new Error("Review an outstanding battery and its replacement before confirming the exchange.");
                payload = { action: "exchange", requestId: crypto.randomUUID(), runId: run.id, expectedRevision: run.revision ?? 1, personalScope, originalBatteryId: exchange.originalBatteryId, outgoing: { batteryId: exchange.outgoing.batteryId, tagId: exchange.outgoing.tagId, version: exchange.outgoing.version, loanId: exchange.outgoing.loanId }, actual: binding(exchange.actual), actualLoanId: exchange.actual.loanId, returnOutgoing: exchange.returnOutgoing, source: { kind: "selection" } };
            }
            else {
                if (!run)
                    throw new Error("The saved checkout record is unavailable. No return was sent.");
                const items = run.items.filter(item => item.status === "outstanding" && selectedReturnIds.includes(item.batteryId));
                if (!items.length || items.some(item => item.status !== "outstanding" || !item.loanId || item.version === null))
                    throw new Error("Only the reviewed outstanding loans can be returned. Refresh and review this checkout again.");
                payload = { action: "return", requestId: crypto.randomUUID(), runId: run.id, personalScope, items: items.map(item => ({ batteryId: item.batteryId, tagId: item.tagId, version: item.version, loanId: item.loanId, source: { kind: "selection" } })) };
            }
            if (!saveDraft())
                return;
            await send(captureTeachingCheckoutAttempt(data.user.id, data.dataset, payload, savedDraft()), false);
        }
        catch (failure) {
            setMessage(failure.message);
        }
    }
    async function reviewLatest() {
        if (running.current || captured.current?.status !== "rejected")
            return;
        running.current = true;
        setBusy(true);
        setMessage("");
        try {
            const value = await inventoryResponse(await fetch(`/api/inventory?dataset=${data.dataset}`, { cache: "no-store" }));
            if (value.dataset !== data.dataset || value.user.id !== data.user.id)
                throw new Error("The original inventory or staff account changed. Restore the original sign-in.");
            setLatest(value);
        }
        catch (failure) {
            setMessage(failure.message);
        }
        finally {
            running.current = false;
            setBusy(false);
        }
    }
    async function discardRejected() {
        const rejected = captured.current;
        if (running.current || !latest || rejected?.status !== "rejected")
            return;
        running.current = true;
        setBusy(true);
        try {
            await acknowledgeConfirmedTeachingRequest();
            finished.current = true;
            setInventory(latest);
            onClose(latest);
        }
        catch (failure) {
            persist(rejected);
            setMessage(`The rejected request could not be cleared from device storage. ${failure.message}`);
        }
        finally {
            running.current = false;
            if (mounted.current)
                setBusy(false);
        }
    }
    return _jsx(Dialog, { open: true, onOpenChange: open => !open && close(), children: _jsxs(DialogContent, { className: styles.dialog, showCloseButton: !actionLocked, onEscapeKeyDown: event => { if (actionLocked)
                event.preventDefault(); }, onInteractOutside: event => { if (actionLocked)
                event.preventDefault(); }, children: [_jsxs(DialogHeader, { children: [_jsx(DialogTitle, { children: exchanging ? "Exchange a battery in this checkout" : action === "continue" ? "Continue this teaching checkout" : checkout ? "Review teaching group checkout" : "Return this actual checkout" }), _jsx(DialogDescription, { children: exchanging ? "Review the incoming battery and whether the outgoing battery has actually been handed back. The default group stays unchanged." : checkout ? "Retain default members, choose temporary alternatives or explicitly continue using your existing loans. Returning an alternative ends its temporary use; the default group stays unchanged." : "Choose all or part of the actual checkout. Each return uses its original recorded loan ID." })] }), _jsxs("div", { className: "detail-card", children: [_jsx("strong", { children: group?.name ?? run?.teachingGroup.name ?? "Preserved group request" }), _jsx("p", { className: "field-hint", children: checkout ? `Checkout to ${data.user.displayName} · ${data.user.username}. Recommendations do not reserve stock.` : `Original checkout: ${formatTime(run?.createdAt)} · ${run?.id ?? (attempt?.payload.action === "return" ? attempt.payload.runId : "")}` }), personalScope !== "all" && _jsxs("p", { className: "field-hint", children: ["Fixed personal scope: ", personalScope === "responsible" ? "My batteries" : "My batteries in use", ". Alternatives cannot extend beyond this scope."] })] }), separateCheckout && _jsx("p", { className: styles.warning, children: "Separate teaching session: this review creates a new checkout. Other sessions and their outstanding loans remain open. Choose different actual batteries; one existing loan cannot cover two active checkouts." }), checkout ? _jsxs(_Fragment, { children: [_jsxs("div", { className: "review-title", children: [_jsxs("strong", { children: [included.filter(slot => slot.actual).length, " actual batteries selected"] }), _jsxs("span", { children: [unresolved.length, " unresolved \u00B7 ", excludedIds.length, " explicitly excluded"] })] }), _jsx("div", { className: styles.slotList, children: slots.map(slot => _jsxs("article", { className: styles.slot, "data-selected": manualOriginalId === slot.originalId, "data-excluded": excludedIds.includes(slot.originalId), children: [_jsxs("div", { children: [_jsxs("h3", { children: ["Default member \u00B7 ", slot.originalId] }), slot.original ? _jsxs(_Fragment, { children: [_jsx("p", { children: slot.original.name }), _jsx("p", { children: specifications(slot.original) }), _jsx("p", { className: "field-hint", children: lastObservation(slot.original) }), slot.original.loanId && _jsx("p", { children: slot.original.borrowerAccountId === data.user.id ? "Already checked out to you. Continue its existing loan here; use Exchange battery afterwards if you need to change it." : `In use by ${slot.original.borrowerName ?? "another staff member"}` }), slot.original.lifecycleStatus !== "active" && _jsx("p", { children: "Retired member; unavailable for this checkout." })] }) : _jsx("p", { children: "The original battery record is unavailable." }), slot.issue && !slot.actual && _jsx("p", { className: "field-hint", children: slot.issue })] }), _jsxs("div", { children: [_jsx("h3", { children: slot.method === "manual" ? "Manual alternative" : slot.method === "automatic" ? "Automatic alternative" : "Actual battery" }), slot.actual ? _jsxs(_Fragment, { children: [_jsxs("p", { children: [_jsx("strong", { children: slot.actual.id }), " \u00B7 ", slot.actual.name] }), _jsx("p", { children: specifications(slot.actual) }), _jsx("p", { className: "field-hint", children: lastObservation(slot.actual) }), slot.existingLoanId && _jsxs("p", { className: styles.warning, children: ["Continue using \u00B7 Existing loan retained from ", formatTime(slot.actual.checkedOutAt), ". No new loan or restart of the checkout time."] }), slot.method === "manual" && slot.original && _jsxs("p", { className: styles.warning, children: [teachingSpecificationDifferences(slot.original, slot.actual).map(teachingSpecificationDifferenceLabel).join(" · ") || "Recorded model and specifications match; manually chosen.", " The teacher must confirm suitability."] }), slot.method === "automatic" && _jsx("p", { className: "field-hint", children: "Known recorded model, chemistry, capacity and voltage match. Physical compatibility is not inferred." }), _jsx("p", { className: "field-hint", children: slot.source.kind === "native_nfc" ? "Adopted native NFC reading" : slot.source.kind === "tag" ? "Entered registered tag" : "Inventory selection" })] }) : _jsx("p", { children: "No actual battery selected. Choose an alternative, continue an existing loan or explicitly exclude this member." })] }), _jsxs("div", { className: styles.slotActions, children: [slot.original?.loanId && slot.original.borrowerAccountId === data.user.id && slot.original.lifecycleStatus === "active" && !slot.issue?.includes("personal scope") && !slot.actual && _jsxs(Button, { variant: "outline", size: "sm", disabled: actionLocked, onClick: () => { if (actionLocked)
                                                    return; setSlots(previous => previous.map(item => item.originalId === slot.originalId ? { ...item, actual: item.original, existingLoanId: item.original.loanId, method: "original", source: { kind: "selection" } } : item)); setExcludedIds(previous => previous.filter(id => id !== slot.originalId)); }, children: ["Continue using ", slot.originalId] }), canReplace(slot) && _jsxs(Button, { variant: "outline", size: "sm", disabled: actionLocked, onClick: () => setManualOriginalId(slot.originalId), children: ["Choose manual alternative", _jsx(ArrowRight, { size: 14 })] }), slot.method !== "original" && slot.actual && _jsx(Button, { variant: "ghost", size: "sm", disabled: actionLocked, onClick: () => setSlots(previous => previous.map(item => item.originalId === slot.originalId ? { ...item, actual: item.original && !item.original.loanId ? item.original : null, method: "original", source: { kind: "selection" }, existingLoanId: undefined } : item)), children: "Remove alternative" }), _jsx(Button, { variant: "ghost", size: "sm", disabled: actionLocked, onClick: () => toggleExcluded(slot), children: excludedIds.includes(slot.originalId) ? "Include this member" : "Exclude from this checkout" })] })] }, slot.originalId)) }), !!originalsMissing.length && _jsxs("p", { className: "form-error", role: "alert", children: ["Requested members are no longer available: ", originalsMissing.join(", "), ". Cancel and reopen the group before preparing a new checkout."] }), _jsx(Button, { variant: "outline", disabled: actionLocked || !included.some(slot => !slot.actual && canReplace(slot)), onClick: suggest, children: "Replace unavailable batteries" }), !!alternativeSlots.length && _jsxs("section", { className: styles.manualPanel, "aria-label": "Manual alternative selection", children: [_jsx("h3", { children: "Manual alternatives" }), _jsx("p", { className: "field-hint", children: "Manual choices may have different or unknown specifications. Select the original member, review the chosen battery and confirm its suitability before checkout." }), _jsxs("div", { className: "form-field", children: [_jsx(Label, { children: "Original member to replace" }), _jsxs(Select, { value: manualOriginalId, disabled: actionLocked, onValueChange: setManualOriginalId, children: [_jsx(SelectTrigger, { "aria-label": "Original member to replace", children: _jsx(SelectValue, { placeholder: "Choose a default member\u2026" }) }), _jsx(SelectContent, { children: alternativeSlots.map(slot => _jsxs(SelectItem, { value: slot.originalId, children: [slot.originalId, " \u00B7 ", slot.original?.name ?? "Unavailable member"] }, slot.originalId)) })] })] }), _jsx("div", { className: "flex flex-wrap gap-2", role: "group", "aria-label": "Manual alternative input source", children: [["selection", "Inventory selection"], ["tag", "Entered tag"], ["native_nfc", "Native NFC"]].map(([source, label]) => _jsx(Button, { variant: inputSource === source ? "default" : "outline", disabled: actionLocked, onClick: () => requestSource(source), children: label }, source)) }), pendingSource && _jsxs("div", { className: "detail-card", role: "alert", children: [_jsx("p", { children: "Switching source clears the current manual alternatives. Fixed members and automatic suggestions stay selected." }), _jsxs("div", { className: "flex flex-wrap gap-2", children: [_jsx(Button, { variant: "outline", disabled: actionLocked, onClick: acceptSource, children: "Switch source and clear manual choices" }), _jsx(Button, { variant: "ghost", disabled: actionLocked, onClick: () => setPendingSource(null), children: "Keep current source" })] })] }), _jsx(BatteryFilterControls, { data: inventory, filters: { ...filters, personalScope }, onChange: patch => { if (!actionLocked) {
                                        setFilters(previous => ({ ...previous, ...patch, personalScope }));
                                        setPage(0);
                                    } }, onClear: () => { if (!actionLocked) {
                                        setFilters({ ...defaultInventoryFilter(), personalScope });
                                        setPage(0);
                                    } }, disabled: actionLocked, showLifecycle: false, scopeNote: "Candidates may be outside the fixed group, within the same inventory and fixed personal scope. Active batteries without a recorded loan can be borrowed; batteries already held by you require an explicit Continue using choice. Clear filters retains the reviewed alternatives." }), filterError && _jsx("p", { className: "form-error", role: "alert", children: filterError }), inputSource === "selection" ? _jsxs(_Fragment, { children: [_jsx("p", { className: "field-hint", children: selectedSlot ? `${candidates.length} matching available alternatives` : "Choose the original member above to view alternatives." }), _jsxs("div", { className: styles.candidateList, children: [_jsxs(Table, { children: [_jsx(TableHeader, { children: _jsxs(TableRow, { children: [_jsx(TableHead, { children: "BATTERY / SPECIFICATIONS" }), _jsx(TableHead, { children: "LAST OBSERVATION" }), _jsx(TableHead, { children: "SELECT" })] }) }), _jsx(TableBody, { children: visible.map(battery => _jsxs(TableRow, { children: [_jsxs(TableCell, { children: [_jsx("strong", { children: battery.id }), _jsx("span", { className: "cell-secondary", children: battery.name }), _jsx("span", { className: "cell-secondary", children: specifications(battery) })] }), _jsx(TableCell, { children: lastObservation(battery) }), _jsx(TableCell, { children: _jsx(Button, { variant: "outline", size: "sm", disabled: actionLocked || !!pendingSource, onClick: () => { try {
                                                                                selectAlternative(battery, { kind: "selection" });
                                                                            }
                                                                            catch (failure) {
                                                                                setMessage(failure.message);
                                                                            } }, "aria-label": `Choose ${battery.id} as manual alternative`, children: battery.loanId ? `Continue using ${battery.id}` : "Choose" }) })] }, battery.id)) })] }), selectedSlot && !visible.length && _jsx("p", { className: "p-4 text-sm", children: "No available batteries match these filters." })] }), pages > 1 && _jsxs("div", { className: "flex items-center justify-between gap-2", children: [_jsx(Button, { variant: "outline", size: "sm", disabled: actionLocked || !currentPage, onClick: () => setPage(currentPage - 1), children: "Previous" }), _jsxs("span", { className: "field-hint", children: ["Page ", currentPage + 1, " of ", pages] }), _jsx(Button, { variant: "outline", size: "sm", disabled: actionLocked || currentPage + 1 >= pages, onClick: () => setPage(currentPage + 1), children: "Next" })] })] }) : _jsx(TeachingNfcInput, { disabled: locked || !selectedSlot || !!pendingSource, onChooseTag: selectTag, onBusyChange: setReaderBusy })] }), !!excludedIds.length && _jsxs("p", { className: styles.warning, children: ["Explicitly excluded from this checkout: ", excludedIds.join(", "), ". These members and their existing loans remain unchanged."] })] }) : exchanging && exchange ? _jsxs("section", { className: styles.exchangeReview, "aria-label": "Battery exchange review", children: [_jsxs("div", { className: styles.slot, children: [_jsxs("div", { children: [_jsxs("h3", { children: ["Outgoing battery \u00B7 ", exchange.outgoing.batteryId] }), _jsxs("p", { children: ["Default member: ", exchange.originalBatteryId] }), _jsxs("p", { className: "field-hint", children: ["Original loan: ", exchange.outgoing.loanId] })] }), _jsxs("div", { children: [_jsx("h3", { children: "Incoming battery" }), exchange.actual ? _jsxs(_Fragment, { children: [_jsxs("p", { children: [_jsx("strong", { children: exchange.actual.id }), " \u00B7 ", exchange.actual.name] }), _jsx("p", { children: specifications(exchange.actual) }), _jsx("p", { className: "field-hint", children: lastObservation(exchange.actual) }), exchange.actual.loanId && _jsxs("p", { className: styles.warning, children: ["Continue using your existing loan from ", formatTime(exchange.actual.checkedOutAt), ". Its loan ID and checkout time are retained."] }), _jsx(Button, { variant: "ghost", size: "sm", disabled: actionLocked, onClick: () => { if (!actionLocked)
                                                        setExchange(previous => previous ? { ...previous, actual: null } : previous); }, children: "Change incoming battery" })] }) : _jsx("p", { children: "Choose the incoming battery below." })] })] }), _jsxs("label", { className: styles.returnChoice, children: [_jsx(Checkbox, { checked: exchange.returnOutgoing, disabled: actionLocked, "aria-label": "The outgoing battery has actually been handed back", onCheckedChange: value => { if (!actionLocked)
                                        setExchange(previous => previous ? { ...previous, returnOutgoing: value === true } : previous); } }), _jsxs("span", { children: [_jsx("strong", { children: "The outgoing battery has actually been handed back" }), _jsxs("span", { className: "cell-secondary", children: ["Only select this after ", exchange.outgoing.batteryId, " has been returned. Damage, replacement or a missing battery does not complete its return."] })] })] }), _jsx("p", { className: styles.warning, role: "status", children: exchange.returnOutgoing ? `${exchange.outgoing.batteryId} will be returned and the incoming battery added in one confirmed transaction.` : `${exchange.outgoing.batteryId} will remain outstanding as Previous battery pending return. Both batteries remain your responsibility until each is returned.` }), !exchange.actual && _jsxs(_Fragment, { children: [_jsx(BatteryFilterControls, { data: inventory, filters: { ...filters, personalScope }, onChange: patch => { if (!actionLocked) {
                                        setFilters(previous => ({ ...previous, ...patch, personalScope }));
                                        setPage(0);
                                    } }, onClear: () => { if (!actionLocked) {
                                        setFilters({ ...defaultInventoryFilter(), personalScope });
                                        setPage(0);
                                    } }, disabled: actionLocked, showLifecycle: false, scopeNote: "Choose an available battery or explicitly continue using one already held by you. Existing outstanding members of this checkout cannot be selected again. Last observations do not establish current location." }), filterError && _jsx("p", { className: "form-error", role: "alert", children: filterError }), _jsxs("p", { className: "field-hint", children: [candidates.length, " matching batteries. Review recorded specifications; the system does not verify teaching suitability."] }), _jsxs("div", { className: styles.candidateList, children: [_jsxs(Table, { children: [_jsx(TableHeader, { children: _jsxs(TableRow, { children: [_jsx(TableHead, { children: "BATTERY / SPECIFICATIONS" }), _jsx(TableHead, { children: "LAST OBSERVATION" }), _jsx(TableHead, { children: "SELECT" })] }) }), _jsx(TableBody, { children: visible.map(battery => _jsxs(TableRow, { children: [_jsxs(TableCell, { children: [_jsx("strong", { children: battery.id }), _jsx("span", { className: "cell-secondary", children: battery.name }), _jsx("span", { className: "cell-secondary", children: specifications(battery) })] }), _jsx(TableCell, { children: lastObservation(battery) }), _jsx(TableCell, { children: _jsx(Button, { variant: "outline", size: "sm", disabled: actionLocked, "aria-label": `Choose ${battery.id} for exchange`, onClick: () => { if (!actionLocked)
                                                                        setExchange(previous => previous ? { ...previous, actual: battery } : previous); }, children: battery.loanId ? `Continue using ${battery.id}` : "Choose" }) })] }, battery.id)) })] }), !visible.length && _jsx("p", { className: "p-4 text-sm", children: "No batteries match these filters." })] }), pages > 1 && _jsxs("div", { className: "flex items-center justify-between gap-2", children: [_jsx(Button, { variant: "outline", size: "sm", disabled: actionLocked || !currentPage, onClick: () => setPage(currentPage - 1), children: "Previous" }), _jsxs("span", { className: "field-hint", children: ["Page ", currentPage + 1, " of ", pages] }), _jsx(Button, { variant: "outline", size: "sm", disabled: actionLocked || currentPage + 1 >= pages, onClick: () => setPage(currentPage + 1), children: "Next" })] })] })] }) : _jsx("div", { className: "review-list", children: _jsxs(Table, { children: [_jsx(TableHeader, { children: _jsxs(TableRow, { children: [_jsx(TableHead, { children: "RETURN" }), _jsx(TableHead, { children: "ACTUAL BATTERY" }), _jsx(TableHead, { children: "RECORDED LOAN" })] }) }), _jsx(TableBody, { children: (run?.items ?? (attempt?.payload.action === "return" ? attempt.payload.items.map(item => ({ ...item, status: "outstanding", returnedAt: null })) : [])).map(item => _jsxs(TableRow, { children: [_jsx(TableCell, { children: _jsx(Checkbox, { "aria-label": `Return ${item.batteryId}`, checked: item.status === "outstanding" && selectedReturnIds.includes(item.batteryId), disabled: actionLocked || item.status !== "outstanding", onCheckedChange: value => { if (!actionLocked && item.status === "outstanding")
                                                    setSelectedReturnIds(previous => value === true ? [...new Set([...previous, item.batteryId])] : previous.filter(id => id !== item.batteryId)); } }) }), _jsxs(TableCell, { children: [_jsx("strong", { children: item.batteryId }), _jsx("span", { className: "cell-secondary", children: inventory.batteries.find(battery => battery.id === item.batteryId)?.name ?? "Historic asset" })] }), _jsxs(TableCell, { children: [item.status, _jsx("span", { className: "cell-secondary", children: item.loanId })] })] }, item.loanId ?? item.batteryId)) })] }) }), storageBlocked && _jsx(Button, { variant: "outline", onClick: saveDraft, disabled: busy || readerBusy, children: "Retry saving this draft" }), message && _jsx("p", { role: "status", className: "form-message", children: message }), attempt && _jsxs("div", { className: "detail-card", role: "alert", children: [_jsx("h3", { children: busy ? "Submitting captured request…" : attempt.status === "uncertain" ? "Result uncertain" : "Request rejected" }), _jsx("p", { children: attempt.message }), _jsxs("p", { className: "field-hint", children: ["Original request: ", attempt.payload.requestId, ". Battery, tag, version, loan and source evidence are locked until this exact request is resolved."] }), attempt.status === "uncertain" ? _jsxs(Button, { disabled: busy || readerBusy, onClick: () => { const saved = captured.current; if (saved)
                                void send(saved, true); }, children: [_jsx(RefreshCw, { size: 16 }), "Retry same request"] }) : _jsxs(Button, { variant: "outline", disabled: busy, onClick: reviewLatest, children: [_jsx(RefreshCw, { size: 16 }), "Review current records"] })] }), latest && _jsxs("div", { className: "detail-card", children: [_jsx("h3", { children: "Current records reviewed" }), _jsx("p", { children: "The preserved request was rejected. Its selections were not silently changed. Discard it explicitly, then reopen the current group or actual checkout to prepare a new review." }), attempt?.payload.action === "checkout" && attempt.payload.mappings.map(mapping => { const current = latest.batteries.find(battery => battery.id === mapping.actual.batteryId); return _jsxs("p", { children: [_jsx("strong", { children: mapping.actual.batteryId }), " \u00B7 ", !current ? "Unavailable" : current.loanId ? `In use by ${current.borrowerName ?? "staff"}` : current.lifecycleStatus === "active" ? "In store" : "Retired", " \u00B7 ", current ? `Current version ${current.version}, reviewed version ${mapping.actual.version}` : ""] }, mapping.actual.batteryId); }), _jsx(Button, { variant: "outline", disabled: busy, onClick: discardRejected, children: "Discard rejected request and close" })] }), _jsxs(DialogFooter, { className: styles.footer, children: [_jsx(Button, { variant: "outline", disabled: actionLocked, onClick: close, children: "Cancel review" }), _jsx(Button, { disabled: actionLocked || !!pendingSource || (checkout ? !included.length || !!unresolved.length || !!originalsMissing.length : exchanging ? !exchange?.actual : !selectedReturnIds.length), onClick: confirm, children: busy ? "Saving…" : exchanging ? "Confirm battery exchange" : action === "continue" ? `Confirm added batteries (${included.filter(slot => slot.actual).length})` : checkout ? `Confirm actual checkout (${included.filter(slot => slot.actual).length})` : `Confirm exact return (${selectedReturnIds.length})` })] })] }) });
}

export function TeachingCheckoutDialog(props) { return _jsx(WorkflowBoundary, {children:_jsx(SharedTeachingCheckoutDialog, {...props})}); }
