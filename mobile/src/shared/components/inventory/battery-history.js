"use client";
import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useRef, useState } from "react";
import { ClipboardCheck, Clock3, Plus, RefreshCw, ArrowUpRight } from "lucide-react";
import { Button } from "../ui/button.js";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../ui/dialog.js";
import { Input } from "../ui/input.js";
import { Label } from "../ui/label.js";
import { Textarea } from "../ui/textarea.js";
import { Skeleton } from "../ui/skeleton.js";
import { MotionDisclosure } from "../ui/workspace-motion.js";
import { currentSydneyDate, serviceAgeAsOfOn } from "../../lib/battery-age.js";
import { isActiveBattery } from "../../lib/battery-lifecycle.js";
import { formatBatteryAge, formatDateOnly, formatTime, fromSydneyInput, sydneyInput } from "../../lib/client-utils.js";
import { formatMovementDuration } from "../../lib/battery-movement-summary.js";
import { getRolePermissions } from "../../lib/permissions.js";
import { inspectionSchema, inspectionVoidSchema } from "../../lib/battery-inspections.js";
import { acknowledgeInspectionAttempt, inspectionFinallyRejected, readInspectionAttempt, saveInspectionAttempt, verifyInspectionReceipt } from "./inspection-request.js";
import styles from "./battery-history.module.css";
const kindLabels = { visual_check: "Visual check", functional_check: "Functional check", capacity_measurement: "Capacity measurement", other: "Other inspection" };
const outcomeLabels = { no_concern_observed: "No concern observed", concern_observed: "Concern observed", inconclusive: "Inconclusive" };
export function BatteryInspectionSummary({ detail, error, onViewEvidence }) {
    const latest = detail?.inspectionSummary.latest;
    return _jsxs("section", { className: `${styles.section} ${latest?.outcome === "concern_observed" ? styles.concern : ""}`, "aria-label": "Latest recorded inspection summary", "data-inspection-outcome": latest?.outcome, children: [_jsxs("div", { className: styles.heading, children: [_jsxs("h3", { children: [_jsx(ClipboardCheck, { size: 17, "aria-hidden": "true" }), "Latest recorded inspection"] }), _jsxs(Button, { variant: "ghost", size: "sm", onClick: onViewEvidence, children: ["View evidence", _jsx(ArrowUpRight, { size: 15, "aria-hidden": "true" })] })] }), error ? _jsx("p", { role: "alert", children: "Inspection evidence could not be loaded. Open Inspections to retry." }) : !detail ? _jsxs(_Fragment, { children: [_jsx(Skeleton, { className: "h-12 w-full" }), _jsx("span", { className: "sr-only", children: "Loading latest recorded inspection." })] }) : latest ? _jsxs(_Fragment, { children: [_jsxs("div", { className: styles.summaryHeading, children: [_jsx("strong", { children: outcomeLabels[latest.outcome] }), _jsx("span", { children: kindLabels[latest.kind] })] }), _jsxs("p", { children: [formatTime(latest.performedAt), " \u00B7 ", latest.inspectorName] }), latest.outcome === "concern_observed" && latest.notes && _jsx("p", { className: styles.concernNotes, children: latest.notes })] }) : _jsx("p", { children: detail.inspectionSummary.totalRecords ? "No current inspection record. Earlier entries marked as entered in error remain in the history." : "No inspection recorded." }), _jsx("p", { className: styles.note, children: "Recorded evidence only. A concern does not automatically change availability; an inspection is not a safety certification." })] });
}
export function BatteryAgeAndUsage({ battery, detail, error, onRetry }) {
    const asOf = currentSydneyDate(), serviceAsOf = serviceAgeAsOfOn(battery, asOf);
    const usage = detail?.usageSummary;
    return _jsxs(_Fragment, { children: [_jsxs("section", { className: styles.section, "aria-label": "Borrowing history", "aria-busy": !detail && !error, children: [_jsx("div", { className: styles.heading, children: _jsxs("h3", { children: [_jsx(Clock3, { size: 17, "aria-hidden": "true" }), "Borrowing history"] }) }), error ? _jsxs(_Fragment, { children: [_jsx("p", { role: "alert", children: "Borrowing history could not be loaded." }), _jsxs(Button, { variant: "outline", size: "sm", onClick: onRetry, children: [_jsx(RefreshCw, { size: 15 }), "Retry details"] })] }) : !usage ? _jsxs(_Fragment, { children: [_jsx(Skeleton, { className: "h-20 w-full" }), _jsx("span", { className: "sr-only", children: "Loading borrowing totals." })] }) : _jsxs(_Fragment, { children: [_jsxs("dl", { className: styles.metrics, children: [_jsxs("div", { className: styles.metric, children: [_jsx("dt", { children: "Total checkouts" }), _jsx("dd", { children: usage.totalCheckouts.toLocaleString() })] }), _jsxs("div", { className: styles.metric, children: [_jsx("dt", { children: "Total checked-out time" }), _jsx("dd", { children: usage.totalCheckedOutSeconds == null ? "Not available" : usage.totalCheckedOutSeconds === 0 ? "0h" : formatMovementDuration(usage.totalCheckedOutSeconds * 1000) })] })] }), _jsxs("p", { children: [usage.completedCheckouts.toLocaleString(), " completed \u00B7 ", usage.activeCheckouts.toLocaleString(), " current. Calculated from all valid checkout records, as of ", formatTime(usage.asOf), "."] }), usage.activeCheckouts > 0 && _jsx("p", { children: "Includes the current checkout up to that time. Refresh details to update this total." }), usage.invalidDurationCount > 0 && _jsxs("p", { role: "status", children: ["The time total is unavailable because ", usage.invalidDurationCount.toLocaleString(), " checkout record", usage.invalidDurationCount === 1 ? " has" : "s have", " missing or invalid times."] }), _jsx("p", { className: styles.note, children: "Recorded borrowing only. Checkout counts and time away do not measure charge/discharge cycles, powered use or battery health. Earlier use outside this system is unknown. Checkouts entered in error are excluded." })] })] }), _jsxs("section", { className: styles.section, "aria-label": "Age and registration", children: [_jsx("div", { className: styles.heading, children: _jsxs("h3", { children: [_jsx(Clock3, { size: 17, "aria-hidden": "true" }), "Age & registration"] }) }), _jsx("dl", { className: "spec-grid", children: [
                            ["Date added", formatTime(battery.registeredAt)],
                            ["Manufactured on", formatDateOnly(battery.manufacturedOn)],
                            ["First used on", formatDateOnly(battery.firstUsedOn)],
                            ["Age since manufacture", formatBatteryAge(battery.manufacturedOn, asOf)],
                            ["Time in service", serviceAsOf ? formatBatteryAge(battery.firstUsedOn, serviceAsOf) : "Not available"],
                        ].map(([label, value]) => _jsxs("div", { children: [_jsx("dt", { children: label }), _jsx("dd", { children: value })] }, label)) }), _jsx("p", { className: styles.note, children: "Manufacture age uses the recorded production date. Date added is registration in this system, not the manufacture date. Unknown dates remain unrecorded." }), _jsx("p", { className: styles.note, children: isActiveBattery(battery) ? `Time in service uses the recorded first-use date. Ages calculated as of ${formatDateOnly(asOf)} (Sydney).` : serviceAsOf ? `Time in service ends at retirement / permanent removal on ${formatDateOnly(serviceAsOf)} (Sydney). Manufacture age is calculated as of ${formatDateOnly(asOf)}.` : "Time in service is unavailable because the retirement / removal date is missing or invalid." })] })] });
}
export function BatteryInspections({ battery, detail, error, data, write, onChanged, onSaved, onRecoveryChange }) {
    const permissions = getRolePermissions(data.user.role);
    const [recovery, setRecovery] = useState({ ready: false, input: null, error: "" });
    const [form, setForm] = useState(null), [expanded, setExpanded] = useState(false), [notice, setNotice] = useState("");
    useEffect(() => {
        let active = true;
        Promise.resolve().then(() => { if (active)
            setRecovery({ ready: true, ...readInspectionAttempt(data.user.id, data.dataset, battery.id) }); });
        return () => { active = false; };
    }, [data.user.id, data.dataset, battery.id]);
    useEffect(() => {
        onRecoveryChange?.({ ready: recovery.ready, pending: !!recovery.input, error: recovery.error });
    }, [onRecoveryChange, recovery.ready, recovery.input, recovery.error]);
    const unavailable = !recovery.ready || !!recovery.error || !!recovery.input || !detail || !!error;
    const latest = detail?.inspectionSummary.latest;
    return _jsxs("section", { className: styles.section, "aria-label": "Inspection records", children: [_jsxs("div", { className: styles.heading, children: [_jsxs("h3", { children: [_jsx(ClipboardCheck, { size: 17, "aria-hidden": "true" }), "Inspection records"] }), permissions.recordInspections && isActiveBattery(battery) && _jsxs(Button, { variant: "outline", size: "sm", disabled: unavailable, onClick: () => setForm({ kind: "new" }), children: [_jsx(Plus, { size: 15 }), "Record inspection"] })] }), notice && _jsx("p", { className: styles.notice, role: "status", children: notice }), recovery.error && _jsx("p", { className: "form-error", role: "alert", children: recovery.error }), recovery.input && _jsxs("div", { className: styles.notice, role: "status", children: [_jsx("p", { children: "An inspection change still needs confirmation. Its original input is preserved in this tab." }), _jsx(Button, { variant: "outline", size: "sm", onClick: () => setForm({ kind: "resume" }), children: "Review saved request" })] }), error ? _jsxs(_Fragment, { children: [_jsx("p", { role: "alert", children: "Inspection records could not be loaded." }), _jsx(Button, { variant: "outline", size: "sm", onClick: onChanged, children: "Retry details" })] }) : !detail ? _jsxs(_Fragment, { children: [_jsx(Skeleton, { className: "h-20 w-full" }), _jsx("span", { className: "sr-only", children: "Loading inspection records." })] }) : _jsxs(_Fragment, { children: [latest ? _jsxs("div", { className: styles.latest, children: [_jsx("strong", { children: "Latest recorded inspection" }), _jsxs("p", { children: [kindLabels[latest.kind], " \u00B7 ", outcomeLabels[latest.outcome]] }), _jsxs("p", { children: [formatTime(latest.performedAt), " \u00B7 ", latest.inspectorName] })] }) : _jsx("p", { children: detail.inspectionSummary.totalRecords ? "No current inspection record. Earlier entries marked as entered in error remain in the history." : "No inspection recorded." }), _jsx("p", { className: styles.note, children: "Staff-entered observations and measurements. An inspection record is not a safety certification or a battery-health estimate. Recording a concern does not automatically change availability." }), detail.inspections.length > 0 && _jsxs(_Fragment, { children: [_jsx(Button, { variant: "outline", size: "sm", "aria-expanded": expanded, "aria-controls": `inspection-history-${battery.id}`, onClick: () => setExpanded(value => !value), children: expanded ? "Hide inspection history" : `View inspection history (${detail.inspectionSummary.totalRecords.toLocaleString()})` }), _jsx(MotionDisclosure, { open: expanded, id: `inspection-history-${battery.id}`, children: _jsxs("div", { className: styles.history, children: [detail.inspections.map(record => _jsxs("article", { className: styles.entry, children: [_jsxs("div", { className: styles.heading, children: [_jsx("h4", { children: kindLabels[record.kind] }), _jsx("span", { className: styles.badge, children: record.voidedAt ? "Entered in error" : outcomeLabels[record.outcome] })] }), _jsxs("p", { children: ["Performed ", formatTime(record.performedAt), " \u00B7 ", record.inspectorName] }), record.voidedAt && _jsxs("p", { children: ["Original outcome: ", outcomeLabels[record.outcome]] }), record.capacityMah != null && _jsxs("p", { children: ["Measured capacity: ", _jsxs("strong", { children: [record.capacityMah.toLocaleString(), " mAh"] })] }), record.method && _jsxs("p", { children: ["Method / conditions: ", record.method] }), record.notes && _jsxs("p", { children: ["Notes: ", record.notes] }), record.reference && _jsxs("p", { children: ["Evidence reference: ", record.reference] }), _jsxs("p", { className: styles.note, children: ["Recorded ", formatTime(record.recordedAt)] }), record.voidedAt ? _jsxs("p", { className: "correction-reason", children: ["Marked entered in error ", formatTime(record.voidedAt), " by ", record.voidedByName || "Not recorded", ". Reason: ", record.voidReason] }) : permissions.correctInspections && _jsx(Button, { variant: "outline", size: "sm", disabled: unavailable, onClick: () => setForm({ kind: "void", record }), children: "Mark entered in error" })] }, record.id)), _jsx("p", { className: styles.note, children: detail.inspections.length < detail.inspectionSummary.totalRecords ? `Showing the ${detail.inspections.length} most recent records. Download details for the complete history.` : "Original records are retained when an administrator marks an entry as entered in error." })] }) })] })] }), form && _jsx(InspectionForm, { draft: form, pending: recovery.input, battery: battery, data: data, write: write, onPending: input => setRecovery({ ready: true, input, error: "" }), onClose: () => setForm(null), onSaved: action => { setForm(null); setNotice(action === "inspection" ? "Inspection recorded." : "The entry was marked as entered in error. Its original evidence is retained."); (onSaved ?? onChanged)(); } }, form.kind === "void" ? form.record.id : form.kind)] });
}
function InspectionForm({ draft, pending, battery, data, write, onPending, onClose, onSaved }) {
    const [initialRequest] = useState(pending);
    const initialRecord = initialRequest?.action === "inspection" ? initialRequest.payload : null;
    const [kind, setKind] = useState(initialRecord?.kind ?? "visual_check"), [outcome, setOutcome] = useState(initialRecord?.outcome ?? "");
    const [time, setTime] = useState(() => initialRecord ? sydneyInput(new Date(initialRecord.performedAt)) : sydneyInput()), [method, setMethod] = useState(initialRecord?.method ?? ""), [notes, setNotes] = useState(initialRecord?.notes ?? ""), [reference, setReference] = useState(initialRecord?.reference ?? ""), [capacity, setCapacity] = useState(initialRecord?.capacityMah == null ? "" : String(initialRecord.capacityMah)), [reason, setReason] = useState(initialRequest?.action === "inspection_void" ? initialRequest.payload.reason : "");
    const [busy, setBusy] = useState(false), [error, setError] = useState(""), [rejected, setRejected] = useState(false);
    const attempt = useRef(pending), inFlight = useRef(false), reviewedVersion = useRef(battery.version);
    const input = pending;
    const correcting = initialRequest ? initialRequest.action === "inspection_void" : draft.kind === "void";
    const permissions = getRolePermissions(data.user.role);
    const permitted = correcting ? permissions.correctInspections : permissions.recordInspections && (isActiveBattery(battery) || !!input);
    const locked = busy || !!input || rejected;
    async function submit(event) {
        event.preventDefault();
        if (inFlight.current || rejected || !permitted)
            return;
        setError("");
        let captured = attempt.current;
        try {
            if (!captured) {
                const identity = { accountId: data.user.id, dataset: data.dataset, batteryId: battery.id };
                if (draft.kind === "void") {
                    const parsed = inspectionVoidSchema.safeParse({ requestId: crypto.randomUUID(), batteryId: battery.id, inspectionId: draft.record.id, reason });
                    if (!parsed.success)
                        throw new Error(parsed.error.issues[0].message);
                    captured = { ...identity, action: "inspection_void", payload: parsed.data };
                }
                else {
                    const parsed = inspectionSchema.safeParse({ requestId: crypto.randomUUID(), batteryId: battery.id, expectedBatteryVersion: reviewedVersion.current, kind, outcome, performedAt: fromSydneyInput(time), method, notes, reference, capacityMah: kind === "capacity_measurement" && capacity.trim() ? Number(capacity) : null });
                    if (!parsed.success)
                        throw new Error(parsed.error.issues[0].message);
                    captured = { ...identity, action: "inspection", payload: parsed.data };
                }
            }
            saveInspectionAttempt(captured);
        }
        catch (failure) {
            setError(failure.message);
            return;
        }
        attempt.current = captured;
        onPending(captured);
        inFlight.current = true;
        setBusy(true);
        try {
            const result = await write(captured.action, captured.payload);
            verifyInspectionReceipt(result, captured);
            await acknowledgeInspectionAttempt(captured);
            attempt.current = null;
            onPending(null);
            onSaved(captured.action);
        }
        catch (failure) {
            if (inspectionFinallyRejected(failure)) {
                try {
                    await acknowledgeInspectionAttempt(captured);
                    attempt.current = null;
                    onPending(null);
                    setRejected(true);
                    setError(`${failure.message} This request was not saved. Close this dialog, refresh details and review a new record before trying again.`);
                }
                catch (storageFailure) {
                    setError(storageFailure.message);
                }
            }
            else
                setError(`${failure.message} The original input is preserved. Retry this same request to confirm its outcome.`);
        }
        finally {
            inFlight.current = false;
            setBusy(false);
        }
    }
    return _jsx(Dialog, { open: true, onOpenChange: open => { if (!open && !busy)
            onClose(); }, children: _jsxs(DialogContent, { className: styles.dialog, showCloseButton: !busy, onEscapeKeyDown: event => { if (busy)
                event.preventDefault(); }, onInteractOutside: event => { if (busy)
                event.preventDefault(); }, children: [_jsxs(DialogHeader, { children: [_jsx(DialogTitle, { children: correcting ? "Mark inspection entered in error" : "Record inspection" }), _jsxs(DialogDescription, { children: [battery.id, " \u00B7 ", correcting ? "Keep the original evidence and record why this entry should not be used." : "Record a check you performed. Choose an explicit outcome; no safety approval is inferred."] })] }), _jsxs("form", { onSubmit: submit, children: [input ? _jsxs("div", { className: styles.formFields, children: [_jsx("p", { className: styles.notice, children: "This request is preserved exactly as first sent. Review it below, then retry to confirm the saved outcome. Closing keeps it available in this tab." }), _jsx(InspectionRequestReview, { input: input })] }) : _jsx("div", { className: styles.formFields, children: correcting ? _jsxs(_Fragment, { children: [_jsx("p", { children: draft.kind === "void" ? `${kindLabels[draft.record.kind]} · ${formatTime(draft.record.performedAt)} · ${draft.record.inspectorName}` : initialRequest?.action === "inspection_void" ? `Inspection record: ${initialRequest.payload.inspectionId}` : "Recorded inspection" }), _jsxs("div", { className: "form-field", children: [_jsx(Label, { htmlFor: "inspection-void-reason", children: "Reason for correction" }), _jsx(Textarea, { id: "inspection-void-reason", value: reason, onChange: event => setReason(event.target.value), minLength: 5, maxLength: 1000, required: true, disabled: locked })] })] }) : _jsxs(_Fragment, { children: [_jsxs("div", { className: styles.twoColumns, children: [_jsxs("div", { className: "form-field", children: [_jsx(Label, { htmlFor: "inspection-kind", children: "Inspection type" }), _jsx("select", { id: "inspection-kind", className: styles.select, value: kind, onChange: event => setKind(event.target.value), disabled: locked, children: Object.entries(kindLabels).map(([value, label]) => _jsx("option", { value: value, children: label }, value)) })] }), _jsxs("div", { className: "form-field", children: [_jsx(Label, { htmlFor: "inspection-outcome", children: "Outcome" }), _jsxs("select", { id: "inspection-outcome", className: styles.select, value: outcome, onChange: event => setOutcome(event.target.value), required: true, disabled: locked, children: [_jsx("option", { value: "", children: "Choose an outcome\u2026" }), Object.entries(outcomeLabels).map(([value, label]) => _jsx("option", { value: value, children: label }, value))] })] })] }), _jsxs("div", { className: "form-field", children: [_jsx(Label, { htmlFor: "inspection-time", children: "Performed at (Sydney time)" }), _jsx(Input, { id: "inspection-time", type: "datetime-local", value: time, onChange: event => setTime(event.target.value), required: true, disabled: locked }), _jsxs("p", { className: "field-hint", children: ["Inspector: ", data.user.displayName, ". The server records when this entry is saved."] })] }), _jsx(MotionDisclosure, { open: kind === "capacity_measurement", children: _jsxs("div", { className: "form-field", children: [_jsx(Label, { htmlFor: "inspection-capacity", children: "Measured capacity (mAh)" }), _jsx(Input, { id: "inspection-capacity", type: "number", min: "0.001", max: "1000000", step: "any", value: capacity, onChange: event => setCapacity(event.target.value), required: kind === "capacity_measurement", disabled: locked || kind !== "capacity_measurement" }), _jsx("p", { className: "field-hint", children: "Enter a measured result, not the rated capacity from the battery label." })] }) }), _jsxs("div", { className: "form-field", children: [_jsxs(Label, { htmlFor: "inspection-method", children: ["Method / test conditions ", kind !== "capacity_measurement" && "(optional)"] }), _jsx(Textarea, { id: "inspection-method", value: method, onChange: event => setMethod(event.target.value), required: kind === "capacity_measurement", maxLength: 1000, disabled: locked, placeholder: "Describe the check, equipment and relevant test conditions." })] }), _jsxs("div", { className: "form-field", children: [_jsxs(Label, { htmlFor: "inspection-notes", children: ["Notes ", outcome !== "concern_observed" && kind !== "other" && "(optional)"] }), _jsx(Textarea, { id: "inspection-notes", value: notes, onChange: event => setNotes(event.target.value), required: outcome === "concern_observed" || kind === "other", maxLength: 2000, disabled: locked, placeholder: outcome === "concern_observed" ? "Describe the concern observed." : "Record relevant findings." })] }), _jsxs("div", { className: "form-field", children: [_jsx(Label, { htmlFor: "inspection-reference", children: "Evidence reference (optional)" }), _jsx(Input, { id: "inspection-reference", value: reference, onChange: event => setReference(event.target.value), maxLength: 1000, disabled: locked, placeholder: "Report number, file name or reference link" }), _jsx("p", { className: "field-hint", children: "A reference only; this form does not upload files." })] })] }) }), !permitted && _jsx("p", { className: "form-error", role: "alert", children: "This operation is unavailable for this account or battery. Any saved request remains preserved." }), error && _jsx("p", { className: "form-error", role: "alert", children: error }), _jsxs(DialogFooter, { children: [_jsx(Button, { type: "button", variant: "outline", onClick: onClose, disabled: busy, children: input ? "Close and keep request" : "Close" }), _jsx(Button, { type: "submit", disabled: busy || rejected || !permitted, children: busy ? "Saving…" : input ? "Retry original request" : correcting ? "Confirm correction" : "Save inspection" })] })] })] }) });
}
function InspectionRequestReview({ input }) {
    const fields = input.action === "inspection_void" ? [["Battery", input.batteryId], ["Inspection record", input.payload.inspectionId], ["Correction reason", input.payload.reason]] : [["Battery", input.batteryId], ["Inspection type", kindLabels[input.payload.kind]], ["Outcome", outcomeLabels[input.payload.outcome]], ["Performed at", formatTime(input.payload.performedAt)], ["Method / conditions", input.payload.method || "Not recorded"], ["Notes", input.payload.notes || "Not recorded"], ["Evidence reference", input.payload.reference || "Not recorded"], ...(input.payload.capacityMah != null ? [["Measured capacity", `${input.payload.capacityMah.toLocaleString()} mAh`]] : [])];
    return _jsx("dl", { className: styles.review, children: fields.map(([label, value]) => _jsxs("div", { children: [_jsx("dt", { children: label }), _jsx("dd", { children: value })] }, label)) });
}
