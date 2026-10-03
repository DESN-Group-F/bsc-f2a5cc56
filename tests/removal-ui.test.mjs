import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

// Exercise the actual component handlers with controlled hooks and exact-request
// recovery. This is not browser focus, RFID or stakeholder-efficiency evidence.
const scratchRoot = new URL("../work/qa/", import.meta.url);
await mkdir(scratchRoot, { recursive: true });
const scratch = await mkdtemp(join(fileURLToPath(scratchRoot), "removal-ui-"));
for (const name of ["teaching-context", "battery-age", "domain", "location-catalog", "client-utils", "lifecycle-session", "removal-draft"]) {
    const source = await readFile(new URL(`../lib/${name}.ts`, import.meta.url), "utf8");
    const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText.replace(/from "(\.\/[^\"]+)"/g, (_, specifier) => `from "${specifier}.mjs"`);
    await writeFile(join(scratch, `${name}.mjs`), compiled);
}
const [lifecycle, client, removalDraft] = await Promise.all(["lifecycle-session", "client-utils", "removal-draft"].map(name => import(pathToFileURL(join(scratch, `${name}.mjs`)))));
const source = await readFile(new URL("../components/inventory/removal-station.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } }).outputText.replace(/^import .*;\r?\n/gm, "").replace(/^export /gm, "");
const ui = Object.fromEntries(["CheckCircle2", "LogOut", "ScanLine", "Trash2", "Button", "Checkbox", "Input", "Label", "Textarea", "Select", "SelectContent", "SelectItem", "SelectTrigger", "SelectValue", "Table", "TableBody", "TableCell", "TableHead", "TableHeader", "TableRow"].map(name => [name, name]));
const jsx = (type, props, key) => ({ type, props: props ?? {}, key });
function hooks() {
    const state = [], effects = [];
    let pointer = 0, effectPointer = 0, scheduled = [];
    return {
        reset() { pointer = 0; effectPointer = 0; scheduled = []; },
        useState(initial) { const index = pointer++; if (!(index in state)) state[index] = typeof initial === "function" ? initial() : initial; return [state[index], update => { state[index] = typeof update === "function" ? update(state[index]) : update; }]; },
        useRef(initial) { const index = pointer++; if (!(index in state)) state[index] = { current: initial }; return state[index]; },
        useEffect(callback, dependencies) { const index = effectPointer++, prior = effects[index]; if (!prior || !dependencies || dependencies.some((value, key) => !Object.is(value, prior.dependencies?.[key]))) scheduled.push(() => { prior?.cleanup?.(); effects[index] = { dependencies, cleanup: callback() }; }); },
        commit() { for (const callback of scheduled) callback(); },
        unmount() { for (const effect of effects) effect?.cleanup?.(); },
    };
}
function nodes(node, results = []) { if (Array.isArray(node)) for (const item of node) nodes(item, results); else if (node && typeof node === "object") { results.push(node); nodes(node.props?.children, results); } return results; }
function text(node) { if (typeof node === "string" || typeof node === "number") return String(node); if (Array.isArray(node)) return node.map(text).join(""); return node && typeof node === "object" ? text(node.props?.children) : ""; }
function button(tree, label) { return nodes(tree).find(node => node.type === "Button" && text(node) === label); }
function control(tree, id) { return nodes(tree).find(node => node.props?.id === id && ["Input", "Textarea", "Checkbox"].includes(node.type)); }
function battery(id, overrides = {}) {
    return { id, name: `Battery ${id}`, model: "PACK-MODEL", ownerName: "Staff owner", version: 3, tagId: `TAG-${id}`, loanId: null, lifecycleStatus: "active", lifecycleAt: null, lifecycleReason: null, lifecycleDestination: null, ...overrides };
}
function fixture(dataset = "live", role = "staff") {
    return { dataset, user: { id: "removal-native-actor", username: "operator", role }, batteries: [battery("BAT-A"), battery("BAT-B", { tagId: null }), battery("BAT-LOAN", { loanId: "active-loan" }), battery("BAT-SCRAPPED", { lifecycleStatus: "scrapped", lifecycleAt: "2026-10-03T03:00:00.000Z", lifecycleReason: "Damaged pack" }), battery("BAT-REMOVED", { lifecycleStatus: "permanently_removed", lifecycleAt: "2026-10-03T04:00:00.000Z", lifecycleReason: "Transferred", lifecycleDestination: "Receiving laboratory" })] };
}
function receipt(payload, overrides = {}) {
    return { requestId: payload.requestId, dataset: "live", actorAccountId: "removal-native-actor", kind: payload.kind, reason: payload.reason, destination: payload.destination, source: payload.source, at: "2026-10-03T05:00:00.000Z", replayed: false, items: payload.items.map(item => ({ ...item, version: item.version + 1, status: payload.kind })), ...overrides };
}
async function environment(run, seed = []) {
    const saved = Object.fromEntries(["sessionStorage", "window"].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
    const entries = new Map(seed), storage = { failReads: false, failWrites: false, failRemoval: false, blockedReadKey: null, blockedWriteKey: null };
    Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: { getItem: key => { if (storage.failReads || storage.blockedReadKey === key) throw new Error("Storage unavailable"); return entries.get(key) ?? null; }, setItem: (key, value) => { if (storage.failWrites || storage.blockedWriteKey === key) throw new Error("Storage unavailable"); entries.set(key, value); }, removeItem: key => { if (storage.failRemoval) throw new Error("Storage unavailable"); entries.delete(key); } } });
    Object.defineProperty(globalThis, "window", { configurable: true, value: { addEventListener() {}, removeEventListener() {} } });
    try { await run({ entries, storage }); } finally { for (const [name, descriptor] of Object.entries(saved)) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); } }
}
function mount(overrides = {}, component = "RemovalStation") {
    const state = hooks(), writes = [], changes = [], details = [], locks = [], downloads = [];
    const bindings = { ...ui, ...lifecycle, ...client, ...removalDraft, ...state }, names = Object.keys(bindings);
    const Component = new Function(...names, "_jsx", "_jsxs", "_Fragment", `${compiled}\nreturn ${component};`)(...names.map(name => bindings[name]), jsx, jsx, "Fragment");
    const props = { data: fixture(), onChanged: () => changes.push(true), onDetail: id => details.push(id), onBusyChange: locked => locks.push(locked), onDownload: ids => downloads.push(ids), async write(action, payload) { writes.push({ action, payload: structuredClone(payload) }); return receipt(payload, { dataset: props.data.dataset }); }, ...overrides };
    return { props, writes, changes, details, locks, downloads, render() { state.reset(); const tree = Component(props); state.commit(); return tree; }, unmount: state.unmount };
}
function pendingValues(entries) { return [...entries].filter(([key]) => key.startsWith("battery-lifecycle:")).map(([, value]) => value); }
function savedDraft(entries, dataset = "live") { return JSON.parse(entries.get(removalDraft.removalDraftStorageKey("removal-native-actor", dataset))); }
function queue(view, id) { nodes(view.render()).find(node => node.type === "Button" && node.props["aria-label"] === `Queue ${id}`).props.onClick(); }
function reason(view, value = "Retired after staff review") { control(view.render(), "removal-reason").props.onChange({ target: { value } }); }
function setTag(view, value) { control(view.render(), "removal-tag").props.onChange({ target: { value } }); }

