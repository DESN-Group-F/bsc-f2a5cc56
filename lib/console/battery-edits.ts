import { validateBatteryDates, type BatteryRecord, type InventorySnapshot } from "../domain";
import { isDateOnly } from "../battery-age";
import { isActiveBattery } from "../battery-lifecycle";
import { canonicalModelJson } from "../battery-models";
import { operatorEditPayloadSchema, type OperatorEditPayload } from "../operator-edit";

/**
 * Saved battery metadata that an administrator can change from the management console.
 * Identity, registration time, lifecycle, loans and observations are never editable here;
 * the registered building is always J18 (the only selectable building).
 */
export const editableFields = ["name", "model", "chemistry", "capacityMah", "voltage", "tagId", "ownerId", "homeRoomId", "manufacturedOn", "firstUsedOn"] as const;
export type EditableField = (typeof editableFields)[number];
export type EditableValues = {
  name: string; model: string; chemistry: string; capacityMah: number | null; voltage: number | null; tagId: string | null;
  ownerId: string; homeRoomId: string | null; manufacturedOn: string | null; firstUsedOn: string | null;
};
export type BatteryChanges = Partial<EditableValues>;

export const fieldLabels: Record<EditableField, string> = {
  name: "Name", model: "Model", chemistry: "Chemistry", capacityMah: "Capacity (mAh)", voltage: "Voltage (V)", tagId: "RFID tag",
  ownerId: "Responsible owner", homeRoomId: "Storage room", manufacturedOn: "Manufactured", firstUsedOn: "First used",
};
export const REGISTERED_BUILDING = "J18";

export function recordValues(battery: BatteryRecord): EditableValues {
  return {
    name: battery.name, model: battery.model, chemistry: battery.chemistry, capacityMah: battery.capacityMah, voltage: battery.voltage,
    tagId: battery.tagId, ownerId: battery.ownerId, homeRoomId: battery.homeRoomId, manufacturedOn: battery.manufacturedOn, firstUsedOn: battery.firstUsedOn,
  };
}

/** Why a battery's saved metadata cannot be edited from the console, or null. */
export function editBlockReason(battery: BatteryRecord): string | null {
  if (!isActiveBattery(battery)) return "Retired batteries cannot be edited. Their records stay as history.";
  return null;
}

type Parsed = { ok: true; value: EditableValues[EditableField] } | { ok: false; error: string };
const positive = (raw: string, max: number, label: string): Parsed => {
  const text = raw.trim();
  if (!text) return { ok: true, value: null };
  const value = Number(text);
  if (!Number.isFinite(value) || value <= 0) return { ok: false, error: `${label} must be a positive number, or empty if not recorded.` };
  if (value > max) return { ok: false, error: `${label} must be at most ${max.toLocaleString("en-AU")}.` };
  return { ok: true, value };
};

/** Turns typed cell text into a field value with the same limits the server enforces. Empty means not recorded. */
export function parseFieldInput(field: EditableField, raw: string): Parsed {
  const text = raw.trim();
  switch (field) {
    case "name":
      if (text.length < 2) return { ok: false, error: "Use a name of at least 2 characters." };
      if (text.length > 120) return { ok: false, error: "Use a name of at most 120 characters." };
      return { ok: true, value: text };
    case "model":
      return text.length > 120 ? { ok: false, error: "Use a model of at most 120 characters." } : { ok: true, value: text };
    case "chemistry":
      return text.length > 40 ? { ok: false, error: "Use a chemistry of at most 40 characters." } : { ok: true, value: text };
    case "capacityMah": return positive(text, 1_000_000, "Capacity");
    case "voltage": return positive(text, 1000, "Voltage");
    case "tagId":
      if (!text) return { ok: true, value: null };
      return text.length > 128 ? { ok: false, error: "Use a tag identifier of at most 128 characters." } : { ok: true, value: text };
    case "ownerId":
      return text ? { ok: true, value: text } : { ok: false, error: "Choose the responsible staff owner." };
    case "homeRoomId":
      return { ok: true, value: text || null };
    case "manufacturedOn":
    case "firstUsedOn":
      if (!text) return { ok: true, value: null };
      return isDateOnly(text) ? { ok: true, value: text } : { ok: false, error: "Use a real calendar date (YYYY-MM-DD), or leave it empty if unknown." };
  }
}

/** Only the fields that differ from the record as loaded. */
export function effectiveChanges(battery: BatteryRecord, changes: BatteryChanges): BatteryChanges {
  const current = recordValues(battery);
  const result: BatteryChanges = {};
  for (const field of editableFields) {
    if (!(field in changes)) continue;
    const value = changes[field];
    if (value !== current[field]) (result as Record<string, unknown>)[field] = value;
  }
  return result;
}

