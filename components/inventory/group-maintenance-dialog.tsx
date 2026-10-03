"use client";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { RecordPicker } from "./record-picker";
import type { InventorySnapshot } from "@/lib/domain";
import type { TeachingGroup } from "@/lib/teaching-groups";
import { groupMaintenanceKey, captureGroupMaintenance, recoverGroupMaintenance, verifyGroupMaintenance, type GroupMaintenanceAttempt, type GroupMaintenancePayload } from "@/lib/group-maintenance";
import { fromSydneyInput, staffIdentityLabel } from "@/lib/client-utils";
import { roomPickerOptions } from "@/lib/location-catalog";
import type { WriteAction } from "./movement-dialog";

export function GroupMaintenanceDialog({ data, group, ids, write, onClose, onChanged }: { data: InventorySnapshot; group?: TeachingGroup; ids: string[]; write: WriteAction; onClose: () => void; onChanged: () => Promise<void> }) {
    const [context] = useState(() => ({ accountId: data.user.id, dataset: data.dataset }));
    const key = groupMaintenanceKey(context.accountId, context.dataset);
    const [recovery] = useState(() => { try { const raw = sessionStorage.getItem(key), attempt = recoverGroupMaintenance(raw, context.accountId, context.dataset); return { attempt, invalid: !!raw && !attempt }; } catch { return { attempt: null, invalid: true }; } });
    const [attempt, setAttempt] = useState(recovery.attempt), pending = useRef(attempt), running = useRef(false), live = useRef(true);
    const [kind, setKind] = useState<GroupMaintenancePayload["kind"]>("owner"), [ownerId, setOwnerId] = useState(""), [roomId, setRoomId] = useState("__unspecified"), [time, setTime] = useState(""), [duration, setDuration] = useState("");
    const [busy, setBusy] = useState(false), [error, setError] = useState(""), [storageError, setStorageError] = useState("");
    const [saved, setSaved] = useState(false);
    const [reviewed] = useState(() => ids.map(id => data.batteries.find(b => b.id === id)).filter(b => !!b).map(b => ({ batteryId: b.id, version: b.version, tagId: b.tagId })));
    const contextChanged = context.accountId !== data.user.id || context.dataset !== data.dataset;
    useEffect(() => { live.current = !contextChanged; return () => { live.current = false; }; }, [contextChanged]);
    const locked = busy || !!attempt || !!storageError || recovery.invalid || contextChanged;
    function preserve(next: GroupMaintenanceAttempt | null) {
        try { if (next) sessionStorage.setItem(key, JSON.stringify(next)); else sessionStorage.removeItem(key); pending.current = next; setAttempt(next); setStorageError(""); window.dispatchEvent(new Event("battery-group-maintenance-recovery")); return true; }
        catch { pending.current = next || pending.current; setAttempt(pending.current); setStorageError("Restore browser storage and retry this exact operation before leaving."); return false; }
    }
    async function save(retry = false) {
        if (saved || running.current || busy || recovery.invalid || contextChanged || !retry && locked || retry && !pending.current) return;
        running.current = true; setBusy(true); setError("");
        let captured = pending.current;
        try {
            if (!captured) {
                if (!group || reviewed.length !== ids.length) throw new Error("Reopen the group and review all selected members.");
                const base = { requestId: crypto.randomUUID(), teachingGroup: { id: group.id, version: group.version }, items: reviewed };
                const fields = kind === "owner" ? { ownerId } : kind === "storage" ? { homeBuildingId: "J18", homeRoomId: roomId === "__unspecified" ? null : roomId } : kind === "charge" ? { completedAt: fromSydneyInput(time), durationMinutes: Number(duration) } : { roomId, observedAt: fromSydneyInput(time) };
                captured = captureGroupMaintenance(context.accountId, context.dataset, { ...base, kind, ...fields });
            }
            if (!preserve(captured)) return;
            const receipt = await write("group_maintenance", captured.payload);
            verifyGroupMaintenance(receipt, captured);
            if (!live.current) return;
            if (!preserve(null)) return;
            setSaved(true);
            try { await onChanged(); } catch { setError("The group operation was saved. The display could not refresh; close this dialog and refresh before another update."); return; }
            onClose();
        } catch (error) {
            if (!live.current) return;
            const rejected = (error as { code?: string }).code === "group_operation_rejected_final";
            if (rejected && captured) preserve(null);
            setError((error as { issues?: { message: string }[] }).issues?.[0]?.message || (error as Error).message);
        } finally { running.current = false; if (live.current) setBusy(false); }
    }
    return <Dialog open onOpenChange={open => { if (!open && !locked) onClose(); }}><DialogContent showCloseButton={!locked}><DialogHeader><DialogTitle>Update teaching group batteries</DialogTitle><DialogDescription>Review one common change for the selected members. All changes are saved together with their recorded group context.</DialogDescription></DialogHeader>
        <p className="group-context-banner"><strong>{group?.name ?? "Preserved group operation"}</strong> · {attempt?.payload.items.length ?? reviewed.length} batteries</p>
        {recovery.invalid && <p className="form-error">This tab could not recover its earlier group operation. Restore storage access and reopen with the same account and inventory.</p>}
        {contextChanged && <p className="form-error">Restore the original staff account and inventory to resolve this request.</p>}
        {!attempt && !saved && <div className="form-stack"><Label>Operation</Label><Select value={kind} onValueChange={value => { if (!locked) { setKind(value as typeof kind); setRoomId("__unspecified"); } }} disabled={locked}><SelectTrigger aria-label="Group update operation"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="owner">Change responsible owner</SelectItem><SelectItem value="storage">Change registered storage</SelectItem><SelectItem value="charge">Record charging</SelectItem>{data.dataset === "demo" && <SelectItem value="observation">Record demo location</SelectItem>}</SelectContent></Select>
        {kind === "owner" && <RecordPicker id="group-update-owner" value={ownerId} onChange={setOwnerId} disabled={locked} placeholder="Choose responsible owner…" options={data.people.filter(p => p.role === "staff" && p.accountId && data.staffDirectory.some(a => a.id === p.accountId && a.active)).map(p => ({ id: p.id, label: staffIdentityLabel(p.name, data.staffDirectory.find(a => a.id === p.accountId)?.username, p.accountId!) }))}/>}
        {(kind === "storage" || kind === "observation") && <><Label>J18 room{kind === "storage" ? " — optional" : ""}</Label><RecordPicker id="group-update-room" value={roomId} onChange={setRoomId} disabled={locked} placeholder="Choose J18 room…" options={[...(kind === "storage" ? [{ id: "__unspecified", label: "Room not specified" }] : []), ...roomPickerOptions(data.rooms, "J18")]}/><p className="field-hint">Registered storage and dated location evidence remain separate. Demo rooms are unverified placeholders.</p></>}
        {(kind === "charge" || kind === "observation") && <><Label htmlFor="group-update-time">{kind === "charge" ? "Charging completed" : "Demo observation time"} · Sydney time</Label><Input id="group-update-time" type="datetime-local" value={time} onChange={event => setTime(event.target.value)} disabled={locked}/></>}
        {kind === "charge" && <><Label htmlFor="group-update-duration">Duration for each selected battery (minutes)</Label><Input id="group-update-duration" type="number" min="1" max="525600" value={duration} onChange={event => setDuration(event.target.value)} disabled={locked}/></>}
        <details><summary>Review selected battery IDs</summary><p>{reviewed.map(item => item.batteryId).join(", ")}</p></details></div>}
        {attempt && <div className="detail-card"><p>The outcome of this exact request is unconfirmed. Reopening this dialog restores it without sending automatically.</p><p>{attempt.payload.kind} · {attempt.payload.items.map(item => item.batteryId).join(", ")}</p><Button onClick={() => save(true)} disabled={busy || recovery.invalid || contextChanged}>Retry exact group operation</Button></div>}
        {(error || storageError) && <p className="form-error" role="alert">{storageError || error}</p>}
        <DialogFooter><Button variant="outline" disabled={locked} onClick={onClose}>{saved ? "Close" : "Cancel"}</Button>{!saved && <Button onClick={() => save()} disabled={locked || !group || !reviewed.length}>{busy ? "Saving…" : `Confirm update (${reviewed.length})`}</Button>}</DialogFooter>
    </DialogContent></Dialog>;
}
