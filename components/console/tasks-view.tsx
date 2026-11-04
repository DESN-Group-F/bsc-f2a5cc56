"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, RefreshCw } from "lucide-react";
import type { InventorySnapshot } from "@/lib/domain";
import type { TaskCycleRecord } from "@/lib/task-plans";
import type { TaskPlansResponse } from "@/lib/client/task-api";
import { dueLabel, openDueCycles } from "@/lib/console/overview";
import { calendarDate, shortDateTime } from "@/lib/console/battery-columns";
import { TaskPlansPanel } from "@/components/inventory/task-plans-panel";
import { MessagesPanel } from "@/components/inventory/messages-panel";
import { assignmentNames, reminderLimitation, targetSummary, taskCategoryLabels } from "@/components/inventory/tasks/task-presentation";
import styles from "./console.module.css";

export type TasksTab = "due" | "plans" | "messages";
const dueTone = { overdue: "danger", today: "warning", soon: "info", upcoming: "muted" } as const;

export function TasksView({ snapshot, today, tasks, error, loading, tab, onTab, onReload, onComplete, onChanged, onDetail, onUnreadCount, unreadCount }: {
  snapshot: InventorySnapshot; today: string; tasks: TaskPlansResponse | null; error: string; loading: boolean; tab: TasksTab; onTab: (tab: TasksTab) => void;
  onReload: () => void; onComplete: (cycle: TaskCycleRecord) => void; onChanged: () => Promise<void>; onDetail: (batteryId: string) => void;
  onUnreadCount: (count: number) => void; unreadCount: number | null;
}) {
  const [scope, setScope] = useState<"all" | "mine" | "overdue">("all");
  const [showCompleted, setShowCompleted] = useState(false);
  const open = useMemo(() => tasks ? openDueCycles(tasks.cycles, today) : [], [tasks, today]);
  const shown = open.filter((item) => scope === "all" || (scope === "mine" ? item.cycle.currentAssigneeIds.includes(snapshot.user.id) : item.due.state === "overdue"));
  const completed = useMemo(() => (tasks?.cycles ?? []).filter((cycle) => cycle.status === "completed").sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? "")).slice(0, 20), [tasks]);
  return <div className={styles.page}>
    <div className={styles.pageHead}>
      <div>
        <h1 className={styles.pageTitle}>Tasks</h1>
        <p className={styles.pageSub}>Recurring checks configured for this inventory, and your own messages.</p>
      </div>
      <div className={styles.headActions}><button type="button" className={styles.btn} onClick={onReload} disabled={loading}><RefreshCw size={15} />Refresh</button></div>
    </div>
    <div className={styles.tabs} role="tablist" aria-label="Task areas">
      <button type="button" role="tab" className={styles.tab} aria-selected={tab === "due"} onClick={() => onTab("due")}>Due work{open.length ? <span className={styles.panelCount}>{open.length}</span> : null}</button>
      <button type="button" role="tab" className={styles.tab} aria-selected={tab === "plans"} onClick={() => onTab("plans")}>Plans and cycles</button>
      <button type="button" role="tab" className={styles.tab} aria-selected={tab === "messages"} onClick={() => onTab("messages")}>My messages{unreadCount ? <span className={styles.chip} data-tone="danger" style={{ height: 18 }}>{unreadCount}</span> : null}</button>
    </div>

    {tab === "due" && <>
      {tasks?.generationIssues.length ? <div className={styles.notice} data-tone="warning"><AlertTriangle size={16} /><div className={styles.noticeBody}>
        <p><strong>Some plans need review before they can create reminders.</strong></p>
        <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>{tasks.generationIssues.map((issue) => <li key={`${issue.planId}:${issue.message}`}>{tasks.plans.find((plan) => plan.id === issue.planId)?.title ?? "Plan"}: {issue.message}</li>)}</ul>
      </div></div> : null}
      <div style={{ display: "flex", gap: 8, marginBottom: 12, alignItems: "center", flexWrap: "wrap" }}>
        <div className={styles.segmented} role="group" aria-label="Which tasks">
          {([["all", "All open"], ["mine", "Assigned to me"], ["overdue", "Overdue"]] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={scope === value} onClick={() => setScope(value)}>{label}</button>)}
        </div>
        <span className={styles.muted} style={{ fontSize: 12 }}>{tasks?.capabilities.note ?? "Messages are generated while the system is in use."}</span>
      </div>
      <section className={styles.panel}>
        {error && !tasks ? <div className={styles.empty}><strong>Tasks could not be loaded</strong>{error}</div>
          : !tasks ? <div className={styles.empty}>Loading…</div>
          : shown.length ? shown.map(({ cycle, due }) => {
            const limitation = reminderLimitation(cycle.reminderStatus);
            return <div key={cycle.id} className={styles.row} style={{ cursor: "default" }}>
              <span className={styles.rowTitle}>{cycle.title}</span>
              <span className={styles.rowMeta}>
                {taskCategoryLabels[cycle.category]} · {targetSummary(cycle, snapshot)} · due {calendarDate(cycle.dueOn)} · {assignmentNames(cycle.currentAssigneeIds, snapshot)}
                {limitation ? ` · ${limitation}` : ""}
              </span>
              <span className={styles.rowSide}>
                <span className={styles.chip} data-tone={dueTone[due.state]}>{dueLabel(due)}</span>
                <button type="button" className={`${styles.btn} ${cycle.canComplete ? styles.btnPrimary : ""}`} onClick={() => onComplete(cycle)} title={cycle.canComplete ? "Review and record completion" : "Only assigned staff or an administrator can complete this task"}>
                  {cycle.canComplete ? <><CheckCircle2 size={15} />Complete…</> : "View"}
                </button>
              </span>
            </div>;
          })
          : <div className={styles.empty}><strong>{scope === "all" ? "No open task cycles" : scope === "mine" ? "Nothing assigned to you is open" : "Nothing is overdue"}</strong>{tasks.plans.length ? "" : "Administrators can set up recurring checks under Plans and cycles."}</div>}
      </section>
      <div style={{ marginTop: 16 }}>
        <button type="button" className={styles.link} onClick={() => setShowCompleted(!showCompleted)}>{showCompleted ? "Hide" : "Show"} recently completed</button>
        {showCompleted && <section className={styles.panel} style={{ marginTop: 8 }}>
          {completed.length ? completed.map((cycle) => <div key={cycle.id} className={styles.row} style={{ cursor: "default" }}>
            <span className={styles.rowTitle}>{cycle.title}</span>
            <span className={styles.rowMeta}>Due {calendarDate(cycle.dueOn)} · completed {shortDateTime(cycle.completedAt)} by {cycle.completedByName ?? "Unknown"}{cycle.completionNotes ? ` · ${cycle.completionNotes}` : ""}</span>
            <span className={styles.rowSide}><span className={styles.chip} data-tone="success">Completed</span></span>
          </div>) : <div className={styles.empty}>No completed cycles yet.</div>}
        </section>}
      </div>
    </>}

    {tab === "plans" && <div className={styles.embeddedFull}><TaskPlansPanel data={snapshot} onChanged={async () => { await onChanged(); onReload(); }} onDetail={onDetail} /></div>}
    {tab === "messages" && <div className={styles.embeddedFull}><MessagesPanel data={snapshot} onChanged={onChanged} onDetail={onDetail} onUnreadCount={onUnreadCount} /></div>}
  </div>;
}
