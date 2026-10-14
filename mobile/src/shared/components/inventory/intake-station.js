import { WorkflowBoundary } from "../../../business/workflow-boundary.jsx";
"use client";
import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { getRolePermissions } from "../../lib/permissions.js";
import { useEffect, useRef, useState } from "react";
import { CheckCircle2, LogOut, ScanLine } from "lucide-react";
import { Button } from "../ui/button.js";
import { ReceiptAction } from "../ui/receipt-action.js";
import { Checkbox } from "../ui/checkbox.js";
import { Input } from "../ui/input.js";
import { Label } from "../ui/label.js";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select.js";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../ui/dialog.js";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table.js";
import { TeachingGroupsPanel } from "./teaching-groups-panel.js";
import { RecordPicker } from "./record-picker.js";
import { BatteryModelPicker } from "./battery-model-picker.js";
import { BatteryFilterControls } from "./battery-filter-controls.js";
import { defaultInventoryFilter } from "../../lib/inventory-query.js";
import { getFilteredBatteries, hasBatterySelectionCriteria } from "../../lib/battery-selection-query.js";
import { hasRowTextSelection, shouldToggleSelection } from "../../lib/client/row-selection.js";
import { dateOnlyOrNull, formatTime, numberOrNull, staffIdentityLabel } from "../../lib/client-utils.js";
import { currentSydneyDate } from "../../lib/battery-age.js";
import { buildingPickerOptions, isSelectableRoom, roomPickerOptions } from "../../lib/location-catalog.js";
import { modelApplication, modelFieldValue } from "../../lib/battery-models.js";
import { captureIntakeAttempt, intakeCommonSchema, intakeFailureStatus, intakePayloadSchema, intakeStorageKey, verifyIntakeReceipt } from "../../lib/intake-session.js";
import { captureIntakeDraft, recoverIntakeDraft } from "../../lib/intake-draft.js";
function message(error) {
    const issues = error?.issues;
    return (issues?.[0]?.message || error?.message || "The intake could not be completed.").slice(0, 4000);
}
function stringFields(common) { return Object.fromEntries(Object.entries(common).filter(([key]) => key !== "modelSelection").map(([key, value]) => [key, value == null ? "" : String(value)])); }
function firstUseLabel(mode, date) { return mode === "at_registration" ? "Each battery's confirmation date" : mode === "date" ? date || "Not recorded" : "Not recorded"; }
function emptyDraft(actorAccountId) { return { actorAccountId, dataset: "demo", batch: null, entries: [], attempt: null, attemptEntryId: null, completed: [] }; }
function formField(input, key, label, prefix, change, disabled, type = "text", required = false) {
    return _jsxs("div", { className: "form-field", children: [_jsxs(Label, { htmlFor: prefix + "-" + key, children: [label, required && _jsx("span", { className: "required", children: " *" })] }), _jsx(Input, { id: prefix + "-" + key, type: type, value: input[key] ?? "", onChange: event => change(key, event.target.value), disabled: disabled, required: required, step: type === "number" ? "any" : undefined, min: type === "number" ? 0 : key === "firstUsedOn" ? input.manufacturedOn || undefined : undefined, max: type === "date" ? currentSydneyDate() : undefined })] });
}
function IntakeCommonFields({ data, input, mode, prefix, change, changeMode, disabled }) {
    const field = (key, label, type = "text", required = false) => formField(input, key, label, prefix, change, disabled, type, required);
    return _jsxs("div", { className: "form-grid", children: [field("name", "Battery name", "text", true), field("model", "Model"), field("chemistry", "Chemistry"), field("capacityMah", "Capacity (mAh)", "number"), field("voltage", "Nominal voltage (V)", "number"), _jsxs("div", { className: "form-field", children: [_jsxs(Label, { htmlFor: prefix + "-owner", children: ["Responsible staff owner ", _jsx("span", { className: "required", children: "*" })] }), _jsx(RecordPicker, { id: prefix + "-owner", options: data.people.filter(person => person.role === "staff" && person.accountId).map(person => { const account = data.staffDirectory.find(account => account.id === person.accountId); return { id: person.id, label: staffIdentityLabel(person.name, account?.username, person.accountId || person.id) + (account && !account.active ? " — Inactive account" : ""), disabled: !account?.active }; }), value: input.ownerId ?? "", onChange: next => change("ownerId", next), placeholder: "Choose responsible owner\u2026", disabled: disabled })] }), _jsxs("div", { className: "form-field", children: [_jsx(Label, { htmlFor: prefix + "-building", children: "Registered storage building" }), _jsx(RecordPicker, { id: prefix + "-building", options: buildingPickerOptions(data.buildings), value: input.homeBuildingId ?? "", onChange: next => { change("homeBuildingId", next); change("homeRoomId", ""); }, placeholder: "Choose building\u2026", disabled: disabled })] }), _jsxs("div", { className: "form-field", children: [_jsx(Label, { htmlFor: prefix + "-room", children: "Registered storage room \u2014 optional" }), _jsx(RecordPicker, { id: prefix + "-room", options: [{ id: "__unspecified", label: "Room not specified" }, ...roomPickerOptions(data.rooms, input.homeBuildingId)], value: input.homeRoomId || "__unspecified", onChange: next => change("homeRoomId", next === "__unspecified" ? "" : next), placeholder: "Room not specified", disabled: disabled }), _jsx("p", { className: "field-hint", children: "J18 demo rooms remain unverified placeholders." })] }), field("manufacturedOn", "Manufactured on — optional", "date"), _jsxs("div", { className: "form-field", children: [_jsx(Label, { htmlFor: prefix + "-first-use-mode", children: "First-use date / time in service" }), _jsxs(Select, { value: mode, onValueChange: (next) => { if (!disabled)
                            changeMode(next); }, disabled: disabled, children: [_jsx(SelectTrigger, { id: prefix + "-first-use-mode", children: _jsx(SelectValue, {}) }), _jsxs(SelectContent, { children: [_jsx(SelectItem, { value: "at_registration", children: "Start when each battery is registered" }), _jsx(SelectItem, { value: "date", children: "Use a known first-use date" }), _jsx(SelectItem, { value: "unknown", children: "Not recorded" })] })] })] }), mode === "date" && field("firstUsedOn", "Known first-use date", "date", true), _jsx("p", { className: "field-hint full-width", children: "By default, time in service starts on each battery's server-confirmed registration date in Sydney. Device scan time does not establish its manufacture age or start the service clock." })] });
}
function IntakeField({ input, keyName, label, prefix, change, disabled, type, required }) { return formField(input, keyName, label, prefix, change, disabled, type, required); }
function SharedIntakeStation({ data, write, onExit, onRegistered, paused = false }) {
    const [context] = useState(() => ({ dataset: data.dataset, actorAccountId: data.user.id }));
    const contextMatches = context.dataset === data.dataset && context.actorAccountId === data.user.id;
    const storageKey = intakeStorageKey(context.actorAccountId, context.dataset);
    const [recovery] = useState(() => {
        try {
            const raw = window.__batteryWorkflowStorage.getItem(storageKey), draft = recoverIntakeDraft(raw, context.actorAccountId, context.dataset);
            return { draft, invalid: !!raw && !draft, error: raw && !draft ? "The saved intake draft could not be recovered. No new scan will replace it. Preserve this tab and ask the administrator to review the saved request." : "" };
        }
        catch {
            return { draft: null, invalid: true, error: "Saved intake drafts could not be read. No new scan or confirmation will replace unknown saved work. Restore browser storage, then exit and reopen intake." };
        }
    });
    const [draft, setDraft] = useState(() => recovery.draft || emptyDraft(context.actorAccountId));
    const current = useRef(draft), running = useRef(false), live = useRef(true), storageBlocked = useRef(false);
    const [values, setValues] = useState(() => recovery.draft?.batch ? stringFields(recovery.draft.batch.common) : { ownerId: data.people.find(person => person.role === "staff" && person.accountId === data.user.id)?.id || "", homeBuildingId: "J18" });
    const [firstUseMode, setFirstUseMode] = useState(recovery.draft?.batch?.firstUseMode || "at_registration");
    const [modelSelection, setModelSelection] = useState(recovery.draft?.batch?.common.modelSelection || null);
    const [appliedModel, setAppliedModel] = useState(null);
    const [modelBusy, setModelBusy] = useState(false), [busy, setBusy] = useState(false);
    const [tag, setTag] = useState("");
    const [groupEditor, setGroupEditor] = useState(null), [completedGroupIds, setCompletedGroupIds] = useState([]);
    const [completedFilters, setCompletedFilters] = useState(() => ({ ...defaultInventoryFilter(), lifecycle: "all" }));
    const [registrationConfirmation, setRegistrationConfirmation] = useState(null);
    const [error, setError] = useState(recovery.error), [storageError, setStorageError] = useState("");
    const [storageCandidate, setStorageCandidate] = useState(null);
    const [notice, setNotice] = useState("");
    const [editing, setEditing] = useState(null), [editError, setEditError] = useState("");
    const editor = useRef(null);
    const batch = draft.batch, attempt = draft.attempt;
    const locked = busy || modelBusy || paused || !contextMatches || recovery.invalid;
    const queueLocked = locked || !!attempt || !!storageCandidate || !!storageError || !!editing;
    const configLocked = queueLocked || !!batch;
    const selected = draft.entries.filter(entry => entry.selected);
    const completedIds = new Set(draft.completed.map(receipt => receipt.batteryId));
    const completedMatches = getFilteredBatteries(data, completedFilters, data.batteries.filter(battery => completedIds.has(battery.id)));
    const filteredCompletedIds = new Set(completedMatches.batteries.map(battery => battery.id));
    const completedFiltered = hasBatterySelectionCriteria(completedFilters, "all");
    const visibleCompleted = completedMatches.error ? [] : draft.completed.filter(receipt => !completedFiltered || filteredCompletedIds.has(receipt.batteryId)).sort((left, right) => {
        const ids = completedMatches.batteries.map(battery => battery.id);
        const leftIndex = ids.indexOf(left.batteryId), rightIndex = ids.indexOf(right.batteryId);
        return (leftIndex < 0 ? Number.MAX_SAFE_INTEGER : leftIndex) - (rightIndex < 0 ? Number.MAX_SAFE_INTEGER : rightIndex);
    });
    function chooseCompleted(id, checked) {
        if (locked || !completedIds.has(id))
            return;
        setCompletedGroupIds(previous => checked ? previous.includes(id) || previous.length >= 100 ? previous : [...previous, id] : previous.filter(value => value !== id));
    }
    useEffect(() => { live.current = contextMatches; return () => { live.current = false; }; }, [contextMatches, data.dataset, data.user.id]);
    useEffect(() => {
        if (!busy && !attempt && !storageCandidate)
            return;
        const protect = (event) => { event.preventDefault(); event.returnValue = ""; };
        window.addEventListener("beforeunload", protect);
        return () => window.removeEventListener("beforeunload", protect);
    }, [busy, attempt, storageCandidate]);
    function persist(next) {
        let captured;
        try {
            captured = captureIntakeDraft(next);
        }
        catch (error) {
            setError(message(error));
            return false;
        }
        try {
            window.__batteryWorkflowStorage.setItem(storageKey, JSON.stringify(captured));
            current.current = captured;
            storageBlocked.current = false;
            setDraft(captured);
            setStorageCandidate(null);
            setStorageError("");
            return true;
        }
        catch {
            storageBlocked.current = true;
            setStorageCandidate(captured);
            setStorageError("This tab could not preserve the intake draft. No replacement scan or confirmation will be sent. Restore browser storage to recover the exact draft.");
            return false;
        }
    }
    function restoreRecovery() {
        if (locked || running.current || !storageCandidate || !persist(storageCandidate))
            return;
        if (storageCandidate.batch) {
            setValues(stringFields(storageCandidate.batch.common));
            setFirstUseMode(storageCandidate.batch.firstUseMode);
            setModelSelection(storageCandidate.batch.common.modelSelection || null);
            setAppliedModel(null);
        }
        setEditing(null);
        editor.current = null;
        setEditError("");
        setTag("");
        setNotice("Intake draft recovery restored. Review pending entries before confirming.");
    }
    function ownerLabel(ownerId) {
        const person = data.people.find(person => person.id === ownerId), account = data.staffDirectory.find(account => account.id === person?.accountId);
        return staffIdentityLabel(person?.name || "Staff owner", account?.username, person?.accountId || ownerId);
    }
    function roomLabel(roomId) { const room = data.rooms.find(room => room.id === roomId); return room ? room.name + (room.isPlaceholder ? " — Placeholder" : "") : "Room not specified"; }
    function commonFrom(input, mode, selection) {
        const value = (key) => input[key] ?? "";
        const common = intakeCommonSchema.parse({ name: value("name"), model: value("model"), chemistry: value("chemistry"), capacityMah: numberOrNull(value("capacityMah"), "Capacity"), voltage: numberOrNull(value("voltage"), "Voltage"), ownerId: value("ownerId"), homeBuildingId: value("homeBuildingId"), homeRoomId: value("homeRoomId") || null, manufacturedOn: dateOnlyOrNull(value("manufacturedOn"), "Manufactured on"), firstUsedOn: mode === "date" ? dateOnlyOrNull(value("firstUsedOn"), "First used on") : null, ...(selection ? { modelSelection: selection } : {}) });
        if (common.homeBuildingId !== "J18")
            throw new Error("Select J18 for this intake.");
        const person = data.people.find(person => person.id === common.ownerId && person.role === "staff" && person.accountId);
        if (!person || !data.staffDirectory.some(account => account.id === person.accountId && account.active))
            throw new Error("Choose an active responsible staff owner.");
        if (common.homeRoomId && !data.rooms.some(room => room.id === common.homeRoomId && isSelectableRoom(room)))
            throw new Error("Choose a selectable J18 room, or leave it unspecified.");
        const today = currentSydneyDate();
        if (common.manufacturedOn && common.manufacturedOn > today || common.firstUsedOn && common.firstUsedOn > today)
            throw new Error("Recorded battery dates cannot be in the future.");
        if (common.manufacturedOn && common.firstUsedOn && common.firstUsedOn < common.manufacturedOn)
            throw new Error("The first-use date cannot precede manufacture.");
        intakePayloadSchema.parse({ requestId: crypto.randomUUID(), sessionId: crypto.randomUUID(), tagId: "DEMO-INTAKE-REVIEW", common, firstUseMode: mode });
        return common;
    }
    function set(key, next) {
        if (configLocked || storageBlocked.current || running.current)
            return;
        setValues(previous => ({ ...previous, [key]: next }));
        setModelSelection(selection => selection && selection.appliedFields.includes(key) && (!appliedModel || next !== modelFieldValue(appliedModel, key)) ? { ...selection, appliedFields: selection.appliedFields.filter(field => field !== key) } : selection);
    }
    function applyModel(model, fields) {
        if (configLocked || storageBlocked.current || running.current)
            return;
        setValues(previous => modelApplication(previous, model, fields));
        setAppliedModel(model);
        setModelSelection({ origin: model.origin, id: model.id, contentHash: model.contentHash, confirmed: true, appliedFields: fields });
    }
    function startBatch(event) {
        event.preventDefault();
        if (configLocked || storageBlocked.current || running.current || data.dataset !== "demo")
            return;
        try {
            const common = commonFrom(values, firstUseMode, modelSelection);
            if (persist({ ...current.current, batch: { sessionId: crypto.randomUUID(), common, firstUseMode } })) {
                setError("");
                setNotice("Common details confirmed for new draft scans. Scanning does not register a battery; review the queue and confirm it when ready.");
            }
        }
        catch (error) {
            setError(message(error));
        }
    }
    function changeCommonDetails() {
        if (queueLocked || storageBlocked.current || running.current || current.current.attempt)
            return;
        if (persist({ ...current.current, batch: null })) {
            setTag("");
            setError("");
            setNotice("Change common details for subsequent scans. Existing queued entries keep their own reviewed details.");
        }
    }
    function queueTag(identifier) {
        if (queueLocked || running.current || storageBlocked.current || editor.current || current.current.attempt || data.dataset !== "demo" || !current.current.batch)
            return;
        try {
            const tagId = identifier.trim(), currentDraft = current.current, configuration = currentDraft.batch;
            if (currentDraft.entries.some(entry => entry.tagId === tagId) || currentDraft.completed.some(receipt => receipt.tagId === tagId) || data.batteries.some(battery => battery.tagId === tagId))
                throw new Error("This tag is already queued or registered. Scan a different new battery.");
            if (currentDraft.entries.length >= 200)
                throw new Error("Confirm or remove queued drafts before adding more than 200 entries.");
            const scannedAt = new Date().toISOString();
            const checked = intakePayloadSchema.parse({ requestId: crypto.randomUUID(), sessionId: configuration.sessionId, tagId, scannedAt, common: configuration.common, firstUseMode: configuration.firstUseMode });
            const entry = { id: crypto.randomUUID(), tagId: checked.tagId, scannedAt, common: checked.common, firstUseMode: checked.firstUseMode, sessionId: checked.sessionId, selected: true, error: "" };
            if (persist({ ...currentDraft, entries: [...currentDraft.entries, entry] })) {
                setTag("");
                setError("");
                setNotice(entry.tagId + " added to the draft queue. Review or edit it before confirmation.");
            }
        }
        catch (error) {
            setError(message(error));
        }
    }
    function chooseEntries(ids, checked) {
        if (queueLocked || running.current || storageBlocked.current || current.current.attempt)
            return;
        persist({ ...current.current, entries: current.current.entries.map(entry => ids.includes(entry.id) ? { ...entry, selected: checked } : entry) });
    }
    function removeEntry(id) {
        if (queueLocked || running.current || storageBlocked.current || current.current.attempt)
            return;
        if (persist({ ...current.current, entries: current.current.entries.filter(entry => entry.id !== id) })) {
            setError("");
            setNotice("Draft removed. No battery was registered.");
        }
    }
    function editEntry(id) {
        if (queueLocked || running.current || storageBlocked.current || current.current.attempt)
            return;
        const entry = current.current.entries.find(entry => entry.id === id);
        if (!entry)
            return;
        const next = { entryId: id, values: { ...stringFields(entry.common), tagId: entry.tagId }, firstUseMode: entry.firstUseMode, modelSelection: entry.common.modelSelection || null };
        editor.current = next;
        setEditing(next);
        setEditError("");
    }
    function changeEdit(key, value) {
        const previous = editor.current;
        if (!previous || locked || storageBlocked.current || current.current.attempt || running.current)
            return;
        const next = { ...previous, values: { ...previous.values, [key]: value }, modelSelection: previous.modelSelection && previous.values[key] !== value && previous.modelSelection.appliedFields.includes(key) ? { ...previous.modelSelection, appliedFields: previous.modelSelection.appliedFields.filter(field => field !== key) } : previous.modelSelection };
        editor.current = next;
        setEditing(next);
    }
    function saveEdit(event) {
        event.preventDefault();
        const proposed = editor.current;
        if (!proposed || locked || running.current || storageBlocked.current || current.current.attempt)
            return;
        try {
            const original = current.current.entries.find(entry => entry.id === proposed.entryId);
            if (!original)
                throw new Error("This draft is no longer available.");
            const common = commonFrom(proposed.values, proposed.firstUseMode, proposed.modelSelection), tagId = proposed.values.tagId.trim();
            if (current.current.entries.some(entry => entry.id !== original.id && entry.tagId === tagId) || current.current.completed.some(receipt => receipt.tagId === tagId) || data.batteries.some(battery => battery.tagId === tagId))
                throw new Error("This tag is already queued or registered. Choose a distinct new tag.");
            const changed = JSON.stringify(common) !== JSON.stringify(original.common) || proposed.firstUseMode !== original.firstUseMode;
            const next = { ...original, common, tagId, firstUseMode: proposed.firstUseMode, sessionId: changed ? crypto.randomUUID() : original.sessionId, error: "" };
            intakePayloadSchema.parse({ requestId: crypto.randomUUID(), sessionId: next.sessionId, tagId: next.tagId, ...(next.scannedAt ? { scannedAt: next.scannedAt } : {}), common: next.common, firstUseMode: next.firstUseMode });
            if (persist({ ...current.current, entries: current.current.entries.map(entry => entry.id === original.id ? next : entry) })) {
                editor.current = null;
                setEditing(null);
                setEditError("");
                setError("");
                setNotice("Draft updated. Its device scan time is retained; registration still requires confirmation.");
            }
        }
        catch (error) {
            setEditError(message(error));
        }
    }
    function closeEdit() { if (!locked && !storageBlocked.current && !running.current) {
        editor.current = null;
        setEditing(null);
        setEditError("");
    } }
    async function confirmEntries(ids, retry = false) {
        if (locked || running.current || editor.current || storageBlocked.current || data.dataset !== "demo" || (!retry && current.current.attempt))
            return;
        const requested = retry && current.current.attemptEntryId ? [current.current.attemptEntryId] : ids;
        if (!requested.length)
            return;
        running.current = true;
        setBusy(true);
        setError("");
        setNotice("");
        setRegistrationConfirmation(null);
        let succeeded = 0, rejected = 0, unknown = false;
        const verifiedRequestIds = [];
        try {
            for (const id of requested) {
                if (!live.current)
                    break;
                const entry = current.current.entries.find(entry => entry.id === id);
                if (!entry)
                    continue;
                let captured;
                if (retry) {
                    if (!current.current.attempt || current.current.attemptEntryId !== id)
                        break;
                    captured = current.current.attempt;
                }
                else {
                    captured = captureIntakeAttempt(context.actorAccountId, context.dataset, { requestId: crypto.randomUUID(), sessionId: entry.sessionId, tagId: entry.tagId, ...(entry.scannedAt ? { scannedAt: entry.scannedAt } : {}), common: entry.common, firstUseMode: entry.firstUseMode });
                    if (!persist({ ...current.current, attempt: captured, attemptEntryId: id }))
                        break;
                }
                try {
                    const result = await write("intake", captured.payload), receipt = verifyIntakeReceipt(result, captured);
                    if (!live.current) {
                        try {
                            const saved = recoverIntakeDraft(window.__batteryWorkflowStorage.getItem(storageKey), context.actorAccountId, context.dataset);
                            if (saved?.attempt?.payload.requestId === captured.payload.requestId)
                                window.__batteryWorkflowStorage.setItem(storageKey, JSON.stringify(captureIntakeDraft({ ...saved, entries: saved.entries.filter(candidate => candidate.id !== saved.attemptEntryId), completed: saved.completed.some(item => item.requestId === receipt.requestId) ? saved.completed : [...saved.completed, receipt], attempt: null, attemptEntryId: null })));
                        }
                        catch { /* Retain the original request for exact replay when draft recovery cannot be updated. */ }
                        return;
                    }
                    verifiedRequestIds.push(receipt.requestId);
                    setRegistrationConfirmation({ identity: verifiedRequestIds.join("|"), count: verifiedRequestIds.length, text: `${verifiedRequestIds.length} ${verifiedRequestIds.length === 1 ? "battery" : "batteries"} registered` });
                    const next = { ...current.current, entries: current.current.entries.filter(candidate => candidate.id !== id), completed: current.current.completed.some(item => item.requestId === receipt.requestId) ? current.current.completed : [...current.current.completed, receipt], attempt: null, attemptEntryId: null };
                    if (!persist(next)) {
                        setNotice(receipt.batteryId + " was registered, but local draft recovery could not be updated. Restore recovery before continuing.");
                        break;
                    }
                    succeeded++;
                    try {
                        await onRegistered?.();
                    }
                    catch {
                        if (live.current)
                            setError("Confirmed batteries are saved, but the inventory display could not refresh. Their receipts remain below.");
                    }
                }
                catch (error) {
                    if (!live.current)
                        return;
                    const reason = message(error), final = intakeFailureStatus(error) === "rejected";
                    const next = { ...current.current, entries: current.current.entries.map(candidate => candidate.id === id ? { ...candidate, error: reason } : candidate), ...(final ? { attempt: null, attemptEntryId: null } : {}) };
                    if (!persist(next))
                        break;
                    if (!final) {
                        unknown = true;
                        setError(reason + " The outcome is unconfirmed. Retry the exact preserved confirmation before editing or processing another draft.");
                        break;
                    }
                    rejected++;
                }
            }
            if (live.current && !storageBlocked.current)
                setNotice(succeeded + " batteries registered" + (retry && succeeded ? " · saved result recovered" : "") + ". " + current.current.entries.length + " drafts remain" + (rejected ? "; " + rejected + " require correction" : "") + (unknown ? "; one confirmation is unresolved" : "") + ".");
        }
        catch (error) {
            if (live.current)
                setError(message(error));
        }
        finally {
            running.current = false;
            if (live.current)
                setBusy(false);
        }
    }
    return _jsxs("section", { className: "intake-station", "aria-busy": busy, children: [_jsxs("div", { className: "scan-station-header station-exit-bar", children: [_jsxs("div", { children: [_jsx("h2", { children: "First-time battery intake" }), _jsx("p", { children: "Scan into an editable draft queue, then confirm selected entries or the whole queue. Existing batteries use Scan return." }), _jsx("p", { className: "station-exit-hint", children: busy || modelBusy ? "Saving. Wait for the result before leaving." : editing ? "Finish or close the draft editor to exit intake." : storageError || storageCandidate ? "Restore the recovery storage before exiting intake." : "Choose Exit intake to restore sidebar navigation. Your staged queue is kept in this tab." })] }), _jsxs(Button, { type: "button", size: "lg", className: "station-exit-button", onClick: () => { if (!busy && !modelBusy && !storageBlocked.current && !editor.current)
                            onExit(); }, disabled: busy || modelBusy || !!storageError || !!storageCandidate || !!editing, children: [_jsx(LogOut, { size: 20 }), "Exit intake"] })] }), _jsxs("div", { className: "scan-station-info connection-message", children: [_jsx(ScanLine, { size: 18 }), _jsxs("span", { children: [_jsx("strong", { children: "No real RFID reader is connected." }), " ", data.dataset === "demo" ? "Demonstration scans only collect draft entries. Permanent battery IDs, registration records and default service dates are created after confirmation." : "Continuous hardware intake remains unavailable. Use Register battery for working inventory."] })] }), !contextMatches && _jsx("p", { role: "alert", className: "form-error", children: "The inventory or account changed. Exit and reopen intake before processing a draft." }), data.dataset === "demo" && _jsxs("div", { className: "scan-station-toolbar detail-card asset-station-guide", children: [_jsxs("div", { children: [_jsx("strong", { children: "Set common details \u2192 Add drafts \u2192 Review \u2192 Confirm" }), _jsx("p", { className: "field-hint", children: "Registration starts only after explicit confirmation. Keep adding drafts until you choose Exit intake." })] }), _jsxs("span", { className: "asset-station-progress", children: [draft.entries.length, " pending \u00B7 ", selected.length, " selected \u00B7 ", draft.completed.length, " registered"] })] }), data.dataset !== "demo" ? _jsxs("div", { className: "intake-panel", children: [_jsx("h3", { children: "Hardware intake is not connected" }), _jsx("p", { className: "field-hint", children: "Reader, tag format and device mapping must be validated before real RFID intake is enabled." })] }) : !batch ? _jsxs("form", { className: "intake-panel", onSubmit: startBatch, children: [_jsx("h3", { children: "Common details for new draft scans" }), _jsx("p", { className: "field-hint", children: "Choose shared specifications, owner and registered storage once. Each queued entry can be corrected independently before confirmation." }), _jsx(BatteryModelPicker, { dataset: data.dataset, actorAccountId: data.user.id, canEditModels: getRolePermissions(data.user.role).editModels, values: values, selection: modelSelection, disabled: configLocked, onApply: applyModel, onManual: () => { if (!configLocked) {
                            setModelSelection(null);
                            setAppliedModel(null);
                        } }, onBusyChange: setModelBusy }, data.dataset + "/" + data.user.id), _jsx(IntakeCommonFields, { data: data, input: values, mode: firstUseMode, prefix: "intake", change: set, changeMode: setFirstUseMode, disabled: configLocked }), _jsx("div", { className: "form-footer", children: _jsx(Button, { type: "submit", disabled: configLocked, children: "Confirm common details and start scanning" }) })] }) : _jsxs(_Fragment, { children: [_jsxs("div", { className: "intake-panel intake-common-summary", children: [_jsxs("div", { className: "intake-summary-heading", children: [_jsx("h3", { children: "Common details for subsequent scans" }), _jsx(Button, { type: "button", variant: "outline", size: "sm", onClick: changeCommonDetails, disabled: queueLocked, children: "Change common details" })] }), _jsxs("dl", { children: [_jsx("dt", { children: "Battery" }), _jsxs("dd", { children: [batch.common.name, batch.common.model && " · " + batch.common.model] }), _jsx("dt", { children: "Specifications" }), _jsxs("dd", { children: [batch.common.chemistry || "Chemistry not recorded", " \u00B7 ", batch.common.capacityMah === null ? "Capacity not recorded" : batch.common.capacityMah.toLocaleString() + " mAh", " \u00B7 ", batch.common.voltage === null ? "Voltage not recorded" : batch.common.voltage + " V"] }), _jsx("dt", { children: "Responsible owner" }), _jsx("dd", { children: ownerLabel(batch.common.ownerId) }), _jsx("dt", { children: "Registered storage" }), _jsxs("dd", { children: ["J18 \u00B7 ", roomLabel(batch.common.homeRoomId)] }), _jsx("dt", { children: "Manufactured on" }), _jsx("dd", { children: batch.common.manufacturedOn || "Not recorded — manufacture age unknown" }), _jsx("dt", { children: "First use" }), _jsx("dd", { children: firstUseLabel(batch.firstUseMode, batch.common.firstUsedOn) })] })] }), _jsxs("div", { className: "intake-panel", children: [_jsx("h3", { children: "Add new battery drafts" }), _jsx("p", { className: "field-hint", children: "Each scan adds one editable draft. Nothing is registered until you choose Confirm selected or Confirm all." }), _jsxs("div", { className: "form-field", children: [_jsx(Label, { htmlFor: "intake-demo-tag", children: "Demonstration tag" }), _jsx(Input, { id: "intake-demo-tag", value: tag, onChange: event => { if (!queueLocked && !running.current && !storageBlocked.current && !editor.current && !current.current.attempt)
                                            setTag(event.target.value); }, onKeyDown: event => { if (event.key === "Enter") {
                                            event.preventDefault();
                                            queueTag(tag);
                                        } }, placeholder: "DEMO-INTAKE-\u2026", disabled: modelBusy || paused || !contextMatches || recovery.invalid, readOnly: queueLocked })] }), _jsxs("div", { className: "intake-actions", children: [_jsx(Button, { type: "button", variant: "outline", onClick: () => queueTag(tag), disabled: queueLocked || !tag.trim(), children: "Simulate this tag" }), _jsxs(Button, { type: "button", onClick: () => queueTag("DEMO-INTAKE-" + crypto.randomUUID()), disabled: queueLocked, children: [_jsx(ScanLine, { size: 16 }), "Simulate next new battery"] })] })] })] }), data.dataset === "demo" && _jsxs("div", { className: "intake-panel", children: [_jsxs("div", { className: "intake-summary-heading", children: [_jsx("h3", { children: "Draft queue" }), _jsxs("span", { className: "intake-count", children: [draft.entries.length, " pending \u00B7 ", selected.length, " selected \u00B7 ", draft.completed.length, " registered"] })] }), _jsx("p", { className: "field-hint", children: "Selected entries are confirmed individually. Verified successes leave the queue; errors and unselected drafts stay available for correction." }), _jsxs("div", { className: "intake-actions", children: [_jsxs(ReceiptAction, { type: "button", pending: busy, confirmation: registrationConfirmation, reviewKey: draft.entries.map(entry => `${entry.id}:${entry.selected}`).join("|"), actionLabel: `Confirm selected (${selected.length})`, onClick: () => confirmEntries(selected.map(entry => entry.id)), disabled: queueLocked || !selected.length, children: ["Confirm selected (", selected.length, ")"] }), _jsxs(ReceiptAction, { type: "button", variant: "outline", pending: busy, confirmation: registrationConfirmation, reviewKey: draft.entries.map(entry => entry.id).join("|"), actionLabel: `Confirm all (${draft.entries.length})`, onClick: () => confirmEntries(draft.entries.map(entry => entry.id)), disabled: queueLocked || !draft.entries.length, children: ["Confirm all (", draft.entries.length, ")"] })] }), !draft.entries.length ? _jsx("p", { className: "field-hint", children: "No pending drafts. Scan a new demonstration tag to add one." }) : _jsx("div", { className: "intake-draft-table", children: _jsxs(Table, { children: [_jsx(TableHeader, { children: _jsxs(TableRow, { children: [_jsx(TableHead, { children: _jsx(Checkbox, { "aria-label": "Select all intake drafts", checked: selected.length === draft.entries.length ? true : selected.length ? "indeterminate" : false, onCheckedChange: checked => chooseEntries(draft.entries.map(entry => entry.id), checked === true), disabled: queueLocked }) }), _jsx(TableHead, { children: "Draft battery / tag" }), _jsx(TableHead, { children: "Owner / storage" }), _jsx(TableHead, { children: "Scanned at (this device)" }), _jsx(TableHead, { children: "Status" }), _jsx(TableHead, { children: "Actions" })] }) }), _jsx(TableBody, { children: draft.entries.map(entry => _jsxs(TableRow, { className: "battery-selection-row", "data-selectable": !queueLocked, "aria-selected": entry.selected, onClick: event => { if (shouldToggleSelection(event))
                                            chooseEntries([entry.id], !entry.selected); }, "data-selected": entry.selected, "data-testid": "intake-draft-" + entry.tagId, children: [_jsx(TableCell, { children: _jsx(Checkbox, { "aria-label": "Select " + entry.tagId, checked: entry.selected, onCheckedChange: checked => chooseEntries([entry.id], checked === true), disabled: queueLocked }) }), _jsxs(TableCell, { children: [_jsx("strong", { children: entry.common.name }), _jsx("span", { className: "intake-draft-detail", children: entry.tagId }), _jsxs("span", { className: "intake-draft-detail", children: [entry.common.model || "Model not recorded", " \u00B7 ", entry.common.chemistry || "Chemistry not recorded"] }), _jsxs("span", { className: "intake-draft-detail", children: [entry.common.capacityMah === null ? "Capacity not recorded" : entry.common.capacityMah + " mAh", " \u00B7 ", entry.common.voltage === null ? "Voltage not recorded" : entry.common.voltage + " V"] })] }), _jsxs(TableCell, { children: [ownerLabel(entry.common.ownerId), _jsxs("span", { className: "intake-draft-detail", children: ["J18 \u00B7 ", roomLabel(entry.common.homeRoomId)] })] }), _jsx(TableCell, { children: entry.scannedAt ? formatTime(entry.scannedAt) : "Not recorded" }), _jsxs(TableCell, { children: [draft.attemptEntryId === entry.id ? "Confirmation unresolved" : entry.error ? "Needs correction" : "Pending confirmation", entry.error && _jsx("span", { className: "intake-draft-error", children: entry.error })] }), _jsx(TableCell, { children: _jsxs("div", { className: "intake-draft-row-actions", children: [_jsx(Button, { type: "button", variant: "outline", size: "sm", onClick: () => editEntry(entry.id), disabled: queueLocked, children: "Edit" }), _jsx(Button, { type: "button", variant: "ghost", size: "sm", onClick: () => removeEntry(entry.id), disabled: queueLocked, children: "Remove" })] }) })] }, entry.id)) })] }) }), attempt && _jsxs("div", { className: "intake-pending", children: [_jsxs("strong", { children: ["Preserved confirmation: ", attempt.payload.tagId] }), _jsx("p", { className: "field-hint", children: "The original request may already be saved. Its draft cannot be edited, removed or replaced until the exact result is resolved." }), _jsx(Button, { type: "button", variant: "outline", onClick: () => confirmEntries([], true), disabled: locked || !!storageError, children: "Retry exact confirmation" }), _jsx("p", { className: "field-hint", children: "Exit intake keeps the complete queue and this request for the same account and inventory." })] })] }), draft.completed.length > 0 && _jsxs("div", { className: "intake-panel", children: [_jsxs("div", { className: "section-heading", children: [_jsx("h3", { children: "Registered in this station" }), _jsxs("div", { className: "teaching-group-actions", children: [_jsx(Button, { type: "button", variant: "outline", disabled: locked || !completedGroupIds.length, onClick: () => setGroupEditor(completedGroupIds), children: "Add selected to teaching group" }), _jsx(Button, { type: "button", variant: "outline", disabled: locked || !visibleCompleted.length || visibleCompleted.length > 100, onClick: () => { if (!locked)
                                            setGroupEditor(visibleCompleted.map(receipt => receipt.batteryId)); }, children: completedFiltered ? "Add matching batteries to group" : "Add registered batteries to group" })] })] }), _jsx(BatteryFilterControls, { data: data, filters: completedFilters, onChange: patch => { if (!locked)
                            setCompletedFilters(previous => ({ ...previous, ...patch })); }, onClear: () => { if (!locked)
                            setCompletedFilters({ ...defaultInventoryFilter(), lifecycle: "all" }); }, disabled: locked, defaultLifecycle: "all", scopeNote: "Filter registered batteries using their current inventory details. Saved registration evidence and selected batteries are retained." }), completedMatches.error && _jsx("p", { className: "form-error", role: "alert", children: completedMatches.error }), _jsxs("p", { className: "field-hint", children: [visibleCompleted.length, " of ", draft.completed.length, " registered batteries shown \u00B7 ", completedGroupIds.length, " selected \u00B7 ", completedGroupIds.filter(id => !visibleCompleted.some(receipt => receipt.batteryId === id)).length, " selected outside these filters"] }), _jsx("div", { className: "intake-results", children: _jsxs(Table, { children: [_jsx(TableHeader, { children: _jsxs(TableRow, { children: [_jsx(TableHead, { children: "Battery ID" }), _jsx(TableHead, { children: "Tag" }), _jsx(TableHead, { children: "Scanned at (this device)" }), _jsx(TableHead, { children: "Registered at (server)" }), _jsx(TableHead, { children: "First used" }), _jsx(TableHead, { children: "Source" })] }) }), _jsx(TableBody, { children: visibleCompleted.map(receipt => _jsxs(TableRow, { className: "battery-selection-row", "data-selectable": !locked && (completedGroupIds.includes(receipt.batteryId) || completedGroupIds.length < 100), "data-selected": completedGroupIds.includes(receipt.batteryId), "aria-selected": completedGroupIds.includes(receipt.batteryId), onClick: event => { if (shouldToggleSelection(event))
                                            chooseCompleted(receipt.batteryId, !completedGroupIds.includes(receipt.batteryId)); }, children: [_jsx(TableCell, { children: _jsxs("label", { className: "group-member-selection", onClick: event => { if (hasRowTextSelection(event))
                                                        event.preventDefault(); }, children: [_jsx(Checkbox, { "aria-label": `Select registered ${receipt.batteryId} for a teaching group`, checked: completedGroupIds.includes(receipt.batteryId), disabled: locked || !completedGroupIds.includes(receipt.batteryId) && completedGroupIds.length >= 100, onCheckedChange: checked => chooseCompleted(receipt.batteryId, checked === true) }), receipt.batteryId] }) }), _jsx(TableCell, { children: receipt.tagId }), _jsx(TableCell, { children: receipt.scannedAt ? formatTime(receipt.scannedAt) : "Not recorded" }), _jsx(TableCell, { children: formatTime(receipt.registeredAt) }), _jsx(TableCell, { children: receipt.firstUsedOn || "Not recorded" }), _jsx(TableCell, { children: "Simulated intake" })] }, receipt.requestId)) })] }) })] }), notice && _jsxs("div", { role: "status", className: "intake-success", children: [_jsx(CheckCircle2, { size: 17 }), _jsx("span", { children: notice })] }), error && _jsx("p", { role: "alert", className: "form-error", children: error }), storageError && _jsxs("div", { role: "alert", className: "form-error", children: [_jsx("p", { children: storageError }), storageCandidate && _jsx(Button, { type: "button", variant: "outline", size: "sm", onClick: restoreRecovery, disabled: locked, children: "Restore draft recovery" })] }), editing && _jsx(Dialog, { open: true, onOpenChange: open => !open && closeEdit(), children: _jsxs(DialogContent, { className: "record-dialog", children: [_jsxs(DialogHeader, { children: [_jsx(DialogTitle, { children: "Edit pending intake" }), _jsx(DialogDescription, { children: "Correct this draft before confirmation. The device scan time is retained; no permanent battery ID has been assigned." })] }), _jsxs("form", { onSubmit: saveEdit, children: [_jsx(IntakeField, { input: editing.values, keyName: "tagId", label: "Demonstration tag", prefix: "intake-edit", change: changeEdit, disabled: locked || !!storageError, type: "text", required: true }), _jsx(IntakeCommonFields, { data: data, input: editing.values, mode: editing.firstUseMode, prefix: "intake-edit", change: changeEdit, changeMode: mode => { if (!locked && !storageBlocked.current && editor.current) {
                                        editor.current = { ...editor.current, firstUseMode: mode };
                                        setEditing(editor.current);
                                    } }, disabled: locked || !!storageError }), editing.modelSelection && _jsxs("div", { className: "field-hint", children: [_jsx("p", { children: "Reviewed model suggestions are retained for unchanged fields. Different battery values remain explicit overrides." }), _jsx(Button, { type: "button", variant: "ghost", size: "sm", onClick: () => { if (!locked && !storageBlocked.current && editor.current) {
                                                editor.current = { ...editor.current, modelSelection: null };
                                                setEditing(editor.current);
                                            } }, disabled: locked || !!storageError, children: "Use manual model details" })] }), editError && _jsx("p", { role: "alert", className: "form-error", children: editError }), _jsxs(DialogFooter, { className: "form-footer", children: [_jsx(Button, { type: "button", variant: "outline", onClick: closeEdit, disabled: locked || !!storageError, children: "Cancel" }), _jsx(Button, { type: "submit", disabled: locked || !!storageError, children: "Save draft changes" })] })] })] }) }), groupEditor && _jsx(TeachingGroupsPanel, { data: data, initialIds: groupEditor, addToExisting: true, onClose: () => setGroupEditor(null), onChanged: async () => { await onRegistered?.(); }, onSaved: () => setGroupEditor(null), onFilter: () => { }, onSelect: () => { } })] });
}

export function IntakeStation(props) { return _jsx(WorkflowBoundary, {children:_jsx(SharedIntakeStation, {...props})}); }
