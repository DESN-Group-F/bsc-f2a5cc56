import { z } from "zod";
export const NEW_ARRIVAL_WINDOW_MS = 48 * 60 * 60 * 1000;
/** A captured snapshot cursor, never the latest cursor at confirmation time. */
export const newArrivalsAcknowledgementSchema = z.object({
    throughSequence: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
}).strict();
/** View acknowledgement and the registration window are independent. */
export function recentNewArrivals(arrivals) {
    if (!arrivals)
        return [];
    const now = Date.parse(arrivals.serverNow);
    if (!Number.isFinite(now))
        return [];
    return arrivals.items.filter(item => {
        const registered = Date.parse(item.registeredAt);
        return Number.isFinite(registered) && registered <= now && now - registered < NEW_ARRIVAL_WINDOW_MS;
    });
}
/** Advance server time by elapsed monotonic time, without trusting the device date. */
export function advanceArrivalClock(arrivals, elapsedMs) {
    if (!arrivals || !Number.isFinite(Date.parse(arrivals.serverNow)))
        return undefined;
    const serverNow = new Date(Date.parse(arrivals.serverNow) + Math.max(0, Number.isFinite(elapsedMs) ? elapsedMs : 0)).toISOString();
    const items = recentNewArrivals({ ...arrivals, items: recentNewArrivals(arrivals), serverNow });
    return { ...arrivals, serverNow, items, unreadCount: items.filter(item => item.isUnread).length };
}
/** Polling the clock alone must not invalidate message or complete-history queries. */
export function inventoryRevisionKey(snapshot) {
    if (!snapshot)
        return "null";
    const { newArrivals, ...inventory } = snapshot;
    if (!newArrivals)
        return JSON.stringify(inventory);
    const registrationState = { ...newArrivals };
    delete registrationState.serverNow;
    return JSON.stringify({ ...inventory, newArrivals: registrationState });
}
