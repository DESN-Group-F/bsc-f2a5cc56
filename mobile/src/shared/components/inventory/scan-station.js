import { WorkflowBoundary } from "../../../business/workflow-boundary.jsx";
import { NfcReadButton } from "../../../business/nfc-read.jsx";
"use client";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { isActiveBattery } from "../../lib/battery-lifecycle.js";
import { useEffect, useRef, useState } from "react";
import { CheckCircle2, LogOut, Radio, RefreshCw, ScanLine, Trash2 } from "lucide-react";
import { Button } from "../ui/button.js";
import { Input } from "../ui/input.js";
import { Label } from "../ui/label.js";
import { Checkbox } from "../ui/checkbox.js";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select.js";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table.js";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../ui/dialog.js";
import { formatTime, roomLabel } from "../../lib/client-utils.js";
import { isSelectableRoom } from "../../lib/location-catalog.js";
import { recoverScanSession, resolveRegisteredTagIssues, scanCompletedReadMatches, scanFailureStatus, scanMovementPayload, scanReadProblem } from "../../lib/scan-session.js";
import { TeachingGroupsPanel } from "./teaching-groups-panel.js";
import { verifyGroupEvidence } from "../../lib/teaching-context.js";
import { BatteryFilterControls } from "./battery-filter-controls.js";
import { defaultInventoryFilter } from "../../lib/inventory-query.js";
import { getFilteredBatteries, hasBatterySelectionCriteria } from "../../lib/battery-selection-query.js";
import { hasRowTextSelection, shouldToggleSelection } from "../../lib/client/row-selection.js";
function freshSession() {
    return { sessionId: crypto.randomUUID(), mode: "batch", room: null, queue: [], completed: [], issues: [], attempt: null };
}
function sessionStorageKey(data, kind) {
    return `battery-scan:${data.user.id}:${data.dataset}:${kind}`;
}
function loadSession(key, kind) {
    try {
        return typeof window === "undefined" ? freshSession() : recoverScanSession(window.__batteryWorkflowStorage.getItem(key), kind) ?? freshSession();
    }
    catch {
        return freshSession();
    }
}
function errorMessage(error) { return error instanceof Error ? error.message : "The operation could not be completed."; }
function sourceLabel(source) { return source === "selection" ? "Manual selection" : source === "simulated" ? "Simulated reader" : "Manual tag input"; }
function SharedScanStation({ data, kind, write, onExit, onRegister, onChanged, paused = false }) {
    const storageKey = sessionStorageKey(data, kind);
    const [session, setSession] = useState(() => loadSession(storageKey, kind));
    const current = useRef(session), running = useRef(false), tagInput = useRef(null);
    const [busy, setBusy] = useState(false), [tag, setTag] = useState(""), [notice, setNotice] = useState(""), [storageError, setStorageError] = useState("");
    const [selectedIds, setSelectedIds] = useState([]), [selectionFilters, setSelectionFilters] = useState(() => defaultInventoryFilter());
    const [completedFilters, setCompletedFilters] = useState(() => ({ ...defaultInventoryFilter(), lifecycle: "all" }));
    const [groupEditor, setGroupEditor] = useState(null), [completedGroupIds, setCompletedGroupIds] = useState([]);
    const scanGroup = data.teachingGroups?.find(group => group.id === session.teachingGroup?.id && group.version === session.teachingGroup.version);
    const [confirmedSelectionSnapshots, setConfirmedSelectionSnapshots] = useState(() => new Map());
    const [confirmation, setConfirmation] = useState(null), [latest, setLatest] = useState(null), [toast, setToast] = useState("");
    const [reviewedRooms, setReviewedRooms] = useState(null);
    const checkout = kind === "checkout", roomLocked = busy || paused || !!session.attempt;
    const roomConfirmationRequired = !checkout && !!session.roomConfirmationRequired;
    const locked = roomLocked || roomConfirmationRequired || !!groupEditor;
    const rooms = (reviewedRooms ?? data.rooms).filter(isSelectableRoom), unresolvedIssues = session.issues.filter(issue => !issue.acknowledged);
    const recovering = !!session.attempt || !!session.queue.length;
    function change(update) {
        const next = update(current.current);
        current.current = next;
        try {
            window.__batteryWorkflowStorage.setItem(storageKey, JSON.stringify(next));
        }
        catch {
            setStorageError("Local reload recovery is unavailable in this browser. Keep this page open until every pending request has been resolved.");
        }
        setSession(next);
    }
    function addIssue(category, tagId, message, acknowledged = false) {
        change(previous => ({ ...previous, issues: [...previous.issues, { id: crypto.randomUUID(), category, tagId, message, acknowledged }] }));
    }
    function startWork() {
        if (running.current || paused)
            return false;
        running.current = true;
        setBusy(true);
        setNotice("");
        return true;
    }
    function finishWork() { running.current = false; setBusy(false); }
    useEffect(() => {
        if (!busy && !paused && !session.attempt)
            tagInput.current?.focus();
    }, [busy, paused, session.attempt]);
    useEffect(() => {
        if (!busy && !session.queue.length && !session.attempt)
            return;
        const protect = (event) => { event.preventDefault(); event.returnValue = ""; };
        window.addEventListener("beforeunload", protect);
        return () => window.removeEventListener("beforeunload", protect);
    }, [busy, session.queue.length, session.attempt]);
    useEffect(() => {
        if (!toast)
            return;
        const timer = setTimeout(() => setToast(""), 5500);
        return () => clearTimeout(timer);
    }, [toast]);
    async function runAttempt(attempt) {
        change(previous => ({ ...previous, attempt: { ...attempt, status: "uncertain", message: "Waiting for the server to confirm this exact request." } }));
        try {
            const result = await write("movement", attempt.payload);
            if (!result || result.kind !== kind || result.requestId !== attempt.payload.requestId || !Array.isArray(result.batteryIds)
                || result.batteryIds.length !== attempt.reads.length || result.count !== attempt.reads.length || attempt.reads.some(read => !result.batteryIds.includes(read.battery.id)) || typeof result.at !== "string" || !Number.isFinite(Date.parse(result.at))) {
                throw new Error("The movement response could not be verified. Its result is uncertain; retry the same captured request.");
            }
            verifyGroupEvidence(result.teachingGroup, attempt.payload.teachingGroup, attempt.payload.requestId, attempt.payload.batteryIds, data.user.id);
            const ids = new Set(attempt.reads.map(read => read.battery.id));
            setConfirmedSelectionSnapshots(previous => {
                const next = new Map(previous);
                for (const id of ids) {
                    const snapshot = data.batteries.find(battery => battery.id === id);
                    if (snapshot)
                        next.set(id, snapshot);
                }
                return next;
            });
            setSelectedIds(previous => previous.filter(id => !ids.has(id)));
            change(previous => ({ ...previous, queue: previous.queue.filter(read => !ids.has(read.battery.id)), completed: [...previous.completed, ...attempt.reads.filter(read => !previous.completed.some(saved => saved.battery.id === read.battery.id && saved.receipt.requestId === result.requestId)).map(read => ({ ...read, receipt: result }))], attempt: null,
                issues: previous.issues.map(issue => issue.id === attempt.payload.requestId ? { ...issue, acknowledged: true } : issue) }));
            setLatest(null);
            setToast(`${result.count === 1 ? result.batteryIds[0] : `${result.count} batteries`} ${checkout ? "checked out" : "returned"}${result.replayed ? " · original request confirmed" : ""}. Ready for the next read.`);
            return true;
        }
        catch (error) {
            const status = scanFailureStatus(error, attempt.status === "uncertain"), statusCode = error?.status;
            const message = status === "uncertain" ? `Result uncertain. ${errorMessage(error)} Retry the original request before scanning or exiting.` : errorMessage(error);
            change(previous => ({ ...previous, attempt: { ...attempt, status, statusCode, message }, issues: status === "rejected" && !previous.issues.some(issue => issue.id === attempt.payload.requestId)
                    ? [...previous.issues, { id: attempt.payload.requestId, category: "state", tagId: attempt.reads.map(read => read.tagId || read.battery.id).join(", "), message, acknowledged: false }] : previous.issues }));
            setLatest(null);
            return false;
        }
    }
    async function processQueue() {
        if (current.current.roomConfirmationRequired) {
            setNotice("Confirm the return room or explicitly choose Room unspecified before processing more batteries.");
            return;
        }
        const state = current.current;
        if (!state.queue.length || state.attempt)
            return;
        const reads = [...state.queue];
        const attempt = { reads, payload: scanMovementPayload(kind, reads, state.sessionId, state.room, crypto.randomUUID(), state.teachingGroup), status: "rejected", message: "" };
        if (await runAttempt(attempt)) {
            try {
                await onChanged?.();
            }
            catch {
                setNotice("The server confirmed the movement. Shared inventory refresh is unavailable; the completed list retains the receipt.");
            }
        }
    }
    async function readTags(tags, source) {
        if (current.current.attempt || current.current.roomConfirmationRequired || !startWork())
            return;
        try {
            const normalized = tags.map(value => value.trim()).filter(Boolean), unique = [...new Set(normalized)];
            if (!unique.length) {
                setNotice("Enter or select a tag to read.");
                return;
            }
            if (unique.length > 100 || unique.some(value => value.length > 128)) {
                setNotice("Read up to 100 unique tags at a time; each tag must be at most 128 characters.");
                return;
            }
            if (current.current.queue.length && current.current.queue[0].source !== source) {
                addIssue("source", normalized.join(", "), "Different input methods need separate batches. Confirm or clear the current queue before using another input method.");
                return;
            }
            const response = await write("scan_lookup", { tagIds: unique, source });
            if (!response || response.source !== source || !Array.isArray(response.results))
                throw new Error("The tag lookup response could not be read. No movement was attempted.");
            for (const tagId of normalized) {
                const result = response.results.find(item => item.tagId === tagId), state = current.current;
                if (!result) {
                    addIssue("lookup", tagId, "The lookup returned no result for this tag. No movement was attempted.");
                    continue;
                }
                if (!result.battery) {
                    addIssue("unknown", tagId, "Unregistered tag. Register the battery or check the identifier, then read it again.");
                    continue;
                }
                const battery = result.battery;
                change(previous => ({ ...previous, issues: resolveRegisteredTagIssues(previous.issues, tagId, battery) }));
                if (state.queue.some(read => read.battery.id === battery.id) || scanCompletedReadMatches(kind, battery, state.completed)) {
                    addIssue("duplicate", tagId, `${battery.id} was already queued or this loan action was completed in this session. Repeated read ignored.`, true);
                    continue;
                }
                if (state.teachingGroup && !scanGroup?.batteryIds.includes(battery.id)) {
                    addIssue("state", tagId, "This battery is outside the reviewed teaching group, or that group changed. No movement was saved.");
                    continue;
                }
                const problem = scanReadProblem(kind, battery, tagId);
                if (problem) {
                    addIssue("state", tagId, `${battery.id}: ${problem}`);
                    continue;
                }
                if (state.queue.length >= 100) {
                    addIssue("limit", tagId, "The queue already contains 100 batteries. Confirm or clear it before adding another read.");
                    continue;
                }
                change(previous => ({ ...previous, queue: [...previous.queue, { battery, tagId, source, readAt: new Date().toISOString() }] }));
            }
            setTag("");
            setNotice(`Valid reads were added to the review queue. Choose Confirm ${checkout ? "checkout" : "return"} to save the movement.`);
        }
        catch (error) {
            addIssue("lookup", tags.join(", "), `Lookup failed. ${errorMessage(error)} No new movement was attempted.`);
        }
        finally {
            finishWork();
        }
    }
    async function confirmQueue() {
        if (!current.current.queue.length || current.current.attempt || current.current.roomConfirmationRequired || !startWork())
            return;
        try {
            await processQueue();
        }
        catch (error) {
            setNotice(errorMessage(error));
        }
        finally {
            finishWork();
        }
    }
    async function retry() {
        const attempt = current.current.attempt;
        if (!attempt || !startWork())
            return;
        try {
            if (await runAttempt(attempt)) {
                let refreshWarning = "";
                try {
                    await onChanged?.();
                }
                catch {
                    refreshWarning = " Refresh shared inventory when available.";
                }
                setNotice(`The original movement is confirmed.${refreshWarning}${current.current.queue.length ? ` Review the remaining queue and choose Confirm ${checkout ? "checkout" : "return"} to save it.` : ""}`);
            }
        }
        finally {
            finishWork();
        }
    }
    async function reviewLatest() {
        const attempt = current.current.attempt;
        if (!attempt || attempt.status !== "rejected" || !startWork())
            return;
        try {
            const response = await fetch(`/api/inventory?dataset=${data.dataset}`, { cache: "no-store" });
            const inventory = await response.json();
            if (!response.ok)
                throw new Error(inventory.error || "Current records could not be loaded.");
            if (inventory.dataset !== data.dataset || inventory.user.id !== data.user.id || !Array.isArray(inventory.rooms))
                throw new Error("The latest records do not match this scan session.");
            setLatest({ requestId: attempt.payload.requestId, inventory });
        }
        catch (error) {
            setNotice(`Your captured request is preserved. ${errorMessage(error)}`);
        }
        finally {
            finishWork();
        }
    }
    async function reloadReturnRooms() {
        if (!current.current.roomConfirmationRequired || current.current.attempt || !startWork())
            return;
        try {
            const response = await fetch(`/api/inventory?dataset=${data.dataset}`, { cache: "no-store" });
            const inventory = await response.json();
            if (!response.ok)
                throw new Error(inventory.error || "Current return rooms could not be loaded.");
            if (inventory.dataset !== data.dataset || inventory.user.id !== data.user.id || !Array.isArray(inventory.rooms))
                throw new Error("The latest rooms do not match this scan session.");
            setReviewedRooms(inventory.rooms);
            setNotice("Current return rooms loaded. Choose a reviewed room or explicitly choose Room unspecified before reading again.");
        }
        catch (error) {
            setNotice(`Return-room confirmation is still required. ${errorMessage(error)}`);
        }
        finally {
            finishWork();
        }
    }
    function confirmLocalAction() {
        if (running.current || busy || paused || current.current.attempt?.status === "uncertain")
            return;
        if (confirmation === "discard") {
            const attempt = current.current.attempt;
            if (!attempt || latest?.requestId !== attempt.payload.requestId)
                return;
            const ids = new Set(attempt.reads.map(read => read.battery.id));
            const confirmRoom = !checkout && !!attempt.payload.returnRoom;
            setReviewedRooms(latest.inventory.rooms);
            change(previous => ({ ...previous, attempt: null, ...(confirmRoom ? { room: null, roomConfirmationRequired: true } : {}), queue: previous.queue.filter(read => !ids.has(read.battery.id)), issues: previous.issues.map(issue => issue.id === attempt.payload.requestId ? { ...issue, acknowledged: true } : issue) }));
            setLatest(null);
            setNotice(confirmRoom ? "The rejected request was discarded after review. Choose the reviewed return room or explicitly choose Room unspecified, then read the battery again. No new loan or room was substituted." : "The rejected request was discarded after review. No new loan was substituted. Read the battery again to capture its current state.");
        }
        else if (confirmation === "clear") {
            if (current.current.attempt)
                return;
            change(previous => ({ ...previous, queue: [] }));
            setNotice("Uncommitted reads cleared. Confirmed movements remain in this session's completed list.");
        }
        else if (confirmation === "exit") {
            if (current.current.attempt)
                return;
            try {
                window.__batteryWorkflowStorage.removeItem(storageKey);
            }
            catch { /* The in-memory session is already resolved. */ }
            onExit();
        }
        setConfirmation(null);
    }
    function requestExit() {
        if (running.current || busy || paused)
            return;
        if (current.current.queue.length || current.current.attempt || current.current.issues.some(issue => !issue.acknowledged))
            setConfirmation("exit");
        else {
            try {
                window.__batteryWorkflowStorage.removeItem(storageKey);
            }
            catch { /* No pending movement remains. */ }
            onExit();
        }
    }
    // A verified movement consumes its old snapshot; fresh server state can offer a later borrowing round.
    const selectionCandidates = data.batteries.filter(battery => (!session.teachingGroup || scanGroup?.batteryIds.includes(battery.id)) && isActiveBattery(battery) && (checkout ? !battery.loanId : !!battery.loanId)
        && confirmedSelectionSnapshots.get(battery.id) !== battery);
    const availableCandidates = selectionCandidates.filter(battery => session.attempt || !session.queue.some(read => read.battery.id === battery.id));
    const selectedBatteries = availableCandidates.filter(battery => selectedIds.includes(battery.id));
    const { batteries: visibleCandidates, error: selectionFilterError } = getFilteredBatteries(data, selectionFilters, availableCandidates);
    const completedIds = new Set(session.completed.map(read => read.battery.id));
    const completedBatteries = data.batteries.filter(battery => completedIds.has(battery.id));
    const { batteries: matchingCompleted, error: completedFilterError } = getFilteredBatteries(data, completedFilters, completedBatteries);
    const unavailableCompleted = !hasBatterySelectionCriteria(completedFilters, "all") && !completedFilterError ? session.completed.filter(read => !completedBatteries.some(battery => battery.id === read.battery.id)) : [];
    const visibleCompleted = [...matchingCompleted.flatMap(battery => session.completed.filter(read => read.battery.id === battery.id)), ...unavailableCompleted];
    function changeSelectionFilters(patch) {
        if (locked || running.current || current.current.attempt)
            return;
        setSelectionFilters(previous => patch ? { ...previous, ...patch } : defaultInventoryFilter());
    }
    function changeCompletedFilters(patch) {
        if (locked || running.current || current.current.attempt)
            return;
        setCompletedFilters(previous => patch ? { ...previous, ...patch } : { ...defaultInventoryFilter(), lifecycle: "all" });
    }
    async function processSelected() {
        if (current.current.attempt || current.current.roomConfirmationRequired || !startWork())
            return;
        try {
            if (!selectedBatteries.length) {
                setNotice("Select at least one battery.");
                return;
            }
            if (current.current.queue.length && current.current.queue[0].source !== "selection") {
                setNotice("Confirm or clear the current tag-input queue before using manual selection.");
                return;
            }
            for (const battery of selectedBatteries) {
                const state = current.current;
                if (state.queue.some(read => read.battery.id === battery.id) || scanCompletedReadMatches(kind, battery, state.completed))
                    continue;
                const problem = scanReadProblem(kind, battery, battery.tagId);
                if (problem) {
                    addIssue("state", battery.id, `${battery.id}: ${problem}`);
                    continue;
                }
                if (state.queue.length >= 100) {
                    setNotice("The queue already contains 100 batteries. Confirm or clear it before adding more.");
                    break;
                }
                change(previous => ({ ...previous, queue: [...previous.queue, { battery, tagId: battery.tagId, source: "selection", readAt: new Date().toISOString() }] }));
            }
            setNotice(`Selected batteries were added to the review queue. Choose Confirm ${checkout ? "checkout" : "return"} to save the movement.`);
        }
        catch (error) {
            setNotice(errorMessage(error));
        }
        finally {
            finishWork();
        }
    }
    const latestMatchesAttempt = latest && latest.requestId === session.attempt?.payload.requestId;
    function chooseRoom(value) {
        const state = current.current;
        if (running.current || busy || paused || state.attempt || state.roomConfirmationRequired && !reviewedRooms || !state.roomConfirmationRequired && (state.queue.length || state.completed.length))
            return;
        const room = rooms.find(item => item.id === value);
        if (value !== "__unspecified" && (!room || data.dataset === "live" && room.isPlaceholder))
            return;
        change(previous => ({ ...previous, roomConfirmationRequired: false, room: room ? { id: room.id, version: room.version, name: room.name, isPlaceholder: room.isPlaceholder, buildingId: room.buildingId } : null }));
    }
    return _jsxs("section", { className: "scan-station", "aria-label": `${checkout ? "Checkout" : "Return"} scan station`, "aria-busy": busy, children: [_jsxs("div", { className: "scan-station-header station-exit-bar", children: [_jsxs("div", { children: [_jsx("span", { className: "eyebrow", children: "STAFF SCAN STATION" }), _jsx("h2", { children: checkout ? "Check out batteries" : "Return batteries" }), _jsx("p", { children: checkout ? "Review selected batteries, then confirm checkout to your signed-in staff account. Responsible ownership remains unchanged." : "Receive reviewed active loans from any staff holder. Return placement is recorded separately from registered storage home." }), _jsx("p", { className: "station-exit-hint", children: busy ? "Wait for the current action to finish before leaving." : session.attempt?.status === "uncertain" ? "Resolve the preserved request before exiting. Use Retry same request below." : "Choose Exit scanning to finish this session and restore sidebar navigation." })] }), _jsxs(Button, { type: "button", size: "lg", className: "station-exit-button", onClick: requestExit, disabled: busy || paused, children: [_jsx(LogOut, { size: 20 }), "Exit scanning"] })] }), _jsxs("div", { className: "scan-station-info connection-message", children: [_jsx(Radio, { size: 18 }), _jsxs("span", { children: [_jsx("strong", { children: "No real RFID reader is connected." }), " Enter a registered tag or choose batteries with Manual selection. Both options are available in each inventory."] })] }), storageError && _jsx("p", { className: "form-error", role: "alert", children: storageError }), recovering && _jsx("p", { className: "field-hint", children: "Captured reads and request IDs remain in this station until resolved. An uncertain result must be confirmed by retrying its exact request; current loan state alone does not prove the earlier result." }), _jsxs("div", { className: "scan-station-toolbar detail-card", children: [_jsxs("div", { children: [_jsx("strong", { children: "Add batteries \u2192 Review list \u2192 Confirm" }), _jsx("p", { className: "field-hint", children: "Add one or more batteries using a registered tag or manual selection. Review up to 100 batteries, then confirm to save. Use one input method per review list." })] }), checkout ? _jsxs("div", { children: [_jsx(Label, { children: "Current holder for this checkout" }), _jsxs("strong", { children: [data.user.displayName, " \u00B7 ", data.user.username] }), _jsx("p", { className: "field-hint", children: "Signed-in staff account; no proxy holder." })] }) : _jsxs("div", { children: [_jsx(Label, { children: "Return room \u00B7 J18 \u00B7 optional" }), _jsxs(Select, { value: roomConfirmationRequired ? "__confirmation_required" : session.room?.id ?? "__unspecified", onValueChange: chooseRoom, disabled: roomLocked || roomConfirmationRequired && !reviewedRooms || !roomConfirmationRequired && (!!session.queue.length || !!session.completed.length), children: [_jsx(SelectTrigger, { "aria-label": "Session return room", children: _jsx(SelectValue, {}) }), _jsxs(SelectContent, { children: [roomConfirmationRequired && _jsx(SelectItem, { value: "__confirmation_required", disabled: true, children: "Confirm room or choose Room unspecified" }), _jsx(SelectItem, { value: "__unspecified", children: "Room unspecified" }), session.room && !rooms.some(room => room.id === session.room?.id) && _jsxs(SelectItem, { value: session.room.id, disabled: true, children: [session.room.name, " \u2014 Captured room unavailable"] }), rooms.map(room => _jsx(SelectItem, { value: room.id, disabled: data.dataset === "live" && room.isPlaceholder, children: room.id === session.room?.id ? `${session.room.name}${session.room.isPlaceholder ? " — Placeholder" : ""} · Captured` : data.dataset === "live" && room.isPlaceholder ? `${room.name} — Unverified room, unavailable` : roomLabel(room) }, room.id))] })] }), roomConfirmationRequired && !reviewedRooms && _jsx(Button, { variant: "outline", onClick: reloadReturnRooms, disabled: busy || paused, children: "Reload current return rooms" }), _jsx("p", { className: "field-hint", children: roomConfirmationRequired ? "Confirm a reviewed room or explicitly choose Room unspecified before another read. Completed movements retain their original placement evidence." : session.room?.isPlaceholder ? "Demonstration placeholder only; this is not verified physical location evidence." : "Choose once before accepted reads. Unspecified records no room; there is no registered-home fallback." })] })] }), _jsxs("div", { className: "group-scan-context", children: [_jsx(Label, { children: "Process as teaching group \u2014 optional" }), _jsxs(Select, { value: session.teachingGroup?.id ?? "__none", disabled: locked || !!session.queue.length || !!session.completed.length, onValueChange: id => { const group = data.teachingGroups?.find(group => group.id === id); change(previous => ({ ...previous, teachingGroup: group ? { id: group.id, version: group.version } : undefined })); setSelectedIds([]); }, children: [_jsx(SelectTrigger, { "aria-label": "Scan teaching group", children: _jsx(SelectValue, {}) }), _jsxs(SelectContent, { children: [_jsx(SelectItem, { value: "__none", children: "Individual battery operations" }), data.teachingGroups?.map(group => _jsx(SelectItem, { value: group.id, children: group.name }, group.id)), session.teachingGroup && !scanGroup && _jsx(SelectItem, { value: session.teachingGroup.id, disabled: true, children: "Reviewed group unavailable" })] })] }), session.teachingGroup && _jsx("p", { className: "field-hint", children: "Only reviewed group members can be processed. A confirmed batch is one group operation in shared Activity. Changing the group requires a new session." })] }), _jsxs("div", { className: "scan-station-summary", children: [_jsxs("div", { className: "detail-card", children: [_jsx("span", { children: "Completed this session" }), _jsx("strong", { children: session.completed.length })] }), _jsxs("div", { className: "detail-card", children: [_jsx("span", { children: "Queued / not committed" }), _jsx("strong", { children: session.queue.length })] }), _jsxs("div", { className: "detail-card", children: [_jsx("span", { children: "Unresolved read issues" }), _jsx("strong", { children: unresolvedIssues.filter(issue => session.attempt?.status !== "uncertain" || issue.id !== session.attempt.payload.requestId).length + (session.attempt?.status === "uncertain" ? 1 : 0) })] })] }), _jsxs("div", { className: "scan-station-grid", children: [_jsxs("section", { className: "scan-station-reader inventory-panel", children: [_jsx("div", { className: "section-heading", children: _jsxs("h2", { children: [_jsx(ScanLine, { size: 18 }), "Manual tag lookup"] }) }), _jsxs("div", { className: "form-stack p-5", children: [_jsx(Label, { htmlFor: "scan-station-tag", children: "Tag identifier" }), _jsxs("div", { className: "inline-input", children: [_jsx(Input, { ref: tagInput, id: "scan-station-tag", value: tag, onChange: event => setTag(event.target.value), maxLength: 128, onKeyDown: event => { if (event.key === "Enter") {
                                                    event.preventDefault();
                                                    void readTags([tag], "manual");
                                                } }, placeholder: "Enter a registered tag, then press Enter", disabled: locked }), _jsx(NfcReadButton, { disabled: locked || data.dataset !== "demo", onIdentity: setTag }), _jsx(Button, { onClick: () => readTags([tag], "manual"), disabled: locked || !tag.trim(), children: "Add tag to review" })] }), _jsx("p", { className: "field-hint", children: "A valid tag only adds to the review queue. Confirm the list to save. Source is recorded as manual input, never as an RFID device." })] })] }), _jsxs("section", { className: "scan-station-selection inventory-panel", children: [_jsxs("div", { className: "section-heading", children: [_jsx("h2", { children: "Manual selection" }), _jsxs("span", { children: [selectedBatteries.length, " selected"] })] }), _jsxs("div", { className: "form-stack p-5", children: [_jsxs("p", { className: "field-hint", children: [checkout ? "Select in-store batteries to check out to your account." : "Select borrowed batteries to return.", " A registered tag is not required."] }), _jsx(BatteryFilterControls, { data: data, filters: selectionFilters, onChange: changeSelectionFilters, onClear: () => changeSelectionFilters(), disabled: locked, fixedGroup: !!session.teachingGroup, showLifecycle: false, scopeNote: "Filters narrow the available batteries. Selected batteries remain selected when hidden; queued reads and exact tag lookup stay unchanged." }), selectionFilterError && _jsx("p", { className: "form-error", role: "alert", children: selectionFilterError }), _jsxs("p", { className: "field-hint", children: [visibleCandidates.length, " matching batteries \u00B7 ", selectedBatteries.length, " selected across all filters."] }), _jsx("div", { className: "scan-station-selection-list", children: visibleCandidates.map(battery => _jsxs("label", { className: "export-option", onClick: event => { if (locked || hasRowTextSelection(event))
                                                event.preventDefault(); }, children: [_jsx(Checkbox, { checked: selectedIds.includes(battery.id), onCheckedChange: value => { if (!locked && !running.current)
                                                        setSelectedIds(previous => value === true ? [...new Set([...previous, battery.id])] : previous.filter(id => id !== battery.id)); }, disabled: locked || !selectedIds.includes(battery.id) && selectedBatteries.length >= 100 }), _jsxs("span", { children: [_jsxs("strong", { children: [battery.id, " \u00B7 ", battery.name] }), _jsxs("small", { children: [battery.tagId || "No registered tag", " \u00B7 ", battery.loanId ? "In use by " + (battery.borrowerName || "staff holder") : "In store"] })] })] }, battery.id)) }), !visibleCandidates.length && _jsx("p", { className: "field-hint", children: selectionCandidates.length ? availableCandidates.length ? "No batteries match these filters." : "All available batteries are already in the review list." : checkout ? "No in-store batteries available for checkout." : "No batteries in use available for return." }), _jsxs("div", { className: "flex flex-wrap gap-2", children: [_jsx(Button, { "data-testid": "manual-selection-submit", onClick: processSelected, disabled: locked || !selectedBatteries.length, children: `Add selected to review (${selectedBatteries.length})` }), _jsx(Button, { variant: "outline", onClick: () => setSelectedIds([]), disabled: locked || !selectedBatteries.length, children: "Clear selection" })] }), _jsx(Button, { variant: "outline", onClick: () => setGroupEditor(selectedBatteries.map(b => b.id)), disabled: locked || !selectedBatteries.length, children: "Add selected to teaching group" }), _jsxs("p", { className: "field-hint", children: ["Review the queue and choose Confirm ", checkout ? "checkout" : "return", " to save all queued batteries together. Confirmed movements clear their selections and are recorded as Manual selection."] })] })] })] }), notice && _jsx("p", { className: "scan-station-status form-message", role: "status", children: notice }), session.attempt && _jsxs("section", { className: "scan-station-conflict detail-card", role: "alert", children: [_jsx("h2", { children: busy ? "Submitting captured request…" : session.attempt.status === "uncertain" ? "Movement result uncertain" : "Movement rejected" }), _jsx("p", { children: session.attempt.message }), _jsxs("p", { className: "field-hint", children: ["Captured request: ", session.attempt.payload.requestId, ". The review list, input method and room remain locked."] }), !busy && _jsxs("div", { className: "flex flex-wrap gap-2", children: [_jsxs(Button, { onClick: retry, disabled: paused, children: [_jsx(RefreshCw, { size: 16 }), "Retry same request"] }), session.attempt.status === "rejected" && _jsx(Button, { variant: "outline", onClick: reviewLatest, disabled: paused, children: "Review current records" })] }), latestMatchesAttempt && _jsxs("div", { className: "mt-4", children: [_jsx("h3", { children: "Review before discarding the rejected request" }), session.attempt.reads.map(read => { const now = latest.inventory.batteries.find(item => item.id === read.battery.id); return _jsxs("article", { className: "history-entry", children: [_jsx("strong", { children: read.battery.id }), _jsxs("p", { children: ["Captured: version ", read.battery.version, ", tag ", read.tagId || "not recorded", read.battery.loanId ? `; holder ${read.battery.borrowerName} · checked out ${formatTime(read.battery.checkedOutAt)}` : "; in store", "."] }), _jsxs("p", { children: ["Current: ", now ? `version ${now.version}, tag ${now.tagId || "not recorded"}${now.loanId ? `; holder ${now.borrowerName} · ${now.loanId === read.battery.loanId ? "same loan" : "different loan"}` : "; no active loan"}` : "battery unavailable", "."] })] }, read.battery.id); }), session.room && _jsxs("p", { children: ["Captured room version ", session.room.version, "; current version ", latest.inventory.rooms.find(room => room.id === session.room?.id)?.version ?? "unavailable", ". The captured room has not been replaced."] }), _jsx(Button, { variant: "outline", onClick: () => setConfirmation("discard"), disabled: busy || paused, children: "Discard rejected request after review" }), _jsx("p", { className: "field-hint", children: "Discard does not process the latest loan. A new explicit read is required." })] })] }), _jsxs("section", { className: "scan-station-queue inventory-panel", children: [_jsxs("div", { className: "panel-top", children: [_jsxs("h2", { children: ["Review queue \u00B7 ", session.queue.length] }), _jsxs("div", { className: "panel-actions", children: [_jsx(Button, { onClick: confirmQueue, disabled: locked || !session.queue.length, children: busy ? "Processing…" : `Confirm ${checkout ? "checkout" : "return"} (${session.queue.length})` }), _jsx(Button, { variant: "outline", onClick: () => setConfirmation("clear"), disabled: locked || !session.queue.length, children: "Clear queue" })] })] }), _jsxs(Table, { children: [_jsx(TableHeader, { children: _jsxs(TableRow, { children: [_jsx(TableHead, { children: "BATTERY / TAG" }), _jsx(TableHead, { children: "RESPONSIBLE OWNER" }), _jsx(TableHead, { children: "CURRENT HOLDER" }), _jsx(TableHead, { children: "SOURCE" }), _jsx(TableHead, {})] }) }), _jsx(TableBody, { children: session.queue.map(read => _jsxs(TableRow, { children: [_jsxs(TableCell, { children: [_jsxs("strong", { children: [read.battery.id, " \u00B7 ", read.battery.name] }), _jsx("span", { className: "cell-secondary", children: read.tagId || "No registered tag" })] }), _jsx(TableCell, { children: read.battery.ownerName }), _jsx(TableCell, { children: read.battery.borrowerName || "No active loan" }), _jsx(TableCell, { children: sourceLabel(read.source) }), _jsx(TableCell, { children: _jsx(Button, { variant: "ghost", size: "icon", "aria-label": `Remove queued ${read.battery.id}`, disabled: locked, onClick: () => change(previous => ({ ...previous, queue: previous.queue.filter(item => item.battery.id !== read.battery.id) })), children: _jsx(Trash2, { size: 16 }) }) })] }, read.battery.id)) })] }), !session.queue.length && _jsxs("div", { className: "empty-state", children: [_jsx(ScanLine, {}), _jsx("p", { children: "Add a registered tag or select batteries above to prepare the review list." })] })] }), _jsxs("section", { className: "scan-station-completed inventory-panel", children: [_jsxs("div", { className: "section-heading", children: [_jsx("h2", { children: "Completed this session" }), _jsxs("div", { className: "teaching-group-actions", children: [_jsx(Button, { variant: "outline", disabled: locked || !completedGroupIds.length, onClick: () => setGroupEditor(completedGroupIds), children: "Add selected to teaching group" }), _jsx(Button, { variant: "outline", disabled: locked || !session.completed.length || new Set(session.completed.map(read => read.battery.id)).size > 100, onClick: () => setGroupEditor([...new Set(session.completed.map(read => read.battery.id))]), children: "Add all session batteries to group" })] }), _jsxs("span", { children: [visibleCompleted.length, " of ", session.completed.length, " movements \u00B7 ", completedGroupIds.length, " selected"] })] }), _jsxs("div", { className: "p-5", children: [_jsx(BatteryFilterControls, { data: data, filters: completedFilters, onChange: changeCompletedFilters, onClear: () => changeCompletedFilters(), disabled: locked, defaultLifecycle: "all", scopeNote: "Filters use current battery details within this session. Clear battery criteria to include receipts whose current details are unavailable. Recorded movements and selections stay unchanged." }), completedFilterError && _jsx("p", { className: "form-error", role: "alert", children: completedFilterError })] }), _jsxs(Table, { children: [_jsx(TableHeader, { children: _jsxs(TableRow, { children: [_jsx(TableHead, { children: "BATTERY" }), _jsx(TableHead, { children: "CONFIRMED AT" }), _jsx(TableHead, { children: "SOURCE" }), _jsx(TableHead, { children: "RESULT" })] }) }), _jsx(TableBody, { children: visibleCompleted.map(read => _jsxs(TableRow, { className: "battery-selection-row", "data-selectable": !locked && (completedGroupIds.includes(read.battery.id) || completedGroupIds.length < 100), "data-selected": completedGroupIds.includes(read.battery.id), "aria-selected": completedGroupIds.includes(read.battery.id), "data-state": completedGroupIds.includes(read.battery.id) ? "selected" : undefined, onClick: event => { if (!locked && !running.current && shouldToggleSelection(event))
                                        setCompletedGroupIds(previous => previous.includes(read.battery.id) ? previous.filter(id => id !== read.battery.id) : previous.length < 100 ? [...previous, read.battery.id] : previous); }, children: [_jsxs(TableCell, { children: [_jsxs("label", { className: "group-member-selection", onClick: event => { if (locked || hasRowTextSelection(event))
                                                        event.preventDefault(); }, children: [_jsx(Checkbox, { "aria-label": `Select completed ${read.battery.id} for a teaching group`, checked: completedGroupIds.includes(read.battery.id), disabled: locked || !completedGroupIds.includes(read.battery.id) && completedGroupIds.length >= 100, onCheckedChange: checked => { if (!locked && !running.current)
                                                                setCompletedGroupIds(previous => checked === true ? [...new Set([...previous, read.battery.id])] : previous.filter(id => id !== read.battery.id)); } }), _jsxs("strong", { children: [read.battery.id, " \u00B7 ", read.battery.name] })] }), _jsxs("span", { className: "cell-secondary", children: ["Responsible owner: ", read.battery.ownerName] })] }), _jsx(TableCell, { children: formatTime(read.receipt.at) }), _jsx(TableCell, { children: sourceLabel(read.source) }), _jsxs(TableCell, { children: [checkout ? `Checked out to ${read.receipt.borrower || data.user.displayName}` : "Returned", !checkout && _jsx("span", { className: "cell-secondary", children: read.receipt.returnPlacement ? read.receipt.returnPlacement.roomName : "Room unspecified" })] })] }, `${read.receipt.requestId}-${read.battery.id}`)) })] }), !visibleCompleted.length && _jsxs("div", { className: "empty-state", children: [_jsx(CheckCircle2, {}), _jsx("p", { children: session.completed.length ? "No completed movements match these filters. Clear filters to show all session records." : "No server-confirmed movements in this session yet." })] })] }), !!session.issues.length && _jsxs("section", { className: "scan-station-issues inventory-panel", children: [_jsxs("div", { className: "section-heading", children: [_jsx("h2", { children: "Read issues and ignored duplicates" }), _jsxs("span", { children: [session.issues.length, " ", session.issues.length === 1 ? "record" : "records"] })] }), session.issues.map(issue => _jsxs("article", { className: "history-entry px-5", children: [_jsxs("strong", { children: [issue.resolvedBatteryId ? "Registered tag" : issue.category === "duplicate" ? "Duplicate read ignored" : issue.category === "unknown" ? "Unregistered tag" : issue.category === "state" ? "Battery or loan state" : "Read issue", " \u00B7 ", issue.tagId] }), _jsx("p", { children: issue.resolvedBatteryId ? `Tag lookup now identifies ${issue.resolvedBatteryId}.` : issue.message }), _jsxs("div", { className: "flex flex-wrap gap-2", children: [issue.category === "unknown" && !issue.resolvedBatteryId && _jsx(Button, { variant: "outline", size: "sm", onClick: () => onRegister(issue.tagId), disabled: locked, children: "Register new battery" }), !issue.acknowledged && issue.id !== session.attempt?.payload.requestId && _jsx(Button, { variant: "ghost", size: "sm", onClick: () => change(previous => ({ ...previous, issues: previous.issues.map(item => item.id === issue.id ? { ...item, acknowledged: true } : item) })), disabled: busy || paused, children: "Acknowledge" }), issue.acknowledged && _jsx("span", { className: "field-hint", children: issue.resolvedBatteryId ? "Resolved" : "Acknowledged" })] })] }, issue.id))] }), groupEditor && _jsx(TeachingGroupsPanel, { data: data, initialIds: groupEditor, addToExisting: true, onClose: () => setGroupEditor(null), onChanged: onChanged, onSaved: group => { setNotice(`Selected batteries saved in ${group.name}. Earlier movements retain their original activity context.`); setGroupEditor(null); }, onFilter: () => setNotice("Open Teaching groups after exiting this scanning session."), onSelect: () => setNotice("Open Teaching groups after exiting this scanning session.") }), toast && _jsxs("div", { className: "scan-station-toast", role: "status", children: [_jsx(CheckCircle2, { size: 18 }), _jsx("span", { children: toast })] }), _jsx(Dialog, { open: !!confirmation, onOpenChange: open => !open && !busy && setConfirmation(null), children: _jsxs(DialogContent, { showCloseButton: !busy, children: [_jsxs(DialogHeader, { children: [_jsx(DialogTitle, { children: confirmation === "exit" ? "Exit scanning?" : confirmation === "clear" ? "Clear uncommitted reads?" : "Discard reviewed rejected request?" }), _jsx(DialogDescription, { children: session.attempt?.status === "uncertain" ? "The result of the captured movement is still uncertain. Exit and discard are blocked until its exact request has been retried and confirmed or rejected by the server." : confirmation === "exit" ? "Uncommitted reads and unacknowledged issues will leave this session. Server-confirmed movements and their audit history remain saved." : confirmation === "clear" ? "Only queued reads will be removed. No checkout or return is performed, and the completed session list remains." : "The server rejected this captured request and you reviewed the current records. Removing it does not act on a newer loan or change any saved movement." })] }), _jsxs(DialogFooter, { children: [_jsx(Button, { variant: "outline", onClick: () => setConfirmation(null), disabled: busy, children: "Continue scanning" }), session.attempt?.status === "uncertain" ? _jsx(Button, { onClick: async () => { setConfirmation(null); await retry(); }, disabled: busy || paused, children: "Retry same request" }) : _jsx(Button, { onClick: confirmLocalAction, disabled: busy || paused || confirmation === "exit" && !!session.attempt, children: confirmation === "exit" ? "Exit scanning" : confirmation === "clear" ? "Clear queue" : "Discard rejected request" })] })] }) })] });
}

export function ScanStation(props) { return _jsx(WorkflowBoundary, {children:_jsx(SharedScanStation, {...props})}); }
