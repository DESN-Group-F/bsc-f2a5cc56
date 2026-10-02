import { test } from "node:test";
import assert from "node:assert/strict";
const { captureMovementAttempt, movementFailureStatus, movementStorageKey, recoverMovementAttempt, verifyMovementReceipt } = await import(process.env.MOVEMENT_SESSION_TEST_MODULE ?? "../work/qa/movement-session.mjs");
const requestId = "22222222-2222-4222-8222-222222222222", loanId = "33333333-3333-4333-8333-333333333333", replacementLoanId = "44444444-4444-4444-8444-444444444444";
const accountId = "current-native-account", otherAccountId = "other-native-account";
const battery = (extra = {}) => ({ id: "BAT-001", name: "Reviewed battery", version: 7, ownerName: "Responsible Staff", loanId, borrowerName: "Current Holder", checkedOutAt: "2026-10-02T05:00:00.000Z", ...extra });
const attempt = (kind = "return") => captureMovementAttempt(kind, [battery(kind === "checkout" ? { loanId: null, borrowerName: null, checkedOutAt: null } : {})], accountId, "demo", requestId);
const receipt = (input, extra = {}) => ({ requestId: input.payload.requestId, kind: input.payload.kind, batteryIds: [...input.payload.batteryIds], count: input.payload.batteryIds.length, at: "2026-10-02T05:01:00.000Z", ...(input.payload.kind === "checkout" ? { borrowerAccountId: accountId, borrower: "Current Staff" } : {}), ...extra });

test("ordinary return capture keeps the exact reviewed loan and snapshots after surrounding records mutate", () => {
    const original = battery(), captured = captureMovementAttempt("return", [original], accountId, "demo", requestId);
    original.loanId = replacementLoanId; original.borrowerName = "A later holder"; original.version++;
    assert.deepEqual(captured.payload, { requestId, kind: "return", batteryIds: ["BAT-001"], expectedLoans: [{ batteryId: "BAT-001", loanId }] });
    assert.equal(captured.reviewed[0].borrowerName, "Current Holder");
    assert.equal(captured.reviewed[0].version, 7);
    assert.equal(captured.status, "uncertain");
    const checkout = attempt("checkout");
    assert.equal(checkout.payload.expectedLoans, undefined);
    assert.equal(checkout.payload.borrowerAccountId, undefined);
    assert.equal(checkout.payload.borrowerName, undefined);
});

test("invalid movement state or oversized and repeated records cannot be captured for a new write", () => {
    assert.throws(() => captureMovementAttempt("checkout", [battery()], accountId, "demo", requestId), /already on loan/);
    assert.throws(() => captureMovementAttempt("return", [battery({ loanId: null })], accountId, "demo", requestId), /valid reviewed loan/);
    assert.throws(() => captureMovementAttempt("return", [battery(), battery()], accountId, "demo", requestId), /different batteries/);
    assert.throws(() => captureMovementAttempt("return", [], accountId, "demo", requestId), /between 1 and 100/);
    assert.throws(() => captureMovementAttempt("return", Array.from({ length: 101 }, (_, index) => battery({ id: `BAT-${index}` })), accountId, "demo", requestId), /between 1 and 100/);
    assert.throws(() => captureMovementAttempt("return", [battery()], accountId, "demo", "new-request"), /valid request/);
});

test("network, server or malformed-response uncertainty requires a terminal server rejection before review can discard a request", () => {
    assert.equal(movementFailureStatus(new Error("Connection ended after sending")), "uncertain");
    assert.equal(movementFailureStatus({ status: 503 }), "uncertain");
    assert.equal(movementFailureStatus({ status: 200 }), "uncertain");
    assert.equal(movementFailureStatus({ status: 409 }), "rejected");
    assert.equal(movementFailureStatus({ status: 401 }), "rejected");
    assert.equal(movementFailureStatus({ status: 401 }, true), "uncertain");
    assert.equal(movementFailureStatus({ status: 403 }, true), "uncertain");
    for (const status of [400, 401, 403, 404, 409, 415, 429]) {
        assert.equal(movementFailureStatus({ status }, true), "uncertain");
        assert.equal(movementFailureStatus({ status, code: "scan_conflict" }, true), "uncertain");
    }
    assert.equal(movementFailureStatus({ status: 409, code: "movement_rejected_final" }, true), "rejected");
    assert.equal(movementFailureStatus({ status: 400, code: "movement_rejected_final" }, true), "rejected");
    assert.equal(movementFailureStatus({ status: 503, code: "movement_rejected_final" }, true), "uncertain");
    assert.equal(movementFailureStatus({ code: "movement_rejected_final" }, true), "uncertain");
    assert.equal(movementFailureStatus(new Error("Retry connection ended"), true), "uncertain");
    const captured = attempt(), unmatched = { ...captured, status: movementFailureStatus({ status: 409 }, true), message: "Another operation closed the loan while the original request is still unresolved." };
    assert.equal(recoverMovementAttempt(JSON.stringify(unmatched), accountId, "demo", "return").status, "uncertain");
    const finalized = { ...unmatched, status: movementFailureStatus({ status: 409, code: "movement_rejected_final" }, true), message: "This exact request is reserved as rejected." };
    const recovered = recoverMovementAttempt(JSON.stringify(finalized), accountId, "demo", "return");
    assert.equal(recovered.status, "rejected");
    assert.deepEqual(recovered.payload, captured.payload);
});

