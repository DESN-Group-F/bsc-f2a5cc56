import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, posix } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

// Execute the actual intake component handlers with controlled hooks, receipts
// and local recovery. No browser, physical reader or shared database is used.
const scratchRoot = new URL("../work/qa/", import.meta.url);
await mkdir(scratchRoot, { recursive: true });
const scratch = await mkdtemp(join(fileURLToPath(scratchRoot), "intake-ui-"));
after(() => rm(scratch, { recursive: true, force: true }));
const compiledLibraries = new Map();
async function compileLibrary(name) {
    if (compiledLibraries.has(name)) return compiledLibraries.get(name);
    const destination = join(scratch, `${name}.mjs`); compiledLibraries.set(name, destination);
    const source = await readFile(new URL(`../lib/${name}.ts`, import.meta.url), "utf8");
    const output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
    for (const match of output.matchAll(/from "(\.[^"]+)"/g)) await compileLibrary(posix.normalize(posix.join(posix.dirname(name), match[1])));
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, output.replace(/from "(\.[^"]+)"/g, (_, specifier) => `from "${specifier}.mjs"`));
    return destination;
}
for (const name of ["teaching-context", "teaching-nfc", "battery-models", "battery-age", "domain", "location-catalog", "client-utils", "intake-session", "intake-draft", "battery-lifecycle", "new-arrivals", "inventory-mapping", "inventory-query", "battery-selection-query", "permissions", "client/workflow-storage"]) await compileLibrary(name);
const [intake, models, client, locations, drafts] = await Promise.all(["intake-session", "battery-models", "client-utils", "location-catalog", "intake-draft"].map(name => import(pathToFileURL(join(scratch, `${name}.mjs`)))));
const query = await import(pathToFileURL(join(scratch, "inventory-query.mjs")));
const selectionQuery = await import(pathToFileURL(join(scratch, "battery-selection-query.mjs")));
const { getRolePermissions } = await import(pathToFileURL(join(scratch, "permissions.mjs")));
const workflowStorage = await import(pathToFileURL(join(scratch, "client/workflow-storage.mjs")));
const rowSource = await readFile(new URL("../lib/client/row-selection.ts", import.meta.url), "utf8");
await writeFile(join(scratch, "row-selection.mjs"), ts.transpileModule(rowSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText);
const rowSelection = await import(pathToFileURL(join(scratch, "row-selection.mjs")));
const source = await readFile(new URL("../components/inventory/intake-station.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } }).outputText.replace(/^import .*;\r?\n/gm, "").replace(/^export /gm, "");
const ui = Object.fromEntries(["BatteryFilterControls", "TeachingGroupsPanel", "NfcScanPanel", "CheckCircle2", "LogOut", "ScanLine", "Button", "Input", "Label", "Select", "SelectContent", "SelectItem", "SelectTrigger", "SelectValue", "Table", "TableBody", "TableCell", "TableHead", "TableHeader", "TableRow", "RecordPicker", "BatteryModelPicker", "Checkbox", "Dialog", "DialogContent", "DialogDescription", "DialogFooter", "DialogHeader", "DialogTitle"].map(name => [name, name]));
Object.assign(ui, { ReceiptAction: "Button", useNfcScanOffered: dataset => dataset === "demo" });
const jsx = (type, props, key) => typeof type === "function" ? type(props ?? {}) : ({ type, props: props ?? {}, key });
function hooks() {
    const state = [], effects = [];
    let pointer = 0, effectPointer = 0, scheduled = [];
    return {
        reset() { pointer = 0; effectPointer = 0; scheduled = []; },
        useState(initial) { const index = pointer++; if (!(index in state)) state[index] = typeof initial === "function" ? initial() : initial; return [state[index], update => { state[index] = typeof update === "function" ? update(state[index]) : update; }]; },
        useRef(initial) { const index = pointer++; if (!(index in state)) state[index] = { current: initial }; return state[index]; },
        useEffect(callback, dependencies) { const index = effectPointer++, prior = effects[index]; if (!prior || dependencies.some((value, key) => !Object.is(value, prior.dependencies[key]))) scheduled.push(() => { prior?.cleanup?.(); effects[index] = { dependencies, cleanup: callback() }; }); },
        commit() { for (const callback of scheduled) callback(); },
        unmount() { for (const effect of effects) effect?.cleanup?.(); },
    };
}
function nodes(node, results = []) { if (Array.isArray(node)) for (const item of node) nodes(item, results); else if (node && typeof node === "object") { results.push(node); nodes(node.props?.children, results); } return results; }
function text(node) { if (typeof node === "string" || typeof node === "number") return String(node); if (Array.isArray(node)) return node.map(text).join(""); return node && typeof node === "object" ? text(node.props?.children) : ""; }
function button(tree, label) { return nodes(tree).find(node => node.type === "Button" && text(node) === label); }
function input(tree, key) { return nodes(tree).find(node => node.type === "Input" && node.props.id === `intake-${key}`); }
function fixture(dataset = "demo") {
    return { dataset, user: { id: "intake-native-actor", role: "staff", username: "operator" }, people: [{ id: "staff-intake-actor", accountId: "intake-native-actor", name: "Same staff", role: "staff" }, { id: "staff-another-owner", accountId: "another-native-owner", name: "Same staff", role: "staff" }], staffDirectory: [{ id: "intake-native-actor", username: "operator", displayName: "Same staff", active: true }, { id: "another-native-owner", username: "owner", displayName: "Same staff", active: true }], buildings: [{ id: "J18", name: "Willis Annexe" }, { id: "E10", name: "Hilmer Building" }], rooms: [{ id: "J18-DEMO", name: "Demo room", buildingId: "J18", isPlaceholder: true, selectable: true, number: "DEMO" }], batteries: [] };
}
function receipt(payload, overrides = {}) {
    const common = { ...payload.common }; delete common.modelSelection;
    return { ...common, requestId: payload.requestId, sessionId: payload.sessionId, dataset: "demo", actorAccountId: "intake-native-actor", batteryId: "BAT-00000001", tagId: payload.tagId, registeredAt: "2026-10-03T01:00:00.000Z", source: payload.source ?? "simulated_intake", ...(payload.nfcEvidence ? { nfcEvidence: payload.nfcEvidence } : {}), replayed: false, ...(payload.scannedAt ? { scannedAt: payload.scannedAt } : {}), firstUsedOn: payload.firstUseMode === "at_registration" ? "2026-10-03" : payload.firstUseMode === "date" ? common.firstUsedOn : null, ...overrides };
}
async function environment(run, seed = []) {
    const saved = Object.fromEntries(["sessionStorage", "window", "Element"].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
    const entries = new Map(seed), control = { selection: null, failWrites: false, failReads: false, writeCalls: 0 };
    Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: { getItem: key => { if (control.failReads) throw new Error("Read unavailable"); return entries.get(key) ?? null; }, setItem: (key, value) => { control.writeCalls++; if (control.failWrites) throw new Error("Storage unavailable"); entries.set(key, value); }, removeItem: key => { if (control.failWrites) throw new Error("Storage unavailable"); entries.delete(key); } } });
    Object.defineProperty(globalThis, "window", { configurable: true, value: { addEventListener() {}, removeEventListener() {}, getSelection() { return control.selection; } } });
    Object.defineProperty(globalThis, "Element", { configurable: true, value: class { constructor(interactive = false) { this.interactive = interactive; } closest() { return this.interactive; } } });
    try { await run({ entries, control }); } finally { for (const [name, descriptor] of Object.entries(saved)) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); } }
}
function mount(overrides = {}) {
    const state = hooks(), writes = [], exits = [];
    const bindings = { ...query, ...selectionQuery, ...rowSelection, ...workflowStorage, getRolePermissions, ...ui, ...intake, ...drafts, ...models, ...client, ...locations, ...state, currentSydneyDate: () => "2026-10-03" }, names = Object.keys(bindings);
    const IntakeStation = new Function(...names, "_jsx", "_jsxs", "_Fragment", `${compiled}\nreturn IntakeStation;`)(...names.map(name => bindings[name]), jsx, jsx, "Fragment");
    const props = { data: fixture(), onExit: () => exits.push(true), async write(action, payload) { writes.push({ action, payload: structuredClone(payload) }); return receipt(payload, { batteryId: `BAT-${String(writes.length).padStart(8, "0")}` }); }, ...overrides };
    return { props, writes, exits, render() { state.reset(); const tree = IntakeStation(props); state.commit(); return tree; }, unmount: state.unmount };
}
function setFields(view, values) { for (const [key, value] of Object.entries(values)) input(view.render(), key).props.onChange({ target: { value } }); }
function start(view, fields = { name: "Batch batteries", model: "MODEL-BATCH" }) { setFields(view, fields); nodes(view.render()).find(node => node.type === "form").props.onSubmit({ preventDefault() {} }); return view.render(); }