test("returning to inventory preserves the removal draft and blocks exit during unknown confirmation or storage recovery", async () => {
    await environment(async ({ entries }) => {
        let exits = 0; const view = mount({ onExit: () => exits++ }); queue(view, "BAT-A"); reason(view, "Optional reviewed note");
        const before = savedDraft(entries); assert.equal(button(view.render(), "Back to inventory").props.disabled, false); button(view.render(), "Back to inventory").props.onClick();
        assert.equal(exits, 1); assert.deepEqual(savedDraft(entries), before); assert.equal(view.writes.length, 0); view.unmount();
    });
    await environment(async ({ entries }) => {
        let exits = 0; const view = mount({ onExit: () => exits++, async write() { throw new Error("Response lost"); } }); queue(view, "BAT-A");
        await button(view.render(), "Confirm all queued").props.onClick(); const before = pendingValues(entries);
        assert.equal(button(view.render(), "Back to inventory").props.disabled, true); button(view.render(), "Back to inventory").props.onClick();
        assert.equal(exits, 0); assert.deepEqual(pendingValues(entries), before); view.unmount();
    });
    await environment(async ({ storage }) => {
        let exits = 0; const view = mount({ onExit: () => exits++ }); storage.failWrites = true; queue(view, "BAT-A");
        assert.equal(button(view.render(), "Back to inventory").props.disabled, true); button(view.render(), "Back to inventory").props.onClick(); assert.equal(exits, 0); view.unmount();
    });
});

test("staff and administrators in both inventories can queue whole battery choices and confirm selected or all while preserving other queue items", async () => {
    for (const dataset of ["live", "demo"]) for (const role of ["staff", "admin"]) await environment(async ({ entries }) => {
        const view = mount({ data: fixture(dataset, role) }); queue(view, "BAT-A"); queue(view, "BAT-B"); reason(view, "  Retired after staff review  ");
        control(view.render(), "removal-queued-BAT-B").props.onCheckedChange(false);
        await button(view.render(), "Confirm selected").props.onClick();
        assert.equal(view.writes.length, 1); assert.equal(view.writes[0].action, "lifecycle");
        assert.deepEqual(view.writes[0].payload.items, [{ batteryId: "BAT-A", version: 3, tagId: "TAG-BAT-A" }]);
        assert.equal(view.writes[0].payload.source, "manual_selection"); assert.equal(view.writes[0].payload.reason, "Retired after staff review"); assert.equal(view.writes[0].payload.destination, null);
        assert.ok(control(view.render(), "removal-queued-BAT-B")); assert.equal(control(view.render(), "removal-queued-BAT-A"), undefined);
        assert.equal(button(view.render(), "Tag entry").props.disabled, true); assert.equal(pendingValues(entries).length, 0);
        await button(view.render(), "Confirm all queued").props.onClick();
        assert.deepEqual(view.writes[1].payload.items, [{ batteryId: "BAT-B", version: 3, tagId: null }]); assert.notEqual(view.writes[0].payload.requestId, view.writes[1].payload.requestId);
        assert.equal(view.changes.length, 2); assert.equal(control(view.render(), "removal-queued-BAT-B"), undefined); assert.ok(text(view.render()).includes("Recorded this session")); view.unmount();
    });
});

