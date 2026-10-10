import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, posix } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

// Execute the complete current application and its real history/action handlers
// with controlled React/transport boundaries. No browser or business DB is used.
const scratchRoot = new URL("../work/qa/", import.meta.url);
await mkdir(scratchRoot, { recursive: true });
const scratch = await mkdtemp(join(fileURLToPath(scratchRoot), "retired-app-"));
after(() => { assert.ok(scratch.startsWith(fileURLToPath(scratchRoot))); return rm(scratch, { recursive: true, force: true }); });
const compiled = new Map();
async function compileLibrary(name) {
  if (compiled.has(name)) return compiled.get(name);
  const destination = join(scratch, `${name}.mjs`); compiled.set(name, destination);
  const source = await readFile(new URL(`../lib/${name}.ts`, import.meta.url), "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  for (const match of output.matchAll(/from "(\.[^"]+)"/g)) await compileLibrary(posix.normalize(posix.join(posix.dirname(name), match[1])));
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, output.replace(/from "(\.[^"]+)"/g, (_, path) => `from "${path}.mjs"`));
  return destination;
}
const libraries = {};
for (const name of ["client/workflow-recovery", "browser-tools", "permissions", "inventory-query", "client/inventory-request", "retired-asset-actions", "client-utils", "battery-selection-query", "client/row-selection", "removal-draft", "movement-session", "group-maintenance", "client/teaching-checkout-request", "client/teaching-checkout-draft", "client/teaching-checkout-download"]) Object.assign(libraries, await import(pathToFileURL(await compileLibrary(name))));
const ui = {}, sources = {};
for (const [name, file] of [["InventoryApp", "app/inventory-app.tsx"], ["RemovalHistory", "components/inventory/removal-station.tsx"], ["RetiredAssetActionDialog", "components/inventory/retired-asset-action-dialog.tsx"], ["RecoveryNotices", "components/application/recovery-notices.tsx"]]) {
  const source = await readFile(new URL(`../${file}`, import.meta.url), "utf8");
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  for (const statement of parsed.statements.filter(ts.isImportDeclaration)) {
    if (statement.importClause?.name) ui[statement.importClause.name.text] = statement.importClause.name.text;
    for (const binding of statement.importClause?.namedBindings?.elements ?? []) ui[binding.name.text] = binding.name.text;
  }
  const withoutImports = parsed.statements.filter(statement => !ts.isImportDeclaration(statement)).map(statement => statement.getFullText(parsed)).join("\n");
  sources[name] = ts.transpileModule(withoutImports, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } }).outputText.replace(/^import .*;\r?\n/gm, "").replace(/^export default /gm, "").replace(/^export /gm, "");
}
ui.styles = ui.historyStyles = new Proxy({}, { get: (_, key) => String(key) });
const jsx = (type, props, key) => ({ type, props: props ?? {}, key });
function hooks() {
  const values = [], setters = [], effects = []; let index = 0, effectIndex = 0, scheduled = [];
  return {
    reset() { index = 0; effectIndex = 0; scheduled = []; },
    useState(initial) { const key = index++; if (!(key in values)) { values[key] = typeof initial === "function" ? initial() : initial; setters[key] = update => { values[key] = typeof update === "function" ? update(values[key]) : update; }; } return [values[key], setters[key]]; },
    useRef(initial) { const key = index++; if (!(key in values)) values[key] = { current: initial }; return values[key]; },
    useCallback(callback) { return callback; },
    useEffect(callback, dependencies) { const key = effectIndex++, previous = effects[key]; if (!previous || !dependencies || dependencies.some((value, position) => !Object.is(value, previous.dependencies?.[position]))) scheduled.push(() => { previous?.cleanup?.(); effects[key] = { dependencies, cleanup: callback() }; }); },
    commit() { scheduled.forEach(callback => callback()); }, unmount() { effects.forEach(effect => effect?.cleanup?.()); },
  };
}
function nodes(tree, result = []) { if (Array.isArray(tree)) tree.forEach(item => nodes(item, result)); else if (tree && typeof tree === "object") { result.push(tree); nodes(tree.props?.children, result); } return result; }
function text(tree) { return typeof tree === "string" || typeof tree === "number" ? String(tree) : Array.isArray(tree) ? tree.map(text).join("") : tree && typeof tree === "object" ? text(tree.props?.children) : ""; }
const node = (view, type) => nodes(view.render()).find(item => item.type === type);
const button = (view, label) => nodes(view.render()).find(item => ["Button", "ReceiptAction"].includes(item.type) && text(item) === label);
const at = "2026-10-08T04:00:00.000Z", actor = "audit-native-account";
function battery(id, status = "scrapped") { return { id, name: `Recorded asset ${id}`, chemistry: "LiPo", model: "Recorded model", version: 2, tagId: null, loanId: null, borrowerName: null, checkedOutAt: null, ownerName: "Staff owner", ownerId: "staff-owner", ownerAccountId: actor, capacityMah: null, voltage: null, manufacturedOn: null, firstUsedOn: null, registeredAt: at, lifecycleStatus: status, lifecycleAt: at, lifecycleReason: "Recorded retirement", lifecycleDestination: null, homeBuildingId: "J18", homeBuildingName: "Willis Annexe", homeRoomId: null }; }
function attempt(dataset = "live") { return libraries.captureRetiredAssetAttempt(actor, dataset, { requestId: crypto.randomUUID(), kind: "recover", items: [{ batteryId: "BAT-SCRAPPED", version: 2, tagId: null }] }); }
function receipt(payload, dataset, overrides = {}) { return { requestId: payload.requestId, actorAccountId: actor, dataset, kind: payload.kind, at, replayed: false, items: payload.items.map(item => ({ batteryId: item.batteryId, version: item.version + 1, status: payload.kind === "recover" ? "active" : "deleted" })), ...overrides }; }
async function environment(run, seed = []) {
  const descriptors = Object.fromEntries(["sessionStorage", "window", "document", "fetch"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const entries = new Map(seed), tools = new Map(), requests = [], loads = [], events = [];
  const user = { id: actor, role: "admin", username: "audit-user", defaultDataset: "demo" };
  const env = { user, dataset: "demo", error: "", revision: 0, failReads: false, entries, tools, requests, loads, events, respond: input => receipt(input.payload, input.dataset) };
  const snapshot = () => ({ dataset: env.dataset, user, actor: "Audit fixture", batteries: [battery("BAT-SCRAPPED"), battery("BAT-ACTIVE", "active")], people: [], rooms: [], buildings: [], staffDirectory: [], teachingGroups: [], events: [] });
  const current = { current: snapshot() };
  Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: { getItem(key) { if (env.failReads) throw new Error("Browser recovery read unavailable"); return entries.get(key) ?? null; }, setItem(key, value) { entries.set(key, value); }, removeItem(key) { entries.delete(key); } } });
  Object.defineProperty(globalThis, "window", { configurable: true, value: Object.assign(new EventTarget(), { dispatchEvent(event) { events.push(event.type); return EventTarget.prototype.dispatchEvent.call(this, event); } }) });
  Object.defineProperty(globalThis, "document", { configurable: true, value: { modelContext: { registerTool(tool) { tools.set(tool.name, tool); } } } });
  Object.defineProperty(globalThis, "fetch", { configurable: true, value: async (url, options) => { const input = JSON.parse(options.body); requests.push({ url, input: structuredClone(input) }); return new Response(JSON.stringify({ result: env.respond(input) }), { status: 200, headers: { "Content-Type": "application/json" } }); } });
  env.bindings = {
    flushSync: callback => callback(), transitionWorkspace: callback => callback(),
    useInventoryData() { current.current = snapshot(); return { user, dataset: env.dataset, data: current.current, loading: false, error: env.error, revision: env.revision, current, setError: value => { env.error = value; }, setRevision: update => { env.revision = typeof update === "function" ? update(env.revision) : update; }, load: async dataset => { loads.push(dataset); }, refresh() {}, changeDataset: dataset => { env.dataset = dataset; }, acceptReviewedInventory() {} }; },
    useWorkflowRecovery(accountId) { return { recovery: libraries.readWorkflowRecovery(sessionStorage, accountId), unavailable: false, read: () => libraries.readWorkflowRecovery(sessionStorage, accountId) }; },
    useLocationRecovery() { return { recovery: { attempts: [], error: "" }, read: () => ({ attempts: [], error: "" }) }; },
    useMessageCount: () => ({ unreadCount: 0, acceptUnreadCount() {} }), useInventoryPolling() {},
    useNewArrivals: () => ({ arrivals: undefined, acknowledge: async () => {}, pending: false, error: "" }),
  };
  try { await run(env); }
  finally { for (const [key, descriptor] of Object.entries(descriptors)) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); } }
}
function mount(name, env, initialProps = {}) {
  const state = hooks(), bindings = { ...ui, ...libraries, ...env.bindings, ...state }, keys = Object.keys(bindings);
  const Component = new Function(...keys, "_jsx", "_jsxs", "_Fragment", `${sources[name]}\nreturn ${name};`)(...keys.map(key => bindings[key]), jsx, jsx, "Fragment");
  const view = { props: initialProps, render() { state.reset(); const tree = Component(view.props); state.commit(); return tree; }, unmount: state.unmount }; return view;
}

