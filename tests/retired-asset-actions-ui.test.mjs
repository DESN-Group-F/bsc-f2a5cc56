import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

// Actual history/dialog handlers with controlled hooks and tab recovery. These
// probes establish request and selection behavior, not browser geometry or safety.
const scratchRoot = new URL("../work/qa/", import.meta.url);
await mkdir(scratchRoot, { recursive: true });
const scratch = await mkdtemp(join(fileURLToPath(scratchRoot), "retired-ui-"));
after(() => rm(scratch, { recursive: true, force: true }));
const names = ["teaching-context", "domain", "battery-age", "location-catalog", "battery-lifecycle", "new-arrivals", "inventory-query", "battery-selection-query", "client-utils", "permissions", "retired-asset-actions"];
for (const name of names) {
  const source = await readFile(new URL(`../lib/${name}.ts`, import.meta.url), "utf8");
  await writeFile(join(scratch, `${name}.mjs`), ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText.replace(/from "(\.\/[^\"]+)"/g, (_, path) => `from "${path}.mjs"`));
}
const libraries = Object.assign({}, ...await Promise.all(names.map(name => import(pathToFileURL(join(scratch, `${name}.mjs`))))));
const rowSource = await readFile(new URL("../lib/client/row-selection.ts", import.meta.url), "utf8");
await writeFile(join(scratch, "row-selection.mjs"), ts.transpileModule(rowSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText);
Object.assign(libraries, await import(pathToFileURL(join(scratch, "row-selection.mjs"))));
const sources = Object.fromEntries(await Promise.all(["removal-station", "retired-asset-action-dialog"].map(async name => [name, ts.transpileModule(await readFile(new URL(`../components/inventory/${name}.tsx`, import.meta.url), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } }).outputText.replace(/^import .*;\r?\n/gm, "").replace(/^export /gm, "")])));
const ui = Object.fromEntries(["Button", "ReceiptAction", "MotionDisclosure", "Input", "Label", "Checkbox", "BatteryFilterControls", "Table", "TableBody", "TableCell", "TableHead", "TableHeader", "TableRow", "RetiredAssetActionDialog", "Dialog", "DialogContent", "DialogDescription", "DialogFooter", "DialogHeader", "DialogTitle"].map(name => [name, name]));
ui.styles = ui.historyStyles = new Proxy({}, { get: (_, key) => String(key) });
const jsx = (type, props, key) => ({ type, props: props ?? {}, key });
function hooks() {
  const values = [], effects = []; let index = 0, effectIndex = 0, scheduled = [];
  return {
    reset() { index = 0; effectIndex = 0; scheduled = []; },
    useState(initial) { const key = index++; if (!(key in values)) values[key] = typeof initial === "function" ? initial() : initial; return [values[key], update => { values[key] = typeof update === "function" ? update(values[key]) : update; }]; },
    useRef(initial) { const key = index++; if (!(key in values)) values[key] = { current: initial }; return values[key]; },
    useEffect(callback, dependencies) { const key = effectIndex++, previous = effects[key]; if (!previous || !dependencies || dependencies.some((value, position) => !Object.is(value, previous.dependencies?.[position]))) scheduled.push(() => { previous?.cleanup?.(); effects[key] = { dependencies, cleanup: callback() }; }); },
    commit() { scheduled.forEach(callback => callback()); }, unmount() { effects.forEach(effect => effect?.cleanup?.()); },
  };
}
function nodes(tree, result = []) { if (Array.isArray(tree)) tree.forEach(item => nodes(item, result)); else if (tree && typeof tree === "object") { result.push(tree); nodes(tree.props?.children, result); } return result; }
function text(tree) { return typeof tree === "string" || typeof tree === "number" ? String(tree) : Array.isArray(tree) ? tree.map(text).join("") : tree && typeof tree === "object" ? text(tree.props?.children) : ""; }
const button = (tree, label) => nodes(tree).find(node => ["Button", "ReceiptAction"].includes(node.type) && text(node) === label);
const receiptButton = view => nodes(view.render()).find(node => node.type === "ReceiptAction");
const filters = view => nodes(view.render()).find(node => node.type === "BatteryFilterControls");
const select = (view, id, checked = true) => nodes(view.render()).find(node => node.type === "Checkbox" && node.props["aria-label"] === `Select retired battery ${id}`).props.onCheckedChange(checked);
const at = "2026-10-08T03:00:00.000Z";
function battery(id, status = "scrapped") { return { id, name: `Recorded asset ${id}`, version: 4, tagId: id === "BAT-B" ? null : `TAG-${id}`, chemistry: "LiPo", model: "Recorded model", capacityMah: 2200, voltage: 11.1, ownerName: "Staff owner", ownerId: "staff-native-actor", ownerAccountId: "native-actor", loanId: null, homeBuildingId: "J18", homeBuildingName: "Willis Annexe", homeRoomId: null, manufacturedOn: null, firstUsedOn: null, registeredAt: at, lifecycleStatus: status, lifecycleAt: at, lifecycleReason: status === "permanently_removed" ? "Transferred" : "Staff retirement", lifecycleDestination: status === "permanently_removed" ? "Receiving laboratory" : null }; }
function fixture(role = "staff", dataset = "live") { return { user: { id: "native-actor", role, username: "operator" }, dataset, batteries: [battery("BAT-A"), battery("BAT-B"), battery("BAT-C", "permanently_removed"), battery("BAT-ACTIVE", "active")], people: [], rooms: [], buildings: [], staffDirectory: [], teachingGroups: [] }; }
function result(payload, overrides = {}) { return { requestId: payload.requestId, dataset: "live", actorAccountId: "native-actor", kind: payload.kind, at, replayed: false, items: payload.items.map(item => ({ batteryId: item.batteryId, version: item.version + 1, status: payload.kind === "recover" ? "active" : "deleted" })), ...overrides }; }
async function environment(run, seed = []) {
  const descriptors = Object.fromEntries(["sessionStorage", "window", "Element"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const entries = new Map(seed), failures = { read: false, write: false, remove: false }, events = []; let selection = null;
  class ElementStub { constructor(interactive = false) { this.interactive = interactive; } closest() { return this.interactive ? this : null; } contains() { return true; } }
  Object.defineProperty(globalThis, "Element", { configurable: true, value: ElementStub });
  Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: { getItem(key) { if (failures.read) throw new Error("Recovery read unavailable"); return entries.get(key) ?? null; }, setItem(key, value) { if (failures.write) throw new Error("Recovery write unavailable"); entries.set(key, value); }, removeItem(key) { if (failures.remove) throw new Error("Recovery cleanup unavailable"); entries.delete(key); } } });
  Object.defineProperty(globalThis, "window", { configurable: true, value: { dispatchEvent(event) { events.push(event.type); }, getSelection() { return selection; } } });
  try { await run({ entries, failures, events, event: (interactive = false) => ({ target: new ElementStub(interactive), currentTarget: new ElementStub(), defaultPrevented: false, button: 0 }), setTextSelection(active) { selection = active ? { isCollapsed: false, anchorNode: {}, focusNode: {} } : null; } }); }
  finally { for (const [key, descriptor] of Object.entries(descriptors)) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); } }
}
function mount(component = "RemovalHistory", overrides = {}) {
  const state = hooks(), writes = [], changes = [], details = [], downloads = [], locks = [], outcomes = [], closes = [];
  const data = fixture(), props = { data, review: { kind: "recover", batteries: data.batteries.slice(0, 2) }, onDetail: id => details.push(id), onDownload: ids => downloads.push([...ids]), onChanged: () => changes.push(true), onBusyChange: value => locks.push(value), onVerified: value => outcomes.push(value), onClose: () => closes.push(true), async write(action, payload) { writes.push({ action, payload: structuredClone(payload) }); return result(payload, { dataset: props.data.dataset }); }, ...overrides };
  const bindings = { ...libraries, ...ui, ...state }, keys = Object.keys(bindings);
  const Component = new Function(...keys, "_jsx", "_jsxs", "_Fragment", `${sources[component === "RemovalHistory" ? "removal-station" : "retired-asset-action-dialog"]}\nreturn ${component};`)(...keys.map(key => bindings[key]), jsx, jsx, "Fragment");
  return { props, writes, changes, details, downloads, locks, outcomes, closes, render() { state.reset(); const tree = Component(props); state.commit(); return tree; }, unmount: state.unmount };
}

