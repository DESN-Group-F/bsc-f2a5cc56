import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

// Run the actual component handlers with controlled hooks and storage. These
// probes do not write to the user's inventory or claim browser validation.
const scratchRoot = new URL("../work/qa/", import.meta.url);
await mkdir(scratchRoot, { recursive: true });
const scratch = await mkdtemp(join(fileURLToPath(scratchRoot), "inspection-ui-"));
after(() => rm(scratch, { recursive: true, force: true }));
const names = ["teaching-nfc", "battery-inspections", "domain", "battery-age", "teaching-context", "client-utils", "location-catalog", "battery-lifecycle", "battery-movement-summary", "permissions"];
for (const name of names) {
    const source = await readFile(new URL(`../lib/${name}.ts`, import.meta.url), "utf8");
    const output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText.replace(/from "(\.\/[^\"]+)"/g, (_, specifier) => `from "${specifier}.mjs"`);
    await writeFile(join(scratch, `${name}.mjs`), output);
}
const modules = Object.assign({}, ...await Promise.all(names.map(name => import(pathToFileURL(join(scratch, `${name}.mjs`))))));
const helper = ts.transpileModule(await readFile(new URL("../components/inventory/inspection-request.ts", import.meta.url), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText.replace(/from "@\/lib\/battery-inspections"/, 'from "./battery-inspections.mjs"');
await writeFile(join(scratch, "inspection-request.mjs"), helper);
const recovery = await import(pathToFileURL(join(scratch, "inspection-request.mjs")));
const componentSource = ts.transpileModule(await readFile(new URL("../components/inventory/battery-history.tsx", import.meta.url), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } }).outputText.replace(/^import .*;\r?\n/gm, "").replace(/^export /gm, "");
const ui = Object.fromEntries(["Button", "Dialog", "DialogContent", "DialogDescription", "DialogFooter", "DialogHeader", "DialogTitle", "Input", "Label", "Textarea", "Skeleton", "ClipboardCheck", "Clock3", "Plus", "RefreshCw", "ArrowUpRight", "MotionDisclosure"].map(name => [name, name]));
const jsx = (type, props, key) => ({ type, props: props ?? {}, key });
function hooks() {
    const states = [], effects = [];
    let pointer = 0, effectIndex = 0, scheduled = [];
    return {
        reset() { pointer = 0; effectIndex = 0; scheduled = []; },
        useState(initial) { const index = pointer++; if (!(index in states)) states[index] = typeof initial === "function" ? initial() : initial; return [states[index], value => { states[index] = typeof value === "function" ? value(states[index]) : value; }]; },
        useRef(initial) { const index = pointer++; if (!(index in states)) states[index] = { current: initial }; return states[index]; },
        useEffect(callback, dependencies) { const index = effectIndex++, previous = effects[index]; if (!previous || dependencies.some((value, at) => value !== previous.dependencies[at])) scheduled.push(() => { previous?.cleanup?.(); effects[index] = { dependencies, cleanup: callback() }; }); },
        commit() { scheduled.forEach(callback => callback()); },
    };
}
function mount(name, props) {
    const state = hooks(), bindings = { ...modules, ...recovery, ...ui, ...state, styles: new Proxy({}, { get: (_, name) => name }), currentSydneyDate: () => "2026-10-06" }, names = Object.keys(bindings);
    const component = new Function(...names, "_jsx", "_jsxs", "_Fragment", `${componentSource}\nreturn ${name};`)(...names.map(name => bindings[name]), jsx, jsx, "Fragment");
    return { props, render() { state.reset(); const value = component(props); state.commit(); return value; } };
}
function nodes(value, result = []) { if (Array.isArray(value)) value.forEach(item => nodes(item, result)); else if (value && typeof value === "object") { result.push(value); nodes(value.props?.children, result); } return result; }
function text(value) { if (typeof value === "string" || typeof value === "number") return String(value); if (Array.isArray(value)) return value.map(text).join(""); return value && typeof value === "object" ? text(value.props?.children) : ""; }
function button(tree, label) { return nodes(tree).find(node => node.type === "Button" && text(node) === label); }
function input(tree, id) { return nodes(tree).find(node => node.props?.id === id && ["Input", "Textarea", "select"].includes(node.type)); }
function fill(view, values) { Object.entries(values).forEach(([key, value]) => input(view.render(), `inspection-${key}`).props.onChange({ target: { value } })); }
async function settled(view) { view.render(); await new Promise(resolve => setImmediate(resolve)); return view.render(); }
const battery = { id: "BAT-001", name: "Recorded battery", version: 3, lifecycleStatus: "active", lifecycleAt: null, registeredAt: "2026-01-05T01:00:00Z", manufacturedOn: null, firstUsedOn: "2026-01-05" };
const data = { dataset: "demo", user: { id: "native-staff", displayName: "Staff member", role: "staff" } };
const inspection = { id: "33333333-3333-4333-8333-333333333333", batteryId: battery.id, kind: "visual_check", outcome: "concern_observed", performedAt: "2026-10-05T01:00:00Z", recordedAt: "2026-10-05T02:00:00Z", inspectorAccountId: data.user.id, inspectorName: data.user.displayName, method: "Visual examination", notes: "Connector housing was loose.", reference: "Lab report 7", capacityMah: null, voidedAt: null, voidedByName: null, voidReason: null };
const detail = { battery, usageSummary: { asOf: "2026-10-05T02:00:00Z", totalCheckouts: 205, completedCheckouts: 204, activeCheckouts: 1, totalCheckedOutSeconds: 1512000, invalidDurationCount: 0 }, loans: ["recent-only"], inspections: [inspection], inspectionSummary: { totalRecords: 1, validRecords: 1, latest: inspection } };
function receipt(action, payload, overrides = {}) { return { requestId: payload.requestId, dataset: data.dataset, actorAccountId: data.user.id, batteryId: payload.batteryId, inspectionId: action === "inspection_void" ? payload.inspectionId : inspection.id, action, at: "2026-10-06T00:00:00Z", replayed: false, ...overrides }; }
async function withStorage(run) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage"), entries = new Map();
    const storage = { getItem: key => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, value), removeItem: key => entries.delete(key) };
    Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: storage });
    try { await run({ storage, entries }); } finally { if (previous) Object.defineProperty(globalThis, "sessionStorage", previous); else Reflect.deleteProperty(globalThis, "sessionStorage"); }
}
function form(write, overrides = {}) {
    const writes = [], saved = [], props = { draft: { kind: "new" }, pending: null, battery, data, onClose() {}, onPending(value) { props.pending = value; }, onSaved(action) { saved.push(action); }, async write(action, payload) { writes.push({ action, payload }); return write(action, payload); }, ...overrides };
    return { ...mount("InspectionForm", props), writes, saved, async submit() { await nodes(this.render()).find(node => node.type === "form").props.onSubmit({ preventDefault() {} }); } };
}