test("real app scan, intake, movement and assets handlers resume a saved foreign-dataset retired request", async () => {
  for (const action of [app => node(app, "ApplicationShell").props.onScan("checkout"), app => node(app, "ApplicationShell").props.onAssets(), app => node(app, "InventoryTable").props.onMovement("checkout", ["BAT-ACTIVE"]), app => node(app, "RecoveryNotices").props.startIntake()]) {
    const saved = attempt("live"), key = libraries.retiredAssetStorageKey(actor, "live"), raw = JSON.stringify(saved);
    await environment(async env => { const app = mount("InventoryApp", env, { initialUser: env.user }); action(app); const history = node(app, "RemovalHistory"); assert.ok(history); assert.equal(env.dataset, "live"); assert.equal(node(app, "ScanStation"), undefined); assert.equal(node(app, "IntakeStation"), undefined); assert.equal(node(app, "MovementDialog"), undefined); assert.equal(env.entries.get(key), raw); assert.equal(env.requests.length, 0); app.unmount(); }, [[key, raw]]);
  }
});

test("the app retains the Mapping instance while scan and intake stations temporarily deactivate it", async () => environment(async env => {
  const app = mount("InventoryApp", env, { initialUser: env.user });
  const instanceKey = node(app, "MappingWorkspace").key;
  assert.equal(node(app, "MappingWorkspace").props.active, false);
  node(app, "ApplicationShell").props.onNavigate("mapping");
  assert.equal(node(app, "MappingWorkspace").props.active, true);
  node(app, "MappingWorkspace").props.onScan("checkout");
  assert.ok(node(app, "ScanStation"));
  assert.equal(node(app, "MappingWorkspace").key, instanceKey);
  assert.equal(node(app, "MappingWorkspace").props.active, false);
  node(app, "ScanStation").props.onExit();
  assert.equal(node(app, "MappingWorkspace").props.active, true);
  node(app, "RecoveryNotices").props.startIntake();
  assert.ok(node(app, "IntakeStation"));
  assert.equal(node(app, "MappingWorkspace").key, instanceKey);
  assert.equal(node(app, "MappingWorkspace").props.active, false);
  node(app, "IntakeStation").props.onExit();
  node(app, "ApplicationShell").props.onNavigate("mapping");
  assert.equal(node(app, "MappingWorkspace").key, instanceKey);
  assert.equal(node(app, "MappingWorkspace").props.active, true);
  assert.equal(env.requests.length, 0);
  app.unmount();
}));

