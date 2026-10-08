import type { BatteryRecord, InventorySnapshot } from "./domain";
import type { TeachingGroup } from "./teaching-groups";
import { teachingSpecificationsMatch, type TeachingSelectionSource } from "./teaching-checkouts";

export { teachingSpecificationDifferences } from "./teaching-checkouts";
export type TeachingPersonalScope = "all" | "responsible" | "borrowed";
export type TeachingSelection = {
  originalId: string;
  original: BatteryRecord | null;
  actual: BatteryRecord | null;
  method: "original" | "automatic" | "manual";
  source: TeachingSelectionSource;
  issue?: string;
};

function inScope(battery: BatteryRecord, data: InventorySnapshot, scope: TeachingPersonalScope) {
  return scope === "all" || (scope === "responsible" ? battery.ownerAccountId === data.user.id : !!battery.loanId && battery.borrowerAccountId === data.user.id);
}
function available(battery: BatteryRecord, data: InventorySnapshot, scope: TeachingPersonalScope) {
  return battery.lifecycleStatus === "active" && battery.loanId === null && inScope(battery, data, scope);
}
function compareIds(a: BatteryRecord, b: BatteryRecord) {
  return a.id.localeCompare(b.id, "en", { numeric: true }) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}
/** A room is useful for collection only when its saved building and room still exist. */
function verifiedRoom(battery: BatteryRecord, data: InventorySnapshot): string | null {
  if (!battery.homeRoomId || !battery.homeBuildingId || battery.homeRoomIsPlaceholder !== false) return null;
  const room = data.rooms.find(item => item.id === battery.homeRoomId);
  return room && !room.isPlaceholder && room.buildingId === battery.homeBuildingId && data.buildings.some(item => item.id === room.buildingId) ? room.id : null;
}

export function initialTeachingSelection(data: InventorySnapshot, group: TeachingGroup, requestedIds: readonly string[], personalScope: TeachingPersonalScope): TeachingSelection[] {
  if (group.ownerAccountId !== data.user.id || group.state !== "active") throw new Error("Choose your current active teaching group.");
  if (!requestedIds.length || requestedIds.length > 100 || new Set(requestedIds).size !== requestedIds.length || requestedIds.some(id => !group.batteryIds.includes(id))) throw new Error("Review different members of this fixed teaching group.");
  return requestedIds.map(originalId => {
    const original = data.batteries.find(item => item.id === originalId) ?? null;
    const slot: TeachingSelection = { originalId, original, actual: null, method: "original", source: { kind: "selection" } };
    if (!original) slot.issue = "This fixed member is unavailable. Maintain the fixed group before borrowing it.";
    else if (!inScope(original, data, personalScope)) slot.issue = "This member is outside the fixed personal scope.";
    else if (original.lifecycleStatus !== "active") slot.issue = "This member is retired. Maintain the fixed group before borrowing it.";
    else if (original.loanId && original.borrowerAccountId === data.user.id) slot.issue = "You already hold this member. Return it or exclude it from this checkout.";
    else if (original.loanId) slot.issue = "This member is currently borrowed. Review an alternative for this checkout.";
    else slot.actual = original;
    return slot;
  });
}

/** This pool deliberately has no fixed-group filter; all candidates retain the caller's personal boundary. */
export function eligibleTeachingAlternatives(data: InventorySnapshot, slots: readonly TeachingSelection[], personalScope: TeachingPersonalScope, originalId: string): BatteryRecord[] {
  const slot = slots.find(item => item.originalId === originalId);
  if (!slot?.original || !inScope(slot.original, data, personalScope) || slot.original.lifecycleStatus !== "active" || !slot.original.loanId || slot.original.borrowerAccountId === data.user.id) return [];
  const chosen = new Set(slots.filter(item => item.originalId !== originalId && item.actual).map(item => item.actual!.id));
  return data.batteries.filter(item => available(item, data, personalScope) && !chosen.has(item.id)).sort(compareIds);
}

/** Suggestions are a draft, never a reservation. Unknown specifications and locations are not inferred. */
export function suggestTeachingReplacements(data: InventorySnapshot, slots: readonly TeachingSelection[], personalScope: TeachingPersonalScope): TeachingSelection[] {
  const result = structuredClone(slots) as TeachingSelection[];
  const unresolved = result.filter(slot => !slot.actual && slot.original?.loanId && slot.original.borrowerAccountId !== data.user.id && slot.original.lifecycleStatus === "active" && inScope(slot.original, data, personalScope));
  const chosen = new Set(result.flatMap(slot => slot.actual ? [slot.actual.id] : []));
  const rooms = new Map<string, number>();
  for (const slot of result) {
    const room = slot.actual && verifiedRoom(slot.actual, data);
    if (room) rooms.set(room, (rooms.get(room) ?? 0) + 1);
  }
  const pool = () => data.batteries.filter(item => available(item, data, personalScope) && !chosen.has(item.id));
  for (let index = 0; index < unresolved.length; index++) {
    const slot = unresolved[index];
    const remaining = unresolved.slice(index);
    const candidates = pool().filter(item => teachingSpecificationsMatch(slot.original!, item));
    // Count how many remaining slots a room can cover without counting one battery twice.
    const coverage = (room: string | null) => {
      if (!room) return 0;
      const stock = pool().filter(item => verifiedRoom(item, data) === room);
      let count = 0;
      for (const pending of remaining) {
        const match = stock.findIndex(item => teachingSpecificationsMatch(pending.original!, item));
        if (match >= 0) { stock.splice(match, 1); count++; }
      }
      return count;
    };
    candidates.sort((a, b) => {
      const aRoom = verifiedRoom(a, data), bRoom = verifiedRoom(b, data);
      return Number(!!bRoom) - Number(!!aRoom) || (rooms.get(bRoom ?? "") ?? 0) - (rooms.get(aRoom ?? "") ?? 0) || coverage(bRoom) - coverage(aRoom) || compareIds(a, b);
    });
    const candidate = candidates[0];
    if (!candidate) { slot.issue = "No available battery has the same known model and specifications. Choose a manual alternative."; continue; }
    slot.actual = candidate;
    slot.method = "automatic";
    slot.source = { kind: "selection" };
    delete slot.issue;
    chosen.add(candidate.id);
    const room = verifiedRoom(candidate, data);
    if (room) rooms.set(room, (rooms.get(room) ?? 0) + 1);
  }
  return result;
}
