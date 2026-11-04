"use client";

import { useEffect, useState } from "react";
import { ExternalLink, FileDown, Pencil, X } from "lucide-react";
import type { BatteryDetail, BatteryRecord, InventorySnapshot } from "@/lib/domain";
import { actionNames, durationLabel, reloadSessionPage } from "@/lib/client-utils";
import { calendarDate, inspectionOutcomeLabels, observationLabel, shortDate, shortDateTime, statusLabel, storageLabel } from "@/lib/console/battery-columns";
import { elapsedLabel } from "@/lib/console/overview";
import styles from "./console.module.css";

const kindLabels: Record<string, string> = { visual_check: "Visual check", functional_check: "Functional check", capacity_measurement: "Capacity measurement", other: "Other inspection" };
const statusTone = (battery: BatteryRecord) => battery.lifecycleStatus !== "active" ? "muted" : battery.loanId ? "info" : "success";

/** Read-only summary beside the grid. Recording inspections, charges and corrections stays in the full record. */
export function BatteryInspector({ battery, snapshot, revision, now, canEdit, onClose, onOpenRecord, onExport, onEdit }: {
  battery: BatteryRecord; snapshot: InventorySnapshot; revision: number; now: number; canEdit: boolean;
  onClose: () => void; onOpenRecord: () => void; onExport: () => void; onEdit: () => void;
}) {
  const key = `${snapshot.dataset}:${battery.id}:${battery.version}:${revision}`;
  const [detail, setDetail] = useState<{ key: string; value: BatteryDetail | null; error: string } | null>(null);
  useEffect(() => {
    const abort = new AbortController();
    fetch(`/api/inventory?dataset=${snapshot.dataset}&batteryId=${encodeURIComponent(battery.id)}`, { cache: "no-store", signal: abort.signal })
      .then(async (response) => {
        if (response.status === 401) reloadSessionPage("/signin");
        const body = await response.json() as BatteryDetail & { error?: string };
        if (!response.ok) throw new Error(body.error || "The battery history could not be loaded.");
        if (body.battery?.id !== battery.id) throw new Error("The battery history response did not match this record.");
        if (!abort.signal.aborted) setDetail({ key, value: body, error: "" });
      })
      .catch((error) => { if (!abort.signal.aborted && error.name !== "AbortError") setDetail({ key, value: null, error: error.message }); });
    return () => abort.abort();
  }, [battery.id, snapshot.dataset, key]);
  const current = detail?.key === key ? detail : null;
  const preview = battery.inspectionPreview;
  const checkedOut = battery.checkedOutAt ? Date.parse(battery.checkedOutAt) : NaN;
  return <aside className={styles.inspector} aria-label={`Battery ${battery.id}`}>
    <div className={styles.inspectorHead}>
      <div className={styles.inspectorTitle}>
        <h2>{battery.id}</h2>
        <p title={battery.name}>{battery.name}</p>
        <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
          <span className={styles.chip} data-tone={statusTone(battery)}>{statusLabel(battery)}</span>
          {preview?.latest?.outcome === "concern_observed" && <span className={styles.chip} data-tone="danger">Latest inspection: concern</span>}
          {preview && !preview.latest && battery.lifecycleStatus === "active" && <span className={styles.chip} data-tone="muted">No inspection recorded</span>}
        </div>
      </div>
      <button type="button" className={styles.iconButton} onClick={onClose} aria-label="Close battery summary" title="Close (Esc)"><X size={18} /></button>
    </div>
    <div className={styles.inspectorBody}>
      <section className={styles.inspectorSection}>
        <h3>Responsibility</h3>
        <dl className={styles.facts}>
          <dt>Responsible owner</dt><dd>{battery.ownerName}</dd>
          <dt>Held by</dt><dd>{battery.loanId ? <>{battery.borrowerName}{Number.isFinite(checkedOut) && now > 0 && <span className={styles.muted}> · {elapsedLabel(now - checkedOut)} (since {shortDateTime(battery.checkedOutAt)})</span>}</> : <span className={styles.muted}>Not checked out</span>}</dd>
        </dl>
      </section>
      <section className={styles.inspectorSection}>
        <h3>Specifications</h3>
        <dl className={styles.facts}>
          <dt>Model</dt><dd>{battery.model || <span className={styles.muted}>Not recorded</span>}</dd>
          <dt>Chemistry</dt><dd>{battery.chemistry || <span className={styles.muted}>Not recorded</span>}</dd>
          <dt>Capacity</dt><dd>{battery.capacityMah === null ? <span className={styles.muted}>Not recorded</span> : `${battery.capacityMah.toLocaleString("en-AU")} mAh`}</dd>
          <dt>Voltage</dt><dd>{battery.voltage === null ? <span className={styles.muted}>Not recorded</span> : `${battery.voltage} V`}</dd>
          <dt>RFID tag</dt><dd>{battery.tagId || <span className={styles.muted}>None</span>}</dd>
          <dt>Manufactured</dt><dd>{calendarDate(battery.manufacturedOn) || <span className={styles.muted}>Unknown</span>}</dd>
          <dt>First used</dt><dd>{calendarDate(battery.firstUsedOn) || <span className={styles.muted}>Unknown</span>}</dd>
          <dt>Registered</dt><dd>{shortDateTime(battery.registeredAt)}</dd>
        </dl>
      </section>
      <section className={styles.inspectorSection}>
        <h3>Storage and location</h3>
        <dl className={styles.facts}>
          <dt>Registered storage</dt><dd>{storageLabel(battery)}</dd>
          <dt>Last observed</dt><dd>{observationLabel(battery)}{battery.observationSource && <span className={styles.muted}> · {battery.observationSource}</span>}</dd>
        </dl>
        <p className={styles.muted} style={{ margin: "8px 0 0", fontSize: 12 }}>Registered storage is where it belongs; a dated observation is where it was last seen. Neither is live tracking.</p>
      </section>
      <section className={styles.inspectorSection}>
        <h3>Inspection</h3>
        {!preview ? <p className={styles.muted} style={{ margin: 0 }}>Inspection summary unavailable.</p> : !preview.latest ? <p style={{ margin: 0 }}>No valid inspection recorded.</p> :
          <dl className={styles.facts}>
            <dt>Latest</dt><dd>{inspectionOutcomeLabels[preview.latest.outcome]} · {kindLabels[preview.latest.kind] ?? preview.latest.kind}</dd>
            <dt>Performed</dt><dd>{shortDateTime(preview.latest.performedAt)} by {preview.latest.inspectorName}</dd>
            <dt>Valid records</dt><dd>{preview.validRecords}{preview.concernRecords ? ` · ${preview.concernRecords} with a concern` : ""}</dd>
          </dl>}
      </section>
      <section className={styles.inspectorSection}>
        <h3>Usage</h3>
        {current?.value ? <dl className={styles.facts}>
          <dt>Checkouts</dt><dd>{current.value.usageSummary.totalCheckouts}</dd>
          <dt>Latest charge</dt><dd>{battery.chargedAt ? `${shortDate(battery.chargedAt)} · ${durationLabel(battery.chargeDurationMinutes)}` : <span className={styles.muted}>Not recorded</span>}</dd>
        </dl> : current?.error ? <p className={styles.muted} style={{ margin: 0 }}>{current.error}</p> : <p className={styles.muted} style={{ margin: 0 }}>Loading history…</p>}
      </section>
      <section className={styles.inspectorSection}>
        <h3>Recent history</h3>
        {current?.value ? current.value.events.length ? <ol className={styles.timeline}>
          {current.value.events.slice(0, 6).map((event) => <li key={event.id}><div><strong>{actionNames[event.action] ?? event.action.replace(/_/g, " ")}</strong> · {event.actorName}<time>{shortDateTime(event.at)}</time></div></li>)}
        </ol> : <p className={styles.muted} style={{ margin: 0 }}>No recorded history.</p> : current?.error ? <p className={styles.muted} style={{ margin: 0 }}>History unavailable.</p> : <p className={styles.muted} style={{ margin: 0 }}>Loading…</p>}
      </section>
    </div>
    <div className={styles.inspectorActions}>
      <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={onOpenRecord}><ExternalLink size={15} />Full record</button>
      {canEdit && battery.lifecycleStatus === "active" && <button type="button" className={styles.btn} onClick={onEdit}><Pencil size={15} />Edit in grid</button>}
      <button type="button" className={styles.btn} onClick={onExport}><FileDown size={15} />Export</button>
    </div>
  </aside>;
}