test("history preserves cross-filter selection, exact matching/selected exports and independent details", async () => environment(async () => {
  const view = mount(); select(view, "BAT-A"); filters(view).props.onChange({ search: "BAT-B" }); button(view.render(), "Select matching").props.onClick();
  assert.match(text(view.render()), /2 selected.*1 matching records.*1 selected outside current filters/);
  button(view.render(), "Download matching records").props.onClick(); button(view.render(), "Download selected records").props.onClick();
  assert.deepEqual(view.downloads, [["BAT-B"], ["BAT-A", "BAT-B"]]);
  nodes(view.render()).find(node => node.type === "button" && text(node) === "BAT-B").props.onClick(); assert.deepEqual(view.details, ["BAT-B"]);
  filters(view).props.onClear(); assert.match(text(view.render()), /2 selected.*3 matching records/);
  button(view.render(), "Clear selections").props.onClick(); assert.match(text(view.render()), /0 selected/); view.unmount();
}));

test("history row selection excludes embedded controls and deliberate text selection", async () => environment(async ({ event, setTextSelection }) => {
  const view = mount(), row = () => nodes(view.render()).find(node => node.type === "TableRow" && node.key === "BAT-A");
  row().props.onClick(event()); assert.equal(row().props["aria-selected"], true);
  row().props.onClick(event(true)); assert.equal(row().props["aria-selected"], true);
  setTextSelection(true); row().props.onClick(event()); assert.equal(row().props["aria-selected"], true);
  setTextSelection(false); row().props.onClick(event()); assert.equal(row().props["aria-selected"], false); view.unmount();
}));

