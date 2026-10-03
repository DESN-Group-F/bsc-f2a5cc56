import { test } from "node:test";
import assert from "node:assert/strict";
import { scanMovementPayload, scanFailureStatus, recoverScanSession, scanReadProblem, resolveRegisteredTagIssues, scanCompletedReadMatches } from "../work/qa/scan-session.mjs";

const sessionId = "11111111-1111-4111-8111-111111111111", requestId = "22222222-2222-4222-8222-222222222222";
const loanId = "33333333-3333-4333-8333-333333333333", laterLoanId = "44444444-4444-4444-8444-444444444444";
const read = (extra = {}, source = "simulated") => ({
    battery: { id: "BAT-001", name: "Scan test battery", version: 7, tagId: "00000001", ownerName: "Responsible Staff", loanId, borrowerName: "Current Staff", ...extra },
    tagId: Object.hasOwn(extra, "tagId") ? extra.tagId : "00000001", source, readAt: "2026-10-02T05:00:00.000Z",
});
const room = () => ({ id: "J18-DEMO-WORKSPACE", version: 4, name: "Demo workspace", isPlaceholder: true, buildingId: "J18" });
function savedAttempt(status = "uncertain") {
    const reads = [read()], selectedRoom = room();
    return {
        sessionId, mode: "batch", room: selectedRoom, queue: reads, completed: [], issues: [],
        attempt: { payload: scanMovementPayload("return", reads, sessionId, selectedRoom, requestId), reads, status, message: "The connection ended before a receipt was received." },
    };
}

test("an exact registered tag resolves its old unknown issues without clearing another tag or a loan-state problem", () => {
    const issues = [
        { id: requestId, tagId: "000Tag", category: "unknown", message: "Not registered", acknowledged: false },
        { id: loanId, tagId: "000Tag", category: "unknown", message: "Earlier repeated unknown read", acknowledged: true },
        { id: laterLoanId, tagId: "000tag", category: "unknown", message: "Other exact identifier", acknowledged: false },
        { id: sessionId, tagId: "000Tag", category: "state", message: "Already in use", acknowledged: false },
    ];
    assert.equal(resolveRegisteredTagIssues(issues, "000Tag", { id: "REGISTERED", tagId: "OTHER" }), issues);
    const resolved = resolveRegisteredTagIssues(issues, "000Tag", { id: "REGISTERED", tagId: "000Tag" });
    assert.deepEqual(resolved.slice(0, 2), issues.slice(0, 2).map(issue => ({ ...issue, acknowledged: true, resolvedBatteryId: "REGISTERED" })));
    assert.equal(resolved[2], issues[2]); assert.equal(resolved[3], issues[3]);
    assert.equal(issues[0].acknowledged, false);
    assert.equal(resolved.filter(issue => !issue.acknowledged).length, 2);
});

test("resolved tag issues survive recovery alongside real pending issues and do not restore a finished scan session", () => {
    const resolved = { id: requestId, tagId: "000Tag", category: "unknown", message: "Original unregistered read", acknowledged: true, resolvedBatteryId: "REGISTERED" };
    const pending = { id: loanId, tagId: "OTHER", category: "unknown", message: "Still unregistered", acknowledged: false };
    const saved = { sessionId, mode: "continuous", room: null, queue: [], completed: [], attempt: null, issues: [resolved, pending] };
    assert.deepEqual(recoverScanSession(JSON.stringify(saved), "checkout").issues, saved.issues);
    assert.equal(recoverScanSession(JSON.stringify({ ...saved, issues: [resolved] }), "checkout"), null);
    for (const invalid of [{ ...resolved, resolvedBatteryId: "" }, { ...resolved, acknowledged: false }, { ...resolved, category: "state" }])
        assert.equal(recoverScanSession(JSON.stringify({ ...saved, issues: [invalid, pending] }), "checkout"), null);
});