function saved(entries) { return JSON.parse(entries.get(intake.intakeStorageKey("intake-native-actor", "demo"))); }
// New drafts come only from NFC reads (a demonstration); each label maps to a stable 7-byte UID.
function tagOf(label) { return label.startsWith("nfc:uid:") ? label : `nfc:uid:${createHash("sha256").update(label).digest("hex").slice(0, 14).toUpperCase()}`; }
function evidenceFor(tagId, at = new Date().toISOString()) { return { attemptId: crypto.randomUUID(), source: "native-nfc-reader", platform: "android", startedAt: at, endedAt: at, adoptedAt: at, tagId, result: { uidHex: tagId.slice(8), technology: "Web NFC (Chrome on Android)", ndefStatus: "unknown", capacityBytes: null, records: [], observedAt: at } }; }
function scanPanel(view) { return nodes(view.render()).find(node => node.type === "NfcScanPanel"); }
function queue(view, tag) { const tagId = tagOf(tag ?? crypto.randomUUID()), panel = scanPanel(view); assert.ok(panel, "An NFC batch must offer the scan panel."); return panel.props.onRead(tagId, evidenceFor(tagId)); }
function draftRow(view, tag) { return nodes(view.render()).find(node => node.type === "TableRow" && node.props["data-testid"] === "intake-draft-" + tagOf(tag)); }
function rowButton(view, tag, label) { return button(draftRow(view, tag), label); }
function selectEntry(view, tag, checked) { nodes(draftRow(view, tag)).find(node => node.type === "Checkbox").props.onCheckedChange(checked); }
function confirmButton(view, kind) { return nodes(view.render()).find(node => node.type === "Button" && text(node).startsWith("Confirm " + kind + " (")); }
function editFields(view, fields) { for (const [key, value] of Object.entries(fields)) input(view.render(), "edit-" + key).props.onChange({ target: { value } }); }
function saveEdit(view) { nodes(view.render()).find(node => node.type === "form").props.onSubmit({ preventDefault() {} }); }
function bareAttempt(tag = "DEMO-INTAKE-LEGACY") { return intake.captureIntakeAttempt("intake-native-actor", "demo", { requestId: crypto.randomUUID(), sessionId: crypto.randomUUID(), tagId: tag, firstUseMode: "at_registration", common: { name: "Legacy pending", model: "LEGACY", chemistry: "", capacityMah: null, voltage: null, ownerId: "staff-intake-actor", homeBuildingId: "J18", homeRoomId: null, manufacturedOn: null, firstUsedOn: null } }); }

