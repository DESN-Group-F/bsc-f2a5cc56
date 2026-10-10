import { z } from "zod";
import { datasetSchema, type Dataset } from "../domain";
import { teachingCheckoutRequestSchema, teachingCheckoutReceiptSchema, type TeachingCheckoutRequest, type TeachingCheckoutReceipt } from "../teaching-checkouts";
import { verifyGroupEvidence } from "../teaching-context";

const attemptSchema = z.object({ actorAccountId: z.string().min(1), dataset: datasetSchema, payload: teachingCheckoutRequestSchema, status: z.enum(["submitted", "uncertain", "rejected"]), message: z.string(), reviewed: z.unknown().optional() }).strict();
export type TeachingCheckoutAttempt = z.infer<typeof attemptSchema>;
export function teachingCheckoutStorageKey(accountId: string, dataset: Dataset) { return `battery-teaching-checkout:${accountId}:${dataset}`; }
export function captureTeachingCheckoutAttempt(actorAccountId: string, dataset: Dataset, payload: TeachingCheckoutRequest, reviewed?: unknown): TeachingCheckoutAttempt {
  const attempt = attemptSchema.parse({ actorAccountId, dataset, payload: structuredClone(payload), status: "submitted", message: "Waiting for confirmation of this exact reviewed request.", ...(reviewed === undefined ? {} : { reviewed: structuredClone(reviewed) }) });
  if (new TextEncoder().encode(JSON.stringify({ dataset, payload: attempt.payload })).length > 250_000) throw new Error("This review exceeds the request size limit. Its draft and complete reader evidence are retained. Review fewer batteries or choose an explicit inventory/tag source; no request has been sent.");
  return attempt;
}
/** Corrupt recovery state is a blocker, never permission to silently issue a new write. */
export function recoverTeachingCheckoutAttempt(raw: string | null, actorAccountId: string, dataset: Dataset): TeachingCheckoutAttempt | null {
  if (raw === null) return null;
  const parsed = attemptSchema.safeParse(JSON.parse(raw));
  if (!parsed.success || parsed.data.actorAccountId !== actorAccountId || parsed.data.dataset !== dataset) throw new Error("The saved teaching checkout cannot be recovered safely. Keep this storage and resolve the original request before borrowing again.");
  return parsed.data;
}
export function persistTeachingCheckoutAttempt(actorAccountId: string, dataset: Dataset, attempt: TeachingCheckoutAttempt | null) {
  const key = teachingCheckoutStorageKey(actorAccountId, dataset);
  const raw = attempt === null ? null : JSON.stringify(attemptSchema.parse(attempt));
  if (attempt && (attempt.actorAccountId !== actorAccountId || attempt.dataset !== dataset)) throw new Error("This recovery request belongs to another account or inventory.");
  if (raw === null) sessionStorage.removeItem(key); else sessionStorage.setItem(key, raw);
  if (sessionStorage.getItem(key) !== raw) throw new Error("Teaching checkout recovery could not be saved. No request has been sent.");
  window.dispatchEvent(new Event("battery-teaching-checkout-recovery"));
}
export function discoverTeachingCheckoutAttempts(actorAccountId: string): TeachingCheckoutAttempt[] {
  return (["demo", "live"] as const).flatMap(dataset => {
    const attempt = recoverTeachingCheckoutAttempt(sessionStorage.getItem(teachingCheckoutStorageKey(actorAccountId, dataset)), actorAccountId, dataset);
    return attempt ? [attempt] : [];
  });
}
/** A lost response is cleared only by the server's durable terminal rejection. */
export function teachingCheckoutFailureStatus(error: unknown, wasUncertain = false): TeachingCheckoutAttempt["status"] {
  const failure = error as { status?: number; code?: string } | null;
  return !failure?.status || failure.status < 400 || failure.status >= 500 || wasUncertain && failure.code !== "teaching_checkout_rejected_final" ? "uncertain" : "rejected";
}
function equal(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((value, i) => equal(value, b[i]));
  const left = a as Record<string, unknown>, right = b as Record<string, unknown>;
  const keys = Object.keys(left).sort();
  return equal(keys, Object.keys(right).sort()) && keys.every(key => equal(left[key], right[key]));
}
export function verifyTeachingCheckoutReceipt(value: unknown, attempt: TeachingCheckoutAttempt): TeachingCheckoutReceipt {
  const result = teachingCheckoutReceiptSchema.safeParse(value);
  const failure = () => { throw new Error("The teaching checkout receipt does not match the saved review. Retry the exact original request."); };
  if (!result.success) return failure();
  const receipt = result.data, payload = attempt.payload;
  const reviewed = attempt.reviewed as { run?: Record<string, unknown> & { changes?: { mappings: TeachingCheckoutReceipt["run"]["mappings"] }[] } } | undefined;
  if (receipt.requestId !== payload.requestId || receipt.actorAccountId !== attempt.actorAccountId || receipt.dataset !== attempt.dataset || receipt.action !== payload.action || receipt.run.dataset !== attempt.dataset) return failure();
  if (payload.action === "continue" || payload.action === "exchange") {
    const change = receipt.change;
    if (receipt.run.id !== payload.runId || !change || change.id !== payload.requestId || change.runId !== payload.runId || change.action !== payload.action || change.actorAccountId !== attempt.actorAccountId || change.at !== receipt.at || change.revision !== payload.expectedRevision + 1 || receipt.revision !== change.revision || Date.parse(receipt.run.createdAt) > Date.parse(receipt.at)) return failure();
    if (payload.action === "continue") {
      verifyGroupEvidence(change.teachingGroup, payload.teachingGroup, payload.requestId, payload.mappings.map(item => item.actual.batteryId), attempt.actorAccountId);
      if (change.mappings.length !== payload.mappings.length || change.outgoing) return failure();
      const loans = new Set<string>();
      for (let index = 0; index < payload.mappings.length; index++) {
        const expected = payload.mappings[index], actual = change.mappings[index];
        if (actual.original.batteryId !== expected.original.batteryId || actual.actual.batteryId !== expected.actual.batteryId || "deleted" in actual.original || "deleted" in actual.actual || actual.original.tagId !== expected.original.tagId || actual.original.version !== expected.original.version || actual.actual.tagId !== expected.actual.tagId || actual.actual.version !== expected.actual.version || actual.originalLoanId !== expected.originalLoanId || actual.method !== expected.method || !equal(actual.source, expected.source) || !actual.loanId || loans.has(actual.loanId) || (expected.existingLoanId ? actual.loanId !== expected.existingLoanId || actual.loanOrigin !== "existing" : actual.loanOrigin === "existing")) return failure();
        loans.add(actual.loanId);
      }
    } else {
      const actual = change.mappings[0], outgoing = change.outgoing;
      if (change.mappings.length !== 1 || !outgoing || "deleted" in outgoing || outgoing.batteryId !== payload.outgoing.batteryId || outgoing.loanId !== payload.outgoing.loanId || outgoing.returned !== payload.returnOutgoing || actual.original.batteryId !== payload.originalBatteryId || actual.actual.batteryId !== payload.actual.batteryId || "deleted" in actual.actual || actual.actual.tagId !== payload.actual.tagId || actual.actual.version !== payload.actual.version || !actual.loanId || !equal(actual.source, payload.source) || (payload.actualLoanId ? actual.loanId !== payload.actualLoanId || actual.loanOrigin !== "existing" : actual.loanOrigin === "existing")) return failure();
    }
  } else if (payload.action === "checkout") {
    verifyGroupEvidence(receipt.run.teachingGroup, payload.teachingGroup, payload.requestId, payload.mappings.map(item => item.actual.batteryId), attempt.actorAccountId);
    if (receipt.run.id !== payload.requestId || receipt.run.createdAt !== receipt.at || !!receipt.run.separateCheckout !== !!payload.separateCheckout || receipt.run.actorAccountId !== attempt.actorAccountId || receipt.run.mappings.length !== payload.mappings.length || !equal(receipt.run.requestedBatteryIds, payload.mappings.map(item => item.original.batteryId))) return failure();
    const loans = new Set<string>();
    for (let i = 0; i < payload.mappings.length; i++) {
      const expected = payload.mappings[i], actual = receipt.run.mappings[i];
      if (actual.original.batteryId !== expected.original.batteryId || actual.actual.batteryId !== expected.actual.batteryId || "deleted" in actual.original || "deleted" in actual.actual || actual.original.tagId !== expected.original.tagId || actual.actual.tagId !== expected.actual.tagId || actual.original.version !== expected.original.version || actual.actual.version !== expected.actual.version || actual.originalLoanId !== expected.originalLoanId || actual.method !== expected.method || !equal(actual.source, expected.source) || !actual.loanId || loans.has(actual.loanId) || (expected.existingLoanId ? actual.loanId !== expected.existingLoanId || actual.loanOrigin !== "existing" : actual.loanOrigin === "existing")) return failure();
      loans.add(actual.loanId);
    }
  } else {
    const allMappings = [...receipt.run.mappings, ...(reviewed?.run?.changes?.flatMap(change => change.mappings) ?? [])];
    if (receipt.run.id !== payload.runId || !equal(receipt.returnedItems, payload.items) || Date.parse(receipt.run.createdAt) > Date.parse(receipt.at) || payload.items.some(item => !allMappings.some(mapping => mapping.actual.batteryId === item.batteryId && mapping.loanId === item.loanId))) return failure();
  }
  if (payload.action !== "checkout" && reviewed?.run) {
      const capturedRun = Object.fromEntries(Object.entries(reviewed.run).filter(([key]) => !["items", "revision", "currentMappings", "changes"].includes(key)));
      // A purge can lawfully redact unrelated returned assets or an original
      // member while the reviewed actual loan remains returnable. Accept only
      // the server's minimal deletion shape, never other historic edits.
      if (Array.isArray(capturedRun.mappings) && capturedRun.mappings.length === receipt.run.mappings.length) {
        capturedRun.mappings = capturedRun.mappings.map((value, index) => {
          const captured = value as Record<string, unknown>, current = receipt.run.mappings[index];
          const originalDeleted = "deleted" in current.original, actualDeleted = "deleted" in current.actual;
          const original = captured.original as { batteryId?: string }, actual = captured.actual as { batteryId?: string };
          if (original?.batteryId !== current.original.batteryId || actual?.batteryId !== current.actual.batteryId) return captured;
          return { ...captured, ...(originalDeleted ? { original: current.original, originalLoanId: null } : {}), ...(actualDeleted ? { actual: current.actual, loanId: null } : {}), ...(originalDeleted || actualDeleted ? { specificationMatch: null, differences: [] } : {}) };
        }).map((value, index) => {
          if ("deleted" in receipt.run.mappings[index].actual) { const cleared = { ...value }; delete cleared.source; return cleared; }
          return value;
        });
      }
      if (!equal(receipt.run, capturedRun)) return failure();
  }
  return receipt;
}
