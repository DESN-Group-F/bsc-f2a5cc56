import type { BatteryRecord, InventorySnapshot } from "./domain";
import { currentSydneyDate } from "./battery-age";
import { defaultInventoryFilter, filterBatteries, inventoryFilterSchema, type InventoryFilter } from "./inventory-query";

export function hasBatterySelectionCriteria(filters: InventoryFilter, defaultLifecycle: InventoryFilter["lifecycle"] = "active"): boolean {
    const defaults = { ...defaultInventoryFilter(), lifecycle: defaultLifecycle };
    return (Object.keys(defaults) as (keyof InventoryFilter)[]).some(key => key !== "sortBy" && key !== "sortDirection" && (key === "search" ? filters.search.trim() : filters[key]) !== defaults[key]);
}

/** Filter the caller's eligible candidates without changing its selection or operation scope. */
export function getFilteredBatteries(data: InventorySnapshot, filters: InventoryFilter, candidates: BatteryRecord[] = data.batteries) {
    const parsed = inventoryFilterSchema.safeParse(filters);
    if (!parsed.success) return { batteries: [] as BatteryRecord[], error: parsed.error.issues.map(issue => issue.message).join(" ") };
    try {
        return { batteries: filterBatteries(candidates, parsed.data, currentSydneyDate(), data.user.id, data.teachingGroups ?? [], data.newArrivals), error: "" };
    } catch (error) {
        return { batteries: [] as BatteryRecord[], error: (error as Error).message || "These battery filters could not be applied. Clear filters and try again." };
    }
}