test("fresh WebMCP staging honors preserved retired requests while its read tool remains usable", async () => environment(async env => {
  const app = mount("InventoryApp", env, { initialUser: env.user }); app.render(); const saved = attempt("live"), raw = JSON.stringify(saved), key = libraries.retiredAssetStorageKey(actor, "live"); env.entries.set(key, raw);
  assert.throws(() => env.tools.get("stage_battery_movement").execute({ kind: "checkout", batteryIds: ["BAT-ACTIVE"] }), /unfinished workflow/);
  assert.equal(env.tools.get("read_battery_inventory").execute({}).batteries.length, 1); assert.equal(node(app, "MovementDialog"), undefined); assert.equal(env.entries.get(key), raw); app.unmount();
}));

test("a preserved teaching request locks sign-out and dataset navigation and resumes its exact foreign-dataset payload", async () => {
  const groupId = crypto.randomUUID();
  const captured = libraries.captureTeachingCheckoutAttempt(actor, "live", { action: "checkout", requestId: crypto.randomUUID(), teachingGroup: { id: groupId, version: 1 }, personalScope: "all", mappings: [{ original: { batteryId: "BAT-ACTIVE", version: 2, tagId: null }, actual: { batteryId: "BAT-ACTIVE", version: 2, tagId: null }, originalLoanId: null, method: "original", source: { kind: "selection" } }] });
  const key = libraries.teachingCheckoutStorageKey(actor, "live"), raw = JSON.stringify({ ...captured, status: "uncertain" });
  await environment(async env => {
    const app = mount("InventoryApp", env, { initialUser: env.user }); app.render();
    assert.equal(node(app, "ApplicationShell").props.locked, true);
    const datasetSelect = nodes(node(app, "ApplicationShell").props.scopeControls).find(item => item.type === "Select" && item.props.value === "demo"); assert.ok(datasetSelect, "The global scope slot includes the current inventory selector"); assert.equal(datasetSelect.props.disabled, true);
    button(app, "Resume teaching checkout").props.onClick();
    const dialog = node(app, "TeachingCheckoutDialog"); assert.ok(dialog); assert.equal(env.dataset, "live"); assert.deepEqual(dialog.props.draft.attempt.payload, captured.payload); assert.equal(env.entries.get(key), raw);
    assert.throws(() => env.tools.get("stage_battery_movement").execute({ kind: "checkout", batteryIds: ["BAT-ACTIVE"] }), /current workflow/);
    assert.equal(env.requests.length, 0); app.unmount();
  }, [[key, raw]]);
});