test("usage loading and failures never substitute a zero count or no-history claim", () => {
    for (const error of ["", "Offline"]) {
        const view = mount("BatteryAgeAndUsage", { battery, detail: null, error, onRetry() {} }), tree = view.render();
        assert.doesNotMatch(text(tree), /0 completed|Total checkouts0|No checkout/);
        assert.match(text(tree), error ? /Borrowing history could not be loaded/ : /Loading borrowing totals/);
    }
});

test("overview inspection summary exposes real concern evidence without assigning availability or certification", () => {
    let opened = 0;
    const view = mount("BatteryInspectionSummary", { detail, error: "", onViewEvidence() { opened += 1; } }), tree = view.render();
    assert.match(text(tree), /Concern observed/);
    assert.match(text(tree), /Connector housing was loose/);
    assert.match(text(tree), /not a safety certification/);
    button(tree, "View evidence").props.onClick();
    assert.equal(opened, 1);
    view.props.detail = null;
    view.props.error = "Offline";
    assert.match(text(view.render()), /Inspection evidence could not be loaded/);
    assert.doesNotMatch(text(view.render()), /No inspection recorded/);
});

test("inspection recovery reports pending state for a persistent notice outside its hidden detail section", async () => withStorage(async () => {
    const pending = { accountId: data.user.id, dataset: data.dataset, batteryId: battery.id, action: "inspection", payload: modules.inspectionSchema.parse({ requestId: crypto.randomUUID(), batteryId: battery.id, expectedBatteryVersion: battery.version, kind: "visual_check", outcome: "inconclusive", performedAt: inspection.performedAt }) };
    recovery.saveInspectionAttempt(pending);
    const statuses = [], view = mount("BatteryInspections", { battery, detail, data, error: "", write() {}, onChanged() {}, onRecoveryChange(value) { statuses.push(value); } });
    const tree = await settled(view);
    assert.deepEqual(statuses.at(-1), { ready: true, pending: true, error: "" });
    button(tree, "Review saved request").props.onClick();
    const form = nodes(view.render()).find(node => typeof node.type === "function" && node.type.name === "InspectionForm");
    assert.deepEqual(form.props.pending, pending);
    form.props.onPending(null);
    view.render();
    assert.deepEqual(statuses.at(-1), { ready: true, pending: false, error: "" });
}));

