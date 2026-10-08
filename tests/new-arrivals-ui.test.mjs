import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import * as inventoryQuery from "../work/qa/inventory-query.mjs";
import * as arrivals from "../work/qa/new-arrivals.mjs";
import * as client from "../work/qa/client-utils.mjs";
import * as lifecycle from "../work/qa/battery-lifecycle.mjs";
import * as rowSelection from "../work/qa/client/row-selection.mjs";
import * as locations from "../work/qa/location-catalog.mjs";
import { getRolePermissions } from "../work/qa/permissions.mjs";
import * as teachingRequests from "../work/qa/client/teaching-checkout-request.mjs";
import * as teachingDrafts from "../work/qa/client/teaching-checkout-draft.mjs";

// Execute current page functions with inert component boundaries. These probes
// verify public handlers and projections, not browser layout or native disabling.
const jsx = (type, props, key) => ({ type, props: props ?? {}, key });
const renderedJsx = (type, props, key) => typeof type === "function" ? type(props ?? {}) : jsx(type, props, key);
function nodes(tree, result = [], visibleOnly = false) {
  if (Array.isArray(tree)) tree.forEach(item => nodes(item, result, visibleOnly));
  else if (tree && typeof tree === "object" && (!visibleOnly || !tree.props?.hidden)) {
    result.push(tree); nodes(tree.props?.children, result, visibleOnly);
  }
  return result;
}
function text(tree) {
  return typeof tree === "string" || typeof tree === "number" ? String(tree)
    : Array.isArray(tree) ? tree.map(text).join("") : tree && typeof tree === "object" ? text(tree.props?.children) : "";
}
function hooks() {
  const values = []; let index = 0;
  return {
    reset() { index = 0; },
    useState(initial) { const key = index++; if (!(key in values)) values[key] = typeof initial === "function" ? initial() : initial;
      return [values[key], next => { values[key] = typeof next === "function" ? next(values[key]) : next; }]; },
    useRef(initial) { const key = index++; if (!(key in values)) values[key] = { current: initial }; return values[key]; },
    useCallback: callback => callback, useEffect() {}, useLayoutEffect() {},
  };
}
async function factory(file, exportNames, renderFunctions = false) {
  const source = await readFile(new URL(`../${file}`, import.meta.url), "utf8");
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const primitives = {};
  for (const statement of parsed.statements.filter(ts.isImportDeclaration)) {
    if (statement.importClause?.name) primitives[statement.importClause.name.text] = statement.importClause.name.text;
    for (const binding of statement.importClause?.namedBindings?.elements ?? []) primitives[binding.name.text] = binding.name.text;
  }
  const withoutImports = parsed.statements.filter(statement => !ts.isImportDeclaration(statement)).map(statement => statement.getFullText(parsed)).join("\n");
  const output = ts.transpileModule(withoutImports, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText.replace(/^import .*;\r?\n/gm, "").replace(/^export default /gm, "").replace(/^export /gm, "");
  return (state, extra = {}) => {
    const bindings = { ...primitives, ...inventoryQuery, ...arrivals, ...client, ...lifecycle, ...rowSelection, ...locations,
      getRolePermissions, ...state, currentSydneyDate: () => "2026-10-08", transitionWorkspace: callback => callback(),
      styles: new Proxy({}, { get: (_, key) => String(key) }), ...extra };
    const create = renderFunctions ? renderedJsx : jsx;
    return new Function(...Object.keys(bindings), "_jsx", "_jsxs", "_Fragment", `${output}\nreturn { ${exportNames.join(", ")} };`)(...Object.values(bindings), create, create, "Fragment");
  };
}
const panelFactory = await factory("components/inventory/inventory-filter-panel.tsx", ["appliedFilterChips"]);
const tableFactory = await factory("components/inventory/inventory-table.tsx", ["InventoryTable"]);
const appFactory = await factory("app/inventory-app.tsx", ["InventoryApp"]);
const groupsFactory = await factory("components/inventory/teaching-groups-workspace.tsx", ["TeachingGroupsWorkspace"]);
const shellFactory = await factory("components/application/application-shell.tsx", ["ApplicationShell"], true);
const now = "2026-10-08T05:00:00.000Z", actor = "native-staff-one";
const iso = value => new Date(value).toISOString();
function battery(id, position, extra = {}) {
  return { id, name: `Recorded battery ${id}`, model: "Recorded model", chemistry: position % 2 ? "NiMH" : "LiPo",
    capacityMah: null, voltage: null, version: 1, tagId: null, ownerId: `staff-${actor}`, ownerName: "Same Staff",
    ownerAccountId: actor, loanId: position % 3 ? null : `loan-${id}`, borrowerAccountId: position % 3 ? null : actor,
    borrowerKind: "staff", borrowerName: position % 3 ? null : "Same Staff", checkedOutAt: null,
    registeredAt: iso(Date.parse(now) - (25 - position) * 60000), manufacturedOn: null, firstUsedOn: null,
    lifecycleStatus: "active", lifecycleAt: null, lifecycleReason: null, lifecycleDestination: null,
    homeBuildingId: "J18", homeBuildingName: "Willis Annexe", homeRoomId: null, homeRoomName: null,
    observedAt: null, observedRoom: null, observationRoomSnapshot: null, observedBuilding: null,
    lastCheckedOutAt: null, chargedAt: null, chargeDurationMinutes: null, ...extra };
}
function fixture() {
  const recent = Array.from({ length: 24 }, (_, index) => battery(`BAT-${String(index + 1).padStart(3, "0")}`, index + 1));
  const old = battery("BAT-000", 1, { registeredAt: iso(Date.parse(now) - 72 * 3600000) });
  const scrapped = battery("BAT-099", 2, { lifecycleStatus: "scrapped" });
  const user = { id: actor, role: "staff", username: "staff.one", displayName: "Same Staff", defaultDataset: "demo" };
  return { dataset: "demo", user, actor: "Same Staff", batteries: [old, ...recent, scrapped], events: [],
    people: [{ id: `staff-${actor}`, name: "Same Staff", accountId: actor, role: "staff" }],
    staffDirectory: [{ ...user, active: true }], buildings: [{ id: "J18", name: "Willis Annexe" }], rooms: [],
    teachingGroups: [{ id: "11111111-1111-4111-8111-111111111111", name: "Teaching selection", notes: "Independent group", state: "active", version: 2, ownerAccountId: actor, batteryIds: [old.id, recent[2].id] }],
    newArrivals: { serverNow: now, throughSequence: 25, acknowledgedThroughSequence: 0, unreadCount: 23,
      items: recent.map((item, index) => ({ batteryId: item.id, sequence: index + 1, registeredAt: item.registeredAt, isUnread: index !== 0 })) },
  };
}
function table(data = fixture(), extra = {}) {
  const state = hooks(), acknowledgements = [], exports = [];
  const { appliedFilterChips } = panelFactory(hooks());
  const { InventoryTable } = tableFactory(state, { appliedFilterChips });
  const props = { data, ready: true, newArrivals: data.newArrivals, onMovement() {}, onEdit() {}, onDetail() {}, onSetup() {},
    onViewNewArrivals: async cursor => { acknowledgements.push(cursor); }, onExport: value => exports.push(structuredClone(value)), ...extra };
  return { props, acknowledgements, exports, render() { state.reset(); return InventoryTable(props); } };
}
const byType = (tree, type) => nodes(tree).find(node => node.type === type);
const button = (tree, label) => nodes(tree).find(node => node.type === "Button" && text(node) === label);
const quickEntry = tree => nodes(tree).find(node => node.type === "Button" && text(node).startsWith("New arrivals"));
const filters = tree => byType(tree, "InventoryFilterPanel").props;
const statusTabs = tree => byType(tree, "Tabs").props;
const rowIds = tree => nodes(tree).filter(node => node.type === "Checkbox" && /^Select BAT-/.test(node.props["aria-label"] ?? "")).map(node => node.props["aria-label"].slice(7));
const statusCount = (tree, value) => Number(text(nodes(nodes(tree).find(node => node.type === "TabsTrigger" && node.props.value === value)).find(node => node.props.className === "tab-count")));
function download(view) { nodes(view.render()).find(node => node.type === "Button" && node.props["aria-label"] === "Download inventory").props.onClick(); return view.exports.at(-1); }

test("normal inventory rendering, status navigation, filters, selection and clearing criteria never acknowledge registrations", () => {
  const view = table(); let tree = view.render(); view.render();
  nodes(tree).find(node => node.type === "Checkbox" && node.props["aria-label"] === "Select BAT-000").props.onCheckedChange(true);
  statusTabs(view.render()).onValueChange("out");
  filters(view.render()).onChange({ search: "BAT-003", chemistry: "NiMH" });
  tree = view.render(); assert.deepEqual(rowIds(tree), ["BAT-003"]);
  byType(tree, "AppliedFilters").props.onClear();
  tree = view.render(); assert.equal(filters(tree).filters.search, "");
  assert.equal(download(view).selectedIds[0], "BAT-000"); assert.deepEqual(view.acknowledgements, []);
});

test("New arrivals captures the displayed cursor, resets ordinary criteria and retains selected assets while counts, pages and exports share the new scope", () => {
  const view = table(); let tree = view.render();
  nodes(tree).find(node => node.type === "Checkbox" && node.props["aria-label"] === "Select BAT-000").props.onCheckedChange(true);
  filters(view.render()).onChange({ search: "hidden old query", groupId: view.props.data.teachingGroups[0].id, status: "out", owner: "missing-owner", lifecycle: "all", chemistry: "NiMH" });
  tree = view.render(); const entry = quickEntry(tree);
  view.props.newArrivals = { ...view.props.newArrivals, throughSequence: 26 };
  entry.props.onClick(); assert.deepEqual(view.acknowledgements, [25], "The click uses its displayed snapshot, not an unseen projection");
  tree = view.render(); const current = filters(tree).filters;
  assert.equal(current.newArrivalsOnly, true); assert.equal(current.search, ""); assert.equal(current.groupId, null);
  assert.equal(current.owner, "all"); assert.equal(current.status, "all"); assert.equal(current.lifecycle, "active");
  assert.equal(current.chemistry, null); assert.equal(current.sortBy, "registered"); assert.equal(current.sortDirection, "desc");
  assert.equal(statusCount(tree, "all"), 24); assert.equal(statusCount(tree, "in"), 16); assert.equal(statusCount(tree, "out"), 8);
  assert.equal(rowIds(tree)[0], "BAT-024"); assert.equal(rowIds(tree).at(-1), "BAT-001");
  let draft = download(view); assert.deepEqual(draft.selectedIds, ["BAT-000"]); assert.equal(draft.matching, 24);
  const size = nodes(tree).find(node => node.type === "Select" && nodes(node).some(child => child.props["aria-label"] === "Batteries per page"));
  size.props.onValueChange("10"); tree = view.render(); assert.equal(rowIds(tree).length, 10);
  button(tree, "Next").props.onClick(); draft = download(view);
  assert.equal(draft.page, 1); assert.equal(draft.pageSize, "10"); assert.equal(draft.pageCount, 10); assert.equal(draft.matching, 24);
  assert.deepEqual(rowIds(view.render()), inventoryQuery.filterBatteries(view.props.data.batteries, draft.filter, "2026-10-08", actor, view.props.data.teachingGroups, view.props.newArrivals).slice(10, 20).map(item => item.id));
  filters(view.render()).onChange({ chemistry: "LiPo", status: "in" }); tree = view.render(); draft = download(view);
  assert.equal(draft.page, 0); assert.equal(draft.matching, 8); assert.equal(statusCount(tree, "all"), 12);
  assert.equal(statusCount(tree, "in"), 8); assert.equal(statusCount(tree, "out"), 4);
  assert.deepEqual(rowIds(tree), inventoryQuery.filterBatteries(view.props.data.batteries, draft.filter, "2026-10-08", actor, view.props.data.teachingGroups, view.props.newArrivals).map(item => item.id));
  byType(tree, "AppliedFilters").props.onClear(); draft = download(view);
  assert.equal(draft.filter.newArrivalsOnly, false); assert.deepEqual(draft.selectedIds, ["BAT-000"]);
  assert.deepEqual(view.acknowledgements, [25]);
});

test("viewing clears unread indicators without removing recent labels, and elapsed expiry removes labels without another acknowledgement", () => {
  const view = table(); quickEntry(view.render()).props.onClick();
  const viewed = { ...view.props.newArrivals, acknowledgedThroughSequence: 25, unreadCount: 0,
    items: view.props.newArrivals.items.map(item => ({ ...item, isUnread: false })) };
  view.props.newArrivals = viewed; let tree = view.render();
  const badges = () => nodes(tree).filter(node => node.props.className === "newArrivalBadge");
  assert.equal(badges().filter(node => node.props["data-visible"]).length, 24);
  assert.ok(badges().every(node => node.props["aria-hidden"] === false));
  assert.equal(nodes(quickEntry(tree)).filter(node => node.props.className === "unreadCount").length, 0);
  byType(tree, "AppliedFilters").props.onClear();
  view.props.newArrivals = arrivals.advanceArrivalClock(viewed, arrivals.NEW_ARRIVAL_WINDOW_MS);
  tree = view.render(); assert.ok(badges().every(node => node.props["data-visible"] === false && node.props["aria-hidden"] === true));
  assert.equal(view.props.newArrivals.unreadCount, 0); assert.deepEqual(view.acknowledgements, [25]);
});

function app(data, extra = {}) {
  const state = hooks(), acknowledgements = [], loadCalls = [], recovery = { groups: [], removals: [], retiredActions: [], intakes: [], scans: [], movements: [] };
  const arrivalState = { arrivals: data.newArrivals, pending: true, error: "Open New arrivals again to retry.", acknowledge: async cursor => { acknowledgements.push(cursor); }, ...extra };
  const { InventoryApp } = appFactory(state, {
    ...teachingRequests, ...teachingDrafts, sessionStorage: { getItem() { return null; } },
    useInventoryData: () => ({ user: data.user, dataset: data.dataset, data, loading: false, error: "", revision: 1, current: { current: data }, setError() {}, setRevision() {}, load: async dataset => { loadCalls.push(dataset); }, refresh() {}, changeDataset() {}, acceptReviewedInventory() {} }),
    useNewArrivals: nativeData => { assert.equal(nativeData.user.id, data.user.id); assert.equal(nativeData.dataset, data.dataset); return arrivalState; },
    useMessageCount: () => ({ unreadCount: 7, acceptUnreadCount() {} }), useWorkflowRecovery: () => ({ recovery, unavailable: false, read: () => recovery }),
    useInventoryPolling() {},
  });
  return { acknowledgements, loadCalls, render() { state.reset(); return InventoryApp({ initialUser: data.user }); } };
}

test("the actual app keeps global native inventory reminders separate from Messages and excludes acknowledgement/errors from personal and opened-group views", () => {
  const data = fixture(), view = app(data); let tree = view.render();
  let shell = byType(tree, "ApplicationShell"); assert.equal(shell.props.inventoryNoticeCount, 23); assert.equal(shell.props.unreadCount, 7);
  let inventory = nodes(tree, [], true).find(node => node.type === "InventoryTable");
  assert.equal(typeof inventory.props.onViewNewArrivals, "function"); assert.equal(inventory.props.arrivalsPending, true);
  for (const destination of ["my-batteries", "my-loans"]) {
    shell.props.onNavigate(destination); tree = view.render(); shell = byType(tree, "ApplicationShell");
    inventory = nodes(tree, [], true).find(node => node.type === "InventoryTable");
    assert.equal(inventory.props.onViewNewArrivals, undefined); assert.equal(inventory.props.arrivalsPending, false); assert.equal(inventory.props.arrivalsError, "");
    const personal = table(data, inventory.props); assert.equal(quickEntry(personal.render()), undefined);
    assert.equal(shell.props.inventoryNoticeCount, 23); assert.equal(shell.props.unreadCount, 7);
  }
  shell.props.onNavigate("inventory"); tree = view.render(); byType(tree, "ApplicationShell").props.onTeachingGroups();
  tree = view.render(); assert.equal(nodes(tree, [], true).find(node => node.type === "InventoryTable"), undefined);
  let workspace = byType(tree, "TeachingGroupsWorkspace"); workspace.props.onActiveChange(data.teachingGroups[0].id);
  workspace = byType(view.render(), "TeachingGroupsWorkspace");
  const groupState = hooks(), { TeachingGroupsWorkspace } = groupsFactory(groupState);
  groupState.reset(); const groupTree = TeachingGroupsWorkspace(workspace.props);
  const groupTable = byType(groupTree, "InventoryTable");
  assert.equal(groupTable.props.onViewNewArrivals, undefined); assert.equal(groupTable.props.arrivalsError, undefined);
  assert.equal(quickEntry(table(data, groupTable.props).render()), undefined);
  assert.deepEqual(view.acknowledgements, []); assert.deepEqual(view.loadCalls, []);
});

test("staff and administrator navigation expose the same native arrival count in expanded and icon views without changing message counts or acknowledging", () => {
  for (const role of ["staff", "admin"]) for (const expanded of [true, false]) {
    const data = fixture(); data.user.role = role; const view = app(data);
    const shellProps = byType(view.render(), "ApplicationShell").props;
    const state = hooks(), { ApplicationShell } = shellFactory(state, {
      useSidebar: () => ({ isMobile: false, open: expanded, toggleSidebar() {}, setOpenMobile() {} }), spring() {},
    });
    state.reset(); const tree = ApplicationShell(shellProps);
    const inventory = nodes(tree).find(node => node.type === "SidebarMenuButton" && node.props["data-navigation-view"] === "inventory");
    const messages = nodes(tree).find(node => node.type === "SidebarMenuButton" && node.props["aria-label"] === "Messages · 7 unread messages");
    assert.equal(inventory.props["aria-label"], "Battery inventory · 23 unread battery registration notices");
    assert.equal(inventory.props.tooltip, inventory.props["aria-label"]); assert.ok(messages);
    inventory.props.onClick({}); assert.deepEqual(view.acknowledgements, []);
    assert.equal(byType(view.render(), "ApplicationShell").props.unreadCount, 7);
  }
});