test("tag entry queues exact registered active tags, refuses loans and unknowns, and records permanent-removal destination without mixing sources", async () => {
    await environment(async () => {
        const view = mount();
        assert.equal(nodes(view.render()).some(node => node.props?.["aria-label"] === "Queue BAT-LOAN"), false);
        assert.equal(nodes(view.render()).some(node => node.props?.["aria-label"] === "Queue BAT-SCRAPPED"), false);
        button(view.render(), "Tag entry").props.onClick();
        setTag(view, "UNKNOWN"); button(view.render(), "Add tag to queue").props.onClick(); assert.ok(text(view.render()).includes("exactly one registered battery"));
        setTag(view, "TAG-BAT-LOAN"); button(view.render(), "Add tag to queue").props.onClick(); assert.ok(text(view.render()).includes("Return a borrowed battery first"));
        setTag(view, " TAG-BAT-A "); control(view.render(), "removal-tag").props.onKeyDown({ key: "Enter", preventDefault() {} });
        button(view.render(), "Manual selection").props.onClick();
        assert.ok(control(view.render(), "removal-tag")); assert.ok(control(view.render(), "removal-queued-BAT-A"));
        nodes(view.render()).find(node => node.type === "Select").props.onValueChange("permanently_removed"); reason(view, "Transfer of inventory"); control(view.render(), "removal-destination").props.onChange({ target: { value: "  Receiving laboratory  " } });
        await button(view.render(), "Confirm all queued").props.onClick();
        assert.equal(view.writes[0].payload.source, "tag_entry"); assert.equal(view.writes[0].payload.kind, "permanently_removed"); assert.equal(view.writes[0].payload.destination, "Receiving laboratory"); assert.equal(view.writes[0].payload.items[0].tagId, "TAG-BAT-A"); view.unmount();
    });
});

test("changed version, tag or loan prevent fresh confirmation even when the optional reason is blank", async () => {
    for (const change of [{ version: 4 }, { tagId: "REASSIGNED-TAG" }, { loanId: "new-loan" }, { lifecycleStatus: "scrapped" }]) await environment(async () => {
        const view = mount(); queue(view, "BAT-A");
        assert.equal(control(view.render(), "removal-reason").props.value, "");
        assert.equal(button(view.render(), "Confirm selected").props.disabled, false);
        view.props.data = { ...view.props.data, batteries: view.props.data.batteries.map(item => item.id === "BAT-A" ? { ...item, ...change } : item) };
        await button(view.render(), "Confirm selected").props.onClick(); assert.equal(view.writes.length, 0);
        assert.ok(text(view.render()).includes("Remove that queue item")); assert.ok(text(view.render()).includes("Reviewed version 3")); view.unmount();
    });
});

test("empty and whitespace-only reasons permit selected or whole-queue batches without submitting unselected batteries", async () => {
    for (const scenario of [
        { reason: "", kind: "scrapped", selected: true },
        { reason: " \t  ", kind: "permanently_removed", selected: true },
        { reason: "", kind: "permanently_removed", selected: false },
        { reason: " \n ", kind: "scrapped", selected: false },
    ]) await environment(async ({ entries }) => {
        const view = mount({ data: { ...fixture(), batteries: [...fixture().batteries, battery("BAT-C")] } });
        queue(view, "BAT-A"); queue(view, "BAT-B"); queue(view, "BAT-C");
        nodes(view.render()).find(node => node.type === "Select").props.onValueChange(scenario.kind);
        reason(view, scenario.reason); control(view.render(), "removal-queued-BAT-B").props.onCheckedChange(false);
        assert.equal(view.writes.length, 0);
        assert.equal(control(view.render(), "removal-reason").props.required, undefined);
        assert.equal(text(nodes(view.render()).find(node => node.type === "Label" && node.props.htmlFor === "removal-reason")), "Reason — optional");
        assert.equal(button(view.render(), "Confirm selected").props.disabled, false);
        assert.equal(button(view.render(), "Confirm all queued").props.disabled, false);
        await button(view.render(), scenario.selected ? "Confirm selected" : "Confirm all queued").props.onClick();
        assert.equal(view.writes.length, 1);
        const payload = view.writes[0].payload;
        assert.equal(payload.reason, ""); assert.equal(payload.kind, scenario.kind); assert.equal(payload.destination, null);
        assert.deepEqual(payload.items.map(item => item.batteryId), scenario.selected ? ["BAT-A", "BAT-C"] : ["BAT-A", "BAT-B", "BAT-C"]);
        assert.equal(pendingValues(entries).length, 0);
        assert.equal(view.changes.length, 1);
        assert.ok(text(view.render()).includes("Recorded this session"));
        if (scenario.selected) {
            assert.equal(control(view.render(), "removal-queued-BAT-B").props.checked, false);
            assert.deepEqual(savedDraft(entries).items.map(item => item.batteryId), ["BAT-B"]);
            await button(view.render(), "Confirm all queued").props.onClick();
            assert.deepEqual(view.writes[1].payload.items.map(item => item.batteryId), ["BAT-B"]);
            assert.equal(view.writes[1].payload.reason, "");
        }
        assert.equal(savedDraft(entries).items.length, 0); view.unmount();
    });
});

