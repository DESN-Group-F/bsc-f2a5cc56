"use client";

import { useEffect, useRef, useState } from "react";
import { ClipboardCheck, Clock3, Plus, RefreshCw, ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { MotionDisclosure } from "@/components/ui/workspace-motion";
import type { BatteryDetail, BatteryRecord, InventorySnapshot } from "@/lib/domain";
import { currentSydneyDate, serviceAgeAsOfOn } from "@/lib/battery-age";
import { isActiveBattery } from "@/lib/battery-lifecycle";
import { formatBatteryAge, formatDateOnly, formatTime, fromSydneyInput, sydneyInput } from "@/lib/client-utils";
import { formatMovementDuration } from "@/lib/battery-movement-summary";
import { getRolePermissions } from "@/lib/permissions";
import { inspectionSchema, inspectionVoidSchema, type InspectionRecord } from "@/lib/battery-inspections";
import type { WriteAction } from "@/lib/client/inventory-contracts";
import { clearInspectionAttempt, inspectionFinallyRejected, readInspectionAttempt, saveInspectionAttempt, verifyInspectionReceipt, type InspectionAttempt } from "./inspection-request";
import styles from "./battery-history.module.css";

const kindLabels = { visual_check: "Visual check", functional_check: "Functional check", capacity_measurement: "Capacity measurement", other: "Other inspection" };
const outcomeLabels = { no_concern_observed: "No concern observed", concern_observed: "Concern observed", inconclusive: "Inconclusive" };

export function BatteryInspectionSummary({ detail, error, onViewEvidence }: { detail: BatteryDetail | null; error: string; onViewEvidence: () => void }) {
    const latest = detail?.inspectionSummary.latest;
    return <section className={`${styles.section} ${latest?.outcome === "concern_observed" ? styles.concern : ""}`} aria-label="Latest recorded inspection summary">
        <div className={styles.heading}><h3><ClipboardCheck size={17} aria-hidden="true" />Latest recorded inspection</h3><Button variant="ghost" size="sm" onClick={onViewEvidence}>View evidence<ArrowUpRight size={15} aria-hidden="true" /></Button></div>
        {error ? <p role="alert">Inspection evidence could not be loaded. Open Inspections to retry.</p> : !detail ? <><Skeleton className="h-12 w-full" /><span className="sr-only">Loading latest recorded inspection.</span></> : latest ? <><div className={styles.summaryHeading}><strong>{outcomeLabels[latest.outcome]}</strong><span>{kindLabels[latest.kind]}</span></div><p>{formatTime(latest.performedAt)} · {latest.inspectorName}</p>{latest.outcome === "concern_observed" && latest.notes && <p className={styles.concernNotes}>{latest.notes}</p>}</> : <p>{detail.inspectionSummary.totalRecords ? "No current inspection record. Earlier entries marked as entered in error remain in the history." : "No inspection recorded."}</p>}
        <p className={styles.note}>Recorded evidence only. A concern does not automatically change availability; an inspection is not a safety certification.</p>
    </section>;
}

export function BatteryAgeAndUsage({ battery, detail, error, onRetry }: { battery: BatteryRecord; detail: BatteryDetail | null; error: string; onRetry: () => void }) {
    const asOf = currentSydneyDate(), serviceAsOf = serviceAgeAsOfOn(battery, asOf);
    const usage = detail?.usageSummary;
    return <>
        <section className={styles.section} aria-label="Borrowing history" aria-busy={!detail && !error}>
            <div className={styles.heading}><h3><Clock3 size={17} aria-hidden="true" />Borrowing history</h3></div>
            {error ? <><p role="alert">Borrowing history could not be loaded.</p><Button variant="outline" size="sm" onClick={onRetry}><RefreshCw size={15} />Retry details</Button></> : !usage ? <><Skeleton className="h-20 w-full" /><span className="sr-only">Loading borrowing totals.</span></> : <>
                <dl className={styles.metrics}>
                    <div className={styles.metric}><dt>Total checkouts</dt><dd>{usage.totalCheckouts.toLocaleString()}</dd></div>
                    <div className={styles.metric}><dt>Total checked-out time</dt><dd>{usage.totalCheckedOutSeconds == null ? "Not available" : usage.totalCheckedOutSeconds === 0 ? "0h" : formatMovementDuration(usage.totalCheckedOutSeconds * 1000)}</dd></div>
                </dl>
                <p>{usage.completedCheckouts.toLocaleString()} completed · {usage.activeCheckouts.toLocaleString()} current. Calculated from all valid checkout records, as of {formatTime(usage.asOf)}.</p>
                {usage.activeCheckouts > 0 && <p>Includes the current checkout up to that time. Refresh details to update this total.</p>}
                {usage.invalidDurationCount > 0 && <p role="status">The time total is unavailable because {usage.invalidDurationCount.toLocaleString()} checkout record{usage.invalidDurationCount === 1 ? " has" : "s have"} missing or invalid times.</p>}
                <p className={styles.note}>Recorded borrowing only. Checkout counts and time away do not measure charge/discharge cycles, powered use or battery health. Earlier use outside this system is unknown. Checkouts entered in error are excluded.</p>
            </>}
        </section>
        <section className={styles.section} aria-label="Age and registration">
            <div className={styles.heading}><h3><Clock3 size={17} aria-hidden="true" />Age &amp; registration</h3></div>
            <dl className="spec-grid">{[
                ["Date added", formatTime(battery.registeredAt)],
                ["Manufactured on", formatDateOnly(battery.manufacturedOn)],
                ["First used on", formatDateOnly(battery.firstUsedOn)],
                ["Age since manufacture", formatBatteryAge(battery.manufacturedOn, asOf)],
                ["Time in service", serviceAsOf ? formatBatteryAge(battery.firstUsedOn, serviceAsOf) : "Not available"],
            ].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
            <p className={styles.note}>Manufacture age uses the recorded production date. Date added is registration in this system, not the manufacture date. Unknown dates remain unrecorded.</p>
            <p className={styles.note}>{isActiveBattery(battery) ? `Time in service uses the recorded first-use date. Ages calculated as of ${formatDateOnly(asOf)} (Sydney).` : serviceAsOf ? `Time in service ends at retirement / permanent removal on ${formatDateOnly(serviceAsOf)} (Sydney). Manufacture age is calculated as of ${formatDateOnly(asOf)}.` : "Time in service is unavailable because the retirement / removal date is missing or invalid."}</p>
        </section>
    </>;
}

type InspectionFormDraft = { kind: "new" } | { kind: "void"; record: InspectionRecord } | { kind: "resume" };
export type InspectionRecoveryStatus = { ready: boolean; pending: boolean; error: string };

export function BatteryInspections({ battery, detail, error, data, write, onChanged, onSaved, onRecoveryChange }: { battery: BatteryRecord; detail: BatteryDetail | null; error: string; data: InventorySnapshot; write: WriteAction; onChanged: () => void; onSaved?: () => void; onRecoveryChange?: (status: InspectionRecoveryStatus) => void }) {
    const permissions = getRolePermissions(data.user.role);
    const [recovery, setRecovery] = useState<{ ready: boolean; input: InspectionAttempt | null; error: string }>({ ready: false, input: null, error: "" });
    const [form, setForm] = useState<InspectionFormDraft | null>(null), [expanded, setExpanded] = useState(false), [notice, setNotice] = useState("");
    useEffect(() => {
        let active = true;
        Promise.resolve().then(() => { if (active) setRecovery({ ready: true, ...readInspectionAttempt(data.user.id, data.dataset, battery.id) }); });
        return () => { active = false; };
    }, [data.user.id, data.dataset, battery.id]);
    useEffect(() => {
        onRecoveryChange?.({ ready: recovery.ready, pending: !!recovery.input, error: recovery.error });
    }, [onRecoveryChange, recovery.ready, recovery.input, recovery.error]);
    const unavailable = !recovery.ready || !!recovery.error || !!recovery.input || !detail || !!error;
    const latest = detail?.inspectionSummary.latest;
    return <section className={styles.section} aria-label="Inspection records">
        <div className={styles.heading}><h3><ClipboardCheck size={17} aria-hidden="true" />Inspection records</h3>{permissions.recordInspections && isActiveBattery(battery) && <Button variant="outline" size="sm" disabled={unavailable} onClick={() => setForm({ kind: "new" })}><Plus size={15} />Record inspection</Button>}</div>
        {notice && <p className={styles.notice} role="status">{notice}</p>}
        {recovery.error && <p className="form-error" role="alert">{recovery.error}</p>}
        {recovery.input && <div className={styles.notice} role="status"><p>An inspection change still needs confirmation. Its original input is preserved in this tab.</p><Button variant="outline" size="sm" onClick={() => setForm({ kind: "resume" })}>Review saved request</Button></div>}
        {error ? <><p role="alert">Inspection records could not be loaded.</p><Button variant="outline" size="sm" onClick={onChanged}>Retry details</Button></> : !detail ? <><Skeleton className="h-20 w-full" /><span className="sr-only">Loading inspection records.</span></> : <>
            {latest ? <div className={styles.latest}><strong>Latest recorded inspection</strong><p>{kindLabels[latest.kind]} · {outcomeLabels[latest.outcome]}</p><p>{formatTime(latest.performedAt)} · {latest.inspectorName}</p></div> : <p>{detail.inspectionSummary.totalRecords ? "No current inspection record. Earlier entries marked as entered in error remain in the history." : "No inspection recorded."}</p>}
            <p className={styles.note}>Staff-entered observations and measurements. An inspection record is not a safety certification or a battery-health estimate. Recording a concern does not automatically change availability.</p>
            {detail.inspections.length > 0 && <><Button variant="outline" size="sm" aria-expanded={expanded} aria-controls={`inspection-history-${battery.id}`} onClick={() => setExpanded(value => !value)}>{expanded ? "Hide inspection history" : `View inspection history (${detail.inspectionSummary.totalRecords.toLocaleString()})`}</Button>
                <MotionDisclosure open={expanded} id={`inspection-history-${battery.id}`}><div className={styles.history}>{detail.inspections.map(record => <article key={record.id} className={styles.entry}>
                    <div className={styles.heading}><h4>{kindLabels[record.kind]}</h4><span className={styles.badge}>{record.voidedAt ? "Entered in error" : outcomeLabels[record.outcome]}</span></div>
                    <p>Performed {formatTime(record.performedAt)} · {record.inspectorName}</p>
                    {record.voidedAt && <p>Original outcome: {outcomeLabels[record.outcome]}</p>}
                    {record.capacityMah != null && <p>Measured capacity: <strong>{record.capacityMah.toLocaleString()} mAh</strong></p>}
                    {record.method && <p>Method / conditions: {record.method}</p>}
                    {record.notes && <p>Notes: {record.notes}</p>}
                    {record.reference && <p>Evidence reference: {record.reference}</p>}
                    <p className={styles.note}>Recorded {formatTime(record.recordedAt)}</p>
                    {record.voidedAt ? <p className="correction-reason">Marked entered in error {formatTime(record.voidedAt)} by {record.voidedByName || "Not recorded"}. Reason: {record.voidReason}</p> : permissions.correctInspections && <Button variant="outline" size="sm" disabled={unavailable} onClick={() => setForm({ kind: "void", record })}>Mark entered in error</Button>}
                </article>)}<p className={styles.note}>{detail.inspections.length < detail.inspectionSummary.totalRecords ? `Showing the ${detail.inspections.length} most recent records. Download details for the complete history.` : "Original records are retained when an administrator marks an entry as entered in error."}</p></div></MotionDisclosure>
            </>}
        </>}
        {form && <InspectionForm key={form.kind === "void" ? form.record.id : form.kind} draft={form} pending={recovery.input} battery={battery} data={data} write={write} onPending={input => setRecovery({ ready: true, input, error: "" })} onClose={() => setForm(null)} onSaved={action => { setForm(null); setNotice(action === "inspection" ? "Inspection recorded." : "The entry was marked as entered in error. Its original evidence is retained."); (onSaved ?? onChanged)(); }} />}
    </section>;
}

function InspectionForm({ draft, pending, battery, data, write, onPending, onClose, onSaved }: { draft: InspectionFormDraft; pending: InspectionAttempt | null; battery: BatteryRecord; data: InventorySnapshot; write: WriteAction; onPending: (input: InspectionAttempt | null) => void; onClose: () => void; onSaved: (action: InspectionAttempt["action"]) => void }) {
    const [initialRequest] = useState(pending);
    const initialRecord = initialRequest?.action === "inspection" ? initialRequest.payload : null;
    const [kind, setKind] = useState<InspectionRecord["kind"]>(initialRecord?.kind ?? "visual_check"), [outcome, setOutcome] = useState<InspectionRecord["outcome"] | "">(initialRecord?.outcome ?? "");
    const [time, setTime] = useState(() => initialRecord ? sydneyInput(new Date(initialRecord.performedAt)) : sydneyInput()), [method, setMethod] = useState(initialRecord?.method ?? ""), [notes, setNotes] = useState(initialRecord?.notes ?? ""), [reference, setReference] = useState(initialRecord?.reference ?? ""), [capacity, setCapacity] = useState(initialRecord?.capacityMah == null ? "" : String(initialRecord.capacityMah)), [reason, setReason] = useState(initialRequest?.action === "inspection_void" ? initialRequest.payload.reason : "");
    const [busy, setBusy] = useState(false), [error, setError] = useState(""), [rejected, setRejected] = useState(false);
    const attempt = useRef<InspectionAttempt | null>(pending), inFlight = useRef(false), reviewedVersion = useRef(battery.version);
    const input = pending;
    const correcting = initialRequest ? initialRequest.action === "inspection_void" : draft.kind === "void";
    const permissions = getRolePermissions(data.user.role);
    const permitted = correcting ? permissions.correctInspections : permissions.recordInspections && (isActiveBattery(battery) || !!input);
    const locked = busy || !!input || rejected;

    async function submit(event: React.FormEvent) {
        event.preventDefault();
        if (inFlight.current || rejected || !permitted) return;
        setError("");
        let captured = attempt.current;
        try {
            if (!captured) {
                const identity = { accountId: data.user.id, dataset: data.dataset, batteryId: battery.id };
                if (draft.kind === "void") {
                    const parsed = inspectionVoidSchema.safeParse({ requestId: crypto.randomUUID(), batteryId: battery.id, inspectionId: draft.record.id, reason });
                    if (!parsed.success) throw new Error(parsed.error.issues[0].message);
                    captured = { ...identity, action: "inspection_void", payload: parsed.data };
                } else {
                    const parsed = inspectionSchema.safeParse({ requestId: crypto.randomUUID(), batteryId: battery.id, expectedBatteryVersion: reviewedVersion.current, kind, outcome, performedAt: fromSydneyInput(time), method, notes, reference, capacityMah: kind === "capacity_measurement" && capacity.trim() ? Number(capacity) : null });
                    if (!parsed.success) throw new Error(parsed.error.issues[0].message);
                    captured = { ...identity, action: "inspection", payload: parsed.data };
                }
            }
            saveInspectionAttempt(captured);
        } catch (failure) { setError((failure as Error).message); return; }
        attempt.current = captured;
        onPending(captured);
        inFlight.current = true;
        setBusy(true);
        try {
            const result = await write(captured.action, captured.payload);
            verifyInspectionReceipt(result, captured);
            clearInspectionAttempt(captured);
            attempt.current = null;
            onPending(null);
            onSaved(captured.action);
        } catch (failure) {
            if (inspectionFinallyRejected(failure)) {
                try {
                    clearInspectionAttempt(captured);
                    attempt.current = null;
                    onPending(null);
                    setRejected(true);
                    setError(`${(failure as Error).message} This request was not saved. Close this dialog, refresh details and review a new record before trying again.`);
                } catch (storageFailure) { setError((storageFailure as Error).message); }
            } else setError(`${(failure as Error).message} The original input is preserved. Retry this same request to confirm its outcome.`);
        } finally { inFlight.current = false; setBusy(false); }
    }

    return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}><DialogContent className={styles.dialog} showCloseButton={!busy} onEscapeKeyDown={event => { if (busy) event.preventDefault(); }} onInteractOutside={event => { if (busy) event.preventDefault(); }}><DialogHeader><DialogTitle>{correcting ? "Mark inspection entered in error" : "Record inspection"}</DialogTitle><DialogDescription>{battery.id} · {correcting ? "Keep the original evidence and record why this entry should not be used." : "Record a check you performed. Choose an explicit outcome; no safety approval is inferred."}</DialogDescription></DialogHeader>
        <form onSubmit={submit}>
            {input ? <div className={styles.formFields}><p className={styles.notice}>This request is preserved exactly as first sent. Review it below, then retry to confirm the saved outcome. Closing keeps it available in this tab.</p><InspectionRequestReview input={input} /></div> : <div className={styles.formFields}>
                {correcting ? <><p>{draft.kind === "void" ? `${kindLabels[draft.record.kind]} · ${formatTime(draft.record.performedAt)} · ${draft.record.inspectorName}` : initialRequest?.action === "inspection_void" ? `Inspection record: ${initialRequest.payload.inspectionId}` : "Recorded inspection"}</p><div className="form-field"><Label htmlFor="inspection-void-reason">Reason for correction</Label><Textarea id="inspection-void-reason" value={reason} onChange={event => setReason(event.target.value)} minLength={5} maxLength={1000} required disabled={locked} /></div></> : <>
                    <div className={styles.twoColumns}><div className="form-field"><Label htmlFor="inspection-kind">Inspection type</Label><select id="inspection-kind" className={styles.select} value={kind} onChange={event => setKind(event.target.value as InspectionRecord["kind"])} disabled={locked}>{Object.entries(kindLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div><div className="form-field"><Label htmlFor="inspection-outcome">Outcome</Label><select id="inspection-outcome" className={styles.select} value={outcome} onChange={event => setOutcome(event.target.value as InspectionRecord["outcome"])} required disabled={locked}><option value="">Choose an outcome…</option>{Object.entries(outcomeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div></div>
                    <div className="form-field"><Label htmlFor="inspection-time">Performed at (Sydney time)</Label><Input id="inspection-time" type="datetime-local" value={time} onChange={event => setTime(event.target.value)} required disabled={locked} /><p className="field-hint">Inspector: {data.user.displayName}. The server records when this entry is saved.</p></div>
                    <MotionDisclosure open={kind === "capacity_measurement"}><div className="form-field"><Label htmlFor="inspection-capacity">Measured capacity (mAh)</Label><Input id="inspection-capacity" type="number" min="0.001" max="1000000" step="any" value={capacity} onChange={event => setCapacity(event.target.value)} required={kind === "capacity_measurement"} disabled={locked || kind !== "capacity_measurement"} /><p className="field-hint">Enter a measured result, not the rated capacity from the battery label.</p></div></MotionDisclosure>
                    <div className="form-field"><Label htmlFor="inspection-method">Method / test conditions {kind !== "capacity_measurement" && "(optional)"}</Label><Textarea id="inspection-method" value={method} onChange={event => setMethod(event.target.value)} required={kind === "capacity_measurement"} maxLength={1000} disabled={locked} placeholder="Describe the check, equipment and relevant test conditions." /></div>
                    <div className="form-field"><Label htmlFor="inspection-notes">Notes {outcome !== "concern_observed" && kind !== "other" && "(optional)"}</Label><Textarea id="inspection-notes" value={notes} onChange={event => setNotes(event.target.value)} required={outcome === "concern_observed" || kind === "other"} maxLength={2000} disabled={locked} placeholder={outcome === "concern_observed" ? "Describe the concern observed." : "Record relevant findings."} /></div>
                    <div className="form-field"><Label htmlFor="inspection-reference">Evidence reference (optional)</Label><Input id="inspection-reference" value={reference} onChange={event => setReference(event.target.value)} maxLength={1000} disabled={locked} placeholder="Report number, file name or reference link" /><p className="field-hint">A reference only; this form does not upload files.</p></div>
                </>}
            </div>}
            {!permitted && <p className="form-error" role="alert">This operation is unavailable for this account or battery. Any saved request remains preserved.</p>}
            {error && <p className="form-error" role="alert">{error}</p>}
            <DialogFooter><Button type="button" variant="outline" onClick={onClose} disabled={busy}>{input ? "Close and keep request" : "Close"}</Button><Button type="submit" disabled={busy || rejected || !permitted}>{busy ? "Saving…" : input ? "Retry original request" : correcting ? "Confirm correction" : "Save inspection"}</Button></DialogFooter>
        </form>
    </DialogContent></Dialog>;
}

function InspectionRequestReview({ input }: { input: InspectionAttempt }) {
    const fields = input.action === "inspection_void" ? [["Battery", input.batteryId], ["Inspection record", input.payload.inspectionId], ["Correction reason", input.payload.reason]] : [["Battery", input.batteryId], ["Inspection type", kindLabels[input.payload.kind]], ["Outcome", outcomeLabels[input.payload.outcome]], ["Performed at", formatTime(input.payload.performedAt)], ["Method / conditions", input.payload.method || "Not recorded"], ["Notes", input.payload.notes || "Not recorded"], ["Evidence reference", input.payload.reference || "Not recorded"], ...(input.payload.capacityMah != null ? [["Measured capacity", `${input.payload.capacityMah.toLocaleString()} mAh`]] : [])];
    return <dl className={styles.review}>{fields.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>;
}
