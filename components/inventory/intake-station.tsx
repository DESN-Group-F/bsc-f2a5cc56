"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, LogOut, ScanLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TeachingGroupsPanel } from "./teaching-groups-panel";
import { RecordPicker } from "./record-picker";
import { BatteryModelPicker } from "./battery-model-picker";
import type { InventorySnapshot } from "@/lib/domain";
import type { WriteAction } from "./movement-dialog";
import { dateOnlyOrNull, formatTime, numberOrNull, staffIdentityLabel } from "@/lib/client-utils";
import { currentSydneyDate } from "@/lib/battery-age";
import { buildingPickerOptions, isSelectableRoom, roomPickerOptions } from "@/lib/location-catalog";
import { modelApplication, modelFieldValue, type BatteryModelChoice, type ModelField, type ModelSelection } from "@/lib/battery-models";
import { captureIntakeAttempt, intakeCommonSchema, intakeFailureStatus, intakePayloadSchema, intakeStorageKey, verifyIntakeReceipt, type FirstUseMode, type IntakeAttempt, type IntakeCommon } from "@/lib/intake-session";
import { captureIntakeDraft, recoverIntakeDraft, type IntakeDraftSession, type IntakeQueueEntry } from "@/lib/intake-draft";

export type IntakeStationProps = { data: InventorySnapshot; write: WriteAction; onExit: () => void; onRegistered?: () => void | Promise<void>; paused?: boolean };
type EditDraft = { entryId: string; values: Record<string, string>; firstUseMode: FirstUseMode; modelSelection: ModelSelection | null };
function message(error: unknown) {
    const issues = (error as { issues?: { message: string }[] })?.issues;
    return (issues?.[0]?.message || (error as Error)?.message || "The intake could not be completed.").slice(0, 4000);
}
function stringFields(common: IntakeCommon) { return Object.fromEntries(Object.entries(common).filter(([key]) => key !== "modelSelection").map(([key, value]) => [key, value == null ? "" : String(value)])); }
function firstUseLabel(mode: FirstUseMode, date: string | null) { return mode === "at_registration" ? "Each battery's confirmation date" : mode === "date" ? date || "Not recorded" : "Not recorded"; }
function emptyDraft(actorAccountId: string): IntakeDraftSession { return { actorAccountId, dataset: "demo", batch: null, entries: [], attempt: null, attemptEntryId: null, completed: [] }; }

    function formField(input: Record<string, string>, key: string, label: string, prefix: string, change: (key: string, value: string) => void, disabled: boolean, type = "text", required = false) {
        return <div className="form-field"><Label htmlFor={prefix + "-" + key}>{label}{required && <span className="required"> *</span>}</Label><Input id={prefix + "-" + key} type={type} value={input[key] ?? ""} onChange={event => change(key, event.target.value)} disabled={disabled} required={required} step={type === "number" ? "any" : undefined} min={type === "number" ? 0 : key === "firstUsedOn" ? input.manufacturedOn || undefined : undefined} max={type === "date" ? currentSydneyDate() : undefined}/></div>;
    }
    function IntakeCommonFields({ data, input, mode, prefix, change, changeMode, disabled }: { data: InventorySnapshot; input: Record<string, string>; mode: FirstUseMode; prefix: string; change: (key: string, value: string) => void; changeMode: (mode: FirstUseMode) => void; disabled: boolean }) {
        const field = (key: string, label: string, type = "text", required = false) => formField(input, key, label, prefix, change, disabled, type, required);
        return <div className="form-grid">{field("name", "Battery name", "text", true)}{field("model", "Model")}{field("chemistry", "Chemistry")}{field("capacityMah", "Capacity (mAh)", "number")}{field("voltage", "Nominal voltage (V)", "number")}
            <div className="form-field"><Label htmlFor={prefix + "-owner"}>Responsible staff owner <span className="required">*</span></Label><RecordPicker id={prefix + "-owner"} options={data.people.filter(person => person.role === "staff" && person.accountId).map(person => { const account = data.staffDirectory.find(account => account.id === person.accountId); return { id: person.id, label: staffIdentityLabel(person.name, account?.username, person.accountId || person.id) + (account && !account.active ? " — Inactive account" : ""), disabled: !account?.active }; })} value={input.ownerId ?? ""} onChange={next => change("ownerId", next)} placeholder="Choose responsible owner…" disabled={disabled}/></div>
            <div className="form-field"><Label htmlFor={prefix + "-building"}>Registered storage building</Label><RecordPicker id={prefix + "-building"} options={buildingPickerOptions(data.buildings)} value={input.homeBuildingId ?? ""} onChange={next => { change("homeBuildingId", next); change("homeRoomId", ""); }} placeholder="Choose building…" disabled={disabled}/></div>
            <div className="form-field"><Label htmlFor={prefix + "-room"}>Registered storage room — optional</Label><RecordPicker id={prefix + "-room"} options={[{ id: "__unspecified", label: "Room not specified" }, ...roomPickerOptions(data.rooms, input.homeBuildingId)]} value={input.homeRoomId || "__unspecified"} onChange={next => change("homeRoomId", next === "__unspecified" ? "" : next)} placeholder="Room not specified" disabled={disabled}/><p className="field-hint">J18 demo rooms remain unverified placeholders.</p></div>
            {field("manufacturedOn", "Manufactured on — optional", "date")}
            <div className="form-field"><Label htmlFor={prefix + "-first-use-mode"}>First-use date / time in service</Label><Select value={mode} onValueChange={(next: FirstUseMode) => { if (!disabled) changeMode(next); }} disabled={disabled}><SelectTrigger id={prefix + "-first-use-mode"}><SelectValue/></SelectTrigger><SelectContent><SelectItem value="at_registration">Start when each battery is registered</SelectItem><SelectItem value="date">Use a known first-use date</SelectItem><SelectItem value="unknown">Not recorded</SelectItem></SelectContent></Select></div>
            {mode === "date" && field("firstUsedOn", "Known first-use date", "date", true)}<p className="field-hint full-width">By default, time in service starts on each battery&apos;s server-confirmed registration date in Sydney. Device scan time does not establish its manufacture age or start the service clock.</p>
        </div>;
    }