test("recovered native intake keeps adopted tags and evidence through editing, explicit confirmation and exact retry", async () => environment(async ({ entries }) => {
    const evidence = { attemptId: crypto.randomUUID(), source: "native-nfc-reader", platform: "android", startedAt: "2026-10-03T00:00:00.000Z", endedAt: "2026-10-03T00:00:01.000Z", adoptedAt: "2026-10-03T00:00:02.000Z", tagId: "nfc:uid:01020304", result: { uidHex: "01020304", technology: "NfcA", ndefStatus: "unknown", capacityBytes: null, records: [], observedAt: "2026-10-03T00:00:01.000Z" } };
    const original = bareAttempt().payload, entry = { id: crypto.randomUUID(), tagId: evidence.tagId, scannedAt: evidence.result.observedAt, sessionId: original.sessionId, common: original.common, firstUseMode: "at_registration", source: "native_nfc", nfcEvidence: evidence, selected: true, error: "" };
    const legacy = receipt(original, { batteryId: "BAT-00000002" });
    entries.set(intake.intakeStorageKey("intake-native-actor", "demo"), JSON.stringify(drafts.captureIntakeDraft({ actorAccountId: "intake-native-actor", dataset: "demo", batch: { sessionId: entry.sessionId, common: entry.common, firstUseMode: entry.firstUseMode, source: "native_nfc" }, entries: [entry], completed: [legacy], attempt: null, attemptEntryId: null })));
    const sent = []; let complete = false;
    const write = async (action, payload) => { sent.push(structuredClone(payload)); if (!complete) throw new Error("Controlled missing native receipt"); return receipt(payload, { source: "native_nfc", nfcEvidence: evidence }); };
    const view = mount({ write });
    assert.ok(scanPanel(view), "a native batch continues with NFC scanning"); assert.equal(button(view.render(), "Simulate next new battery"), undefined); assert.equal(input(view.render(), "demo-tag"), undefined);
    assert.equal(view.writes.length, 0); rowButton(view, evidence.tagId, "Edit").props.onClick(); assert.equal(input(view.render(), "edit-tagId").props.disabled, true);
    editFields(view, { name: "Reviewed native draft" }); saveEdit(view);
    assert.equal(saved(entries).entries[0].common.name, "Reviewed native draft"); assert.deepEqual(saved(entries).entries[0].nfcEvidence, evidence);
    await confirmButton(view, "all").props.onClick(); const captured = structuredClone(sent[0]);
    assert.equal(captured.source, "native_nfc"); assert.equal(captured.tagId, evidence.tagId); assert.deepEqual(captured.nfcEvidence, evidence); assert.ok(saved(entries).attempt); view.unmount();
    complete = true; const resumed = mount({ write }); await button(resumed.render(), "Retry exact confirmation").props.onClick();
    assert.deepEqual(sent[1], captured); assert.equal(saved(entries).entries.length, 0); assert.equal(saved(entries).attempt, null); assert.deepEqual(saved(entries).completed[0], legacy);
    const resultRows = nodes(resumed.render()).filter(node => node.type === "TableRow" && node.props.onClick && !node.props["data-testid"]);
    assert.match(text(resultRows.find(row => text(row).includes("BAT-00000001"))), /NFC scan/); assert.doesNotMatch(text(resultRows.find(row => text(row).includes("BAT-00000001"))), /Simulated intake/);
    assert.match(text(resultRows.find(row => text(row).includes("BAT-00000002"))), /Simulated intake \(demo, earlier\)/); resumed.unmount();
}));

test("intake rows toggle once from plain content, preserve interactive controls and text selection, and lock uncertain confirmations", async () => {
    await environment(async ({ entries, control }) => {
        const view = mount({ async write() { throw new Error("Response unavailable"); } });
        start(view); queue(view, tagOf("DEMO-INTAKE-ROW"));
        const event = interactive => ({ target: new Element(interactive), currentTarget: { contains: node => node === "inside" }, button: 0, defaultPrevented: false });
        draftRow(view, tagOf("DEMO-INTAKE-ROW")).props.onClick(event(false));
        assert.equal(saved(entries).entries[0].selected, false);
        draftRow(view, tagOf("DEMO-INTAKE-ROW")).props.onClick(event(true));
        assert.equal(saved(entries).entries[0].selected, false);
        control.selection = { isCollapsed: false, anchorNode: "inside", focusNode: "inside" };
        draftRow(view, tagOf("DEMO-INTAKE-ROW")).props.onClick(event(false));
        assert.equal(saved(entries).entries[0].selected, false);
        control.selection = null;
        selectEntry(view, tagOf("DEMO-INTAKE-ROW"), true);
        await confirmButton(view, "selected").props.onClick();
        const preserved = structuredClone(saved(entries));
        draftRow(view, tagOf("DEMO-INTAKE-ROW")).props.onClick(event(false));
        assert.deepEqual(saved(entries), preserved);
        view.unmount();
    });
});

