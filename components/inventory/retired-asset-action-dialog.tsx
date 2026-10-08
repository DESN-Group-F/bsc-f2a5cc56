"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ReceiptAction } from "@/components/ui/receipt-action";
import { MotionDisclosure } from "@/components/ui/workspace-motion";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { BatteryRecord, InventorySnapshot } from "@/lib/domain";
import type { WriteAction } from "@/lib/client/inventory-contracts";
import { formatTime } from "@/lib/client-utils";
import { getRolePermissions } from "@/lib/permissions";
import { captureRetiredAssetAttempt, recoverRetiredAssetAttempt, retiredAssetFailureStatus, retiredAssetStorageKey, verifyRetiredAssetReceipt, type RetiredAssetAttempt, type RetiredAssetPayload, type RetiredAssetReceipt } from "@/lib/retired-asset-actions";
import styles from "./retired-asset-action-dialog.module.css";

export type RetiredAssetReview = {
  kind: RetiredAssetPayload["kind"];
  batteries: BatteryRecord[];
  attempt?: RetiredAssetAttempt;
};

export type RetiredAssetActionDialogProps = {
  data: InventorySnapshot;
  review: RetiredAssetReview;
  write: WriteAction;
  onChanged: () => Promise<unknown> | unknown;
  onClose: () => void;
  onVerified?: (receipt: RetiredAssetReceipt) => void;
  onBusyChange?: (locked: boolean) => void;
  paused?: boolean;
};

function message(error: unknown) { return error instanceof Error ? error.message : "The request could not be confirmed."; }
function notifyRecovery() { window.dispatchEvent(new Event("battery-retired-action-recovery")); }

