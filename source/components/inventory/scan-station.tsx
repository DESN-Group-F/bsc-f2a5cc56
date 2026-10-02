"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, LogOut, Radio, RefreshCw, ScanLine, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { BatteryRecord, InventorySnapshot } from "@/lib/domain";
import { formatTime, roomLabel } from "@/lib/client-utils";
import { isSelectableRoom } from "@/lib/location-catalog";
import { recoverScanSession, resolveRegisteredTagIssues, scanCompletedReadMatches, scanFailureStatus, scanMovementPayload, scanReadProblem, type ScanAttempt, type ScanIssue, type ScanReceipt, type ScanSession, type ScanSource } from "@/lib/scan-session";
import type { WriteAction } from "./movement-dialog";

export type ScanStationProps = {
    data: InventorySnapshot;
    kind: "checkout" | "return";
    write: WriteAction;
    onExit: () => void;
    onRegister: (tagId: string) => void;
    onChanged?: () => Promise<void>;
    paused?: boolean;
};
type LookupResult = { source: ScanSource; results: { tagId: string; battery: BatteryRecord | null }[] };
type LatestReview = { requestId: string; inventory: InventorySnapshot };
type Confirmation = "exit" | "clear" | "discard" | null;

function freshSession(): ScanSession {
    return { sessionId: crypto.randomUUID(), mode: "continuous", room: null, queue: [], completed: [], issues: [], attempt: null };
}
function sessionStorageKey(data: InventorySnapshot, kind: ScanStationProps["kind"]) {
    return `battery-scan:${data.user.id}:${data.dataset}:${kind}`;
}
function loadSession(key: string, kind: ScanStationProps["kind"]) {
    try { return typeof window === "undefined" ? freshSession() : recoverScanSession(sessionStorage.getItem(key), kind) ?? freshSession(); }
    catch { return freshSession(); }
}
function errorMessage(error: unknown) { return error instanceof Error ? error.message : "The operation could not be completed."; }

