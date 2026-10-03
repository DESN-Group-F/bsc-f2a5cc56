import { z } from "zod";
import { DomainError, type BatteryRecord } from "./domain";
import type { TeachingGroup } from "./teaching-groups";
import { ageInDays, currentSydneyDate, isDateOnly } from "./battery-age";
import { isActiveBattery } from "./battery-lifecycle";
const availability = z.enum(["any", "known", "unknown"]).default("any");
const positiveBound = z.number().finite().positive().nullable().default(null);
const ageBound = z.number().finite().int().nonnegative().max(3652058).nullable().default(null);
const dateBound = z.string().refine(isDateOnly, "Use a real calendar date in YYYY-MM-DD format.").nullable().default(null);
export const inventorySortOptions = [
    { id: "id", label: "Battery ID" }, { id: "name", label: "Battery name" },
    { id: "registered", label: "Registration time" }, { id: "manufactured", label: "Manufacture date" },
    { id: "age", label: "Age since manufacture" }, { id: "service_age", label: "Time in service" },
    { id: "checkout", label: "Latest checkout time" }, { id: "charge", label: "Latest charge time" },
    { id: "observed", label: "Latest observation time" }, { id: "capacity", label: "Capacity (mAh)" },
    { id: "voltage", label: "Voltage (V)" }, { id: "charge_duration", label: "Latest charging duration" },
] as const;
export const inventoryFilterSchema = z.object({
    groupId: z.string().uuid().nullable().default(null),
    sortBy: z.enum(["id", "name", "registered", "manufactured", "age", "service_age", "checkout", "charge", "observed", "capacity", "voltage", "charge_duration"]).default("id"),
    sortDirection: z.enum(["asc", "desc"]).default("asc"),
    personalScope: z.enum(["all", "responsible", "borrowed"]).default("all"),
    lifecycle: z.enum(["active", "all", "scrapped", "permanently_removed"]).default("active"),
    status: z.enum(["all", "in", "out"]).default("all"), building: z.string().max(64).default("all"), room: z.string().max(64).default("all"), owner: z.string().max(64).default("all"), search: z.string().max(200).default(""),
    observedRoom: z.string().max(64).default("all"),
    chemistry: z.string().max(40).nullable().default(null), chemistryUnknown: z.boolean().default(false),
    holder: z.string().max(128).default("all"), model: z.string().max(120).nullable().default(null), modelUnknown: z.boolean().default(false),
    capacityMode: availability, capacityMinMah: positiveBound, capacityMaxMah: positiveBound,
    voltageMode: availability, voltageMin: positiveBound, voltageMax: positiveBound,
    ageMode: availability, ageMinDays: ageBound, ageMaxDays: ageBound,
    checkoutMode: availability, checkoutFrom: dateBound, checkoutTo: dateBound,
    chargeMode: availability, chargeFrom: dateBound, chargeTo: dateBound,
}).superRefine((filter, context) => {
    const ranges = [
        ["capacityMode", "capacityMinMah", "capacityMaxMah", "Capacity"],
        ["voltageMode", "voltageMin", "voltageMax", "Voltage"],
        ["ageMode", "ageMinDays", "ageMaxDays", "Age since manufacture"],
        ["checkoutMode", "checkoutFrom", "checkoutTo", "Latest checkout date"],
        ["chargeMode", "chargeFrom", "chargeTo", "Latest charge date"],
    ] as const;
    for (const [mode, lowKey, highKey, label] of ranges) {
        const low = filter[lowKey], high = filter[highKey];
        if (low !== null && high !== null && low > high)
            context.addIssue({ code: z.ZodIssueCode.custom, path: [highKey], message: `${label}: the maximum must be at least the minimum.` });
        if (filter[mode] === "unknown" && (low !== null || high !== null))
            context.addIssue({ code: z.ZodIssueCode.custom, path: [mode], message: `${label}: clear the range before selecting not recorded.` });
    }
    for (const key of ["chemistry", "model"] as const) {
        if (filter[`${key}Unknown`] && filter[key] !== null)
            context.addIssue({ code: z.ZodIssueCode.custom, path: [key], message: `Choose a saved ${key} or not recorded, rather than both.` });
    }
});
export type InventoryFilter = z.infer<typeof inventoryFilterSchema>;
export type InventoryFilterInput = z.input<typeof inventoryFilterSchema>;
export function defaultInventoryFilter(): InventoryFilter { return inventoryFilterSchema.parse({}); }
export function lastObservedLocations(batteries: BatteryRecord[]) {
    const locations = new Map<string, { id: string; label: string; at: number }>();
    for (const battery of batteries) {
        if (!battery.observedAt || !battery.observedRoomId) continue;
        const at = Date.parse(battery.observedAt);
        if (!Number.isFinite(at)) continue;
        const label = battery.observationRoomSnapshot === "recorded" && battery.observedRoom
            ? [battery.observedBuilding, battery.observedRoom].filter(Boolean).join(" · ")
            : `Room ID: ${battery.observedRoomId} · Recorded address unavailable`;
        const existing = locations.get(battery.observedRoomId);
        if (!existing || at > existing.at) locations.set(battery.observedRoomId, { id: battery.observedRoomId, label, at });
    }
    const choices = [...locations.values()];
    const names = new Map<string, number>();
    for (const location of choices) names.set(location.label, (names.get(location.label) || 0) + 1);
    return choices.map(({ id, label }) => ({ id, label: names.get(label)! > 1 ? `${label} · Room ID: ${id}` : label })).sort((a, b) => a.label.localeCompare(b.label, "en", { numeric: true }));
}
function matchesRange(value: number | string | null, mode: "any" | "known" | "unknown", low: number | string | null, high: number | string | null) {
    if (mode === "unknown") return value === null;
    if (value === null) return mode === "any" && low === null && high === null;
    return (low === null || value >= low) && (high === null || value <= high);
}
function timestampDate(value: string | null): string | null {
    if (!value) return null;
    const time = new Date(value);
    return Number.isFinite(time.getTime()) ? currentSydneyDate(time) : null;
}
export function sortBatteries(batteries: BatteryRecord[], input: InventoryFilterInput, asOfOn: string = currentSydneyDate()) {
    const filter = inventoryFilterSchema.parse(input);
    const time = (value: string | null | undefined) => { const parsed = value ? Date.parse(value) : NaN; return Number.isFinite(parsed) ? parsed : null; };
    function value(battery: BatteryRecord): string | number | null {
        switch (filter.sortBy) {
            case "id": return battery.id;
            case "name": return battery.name.trim() || null;
            case "registered": return time(battery.registeredAt);
            case "manufactured": return time(battery.manufacturedOn);
            case "age": return ageInDays(battery.manufacturedOn, asOfOn);
            case "service_age": return ageInDays(battery.firstUsedOn, asOfOn);
            case "checkout": return time(battery.lastCheckedOutAt);
            case "charge": return time(battery.chargedAt);
            case "observed": return time(battery.observedAt);
            case "capacity": return Number.isFinite(battery.capacityMah) ? battery.capacityMah : null;
            case "voltage": return Number.isFinite(battery.voltage) ? battery.voltage : null;
            case "charge_duration": return Number.isFinite(battery.chargeDurationMinutes) ? battery.chargeDurationMinutes : null;
        }
    }
    return [...batteries].sort((a, b) => {
        const left = value(a), right = value(b);
        if (left === null && right !== null) return 1;
        if (right === null && left !== null) return -1;
        const compared = left === null || right === null ? 0 : typeof left === "number" && typeof right === "number" ? left - right : String(left).localeCompare(String(right), "en", { numeric: true, sensitivity: "base" });
        return compared ? (filter.sortDirection === "desc" ? -compared : compared) : a.id.localeCompare(b.id, "en", { numeric: true }) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    });
}
export function filterBatteries(batteries: BatteryRecord[], input: InventoryFilterInput, asOfOn: string = currentSydneyDate(), viewerAccountId: string | null = null, teachingGroups: TeachingGroup[] = []) {
    const filter = inventoryFilterSchema.parse(input);
    const group = filter.groupId ? teachingGroups.find(item => item.id === filter.groupId && item.ownerAccountId === viewerAccountId && item.state === "active") : null;
    if (filter.groupId && !group) throw new DomainError(409, "This teaching group is no longer available in your account and inventory. Clear the group filter or choose a current group.");
    const memberIds = group ? new Set(group.batteryIds) : null;
    const query = filter.search.trim().toLowerCase();
    return sortBatteries(batteries.filter(battery => (!memberIds || memberIds.has(battery.id)) && (filter.personalScope === "all" || !!viewerAccountId && (filter.personalScope === "responsible" ? battery.ownerAccountId === viewerAccountId : !!battery.loanId && battery.borrowerAccountId === viewerAccountId))
        && (filter.lifecycle === "all" || (filter.lifecycle === "active" ? isActiveBattery(battery) : battery.lifecycleStatus === filter.lifecycle))
        && (filter.status === "all" || isActiveBattery(battery) && (filter.status === "out" ? !!battery.loanId : !battery.loanId))
        && (filter.building === "all" || battery.homeBuildingId === filter.building)
        && (filter.room === "all" || (filter.room === "__unspecified" ? !battery.homeRoomId : battery.homeRoomId === filter.room))
        && (filter.observedRoom === "all" || (filter.observedRoom === "__not_observed" ? !battery.observedAt : filter.observedRoom === "__unavailable" ? !!battery.observedAt && battery.observationRoomSnapshot !== "recorded" : !!battery.observedAt && battery.observedRoomId === filter.observedRoom))
        && (filter.owner === "all" || battery.ownerId === filter.owner)
        && (filter.chemistryUnknown ? !battery.chemistry.trim() : filter.chemistry === null || battery.chemistry === filter.chemistry)
        && (filter.holder === "all" || !!battery.loanId && (filter.holder === "__legacy" ? battery.borrowerKind === "legacy" : battery.borrowerKind === "staff" && battery.borrowerAccountId === filter.holder))
        && (filter.modelUnknown ? !battery.model.trim() : filter.model === null || battery.model === filter.model)
        && matchesRange(battery.capacityMah, filter.capacityMode, filter.capacityMinMah, filter.capacityMaxMah)
        && matchesRange(battery.voltage, filter.voltageMode, filter.voltageMin, filter.voltageMax)
        && matchesRange(ageInDays(battery.manufacturedOn, asOfOn), filter.ageMode, filter.ageMinDays, filter.ageMaxDays)
        && matchesRange(timestampDate(battery.lastCheckedOutAt), filter.checkoutMode, filter.checkoutFrom, filter.checkoutTo)
        && matchesRange(timestampDate(battery.chargedAt), filter.chargeMode, filter.chargeFrom, filter.chargeTo)
        && `${battery.id} ${battery.name} ${battery.chemistry} ${battery.model} ${battery.tagId ?? ""} ${battery.ownerName} ${battery.borrowerName ?? ""} ${battery.homeBuildingId ?? ""} ${battery.homeBuildingName ?? ""} ${battery.homeRoomNumber ?? ""} ${battery.homeRoomName ?? ""}`.toLowerCase().includes(query)), filter, asOfOn);
}
export const exportSections = [
    { id: "specifications", label: "Identity and specifications", note: "Identifiers, specifications, registration time, manufacture and first-use dates, age and record version" },
    { id: "responsibility", label: "Responsibility and current loan", note: "Responsible owner, current borrower and checkout time" },
    { id: "storage", label: "Registered storage", note: "Building and optional room" },
    { id: "latest", label: "Latest observation and charge", note: "Dated location evidence, source and charging duration" },
    { id: "loans", label: "Complete loan history", note: "Borrowers, operators, times, returns and corrections" },
    { id: "observations", label: "Complete observation history", note: "Every location reading, received time, saved labels and source" },
    { id: "charges", label: "Complete charging history", note: "Duration, completion time, operator and preserved legacy percentage" },
    { id: "audit", label: "Complete operation history", note: "Recorded actions and their full supporting details" },
    { id: "directories", label: "Related people and locations", note: "Directory records referenced by these batteries and histories" },
] as const;
export type ExportSection = typeof exportSections[number]["id"];
