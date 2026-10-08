"use client";
import { getRolePermissions } from "@/lib/permissions";
import { isActiveBattery, batteryStatusLabel } from "@/lib/battery-lifecycle";
import { useEffect, useRef, useState } from "react";
import { Battery, Download, Clock3, Radio, UserRound, Plus, Pencil, RefreshCw, MapPin, ChevronDown, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { MotionDisclosure } from "@/components/ui/workspace-motion";
import type { InventorySnapshot, BatteryRecord, BatteryDetail } from "@/lib/domain";
import { actionNames, formatTime, sydneyInput, fromSydneyInput, numberOrNull, buildingLabel, storageRoomLabel, durationLabel, reloadSessionPage } from "@/lib/client-utils";
import { buildingPickerOptions, isSupportedBuilding, roomPickerOptions } from "@/lib/location-catalog";
import { RecordPicker } from "./record-picker";
import { BatteryMovementSummary } from "./battery-movement-summary";
import { BatteryAgeAndUsage, BatteryInspectionSummary, BatteryInspections, type InspectionRecoveryStatus } from "./battery-history";
import type { WriteAction } from "@/lib/client/inventory-contracts";
import styles from "./battery-detail.module.css";
type DetailDraft = { kind: "charge" } | { kind: "observation" } | {
    kind: "correction";
    loanId: string;
    action: "checkout_voided" | "return_reopened";
    expectedReturnedAt: string | null;
};
export function BatteryDetails({ battery: initialBattery, data, revision, onClose, onEdit, onExport, onInspectionChanged, write }: {
    battery: BatteryRecord;
    data: InventorySnapshot;
    revision: number;
    onClose: () => void;
    onEdit: (battery: BatteryRecord) => void;
    onExport: () => void;
    onInspectionChanged?: () => void;
    write: WriteAction;
}) {
    const permissions = getRolePermissions(data.user.role);
    const [result, setResult] = useState<{ key: string; detail: BatteryDetail | null; error: string } | null>(null);
    const [retry, setRetry] = useState(0), [form, setForm] = useState<DetailDraft | null>(null);
    const [tab, setTab] = useState("overview"), [specificationsOpen, setSpecificationsOpen] = useState(false);
    const [inspectionRecovery, setInspectionRecovery] = useState<InspectionRecoveryStatus>({ ready: false, pending: false, error: "" });
    const requestKey = `${data.dataset}:${initialBattery.id}:${revision}:${retry}`;
    const detail = result?.key === requestKey ? result.detail : null;
    const error = result?.key === requestKey ? result.error : "";
    const battery = detail?.battery ?? initialBattery;
    useEffect(() => { const abort = new AbortController(); fetch(`/api/inventory?dataset=${data.dataset}&batteryId=${encodeURIComponent(initialBattery.id)}`, { signal: abort.signal, cache: "no-store" }).then(async (r) => { if (r.status === 401) reloadSessionPage("/signin"); const body = await r.json() as BatteryDetail & {
        error?: string;
    }; if (!r.ok)
        throw new Error(body.error || "Battery details could not be loaded."); if (abort.signal.aborted) return; if (body.battery?.id !== initialBattery.id || !body.movementSummary || !body.usageSummary || !body.inspectionSummary || !Array.isArray(body.inspections)) throw new Error("The battery details response was incomplete. Refresh before using this record."); setResult({ key: requestKey, detail: body, error: "" }); }).catch(e => { if (e.name !== "AbortError" && !abort.signal.aborted)
        setResult({ key: requestKey, detail: null, error: e.message }); }); return () => abort.abort(); }, [initialBattery.id, data.dataset, requestKey]);
    return <>
        <Sheet open onOpenChange={open => !open && onClose()}>
            <SheetContent className={`battery-detail-sheet ${styles.sheet}`}>
                <SheetHeader className={styles.header}>
                    <span className={styles.eyebrow}>Battery record · {data.dataset === "demo" ? "Demonstration inventory" : "Working inventory"}</span>
                    <SheetTitle><span className="detail-title-icon"><Battery size={20} aria-hidden="true" /></span>{battery.id}</SheetTitle>
                    <SheetDescription><span className={styles.assetName}>{battery.name}</span><span>{battery.chemistry || "Chemistry not recorded"} · {battery.voltage == null ? "Nominal voltage not recorded" : `${battery.voltage} V nominal`}</span></SheetDescription>
                </SheetHeader>
                <div className={styles.commands}>
                    <span className={`status-badge ${!isActiveBattery(battery) ? "retired" : battery.loanId ? "out" : "in"}`}>{batteryStatusLabel(battery)}</span>
                    <div className={styles.commandButtons}>
                        <Button variant="outline" size="sm" onClick={() => setRetry(value => value + 1)} disabled={!!form}><RefreshCw size={16} />Refresh details</Button>
                        <Button variant="outline" size="sm" onClick={onExport}><Download size={16} />Download details</Button>
                        {permissions.editBatteryRecords && isActiveBattery(battery) && <Button variant="outline" size="sm" onClick={() => onEdit(battery)}><Pencil size={16} />Edit asset</Button>}
                    </div>
                </div>
                {(inspectionRecovery.pending || inspectionRecovery.error) && <div className={styles.recovery} role={inspectionRecovery.error ? "alert" : "status"}>
                    <AlertCircle size={18} aria-hidden="true" />
                    <div><strong>{inspectionRecovery.error ? "Inspection recovery needs attention" : "An inspection change still needs confirmation"}</strong><p>{inspectionRecovery.error || "The original request is preserved. Review and retry it from Inspections."}</p></div>
                    <Button variant="outline" size="sm" onClick={() => setTab("inspections")}>Open inspection recovery</Button>
                </div>}
                <Tabs value={tab} onValueChange={setTab} className={styles.tabs}>
                    <TabsList className={styles.tabList} aria-label="Battery detail sections">
                        <TabsTrigger value="overview">Overview</TabsTrigger>
                        <TabsTrigger value="usage">Usage</TabsTrigger>
                        <TabsTrigger value="inspections">Inspections</TabsTrigger>
                        <TabsTrigger value="history">History</TabsTrigger>
                    </TabsList>
                    <div className={styles.body}>
                        <TabsContent value="overview" className={styles.panel}>
                            <BatteryInspectionSummary detail={detail} error={error} onViewEvidence={() => setTab("inspections")} />
                            <div className={styles.overviewGrid}>
                                <section className={styles.card} aria-label="Responsibility">
                                    <h3><UserRound size={17} aria-hidden="true" />Responsibility</h3>
                                    <dl className={styles.values}><div><dt>Responsible owner</dt><dd>{battery.ownerName}</dd></div><div><dt>Current holder</dt><dd>{battery.borrowerName || "No active holder"}</dd></div>{battery.checkedOutAt && <div><dt>Checked out</dt><dd>{formatTime(battery.checkedOutAt)}</dd></div>}</dl>
                                </section>
                                <section className={styles.card} aria-label="Registered storage home">
                                    <h3><MapPin size={17} aria-hidden="true" />Registered home</h3>
                                    <dl className={styles.values}><div><dt>Building</dt><dd>{battery.homeBuildingId ? buildingLabel({ id: battery.homeBuildingId, name: battery.homeBuildingName! }) : "Building not assigned"}</dd></div><div><dt>Room</dt><dd>{storageRoomLabel(battery)}</dd></div></dl>
                                    <p className={styles.note}>Registered storage is separate from observed location and current borrowing.</p>
                                </section>
                                <section className={styles.card} aria-label="Last recorded location observation">
                                    <h3><Radio size={17} aria-hidden="true" />Last observed location</h3>
                                    <strong>{battery.observedRoom || (battery.observedAt ? "Original room label unavailable" : "No observation recorded")}</strong>
                                    {battery.observedBuilding && <p>{battery.observedBuilding}</p>}
                                    <p>{battery.observedAt ? `${formatTime(battery.observedAt)} · ${battery.observationSource || "Source not recorded"}` : "RFID room detection has not been connected."}</p>
                                    {battery.observationRoomSnapshot === "unavailable" && <p className={styles.note}>Original room label unavailable; the recorded room ID is retained.</p>}
                                    {data.dataset === "demo" && permissions.recordDemoObservations && isActiveBattery(battery) && <Button variant="outline" size="sm" onClick={() => setForm({ kind: "observation" })}><Plus size={15} />Add demo observation</Button>}
                                </section>
                                <section className={styles.card} aria-label="Last recorded charge">
                                    <h3><Clock3 size={17} aria-hidden="true" />Last recorded charge</h3>
                                    <strong>{battery.chargedAt ? `Completed ${formatTime(battery.chargedAt)}` : "No charge record"}</strong>
                                    <p>{battery.chargedAt ? durationLabel(battery.chargeDurationMinutes) : permissions.recordCharges ? "Record the charging duration and completion time." : "Charging records are maintained by an administrator."}</p>
                                    {permissions.recordCharges && isActiveBattery(battery) && <Button variant="outline" size="sm" onClick={() => setForm({ kind: "charge" })}><Plus size={15} />Record charge</Button>}
                                </section>
                            </div>
                            <section className={styles.specifications}>
                                <Button variant="ghost" className={styles.disclosureButton} onClick={() => setSpecificationsOpen(open => !open)} aria-expanded={specificationsOpen} aria-controls="battery-detail-specifications"><span>Specifications &amp; identification</span><ChevronDown size={16} className={specificationsOpen ? styles.chevronOpen : styles.chevron} aria-hidden="true" /></Button>
                                <MotionDisclosure open={specificationsOpen} id="battery-detail-specifications">
                                    <dl className={`spec-grid ${styles.specGrid}`}>{[["Battery ID", battery.id], ["Battery name", battery.name], ["Chemistry", battery.chemistry || "Not recorded"], ["Model", battery.model || "Not recorded"], ["Capacity", battery.capacityMah == null ? "Not recorded" : `${battery.capacityMah.toLocaleString()} mAh`], ["Nominal voltage", battery.voltage == null ? "Not recorded" : `${battery.voltage} V`], ["RFID identifier", battery.tagId || "Not assigned"]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
                                </MotionDisclosure>
                            </section>
                            {!isActiveBattery(battery) && <section className={styles.card}><h3>Retirement / permanent removal</h3><p>{batteryStatusLabel(battery)} · {formatTime(battery.lifecycleAt)}</p><p>Reason: {battery.lifecycleReason || "Not recorded"}</p>{battery.lifecycleDestination && <p>Destination: {battery.lifecycleDestination}</p>}<p className={styles.note}>This asset is unavailable for borrowing. Its archived storage, responsibility and complete history remain recorded.</p></section>}
                        </TabsContent>
                        <TabsContent value="usage" className={styles.panel}>
                            <div className={styles.card}><BatteryMovementSummary detail={detail} error={error} onRetry={() => setRetry(value => value + 1)} /></div>
                            <BatteryAgeAndUsage battery={battery} detail={detail} error={error} onRetry={() => setRetry(value => value + 1)} />
                        </TabsContent>
                        <TabsContent value="inspections" forceMount hidden={tab !== "inspections"} className={styles.panel}>
                            <BatteryInspections key={`${data.user.id}:${data.dataset}:${battery.id}`} battery={battery} detail={detail} error={error} data={data} write={write} onChanged={() => setRetry(value => value + 1)} onRecoveryChange={setInspectionRecovery} onSaved={() => { setRetry(value => value + 1); onInspectionChanged?.(); }} />
                        </TabsContent>
                        <TabsContent value="history" className={styles.panel}>
                            {error ? <div className="form-error" role="alert">{error}<Button variant="outline" size="sm" onClick={() => setRetry(value => value + 1)}>Retry history</Button></div> : !detail ? <div className="space-y-3" aria-busy="true"><Skeleton className="h-10 w-full" /><Skeleton className="h-24 w-full" /><span className="sr-only">Loading battery history.</span></div> : <Tabs defaultValue="loans" className={styles.historyTabs}>
                                <TabsList variant="line" className={styles.historyTabList} aria-label="Recorded battery history"><TabsTrigger value="loans">Loans</TabsTrigger><TabsTrigger value="charges">Charges</TabsTrigger><TabsTrigger value="observations">Locations</TabsTrigger><TabsTrigger value="audit">Audit history</TabsTrigger></TabsList>
                                <TabsContent value="loans"><div className="history-list">{detail.loans.length ? detail.loans.map((loan, index) => <article className="history-entry" key={loan.id}><div className="history-heading"><strong>{loan.borrowerName}</strong><span className={`status-badge ${!loan.returnedAt && !loan.cancelledAt ? "out" : "in"}`}>{loan.cancelledAt ? "Corrected" : loan.returnedAt ? "Returned" : "In use"}</span></div><p>Checkout</p><p>Out: {formatTime(loan.checkedOutAt)} · {loan.checkoutActorName}</p>{loan.returnedAt && <p>Return: {formatTime(loan.returnedAt)} · {loan.returnActorName}</p>}{loan.cancelledAt && <p>Checkout corrected: {formatTime(loan.cancelledAt)}</p>}{loan.correctionReason && <p className="correction-reason">Reason: {loan.correctionReason}</p>}{permissions.correctLoans && isActiveBattery(battery) && index === 0 && !loan.cancelledAt && <Button variant="ghost" size="sm" onClick={() => setForm({ kind: "correction", loanId: loan.id, action: loan.returnedAt ? "return_reopened" : "checkout_voided", expectedReturnedAt: loan.returnedAt })}><RefreshCw size={15} />Correct this transaction</Button>}</article>) : <p className="history-empty">No loan history.</p>}</div></TabsContent>
                                <TabsContent value="charges"><div className="history-list">{detail.charges.length ? detail.charges.map(charge => <article className="history-entry" key={charge.id}><strong>Completed {formatTime(charge.completedAt)}</strong><p>{durationLabel(charge.durationMinutes)}</p>{charge.percentage != null && <p>Legacy recorded percentage: {charge.percentage}%</p>}<p>Recorded by {charge.actorName} · {formatTime(charge.recordedAt)}</p></article>) : <p className="history-empty">No charging history.</p>}</div></TabsContent>
                                <TabsContent value="observations"><div className="history-list">{detail.observations.length ? detail.observations.map(observation => <article className="history-entry" key={observation.id}><strong>{observation.roomName}</strong>{observation.roomBuilding && <p>{observation.roomBuilding}</p>}<p>Observed {formatTime(observation.observedAt)} · {observation.source}</p><p>Recorded {formatTime(observation.receivedAt)}</p>{observation.roomSnapshot === "unavailable" && <p>Original room label unavailable; the recorded room ID is retained.</p>}</article>) : <p className="history-empty">No location observations.</p>}</div></TabsContent>
                                <TabsContent value="audit"><div className="history-list">{detail.events.length ? detail.events.map(event => <article className="history-entry" key={event.id}><strong>{actionNames[event.action] ?? event.action}</strong><p>{formatTime(event.at)} · {event.actorName}</p>{typeof event.details.reason === "string" && <p className="correction-reason">Reason: {event.details.reason || "Not recorded"}</p>}{typeof event.details.source === "string" && <p>Source: {event.details.source}</p>}</article>) : <p className="history-empty">No audit history.</p>}</div></TabsContent>
                            </Tabs>}
                            <p className={styles.note}>History lists show up to 200 recent records per section. Downloads include the complete selected histories.</p>
                        </TabsContent>
                    </div>
                </Tabs>
                <p className={styles.timeNote}>All displayed times use Australia/Sydney.</p>
            </SheetContent>
        </Sheet>
        {form && <DetailForm key={`${form.kind}-${form.kind === "correction" ? form.loanId : ""}`} form={form} battery={battery} data={data} onClose={() => setForm(null)} write={write} />}
    </>;
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
    const permissions = getRolePermissions(data.user.role);
    const permitted = isActiveBattery(battery) && (form.kind === "charge" ? permissions.recordCharges : form.kind === "observation" ? permissions.recordDemoObservations && data.dataset === "demo" : permissions.correctLoans);
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
    </div>{!permitted && <p className="form-error" role="alert">This operation is no longer available for this account or battery. Your input is retained until you close this dialog.</p>}{error && <p className="form-error" role="alert">{error}</p>}<DialogFooter className="form-footer"><Button type="button" variant="outline" onClick={onClose} disabled={busy}>Cancel</Button><Button type="submit" disabled={busy || !permitted || (form.kind === "observation" && !roomId)}>{busy ? "Saving…" : "Save record"}</Button></DialogFooter></form></DialogContent></Dialog>;
}
