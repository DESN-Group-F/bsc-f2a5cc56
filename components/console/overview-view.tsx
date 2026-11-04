"use client";

import { AlertTriangle, ArrowRight, BatteryCharging, CalendarClock, ClipboardCheck, PackageCheck, PackagePlus, ShieldAlert, Users } from "lucide-react";
import type { AuditEvent, InventorySnapshot } from "@/lib/domain";
import type { TaskCycleRecord } from "@/lib/task-plans";
import type { TaskPlansResponse } from "@/lib/client/task-api";
import { actionNames } from "@/lib/client-utils";
import { dueLabel, elapsedLabel, type OverviewSummary } from "@/lib/console/overview";
import { calendarDate, inspectionOutcomeLabels, longCalendarDate, shortDate, shortDateTime } from "@/lib/console/battery-columns";
import type { ConsoleViewId } from "@/lib/console/views";
import styles from "./console.module.css";

const dueTone = { overdue: "danger", today: "warning", soon: "info", upcoming: "muted" } as const;
const categoryLabels: Record<string, string> = { storage_review: "Storage-area review", inventory_reconciliation: "Inventory reconciliation", storage_maintenance: "Storage maintenance review", custom: "Recurring task" };

function eventText(event: AuditEvent) {
  const action = actionNames[event.action] ?? event.action.replace(/_/g, " ");
  const count = typeof event.details.count === "number" && event.details.count > 1 ? ` · ${event.details.count} batteries` : "";
  return `${action}${event.batteryId ? ` · ${event.batteryId}` : ""}${count}`;
}

