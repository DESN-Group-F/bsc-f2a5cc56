import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { createWebNfcBridge, isEmbeddedPage, webNfcScanError, webNfcSupport, webNfcTagId, WebNfcError, WEB_NFC_TECHNOLOGY } from "../work/qa/web-nfc.mjs";
import { teachingNfcEvidenceSchema, validateTeachingNfcTag } from "../work/qa/teaching-nfc.mjs";

// The browser reader is exercised with a scripted NDEFReader. No physical tag or browser is used.
const original = Object.getOwnPropertyDescriptor(globalThis, "window");
afterEach(() => { if (original) Object.defineProperty(globalThis, "window", original); else Reflect.deleteProperty(globalThis, "window"); });
function browser({ secure = true, reader = true, embedded = false, crossOrigin = false } = {}) {
    const readers = [];
    class FakeReader extends EventTarget {
        constructor() { super(); this.scans = []; readers.push(this); }
        scan(options) { this.scans.push(options); return this.failure ? Promise.reject(this.failure) : Promise.resolve(); }
    }
    const win = { isSecureContext: secure, ...(reader ? { NDEFReader: FakeReader } : {}) };
    win.self = win;
    if (crossOrigin) Object.defineProperty(win, "top", { get() { throw new Error("Blocked a frame from accessing a cross-origin frame."); } });
    else win.top = embedded ? {} : win;
    Object.defineProperty(globalThis, "window", { configurable: true, writable: true, value: win });
    return { readers, FakeReader };
}
const reading = serialNumber => Object.assign(new Event("reading"), { serialNumber });
const tick = () => new Promise(resolve => setImmediate(resolve));

test("Chrome serial numbers become the same nfc:uid identifiers the phone apps send", () => {
    assert.deepEqual(webNfcTagId("04:a2:3b:4c:5d:6e:7f"), { uidHex: "04A23B4C5D6E7F", tagId: "nfc:uid:04A23B4C5D6E7F" });
    assert.equal(webNfcTagId(" de:ad:be:ef ").tagId, "nfc:uid:DEADBEEF");
    assert.equal(webNfcTagId("00:01:02:03:04:05:06:07:08:09").tagId, "nfc:uid:00010203040506070809");
    for (const bad of ["04:a2:3b:4c:5d", "", "04a23b4c", "zz:00:00:00", null, 1234])
        assert.throws(() => webNfcTagId(bad), error => error instanceof WebNfcError && error.kind === "identifier");
});

test("scanning is offered only to a secure top-level page with NDEFReader; embedded pages never scan", () => {
    Reflect.deleteProperty(globalThis, "window"); assert.equal(webNfcSupport(), "unsupported"); assert.equal(isEmbeddedPage(), false);
    browser({ secure: false }); assert.equal(webNfcSupport(), "unsupported"); assert.equal(createWebNfcBridge(), null);
    browser({ reader: false }); assert.equal(webNfcSupport(), "unsupported");
    browser(); assert.equal(webNfcSupport(), "available");
    browser({ embedded: true }); assert.equal(webNfcSupport(), "embedded"); assert.equal(createWebNfcBridge(), null);
    browser({ crossOrigin: true }); assert.equal(webNfcSupport(), "embedded");
});

test("a browser read produces device evidence that adopts and validates like a phone read, then stops the reader", async () => {
    const { readers } = browser(), bridge = createWebNfcBridge();
    assert.deepEqual(await bridge.getAvailability(), { available: true, enabled: true, platform: "android" });
    const pending = bridge.read(); await tick();
    assert.equal(readers.length, 1); const signal = readers[0].scans[0].signal; assert.equal(signal.aborted, false);
    readers[0].dispatchEvent(reading("04:a1:b2:c3:d4:e5:f6"));
    const proposal = await pending;
    assert.equal(signal.aborted, true, "the reader stops after one read");
    assert.equal(proposal.tagId, "nfc:uid:04A1B2C3D4E5F6"); assert.equal(proposal.platform, "android"); assert.equal(proposal.source, "native-nfc-reader");
    assert.equal(proposal.result.technology, WEB_NFC_TECHNOLOGY); assert.deepEqual(proposal.result.records, []); assert.equal(proposal.result.capacityBytes, null);
    const evidence = await bridge.adopt(proposal);
    assert.deepEqual(teachingNfcEvidenceSchema.parse(evidence), evidence); assert.deepEqual(validateTeachingNfcTag(evidence, proposal.tagId), evidence);
});

