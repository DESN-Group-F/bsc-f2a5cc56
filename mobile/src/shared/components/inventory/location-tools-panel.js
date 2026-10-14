"use client";
import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useCallback, useEffect, useRef, useState } from "react";
import { BluetoothOff, FlaskConical, MapPin, Pencil, RefreshCw } from "lucide-react";
import { Button } from "../ui/button.js";
import { Input } from "../ui/input.js";
import { Label } from "../ui/label.js";
import { LoadingState } from "../ui/loading-state.js";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../ui/dialog.js";
import { RecordPicker } from "./record-picker.js";
import { useLocationRecovery } from "../../hooks/use-location-recovery.js";
import { isActiveBattery } from "../../lib/battery-lifecycle.js";
import { formatTime, saveDownloadAttachment } from "../../lib/client-utils.js";
import { inventoryResponse } from "../../lib/client/inventory-request.js";
import { captureLocationAttempt, acknowledgeLocationAttempt, locationFailureStatus, locationRequestStorageKey, persistLocationAttempt, verifyLocationReceipt } from "../../lib/client/location-request.js";
import { roomPickerOptions, SUPPORTED_BUILDING_ID } from "../../lib/location-catalog.js";
import { locationBeaconRequestSchema, locationCaptureSchema } from "../../lib/location-observations.js";
import styles from "./location-tools-panel.module.css";
const emptyForm = () => ({ editing: null, label: "", identifier: "", room: null, active: true });
function messageOf(error) { return error instanceof Error ? error.message : "The location request could not be confirmed."; }
function announceRecovery() { window.dispatchEvent(new Event("battery-location-recovery")); }
export function LocationToolsPanel({ data, ready, onChanged, onClose }) {
    const [context] = useState({ actorAccountId: data.user.id, dataset: data.dataset });
    const [directory, setDirectory] = useState(null);
    const [loading, setLoading] = useState(true), [directoryError, setDirectoryError] = useState("");
    const [inMemoryAttempt, setAttempt] = useState(null);
    const { recovery, read: readSavedRecovery } = useLocationRecovery(context.actorAccountId);
    const persistedAttempt = recovery.attempts.find(value => value.dataset === context.dataset) ?? null;
    const attempt = inMemoryAttempt ?? persistedAttempt;
    const attemptRef = useRef(null), busyRef = useRef(false), mounted = useRef(true);
    const directoryController = useRef(null), directorySequence = useRef(0);
    const [busy, setBusy] = useState(false), [localStorageError, setStorageError] = useState("");
    const storageConflict = inMemoryAttempt && persistedAttempt && JSON.stringify(inMemoryAttempt.payload) !== JSON.stringify(persistedAttempt.payload) ? "A different original request is retained in this browser. Export the recovery record for review; no new request will be sent." : "";
    const storageError = localStorageError || recovery.error || storageConflict;
    const [error, setError] = useState(""), [receipt, setReceipt] = useState(null), [refreshNeeded, setRefreshNeeded] = useState(false);
    const [form, setForm] = useState(emptyForm);
    const [battery, setBattery] = useState(null), [selectedBeacons, setSelectedBeacons] = useState([]);
    const contextChanged = context.actorAccountId !== data.user.id || context.dataset !== data.dataset;
    const admin = data.user.role === "admin", canManage = admin && directory?.capabilities.manageBeacons === true;
    const canSimulate = admin && context.dataset === "demo" && directory?.capabilities.demoSimulation === true;
    const blocked = busy || loading || !!directoryError || !!attempt || !directory || !!storageError || !ready || contextChanged || refreshNeeded;
    const exitBlocked = busy || !!attempt || !!storageError;
    const storageKey = locationRequestStorageKey(context.actorAccountId, context.dataset);
    const remember = useCallback((value) => { attemptRef.current = value; setAttempt(value); }, []);
    const stopDirectory = useCallback(() => { directorySequence.current++; directoryController.current?.abort(); }, []);
    function readRecovery() {
        try {
            const latest = readSavedRecovery();
            if (latest.error)
                throw new Error(latest.error);
            const saved = latest.attempts.find(value => value.dataset === context.dataset) ?? null;
            const current = attemptRef.current;
            if (current && saved && JSON.stringify(current.payload) !== JSON.stringify(saved.payload))
                throw new Error("A different original request is retained in this browser. Export the recovery record for review; no new request will be sent.");
            setStorageError("");
            announceRecovery();
        }
        catch (failure) {
            setStorageError(messageOf(failure));
        }
    }
    const loadDirectory = useCallback(async () => {
        if (!mounted.current)
            return;
        const sequence = ++directorySequence.current;
        directoryController.current?.abort();
        const controller = new AbortController();
        directoryController.current = controller;
        let timedOut = false;
        const timer = window.setTimeout(() => { timedOut = true; controller.abort(); }, 30_000);
        setLoading(true);
        setDirectoryError("");
        try {
            const result = await inventoryResponse(await fetch(`/api/locations?dataset=${context.dataset}`, { cache: "no-store", signal: controller.signal }));
            if (result.dataset !== context.dataset || !Array.isArray(result.beacons) || result.capabilities?.hardwareIngestion !== false)
                throw new Error("The room beacon directory returned an unexpected capability or inventory. Refresh before continuing.");
            if (controller.signal.aborted)
                throw new Error("The room beacon request was interrupted.");
            if (mounted.current && sequence === directorySequence.current) {
                setDirectory(result);
                setDirectoryError("");
            }
        }
        catch (failure) {
            if (!mounted.current || sequence !== directorySequence.current || controller.signal.aborted && !timedOut)
                return;
            const message = timedOut ? "The room beacon directory is taking too long to respond. Check your connection, then refresh the directory." : failure instanceof TypeError || failure instanceof SyntaxError ? "The room beacon directory could not be reached. Check your connection, then refresh the directory." : messageOf(failure);
            setDirectoryError(message);
            throw new Error(message);
        }
        finally {
            window.clearTimeout(timer);
            if (mounted.current && sequence === directorySequence.current)
                setLoading(false);
        }
    }, [context.dataset]);
    useEffect(() => {
        mounted.current = true;
        let active = true;
        void Promise.resolve().then(() => { if (active)
            return loadDirectory(); }).catch(() => { });
        return () => { active = false; mounted.current = false; stopDirectory(); };
    }, [loadDirectory, stopDirectory]);
    useEffect(() => {
        if (!exitBlocked)
            return;
        const warn = (event) => { event.preventDefault(); event.returnValue = ""; };
        window.addEventListener("beforeunload", warn);
        return () => window.removeEventListener("beforeunload", warn);
    }, [exitBlocked]);
    async function refresh() {
        if (busyRef.current || contextChanged)
            return;
        busyRef.current = true;
        setBusy(true);
        setLoading(true);
        setError("");
        try {
            await Promise.all([loadDirectory(), onChanged()]);
            setRefreshNeeded(false);
        }
        catch (failure) {
            setError(`Refresh could not complete. ${messageOf(failure)}`);
            setRefreshNeeded(true);
        }
        finally {
            busyRef.current = false;
            setBusy(false);
        }
    }
    async function submit(original) {
        if (busyRef.current || contextChanged || original.actorAccountId !== data.user.id || original.dataset !== data.dataset)
            return;
        if (!window.__batteryLocationLocks) {
            setError("This browser cannot safely retain location requests across tabs. Open the inventory in a browser that supports secure request recovery.");
            return;
        }
        busyRef.current = true;
        setBusy(true);
        setError("");
        setReceipt(null);
        try {
            await window.__batteryLocationLocks.request(storageKey, { ifAvailable: true }, async (lock) => {
                if (!lock) {
                    setError("Another tab is resolving a location request. Finish it there, then check recovery before trying again.");
                    return;
                }
                const sending = { ...original, status: "submitted", message: "Waiting for the server to confirm this exact request." };
                remember(sending);
                let sent = false;
                try {
                    persistLocationAttempt(sending);
                    setStorageError("");
                    announceRecovery();
                    let body;
                    if (sending.kind === "beacon") {
                        const { action, ...payload } = sending.payload;
                        sent = true;
                        body = await inventoryResponse(await fetch("/api/locations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dataset: sending.dataset, action, payload }) }));
                    }
                    else {
                        sent = true;
                        body = await inventoryResponse(await fetch("/api/location-observations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dataset: sending.dataset, payload: sending.payload }) }));
                    }
                    const confirmed = verifyLocationReceipt(body.result, sending);
                    await acknowledgeLocationAttempt(sending);
                    remember(null);
                    announceRecovery();
                    setReceipt(confirmed);
                    if (sending.kind === "beacon")
                        setForm(emptyForm());
                    else {
                        setBattery(null);
                        setSelectedBeacons([]);
                    }
                    try {
                        await Promise.all([loadDirectory(), onChanged()]);
                        setRefreshNeeded(false);
                    }
                    catch {
                        setRefreshNeeded(true);
                        setError("The server confirmed this result, but the inventory could not refresh. Refresh before another change.");
                    }
                }
                catch (failure) {
                    const failed = { ...sending, status: sent ? locationFailureStatus(failure) : "uncertain", message: sent ? messageOf(failure) : `Nothing was sent. ${messageOf(failure)}` };
                    remember(failed);
                    try {
                        persistLocationAttempt(failed);
                        announceRecovery();
                    }
                    catch (storageFailure) {
                        setStorageError(messageOf(storageFailure));
                    }
                    setError(failed.message);
                }
            });
        }
        catch (failure) {
            setError(messageOf(failure));
        }
        finally {
            busyRef.current = false;
            setBusy(false);
        }
    }
    function saveBeacon(event) {
        event.preventDefault();
        if (blocked || !canManage)
            return;
        try {
            if (!form.room || !roomOptions.some(room => room.id === form.room?.roomId))
                throw new Error(context.dataset === "live" ? "Choose an existing verified, selectable J18 room." : "Choose an existing selectable J18 room.");
            const fields = { requestId: crypto.randomUUID(), id: form.editing?.id ?? `BEACON-${crypto.randomUUID()}`, label: form.label, identifier: form.identifier, ...form.room, active: form.active };
            const payload = locationBeaconRequestSchema.parse(form.editing ? { ...fields, action: "update", expectedVersion: form.editing.version } : { ...fields, action: "create" });
            void submit(captureLocationAttempt(context.actorAccountId, context.dataset, { kind: "beacon", payload }));
        }
        catch (failure) {
            setError(messageOf(failure));
        }
    }
    function simulate(event) {
        event.preventDefault();
        if (blocked || !canSimulate)
            return;
        try {
            if (!battery?.tagId || !isActiveBattery(battery))
                throw new Error("Choose an active battery with a registered tag.");
            const capturedAt = new Date().toISOString();
            const payload = locationCaptureSchema.parse({ requestId: crypto.randomUUID(), source: "demo_room_scan", batteryId: battery.id, tagId: battery.tagId, expectedBatteryVersion: battery.version, capturedAt, candidates: selectedBeacons.map(beacon => ({ beaconId: beacon.id, version: beacon.version, detectedAt: capturedAt })) });
            void submit(captureLocationAttempt(context.actorAccountId, context.dataset, { kind: "capture", payload }));
        }
        catch (failure) {
            setError(messageOf(failure));
        }
    }
    async function dismissRejected() {
        if (busyRef.current || attempt?.status !== "rejected")
            return;
        try {
            await acknowledgeLocationAttempt(attempt);
            remember(null);
            setStorageError("");
            setError("");
            announceRecovery();
            void refresh();
        }
        catch (failure) {
            setStorageError(messageOf(failure));
        }
    }
    function exportRecovery() {
        try {
            const raw = window.__batteryWorkflowStorage.getItem(storageKey);
            if (!raw && !attempt)
                throw new Error("There is no saved location request to export.");
            saveDownloadAttachment({ blob: new Blob([raw ?? JSON.stringify(attempt, null, 2)], { type: "application/json" }), filename: `location-recovery-${context.dataset}.json` });
        }
        catch (failure) {
            setError(messageOf(failure));
        }
    }
    const roomOptions = roomPickerOptions(data.rooms.filter(room => context.dataset === "demo" || !room.isPlaceholder), SUPPORTED_BUILDING_ID);
    const activeBeacons = directory?.beacons.filter(beacon => beacon.active && beacon.roomSelectable) ?? [];
    const staleBeacons = selectedBeacons.filter(selected => !activeBeacons.some(current => current.id === selected.id && current.version === selected.version && current.roomId === selected.roomId));
    const visibleBeacons = [...activeBeacons, ...selectedBeacons.filter(selected => !activeBeacons.some(current => current.id === selected.id))];
    const roomCount = new Set(selectedBeacons.map(beacon => beacon.roomId)).size;
    const prediction = !selectedBeacons.length ? "Unresolved: no room evidence. No Last observed location will be recorded." : roomCount > 1 ? "Ambiguous: selected beacons span rooms. No Last observed location will be recorded." : `Room evidence: ${selectedBeacons[0].roomName}. The server validates the captured versions before recording.`;
    const exitReason = busy ? "Waiting for the request or refresh to finish." : attempt ? "Resolve the original request before leaving. Its exact payload is retained in this browser." : storageError ? "Resolve recovery storage before leaving. The saved record has not been discarded." : "";
    return _jsx(Dialog, { open: true, onOpenChange: open => { if (!open && !exitBlocked)
            onClose(); }, children: _jsxs(DialogContent, { className: styles.dialog, showCloseButton: false, onEscapeKeyDown: event => { if (exitBlocked)
                event.preventDefault(); }, onInteractOutside: event => event.preventDefault(), children: [_jsxs("header", { className: styles.header, children: [_jsxs("div", { children: [_jsx(DialogTitle, { children: "Room beacons & location tests" }), _jsxs(DialogDescription, { children: ["Configure room evidence for Last observed location. ", context.dataset === "demo" ? "Demonstration inventory" : "Working inventory", "."] })] }), _jsx(Button, { variant: "outline", onClick: onClose, disabled: exitBlocked, children: "Close" })] }), _jsxs("div", { className: styles.body, children: [_jsxs("section", { className: styles.capabilities, "aria-label": "Location capabilities", children: [_jsx(BluetoothOff, { size: 22, "aria-hidden": "true" }), _jsxs("div", { children: [_jsx("h2", { children: "Hardware ingestion disabled" }), _jsx("p", { children: "Room beacons and phone Bluetooth scanning are planned and not installed or validated. This panel does not connect to hardware." }), _jsxs("dl", { className: styles.capabilityList, children: [_jsxs("div", { children: [_jsx("dt", { children: "Hardware" }), _jsx("dd", { children: "Disabled" })] }), _jsxs("div", { children: [_jsx("dt", { children: "Beacon configuration" }), _jsx("dd", { children: directory ? directory.capabilities.manageBeacons ? "Administrator access" : "Read only" : "Awaiting server" })] }), _jsxs("div", { children: [_jsx("dt", { children: "Demo simulator" }), _jsx("dd", { children: directory ? directory.capabilities.demoSimulation ? "Available" : "Unavailable" : "Awaiting server" })] })] })] })] }), contextChanged && _jsx("p", { className: styles.error, role: "alert", children: "The account or inventory changed. This panel retains the original context; close it before continuing." }), error && _jsx("p", { className: styles.error, role: "alert", children: error }), storageError && _jsxs("section", { className: styles.recovery, "aria-label": "Recovery storage issue", children: [_jsx("h2", { children: "Recovery needs attention" }), _jsx("p", { role: "alert", children: storageError }), _jsxs("div", { className: styles.actions, children: [_jsx(Button, { variant: "outline", onClick: exportRecovery, disabled: busy, children: "Export recovery record" }), _jsx(Button, { variant: "outline", onClick: readRecovery, disabled: busy, children: "Check recovery storage" })] })] }), attempt && _jsxs("section", { className: styles.recovery, "aria-label": "Original location request", children: [_jsx("h2", { children: attempt.status === "rejected" ? "Request rejected by the server" : "Original request retained" }), _jsx("p", { children: attempt.message }), _jsxs("dl", { className: styles.facts, children: [_jsx("dt", { children: "Request" }), _jsx("dd", { className: styles.identifier, children: attempt.payload.requestId }), _jsx("dt", { children: "Operation" }), _jsx("dd", { children: attempt.kind === "beacon" ? `${attempt.payload.action === "create" ? "Create" : "Update"} beacon mapping: ${attempt.payload.label}` : `One simulated scan: ${attempt.payload.batteryId}` }), _jsx("dt", { children: "Inventory" }), _jsx("dd", { children: attempt.dataset === "demo" ? "Demonstration inventory" : "Working inventory" })] }), _jsxs("details", { children: [_jsx("summary", { children: "Captured request details" }), _jsx("pre", { children: JSON.stringify(attempt.payload, null, 2) })] }), _jsxs("div", { className: styles.actions, children: [attempt.status === "rejected" ? _jsx(Button, { variant: "outline", disabled: busy, onClick: dismissRejected, children: "Acknowledge rejection" }) : _jsx(Button, { disabled: busy || contextChanged, onClick: () => void submit(attempt), children: "Retry the same request" }), _jsx(Button, { variant: "outline", onClick: exportRecovery, disabled: busy, children: "Export recovery record" })] }), _jsx("p", { className: styles.hint, children: attempt.status === "rejected" ? "The server reserved this rejection. A later retry cannot apply the rejected operation." : "Retry preserves the original battery, tag, versions, evidence time and request ID. No new scan is captured." })] }), receipt && _jsxs("section", { className: styles.result, "aria-label": "Confirmed location result", role: "status", children: [_jsx("h2", { children: "beacon" in receipt ? "Beacon mapping saved" : receipt.outcome === "recorded" ? "Last observed location recorded" : receipt.outcome === "ambiguous" ? "Ambiguous room evidence" : "Room evidence unresolved" }), "beacon" in receipt ? _jsxs("p", { children: [receipt.beacon.label, " \u2192 ", receipt.beacon.roomName, ". This mapping is configuration only; hardware remains disabled."] }) : _jsxs(_Fragment, { children: [_jsx("p", { children: receipt.outcome === "recorded" ? `${receipt.batteryId}: ${receipt.room?.buildingId} ${receipt.room?.buildingName} / ${receipt.room?.name}.` : "No Last observed location was recorded. The test outcome was retained in the audit history." }), _jsxs("dl", { className: styles.facts, children: [_jsx("dt", { children: "Source" }), _jsx("dd", { children: receipt.source }), _jsx("dt", { children: "Device capture time" }), _jsx("dd", { children: formatTime(receipt.capturedAt) }), _jsx("dt", { children: "Server received" }), _jsx("dd", { children: formatTime(receipt.receivedAt) })] })] }), _jsxs("p", { className: styles.hint, children: ["Server-confirmed", receipt.replayed ? " original request (recovered receipt)" : " result", ". Request ", receipt.requestId, "."] })] }), refreshNeeded && _jsxs(Button, { variant: "outline", onClick: () => void refresh(), disabled: busy || contextChanged, children: [_jsx(RefreshCw, { size: 16 }), "Refresh inventory"] }), _jsxs("section", { className: styles.section, "aria-labelledby": "beacon-directory-heading", children: [_jsxs("div", { className: styles.sectionHeading, children: [_jsxs("div", { children: [_jsxs("h2", { id: "beacon-directory-heading", children: [_jsx(MapPin, { size: 18, "aria-hidden": "true" }), "Room beacon directory"] }), _jsx("p", { children: "Mappings use existing selectable J18 rooms. Placeholder rooms remain labelled." })] }), _jsxs(Button, { variant: "outline", size: "sm", disabled: busy || loading || contextChanged, onClick: () => void loadDirectory().catch(() => { }), children: [_jsx(RefreshCw, { size: 15 }), "Refresh directory"] })] }), loading && _jsx(LoadingState, { compact: true, label: directory ? "Refreshing room beacons" : "Loading room beacons", detail: directory ? "Your last received directory remains visible while it updates." : "Retrieving room mappings and server capabilities." }), directoryError && _jsx("p", { className: styles.error, role: "alert", children: directoryError }), directory && !directory.beacons.length && _jsx("p", { className: styles.empty, children: "No room beacons configured." }), !!directory?.beacons.length && _jsx("div", { className: styles.tableWrap, children: _jsxs("table", { className: styles.table, children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "Beacon" }), _jsx("th", { children: "Mapped room" }), _jsx("th", { children: "State" }), canManage && _jsx("th", { children: _jsx("span", { className: "sr-only", children: "Actions" }) })] }) }), _jsx("tbody", { children: directory.beacons.map(beacon => _jsxs("tr", { children: [_jsxs("td", { children: [_jsx("strong", { children: beacon.label }), _jsx("span", { className: styles.identifier, children: beacon.identifier }), _jsxs("small", { children: [beacon.id, " \u00B7 Version ", beacon.version] })] }), _jsxs("td", { children: [beacon.buildingId, " ", beacon.buildingName, _jsx("span", { children: beacon.roomName })] }), _jsxs("td", { children: [beacon.active ? "Configured" : "Inactive", _jsx("small", { children: "Hardware unvalidated" })] }), canManage && _jsx("td", { children: _jsxs(Button, { variant: "ghost", size: "sm", disabled: blocked, onClick: () => { setError(""); setForm({ editing: beacon, label: beacon.label, identifier: beacon.identifier, active: beacon.active, room: { roomId: beacon.roomId, roomVersion: beacon.roomVersion, buildingVersion: beacon.buildingVersion } }); }, children: [_jsx(Pencil, { size: 14 }), "Edit"] }) })] }, beacon.id)) })] }) }), !admin && _jsx("p", { className: styles.hint, children: "Staff can view the directory. Administrators manage mappings and demonstration tests." })] }), canManage && _jsxs("section", { className: styles.section, "aria-labelledby": "beacon-config-heading", children: [_jsx("h2", { id: "beacon-config-heading", children: form.editing ? `Edit ${form.editing.label}` : "Configure a room beacon" }), _jsx("p", { className: styles.hint, children: "Set a beacon identifier and its room once. Reconfigure only when its assignment changes." }), _jsxs("form", { className: styles.form, onSubmit: saveBeacon, children: [_jsxs("div", { className: styles.formGrid, children: [_jsxs("div", { children: [_jsx(Label, { htmlFor: "beacon-label", children: "Beacon label" }), _jsx(Input, { id: "beacon-label", value: form.label, onChange: event => setForm({ ...form, label: event.target.value }), maxLength: 120, required: true, disabled: blocked })] }), _jsxs("div", { children: [_jsx(Label, { htmlFor: "beacon-identifier", children: "Beacon identifier" }), _jsx(Input, { id: "beacon-identifier", value: form.identifier, onChange: event => setForm({ ...form, identifier: event.target.value }), maxLength: 128, required: true, disabled: blocked })] })] }), _jsxs("div", { children: [_jsx(Label, { htmlFor: "beacon-room", children: context.dataset === "live" ? "Existing verified J18 room" : "Existing J18 room" }), _jsx(RecordPicker, { id: "beacon-room", options: roomOptions, value: form.room?.roomId ?? "", placeholder: "Choose a room", disabled: blocked || !roomOptions.length, onChange: roomId => { const room = data.rooms.find(item => item.id === roomId), building = data.buildings.find(item => item.id === room?.buildingId); setForm({ ...form, room: room && building ? { roomId, roomVersion: room.version, buildingVersion: building.version } : null }); } }), context.dataset === "live" && !roomOptions.length && _jsx("p", { className: styles.hint, children: "No verified selectable J18 rooms are available. Configure a verified room in the room directory before saving a working-inventory beacon." })] }), _jsxs("label", { className: styles.checkbox, children: [_jsx("input", { type: "checkbox", checked: form.active, onChange: event => setForm({ ...form, active: event.target.checked }), disabled: blocked }), "Mapping active"] }), _jsxs("div", { className: styles.actions, children: [_jsx(Button, { type: "submit", disabled: blocked || !roomOptions.some(room => room.id === form.room?.roomId), children: form.editing ? "Save mapping changes" : "Save beacon mapping" }), form.editing && _jsx(Button, { type: "button", variant: "outline", disabled: blocked, onClick: () => setForm(emptyForm()), children: "Cancel edit" })] })] })] }), canSimulate && _jsxs("section", { className: styles.section, "aria-labelledby": "location-simulator-heading", children: [_jsxs("h2", { id: "location-simulator-heading", children: [_jsx(FlaskConical, { size: 19, "aria-hidden": "true" }), "Simulate one battery scan"] }), _jsx("p", { className: styles.hint, children: "Demonstration only. Choose the battery and room evidence, then submit one dated event. This does not change a checkout, responsible owner or registered storage." }), _jsxs("form", { onSubmit: simulate, className: styles.form, children: [_jsxs("div", { children: [_jsx(Label, { htmlFor: "location-test-battery", children: "Battery with a registered tag" }), _jsx(RecordPicker, { id: "location-test-battery", options: data.batteries.filter(item => isActiveBattery(item) && item.tagId).map(item => ({ id: item.id, label: `${item.id} — ${item.name}` })), value: battery?.id ?? "", placeholder: "Choose one battery", disabled: blocked, onChange: id => setBattery(data.batteries.find(item => item.id === id) ?? null) })] }), battery && _jsxs("p", { className: styles.hint, children: ["Captured selection: ", battery.id, " \u00B7 Tag ", battery.tagId, " \u00B7 Version ", battery.version] }), _jsxs("fieldset", { disabled: blocked, className: styles.beaconChoices, children: [_jsx("legend", { children: "Room beacons detected in this simulated event" }), visibleBeacons.map(current => {
                                                    const selected = selectedBeacons.find(item => item.id === current.id), beacon = selected ?? current, stale = staleBeacons.some(item => item.id === beacon.id);
                                                    return _jsxs("label", { className: styles.checkbox, children: [_jsx("input", { type: "checkbox", checked: !!selected, disabled: !selected && selectedBeacons.length >= 16, onChange: event => setSelectedBeacons(previous => event.target.checked ? [...previous, current] : previous.filter(item => item.id !== beacon.id)) }), _jsxs("span", { children: [_jsx("strong", { children: beacon.label }), " \u2014 ", beacon.roomName, _jsxs("small", { children: ["Version ", beacon.version, stale ? " · Directory changed; remove and choose again." : ""] })] })] }, beacon.id);
                                                }), !visibleBeacons.length && _jsx("p", { children: "No active room beacons are configured." }), _jsx(Button, { type: "button", variant: "outline", size: "sm", disabled: blocked || !selectedBeacons.length, onClick: () => setSelectedBeacons([]), children: "Use no room evidence" })] }), _jsxs("div", { className: styles.preview, children: [_jsx("strong", { children: !selectedBeacons.length ? "Unknown room" : roomCount > 1 ? "Multiple rooms" : "One room" }), _jsx("p", { children: prediction }), _jsx("p", { className: styles.hint, children: "Device capture time is set when submitted. Up to 16 beacon candidates are permitted; no signal strength is invented." })] }), _jsx(Button, { type: "submit", disabled: blocked || !battery || !!staleBeacons.length, children: "Submit one simulated scan" })] })] })] }), _jsxs("footer", { className: styles.footer, children: [_jsx("p", { children: exitReason || "Last observed location is dated evidence, not a live position." }), _jsx(Button, { variant: "outline", disabled: exitBlocked, onClick: onClose, children: "Close location tools" })] })] }) });
}
