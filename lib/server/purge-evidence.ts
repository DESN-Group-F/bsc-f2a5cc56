import { DomainError } from "../domain";

export async function evidenceFingerprint(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return `sha256:${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("")}`;
}
export function registeredTagHash(scope: string, tagId: string) {
  return evidenceFingerprint(JSON.stringify({ scope, tagId }));
}

/** A retained request key prevents a delayed write from recreating deleted evidence. */
export function rejectPurgedReplay(resultJson: unknown, finalCode: string) {
  const result = JSON.parse(String(resultJson));
  if (Array.isArray(result.purgedBatteryIds) && result.purgedBatteryIds.length)
    throw new DomainError(409, "This original request includes a battery whose data was permanently deleted. Its request identifier remains reserved; no new write was made.", finalCode);
  return result;
}

const batteryObjectPaths = new Set(["battery", "batteries", "batteryRecord", "batteryRecords", "batterySnapshot", "batterySnapshots", "sourceBindings", "byBattery", "batteryById", "batteriesById", "batteryEvidence"]);
const batteryIdPaths = new Set(["batteryIds", "battery_ids", "memberIds", "member_ids", "purgedBatteryIds", "requestedBatteryIds"]);
const resolveId = (identity: string, ids: ReadonlySet<string>) => ids.has(identity) ? identity : [...ids].find(candidate => identity.endsWith(`/${candidate}`))!;
function batteryIdentity(object: Record<string, unknown>, ids: ReadonlySet<string>, keys: ReadonlySet<string>, path: string) {
  // Generic IDs also exist in room/model/account namespaces. Asset records have
  // explicit ownership/tag fields, or occur in a known battery snapshot path.
  const assetShape = "ownerId" in object || "owner_key" in object || "tagId" in object || "tag_id" in object;
  const fields = ["batteryId", "battery_id", "batteryKey", "battery_key", ...(assetShape || batteryObjectPaths.has(path) ? ["id", "key"] : [])];
  for (const field of fields) {
    const identity = object[field];
    if (typeof identity === "string" && (ids.has(identity) || keys.has(identity))) return { id: resolveId(identity, ids), field };
  }
  return null;
}

/** Keep independent records and ID references; remove only identified asset snapshots. */
export function redactBatteryEvidence(value: unknown, ids: ReadonlySet<string>, keys: ReadonlySet<string>, path = ""): unknown {
  if (Array.isArray(value)) return value.map(item => redactBatteryEvidence(item, ids, keys, path));
  if (!value || typeof value !== "object") return value;
  const object = value as Record<string, unknown>, identity = batteryIdentity(object, ids, keys, path);
  if (identity) return { [identity.field === "id" ? "id" : "batteryId"]: identity.id, deleted: true };
  // Replacement comparisons describe both assets. Remove comparisons when
  // either is deleted, and remove reader/loan evidence belonging to the actual asset.
  if (path === "mappings" && "original" in object && "actual" in object) {
    const originalDeleted = referencesBattery(object.original, ids, keys);
    const actualDeleted = referencesBattery(object.actual, ids, keys);
    if (originalDeleted || actualDeleted) {
      const redacted = Object.fromEntries(Object.entries(object).map(([field, item]) => [field, redactBatteryEvidence(item, ids, keys, field)]));
      return { ...redacted, ...(originalDeleted ? { originalLoanId: null } : {}), ...(actualDeleted ? { loanId: null, source: undefined } : {}), specificationMatch: null, differences: [] };
    }
  }
  return Object.fromEntries(Object.entries(object).map(([field, item]) => [field,
    batteryObjectPaths.has(path) && (ids.has(field) || keys.has(field))
      ? { batteryId: resolveId(field, ids), deleted: true }
      : redactBatteryEvidence(item, ids, keys, field)]));
}

export function referencesBattery(value: unknown, ids: ReadonlySet<string>, keys: ReadonlySet<string>, path = ""): boolean {
  if (typeof value === "string") return batteryIdPaths.has(path) && (ids.has(value) || keys.has(value));
  if (Array.isArray(value)) return value.some(item => referencesBattery(item, ids, keys, path));
  if (!value || typeof value !== "object") return false;
  if (batteryIdentity(value as Record<string, unknown>, ids, keys, path)) return true;
  return Object.entries(value).some(([field, item]) => batteryObjectPaths.has(path) && (ids.has(field) || keys.has(field)) || referencesBattery(item, ids, keys, field));
}
