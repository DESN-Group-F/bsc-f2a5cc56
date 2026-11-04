import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import { nativeNfcCapability } from "../work/qa/native-nfc-capability.mjs";
import { validateTeachingNfcTag } from "../work/qa/teaching-nfc.mjs";
import { WebNfcError } from "../work/qa/web-nfc.mjs";

// Runs the real panel handlers with controlled hooks and a scripted reader bridge.
const source = await readFile(new URL("../components/inventory/nfc-scan-panel.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } }).outputText.replace(/^import .*;\r?\n/gm, "").replace(/^export /gm, "");
const jsx = (type, props, key) => ({ type, props: props ?? {}, key });
function hooks() {
    const state = [], effects = []; let pointer = 0, effectPointer = 0, scheduled = [];
    return {
        reset() { pointer = 0; effectPointer = 0; scheduled = []; },
        useState(initial) { const index = pointer++; if (!(index in state)) state[index] = typeof initial === "function" ? initial() : initial; return [state[index], update => { state[index] = typeof update === "function" ? update(state[index]) : update; }]; },
        useRef(initial) { const index = pointer++; if (!(index in state)) state[index] = { current: initial }; return state[index]; },
        useEffect(callback, dependencies) { const index = effectPointer++, prior = effects[index]; if (!prior || !dependencies || dependencies.some((value, key) => !Object.is(value, prior.dependencies[key]))) scheduled.push(() => { prior?.cleanup?.(); effects[index] = { dependencies, cleanup: callback() }; }); },
        useSyncExternalStore(_subscribe, getSnapshot) { return getSnapshot(); },
        commit() { for (const callback of scheduled) callback(); },
        unmount() { for (const effect of effects) effect?.cleanup?.(); },
    };
}
function nodes(node, results = []) { if (Array.isArray(node)) for (const item of node) nodes(item, results); else if (node && typeof node === "object") { results.push(node); nodes(node.props?.children, results); } return results; }
function text(node) { if (typeof node === "string" || typeof node === "number") return String(node); if (Array.isArray(node)) return node.map(text).join(""); return node && typeof node === "object" ? text(node.props?.children) : ""; }
function button(tree, label) { return nodes(tree).find(node => node.type === "Button" && text(node).includes(label)); }
const tick = () => new Promise(resolve => setImmediate(resolve));
function evidence(uid) { const at = "2026-11-04T00:00:01.000Z"; return { attemptId: crypto.randomUUID(), source: "native-nfc-reader", platform: "android", startedAt: at, endedAt: at, tagId: `nfc:uid:${uid}`, result: { uidHex: uid, technology: "Web NFC (Chrome on Android)", ndefStatus: "unknown", capacityBytes: null, records: [], observedAt: at } }; }
function scriptedBridge() {
    const outcomes = [], calls = { read: 0, cancel: 0 }; let waiting = null;
    return {
        calls, push(outcome) { if (waiting) { const settle = waiting; waiting = null; settle(outcome); } else outcomes.push(outcome); },
        async getAvailability() { return { available: true, enabled: true, platform: "android" }; },
        read() { calls.read++; const next = outcomes.shift(); const run = outcome => outcome instanceof Error ? Promise.reject(outcome) : Promise.resolve(outcome); return next ? run(next) : new Promise((resolve, reject) => { waiting = outcome => run(outcome).then(resolve, reject); }); },
        async cancel() { calls.cancel++; if (waiting) { const settle = waiting; waiting = null; settle(new WebNfcError("NFC scanning stopped.", "cancelled")); } },
        async adopt(proposal) { return { ...proposal, adoptedAt: "2026-11-04T00:00:02.000Z" }; },
    };
}
function mount(props, { bridge = null, embedded = false } = {}) {
    const state = hooks(), bindings = { ...state, nativeNfcCapability, validateTeachingNfcTag, WebNfcError, teachingNfcBridge: () => bridge, isEmbeddedPage: () => embedded, Button: "Button", Radio: "Radio", Square: "Square" }, names = Object.keys(bindings);
    const Panel = new Function(...names, "_jsx", "_jsxs", "_Fragment", `${compiled}\nreturn NfcScanPanel;`)(...names.map(name => bindings[name]), jsx, jsx, "Fragment");
    return { props, render() { state.reset(); const tree = Panel(props); state.commit(); return tree; }, unmount: state.unmount };
}

test("the panel is absent in Working inventory and inside embedded pages, and says plainly when a device cannot scan", () => {
    assert.equal(mount({ dataset: "live", hint: "", onRead() {} }, { bridge: scriptedBridge() }).render(), null);
    assert.equal(mount({ dataset: "demo", hint: "", onRead() {} }, { bridge: scriptedBridge(), embedded: true }).render(), null);
    const unsupported = mount({ dataset: "demo", hint: "", onRead() {} }).render();
    assert.match(text(unsupported), /NFC scanning isn't supported on this device or browser/); assert.equal(button(unsupported, "Start NFC scanning"), undefined);
    const ready = mount({ dataset: "demo", hint: "Reads join the list.", onRead() {} }, { bridge: scriptedBridge() }).render();
    assert.match(text(ready), /NFC scan \(demonstration\)/); assert.match(text(ready), /Reads join the list/); assert.ok(button(ready, "Start NFC scanning"));
});

test("listening hands each adopted read to the workspace in order, keeps going after an unreadable tag and stops on request", async () => {
    const bridge = scriptedBridge(), reads = [], listening = [];
    const view = mount({ dataset: "demo", hint: "", onRead: async (tagId, adopted) => { reads.push([tagId, adopted]); await tick(); }, onListeningChange: value => listening.push(value) }, { bridge });
    bridge.push(evidence("04A1B2C3D4E5F6")); bridge.push(new WebNfcError("A tag was detected but the browser could not read it.", "unreadable")); bridge.push(evidence("01020304"));
    const started = button(view.render(), "Start NFC scanning").props.onClick(); await new Promise(resolve => setTimeout(resolve, 1500));
    assert.deepEqual(reads.map(([tagId]) => tagId), ["nfc:uid:04A1B2C3D4E5F6", "nfc:uid:01020304"]);
    assert.deepEqual(validateTeachingNfcTag(reads[0][1], reads[0][0]), reads[0][1]); assert.equal(reads[0][1].adoptedAt, "2026-11-04T00:00:02.000Z");
    let tree = view.render(); assert.ok(button(tree, "Stop scanning")); assert.match(text(tree), /Last tag read: nfc:uid:01020304/);
    button(tree, "Stop scanning").props.onClick(); await started; await tick();
    tree = view.render(); assert.ok(button(tree, "Start NFC scanning")); assert.deepEqual(listening, [true, false]); assert.equal(bridge.calls.cancel, 1);
    assert.equal(nodes(tree).some(node => node.props.role === "alert"), false, "stopping is not an error");
    view.unmount();
});

test("a tag held against the phone and reported again at once reaches the workspace only once", async () => {
    const bridge = scriptedBridge(), reads = [], view = mount({ dataset: "demo", hint: "", onRead: tagId => { reads.push(tagId); } }, { bridge });
    const held = evidence("04A1B2C3D4E5F6"); bridge.push(held); bridge.push({ ...held, attemptId: crypto.randomUUID() }); bridge.push(evidence("01020304"));
    const started = button(view.render(), "Start NFC scanning").props.onClick(); await new Promise(resolve => setTimeout(resolve, 1500));
    assert.deepEqual(reads, ["nfc:uid:04A1B2C3D4E5F6", "nfc:uid:01020304"]);
    button(view.render(), "Stop scanning").props.onClick(); await started; view.unmount();
});

test("a refused permission ends listening with its reason, and disabling the panel stops a running scan", async () => {
    const denied = scriptedBridge(), view = mount({ dataset: "demo", hint: "", onRead() { assert.fail("no read"); } }, { bridge: denied });
    denied.push(new WebNfcError("NFC permission was not granted.", "permission"));
    await button(view.render(), "Start NFC scanning").props.onClick();
    const tree = view.render(); assert.match(text(nodes(tree).find(node => node.props.role === "alert")), /permission was not granted/); assert.ok(button(tree, "Start NFC scanning"));
    const bridge = scriptedBridge(), props = { dataset: "demo", hint: "", disabled: false, onRead() {} }, running = mount(props, { bridge });
    const started = button(running.render(), "Start NFC scanning").props.onClick(); await tick();
    props.disabled = true; running.render(); await started; await tick();
    assert.equal(bridge.calls.cancel, 1); assert.equal(button(running.render(), "Start NFC scanning").props.disabled, true); running.unmount();
});

function listeningBridge() {
    const sessions = [];
    return {
        sessions, emit(outcome) { const session = sessions.at(-1); if (outcome instanceof Error) session.onFailure(outcome); else session.onProposal(outcome); },
        async getAvailability() { return { available: true, enabled: true, platform: "android" }; },
        read() { assert.fail("a listening bridge is not read one tag at a time"); },
        async cancel() {},
        async adopt(proposal) { return { ...proposal, adoptedAt: "2026-11-04T00:00:02.000Z" }; },
        listen(onProposal, onFailure) { const session = { onProposal, onFailure, stopped: 0 }; sessions.push(session); return () => { session.stopped++; }; },
    };
}

test("a continuous browser session keeps one scan, delivers reads in order while the workspace is busy and ignores a held tag", async () => {
    const bridge = listeningBridge(), reads = [], listening = []; let release;
    const view = mount({ dataset: "demo", hint: "", onRead: tagId => { reads.push(tagId); if (reads.length === 1) return new Promise(resolve => { release = resolve; }); }, onListeningChange: value => listening.push(value) }, { bridge });
    button(view.render(), "Start NFC scanning").props.onClick(); await tick();
    assert.equal(bridge.sessions.length, 1, "one scan for the whole listening session");
    bridge.emit(evidence("04A1B2C3D4E5F6")); await tick();
    bridge.emit(evidence("01020304")); bridge.emit(evidence("01020304")); await tick();
    assert.deepEqual(reads, ["nfc:uid:04A1B2C3D4E5F6"], "the next read waits for the workspace");
    release(); await new Promise(resolve => setTimeout(resolve, 50));
    assert.deepEqual(reads, ["nfc:uid:04A1B2C3D4E5F6", "nfc:uid:01020304"], "a repeat of the held tag is ignored");
    bridge.emit(new WebNfcError("A tag was detected but the browser could not read it.", "unreadable")); await tick();
    assert.match(text(nodes(view.render()).find(node => node.props.role === "alert")), /could not read it/); assert.ok(button(view.render(), "Stop scanning"));
    button(view.render(), "Stop scanning").props.onClick(); await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(bridge.sessions[0].stopped, 1); assert.ok(button(view.render(), "Start NFC scanning")); assert.deepEqual(listening, [true, false]);
    bridge.emit(evidence("0A0B0C0D")); await tick(); assert.equal(reads.length, 2, "nothing is delivered after stopping");
    view.unmount();
});

test("a continuous session ends on refused permission and stops when the workspace locks, even mid-read", async () => {
    const denied = listeningBridge(), view = mount({ dataset: "demo", hint: "", onRead() { assert.fail("no read"); } }, { bridge: denied });
    button(view.render(), "Start NFC scanning").props.onClick(); await tick();
    denied.emit(new WebNfcError("NFC permission was not granted.", "permission")); await tick();
    assert.match(text(nodes(view.render()).find(node => node.props.role === "alert")), /permission was not granted/); assert.ok(button(view.render(), "Start NFC scanning"));
    const bridge = listeningBridge(), reads = [], props = { dataset: "demo", hint: "", disabled: false, onRead: tagId => { reads.push(tagId); } }, running = mount(props, { bridge });
    button(running.render(), "Start NFC scanning").props.onClick(); await tick();
    let finishAdopt; bridge.adopt = proposal => new Promise(resolve => { finishAdopt = () => resolve({ ...proposal, adoptedAt: "2026-11-04T00:00:02.000Z" }); });
    bridge.emit(evidence("04A1B2C3D4E5F6")); await tick();
    props.disabled = true; running.render(); finishAdopt(); await new Promise(resolve => setTimeout(resolve, 10));
    assert.deepEqual(reads, [], "a read adopted after the workspace locked is not delivered"); assert.equal(bridge.sessions[0].stopped, 1);
    assert.equal(button(running.render(), "Start NFC scanning").props.disabled, true); running.unmount();
});
