import { z } from "zod";
import type { Dataset } from "../domain";
import { operatorEditPayloadSchema, verifyOperatorEditOutcome, type OperatorEditOutcome, type OperatorEditPayload } from "../operator-edit";

/**
 * Durable record of metadata edits that were confirmed for sending but whose server outcome is
 * not yet verified. Each entry is saved before its request leaves the browser, holds the exact
 * original payload, and is removed only after a verified receipt or a reserved final rejection.
 */
export type JournalEntry = {
  requestId: string;
  batteryId: string;
  payload: OperatorEditPayload;
  preparedAt: string;
  /** prepared: saved, not yet sent. sent: a send started; its outcome is unknown until verified. */
  state: "prepared" | "sent";
  lastError: string | null;
};

const entrySchema = z.object({
  requestId: z.string().uuid(),
  batteryId: z.string().min(1).max(64),
  payload: operatorEditPayloadSchema,
  preparedAt: z.string().datetime({ offset: true }),
  state: z.enum(["prepared", "sent"]),
  lastError: z.string().max(2000).nullable(),
}).strict().refine((entry) => entry.payload.requestId === entry.requestId && entry.payload.batteryId === entry.batteryId, "Journal entry identity mismatch");

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function journalKey(accountId: string, dataset: Dataset) {
  return `battery-console:metadata-edits:v1:${accountId}:${dataset}`;
}

/** Reads saved entries. A damaged store is reported, never silently replaced. */
export function readJournal(storage: StorageLike, accountId: string, dataset: Dataset): { entries: JournalEntry[]; error: string } {
  let text: string | null;
  try { text = storage.getItem(journalKey(accountId, dataset)); } catch { return { entries: [], error: "This browser blocked access to saved edit requests. Unresolved saves cannot be shown here." }; }
  if (!text) return { entries: [], error: "" };
  try {
    const parsed = z.array(entrySchema).max(200).parse(JSON.parse(text));
    return { entries: parsed, error: "" };
  } catch {
    return { entries: [], error: "Saved edit requests in this browser could not be read. They were left untouched; export them from the browser storage before clearing it." };
  }
}

export function writeJournal(storage: StorageLike, accountId: string, dataset: Dataset, entries: readonly JournalEntry[]) {
  const key = journalKey(accountId, dataset);
  if (!entries.length) storage.removeItem(key);
  else storage.setItem(key, JSON.stringify(entries));
}

export function upsertEntries(existing: readonly JournalEntry[], next: readonly JournalEntry[]): JournalEntry[] {
  const byId = new Map(existing.map((entry) => [entry.requestId, entry]));
  for (const entry of next) byId.set(entry.requestId, entry);
  return [...byId.values()].sort((a, b) => a.preparedAt.localeCompare(b.preparedAt) || a.requestId.localeCompare(b.requestId));
}

export function removeEntry(existing: readonly JournalEntry[], requestId: string): JournalEntry[] {
  return existing.filter((entry) => entry.requestId !== requestId);
}

/** One battery may have at most one unresolved request; a new edit waits until it is resolved. */
export function unresolvedBatteryIds(entries: readonly JournalEntry[]): Set<string> {
  return new Set(entries.map((entry) => entry.batteryId));
}

export type SettledOutcome =
  | { kind: "saved"; at: string; version: number }
  | { kind: "not-saved"; message: string }
  | { kind: "removed"; message: string }
  | { kind: "not-received" };

/** Verifies a server outcome against the exact original payload; throws if it belongs elsewhere. */
export async function settleOutcome(value: unknown, payload: OperatorEditPayload, accountId: string, dataset: Dataset): Promise<SettledOutcome> {
  const outcome: OperatorEditOutcome = await verifyOperatorEditOutcome(value, payload, accountId, dataset);
  switch (outcome.state) {
    case "confirmed": return { kind: "saved", at: outcome.receipt.at, version: outcome.receipt.after.version };
    case "rejected": return { kind: "not-saved", message: outcome.error };
    case "purged": return { kind: "removed", message: "This battery was permanently deleted, so the edit no longer applies." };
    case "missing": return { kind: "not-received" };
  }
}
