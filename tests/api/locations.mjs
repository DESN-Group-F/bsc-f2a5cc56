import assert from "node:assert/strict";

/** Room location checks run only inside the caller's isolated local Worker. */
export async function checkLocations({ check, json, adminCookie, staffCookie }) {
  await check("room beacon directory requires an active account", "/api/locations?dataset=demo", {}, 401);
  const directory = await (await check("room beacon directory explicitly keeps hardware disabled", "/api/locations?dataset=demo", { headers: { Cookie: adminCookie } })).json();
  assert.equal(directory.capabilities.hardwareIngestion, false);
  const data = await (await check("room tests use existing inventory room identities", "/api/inventory?dataset=demo", { headers: { Cookie: adminCookie } })).json();
  const room = data.rooms.find(item => item.buildingId === "J18" && item.selectable);
  const building = data.buildings.find(item => item.id === "J18");
  const payload = { requestId: crypto.randomUUID(), id: "QA-ROOM-BEACON", label: "Software-only room fixture", identifier: "qa-software-room-beacon", roomId: room.id, roomVersion: room.version, buildingVersion: building.version, active: true };
  const save = (name, body, cookie = adminCookie, status = 200) => check(name, "/api/locations", json({ dataset: "demo", action: "create", payload: body }, cookie), status);
  await save("staff cannot configure room beacons", payload, staffCookie, 403);
  const saved = await (await save("admin registers a versioned room beacon mapping", payload)).json();
  assert.equal(saved.result.beacon.hardwareValidated, false);
  assert.equal((await (await save("room beacon exact retry returns its existing receipt", payload)).json()).result.replayed, true);
  await save("room beacon request IDs cannot be reused for different mappings", { ...payload, label: "Conflicting label" }, adminCookie, 409);
  const actorOwner = data.people.find(person => person.accountId === data.user.id);
  await check("room scan fixture registers one attributed tagged battery", "/api/inventory", json({ dataset: "demo", action: "battery", payload: { id: "QA-LOCATION-BATTERY", name: "Room observation fixture", tagId: "QA-LOCATION-TAG", ownerId: actorOwner.id, homeBuildingId: "J18" } }, adminCookie));
  const capturedAt = new Date().toISOString();
  const capture = { requestId: crypto.randomUUID(), source: "demo_room_scan", batteryId: "QA-LOCATION-BATTERY", tagId: "QA-LOCATION-TAG", expectedBatteryVersion: 1, capturedAt, candidates: [{ beaconId: payload.id, version: 1, detectedAt: capturedAt }] };
  const observe = (name, value, cookie = adminCookie, dataset = "demo", status = 200) => check(name, "/api/location-observations", json({ dataset, payload: value }, cookie), status);
  await observe("staff cannot masquerade as a demo observation administrator", capture, staffCookie, "demo", 403);
  const recorded = await (await observe("demo scan records separately labelled room evidence", capture)).json();
  assert.equal(recorded.result.outcome, "recorded"); assert.match(recorded.result.source, /^Simulated/);
  assert.equal((await (await observe("replayed demo scan does not duplicate its observation", capture)).json()).result.observationId, recorded.result.observationId);
  await observe("working inventory rejects simulated room observations", { ...capture, requestId: crypto.randomUUID() }, adminCookie, "live", 400);
  await observe("native hardware input remains unavailable before acceptance", { ...capture, requestId: crypto.randomUUID(), source: "phone_ble_scan" }, staffCookie, "live", 501);
  const unknown = await (await observe("missing room evidence stays unresolved without guessing", { ...capture, requestId: crypto.randomUUID(), candidates: [] })).json();
  assert.equal(unknown.result.outcome, "unresolved"); assert.equal(unknown.result.observationId, null);
  const detail = await (await check("existing detail shows saved observed location without a loan", "/api/inventory?dataset=demo&batteryId=QA-LOCATION-BATTERY", { headers: { Cookie: adminCookie } })).json();
  assert.equal(detail.battery.loanId, null); assert.equal(detail.battery.homeRoomId, null); assert.equal(detail.battery.observedRoomId, room.id);
  assert.equal(detail.observations.length, 1);
  const exported = await (await check("location exports retain complete observation evidence", "/api/export", json({ dataset: "demo", mode: "detail", batteryId: "QA-LOCATION-BATTERY", sections: ["observations"] }, staffCookie))).json();
  assert.equal(exported.tables.Observations.length, 1);
  assert.equal(exported.tables.Observations[0].source, recorded.result.source);
}
