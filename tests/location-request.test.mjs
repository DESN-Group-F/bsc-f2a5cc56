import { test } from "node:test";
import assert from "node:assert/strict";
import { captureLocationAttempt, clearLocationAttempt, discoverLocationAttempts, locationFailureStatus, locationRequestStorageKey, persistLocationAttempt, recoverLocationAttempt, verifyLocationReceipt } from "../work/qa/client/location-request.mjs";
import { SIMULATED_LOCATION_SOURCE } from "../work/qa/location-observations.mjs";

const requestId = "02c5d766-a5fb-4f29-b355-8fb2cd8a1e2b";
function storage() {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
}
function captureFixture() {
  const payload = { requestId, source: "demo_room_scan", batteryId: "BAT-1", tagId: "TAG-1", expectedBatteryVersion: 2, capturedAt: "2026-10-10T00:00:00.000Z", candidates: [{ beaconId: "BEACON-1", version: 3, detectedAt: "2026-10-10T00:00:00.000Z" }] };
  const attempt = captureLocationAttempt("admin", "demo", { kind: "capture", payload });
  const receipt = { requestId, dataset: "demo", actorAccountId: "admin", batteryId: "BAT-1", outcome: "recorded", observationId: "observation-1", room: { id: "ROOM-1", name: "Room 1", buildingId: "J18", buildingName: "Willis Annexe", isPlaceholder: false }, source: SIMULATED_LOCATION_SOURCE, capturedAt: payload.capturedAt, receivedAt: "2026-10-10T00:00:00.400Z", replayed: false };
  return { payload, attempt, receipt };
}
function beaconFixture(action = "create") {
  const payload = { action, requestId, id: "BEACON-1", label: "Room 1 beacon", identifier: "demo-beacon-1", roomId: "ROOM-1", roomVersion: 3, buildingVersion: 2, active: true, ...(action === "update" ? { expectedVersion: 7 } : {}) };
  const attempt = captureLocationAttempt("admin", "demo", { kind: "beacon", payload });
  const receipt = { requestId, dataset: "demo", actorAccountId: "admin", replayed: false, beacon: { ...payload, version: action === "update" ? 8 : 1, roomName: "Room 1", buildingId: "J18", buildingName: "Willis Annexe", roomIsPlaceholder: false, roomSelectable: true, hardwareValidated: false, createdAt: "2026-10-10T00:00:00Z", updatedAt: "2026-10-10T00:00:00Z" } };
  return { payload, attempt, receipt };
}

test("capture clones exact request guards and recovery binds native account and inventory", () => {
  const { payload, attempt } = captureFixture();
  payload.tagId = "edited"; payload.candidates[0].version = 99;
  assert.equal(attempt.payload.tagId, "TAG-1"); assert.equal(attempt.payload.candidates[0].version, 3);
  const raw = JSON.stringify(attempt);
  assert.deepEqual(recoverLocationAttempt(raw, "admin", "demo"), attempt);
  assert.throws(() => recoverLocationAttempt(raw, "admin", "live"), /retained/);
  assert.throws(() => recoverLocationAttempt(raw, "other", "demo"), /retained/);
  assert.throws(() => recoverLocationAttempt("not-json", "admin", "demo"), /retained/);
  assert.throws(() => captureLocationAttempt("admin", "demo", { kind: "capture", payload: { ...attempt.payload, tagId: null } }));
});

test("durable recovery refuses replacement, mismatched clearing and silent storage failure", () => {
  const saved = storage(), { attempt } = captureFixture();
  persistLocationAttempt(attempt, saved);
  const changed = structuredClone(attempt); changed.payload.expectedBatteryVersion++;
  assert.throws(() => persistLocationAttempt(changed, saved), /not been replaced/);
  assert.throws(() => clearLocationAttempt(changed, saved), /not been removed/);
  assert.deepEqual(discoverLocationAttempts("admin", saved), [attempt]);
  persistLocationAttempt({ ...attempt, status: "uncertain", message: "Network interrupted" }, saved);
  assert.equal(JSON.parse(saved.getItem(locationRequestStorageKey("admin", "demo"))).payload.requestId, requestId);
  clearLocationAttempt(attempt, saved); assert.deepEqual(discoverLocationAttempts("admin", saved), []);
  assert.throws(() => persistLocationAttempt(attempt, { getItem: () => null, setItem() {} }), /could not be verified/);
});

