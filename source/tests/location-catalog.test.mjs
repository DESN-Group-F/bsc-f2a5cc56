import test from "node:test";
import assert from "node:assert/strict";
import { REFERENCE_BUILDINGS, PLACEHOLDER_ROOMS, buildingPickerOptions, roomPickerOptions, isSelectableRoom, isSupportedBuilding } from "../work/qa/location-catalog.mjs";
import { roomLabel, storageRoomLabel, importPayload } from "../work/qa/client-utils.mjs";

test("reviewed campus buildings keep source attribution and J18 alone is available", () => {
    assert.deepEqual(REFERENCE_BUILDINGS.map(({ id, name }) => ({ id, name })), [
        { id: "J18", name: "Willis Annexe" },
        { id: "E10", name: "Hilmer Building" },
        { id: "G17", name: "Electrical Engineering Building" },
    ]);
    for (const building of REFERENCE_BUILDINGS) assert.match(building.sourceUrl, /^https:\/\/www\.making\.unsw\.edu\.au\//);
    const choices = buildingPickerOptions(REFERENCE_BUILDINGS);
    assert.equal(choices.find(building => building.id === "J18").disabled, false);
    assert.equal(choices.find(building => building.id === "E10").disabled, true);
    assert.equal(choices.find(building => building.id === "G17").disabled, true);
    for (const id of [null, undefined, "", "E10", "G17", "J18 "]) assert.equal(isSupportedBuilding(id), false);
});

test("placeholder and verified room choices are explicit; inactive and other-building rooms cannot become new choices", () => {
    const rooms = [
        ...PLACEHOLDER_ROOMS,
        { id: "verified", buildingId: "J18", number: "115", name: "Confirmed room", selectable: true, isPlaceholder: false },
        { id: "old-demo", buildingId: "J18", number: "DEMO-A", name: "Old fictional location", selectable: false, isPlaceholder: true },
        { id: "other", buildingId: "E10", number: "G19", name: "Other room", selectable: true, isPlaceholder: false },
    ];
    const choices = roomPickerOptions(rooms, "J18");
    assert.deepEqual(choices.map(room => room.id), ["J18-DEMO-ROOM", "J18-DEMO-WORKSPACE", "verified"]);
    assert.equal(choices[0].label, "Demo room — Placeholder");
    assert.equal(choices[1].label, "Demo workspace — Placeholder");
    assert.equal(choices[2].label, "115 - Confirmed room");
    assert.equal(isSelectableRoom(rooms[3]), false);
    assert.equal(isSelectableRoom(rooms[4]), false);
    assert.deepEqual(roomPickerOptions(rooms, "E10"), [{ id: "__unavailable", label: "Not available", disabled: true }]);
    assert.deepEqual(roomPickerOptions(rooms, null), [{ id: "__unavailable", label: "Not available", disabled: true }]);
});

test("display labels identify virtual storage without presenting an invented room number", () => {
    assert.equal(roomLabel({ name: "Demo room", number: "DEMO-ROOM", isPlaceholder: true }), "Demo room — Placeholder");
    assert.equal(storageRoomLabel({ homeBuildingId: "J18", homeRoomName: "Demo workspace", homeRoomNumber: "DEMO-WORKSPACE", homeRoomIsPlaceholder: true }), "Demo workspace — Placeholder");
    assert.equal(storageRoomLabel({ homeBuildingId: "G17", homeRoomName: "Saved room", homeRoomNumber: "120", homeRoomIsPlaceholder: false }), "Not available");
    assert.equal(storageRoomLabel({ homeBuildingId: "J18", homeRoomName: null, homeRoomNumber: null, homeRoomIsPlaceholder: null }), "Room not specified");
});

test("CSV room import remains unverified even when a file supplies a verification field", () => {
    const payload = importPayload("rooms", [{ id: "J18-115", name: "Proposed room", building_id: "J18", number: "115", is_placeholder: "false" }]);
    assert.deepEqual(payload, [{ id: "J18-115", name: "Proposed room", buildingId: "J18", number: "115", isPlaceholder: true }]);
});
