import type { BatteryRecord, InventorySnapshot } from "../domain";
import type { TaskCycleRecord } from "../task-plans";
import { currentSydneyDate, isDateOnly } from "../battery-age";
import { isActiveBattery } from "../battery-lifecycle";
import { recentNewArrivals, type NewArrivals } from "../new-arrivals";

/** Due state of an open recurring-task cycle, judged on Sydney calendar dates. */
export type DueState = "overdue" | "today" | "soon" | "upcoming";
export const DUE_SOON_DAYS = 7;

const dayMs = 86_400_000;
/** Whole calendar days from `from` to `to` (both YYYY-MM-DD); null for invalid dates. */
export function calendarDaysBetween(from: string, to: string): number | null {
  if (!isDateOnly(from) || !isDateOnly(to)) return null;
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / dayMs);
}

export function dueState(dueOn: string, today: string, soonDays = DUE_SOON_DAYS): { state: DueState; days: number } | null {
  const days = calendarDaysBetween(today, dueOn);
  if (days === null) return null;
  return { state: days < 0 ? "overdue" : days === 0 ? "today" : days <= soonDays ? "soon" : "upcoming", days };
}

export function dueLabel(due: { state: DueState; days: number }): string {
  if (due.state === "overdue") return due.days === -1 ? "Overdue by 1 day" : `Overdue by ${-due.days} days`;
  if (due.state === "today") return "Due today";
  return due.days === 1 ? "Due tomorrow" : `Due in ${due.days} days`;
}

export type DueCycle = { cycle: TaskCycleRecord; due: { state: DueState; days: number } };

/** Open cycles of current plans, most urgent first. Completed cycles never appear as due work. */
export function openDueCycles(cycles: readonly TaskCycleRecord[], today: string, accountId?: string): DueCycle[] {
  return cycles
    .filter((cycle) => cycle.status === "open" && !cycle.planRemoved && (!accountId || cycle.currentAssigneeIds.includes(accountId)))
    .flatMap((cycle) => {
      const due = dueState(cycle.dueOn, today);
      return due ? [{ cycle, due }] : [];
    })
    .sort((a, b) => a.due.days - b.due.days || a.cycle.title.localeCompare(b.cycle.title, "en") || a.cycle.id.localeCompare(b.cycle.id));
}

/** A battery whose latest valid inspection record states a concern. Earlier concerns are history, not the current finding. */
export function latestInspectionReportsConcern(battery: BatteryRecord): boolean {
  return battery.inspectionPreview?.latest?.outcome === "concern_observed";
}
export function hasNoInspectionRecord(battery: BatteryRecord): boolean {
  return !!battery.inspectionPreview && battery.inspectionPreview.validRecords === 0;
}

export type OutstandingLoan = { battery: BatteryRecord; checkedOutAt: string; elapsedMs: number };

export type OverviewSummary = {
  today: string;
  active: number;
  inStore: number;
  inUse: number;
  holders: number;
  retired: number;
  newArrivals: { recent: number; unread: number };
  tasks: { open: number; overdue: number; dueToday: number; dueSoon: number; mine: number; mineUrgent: number };
  due: DueCycle[];
  inspections: { concern: BatteryRecord[]; neverInspected: number; previewAvailable: boolean };
  outstanding: OutstandingLoan[];
};

/**
 * Pure summary of an inventory snapshot and the shared task cycles. Counts use the same
 * meanings as the full application: In use is an active recorded loan, not physical sensing,
 * and loans have no due date in this system, so outstanding loans are ordered by elapsed time only.
 */
export function summarizeOverview(input: {
  snapshot: InventorySnapshot;
  cycles: readonly TaskCycleRecord[];
  now?: Date | number;
  newArrivals?: NewArrivals;
}): OverviewSummary {
  const now = input.now === undefined ? new Date() : typeof input.now === "number" ? new Date(input.now) : input.now;
  const today = currentSydneyDate(now);
  const active = input.snapshot.batteries.filter((battery) => isActiveBattery(battery));
  const inUse = active.filter((battery) => !!battery.loanId);
  const holders = new Set(inUse.map((battery) => battery.borrowerAccountId ?? `name:${battery.borrowerName ?? ""}`));
  const due = openDueCycles(input.cycles, today);
  const accountId = input.snapshot.user.id;
  const mine = due.filter((item) => item.cycle.currentAssigneeIds.includes(accountId));
  const arrivals = recentNewArrivals(input.newArrivals ?? input.snapshot.newArrivals);
  const activeIds = new Set(active.map((battery) => battery.id));
  const outstanding = inUse
    .flatMap((battery) => {
      const at = battery.checkedOutAt ? Date.parse(battery.checkedOutAt) : NaN;
      return Number.isFinite(at) ? [{ battery, checkedOutAt: battery.checkedOutAt!, elapsedMs: Math.max(0, now.getTime() - at) }] : [];
    })
    .sort((a, b) => b.elapsedMs - a.elapsedMs || a.battery.id.localeCompare(b.battery.id, "en", { numeric: true }));
  return {
    today,
    active: active.length,
    inStore: active.length - inUse.length,
    inUse: inUse.length,
    holders: inUse.length ? holders.size : 0,
    retired: input.snapshot.batteries.length - active.length,
    newArrivals: {
      recent: arrivals.filter((item) => activeIds.has(item.batteryId)).length,
      unread: arrivals.filter((item) => item.isUnread && activeIds.has(item.batteryId)).length,
    },
    tasks: {
      open: due.length,
      overdue: due.filter((item) => item.due.state === "overdue").length,
      dueToday: due.filter((item) => item.due.state === "today").length,
      dueSoon: due.filter((item) => item.due.state === "soon").length,
      mine: mine.length,
      mineUrgent: mine.filter((item) => item.due.state === "overdue" || item.due.state === "today").length,
    },
    due,
    inspections: {
      concern: active.filter(latestInspectionReportsConcern).sort((a, b) => a.id.localeCompare(b.id, "en", { numeric: true })),
      neverInspected: active.filter(hasNoInspectionRecord).length,
      previewAvailable: active.every((battery) => !!battery.inspectionPreview),
    },
    outstanding,
  };
}

/** Human-readable elapsed time for an outstanding loan. */
export function elapsedLabel(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return minutes <= 1 ? "1 minute" : `${minutes} minutes`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return hours === 1 ? "1 hour" : `${hours} hours`;
  const days = Math.floor(hours / 24);
  return `${days} days`;
}
