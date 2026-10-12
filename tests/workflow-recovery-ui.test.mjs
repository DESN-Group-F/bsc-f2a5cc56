import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import * as recovery from "../work/qa/client/workflow-recovery.mjs";
import { groupMaintenanceKey } from "../work/qa/group-maintenance.mjs";
import { intakeStorageKey } from "../work/qa/intake-session.mjs";
import { lifecycleStorageKey } from "../work/qa/lifecycle-session.mjs";
import { movementStorageKey } from "../work/qa/movement-session.mjs";
import { removalDraftStorageKey } from "../work/qa/removal-draft.mjs";
import { retiredAssetStorageKey } from "../work/qa/retired-asset-actions.mjs";
import { bindDownloadFeedback } from "./helpers/download-feedback-harness.mjs";

// Exercise the actual recovery hook and notice with controlled storage and download handoff.
// The raw data is synthetic; this does not access a real account or browser storage.
async function compiled(path) {
  return ts.transpileModule(await readFile(new URL(`../${path}`, import.meta.url), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } }).outputText.replace(/^import .*;\r?\n/gm, "").replace(/^export /gm, "");
}
const hookSource = await compiled("hooks/use-workflow-recovery.ts"), noticeSource = await compiled("components/application/recovery-notices.tsx");
function hook(downloads) {
  const bindings = { ...recovery, groupMaintenanceKey, intakeStorageKey, lifecycleStorageKey, movementStorageKey, removalDraftStorageKey, retiredAssetStorageKey, useCallback: callback => callback, useSyncExternalStore: (_subscribe, snapshot) => snapshot(), saveDownloadAttachment: attachment => downloads.push(attachment) };
  return new Function(...Object.keys(bindings), `${hookSource}\nreturn { useWorkflowRecovery, retainedWorkflowExport };`)(...Object.values(bindings));
}
async function environment(run, seed = [], denied = false) {
  const original = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage"), entries = new Map(seed), reads = [];
  Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: { getItem(key) { reads.push(key); if (denied) throw new Error("Controlled browser storage access denied"); return entries.get(key) ?? null; }, setItem() { assert.fail("Recovery export must not change storage"); }, removeItem() { assert.fail("Recovery export must not clear storage"); } } });
  try { await run({ entries, reads }); } finally { if (original) Object.defineProperty(globalThis, "sessionStorage", original); else Reflect.deleteProperty(globalThis, "sessionStorage"); }
}
const actor = "current-native-account";

test("unreadable recovery exposes its actual error and exports raw evidence only from known current-account workflow keys", async () => {
  const scanKey = `battery-scan:${actor}:demo:checkout`, raw = '{"native evidence":"Retained\r\n电池 — ☃", damaged';
  const ownIntake = intakeStorageKey(actor, "live"), foreign = `battery-scan:another-account:demo:checkout`;
  await environment(async ({ entries, reads }) => {
    const downloads = [], api = hook(downloads), state = api.useWorkflowRecovery(actor), before = [...entries];
    assert.equal(state.unavailable, true); assert.match(state.error, /retained demo checkout scan session is unreadable/);
    assert.throws(state.read, /retained demo checkout scan session is unreadable/);
    reads.length = 0; state.exportRetained();
    assert.equal(downloads.length, 1); assert.equal(downloads[0].filename, "battery-workflow-recovery.json"); assert.equal(downloads[0].blob.type, "application/json");
    const saved = JSON.parse(await downloads[0].blob.text());
    assert.equal(saved.accountId, actor); assert.equal(saved.format, "battery-workflow-recovery");
    assert.deepEqual(saved.records, [{ key: scanKey, raw }, { key: ownIntake, raw: "Unsupported but retained intake" }]);
    assert.equal(reads.length, 18); assert.ok(reads.every(key => key.includes(`:${actor}:`)));
    assert.equal(reads.includes(foreign), false); assert.equal(reads.includes("session-token"), false); assert.equal(reads.includes(`battery-unrelated:${actor}:demo`), false);
    assert.deepEqual([...entries], before);
    const other = api.useWorkflowRecovery("another-account"); other.exportRetained();
    assert.deepEqual(JSON.parse(await downloads[1].blob.text()).records, [{ key: foreign, raw: "Other account data" }]);
  }, [[scanKey, raw], [ownIntake, "Unsupported but retained intake"], [foreign, "Other account data"], ["session-token", "Private authentication token"], [`battery-unrelated:${actor}:demo`, "Unrelated retained value"]]);
});