test("registered intake filters use current records while retaining hidden selections, original receipts and unavailable history", async () => {
    await environment(async ({ entries }) => {
        const view = mount(); start(view); queue(view, tagOf("DEMO-INTAKE-FILTER-A")); queue(view, tagOf("DEMO-INTAKE-FILTER-B"));
        await confirmButton(view, "all").props.onClick();
        const preserved = structuredClone(saved(entries));
        const receiptRows = () => nodes(view.render()).filter(node => node.type === "TableRow" && node.props.onClick && !node.props["data-testid"]);
        const filters = () => nodes(view.render()).find(node => node.type === "BatteryFilterControls");
        assert.equal(receiptRows().length, 2, "unavailable current inventory must not hide saved receipts by default");
        view.props.data.batteries = preserved.completed.map((receipt, index) => ({ ...receipt, id: receipt.batteryId, lifecycleStatus: index ? "scrapped" : "active", loanId: null, chemistry: index ? "NiMH" : "Li-ion", name: "Confirmed pack" }));
        receiptRows()[0].props.onClick({ target: new Element(false), currentTarget: { contains: () => false }, button: 0, defaultPrevented: false });
        filters().props.onChange({ chemistry: "NiMH" });
        assert.equal(receiptRows().length, 1);
        assert.ok(text(receiptRows()[0]).includes("BAT-00000002"));
        assert.ok(text(view.render()).includes("1 selected outside these filters"));
        button(view.render(), "Add selected to teaching group").props.onClick();
        assert.deepEqual(nodes(view.render()).find(node => node.type === "TeachingGroupsPanel").props.initialIds, ["BAT-00000001"]);
        filters().props.onChange({ capacityMinMah: 100, capacityMaxMah: 50 });
        assert.equal(receiptRows().length, 0);
        assert.ok(nodes(view.render()).some(node => node.props.role === "alert"));
        filters().props.onClear();
        assert.equal(receiptRows().length, 2);
        assert.equal(nodes(receiptRows()[0]).find(node => node.type === "Checkbox").props.checked, true);
        assert.deepEqual(saved(entries), preserved, "selection and filtering cannot alter saved intake evidence");
        view.unmount();
    });
});

test("scans create durable editable drafts only; common snapshots, device times and default unknown manufacture dates exist before any API", async () => {
    await environment(async ({ entries }) => {
        const view = mount(); start(view, { name: "Batch pack", model: "Known pack", capacityMah: "2200" });
        queue(view, tagOf("DEMO-INTAKE-ONE")); queue(view, tagOf("DEMO-INTAKE-TWO"));
        assert.equal(view.writes.length, 0); assert.equal(view.exits.length, 0);
        const draft = saved(entries);
        assert.equal(draft.entries.length, 2); assert.equal(draft.attempt, null); assert.equal(draft.completed.length, 0);
        assert.deepEqual(draft.entries[0].common, draft.entries[1].common); assert.equal(draft.entries[0].sessionId, draft.entries[1].sessionId);
        assert.equal(draft.entries[0].common.ownerId, "staff-intake-actor"); assert.equal(draft.entries[0].common.firstUsedOn, null); assert.equal(draft.entries[0].common.manufacturedOn, null);
        assert.equal(draft.entries[0].firstUseMode, "at_registration"); assert.equal(draft.entries[0].common.id, undefined); assert.equal(Number.isFinite(Date.parse(draft.entries[0].scannedAt)), true);
        assert.ok(text(view.render()).includes("Scanned at (this device)")); assert.equal(text(view.render()).includes("BAT-00000001"), false);
        await confirmButton(view, "all").props.onClick();
        assert.equal(view.writes.length, 2); assert.equal(saved(entries).entries.length, 0); assert.equal(saved(entries).completed.length, 2);
        assert.ok(text(view.render()).includes("Registered at (server)")); assert.ok(text(view.render()).includes("2026-10-03")); assert.ok(scanPanel(view)); view.unmount();
    });
});