test("verified success requires the captured request and exact complete battery set", () => {
    const input = attempt(), saved = receipt(input);
    assert.equal(verifyMovementReceipt(saved, input.payload, accountId), saved);
    assert.equal(verifyMovementReceipt({ ...saved, replayed: true }, input.payload, accountId).replayed, true);
    for (const changes of [{ requestId: replacementLoanId }, { kind: "checkout" }, { count: 0 }, { batteryIds: [] }, { batteryIds: ["BAT-OTHER"] }, { batteryIds: ["BAT-001", "BAT-001"], count: 2 }, { at: "not recorded" }, { at: "2026" }])
        assert.throws(() => verifyMovementReceipt({ ...saved, ...changes }, input.payload, accountId), /result is uncertain/);
    assert.throws(() => verifyMovementReceipt(undefined, input.payload, accountId), /result is uncertain/);
    const larger = captureMovementAttempt("return", [battery(), battery({ id: "BAT-002", loanId: replacementLoanId })], accountId, "demo", requestId);
    assert.ok(verifyMovementReceipt(receipt(larger, { batteryIds: ["BAT-002", "BAT-001"] }), larger.payload, accountId));
});

test("checkout receipt identifies the authenticated native holder rather than a supplied display name", () => {
    const input = attempt("checkout");
    assert.equal(verifyMovementReceipt(receipt(input), input.payload, accountId).borrowerAccountId, accountId);
    assert.throws(() => verifyMovementReceipt(receipt(input, { borrowerAccountId: otherAccountId }), input.payload, accountId), /result is uncertain/);
    assert.throws(() => verifyMovementReceipt(receipt(input, { borrowerAccountId: undefined }), input.payload, accountId), /result is uncertain/);
    assert.throws(() => verifyMovementReceipt(receipt(input, { borrower: "" }), input.payload, accountId), /result is uncertain/);
});

test("same-tab recovery preserves the original request and reviewed loan under account, dataset and kind isolation", () => {
    const captured = attempt(), raw = JSON.stringify(captured);
    const recovered = recoverMovementAttempt(raw, accountId, "demo", "return");
    assert.deepEqual(recovered, captured);
    assert.equal(recovered.payload.requestId, requestId);
    assert.equal(recovered.payload.expectedLoans[0].loanId, loanId);
    assert.equal(recoverMovementAttempt(raw, otherAccountId, "demo", "return"), null);
    assert.equal(recoverMovementAttempt(raw, accountId, "live", "return"), null);
    assert.equal(recoverMovementAttempt(raw, accountId, "demo", "checkout"), null);
    assert.notEqual(movementStorageKey(accountId, "demo", "return"), movementStorageKey(otherAccountId, "demo", "return"));
    assert.notEqual(movementStorageKey(accountId, "demo", "return"), movementStorageKey(accountId, "live", "return"));
    assert.notEqual(movementStorageKey(accountId, "demo", "return"), movementStorageKey(accountId, "demo", "checkout"));
    const rejected = { ...captured, status: "rejected", statusCode: 409, message: "This reviewed loan changed." };
    assert.deepEqual(recoverMovementAttempt(JSON.stringify(rejected), accountId, "demo", "return"), rejected);
});

test("corrupted recovery never substitutes a new request or a replacement loan", () => {
    assert.equal(recoverMovementAttempt(null, accountId, "demo", "return"), null);
    assert.equal(recoverMovementAttempt("not JSON", accountId, "demo", "return"), null);
    for (const corrupt of [
        saved => { saved.payload.requestId = "invalid-request"; },
        saved => { saved.payload.expectedLoans[0].loanId = replacementLoanId; },
        saved => { saved.payload.batteryIds = ["BAT-OTHER"]; },
        saved => { saved.payload.borrowerAccountId = otherAccountId; },
        saved => { saved.reviewed[0].loanId = null; },
        saved => { saved.reviewed.push(saved.reviewed[0]); },
        saved => { saved.reviewed[0].checkedOutAt = "invalid"; },
        saved => { saved.status = "completed"; },
        saved => { saved.statusCode = 0; },
    ]) { const saved = attempt(); corrupt(saved); assert.equal(recoverMovementAttempt(JSON.stringify(saved), accountId, "demo", "return"), null); }
});