test("unknown and authorization outcomes keep the same immutable request and disable edits until its original receipt returns", async () => {
    const writes = [];
    await environment(async ({ entries }) => {
        const view = mount({ async write(action, payload) { writes.push(structuredClone(payload)); if (writes.length === 1) throw new Error("Connection interrupted"); if (writes.length === 2) throw Object.assign(new Error("Sign in again"), { status: 401 }); if (writes.length === 3) throw Object.assign(new Error("Conflict without final reservation"), { status: 409 }); return receipt(payload, { replayed: true }); } });
        queue(view, "BAT-A"); reason(view); await button(view.render(), "Confirm selected").props.onClick(); const saved = pendingValues(entries)[0];
        assert.equal(button(view.render(), "Clear queue").props.disabled, true); assert.equal(control(view.render(), "removal-reason").props.disabled, true);
        control(view.render(), "removal-reason").props.onChange({ target: { value: "Changed after submission" } }); button(view.render(), "Clear queue").props.onClick();
        assert.equal(control(view.render(), "removal-reason").props.value, "Retired after staff review");
        await button(view.render(), "Retry exact removal").props.onClick(); assert.equal(pendingValues(entries)[0], saved);
        await button(view.render(), "Retry exact removal").props.onClick(); assert.equal(pendingValues(entries)[0], saved);
        await button(view.render(), "Retry exact removal").props.onClick();
        assert.equal(new Set(writes.map(payload => JSON.stringify(payload))).size, 1); assert.equal(pendingValues(entries).length, 0); assert.ok(text(view.render()).includes("Saved result recovered")); view.unmount();
    });
});

test("a verified final rejection preserves the editable queue and requires a new request ID for a later review", async () => {
    const requests = [];
    await environment(async ({ entries }) => {
        const view = mount({ async write(action, payload) { requests.push(payload); if (requests.length === 1) throw Object.assign(new Error("Reviewed asset changed"), { status: 409, code: "lifecycle_rejected_final" }); return receipt(payload); } });
        queue(view, "BAT-A"); reason(view); await button(view.render(), "Confirm selected").props.onClick();
        assert.equal(pendingValues(entries).length, 0); assert.equal(button(view.render(), "Retry exact removal"), undefined); assert.ok(control(view.render(), "removal-queued-BAT-A")); assert.equal(control(view.render(), "removal-reason").props.disabled, false);
        await button(view.render(), "Confirm selected").props.onClick(); assert.notEqual(requests[0].requestId, requests[1].requestId); view.unmount();
    });
});

test("forged identity, scope or asset receipts never show removal success and retain the exact request", async () => {
    for (const alter of [value => ({ ...value, actorAccountId: "another-actor" }), value => ({ ...value, dataset: "demo" }), value => ({ ...value, source: "tag_entry" }), value => ({ ...value, items: value.items.map(item => ({ ...item, version: 99 })) }), value => ({ ...value, items: [...value.items].reverse() })]) await environment(async ({ entries }) => {
        const view = mount({ async write(action, payload) { return alter(receipt(payload)); } }); queue(view, "BAT-A"); queue(view, "BAT-B"); reason(view); await button(view.render(), "Confirm all queued").props.onClick();
        assert.equal(pendingValues(entries).length, 1); assert.ok(button(view.render(), "Retry exact removal")); assert.equal(text(view.render()).includes("Recorded this session"), false); assert.equal(view.changes.length, 0); view.unmount();
    });
});

test("same-tab recovery retains bindings while foreign recovery and changed account or inventory block writes", async () => {
    await environment(async ({ entries }) => {
        const original = mount({ async write() { throw new Error("Unknown outcome"); } }); queue(original, "BAT-A"); reason(original); await button(original.render(), "Confirm selected").props.onClick(); const saved = JSON.parse(pendingValues(entries)[0]); original.unmount();
        const resumed = mount(); assert.ok(button(resumed.render(), "Retry exact removal")); resumed.props.data = { ...resumed.props.data, dataset: "demo" };
        assert.equal(button(resumed.render(), "Retry exact removal").props.disabled, true); await button(resumed.render(), "Retry exact removal").props.onClick(); assert.equal(resumed.writes.length, 0); resumed.unmount();
        const exact = mount({ data: { ...fixture(), batteries: fixture().batteries.map(item => item.id === "BAT-A" ? { ...item, version: 4, lifecycleStatus: "scrapped" } : item) } }); await button(exact.render(), "Retry exact removal").props.onClick(); assert.deepEqual(exact.writes[0].payload, saved.payload); assert.equal(pendingValues(entries).length, 0); exact.unmount();
        entries.set(lifecycle.lifecycleStorageKey("removal-native-actor", "live"), JSON.stringify({ ...saved, actorAccountId: "foreign-native-account" }));
        const foreign = mount(); assert.ok(text(foreign.render()).includes("could not be recovered")); assert.equal(button(foreign.render(), "Confirm selected").props.disabled, true); assert.equal(foreign.writes.length, 0); foreign.unmount();
    });
});