test("usage displays complete server totals and fixed as-of time separately from cycles and health", () => {
    const view = mount("BatteryAgeAndUsage", { battery, detail, error: "", onRetry() {} }), tree = view.render();
    assert.match(text(tree), /Total checkouts205/);
    assert.match(text(tree), /17d 12h/);
    assert.match(text(tree), /204 completed · 1 current/);
    assert.match(text(tree), /05 Oct 2026, 13:00/);
    assert.match(text(tree), /Refresh details to update/);
    assert.match(text(tree), /do not measure charge\/discharge cycles/);
    assert.match(text(tree), /Manufactured onNot recorded/);
    view.props.detail = { ...detail, usageSummary: { ...detail.usageSummary, totalCheckedOutSeconds: null, invalidDurationCount: 2 } };
    assert.match(text(view.render()), /Total checked-out timeNot available/);
    assert.match(text(view.render()), /2 checkout records have missing or invalid times/);
});

test("retired service age stops at the recorded Sydney date and cannot substitute manufacture age", () => {
    const retired = { ...battery, firstUsedOn: "2026-01-05", lifecycleStatus: "scrapped", lifecycleAt: "2026-01-06T14:00:00Z" };
    const view = mount("BatteryAgeAndUsage", { battery: retired, detail, error: "", onRetry() {} });
    assert.match(text(view.render()), /Time in service2 days/);
    assert.match(text(view.render()), /ends at retirement \/ permanent removal on 07 Jan 2026/);
    assert.match(text(view.render()), /Age since manufactureNot recorded/);
    view.props.battery = { ...retired, lifecycleAt: null };
    assert.match(text(view.render()), /Time in serviceNot available/);
});

test("staff can record inspections; only admins see correction controls, including retired records", async () => withStorage(async () => {
    for (const role of ["staff", "admin"]) {
        const view = mount("BatteryInspections", { battery, detail, data: { ...data, user: { ...data.user, role } }, error: "", write() {}, onChanged() {} });
        let tree = await settled(view);
        assert.equal(button(tree, "Record inspection").props.disabled, false);
        button(tree, "View inspection history (1)").props.onClick();
        tree = view.render();
        assert.equal(!!button(tree, "Mark entered in error"), role === "admin");
        assert.match(text(tree), /Connector housing was loose/);
        view.props.battery = { ...battery, lifecycleStatus: "scrapped" };
        assert.equal(button(view.render(), "Record inspection"), undefined);
        assert.equal(!!button(view.render(), "Mark entered in error"), role === "admin");
    }
}));

test("inspection outcomes are explicit; concern notes and measured capacity conditions are required", async () => withStorage(async ({ entries }) => {
    const view = form(receipt);
    assert.equal(input(view.render(), "inspection-outcome").props.value, "");
    fill(view, { outcome: "concern_observed", time: "2026-10-05T10:00" });
    await view.submit();
    assert.equal(view.writes.length, 0);
    assert.equal(entries.size, 0);
    fill(view, { kind: "capacity_measurement", outcome: "inconclusive", capacity: "2100" });
    await view.submit();
    assert.equal(view.writes.length, 0);
    fill(view, { method: "Tester A, controlled discharge to the manufacturer's specified cutoff." });
    await view.submit();
    assert.equal(view.writes.length, 1);
    assert.equal(view.writes[0].payload.capacityMah, 2100);
    assert.equal(view.writes[0].payload.expectedBatteryVersion, 3);
    assert.deepEqual(view.saved, ["inspection"]);
    assert.equal(entries.size, 0);
}));