export function OverviewView({ snapshot, summary, tasks, tasksError, tasksLoading, onOpenBatteries, onOpenTasks, onCompleteCycle, onInspect }: {
  snapshot: InventorySnapshot; summary: OverviewSummary; tasks: TaskPlansResponse | null; tasksError: string; tasksLoading: boolean;
  onOpenBatteries: (view: ConsoleViewId) => void; onOpenTasks: () => void; onCompleteCycle: (cycle: TaskCycleRecord) => void; onInspect: (id: string) => void;
}) {
  const people = new Map((tasks?.staffDirectory ?? snapshot.staffDirectory).map((account) => [account.id, account.displayName]));
  const due = summary.due.filter((item) => item.due.state !== "upcoming").slice(0, 8);
  const later = summary.due.length - due.length;
  const greeting = snapshot.user.displayName.split(" ")[0];
  const events = snapshot.events.slice(0, 8);
  return <div className={styles.page}>
    <div className={styles.pageHead}>
      <div>
        <h1 className={styles.pageTitle}>Overview</h1>
        <p className={styles.pageSub}>Hello {greeting}. {snapshot.dataset === "demo" ? "Demonstration inventory" : "Working inventory"} · {longCalendarDate(summary.today)}</p>
      </div>
    </div>

    {summary.active === 0 && summary.retired === 0 && <div className={styles.notice}>
      <p><strong>This inventory has no batteries yet.</strong> Register them with the phone app or the full application, or import a reviewed CSV file under Admin → Records and directories.</p>
    </div>}
    <div className={styles.kpis}>
      <button type="button" className={styles.kpi} onClick={() => onOpenBatteries("active")}>
        <span className={styles.kpiLabel}><BatteryCharging size={14} />Active batteries</span>
        <span className={styles.kpiValue}>{summary.active}</span>
        <span className={styles.kpiNote}>{summary.retired ? `${summary.retired} retired kept as history` : "No retired records"}</span>
      </button>
      <button type="button" className={styles.kpi} onClick={() => onOpenBatteries("in-store")}>
        <span className={styles.kpiLabel}><PackageCheck size={14} />In store</span>
        <span className={styles.kpiValue}>{summary.inStore}</span>
        <span className={styles.kpiNote}>No recorded loan</span>
      </button>
      <button type="button" className={styles.kpi} onClick={() => onOpenBatteries("in-use")}>
        <span className={styles.kpiLabel}><Users size={14} />In use</span>
        <span className={styles.kpiValue}>{summary.inUse}</span>
        <span className={styles.kpiNote}>{summary.inUse ? `Held by ${summary.holders} ${summary.holders === 1 ? "person" : "people"}` : "Nothing checked out"}</span>
      </button>
      <button type="button" className={styles.kpi} data-tone={summary.tasks.overdue ? "danger" : summary.tasks.dueToday ? "warning" : undefined} onClick={onOpenTasks}>
        <span className={styles.kpiLabel}><CalendarClock size={14} />Recurring tasks due</span>
        <span className={styles.kpiValue}>{tasks ? summary.tasks.overdue + summary.tasks.dueToday + summary.tasks.dueSoon : "–"}</span>
        <span className={styles.kpiNote}>{!tasks ? (tasksError ? "Tasks unavailable" : "Loading…") : summary.tasks.overdue ? `${summary.tasks.overdue} overdue · ${summary.tasks.dueToday} today` : summary.tasks.dueToday ? `${summary.tasks.dueToday} due today` : `Within ${7} days`}</span>
      </button>
      <button type="button" className={styles.kpi} data-tone={summary.inspections.concern.length ? "warning" : undefined} onClick={() => onOpenBatteries("attention")}>
        <span className={styles.kpiLabel}><ShieldAlert size={14} />Inspection concerns</span>
        <span className={styles.kpiValue}>{summary.inspections.concern.length}</span>
        <span className={styles.kpiNote}>{summary.inspections.neverInspected} never inspected</span>
      </button>
      <button type="button" className={styles.kpi} onClick={() => onOpenBatteries("arrivals")}>
        <span className={styles.kpiLabel}><PackagePlus size={14} />New arrivals</span>
        <span className={styles.kpiValue}>{summary.newArrivals.recent}</span>
        <span className={styles.kpiNote}>{summary.newArrivals.unread ? `${summary.newArrivals.unread} you have not opened` : "Last 48 hours"}</span>
      </button>
    </div>

    <div className={styles.panels}>
      <section className={styles.panel} aria-labelledby="overview-due">
        <div className={styles.panelHead}>
          <h2 className={styles.panelTitle} id="overview-due"><ClipboardCheck size={16} />Due work <span className={styles.panelCount}>{due.length}</span></h2>
          <button type="button" className={styles.link} onClick={onOpenTasks}>All tasks <ArrowRight size={13} style={{ verticalAlign: -2 }} /></button>
        </div>
        <div className={styles.panelBody}>
          {tasksError && !tasks ? <div className={styles.empty}><strong>Tasks could not be loaded</strong>{tasksError}</div>
            : !tasks && tasksLoading ? <div className={styles.empty}>Loading recurring tasks…</div>
            : due.length ? due.map(({ cycle, due: state }) => <button key={cycle.id} type="button" className={styles.row} onClick={() => onCompleteCycle(cycle)}>
              <span className={styles.rowTitle}>{cycle.title}</span>
              <span className={styles.rowMeta}>{categoryLabels[cycle.category] ?? "Recurring task"} · due {calendarDate(cycle.dueOn)} · {cycle.currentAssigneeIds.map((id) => people.get(id) ?? "Unknown account").join(", ") || "No assignee"}</span>
              <span className={styles.rowSide}><span className={styles.chip} data-tone={dueTone[state.state]}>{dueLabel(state)}</span></span>
            </button>)
            : <div className={styles.empty}><strong>Nothing due in the next 7 days</strong>{later ? `${later} later ${later === 1 ? "cycle" : "cycles"} scheduled.` : tasks?.plans.length ? "All open cycles are further out." : "No recurring tasks are configured yet."}</div>}
        </div>
        <div className={styles.panelFoot}>Reminders are created while the system is in use; there is no unattended background delivery.</div>
      </section>

      <section className={styles.panel} aria-labelledby="overview-inspection">
        <div className={styles.panelHead}>
          <h2 className={styles.panelTitle} id="overview-inspection"><AlertTriangle size={16} />Inspection attention <span className={styles.panelCount}>{summary.inspections.concern.length}</span></h2>
          <button type="button" className={styles.link} onClick={() => onOpenBatteries("uninspected")}>{summary.inspections.neverInspected} never inspected <ArrowRight size={13} style={{ verticalAlign: -2 }} /></button>
        </div>
        <div className={styles.panelBody}>
          {summary.inspections.concern.length ? summary.inspections.concern.slice(0, 8).map((battery) => <button key={battery.id} type="button" className={styles.row} onClick={() => onInspect(battery.id)}>
            <span className={styles.rowTitle}><span className={styles.idCell}>{battery.id}</span> · {battery.name}</span>
            <span className={styles.rowMeta}>{inspectionOutcomeLabels.concern_observed} recorded {shortDate(battery.inspectionPreview?.latest?.performedAt)} by {battery.inspectionPreview?.latest?.inspectorName} · {battery.loanId ? `held by ${battery.borrowerName}` : "in store"}</span>
            <span className={styles.rowSide}><span className={styles.chip} data-tone="danger">Concern</span></span>
          </button>) : <div className={styles.empty}><strong>No current concerns</strong>No active battery&apos;s latest inspection records a concern.</div>}
        </div>
        <div className={styles.panelFoot}>A recorded concern is staff evidence. It does not block borrowing and is not a safety certification.</div>
      </section>

      <section className={styles.panel} aria-labelledby="overview-outstanding">
        <div className={styles.panelHead}>
          <h2 className={styles.panelTitle} id="overview-outstanding"><Users size={16} />Out longest <span className={styles.panelCount}>{summary.outstanding.length}</span></h2>
          <button type="button" className={styles.link} onClick={() => onOpenBatteries("in-use")}>All in use <ArrowRight size={13} style={{ verticalAlign: -2 }} /></button>
        </div>
        <div className={styles.panelBody}>
          {summary.outstanding.length ? summary.outstanding.slice(0, 8).map(({ battery, elapsedMs, checkedOutAt }) => <button key={battery.id} type="button" className={styles.row} onClick={() => onInspect(battery.id)}>
            <span className={styles.rowTitle}><span className={styles.idCell}>{battery.id}</span> · {battery.name}</span>
            <span className={styles.rowMeta}>{battery.borrowerName} · since {shortDateTime(checkedOutAt)}</span>
            <span className={styles.rowSide}><span className={styles.chip} data-tone="muted">{elapsedLabel(elapsedMs)}</span></span>
          </button>) : <div className={styles.empty}><strong>Nothing checked out</strong>All active batteries are in store.</div>}
        </div>
        <div className={styles.panelFoot}>Loans have no due date in this system, so this lists the longest recorded checkouts.</div>
      </section>

      <section className={`${styles.panel} ${styles.panelWide}`} aria-labelledby="overview-activity">
        <div className={styles.panelHead}>
          <h2 className={styles.panelTitle} id="overview-activity">Recent activity</h2>
        </div>
        <div className={styles.panelBody}>
          {events.length ? events.map((event) => <button key={event.id} type="button" className={styles.row} onClick={() => event.batteryId && onInspect(event.batteryId)} disabled={!event.batteryId} style={!event.batteryId ? { cursor: "default" } : undefined}>
            <span className={styles.rowTitle}>{eventText(event)}</span>
            <span className={styles.rowMeta}>{event.actorName} · {shortDateTime(event.at)}</span>
          </button>) : <div className={styles.empty}><strong>No activity yet</strong>Checkouts, returns and edits appear here.</div>}
        </div>
      </section>
    </div>
  </div>;
}
