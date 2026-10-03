import { test } from "node:test";
import assert from "node:assert/strict";
import { captureLifecycleAttempt, recoverLifecycleSession, verifyLifecycleReceipt, lifecycleFailureStatus, lifecycleStorageKey, lifecyclePayloadSchema } from "../work/qa/lifecycle-session.mjs";

const payload = () => ({ requestId: crypto.randomUUID(), kind: "scrapped", reason: "R", destination: null, source: "manual_selection", items: [{ batteryId: "BAT-A", version: 1, tagId: "TAG-A" }, { batteryId: "BAT-B", version: 3, tagId: null }] });
const receipt = attempt => ({ requestId: attempt.payload.requestId, actorAccountId: attempt.actorAccountId, dataset: attempt.dataset, kind: attempt.payload.kind, reason: attempt.payload.reason, destination: attempt.payload.destination, source: attempt.payload.source, at: "2026-10-03T20:00:00.000Z", items: attempt.payload.items.map(item => ({ ...item, status: attempt.payload.kind, version: item.version + 1 })), replayed: false });

test("captured removal requests preserve every reviewed binding and recover only for their native account and dataset", () => {
    const draft = payload(), attempt = captureLifecycleAttempt("staff-one", "live", draft);
    draft.reason = "Changed live form"; draft.items[0].tagId = "CHANGED";
    assert.equal(attempt.payload.reason, "R"); assert.equal(attempt.payload.items[0].tagId, "TAG-A");
    const raw = JSON.stringify(attempt);
    assert.deepEqual(recoverLifecycleSession(raw, "staff-one", "live"), attempt);
    assert.equal(recoverLifecycleSession(raw, "staff-two", "live"), null);
    assert.equal(recoverLifecycleSession(raw, "staff-one", "demo"), null);
    assert.equal(recoverLifecycleSession("broken", "staff-one", "live"), null);
    assert.equal(recoverLifecycleSession(JSON.stringify({ ...attempt, payload: { ...attempt.payload, items: [] } }), "staff-one", "live"), null);
    assert.notEqual(lifecycleStorageKey("staff-one", "live"), lifecycleStorageKey("staff-two", "live"));
    assert.notEqual(lifecycleStorageKey("staff-one", "live"), lifecycleStorageKey("staff-one", "demo"));
});

test("removal validation keeps manual untagged choices available and requires deliberate bound input", () => {
    const draft = payload(); assert.equal(lifecyclePayloadSchema.parse(draft).reason, "R");
    assert.equal(lifecyclePayloadSchema.parse({ ...draft, reason: "  Checked  " }).reason, "Checked");
    for (const change of [{ reason: "R".repeat(1001) }, { items: [draft.items[0], draft.items[0]] }, { items: [{ ...draft.items[1], tagId: "TAG-A" }, draft.items[0]] }, { source: "tag_entry" }, { source: "RFID" }, { kind: "active" }, { destination: "Another institution" }, { expectedVersion: 1 }, { items: [{ ...draft.items[0], version: Number.MAX_SAFE_INTEGER }] }]) assert.throws(() => lifecyclePayloadSchema.parse({ ...draft, ...change }));
    const removed = lifecyclePayloadSchema.parse({ ...draft, kind: "permanently_removed", destination: "  External store  " });
    assert.equal(removed.destination, "External store");
    assert.equal(lifecyclePayloadSchema.parse({ ...draft, kind: "permanently_removed", destination: " " }).destination, null);
});

test("optional reasons normalize omitted, blank and whitespace input without changing earlier nonempty requests", () => {
    const previous = payload();
    assert.deepEqual(lifecyclePayloadSchema.parse(previous), previous);
    assert.equal(lifecyclePayloadSchema.parse({ ...previous, reason: "R".repeat(1000) }).reason.length, 1000);
    for (const reason of [undefined, "", " \t\r\n "]) {
        const input = { ...previous, reason };
        if (reason === undefined) delete input.reason;
        const attempt = captureLifecycleAttempt("staff-one", "live", input);
        assert.equal(attempt.payload.reason, "");
        assert.deepEqual(recoverLifecycleSession(JSON.stringify(attempt), "staff-one", "live"), attempt);
    }
    for (const reason of [null, 0, false]) assert.throws(() => lifecyclePayloadSchema.parse({ ...previous, reason }));
});

test("empty-reason batch receipts remain exact and cannot acquire an invented reason or omit the receipt field", () => {
    for (const kind of ["scrapped", "permanently_removed"]) {
        const attempt = captureLifecycleAttempt("staff-one", "live", { ...payload(), kind, reason: " " }), result = receipt(attempt);
        assert.equal(result.reason, ""); assert.equal(result.items.length, 2);
        assert.deepEqual(verifyLifecycleReceipt(result, attempt), result);
        const missing = { ...result }; delete missing.reason;
        for (const altered of [missing, { ...result, reason: null }, { ...result, reason: "Staff disposal" }, { ...result, reason: " " }]) assert.throws(() => verifyLifecycleReceipt(altered, attempt));
    }
});

test("successful removal receipts must match the account, dataset, action, source and every ordered battery/tag/version", () => {
    const attempt = captureLifecycleAttempt("staff-one", "demo", payload()), result = receipt(attempt);
    assert.deepEqual(verifyLifecycleReceipt(result, attempt), result);
    assert.deepEqual(verifyLifecycleReceipt({ ...result, replayed: true }, attempt), { ...result, replayed: true });
    for (const change of [{ actorAccountId: "staff-two" }, { dataset: "live" }, { requestId: crypto.randomUUID() }, { kind: "permanently_removed" }, { reason: "Different" }, { destination: "Unknown destination" }, { source: "tag_entry" }, { items: result.items.slice(1) }, { items: [...result.items].reverse() }, { items: [{ ...result.items[0], tagId: null }, result.items[1]] }, { items: [{ ...result.items[0], version: 1 }, result.items[1]] }, { items: [{ ...result.items[0], status: "permanently_removed" }, result.items[1]] }, { at: "unknown" }]) assert.throws(() => verifyLifecycleReceipt({ ...result, ...change }, attempt));
});

test("only confirmed final removal rejections clear reviewed attempts; authentication and uncertain conflicts remain pending", () => {
    for (const status of [400, 404, 409, 422]) assert.equal(lifecycleFailureStatus({ status, code: "lifecycle_rejected_final" }), "rejected");
    for (const status of [401, 403, 404, 409, 429, 500, 503]) assert.equal(lifecycleFailureStatus({ status }), "unknown");
    assert.equal(lifecycleFailureStatus({ status: 409, code: "idempotency_conflict" }), "unknown");
    assert.equal(lifecycleFailureStatus(new Error("Response lost")), "unknown");
    assert.equal(lifecycleFailureStatus({ status: 400 }), "rejected");
});
