import { z } from "zod";
import type { BatteryRecord } from "./domain";
import { ageInDays, currentSydneyDate, isDateOnly } from "./battery-age";
const availability = z.enum(["any", "known", "unknown"]).default("any");
const positiveBound = z.number().finite().positive().nullable().default(null);
const ageBound = z.number().finite().int().nonnegative().max(3652058).nullable().default(null);
const dateBound = z.string().refine(isDateOnly, "Use a real calendar date in YYYY-MM-DD format.").nullable().default(null);
export const inventoryFilterSchema = z.object({
    personalScope: z.enum(["all", "responsible", "borrowed"]).default("all"),
    status: z.enum(["all", "in", "out"]).default("all"), building: z.string().max(64).default("all"), room: z.string().max(64).default("all"), owner: z.string().max(64).default("all"), search: z.string().max(200).default(""),
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
export function filterBatteries(batteries: BatteryRecord[], input: InventoryFilterInput, asOfOn: string = currentSydneyDate(), viewerAccountId: string | null = null) {
    const filter = inventoryFilterSchema.parse(input);
    const query = filter.search.trim().toLowerCase();
    return batteries.filter(battery => (filter.personalScope === "all" || !!viewerAccountId && (filter.personalScope === "responsible" ? battery.ownerAccountId === viewerAccountId : !!battery.loanId && battery.borrowerAccountId === viewerAccountId))
        && (filter.status === "all" || (filter.status === "out" ? !!battery.loanId : !battery.loanId))
        && (filter.building === "all" || battery.homeBuildingId === filter.building)
        && (filter.room === "all" || (filter.room === "__unspecified" ? !battery.homeRoomId : battery.homeRoomId === filter.room))
        && (filter.owner === "all" || battery.ownerId === filter.owner)
        && (filter.chemistryUnknown ? !battery.chemistry.trim() : filter.chemistry === null || battery.chemistry === filter.chemistry)
        && (filter.holder === "all" || !!battery.loanId && (filter.holder === "__legacy" ? battery.borrowerKind === "legacy" : battery.borrowerKind === "staff" && battery.borrowerAccountId === filter.holder))
        && (filter.modelUnknown ? !battery.model.trim() : filter.model === null || battery.model === filter.model)
        && matchesRange(battery.capacityMah, filter.capacityMode, filter.capacityMinMah, filter.capacityMaxMah)
        && matchesRange(battery.voltage, filter.voltageMode, filter.voltageMin, filter.voltageMax)
        && matchesRange(ageInDays(battery.manufacturedOn, asOfOn), filter.ageMode, filter.ageMinDays, filter.ageMaxDays)
        && matchesRange(timestampDate(battery.lastCheckedOutAt), filter.checkoutMode, filter.checkoutFrom, filter.checkoutTo)
        && matchesRange(timestampDate(battery.chargedAt), filter.chargeMode, filter.chargeFrom, filter.chargeTo)
        && `${battery.id} ${battery.name} ${battery.chemistry} ${battery.model} ${battery.tagId ?? ""} ${battery.ownerName} ${battery.borrowerName ?? ""} ${battery.homeBuildingId ?? ""} ${battery.homeBuildingName ?? ""} ${battery.homeRoomNumber ?? ""} ${battery.homeRoomName ?? ""}`.toLowerCase().includes(query));
}
export const exportSections = [
    { id: "specifications", label: "Identity and specifications", note: "Identifiers, specifications, manufacture and first-use dates, age and record version" },
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
