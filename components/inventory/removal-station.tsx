"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, LogOut, ScanLine, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { BatteryRecord, InventorySnapshot } from "@/lib/domain";
import { formatTime } from "@/lib/client-utils";
import { captureLifecycleAttempt, lifecycleFailureStatus, lifecycleStorageKey, recoverLifecycleSession, verifyLifecycleReceipt, type LifecycleAttempt, type LifecyclePayload, type LifecycleReceipt } from "@/lib/lifecycle-session";
import { captureRemovalDraft, recoverRemovalDraft, removalDraftStorageKey, type RemovalDraft } from "@/lib/removal-draft";
import type { WriteAction } from "./movement-dialog";

import type { TeachingGroupReference } from "@/lib/teaching-context";

type QueueItem = RemovalDraft["items"][number];
export type RemovalStationProps = {
    data: InventorySnapshot;
    write: WriteAction;
    onChanged?: () => void | Promise<void>;
    onDetail?: (id: string) => void;
    paused?: boolean;
    onBusyChange?: (locked: boolean) => void;
    onExit?: () => void;
    initialIds?: string[];
    teachingGroup?: TeachingGroupReference;
};
function failureMessage(error: unknown) {
    return (error as { issues?: { message: string }[] })?.issues?.[0]?.message || (error as Error)?.message || "The removal could not be confirmed.";
}
function lifecycleLabel(status: string) { return status === "scrapped" ? "Scrapped" : status === "permanently_removed" ? "Permanently removed" : "Active"; }
function eligible(battery: BatteryRecord) { return battery.lifecycleStatus === "active" && !battery.loanId; }
function sameBinding(battery: BatteryRecord | undefined, item: QueueItem) {
    return !!battery && eligible(battery) && battery.version === item.version && battery.tagId === item.tagId;
}
function withExactRequest(draft: RemovalDraft, attempt: LifecycleAttempt, data: InventorySnapshot): RemovalDraft {
    const capturedIds = new Set(attempt.payload.items.map(item => item.batteryId));
    const items = [...draft.items.filter(item => !capturedIds.has(item.batteryId)), ...attempt.payload.items.map(item => ({ ...item, name: draft.items.find(saved => saved.batteryId === item.batteryId)?.name || data.batteries.find(battery => battery.id === item.batteryId)?.name || "Recorded battery" }))];
    return captureRemovalDraft({ ...draft, kind: attempt.payload.kind, source: attempt.payload.source, reason: attempt.payload.reason, destination: attempt.payload.destination || "", items, selectedIds: [...new Set([...draft.selectedIds, ...capturedIds])], teachingGroup: attempt.payload.teachingGroup });
}