function IntakeField({ input, keyName, label, prefix, change, disabled, type, required }: { input: Record<string, string>; keyName: string; label: string; prefix: string; change: (key: string, value: string) => void; disabled: boolean; type: string; required: boolean }) { return formField(input, keyName, label, prefix, change, disabled, type, required); }

export function IntakeStation({ data, write, onExit, onRegistered, paused = false }: IntakeStationProps) {
    const [context] = useState(() => ({ dataset: data.dataset, actorAccountId: data.user.id }));
    const contextMatches = context.dataset === data.dataset && context.actorAccountId === data.user.id;
    const storageKey = intakeStorageKey(context.actorAccountId, context.dataset);
    const [recovery] = useState(() => {
        try {
            const raw = sessionStorage.getItem(storageKey), draft = recoverIntakeDraft(raw, context.actorAccountId, context.dataset);
            return { draft, invalid: !!raw && !draft, error: raw && !draft ? "The saved intake draft could not be recovered. No new scan will replace it. Preserve this tab and ask the administrator to review the saved request." : "" };
        } catch { return { draft: null, invalid: true, error: "Saved intake drafts could not be read. No new scan or confirmation will replace unknown saved work. Restore browser storage, then exit and reopen intake." }; }
    });
    const [draft, setDraft] = useState<IntakeDraftSession>(() => recovery.draft || emptyDraft(context.actorAccountId));
    const current = useRef(draft), running = useRef(false), live = useRef(true), storageBlocked = useRef(false);
    const [values, setValues] = useState<Record<string, string>>(() => recovery.draft?.batch ? stringFields(recovery.draft.batch.common) : { ownerId: data.people.find(person => person.role === "staff" && person.accountId === data.user.id)?.id || "", homeBuildingId: "J18" });
    const [firstUseMode, setFirstUseMode] = useState<FirstUseMode>(recovery.draft?.batch?.firstUseMode || "at_registration");
    const [modelSelection, setModelSelection] = useState<ModelSelection | null>(recovery.draft?.batch?.common.modelSelection || null);
    const [appliedModel, setAppliedModel] = useState<BatteryModelChoice | null>(null);
    const [modelBusy, setModelBusy] = useState(false), [busy, setBusy] = useState(false);
    const [tag, setTag] = useState("");
    const [groupEditor, setGroupEditor] = useState<string[] | null>(null), [completedGroupIds, setCompletedGroupIds] = useState<string[]>([]);
    const [error, setError] = useState(recovery.error), [storageError, setStorageError] = useState("");
    const [storageCandidate, setStorageCandidate] = useState<IntakeDraftSession | null>(null);
    const [notice, setNotice] = useState("");
    const [editing, setEditing] = useState<EditDraft | null>(null), [editError, setEditError] = useState("");
    const editor = useRef<EditDraft | null>(null);
    const batch = draft.batch, attempt = draft.attempt;
    const locked = busy || modelBusy || paused || !contextMatches || recovery.invalid;
    const queueLocked = locked || !!attempt || !!storageCandidate || !!storageError || !!editing;
    const configLocked = queueLocked || !!batch;
    const selected = draft.entries.filter(entry => entry.selected);

    useEffect(() => { live.current = contextMatches; return () => { live.current = false; }; }, [contextMatches, data.dataset, data.user.id]);
    useEffect(() => {
        if (!busy && !attempt && !storageCandidate) return;
        const protect = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
        window.addEventListener("beforeunload", protect);
        return () => window.removeEventListener("beforeunload", protect);
    }, [busy, attempt, storageCandidate]);

    function persist(next: IntakeDraftSession) {
        let captured: IntakeDraftSession;
        try { captured = captureIntakeDraft(next); }
        catch (error) { setError(message(error)); return false; }
        try {
            sessionStorage.setItem(storageKey, JSON.stringify(captured));
            current.current = captured; storageBlocked.current = false; setDraft(captured); setStorageCandidate(null); setStorageError(""); return true;
        } catch {
            storageBlocked.current = true; setStorageCandidate(captured);
            setStorageError("This tab could not preserve the intake draft. No replacement scan or confirmation will be sent. Restore browser storage to recover the exact draft."); return false;
        }
    }
    function restoreRecovery() {
        if (locked || running.current || !storageCandidate || !persist(storageCandidate)) return;
        if (storageCandidate.batch) { setValues(stringFields(storageCandidate.batch.common)); setFirstUseMode(storageCandidate.batch.firstUseMode); setModelSelection(storageCandidate.batch.common.modelSelection || null); setAppliedModel(null); }
        setEditing(null); editor.current = null; setEditError(""); setTag(""); setNotice("Intake draft recovery restored. Review pending entries before confirming.");
    }
    function ownerLabel(ownerId: string) {
        const person = data.people.find(person => person.id === ownerId), account = data.staffDirectory.find(account => account.id === person?.accountId);
        return staffIdentityLabel(person?.name || "Staff owner", account?.username, person?.accountId || ownerId);
    }
    function roomLabel(roomId: string | null) { const room = data.rooms.find(room => room.id === roomId); return room ? room.name + (room.isPlaceholder ? " — Placeholder" : "") : "Room not specified"; }
    function commonFrom(input: Record<string, string>, mode: FirstUseMode, selection: ModelSelection | null): IntakeCommon {
        const value = (key: string) => input[key] ?? "";
        const common = intakeCommonSchema.parse({ name: value("name"), model: value("model"), chemistry: value("chemistry"), capacityMah: numberOrNull(value("capacityMah"), "Capacity"), voltage: numberOrNull(value("voltage"), "Voltage"), ownerId: value("ownerId"), homeBuildingId: value("homeBuildingId"), homeRoomId: value("homeRoomId") || null, manufacturedOn: dateOnlyOrNull(value("manufacturedOn"), "Manufactured on"), firstUsedOn: mode === "date" ? dateOnlyOrNull(value("firstUsedOn"), "First used on") : null, ...(selection ? { modelSelection: selection } : {}) });
        if (common.homeBuildingId !== "J18") throw new Error("Select J18 for this intake.");
        const person = data.people.find(person => person.id === common.ownerId && person.role === "staff" && person.accountId);
        if (!person || !data.staffDirectory.some(account => account.id === person.accountId && account.active)) throw new Error("Choose an active responsible staff owner.");
        if (common.homeRoomId && !data.rooms.some(room => room.id === common.homeRoomId && isSelectableRoom(room))) throw new Error("Choose a selectable J18 room, or leave it unspecified.");
        const today = currentSydneyDate();
        if (common.manufacturedOn && common.manufacturedOn > today || common.firstUsedOn && common.firstUsedOn > today) throw new Error("Recorded battery dates cannot be in the future.");
        if (common.manufacturedOn && common.firstUsedOn && common.firstUsedOn < common.manufacturedOn) throw new Error("The first-use date cannot precede manufacture.");
        intakePayloadSchema.parse({ requestId: crypto.randomUUID(), sessionId: crypto.randomUUID(), tagId: "DEMO-INTAKE-REVIEW", common, firstUseMode: mode });
        return common;
    }
    function set(key: string, next: string) {
        if (configLocked || storageBlocked.current || running.current) return;
        setValues(previous => ({ ...previous, [key]: next }));
        setModelSelection(selection => selection && selection.appliedFields.includes(key as ModelField) && (!appliedModel || next !== modelFieldValue(appliedModel, key as ModelField)) ? { ...selection, appliedFields: selection.appliedFields.filter(field => field !== key) } : selection);
    }
    function applyModel(model: BatteryModelChoice, fields: ModelField[]) {
        if (configLocked || storageBlocked.current || running.current) return;
        setValues(previous => modelApplication(previous, model, fields)); setAppliedModel(model); setModelSelection({ origin: model.origin, id: model.id, contentHash: model.contentHash, confirmed: true, appliedFields: fields });
    }
    function startBatch(event: React.FormEvent) {
        event.preventDefault();
        if (configLocked || storageBlocked.current || running.current || data.dataset !== "demo") return;
        try {
            const common = commonFrom(values, firstUseMode, modelSelection);
            if (persist({ ...current.current, batch: { sessionId: crypto.randomUUID(), common, firstUseMode } })) { setError(""); setNotice("Common details confirmed for new draft scans. Scanning does not register a battery; review the queue and confirm it when ready."); }
        } catch (error) { setError(message(error)); }
    }
    function changeCommonDetails() {
        if (queueLocked || storageBlocked.current || running.current || current.current.attempt) return;
        if (persist({ ...current.current, batch: null })) { setTag(""); setError(""); setNotice("Change common details for subsequent scans. Existing queued entries keep their own reviewed details."); }
    }
    function queueTag(identifier: string) {
        if (queueLocked || running.current || storageBlocked.current || editor.current || current.current.attempt || data.dataset !== "demo" || !current.current.batch) return;
        try {
            const tagId = identifier.trim(), currentDraft = current.current, configuration = currentDraft.batch!;
            if (currentDraft.entries.some(entry => entry.tagId === tagId) || currentDraft.completed.some(receipt => receipt.tagId === tagId) || data.batteries.some(battery => battery.tagId === tagId)) throw new Error("This tag is already queued or registered. Scan a different new battery.");
            if (currentDraft.entries.length >= 200) throw new Error("Confirm or remove queued drafts before adding more than 200 entries.");
            const scannedAt = new Date().toISOString();
            const checked = intakePayloadSchema.parse({ requestId: crypto.randomUUID(), sessionId: configuration.sessionId, tagId, scannedAt, common: configuration.common, firstUseMode: configuration.firstUseMode });
            const entry: IntakeQueueEntry = { id: crypto.randomUUID(), tagId: checked.tagId, scannedAt, common: checked.common, firstUseMode: checked.firstUseMode, sessionId: checked.sessionId, selected: true, error: "" };
            if (persist({ ...currentDraft, entries: [...currentDraft.entries, entry] })) { setTag(""); setError(""); setNotice(entry.tagId + " added to the draft queue. Review or edit it before confirmation."); }
        } catch (error) { setError(message(error)); }
    }
    function chooseEntries(ids: string[], checked: boolean) {
        if (queueLocked || running.current || storageBlocked.current || current.current.attempt) return;
        persist({ ...current.current, entries: current.current.entries.map(entry => ids.includes(entry.id) ? { ...entry, selected: checked } : entry) });
    }
    function removeEntry(id: string) {
        if (queueLocked || running.current || storageBlocked.current || current.current.attempt) return;
        if (persist({ ...current.current, entries: current.current.entries.filter(entry => entry.id !== id) })) { setError(""); setNotice("Draft removed. No battery was registered."); }
    }
    function editEntry(id: string) {
        if (queueLocked || running.current || storageBlocked.current || current.current.attempt) return;
        const entry = current.current.entries.find(entry => entry.id === id);
        if (!entry) return;
        const next: EditDraft = { entryId: id, values: { ...stringFields(entry.common), tagId: entry.tagId }, firstUseMode: entry.firstUseMode, modelSelection: entry.common.modelSelection || null };
        editor.current = next; setEditing(next); setEditError("");
    }
    function changeEdit(key: string, value: string) {
        const previous = editor.current;
        if (!previous || locked || storageBlocked.current || current.current.attempt || running.current) return;
        const next: EditDraft = { ...previous, values: { ...previous.values, [key]: value }, modelSelection: previous.modelSelection && previous.values[key] !== value && previous.modelSelection.appliedFields.includes(key as ModelField) ? { ...previous.modelSelection, appliedFields: previous.modelSelection.appliedFields.filter(field => field !== key) } : previous.modelSelection };
        editor.current = next; setEditing(next);
    }
    function saveEdit(event: React.FormEvent) {
        event.preventDefault();
        const proposed = editor.current;
        if (!proposed || locked || running.current || storageBlocked.current || current.current.attempt) return;
        try {
            const original = current.current.entries.find(entry => entry.id === proposed.entryId);
            if (!original) throw new Error("This draft is no longer available.");
            const common = commonFrom(proposed.values, proposed.firstUseMode, proposed.modelSelection), tagId = proposed.values.tagId.trim();
            if (current.current.entries.some(entry => entry.id !== original.id && entry.tagId === tagId) || current.current.completed.some(receipt => receipt.tagId === tagId) || data.batteries.some(battery => battery.tagId === tagId)) throw new Error("This tag is already queued or registered. Choose a distinct new tag.");
            const changed = JSON.stringify(common) !== JSON.stringify(original.common) || proposed.firstUseMode !== original.firstUseMode;
            const next: IntakeQueueEntry = { ...original, common, tagId, firstUseMode: proposed.firstUseMode, sessionId: changed ? crypto.randomUUID() : original.sessionId, error: "" };
            intakePayloadSchema.parse({ requestId: crypto.randomUUID(), sessionId: next.sessionId, tagId: next.tagId, ...(next.scannedAt ? { scannedAt: next.scannedAt } : {}), common: next.common, firstUseMode: next.firstUseMode });
            if (persist({ ...current.current, entries: current.current.entries.map(entry => entry.id === original.id ? next : entry) })) { editor.current = null; setEditing(null); setEditError(""); setError(""); setNotice("Draft updated. Its device scan time is retained; registration still requires confirmation."); }
        } catch (error) { setEditError(message(error)); }
    }
    function closeEdit() { if (!locked && !storageBlocked.current && !running.current) { editor.current = null; setEditing(null); setEditError(""); } }

    async function confirmEntries(ids: string[], retry = false) {
        if (locked || running.current || editor.current || storageBlocked.current || data.dataset !== "demo" || (!retry && current.current.attempt)) return;
        const requested = retry && current.current.attemptEntryId ? [current.current.attemptEntryId] : ids;
        if (!requested.length) return;
        running.current = true; setBusy(true); setError(""); setNotice("");
        let succeeded = 0, rejected = 0, unknown = false;
        try {
            for (const id of requested) {
                if (!live.current) break;
                const entry = current.current.entries.find(entry => entry.id === id);
                if (!entry) continue;
                let captured: IntakeAttempt;
                if (retry) { if (!current.current.attempt || current.current.attemptEntryId !== id) break; captured = current.current.attempt; }
                else {
                    captured = captureIntakeAttempt(context.actorAccountId, context.dataset, { requestId: crypto.randomUUID(), sessionId: entry.sessionId, tagId: entry.tagId, ...(entry.scannedAt ? { scannedAt: entry.scannedAt } : {}), common: entry.common, firstUseMode: entry.firstUseMode });
                    if (!persist({ ...current.current, attempt: captured, attemptEntryId: id })) break;
                }
                try {
                    const result = await write("intake", captured.payload), receipt = verifyIntakeReceipt(result, captured);
                    if (!live.current) {
                        try {
                            const saved = recoverIntakeDraft(sessionStorage.getItem(storageKey), context.actorAccountId, context.dataset);
                            if (saved?.attempt?.payload.requestId === captured.payload.requestId) sessionStorage.setItem(storageKey, JSON.stringify(captureIntakeDraft({ ...saved, entries: saved.entries.filter(candidate => candidate.id !== saved.attemptEntryId), completed: saved.completed.some(item => item.requestId === receipt.requestId) ? saved.completed : [...saved.completed, receipt], attempt: null, attemptEntryId: null })));
                        } catch { /* Retain the original request for exact replay when draft recovery cannot be updated. */ }
                        return;
                    }
                    const next = { ...current.current, entries: current.current.entries.filter(candidate => candidate.id !== id), completed: current.current.completed.some(item => item.requestId === receipt.requestId) ? current.current.completed : [...current.current.completed, receipt], attempt: null, attemptEntryId: null };
                    if (!persist(next)) { setNotice(receipt.batteryId + " was registered, but local draft recovery could not be updated. Restore recovery before continuing."); break; }
                    succeeded++;
                    try { await onRegistered?.(); } catch { if (live.current) setError("Confirmed batteries are saved, but the inventory display could not refresh. Their receipts remain below."); }
                } catch (error) {
                    if (!live.current) return;
                    const reason = message(error), final = intakeFailureStatus(error) === "rejected";
                    const next = { ...current.current, entries: current.current.entries.map(candidate => candidate.id === id ? { ...candidate, error: reason } : candidate), ...(final ? { attempt: null, attemptEntryId: null } : {}) };
                    if (!persist(next)) break;
                    if (!final) { unknown = true; setError(reason + " The outcome is unconfirmed. Retry the exact preserved confirmation before editing or processing another draft."); break; }
                    rejected++;
                }
            }
            if (live.current && !storageBlocked.current) setNotice(succeeded + " batteries registered" + (retry && succeeded ? " · saved result recovered" : "") + ". " + current.current.entries.length + " drafts remain" + (rejected ? "; " + rejected + " require correction" : "") + (unknown ? "; one confirmation is unresolved" : "") + ".");
        } catch (error) { if (live.current) setError(message(error)); }
        finally { running.current = false; if (live.current) setBusy(false); }
    }

    return <section className="intake-station" aria-busy={busy}>
        <div className="section-heading station-exit-bar"><div><h2>First-time battery intake</h2><p className="field-hint">Scan into an editable draft queue, then confirm selected entries or the whole queue. Existing batteries use Scan return.</p><p className="station-exit-hint">{busy || modelBusy ? "Saving. Wait for the result before leaving." : editing ? "Finish or close the draft editor to exit intake." : storageError || storageCandidate ? "Restore the recovery storage before exiting intake." : "Choose Exit intake to restore sidebar navigation. Your staged queue is kept in this tab."}</p></div><Button type="button" size="lg" className="station-exit-button" onClick={() => { if (!busy && !modelBusy && !storageBlocked.current && !editor.current) onExit(); }} disabled={busy || modelBusy || !!storageError || !!storageCandidate || !!editing}><LogOut size={20}/>Exit intake</Button></div>
        <div className="working-notice"><ScanLine size={17}/><span><strong>No real RFID reader is connected.</strong> {data.dataset === "demo" ? "Demonstration scans only collect draft entries. Permanent battery IDs, registration records and default service dates are created after confirmation." : "Continuous hardware intake remains unavailable. Use Register battery for working inventory."}</span></div>
        {!contextMatches && <p role="alert" className="form-error">The inventory or account changed. Exit and reopen intake before processing a draft.</p>}
        {data.dataset !== "demo" ? <div className="intake-panel"><h3>Hardware intake is not connected</h3><p className="field-hint">Reader, tag format and device mapping must be validated before real RFID intake is enabled.</p></div> : !batch ? <form className="intake-panel" onSubmit={startBatch}>
            <h3>Common details for new draft scans</h3><p className="field-hint">Choose shared specifications, owner and registered storage once. Each queued entry can be corrected independently before confirmation.</p>
            <BatteryModelPicker key={data.dataset + "/" + data.user.id} dataset={data.dataset} actorAccountId={data.user.id} canEditModels={data.user.role === "admin"} values={values} selection={modelSelection} disabled={configLocked} onApply={applyModel} onManual={() => { if (!configLocked) { setModelSelection(null); setAppliedModel(null); } }} onBusyChange={setModelBusy}/>
            <IntakeCommonFields data={data} input={values} mode={firstUseMode} prefix="intake" change={set} changeMode={setFirstUseMode} disabled={configLocked}/><div className="form-footer"><Button type="submit" disabled={configLocked}>Confirm common details and start scanning</Button></div>
        </form> : <>
            <div className="intake-panel intake-common-summary"><div className="intake-summary-heading"><h3>Common details for subsequent scans</h3><Button type="button" variant="outline" size="sm" onClick={changeCommonDetails} disabled={queueLocked}>Change common details</Button></div><dl><dt>Battery</dt><dd>{batch.common.name}{batch.common.model && " · " + batch.common.model}</dd><dt>Specifications</dt><dd>{batch.common.chemistry || "Chemistry not recorded"} · {batch.common.capacityMah === null ? "Capacity not recorded" : batch.common.capacityMah.toLocaleString() + " mAh"} · {batch.common.voltage === null ? "Voltage not recorded" : batch.common.voltage + " V"}</dd><dt>Responsible owner</dt><dd>{ownerLabel(batch.common.ownerId)}</dd><dt>Registered storage</dt><dd>J18 · {roomLabel(batch.common.homeRoomId)}</dd><dt>Manufactured on</dt><dd>{batch.common.manufacturedOn || "Not recorded — manufacture age unknown"}</dd><dt>First use</dt><dd>{firstUseLabel(batch.firstUseMode, batch.common.firstUsedOn)}</dd></dl></div>
            <div className="intake-panel"><h3>Continuous demonstration scans</h3><p className="field-hint">Each scan adds one editable draft. Nothing is registered until you choose Confirm selected or Confirm all.</p><div className="form-field"><Label htmlFor="intake-demo-tag">Demonstration tag</Label><Input id="intake-demo-tag" value={tag} onChange={event => { if (!queueLocked && !running.current && !storageBlocked.current && !editor.current && !current.current.attempt) setTag(event.target.value); }} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); queueTag(tag); } }} placeholder="DEMO-INTAKE-…" disabled={modelBusy || paused || !contextMatches || recovery.invalid} readOnly={queueLocked}/></div><div className="intake-actions"><Button type="button" variant="outline" onClick={() => queueTag(tag)} disabled={queueLocked || !tag.trim()}>Simulate this tag</Button><Button type="button" onClick={() => queueTag("DEMO-INTAKE-" + crypto.randomUUID())} disabled={queueLocked}><ScanLine size={16}/>Simulate next new battery</Button></div></div>
        </>}
        {data.dataset === "demo" && <div className="intake-panel"><div className="intake-summary-heading"><h3>Draft queue</h3><span className="intake-count">{draft.entries.length} pending · {selected.length} selected · {draft.completed.length} registered</span></div><p className="field-hint">Selected entries are confirmed individually. Verified successes leave the queue; errors and unselected drafts stay available for correction.</p><div className="intake-actions"><Button type="button" onClick={() => confirmEntries(selected.map(entry => entry.id))} disabled={queueLocked || !selected.length}>Confirm selected ({selected.length})</Button><Button type="button" variant="outline" onClick={() => confirmEntries(draft.entries.map(entry => entry.id))} disabled={queueLocked || !draft.entries.length}>Confirm all ({draft.entries.length})</Button></div>
            {!draft.entries.length ? <p className="field-hint">No pending drafts. Scan a new demonstration tag to add one.</p> : <div className="intake-draft-table"><Table><TableHeader><TableRow><TableHead><Checkbox aria-label="Select all intake drafts" checked={selected.length === draft.entries.length ? true : selected.length ? "indeterminate" : false} onCheckedChange={checked => chooseEntries(draft.entries.map(entry => entry.id), checked === true)} disabled={queueLocked}/></TableHead><TableHead>Draft battery / tag</TableHead><TableHead>Owner / storage</TableHead><TableHead>Scanned at (this device)</TableHead><TableHead>Status</TableHead><TableHead>Actions</TableHead></TableRow></TableHeader><TableBody>{draft.entries.map(entry => <TableRow key={entry.id} data-selected={entry.selected} data-testid={"intake-draft-" + entry.tagId}><TableCell><Checkbox aria-label={"Select " + entry.tagId} checked={entry.selected} onCheckedChange={checked => chooseEntries([entry.id], checked === true)} disabled={queueLocked}/></TableCell><TableCell><strong>{entry.common.name}</strong><span className="intake-draft-detail">{entry.tagId}</span><span className="intake-draft-detail">{entry.common.model || "Model not recorded"} · {entry.common.chemistry || "Chemistry not recorded"}</span><span className="intake-draft-detail">{entry.common.capacityMah === null ? "Capacity not recorded" : entry.common.capacityMah + " mAh"} · {entry.common.voltage === null ? "Voltage not recorded" : entry.common.voltage + " V"}</span></TableCell><TableCell>{ownerLabel(entry.common.ownerId)}<span className="intake-draft-detail">J18 · {roomLabel(entry.common.homeRoomId)}</span></TableCell><TableCell>{entry.scannedAt ? formatTime(entry.scannedAt) : "Not recorded"}</TableCell><TableCell>{draft.attemptEntryId === entry.id ? "Confirmation unresolved" : entry.error ? "Needs correction" : "Pending confirmation"}{entry.error && <span className="intake-draft-error">{entry.error}</span>}</TableCell><TableCell><div className="intake-draft-row-actions"><Button type="button" variant="outline" size="sm" onClick={() => editEntry(entry.id)} disabled={queueLocked}>Edit</Button><Button type="button" variant="ghost" size="sm" onClick={() => removeEntry(entry.id)} disabled={queueLocked}>Remove</Button></div></TableCell></TableRow>)}</TableBody></Table></div>}
            {attempt && <div className="intake-pending"><strong>Preserved confirmation: {attempt.payload.tagId}</strong><p className="field-hint">The original request may already be saved. Its draft cannot be edited, removed or replaced until the exact result is resolved.</p><Button type="button" variant="outline" onClick={() => confirmEntries([], true)} disabled={locked || !!storageError}>Retry exact confirmation</Button><p className="field-hint">Exit intake keeps the complete queue and this request for the same account and inventory.</p></div>}
        </div>}
        {draft.completed.length > 0 && <div className="intake-panel"><div className="section-heading"><h3>Registered in this station</h3><div className="teaching-group-actions"><Button type="button" variant="outline" disabled={locked || !completedGroupIds.length} onClick={() => setGroupEditor(completedGroupIds)}>Add selected to teaching group</Button><Button type="button" variant="outline" disabled={locked || draft.completed.length > 100} onClick={() => setGroupEditor(draft.completed.map(receipt => receipt.batteryId))}>Add registered batteries to group</Button></div></div><div className="intake-results"><Table><TableHeader><TableRow><TableHead>Battery ID</TableHead><TableHead>Tag</TableHead><TableHead>Scanned at (this device)</TableHead><TableHead>Registered at (server)</TableHead><TableHead>First used</TableHead><TableHead>Source</TableHead></TableRow></TableHeader><TableBody>{draft.completed.map(receipt => <TableRow key={receipt.requestId}><TableCell><label className="group-member-selection"><Checkbox aria-label={`Select registered ${receipt.batteryId} for a teaching group`} checked={completedGroupIds.includes(receipt.batteryId)} disabled={locked || !completedGroupIds.includes(receipt.batteryId) && completedGroupIds.length >= 100} onCheckedChange={checked => setCompletedGroupIds(previous => checked === true ? [...new Set([...previous, receipt.batteryId])] : previous.filter(id => id !== receipt.batteryId))}/>{receipt.batteryId}</label></TableCell><TableCell>{receipt.tagId}</TableCell><TableCell>{receipt.scannedAt ? formatTime(receipt.scannedAt) : "Not recorded"}</TableCell><TableCell>{formatTime(receipt.registeredAt)}</TableCell><TableCell>{receipt.firstUsedOn || "Not recorded"}</TableCell><TableCell>Simulated intake</TableCell></TableRow>)}</TableBody></Table></div></div>}
        {notice && <div role="status" className="intake-success"><CheckCircle2 size={17}/><span>{notice}</span></div>}{error && <p role="alert" className="form-error">{error}</p>}{storageError && <div role="alert" className="form-error"><p>{storageError}</p>{storageCandidate && <Button type="button" variant="outline" size="sm" onClick={restoreRecovery} disabled={locked}>Restore draft recovery</Button>}</div>}
        {editing && <Dialog open onOpenChange={open => !open && closeEdit()}><DialogContent className="record-dialog"><DialogHeader><DialogTitle>Edit pending intake</DialogTitle><DialogDescription>Correct this draft before confirmation. The device scan time is retained; no permanent battery ID has been assigned.</DialogDescription></DialogHeader><form onSubmit={saveEdit}><IntakeField input={editing.values} keyName="tagId" label="Demonstration tag" prefix="intake-edit" change={changeEdit} disabled={locked || !!storageError} type="text" required/><IntakeCommonFields data={data} input={editing.values} mode={editing.firstUseMode} prefix="intake-edit" change={changeEdit} changeMode={mode => { if (!locked && !storageBlocked.current && editor.current) { editor.current = { ...editor.current, firstUseMode: mode }; setEditing(editor.current); } }} disabled={locked || !!storageError}/>{editing.modelSelection && <div className="field-hint"><p>Reviewed model suggestions are retained for unchanged fields. Different battery values remain explicit overrides.</p><Button type="button" variant="ghost" size="sm" onClick={() => { if (!locked && !storageBlocked.current && editor.current) { editor.current = { ...editor.current, modelSelection: null }; setEditing(editor.current); } }} disabled={locked || !!storageError}>Use manual model details</Button></div>}{editError && <p role="alert" className="form-error">{editError}</p>}<DialogFooter className="form-footer"><Button type="button" variant="outline" onClick={closeEdit} disabled={locked || !!storageError}>Cancel</Button><Button type="submit" disabled={locked || !!storageError}>Save draft changes</Button></DialogFooter></form></DialogContent></Dialog>}
        {groupEditor && <TeachingGroupsPanel data={data} initialIds={groupEditor} addToExisting onClose={() => setGroupEditor(null)} onChanged={async () => { await onRegistered?.(); }} onSaved={() => setGroupEditor(null)} onFilter={() => {}} onSelect={() => {}}/>}
    </section>;
}
