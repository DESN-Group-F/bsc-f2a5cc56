"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRight, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BatteryFilterControls } from "./battery-filter-controls";
import { TeachingNfcInput } from "./teaching-nfc-input";
import { defaultInventoryFilter, type InventoryFilter } from "@/lib/inventory-query";
import { getFilteredBatteries } from "@/lib/battery-selection-query";
import { formatTime, storageRoomLabel } from "@/lib/client-utils";
import { inventoryResponse } from "@/lib/client/inventory-request";
import type { InventorySnapshot, BatteryRecord } from "@/lib/domain";
import type { TeachingGroup } from "@/lib/teaching-groups";
import type { TeachingCheckoutListedRun, TeachingCheckoutRequest, TeachingSelectionSource } from "@/lib/teaching-checkouts";
import { teachingSpecificationDifferences } from "@/lib/teaching-checkouts";
import { initialTeachingSelection, suggestTeachingReplacements, eligibleTeachingAlternatives, type TeachingSelection } from "@/lib/teaching-checkout-selection";
import { captureTeachingCheckoutAttempt, recoverTeachingCheckoutAttempt, persistTeachingCheckoutAttempt, teachingCheckoutStorageKey, teachingCheckoutFailureStatus, verifyTeachingCheckoutReceipt, type TeachingCheckoutAttempt } from "@/lib/client/teaching-checkout-request";
import { persistTeachingCheckoutDraft, recoverTeachingCheckoutDraft, reviewedTeachingCheckoutAttempt, teachingCheckoutDraftSchema, teachingCheckoutDraftStorageKey, type SavedTeachingCheckoutDraft } from "@/lib/client/teaching-checkout-draft";
import styles from "./teaching-checkout.module.css";

export type TeachingCheckoutDraft =
    | { kind: "checkout"; group: TeachingGroup; ids: string[]; personalScope: InventoryFilter["personalScope"] }
    | { kind: "return"; run: TeachingCheckoutListedRun; personalScope: InventoryFilter["personalScope"] }
    | { kind: "recover"; attempt: TeachingCheckoutAttempt }
    | { kind: "resume"; saved: SavedTeachingCheckoutDraft };

function specifications(battery: BatteryRecord) {
    return `${battery.model || "Model not recorded"} · ${battery.chemistry || "Chemistry not recorded"} · ${battery.capacityMah === null ? "Capacity not recorded" : `${battery.capacityMah} mAh`} · ${battery.voltage === null ? "Voltage not recorded" : `${battery.voltage} V`}`;
}
function binding(battery: BatteryRecord) { return { batteryId: battery.id, tagId: battery.tagId, version: battery.version }; }
async function flushRecoveryStorage() {
    await (window as Window & { __batteryWorkflowStorage?: { flush(): Promise<void> } }).__batteryWorkflowStorage?.flush();
}