test("completed reads suppress the same loan action while allowing a later loan or checkout after return", () => {
    const returned = { ...read(), receipt: { requestId, kind: "return", batteryIds: ["BAT-001"], count: 1, at: "2026-10-02T05:01:00.000Z" } };
    assert.equal(scanCompletedReadMatches("return", read().battery, [returned]), true);
    assert.equal(scanCompletedReadMatches("return", read({ loanId: null }).battery, [returned]), true);
    assert.equal(scanCompletedReadMatches("return", read({ loanId: laterLoanId }).battery, [returned]), false);
    assert.equal(scanCompletedReadMatches("return", read({ id: "BAT-002" }).battery, [returned]), false);
    const checkedOut = { ...read({ loanId: null }), receipt: { ...returned.receipt, kind: "checkout" } };
    assert.equal(scanCompletedReadMatches("checkout", read().battery, [checkedOut]), true);
    assert.equal(scanCompletedReadMatches("checkout", read({ loanId: null }).battery, [checkedOut]), false);
});

test("recovery retains separate confirmed movements and later queued loans of the same battery without admitting duplicate receipts", () => {
    const returned = { ...read(), receipt: { requestId, kind: "return", batteryIds: ["BAT-001"], count: 1, at: "2026-10-02T05:01:00.000Z" } };
    const saved = { sessionId, mode: "batch", room: null, queue: [read({ loanId: laterLoanId })], completed: [returned], issues: [], attempt: null };
    assert.deepEqual(recoverScanSession(JSON.stringify(saved), "return"), saved);
    assert.equal(recoverScanSession(JSON.stringify({ ...saved, queue: [read()] }), "return"), null);
    const laterReturn = { ...read({ loanId: laterLoanId }), receipt: { ...returned.receipt, requestId: loanId, at: "2026-10-02T05:03:00.000Z" } };
    const pendingIssue = { id: laterLoanId, tagId: "UNKNOWN", category: "unknown", message: "Still unregistered", acknowledged: false };
    const finished = { ...saved, queue: [], completed: [returned, laterReturn], issues: [pendingIssue] };
    assert.deepEqual(recoverScanSession(JSON.stringify(finished), "return").completed, [returned, laterReturn]);
    assert.equal(recoverScanSession(JSON.stringify({ ...finished, completed: [returned, returned] }), "return"), null);
});

test("captured return payload preserves the exact reviewed loan, tag, asset version and room version after surrounding data changes", () => {
    const originalRead = read(), selectedRoom = room();
    const payload = scanMovementPayload("return", [originalRead], sessionId, selectedRoom, requestId);
    originalRead.battery.loanId = laterLoanId;
    originalRead.battery.version = 8;
    originalRead.battery.tagId = "NEW-TAG";
    selectedRoom.id = "DIFFERENT-ROOM";
    selectedRoom.version = 5;
    assert.deepEqual(payload, {
        requestId, kind: "return", batteryIds: ["BAT-001"], expectedLoans: [{ batteryId: "BAT-001", loanId }],
        scan: { sessionId, source: "simulated", bindings: [{ batteryId: "BAT-001", tagId: "00000001", version: 7 }] },
        returnRoom: { roomId: "J18-DEMO-WORKSPACE", version: 4 },
    });
    const checkout = scanMovementPayload("checkout", [read({ loanId: null }, "manual")], sessionId, room(), requestId);
    assert.equal(checkout.expectedLoans, undefined);
    assert.equal(checkout.returnRoom, undefined);
    assert.equal(checkout.scan.source, "manual");
});

test("a scan movement cannot mix sources, repeat an asset or capture a tag/state that no longer matches the review", () => {
    assert.throws(() => scanMovementPayload("return", [read(), read({ id: "BAT-002" }, "manual")], sessionId, room(), requestId), /separate batches/);
    assert.throws(() => scanMovementPayload("return", [read(), read()], sessionId, room(), requestId), /only once/);
    assert.throws(() => scanMovementPayload("return", [], sessionId, room(), requestId), /between 1 and 100/);
    assert.throws(() => scanMovementPayload("return", Array.from({ length: 101 }, (_, index) => read({ id: `BAT-${index}` })), sessionId, room(), requestId), /between 1 and 100/);
    assert.throws(() => scanMovementPayload("return", [read({ loanId: null })], sessionId, room(), requestId), /No active loan/);
    assert.throws(() => scanMovementPayload("checkout", [read()], sessionId, null, requestId), /Already in use/);
    const changedTag = read();
    changedTag.battery.tagId = "OTHER-TAG";
    assert.match(scanReadProblem("return", changedTag.battery, changedTag.tagId), /registered tag changed/);
    assert.throws(() => scanMovementPayload("return", [changedTag], sessionId, room(), requestId), /registered tag changed/);
});

