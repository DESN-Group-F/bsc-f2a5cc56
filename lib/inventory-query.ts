import { z } from "zod";
import type { BatteryRecord } from "./domain";
export const inventoryFilterSchema = z.object({
    status: z.enum(["all", "in", "out"]).default("all"), building: z.string().max(64).default("all"), room: z.string().max(64).default("all"), owner: z.string().max(64).default("all"), search: z.string().max(200).default(""),
});
export type InventoryFilter = z.infer<typeof inventoryFilterSchema>;
export function filterBatteries(batteries: BatteryRecord[], filter: InventoryFilter) {
    const query = filter.search.trim().toLowerCase();
    return batteries.filter(battery => (filter.status === "all" || (filter.status === "out" ? !!battery.loanId : !battery.loanId)) && (filter.building === "all" || battery.homeBuildingId === filter.building) && (filter.room === "all" || (filter.room === "__unspecified" ? !battery.homeRoomId : battery.homeRoomId === filter.room)) && (filter.owner === "all" || battery.ownerId === filter.owner) && `${battery.id} ${battery.name} ${battery.chemistry} ${battery.model} ${battery.tagId ?? ""} ${battery.ownerName} ${battery.borrowerName ?? ""} ${battery.homeBuildingId ?? ""} ${battery.homeBuildingName ?? ""} ${battery.homeRoomNumber ?? ""} ${battery.homeRoomName ?? ""}`.toLowerCase().includes(query));
}
export const exportSections = [
    { id: "specifications", label: "Identity and specifications", note: "Identifiers, chemistry, model, capacity, voltage and record version" },
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