export function RemovalStation({ data, write, onChanged, onDetail, paused = false, onBusyChange, onExit, initialIds = [], teachingGroup }: RemovalStationProps) {
    const [context] = useState(() => ({ actorAccountId: data.user.id, dataset: data.dataset }));
    const contextMatches = context.actorAccountId === data.user.id && context.dataset === data.dataset;
    const storageKey = lifecycleStorageKey(context.actorAccountId, context.dataset);
    const draftKey = removalDraftStorageKey(context.actorAccountId, context.dataset);
    const [recovery] = useState(() => {
        try {
            const raw = sessionStorage.getItem(storageKey), savedDraft = sessionStorage.getItem(draftKey);
            const attempt = recoverLifecycleSession(raw, context.actorAccountId, context.dataset), draft = recoverRemovalDraft(savedDraft, context.actorAccountId, context.dataset);
            const invalid = !!raw && !attempt || !!savedDraft && !draft;
            const base: RemovalDraft = draft && (draft.items.length || !initialIds.length) ? draft : { ...context, source: "manual_selection", kind: "scrapped", reason: "", destination: "", items: [], selectedIds: [], ...(teachingGroup ? { teachingGroup } : {}) };
            if ((!draft || !draft.items.length) && !attempt && initialIds.length) {
                base.items = initialIds.flatMap(id => { const b = data.batteries.find(b => b.id === id); return b && eligible(b) ? [{ batteryId: b.id, version: b.version, tagId: b.tagId, name: b.name }] : []; });
                base.selectedIds = base.items.map(item => item.batteryId);
            }
            return { attempt, draft: attempt && !invalid ? withExactRequest(base, attempt, data) : base, invalid, message: invalid ? "The saved removal request or review draft could not be recovered. No new request will replace it. Preserve this tab and ask the administrator to review the saved records." : "" };
        } catch { return { attempt: null, draft: { ...context, source: "manual_selection", kind: "scrapped", reason: "", destination: "", items: [], selectedIds: [] } as RemovalDraft, invalid: true, message: "This tab could not read its saved removal request or review draft. No new request will replace any earlier unresolved removal. Restore browser storage access, then reopen this workflow or reload this tab with the same account and inventory." }; }
    });
    const currentDraft = useRef<RemovalDraft>(recovery.draft);
    const initialDraftPreserved = useRef(false);
    const [queue, setQueue] = useState<QueueItem[]>(recovery.draft.items);
    const queueRef = useRef(queue);
    const [selected, setSelected] = useState<string[]>(recovery.draft.selectedIds);
    const [source, setSource] = useState<LifecyclePayload["source"]>(recovery.draft.source);
    const [kind, setKind] = useState<LifecyclePayload["kind"]>(recovery.draft.kind);
    const [reason, setReason] = useState(recovery.draft.reason);
    const [destination, setDestination] = useState(recovery.draft.destination);
    const [search, setSearch] = useState(""), [tag, setTag] = useState("");
    const [attempt, setAttempt] = useState<LifecycleAttempt | null>(recovery.attempt);
    const pending = useRef(attempt), running = useRef(false), storageBlocked = useRef(false), live = useRef(true);
    const [storageCandidate, setStorageCandidate] = useState<LifecycleAttempt | null>(null);
    const [draftCandidate, setDraftCandidate] = useState<RemovalDraft | null>(null);
    const [busy, setBusy] = useState(false), [error, setError] = useState(recovery.message), [storageError, setStorageError] = useState("");
    const [notice, setNotice] = useState(""), [completed, setCompleted] = useState<LifecycleReceipt[]>([]);
    const contextLocked = paused || !contextMatches || recovery.invalid;
    const locked = busy || contextLocked || !!attempt || !!storageCandidate || !!draftCandidate || !!storageError;
    const completedIds = new Set(completed.flatMap(receipt => receipt.items.map(item => item.batteryId)));
    const groupRef = recovery.draft.teachingGroup;
    const group = data.teachingGroups?.find(group => group.id === groupRef?.id && group.version === groupRef.version);
    const candidates = data.batteries.filter(battery => (!groupRef || group?.batteryIds.includes(battery.id)) && eligible(battery) && !completedIds.has(battery.id) && !queue.some(item => item.batteryId === battery.id));
    const matching = candidates.filter(battery => `${battery.id} ${battery.name} ${battery.model} ${battery.tagId || ""} ${battery.ownerName}`.toLowerCase().includes(search.trim().toLowerCase()));
    const stale = queue.filter(item => !sameBinding(data.batteries.find(battery => battery.id === item.batteryId), item));

    useEffect(() => { live.current = contextMatches; return () => { live.current = false; }; }, [contextMatches, data.dataset, data.user.id]);
    useEffect(() => { onBusyChange?.(busy || !!attempt || !!storageCandidate || !!draftCandidate || !!storageError || recovery.invalid); }, [busy, attempt, storageCandidate, draftCandidate, storageError, recovery.invalid, onBusyChange]);
    useEffect(() => () => { onBusyChange?.(false); }, [onBusyChange]);
    useEffect(() => {
        if (!busy && !attempt && !storageCandidate && !draftCandidate) return;
        const protect = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
        window.addEventListener("beforeunload", protect);
        return () => window.removeEventListener("beforeunload", protect);
    }, [busy, attempt, storageCandidate, draftCandidate]);

    function canEdit() { return live.current && !locked && !running.current && !pending.current && !storageBlocked.current; }
    function applyDraft(draft: RemovalDraft) {
        currentDraft.current = draft; queueRef.current = draft.items; setQueue(draft.items); setSelected(draft.selectedIds);
        setSource(draft.source); setKind(draft.kind); setReason(draft.reason); setDestination(draft.destination);
    }
    function persistDraft(next: RemovalDraft) {
        let captured: RemovalDraft;
        try { captured = captureRemovalDraft(next); }
        catch (error) { setError(failureMessage(error)); return false; }
        try {
            sessionStorage.setItem(draftKey, JSON.stringify(captured)); applyDraft(captured); setDraftCandidate(null);
            storageBlocked.current = false; setStorageError(""); return true;
        } catch {
            storageBlocked.current = true; setDraftCandidate(captured);
            setStorageError("This tab could not preserve the removal review draft. No replacement queue change or confirmation will be accepted. Restore browser storage to retain the exact review."); return false;
        }
    }
    function changeDraft(patch: Partial<RemovalDraft>) { if (canEdit()) persistDraft({ ...currentDraft.current, ...patch }); }
    function addBattery(battery: BatteryRecord) {
        if (groupRef && !group?.batteryIds.includes(battery.id)) { setError("This battery is outside the reviewed group, or the group changed. Reopen the group to review its members."); return; }
        if (!canEdit()) return;
        const current = data.batteries.find(item => item.id === battery.id);
        if (!current || !eligible(current) || completedIds.has(current.id)) { setError("Only active batteries that are not in use can enter this queue. Return a borrowed battery first."); return; }
        if (queueRef.current.some(item => item.batteryId === current.id)) { setNotice(`${current.id} is already queued.`); return; }
        if (queueRef.current.length >= 100) { setError("Confirm this queue before adding more batteries. A request supports up to 100 batteries."); return; }
        if (persistDraft({ ...currentDraft.current, items: [...queueRef.current, { batteryId: current.id, version: current.version, tagId: current.tagId, name: current.name }], selectedIds: [...currentDraft.current.selectedIds, current.id] })) {
            setError(""); setNotice(`${current.id} added to the reviewed queue. Nothing has been removed yet.`);
        }
    }
    function readTag() {
        if (!canEdit() || source !== "tag_entry") return;
        const exact = tag.trim(), matches = data.batteries.filter(battery => battery.tagId === exact);
        if (!exact) { setError("Enter a registered tag identifier."); return; }
        if (matches.length !== 1) { setError("This tag does not identify exactly one registered battery in this inventory."); return; }
        addBattery(matches[0]); setTag("");
    }
    function removeQueued(id: string) {
        if (!canEdit()) return;
        if (persistDraft({ ...currentDraft.current, items: queueRef.current.filter(item => item.batteryId !== id), selectedIds: currentDraft.current.selectedIds.filter(item => item !== id) })) setError("");
    }
    function persist(next: LifecycleAttempt | null) {
        try {
            if (next) sessionStorage.setItem(storageKey, JSON.stringify(next)); else sessionStorage.removeItem(storageKey);
            pending.current = next; storageBlocked.current = false; setAttempt(next); setStorageCandidate(null); setStorageError(""); return true;
        } catch {
            storageBlocked.current = true; setStorageCandidate(next || pending.current);
            setStorageError("This tab could not preserve or clear the exact removal request. No new request will be sent. Restore browser storage and retry the preserved request."); return false;
        }
    }
    function restoreRecovery() {
        if (busy || contextLocked) return;
        const captured = storageCandidate || pending.current, review = draftCandidate || currentDraft.current;
        if (captured) {
            if (!persistDraft(withExactRequest(review, captured, data)) || !persist(captured)) return;
        } else if (draftCandidate) persistDraft(draftCandidate);
    }
    async function confirm(ids: string[], retry = false) {
        if (!live.current || busy || running.current || contextLocked || (!retry && !canEdit()) || (retry && !pending.current)) return;
        running.current = true; setBusy(true); setError(""); setNotice("");
        let captured = pending.current;
        try {
            if (!captured) {
                const items = queueRef.current.filter(item => ids.includes(item.batteryId));
                if (!items.length) throw new Error("Choose at least one queued battery to confirm.");
                if (items.some(item => !sameBinding(data.batteries.find(battery => battery.id === item.batteryId), item))) throw new Error("A queued battery changed or is now unavailable. Remove that queue item, review its current record and add it again before confirming.");
                const review = currentDraft.current;
                captured = captureLifecycleAttempt(context.actorAccountId, context.dataset, { requestId: crypto.randomUUID(), kind: review.kind, reason: review.reason, destination: review.kind === "permanently_removed" ? review.destination.trim() || null : null, source: review.source, items: items.map(({ batteryId, version, tagId }) => ({ batteryId, version, tagId })), ...(review.teachingGroup ? { teachingGroup: review.teachingGroup } : {}) });
                if (!persistDraft(review)) { setStorageCandidate(captured); return; }
                if (!persist(captured)) return;
            }
            const result = await write("lifecycle", captured.payload), receipt = verifyLifecycleReceipt(result, captured);
            if (!live.current) {
                try {
                    const saved = recoverLifecycleSession(sessionStorage.getItem(storageKey), context.actorAccountId, context.dataset);
                    if (saved?.payload.requestId === captured.payload.requestId) {
                        const review = recoverRemovalDraft(sessionStorage.getItem(draftKey), context.actorAccountId, context.dataset);
                        if (review) {
                            const committed = new Set(receipt.items.map(item => item.batteryId));
                            sessionStorage.setItem(draftKey, JSON.stringify(captureRemovalDraft({ ...review, items: review.items.filter(item => !committed.has(item.batteryId)), selectedIds: review.selectedIds.filter(id => !committed.has(id)) })));
                            sessionStorage.removeItem(storageKey);
                        }
                    }
                } catch { /* Retain the verified request for exact replay when storage cannot be cleared. */ }
                return;
            }
            setCompleted(receipts => receipts.some(saved => saved.requestId === receipt.requestId) ? receipts : [...receipts, receipt]);
            const committed = new Set(receipt.items.map(item => item.batteryId));
            setNotice(`${receipt.items.length} ${receipt.items.length === 1 ? "battery" : "batteries"} recorded as ${lifecycleLabel(receipt.kind).toLowerCase()}. ${receipt.replayed ? "Saved result recovered." : "The queue is ready for the next review."}`);
            if (!persistDraft({ ...currentDraft.current, items: queueRef.current.filter(item => !committed.has(item.batteryId)), selectedIds: currentDraft.current.selectedIds.filter(id => !committed.has(id)) })) return;
            persist(null);
            try { await onChanged?.(); }
            catch { if (live.current) setError("The removal was recorded, but the inventory display could not refresh. Its verified receipt remains below."); }
        } catch (error) {
            if (!live.current) return;
            if (captured && lifecycleFailureStatus(error) === "rejected") persist(null);
            setError(captured && lifecycleFailureStatus(error) === "unknown" ? `${failureMessage(error)} The outcome is unconfirmed. Retry this exact removal before confirming another request.` : failureMessage(error));
        } finally { running.current = false; if (live.current) setBusy(false); }
    }

    useEffect(() => {
        if (initialDraftPreserved.current) return;
        initialDraftPreserved.current = true;
        if (initialIds.length && recovery.draft.items.length && !recovery.invalid && !recovery.attempt) persistDraft(currentDraft.current);
    });
    return <section className="removal-station" aria-busy={busy}>{groupRef && <p className="group-context-banner">Teaching group: <strong>{group?.name ?? "Previously reviewed group"}</strong>. Removal records retain the reviewed group and actual members.</p>}
        <div className="section-heading station-exit-bar"><div><h2>Retire or remove batteries</h2><p className="field-hint">Queue active batteries, optionally add a reason and confirm all or selected items. Both staff and administrators may use this workflow.</p><p className="station-exit-hint">{locked ? "Resolve the current confirmation or storage issue before leaving this workflow." : "Return to inventory when finished. Your reviewed queue is kept in this tab."}</p></div>{onExit && <Button type="button" size="lg" className="station-exit-button" disabled={locked} onClick={() => { if (!locked && !running.current) onExit(); }}><LogOut size={20}/>Back to inventory</Button>}</div>
        <div className="working-notice"><ScanLine size={17}/><span><strong>No RFID reader is connected.</strong> Manual selection and tag entry only prepare a reviewed queue. This tab preserves the queue and settings for the same account and inventory. Confirmation preserves each asset and its complete history; it never returns an active loan automatically.</span></div>
        {!contextMatches && <p role="alert" className="form-error">The account or inventory changed. Reopen this workflow with the original account and inventory to resolve the captured request.</p>}
        <div className="removal-columns">
            <div className="removal-panel"><h3>Add batteries to the queue</h3><div className="removal-actions"><Button type="button" variant={source === "manual_selection" ? "default" : "outline"} onClick={() => { if (canEdit() && !queueRef.current.length) { changeDraft({ source: "manual_selection" }); setError(""); } }} disabled={locked || !!queue.length}>Manual selection</Button><Button type="button" variant={source === "tag_entry" ? "default" : "outline"} onClick={() => { if (canEdit() && !queueRef.current.length) { changeDraft({ source: "tag_entry" }); setError(""); } }} disabled={locked || !!queue.length}>Tag entry</Button></div><p className="field-hint">A queue uses one input source. Clear or confirm its items before switching sources. Batteries in use must be returned first.</p>
                {source === "manual_selection" ? <><div className="removal-search"><Label htmlFor="removal-search">Find an active battery</Label><Input id="removal-search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search battery, model, tag or owner…" disabled={locked}/><Button type="button" variant="outline" size="sm" onClick={() => setSearch("")} disabled={locked || !search}>Clear filters</Button></div><p className="field-hint">{matching.length} available batteries</p><div className="removal-candidates">{matching.map(battery => <Button key={battery.id} type="button" variant="outline" className="removal-candidate" onClick={() => { if (source === "manual_selection") addBattery(battery); }} disabled={locked || queue.length >= 100} aria-label={`Queue ${battery.id}`}><strong>{battery.id} · {battery.name}</strong><span>{battery.model || "Model not recorded"} · {battery.tagId || "No tag assigned"}</span><small>{battery.ownerName} · In store</small></Button>)}{!matching.length && <p className="empty-hint">No matching available batteries. Clear filters or return an active loan first.</p>}</div></> : <div className="form-field"><Label htmlFor="removal-tag">Registered tag identifier</Label><Input id="removal-tag" value={tag} onChange={event => { if (canEdit()) setTag(event.target.value); }} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); readTag(); } }} placeholder="Enter an exact registered tag…" disabled={contextLocked} readOnly={locked}/><Button type="button" variant="outline" onClick={readTag} disabled={locked || !tag.trim()}>Add tag to queue</Button></div>}
            </div>
            <div className="removal-panel"><div className="removal-panel-heading"><h3>Reviewed queue</h3><span>{queue.length}/100 queued · {selected.length} selected</span></div><div className="removal-actions"><Button type="button" variant="outline" size="sm" onClick={() => { changeDraft({ selectedIds: queueRef.current.map(item => item.batteryId) }); }} disabled={locked || !queue.length}>Select all queued</Button><Button type="button" variant="outline" size="sm" onClick={() => { changeDraft({ selectedIds: [] }); }} disabled={locked || !selected.length}>Deselect all queued</Button><Button type="button" variant="outline" size="sm" onClick={() => { if (canEdit() && persistDraft({ ...currentDraft.current, items: [], selectedIds: [] })) { setNotice(""); setError(""); } }} disabled={locked || !queue.length}>Clear queue</Button></div>
                <div className="removal-queue">{queue.map(item => <div key={item.batteryId} className="removal-queue-item"><label htmlFor={`removal-queued-${item.batteryId}`}><Checkbox id={`removal-queued-${item.batteryId}`} checked={selected.includes(item.batteryId)} disabled={locked} onCheckedChange={checked => { changeDraft({ selectedIds: checked === true ? [...new Set([...currentDraft.current.selectedIds, item.batteryId])] : currentDraft.current.selectedIds.filter(id => id !== item.batteryId) }); }}/><span><strong>{item.batteryId} · {item.name}</strong><small>Reviewed version {item.version} · {item.tagId || "No tag assigned"}</small>{stale.some(stale => stale.batteryId === item.batteryId) && <small className="form-error">Current record changed; review again before a new confirmation.</small>}</span></label><div>{onDetail && <Button type="button" size="sm" variant="ghost" onClick={() => onDetail(item.batteryId)} disabled={busy}>Details</Button>}<Button type="button" size="sm" variant="ghost" onClick={() => removeQueued(item.batteryId)} disabled={locked} aria-label={`Remove ${item.batteryId} from queue`}><Trash2 size={15}/></Button></div></div>)}{!queue.length && <p className="empty-hint">Choose batteries to begin. No removal is recorded by adding a queue item.</p>}</div>
                <div className="form-field"><Label htmlFor="removal-kind">Final status</Label><Select value={kind} disabled={locked} onValueChange={(next: LifecyclePayload["kind"]) => { changeDraft({ kind: next }); }}><SelectTrigger id="removal-kind"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="scrapped">Scrapped</SelectItem><SelectItem value="permanently_removed">Permanently removed</SelectItem></SelectContent></Select><p className="field-hint">Scrapped records a battery retired from use. Permanently removed records stock that has left this inventory. Neither deletes history or certifies physical disposal.</p></div>
                <div className="form-field"><Label htmlFor="removal-reason">Reason — optional</Label><Textarea id="removal-reason" value={reason} onChange={event => { changeDraft({ reason: event.target.value }); }} disabled={locked} maxLength={1000} placeholder="Add a reason for this batch, if available…"/></div>
                {kind === "permanently_removed" && <div className="form-field"><Label htmlFor="removal-destination">Destination — optional</Label><Input id="removal-destination" value={destination} onChange={event => { changeDraft({ destination: event.target.value }); }} disabled={locked} maxLength={200} placeholder="Known transfer or disposal destination…"/></div>}
                <div className="removal-actions"><Button type="button" onClick={() => confirm(currentDraft.current.selectedIds)} disabled={locked || !selected.length}>Confirm selected</Button><Button type="button" variant="outline" onClick={() => confirm(currentDraft.current.items.map(item => item.batteryId))} disabled={locked || !queue.length}>Confirm all queued</Button></div>
            </div>
        </div>
        {attempt && <div className="removal-pending"><strong>Preserved removal: {attempt.payload.items.length} batteries · {lifecycleLabel(attempt.payload.kind)}</strong><p className="field-hint">The original account, inventory, reason, bindings and request ID are retained. This result may already be saved. Resolve this exact request before preparing another confirmation.</p><Button type="button" variant="outline" onClick={() => confirm([], true)} disabled={busy || contextLocked}>Retry exact removal</Button></div>}
        {notice && <div role="status" className="removal-success"><CheckCircle2 size={17}/><span>{notice}</span></div>}{error && <p role="alert" className="form-error">{error}</p>}{storageError && <div role="alert" className="form-error"><p>{storageError}</p>{(storageCandidate || draftCandidate || attempt) && <Button type="button" variant="outline" size="sm" onClick={restoreRecovery} disabled={busy || contextLocked}>Restore request recovery</Button>}</div>}
        {completed.length > 0 && <div className="removal-panel"><h3>Recorded this session</h3><div className="removal-results"><Table><TableHeader><TableRow><TableHead>BATTERY</TableHead><TableHead>STATUS</TableHead><TableHead>RECORDED AT</TableHead><TableHead>SOURCE</TableHead></TableRow></TableHeader><TableBody>{completed.flatMap(receipt => receipt.items.map(item => <TableRow key={`${receipt.requestId}/${item.batteryId}`}><TableCell>{onDetail ? <button type="button" className="record-link" onClick={() => onDetail(item.batteryId)}>{item.batteryId}</button> : item.batteryId}</TableCell><TableCell>{lifecycleLabel(item.status)}</TableCell><TableCell>{formatTime(receipt.at)}</TableCell><TableCell>{receipt.source === "tag_entry" ? "Staff tag entry" : "Staff manual selection"}</TableCell></TableRow>))}</TableBody></Table></div></div>}
    </section>;
}