test("network/server uncertainty retains the exact original request until a terminal reservation rejects it, including when authentication later expires", () => {
    assert.equal(scanFailureStatus(new Error("Network connection ended")), "uncertain");
    assert.equal(scanFailureStatus({ status: 503 }), "uncertain");
    assert.equal(scanFailureStatus({ status: 409 }), "rejected");
    assert.equal(scanFailureStatus({ status: 401 }), "rejected");
    assert.equal(scanFailureStatus({ status: 401 }, true), "uncertain");
    assert.equal(scanFailureStatus({ status: 403 }, true), "uncertain");
    for (const status of [400, 404, 409, 415, 429]) {
        assert.equal(scanFailureStatus({ status }, true), "uncertain");
        assert.equal(scanFailureStatus({ status, code: "scan_conflict" }, true), "uncertain");
    }
    assert.equal(scanFailureStatus({ status: 409, code: "movement_rejected_final" }, true), "rejected");
    assert.equal(scanFailureStatus({ status: 400, code: "movement_rejected_final" }, true), "rejected");
    assert.equal(scanFailureStatus({ status: 503, code: "movement_rejected_final" }, true), "uncertain");
    assert.equal(scanFailureStatus({ code: "movement_rejected_final" }, true), "uncertain");
    assert.equal(scanFailureStatus(new Error("Retry connection ended"), true), "uncertain");
    const saved = savedAttempt(), recovered = recoverScanSession(JSON.stringify(saved), "return");
    assert.ok(recovered);
    assert.equal(recovered.attempt.status, "uncertain");
    assert.equal(recovered.attempt.payload.requestId, requestId);
    assert.deepEqual(recovered.attempt.payload, saved.attempt.payload);
    assert.deepEqual(recovered.attempt.payload.expectedLoans, [{ batteryId: "BAT-001", loanId }]);
    assert.equal(recoverScanSession(JSON.stringify(saved), "checkout"), null);
    const finalized = { ...saved, attempt: { ...saved.attempt, status: scanFailureStatus({ status: 409, code: "movement_rejected_final" }, true), message: "This exact scanned request is reserved as rejected." } };
    const finalRecovery = recoverScanSession(JSON.stringify(finalized), "return");
    assert.equal(finalRecovery.attempt.status, "rejected");
    assert.deepEqual(finalRecovery.attempt.payload, saved.attempt.payload);
});

test("recovery rejects corrupted request, tag, loan and room bindings rather than preparing a replacement operation", () => {
    assert.equal(recoverScanSession("not JSON", "return"), null);
    const corruptions = [
        saved => { saved.attempt.payload.requestId = "not-a-valid-request-id"; },
        saved => { saved.sessionId = "------------------------------------"; saved.attempt.payload.scan.sessionId = saved.sessionId; },
        saved => { saved.attempt.payload.expectedLoans[0].loanId = laterLoanId; },
        saved => { saved.attempt.payload.scan.bindings[0].tagId = "OTHER-TAG"; },
        saved => { saved.attempt.payload.scan.bindings[0].version++; },
        saved => { saved.attempt.payload.returnRoom.version++; },
        saved => { saved.attempt.payload.scan.source = "manual"; },
        saved => { saved.attempt.reads[0].battery.version = 0; saved.attempt.payload.scan.bindings[0].version = 0; },
        saved => { saved.issues = ["corrupted-issue-record"]; },
    ];
    for (const [index, corrupt] of corruptions.entries()) {
        const saved = savedAttempt();
        corrupt(saved);
        assert.equal(recoverScanSession(JSON.stringify(saved), "return"), null, `Corrupted saved session ${index} was accepted`);
    }
    const duplicateQueue = { ...savedAttempt(), attempt: null, queue: [read(), read()] };
    assert.equal(recoverScanSession(JSON.stringify(duplicateQueue), "return"), null);
});

