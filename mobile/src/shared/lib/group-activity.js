import { teachingGroupEvidenceSchema } from "./teaching-context.js";
import { defaultInventoryFilter } from "./inventory-query.js";
import { teachingCheckoutRunSchema, teachingCheckoutChangeSchema } from "./teaching-checkouts.js";
import { actionNames } from "./client-utils.js";
export function teachingReplacementDescription(event) {
    const change = teachingCheckoutChangeSchema.safeParse(event.details.teachingCheckoutChange);
    if (change.success && change.data.action === "exchange") {
        const replacement = change.data.mappings[0], outgoing = change.data.outgoing;
        if (outgoing && (outgoing.batteryId === event.batteryId || replacement.actual.batteryId === event.batteryId))
            return `Exchange for ${replacement.original.batteryId}: ${outgoing.batteryId} → ${replacement.actual.batteryId} · ${"deleted" in outgoing ? "Outgoing evidence deleted" : outgoing.returned ? "Outgoing battery returned at exchange" : "Outgoing battery not returned at exchange"} · Exact loan: ${event.details.loanId ?? "Deleted evidence"}`;
    }
    const parsed = teachingCheckoutRunSchema.safeParse(event.details.teachingCheckout);
    if (!parsed.success)
        return null;
    const mapping = (change.success ? change.data.mappings : parsed.data.mappings).find(item => item.actual.batteryId === event.batteryId && (event.details.loanId === undefined || item.loanId === event.details.loanId));
    if (!mapping)
        return null;
    const method = mapping.method === "manual" ? "Manual alternative" : mapping.method === "automatic" ? "Same known model and specifications" : "Original member";
    return `${mapping.original.batteryId} → ${mapping.actual.batteryId} · ${method}${mapping.loanOrigin === "existing" ? " · Existing loan continued" : ""} · Input: ${mapping.source?.kind === "native_nfc" ? "Native NFC" : mapping.source?.kind === "tag" ? "Entered registered tag" : mapping.source ? "Inventory selection" : "Deleted evidence"} · Exact loan: ${mapping.loanId ?? "Deleted evidence"}`;
}
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
        && `${entry.action} ${actionNames[entry.action] ?? ""} ${entry.actorName} ${entry.at} ${entry.batteryId ?? ""} ${JSON.stringify(entry.details)} ${JSON.stringify(entry.members ?? [])}`.toLowerCase().includes(query));
}
