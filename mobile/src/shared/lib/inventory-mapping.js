import { isSelectableRoom } from "./location-catalog.js";
export const UNKNOWN_MAPPING_ROOM = "__unknown";
/** Current directory labels are navigation, never replacements for saved observation labels. */
export function getMappingRooms(rooms) {
    return rooms.filter(isSelectableRoom).sort((a, b) => (a.number ?? a.name).localeCompare(b.number ?? b.name, "en", { numeric: true }) || a.id.localeCompare(b.id, "en"));
}
/** Use the server's latest observation projection; registered storage and loans do not locate an asset. */
export function mappingBucket(battery, rooms) {
    if (!battery.observedAt || !Number.isFinite(Date.parse(battery.observedAt)) || !battery.observedRoomId)
        return UNKNOWN_MAPPING_ROOM;
    return rooms.some(room => room.id === battery.observedRoomId && isSelectableRoom(room))
        ? battery.observedRoomId : UNKNOWN_MAPPING_ROOM;
}
export function mappingUnknownReason(battery) {
    if (!battery.observedAt)
        return "No observation recorded";
    if (!Number.isFinite(Date.parse(battery.observedAt)) || !battery.observedRoomId)
        return "Recorded room identity unavailable";
    return "Last observed room is outside this map";
}
export function mappingScopeLabel(roomId, rooms) {
    return roomId === UNKNOWN_MAPPING_ROOM ? "Unknown / outside this map" : rooms.find(room => room.id === roomId)?.name ?? "Room no longer available";
}