test("uncertain inspection survives dialog close and reload with exactly the original payload and request ID", async () => withStorage(async ({ entries }) => {
    const first = form(() => { throw new TypeError("Connection interrupted"); });
    fill(first, { outcome: "no_concern_observed", time: "2026-10-05T10:00", notes: "Housing and connector checked." });
    await first.submit();
    const original = structuredClone(first.writes[0]);
    assert.equal(entries.size, 1);
    assert.ok(button(first.render(), "Close and keep request"));
    assert.equal(input(first.render(), "inspection-notes"), undefined);
    const recovered = recovery.readInspectionAttempt(data.user.id, data.dataset, battery.id);
    assert.equal(recovered.error, "");
    const next = form((action, payload) => receipt(action, payload, { replayed: true }), { pending: recovered.input, draft: { kind: "resume" }, battery: { ...battery, version: 50, lifecycleStatus: "scrapped" } });
    await next.submit();
    assert.deepEqual(next.writes[0], original);
    assert.deepEqual(next.saved, ["inspection"]);
    assert.equal(entries.size, 0);
}));

test("a mismatched successful receipt is uncertain and never announces success or unlocks a new write", async () => withStorage(async ({ entries }) => {
    const view = form((action, payload) => receipt(action, payload, { actorAccountId: "different-account" }));
    fill(view, { outcome: "inconclusive", time: "2026-10-05T10:00" });
    await view.submit();
    assert.equal(entries.size, 1);
    assert.deepEqual(view.saved, []);
    assert.match(text(view.render()), /The result is uncertain/);
    assert.ok(button(view.render(), "Retry original request"));
}));

test("terminal rejection clears recovery but preserves the draft and prevents silent version rebinding", async () => withStorage(async ({ entries }) => {
    const view = form(() => { throw Object.assign(new Error("Battery changed"), { status: 409, code: "inspection_rejected_final" }); });
    fill(view, { outcome: "inconclusive", time: "2026-10-05T10:00", notes: "Original reviewed input" });
    await view.submit();
    assert.equal(entries.size, 0);
    assert.equal(input(view.render(), "inspection-notes").props.value, "Original reviewed input");
    assert.equal(button(view.render(), "Save inspection").props.disabled, true);
    view.props.battery = { ...battery, version: 4 };
    await view.submit();
    assert.equal(view.writes.length, 1);
}));

test("ordinary conflict and authentication failures remain unresolved until an exact retry confirms a result", async () => withStorage(async ({ entries }) => {
    for (const [status, code] of [[409, "idempotency_conflict"], [401, undefined], [403, undefined]]) {
        const view = form(() => { throw Object.assign(new Error("Cannot verify"), { status, code }); });
        fill(view, { outcome: "inconclusive", time: "2026-10-05T10:00" });
        await view.submit();
        assert.equal(entries.size, 1);
        assert.ok(button(view.render(), "Retry original request"));
        entries.clear();
    }
}));

test("a recovered request rejected finally still displays its original fields and correction intent", async () => withStorage(async () => {
    for (const action of ["inspection", "inspection_void"]) {
        const payload = action === "inspection" ? modules.inspectionSchema.parse({ requestId: crypto.randomUUID(), batteryId: battery.id, expectedBatteryVersion: 3, kind: "functional_check", outcome: "inconclusive", performedAt: "2026-10-05T01:00:00Z", notes: "Original saved inspection." }) : modules.inspectionVoidSchema.parse({ requestId: crypto.randomUUID(), batteryId: battery.id, inspectionId: inspection.id, reason: "Original correction reason." });
        const pending = { accountId: data.user.id, dataset: data.dataset, batteryId: battery.id, action, payload };
        recovery.saveInspectionAttempt(pending);
        const view = form(() => { throw Object.assign(new Error("Reviewed record changed"), { status: 409, code: "inspection_rejected_final" }); }, { draft: { kind: "resume" }, pending, data: { ...data, user: { ...data.user, role: "admin" } } });
        await view.submit();
        if (action === "inspection") {
            assert.equal(input(view.render(), "inspection-notes").props.value, "Original saved inspection.");
            assert.equal(input(view.render(), "inspection-kind").props.value, "functional_check");
            assert.equal(button(view.render(), "Save inspection").props.disabled, true);
        } else {
            assert.equal(input(view.render(), "inspection-void-reason").props.value, "Original correction reason.");
            assert.equal(button(view.render(), "Confirm correction").props.disabled, true);
            assert.match(text(view.render()), /Mark inspection entered in error/);
        }
    }
}));

