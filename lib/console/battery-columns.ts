import type { BatteryRecord, InventorySnapshot } from "../domain";
import { ageInDays, currentSydneyDate } from "../battery-age";
import { isActiveBattery } from "../battery-lifecycle";
import type { EditableField } from "./battery-edits";
import type { InventoryFilter } from "../inventory-query";

export type ColumnContext = { snapshot: InventorySnapshot; today: string };
export type SortValue = string | number | null;

export type BatteryColumn = {
  id: string;
  label: string;
  /** Default visibility; the identity column is always shown. */
  visible: boolean;
  width: number;
  align?: "end";
  edit?: EditableField;
  /** Shared query sort key, so exports and the full application order records the same way. */
  sharedSort?: InventoryFilter["sortBy"];
  sortValue: (battery: BatteryRecord, context: ColumnContext) => SortValue;
  text: (battery: BatteryRecord, context: ColumnContext) => string;
};

const time = (value: string | null | undefined) => {
  const parsed = value ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
};
const dateFormat = new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Sydney", day: "numeric", month: "short", year: "numeric" });
const dateTimeFormat = new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Sydney", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
export function shortDate(value: string | null | undefined): string {
  const parsed = time(value);
  return parsed === null ? "" : dateFormat.format(parsed);
}
export function shortDateTime(value: string | null | undefined): string {
  const parsed = time(value);
  return parsed === null ? "" : dateTimeFormat.format(parsed);
}
/** Date-only fields are calendar dates, not instants; render them without a time zone shift. */
export function calendarDate(value: string | null | undefined): string {
  if (!value) return "";
  const parsed = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(parsed) ? new Intl.DateTimeFormat("en-AU", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" }).format(parsed) : value;
}

export function longCalendarDate(value: string): string {
  const parsed = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(parsed) ? new Intl.DateTimeFormat("en-AU", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" }).format(parsed) : value;
}

export function statusLabel(battery: BatteryRecord): "In store" | "In use" | "Scrapped" | "Permanently removed" {
  if (battery.lifecycleStatus === "scrapped") return "Scrapped";
  if (battery.lifecycleStatus === "permanently_removed") return "Permanently removed";
  return battery.loanId ? "In use" : "In store";
}

export const inspectionOutcomeLabels = { no_concern_observed: "No concern", concern_observed: "Concern", inconclusive: "Inconclusive" } as const;
export function inspectionLabel(battery: BatteryRecord): string {
  const preview = battery.inspectionPreview;
  if (!preview) return "";
  if (!preview.latest) return "None recorded";
  return `${inspectionOutcomeLabels[preview.latest.outcome]} · ${shortDate(preview.latest.performedAt)}`;
}

export function storageLabel(battery: BatteryRecord): string {
  if (!battery.homeBuildingId) return "Not recorded";
  const room = battery.homeRoomId
    ? `${battery.homeRoomNumber && !battery.homeRoomIsPlaceholder ? `${battery.homeRoomNumber} · ` : ""}${battery.homeRoomName ?? battery.homeRoomId}${battery.homeRoomIsPlaceholder ? " (placeholder)" : ""}`
    : "Room not specified";
  return `${battery.homeBuildingId} · ${room}`;
}

export function observationLabel(battery: BatteryRecord): string {
  if (!battery.observedAt) return "Not observed";
  const place = battery.observationRoomSnapshot === "recorded" && battery.observedRoom ? battery.observedRoom : `Room ${battery.observedRoomId ?? "unknown"} (label unavailable)`;
  return `${place} · ${shortDate(battery.observedAt)}`;
}

const text = (value: string | null | undefined) => value?.trim() || "";
const nullableText = (value: string | null | undefined): SortValue => value?.trim() ? value.trim().toLowerCase() : null;

export const batteryColumns: BatteryColumn[] = [
  { id: "id", label: "Battery ID", visible: true, width: 120, sharedSort: "id", sortValue: (b) => b.id, text: (b) => b.id },
  { id: "name", label: "Name", visible: true, width: 180, edit: "name", sharedSort: "name", sortValue: (b) => nullableText(b.name), text: (b) => b.name },
  { id: "status", label: "Status", visible: true, width: 190, sortValue: (b) => `${statusLabel(b)} ${b.loanId ? b.borrowerName ?? "" : ""}`.toLowerCase(), text: (b) => (b.loanId && b.lifecycleStatus === "active" ? `In use · ${text(b.borrowerName)}` : statusLabel(b)) },
  { id: "owner", label: "Responsible owner", visible: true, width: 150, edit: "ownerId", sortValue: (b) => nullableText(b.ownerName), text: (b) => b.ownerName },
  { id: "model", label: "Model", visible: true, width: 140, edit: "model", sortValue: (b) => nullableText(b.model), text: (b) => text(b.model) },
  { id: "chemistry", label: "Chemistry", visible: true, width: 88, edit: "chemistry", sortValue: (b) => nullableText(b.chemistry), text: (b) => text(b.chemistry) },
  { id: "storage", label: "Registered storage", visible: true, width: 170, edit: "homeRoomId", sortValue: (b) => (b.homeBuildingId ? storageLabel(b).toLowerCase() : null), text: (b) => storageLabel(b) },
  { id: "inspection", label: "Latest inspection", visible: true, width: 150, sortValue: (b) => (b.inspectionPreview?.latest ? time(b.inspectionPreview.latest.performedAt) : null), text: (b) => inspectionLabel(b) },
  { id: "capacity", label: "Capacity (mAh)", visible: false, width: 112, align: "end", edit: "capacityMah", sharedSort: "capacity", sortValue: (b) => (Number.isFinite(b.capacityMah) ? b.capacityMah : null), text: (b) => (b.capacityMah === null ? "" : b.capacityMah.toLocaleString("en-AU")) },
  { id: "voltage", label: "Voltage (V)", visible: false, width: 92, align: "end", edit: "voltage", sharedSort: "voltage", sortValue: (b) => (Number.isFinite(b.voltage) ? b.voltage : null), text: (b) => (b.voltage === null ? "" : String(b.voltage)) },
  { id: "holder", label: "Held by", visible: false, width: 150, sortValue: (b) => (b.loanId ? nullableText(b.borrowerName) : null), text: (b) => (b.loanId ? text(b.borrowerName) : "") },
  { id: "tag", label: "RFID tag", visible: false, width: 150, edit: "tagId", sortValue: (b) => nullableText(b.tagId), text: (b) => text(b.tagId) },
  { id: "observed", label: "Last observed", visible: false, width: 190, sharedSort: "observed", sortValue: (b) => time(b.observedAt), text: (b) => observationLabel(b) },
  { id: "checkout", label: "Latest checkout", visible: false, width: 150, sharedSort: "checkout", sortValue: (b) => time(b.lastCheckedOutAt), text: (b) => shortDateTime(b.lastCheckedOutAt) },
  { id: "registered", label: "Registered", visible: false, width: 120, sharedSort: "registered", sortValue: (b) => time(b.registeredAt), text: (b) => shortDate(b.registeredAt) },
  { id: "manufactured", label: "Manufactured", visible: false, width: 120, edit: "manufacturedOn", sharedSort: "manufactured", sortValue: (b) => time(b.manufacturedOn), text: (b) => calendarDate(b.manufacturedOn) },
  { id: "firstUsed", label: "First used", visible: false, width: 120, edit: "firstUsedOn", sortValue: (b) => time(b.firstUsedOn), text: (b) => calendarDate(b.firstUsedOn) },
  { id: "age", label: "Manufacture age (days)", visible: false, width: 120, align: "end", sharedSort: "age", sortValue: (b, c) => ageInDays(b.manufacturedOn, c.today), text: (b, c) => { const days = ageInDays(b.manufacturedOn, c.today); return days === null ? "" : String(days); } },
  { id: "charged", label: "Latest charge", visible: false, width: 150, sharedSort: "charge", sortValue: (b) => time(b.chargedAt), text: (b) => shortDateTime(b.chargedAt) },
];

export const columnById = new Map(batteryColumns.map((column) => [column.id, column]));

/** Unknown values sort last in both directions; ties fall back to Battery ID, as in the shared query. */
export function sortForColumn(batteries: readonly BatteryRecord[], columnId: string, direction: "asc" | "desc", context: ColumnContext): BatteryRecord[] {
  const column = columnById.get(columnId) ?? batteryColumns[0];
  const keyed = batteries.map((battery) => ({ battery, value: column.sortValue(battery, context) }));
  keyed.sort((a, b) => {
    if (a.value === null && b.value !== null) return 1;
    if (b.value === null && a.value !== null) return -1;
    const compared = a.value === null || b.value === null ? 0
      : typeof a.value === "number" && typeof b.value === "number" ? a.value - b.value
        : String(a.value).localeCompare(String(b.value), "en", { numeric: true, sensitivity: "base" });
    if (compared) return direction === "desc" ? -compared : compared;
    return a.battery.id.localeCompare(b.battery.id, "en", { numeric: true });
  });
  return keyed.map((item) => item.battery);
}

export function defaultColumnIds(): string[] {
  return batteryColumns.filter((column) => column.visible).map((column) => column.id);
}

export function contextFor(snapshot: InventorySnapshot, now = new Date()): ColumnContext {
  return { snapshot, today: currentSydneyDate(now) };
}

export function isEditableRow(battery: BatteryRecord) {
  return isActiveBattery(battery);
}
