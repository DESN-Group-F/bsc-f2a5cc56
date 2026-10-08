import { test } from "node:test";
import assert from "node:assert/strict";
import {
    captureRetiredAssetAttempt, recoverRetiredAssetAttempt, retiredAssetStorageKey,
    verifyRetiredAssetReceipt, retiredAssetFailureStatus, retiredAssetPayloadSchema,
} from "../work/qa/retired-asset-actions.mjs";

const payload = (kind = "recover") => ({ requestId: crypto.randomUUID(), kind, items: [
    { batteryId: "BAT-001", version: 3, tagId: "TAG-001" },
    { batteryId: "BAT-002", version: 8, tagId: null },
] });
function receipt(attempt) {
    return { requestId: attempt.payload.requestId, kind: attempt.payload.kind,
        actorAccountId: attempt.actorAccountId, dataset: attempt.dataset,
        at: "2026-10-08T05:00:00.000Z", replayed: false,
        items: attempt.payload.items.map(item => ({ batteryId: item.batteryId,
            version: item.version + 1, status: attempt.payload.kind === "recover" ? "active" : "deleted" })),
    };
}

test("retired asset attempts freeze reviewed bindings and recover only for the original native account and inventory", () => {
    for (const kind of ["recover", "purge"]) {
        const original = payload(kind), captured = captureRetiredAssetAttempt("staff-one", "demo", original);
        original.kind = kind === "recover" ? "purge" : "recover";
        original.items[0].tagId = "CHANGED";
        assert.equal(captured.payload.kind, kind);
        assert.equal(captured.payload.items[0].tagId, "TAG-001");
        const raw = JSON.stringify(captured);
        assert.deepEqual(recoverRetiredAssetAttempt(raw, "staff-one", "demo"), captured);
        assert.equal(recoverRetiredAssetAttempt(raw, "staff-two", "demo"), null);
        assert.equal(recoverRetiredAssetAttempt(raw, "staff-one", "live"), null);
        assert.equal(recoverRetiredAssetAttempt("broken", "staff-one", "demo"), null);
        assert.equal(recoverRetiredAssetAttempt(JSON.stringify({ ...captured, payload: { ...captured.payload, items: [] } }), "staff-one", "demo"), null);
    }
    assert.notEqual(retiredAssetStorageKey("staff-one", "demo"), retiredAssetStorageKey("staff-two", "demo"));
    assert.notEqual(retiredAssetStorageKey("staff-one", "demo"), retiredAssetStorageKey("staff-one", "live"));
});

test("retired asset validation rejects duplicates, oversized reviews and unreviewed or invalid bindings", () => {
    const original = payload();
    assert.deepEqual(retiredAssetPayloadSchema.parse(original), original);
    for (const change of [
        { kind: "scrapped" }, { kind: "permanently_removed" }, { items: [] },
        { items: [original.items[0], original.items[0]] },
        { items: [original.items[0], { ...original.items[1], tagId: "TAG-001" }] },
        { items: [{ ...original.items[0], version: Number.MAX_SAFE_INTEGER }] },
        { items: [{ batteryId: "BAT-001", version: 3 }] }, { actorAccountId: "spoofed" },
        { items: Array.from({ length: 101 }, (_, i) => ({ batteryId: `BAT-${i}`, version: 1, tagId: null })) },
    ]) assert.throws(() => retiredAssetPayloadSchema.parse({ ...original, ...change }));
});

test("recover and purge receipts match every ordered ID, version, action and actor before any success is displayed", () => {
    for (const kind of ["recover", "purge"]) {
        const attempt = captureRetiredAssetAttempt("staff-one", "demo", payload(kind)), result = receipt(attempt);
        assert.deepEqual(verifyRetiredAssetReceipt(result, attempt), result);
        assert.deepEqual(verifyRetiredAssetReceipt({ ...result, replayed: true }, attempt), { ...result, replayed: true });
        for (const change of [
            { requestId: crypto.randomUUID() }, { actorAccountId: "staff-two" }, { dataset: "live" },
            { kind: kind === "recover" ? "purge" : "recover" }, { at: "unknown" },
            { items: result.items.slice(1) }, { items: [...result.items].reverse() },
            { items: [{ ...result.items[0], version: 3 }, result.items[1]] },
            { items: [{ ...result.items[0], status: kind === "recover" ? "deleted" : "active" }, result.items[1]] },
            { items: [{ ...result.items[0], tagId: "TAG-001" }, result.items[1]] },
        ]) assert.throws(() => verifyRetiredAssetReceipt({ ...result, ...change }, attempt));
    }
});

test("only reserved final rejections release an uncertain retired action for a new review", () => {
    for (const status of [400, 404, 409, 422]) assert.equal(retiredAssetFailureStatus({ status, code: "retired_asset_rejected_final" }), "rejected");
    for (const status of [401, 403, 404, 409, 429, 500, 503]) assert.equal(retiredAssetFailureStatus({ status }), "unknown");
    assert.equal(retiredAssetFailureStatus({ status: 409, code: "idempotency_conflict" }), "unknown");
    assert.equal(retiredAssetFailureStatus(new Error("Response lost")), "unknown");
});