test("edited drafts retain scan time, use a new immutable configuration and can be removed without registration", async () => {
    await environment(async ({ entries }) => {
        const view = mount(); start(view); queue(view, tagOf("DEMO-INTAKE-EDIT")); queue(view, tagOf("DEMO-INTAKE-KEEP"));
        const original = saved(entries).entries[0], other = saved(entries).entries[1];
        rowButton(view, tagOf("DEMO-INTAKE-EDIT"), "Edit").props.onClick();
        assert.equal(input(view.render(), "edit-tagId").props.disabled, true, "an NFC draft keeps its read tag");
        editFields(view, { name: "Corrected pack", model: "MODEL-EDIT", chemistry: "Li-ion", capacityMah: "3300", voltage: "7.4", manufacturedOn: "2024-01-01" });
        nodes(view.render()).find(node => node.type === "RecordPicker" && node.props.id === "intake-edit-owner").props.onChange("staff-another-owner");
        nodes(view.render()).find(node => node.type === "RecordPicker" && node.props.id === "intake-edit-room").props.onChange("J18-DEMO");
        nodes(view.render()).find(node => node.type === "Select").props.onValueChange("date"); editFields(view, { firstUsedOn: "2024-02-01" }); saveEdit(view);
        const edited = saved(entries).entries[0];
        assert.equal(view.writes.length, 0); assert.equal(edited.scannedAt, original.scannedAt); assert.notEqual(edited.sessionId, original.sessionId); assert.deepEqual(saved(entries).entries[1], other);
        assert.equal(edited.common.ownerId, "staff-another-owner"); assert.equal(edited.common.homeRoomId, "J18-DEMO"); assert.equal(edited.common.firstUsedOn, "2024-02-01"); assert.equal(edited.common.capacityMah, 3300);
        rowButton(view, tagOf("DEMO-INTAKE-KEEP"), "Remove").props.onClick(); assert.equal(saved(entries).entries.length, 1); assert.equal(view.writes.length, 0);
        await confirmButton(view, "all").props.onClick(); assert.equal(view.writes.length, 1); assert.equal(view.writes[0].payload.tagId, tagOf("DEMO-INTAKE-EDIT")); assert.equal(view.writes[0].payload.common.name, "Corrected pack"); assert.equal(view.writes[0].payload.sessionId, edited.sessionId); view.unmount();
    });
});

test("selected confirmation sends only chosen drafts; Confirm all includes the remaining unselected entry", async () => {
    await environment(async ({ entries }) => {
        const view = mount(); start(view); queue(view, tagOf("DEMO-INTAKE-A")); queue(view, tagOf("DEMO-INTAKE-B")); queue(view, tagOf("DEMO-INTAKE-C"));
        selectEntry(view, tagOf("DEMO-INTAKE-B"), false); selectEntry(view, tagOf("DEMO-INTAKE-C"), false);
        await confirmButton(view, "selected").props.onClick();
        assert.deepEqual(view.writes.map(write => write.payload.tagId), [tagOf("DEMO-INTAKE-A")]);
        assert.deepEqual(saved(entries).entries.map(entry => [entry.tagId, entry.selected]), [[tagOf("DEMO-INTAKE-B"), false], [tagOf("DEMO-INTAKE-C"), false]]);
        assert.equal(confirmButton(view, "selected").props.disabled, true);
        await confirmButton(view, "all").props.onClick(); assert.deepEqual(view.writes.map(write => write.payload.tagId), [tagOf("DEMO-INTAKE-A"), tagOf("DEMO-INTAKE-B"), tagOf("DEMO-INTAKE-C")]); view.unmount();
    });
});

test("queue selections and confirmed receipts recover after explicit exit without automatically sending any draft", async () => {
    await environment(async ({ entries }) => {
        const view = mount(); start(view); queue(view, tagOf("DEMO-INTAKE-EXIT-A")); queue(view, tagOf("DEMO-INTAKE-EXIT-B")); selectEntry(view, tagOf("DEMO-INTAKE-EXIT-B"), false);
        await confirmButton(view, "selected").props.onClick(); button(view.render(), "Exit intake").props.onClick(); assert.equal(view.exits.length, 1); view.unmount();
        const reopened = mount(); assert.ok(draftRow(reopened, tagOf("DEMO-INTAKE-EXIT-B"))); assert.equal(saved(entries).entries[0].selected, false); assert.ok(text(reopened.render()).includes("BAT-00000001")); assert.equal(reopened.writes.length, 0);
        const selectAll = nodes(reopened.render()).find(node => node.type === "Checkbox" && node.props["aria-label"] === "Select all intake drafts"); selectAll.props.onCheckedChange(true);
        assert.equal(saved(entries).entries[0].selected, true); reopened.unmount();
    });
});

test("explicit intake exit retains an uncertain request and reopening retries only that original confirmation", async () => {
    await environment(async ({ entries }) => {
        const view = mount({ async write() { throw new Error("Response lost"); } });
        start(view); queue(view, tagOf("DEMO-INTAKE-UNKNOWN")); queue(view, tagOf("DEMO-INTAKE-LATER"));
        await confirmButton(view, "all").props.onClick();
        const preserved = saved(entries);
        assert.ok(preserved.attempt);
        assert.equal(button(view.render(), "Exit intake").props.disabled, false);
        button(view.render(), "Exit intake").props.onClick();
        assert.equal(view.exits.length, 1);
        assert.deepEqual(saved(entries), preserved);
        view.unmount();
        const reopened = mount();
        assert.ok(button(reopened.render(), "Retry exact confirmation"));
        assert.equal(reopened.writes.length, 0);
        await button(reopened.render(), "Retry exact confirmation").props.onClick();
        assert.deepEqual(reopened.writes.map(write => write.payload), [preserved.attempt.payload]);
        assert.deepEqual(saved(entries).entries.map(entry => entry.tagId), [tagOf("DEMO-INTAKE-LATER")]);
        assert.equal(saved(entries).attempt, null);
        reopened.unmount();
    });
});

