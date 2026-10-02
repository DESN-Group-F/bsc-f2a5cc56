"use client";
import { useEffect, useRef, useState } from "react";
import { ScanLine, Trash2, Radio, Plus, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Table, TableHeader, TableHead, TableRow, TableBody, TableCell } from "@/components/ui/table";
import { RecordPicker } from "./record-picker";
import type { BatteryRecord, InventorySnapshot } from "@/lib/domain";
import { formatTime, reloadSessionPage } from "@/lib/client-utils";
import { captureMovementAttempt, movementFailureStatus, movementStorageKey, recoverMovementAttempt, verifyMovementReceipt, type MovementAttempt } from "@/lib/movement-session";

export type MovementDraft = { kind: "checkout" | "return"; ids: string[]; nonce: string };
export type WriteAction = (action: string, payload: unknown, extra?: Record<string, unknown>) => Promise<unknown>;
type LatestReview = { inventory: InventorySnapshot; changes: { before: BatteryRecord; after: BatteryRecord | undefined }[] };

export function MovementDialog({ draft, data, onClose, write }: {
    draft: MovementDraft; data: InventorySnapshot; onClose: (reviewedInventory?: InventorySnapshot) => void; write: WriteAction;
}) {
    const storageKey = movementStorageKey(data.user.id, data.dataset, draft.kind);
    const [recovery] = useState(() => {
        try {
            const raw = sessionStorage.getItem(storageKey), attempt = recoverMovementAttempt(raw, data.user.id, data.dataset, draft.kind);
            return { attempt, invalidSaved: !!raw && !attempt, message: raw && !attempt ? "A saved movement request could not be recovered. No new movement will be sent or replace it. Preserve this tab and ask the administrator to investigate the saved request." : "" };
        } catch { return { attempt: null, invalidSaved: false, message: "Browser storage is unavailable. No movement can be sent until its exact request can be saved in this tab." }; }
    });
    const [inventory, setInventory] = useState(data), [ids, setIds] = useState(recovery.attempt?.payload.batteryIds ?? draft.ids);
    const [reviewed, setReviewed] = useState<Record<string, BatteryRecord>>(() => recovery.attempt ? Object.fromEntries(recovery.attempt.reviewed.map(battery => [battery.id, battery])) : Object.fromEntries(draft.ids.flatMap(id => {
        const battery = data.batteries.find(b => b.id === id);
        return battery ? [[id, battery]] : [];
    })));
    const [adding, setAdding] = useState(!recovery.attempt && !draft.ids.length), [allLoans, setAllLoans] = useState(false);
    const [tag, setTag] = useState(""), [picked, setPicked] = useState(""), [message, setMessage] = useState(recovery.message), [busy, setBusy] = useState(false);
    const [batterySearchActive, setBatterySearchActive] = useState(false), [searchReset, setSearchReset] = useState(0);
    const [attempt, setAttempt] = useState<MovementAttempt | null>(recovery.attempt), [latestReview, setLatestReview] = useState<LatestReview | null>(null);
    const captured = useRef(attempt), running = useRef(false);
    const locked = busy || !!attempt || recovery.invalidSaved;
    const checkout = draft.kind === "checkout";
    const queued = ids.map(id => reviewed[id]).filter(Boolean);
    const allEligible = inventory.batteries.filter(b => checkout ? !b.loanId : !!b.loanId);
    const eligible = allEligible.filter(b => checkout || allLoans || b.borrowerAccountId === data.user.id);
    const candidates = eligible.filter(b => !ids.includes(b.id));

    useEffect(() => {
        if (!busy && attempt?.status !== "uncertain" && !recovery.invalidSaved) return;
        const protect = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
        window.addEventListener("beforeunload", protect);
        return () => window.removeEventListener("beforeunload", protect);
    }, [busy, attempt?.status, recovery.invalidSaved]);
    function persist(next: MovementAttempt | null) {
        try {
            if (next) sessionStorage.setItem(storageKey, JSON.stringify(next));
            else sessionStorage.removeItem(storageKey);
            captured.current = next; setAttempt(next);
            window.dispatchEvent(new Event("battery-movement-recovery"));
            return true;
        } catch { setMessage("Browser storage could not preserve or clear this request. No replacement request will be sent. Restore browser storage and retry the same operation."); return false; }
    }
    function close() {
        if (running.current || captured.current?.status === "uncertain" || recovery.invalidSaved) return;
        if (captured.current) { setMessage("Review the current records and deliberately discard the rejected request before closing."); return; }
        onClose(inventory !== data ? inventory : undefined);
    }

    function addMany(batteries: BatteryRecord[]) {
        if (running.current || captured.current || recovery.invalidSaved) return;
        if (ids.length + batteries.length > 100) {
            setMessage("A movement can include up to 100 batteries. Confirm this list before starting another batch.");
            return;
        }
        setIds([...ids, ...batteries.map(b => b.id)]);
        setReviewed({ ...reviewed, ...Object.fromEntries(batteries.map(b => [b.id, b])) });
        setTag(""); setPicked(""); setMessage(""); setLatestReview(null);
    }
    function add(id: string) {
        if (running.current || captured.current || recovery.invalidSaved) return;
        const battery = inventory.batteries.find(b => b.id === id);
        if (!battery) { setMessage("This battery is not registered in the inventory. No changes were made."); return; }
        if (checkout && battery.loanId) { setMessage(`${battery.id} is already on loan to ${battery.borrowerName}.`); return; }
        if (!checkout && !battery.loanId) { setMessage(`${battery.id} has no active loan to return.`); return; }
        if (ids.includes(id)) { setMessage(`${id} is already in this list.`); return; }
        addMany([battery]);
    }
    function addTag() {
        const battery = inventory.batteries.find(b => b.tagId === tag.trim());
        if (battery) add(battery.id);
        else setMessage("This tag identifier is not registered. Check the identifier or register the battery first.");
    }
    function remove(id: string) { if (running.current || captured.current || recovery.invalidSaved) return; setIds(ids.filter(value => value !== id)); setLatestReview(null); }
    function clearFilters() { if (running.current || captured.current || recovery.invalidSaved) return; setAllLoans(false); setBatterySearchActive(false); setSearchReset(previous => previous + 1); }
    async function runAttempt(original: MovementAttempt, alreadyUncertain: boolean) {
        if (running.current || recovery.invalidSaved) return;
        running.current = true; setBusy(true); setMessage("");
        const sending = { ...original, status: "uncertain" as const, message: "Waiting for the server to confirm this exact request." };
        try {
            if (!persist(sending)) return;
            const result = await write("movement", sending.payload);
            verifyMovementReceipt(result, sending.payload, data.user.id);
            if (!persist(null)) return;
            onClose();
        } catch (error) {
            const status = movementFailureStatus(error, alreadyUncertain), statusCode = (error as { status?: number })?.status;
            const failed: MovementAttempt = { ...sending, status, message: status === "uncertain" ? `Result uncertain. ${(error as Error).message} Retry the original request before editing or closing.` : (error as Error).message, ...(statusCode ? { statusCode } : {}) };
            if (!persist(failed)) { captured.current = failed; setAttempt(failed); }
        } finally { running.current = false; setBusy(false); }
    }
    async function confirm() {
        if (running.current || captured.current || recovery.invalidSaved) return;
        try { await runAttempt(captureMovementAttempt(draft.kind, queued, data.user.id, data.dataset, crypto.randomUUID()), false); }
        catch (error) { setMessage((error as Error).message); }
    }
    async function reviewLatest() {
        if (running.current || captured.current?.status !== "rejected") return;
        running.current = true;
        setBusy(true); setMessage("");
        try {
            const response = await fetch(`/api/inventory?dataset=${data.dataset}`, { cache: "no-store" });
            if (response.status === 401) reloadSessionPage("/signin");
            const latest = await response.json() as InventorySnapshot & { error?: string };
            if (!response.ok) throw new Error(latest.error || "The latest loans could not be loaded.");
            if (latest.dataset !== data.dataset || latest.user?.id !== data.user.id || !Array.isArray(latest.batteries)) throw new Error("The staff account or inventory changed. Restore the original sign-in before reviewing this captured request.");
            setLatestReview({ inventory: latest, changes: queued.map(before => ({ before, after: latest.batteries.find(b => b.id === before.id) })) });
        } catch (error) { setMessage((error as Error).message); }
        finally { running.current = false; setBusy(false); }
    }
    function acceptLatest() {
        if (!latestReview || running.current || captured.current?.status !== "rejected" || !persist(null)) return;
        const next = latestReview.changes.flatMap(({ after }) => after && (checkout ? !after.loanId : !!after.loanId) ? [after] : []);
        setIds(next.map(b => b.id)); setReviewed(Object.fromEntries(next.map(b => [b.id, b])));
        setInventory(latestReview.inventory); setLatestReview(null);
        setMessage(checkout ? "The latest reviewed batteries are now in your draft. Unavailable or on-loan batteries were removed. Review the updated list before confirming a new request." : "The reviewed latest loans are now in your draft. Batteries without an active loan were removed. Confirm only after reviewing the updated list.");
        if (!next.length) setAdding(true);
    }
    function discardRejected() {
        if (!latestReview || running.current || captured.current?.status !== "rejected" || !persist(null)) return;
        onClose(latestReview.inventory);
    }
    return <Dialog open onOpenChange={open => !open && close()}><DialogContent className="movement-dialog" showCloseButton={!locked} onEscapeKeyDown={event => { if (locked) event.preventDefault(); }} onInteractOutside={event => { if (locked) event.preventDefault(); }}><DialogHeader><DialogTitle>{checkout ? "Check out batteries" : "Return batteries"}</DialogTitle><DialogDescription>{checkout ? "Review your selected batteries and confirm with your own staff account." : "Review each selected loan before confirming. You may receive batteries checked out by another staff member."}</DialogDescription></DialogHeader>
        {checkout && <div className="detail-card"><div className="key-value"><span>Checked out to</span><strong>{data.user.displayName} · {data.user.username}</strong></div><p>Your signed-in staff account is responsible for this checkout. The asset owner stays the same.</p></div>}
        <div className="review-title"><strong>Review list</strong><span>{queued.length} {queued.length === 1 ? "battery" : "batteries"}</span></div>
        <div className="review-list"><Table><TableHeader><TableRow><TableHead>BATTERY</TableHead><TableHead>{checkout ? "RESPONSIBLE OWNER" : "CURRENT HOLDER"}</TableHead><TableHead><span className="sr-only">Remove</span></TableHead></TableRow></TableHeader><TableBody>{queued.map(b => <TableRow key={b.id}><TableCell><strong>{b.id}</strong><span className="cell-secondary">{b.name}</span></TableCell><TableCell>{checkout ? b.ownerName : <>{b.borrowerName}<span className="cell-secondary">Checked out {formatTime(b.checkedOutAt)}</span></>}</TableCell><TableCell><Button variant="ghost" size="icon" aria-label={`Remove ${b.id}`} disabled={locked} onClick={() => remove(b.id)}><Trash2 size={16}/></Button></TableCell></TableRow>)}</TableBody></Table>{!queued.length && <div className="queue-empty"><ScanLine size={26}/><p>Add registered batteries below to prepare this {checkout ? "checkout" : "return"}.</p></div>}</div>
        <Button variant="outline" className="justify-start" aria-expanded={adding} aria-controls="movement-add-more" onClick={() => setAdding(!adding)} disabled={locked}>{adding ? "− Hide additional batteries" : "+ Add more batteries"}</Button>
        {adding && <div id="movement-add-more" className="form-stack">
            <p className="time-note">Add already registered batteries to this review list. These optional inputs do not create new battery records.</p>
            {!checkout && <><div className="flex flex-wrap gap-2" role="group" aria-label="Available return loans"><Button variant={allLoans ? "outline" : "default"} onClick={() => { setAllLoans(false); setPicked(""); }} disabled={locked}>My outstanding loans</Button><Button variant={allLoans ? "default" : "outline"} onClick={() => { setAllLoans(true); setPicked(""); }} disabled={locked}>All on-loan batteries</Button></div><p className="time-note">{allLoans ? "Any staff member may receive these loans. The original holder and your return action remain recorded." : "Showing active loans linked to your staff account. Explicitly selected batteries stay in the review list."}</p></>}
            <div className="reader-entry"><div className="form-field"><Label htmlFor="movement-battery">Search registered batteries</Label><RecordPicker id="movement-battery" options={candidates.map(b => ({ id: b.id, label: `${b.id} · ${b.name}${!checkout ? ` · ${b.borrowerName}` : ""}` }))} value={picked} onChange={id => { setPicked(id); if (id) add(id); }} placeholder="Search batteries…" disabled={locked} resetKey={searchReset} showClearFilters={false} onFilterChange={setBatterySearchActive}/></div><div className="form-field"><Label htmlFor="tag-input">Existing tag identifier (optional)</Label><div className="inline-input"><Input id="tag-input" value={tag} onChange={event => setTag(event.target.value)} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); addTag(); } }} placeholder={data.dataset === "demo" ? "e.g. DEMO-TAG-001" : "Enter a registered tag identifier"} disabled={locked}/><Button variant="outline" onClick={addTag} disabled={!tag.trim() || locked}><Plus />Add</Button></div></div></div>
            <Button variant="ghost" className="self-start" onClick={clearFilters} disabled={locked || !batterySearchActive && !allLoans}>Clear filters</Button>
            {!checkout && <><div className="review-title"><strong>{allLoans ? "Available on-loan batteries" : "Your outstanding batteries"}</strong><span>{candidates.length}</span></div>{candidates.length ? <div className="review-list"><Table><TableHeader><TableRow><TableHead>BATTERY</TableHead><TableHead>CURRENT HOLDER</TableHead><TableHead><span className="sr-only">Add</span></TableHead></TableRow></TableHeader><TableBody>{candidates.slice(0, 100).map(b => <TableRow key={b.id}><TableCell><strong>{b.id}</strong><span className="cell-secondary">{b.name}</span></TableCell><TableCell>{b.borrowerName}<span className="cell-secondary">Checked out {formatTime(b.checkedOutAt)}</span></TableCell><TableCell><Button variant="outline" size="sm" onClick={() => add(b.id)} disabled={locked || ids.length >= 100} aria-label={`Add ${b.id}`}><Plus size={16}/>Add</Button></TableCell></TableRow>)}</TableBody></Table></div> : <p className="time-note">{allLoans ? "No additional active loans are available." : "You have no additional outstanding loans. Choose All on-loan batteries to receive another holder's loan."}</p>}{candidates.length > 100 && <p className="time-note">The list shows the first 100 available batteries. Search above to find any other registered battery.</p>}</>}
            <div className="connection-message"><Radio size={18}/><span><strong>RFID reader not connected.</strong> Entering a tag identifier manually looks up an existing record; it does not read an RFID device.</span></div>
            {data.dataset === "demo" && <Button variant="outline" className="demo-reading-button" onClick={() => { const sample = candidates.slice(0, Math.min(2, 100 - ids.length)); if (sample.length) addMany(sample); else setMessage("No additional eligible demo batteries."); }} disabled={locked || ids.length >= 100}>Add demo records</Button>}
        </div>}
        {ids.length > 100 && <p role="alert" className="form-error">A checkout or return can include up to 100 batteries. Remove batteries from this review list before confirming. No changes have been saved.</p>}
        {message && <p role="status" className="form-message">{message}</p>}
        {attempt && <div className="detail-card" role="alert"><h3>{busy ? "Submitting captured request…" : attempt.status === "uncertain" ? "Movement result uncertain" : "Movement rejected"}</h3><p>{attempt.message}</p><p className="field-hint">Captured request: {attempt.payload.requestId}. Your reviewed batteries and loan IDs remain locked until this request is resolved. Recovery is available in this browser tab.</p>{attempt.status === "uncertain" ? <Button onClick={() => { const saved = captured.current; if (saved) void runAttempt(saved, true); }} disabled={busy}><RefreshCw size={16}/>Retry same request</Button> : <Button variant="outline" onClick={reviewLatest} disabled={busy}><RefreshCw size={16}/>Review current records</Button>}</div>}
        {latestReview && <div className="detail-card"><h3>Review changes before updating this draft</h3>{latestReview.changes.map(({ before, after }) => <div key={before.id} className="history-entry"><strong>{before.id}</strong><p>Previously reviewed: {before.loanId ? `${before.borrowerName} · ${formatTime(before.checkedOutAt)}` : "In store"}</p><p>Latest: {!after ? "Battery unavailable; it will be removed from the new draft." : after.loanId ? `${after.borrowerName} · ${formatTime(after.checkedOutAt)}${after.loanId !== before.loanId ? " · Different loan" : " · Same loan"}${checkout ? " · Will be removed from the checkout list" : ""}` : checkout ? "In store; available for a new checkout review." : "No active loan; this battery will be removed from the return list."}</p></div>)}<div className="flex flex-wrap gap-2"><Button variant="outline" onClick={acceptLatest} disabled={busy}>Accept reviewed changes</Button><Button variant="outline" onClick={discardRejected} disabled={busy}>Discard rejected request</Button></div><p className="field-hint">Accepting changes prepares a new draft for your confirmation. Discarding performs no movement.</p></div>}
        <DialogFooter><Button variant="outline" onClick={close} disabled={locked}>Cancel</Button><Button onClick={confirm} disabled={locked || !queued.length || ids.length > 100}>{busy ? "Saving…" : `${checkout ? "Confirm checkout" : "Confirm return"} (${queued.length})`}</Button></DialogFooter>
    </DialogContent></Dialog>;
}
