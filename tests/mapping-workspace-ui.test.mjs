import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import * as mapping from "../work/qa/inventory-mapping.mjs";
import * as locations from "../work/qa/location-catalog.mjs";
import { isActiveBattery } from "../work/qa/battery-lifecycle.mjs";

// Execute the component's real event handlers with isolated React/UI boundaries.
// Browser layout, focus painting and InventoryTable's own state are tested separately.
const jsx = (type, props, key) => ({ type, props: props ?? {}, key });
function nodes(tree, result = []) {
  if (Array.isArray(tree)) tree.forEach(child => nodes(child, result));
  else if (tree && typeof tree === "object") { result.push(tree); nodes(tree.props?.children, result); }
  return result;
}
function text(tree) {
  return typeof tree === "string" || typeof tree === "number" ? String(tree) : Array.isArray(tree) ? tree.map(text).join("") : tree && typeof tree === "object" ? text(tree.props?.children) : "";
}
const button = (tree, label) => nodes(tree).find(node => ["button", "Button"].includes(node.type) && text(node) === label);
const tables = tree => nodes(tree).filter(node => node.type === "InventoryTable");
const roomButton = (tree, label) => nodes(tree).find(node => node.type === "button" && node.props["data-position"] !== undefined && node.props["aria-label"].startsWith(label + ","));
const tab = (tree, label) => nodes(tree).find(node => node.props.role === "tab" && text(node) === label);

function fixture() {
  const rooms = ["A", "B", "C"].map(letter => ({ id: `J18-${letter}`, name: `Room ${letter}`, number: letter, buildingId: "J18", building: "Willis Annexe", isPlaceholder: true, selectable: true, version: 1 }));
  const batteries = [
    { id: "BAT-1", observedRoomId: "J18-A", observedAt: "2026-10-10T01:00:00.000Z", observedRoom: "Original A", observationSource: "Simulated room observation", loanId: null },
    { id: "BAT-2", observedRoomId: "J18-A", observedAt: "2026-10-10T02:00:00.000Z", observedRoom: null, observationSource: "Staff return confirmation", loanId: "loan-2" },
    { id: "BAT-3", observedRoomId: null, observedAt: null, homeRoomId: "J18-A", loanId: null },
    { id: "BAT-4", observedRoomId: "E10-Z", observedAt: "2026-10-10T03:00:00.000Z", observedRoom: "Historical room", observationSource: "Staff return confirmation", loanId: null },
    { id: "BAT-5", observedRoomId: "J18-A", observedAt: "2026-10-10T04:00:00.000Z", lifecycleStatus: "scrapped", loanId: null },
  ].map(battery => ({ lifecycleStatus: "active", ...battery }));
  return { dataset: "demo", user: { id: "staff-a", role: "staff" }, rooms, batteries, teachingGroups: [] };
}