test("valid exact teaching recovery survives a corrupt standalone draft while other corruption still blocks new writes", async () => {
  const captured = libraries.captureTeachingCheckoutAttempt(actor, "live", { action: "checkout", requestId: crypto.randomUUID(), teachingGroup: { id: crypto.randomUUID(), version: 1 }, personalScope: "all", mappings: [{ original: { batteryId: "BAT-ACTIVE", version: 2, tagId: null }, actual: { batteryId: "BAT-ACTIVE", version: 2, tagId: null }, originalLoanId: null, method: "original", source: { kind: "selection" } }] });
  const key = libraries.teachingCheckoutStorageKey(actor, "live"), liveDraftKey = libraries.teachingCheckoutDraftStorageKey(actor, "live"), demoDraftKey = libraries.teachingCheckoutDraftStorageKey(actor, "demo"), raw = JSON.stringify({ ...captured, status: "uncertain" });
  await environment(async env => {
    const app = mount("InventoryApp", env, { initialUser: env.user }); app.render();
    assert.match(text(app.render()), /demo:/); assert.ok(button(app, "Resume teaching checkout")); assert.equal(button(app, "Resume teaching checkout").props.disabled, false);
    button(app, "Resume teaching checkout").props.onClick(); const dialog = node(app, "TeachingCheckoutDialog"); assert.ok(dialog); assert.deepEqual(dialog.props.draft.attempt.payload, captured.payload);
    assert.equal(env.entries.get(key), raw); assert.equal(env.entries.get(liveDraftKey), "corrupt live draft"); assert.equal(env.entries.get(demoDraftKey), "corrupt demo draft");
    dialog.props.onClose(); env.entries.delete(key); window.dispatchEvent(new Event("battery-teaching-checkout-recovery"));
    node(app, "ApplicationShell").props.onScan("checkout"); assert.equal(node(app, "ScanStation"), undefined); assert.equal(node(app, "ApplicationShell").props.locked, true); assert.equal(env.requests.length, 0);
    app.unmount();
  }, [[key, raw], [liveDraftKey, "corrupt live draft"], [demoDraftKey, "corrupt demo draft"]]);
});

