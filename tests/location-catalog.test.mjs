import test from "node:test";
import assert from "node:assert/strict";
import { REFERENCE_BUILDINGS, PLACEHOLDER_ROOMS, SUPPORTED_BUILDING_IDS, SUPPORTED_BUILDINGS_LABEL, SUPPORTED_BUILDINGS_SQL, DEFAULT_BUILDING_ID, ROOM_BUILDING_IDS, isRoomBuilding, allRoomPickerOptions, buildingPickerOptions, roomPickerOptions, isSelectableRoom, isSupportedBuilding } from "../work/qa/location-catalog.mjs";
import { roomLabel, storageRoomLabel, importPayload } from "../work/qa/client-utils.mjs";

test("reviewed campus buildings keep source attribution; J18, E10 and G17 are available and J18 is the default", () => {
    assert.deepEqual(REFERENCE_BUILDINGS.map(({ id, name }) => ({ id, name })), [
        { id: "J18", name: "Willis Annexe" },
        { id: "E10", name: "Hilmer Building" },
        { id: "G17", name: "Electrical Engineering Building" },
    ]);
    for (const building of REFERENCE_BUILDINGS) assert.match(building.sourceUrl, /^https:\/\/www\.making\.unsw\.edu\.au\//);
    const choices = buildingPickerOptions(REFERENCE_BUILDINGS);
    for (const building of choices) assert.equal(building.disabled, false);
    assert.deepEqual(SUPPORTED_BUILDING_IDS, ["J18", "E10", "G17"]);
    assert.equal(DEFAULT_BUILDING_ID, "J18");
    assert.equal(SUPPORTED_BUILDINGS_LABEL, "J18, E10 or G17");
    assert.equal(SUPPORTED_BUILDINGS_SQL, "('J18','E10','G17')");
    for (const id of ["J18", "E10", "G17"]) assert.equal(isSupportedBuilding(id), true);
    for (const id of [null, undefined, "", "K17", "e10", "J18 "]) assert.equal(isSupportedBuilding(id), false);
    assert.equal(buildingPickerOptions([{ id: "K17", name: "Registered elsewhere" }])[0].disabled, true);
    assert.deepEqual(ROOM_BUILDING_IDS, ["J18"], "selectable rooms stay in J18 until a migration replaces the 0007/0021 triggers");
    assert.equal(isRoomBuilding("J18"), true);
    for (const id of ["E10", "G17", "K17", null]) assert.equal(isRoomBuilding(id), false);
});

test("placeholder and verified room choices are explicit; inactive and other-building rooms cannot become new choices", () => {
    const rooms = [
        ...PLACEHOLDER_ROOMS,
        { id: "verified", buildingId: "J18", number: "115", name: "Confirmed room", selectable: true, isPlaceholder: false },
        { id: "old-demo", buildingId: "J18", number: "DEMO-A", name: "Old fictional location", selectable: false, isPlaceholder: true },
        { id: "other", buildingId: "E10", number: "G19", name: "MCIC Makerspace", selectable: true, isPlaceholder: false },
        { id: "unsupported", buildingId: "K17", number: "101", name: "Unsupported room", selectable: true, isPlaceholder: false },
    ];
    const choices = roomPickerOptions(rooms, "J18");
    assert.deepEqual(choices.map(room => room.id), ["J18-DEMO-ROOM", "J18-DEMO-WORKSPACE", "J18-DEMO-STORAGE", "verified"]);
    assert.equal(choices[0].label, "Demo room — Placeholder");
    assert.equal(choices[1].label, "Demo workspace — Placeholder");
    assert.equal(choices[2].label, "Demo storage — Placeholder");
    assert.equal(choices[3].label, "115 - Confirmed room");
    assert.equal(isSelectableRoom(rooms[4]), false);
    assert.equal(isSelectableRoom(rooms[5]), true, "E10 rooms are selectable");
    assert.equal(isSelectableRoom(rooms[6]), false, "rooms in unsupported buildings are not");
    assert.deepEqual(roomPickerOptions(rooms, "E10"), [{ id: "other", label: "G19 - MCIC Makerspace" }]);
    assert.deepEqual(roomPickerOptions(rooms, "G17"), []);
    assert.deepEqual(roomPickerOptions(rooms, "K17"), [{ id: "__unavailable", label: "Not available", disabled: true }]);
    assert.deepEqual(allRoomPickerOptions(rooms).map(room => [room.id, room.label]), [
        ["J18-DEMO-ROOM", "J18 · Demo room — Placeholder"], ["J18-DEMO-WORKSPACE", "J18 · Demo workspace — Placeholder"],
        ["J18-DEMO-STORAGE", "J18 · Demo storage — Placeholder"], ["verified", "J18 · 115 - Confirmed room"], ["other", "E10 · G19 - MCIC Makerspace"],
    ]);
    assert.deepEqual(roomPickerOptions(rooms, null), [{ id: "__unavailable", label: "Not available", disabled: true }]);
});

test("display labels identify virtual storage without presenting an invented room number", () => {
    assert.equal(roomLabel({ name: "Demo room", number: "DEMO-ROOM", isPlaceholder: true }), "Demo room — Placeholder");
    assert.equal(storageRoomLabel({ homeBuildingId: "J18", homeRoomName: "Demo workspace", homeRoomNumber: "DEMO-WORKSPACE", homeRoomIsPlaceholder: true }), "Demo workspace — Placeholder");
    assert.equal(storageRoomLabel({ homeBuildingId: "G17", homeRoomName: "Electrical Engineering Makerspace", homeRoomNumber: "120", homeRoomIsPlaceholder: false }), "120 - Electrical Engineering Makerspace");
    assert.equal(storageRoomLabel({ homeBuildingId: "K17", homeRoomName: "Saved room", homeRoomNumber: "101", homeRoomIsPlaceholder: false }), "Not available");
    assert.equal(storageRoomLabel({ homeBuildingId: "J18", homeRoomName: null, homeRoomNumber: null, homeRoomIsPlaceholder: null }), "Room not specified");
});

test("CSV room import remains unverified even when a file supplies a verification field", () => {
    const payload = importPayload("rooms", [{ id: "J18-115", name: "Proposed room", building_id: "J18", number: "115", is_placeholder: "false" }]);
    assert.deepEqual(payload, [{ id: "J18-115", name: "Proposed room", buildingId: "J18", number: "115", isPlaceholder: true }]);
});
