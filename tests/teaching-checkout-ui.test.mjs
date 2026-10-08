import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import * as selection from "../work/qa/teaching-checkout-selection.mjs";
import * as requests from "../work/qa/client/teaching-checkout-request.mjs";
import * as drafts from "../work/qa/client/teaching-checkout-draft.mjs";
import * as contract from "../work/qa/teaching-checkouts.mjs";
import * as filters from "../work/qa/inventory-query.mjs";
import * as batterySelection from "../work/qa/battery-selection-query.mjs";
import * as utils from "../work/qa/client-utils.mjs";
import { inventoryResponse } from "../work/qa/client/inventory-request.mjs";

// Execute real component handlers with inert visual boundaries; browser and NFC hardware are verified separately.
const jsx = (type, props, key) => ({ type, props: props ?? {}, key });
const ui = Object.fromEntries(["ArrowRight", "RefreshCw", "Button", "Checkbox", "Label", "Dialog", "DialogContent", "DialogDescription", "DialogFooter", "DialogHeader", "DialogTitle", "Table", "TableBody", "TableCell", "TableHead", "TableHeader", "TableRow", "Select", "SelectContent", "SelectItem", "SelectTrigger", "SelectValue", "BatteryFilterControls", "TeachingNfcInput"].map(name => [name, name]));
function hooks() {
    const state = [], effects = []; let pointer = 0, effectPointer = 0, pending = [];
    return {
        reset() { pointer = 0; effectPointer = 0; pending = []; },
        useState(initial) { const index = pointer++; if (!(index in state)) state[index] = typeof initial === "function" ? initial() : initial; return [state[index], value => { state[index] = typeof value === "function" ? value(state[index]) : value; }]; },
        useRef(initial) { const index = pointer++; if (!(index in state)) state[index] = { current: initial }; return state[index]; },
        useEffect(callback, deps) { const index = effectPointer++, prior = effects[index]; if (!prior || deps.some((value, at) => !Object.is(value, prior.deps[at]))) pending.push(() => { prior?.cleanup?.(); effects[index] = { deps, cleanup: callback() }; }); },
        commit() { pending.forEach(callback => callback()); }, unmount() { effects.forEach(effect => effect?.cleanup?.()); },
    };
}
function nodes(node, result = []) { if (Array.isArray(node)) node.forEach(child => nodes(child, result)); else if (node && typeof node === "object") { result.push(node); nodes(node.props?.children, result); } return result; }
function content(node) { return typeof node === "string" || typeof node === "number" ? String(node) : Array.isArray(node) ? node.map(content).join("") : node && typeof node === "object" ? content(node.props?.children) : ""; }
function button(tree, label) { const found = nodes(tree).find(node => node.type === "Button" && content(node) === label); assert.ok(found, `Missing button: ${label}`); return found; }
function filter(tree) { return nodes(tree).find(node => node.type === "BatteryFilterControls"); }
function nativeInput(tree) { return nodes(tree).find(node => node.type === "TeachingNfcInput"); }
const at = "2026-10-08T06:00:00.000Z";
function battery(id, overrides = {}) {
    return { id, version: 1, name: id, model: "PACK-X", chemistry: "LiPo", capacityMah: 2000, voltage: 7.4, tagId: `tag-${id}`, registeredAt: at, manufacturedOn: null, firstUsedOn: null, lifecycleStatus: "active", lifecycleAt: null, lifecycleReason: null, lifecycleDestination: null, ownerId: "staff-teacher", ownerName: "Teacher A", ownerAccountId: "teacher", homeBuildingId: "J18", homeBuildingName: "Willis Annexe", homeRoomId: null, homeRoomName: null, homeRoomNumber: null, homeRoomIsPlaceholder: null, homeRoomSelectable: null, loanId: null, borrowerId: null, borrowerName: null, borrowerAccountId: null, borrowerKind: null, checkedOutAt: null, lastCheckedOutAt: null, observedRoom: null, observedRoomId: null, observedBuilding: null, observationRoomSnapshot: null, observedAt: null, observationSource: null, chargedAt: null, chargeDurationMinutes: null, ...overrides };
}
function fixture() {
    const group = { id: crypto.randomUUID(), version: 1, name: "Class pack", notes: "", batteryIds: ["BAT-A", "BAT-B"], ownerAccountId: "teacher", state: "active", createdAt: at, updatedAt: at };
    return { dataset: "demo", actor: "Teacher A", user: { id: "teacher", role: "staff", displayName: "Teacher A", username: "teacher" }, teachingGroups: [group], batteries: [battery("BAT-A"), battery("BAT-B", { loanId: crypto.randomUUID(), borrowerAccountId: "other", borrowerId: "staff-other", borrowerKind: "staff", borrowerName: "Teacher B", checkedOutAt: at }), battery("BAT-C", { model: "OTHER", capacityMah: null, voltage: null, tagId: "nfc:uid:01020304" }), battery("BAT-D", { model: "OTHER", capacityMah: 3000 }), battery("BAT-E", { loanId: crypto.randomUUID(), borrowerAccountId: "teacher", borrowerKind: "staff" }), battery("BAT-F", { lifecycleStatus: "scrapped" })], rooms: [], buildings: [], people: [], staffDirectory: [], events: [], hardwareConnected: false };
}
function snapshot(value) { return Object.fromEntries(["name", "model", "chemistry", "capacityMah", "voltage", "tagId", "version", "homeBuildingId", "homeRoomId", "homeRoomName", "homeRoomIsPlaceholder"].map(key => [key, value[key]]).concat([["batteryId", value.id]])); }
function receipt(data, attempt) {
    const payload = attempt.payload;
    if (payload.action === "return") {
        const run = Object.fromEntries(Object.entries(attempt.reviewed.run).filter(([key]) => key !== "items"));
        return { requestId: payload.requestId, actorAccountId: data.user.id, dataset: data.dataset, action: "return", run, returnedItems: payload.items, at: "2026-10-08T06:01:00.000Z" };
    }
    const run = { id: payload.requestId, dataset: data.dataset, actorAccountId: data.user.id, actorName: "Teacher A", teachingGroup: { ...payload.teachingGroup, name: attempt.reviewed.group.name, ownerAccountId: data.user.id, operationId: payload.requestId, batteryIds: payload.mappings.map(item => item.actual.batteryId) }, requestedBatteryIds: payload.mappings.map(item => item.original.batteryId), mappings: payload.mappings.map(item => {
        const slot = attempt.reviewed.slots.find(slot => slot.originalId === item.original.batteryId);
        return { original: snapshot(slot.original), actual: snapshot(slot.actual), originalLoanId: item.originalLoanId, method: item.method, source: item.source, loanId: crypto.randomUUID(), specificationMatch: contract.teachingSpecificationsMatch(slot.original, slot.actual), differences: contract.teachingSpecificationDifferences(slot.original, slot.actual) };
    }), createdAt: at };
    return { requestId: payload.requestId, actorAccountId: data.user.id, dataset: data.dataset, action: "checkout", run, at };
}
function installEnvironment(entries, flags) {
    const window = new EventTarget();
    const sessionStorage = { getItem(key) { if (flags.read) throw new Error("Storage read unavailable"); return entries.get(key) ?? null; }, setItem(key, value) { if (flags.write) throw new Error("Storage write unavailable"); entries.set(key, value); }, removeItem(key) { if (flags.clear) throw new Error("Storage clear unavailable"); entries.delete(key); } };
    globalThis.window = window; globalThis.sessionStorage = sessionStorage;
    return { window, sessionStorage };
}
async function view({ data = fixture(), entries = new Map(), flags = {}, transport, draft } = {}) {
    const state = hooks(), sent = [], closed = [], changed = [];
    const env = installEnvironment(entries, flags);
    const fetch = async (url, options) => {
        if (!options?.body) return { ok: true, async json() { return structuredClone(data); } };
        const input = JSON.parse(options.body); sent.push(input);
        const attempt = requests.recoverTeachingCheckoutAttempt(entries.get(requests.teachingCheckoutStorageKey(data.user.id, data.dataset)), data.user.id, data.dataset);
        assert.ok(attempt, "Exact request saved before POST"); assert.ok(entries.has(drafts.teachingCheckoutDraftStorageKey(data.user.id, data.dataset)), "Full reviewed draft saved before POST");
        return transport ? transport(input, attempt, sent.length) : { ok: true, async json() { return { result: receipt(data, attempt) }; } };
    };
    const source = ts.transpileModule(await readFile("components/inventory/teaching-checkout-dialog.tsx", "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } }).outputText.replace(/^import .*;\r?\n/gm, "").replace(/^export /gm, "");
    const bindings = { ...ui, ...selection, ...requests, ...drafts, ...contract, ...filters, ...batterySelection, ...utils, ...state, inventoryResponse, ...env, fetch, styles: new Proxy({}, { get: (_, key) => String(key) }) }, names = Object.keys(bindings);
    const component = new Function(...names, "_jsx", "_jsxs", "_Fragment", `${source}\nreturn TeachingCheckoutDialog;`)(...names.map(name => bindings[name]), jsx, jsx, "Fragment");
    const props = { data, draft: draft ?? { kind: "checkout", group: data.teachingGroups[0], ids: [...data.teachingGroups[0].batteryIds], personalScope: "all" }, onClose: value => closed.push(value), onChanged: async () => changed.push(true) };
    const render = () => { state.reset(); const tree = component(props); state.commit(); return tree; };
    render(); return { render, sent, data, entries, flags, closed, changed, env, unmount: () => state.unmount() };
}
function chooseOriginal(tree, id = "BAT-B") { const select = nodes(tree).find(node => node.type === "Select" && nodes(node).some(child => child.props["aria-label"] === "Original member to replace")); select.props.onValueChange(id); }

test("missing strict alternative supports shared filters, unknown manual specifications and clear without losing the selected mapping", async () => {
    const page = await view(); await button(page.render(), "Replace unavailable batteries").props.onClick();
    assert.match(content(page.render()), /No strict automatic alternatives are available/);
    assert.doesNotMatch(content(page.render()), /Suggestions have been added/);
    assert.equal(button(page.render(), "Confirm actual checkout (1)").props.disabled, true);
    chooseOriginal(page.render()); filter(page.render()).props.onChange({ search: "BAT-C", capacityMode: "unknown" });
    button(page.render(), "Choose").props.onClick();
    assert.match(content(page.render()), /Manual alternative/); assert.match(content(page.render()), /capacityMah: unknown information/);
    filter(page.render()).props.onClear();
    assert.equal(filter(page.render()).props.filters.search, ""); assert.match(content(page.render()), /2 actual batteries selected/);
    await button(page.render(), "Confirm actual checkout (2)").props.onClick();
    assert.equal(page.sent.length, 1); assert.equal(page.sent[0].payload.mappings[1].method, "manual"); assert.equal(page.sent[0].payload.mappings[1].actual.batteryId, "BAT-C"); assert.equal(page.sent[0].payload.mappings[1].originalLoanId, page.data.batteries[1].loanId);
    assert.deepEqual(page.data.teachingGroups[0].batteryIds, ["BAT-A", "BAT-B"]); assert.equal(page.changed.length, 1); assert.equal(page.entries.size, 0);
});

test("explicit source switching clears only manual alternatives; exact tag and native evidence survive draft refresh", async () => {
    const entries = new Map(), data = fixture(), page = await view({ entries, data }); chooseOriginal(page.render()); button(page.render(), "Choose").props.onClick();
    button(page.render(), "Entered tag").props.onClick(); assert.match(content(page.render()), /Switching source clears/); assert.match(content(page.render()), /2 actual batteries selected/);
    button(page.render(), "Switch source and clear manual choices").props.onClick(); assert.match(content(page.render()), /1 actual batteries selected/);
    await nativeInput(page.render()).props.onChooseTag("nfc:uid:01020304", { kind: "tag" }); assert.match(content(page.render()), /Entered registered tag/);
    button(page.render(), "Native NFC").props.onClick(); button(page.render(), "Switch source and clear manual choices").props.onClick();
    const evidence = { attemptId: crypto.randomUUID(), source: "native-nfc-reader", platform: "android", startedAt: at, endedAt: at, adoptedAt: at, tagId: "nfc:uid:01020304", result: { uidHex: "01020304", technology: "NfcA", ndefStatus: "unknown", capacityBytes: null, records: [], observedAt: at } };
    await nativeInput(page.render()).props.onChooseTag(evidence.tagId, { kind: "native_nfc", evidence }); page.render(); page.unmount();
    const restored = await view({ entries, data }); assert.match(content(restored.render()), /Adopted native NFC reading/);
    const saved = drafts.recoverTeachingCheckoutDraft(entries.get(drafts.teachingCheckoutDraftStorageKey(data.user.id, data.dataset)), data.user.id, data.dataset);
    assert.deepEqual(saved.slots[1].source.evidence, evidence);
    await button(restored.render(), "Confirm actual checkout (2)").props.onClick(); assert.deepEqual(restored.sent[0].payload.mappings[1].source.evidence, evidence);
});

test("unknown results freeze review and the exact mapping until matching original replay, including across refresh", async () => {
    const data = fixture(), entries = new Map(); let complete = false;
    const transport = async (input, attempt) => { if (!complete) throw new Error("Lost response"); return { ok: true, async json() { return { result: receipt(data, attempt) }; } }; };
    const page = await view({ data, entries, transport }); chooseOriginal(page.render()); button(page.render(), "Choose").props.onClick(); await button(page.render(), "Confirm actual checkout (2)").props.onClick();
    const original = structuredClone(page.sent[0]); assert.equal(filter(page.render()).props.disabled, true); assert.equal(button(page.render(), "Cancel review").props.disabled, true);
    filter(page.render()).props.onClear(); page.unmount();
    const restored = await view({ data, entries, transport }); complete = true;
    await button(restored.render(), "Retry same request").props.onClick(); await new Promise(resolve => setImmediate(resolve)); assert.deepEqual(restored.sent[0], original); assert.equal(restored.changed.length, 1); assert.equal(entries.size, 0);
});

test("storage failures prevent writes, and receipt clear failure retains the exact request for replay", async () => {
    const flags = { write: true }, page = await view({ flags });
    assert.equal(button(page.render(), "Confirm actual checkout (1)").props.disabled, true); await button(page.render(), "Confirm actual checkout (1)").props.onClick(); assert.equal(page.sent.length, 0);
    flags.write = false; button(page.render(), "Retry saving this draft").props.onClick(); chooseOriginal(page.render()); button(page.render(), "Choose").props.onClick(); flags.clear = true;
    await button(page.render(), "Confirm actual checkout (2)").props.onClick(); assert.equal(page.sent.length, 1); assert.ok(button(page.render(), "Retry same request")); assert.equal(page.closed.length, 0);
    flags.clear = false; await button(page.render(), "Retry same request").props.onClick(); await new Promise(resolve => setImmediate(resolve)); assert.deepEqual(page.sent[1], page.sent[0]); assert.equal(page.entries.size, 0);
});

test("actual checkout return submits a deliberate partial subset with original loan IDs after group archive", async () => {
    const data = fixture(), slots = selection.initialTeachingSelection(data, data.teachingGroups[0], ["BAT-A"], "all");
    const payload = { action: "checkout", requestId: crypto.randomUUID(), teachingGroup: { id: data.teachingGroups[0].id, version: 1 }, personalScope: "all", mappings: slots.map(slot => ({ original: { batteryId: slot.original.id, tagId: slot.original.tagId, version: 1 }, actual: { batteryId: slot.actual.id, tagId: slot.actual.tagId, version: 1 }, originalLoanId: null, method: "original", source: { kind: "selection" } })) };
    const run = receipt(data, requests.captureTeachingCheckoutAttempt(data.user.id, data.dataset, payload, { group: data.teachingGroups[0], slots })).run;
    const second = { ...run.mappings[0], original: snapshot(data.batteries[1]), actual: snapshot(data.batteries[2]), method: "manual", loanId: crypto.randomUUID() };
    run.mappings.push(second); run.requestedBatteryIds.push("BAT-B"); run.teachingGroup.batteryIds.push("BAT-C");
    const listed = { ...run, items: run.mappings.map(mapping => ({ batteryId: mapping.actual.batteryId, loanId: mapping.loanId, status: "outstanding", tagId: mapping.actual.tagId, version: 2, returnedAt: null })) };
    data.teachingGroups = [];
    const page = await view({ data, draft: { kind: "return", run: listed, personalScope: "all" } });
    nodes(page.render()).find(node => node.type === "Checkbox" && node.props["aria-label"] === "Return BAT-C").props.onCheckedChange(false);
    await button(page.render(), "Confirm exact return (1)").props.onClick();
    assert.equal(page.sent[0].payload.items.length, 1); assert.equal(page.sent[0].payload.items[0].batteryId, "BAT-A"); assert.equal(page.sent[0].payload.items[0].loanId, listed.items[0].loanId); assert.equal(page.changed.length, 1);
});

test("manual tag lookup rejects duplicate and unavailable candidates without replacing an earlier reviewed slot", async () => {
    const data = fixture(), second = battery("BAT-B2", { loanId: crypto.randomUUID(), borrowerAccountId: "other", borrowerKind: "staff" });
    data.batteries.push(second); data.teachingGroups[0].batteryIds.push(second.id);
    const page = await view({ data }); chooseOriginal(page.render()); button(page.render(), "Entered tag").props.onClick();
    nativeInput(page.render()).props.onChooseTag("nfc:uid:01020304", { kind: "tag" }); page.render(); chooseOriginal(page.render(), second.id);
    assert.throws(() => nativeInput(page.render()).props.onChooseTag("nfc:uid:01020304", { kind: "tag" }), /unavailable, already selected/);
    assert.throws(() => nativeInput(page.render()).props.onChooseTag("tag-BAT-E", { kind: "tag" }), /unavailable, already selected/);
    assert.throws(() => nativeInput(page.render()).props.onChooseTag("unknown-tag", { kind: "tag" }), /not registered in this inventory/);
    assert.match(content(page.render()), /2 actual batteries selected/); assert.equal(page.sent.length, 0);
});

test("a transient invalid shared filter range is editable and does not discard the reviewed manual alternative", async () => {
    const page = await view(); chooseOriginal(page.render()); button(page.render(), "Choose").props.onClick();
    filter(page.render()).props.onChange({ capacityMinMah: 3000, capacityMaxMah: 1000 });
    assert.match(content(page.render()), /maximum must be at least the minimum/); assert.equal(filter(page.render()).props.disabled, false);
    filter(page.render()).props.onClear(); assert.match(content(page.render()), /2 actual batteries selected/);
    await button(page.render(), "Confirm actual checkout (2)").props.onClick(); assert.equal(page.sent.length, 1);
});

test("a corrupted captured review is blocked before retry and is retained for investigation", async () => {
    const entries = new Map(), data = fixture(), page = await view({ data, entries, transport: async () => { throw new Error("Lost response"); } });
    chooseOriginal(page.render()); button(page.render(), "Choose").props.onClick(); await button(page.render(), "Confirm actual checkout (2)").props.onClick(); page.unmount();
    const key = requests.teachingCheckoutStorageKey(data.user.id, data.dataset), captured = JSON.parse(entries.get(key));
    captured.reviewed.slots[1].actual.tagId = "changed-evidence-tag"; entries.set(key, JSON.stringify(captured));
    const recovered = await view({ data, entries }); assert.match(content(recovered.render()), /preserved request and its displayed review do not match/i); assert.equal(button(recovered.render(), "Cancel review").props.disabled, true);
    assert.equal(button(recovered.render(), "Confirm actual checkout (1)").props.disabled, true); assert.equal(recovered.sent.length, 0); assert.equal(JSON.parse(entries.get(key)).reviewed.slots[1].actual.tagId, "changed-evidence-tag");
});

test("including an excluded tag alternative after switching source requires an explicit compatible source", async () => {
    const page = await view(); chooseOriginal(page.render()); button(page.render(), "Entered tag").props.onClick(); nativeInput(page.render()).props.onChooseTag("nfc:uid:01020304", { kind: "tag" });
    const originalSlot = () => nodes(page.render()).find(node => node.type === "article" && node.key === "BAT-B");
    button(originalSlot(), "Exclude from this checkout").props.onClick(); button(page.render(), "Inventory selection").props.onClick();
    button(originalSlot(), "Include this member").props.onClick();
    assert.match(content(page.render()), /excluded alternative uses a different input source/); assert.match(content(page.render()), /1 actual batteries selected/); assert.equal(filter(page.render()).props.disabled, false);
    button(page.render(), "Entered tag").props.onClick(); button(originalSlot(), "Include this member").props.onClick();
    assert.equal(filter(page.render()).props.disabled, false); assert.match(content(page.render()), /2 actual batteries selected/);
    await button(page.render(), "Confirm actual checkout (2)").props.onClick(); assert.equal(page.sent[0].payload.mappings[1].source.kind, "tag");
});

test("an excluded alternative can be deliberately chosen again from a new source without silently including its old mapping", async () => {
    const page = await view(); chooseOriginal(page.render()); button(page.render(), "Entered tag").props.onClick(); nativeInput(page.render()).props.onChooseTag("nfc:uid:01020304", { kind: "tag" });
    const originalSlot = () => nodes(page.render()).find(node => node.type === "article" && node.key === "BAT-B");
    button(originalSlot(), "Exclude from this checkout").props.onClick(); button(page.render(), "Inventory selection").props.onClick(); button(originalSlot(), "Choose manual alternative").props.onClick();
    assert.match(content(page.render()), /1 actual batteries selected/); assert.equal(filter(page.render()).props.disabled, false);
    button(page.render(), "Choose").props.onClick(); assert.match(content(page.render()), /2 actual batteries selected/); assert.equal(filter(page.render()).props.disabled, false);
    await button(page.render(), "Confirm actual checkout (2)").props.onClick(); assert.equal(page.sent[0].payload.mappings[1].source.kind, "selection");
});

test("automatic suggestion feedback reports the number of alternatives actually added", async () => {
    const data = fixture(); Object.assign(data.batteries[2], { model: "PACK-X", capacityMah: 2000, voltage: 7.4 });
    const page = await view({ data }); button(page.render(), "Replace unavailable batteries").props.onClick();
    assert.match(content(page.render()), /1 automatic alternative added to the review list/); assert.equal(button(page.render(), "Confirm actual checkout (2)").props.disabled, false);
});
