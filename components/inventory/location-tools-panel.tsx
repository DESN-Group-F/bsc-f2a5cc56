"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BluetoothOff, FlaskConical, MapPin, Pencil, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LoadingState } from "@/components/ui/loading-state";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { RecordPicker } from "@/components/inventory/record-picker";
import { useLocationRecovery } from "@/hooks/use-location-recovery";
import { isActiveBattery } from "@/lib/battery-lifecycle";
import { formatTime, saveDownloadAttachment } from "@/lib/client-utils";
import { inventoryResponse } from "@/lib/client/inventory-request";
import { captureLocationAttempt, clearLocationAttempt, locationFailureStatus, locationRequestStorageKey, persistLocationAttempt, verifyLocationReceipt, type LocationAttempt, type LocationReceipt } from "@/lib/client/location-request";
import type { BatteryRecord, InventorySnapshot } from "@/lib/domain";
import { roomPickerOptions, SUPPORTED_BUILDING_ID } from "@/lib/location-catalog";
import { locationBeaconRequestSchema, locationCaptureSchema, type LocationBeacon, type LocationDirectorySnapshot } from "@/lib/location-observations";
import styles from "./location-tools-panel.module.css";

type RoomBinding = { roomId: string; roomVersion: number; buildingVersion: number };
type BeaconForm = { editing: LocationBeacon | null; label: string; identifier: string; room: RoomBinding | null; active: boolean };
const emptyForm = (): BeaconForm => ({ editing: null, label: "", identifier: "", room: null, active: true });
function messageOf(error: unknown) { return error instanceof Error ? error.message : "The location request could not be confirmed."; }
function announceRecovery() { window.dispatchEvent(new Event("battery-location-recovery")); }