export function RemovalHistory({ data, onDetail, onDownload }: { data: InventorySnapshot; onDetail?: (id: string) => void; onDownload?: (ids: string[]) => void }) {
    const [search, setSearch] = useState(""), [status, setStatus] = useState("all");
    const matching = data.batteries.filter(battery => battery.lifecycleStatus !== "active" && (status === "all" || battery.lifecycleStatus === status) && `${battery.id} ${battery.name} ${battery.model} ${battery.ownerName} ${battery.lifecycleReason || ""} ${battery.lifecycleDestination || ""}`.toLowerCase().includes(search.trim().toLowerCase())).sort((a, b) => (b.lifecycleAt || "").localeCompare(a.lifecycleAt || "") || a.id.localeCompare(b.id));
    return <section className="removal-panel"><div className="removal-panel-heading"><div><h2>Removal history</h2><p className="field-hint">Retired assets remain available for details, recorded evidence and complete-history downloads.</p></div>{onDownload && <Button type="button" variant="outline" onClick={() => onDownload(matching.map(battery => battery.id))} disabled={!matching.length}>Download matching records</Button>}</div><div className="removal-history-filters"><Input aria-label="Search removal history" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search battery, owner, reason or destination…"/><Select value={status} onValueChange={setStatus}><SelectTrigger aria-label="Removal status"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="all">All retired records</SelectItem><SelectItem value="scrapped">Scrapped</SelectItem><SelectItem value="permanently_removed">Permanently removed</SelectItem></SelectContent></Select><Button type="button" variant="outline" onClick={() => { setSearch(""); setStatus("all"); }} disabled={!search && status === "all"}>Clear filters</Button></div>{(search || status !== "all") && <p className="field-hint">Applied filters: {status !== "all" && lifecycleLabel(status)}{status !== "all" && search && " · "}{search && `Search: ${search}`}</p>}<p className="field-hint">{matching.length} matching records</p><div className="removal-results"><Table><TableHeader><TableRow><TableHead>BATTERY</TableHead><TableHead>STATUS</TableHead><TableHead>REASON / DESTINATION</TableHead><TableHead>RECORDED AT</TableHead></TableRow></TableHeader><TableBody>{matching.map(battery => <TableRow key={battery.id}><TableCell>{onDetail ? <button type="button" className="record-link" onClick={() => onDetail(battery.id)}>{battery.id}</button> : <strong>{battery.id}</strong>}<span className="cell-secondary">{battery.name}</span></TableCell><TableCell>{lifecycleLabel(battery.lifecycleStatus)}</TableCell><TableCell>{battery.lifecycleReason || "Not recorded"}{battery.lifecycleDestination && <span className="cell-secondary">Destination: {battery.lifecycleDestination}</span>}</TableCell><TableCell>{battery.lifecycleAt ? formatTime(battery.lifecycleAt) : "Not recorded"}</TableCell></TableRow>)}</TableBody></Table></div>{!matching.length && <p className="empty-hint">No retired records match these filters.</p>}</section>;
}