test("actual retired dialog can resolve its request alongside another dataset's saved draft without forcing old removal", async () => {
  const saved = attempt("live"), key = libraries.retiredAssetStorageKey(actor, "live"), other = libraries.removalDraftStorageKey(actor, "demo"), rawOther = "preserved older removal draft";
  await environment(async env => {
    const app = mount("InventoryApp", env, { initialUser: env.user }); node(app, "RecoveryNotices").props.resumeRetiredAction({ dataset: "live" });
    const history = mount("RemovalHistory", env, node(app, "RemovalHistory").props); const dialog = mount("RetiredAssetActionDialog", env, node(history, "RetiredAssetActionDialog").props); dialog.render();
    assert.equal(node(app, "Tabs").props.value, "history"); assert.equal(node(app, "RemovalHistory").props.paused, false); assert.equal(node(app, "ApplicationShell").props.locked, true);
    assert.equal(node(dialog, "ReceiptAction").props.disabled, false); await node(dialog, "ReceiptAction").props.onClick();
    assert.deepEqual(env.requests[0].input.payload, saved.payload); assert.equal(node(dialog, "ReceiptAction").props.confirmation.count, 1); assert.equal(env.entries.has(key), false); assert.equal(env.entries.get(other), rawOther); assert.deepEqual(env.loads, ["live"]);
    assert.equal(node(app, "RemovalHistory").props.paused, true); dialog.unmount(); history.unmount(); app.unmount();
  }, [[key, JSON.stringify(saved)], [other, rawOther]]);
});

test("root write returns unverified retired responses without generic success, refresh or clearing recovery", async () => {
  const saved = attempt("live"), key = libraries.retiredAssetStorageKey(actor, "live"), raw = JSON.stringify(saved);
  await environment(async env => {
    env.respond = input => receipt(input.payload, input.dataset, { requestId: crypto.randomUUID() });
    const app = mount("InventoryApp", env, { initialUser: env.user }); node(app, "RecoveryNotices").props.resumeRetiredAction({ dataset: "live" });
    const history = mount("RemovalHistory", env, node(app, "RemovalHistory").props), dialog = mount("RetiredAssetActionDialog", env, node(history, "RetiredAssetActionDialog").props);
    await node(dialog, "ReceiptAction").props.onClick(); assert.equal(node(dialog, "ReceiptAction").props.confirmation, null); assert.match(text(dialog.render()), /does not match/); assert.equal(env.entries.get(key), raw); assert.equal(env.loads.length, 0); assert.equal(env.revision, 0); assert.doesNotMatch(text(app.render()), /Record saved|saved successfully/);
    dialog.unmount(); history.unmount(); app.unmount();
  }, [[key, raw]]);
});

test("confirmed current-dataset action cannot open a new request while another retired dataset remains pending", async () => {
  const demo = attempt("demo"), live = attempt("live"), demoKey = libraries.retiredAssetStorageKey(actor, "demo"), liveKey = libraries.retiredAssetStorageKey(actor, "live"), liveRaw = JSON.stringify(live);
  await environment(async env => {
    const app = mount("InventoryApp", env, { initialUser: env.user }); node(app, "RecoveryNotices").props.resumeRetiredAction({ dataset: "demo" });
    const history = mount("RemovalHistory", env, node(app, "RemovalHistory").props), dialog = mount("RetiredAssetActionDialog", env, node(history, "RetiredAssetActionDialog").props);
    await node(dialog, "ReceiptAction").props.onClick(); button(dialog, "Close review").props.onClick(); dialog.unmount();
    history.props = node(app, "RemovalHistory").props; assert.equal(history.props.paused, true);
    nodes(history.render()).find(item => item.type === "Checkbox" && item.props["aria-label"] === "Select retired battery BAT-SCRAPPED").props.onCheckedChange(true); assert.match(text(history.render()), /0 selected/);
    const notices = mount("RecoveryNotices", env, node(app, "RecoveryNotices").props); const resume = button(notices, "Resume retired battery action · Working"); assert.ok(resume); assert.equal(resume.props.disabled, false); resume.props.onClick(); assert.equal(env.dataset, "live"); assert.equal(node(app, "Tabs").props.value, "history");
    assert.equal(env.entries.has(demoKey), false); assert.equal(env.entries.get(liveKey), liveRaw); assert.equal(env.requests.length, 1); notices.unmount(); history.unmount(); app.unmount();
  }, [[demoKey, JSON.stringify(demo)], [liveKey, liveRaw]]);
});

