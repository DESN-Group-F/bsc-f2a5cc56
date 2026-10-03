import { test } from "node:test";
import assert from "node:assert/strict";
import { captureIntakeDraft, recoverIntakeDraft } from "../work/qa/intake-draft.mjs";
import { captureIntakeAttempt, recoverIntakeSession, verifyIntakeReceipt } from "../work/qa/intake-session.mjs";

const common = { name: "Review pack", model: "PACK-A", chemistry: "Li-ion", capacityMah: null, voltage: 12, ownerId: "staff-a", homeBuildingId: "J18", homeRoomId: null, manufacturedOn: null, firstUsedOn: null };
function draft() {
    const sessionId = crypto.randomUUID();
    const details = { ...common };
    return { actorAccountId: "staff-a", dataset: "demo", batch: { sessionId, common: details, firstUseMode: "at_registration" }, entries: [{ id: crypto.randomUUID(), tagId: "DEMO-INTAKE-A", scannedAt: "2026-10-03T09:00:00.000Z", common: details, firstUseMode: "at_registration", sessionId, selected: true, error: "" }], attempt: null, attemptEntryId: null, completed: [] };
}
test("an editable intake draft recovers selection, distinct scan evidence and common fields only within its native context", () => {
    const original = draft(), saved = captureIntakeDraft(original);
    original.entries[0].selected = false;
    original.entries[0].common.name = "Changed source";
    assert.equal(saved.entries[0].selected, true);
    assert.equal(saved.entries[0].common.name, "Review pack");
    assert.deepEqual(recoverIntakeDraft(JSON.stringify(saved), "staff-a", "demo"), saved);
    assert.equal(recoverIntakeDraft(JSON.stringify(saved), "staff-b", "demo"), null);
    assert.equal(recoverIntakeDraft(JSON.stringify(saved), "staff-a", "live"), null);
    assert.equal(recoverIntakeDraft("{", "staff-a", "demo"), null);
});
test("draft capture rejects duplicates and any drift from an unresolved immutable confirmation", () => {
    const original = draft(), entry = original.entries[0];
    original.attempt = captureIntakeAttempt("staff-a", "demo", { requestId: crypto.randomUUID(), sessionId: entry.sessionId, tagId: entry.tagId, scannedAt: entry.scannedAt, common: entry.common, firstUseMode: entry.firstUseMode });
    original.attemptEntryId = entry.id;
    const saved = captureIntakeDraft(original);
    assert.deepEqual(recoverIntakeSession(JSON.stringify(saved), "staff-a", "demo"), saved.attempt);
    assert.throws(() => captureIntakeDraft({ ...saved, entries: [{ ...saved.entries[0], tagId: "DEMO-INTAKE-CHANGED" }] }));
    assert.throws(() => captureIntakeDraft({ ...saved, entries: [{ ...saved.entries[0], scannedAt: "2026-10-03T10:00:00.000Z" }] }));
    assert.throws(() => captureIntakeDraft({ ...saved, entries: [{ ...saved.entries[0], common: { ...common, voltage: 20 } }] }));
    assert.throws(() => captureIntakeDraft({ ...saved, actorAccountId: "staff-b" }));
    assert.throws(() => captureIntakeDraft({ ...saved, entries: [...saved.entries, { ...saved.entries[0], id: crypto.randomUUID() }] }));
});
test("a pre-queue captured request stays retryable without inventing a device scan timestamp", () => {
    const saved = captureIntakeAttempt("staff-a", "demo", { requestId: crypto.randomUUID(), sessionId: crypto.randomUUID(), tagId: "DEMO-INTAKE-PRIOR", common, firstUseMode: "at_registration" });
    const restored = recoverIntakeDraft(JSON.stringify(saved), "staff-a", "demo");
    assert.deepEqual(restored.attempt, saved);
    assert.equal(restored.entries[0].scannedAt, null);
    assert.equal(restored.entries[0].id, saved.payload.requestId);
});
test("receipt distinguishes device scan time from server registration and rejects changed scan evidence", () => {
    const entry = draft().entries[0], attempt = captureIntakeAttempt("staff-a", "demo", { requestId: crypto.randomUUID(), sessionId: entry.sessionId, tagId: entry.tagId, scannedAt: entry.scannedAt, common, firstUseMode: "at_registration" });
    const receipt = { ...common, requestId: attempt.payload.requestId, sessionId: entry.sessionId, dataset: "demo", actorAccountId: "staff-a", batteryId: "BAT-00000001", tagId: entry.tagId, scannedAt: entry.scannedAt, registeredAt: "2026-10-03T14:30:00.000Z", source: "simulated_intake", replayed: false, firstUsedOn: "2026-10-04" };
    assert.equal(verifyIntakeReceipt(receipt, attempt).firstUsedOn, "2026-10-04");
    assert.throws(() => verifyIntakeReceipt({ ...receipt, scannedAt: receipt.registeredAt }, attempt));
});