test("history roles and terminal-state boundaries preserve downloads without silent action subsets", async () => environment(async () => {
  const view = mount(); select(view, "BAT-A"); assert.equal(button(view.render(), "Recover selected (1)").props.disabled, false);
  assert.equal(button(view.render(), "Delete selected records (1)"), undefined);
  select(view, "BAT-C"); assert.equal(button(view.render(), "Recover selected (2)").props.disabled, true); button(view.render(), "Recover selected (2)").props.onClick();
  assert.equal(nodes(view.render()).some(node => node.type === "RetiredAssetActionDialog"), false);
  view.props.data.user.role = "admin"; assert.equal(button(view.render(), "Delete selected records (2)").props.disabled, true);
  select(view, "BAT-C", false); button(view.render(), "Delete selected records (1)").props.onClick();
  const review = nodes(view.render()).find(node => node.type === "RetiredAssetActionDialog").props.review;
  assert.equal(review.kind, "purge"); assert.deepEqual(review.batteries.map(record => [record.id, record.version, record.tagId]), [["BAT-A", 4, "TAG-BAT-A"]]); view.unmount();
}));

test("history operation cap retains every selected export and account switch clears scope", async () => environment(async () => {
  const data = fixture("admin"); data.batteries = Array.from({ length: 101 }, (_, index) => battery(`BAT-${index}`));
  const view = mount("RemovalHistory", { data }); button(view.render(), "Select matching").props.onClick();
  assert.equal(button(view.render(), "Recover selected (101)").props.disabled, true); assert.equal(button(view.render(), "Delete selected records (101)").props.disabled, true);
  button(view.render(), "Download selected records").props.onClick(); assert.equal(view.downloads[0].length, 101);
  view.props.data = { ...data, user: { ...data.user, id: "other-native-actor" } }; view.render(); assert.match(text(view.render()), /0 selected/); view.unmount();
}));

test("purge requires current administrator, exact DELETE and an explicit reviewed request", async () => environment(async ({ entries }) => {
  const data = fixture("admin"), view = mount("RetiredAssetActionDialog", { data, review: { kind: "purge", batteries: data.batteries.slice(0, 2) } });
  assert.match(text(view.render()), /irreversible/); assert.match(text(view.render()), /complete history/); assert.equal(receiptButton(view).props.disabled, true);
  const confirmation = () => nodes(view.render()).find(node => node.type === "Input" && node.props.id === "retired-delete-confirmation");
  confirmation().props.onChange({ target: { value: "delete" } }); await receiptButton(view).props.onClick(); assert.equal(view.writes.length, 0);
  confirmation().props.onChange({ target: { value: "DELETE" } }); view.props.data.user.role = "staff"; await receiptButton(view).props.onClick(); assert.equal(view.writes.length, 0);
  view.props.data.user.role = "admin"; await receiptButton(view).props.onClick();
  assert.equal(view.writes[0].action, "retired_asset"); assert.equal(view.writes[0].payload.kind, "purge"); assert.equal(receiptButton(view).props.confirmation.count, 2); assert.equal(entries.size, 0); view.unmount();
}));

