/**
 * Buildings that may hold registered storage, return locations, task storage areas and
 * demonstration room observations. J18 remains the default for new records and the
 * demonstration inventory. E10 and G17 hold the makerspaces used for the November 2026 pilot.
 */
export const SUPPORTED_BUILDING_IDS = ["J18", "E10", "G17"] as const;
/**
 * Buildings that may hold selectable rooms. Migrations 0007 and 0021 keep selectable rooms and
 * room beacons in J18 at the database level, so E10 and G17 hold storage without a room until a
 * migration replaces those triggers (docs/storage-buildings.md).
 */
export const ROOM_BUILDING_IDS = ["J18"] as const;
export type SupportedBuildingId = (typeof SUPPORTED_BUILDING_IDS)[number];
export const DEFAULT_BUILDING_ID: SupportedBuildingId = "J18";
/** SQL list literal for the supported building codes, built only from the constants above. */
export const SUPPORTED_BUILDINGS_SQL = `(${SUPPORTED_BUILDING_IDS.map(id => `'${id}'`).join(",")})`;
/** Human-readable list for messages, for example "J18, E10 or G17". */
export const SUPPORTED_BUILDINGS_LABEL = SUPPORTED_BUILDING_IDS.length > 1
    ? `${SUPPORTED_BUILDING_IDS.slice(0, -1).join(", ")} or ${SUPPORTED_BUILDING_IDS[SUPPORTED_BUILDING_IDS.length - 1]}`
    : SUPPORTED_BUILDING_IDS[0];

export const REFERENCE_BUILDINGS = [
    { id: "J18", name: "Willis Annexe", sourceUrl: "https://www.making.unsw.edu.au/engineering-makerspace/digital-fabrication-eng/" },
    { id: "E10", name: "Hilmer Building", sourceUrl: "https://www.making.unsw.edu.au/access/contact-us/" },
    { id: "G17", name: "Electrical Engineering Building", sourceUrl: "https://www.making.unsw.edu.au/access/contact-us/" },
] as const;

export const PLACEHOLDER_ROOMS = [
    { id: "J18-DEMO-ROOM", buildingId: "J18", number: "DEMO-ROOM", name: "Demo room", isPlaceholder: true, selectable: true },
    { id: "J18-DEMO-WORKSPACE", buildingId: "J18", number: "DEMO-WORKSPACE", name: "Demo workspace", isPlaceholder: true, selectable: true },
    { id: "J18-DEMO-STORAGE", buildingId: "J18", number: "DEMO-STORAGE", name: "Demo storage", isPlaceholder: true, selectable: true },
] as const;

type BuildingChoice = { id: string; name: string };
type RoomChoice = { id: string; buildingId: string | null; number: string | null; name: string; isPlaceholder: boolean; selectable: boolean };
type LocationOption = { id: string; label: string; disabled?: boolean };

export function isSupportedBuilding(id: string | null | undefined): id is SupportedBuildingId {
    return typeof id === "string" && (SUPPORTED_BUILDING_IDS as readonly string[]).includes(id);
}

export function isRoomBuilding(id: string | null | undefined): id is (typeof ROOM_BUILDING_IDS)[number] {
    return typeof id === "string" && (ROOM_BUILDING_IDS as readonly string[]).includes(id);
}

export function isSelectableRoom(room: Pick<RoomChoice, "buildingId" | "selectable">) {
    return isSupportedBuilding(room.buildingId) && room.selectable;
}

export function buildingPickerOptions(buildings: readonly BuildingChoice[]): LocationOption[] {
    return buildings.map(building => ({ id: building.id, label: `${building.id} - ${building.name}`, disabled: !isSupportedBuilding(building.id) }));
}

export function roomChoiceLabel(room: Pick<RoomChoice, "number" | "name" | "isPlaceholder">) {
    return `${room.number && !room.isPlaceholder ? `${room.number} - ` : ""}${room.name}${room.isPlaceholder ? " — Placeholder" : ""}`;
}

export function roomPickerOptions(rooms: readonly RoomChoice[], buildingId: string | null | undefined): LocationOption[] {
    if (!isSupportedBuilding(buildingId)) return [{ id: "__unavailable", label: "Not available", disabled: true }];
    return rooms.filter(room => room.buildingId === buildingId && isSelectableRoom(room)).map(room => ({ id: room.id, label: roomChoiceLabel(room) }));
}

/** Selectable rooms across every supported building, grouped by building and labelled with its code. */
export function allRoomPickerOptions(rooms: readonly RoomChoice[]): LocationOption[] {
    return SUPPORTED_BUILDING_IDS.flatMap(buildingId => rooms
        .filter(room => room.buildingId === buildingId && isSelectableRoom(room))
        .map(room => ({ id: room.id, label: `${buildingId} · ${roomChoiceLabel(room)}` })));
}