test("partial success removes verified drafts, retains an unknown item and its exact payload, and does not submit later drafts on retry", async () => {
    const writes = [], attempts = new Map();
    await environment(async ({ entries }) => {
        const view = mount({ async write(action, payload) {
            writes.push(structuredClone(payload)); const calls = (attempts.get(payload.tagId) || 0) + 1; attempts.set(payload.tagId, calls);
            if (payload.tagId === tagOf("DEMO-INTAKE-PART-B") && calls === 1) throw new Error("Response lost");
            if (payload.tagId === tagOf("DEMO-INTAKE-PART-B") && calls === 2) throw Object.assign(new Error("Sign in again"), { status: 401 });
            return receipt(payload, { batteryId: payload.tagId.endsWith("A") ? "BAT-00000001" : "BAT-00000002", replayed: calls > 1 });
        } });
        start(view); for (const tag of [tagOf("DEMO-INTAKE-PART-A"), tagOf("DEMO-INTAKE-PART-B"), tagOf("DEMO-INTAKE-PART-C")]) queue(view, tag);
        await confirmButton(view, "all").props.onClick();
        assert.deepEqual(writes.map(payload => payload.tagId), [tagOf("DEMO-INTAKE-PART-A"), tagOf("DEMO-INTAKE-PART-B")]); assert.equal(saved(entries).completed.length, 1);
        assert.equal(confirmButton(view, "all").props.pending, false);
        assert.equal(confirmButton(view, "all").props.confirmation.count, 1);
        assert.equal(confirmButton(view, "all").props.confirmation.identity, writes[0].requestId);
        assert.equal(confirmButton(view, "all").props.confirmation.text, "1 battery registered");
        assert.match(text(view.render()), /one confirmation is unresolved/);
        const pending = saved(entries).attempt; assert.equal(saved(entries).entries.length, 2); assert.equal(rowButton(view, tagOf("DEMO-INTAKE-PART-C"), "Edit").props.disabled, true);
        await button(view.render(), "Retry exact confirmation").props.onClick(); assert.deepEqual(saved(entries).attempt, pending);
        assert.equal(confirmButton(view, "all").props.confirmation, null);
        await button(view.render(), "Retry exact confirmation").props.onClick(); assert.equal(saved(entries).attempt, null); assert.equal(saved(entries).entries.length, 1);
        assert.equal(confirmButton(view, "all").props.confirmation.count, 1);
        assert.equal(confirmButton(view, "all").props.confirmation.identity, pending.payload.requestId);
        assert.equal(saved(entries).entries[0].tagId, tagOf("DEMO-INTAKE-PART-C")); assert.equal(writes.filter(payload => payload.tagId === tagOf("DEMO-INTAKE-PART-C")).length, 0);
        assert.equal(new Set(writes.filter(payload => payload.tagId === tagOf("DEMO-INTAKE-PART-B")).map(payload => JSON.stringify(payload))).size, 1); view.unmount();
    });
});

test("definite per-item rejections remain editable while the rest of the explicit confirmation progresses", async () => {
    const writes = [];
    await environment(async ({ entries }) => {
        let rejected = false; const view = mount({ async write(action, payload) { writes.push(payload); if (payload.tagId === tagOf("DEMO-INTAKE-BAD") && !rejected) { rejected = true; throw Object.assign(new Error("Tag already exists"), { status: 409, code: "intake_rejected_final" }); } return receipt(payload); } });
        start(view); queue(view, tagOf("DEMO-INTAKE-BAD")); queue(view, tagOf("DEMO-INTAKE-GOOD"));
        await confirmButton(view, "all").props.onClick(); assert.equal(writes.length, 2); assert.equal(saved(entries).entries.length, 1); assert.equal(saved(entries).attempt, null); assert.ok(saved(entries).entries[0].error.includes("Tag already exists"));
        rowButton(view, tagOf("DEMO-INTAKE-BAD"), "Edit").props.onClick(); editFields(view, { name: "Reviewed after rejection" }); saveEdit(view);
        assert.equal(saved(entries).entries[0].error, ""); await confirmButton(view, "all").props.onClick(); assert.equal(saved(entries).entries.length, 0); view.unmount();
    });
});

test("scanning and editing reject duplicate or invalid tags without sending API requests or hiding modal errors", async () => {
    await environment(async ({ entries }) => {
        const view = mount(); start(view); queue(view, tagOf("DEMO-INTAKE-DUP")); queue(view, tagOf("DEMO-INTAKE-DUP")); assert.equal(saved(entries).entries.length, 1);
        assert.ok(nodes(view.render()).some(node => node.props?.role === "alert" && text(node).includes("already queued or registered")));
        queue(view, tagOf("DEMO-INTAKE-SECOND")); rowButton(view, tagOf("DEMO-INTAKE-SECOND"), "Edit").props.onClick(); editFields(view, { tagId: tagOf("DEMO-INTAKE-DUP") }); saveEdit(view);
        assert.ok(nodes(view.render()).filter(node => node.type === "Dialog").some(node => text(node).includes("retain its adopted tag")));
        assert.equal(view.writes.length, 0); assert.equal(saved(entries).entries.length, 2); view.unmount();
    });
});