test("malformed retired storage remains blocked in its own history and no other dataset overwrites it", async () => {
  const key = libraries.retiredAssetStorageKey(actor, "live"), raw = "damaged exact request";
  await environment(async env => {
    const app = mount("InventoryApp", env, { initialUser: env.user }); node(app, "ApplicationShell").props.onScan("return"); const history = mount("RemovalHistory", env, node(app, "RemovalHistory").props); history.render();
    assert.equal(node(app, "Tabs").props.value, "history"); assert.equal(node(app, "ApplicationShell").props.locked, true); assert.match(text(history.render()), /could not be read/); node(app, "RecoveryNotices").props.startIntake(); assert.equal(node(app, "IntakeStation"), undefined); assert.equal(env.entries.get(key), raw); assert.equal(env.entries.has(libraries.retiredAssetStorageKey(actor, "demo")), false); assert.equal(env.requests.length, 0); history.unmount(); app.unmount();
  }, [[key, raw]]);
});

test("actual group maintenance and group removal entry points do not create another action during retired recovery", async () => {
  const saved = attempt("live"), key = libraries.retiredAssetStorageKey(actor, "live"), raw = JSON.stringify(saved);
  await environment(async env => {
    const app = mount("InventoryApp", env, { initialUser: env.user }); node(app, "ApplicationShell").props.onTeachingGroups();
    const groups = node(app, "TeachingGroupsWorkspace"); assert.ok(groups); groups.props.onMaintenance(["BAT-ACTIVE"], { id: crypto.randomUUID(), version: 1 }); assert.equal(node(app, "GroupMaintenanceDialog"), undefined);
    groups.props.onRemoval(["BAT-ACTIVE"], { id: crypto.randomUUID(), version: 1 }); assert.equal(node(app, "RemovalStation"), undefined); assert.equal(env.entries.get(key), raw); assert.equal(env.requests.length, 0); app.unmount();
  }, [[key, raw]]);
});

test("direct scan, movement, removal and group recovery notices honor retired priority without dropping older evidence", async () => {
  const saved = attempt("live"), key = libraries.retiredAssetStorageKey(actor, "live"), raw = JSON.stringify(saved);
  const scanRaw = JSON.stringify({ sessionId: crypto.randomUUID(), mode: "batch", room: null, queue: [{ battery: battery("BAT-ACTIVE", "active"), tagId: null, source: "selection", readAt: at }], completed: [], issues: [], attempt: null });
  const movementRaw = JSON.stringify(libraries.captureMovementAttempt("checkout", [battery("BAT-ACTIVE", "active")], actor, "demo", crypto.randomUUID()));
  for (const [olderKey, olderRaw, label, category] of [
    [`battery-scan:${actor}:demo:checkout`, scanRaw, "Resume checkout · Demonstration", "scans"],
    [libraries.movementStorageKey(actor, "demo", "checkout"), movementRaw, "Resume saved checkout · Demonstration", "movements"],
    [libraries.removalDraftStorageKey(actor, "demo"), "preserved older removal evidence", "Resume removal · Demonstration", "removals"],
    [libraries.groupMaintenanceKey(actor, "demo"), "preserved older group request", "Resume group update · demo", "groups"],
  ]) {
    await environment(async env => {
      const app = mount("InventoryApp", env, { initialUser: env.user }); const recovery = node(app, "RecoveryNotices"); assert.equal(recovery.props.recovery[category].length, 1);
      const notices = mount("RecoveryNotices", env, recovery.props); const resume = button(notices, label); assert.ok(resume); resume.props.onClick();
      assert.equal(node(app, "ScanStation"), undefined); assert.equal(node(app, "MovementDialog"), undefined); assert.equal(node(app, "GroupMaintenanceDialog"), undefined); assert.ok(node(app, "RemovalHistory")); assert.equal(node(app, "Tabs").props.value, "history"); assert.equal(env.dataset, "live"); assert.equal(env.entries.get(key), raw); assert.equal(env.entries.get(olderKey), olderRaw); assert.equal(env.requests.length, 0); notices.unmount(); app.unmount();
    }, [[key, raw], [olderKey, olderRaw]]);
  }
});
