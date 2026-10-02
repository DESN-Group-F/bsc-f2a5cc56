"use client";
import { useRef, useState } from "react";
import { ScanLine, Trash2, Radio, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Table, TableHeader, TableHead, TableRow, TableBody, TableCell } from "@/components/ui/table";
import { RecordPicker } from "./record-picker";
import type { InventorySnapshot } from "@/lib/domain";
export type MovementDraft = {
    kind: "checkout" | "return";
    ids: string[];
    borrowerId?: string;
    nonce: string;
};
export type WriteAction = (action: string, payload: unknown, extra?: Record<string, unknown>) => Promise<unknown>;
export function MovementDialog({ draft, data, onClose, write }: {
    draft: MovementDraft;
    data: InventorySnapshot;
    onClose: () => void;
    write: WriteAction;
}) {
    const [ids, setIds] = useState(draft.ids), [borrowerId, setBorrower] = useState(draft.borrowerId ?? ""), [tag, setTag] = useState(""), [picked, setPicked] = useState(""), [message, setMessage] = useState(""), [busy, setBusy] = useState(false);
    const attempt = useRef({ signature: "", id: "" });
    const checkout = draft.kind === "checkout";
    const queued = ids.map(id => data.batteries.find(b => b.id === id)!).filter(Boolean);
    const eligible = data.batteries.filter(b => checkout ? !b.loanId : !!b.loanId);
    function add(id: string) {
        const b = data.batteries.find(b => b.id === id);
        if (!b) {
            setMessage("This tag is not registered in the inventory. No changes were made.");
            return;
        }
        if (checkout && b.loanId) {
            setMessage(`${b.id} is already on loan to ${b.borrowerName}.`);
            return;
        }
        if (!checkout && !b.loanId) {
            setMessage(`${b.id} has no active loan to return.`);
            return;
        }
        if (ids.includes(id)) {
            setMessage(`${id} is already in this list. Duplicate reading ignored.`);
            return;
        }
        setIds([...ids, id]);
        setTag("");
        setPicked("");
        setMessage("");
    }
    function addTag() { const b = data.batteries.find(b => b.tagId === tag.trim()); if (b)
        add(b.id);
    else
        setMessage("This tag identifier is not registered. Check the identifier or register the battery first."); }
    async function confirm() {
        const payload = { kind: draft.kind, batteryIds: ids, ...(checkout ? { borrowerId } : {}) };
        const signature = JSON.stringify(payload);
        if (attempt.current.signature !== signature)
            attempt.current = { signature, id: crypto.randomUUID() };
        setBusy(true);
        setMessage("");
        try {
            await write("movement", { ...payload, requestId: attempt.current.id });
            onClose();
        }
        catch (e) {
            setMessage((e as Error).message);
        }
        finally {
            setBusy(false);
        }
    }
    return <Dialog open onOpenChange={o => !o && !busy && onClose()}><DialogContent className="movement-dialog"><DialogHeader><DialogTitle>{checkout ? "Check out batteries" : "Return batteries"}</DialogTitle><DialogDescription>{checkout ? "Choose the borrower once, add the batteries, then confirm the complete list." : "Review the batteries and their current borrowers, then confirm the return."}</DialogDescription></DialogHeader>
    <div className="connection-message"><Radio size={18}/><span><strong>RFID reader not connected.</strong> Manual selection and tag entry are available to review the software workflow.</span></div>
    {checkout && <div className="form-field"><Label htmlFor="movement-borrower">Borrower <span className="required">*</span></Label><RecordPicker id="movement-borrower" options={data.people.map(p => ({ id: p.id, label: `${p.name} · ${p.reference || p.id}` }))} value={borrowerId} onChange={setBorrower} placeholder="Search registered people…" disabled={busy}/></div>}
    <div className="reader-entry"><div className="form-field"><Label htmlFor="tag-input">Tag identifier</Label><div className="inline-input"><Input id="tag-input" value={tag} onChange={e => setTag(e.target.value)} onKeyDown={e => { if (e.key === "Enter") {
        e.preventDefault();
        addTag();
    } }} placeholder={data.dataset === "demo" ? "e.g. DEMO-TAG-001" : "Enter a registered tag identifier"} disabled={busy}/><Button variant="outline" onClick={addTag} disabled={!tag.trim() || busy}><Plus />Add</Button></div></div><div className="form-field"><Label htmlFor="movement-battery">Or select a registered battery</Label><RecordPicker id="movement-battery" options={eligible.filter(b => !ids.includes(b.id)).map(b => ({ id: b.id, label: `${b.id} · ${b.name}` }))} value={picked} onChange={id => { setPicked(id); if (id)
        add(id); }} placeholder="Search batteries…" disabled={busy}/></div></div>
    {data.dataset === "demo" && <Button variant="outline" className="demo-reading-button" onClick={() => { const sample = eligible.filter(b => !ids.includes(b.id)).slice(0, 2); setIds([...ids, ...sample.map(b => b.id)]); setMessage(sample.length ? "Fictional demo records added. No RFID device was read." : "No additional eligible demo batteries."); }} disabled={busy}><FlaskIcon />Add demo records</Button>}
    <div className="review-title"><strong>Review list</strong><span>{queued.length} {queued.length === 1 ? "battery" : "batteries"}</span></div>
    <div className="review-list"><Table><TableHeader><TableRow><TableHead>BATTERY</TableHead><TableHead>{checkout ? "RESPONSIBLE OWNER" : "CURRENT BORROWER"}</TableHead><TableHead><span className="sr-only">Remove</span></TableHead></TableRow></TableHeader><TableBody>{queued.map(b => <TableRow key={b.id}><TableCell><strong>{b.id}</strong><span className="cell-secondary">{b.name}</span></TableCell><TableCell>{checkout ? b.ownerName : b.borrowerName}</TableCell><TableCell><Button variant="ghost" size="icon" aria-label={`Remove ${b.id}`} disabled={busy} onClick={() => setIds(ids.filter(id => id !== b.id))}><Trash2 size={16}/></Button></TableCell></TableRow>)}</TableBody></Table>{!queued.length && <div className="queue-empty"><ScanLine size={26}/><p>Add batteries to prepare this {checkout ? "checkout" : "return"}.</p></div>}</div>
    {message && <p role="status" className="form-message">{message}</p>}
    <DialogFooter><Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button><Button onClick={confirm} disabled={busy || !queued.length || (checkout && !borrowerId)}>{busy ? "Saving…" : `${checkout ? "Confirm checkout" : "Confirm return"} (${queued.length})`}</Button></DialogFooter>
  </DialogContent></Dialog>;
}
function FlaskIcon() { return <span aria-hidden="true">◇</span>; }