async function mount(overrides = {}) {
  const state = [], effects = [], focus = [];
  let pointer = 0;
  const props = { data: fixture(), ready: true, onMovement() {}, onEdit() {}, onDetail() {}, onSetup() {}, onExport() {}, ...overrides };
  const source = ts.transpileModule(await readFile("components/inventory/mapping-workspace.tsx", "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } }).outputText.replace(/^import .*;\r?\n/gm, "").replace(/^export /gm, "");
  const bindings = {
    ...mapping, ...locations, isActiveBattery,
    useId: () => "mapping-test",
    useState(initial) { const index = pointer++; if (!(index in state)) state[index] = typeof initial === "function" ? initial() : initial; return [state[index], value => { state[index] = typeof value === "function" ? value(state[index]) : value; }]; },
    useRef(initial) { const index = pointer++; if (!(index in state)) state[index] = { current: initial }; return state[index]; },
    useLayoutEffect(callback) { effects.push(callback); },
    formatTime: value => value,
    styles: new Proxy({}, { get: (_, key) => String(key) }),
    ...Object.fromEntries(["ArrowLeft", "ArrowRight", "Building2", "Check", "ChevronDown", "DoorOpen", "Info", "Layers2", "LockKeyhole", "MapIcon", "Maximize", "Settings2", "SlidersHorizontal", "X", "Button", "MotionDisclosure", "InventoryTable", "MappingRoomDrawing"].map(name => [name, name])),
  };
  const names = Object.keys(bindings);
  const component = new Function(...names, "_jsx", "_jsxs", "_Fragment", `${source}\nreturn MappingWorkspace;`)(...names.map(name => bindings[name]), jsx, jsx, "Fragment");
  return {
    props, focus,
    render() {
      pointer = 0; effects.length = 0;
      const tree = component(props);
      for (const node of nodes(tree)) {
        const element = { focus() { focus.push(node.props.id ?? node.props["aria-label"] ?? text(node)); } };
        if (typeof node.props.ref === "function") node.props.ref(element);
        else if (node.props.ref) node.props.ref.current = element;
      }
      effects.forEach(effect => effect());
      return tree;
    },
  };
}

test("mapping summarizes latest active observations without substituting registered home or historical labels", async () => {
  const view = await mount();
  let tree = view.render();
  assert.equal(nodes(tree).filter(node => node.props.role === "tab").length, 1);
  assert.equal(tables(tree).length, 0);
  assert.match(roomButton(tree, "Room A").props["aria-label"], /2 last observed here/);
  assert.match(roomButton(tree, "Unknown").props["aria-label"], /2 without a mapped last observation/);
  roomButton(tree, "Room A").props.onClick();
  tree = view.render();
  assert.equal(tables(tree).length, 0, "selecting a shape only opens its summary");
  assert.match(text(tree), /Original room label unavailable/);
  assert.match(text(tree), /Staff return confirmation/);
  assert.match(text(tree), /Simulated room observation/);
  assert.match(text(tree), /Loan status, not physical presence/);
  assert.equal(button(tree, "E10Hilmer Building · unavailable").props.disabled, true);
});

test("View details opens independent persistent tabs and reopening the same room keeps its table mounted", async () => {
  const view = await mount();
  button(view.render(), "Filter").props.onClick();
  roomButton(view.render(), "Room A").props.onClick();
  button(view.render(), "View details").props.onClick();
  let tree = view.render();
  assert.equal(tab(tree, "Room A").props["aria-selected"], true);
  assert.deepEqual(tables(tree).map(node => [node.props.mappingRoom, node.props.active]), [["J18-A", true]]);
  const originalData = tables(tree)[0].props.data;
  button(tree, "Back to mapping").props.onClick();
  tree = view.render();
  assert.equal(nodes(tree).find(node => node.type === "MotionDisclosure").props.open, true, "overview keeps its filter state");
  assert.equal(tables(tree)[0].props.active, false, "the hidden table remains mounted");
  roomButton(tree, "Room B").props.onClick();
  button(view.render(), "View details").props.onClick();
  tree = view.render();
  assert.deepEqual(tables(tree).map(node => [node.props.mappingRoom, node.props.active]), [["J18-A", false], ["J18-B", true]]);
  assert.equal(tables(tree)[0].props.data, originalData, "tabs receive the unchanged authoritative inventory");
  tab(tree, "Room A").props.onClick();
  tree = view.render();
  assert.deepEqual(tables(tree).map(node => node.props.active), [true, false]);
  button(tree, "Back to mapping").props.onClick();
  roomButton(view.render(), "Room A").props.onClick();
  button(view.render(), "View details").props.onClick();
  tree = view.render();
  assert.equal(tables(tree).length, 2, "an existing room is focused instead of appended or replaced");
  assert.equal(tab(tree, "Room A").props["aria-selected"], true);
});

test("closing tabs focuses a neighbour then Overview, and overlays block tab changes", async () => {
  const view = await mount();
  for (const name of ["Room A", "Room B"]) {
    roomButton(view.render(), name).props.onClick();
    button(view.render(), "View details").props.onClick();
    tab(view.render(), "Overview").props.onClick();
  }
  tab(view.render(), "Room B").props.onClick();
  view.props.overlayOpen = true;
  let tree = view.render();
  const close = name => nodes(tree).find(node => node.props["aria-label"] === `Close ${name} tab`);
  assert.equal(close("Room B").props.disabled, true);
  close("Room B").props.onClick();
  tab(tree, "Overview").props.onClick();
  tree = view.render();
  assert.equal(tables(tree).length, 2);
  assert.equal(tab(tree, "Room B").props["aria-selected"], true);
  view.props.overlayOpen = false;
  tree = view.render();
  close("Room B").props.onClick();
  tree = view.render();
  assert.equal(tab(tree, "Room A").props["aria-selected"], true);
  assert.equal(view.focus.at(-1), "mapping-test-tab-J18-A");
  close("Room A").props.onClick();
  tree = view.render();
  assert.equal(tables(tree).length, 0);
  assert.equal(tab(tree, "Overview").props["aria-selected"], true);
  assert.equal(view.focus.at(-1), "mapping-test-tab-__overview");
});

test("tab actions preserve observation scope when opening battery details and fresh snapshots", async () => {
  const details = [], view = await mount({ onDetail: (...args) => details.push(args) });
  roomButton(view.render(), "Unknown").props.onClick();
  button(view.render(), "View details").props.onClick();
  let tree = view.render();
  tables(tree)[0].props.onDetail("BAT-4");
  assert.deepEqual(details, [["BAT-4", mapping.UNKNOWN_MAPPING_ROOM]]);
  view.props.data = { ...view.props.data, batteries: [...view.props.data.batteries] };
  tree = view.render();
  assert.equal(tables(tree).length, 1);
  assert.equal(tables(tree)[0].props.mappingRoom, mapping.UNKNOWN_MAPPING_ROOM);
  assert.equal(tables(tree)[0].props.data, view.props.data);
  assert.equal(tab(tree, "Unknown").props["aria-selected"], true);
});