test("recovery export preserves an empty corrupt raw value and fails without an attachment when browser storage is inaccessible", async () => {
  await environment(async () => {
    const downloads = [], api = hook(downloads), state = api.useWorkflowRecovery(actor);
    assert.equal(state.unavailable, true); state.exportRetained();
    assert.deepEqual(JSON.parse(await downloads[0].blob.text()).records, [{ key: movementStorageKey(actor, "demo", "return"), raw: "" }]);
  }, [[movementStorageKey(actor, "demo", "return"), ""]]);
  await environment(async () => {
    const downloads = [], state = hook(downloads).useWorkflowRecovery(actor);
    assert.equal(state.unavailable, true); assert.equal(state.error, "Controlled browser storage access denied");
    assert.throws(state.exportRetained, /Controlled browser storage access denied/); assert.equal(downloads.length, 0);
  }, [], true);
});

function hooks() {
  const state = [], effects = []; let index = 0, effectIndex = 0, pending = [];
  return {
    reset() { index = 0; effectIndex = 0; pending = []; },
    useState(initial) { const key = index++; if (!(key in state)) state[key] = typeof initial === "function" ? initial() : initial; return [state[key], value => { state[key] = typeof value === "function" ? value(state[key]) : value; }]; },
    useRef(initial) { const key = index++; if (!(key in state)) state[key] = { current: initial }; return state[key]; },
    useEffect(callback, deps) { const key = effectIndex++, previous = effects[key]; if (!previous || deps.some((value, position) => !Object.is(value, previous.deps[position]))) pending.push(() => { previous?.cleanup?.(); effects[key] = { deps, cleanup: callback() }; }); },
    commit() { pending.forEach(callback => callback()); }, unmount() { effects.forEach(effect => effect?.cleanup?.()); },
  };
}
const jsx = (type, props) => ({ type, props: props ?? {} });
function text(node) { return typeof node === "string" || typeof node === "number" ? String(node) : Array.isArray(node) ? node.map(text).join("") : node && typeof node === "object" ? text(node.props?.children) : ""; }
function nodes(node, result = []) { if (Array.isArray(node)) node.forEach(child => nodes(child, result)); else if (node && typeof node === "object") { result.push(node); nodes(node.props?.children, result); } return result; }
function mountNotice(props) {
  const state = hooks(), bindings = { DownloadAction: "DownloadAction", useDownloadFeedback: bindDownloadFeedback(state) };
  const Component = new Function(...Object.keys(bindings), "_jsx", "_jsxs", "_Fragment", `${noticeSource}\nreturn RecoveryStorageNotice;`)(...Object.values(bindings), jsx, jsx, "Fragment");
  return { render() { state.reset(); const tree = Component(props); state.commit(); return tree; }, unmount: state.unmount };
}

test("recovery notice displays the load error and reports export failure or successful browser handoff without clearing evidence", async () => {
  let denied = true, attempts = 0;
  const view = mountNotice({ message: "The retained native scan evidence is unreadable.", onExport() { attempts++; if (denied) throw new Error("Controlled export storage read denied"); } });
  const action = () => nodes(view.render()).find(node => node.type === "DownloadAction");
  assert.match(text(view.render()), /The retained native scan evidence is unreadable/); assert.match(text(view.render()), /Export keeps the original data unchanged/);
  assert.equal(action().props.completion, null); await action().props.onClick();
  assert.equal(attempts, 1); assert.match(text(view.render()), /Controlled export storage read denied/); assert.equal(action().props.completion, null);
  denied = false; const pending = action().props.onClick(); assert.equal(action().props.pending, true); await pending;
  assert.equal(attempts, 2); assert.equal(action().props.pending, false); assert.ok(action().props.completion); assert.doesNotMatch(text(view.render()), /Controlled export storage read denied/);
  assert.match(text(view.render()), /The retained native scan evidence is unreadable/); view.unmount();
});