test("storage failure with an optional blank reason sends no batch before restoration and preserves the unconfirmed remainder", async () => {
    await environment(async ({ entries, storage }) => {
        const view = mount({ data: { ...fixture(), batteries: [...fixture().batteries, battery("BAT-C")] } }); queue(view, "BAT-A"); queue(view, "BAT-B"); queue(view, "BAT-C"); control(view.render(), "removal-queued-BAT-B").props.onCheckedChange(false); storage.failWrites = true;
        await button(view.render(), "Confirm selected").props.onClick(); assert.equal(view.writes.length, 0); assert.equal(pendingValues(entries).length, 0); assert.equal(button(view.render(), "Clear queue").props.disabled, true);
        button(view.render(), "Clear queue").props.onClick(); storage.failWrites = false; button(view.render(), "Restore request recovery").props.onClick();
        const saved = JSON.parse(pendingValues(entries)[0]); assert.equal(saved.payload.reason, ""); assert.deepEqual(saved.payload.items.map(item => item.batteryId), ["BAT-A", "BAT-C"]); await button(view.render(), "Retry exact removal").props.onClick();
        assert.deepEqual(view.writes[0].payload, saved.payload); assert.ok(control(view.render(), "removal-queued-BAT-B")); assert.equal(control(view.render(), "removal-queued-BAT-A"), undefined); assert.equal(control(view.render(), "removal-queued-BAT-C"), undefined); assert.equal(pendingValues(entries).length, 0); view.unmount();
    });
});

test("empty-reason batch recovery retries the same request and accepts only its matching empty-reason receipt", async () => {
    await environment(async ({ entries }) => {
        const data = { ...fixture(), batteries: [...fixture().batteries, battery("BAT-C")] };
        const original = mount({ data, async write() { throw new Error("The batch result was lost"); } });
        queue(original, "BAT-A"); queue(original, "BAT-B"); queue(original, "BAT-C"); reason(original, " \t ");
        control(original.render(), "removal-queued-BAT-B").props.onCheckedChange(false);
        await button(original.render(), "Confirm selected").props.onClick();
        const raw = pendingValues(entries)[0], exact = JSON.parse(raw); assert.equal(exact.payload.reason, ""); original.unmount();
        const writes = [], recovered = mount({ data, async write(action, payload) { writes.push(structuredClone(payload)); return receipt(payload, { reason: writes.length === 1 ? "An invented reason" : "", replayed: true }); } });
        assert.equal(control(recovered.render(), "removal-reason").props.value, "");
        assert.equal(control(recovered.render(), "removal-reason").props.disabled, true);
        assert.equal(recovered.writes.length, 0);
        await button(recovered.render(), "Retry exact removal").props.onClick();
        assert.equal(pendingValues(entries)[0], raw); assert.ok(button(recovered.render(), "Retry exact removal"));
        assert.equal(text(recovered.render()).includes("Recorded this session"), false);
        await button(recovered.render(), "Retry exact removal").props.onClick();
        assert.equal(writes.length, 2); assert.deepEqual(writes[0], exact.payload); assert.deepEqual(writes[1], exact.payload);
        assert.equal(pendingValues(entries).length, 0); assert.ok(text(recovered.render()).includes("Saved result recovered"));
        assert.deepEqual(savedDraft(entries).items.map(item => item.batteryId), ["BAT-B"]);
        assert.equal(control(recovered.render(), "removal-queued-BAT-B").props.checked, false);
        assert.equal(nodes(recovered.render()).filter(node => node.type === "TableRow" && text(node).includes("BAT-A")).length, 1);
        assert.equal(nodes(recovered.render()).filter(node => node.type === "TableRow" && text(node).includes("BAT-C")).length, 1); recovered.unmount();
    });
});

test("an unreadable recovery store fails closed even when writes work and reopening recovers the original unknown request", async () => {
    await environment(async ({ entries, storage }) => {
        const saved = lifecycle.captureLifecycleAttempt("removal-native-actor", "live", { requestId: crypto.randomUUID(), kind: "scrapped", reason: "Original review", destination: null, source: "manual_selection", items: [{ batteryId: "BAT-A", version: 3, tagId: "TAG-BAT-A" }] });
        const key = lifecycle.lifecycleStorageKey("removal-native-actor", "live"), raw = JSON.stringify(saved); entries.set(key, raw); storage.failReads = true;
        const blocked = mount(); assert.ok(text(blocked.render()).includes("could not read its saved removal request"));
        assert.equal(nodes(blocked.render()).find(node => node.props?.["aria-label"] === "Queue BAT-B").props.disabled, true);
        queue(blocked, "BAT-B"); reason(blocked, "Replace the original request"); await button(blocked.render(), "Confirm selected").props.onClick();
        assert.equal(blocked.writes.length, 0); assert.equal(entries.get(key), raw); assert.equal(blocked.locks.at(-1), true);
        storage.failReads = false; queue(blocked, "BAT-B"); assert.equal(entries.get(key), raw); blocked.unmount();
        const reopened = mount(); assert.ok(button(reopened.render(), "Retry exact removal")); await button(reopened.render(), "Retry exact removal").props.onClick();
        assert.deepEqual(reopened.writes[0].payload, saved.payload); assert.equal(pendingValues(entries).length, 0); reopened.unmount();
    });
});

