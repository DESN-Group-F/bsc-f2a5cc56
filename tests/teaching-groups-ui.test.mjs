import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import * as groups from "../work/qa/teaching-groups.mjs";
import * as query from "../work/qa/inventory-query.mjs";
import * as lifecycle from "../work/qa/battery-lifecycle.mjs";
import * as client from "../work/qa/client-utils.mjs";
import * as locations from "../work/qa/location-catalog.mjs";

// Actual component handlers with inert UI boundaries; no browser or hardware claims.
const jsx = (type, props, key) => ({ type, props: props ?? {}, key });
const ui = Object.fromEntries(["Battery", "Package", "Plus", "Download", "Upload", "Pencil", "Settings2", "ClipboardList", "Copy", "Search", "X", "Button", "Input", "Textarea", "Label", "Checkbox", "Dialog", "DialogContent", "DialogHeader", "DialogTitle", "DialogDescription", "DialogFooter", "Select", "SelectTrigger", "SelectValue", "SelectContent", "SelectItem", "Table", "TableHeader", "TableBody", "TableRow", "TableHead", "TableCell", "Tabs", "TabsList", "TabsTrigger", "Skeleton", "AppliedFilters", "InventoryFilterPanel", "TeachingGroupsPanel"].map(name => [name, name]));
function hooks() {
    const state = [], effects = []; let pointer = 0, ep = 0, scheduled = [];
    return {
        reset() { pointer = 0; ep = 0; scheduled = []; },
        useState(initial) { const index = pointer++; if (!(index in state)) state[index] = typeof initial === "function" ? initial() : initial; return [state[index], value => { state[index] = typeof value === "function" ? value(state[index]) : value; }]; },
        useRef(initial) { const index = pointer++; if (!(index in state)) state[index] = { current: initial }; return state[index]; },
        useEffect(callback, deps) { const index = ep++, prior = effects[index]; if (!prior || deps.some((value, key) => !Object.is(value, prior.deps[key]))) scheduled.push(() => { prior?.cleanup?.(); effects[index] = { deps, cleanup: callback() }; }); },
        commit() { scheduled.forEach(callback => callback()); }, unmount() { effects.forEach(effect => effect?.cleanup?.()); },
    };
}
async function component(file, exports, state, extra = {}) {
    const source = ts.transpileModule(await readFile(file, "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } }).outputText.replace(/^import .*;\r?\n/gm, "").replace(/^export /gm, "");
    const bindings = { ...ui, ...query, ...groups, ...lifecycle, ...client, ...locations, ...state, currentSydneyDate: () => "2026-10-03", ...extra }, names = Object.keys(bindings);
    return new Function(...names, "_jsx", "_jsxs", "_Fragment", `${source}\nreturn {${exports.join(",")}};`)(...names.map(name => bindings[name]), jsx, jsx, "Fragment");
}
function nodes(node, result = []) { if (Array.isArray(node)) node.forEach(child => nodes(child, result)); else if (node && typeof node === "object") { result.push(node); nodes(node.props?.children, result); } return result; }
function text(node) { return typeof node === "string" || typeof node === "number" ? String(node) : Array.isArray(node) ? node.map(text).join("") : node && typeof node === "object" ? text(node.props?.children) : ""; }
const button = (tree, label) => nodes(tree).find(node => node.type === "Button" && text(node) === label);
const control = (tree, id) => nodes(tree).find(node => node.props?.id === id && ["Input", "Textarea"].includes(node.type));
const input = (tree, label) => nodes(tree).find(node => node.type === "Input" && node.props["aria-label"] === label);
const select = (tree, label) => nodes(tree).find(node => node.type === "Select" && nodes(node).some(child => child.props["aria-label"] === label));
const at = "2026-10-03T01:00:00.000Z";
function fixture() {
    const accountId = "teacher-a", teachingGroups = [{ id: crypto.randomUUID(), name: "Class A", notes: "Morning class", batteryIds: ["BAT-A", "BAT-B"], version: 1, ownerAccountId: accountId, state: "active", createdAt: at, updatedAt: at }];
    const batteries = ["BAT-A", "BAT-B", "BAT-C"].map((id, index) => ({ id, name: id, model: "PACK", chemistry: "LiPo", capacityMah: index ? 3000 : 2000, voltage: 7.4, tagId: null, version: 1, ownerId: "staff-" + accountId, ownerAccountId: accountId, ownerName: "Teacher", lifecycleStatus: "active", loanId: null, borrowerAccountId: null, borrowerKind: null, homeBuildingId: "J18", homeBuildingName: "Willis Annexe", manufacturedOn: null, firstUsedOn: null, registeredAt: at, observedAt: null, chargedAt: null, lastCheckedOutAt: null }));
    return { dataset: "demo", user: { id: accountId, role: "staff", username: "teacher" }, batteries, teachingGroups, buildings: [], rooms: [], people: [], staffDirectory: [] };
}
function result(data, payload) {
    const before = data.teachingGroups.find(group => group.id === payload.id);
    const group = payload.action === "remove" ? { ...before, version: payload.expectedVersion + 1, state: "archived", updatedAt: at } : { id: payload.id, name: payload.name, notes: payload.notes, batteryIds: payload.batteryIds, ownerAccountId: data.user.id, version: payload.action === "create" ? 1 : payload.expectedVersion + 1, state: "active", createdAt: before?.createdAt || at, updatedAt: at };
    return { requestId: payload.requestId, dataset: data.dataset, actorAccountId: data.user.id, action: payload.action, group, replayed: false };
}
async function panel({ data = fixture(), initialIds = [], entries = new Map(), transport, storageFlags = {}, options = {} } = {}) {
    const state = hooks(), requests = [], changed = [], closed = [], filtered = [], selected = [];
    const storage = { getItem(key) { if (storageFlags.read) throw new Error("Read denied"); return entries.get(key) ?? null; }, setItem(key, value) { if (storageFlags.write) throw new Error("Write denied"); entries.set(key, value); }, removeItem(key) { if (storageFlags.clear) throw new Error("Clear denied"); entries.delete(key); } };
    const fetch = async (url, options) => { const captured = JSON.parse(options.body); requests.push(captured); assert.ok(entries.has(groups.teachingGroupStorageKey(data.user.id, data.dataset)), "Persist before network"); return transport ? transport(captured.payload, requests.length, data) : { ok: true, async json() { return { result: result(data, captured.payload) }; } }; };
    const { TeachingGroupsPanel } = await component("components/inventory/teaching-groups-panel.tsx", ["TeachingGroupsPanel"], state, { fetch, sessionStorage: storage });
    const render = () => { state.reset(); const tree = TeachingGroupsPanel({ data, initialIds, onClose: () => closed.push(true), onChanged: async () => changed.push(true), onFilter: group => filtered.push(structuredClone(group)), onSelect: group => selected.push(structuredClone(group)), ...options }); state.commit(); return tree; };
    render(); return { data, requests, entries, changed, closed, filtered, selected, render, unmount: () => state.unmount() };
}

test("saving a selected teaching set sends no stock movement and persists a reviewed native-account request before network", async () => {
    const view = await panel({ initialIds: ["BAT-A", "BAT-B"] });
    control(view.render(), "teaching-group-name").props.onChange({ target: { value: "  Week 3 class  " } });
    control(view.render(), "teaching-group-notes").props.onChange({ target: { value: "  Shared stock, private shortcut  " } });
    assert.equal(view.requests.length, 0); await button(view.render(), "Save new group").props.onClick();
    assert.equal(view.requests.length, 1); assert.equal(view.requests[0].payload.name, "Week 3 class"); assert.deepEqual(view.requests[0].payload.batteryIds, ["BAT-A", "BAT-B"]);
    assert.equal(view.changed.length, 1); assert.equal(view.entries.size, 0); assert.ok(button(view.render(), "New group"));
});

test("saved groups support filtering or whole-group selection without a write; clear group search preserves saved membership", async () => {
    const view = await panel(); input(view.render(), "Search my teaching groups").props.onChange({ target: { value: "Does not exist" } });
    assert.match(text(view.render()), /0 matching groups/); button(view.render(), "Clear filters").props.onClick();
    button(view.render(), "Filter group").props.onClick(); assert.equal(view.filtered[0].id, view.data.teachingGroups[0].id);
    button(view.render(), "Select group batteries").props.onClick(); assert.deepEqual(view.selected[0].batteryIds, ["BAT-A", "BAT-B"]); assert.equal(view.requests.length, 0);
});

test("editing freezes the loaded group version until explicit latest review, and search clearing leaves draft fields and members intact", async () => {
    const view = await panel({ transport: async (payload, count, data) => payload.expectedVersion < data.teachingGroups[0].version ? { ok: false, status: 409, async json() { return { error: "Group changed; draft preserved", code: "teaching_group_rejected_final" }; } } : { ok: true, async json() { return { result: result(data, payload) }; } } }); button(view.render(), "Edit").props.onClick();
    control(view.render(), "teaching-group-name").props.onChange({ target: { value: "My edited class" } });
    input(view.render(), "Find teaching group batteries").props.onChange({ target: { value: "BAT-C" } });
    button(view.render(), "Clear filters").props.onClick(); assert.equal(control(view.render(), "teaching-group-name").props.value, "My edited class"); assert.match(text(view.render()), /2\/100 selected/);
    view.data.teachingGroups[0] = { ...view.data.teachingGroups[0], version: 2, name: "Other tab change" };
    await button(view.render(), "Save changes").props.onClick(); assert.equal(view.requests[0].payload.expectedVersion, 1);
    assert.equal(control(view.render(), "teaching-group-name").props.value, "My edited class"); button(view.render(), "Load latest group").props.onClick(); assert.equal(control(view.render(), "teaching-group-name").props.value, "Other tab change");
    await button(view.render(), "Save changes").props.onClick(); assert.equal(view.requests[1].payload.expectedVersion, 2);
});

test("unknown saves freeze the exact draft, recover on reopening, and reject mismatched receipts before accepting replay", async () => {
    const entries = new Map(), data = fixture(); let succeeds = false;
    const transport = async (payload) => { if (!succeeds) throw new Error("Lost response"); return { ok: true, async json() { return { result: result(data, payload) }; } }; };
    const first = await panel({ data, initialIds: ["BAT-A", "BAT-B"], entries, transport }); control(first.render(), "teaching-group-name").props.onChange({ target: { value: "Preserved class" } }); await button(first.render(), "Save new group").props.onClick();
    const captured = structuredClone(first.requests[0]); assert.equal(control(first.render(), "teaching-group-name").props.disabled, true); first.unmount();
    const wrong = await panel({ data, entries, transport: async payload => ({ ok: true, async json() { return { result: { ...result(data, payload), actorAccountId: "other" } }; } }) });
    await button(wrong.render(), "Retry exact group request").props.onClick(); assert.ok(button(wrong.render(), "Retry exact group request")); assert.equal(wrong.changed.length, 0); wrong.unmount();
    succeeds = true; const restored = await panel({ data, entries, transport }); assert.equal(control(restored.render(), "teaching-group-name").props.value, "Preserved class"); await button(restored.render(), "Retry exact group request").props.onClick();
    assert.deepEqual(restored.requests[0], captured); assert.equal(restored.entries.size, 0); assert.equal(restored.changed.length, 1);
});

test("storage write/read/clear failures block replacement writes and keep exact recoverable request identity", async () => {
    const flags = { write: true }, view = await panel({ initialIds: ["BAT-A"], storageFlags: flags }); control(view.render(), "teaching-group-name").props.onChange({ target: { value: "Storage class" } }); await button(view.render(), "Save new group").props.onClick();
    assert.equal(view.requests.length, 0); flags.write = false; flags.clear = true; await button(view.render(), "Retry exact group request").props.onClick(); assert.equal(view.requests.length, 1); const original = view.requests[0]; assert.ok(button(view.render(), "Retry exact group request"));
    flags.clear = false; await button(view.render(), "Retry exact group request").props.onClick(); assert.deepEqual(view.requests[1], original); assert.equal(view.entries.size, 0);
    const blocked = await panel({ initialIds: ["BAT-A"], storageFlags: { read: true } }); assert.equal(button(blocked.render(), "Save new group").props.disabled, true); await button(blocked.render(), "Save new group").props.onClick(); assert.equal(blocked.requests.length, 0);
});

test("removing a saved group is a captured versioned preference action and never submits battery state changes", async () => {
    const view = await panel(); button(view.render(), "Remove group").props.onClick(); assert.equal(view.requests.length, 0); await button(view.render(), "Remove saved group").props.onClick();
    assert.deepEqual(Object.keys(view.requests[0].payload).sort(), ["action", "expectedVersion", "id", "requestId"]); assert.equal(view.requests[0].payload.action, "remove"); assert.equal(view.changed.length, 1);
});

test("unmounted delayed group results cannot refresh another dataset or clear a newer preserved request", async () => {
    let release; const view = await panel({ initialIds: ["BAT-A"], transport: payload => new Promise(resolve => { release = () => resolve({ ok: true, async json() { return { result: result(view.data, payload) }; } }); }) });
    control(view.render(), "teaching-group-name").props.onChange({ target: { value: "Delayed class" } }); const write = button(view.render(), "Save new group").props.onClick(); await new Promise(resolve => setTimeout(resolve, 0)); view.unmount();
    const key = groups.teachingGroupStorageKey(view.data.user.id, view.data.dataset), newer = groups.captureTeachingGroupAttempt(view.data.user.id, view.data.dataset, { ...view.requests[0].payload, requestId: crypto.randomUUID() }); view.entries.set(key, JSON.stringify(newer)); release(); await write;
    assert.equal(view.changed.length, 0); assert.deepEqual(JSON.parse(view.entries.get(key)), newer);
});

test("inventory groups select members across pages while respecting the fixed personal scope and retired eligibility", async () => {
    const data = fixture(), state = hooks(), scope = "responsible", exports = [];
    data.batteries[1] = { ...data.batteries[1], ownerAccountId: "other-account" }; data.batteries[0] = { ...data.batteries[0], lifecycleStatus: "scrapped" };
    const more = Array.from({ length: 30 }, (_, index) => ({ ...data.batteries[2], id: `BAT-EXTRA-${String(index).padStart(3, "0")}` }));
    data.batteries.push(...more); data.teachingGroups[0].batteryIds.push(...more.map(battery => battery.id));
    const { appliedFilterChips } = await component("components/inventory/inventory-filter-panel.tsx", ["appliedFilterChips"], hooks());
    const { InventoryTable } = await component("components/inventory/views.tsx", ["InventoryTable"], state, { appliedFilterChips });
    const render = () => { state.reset(); const tree = InventoryTable({ data, ready: true, personalScope: scope, onEdit() {}, onDetail() {}, onSetup() {}, onMovement() {}, onExport: value => exports.push(value) }); state.commit(); return tree; };
    button(render(), "Teaching groups").props.onClick(); const manager = nodes(render()).find(node => node.type === "TeachingGroupsPanel"); manager.props.onSelect(data.teachingGroups[0]); manager.props.onClose();
    const tree = render(); assert.match(text(tree), /31 batteries selected\. 1 member is outside this personal view/); assert.equal(button(tree, "Check out selected").props.disabled, true); assert.equal(button(tree, "Download selected").props.disabled, false);
    button(tree, "Download selected").props.onClick(); assert.deepEqual(exports[0].selectedIds, ["BAT-A", ...more.map(battery => battery.id)]); assert.equal(exports[0].filter.personalScope, "responsible"); assert.equal(exports[0].pageCount, 25);
});

test("sort criteria appear in applied filters and Clear filters restores ID ascending without clearing selections or personal scope", async () => {
    const data = fixture(), state = hooks(), changes = [], filters = { ...query.defaultInventoryFilter(), personalScope: "responsible", sortBy: "capacity", sortDirection: "desc", groupId: data.teachingGroups[0].id };
    const { InventoryFilterPanel, appliedFilterChips } = await component("components/inventory/inventory-filter-panel.tsx", ["InventoryFilterPanel", "appliedFilterChips"], state);
    state.reset(); const tree = InventoryFilterPanel({ data, filters, asOfOn: "2026-10-03", onChange: patch => changes.push(patch) });
    assert.equal(select(tree, "Battery sort direction").props.value, "desc"); select(tree, "Sort batteries by").props.onValueChange("registered"); assert.deepEqual(changes, [{ sortBy: "registered" }]);
    const chips = appliedFilterChips(filters, data); assert.match(chips.find(chip => chip.key === "sort").label, /Capacity.*Descending/); assert.equal(chips.find(chip => chip.key === "group").label, "Teaching group: Class A");
    assert.deepEqual(chips.find(chip => chip.key === "sort").reset, { sortBy: "id", sortDirection: "asc" }); assert.deepEqual(chips.find(chip => chip.key === "group").reset, { groupId: null });
    const tableState = hooks(), table = await component("components/inventory/views.tsx", ["InventoryTable"], tableState, { appliedFilterChips });
    const render = () => { tableState.reset(); const current = table.InventoryTable({ data, ready: true, personalScope: "responsible", onEdit() {}, onDetail() {}, onSetup() {}, onMovement() {}, onExport() {} }); tableState.commit(); return current; };
    nodes(render()).find(node => node.type === "Checkbox" && node.props["aria-label"] === "Select BAT-A").props.onCheckedChange(true);
    button(render(), "Filter").props.onClick(); nodes(render()).find(node => node.type === "InventoryFilterPanel").props.onChange({ groupId: data.teachingGroups[0].id, sortBy: "voltage", sortDirection: "desc" });
    nodes(render()).find(node => node.type === "AppliedFilters").props.onClear(); const cleared = render(), clearedFilters = nodes(cleared).find(node => node.type === "InventoryFilterPanel").props.filters;
    assert.equal(clearedFilters.sortBy, "id"); assert.equal(clearedFilters.sortDirection, "asc"); assert.equal(clearedFilters.groupId, null); assert.equal(clearedFilters.personalScope, "responsible"); assert.match(text(cleared), /1 selected/);
});
test("adding selected batteries to an existing group reviews the union and loaded version without changing stock", async () => {
    const view = await panel({ initialIds: ["BAT-B", "BAT-C"], options: { addToExisting: true } });
    assert.match(text(view.render()), /2 selected batteries/);
    button(view.render(), "Add selected batteries").props.onClick();
    assert.match(text(view.render()), /3\/100 selected/);
    await button(view.render(), "Save changes").props.onClick();
    assert.equal(view.requests.length, 1);
    assert.equal(view.requests[0].payload.action, "update");
    assert.equal(view.requests[0].payload.expectedVersion, 1);
    assert.deepEqual(view.requests[0].payload.batteryIds, ["BAT-A", "BAT-B", "BAT-C"]);
    assert.equal(view.data.batteries.filter(battery => battery.loanId).length, 0);
});

test("opening a workspace group for editing starts with its captured members and version", async () => {
    const data = fixture(), view = await panel({ data, options: { initialGroup: data.teachingGroups[0] } });
    assert.equal(control(view.render(), "teaching-group-name").props.value, "Class A");
    assert.match(text(view.render()), /2\/100 selected/);
    await button(view.render(), "Save changes").props.onClick();
    assert.equal(view.requests[0].payload.expectedVersion, 1);
});