test("unreadable tags, refused permission and cancellation are reported without inventing a read", async () => {
    const { readers } = browser(), bridge = createWebNfcBridge();
    const unreadable = bridge.read(); await tick(); readers[0].dispatchEvent(new Event("readingerror"));
    await assert.rejects(unreadable, error => error instanceof WebNfcError && error.kind === "unreadable");
    const cancelled = bridge.read(); await tick(); await bridge.cancel();
    await assert.rejects(cancelled, error => error instanceof WebNfcError && error.kind === "cancelled");
    const replaced = assert.rejects(bridge.read(), error => error.kind === "cancelled"); await tick(); const next = bridge.read(); await tick();
    await replaced; readers.at(-1).dispatchEvent(reading("01:02:03:04")); assert.equal((await next).tagId, "nfc:uid:01020304");
    const odd = bridge.read(); await tick(); readers.at(-1).dispatchEvent(reading("01:02:03:04:05"));
    await assert.rejects(odd, error => error.kind === "identifier");
    const { readers: denied, FakeReader } = browser(); FakeReader.prototype.failure = Object.assign(new Error("denied"), { name: "NotAllowedError" });
    await assert.rejects(createWebNfcBridge().read(), error => error.kind === "permission"); assert.equal(denied.length, 1);
    delete FakeReader.prototype.failure;
    assert.equal(webNfcScanError(Object.assign(new Error("off"), { name: "NotReadableError" })).kind, "unavailable");
    assert.equal(webNfcScanError(Object.assign(new Error("none"), { name: "NotSupportedError" })).kind, "unavailable");
    assert.equal(webNfcScanError(Object.assign(new Error("stop"), { name: "AbortError" })).kind, "cancelled");
});

test("a listening session keeps one reader for many tags until it is stopped", async () => {
    const { readers } = browser(), bridge = createWebNfcBridge(), proposals = [], failures = [];
    const stop = bridge.listen(proposal => proposals.push(proposal), failure => failures.push(failure)); await tick();
    assert.equal(readers.length, 1); const signal = readers[0].scans[0].signal;
    readers[0].dispatchEvent(reading("04:a1:b2:c3:d4:e5:f6")); readers[0].dispatchEvent(new Event("readingerror")); readers[0].dispatchEvent(reading("01:02:03:04")); readers[0].dispatchEvent(reading("01:02:03"));
    assert.deepEqual(proposals.map(proposal => proposal.tagId), ["nfc:uid:04A1B2C3D4E5F6", "nfc:uid:01020304"]); assert.equal(readers.length, 1, "no restart between tags");
    assert.deepEqual(failures.map(failure => failure.kind), ["unreadable", "identifier"]);
    for (const proposal of proposals) assert.deepEqual(validateTeachingNfcTag(await bridge.adopt(proposal), proposal.tagId).tagId, proposal.tagId);
    stop(); assert.equal(signal.aborted, true);
    readers[0].dispatchEvent(reading("0a:0b:0c:0d")); assert.equal(proposals.length, 2, "nothing is reported after stopping");
    const { FakeReader } = browser(); FakeReader.prototype.failure = Object.assign(new Error("denied"), { name: "NotAllowedError" });
    const refused = []; createWebNfcBridge().listen(() => assert.fail("no read"), failure => refused.push(failure)); await tick();
    assert.deepEqual(refused.map(failure => failure.kind), ["permission"]); delete FakeReader.prototype.failure;
});
