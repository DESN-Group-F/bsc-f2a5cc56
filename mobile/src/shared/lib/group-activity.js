import { teachingGroupEvidenceSchema } from "./teaching-context.js";
import { defaultInventoryFilter } from "./inventory-query.js";
/** Group only persisted operation snapshots; current private definitions never rewrite history. */
export function groupActivity(events) {
    const result = [], grouped = new Map();
    for (const event of events) {
        const parsed = teachingGroupEvidenceSchema.safeParse(event.details.teachingGroup);
        if (!parsed.success || !event.batteryId || !parsed.data.batteryIds.includes(event.batteryId)) {
            result.push(event);
            continue;
        }
        const group = parsed.data;
        const key = JSON.stringify([group.operationId, event.action, event.at, event.actorName, group]);
        const existing = grouped.get(key);
        if (existing)
            existing.members.push(event);
        else {
            const entry = { ...event, id: `group:${event.id}`, batteryId: null, teachingGroup: group, members: [event] };
            grouped.set(key, entry);
            result.push(entry);
        }
    }
    return result;
}
/** Sorting alone must not hide historical events whose current battery is unavailable. */
export function hasActivityBatteryCriteria(filter) {
    if (!filter)
        return false;
    const defaults = { ...defaultInventoryFilter(), lifecycle: "all" };
    return Object.keys(defaults).some(key => key !== "sortBy" && key !== "sortDirection" && (key === "search" ? filter.search.trim() : filter[key]) !== defaults[key]);
}
export function filterActivity(entries, search, groupId = null, batteryIds = null) {
    const query = search.trim().toLowerCase();
    return entries.filter(entry => (!groupId || entry.teachingGroup?.id === groupId)
        && (!batteryIds || (entry.members ?? [entry]).some(member => !!member.batteryId && batteryIds.has(member.batteryId)))
        && `${entry.action} ${entry.actorName} ${entry.at} ${entry.batteryId ?? ""} ${JSON.stringify(entry.details)} ${JSON.stringify(entry.members ?? [])}`.toLowerCase().includes(query));
}
