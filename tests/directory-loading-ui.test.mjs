import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const sources = Object.fromEntries(await Promise.all([
  ["accounts", "components/inventory/accounts-panel.tsx"],
  ["locations", "components/inventory/location-tools-panel.tsx"],
].map(async ([name, path]) => [name, ts.transpileModule(await readFile(path, "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX },
}).outputText.replace(/^import .*;\r?\n/gm, "").replace(/^export /gm, "")])));
const jsx = (type, props) => ({ type, props: props ?? {} });
const settle = () => new Promise(resolve => setImmediate(resolve));
function nodes(tree, found = []) {
  if (Array.isArray(tree)) { tree.forEach(node => nodes(node, found)); return found; }
  if (!tree || typeof tree !== "object") return found;
  found.push(tree); nodes(tree.props?.children, found); return found;
}
const label = tree => Array.isArray(tree) ? tree.map(label).join("") : tree && typeof tree === "object" ? label(tree.props?.children) : tree == null ? "" : String(tree);
const button = (tree, text) => nodes(tree).find(node => node.type === "Button" && label(node) === text);
const loading = tree => nodes(tree).find(node => node.type === "LoadingState");
const account = { id: "admin", username: "fictional-admin", displayName: "Fictional Admin", role: "admin", active: true, email: "", version: 1 };
const data = { user: account, dataset: "demo", buildings: [], rooms: [], batteries: [] };
const beacon = { id: "beacon-a", label: "Room A beacon", identifier: "demo-a", version: 1, roomId: "room-a", roomName: "Room A", buildingId: "J18", buildingName: "Willis Annexe", active: true, roomSelectable: true };
const directory = { dataset: "demo", beacons: [beacon], capabilities: { hardwareIngestion: false, manageBeacons: true, demoSimulation: false } };

function harness(kind) {
  const state = [], effects = [], timers = new Map(), requests = [];
  let pointer = 0, effectPointer = 0, nextTimer = 0, queued = [];
  const bindings = {
    ...Object.fromEntries(["Download", "Plus", "Pencil", "Shield", "UserRound", "RefreshCw", "BluetoothOff", "FlaskConical", "MapPin", "Button", "Input", "Label", "Dialog", "DialogContent", "DialogHeader", "DialogTitle", "DialogDescription", "DialogFooter", "Select", "SelectTrigger", "SelectValue", "SelectContent", "SelectItem", "Table", "TableHeader", "TableBody", "TableRow", "TableHead", "TableCell", "LoadingState", "DownloadAction", "MotionPresence", "RecordPicker"].map(name => [name, name])),
    useState(initial) { const index = pointer++; if (!(index in state)) state[index] = typeof initial === "function" ? initial() : initial; return [state[index], value => { state[index] = typeof value === "function" ? value(state[index]) : value; }]; },
    useRef(initial) { const index = pointer++; if (!(index in state)) state[index] = { current: initial }; return state[index]; },
    useCallback(callback, dependencies) { const index = pointer++, previous = state[index]; if (!previous || dependencies.some((value, index) => !Object.is(value, previous.dependencies[index]))) state[index] = { dependencies, callback }; return state[index].callback; },
    useEffect(callback, dependencies) { const index = effectPointer++, previous = effects[index]; if (!previous || dependencies.some((value, index) => !Object.is(value, previous.dependencies[index]))) queued.push(() => { previous?.cleanup?.(); effects[index] = { dependencies, cleanup: callback() }; }); },
    window: { setTimeout(callback, delay) { const id = ++nextTimer; timers.set(id, { callback, delay }); return id; }, clearTimeout(id) { timers.delete(id); }, addEventListener() {}, removeEventListener() {} },
    fetch(url, options) { return new Promise((resolve, reject) => { requests.push({ url, options, resolve: body => resolve({ ok: true, status: 200, async json() { return body; } }), reject }); options.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true }); }); },
    inventoryResponse: response => response.json(),
    formatTime: value => value ?? "Unavailable",
    useDownloadFeedback: () => ({ busy: false, error: "", completion: null }),
    getRolePermissions: role => ({ manageAccounts: role === "admin" }),
    useLocationRecovery: () => ({ recovery: { attempts: [], error: "" }, read: () => ({ attempts: [], error: "" }) }),
    locationRequestStorageKey: (actor, dataset) => `location:${actor}:${dataset}`,
    roomPickerOptions: () => [], SUPPORTED_BUILDING_ID: "J18",
    styles: new Proxy({}, { get: (_target, name) => name }),
  };
  const component = new Function(...Object.keys(bindings), "_jsx", "_jsxs", "_Fragment", `${sources[kind]}\nreturn ${kind === "accounts" ? "AccountManagementContent" : "LocationToolsPanel"};`)(...Object.values(bindings), jsx, jsx, "Fragment");
  return {
    requests,
    render() { pointer = effectPointer = 0; queued = []; const tree = component(kind === "accounts" ? { currentUser: account, async onSaved() {} } : { data, ready: true, async onChanged() {}, onClose() {} }); queued.forEach(effect => effect()); return tree; },
    timeout() { for (const [id, timer] of timers) if (timer.delay === 30_000) { timers.delete(id); timer.callback(); } },
    dispose() { effects.forEach(effect => effect.cleanup?.()); },
  };
}