test("storage failure accepts no new queue state, blocks configuration changes and restores the same prospective draft before confirmation", async () => {
    await environment(async ({ entries, control }) => {
        const view = mount(); start(view); control.failWrites = true;
        queue(view, tagOf("DEMO-INTAKE-STORAGE")); assert.equal(saved(entries).entries.length, 0); assert.equal(view.writes.length, 0);
        assert.equal(button(view.render(), "Change common details").props.disabled, true); button(view.render(), "Change common details").props.onClick();
        assert.equal(nodes(view.render()).some(node => node.type === "form"), false); assert.equal(confirmButton(view, "all").props.disabled, true);
        control.failWrites = false; button(view.render(), "Restore draft recovery").props.onClick(); const restored = saved(entries).entries[0];
        assert.equal(restored.tagId, tagOf("DEMO-INTAKE-STORAGE")); assert.equal(view.writes.length, 0); await confirmButton(view, "all").props.onClick();
        assert.equal(view.writes[0].payload.scannedAt, restored.scannedAt); assert.equal(view.writes[0].payload.sessionId, restored.sessionId); view.unmount();
    });
});

test("confirmation capture must be durable before sending and storage restoration preserves its request UUID", async () => {
    await environment(async ({ entries, control }) => {
        const view = mount(); start(view); queue(view, tagOf("DEMO-INTAKE-CAPTURE")); control.failWrites = true; await confirmButton(view, "all").props.onClick();
        assert.equal(view.writes.length, 0); assert.equal(saved(entries).attempt, null); control.failWrites = false; button(view.render(), "Restore draft recovery").props.onClick();
        const preserved = saved(entries).attempt; assert.ok(preserved); await button(view.render(), "Retry exact confirmation").props.onClick();
        assert.equal(view.writes[0].payload.requestId, preserved.payload.requestId); assert.equal(saved(entries).entries.length, 0); view.unmount();
    });
});

test("initial storage read failure cannot overwrite unknown saved work even if writes remain available", async () => {
    const previous = JSON.stringify(bareAttempt());
    await environment(async ({ entries, control }) => {
        control.failReads = true; const view = mount(); start(view);
        assert.equal(view.writes.length, 0); assert.equal(control.writeCalls, 0); assert.equal(entries.get(intake.intakeStorageKey("intake-native-actor", "demo")), previous);
        assert.ok(text(view.render()).includes("could not be read")); assert.equal(button(view.render(), "Confirm common details and start scanning").props.disabled, true);
        view.unmount(); control.failReads = false; const reopened = mount(); assert.ok(button(reopened.render(), "Retry exact confirmation")); assert.ok(text(reopened.render()).includes("Not recorded")); reopened.unmount();
    }, [[intake.intakeStorageKey("intake-native-actor", "demo"), previous]]);
});

test("model suggestions preserve ownership and support explicit manual correction after their source becomes stale", async () => {
    await environment(async ({ entries }) => {
        const view = mount(); nodes(view.render()).find(node => node.type === "RecordPicker" && node.props.id === "intake-owner").props.onChange("staff-another-owner");
        nodes(view.render()).find(node => node.type === "BatteryModelPicker").props.onApply({ id: "MODEL-REFERENCE", origin: "inventory", contentHash: "a".repeat(64), name: "Model battery", model: "MODEL-REF", chemistry: "LiPo", capacityMah: 2000, voltage: null }, ["name", "model", "chemistry", "capacityMah"]);
        nodes(view.render()).find(node => node.type === "form").props.onSubmit({ preventDefault() {} }); queue(view, tagOf("DEMO-INTAKE-SOURCE"));
        rowButton(view, tagOf("DEMO-INTAKE-SOURCE"), "Edit").props.onClick(); editFields(view, { capacityMah: "2100" }); button(view.render(), "Use manual model details").props.onClick(); saveEdit(view);
        assert.equal(saved(entries).entries[0].common.modelSelection, undefined); assert.equal(saved(entries).entries[0].common.ownerId, "staff-another-owner"); assert.equal(saved(entries).entries[0].common.manufacturedOn, null);
        await confirmButton(view, "all").props.onClick(); assert.equal(view.writes[0].payload.common.capacityMah, 2100); assert.equal(view.writes[0].payload.common.modelSelection, undefined); view.unmount();
    });
});

test("explicit known and unknown service dates are kept in queued items and default service starts only at server confirmation", async () => {
    for (const mode of ["date", "unknown"]) await environment(async ({ entries }) => {
        const view = mount(); nodes(view.render()).find(node => node.type === "Select").props.onValueChange(mode);
        start(view, { name: "Previously used pack", manufacturedOn: "2025-01-01", ...(mode === "date" ? { firstUsedOn: "2025-02-01" } : {}) }); queue(view);
        assert.equal(view.writes.length, 0); assert.equal(saved(entries).entries[0].common.firstUsedOn, mode === "date" ? "2025-02-01" : null);
        await confirmButton(view, "all").props.onClick(); assert.equal(saved(entries).completed[0].firstUsedOn, mode === "date" ? "2025-02-01" : null); view.unmount();
    });
});

