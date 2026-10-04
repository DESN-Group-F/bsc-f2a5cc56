import { isDateOnly } from "./battery-age";
import type { BatteryDetail, LoanRecord } from "./domain";

export type BatteryMovementTimelineEntry = {
  id: string;
  kind: "checkout" | "return" | "registration";
  at: string | null;
  actorName: string | null;
  borrowerName: string | null;
  loanDuration: string | null;
  currentLoan: boolean;
};

export type BatteryMovementSummary = {
  status: "in_store" | "in_use" | "scrapped" | "permanently_removed";
  statusLabel: string;
  durationLabel: string;
  duration: string;
  personLabel: string;
  personName: string;
  timestampLabel: string;
  startedAt: string | null;
  timeline: BatteryMovementTimelineEntry[];
};

/** Require a real, explicitly zoned instant; never infer a time from a date alone. */
function recordedTime(value: string | null | undefined, now: number): number | null {
  if (!value || !Number.isFinite(now)) return null;
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-](\d{2}):(\d{2}))$/.exec(value);
  if (!match || !isDateOnly(match[1]) || Number(match[2]) > 23 || Number(match[3]) > 59 || Number(match[4]) > 59 || Number(match[6] ?? 0) > 23 || Number(match[7] ?? 0) > 59) return null;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) && milliseconds <= now ? milliseconds : null;
}

export function formatMovementDuration(milliseconds: number | null): string {
  if (milliseconds === null || !Number.isFinite(milliseconds) || milliseconds < 0) return "Not available";
  const minutes = Math.floor(milliseconds / 60_000);
  if (minutes === 0) return "Less than 1m";
  const days = Math.floor(minutes / 1440), hours = Math.floor(minutes % 1440 / 60), remainder = minutes % 60;
  return [days ? `${days}d` : null, hours ? `${hours}h` : null, remainder ? `${remainder}m` : null].filter(Boolean).join(" ");
}

function named(value: string | null | undefined): string | null {
  return value?.trim() || null;
}

/** Effective loan records determine the summary; audit history remains separate evidence. */
export function buildBatteryMovementSummary(
  detail: Pick<BatteryDetail, "battery" | "movementSummary">,
  now: Date = new Date(),
): BatteryMovementSummary {
  const { battery, movementSummary: evidence } = detail;
  const clock = now.getTime();
  const instant = (value: string | null | undefined) => recordedTime(value, clock);
  const timestamp = (value: string | null | undefined) => instant(value) === null ? null : value!;
  const validReturnTime = (loan: LoanRecord | null) => {
    if (!loan || loan.cancelledAt !== null) return null;
    const checkout = instant(loan.checkedOutAt), returned = instant(loan.returnedAt);
    return checkout !== null && returned !== null && returned >= checkout ? returned : null;
  };
  const active = evidence.activeLoan?.id === battery.loanId && evidence.activeLoan.cancelledAt === null && evidence.activeLoan.returnedAt === null ? evidence.activeLoan : null;
  const returned = evidence.latestReturn?.cancelledAt === null && evidence.latestReturn.returnedAt !== null ? evidence.latestReturn : null;
  const registration = evidence.registration ?? { at: battery.registeredAt, actorName: null };
  const terminal = battery.lifecycleStatus !== "active";
  const status = battery.lifecycleStatus !== "active" ? battery.lifecycleStatus : battery.loanId ? "in_use" : "in_store";
  const result: BatteryMovementSummary = {
    status,
    statusLabel: status === "in_use" ? "In use" : status === "in_store" ? "In store" : status === "scrapped" ? "Scrapped" : "Permanently removed",
    durationLabel: terminal ? "Movement tracking" : battery.loanId ? "Checked out for" : returned ? "Since last recorded return" : "Check-in history",
    duration: "Not available",
    personLabel: terminal ? "Last return recorded by" : battery.loanId ? "Current holder" : returned ? "Return recorded by" : "Registered by",
    personName: named(terminal ? returned?.returnActorName : battery.loanId ? battery.borrowerName : returned ? returned.returnActorName : registration.actorName) ?? "Not recorded",
    timestampLabel: terminal ? "Tracking ended" : battery.loanId ? "Checked out" : returned ? "Returned" : "Registered",
    startedAt: null,
    timeline: [],
  };
  if (terminal) {
    result.duration = "Tracking ended";
    result.startedAt = timestamp(battery.lifecycleAt);
  } else if (battery.loanId) {
    const started = active ? instant(active.checkedOutAt) : null;
    result.duration = formatMovementDuration(started === null ? null : clock - started);
    result.startedAt = active ? timestamp(active.checkedOutAt) : null;
  } else if (returned) {
    const started = validReturnTime(returned);
    result.duration = formatMovementDuration(started === null ? null : clock - started);
    result.startedAt = started === null ? null : returned.returnedAt;
  } else {
    result.duration = "No return recorded";
    result.startedAt = timestamp(registration.at);
  }

  const loans = new Map([...evidence.recentLoans, active, returned].filter((loan): loan is LoanRecord => !!loan && loan.cancelledAt === null).map((loan) => [loan.id, loan]));
  for (const loan of loans.values()) {
    const checkout = instant(loan.checkedOutAt), returnTime = validReturnTime(loan);
    result.timeline.push({
      id: `${loan.id}:checkout`, kind: "checkout", at: timestamp(loan.checkedOutAt), actorName: named(loan.checkoutActorName),
      borrowerName: named(loan.borrowerName), loanDuration: loan.returnedAt === null ? null : formatMovementDuration(checkout === null || returnTime === null ? null : returnTime - checkout),
      currentLoan: active?.id === loan.id,
    });
    if (loan.returnedAt !== null) result.timeline.push({
      id: `${loan.id}:return`, kind: "return", at: returnTime === null ? null : loan.returnedAt, actorName: named(loan.returnActorName),
      borrowerName: named(loan.borrowerName), loanDuration: null, currentLoan: false,
    });
  }
  // Registration is labelled separately; it is never treated as a physical check-in.
  if (registration.at) result.timeline.push({
    id: `${battery.id}:registration`, kind: "registration", at: timestamp(registration.at), actorName: named(registration.actorName),
    borrowerName: null, loanDuration: null, currentLoan: false,
  });
  result.timeline.sort((a, b) => {
    const first = a.at === null ? -Infinity : Date.parse(a.at), second = b.at === null ? -Infinity : Date.parse(b.at);
    if (first !== second) return second - first;
    const order = { return: 0, checkout: 1, registration: 2 };
    return order[a.kind] - order[b.kind] || a.id.localeCompare(b.id);
  });
  result.timeline = result.timeline.slice(0, 6);
  return result;
}