test("staff account reads retain received rows while refresh disables changes, then expose timeout retry", async () => {
  const h = harness("accounts");
  let tree = h.render();
  assert.equal(loading(tree).props.label, "Loading staff accounts");
  assert.equal(loading(tree).props.compact, true);
  assert.equal(nodes(tree).filter(node => node.type === "Table").length, 0);
  h.requests[0].resolve({ accounts: [account], events: [] }); await settle(); tree = h.render();
  assert.match(label(tree), /Fictional Admin/);
  button(tree, "Refresh accounts").props.onClick(); tree = h.render();
  assert.equal(loading(tree).props.label, "Refreshing staff accounts");
  assert.match(label(tree), /Fictional Admin/);
  for (const action of ["Create account", "Manage"]) {
    assert.equal(button(tree, action).props.disabled, true);
    button(tree, action).props.onClick();
  }
  assert.equal(nodes(h.render()).some(node => typeof node.type === "function" && node.type.name === "AccountEditor"), false);
  h.timeout(); await settle(); tree = h.render();
  assert.equal(loading(tree), undefined);
  assert.match(label(tree), /taking too long.*refresh accounts/);
  assert.match(label(tree), /Fictional Admin/);
  assert.equal(button(tree, "Manage").props.disabled, true);
  assert.equal(button(tree, "Refresh accounts").props.disabled, false);
  button(tree, "Refresh accounts").props.onClick(); h.render();
  h.requests[2].resolve({ accounts: [{ ...account, displayName: "Updated Admin" }], events: [] }); await settle(); tree = h.render();
  assert.match(label(tree), /Updated Admin/);
  assert.equal(button(tree, "Manage").props.disabled, false);
  h.dispose();
});

test("account read unmount aborts requests and ignores late account responses", async () => {
  const h = harness("accounts"); h.render(); h.dispose();
  assert.equal(h.requests[0].options.signal.aborted, true);
  h.requests[0].resolve({ accounts: [account], events: [] }); await settle();
  assert.doesNotMatch(label(h.render()), /Fictional Admin/);
  h.dispose();
});

test("beacon directory reads show waiting and retain rows without permitting stale mapping changes", async () => {
  const h = harness("locations");
  let tree = h.render(); await settle();
  assert.equal(loading(tree).props.label, "Loading room beacons");
  assert.equal(h.requests[0].url, "/api/locations?dataset=demo");
  h.requests[0].resolve(directory); await settle(); tree = h.render();
  assert.equal(button(tree, "Edit").props.disabled, false);
  button(tree, "Refresh directory").props.onClick(); tree = h.render();
  assert.equal(loading(tree).props.label, "Refreshing room beacons");
  assert.match(label(tree), /Room A beacon/);
  assert.equal(button(tree, "Edit").props.disabled, true);
  h.timeout(); await settle(); tree = h.render();
  assert.equal(loading(tree), undefined);
  assert.match(label(tree), /taking too long.*refresh the directory/);
  assert.match(label(tree), /Room A beacon/);
  assert.equal(button(tree, "Edit").props.disabled, true);
  assert.equal(button(tree, "Refresh directory").props.disabled, false);
  button(tree, "Refresh directory").props.onClick();
  h.requests[2].resolve({ ...directory, beacons: [{ ...beacon, label: "Updated beacon" }] }); await settle(); tree = h.render();
  assert.match(label(tree), /Updated beacon/);
  assert.equal(button(tree, "Edit").props.disabled, false);
  h.dispose();
});

test("a newer beacon directory refresh cancels its predecessor and closing aborts the remaining read", async () => {
  const h = harness("locations"); h.render(); await settle();
  h.requests[0].resolve(directory); await settle();
  const tree = h.render(), refresh = button(tree, "Refresh directory").props.onClick;
  refresh(); refresh();
  assert.equal(h.requests[1].options.signal.aborted, true);
  h.requests[1].resolve({ ...directory, beacons: [{ ...beacon, label: "Obsolete beacon" }] }); await settle();
  assert.equal(loading(h.render()).props.label, "Refreshing room beacons");
  assert.doesNotMatch(label(h.render()), /Obsolete beacon/);
  h.dispose();
  assert.equal(h.requests[2].options.signal.aborted, true);
  await settle();
});