test("foreign receipts stay unresolved, stored queues cannot change native context, and live inventory exposes no simulated controls", async () => {
    await environment(async ({ entries }) => {
        const live = mount({ data: fixture("live") }); assert.equal(scanPanel(live), undefined); assert.equal(button(live.render(), "Simulate next new battery"), undefined); assert.equal(confirmButton(live, "all"), undefined); live.unmount();
        const view = mount({ async write(action, payload) { return receipt(payload, { actorAccountId: "foreign-account" }); } }); start(view); queue(view); await confirmButton(view, "all").props.onClick();
        assert.ok(saved(entries).attempt); assert.equal(saved(entries).completed.length, 0); assert.ok(button(view.render(), "Retry exact confirmation"));
        view.props.data = { ...view.props.data, user: { ...view.props.data.user, id: "another-native-account" } };
        assert.equal(button(view.render(), "Retry exact confirmation").props.disabled, true); view.unmount();
        const raw = saved(entries); entries.set(intake.intakeStorageKey("intake-native-actor", "demo"), JSON.stringify({ ...raw, actorAccountId: "foreign-account" }));
        const invalid = mount(); assert.ok(text(invalid.render()).includes("could not be recovered")); assert.equal(invalid.writes.length, 0); invalid.unmount();
    });
});

test("NFC reads stay in the scan panel, rapid confirmation is serialized and scanning pauses while a confirmation is open", async () => {
    let release;
    await environment(async ({ entries }) => {
        const view = mount({ write(action, payload) { view.writes.push({ action, payload }); return new Promise(resolve => { release = () => resolve(receipt(payload)); }); } });
        start(view); queue(view, tagOf("DEMO-INTAKE-ENTER"));
        assert.equal(view.writes.length, 0); assert.equal(scanPanel(view).props.disabled, false); assert.equal(scanPanel(view).props.dataset, "demo");
        const confirm = confirmButton(view, "all").props.onClick, inFlight = confirm(); await confirm();
        assert.equal(view.writes.length, 1); assert.equal(scanPanel(view).props.disabled, true); assert.equal(button(view.render(), "Exit intake").props.disabled, true);
        queue(view, tagOf("DEMO-INTAKE-DURING")); assert.equal(saved(entries).entries.length, 1, "a read during confirmation is not queued");
        release(); await inFlight; assert.equal(saved(entries).entries.length, 0); assert.equal(scanPanel(view).props.disabled, false); view.unmount();
    });
});

test("a batch left from the retired simulated intake can still be confirmed, and the next batch scans by NFC", async () => {
    await environment(async ({ entries }) => {
        const legacy = bareAttempt("DEMO-INTAKE-EARLIER").payload, entry = { id: crypto.randomUUID(), tagId: legacy.tagId, scannedAt: "2026-10-03T00:00:00.000Z", sessionId: legacy.sessionId, common: legacy.common, firstUseMode: "at_registration", selected: true, error: "" };
        entries.set(intake.intakeStorageKey("intake-native-actor", "demo"), JSON.stringify(drafts.captureIntakeDraft({ actorAccountId: "intake-native-actor", dataset: "demo", batch: { sessionId: entry.sessionId, common: entry.common, firstUseMode: "at_registration" }, entries: [entry], completed: [], attempt: null, attemptEntryId: null })));
        const view = mount();
        assert.match(text(view.render()), /Earlier simulated batch/); assert.equal(scanPanel(view), undefined); assert.equal(input(view.render(), "demo-tag"), undefined);
        await confirmButton(view, "all").props.onClick();
        assert.equal(view.writes.length, 1); assert.equal(view.writes[0].payload.tagId, "DEMO-INTAKE-EARLIER"); assert.equal(view.writes[0].payload.source, undefined); assert.equal(saved(entries).entries.length, 0);
        button(view.render(), "Change common details").props.onClick(); start(view);
        assert.equal(saved(entries).batch.source, "native_nfc"); queue(view, tagOf("DEMO-INTAKE-NEXT"));
        assert.equal(saved(entries).entries[0].source, "native_nfc"); assert.equal(saved(entries).entries[0].tagId, tagOf("DEMO-INTAKE-NEXT")); view.unmount();
    });
});

test("a delayed old confirmation cannot replace a newer station's draft or exact request", async () => {
    let release;
    await environment(async ({ entries }) => {
        const view = mount({ write(action, payload) { return new Promise(resolve => { release = () => resolve(receipt(payload)); }); } }); start(view); queue(view, tagOf("DEMO-INTAKE-OLD"));
        const inFlight = confirmButton(view, "all").props.onClick(), original = saved(entries); view.unmount();
        const newer = structuredClone(original); newer.attempt.payload.requestId = crypto.randomUUID();
        entries.set(intake.intakeStorageKey("intake-native-actor", "demo"), JSON.stringify(newer)); release(); await inFlight;
        assert.deepEqual(saved(entries), newer); assert.equal(view.exits.length, 0);
    });
});
test("only server-confirmed intake assets can be selected for teaching groups and the station stays open", async () => {
    await environment(async () => {
        const view = mount(); start(view); queue(view, tagOf("DEMO-INTAKE-GROUP-A")); queue(view, tagOf("DEMO-INTAKE-GROUP-B"));
        assert.equal(button(view.render(), "Add registered batteries to group"), undefined);
        selectEntry(view, tagOf("DEMO-INTAKE-GROUP-B"), false);
        await confirmButton(view, "selected").props.onClick();
        button(view.render(), "Add registered batteries to group").props.onClick();
        const group = nodes(view.render()).find(node => node.type === "TeachingGroupsPanel");
        assert.equal(group.props.addToExisting, true);
        assert.deepEqual(group.props.initialIds, ["BAT-00000001"]);
        assert.equal(view.writes.length, 1); assert.equal(view.exits.length, 0);
        group.props.onClose(); assert.ok(scanPanel(view)); view.unmount();
    });
});
