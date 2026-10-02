export const SUPPORTED_BUILDING_ID = "J18";

export const REFERENCE_BUILDINGS = [
    { id: "J18", name: "Willis Annexe", sourceUrl: "https://www.making.unsw.edu.au/engineering-makerspace/digital-fabrication-eng/" },
    { id: "E10", name: "Hilmer Building", sourceUrl: "https://www.making.unsw.edu.au/access/contact-us/" },
    { id: "G17", name: "Electrical Engineering Building", sourceUrl: "https://www.making.unsw.edu.au/access/contact-us/" },
] as const;

export const PLACEHOLDER_ROOMS = [
    { id: "J18-DEMO-ROOM", buildingId: "J18", number: "DEMO-ROOM", name: "Demo room", isPlaceholder: true, selectable: true },
    { id: "J18-DEMO-WORKSPACE", buildingId: "J18", number: "DEMO-WORKSPACE", name: "Demo workspace", isPlaceholder: true, selectable: true },
] as const;

type BuildingChoice = { id: string; name: string };
type RoomChoice = { id: string; buildingId: string | null; number: string | null; name: string; isPlaceholder: boolean; selectable: boolean };
type LocationOption = { id: string; label: string; disabled?: boolean };

export function isSupportedBuilding(id: string | null | undefined) {
    return id === SUPPORTED_BUILDING_ID;
}

export function isSelectableRoom(room: Pick<RoomChoice, "buildingId" | "selectable">) {
    return isSupportedBuilding(room.buildingId) && room.selectable;
}

export function buildingPickerOptions(buildings: readonly BuildingChoice[]): LocationOption[] {
    return buildings.map(building => ({ id: building.id, label: `${building.id} - ${building.name}`, disabled: !isSupportedBuilding(building.id) }));
}

export function roomPickerOptions(rooms: readonly RoomChoice[], buildingId: string | null | undefined): LocationOption[] {
    if (!isSupportedBuilding(buildingId)) return [{ id: "__unavailable", label: "Not available", disabled: true }];
    return rooms.filter(room => room.buildingId === buildingId && isSelectableRoom(room)).map(room => ({
        id: room.id,
        label: `${room.number && !room.isPlaceholder ? `${room.number} - ` : ""}${room.name}${room.isPlaceholder ? " — Placeholder" : ""}`,
    }));
}
