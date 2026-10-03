import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import { z } from "zod";

// Execute the real transport helper without loading authentication or a database.
// Keep this test independent of the shared domain runner's generated modules.
const compile = (source) => ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText.replace(/^import .*;\r?\n/gm, "").replace(/^export /gm, "");
const domainSource = ts.createSourceFile("domain.ts", await readFile("lib/domain.ts", "utf8"), ts.ScriptTarget.Latest, true);
const errorDeclaration = domainSource.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === "DomainError");
assert.ok(errorDeclaration, "The request helper must use the application's DomainError");
const DomainError = new Function(`${compile(errorDeclaration.getText(domainSource))}\nreturn DomainError;`)();
const unusedAuthentication = () => { throw new Error("Request-body validation must not authenticate or access a database"); };
const requestJson = new Function("z", "DomainError", "getD1Database", "AccountStore", "sessionToken",
    `${compile(await readFile("lib/api.ts", "utf8"))}\nreturn requestJson;`,
)(z, DomainError, unusedAuthentication, unusedAuthentication, unusedAuthentication);

const originalSetTimeout = globalThis.setTimeout;
const originalClearTimeout = globalThis.clearTimeout;
async function bounded(promise) {
    let timeout;
    try {
        return await Promise.race([
            promise,
            new Promise((_, reject) => { timeout = originalSetTimeout(() => reject(new Error("Request rejection did not settle within the test deadline")), 1500); }),
        ]);
    } finally {
        originalClearTimeout(timeout);
    }
}
const denial = (status, message) => error => {
    assert.ok(error instanceof DomainError);
    assert.equal(error.status, status);
    assert.equal(error.message, message);
    return true;
};
const crossOrigin = { origin: "https://untrusted.example", "content-type": "application/json" };
const unsupportedType = { "content-type": "text/plain" };
const refusals = [
    { headers: crossOrigin, status: 403, message: "Cross-origin changes are not allowed." },
    { headers: unsupportedType, status: 415, message: "Send changes as JSON." },
];
function request(body, headers = { "content-type": "application/json" }) {
    return new Request("https://inventory.example/api/inventory", { method: "POST", headers, body, duplex: "half" });
}
function finiteBody(chunks) {
    const evidence = { bytes: 0, ended: false, cancellations: 0 };
    let index = 0;
    const body = new ReadableStream({
        pull(controller) {
            if (index === chunks.length) { evidence.ended = true; controller.close(); return; }
            const value = new TextEncoder().encode(chunks[index++]);
            evidence.bytes += value.byteLength;
            controller.enqueue(value);
        },
        cancel() { evidence.cancellations++; },
    }, { highWaterMark: 0 });
    return { body, evidence };
}

test("cross-origin rejection retains 403 precedence and completely consumes a small rejected body", { timeout: 3000 }, async () => {
    const { body, evidence } = finiteBody(["not ", "valid JSON"]);
    const input = request(body, { ...crossOrigin, "content-type": "text/plain" });
    await assert.rejects(bounded(requestJson(input)), denial(403, refusals[0].message));
    assert.equal(evidence.ended, true);
    assert.equal(evidence.bytes, 14);
    assert.equal(evidence.cancellations, 0);
    assert.equal(input.bodyUsed, true);
    assert.equal(input.body.locked, false);
});

test("unsupported content type retains 415 and completely consumes a small rejected body", { timeout: 3000 }, async () => {
    const { body, evidence } = finiteBody(["{", '"valid":true', "}"]);
    const input = request(body, unsupportedType);
    await assert.rejects(bounded(requestJson(input)), denial(415, refusals[1].message));
    assert.equal(evidence.ended, true);
    assert.equal(evidence.cancellations, 0);
    assert.equal(input.bodyUsed, true);
    assert.equal(input.body.locked, false);
});

test("requests without a body retain their original origin or content-type refusal", { timeout: 3000 }, async () => {
    for (const refusal of refusals) {
        await assert.rejects(bounded(requestJson(request(null, refusal.headers))), denial(refusal.status, refusal.message));
    }
});