test("corrupt or inaccessible storage blocks new records before a network write", async () => withStorage(async ({ entries, storage }) => {
    const key = recovery.inspectionStorageKey(data.user.id, data.dataset, battery.id);
    entries.set(key, "invalid JSON");
    const panel = mount("BatteryInspections", { battery, detail, data, error: "", write() {}, onChanged() {} });
    assert.equal(button(await settled(panel), "Record inspection").props.disabled, true);
    assert.match(text(panel.render()), /New inspection changes are blocked/);
    entries.clear();
    storage.setItem = () => { throw new Error("Quota exceeded"); };
    const view = form(receipt);
    fill(view, { outcome: "inconclusive", time: "2026-10-05T10:00" });
    await view.submit();
    assert.equal(view.writes.length, 0);
    assert.match(text(view.render()), /Quota exceeded/);
}));

test("inspection recovery cannot cross native account, dataset or battery identity", async () => withStorage(async ({ entries }) => {
    const input = { accountId: data.user.id, dataset: "demo", batteryId: battery.id, action: "inspection", payload: modules.inspectionSchema.parse({ requestId: crypto.randomUUID(), batteryId: battery.id, expectedBatteryVersion: 3, kind: "visual_check", outcome: "inconclusive", performedAt: "2026-10-05T01:00:00Z" }) };
    recovery.saveInspectionAttempt(input);
    for (const [accountId, dataset, batteryId] of [["other", "demo", battery.id], [data.user.id, "live", battery.id], [data.user.id, "demo", "BAT-002"]]) {
        assert.equal(recovery.readInspectionAttempt(accountId, dataset, batteryId).input, null);
        entries.set(recovery.inspectionStorageKey(accountId, dataset, batteryId), JSON.stringify(input));
        assert.match(recovery.readInspectionAttempt(accountId, dataset, batteryId).error, /could not be recovered/);
    }
}));

test("failure to clear a confirmed request retains recovery and does not report completed cleanup", async () => withStorage(async ({ storage, entries }) => {
    storage.removeItem = () => {};
    const view = form(receipt);
    fill(view, { outcome: "inconclusive", time: "2026-10-05T10:00" });
    await view.submit();
    assert.equal(entries.size, 1);
    assert.deepEqual(view.saved, []);
    assert.ok(button(view.render(), "Retry original request"));
}));

test("admin correction uses the original inspection ID and reason; staff cannot submit it", async () => withStorage(async ({ entries }) => {
    for (const role of ["staff", "admin"]) {
        const account = { ...data, user: { ...data.user, role } }, view = form(receipt, { draft: { kind: "void", record: inspection }, data: account, battery: { ...battery, lifecycleStatus: "scrapped" } });
        fill(view, { "void-reason": "The entry referred to a different battery." });
        await view.submit();
        assert.equal(view.writes.length, role === "admin" ? 1 : 0);
        if (role === "admin") { assert.equal(view.writes[0].action, "inspection_void"); assert.equal(view.writes[0].payload.inspectionId, inspection.id); }
        assert.equal(entries.size, 0);
    }
}));

test("voided inspections retain original findings and attribution while no current inspection is claimed", async () => withStorage(async () => {
    const record = { ...inspection, voidedAt: "2026-10-06T00:00:00Z", voidedByName: "Administrator", voidReason: "Wrong battery selected." }, view = mount("BatteryInspections", { battery, detail: { ...detail, inspections: [record], inspectionSummary: { totalRecords: 1, validRecords: 0, latest: null } }, data, error: "", write() {}, onChanged() {} });
    let tree = await settled(view);
    assert.match(text(tree), /No current inspection record/);
    button(tree, "View inspection history (1)").props.onClick();
    tree = view.render();
    assert.match(text(tree), /Original outcome: Concern observed/);
    assert.match(text(tree), /Connector housing was loose/);
    assert.match(text(tree), /by Administrator. Reason: Wrong battery selected/);
}));