test("a storage-clear failure safely replays the verified result without duplicating the session receipt", async () => {
    await environment(async ({ storage, entries }) => {
        const view = mount(); queue(view, "BAT-A"); reason(view); storage.failRemoval = true; await button(view.render(), "Confirm selected").props.onClick();
        assert.equal(pendingValues(entries).length, 1); assert.ok(text(view.render()).includes("Recorded this session")); assert.ok(button(view.render(), "Retry exact removal"));
        storage.failRemoval = false; button(view.render(), "Restore request recovery").props.onClick(); await button(view.render(), "Retry exact removal").props.onClick();
        assert.equal(view.writes.length, 2); assert.deepEqual(view.writes[0].payload, view.writes[1].payload); assert.equal(pendingValues(entries).length, 0);
        assert.equal(nodes(view.render()).filter(node => node.type === "TableRow" && text(node).includes("BAT-A")).length, 1); view.unmount();
    });
});

test("rapid confirmation sends one request and a delayed old response cannot erase a newer station request", async () => {
    let release;
    await environment(async ({ entries }) => {
        const view = mount({ write(action, payload) { view.writes.push({ action, payload }); return new Promise(resolve => { release = () => resolve(receipt(payload)); }); } }); queue(view, "BAT-A"); reason(view);
        const confirm = button(view.render(), "Confirm selected").props.onClick, inFlight = confirm(); await confirm(); assert.equal(view.writes.length, 1);
        const previous = JSON.parse(pendingValues(entries)[0]); view.unmount(); const newer = { ...previous, payload: { ...previous.payload, requestId: crypto.randomUUID() } }; entries.set(lifecycle.lifecycleStorageKey("removal-native-actor", "live"), JSON.stringify(newer));
        release(); await inFlight; assert.equal(JSON.parse(pendingValues(entries)[0]).payload.requestId, newer.payload.requestId); assert.equal(view.changes.length, 0);
    });
});

test("the queue supports at most 100 reviewed assets without selecting a hidden 101st asset", async () => {
    await environment(async () => {
        const view = mount({ data: { ...fixture(), batteries: Array.from({ length: 101 }, (_, index) => battery(`BAT-${index}`)) } });
        for (let index = 0; index < 100; index++) queue(view, `BAT-${index}`);
        const last = nodes(view.render()).find(node => node.props?.["aria-label"] === "Queue BAT-100"); assert.equal(last.props.disabled, true); last.props.onClick(); reason(view);
        assert.ok(text(view.render()).includes("up to 100 batteries")); await button(view.render(), "Confirm all queued").props.onClick(); assert.equal(view.writes[0].payload.items.length, 100); assert.equal(view.writes[0].payload.items.some(item => item.batteryId === "BAT-100"), false); view.unmount();
    });
});

test("unposted queue, selections, source and removal settings survive navigation and reload in their original inventory only", async () => {
    await environment(async ({ entries }) => {
        const original = mount(); queue(original, "BAT-A"); queue(original, "BAT-B");
        nodes(original.render()).find(node => node.type === "Select").props.onValueChange("permanently_removed"); reason(original, "Transfer after approval");
        control(original.render(), "removal-destination").props.onChange({ target: { value: "Receiving workshop" } }); control(original.render(), "removal-queued-BAT-B").props.onCheckedChange(false);
        const saved = savedDraft(entries); original.unmount();
        const reopened = mount(); assert.ok(control(reopened.render(), "removal-queued-BAT-A")); assert.equal(control(reopened.render(), "removal-queued-BAT-B").props.checked, false);
        assert.equal(control(reopened.render(), "removal-reason").props.value, "Transfer after approval"); assert.equal(control(reopened.render(), "removal-destination").props.value, "Receiving workshop");
        assert.equal(nodes(reopened.render()).find(node => node.type === "Select").props.value, "permanently_removed"); assert.equal(reopened.writes.length, 0);
        await button(reopened.render(), "Confirm selected").props.onClick(); assert.equal(reopened.writes[0].payload.items.length, 1); assert.equal(reopened.writes[0].payload.items[0].batteryId, "BAT-A");
        assert.deepEqual(savedDraft(entries).items, saved.items.filter(item => item.batteryId === "BAT-B")); assert.deepEqual(savedDraft(entries).selectedIds, []); reopened.unmount();
        const remaining = mount(); assert.equal(control(remaining.render(), "removal-queued-BAT-A"), undefined); assert.equal(control(remaining.render(), "removal-queued-BAT-B").props.checked, false); assert.equal(remaining.writes.length, 0); remaining.unmount();
        const otherInventory = mount({ data: fixture("demo") }); assert.equal(control(otherInventory.render(), "removal-queued-BAT-B"), undefined); assert.equal(control(otherInventory.render(), "removal-reason").props.value, ""); otherInventory.unmount();
        const otherAccount = mount({ data: { ...fixture(), user: { ...fixture().user, id: "another-native-account" } } }); assert.equal(control(otherAccount.render(), "removal-queued-BAT-B"), undefined); otherAccount.unmount();
    });
});

