import { currentSydneyDate } from "./battery-age.js";
import { defaultInventoryFilter, filterBatteries, inventoryFilterSchema } from "./inventory-query.js";
export function hasBatterySelectionCriteria(filters, defaultLifecycle = "active") {
    const defaults = { ...defaultInventoryFilter(), lifecycle: defaultLifecycle };
    return Object.keys(defaults).some(key => key !== "sortBy" && key !== "sortDirection" && (key === "search" ? filters.search.trim() : filters[key]) !== defaults[key]);
}
/** Filter the caller's eligible candidates without changing its selection or operation scope. */
export function getFilteredBatteries(data, filters, candidates = data.batteries) {
    const parsed = inventoryFilterSchema.safeParse(filters);
    if (!parsed.success)
        return { batteries: [], error: parsed.error.issues.map(issue => issue.message).join(" ") };
    try {
        return { batteries: filterBatteries(candidates, parsed.data, currentSydneyDate(), data.user.id, data.teachingGroups ?? [], data.newArrivals, data.rooms), error: "" };
    }
    catch (error) {
        return { batteries: [], error: error.message || "These battery filters could not be applied. Clear filters and try again." };
    }
}