export function changedFields(battery: BatteryRecord, changes: BatteryChanges): EditableField[] {
  const effective = effectiveChanges(battery, changes);
  return editableFields.filter((field) => field in effective);
}

export type EditPreparation =
  | { ok: true; payload: OperatorEditPayload; fields: EditableField[]; setsBuilding: boolean }
  | { ok: false; errors: string[] };

/**
 * Builds one exact, reviewed metadata edit. The payload carries the record exactly as it was
 * loaded (version, registration time and every saved field) and the reviewed directory versions;
 * the server rejects it if anything changed in between. Nothing here is a batch transaction.
 */
export function prepareBatteryEdit(input: {
  battery: BatteryRecord; changes: BatteryChanges; snapshot: InventorySnapshot; requestId: string; now?: Date;
}): EditPreparation {
  const { battery, snapshot } = input;
  const errors: string[] = [];
  const blocked = editBlockReason(battery);
  if (blocked) return { ok: false, errors: [blocked] };
  const fields = changedFields(battery, input.changes);
  const setsBuilding = battery.homeBuildingId !== REGISTERED_BUILDING;
  if (!fields.length && !setsBuilding) return { ok: false, errors: ["There are no changes to save for this battery."] };
  const values = { ...recordValues(battery), ...effectiveChanges(battery, input.changes) };
  const owner = snapshot.people.find((person) => person.id === values.ownerId && person.role === "staff" && person.accountId);
  const retainedOwner = values.ownerId === battery.ownerId;
  const ownerAccount = owner && snapshot.staffDirectory.find((account) => account.id === owner.accountId);
  if (!owner || !owner.accountId) errors.push("Choose a staff account as the responsible owner.");
  else if (!retainedOwner && ownerAccount && !ownerAccount.active) errors.push("Choose an active staff account as the new responsible owner.");
  const building = snapshot.buildings.find((item) => item.id === REGISTERED_BUILDING);
  if (!building) errors.push("The J18 building record is not available. Refresh the inventory.");
  const room = values.homeRoomId ? snapshot.rooms.find((item) => item.id === values.homeRoomId) : null;
  if (values.homeRoomId && (!room || room.buildingId !== REGISTERED_BUILDING || !room.selectable)) errors.push("Choose an available J18 room, or leave the room unspecified.");
  if (values.tagId) {
    const holder = snapshot.batteries.find((other) => other.id !== battery.id && other.tagId === values.tagId);
    if (holder) errors.push(`RFID tag ${values.tagId} is already assigned to ${holder.id}.`);
  }
  try { validateBatteryDates(values, input.now ?? new Date()); } catch (error) { errors.push((error as Error).message); }
  if (errors.length || !owner?.accountId || !building) return { ok: false, errors };
  const before = { ...recordValues(battery), homeBuildingId: battery.homeBuildingId, version: battery.version, registeredAt: battery.registeredAt };
  const candidate = {
    requestId: input.requestId,
    batteryId: battery.id,
    before,
    fields: { ...values, homeBuildingId: REGISTERED_BUILDING },
    directoryBindings: { ownerVersion: owner.version, ownerAccountId: owner.accountId, buildingVersion: building.version, roomVersion: room ? room.version : null },
  };
  const parsed = operatorEditPayloadSchema.safeParse(candidate);
  if (!parsed.success) return { ok: false, errors: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`) };
  return { ok: true, payload: parsed.data, fields, setsBuilding };
}

/** True when the loaded record no longer matches what a draft was based on. */
export function draftIsStale(baseVersion: number, battery: BatteryRecord | undefined): boolean {
  return !battery || battery.version !== baseVersion;
}

/** Stable comparison used by tests and the review screen. */
export function sameValue(a: unknown, b: unknown): boolean {
  return canonicalModelJson(a) === canonicalModelJson(b);
}

/** Plain-text description of a field value for review and history. */
export function describeValue(field: EditableField, value: unknown, snapshot: InventorySnapshot): string {
  if (value === null || value === "") return "Not recorded";
  if (field === "ownerId") return snapshot.people.find((person) => person.id === value)?.name ?? String(value);
  if (field === "homeRoomId") {
    const room = snapshot.rooms.find((item) => item.id === value);
    return room ? `${room.number && !room.isPlaceholder ? `${room.number} · ` : ""}${room.name}${room.isPlaceholder ? " (placeholder)" : ""}` : String(value);
  }
  if (field === "capacityMah") return `${Number(value).toLocaleString("en-AU")} mAh`;
  if (field === "voltage") return `${value} V`;
  return String(value);
}