test("exact pending removal takes priority over drifted draft settings and bindings while retaining other unposted assets", async () => {
    await environment(async ({ entries }) => {
        const original = mount({ async write() { throw new Error("Lost original result"); } }); queue(original, "BAT-A"); queue(original, "BAT-B"); reason(original, "Original reviewed reason"); control(original.render(), "removal-queued-BAT-B").props.onCheckedChange(false);
        await button(original.render(), "Confirm selected").props.onClick(); const exact = JSON.parse(pendingValues(entries)[0]); original.unmount();
        const drifted = savedDraft(entries); drifted.kind = "permanently_removed"; drifted.reason = "A later draft reason"; drifted.destination = "Other destination"; drifted.selectedIds = []; drifted.items = drifted.items.map(item => item.batteryId === "BAT-A" ? { ...item, version: 99, tagId: "CHANGED-TAG" } : item);
        entries.set(removalDraft.removalDraftStorageKey("removal-native-actor", "live"), JSON.stringify(drifted));
        const recovered = mount(); assert.equal(control(recovered.render(), "removal-reason").props.value, exact.payload.reason); assert.equal(nodes(recovered.render()).find(node => node.type === "Select").props.value, "scrapped"); assert.ok(text(recovered.render()).includes("Reviewed version 3 · TAG-BAT-A"));
        assert.equal(control(recovered.render(), "removal-queued-BAT-B").props.checked, false); await button(recovered.render(), "Retry exact removal").props.onClick();
        assert.deepEqual(recovered.writes[0].payload, exact.payload); assert.deepEqual(savedDraft(entries).items.map(item => item.batteryId), ["BAT-B"]); assert.deepEqual(savedDraft(entries).selectedIds, []); assert.equal(savedDraft(entries).reason, exact.payload.reason); recovered.unmount();
    });
});

test("a persisted tag-entry draft reopens with its original input source and can switch sources only after its queue is cleared", async () => {
    await environment(async ({ entries }) => {
        const original = mount(); button(original.render(), "Tag entry").props.onClick(); setTag(original, "TAG-BAT-A"); button(original.render(), "Add tag to queue").props.onClick(); reason(original); original.unmount();
        const reopened = mount(); assert.ok(control(reopened.render(), "removal-tag")); assert.equal(savedDraft(entries).source, "tag_entry"); assert.equal(button(reopened.render(), "Manual selection").props.disabled, true); assert.equal(reopened.writes.length, 0);
        button(reopened.render(), "Clear queue").props.onClick(); button(reopened.render(), "Manual selection").props.onClick(); assert.equal(savedDraft(entries).source, "manual_selection"); reopened.unmount();
        const manual = mount(); assert.ok(control(manual.render(), "removal-search")); assert.equal(control(manual.render(), "removal-tag"), undefined); manual.unmount();
    });
});

test("draft mutation storage failure does not accept changed form values or send a request until the proposed review is restored", async () => {
    await environment(async ({ entries, storage }) => {
        const view = mount(); queue(view, "BAT-A"); reason(view, "Saved original reason"); const previous = savedDraft(entries); storage.failWrites = true;
        reason(view, "Unsaved proposed reason"); assert.equal(control(view.render(), "removal-reason").props.value, "Saved original reason"); assert.deepEqual(savedDraft(entries), previous);
        await button(view.render(), "Confirm selected").props.onClick(); assert.equal(view.writes.length, 0); assert.equal(pendingValues(entries).length, 0);
        storage.failWrites = false; button(view.render(), "Restore request recovery").props.onClick(); assert.equal(control(view.render(), "removal-reason").props.value, "Unsaved proposed reason");
        await button(view.render(), "Confirm selected").props.onClick(); assert.equal(view.writes[0].payload.reason, "Unsaved proposed reason"); view.unmount();
    });
});

test("an exact-key save failure after draft persistence retains the same captured UUID and sends no request before restoration", async () => {
    await environment(async ({ entries, storage }) => {
        const view = mount(); queue(view, "BAT-A"); queue(view, "BAT-B"); reason(view); control(view.render(), "removal-queued-BAT-B").props.onCheckedChange(false);
        storage.blockedWriteKey = lifecycle.lifecycleStorageKey("removal-native-actor", "live"); await button(view.render(), "Confirm selected").props.onClick();
        assert.equal(view.writes.length, 0); assert.equal(pendingValues(entries).length, 0); assert.equal(savedDraft(entries).items.length, 2);
        storage.blockedWriteKey = null; button(view.render(), "Restore request recovery").props.onClick(); const captured = JSON.parse(pendingValues(entries)[0]);
        await button(view.render(), "Retry exact removal").props.onClick(); assert.deepEqual(view.writes[0].payload, captured.payload); assert.deepEqual(savedDraft(entries).items.map(item => item.batteryId), ["BAT-B"]); view.unmount();
    });
});

