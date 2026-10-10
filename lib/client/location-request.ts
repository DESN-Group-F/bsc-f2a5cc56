import { z } from "zod";
import { datasetSchema, type Dataset } from "../domain";
import { locationBeaconRequestSchema, locationCaptureSchema, SIMULATED_LOCATION_SOURCE, type LocationBeaconReceipt, type LocationCaptureReceipt } from "../location-observations";

const attemptSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("beacon"), payload: locationBeaconRequestSchema }),
  z.object({ kind: z.literal("capture"), payload: locationCaptureSchema }),
]).and(z.object({
  actorAccountId: z.string().min(1), dataset: datasetSchema,
  status: z.enum(["submitted", "uncertain", "rejected"]), message: z.string(),
}));
export type LocationAttempt = z.infer<typeof attemptSchema>;
export type LocationReceipt = LocationBeaconReceipt | LocationCaptureReceipt;
type RecoveryStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function locationRequestStorageKey(accountId: string, dataset: Dataset) {
  return `battery-location-request:${accountId}:${dataset}`;
}

export function captureLocationAttempt(actorAccountId: string, dataset: Dataset, request: Pick<Extract<LocationAttempt, { kind: "beacon" }>, "kind" | "payload"> | Pick<Extract<LocationAttempt, { kind: "capture" }>, "kind" | "payload">): LocationAttempt {
  return attemptSchema.parse({ ...structuredClone(request), actorAccountId, dataset, status: "submitted", message: "Waiting for the server to confirm this exact request." });
}

export function recoverLocationAttempt(raw: string | null, actorAccountId: string, dataset: Dataset): LocationAttempt | null {
  if (raw === null) return null;
  try {
    const value = attemptSchema.parse(JSON.parse(raw));
    if (value.actorAccountId !== actorAccountId || value.dataset !== dataset) throw new Error("Context mismatch");
    return value;
  } catch {
    throw new Error("Saved location work is unreadable or belongs to another account or inventory. It has been retained. Export it for review before starting another request.");
  }
}

function sameRequest(left: LocationAttempt, right: LocationAttempt) {
  return left.kind === right.kind && left.actorAccountId === right.actorAccountId && left.dataset === right.dataset && JSON.stringify(left.payload) === JSON.stringify(right.payload);
}

export function persistLocationAttempt(attempt: LocationAttempt, storage: RecoveryStorage = localStorage) {
  const parsed = attemptSchema.parse(attempt), key = locationRequestStorageKey(parsed.actorAccountId, parsed.dataset);
  const previous = recoverLocationAttempt(storage.getItem(key), parsed.actorAccountId, parsed.dataset);
  if (previous && !sameRequest(previous, parsed)) throw new Error("Another original location request is retained. It has not been replaced.");
  const raw = JSON.stringify(parsed);
  storage.setItem(key, raw);
  if (storage.getItem(key) !== raw) throw new Error("Location request recovery could not be verified. No new request will be sent.");
}

export function clearLocationAttempt(attempt: LocationAttempt, storage: RecoveryStorage = localStorage) {
  const key = locationRequestStorageKey(attempt.actorAccountId, attempt.dataset);
  const previous = recoverLocationAttempt(storage.getItem(key), attempt.actorAccountId, attempt.dataset);
  if (previous && !sameRequest(previous, attempt)) throw new Error("The saved location request changed. It has not been removed.");
  storage.removeItem(key);
  if (storage.getItem(key) !== null) throw new Error("The confirmed result could not be acknowledged in recovery storage. Retry the same request.");
}

export function discoverLocationAttempts(actorAccountId: string, storage: Pick<Storage, "getItem"> = localStorage): LocationAttempt[] {
  return (["demo", "live"] as const).flatMap(dataset => {
    const attempt = recoverLocationAttempt(storage.getItem(locationRequestStorageKey(actorAccountId, dataset)), actorAccountId, dataset);
    return attempt ? [attempt] : [];
  });
}

export function locationFailureStatus(error: unknown): "uncertain" | "rejected" {
  return (error as { code?: string } | null)?.code === "location_rejected_final" ? "rejected" : "uncertain";
}

/** Only an authoritative receipt matching the captured request can release recovery. */
export function verifyLocationReceipt(value: unknown, attempt: LocationAttempt): LocationReceipt {
  const receipt = value as LocationReceipt | null;
  const invalid = () => { throw new Error("The location receipt does not match the original captured request. Retry that same request."); };
  if (!receipt || receipt.requestId !== attempt.payload.requestId || receipt.actorAccountId !== attempt.actorAccountId || receipt.dataset !== attempt.dataset || typeof receipt.replayed !== "boolean") return invalid();
  if (attempt.kind === "beacon") {
    if (!("beacon" in receipt)) return invalid();
    const expected = attempt.payload, beacon = receipt.beacon;
    if (!beacon || beacon.id !== expected.id || beacon.label !== expected.label || beacon.identifier !== expected.identifier || beacon.roomId !== expected.roomId || beacon.roomVersion !== expected.roomVersion || beacon.buildingVersion !== expected.buildingVersion || beacon.active !== expected.active || beacon.version !== (expected.action === "create" ? 1 : expected.expectedVersion + 1) || beacon.hardwareValidated !== false) return invalid();
    return receipt;
  }
  if (!("outcome" in receipt) || receipt.batteryId !== attempt.payload.batteryId || Date.parse(receipt.capturedAt) !== Date.parse(attempt.payload.capturedAt) || receipt.source !== SIMULATED_LOCATION_SOURCE || !Number.isFinite(Date.parse(receipt.receivedAt)) || Date.parse(receipt.receivedAt) < Date.parse(receipt.capturedAt)) return invalid();
  if (receipt.outcome === "recorded") {
    if (typeof receipt.observationId !== "string" || !receipt.observationId || !receipt.room?.id || !receipt.room.name || !receipt.room.buildingId || !receipt.room.buildingName || typeof receipt.room.isPlaceholder !== "boolean") return invalid();
  } else if (!["ambiguous", "unresolved"].includes(receipt.outcome) || receipt.observationId !== null || receipt.room !== null) return invalid();
  return receipt;
}