export function RetiredAssetActionDialog({ data, review, write, onChanged, onClose, onVerified, onBusyChange, paused = false }: RetiredAssetActionDialogProps) {
  const [context] = useState(() => ({ actorAccountId: data.user.id, dataset: data.dataset }));
  const [reviewed] = useState(() => structuredClone(review));
  const [reviewedItems] = useState(() => reviewed.attempt?.payload.items ?? reviewed.batteries.map(battery => ({ batteryId: battery.id, version: battery.version, tagId: battery.tagId })));
  const [attempt, setAttempt] = useState<RetiredAssetAttempt | null>(reviewed.attempt ?? null);
  const captured = useRef<RetiredAssetAttempt | null>(reviewed.attempt ?? null);
  const [busy, setBusy] = useState(false), busyRef = useRef(false);
  const [receipt, setReceipt] = useState<RetiredAssetReceipt | null>(null);
  const verified = useRef<RetiredAssetReceipt | null>(null);
  const [error, setError] = useState(""), [storageError, setStorageError] = useState("");
  const [rejected, setRejected] = useState(false), [refreshError, setRefreshError] = useState("");
  const [deleteText, setDeleteText] = useState("");
  const mounted = useRef(true), currentContext = useRef(context);
  const key = retiredAssetStorageKey(context.actorAccountId, context.dataset);
  const kind = reviewed.attempt?.payload.kind ?? reviewed.kind, purge = kind === "purge";
  const permissions = getRolePermissions(data.user.role);
  const permitted = purge ? permissions.purgeRetiredBatteries : permissions.recoverRetiredBatteries;
  const contextChanged = context.actorAccountId !== data.user.id || context.dataset !== data.dataset;
  const items = attempt?.payload.items ?? reviewedItems;
  const invalidReview = !items.length || items.length > 100 || new Set(items.map(item => item.batteryId)).size !== items.length || !reviewed.attempt && reviewed.batteries.some(battery => battery.lifecycleStatus !== "scrapped" || battery.loanId);
  const bindingChanged = !attempt && !receipt && reviewed.batteries.some(before => {
    const current = data.batteries.find(battery => battery.id === before.id);
    return !current || current.lifecycleStatus !== "scrapped" || !!current.loanId || current.version !== before.version || current.tagId !== before.tagId;
  });
  const locked = busy || !!attempt || !!storageError;
  const confirmation = receipt ? { identity: receipt.requestId, count: receipt.items.length, text: `${receipt.items.length} ${receipt.items.length === 1 ? "battery" : "batteries"} ${purge ? "deleted" : "recovered"}` } : null;
  const actionName = purge ? `Delete selected battery records (${items.length})` : `Recover selected batteries (${items.length})`;

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { currentContext.current = { actorAccountId: data.user.id, dataset: data.dataset }; }, [data.user.id, data.dataset]);
  useEffect(() => { onBusyChange?.(locked); return () => onBusyChange?.(false); }, [locked, onBusyChange]);

  function persist(input: RetiredAssetAttempt) {
    const raw = sessionStorage.getItem(key);
    const previous = recoverRetiredAssetAttempt(raw, context.actorAccountId, context.dataset);
    if (raw && (!previous || previous.payload.requestId !== input.payload.requestId)) throw new Error("Another preserved retired battery request must be resolved first.");
    sessionStorage.setItem(key, JSON.stringify(input));
    notifyRecovery();
  }
  function clear(input: RetiredAssetAttempt) {
    const raw = sessionStorage.getItem(key);
    const previous = recoverRetiredAssetAttempt(raw, context.actorAccountId, context.dataset);
    if (raw && (!previous || previous.payload.requestId !== input.payload.requestId)) throw new Error("The saved recovery request changed. It has not been replaced or removed.");
    if (previous) sessionStorage.removeItem(key);
    notifyRecovery();
  }
  function restoreStorage() {
    const input = captured.current;
    if (!input || busyRef.current || contextChanged) return;
    try {
      if (verified.current || rejected) { clear(input); setAttempt(null); }
      else persist(input);
      setStorageError("");
    } catch (failure) { setStorageError(message(failure)); }
  }
  async function refreshRecords() {
    if (contextChanged || busyRef.current) return;
    setRefreshError("");
    try { await onChanged(); }
    catch (failure) { if (mounted.current) setRefreshError(`The recorded outcome is unchanged. Current records could not refresh: ${message(failure)}`); }
  }
  async function submit(retry = false) {
    if (busyRef.current || paused || contextChanged || !permitted || receipt || storageError || rejected) return;
    if (!retry && (attempt || invalidReview || bindingChanged || purge && deleteText !== "DELETE")) return;
    if (retry && !captured.current) return;
    let input = captured.current;
    try {
      input ??= captureRetiredAssetAttempt(context.actorAccountId, context.dataset, { requestId: crypto.randomUUID(), kind, items });
      captured.current = input;
      setAttempt(input);
      persist(input);
    } catch (failure) {
      if (captured.current) setStorageError(`No request was sent. Recovery must be preserved before confirmation: ${message(failure)}`);
      else setError(`The review could not be captured. No request was sent: ${message(failure)}`);
      return;
    }
    const original = input;
    busyRef.current = true; setBusy(true); setError("");
    try {
      const result = await write("retired_asset", original.payload);
      const confirmed = verifyRetiredAssetReceipt(result, original);
      verified.current = confirmed;
      const sameContext = currentContext.current.actorAccountId === context.actorAccountId && currentContext.current.dataset === context.dataset;
      if (mounted.current && sameContext) {
        setReceipt(confirmed);
        try { onVerified?.(confirmed); }
        catch (failure) { setRefreshError(`The outcome is confirmed. The selection view could not update: ${message(failure)}`); }
      }
      try { clear(original); if (mounted.current) { setAttempt(null); setStorageError(""); } }
      catch (failure) { if (mounted.current) setStorageError(`The outcome is confirmed, but browser recovery could not be cleared: ${message(failure)}`); }
      if (mounted.current && sameContext) {
        try { await onChanged(); }
        catch (failure) { if (mounted.current) setRefreshError(`The outcome is confirmed. Current records could not refresh: ${message(failure)}`); }
      }
    } catch (failure) {
      if (mounted.current) {
        setError(message(failure));
        if (retiredAssetFailureStatus(failure) === "rejected") {
          setRejected(true);
          try { clear(original); setAttempt(null); }
          catch (storageFailure) { setStorageError(`This request was rejected, but browser recovery could not be cleared: ${message(storageFailure)}`); }
        }
      }
    } finally { busyRef.current = false; if (mounted.current) setBusy(false); }
  }

  return <Dialog open onOpenChange={open => { if (!open && !locked) onClose(); }}>
    <DialogContent className={`record-dialog ${styles.dialog}`} showCloseButton={!locked} onEscapeKeyDown={event => { if (locked) event.preventDefault(); }} onInteractOutside={event => { if (locked) event.preventDefault(); }}>
      <DialogHeader>
        <DialogTitle>{purge ? "Delete scrapped battery records" : "Recover scrapped batteries"}</DialogTitle>
        <DialogDescription>{items.length} individually identified {items.length === 1 ? "battery" : "batteries"} · {context.dataset === "demo" ? "Demonstration inventory" : "Working inventory"}</DialogDescription>
      </DialogHeader>
      <div className={purge ? styles.destructiveNotice : styles.notice}>
        {purge ? <><strong>This deletion is irreversible.</strong><p>Delete the information and complete history of each selected battery, including loans, charging, inspections and observations. Associated battery snapshots are cleared; other records and independent human notes remain. A minimal record of its battery ID, deleting account and deletion time remains. The battery ID and registered tag cannot be reused.</p></> : <><strong>Return these scrapped batteries to the active register, in store.</strong><p>Keep their identity, specifications, responsible owner, registration and first-use dates, and complete history, including earlier inspection findings. No checkout is created. Recovery records an inventory change and does not establish physical condition or safety approval.</p></>}
      </div>
      <div className={styles.reviewHeading}><strong>Reviewed assets</strong><span>{items.length} selected</span></div>
      <div className={styles.reviewList}><Table><TableHeader><TableRow><TableHead>Battery</TableHead><TableHead>Reviewed version / tag</TableHead><TableHead>Reviewed status</TableHead></TableRow></TableHeader><TableBody>{items.map(item => <TableRow key={item.batteryId}><TableCell><strong className={styles.identifier}>{item.batteryId}</strong><span className="cell-secondary">{reviewed.batteries.find(battery => battery.id === item.batteryId)?.name || "Name unavailable"}</span></TableCell><TableCell>Version {item.version}<span className="cell-secondary">{item.tagId || "No tag registered"}</span></TableCell><TableCell>Scrapped</TableCell></TableRow>)}</TableBody></Table></div>
      {contextChanged && <p className="form-error" role="alert">The native account or inventory changed. The original request remains bound to its captured context.</p>}
      {!permitted && <p className="form-error" role="alert">{purge ? "Only administrators can delete scrapped battery records." : "This account cannot recover scrapped batteries."}</p>}
      {invalidReview && <p className="form-error" role="alert">Review 1–100 distinct scrapped batteries without active loans. Permanently removed assets cannot be recovered or deleted here.</p>}
      {bindingChanged && <p className="form-error" role="alert">The state, tag or version of a reviewed battery changed. Close this review and reopen the current records before confirming.</p>}
      <MotionDisclosure open={purge && !attempt && !receipt && !rejected}><div className="form-field"><Label htmlFor="retired-delete-confirmation">Type DELETE to confirm irreversible deletion</Label><Input id="retired-delete-confirmation" value={deleteText} autoComplete="off" onChange={event => setDeleteText(event.target.value)} disabled={locked || paused || contextChanged}/></div></MotionDisclosure>
      <MotionDisclosure open={!!attempt && !receipt}>
        <div className={styles.recoveryNotice} role="alert"><strong>{busy ? "Submitting preserved request" : "Exact request awaiting confirmation"}</strong><p>Request {attempt?.payload.requestId}. Its original action, IDs, versions and tags remain fixed. Retry resolves this request only.</p></div>
      </MotionDisclosure>
      <MotionDisclosure open={!!receipt}>
        <div className={styles.success} role="status"><strong>{confirmation?.text}</strong><p>{receipt?.items.map(item => item.batteryId).join(", ")}</p><p>Confirmed {receipt ? formatTime(receipt.at) : ""} · Request {receipt?.requestId}</p></div>
      </MotionDisclosure>
      <MotionDisclosure open={!!error || rejected}><div className="form-error" role="alert">{error}{rejected && <p>This reviewed request was rejected. Close the review and refresh current records before creating another request.</p>}</div></MotionDisclosure>
      <MotionDisclosure open={!!storageError}><div className="form-error" role="alert"><p>{storageError}</p><Button variant="outline" onClick={restoreStorage} disabled={busy || contextChanged || !attempt}>Restore request recovery</Button></div></MotionDisclosure>
      <MotionDisclosure open={!!refreshError}><div className="form-error" role="alert"><p>{refreshError}</p><Button variant="outline" onClick={refreshRecords} disabled={busy || contextChanged}>Refresh current records</Button></div></MotionDisclosure>
      <DialogFooter>
        <Button variant="outline" onClick={() => { if (!locked) onClose(); }} disabled={locked}>{receipt || rejected ? "Close review" : "Cancel"}</Button>
        <ReceiptAction pending={busy} confirmation={confirmation} reviewKey={`${kind}/${items.map(item => `${item.batteryId}:${item.version}:${item.tagId ?? ""}`).join("/")}`} actionLabel={attempt ? "Retry exact retired battery action" : actionName} onClick={() => submit(!!attempt)} disabled={busy || !!storageError || paused || contextChanged || !permitted || !!receipt || rejected || !attempt && (invalidReview || bindingChanged || purge && deleteText !== "DELETE")}>{attempt ? "Retry exact retired battery action" : actionName}</ReceiptAction>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