export function LocationToolsPanel({ data, ready, onChanged, onClose }: {
  data: InventorySnapshot; ready: boolean; onChanged: () => Promise<void>; onClose: () => void;
}) {
  const [context] = useState({ actorAccountId: data.user.id, dataset: data.dataset });
  const [directory, setDirectory] = useState<LocationDirectorySnapshot | null>(null);
  const [loading, setLoading] = useState(true), [directoryError, setDirectoryError] = useState("");
  const [inMemoryAttempt, setAttempt] = useState<LocationAttempt | null>(null);
  const { recovery, read: readSavedRecovery } = useLocationRecovery(context.actorAccountId);
  const persistedAttempt = recovery.attempts.find(value => value.dataset === context.dataset) ?? null;
  const attempt = inMemoryAttempt ?? persistedAttempt;
  const attemptRef = useRef<LocationAttempt | null>(null), busyRef = useRef(false), mounted = useRef(true);
  const directoryController = useRef<AbortController | null>(null), directorySequence = useRef(0);
  const [busy, setBusy] = useState(false), [localStorageError, setStorageError] = useState("");
  const storageConflict = inMemoryAttempt && persistedAttempt && JSON.stringify(inMemoryAttempt.payload) !== JSON.stringify(persistedAttempt.payload) ? "A different original request is retained in this browser. Export the recovery record for review; no new request will be sent." : "";
  const storageError = localStorageError || recovery.error || storageConflict;
  const [error, setError] = useState(""), [receipt, setReceipt] = useState<LocationReceipt | null>(null), [refreshNeeded, setRefreshNeeded] = useState(false);
  const [form, setForm] = useState<BeaconForm>(emptyForm);
  const [battery, setBattery] = useState<BatteryRecord | null>(null), [selectedBeacons, setSelectedBeacons] = useState<LocationBeacon[]>([]);
  const contextChanged = context.actorAccountId !== data.user.id || context.dataset !== data.dataset;
  const admin = data.user.role === "admin", canManage = admin && directory?.capabilities.manageBeacons === true;
  const canSimulate = admin && context.dataset === "demo" && directory?.capabilities.demoSimulation === true;
  const blocked = busy || loading || !!directoryError || !!attempt || !directory || !!storageError || !ready || contextChanged || refreshNeeded;
  const exitBlocked = busy || !!attempt || !!storageError;
  const storageKey = locationRequestStorageKey(context.actorAccountId, context.dataset);

  const remember = useCallback((value: LocationAttempt | null) => { attemptRef.current = value; setAttempt(value); }, []);
  const stopDirectory = useCallback(() => { directorySequence.current++; directoryController.current?.abort(); }, []);
  function readRecovery() {
    try {
      const latest = readSavedRecovery();
      if (latest.error) throw new Error(latest.error);
      const saved = latest.attempts.find(value => value.dataset === context.dataset) ?? null;
      const current = attemptRef.current;
      if (current && saved && JSON.stringify(current.payload) !== JSON.stringify(saved.payload)) throw new Error("A different original request is retained in this browser. Export the recovery record for review; no new request will be sent.");
      setStorageError(""); announceRecovery();
    } catch (failure) { setStorageError(messageOf(failure)); }
  }

  const loadDirectory = useCallback(async () => {
    if (!mounted.current) return;
    const sequence = ++directorySequence.current;
    directoryController.current?.abort();
    const controller = new AbortController();
    directoryController.current = controller;
    let timedOut = false;
    const timer = window.setTimeout(() => { timedOut = true; controller.abort(); }, 30_000);
    setLoading(true); setDirectoryError("");
    try {
      const result = await inventoryResponse<LocationDirectorySnapshot>(await fetch(`/api/locations?dataset=${context.dataset}`, { cache: "no-store", signal: controller.signal }));
      if (result.dataset !== context.dataset || !Array.isArray(result.beacons) || result.capabilities?.hardwareIngestion !== false) throw new Error("The room beacon directory returned an unexpected capability or inventory. Refresh before continuing.");
      if (controller.signal.aborted) throw new Error("The room beacon request was interrupted.");
      if (mounted.current && sequence === directorySequence.current) { setDirectory(result); setDirectoryError(""); }
    } catch (failure) {
      if (!mounted.current || sequence !== directorySequence.current || controller.signal.aborted && !timedOut) return;
      const message = timedOut ? "The room beacon directory is taking too long to respond. Check your connection, then refresh the directory." : failure instanceof TypeError || failure instanceof SyntaxError ? "The room beacon directory could not be reached. Check your connection, then refresh the directory." : messageOf(failure);
      setDirectoryError(message); throw new Error(message);
    } finally {
      window.clearTimeout(timer);
      if (mounted.current && sequence === directorySequence.current) setLoading(false);
    }
  }, [context.dataset]);

  useEffect(() => {
    mounted.current = true;
    let active = true;
    void Promise.resolve().then(() => { if (active) return loadDirectory(); }).catch(() => {});
    return () => { active = false; mounted.current = false; stopDirectory(); };
  }, [loadDirectory, stopDirectory]);

  useEffect(() => {
    if (!exitBlocked) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [exitBlocked]);

  async function refresh() {
    if (busyRef.current || contextChanged) return;
    busyRef.current = true; setBusy(true); setLoading(true); setError("");
    try { await Promise.all([loadDirectory(), onChanged()]); setRefreshNeeded(false); }
    catch (failure) { setError(`Refresh could not complete. ${messageOf(failure)}`); setRefreshNeeded(true); }
    finally { busyRef.current = false; setBusy(false); }
  }

  async function submit(original: LocationAttempt) {
    if (busyRef.current || contextChanged || original.actorAccountId !== data.user.id || original.dataset !== data.dataset) return;
    if (!navigator.locks) { setError("This browser cannot safely retain location requests across tabs. Open the inventory in a browser that supports secure request recovery."); return; }
    busyRef.current = true; setBusy(true); setError(""); setReceipt(null);
    try { await navigator.locks.request(storageKey, { ifAvailable: true }, async lock => {
    if (!lock) { setError("Another tab is resolving a location request. Finish it there, then check recovery before trying again."); return; }
    const sending = { ...original, status: "submitted" as const, message: "Waiting for the server to confirm this exact request." };
    remember(sending);
    let sent = false;
    try {
      persistLocationAttempt(sending); setStorageError(""); announceRecovery();
      let body: unknown;
      if (sending.kind === "beacon") {
        const { action, ...payload } = sending.payload;
        sent = true;
        body = await inventoryResponse<{ result: unknown }>(await fetch("/api/locations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dataset: sending.dataset, action, payload }) }));
      } else {
        sent = true;
        body = await inventoryResponse<{ result: unknown }>(await fetch("/api/location-observations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dataset: sending.dataset, payload: sending.payload }) }));
      }
      const confirmed = verifyLocationReceipt((body as { result: unknown }).result, sending);
      clearLocationAttempt(sending); remember(null); announceRecovery(); setReceipt(confirmed);
      if (sending.kind === "beacon") setForm(emptyForm());
      else { setBattery(null); setSelectedBeacons([]); }
      try { await Promise.all([loadDirectory(), onChanged()]); setRefreshNeeded(false); }
      catch { setRefreshNeeded(true); setError("The server confirmed this result, but the inventory could not refresh. Refresh before another change."); }
    } catch (failure) {
      const failed = { ...sending, status: sent ? locationFailureStatus(failure) : "uncertain" as const, message: sent ? messageOf(failure) : `Nothing was sent. ${messageOf(failure)}` };
      remember(failed);
      try { persistLocationAttempt(failed); announceRecovery(); }
      catch (storageFailure) { setStorageError(messageOf(storageFailure)); }
      setError(failed.message);
    }
    }); } catch (failure) { setError(messageOf(failure)); }
    finally { busyRef.current = false; setBusy(false); }
  }

  function saveBeacon(event: React.FormEvent) {
    event.preventDefault(); if (blocked || !canManage) return;
    try {
      if (!form.room || !roomOptions.some(room => room.id === form.room?.roomId)) throw new Error(context.dataset === "live" ? "Choose an existing verified, selectable J18 room." : "Choose an existing selectable J18 room.");
      const fields = { requestId: crypto.randomUUID(), id: form.editing?.id ?? `BEACON-${crypto.randomUUID()}`, label: form.label, identifier: form.identifier, ...form.room, active: form.active };
      const payload = locationBeaconRequestSchema.parse(form.editing ? { ...fields, action: "update", expectedVersion: form.editing.version } : { ...fields, action: "create" });
      void submit(captureLocationAttempt(context.actorAccountId, context.dataset, { kind: "beacon", payload }));
    } catch (failure) { setError(messageOf(failure)); }
  }

  function simulate(event: React.FormEvent) {
    event.preventDefault(); if (blocked || !canSimulate) return;
    try {
      if (!battery?.tagId || !isActiveBattery(battery)) throw new Error("Choose an active battery with a registered tag.");
      const capturedAt = new Date().toISOString();
      const payload = locationCaptureSchema.parse({ requestId: crypto.randomUUID(), source: "demo_room_scan", batteryId: battery.id, tagId: battery.tagId, expectedBatteryVersion: battery.version, capturedAt, candidates: selectedBeacons.map(beacon => ({ beaconId: beacon.id, version: beacon.version, detectedAt: capturedAt })) });
      void submit(captureLocationAttempt(context.actorAccountId, context.dataset, { kind: "capture", payload }));
    } catch (failure) { setError(messageOf(failure)); }
  }

  function dismissRejected() {
    if (busyRef.current || attempt?.status !== "rejected") return;
    try { clearLocationAttempt(attempt); remember(null); setStorageError(""); setError(""); announceRecovery(); void refresh(); }
    catch (failure) { setStorageError(messageOf(failure)); }
  }

  function exportRecovery() {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw && !attempt) throw new Error("There is no saved location request to export.");
      saveDownloadAttachment({ blob: new Blob([raw ?? JSON.stringify(attempt, null, 2)], { type: "application/json" }), filename: `location-recovery-${context.dataset}.json` });
    } catch (failure) { setError(messageOf(failure)); }
  }

  const roomOptions = roomPickerOptions(data.rooms.filter(room => context.dataset === "demo" || !room.isPlaceholder), SUPPORTED_BUILDING_ID);
  const activeBeacons = directory?.beacons.filter(beacon => beacon.active && beacon.roomSelectable) ?? [];
  const staleBeacons = selectedBeacons.filter(selected => !activeBeacons.some(current => current.id === selected.id && current.version === selected.version && current.roomId === selected.roomId));
  const visibleBeacons = [...activeBeacons, ...selectedBeacons.filter(selected => !activeBeacons.some(current => current.id === selected.id))];
  const roomCount = new Set(selectedBeacons.map(beacon => beacon.roomId)).size;
  const prediction = !selectedBeacons.length ? "Unresolved: no room evidence. No Last observed location will be recorded." : roomCount > 1 ? "Ambiguous: selected beacons span rooms. No Last observed location will be recorded." : `Room evidence: ${selectedBeacons[0].roomName}. The server validates the captured versions before recording.`;
  const exitReason = busy ? "Waiting for the request or refresh to finish." : attempt ? "Resolve the original request before leaving. Its exact payload is retained in this browser." : storageError ? "Resolve recovery storage before leaving. The saved record has not been discarded." : "";

  return <Dialog open onOpenChange={open => { if (!open && !exitBlocked) onClose(); }}>
    <DialogContent className={styles.dialog} showCloseButton={false} onEscapeKeyDown={event => { if (exitBlocked) event.preventDefault(); }} onInteractOutside={event => event.preventDefault()}>
      <header className={styles.header}>
        <div><DialogTitle>Room beacons &amp; location tests</DialogTitle><DialogDescription>Configure room evidence for Last observed location. {context.dataset === "demo" ? "Demonstration inventory" : "Working inventory"}.</DialogDescription></div>
        <Button variant="outline" onClick={onClose} disabled={exitBlocked}>Close</Button>
      </header>
      <div className={styles.body}>
        <section className={styles.capabilities} aria-label="Location capabilities">
          <BluetoothOff size={22} aria-hidden="true"/><div><h2>Hardware ingestion disabled</h2><p>Room beacons and phone Bluetooth scanning are planned and not installed or validated. This panel does not connect to hardware.</p>
            <dl className={styles.capabilityList}><div><dt>Hardware</dt><dd>Disabled</dd></div><div><dt>Beacon configuration</dt><dd>{directory ? directory.capabilities.manageBeacons ? "Administrator access" : "Read only" : "Awaiting server"}</dd></div><div><dt>Demo simulator</dt><dd>{directory ? directory.capabilities.demoSimulation ? "Available" : "Unavailable" : "Awaiting server"}</dd></div></dl>
          </div>
        </section>

        {contextChanged && <p className={styles.error} role="alert">The account or inventory changed. This panel retains the original context; close it before continuing.</p>}
        {error && <p className={styles.error} role="alert">{error}</p>}
        {storageError && <section className={styles.recovery} aria-label="Recovery storage issue"><h2>Recovery needs attention</h2><p role="alert">{storageError}</p><div className={styles.actions}><Button variant="outline" onClick={exportRecovery} disabled={busy}>Export recovery record</Button><Button variant="outline" onClick={readRecovery} disabled={busy}>Check recovery storage</Button></div></section>}

        {attempt && <section className={styles.recovery} aria-label="Original location request"><h2>{attempt.status === "rejected" ? "Request rejected by the server" : "Original request retained"}</h2><p>{attempt.message}</p><dl className={styles.facts}><dt>Request</dt><dd className={styles.identifier}>{attempt.payload.requestId}</dd><dt>Operation</dt><dd>{attempt.kind === "beacon" ? `${attempt.payload.action === "create" ? "Create" : "Update"} beacon mapping: ${attempt.payload.label}` : `One simulated scan: ${attempt.payload.batteryId}`}</dd><dt>Inventory</dt><dd>{attempt.dataset === "demo" ? "Demonstration inventory" : "Working inventory"}</dd></dl>
          <details><summary>Captured request details</summary><pre>{JSON.stringify(attempt.payload, null, 2)}</pre></details>
          <div className={styles.actions}>{attempt.status === "rejected" ? <Button variant="outline" disabled={busy} onClick={dismissRejected}>Acknowledge rejection</Button> : <Button disabled={busy || contextChanged} onClick={() => void submit(attempt)}>Retry the same request</Button>}<Button variant="outline" onClick={exportRecovery} disabled={busy}>Export recovery record</Button></div>
          <p className={styles.hint}>{attempt.status === "rejected" ? "The server reserved this rejection. A later retry cannot apply the rejected operation." : "Retry preserves the original battery, tag, versions, evidence time and request ID. No new scan is captured."}</p>
        </section>}

        {receipt && <section className={styles.result} aria-label="Confirmed location result" role="status"><h2>{"beacon" in receipt ? "Beacon mapping saved" : receipt.outcome === "recorded" ? "Last observed location recorded" : receipt.outcome === "ambiguous" ? "Ambiguous room evidence" : "Room evidence unresolved"}</h2>
          {"beacon" in receipt ? <p>{receipt.beacon.label} → {receipt.beacon.roomName}. This mapping is configuration only; hardware remains disabled.</p> : <><p>{receipt.outcome === "recorded" ? `${receipt.batteryId}: ${receipt.room?.buildingId} ${receipt.room?.buildingName} / ${receipt.room?.name}.` : "No Last observed location was recorded. The test outcome was retained in the audit history."}</p><dl className={styles.facts}><dt>Source</dt><dd>{receipt.source}</dd><dt>Device capture time</dt><dd>{formatTime(receipt.capturedAt)}</dd><dt>Server received</dt><dd>{formatTime(receipt.receivedAt)}</dd></dl></>}
          <p className={styles.hint}>Server-confirmed{receipt.replayed ? " original request (recovered receipt)" : " result"}. Request {receipt.requestId}.</p>
        </section>}
        {refreshNeeded && <Button variant="outline" onClick={() => void refresh()} disabled={busy || contextChanged}><RefreshCw size={16}/>Refresh inventory</Button>}

        <section className={styles.section} aria-labelledby="beacon-directory-heading"><div className={styles.sectionHeading}><div><h2 id="beacon-directory-heading"><MapPin size={18} aria-hidden="true"/>Room beacon directory</h2><p>Mappings use existing selectable J18 rooms. Placeholder rooms remain labelled.</p></div><Button variant="outline" size="sm" disabled={busy || loading || contextChanged} onClick={() => void loadDirectory().catch(() => {})}><RefreshCw size={15}/>Refresh directory</Button></div>
          {loading && <LoadingState compact label={directory ? "Refreshing room beacons" : "Loading room beacons"} detail={directory ? "Your last received directory remains visible while it updates." : "Retrieving room mappings and server capabilities."} />}{directoryError && <p className={styles.error} role="alert">{directoryError}</p>}
          {directory && !directory.beacons.length && <p className={styles.empty}>No room beacons configured.</p>}
          {!!directory?.beacons.length && <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Beacon</th><th>Mapped room</th><th>State</th>{canManage && <th><span className="sr-only">Actions</span></th>}</tr></thead><tbody>{directory.beacons.map(beacon => <tr key={beacon.id}><td><strong>{beacon.label}</strong><span className={styles.identifier}>{beacon.identifier}</span><small>{beacon.id} · Version {beacon.version}</small></td><td>{beacon.buildingId} {beacon.buildingName}<span>{beacon.roomName}</span></td><td>{beacon.active ? "Configured" : "Inactive"}<small>Hardware unvalidated</small></td>{canManage && <td><Button variant="ghost" size="sm" disabled={blocked} onClick={() => { setError(""); setForm({ editing: beacon, label: beacon.label, identifier: beacon.identifier, active: beacon.active, room: { roomId: beacon.roomId, roomVersion: beacon.roomVersion, buildingVersion: beacon.buildingVersion } }); }}><Pencil size={14}/>Edit</Button></td>}</tr>)}</tbody></table></div>}
          {!admin && <p className={styles.hint}>Staff can view the directory. Administrators manage mappings and demonstration tests.</p>}
        </section>

        {canManage && <section className={styles.section} aria-labelledby="beacon-config-heading"><h2 id="beacon-config-heading">{form.editing ? `Edit ${form.editing.label}` : "Configure a room beacon"}</h2><p className={styles.hint}>Set a beacon identifier and its room once. Reconfigure only when its assignment changes.</p>
          <form className={styles.form} onSubmit={saveBeacon}><div className={styles.formGrid}><div><Label htmlFor="beacon-label">Beacon label</Label><Input id="beacon-label" value={form.label} onChange={event => setForm({ ...form, label: event.target.value })} maxLength={120} required disabled={blocked}/></div><div><Label htmlFor="beacon-identifier">Beacon identifier</Label><Input id="beacon-identifier" value={form.identifier} onChange={event => setForm({ ...form, identifier: event.target.value })} maxLength={128} required disabled={blocked}/></div></div>
            <div><Label htmlFor="beacon-room">{context.dataset === "live" ? "Existing verified J18 room" : "Existing J18 room"}</Label><RecordPicker id="beacon-room" options={roomOptions} value={form.room?.roomId ?? ""} placeholder="Choose a room" disabled={blocked || !roomOptions.length} onChange={roomId => { const room = data.rooms.find(item => item.id === roomId), building = data.buildings.find(item => item.id === room?.buildingId); setForm({ ...form, room: room && building ? { roomId, roomVersion: room.version, buildingVersion: building.version } : null }); }}/>{context.dataset === "live" && !roomOptions.length && <p className={styles.hint}>No verified selectable J18 rooms are available. Configure a verified room in the room directory before saving a working-inventory beacon.</p>}</div>
            <label className={styles.checkbox}><input type="checkbox" checked={form.active} onChange={event => setForm({ ...form, active: event.target.checked })} disabled={blocked}/>Mapping active</label>
            <div className={styles.actions}><Button type="submit" disabled={blocked || !roomOptions.some(room => room.id === form.room?.roomId)}>{form.editing ? "Save mapping changes" : "Save beacon mapping"}</Button>{form.editing && <Button type="button" variant="outline" disabled={blocked} onClick={() => setForm(emptyForm())}>Cancel edit</Button>}</div>
          </form>
        </section>}

        {canSimulate && <section className={styles.section} aria-labelledby="location-simulator-heading"><h2 id="location-simulator-heading"><FlaskConical size={19} aria-hidden="true"/>Simulate one battery scan</h2><p className={styles.hint}>Demonstration only. Choose the battery and room evidence, then submit one dated event. This does not change a checkout, responsible owner or registered storage.</p>
          <form onSubmit={simulate} className={styles.form}><div><Label htmlFor="location-test-battery">Battery with a registered tag</Label><RecordPicker id="location-test-battery" options={data.batteries.filter(item => isActiveBattery(item) && item.tagId).map(item => ({ id: item.id, label: `${item.id} — ${item.name}` }))} value={battery?.id ?? ""} placeholder="Choose one battery" disabled={blocked} onChange={id => setBattery(data.batteries.find(item => item.id === id) ?? null)}/></div>
            {battery && <p className={styles.hint}>Captured selection: {battery.id} · Tag {battery.tagId} · Version {battery.version}</p>}
            <fieldset disabled={blocked} className={styles.beaconChoices}><legend>Room beacons detected in this simulated event</legend>{visibleBeacons.map(current => {
              const selected = selectedBeacons.find(item => item.id === current.id), beacon = selected ?? current, stale = staleBeacons.some(item => item.id === beacon.id);
              return <label key={beacon.id} className={styles.checkbox}><input type="checkbox" checked={!!selected} disabled={!selected && selectedBeacons.length >= 16} onChange={event => setSelectedBeacons(previous => event.target.checked ? [...previous, current] : previous.filter(item => item.id !== beacon.id))}/><span><strong>{beacon.label}</strong> — {beacon.roomName}<small>Version {beacon.version}{stale ? " · Directory changed; remove and choose again." : ""}</small></span></label>;
            })}{!visibleBeacons.length && <p>No active room beacons are configured.</p>}<Button type="button" variant="outline" size="sm" disabled={blocked || !selectedBeacons.length} onClick={() => setSelectedBeacons([])}>Use no room evidence</Button></fieldset>
            <div className={styles.preview}><strong>{!selectedBeacons.length ? "Unknown room" : roomCount > 1 ? "Multiple rooms" : "One room"}</strong><p>{prediction}</p><p className={styles.hint}>Device capture time is set when submitted. Up to 16 beacon candidates are permitted; no signal strength is invented.</p></div>
            <Button type="submit" disabled={blocked || !battery || !!staleBeacons.length}>Submit one simulated scan</Button>
          </form>
        </section>}
      </div>
      <footer className={styles.footer}><p>{exitReason || "Last observed location is dated evidence, not a live position."}</p><Button variant="outline" disabled={exitBlocked} onClick={onClose}>Close location tools</Button></footer>
    </DialogContent>
  </Dialog>;
}
