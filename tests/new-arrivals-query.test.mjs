import { test } from "node:test";
import assert from "node:assert/strict";
import { filterBatteries, defaultInventoryFilter } from "../work/qa/inventory-query.mjs";
import { advanceArrivalClock, inventoryRevisionKey, recentNewArrivals, NEW_ARRIVAL_WINDOW_MS } from "../work/qa/new-arrivals.mjs";

const now = "2026-10-08T03:00:00.000Z";
const earlier = hours => new Date(Date.parse(now) - hours * 3600000).toISOString();
const arrivals = { serverNow: now, throughSequence: 9, acknowledgedThroughSequence: 4, unreadCount: 2, items: [
    { batteryId: "BAT-1", sequence: 5, registeredAt: earlier(1), isUnread: true },
    { batteryId: "BAT-2", sequence: 6, registeredAt: earlier(47), isUnread: true },
    { batteryId: "BAT-3", sequence: 7, registeredAt: earlier(2), isUnread: false },
    { batteryId: "BAT-4", sequence: 8, registeredAt: earlier(48), isUnread: true },
    { batteryId: "BAT-5", sequence: 9, registeredAt: earlier(-1), isUnread: true },
] };
const battery = (n, extra = {}) => ({ id: `BAT-${n}`, name: `Battery ${n}`, registeredAt: earlier(1), chemistry: "LiPo", model: "Recorded model", capacityMah: null, voltage: null, tagId: null, ownerId: "owner", ownerAccountId: "staff-a", ownerName: "Staff A", lifecycleStatus: "active", loanId: null, chargedAt: null, observedAt: null, manufacturedOn: null, lastCheckedOutAt: null, ...extra });
const batteries = [battery(1), battery(2, { loanId: "loan", borrowerAccountId: "staff-b" }), battery(3), battery(4), battery(5), battery(6, { lifecycleStatus: "scrapped" })];
const query = (filter, context = arrivals, group = []) => filterBatteries(batteries, filter, "2026-10-08", "staff-a", group, context).map(item => item.id);

test("recent registration is evidence-based, independent of read state and bounded to exactly 48 hours", () => {
    assert.deepEqual(recentNewArrivals(arrivals).map(item => item.batteryId), ["BAT-1", "BAT-2", "BAT-3"]);
    assert.deepEqual(recentNewArrivals(undefined), []);
    assert.deepEqual(recentNewArrivals({ ...arrivals, serverNow: "invalid" }), []);
    assert.deepEqual(query({ newArrivalsOnly: true }), ["BAT-1", "BAT-2", "BAT-3"]);
    assert.deepEqual(query({ newArrivalsOnly: true }, null), []);
});

test("new arrivals compose with status, personal scope, search, ordering and fixed group instead of replacing them", () => {
    assert.deepEqual(query({ newArrivalsOnly: true, status: "in" }), ["BAT-1", "BAT-3"]);
    assert.deepEqual(query({ newArrivalsOnly: true, status: "out" }), ["BAT-2"]);
    assert.deepEqual(query({ newArrivalsOnly: true, personalScope: "borrowed" }), []);
    assert.deepEqual(query({ newArrivalsOnly: true, personalScope: "responsible", search: "Battery 3" }), ["BAT-3"]);
    assert.deepEqual(query({ newArrivalsOnly: true, sortBy: "id", sortDirection: "desc" }), ["BAT-3", "BAT-2", "BAT-1"]);
    const id = crypto.randomUUID(), group = [{ id, state: "active", ownerAccountId: "staff-a", batteryIds: ["BAT-2", "BAT-4"] }];
    assert.deepEqual(query({ newArrivalsOnly: true, groupId: id }, arrivals, group), ["BAT-2"]);
    assert.equal(defaultInventoryFilter().newArrivalsOnly, false);
});

test("retirement always excludes a registration even when the caller supplies a stale recent projection", () => {
    const context = { ...arrivals, items: [...arrivals.items, { batteryId: "BAT-6", sequence: 10, registeredAt: earlier(1), isUnread: true }] };
    assert.deepEqual(query({ newArrivalsOnly: true, lifecycle: "all" }, context), ["BAT-1", "BAT-2", "BAT-3"]);
});

test("elapsed server clock expires badges and unread reminders together without changing captured acknowledgement cursor", () => {
    const projected = advanceArrivalClock(arrivals, 3600000);
    assert.deepEqual(projected.items.map(item => item.batteryId), ["BAT-1", "BAT-3"]);
    assert.equal(projected.unreadCount, 1);
    assert.equal(projected.throughSequence, 9);
    assert.equal(projected.acknowledgedThroughSequence, 4);
    assert.deepEqual(advanceArrivalClock(arrivals, NEW_ARRIVAL_WINDOW_MS).items, []);
    assert.equal(advanceArrivalClock(arrivals, NEW_ARRIVAL_WINDOW_MS).unreadCount, 0);
    assert.equal(advanceArrivalClock(arrivals, -60000).serverNow, now);
});

test("poll clock alone preserves revision, whereas read state, expiry and business changes invalidate it", () => {
    const snapshot = { dataset: "demo", batteries, newArrivals: arrivals };
    const clockOnly = { ...snapshot, newArrivals: { ...arrivals, serverNow: earlier(-0.01) } };
    assert.equal(inventoryRevisionKey(snapshot), inventoryRevisionKey(clockOnly));
    assert.notEqual(inventoryRevisionKey(snapshot), inventoryRevisionKey({ ...snapshot, newArrivals: { ...arrivals, acknowledgedThroughSequence: 9, unreadCount: 0 } }));
    assert.notEqual(inventoryRevisionKey(snapshot), inventoryRevisionKey({ ...snapshot, newArrivals: advanceArrivalClock(arrivals, 3600000) }));
    assert.notEqual(inventoryRevisionKey(snapshot), inventoryRevisionKey({ ...snapshot, batteries: batteries.slice(1) }));
});
