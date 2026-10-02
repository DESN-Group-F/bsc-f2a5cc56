"use client";
import { useEffect, useRef, useState } from "react";
import { Battery, Download, Clock3, Radio, UserRound, Plus, Pencil, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import type { InventorySnapshot, BatteryRecord, BatteryDetail } from "@/lib/domain";
import { actionNames, formatTime, formatDateOnly, formatBatteryAge, sydneyInput, fromSydneyInput, numberOrNull, buildingLabel, storageRoomLabel, durationLabel, reloadSessionPage } from "@/lib/client-utils";
import { currentSydneyDate } from "@/lib/battery-age";
import { buildingPickerOptions, isSupportedBuilding, roomPickerOptions } from "@/lib/location-catalog";
import { RecordPicker } from "./record-picker";
import type { WriteAction } from "./movement-dialog";
type DetailDraft = { kind: "charge" } | { kind: "observation" } | {
    kind: "correction";
    loanId: string;
    action: "checkout_voided" | "return_reopened";
    expectedReturnedAt: string | null;
};
export function BatteryDetails({ battery: initialBattery, data, revision, onClose, onEdit, onExport, write }: {
    battery: BatteryRecord;
    data: InventorySnapshot;
    revision: number;
    onClose: () => void;
    onEdit: (battery: BatteryRecord) => void;
    onExport: () => void;
    write: WriteAction;
}) {
    const [detail, setDetail] = useState<BatteryDetail | null>(null), [error, setError] = useState(""), [retry, setRetry] = useState(0), [form, setForm] = useState<DetailDraft | null>(null);
    const battery = detail?.battery ?? initialBattery;
    useEffect(() => { const abort = new AbortController(); fetch(`/api/inventory?dataset=${data.dataset}&batteryId=${encodeURIComponent(initialBattery.id)}`, { signal: abort.signal, cache: "no-store" }).then(async (r) => { if (r.status === 401) reloadSessionPage("/signin"); const body = await r.json() as BatteryDetail & {
        error?: string;
    }; if (!r.ok)
        throw new Error(body.error); if (abort.signal.aborted) return; if (body.battery?.id !== initialBattery.id) throw new Error("The battery details response was incomplete. Refresh before using this record."); setError(""); setDetail(body); }).catch(e => { if (e.name !== "AbortError" && !abort.signal.aborted)
        setError(e.message); }); return () => abort.abort(); }, [initialBattery.id, data.dataset, revision, retry]);
    const ageAsOfOn = currentSydneyDate();
    return <><Sheet open onOpenChange={o => !o && onClose()}><SheetContent className="battery-detail-sheet"><SheetHeader><SheetTitle><span className="detail-title-icon"><Battery size={20}/></span>{battery.id}</SheetTitle><SheetDescription>{battery.name}</SheetDescription></SheetHeader><div className="detail-body">
    <div className="detail-action-row"><span className={`status-badge ${battery.loanId ? "out" : "in"}`}>{battery.loanId ? "On loan" : "In store"}</span><div className="detail-button-group"><Button variant="outline" size="sm" onClick={() => setRetry(value => value + 1)} disabled={!!form}><RefreshCw size={16}/>Refresh details</Button><Button variant="outline" size="sm" onClick={onExport}><Download size={16}/>Download details</Button>{data.user.role === "admin" && <Button variant="outline" size="sm" onClick={() => onEdit(battery)}><Pencil />Edit asset</Button>}</div></div>
    <dl className="spec-grid">{[["Chemistry", battery.chemistry || "Not recorded"], ["Model", battery.model || "Not recorded"], ["Rated capacity", battery.capacityMah == null ? "Not recorded" : `${battery.capacityMah.toLocaleString()} mAh`], ["Nominal voltage", battery.voltage == null ? "Not recorded" : `${battery.voltage} V`], ["RFID identifier", battery.tagId || "Not assigned"], ["Storage building", battery.homeBuildingId ? buildingLabel({ id: battery.homeBuildingId, name: battery.homeBuildingName! }) : "Building not assigned"], ["Storage room", storageRoomLabel(battery)]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    <div className="detail-card"><h3><Clock3 size={17}/>Battery age</h3><dl className="spec-grid">{[["Manufactured on", formatDateOnly(battery.manufacturedOn)], ["First used on", formatDateOnly(battery.firstUsedOn)], ["Age since manufacture", formatBatteryAge(battery.manufacturedOn, ageAsOfOn)], ["Time in service", formatBatteryAge(battery.firstUsedOn, ageAsOfOn)]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl><p>Calculated as of {formatDateOnly(ageAsOfOn)} (Sydney).</p></div>
    <div className="detail-card"><h3><UserRound size={17}/>Responsibility</h3><div className="key-value"><span>Responsible owner</span><strong>{battery.ownerName}</strong></div><div className="key-value"><span>Current holder</span><strong>{battery.borrowerName || "No active holder"}</strong></div>{battery.checkedOutAt && <div className="key-value"><span>Checked out</span><strong>{formatTime(battery.checkedOutAt)}</strong></div>}</div>
    <div className="detail-card"><h3><Radio size={17}/>Last observed room</h3><strong>{battery.observedRoom || "No observation recorded"}</strong>{battery.observedBuilding && <p>{battery.observedBuilding}</p>}<p>{battery.observedAt ? `${formatTime(battery.observedAt)} · ${battery.observationSource}` : "RFID room detection has not been connected."}</p>{battery.observationRoomSnapshot === "unavailable" && <p>Original room label unavailable; the recorded room ID is retained.</p>}{data.dataset === "demo" && data.user.role === "admin" && <Button variant="outline" size="sm" onClick={() => setForm({ kind: "observation" })}><Plus />Add demo observation</Button>}</div>
    <div className="detail-card"><h3><Clock3 size={17}/>Last recorded charge</h3><strong>{battery.chargedAt ? `Completed ${formatTime(battery.chargedAt)}` : "No charge record"}</strong><p>{battery.chargedAt ? durationLabel(battery.chargeDurationMinutes) : "Record the charging duration and completion time."}</p>{data.user.role === "admin" && <Button variant="outline" size="sm" onClick={() => setForm({ kind: "charge" })}><Plus />Record charge</Button>}</div>
    {error ? <div className="form-error" role="alert">{error}<Button variant="outline" size="sm" onClick={() => setRetry(r => r + 1)}>Retry history</Button></div> : !detail ? <div className="space-y-3"><Skeleton className="h-10 w-full"/><Skeleton className="h-24 w-full"/></div> : <Tabs defaultValue="loans"><TabsList variant="line"><TabsTrigger value="loans">Loans</TabsTrigger><TabsTrigger value="charges">Charges</TabsTrigger><TabsTrigger value="observations">Locations</TabsTrigger><TabsTrigger value="audit">Audit history</TabsTrigger></TabsList>
      <TabsContent value="loans"><div className="history-list">{detail.loans.length ? detail.loans.map((l, i) => <article className="history-entry" key={l.id}><div className="history-heading"><strong>{l.borrowerName}</strong><span className={`status-badge ${!l.returnedAt && !l.cancelledAt ? "out" : "in"}`}>{l.cancelledAt ? "Corrected" : l.returnedAt ? "Returned" : "On loan"}</span></div><p>Checkout</p><p>Out: {formatTime(l.checkedOutAt)} · {l.checkoutActorName}</p>{l.returnedAt && <p>Return: {formatTime(l.returnedAt)} · {l.returnActorName}</p>}{l.cancelledAt && <p>Checkout corrected: {formatTime(l.cancelledAt)}</p>}{l.correctionReason && <p className="correction-reason">Reason: {l.correctionReason}</p>}{data.user.role === "admin" && i === 0 && !l.cancelledAt && <Button variant="ghost" size="sm" onClick={() => setForm({ kind: "correction", loanId: l.id, action: l.returnedAt ? "return_reopened" : "checkout_voided", expectedReturnedAt: l.returnedAt })}><RefreshCw />Correct this transaction</Button>}</article>) : <p className="history-empty">No loan history.</p>}</div></TabsContent>
      <TabsContent value="charges"><div className="history-list">{detail.charges.length ? detail.charges.map(c => <article className="history-entry" key={c.id}><strong>Completed {formatTime(c.completedAt)}</strong><p>{durationLabel(c.durationMinutes)}</p><p>Recorded by {c.actorName} · {formatTime(c.recordedAt)}</p></article>) : <p className="history-empty">No charging history.</p>}</div></TabsContent>
      <TabsContent value="observations"><div className="history-list">{detail.observations.length ? detail.observations.map(o => <article className="history-entry" key={o.id}><strong>{o.roomName}</strong>{o.roomBuilding && <p>{o.roomBuilding}</p>}<p>Observed {formatTime(o.observedAt)} · {o.source}</p><p>Recorded {formatTime(o.receivedAt)}</p>{o.roomSnapshot === "unavailable" && <p>Original room label unavailable; the recorded room ID is retained.</p>}</article>) : <p className="history-empty">No location observations.</p>}</div></TabsContent>
      <TabsContent value="audit"><div className="history-list">{detail.events.map(e => <article className="history-entry" key={e.id}><strong>{actionNames[e.action] ?? e.action}</strong><p>{formatTime(e.at)} · {e.actorName}</p>{typeof e.details.reason === "string" && <p className="correction-reason">Reason: {e.details.reason}</p>}{typeof e.details.source === "string" && <p>Source: {e.details.source}</p>}</article>)}</div></TabsContent>
    </Tabs>}
    <p className="time-note">History lists show up to 200 recent records per section. Downloads include the complete selected histories.</p><p className="time-note">All displayed times use Australia/Sydney.</p>
  </div></SheetContent></Sheet>{form && <DetailForm key={`${form.kind}-${form.kind === "correction" ? form.loanId : ""}`} form={form} battery={battery} data={data} onClose={() => setForm(null)} write={write}/>}</>;
}
function DetailForm({ form, battery, data, onClose, write }: {
    form: DetailDraft;
    battery: BatteryRecord;
    data: InventorySnapshot;
    onClose: () => void;
    write: WriteAction;
}) {
    const [time, setTime] = useState(sydneyInput()), [duration, setDuration] = useState(""), [buildingId, setBuilding] = useState(battery.homeBuildingId || "J18"), [roomId, setRoom] = useState(""), [reason, setReason] = useState(""), [error, setError] = useState(""), [busy, setBusy] = useState(false);
    const attempt = useRef({ signature: "", id: "" });
    async function submit(e: React.FormEvent) {
        e.preventDefault();
        setError("");
        setBusy(true);
        try {
            const payload = form.kind === "charge" ? { batteryId: battery.id, completedAt: fromSydneyInput(time), durationMinutes: numberOrNull(duration, "Charging duration") } : form.kind === "observation" ? { batteryId: battery.id, roomId, observedAt: fromSydneyInput(time) } : { loanId: form.loanId, action: form.action, expectedReturnedAt: form.expectedReturnedAt, reason };
            const signature = JSON.stringify(payload);
            if (attempt.current.signature !== signature)
                attempt.current = { signature, id: crypto.randomUUID() };
            await write(form.kind, { ...payload, requestId: attempt.current.id });
            onClose();
        }
        catch (e) {
            setError(`${(e as Error).message}${form.kind === "correction" && (e as { status?: number }).status === 409 ? " Your reason and intended action are preserved. Close this dialog, choose Refresh details and review a new correction before saving." : ""}`);
        }
        finally {
            setBusy(false);
        }
    }
    const title = form.kind === "charge" ? "Record completed charge" : form.kind === "observation" ? "Add demo room observation" : "Correct latest transaction";
    return <Dialog open onOpenChange={o => !o && !busy && onClose()}><DialogContent><DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{form.kind === "charge" ? "Record how long charging took and when it finished. This is a manual historical record." : form.kind === "observation" ? "Demonstration data only. This does not read an RFID device and will not change loan status." : form.kind === "correction" && form.action === "return_reopened" ? "Undo the recorded return and reopen its loan. The original return remains traceable in the audit history." : "Mark the mistaken checkout as corrected. The original record remains in the history."}</DialogDescription></DialogHeader><form onSubmit={submit}><div className="form-stack">
    {form.kind !== "correction" && <div className="form-field"><Label htmlFor="record-time">{form.kind === "charge" ? "Charge completed" : "Observed at"} (Sydney time)</Label><Input id="record-time" type="datetime-local" value={time} onChange={e => setTime(e.target.value)} required disabled={busy}/></div>}
    {form.kind === "charge" && <div className="form-field"><Label htmlFor="charge-duration">Charging duration (minutes) <span className="required">*</span></Label><Input id="charge-duration" type="number" min="0" max="525600" step="any" value={duration} onChange={e => setDuration(e.target.value)} placeholder="e.g. 90" required disabled={busy}/></div>}
    {form.kind === "observation" && <><div className="form-field"><Label htmlFor="observation-building">Building</Label><RecordPicker id="observation-building" options={buildingPickerOptions(data.buildings)} value={buildingId} onChange={v => { setBuilding(v); setRoom(""); }} placeholder="Select building…" disabled={busy}/></div><div className="form-field"><Label htmlFor="observation-room">Observed room</Label><RecordPicker id="observation-room" options={roomPickerOptions(data.rooms, buildingId)} value={isSupportedBuilding(buildingId) ? roomId : "__unavailable"} onChange={setRoom} placeholder={isSupportedBuilding(buildingId) ? "Select demonstration room…" : "Not available"} disabled={busy || !isSupportedBuilding(buildingId)}/><p className="field-hint">Placeholder locations are unverified. This simulated record provides no physical location evidence.</p></div></>}
    {form.kind === "correction" && <div className="form-field"><Label htmlFor="correction-reason">Reason for correction <span className="required">*</span></Label><Textarea id="correction-reason" value={reason} onChange={e => setReason(e.target.value)} minLength={5} maxLength={500} required placeholder="Explain what was recorded incorrectly…" disabled={busy}/></div>}
    </div>{error && <p className="form-error" role="alert">{error}</p>}<DialogFooter className="form-footer"><Button type="button" variant="outline" onClick={onClose} disabled={busy}>Cancel</Button><Button type="submit" disabled={busy || (form.kind === "observation" && !roomId)}>{busy ? "Saving…" : "Save record"}</Button></DialogFooter></form></DialogContent></Dialog>;
}