test("malformed existing recovery remains untouched and blocks new work", () => {
  const saved = storage(), key = locationRequestStorageKey("admin", "demo"); saved.setItem(key, "broken original");
  assert.throws(() => persistLocationAttempt(captureFixture().attempt, saved), /retained/);
  assert.throws(() => discoverLocationAttempts("admin", saved), /retained/);
  assert.equal(saved.getItem(key), "broken original");
});

test("only a reserved final rejection releases an uncertain location request", () => {
  for (const error of [new Error("offline"), { status: 500 }, { status: 400 }, { status: 403 }, { status: 409, code: "idempotency_conflict" }, { status: 501, code: "location_hardware_unavailable" }]) assert.equal(locationFailureStatus(error), "uncertain");
  assert.equal(locationFailureStatus({ status: 409, code: "location_rejected_final" }), "rejected");
});

test("recorded receipts require matching actor, inventory, original capture and dated source", () => {
  const { attempt, receipt } = captureFixture(); assert.deepEqual(verifyLocationReceipt(receipt, attempt), receipt);
  for (const edit of [r => { r.actorAccountId = "other"; }, r => { r.dataset = "live"; }, r => { r.batteryId = "BAT-2"; }, r => { r.requestId = "different"; }, r => { r.capturedAt = "2026-10-10T00:00:01Z"; }, r => { r.source = "Phone BLE scan"; }, r => { r.receivedAt = "2026-10-09T23:59:59Z"; }, r => { r.observationId = null; }, r => { r.room = null; }]) {
    const altered = structuredClone(receipt); edit(altered); assert.throws(() => verifyLocationReceipt(altered, attempt), /does not match/);
  }
});

test("UTC normalization accepts equivalent capture time without changing the retained payload", () => {
  const { attempt, receipt } = captureFixture();
  attempt.payload.capturedAt = "2026-10-10T11:00:00.000+11:00"; attempt.payload.candidates[0].detectedAt = attempt.payload.capturedAt;
  const raw = JSON.stringify(attempt);
  assert.deepEqual(verifyLocationReceipt(receipt, attempt), receipt);
  assert.equal(JSON.stringify(attempt), raw);
});

test("ambiguous and unresolved receipts explicitly cannot contain an observation or room", () => {
  const { attempt, receipt } = captureFixture();
  for (const outcome of ["ambiguous", "unresolved"]) {
    const valid = { ...receipt, outcome, observationId: null, room: null };
    assert.equal(verifyLocationReceipt(valid, attempt).outcome, outcome);
    assert.throws(() => verifyLocationReceipt({ ...valid, observationId: receipt.observationId }, attempt));
    assert.throws(() => verifyLocationReceipt({ ...valid, room: receipt.room }, attempt));
  }
});

test("mapping receipts guard reviewed directory versions, assignment and update version", () => {
  for (const action of ["create", "update"]) {
    const { attempt, receipt } = beaconFixture(action); assert.deepEqual(verifyLocationReceipt(receipt, attempt), receipt);
    for (const edit of [b => { b.roomVersion++; }, b => { b.buildingVersion++; }, b => { b.version++; }, b => { b.roomId = "OTHER"; }, b => { b.identifier = "OTHER"; }, b => { b.active = false; }, b => { b.hardwareValidated = true; }]) {
      const altered = structuredClone(receipt); edit(altered.beacon); assert.throws(() => verifyLocationReceipt(altered, attempt));
    }
  }
});