export function TeachingCheckoutDialog({ data, draft, onClose, onChanged, onLockedChange }: {
    data: InventorySnapshot; draft: TeachingCheckoutDraft; onClose: (inventory?: InventorySnapshot) => void;
    onChanged: () => Promise<void>; onLockedChange?: (locked: boolean) => void;
}) {
    const storageKey = teachingCheckoutStorageKey(data.user.id, data.dataset);
    const [recovery] = useState(() => {
        try {
            const raw = sessionStorage.getItem(storageKey), attempt = draft.kind === "recover" ? draft.attempt : recoverTeachingCheckoutAttempt(raw, data.user.id, data.dataset);
            const saved = attempt ? reviewedTeachingCheckoutAttempt(attempt) : draft.kind === "resume" ? draft.saved : recoverTeachingCheckoutDraft(sessionStorage.getItem(teachingCheckoutDraftStorageKey(data.user.id, data.dataset)), data.user.id, data.dataset);
            return { attempt, saved, blocked: false, message: "" };
        } catch (failure) { return { attempt: null, saved: null, blocked: true, message: `The preserved teaching workflow could not be read safely. ${(failure as Error).message} Restore access before starting another operation.` }; }
    });
    const recoveredReview = recovery.saved;
    const [inventory, setInventory] = useState(data);
    const [group] = useState(draft.kind === "checkout" ? draft.group : recoveredReview?.group);
    const [run] = useState(draft.kind === "return" ? draft.run : recoveredReview?.run);
    const checkout = recovery.attempt ? recovery.attempt.payload.action === "checkout" : recoveredReview ? recoveredReview.kind === "checkout" : draft.kind === "checkout";
    const personalScope = recovery.attempt?.payload.personalScope ?? recoveredReview?.personalScope ?? (draft.kind === "recover" || draft.kind === "resume" ? "all" : draft.personalScope);
    const [slots, setSlots] = useState<TeachingSelection[]>(() => recoveredReview?.slots ?? (draft.kind === "checkout" ? initialTeachingSelection(data, draft.group, draft.ids, draft.personalScope) : []));
    const [excludedIds, setExcludedIds] = useState<string[]>(recoveredReview?.excludedIds ?? []);
    const [selectedReturnIds, setSelectedReturnIds] = useState<string[]>(() => recovery.attempt?.payload.action === "return" ? recovery.attempt.payload.items.map(item => item.batteryId) : recoveredReview?.selectedReturnIds ?? (draft.kind === "return" ? draft.run.items.filter(item => item.status === "outstanding").map(item => item.batteryId) : []));
    const [manualOriginalId, setManualOriginalId] = useState(recoveredReview?.manualOriginalId ?? ""), [inputSource, setInputSource] = useState<TeachingSelectionSource["kind"]>(recoveredReview?.inputSource ?? "selection");
    const [pendingSource, setPendingSource] = useState<TeachingSelectionSource["kind"] | null>(null);
    const [filters, setFilters] = useState<InventoryFilter>(() => recoveredReview?.filters ?? ({ ...defaultInventoryFilter(), personalScope })), [page, setPage] = useState(0);
    const [attempt, setAttempt] = useState<TeachingCheckoutAttempt | null>(recovery.attempt), [busy, setBusy] = useState(false), [readerBusy, setReaderBusy] = useState(false), [message, setMessage] = useState(recovery.message);
    const [latest, setLatest] = useState<InventorySnapshot | null>(null), [storageBlocked, setStorageBlocked] = useState(false);
    const captured = useRef(attempt), running = useRef(false), mounted = useRef(true), finished = useRef(false);
    const locked = busy || !!attempt || recovery.blocked || storageBlocked, actionLocked = locked || readerBusy;
    const included = slots.filter(slot => !excludedIds.includes(slot.originalId)), unresolved = included.filter(slot => !slot.actual);
    const originalsMissing = included.filter(slot => !slot.original).map(slot => slot.originalId);
    const canReplace = (slot: TeachingSelection) => !!slot.original?.loanId && slot.original.borrowerAccountId !== data.user.id && slot.original.lifecycleStatus === "active" && !slot.issue?.includes("personal scope");
    const alternativeSlots = slots.filter(canReplace), selectedSlot = slots.find(slot => slot.originalId === manualOriginalId);
    const candidatePool = selectedSlot ? eligibleTeachingAlternatives(inventory, slots.filter(slot => !excludedIds.includes(slot.originalId) || slot.originalId === manualOriginalId), personalScope, manualOriginalId) : [];
    const { batteries: candidates, error: filterError } = getFilteredBatteries(inventory, { ...filters, personalScope }, candidatePool);
    const pages = Math.max(1, Math.ceil(candidates.length / 25)), currentPage = Math.min(page, pages - 1), visible = candidates.slice(currentPage * 25, currentPage * 25 + 25);

    useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
    function savedDraft(): SavedTeachingCheckoutDraft {
        return teachingCheckoutDraftSchema.parse({ actorAccountId: data.user.id, dataset: data.dataset, kind: checkout ? "checkout" : "return", ...(group ? { group } : {}), ...(run ? { run } : {}), slots, personalScope, excludedIds, selectedReturnIds, inputSource, manualOriginalId, filters });
    }
    function saveDraft() {
        try { persistTeachingCheckoutDraft(data.user.id, data.dataset, savedDraft()); setStorageBlocked(false); return true; }
        catch (failure) { setStorageBlocked(true); setMessage(`The reviewed draft could not be saved. ${(failure as Error).message} No business request will be sent until storage is restored.`); return false; }
    }
    useEffect(() => {
        if (!recovery.blocked && !captured.current && !finished.current) saveDraft();
        // Each changed review is saved with the complete bindings and acquisition evidence.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [slots, excludedIds, selectedReturnIds, inputSource, manualOriginalId, filters]);
    useEffect(() => { onLockedChange?.(actionLocked); return () => onLockedChange?.(false); }, [actionLocked, onLockedChange]);
    useEffect(() => {
        if (!attempt && !busy && !readerBusy && !recovery.blocked) return;
        const protect = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
        window.addEventListener("beforeunload", protect); return () => window.removeEventListener("beforeunload", protect);
    }, [attempt, busy, readerBusy, recovery.blocked]);
    function persist(next: TeachingCheckoutAttempt | null) {
        try {
            persistTeachingCheckoutAttempt(data.user.id, data.dataset, next);
            captured.current = next; setAttempt(next); return true;
        } catch {
            if (next) { captured.current = next; setAttempt(next); }
            setMessage("Browser storage could not preserve or clear this exact request. No replacement request will be sent. Restore storage, then retry the same request."); return false;
        }
    }
    function clearDraft() {
        try { persistTeachingCheckoutDraft(data.user.id, data.dataset, null); return true; }
        catch (failure) { setMessage(`The preserved draft could not be cleared. ${(failure as Error).message} Restore storage before closing.`); return false; }
    }
    async function close() {
        if (running.current || captured.current || readerBusy || recovery.blocked || !clearDraft()) return;
        running.current = true; setBusy(true);
        try { await flushRecoveryStorage(); finished.current = true; onClose(inventory !== data ? inventory : undefined); }
        catch (failure) { saveDraft(); setMessage(`The reviewed draft could not be cleared from device storage. ${(failure as Error).message}`); }
        finally { running.current = false; if (mounted.current) setBusy(false); }
    }
    function selectAlternative(actual: BatteryRecord, source: TeachingSelectionSource) {
        if (running.current || captured.current || recovery.blocked || storageBlocked) throw new Error("Resolve the preserved request before choosing an alternative.");
        if (!selectedSlot || !canReplace(selectedSlot)) throw new Error("Choose an original member currently borrowed by another staff member first.");
        if (source.kind !== inputSource) throw new Error(`This review list uses ${inputSource === "selection" ? "inventory selection" : inputSource === "tag" ? "entered tags" : "native NFC"}. Switch its input source explicitly before selecting this alternative.`);
        if (!candidatePool.some(candidate => candidate.id === actual.id)) throw new Error("This battery is unavailable, already selected, or outside the current inventory and personal scope. No alternative was added.");
        setSlots(previous => previous.map(slot => slot.originalId === manualOriginalId ? { ...slot, actual, method: "manual", source } : slot));
        setExcludedIds(previous => previous.filter(id => id !== manualOriginalId)); setMessage("");
    }
    function selectTag(tagId: string, source: TeachingSelectionSource) {
        const matches = inventory.batteries.filter(battery => battery.tagId === tagId);
        if (matches.length !== 1) throw new Error("This exact tag is not registered in this inventory. Check the identifier; no new asset or alternative was created.");
        selectAlternative(matches[0], source);
    }
    function requestSource(source: TeachingSelectionSource["kind"]) {
        if (actionLocked || source === inputSource) return;
        if (slots.some(slot => slot.method === "manual" && slot.actual && !excludedIds.includes(slot.originalId))) setPendingSource(source);
        else { setInputSource(source); setPendingSource(null); }
    }
    function acceptSource() {
        if (actionLocked || !pendingSource) return;
        setSlots(previous => previous.map(slot => slot.method === "manual" ? { ...slot, actual: null, method: "original", source: { kind: "selection" } } : slot));
        setInputSource(pendingSource); setPendingSource(null); setMessage("The manual choices were cleared for this explicit source change. Fixed members and automatic alternatives were retained. Review the empty slots again.");
    }
    function toggleExcluded(slot: TeachingSelection) {
        if (actionLocked) return;
        if (excludedIds.includes(slot.originalId) && slot.actual && slot.method === "manual" && slot.source.kind !== inputSource) {
            setMessage("This excluded alternative uses a different input source. Switch back to its source, or remove it and choose a new alternative before including this member."); return;
        }
        if (excludedIds.includes(slot.originalId) && slot.actual && slots.some(other => other.originalId !== slot.originalId && !excludedIds.includes(other.originalId) && other.actual?.id === slot.actual!.id)) {
            setMessage(`${slot.actual.id} is already selected for another member. Remove that alternative before including this member.`); return;
        }
        setExcludedIds(previous => previous.includes(slot.originalId) ? previous.filter(id => id !== slot.originalId) : [...previous, slot.originalId]);
    }
    function suggest() {
        if (actionLocked) return;
        const suggestions = suggestTeachingReplacements(inventory, included, personalScope);
        const added = suggestions.filter(slot => slot.actual && !included.find(previous => previous.originalId === slot.originalId)?.actual).length;
        setSlots(previous => previous.map(slot => suggestions.find(updated => updated.originalId === slot.originalId) ?? slot));
        setMessage(added ? `${added} automatic alternative${added === 1 ? "" : "s"} added to the review list. Known recorded specifications match; verified registered rooms are preferred. Unfilled slots need manual selection or explicit exclusion.` : "No strict automatic alternatives are available for the unresolved members. Choose manual alternatives or explicitly exclude those members.");
    }
    async function send(original: TeachingCheckoutAttempt, wasUncertain: boolean) {
        if (running.current || recovery.blocked) return;
        running.current = true; setBusy(true); setMessage("");
        const sending = { ...original, status: "uncertain" as const, message: "Waiting for the server to confirm this exact request." };
        try {
            if (!persist(sending)) return;
            await flushRecoveryStorage();
            const result = await inventoryResponse<{ result: unknown }>(await fetch("/api/teaching-checkouts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dataset: sending.dataset, payload: sending.payload }) }));
            verifyTeachingCheckoutReceipt(result.result, sending);
            if (!mounted.current || !clearDraft() || !persist(null)) return;
            await flushRecoveryStorage();
            finished.current = true;
            try { await onChanged(); } catch { setMessage("The request was confirmed, but inventory refresh failed. Refresh before starting another operation."); }
            onClose();
        } catch (failure) {
            if (!mounted.current) return;
            const status = teachingCheckoutFailureStatus(failure, wasUncertain);
            const failed = { ...sending, status, message: status === "uncertain" ? `Result uncertain. ${(failure as Error).message} Retry only this original request.` : (failure as Error).message };
            persist(failed);
        } finally { running.current = false; if (mounted.current) setBusy(false); }
    }
    async function confirm() {
        if (actionLocked || pendingSource || originalsMissing.length || checkout && (!group || !included.length || unresolved.length)) return;
        try {
            let payload: TeachingCheckoutRequest;
            if (checkout && group) payload = { action: "checkout", requestId: crypto.randomUUID(), teachingGroup: { id: group.id, version: group.version }, personalScope, mappings: included.map(slot => ({ original: binding(slot.original!), actual: binding(slot.actual!), originalLoanId: slot.original!.loanId, method: slot.method, source: slot.source })) };
            else {
                if (!run) throw new Error("The saved checkout record is unavailable. No return was sent.");
                const items = run.items.filter(item => selectedReturnIds.includes(item.batteryId));
                if (!items.length || items.some(item => item.status !== "outstanding" || !item.loanId || item.version === null)) throw new Error("Only the reviewed outstanding loans can be returned. Refresh and review this checkout again.");
                payload = { action: "return", requestId: crypto.randomUUID(), runId: run.id, personalScope, items: items.map(item => ({ batteryId: item.batteryId, tagId: item.tagId, version: item.version!, loanId: item.loanId!, source: { kind: "selection" } })) };
            }
            if (!saveDraft()) return;
            await send(captureTeachingCheckoutAttempt(data.user.id, data.dataset, payload, savedDraft()), false);
        } catch (failure) { setMessage((failure as Error).message); }
    }
    async function reviewLatest() {
        if (running.current || captured.current?.status !== "rejected") return;
        running.current = true; setBusy(true); setMessage("");
        try {
            const value = await inventoryResponse<InventorySnapshot>(await fetch(`/api/inventory?dataset=${data.dataset}`, { cache: "no-store" }));
            if (value.dataset !== data.dataset || value.user.id !== data.user.id) throw new Error("The original inventory or staff account changed. Restore the original sign-in.");
            setLatest(value);
        } catch (failure) { setMessage((failure as Error).message); }
        finally { running.current = false; setBusy(false); }
    }
    async function discardRejected() {
        const rejected = captured.current;
        if (running.current || !latest || rejected?.status !== "rejected" || !clearDraft() || !persist(null)) return;
        running.current = true; setBusy(true);
        try { await flushRecoveryStorage(); finished.current = true; setInventory(latest); onClose(latest); }
        catch (failure) { persist(rejected); setMessage(`The rejected request could not be cleared from device storage. ${(failure as Error).message}`); }
        finally { running.current = false; if (mounted.current) setBusy(false); }
    }
    return <Dialog open onOpenChange={open => !open && close()}><DialogContent className={styles.dialog} showCloseButton={!actionLocked} onEscapeKeyDown={event => { if (actionLocked) event.preventDefault(); }} onInteractOutside={event => { if (actionLocked) event.preventDefault(); }}><DialogHeader><DialogTitle>{checkout ? "Review teaching group checkout" : "Return this actual checkout"}</DialogTitle><DialogDescription>{checkout ? "Retain available fixed members, choose temporary alternatives, then explicitly confirm the actual batteries. The fixed teaching group stays unchanged." : "Choose all or part of the actual checkout. Each return uses its original recorded loan ID."}</DialogDescription></DialogHeader>
        <div className="detail-card"><strong>{group?.name ?? run?.teachingGroup.name ?? "Preserved group request"}</strong><p className="field-hint">{checkout ? `Checkout to ${data.user.displayName} · ${data.user.username}. Recommendations do not reserve stock.` : `Original checkout: ${formatTime(run?.createdAt)} · ${run?.id ?? (attempt?.payload.action === "return" ? attempt.payload.runId : "")}`}</p>{personalScope !== "all" && <p className="field-hint">Fixed personal scope: {personalScope === "responsible" ? "My batteries" : "My batteries in use"}. Alternatives cannot extend beyond this scope.</p>}</div>
        {checkout ? <>
            <div className="review-title"><strong>{included.filter(slot => slot.actual).length} actual batteries selected</strong><span>{unresolved.length} unresolved · {excludedIds.length} explicitly excluded</span></div>
            <div className={styles.slotList}>{slots.map(slot => <article key={slot.originalId} className={styles.slot} data-selected={manualOriginalId === slot.originalId} data-excluded={excludedIds.includes(slot.originalId)}>
                <div><h3>Fixed member · {slot.originalId}</h3>{slot.original ? <><p>{slot.original.name}</p><p>{specifications(slot.original)}</p><p>{storageRoomLabel(slot.original)}</p>{slot.original.loanId && <p>{slot.original.borrowerAccountId === data.user.id ? "Already checked out to you; this existing loan will not be checked out again." : `In use by ${slot.original.borrowerName ?? "another staff member"}`}</p>}{slot.original.lifecycleStatus !== "active" && <p>Retired member; unavailable for this checkout.</p>}</> : <p>The original battery record is unavailable.</p>}{slot.issue && <p className="field-hint">{slot.issue}</p>}</div>
                <div><h3>{slot.method === "manual" ? "Manual alternative" : slot.method === "automatic" ? "Automatic alternative" : "Actual battery"}</h3>{slot.actual ? <><p><strong>{slot.actual.id}</strong> · {slot.actual.name}</p><p>{specifications(slot.actual)}</p><p>{storageRoomLabel(slot.actual)}</p>{slot.method === "manual" && slot.original && <p className={styles.warning}>{teachingSpecificationDifferences(slot.original, slot.actual).join(" · ") || "Recorded model and specifications match; manually chosen."} The teacher must confirm suitability.</p>}{slot.method === "automatic" && <p className="field-hint">Known recorded model, chemistry, capacity and voltage match. Physical compatibility is not inferred.</p>}<p className="field-hint">{slot.source.kind === "native_nfc" ? "Adopted native NFC reading" : slot.source.kind === "tag" ? "Entered registered tag" : "Inventory selection"}</p></> : <p>No actual battery selected. Choose an alternative or explicitly exclude this member.</p>}</div>
                <div className={styles.slotActions}>{canReplace(slot) && <Button variant="outline" size="sm" disabled={actionLocked} onClick={() => setManualOriginalId(slot.originalId)}>Choose manual alternative<ArrowRight size={14}/></Button>}{slot.method !== "original" && slot.actual && <Button variant="ghost" size="sm" disabled={actionLocked} onClick={() => setSlots(previous => previous.map(item => item.originalId === slot.originalId ? { ...item, actual: null, method: "original", source: { kind: "selection" } } : item))}>Remove alternative</Button>}<Button variant="ghost" size="sm" disabled={actionLocked} onClick={() => toggleExcluded(slot)}>{excludedIds.includes(slot.originalId) ? "Include this member" : "Exclude from this checkout"}</Button></div>
            </article>)}</div>
            {!!originalsMissing.length && <p className="form-error" role="alert">Requested members are no longer available: {originalsMissing.join(", ")}. Cancel and reopen the group before preparing a new checkout.</p>}
            <Button variant="outline" disabled={actionLocked || !included.some(slot => !slot.actual && canReplace(slot))} onClick={suggest}>Replace unavailable batteries</Button>
            {!!alternativeSlots.length && <section className={styles.manualPanel} aria-label="Manual alternative selection"><h3>Manual alternatives</h3><p className="field-hint">Manual choices may have different or unknown specifications. Select the original member, review the chosen battery and confirm its suitability before checkout.</p><div className="form-field"><Label>Original member to replace</Label><Select value={manualOriginalId} disabled={actionLocked} onValueChange={setManualOriginalId}><SelectTrigger aria-label="Original member to replace"><SelectValue placeholder="Choose an unavailable fixed member…"/></SelectTrigger><SelectContent>{alternativeSlots.map(slot => <SelectItem key={slot.originalId} value={slot.originalId}>{slot.originalId} · {slot.original?.name ?? "Unavailable member"}</SelectItem>)}</SelectContent></Select></div><div className="flex flex-wrap gap-2" role="group" aria-label="Manual alternative input source">{([ ["selection", "Inventory selection"], ["tag", "Entered tag"], ["native_nfc", "Native NFC"] ] as const).map(([source, label]) => <Button key={source} variant={inputSource === source ? "default" : "outline"} disabled={actionLocked} onClick={() => requestSource(source)}>{label}</Button>)}</div>
                {pendingSource && <div className="detail-card" role="alert"><p>Switching source clears the current manual alternatives. Fixed members and automatic suggestions stay selected.</p><div className="flex flex-wrap gap-2"><Button variant="outline" disabled={actionLocked} onClick={acceptSource}>Switch source and clear manual choices</Button><Button variant="ghost" disabled={actionLocked} onClick={() => setPendingSource(null)}>Keep current source</Button></div></div>}
                <BatteryFilterControls data={inventory} filters={{ ...filters, personalScope }} onChange={patch => { if (!actionLocked) { setFilters(previous => ({ ...previous, ...patch, personalScope })); setPage(0); } }} onClear={() => { if (!actionLocked) { setFilters({ ...defaultInventoryFilter(), personalScope }); setPage(0); } }} disabled={actionLocked} showLifecycle={false} scopeNote="Candidates may be outside the fixed group, within the same inventory and fixed personal scope. Only active batteries without a recorded loan are available. Clear filters retains the reviewed alternatives."/>
                {filterError && <p className="form-error" role="alert">{filterError}</p>}
                {inputSource === "selection" ? <><p className="field-hint">{selectedSlot ? `${candidates.length} matching available alternatives` : "Choose the original member above to view alternatives."}</p><div className={styles.candidateList}><Table><TableHeader><TableRow><TableHead>BATTERY / SPECIFICATIONS</TableHead><TableHead>REGISTERED STORAGE</TableHead><TableHead>SELECT</TableHead></TableRow></TableHeader><TableBody>{visible.map(battery => <TableRow key={battery.id}><TableCell><strong>{battery.id}</strong><span className="cell-secondary">{battery.name}</span><span className="cell-secondary">{specifications(battery)}</span></TableCell><TableCell>{storageRoomLabel(battery)}</TableCell><TableCell><Button variant="outline" size="sm" disabled={actionLocked || !!pendingSource} onClick={() => { try { selectAlternative(battery, { kind: "selection" }); } catch (failure) { setMessage((failure as Error).message); } }} aria-label={`Choose ${battery.id} as manual alternative`}>Choose</Button></TableCell></TableRow>)}</TableBody></Table>{selectedSlot && !visible.length && <p className="p-4 text-sm">No available batteries match these filters.</p>}</div>{pages > 1 && <div className="flex items-center justify-between gap-2"><Button variant="outline" size="sm" disabled={actionLocked || !currentPage} onClick={() => setPage(currentPage - 1)}>Previous</Button><span className="field-hint">Page {currentPage + 1} of {pages}</span><Button variant="outline" size="sm" disabled={actionLocked || currentPage + 1 >= pages} onClick={() => setPage(currentPage + 1)}>Next</Button></div>}</> : <TeachingNfcInput disabled={locked || !selectedSlot || !!pendingSource} onChooseTag={selectTag} onBusyChange={setReaderBusy}/>}
            </section>}
            {!!excludedIds.length && <p className={styles.warning}>Explicitly excluded from this checkout: {excludedIds.join(", ")}. These members and their existing loans remain unchanged.</p>}
        </> : <div className="review-list"><Table><TableHeader><TableRow><TableHead>RETURN</TableHead><TableHead>ACTUAL BATTERY</TableHead><TableHead>RECORDED LOAN</TableHead></TableRow></TableHeader><TableBody>{(run?.items ?? (attempt?.payload.action === "return" ? attempt.payload.items.map(item => ({ ...item, status: "outstanding" as const, returnedAt: null })) : [])).map(item => <TableRow key={item.batteryId}><TableCell><Checkbox aria-label={`Return ${item.batteryId}`} checked={selectedReturnIds.includes(item.batteryId)} disabled={actionLocked || item.status !== "outstanding"} onCheckedChange={value => { if (!actionLocked && item.status === "outstanding") setSelectedReturnIds(previous => value === true ? [...new Set([...previous, item.batteryId])] : previous.filter(id => id !== item.batteryId)); }}/></TableCell><TableCell><strong>{item.batteryId}</strong><span className="cell-secondary">{inventory.batteries.find(battery => battery.id === item.batteryId)?.name ?? "Historic asset"}</span></TableCell><TableCell>{item.status}<span className="cell-secondary">{item.loanId}</span></TableCell></TableRow>)}</TableBody></Table></div>}
        {storageBlocked && <Button variant="outline" onClick={saveDraft} disabled={busy || readerBusy}>Retry saving this draft</Button>}
        {message && <p role="status" className="form-message">{message}</p>}
        {attempt && <div className="detail-card" role="alert"><h3>{busy ? "Submitting captured request…" : attempt.status === "uncertain" ? "Result uncertain" : "Request rejected"}</h3><p>{attempt.message}</p><p className="field-hint">Original request: {attempt.payload.requestId}. Battery, tag, version, loan and source evidence are locked until this exact request is resolved.</p>{attempt.status === "uncertain" ? <Button disabled={busy || readerBusy} onClick={() => { const saved = captured.current; if (saved) void send(saved, true); }}><RefreshCw size={16}/>Retry same request</Button> : <Button variant="outline" disabled={busy} onClick={reviewLatest}><RefreshCw size={16}/>Review current records</Button>}</div>}
        {latest && <div className="detail-card"><h3>Current records reviewed</h3><p>The preserved request was rejected. Its selections were not silently changed. Discard it explicitly, then reopen the current group or actual checkout to prepare a new review.</p>{attempt?.payload.action === "checkout" && attempt.payload.mappings.map(mapping => { const current = latest.batteries.find(battery => battery.id === mapping.actual.batteryId); return <p key={mapping.actual.batteryId}><strong>{mapping.actual.batteryId}</strong> · {!current ? "Unavailable" : current.loanId ? `In use by ${current.borrowerName ?? "staff"}` : current.lifecycleStatus === "active" ? "In store" : "Retired"} · {current ? `Current version ${current.version}, reviewed version ${mapping.actual.version}` : ""}</p>; })}<Button variant="outline" disabled={busy} onClick={discardRejected}>Discard rejected request and close</Button></div>}
        <DialogFooter className={styles.footer}><Button variant="outline" disabled={actionLocked} onClick={close}>Cancel review</Button><Button disabled={actionLocked || !!pendingSource || (checkout ? !included.length || !!unresolved.length || !!originalsMissing.length : !selectedReturnIds.length)} onClick={confirm}>{busy ? "Saving…" : checkout ? `Confirm actual checkout (${included.filter(slot => slot.actual).length})` : `Confirm exact return (${selectedReturnIds.length})`}</Button></DialogFooter>
    </DialogContent></Dialog>;
}