test("new reviews retain immutable IDs/version/tag and block stale, nonscrapped or duplicate inputs", async () => environment(async () => {
  for (const mutation of [data => { data.batteries[0].version++; }, data => { data.batteries[0].tagId = "CHANGED-TAG"; }, data => { data.batteries[0].lifecycleStatus = "active"; }]) {
    const view = mount("RetiredAssetActionDialog"); view.render(); mutation(view.props.data); assert.equal(receiptButton(view).props.disabled, true); await receiptButton(view).props.onClick(); assert.equal(view.writes.length, 0); view.unmount();
  }
  const data = fixture(), view = mount("RetiredAssetActionDialog", { data, review: { kind: "recover", batteries: [data.batteries[2]] } }); await receiptButton(view).props.onClick(); assert.equal(view.writes.length, 0); view.unmount();
}));

test("unknown response persists before sending and reopens without auto-submit; retry uses original bindings", async () => environment(async ({ entries, events }) => {
  let sent, before;
  const view = mount("RetiredAssetActionDialog", { async write(action, payload) { sent = structuredClone(payload); before = JSON.parse(entries.get(libraries.retiredAssetStorageKey("native-actor", "live"))); throw new Error("Response lost"); } });
  await receiptButton(view).props.onClick(); assert.deepEqual(before.payload, sent); assert.equal(receiptButton(view).props.confirmation, null); assert.equal(button(view.render(), "Cancel").props.disabled, true); view.unmount();
  const history = mount(); const restored = nodes(history.render()).find(node => node.type === "RetiredAssetActionDialog").props.review;
  assert.deepEqual(restored.attempt.payload, sent); assert.equal(history.writes.length, 0);
  const next = mount("RetiredAssetActionDialog", { review: restored }); next.props.data.batteries[0].version = 99; next.props.data.batteries[0].tagId = "LATER-TAG"; next.props.data.batteries[0].lifecycleStatus = "active";
  await receiptButton(next).props.onClick(); assert.deepEqual(next.writes[0].payload, sent); assert.equal(receiptButton(next).props.confirmation.identity, sent.requestId); assert.equal(entries.size, 0); assert.ok(events.every(event => event === "battery-retired-action-recovery")); next.unmount(); history.unmount();
}));

test("mismatched receipt remains unknown and exact retry resolves only its original request", async () => environment(async ({ entries }) => {
  let first;
  const view = mount("RetiredAssetActionDialog", { async write(action, payload) { first = structuredClone(payload); return result(payload, { requestId: crypto.randomUUID() }); } });
  await receiptButton(view).props.onClick(); assert.equal(receiptButton(view).props.confirmation, null); assert.equal(entries.size, 1); assert.match(text(view.render()), /does not match/);
  view.props.write = async (action, payload) => { assert.deepEqual(payload, first); return result(payload); };
  await receiptButton(view).props.onClick(); assert.equal(receiptButton(view).props.confirmation.count, 2); assert.equal(entries.size, 0); view.unmount();
}));

test("verified outcomes remain confirmed when refresh fails and cannot be submitted again", async () => environment(async ({ entries }) => {
  const view = mount("RetiredAssetActionDialog", { onChanged() { throw new Error("Snapshot unavailable"); } });
  await receiptButton(view).props.onClick(); assert.equal(receiptButton(view).props.confirmation.count, 2); assert.equal(view.outcomes.length, 1); assert.equal(entries.size, 0);
  assert.match(text(view.render()), /outcome is confirmed.*could not refresh/); await receiptButton(view).props.onClick(); assert.equal(view.writes.length, 1);
  button(view.render(), "Close review").props.onClick(); assert.equal(view.closes.length, 1); view.unmount();
}));

test("unavailable recovery storage blocks sending and restoration preserves the original UUID", async () => environment(async ({ entries, failures }) => {
  const view = mount("RetiredAssetActionDialog"); failures.write = true; await receiptButton(view).props.onClick(); assert.equal(view.writes.length, 0); assert.match(text(view.render()), /No request was sent/);
  assert.equal(button(view.render(), "Cancel").props.disabled, true); failures.write = false; button(view.render(), "Restore request recovery").props.onClick();
  const captured = JSON.parse([...entries.values()][0]); assert.equal(view.writes.length, 0); await receiptButton(view).props.onClick(); assert.deepEqual(view.writes[0].payload, captured.payload); view.unmount();
}));

