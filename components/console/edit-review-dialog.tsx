"use client";

import { AlertTriangle, CheckCircle2, CircleDashed, Loader2, XCircle } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { BatteryRecord, InventorySnapshot } from "@/lib/domain";
import type { OperatorEditPayload } from "@/lib/operator-edit";
import { currentStorageValue, describeValue, fieldLabels, recordValues, storageBuildingValue, type EditableField } from "@/lib/console/battery-edits";
import type { EditResult } from "./use-metadata-edits";
import styles from "./console.module.css";

export type ReviewItem =
  | { batteryId: string; battery: BatteryRecord; ready: true; payload: OperatorEditPayload; fields: EditableField[]; setsBuilding: boolean }
  | { batteryId: string; battery: BatteryRecord | undefined; ready: false; errors: string[] };

export function resultChip(result: EditResult | undefined) {
  if (!result || result.state === "waiting") return <span className={styles.chip} data-tone="muted"><CircleDashed size={12} />Waiting</span>;
  if (result.state === "saving" || result.state === "checking") return <span className={styles.chip} data-tone="info"><Loader2 size={12} className="animate-spin" />{result.state === "saving" ? "Saving" : "Checking"}</span>;
  if (result.state === "saved") return <span className={styles.chip} data-tone="success"><CheckCircle2 size={12} />Saved</span>;
  if (result.state === "not-received") return <span className={styles.chip} data-tone="warning">Not received by the server</span>;
  if (result.state === "unknown") return <span className={styles.chip} data-tone="warning"><AlertTriangle size={12} />Outcome unknown</span>;
  return <span className={styles.chip} data-tone="danger"><XCircle size={12} />Not saved</span>;
}

export function EditReviewDialog({ items, snapshot, results, running, submitted, submitError, onSubmit, onClose, onRetry, onCheck }: {
  items: ReviewItem[]; snapshot: InventorySnapshot; results: Record<string, EditResult>; running: boolean; submitted: boolean; submitError: string;
  onSubmit: () => void; onClose: () => void; onRetry: (requestId: string) => void; onCheck: (requestId: string) => void;
}) {
  const ready = items.filter((item): item is Extract<ReviewItem, { ready: true }> => item.ready);
  const blocked = items.filter((item): item is Extract<ReviewItem, { ready: false }> => !item.ready);
  const fieldCount = ready.reduce((sum, item) => sum + item.fields.length, 0);
  return <Dialog open onOpenChange={(open) => { if (!open && !running) onClose(); }}>
    <DialogContent className={`${styles.portal} max-w-[920px] sm:max-w-[920px]`} onEscapeKeyDown={(event) => { if (running) event.preventDefault(); }} onPointerDownOutside={(event) => event.preventDefault()}>
      <DialogHeader>
        <DialogTitle>{submitted ? "Saving reviewed changes" : `Review ${ready.length} ${ready.length === 1 ? "battery" : "batteries"}`}</DialogTitle>
        <DialogDescription>
          {submitted
            ? "Each battery is saved on its own. A battery that changed since you loaded it is rejected and keeps its current record."
            : `${fieldCount} ${fieldCount === 1 ? "field" : "fields"} will change. Each battery is saved separately and checked against the version you loaded; other batteries are not affected if one is rejected.`}
        </DialogDescription>
      </DialogHeader>
      {submitError && <div className={styles.notice} data-tone="danger"><AlertTriangle size={16} /><p>{submitError}</p></div>}
      {blocked.length > 0 && !submitted && <div className={styles.notice} data-tone="warning"><AlertTriangle size={16} /><div className={styles.noticeBody}>
        <p><strong>{blocked.length} {blocked.length === 1 ? "battery needs" : "batteries need"} attention and will not be saved:</strong></p>
        <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>{blocked.map((item) => <li key={item.batteryId}>{item.batteryId}: {item.errors.join(" ")}</li>)}</ul>
      </div></div>}
      <div className={styles.reviewScroll}>
        <table className={styles.reviewTable}>
          <thead><tr><th style={{ width: 130 }}>Battery</th><th>Changes</th><th style={{ width: 210 }}>{submitted ? "Result" : "Loaded version"}</th></tr></thead>
          <tbody>
            {ready.map((item) => {
              const before = recordValues(item.battery);
              const result = results[item.payload.requestId];
              return <tr key={item.batteryId}>
                <td><strong className={styles.idCell}>{item.batteryId}</strong><div className={styles.muted} style={{ fontSize: 12 }}>{item.battery.name}</div></td>
                <td>
                  {item.fields.map((field) => <div key={field} style={{ marginBottom: 3 }}>
                    <span className={styles.muted}>{fieldLabels[field]}: </span>
                    <span className={styles.before}>{field === "homeRoomId" ? describeValue(field, currentStorageValue(item.battery), snapshot) : describeValue(field, before[field], snapshot)}</span> → <span className={styles.after}>{field === "homeRoomId" ? describeValue(field, item.payload.fields.homeRoomId ?? storageBuildingValue(item.payload.fields.homeBuildingId), snapshot) : describeValue(field, item.payload.fields[field], snapshot)}</span>
                  </div>)}
                  {item.setsBuilding && <div className={styles.muted} style={{ fontSize: 12 }}>Registered building will be set to {item.payload.fields.homeBuildingId}.</div>}
                </td>
                <td>
                  {submitted ? <div style={{ display: "grid", gap: 6, justifyItems: "start" }}>
                    {resultChip(result)}
                    {(result?.state === "not-saved" || result?.state === "removed" || result?.state === "unknown") && <span style={{ fontSize: 12 }}>{result.message}</span>}
                    {result?.state === "unknown" && !running && <div style={{ display: "flex", gap: 6 }}>
                      <button type="button" className={styles.btn} onClick={() => onCheck(item.payload.requestId)}>Check outcome</button>
                      <button type="button" className={styles.btn} onClick={() => onRetry(item.payload.requestId)}>Send original again</button>
                    </div>}
                    {result?.state === "not-received" && !running && <button type="button" className={styles.btn} onClick={() => onRetry(item.payload.requestId)}>Send original</button>}
                  </div> : <span className={styles.muted} style={{ fontSize: 12 }}>Version {item.payload.before.version}</span>}
                </td>
              </tr>;
            })}
            {!ready.length && <tr><td colSpan={3} className={styles.muted}>Nothing can be saved yet. Fix the highlighted cells first.</td></tr>}
          </tbody>
        </table>
      </div>
      <DialogFooter>
        {submitted
          ? <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} disabled={running} onClick={onClose}>{running ? "Saving…" : "Done"}</button>
          : <>
            <button type="button" className={styles.btn} onClick={onClose}>Back to editing</button>
            <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} disabled={!ready.length || running} onClick={onSubmit}>Save {ready.length} {ready.length === 1 ? "battery" : "batteries"}</button>
          </>}
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
