"use client";
import { useRef, useState } from "react";
import { ScanLine, Trash2, Radio, Plus, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Table, TableHeader, TableHead, TableRow, TableBody, TableCell } from "@/components/ui/table";
import { RecordPicker } from "./record-picker";
import type { BatteryRecord, InventorySnapshot } from "@/lib/domain";
import { formatTime, reloadSessionPage } from "@/lib/client-utils";

export type MovementDraft = { kind: "checkout" | "return"; ids: string[]; nonce: string };
export type WriteAction = (action: string, payload: unknown, extra?: Record<string, unknown>) => Promise<unknown>;
type LatestReview = { inventory: InventorySnapshot; changes: { before: BatteryRecord; after: BatteryRecord | undefined }[] };

export function MovementDialog({ draft, data, onClose, write }: {
    draft: MovementDraft; data: InventorySnapshot; onClose: () => void; write: WriteAction;
}) {
    const [inventory, setInventory] = useState(data), [ids, setIds] = useState(draft.ids);
    const [reviewed, setReviewed] = useState<Record<string, BatteryRecord>>(() => Object.fromEntries(draft.ids.flatMap(id => {
        const battery = data.batteries.find(b => b.id === id);
        return battery ? [[id, battery]] : [];
    })));
    const [adding, setAdding] = useState(!draft.ids.length), [allLoans, setAllLoans] = useState(false);
    const [tag, setTag] = useState(""), [picked, setPicked] = useState(""), [message, setMessage] = useState(""), [busy, setBusy] = useState(false);
    const [conflict, setConflict] = useState(false), [latestReview, setLatestReview] = useState<LatestReview | null>(null);
    const attempt = useRef({ signature: "", id: "" });
    const checkout = draft.kind === "checkout";
    const queued = ids.map(id => reviewed[id]).filter(Boolean);
    const allEligible = inventory.batteries.filter(b => checkout ? !b.loanId : !!b.loanId);
    const eligible = allEligible.filter(b => checkout || allLoans || b.borrowerAccountId === data.user.id);
    const candidates = eligible.filter(b => !ids.includes(b.id));

    function addMany(batteries: BatteryRecord[]) {
        if (ids.length + batteries.length > 100) {
            setMessage("A movement can include up to 100 batteries. Confirm this list before starting another batch.");
            return;
        }
        setIds([...ids, ...batteries.map(b => b.id)]);
        setReviewed({ ...reviewed, ...Object.fromEntries(batteries.map(b => [b.id, b])) });
        setTag(""); setPicked(""); setMessage(""); setLatestReview(null);
    }
    function add(id: string) {
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
    function remove(id: string) { setIds(ids.filter(value => value !== id)); setLatestReview(null); }
    async function confirm() {
        const payload = { kind: draft.kind, batteryIds: ids, ...(!checkout ? { expectedLoans: queued.map(b => ({ batteryId: b.id, loanId: b.loanId })) } : {}) };
        const signature = JSON.stringify(payload);
        if (attempt.current.signature !== signature) attempt.current = { signature, id: crypto.randomUUID() };
        setBusy(true); setMessage("");
        try { await write("movement", { ...payload, requestId: attempt.current.id }); onClose(); }
        catch (error) { setMessage((error as Error).message); if ((error as { status?: number }).status === 409) setConflict(true); }
        finally { setBusy(false); }
    }
    async function reviewLatest() {
        setBusy(true); setMessage("");
        try {
            const response = await fetch(`/api/inventory?dataset=${data.dataset}`, { cache: "no-store" });
            if (response.status === 401) reloadSessionPage("/signin");
            const latest = await response.json() as InventorySnapshot & { error?: string };
            if (!response.ok) throw new Error(latest.error || "The latest loans could not be loaded.");
            setLatestReview({ inventory: latest, changes: queued.map(before => ({ before, after: latest.batteries.find(b => b.id === before.id) })) });
        } catch (error) { setMessage((error as Error).message); }
        finally { setBusy(false); }
    }
    function acceptLatest() {
        if (!latestReview) return;
        const next = latestReview.changes.flatMap(({ after }) => after && after.loanId ? [after] : []);
        setIds(next.map(b => b.id)); setReviewed(Object.fromEntries(next.map(b => [b.id, b])));
        setInventory(latestReview.inventory); setLatestReview(null); setConflict(false);
        attempt.current = { signature: "", id: "" };
        setMessage("The reviewed latest loans are now in your draft. Batteries without an active loan were removed. Confirm only after reviewing the updated list.");
        if (!next.length) setAdding(true);
    }
    return <Dialog open onOpenChange={open => !open && !busy && onClose()}><DialogContent className="movement-dialog"><DialogHeader><DialogTitle>{checkout ? "Check out batteries" : "Return batteries"}</DialogTitle><DialogDescription>{checkout ? "Review your selected batteries and confirm with your own staff account." : "Review each selected loan before confirming. You may receive batteries checked out by another staff member."}</DialogDescription></DialogHeader>
        {checkout && <div className="detail-card"><div className="key-value"><span>Checked out to</span><strong>{data.user.displayName} · {data.user.username}</strong></div><p>Your signed-in staff account is responsible for this checkout. The asset owner stays the same.</p></div>}
        <div className="review-title"><strong>Review list</strong><span>{queued.length} {queued.length === 1 ? "battery" : "batteries"}</span></div>
        <div className="review-list"><Table><TableHeader><TableRow><TableHead>BATTERY</TableHead><TableHead>{checkout ? "RESPONSIBLE OWNER" : "CURRENT HOLDER"}</TableHead><TableHead><span className="sr-only">Remove</span></TableHead></TableRow></TableHeader><TableBody>{queued.map(b => <TableRow key={b.id}><TableCell><strong>{b.id}</strong><span className="cell-secondary">{b.name}</span></TableCell><TableCell>{checkout ? b.ownerName : <>{b.borrowerName}<span className="cell-secondary">Checked out {formatTime(b.checkedOutAt)}</span></>}</TableCell><TableCell><Button variant="ghost" size="icon" aria-label={`Remove ${b.id}`} disabled={busy} onClick={() => remove(b.id)}><Trash2 size={16}/></Button></TableCell></TableRow>)}</TableBody></Table>{!queued.length && <div className="queue-empty"><ScanLine size={26}/><p>Add registered batteries below to prepare this {checkout ? "checkout" : "return"}.</p></div>}</div>
        <Button variant="outline" className="justify-start" aria-expanded={adding} aria-controls="movement-add-more" onClick={() => setAdding(!adding)} disabled={busy}>{adding ? "− Hide additional batteries" : "+ Add more batteries"}</Button>
        {adding && <div id="movement-add-more" className="form-stack">
            <p className="time-note">Add already registered batteries to this review list. These optional inputs do not create new battery records.</p>
            {!checkout && <><div className="flex flex-wrap gap-2" role="group" aria-label="Available return loans"><Button variant={allLoans ? "outline" : "default"} onClick={() => { setAllLoans(false); setPicked(""); }} disabled={busy}>My outstanding loans</Button><Button variant={allLoans ? "default" : "outline"} onClick={() => { setAllLoans(true); setPicked(""); }} disabled={busy}>All on-loan batteries</Button></div><p className="time-note">{allLoans ? "Any staff member may receive these loans. The original holder and your return action remain recorded." : "Showing active loans linked to your staff account. Explicitly selected batteries stay in the review list."}</p></>}
            <div className="reader-entry"><div className="form-field"><Label htmlFor="movement-battery">Search registered batteries</Label><RecordPicker id="movement-battery" options={candidates.map(b => ({ id: b.id, label: `${b.id} · ${b.name}${!checkout ? ` · ${b.borrowerName}` : ""}` }))} value={picked} onChange={id => { setPicked(id); if (id) add(id); }} placeholder="Search batteries…" disabled={busy}/></div><div className="form-field"><Label htmlFor="tag-input">Existing tag identifier (optional)</Label><div className="inline-input"><Input id="tag-input" value={tag} onChange={event => setTag(event.target.value)} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); addTag(); } }} placeholder={data.dataset === "demo" ? "e.g. DEMO-TAG-001" : "Enter a registered tag identifier"} disabled={busy}/><Button variant="outline" onClick={addTag} disabled={!tag.trim() || busy}><Plus />Add</Button></div></div></div>
            {!checkout && <><div className="review-title"><strong>{allLoans ? "Available on-loan batteries" : "Your outstanding batteries"}</strong><span>{candidates.length}</span></div>{candidates.length ? <div className="review-list"><Table><TableHeader><TableRow><TableHead>BATTERY</TableHead><TableHead>CURRENT HOLDER</TableHead><TableHead><span className="sr-only">Add</span></TableHead></TableRow></TableHeader><TableBody>{candidates.slice(0, 100).map(b => <TableRow key={b.id}><TableCell><strong>{b.id}</strong><span className="cell-secondary">{b.name}</span></TableCell><TableCell>{b.borrowerName}<span className="cell-secondary">Checked out {formatTime(b.checkedOutAt)}</span></TableCell><TableCell><Button variant="outline" size="sm" onClick={() => add(b.id)} disabled={busy || ids.length >= 100} aria-label={`Add ${b.id}`}><Plus size={16}/>Add</Button></TableCell></TableRow>)}</TableBody></Table></div> : <p className="time-note">{allLoans ? "No additional active loans are available." : "You have no additional outstanding loans. Choose All on-loan batteries to receive another holder's loan."}</p>}{candidates.length > 100 && <p className="time-note">The list shows the first 100 available batteries. Search above to find any other registered battery.</p>}</>}
            <div className="connection-message"><Radio size={18}/><span><strong>RFID reader not connected.</strong> Entering a tag identifier manually looks up an existing record; it does not read an RFID device.</span></div>
            {data.dataset === "demo" && <Button variant="outline" className="demo-reading-button" onClick={() => { const sample = candidates.slice(0, Math.min(2, 100 - ids.length)); if (sample.length) addMany(sample); else setMessage("No additional eligible demo batteries."); }} disabled={busy || ids.length >= 100}>Add demo records</Button>}
        </div>}
        {ids.length > 100 && <p role="alert" className="form-error">A checkout or return can include up to 100 batteries. Remove batteries from this review list before confirming. No changes have been saved.</p>}
        {message && <p role="status" className="form-message">{message}</p>}
        {!checkout && conflict && <div className="form-stack"><p className="time-note">Your original review list is preserved. Review the latest loans explicitly before changing this draft.</p><Button variant="outline" onClick={reviewLatest} disabled={busy}><RefreshCw size={16}/>Review latest loans</Button></div>}
        {latestReview && <div className="detail-card"><h3>Review changes before updating this draft</h3>{latestReview.changes.map(({ before, after }) => <div key={before.id} className="history-entry"><strong>{before.id}</strong><p>Previously reviewed: {before.borrowerName} · {formatTime(before.checkedOutAt)}</p><p>Latest: {after?.loanId ? `${after.borrowerName} · ${formatTime(after.checkedOutAt)}${after.loanId !== before.loanId ? " · Different loan" : " · Same loan"}` : "No active loan; this battery will be removed from the return list."}</p></div>)}<Button variant="outline" onClick={acceptLatest} disabled={busy}>Accept reviewed changes</Button></div>}
        <DialogFooter><Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button><Button onClick={confirm} disabled={busy || !queued.length || ids.length > 100 || (!checkout && (conflict || !!latestReview))}>{busy ? "Saving…" : `${checkout ? "Confirm checkout" : "Confirm return"} (${queued.length})`}</Button></DialogFooter>
    </DialogContent></Dialog>;
}
