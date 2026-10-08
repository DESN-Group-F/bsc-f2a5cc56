import { z } from "zod";

export type UsageSummary = {
  asOf: string;
  totalCheckouts: number;
  completedCheckouts: number;
  activeCheckouts: number;
  totalCheckedOutSeconds: number | null;
  invalidDurationCount: number;
};

type UsageLoan = {
  checkedOutAt?: unknown;
  returnedAt?: unknown;
  cancelledAt?: unknown;
};
const timestamp = z.string().datetime({ offset: true });
function time(value: unknown) {
  return timestamp.safeParse(value).success ? Date.parse(String(value)) : NaN;
}

/** Borrowing history is not a charge/discharge cycle or battery health reading. */
export function summarizeBatteryUsage(
  loans: readonly UsageLoan[],
  asOf: Date | string,
): UsageSummary {
  const instant = asOf instanceof Date ? asOf.getTime() : time(asOf);
  if (!Number.isFinite(instant)) throw new Error("A valid usage reporting time is required.");
  const valid = loans.filter((loan) => loan.cancelledAt == null);
  let completedCheckouts = 0, activeCheckouts = 0, seconds = 0, invalidDurationCount = 0;
  for (const loan of valid) {
    const active = loan.returnedAt === null;
    if (active) activeCheckouts += 1;
    else completedCheckouts += 1;
    const start = time(loan.checkedOutAt), end = active ? instant : time(loan.returnedAt);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start > instant || end > instant || end < start) {
      invalidDurationCount += 1;
    } else {
      seconds += (end - start) / 1000;
    }
  }
  return {
    asOf: new Date(instant).toISOString(),
    totalCheckouts: valid.length,
    completedCheckouts,
    activeCheckouts,
    totalCheckedOutSeconds: invalidDurationCount ? null : seconds,
    invalidDurationCount,
  };
}