test("receipt success survives cleanup failure; recovery cleanup never repeats the business write", async () => environment(async ({ entries, failures }) => {
  const view = mount("RetiredAssetActionDialog"); failures.remove = true; await receiptButton(view).props.onClick();
  assert.equal(receiptButton(view).props.confirmation.count, 2); assert.equal(entries.size, 1); assert.equal(button(view.render(), "Close review").props.disabled, true);
  failures.remove = false; button(view.render(), "Restore request recovery").props.onClick(); assert.equal(entries.size, 0); assert.equal(view.writes.length, 1); assert.equal(button(view.render(), "Close review").props.disabled, false); view.unmount();
}));

test("only terminal rejection releases the preserved request; authorization/transport errors remain unknown", async () => environment(async ({ entries }) => {
  for (const [status, code, terminal] of [[409, "retired_asset_rejected_final", true], [403, "forbidden", false], [500, "unavailable", false], [409, "conflict", false]]) {
    entries.clear(); const view = mount("RetiredAssetActionDialog", { async write() { throw Object.assign(new Error("Rejected response"), { status, code }); } }); await receiptButton(view).props.onClick();
    assert.equal(entries.size, terminal ? 0 : 1); assert.equal(receiptButton(view).props.confirmation, null); assert.equal(receiptButton(view).props.disabled, terminal); view.unmount();
  }
}));

test("busy duplicate invocation and context changes cannot produce a second write or cross-account refresh", async () => environment(async ({ entries }) => {
  let settle, calls = 0;
  const view = mount("RetiredAssetActionDialog", { write(action, payload) { calls++; return new Promise(resolve => { settle = () => resolve(result(payload)); }); } });
  const request = receiptButton(view).props.onClick(); await receiptButton(view).props.onClick(); assert.equal(calls, 1);
  view.props.data = { ...view.props.data, user: { ...view.props.data.user, id: "different-native-account" } }; view.render(); settle(); await request;
  assert.equal(view.changes.length, 0); assert.equal(view.outcomes.length, 0); assert.equal(receiptButton(view).props.confirmation, null); assert.equal(entries.size, 0); view.unmount();
}));

test("malformed saved request blocks new history actions without rewriting the evidence", async () => environment(async ({ entries }) => {
  const key = libraries.retiredAssetStorageKey("native-actor", "live"); entries.set(key, "broken request evidence");
  const view = mount(); assert.match(text(view.render()), /could not be read/); select(view, "BAT-A"); assert.match(text(view.render()), /0 selected/); assert.equal(entries.get(key), "broken request evidence"); assert.equal(view.locks.at(-1), true); view.unmount();
}));

test("minimum deletion evidence stays outside retired counts, choices and full-history exports", async () => environment(async () => {
  const data = fixture(); data.purgedBatteries = [{ id: "BAT-DELETED", actorAccountId: "deleting-native-account", at }];
  const view = mount("RemovalHistory", { data }); assert.match(text(view.render()), /3 matching records/); assert.match(text(view.render()), /Deletion evidence.*BAT-DELETED.*deleting-native-account/);
  assert.equal(nodes(view.render()).some(node => node.type === "Checkbox" && node.props["aria-label"] === "Select retired battery BAT-DELETED"), false);
  button(view.render(), "Download matching records").props.onClick(); assert.deepEqual(view.downloads[0], ["BAT-A", "BAT-B", "BAT-C"]); view.unmount();
}));

test("a recovered purge request can resolve after its assets disappeared while retaining every reviewed ID", async () => environment(async ({ entries }) => {
  const attempt = libraries.captureRetiredAssetAttempt("native-actor", "live", { requestId: crypto.randomUUID(), kind: "purge", items: [{ batteryId: "BAT-ALREADY-DELETED", version: 4, tagId: null }] });
  entries.set(libraries.retiredAssetStorageKey("native-actor", "live"), JSON.stringify(attempt));
  const data = fixture("admin"), history = mount("RemovalHistory", { data }); const review = nodes(history.render()).find(node => node.type === "RetiredAssetActionDialog").props.review;
  assert.equal(review.batteries.length, 0); const dialog = mount("RetiredAssetActionDialog", { data, review }); assert.equal(receiptButton(dialog).props.disabled, false);
  await receiptButton(dialog).props.onClick(); assert.deepEqual(dialog.writes[0].payload, attempt.payload); assert.equal(receiptButton(dialog).props.confirmation.count, 1);
  const rows = nodes(dialog.render()).filter(node => node.type === "TableRow" && node.key === "BAT-ALREADY-DELETED"); assert.equal(rows.length, 1); assert.match(text(rows[0]), /Version 4.*No tag registered.*Scrapped/);
  assert.equal(entries.size, 0); dialog.unmount(); history.unmount();
}));