test("valid queued work is recovered independently of completed receipts, while an entirely finished session does not restore pending work", () => {
    const saved = savedAttempt(), queued = { ...saved, attempt: null, queue: [read()] };
    assert.deepEqual(recoverScanSession(JSON.stringify(queued), "return").queue, queued.queue);
    const finished = {
        ...saved, attempt: null, queue: [], completed: [{ ...read(), receipt: { requestId, kind: "return", batteryIds: ["BAT-001"], count: 1, at: "2026-10-02T05:01:00.000Z" } }],
    };
    assert.equal(recoverScanSession(JSON.stringify(finished), "return"), null);
    const rejected = savedAttempt("rejected");
    assert.equal(recoverScanSession(JSON.stringify(rejected), "return").attempt.status, "rejected");
});

test("manual selection captures several untagged batteries with exact versions and loan IDs", () => {
    const reads = [read({ tagId: null }, "selection"), read({ id: "BAT-002", tagId: null, loanId: laterLoanId }, "selection")];
    const payload = scanMovementPayload("return", reads, sessionId, null, requestId);
    assert.equal(payload.scan.source, "selection");
    assert.deepEqual(payload.scan.bindings, [
        { batteryId: "BAT-001", tagId: null, version: 7 }, { batteryId: "BAT-002", tagId: null, version: 7 },
    ]);
    assert.deepEqual(payload.expectedLoans, [{ batteryId: "BAT-001", loanId }, { batteryId: "BAT-002", loanId: laterLoanId }]);
    reads[0].battery.tagId = "ADDED-AFTER-SELECTION";
    reads[0].battery.version = 8;
    assert.deepEqual(payload.scan.bindings[0], { batteryId: "BAT-001", tagId: null, version: 7 });
    assert.match(scanReadProblem("return", reads[0].battery, reads[0].tagId), /registered tag changed/);
    for (const source of ["manual", "simulated"]) assert.throws(() => scanMovementPayload("return", [read({ tagId: null }, source)], sessionId, null, requestId), /require registered tags/);
    assert.throws(() => scanMovementPayload("return", [read({}, "manual"), read({ id: "BAT-002", tagId: null }, "selection")], sessionId, null, requestId), /separate batches/);
});

test("untagged selection recovery preserves an uncertain request and rejects changed source or nullable tag bindings", () => {
    const reads = [read({ tagId: null }, "selection"), read({ id: "BAT-002", tagId: null, loanId: laterLoanId }, "selection")];
    const saved = { sessionId, mode: "batch", room: null, queue: reads, completed: [], issues: [],
        attempt: { payload: scanMovementPayload("return", reads, sessionId, null, requestId), reads, status: "uncertain", message: "The response was lost." } };
    assert.deepEqual(recoverScanSession(JSON.stringify(saved), "return"), saved);
    for (const source of ["manual", "simulated"]) {
        const invalid = structuredClone(saved);
        invalid.attempt.payload.scan.source = source;
        for (const read of [...invalid.queue, ...invalid.attempt.reads]) read.source = source;
        assert.equal(recoverScanSession(JSON.stringify(invalid), "return"), null);
    }
    const changed = structuredClone(saved);
    changed.attempt.payload.scan.bindings[0].tagId = "NEW-TAG";
    assert.equal(recoverScanSession(JSON.stringify(changed), "return"), null);
    assert.equal(recoverScanSession(JSON.stringify(saved), "checkout"), null);
    const priorSimulation = savedAttempt();
    assert.equal(recoverScanSession(JSON.stringify(priorSimulation), "return").attempt.payload.scan.source, "simulated", "existing simulated recovery retains its original source");
});