test("post-success draft storage failure retains the exact request and recovers remaining unconfirmed work without a replacement write", async () => {
    await environment(async ({ entries, storage }) => {
        const writes = [], view = mount({ async write(action, payload) { writes.push(structuredClone(payload)); if (writes.length === 1) storage.blockedWriteKey = removalDraft.removalDraftStorageKey("removal-native-actor", "live"); return receipt(payload, { replayed: writes.length > 1 }); } });
        queue(view, "BAT-A"); queue(view, "BAT-B"); reason(view); control(view.render(), "removal-queued-BAT-B").props.onCheckedChange(false); await button(view.render(), "Confirm selected").props.onClick();
        const captured = JSON.parse(pendingValues(entries)[0]); assert.equal(pendingValues(entries).length, 1); assert.ok(text(view.render()).includes("Recorded this session"));
        storage.blockedWriteKey = null; button(view.render(), "Restore request recovery").props.onClick(); await button(view.render(), "Retry exact removal").props.onClick();
        assert.equal(writes.length, 2); assert.deepEqual(writes[0], captured.payload); assert.deepEqual(writes[1], captured.payload); assert.equal(pendingValues(entries).length, 0); assert.deepEqual(savedDraft(entries).items.map(item => item.batteryId), ["BAT-B"]); assert.deepEqual(savedDraft(entries).selectedIds, []); view.unmount();
    });
});

test("failure to read the separate draft store also fails closed without overwriting an original exact request", async () => {
    await environment(async ({ entries, storage }) => {
        const previous = mount({ async write() { throw new Error("Unconfirmed result"); } }); queue(previous, "BAT-A"); reason(previous); await button(previous.render(), "Confirm selected").props.onClick(); previous.unmount();
        const exact = pendingValues(entries)[0], draftKey = removalDraft.removalDraftStorageKey("removal-native-actor", "live"), rawDraft = entries.get(draftKey); storage.blockedReadKey = draftKey;
        const blocked = mount(); queue(blocked, "BAT-B"); reason(blocked, "Replacement"); await button(blocked.render(), "Confirm selected").props.onClick();
        assert.equal(blocked.writes.length, 0); assert.equal(pendingValues(entries)[0], exact); assert.equal(entries.get(draftKey), rawDraft); assert.ok(text(blocked.render()).includes("could not read its saved removal request or review draft")); blocked.unmount();
        storage.blockedReadKey = null; const reopened = mount(); await button(reopened.render(), "Retry exact removal").props.onClick(); assert.deepEqual(reopened.writes[0].payload, JSON.parse(exact).payload); reopened.unmount();
    });
});

test("removal history keeps only terminal records and clears combined filters while downloading their exact matching IDs", () => {
    const view = mount({}, "RemovalHistory"); assert.ok(text(view.render()).includes("2 matching records")); assert.equal(text(view.render()).includes("Battery BAT-LOAN"), false);
    nodes(view.render()).find(node => node.type === "Select").props.onValueChange("permanently_removed"); nodes(view.render()).find(node => node.type === "Input").props.onChange({ target: { value: "Receiving" } });
    assert.ok(text(view.render()).includes("Applied filters")); button(view.render(), "Download matching records").props.onClick(); assert.deepEqual(view.downloads[0], ["BAT-REMOVED"]);
    nodes(view.render()).find(node => node.type === "button" && text(node) === "BAT-REMOVED").props.onClick(); assert.deepEqual(view.details, ["BAT-REMOVED"]);
    button(view.render(), "Clear filters").props.onClick(); assert.ok(text(view.render()).includes("2 matching records")); assert.equal(nodes(view.render()).find(node => node.type === "Input").props.value, ""); view.unmount();
});
test("group removal stages exact members durably and keeps its context after leaving and reopening", async () => environment(async ({ entries }) => {
    const data = fixture(), reference = { id: crypto.randomUUID(), version: 1 };
    data.teachingGroups = [{ ...reference, name: "Staff class", batteryIds: ["BAT-A", "BAT-B"] }];
    const first = mount({ data, initialIds: ["BAT-A", "BAT-B"], teachingGroup: reference }); first.render();
    assert.deepEqual(savedDraft(entries).teachingGroup, reference); assert.deepEqual(savedDraft(entries).selectedIds, ["BAT-A", "BAT-B"]); assert.equal(first.writes.length, 0); first.unmount();
    const restored = mount({ data }); assert.match(text(restored.render()), /Staff class/); assert.match(text(restored.render()), /BAT-A/); assert.match(text(restored.render()), /BAT-B/); assert.equal(restored.writes.length, 0); restored.unmount();
}));