export function ScanStation({ data, kind, write, onExit, onRegister, onChanged, paused = false }: ScanStationProps) {
    const storageKey = sessionStorageKey(data, kind);
    const [session, setSession] = useState<ScanSession>(() => loadSession(storageKey, kind));
    const current = useRef(session), running = useRef(false), tagInput = useRef<HTMLInputElement>(null);
    const [busy, setBusy] = useState(false), [tag, setTag] = useState(""), [notice, setNotice] = useState(""), [storageError, setStorageError] = useState("");
    const [simulatedIds, setSimulatedIds] = useState<string[]>([]), [repeat, setRepeat] = useState(false), [includeUnknown, setIncludeUnknown] = useState(false);
    const [confirmedSimulatorSnapshots, setConfirmedSimulatorSnapshots] = useState<Map<string, BatteryRecord>>(() => new Map());
    const [confirmation, setConfirmation] = useState<Confirmation>(null), [latest, setLatest] = useState<LatestReview | null>(null), [toast, setToast] = useState("");
    const [reviewedRooms, setReviewedRooms] = useState<InventorySnapshot["rooms"] | null>(null);
    const checkout = kind === "checkout", roomLocked = busy || paused || !!session.attempt;
    const roomConfirmationRequired = !checkout && !!session.roomConfirmationRequired;
    const locked = roomLocked || roomConfirmationRequired;
    const rooms = (reviewedRooms ?? data.rooms).filter(isSelectableRoom), unresolvedIssues = session.issues.filter(issue => !issue.acknowledged);
    const recovering = !!session.attempt || !!session.queue.length;

    function change(update: (previous: ScanSession) => ScanSession) {
        const next = update(current.current);
        current.current = next;
        try { sessionStorage.setItem(storageKey, JSON.stringify(next)); }
        catch { setStorageError("Local reload recovery is unavailable in this browser. Keep this page open until every pending request has been resolved."); }
        setSession(next);
    }
    function addIssue(category: ScanIssue["category"], tagId: string, message: string, acknowledged = false) {
        change(previous => ({ ...previous, issues: [...previous.issues, { id: crypto.randomUUID(), category, tagId, message, acknowledged }] }));
    }
    function startWork() {
        if (running.current || paused) return false;
        running.current = true; setBusy(true); setNotice(""); return true;
    }
    function finishWork() { running.current = false; setBusy(false); }
    useEffect(() => {
        if (!busy && !paused && !session.attempt) tagInput.current?.focus();
    }, [busy, paused, session.attempt]);
    useEffect(() => {
        if (!busy && !session.queue.length && !session.attempt) return;
        const protect = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
        window.addEventListener("beforeunload", protect);
        return () => window.removeEventListener("beforeunload", protect);
    }, [busy, session.queue.length, session.attempt]);
    useEffect(() => {
        if (!toast) return;
        const timer = setTimeout(() => setToast(""), 5500);
        return () => clearTimeout(timer);
    }, [toast]);

    async function runAttempt(attempt: ScanAttempt) {
        change(previous => ({ ...previous, attempt: { ...attempt, status: "uncertain", message: "Waiting for the server to confirm this exact request." } }));
        try {
            const result = await write("movement", attempt.payload) as ScanReceipt;
            if (!result || result.kind !== kind || result.requestId !== attempt.payload.requestId || !Array.isArray(result.batteryIds)
                || result.batteryIds.length !== attempt.reads.length || result.count !== attempt.reads.length || attempt.reads.some(read => !result.batteryIds.includes(read.battery.id)) || typeof result.at !== "string" || !Number.isFinite(Date.parse(result.at))) {
                throw new Error("The movement response could not be verified. Its result is uncertain; retry the same captured request.");
            }
            const ids = new Set(attempt.reads.map(read => read.battery.id));
            setConfirmedSimulatorSnapshots(previous => {
                const next = new Map(previous);
                for (const id of ids) {
                    const snapshot = data.batteries.find(battery => battery.id === id);
                    if (snapshot) next.set(id, snapshot);
                }
                return next;
            });
            setSimulatedIds(previous => previous.filter(id => !ids.has(id)));
            change(previous => ({ ...previous, queue: previous.queue.filter(read => !ids.has(read.battery.id)), completed: [...previous.completed, ...attempt.reads.filter(read => !previous.completed.some(saved => saved.battery.id === read.battery.id && saved.receipt.requestId === result.requestId)).map(read => ({ ...read, receipt: result }))], attempt: null,
                issues: previous.issues.map(issue => issue.id === attempt.payload.requestId ? { ...issue, acknowledged: true } : issue) }));
            setLatest(null);
            setToast(`${result.count === 1 ? result.batteryIds[0] : `${result.count} batteries`} ${checkout ? "checked out" : "returned"}${result.replayed ? " · original request confirmed" : ""}. Ready for the next read.`);
            return true;
        } catch (error) {
            const status = scanFailureStatus(error, attempt.status === "uncertain"), statusCode = (error as { status?: number })?.status;
            const message = status === "uncertain" ? `Result uncertain. ${errorMessage(error)} Retry the original request before scanning or exiting.` : errorMessage(error);
            change(previous => ({ ...previous, attempt: { ...attempt, status, statusCode, message }, issues: status === "rejected" && !previous.issues.some(issue => issue.id === attempt.payload.requestId)
                ? [...previous.issues, { id: attempt.payload.requestId, category: "state", tagId: attempt.reads.map(read => read.tagId).join(", "), message, acknowledged: false }] : previous.issues }));
            setLatest(null); return false;
        }
    }
    async function processQueue() {
        if (current.current.roomConfirmationRequired) { setNotice("Confirm the return room or explicitly choose Room unspecified before processing more batteries."); return; }
        let confirmed = false;
        while (current.current.queue.length && !current.current.attempt) {
            const state = current.current, reads = state.mode === "batch" ? [...state.queue] : [state.queue[0]];
            const attempt: ScanAttempt = { reads, payload: scanMovementPayload(kind, reads, state.sessionId, state.room, crypto.randomUUID()), status: "rejected", message: "" };
            if (!await runAttempt(attempt)) break;
            confirmed = true;
            if (state.mode === "batch") break;
        }
        if (confirmed) {
            try { await onChanged?.(); }
            catch { setNotice("The server confirmed the movement. Shared inventory refresh is unavailable; the completed list retains the receipt."); }
        }
    }
    async function readTags(tags: string[], source: ScanSource) {
        if (current.current.attempt || current.current.roomConfirmationRequired || !startWork()) return;
        try {
            const normalized = tags.map(value => value.trim()).filter(Boolean), unique = [...new Set(normalized)];
            if (!unique.length) { setNotice("Enter or select a tag to read."); return; }
            if (unique.length > 100 || unique.some(value => value.length > 128)) { setNotice("Read up to 100 unique tags at a time; each tag must be at most 128 characters."); return; }
            if (current.current.queue.length && current.current.queue[0].source !== source) {
                addIssue("source", normalized.join(", "), "Manual and simulated reads need separate batches. Confirm or clear the current queue before using another source."); return;
            }
            const response = await write("scan_lookup", { tagIds: unique, source }) as LookupResult;
            if (!response || response.source !== source || !Array.isArray(response.results)) throw new Error("The tag lookup response could not be read. No movement was attempted.");
            for (const tagId of normalized) {
                const result = response.results.find(item => item.tagId === tagId), state = current.current;
                if (!result) { addIssue("lookup", tagId, "The lookup returned no result for this tag. No movement was attempted."); continue; }
                if (!result.battery) { addIssue("unknown", tagId, "Unregistered tag. Register the battery or check the identifier, then read it again."); continue; }
                const battery = result.battery;
                change(previous => ({ ...previous, issues: resolveRegisteredTagIssues(previous.issues, tagId, battery) }));
                if (state.queue.some(read => read.battery.id === battery.id) || scanCompletedReadMatches(kind, battery, state.completed)) {
                    addIssue("duplicate", tagId, `${battery.id} was already queued or this loan action was completed in this session. Repeated read ignored.`, true); continue;
                }
                const problem = scanReadProblem(kind, battery, tagId);
                if (problem) { addIssue("state", tagId, `${battery.id}: ${problem}`); continue; }
                if (state.queue.length >= 100) { addIssue("limit", tagId, "The queue already contains 100 batteries. Confirm or clear it before adding another read."); continue; }
                change(previous => ({ ...previous, queue: [...previous.queue, { battery, tagId, source, readAt: new Date().toISOString() }] }));
            }
            setTag("");
            if (current.current.mode === "continuous") await processQueue();
            else setNotice("Valid reads were added to the review queue. No movement is saved until Confirm batch.");
        } catch (error) { addIssue("lookup", tags.join(", "), `Lookup failed. ${errorMessage(error)} No new movement was attempted.`); }
        finally { finishWork(); }
    }
    async function confirmQueue() {
        if (!current.current.queue.length || current.current.attempt || current.current.roomConfirmationRequired || !startWork()) return;
        try { await processQueue(); }
        catch (error) { setNotice(errorMessage(error)); }
        finally { finishWork(); }
    }
    async function retry() {
        const attempt = current.current.attempt;
        if (!attempt || !startWork()) return;
        try {
            if (await runAttempt(attempt)) {
                try { await onChanged?.(); } catch { setNotice("The original movement is confirmed. Refresh shared inventory when available."); }
                if (current.current.mode === "continuous") await processQueue();
            }
        } finally { finishWork(); }
    }
    async function reviewLatest() {
        const attempt = current.current.attempt;
        if (!attempt || attempt.status !== "rejected" || !startWork()) return;
        try {
            const response = await fetch(`/api/inventory?dataset=${data.dataset}`, { cache: "no-store" });
            const inventory = await response.json() as InventorySnapshot & { error?: string };
            if (!response.ok) throw new Error(inventory.error || "Current records could not be loaded.");
            if (inventory.dataset !== data.dataset || inventory.user.id !== data.user.id || !Array.isArray(inventory.rooms)) throw new Error("The latest records do not match this scan session.");
            setLatest({ requestId: attempt.payload.requestId, inventory });
        } catch (error) { setNotice(`Your captured request is preserved. ${errorMessage(error)}`); }
        finally { finishWork(); }
    }
    async function reloadReturnRooms() {
        if (!current.current.roomConfirmationRequired || current.current.attempt || !startWork()) return;
        try {
            const response = await fetch(`/api/inventory?dataset=${data.dataset}`, { cache: "no-store" });
            const inventory = await response.json() as InventorySnapshot & { error?: string };
            if (!response.ok) throw new Error(inventory.error || "Current return rooms could not be loaded.");
            if (inventory.dataset !== data.dataset || inventory.user.id !== data.user.id || !Array.isArray(inventory.rooms)) throw new Error("The latest rooms do not match this scan session.");
            setReviewedRooms(inventory.rooms);
            setNotice("Current return rooms loaded. Choose a reviewed room or explicitly choose Room unspecified before reading again.");
        } catch (error) { setNotice(`Return-room confirmation is still required. ${errorMessage(error)}`); }
        finally { finishWork(); }
    }
    function confirmLocalAction() {
        if (running.current || busy || paused || current.current.attempt?.status === "uncertain") return;
        if (confirmation === "discard") {
            const attempt = current.current.attempt;
            if (!attempt || latest?.requestId !== attempt.payload.requestId) return;
            const ids = new Set(attempt.reads.map(read => read.battery.id));
            const confirmRoom = !checkout && !!attempt.payload.returnRoom;
            setReviewedRooms(latest.inventory.rooms);
            change(previous => ({ ...previous, attempt: null, ...(confirmRoom ? { room: null, roomConfirmationRequired: true } : {}), queue: previous.queue.filter(read => !ids.has(read.battery.id)), issues: previous.issues.map(issue => issue.id === attempt.payload.requestId ? { ...issue, acknowledged: true } : issue) }));
            setLatest(null); setNotice(confirmRoom ? "The rejected request was discarded after review. Choose the reviewed return room or explicitly choose Room unspecified, then read the battery again. No new loan or room was substituted." : "The rejected request was discarded after review. No new loan was substituted. Read the battery again to capture its current state.");
        } else if (confirmation === "clear") {
            if (current.current.attempt) return;
            change(previous => ({ ...previous, queue: [] })); setNotice("Uncommitted reads cleared. Confirmed movements remain in this session's completed list.");
        } else if (confirmation === "exit") {
            if (current.current.attempt) return;
            try { sessionStorage.removeItem(storageKey); } catch { /* The in-memory session is already resolved. */ }
            onExit();
        }
        setConfirmation(null);
    }
    function requestExit() {
        if (running.current || busy || paused) return;
        if (current.current.queue.length || current.current.attempt || current.current.issues.some(issue => !issue.acknowledged)) setConfirmation("exit");
        else {
            try { sessionStorage.removeItem(storageKey); } catch { /* No pending movement remains. */ }
            onExit();
        }
    }
    // A verified movement consumes its old snapshot; fresh server state can offer a later borrowing round.
    const simulatorCandidates = data.batteries.filter(battery => battery.tagId && (checkout ? !battery.loanId : !!battery.loanId)
        && confirmedSimulatorSnapshots.get(battery.id) !== battery);
    const simulatorSelection = simulatorCandidates.filter(battery => simulatedIds.includes(battery.id));
    const simulatorTags = simulatorSelection.map(battery => battery.tagId!);
    function simulate() {
        const tags = repeat ? simulatorTags.flatMap(value => [value, value]) : [...simulatorTags];
        if (includeUnknown) {
            let unknown = `UNREGISTERED-DEMO-${crypto.randomUUID()}`;
            while (data.batteries.some(battery => battery.tagId === unknown)) unknown = `UNREGISTERED-DEMO-${crypto.randomUUID()}`;
            tags.push(unknown);
        }
        void readTags(tags, "simulated");
    }
    const latestMatchesAttempt = latest && latest.requestId === session.attempt?.payload.requestId;

    function chooseRoom(value: string) {
        const state = current.current;
        if (running.current || busy || paused || state.attempt || state.roomConfirmationRequired && !reviewedRooms || !state.roomConfirmationRequired && (state.queue.length || state.completed.length)) return;
        const room = rooms.find(item => item.id === value);
        if (value !== "__unspecified" && (!room || data.dataset === "live" && room.isPlaceholder)) return;
        change(previous => ({ ...previous, roomConfirmationRequired: false, room: room ? { id: room.id, version: room.version, name: room.name, isPlaceholder: room.isPlaceholder, buildingId: room.buildingId } : null }));
    }

    return <section className="scan-station" aria-label={`${checkout ? "Checkout" : "Return"} scan station`} aria-busy={busy}>
        <div className="scan-station-header"><div><span className="eyebrow">STAFF SCAN STATION</span><h2>{checkout ? "Check out batteries" : "Return batteries"}</h2><p>{checkout ? "Accepted reads check out to your signed-in staff account. Responsible ownership remains unchanged." : "Receive reviewed active loans from any staff holder. Return placement is recorded separately from registered storage home."}</p></div><Button variant="outline" onClick={requestExit} disabled={busy || paused}><LogOut size={16}/>Exit scanning</Button></div>
        <div className="scan-station-info connection-message"><Radio size={18}/><span><strong>No real RFID reader is connected.</strong> Manual identifier lookup is available in both inventories. Simulated reads are available only in the Demonstration inventory.</span></div>
        {storageError && <p className="form-error" role="alert">{storageError}</p>}
        {recovering && <p className="field-hint">Captured reads and request IDs remain in this station until resolved. An uncertain result must be confirmed by retrying its exact request; current loan state alone does not prove the earlier result.</p>}
        <div className="scan-station-toolbar detail-card"><div><Label>Processing mode</Label><div className="flex flex-wrap gap-2" role="group" aria-label="Scan processing mode"><Button variant={session.mode === "continuous" ? "default" : "outline"} onClick={() => change(previous => ({ ...previous, mode: "continuous" }))} disabled={locked || !!session.queue.length}>Continuous</Button><Button variant={session.mode === "batch" ? "default" : "outline"} onClick={() => change(previous => ({ ...previous, mode: "batch" }))} disabled={locked || !!session.queue.length}>Batch</Button></div><p className="field-hint">{session.mode === "continuous" ? "Each accepted battery read is submitted separately. Continue scanning after its confirmed success." : "Reads add to a queue. Review and confirm up to 100 batteries in one atomic movement."}</p></div>
            {checkout ? <div><Label>Current holder for this checkout</Label><strong>{data.user.displayName} · {data.user.username}</strong><p className="field-hint">Signed-in staff account; no proxy holder.</p></div> : <div><Label>Return room · J18 · optional</Label><Select value={roomConfirmationRequired ? "__confirmation_required" : session.room?.id ?? "__unspecified"} onValueChange={chooseRoom} disabled={roomLocked || roomConfirmationRequired && !reviewedRooms || !roomConfirmationRequired && (!!session.queue.length || !!session.completed.length)}><SelectTrigger aria-label="Session return room"><SelectValue/></SelectTrigger><SelectContent>{roomConfirmationRequired && <SelectItem value="__confirmation_required" disabled>Confirm room or choose Room unspecified</SelectItem>}<SelectItem value="__unspecified">Room unspecified</SelectItem>{session.room && !rooms.some(room => room.id === session.room?.id) && <SelectItem value={session.room.id} disabled>{session.room.name} — Captured room unavailable</SelectItem>}{rooms.map(room => <SelectItem key={room.id} value={room.id} disabled={data.dataset === "live" && room.isPlaceholder}>{room.id === session.room?.id ? `${session.room.name}${session.room.isPlaceholder ? " — Placeholder" : ""} · Captured` : data.dataset === "live" && room.isPlaceholder ? `${room.name} — Unverified room, unavailable` : roomLabel(room)}</SelectItem>)}</SelectContent></Select>{roomConfirmationRequired && !reviewedRooms && <Button variant="outline" onClick={reloadReturnRooms} disabled={busy || paused}>Reload current return rooms</Button>}<p className="field-hint">{roomConfirmationRequired ? "Confirm a reviewed room or explicitly choose Room unspecified before another read. Completed movements retain their original placement evidence." : session.room?.isPlaceholder ? "Demonstration placeholder only; this is not verified physical location evidence." : "Choose once before accepted reads. Unspecified records no room; there is no registered-home fallback."}</p></div>}
        </div>
        <div className="scan-station-summary"><div className="detail-card"><span>Completed this session</span><strong>{session.completed.length}</strong></div><div className="detail-card"><span>Queued / not committed</span><strong>{session.queue.length}</strong></div><div className="detail-card"><span>Unresolved read issues</span><strong>{unresolvedIssues.filter(issue => session.attempt?.status !== "uncertain" || issue.id !== session.attempt.payload.requestId).length + (session.attempt?.status === "uncertain" ? 1 : 0)}</strong></div></div>
        <div className="scan-station-grid"><section className="scan-station-reader inventory-panel"><div className="section-heading"><h2><ScanLine size={18}/>Manual tag lookup</h2></div><div className="form-stack p-5"><Label htmlFor="scan-station-tag">Tag identifier</Label><div className="inline-input"><Input ref={tagInput} id="scan-station-tag" value={tag} onChange={event => setTag(event.target.value)} maxLength={128} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); void readTags([tag], "manual"); } }} placeholder="Enter a registered tag, then press Enter" disabled={locked}/><Button onClick={() => readTags([tag], "manual")} disabled={locked || !tag.trim()}>Read tag</Button></div><p className="field-hint">{session.mode === "continuous" ? `A valid read confirms one ${checkout ? "checkout" : "return"}.` : "A valid read only adds to the review queue."} Source is recorded as manual input, never as an RFID device.</p></div></section>
            {data.dataset === "demo" && <section className="scan-station-simulator inventory-panel"><div className="section-heading"><h2>Simulated reader · demonstration only</h2></div><div className="form-stack p-5"><p className="field-hint">{checkout ? "In-store batteries with registered tags, available for checkout." : "On-loan batteries with registered tags, available for return."} Confirmed movements clear their selections.</p><div className="scan-station-demo-list">{simulatorCandidates.map(battery => <label className="export-option" key={battery.id}><Checkbox checked={simulatedIds.includes(battery.id)} onCheckedChange={value => setSimulatedIds(previous => value === true ? [...new Set([...previous, battery.id])] : previous.filter(id => id !== battery.id))} disabled={locked || !simulatedIds.includes(battery.id) && simulatorSelection.length >= (includeUnknown ? 99 : 100)}/><span><strong>{battery.id} · {battery.name}</strong><small>{battery.tagId} · {battery.loanId ? `On loan to ${battery.borrowerName || "staff holder"}` : "In store"}</small></span></label>)}</div>{!simulatorCandidates.length && <p className="field-hint">{checkout ? "No tagged in-store batteries available for checkout." : "No tagged on-loan batteries available for return."}</p>}<label className="export-option"><Checkbox checked={repeat} onCheckedChange={value => setRepeat(value === true)} disabled={locked}/><span>Repeat each selected read to demonstrate duplicate suppression</span></label><label className="export-option"><Checkbox checked={includeUnknown} onCheckedChange={value => setIncludeUnknown(value === true)} disabled={locked || !includeUnknown && simulatorSelection.length >= 100}/><span>Include an unregistered tag</span></label><Button variant="outline" onClick={simulate} disabled={locked || !simulatorTags.length && !includeUnknown}>Simulate selected reads</Button><p className="field-hint">Select known batteries deliberately. State errors, repeated reads and unregistered tags are reported separately.</p></div></section>}
        </div>
        {notice && <p className="scan-station-status form-message" role="status">{notice}</p>}
        {session.attempt && <section className="scan-station-conflict detail-card" role="alert"><h2>{busy ? "Submitting captured request…" : session.attempt.status === "uncertain" ? "Movement result uncertain" : "Movement rejected"}</h2><p>{session.attempt.message}</p><p className="field-hint">Captured request: {session.attempt.payload.requestId}. Input, processing mode and room remain locked.</p>{!busy && <div className="flex flex-wrap gap-2"><Button onClick={retry} disabled={paused}><RefreshCw size={16}/>Retry same request</Button>{session.attempt.status === "rejected" && <Button variant="outline" onClick={reviewLatest} disabled={paused}>Review current records</Button>}</div>}
            {latestMatchesAttempt && <div className="mt-4"><h3>Review before discarding the rejected request</h3>{session.attempt.reads.map(read => { const now = latest.inventory.batteries.find(item => item.id === read.battery.id); return <article className="history-entry" key={read.battery.id}><strong>{read.battery.id}</strong><p>Captured: version {read.battery.version}, tag {read.tagId}{read.battery.loanId ? `; holder ${read.battery.borrowerName} · checked out ${formatTime(read.battery.checkedOutAt)}` : "; in store"}.</p><p>Current: {now ? `version ${now.version}, tag ${now.tagId || "not recorded"}${now.loanId ? `; holder ${now.borrowerName} · ${now.loanId === read.battery.loanId ? "same loan" : "different loan"}` : "; no active loan"}` : "battery unavailable"}.</p></article>; })}{session.room && <p>Captured room version {session.room.version}; current version {latest.inventory.rooms.find(room => room.id === session.room?.id)?.version ?? "unavailable"}. The captured room has not been replaced.</p>}<Button variant="outline" onClick={() => setConfirmation("discard")} disabled={busy || paused}>Discard rejected request after review</Button><p className="field-hint">Discard does not process the latest loan. A new explicit read is required.</p></div>}
        </section>}
        {(session.mode === "batch" || session.queue.length > 0) && <section className="scan-station-queue inventory-panel"><div className="panel-top"><h2>Review queue · {session.queue.length}</h2><div className="panel-actions"><Button onClick={confirmQueue} disabled={locked || !session.queue.length}>{busy ? "Processing…" : session.mode === "batch" ? `Confirm batch (${session.queue.length})` : "Process pending reads"}</Button><Button variant="outline" onClick={() => setConfirmation("clear")} disabled={locked || !session.queue.length}>Clear queue</Button></div></div><Table><TableHeader><TableRow><TableHead>BATTERY / TAG</TableHead><TableHead>RESPONSIBLE OWNER</TableHead><TableHead>CURRENT HOLDER</TableHead><TableHead>SOURCE</TableHead><TableHead/></TableRow></TableHeader><TableBody>{session.queue.map(read => <TableRow key={read.battery.id}><TableCell><strong>{read.battery.id} · {read.battery.name}</strong><span className="cell-secondary">{read.tagId}</span></TableCell><TableCell>{read.battery.ownerName}</TableCell><TableCell>{read.battery.borrowerName || "No active loan"}</TableCell><TableCell>{read.source === "simulated" ? "Simulated reader" : "Manual input"}</TableCell><TableCell><Button variant="ghost" size="icon" aria-label={`Remove queued ${read.battery.id}`} disabled={locked} onClick={() => change(previous => ({ ...previous, queue: previous.queue.filter(item => item.battery.id !== read.battery.id) }))}><Trash2 size={16}/></Button></TableCell></TableRow>)}</TableBody></Table>{!session.queue.length && <div className="empty-state"><ScanLine/><p>No uncommitted batteries. Read the next tag.</p></div>}</section>}
        <section className="scan-station-completed inventory-panel"><div className="section-heading"><h2>Completed this session</h2><span>{session.completed.length} {session.completed.length === 1 ? "movement" : "movements"}</span></div><Table><TableHeader><TableRow><TableHead>BATTERY</TableHead><TableHead>CONFIRMED AT</TableHead><TableHead>SOURCE</TableHead><TableHead>RESULT</TableHead></TableRow></TableHeader><TableBody>{session.completed.map(read => <TableRow key={`${read.receipt.requestId}-${read.battery.id}`}><TableCell><strong>{read.battery.id} · {read.battery.name}</strong><span className="cell-secondary">Responsible owner: {read.battery.ownerName}</span></TableCell><TableCell>{formatTime(read.receipt.at)}</TableCell><TableCell>{read.source === "simulated" ? "Simulated reader" : "Manual input"}</TableCell><TableCell>{checkout ? `Checked out to ${read.receipt.borrower || data.user.displayName}` : "Returned"}{!checkout && <span className="cell-secondary">{read.receipt.returnPlacement ? read.receipt.returnPlacement.roomName : "Room unspecified"}</span>}</TableCell></TableRow>)}</TableBody></Table>{!session.completed.length && <div className="empty-state"><CheckCircle2/><p>No server-confirmed movements in this session yet.</p></div>}</section>
        {!!session.issues.length && <section className="scan-station-issues inventory-panel"><div className="section-heading"><h2>Read issues and ignored duplicates</h2><span>{session.issues.length} {session.issues.length === 1 ? "record" : "records"}</span></div>{session.issues.map(issue => <article className="history-entry px-5" key={issue.id}><strong>{issue.resolvedBatteryId ? "Registered tag" : issue.category === "duplicate" ? "Duplicate read ignored" : issue.category === "unknown" ? "Unregistered tag" : issue.category === "state" ? "Battery or loan state" : "Read issue"} · {issue.tagId}</strong><p>{issue.resolvedBatteryId ? `Tag lookup now identifies ${issue.resolvedBatteryId}.` : issue.message}</p><div className="flex flex-wrap gap-2">{issue.category === "unknown" && !issue.resolvedBatteryId && <Button variant="outline" size="sm" onClick={() => onRegister(issue.tagId)} disabled={locked}>Register new battery</Button>}{!issue.acknowledged && issue.id !== session.attempt?.payload.requestId && <Button variant="ghost" size="sm" onClick={() => change(previous => ({ ...previous, issues: previous.issues.map(item => item.id === issue.id ? { ...item, acknowledged: true } : item) }))} disabled={busy || paused}>Acknowledge</Button>}{issue.acknowledged && <span className="field-hint">{issue.resolvedBatteryId ? "Resolved" : "Acknowledged"}</span>}</div></article>)}</section>}
        {toast && <div className="scan-station-toast" role="status"><CheckCircle2 size={18}/><span>{toast}</span></div>}
        <Dialog open={!!confirmation} onOpenChange={open => !open && !busy && setConfirmation(null)}><DialogContent showCloseButton={!busy}><DialogHeader><DialogTitle>{confirmation === "exit" ? "Exit scanning?" : confirmation === "clear" ? "Clear uncommitted reads?" : "Discard reviewed rejected request?"}</DialogTitle><DialogDescription>{session.attempt?.status === "uncertain" ? "The result of the captured movement is still uncertain. Exit and discard are blocked until its exact request has been retried and confirmed or rejected by the server." : confirmation === "exit" ? "Uncommitted reads and unacknowledged issues will leave this session. Server-confirmed movements and their audit history remain saved." : confirmation === "clear" ? "Only queued reads will be removed. No checkout or return is performed, and the completed session list remains." : "The server rejected this captured request and you reviewed the current records. Removing it does not act on a newer loan or change any saved movement."}</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" onClick={() => setConfirmation(null)} disabled={busy}>Continue scanning</Button>{session.attempt?.status === "uncertain" ? <Button onClick={async () => { setConfirmation(null); await retry(); }} disabled={busy || paused}>Retry same request</Button> : <Button onClick={confirmLocalAction} disabled={busy || paused || confirmation === "exit" && !!session.attempt}>{confirmation === "exit" ? "Exit scanning" : confirmation === "clear" ? "Clear queue" : "Discard rejected request"}</Button>}</DialogFooter></DialogContent></Dialog>
    </section>;
}
