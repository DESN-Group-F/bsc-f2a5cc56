import { test } from "node:test";
import assert from "node:assert/strict";
import { captureIntakeAttempt, recoverIntakeSession, verifyIntakeReceipt, intakeFailureStatus, intakePayloadSchema } from "../work/qa/intake-session.mjs";

const common = { name: "Batch pack", model: "PACK-A", chemistry: "Li-ion", capacityMah: 3000, voltage: 12, ownerId: "staff-owner", homeBuildingId: "J18", homeRoomId: null, manufacturedOn: null, firstUsedOn: null };
const payload = () => ({ requestId: crypto.randomUUID(), sessionId: crypto.randomUUID(), tagId: "DEMO-INTAKE-001", common: { ...common }, firstUseMode: "at_registration" });
const receipt = attempt => ({ requestId: attempt.payload.requestId, sessionId: attempt.payload.sessionId, dataset: "demo", actorAccountId: "staff-a", batteryId: "BAT-00000001", tagId: attempt.payload.tagId, registeredAt: "2026-10-03T14:30:00.000Z", source: "simulated_intake", replayed: false, ...common, firstUsedOn: "2026-10-04" });

test("intake captures independent immutable input and restores only the same native account and demo context", () => {
    const draft = payload(), attempt = captureIntakeAttempt("staff-a", "demo", draft);
    draft.common.name = "Changed later";
    assert.equal(attempt.payload.common.name, "Batch pack");
    assert.deepEqual(recoverIntakeSession(JSON.stringify(attempt), "staff-a", "demo"), attempt);
    assert.equal(recoverIntakeSession(JSON.stringify(attempt), "staff-b", "demo"), null);
    assert.equal(recoverIntakeSession(JSON.stringify(attempt), "staff-a", "live"), null);
    assert.equal(recoverIntakeSession("{", "staff-a", "demo"), null);
    assert.throws(() => captureIntakeAttempt("staff-a", "live", payload()));
});

test("registration receipt validates server Sydney service-start date and preserves unknown manufacture date", () => {
    const attempt = captureIntakeAttempt("staff-a", "demo", payload()), saved = receipt(attempt);
    assert.deepEqual(verifyIntakeReceipt(saved, attempt), saved);
    assert.equal(saved.manufacturedOn, null);
    assert.throws(() => verifyIntakeReceipt({ ...saved, firstUsedOn: "2026-10-03" }, attempt));
    assert.throws(() => verifyIntakeReceipt({ ...saved, source: "RFID reader" }, attempt));
    assert.throws(() => verifyIntakeReceipt({ ...saved, batteryId: "PACK-A" }, attempt));
    for (const mismatch of [{ requestId: crypto.randomUUID() }, { sessionId: crypto.randomUUID() }, { dataset: "live" }, { actorAccountId: "staff-b" }, { tagId: "DEMO-INTAKE-002" }, { ownerId: "other-owner" }, { voltage: 18 }]) assert.throws(() => verifyIntakeReceipt({ ...saved, ...mismatch }, attempt));
});

test("custom and unknown service dates do not become the registration date", () => {
    const custom = captureIntakeAttempt("staff-a", "demo", { ...payload(), firstUseMode: "date", common: { ...common, firstUsedOn: "2026-09-01" } });
    assert.equal(verifyIntakeReceipt({ ...receipt(custom), firstUsedOn: "2026-09-01" }, custom).firstUsedOn, "2026-09-01");
    const unknown = captureIntakeAttempt("staff-a", "demo", { ...payload(), firstUseMode: "unknown" });
    assert.equal(verifyIntakeReceipt({ ...receipt(unknown), firstUsedOn: null }, unknown).firstUsedOn, null);
    assert.throws(() => intakePayloadSchema.parse({ ...payload(), firstUseMode: "date" }));
    assert.throws(() => intakePayloadSchema.parse({ ...payload(), common: { ...common, firstUsedOn: "2026-09-01" } }));
    assert.throws(() => intakePayloadSchema.parse({ ...payload(), tagId: "REAL-UNVERIFIED-TAG" }));
    assert.throws(() => intakePayloadSchema.parse({ ...payload(), registeredAt: "2000-01-01T00:00:00Z" }));
});

test("unknown and authentication failures preserve the request; conflicts need a final server rejection", () => {
    for (const error of [new Error("Response lost"), { status: 401 }, { status: 403 }, { status: 503 }, { status: 409, code: "model_conflict" }]) assert.equal(intakeFailureStatus(error), "unknown");
    assert.equal(intakeFailureStatus({ status: 409, code: "intake_rejected_final" }), "rejected");
    for (const status of [400, 404, 422, 501]) assert.equal(intakeFailureStatus({ status }), "rejected");
});