test("unbounded rejected streams stop at the configured or absolute discard limit", { timeout: 3000 }, async () => {
    for (const refusal of refusals) for (const max of [16, 1_000_000]) {
        const limit = Math.min(max, 250_000), chunkSize = 8192;
        let bytes = 0, cancellations = 0;
        const input = request(new ReadableStream({
            pull(controller) { bytes += chunkSize; controller.enqueue(new Uint8Array(chunkSize)); },
            cancel() { cancellations++; },
        }, { highWaterMark: 0 }), refusal.headers);
        await assert.rejects(bounded(requestJson(input, max)), denial(refusal.status, refusal.message));
        assert.ok(bytes >= limit && bytes < limit + chunkSize, `Discarded ${bytes} bytes for a ${limit}-byte limit`);
        assert.equal(cancellations, 1);
        assert.equal(input.body.locked, false);
    }
});

test("a rejected body's read failure never replaces the original denial", { timeout: 3000 }, async () => {
    for (const refusal of refusals) {
        const input = request(new ReadableStream({
            pull(controller) { controller.error(new Error("The request upload disconnected")); },
        }, { highWaterMark: 0 }), refusal.headers);
        await assert.rejects(bounded(requestJson(input)), denial(refusal.status, refusal.message));
        assert.equal(input.body.locked, false);
    }
});

test("a rejected cancellation cannot replace the original 403 or 415 response", { timeout: 3000 }, async () => {
    for (const refusal of refusals) {
        let cancellations = 0;
        const input = request(new ReadableStream({
            pull(controller) { controller.enqueue(new Uint8Array(16)); },
            cancel() { cancellations++; return Promise.reject(new Error("Cancellation failed")); },
        }, { highWaterMark: 0 }), refusal.headers);
        await assert.rejects(bounded(requestJson(input, 8)), denial(refusal.status, refusal.message));
        assert.equal(cancellations, 1);
        assert.equal(input.body.locked, false);
    }
});

test("a capped rejected body does not await a cancellation promise that never settles", { timeout: 3000 }, async () => {
    for (const refusal of refusals) {
        let cancellations = 0;
        const input = request(new ReadableStream({
            pull(controller) { controller.enqueue(new Uint8Array(16)); },
            cancel() { cancellations++; return new Promise(() => {}); },
        }, { highWaterMark: 0 }), refusal.headers);
        await assert.rejects(bounded(requestJson(input, 8)), denial(refusal.status, refusal.message));
        assert.equal(cancellations, 1);
        assert.equal(input.body.locked, false);
    }
});

test("a stalled rejected upload is cancelled on its deadline without awaiting cancellation", { timeout: 3000 }, async context => {
    context.mock.timers.enable({ apis: ["setTimeout"] });
    for (const refusal of refusals) {
        let cancellations = 0, settled = false;
        const input = request(new ReadableStream({
            pull() {},
            cancel() { cancellations++; return new Promise(() => {}); },
        }, { highWaterMark: 0 }), refusal.headers);
        const result = requestJson(input);
        const completed = result.then(() => { settled = true; }, () => { settled = true; });
        const rejected = assert.rejects(bounded(result), denial(refusal.status, refusal.message));
        context.mock.timers.tick(999);
        await Promise.resolve();
        assert.equal(settled, false);
        assert.equal(cancellations, 0);
        context.mock.timers.tick(1);
        await rejected;
        await completed;
        assert.equal(cancellations, 1);
        assert.equal(input.body.locked, false);
    }
});

test("valid JSON remains accepted with an absent or matching origin", { timeout: 3000 }, async () => {
    for (const origin of [undefined, "https://inventory.example"]) {
        const value = { dataset: "demo", count: 3, note: "Unicode: µ" };
        const input = request(JSON.stringify(value), { "content-type": "application/json; charset=utf-8", ...(origin ? { origin } : {}) });
        assert.deepEqual(await bounded(requestJson(input)), value);
        assert.equal(input.bodyUsed, true);
    }
});

test("malformed JSON and oversized JSON preserve their original status and messages", { timeout: 3000 }, async () => {
    await assert.rejects(bounded(requestJson(request("{"))), denial(400, "The request is not valid JSON."));
    await assert.rejects(bounded(requestJson(request('{"value":true}'), 4)), denial(413, "This request is too large."));
    await assert.rejects(bounded(requestJson(request('{"value":true}'), 4, "Import at most 200 rows.")), denial(413, "Import at most 200 rows."));
});
