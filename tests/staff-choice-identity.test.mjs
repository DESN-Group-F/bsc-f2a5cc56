import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import * as client from "../work/qa/client-utils.mjs";
import * as lifecycle from "../work/qa/battery-lifecycle.mjs";
import * as locations from "../work/qa/location-catalog.mjs";
import * as schedule from "../work/qa/task-schedule.mjs";
import * as inventoryQuery from "../work/qa/inventory-query.mjs";
const { defaultInventoryFilter } = inventoryQuery;

// Render the actual component functions with inert UI boundaries. These probes
// exercise labels and handlers without changing a browser or business database.
function hooks() {
    const state = [];
    let pointer = 0;
    return {
        reset() { pointer = 0; },
        useState(initial) {
            const index = pointer++;
            if (!(index in state)) state[index] = typeof initial === "function" ? initial() : initial;
            return [state[index], update => { state[index] = typeof update === "function" ? update(state[index]) : update; }];
        },
        useRef(initial) {
            const index = pointer++;
            if (!(index in state)) state[index] = { current: initial };
            return state[index];
        },
        useEffect() {},
    };
}
const jsx = (type, props, key) => ({ type, props: props ?? {}, key });
function nodes(node, results = []) {
    if (Array.isArray(node)) { for (const item of node) nodes(item, results); return results; }
    if (!node || typeof node !== "object") return results;
    results.push(node); nodes(node.props?.children, results); return results;
}
function text(node) {
    if (typeof node === "string" || typeof node === "number") return String(node);
    if (Array.isArray(node)) return node.map(text).join("");
    return node && typeof node === "object" ? text(node.props?.children) : "";
}
const ui = Object.fromEntries(["Search", "X", "CalendarDays", "CheckCircle2", "Battery", "Package", "Plus", "Download", "Upload", "Pencil", "Settings2", "ClipboardList", "Copy", "Button", "Input", "Textarea", "Label", "Checkbox", "RecordPicker", "BatteryModelPicker", "Dialog", "DialogContent", "DialogHeader", "DialogTitle", "DialogDescription", "DialogFooter", "Select", "SelectTrigger", "SelectContent", "SelectValue", "SelectItem", "Tabs", "TabsList", "TabsTrigger", "Table", "TableHeader", "TableBody", "TableRow", "TableHead", "TableCell", "Skeleton", "InventoryFilterPanel", "AppliedFilters"].map(name => [name, name]));
async function component(path, exports, state = hooks(), additional = {}) {
    const paths = Array.isArray(path) ? path : [path];
    const input = (await Promise.all(paths.map(file => readFile(file, "utf8")))).join("\n");
    const output = ts.transpileModule(input, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } }).outputText.replace(/^import .*;\r?\n/gm, "").replace(/^export \{[^\n]*\} from [^;]+;\r?\n/gm, "").replace(/^export /gm, "");
    const bindings = { ...ui, ...client, ...locations, ...lifecycle, ...schedule, ...inventoryQuery, ...state, ...additional, currentSydneyDate: () => "2026-10-03" }, names = Object.keys(bindings);
    return new Function(...names, "_jsx", "_jsxs", "_Fragment", `${output}\nreturn { ${exports.join(", ")} };`)(...names.map(name => bindings[name]), jsx, jsx, "Fragment");
}
function fixture() {
    const accounts = [
        { id: "account-prefix-one", displayName: "Same Staff", username: "teacher-one", active: true },
        { id: "account-prefix-two", displayName: "Same Staff", username: "teacher-two", active: true },
        { id: "account-prefix-disabled", displayName: "Same Staff", username: "", active: false },
    ];
    return {
        dataset: "demo", user: { id: "review-account", username: "reviewer", displayName: "Reviewer", role: "admin" },
        people: accounts.map(account => ({ id: `staff-${account.id}`, accountId: account.id, name: account.displayName, role: "staff", version: 1, reference: "" })).concat({ id: "staff-unavailable", accountId: "account-prefix-unavailable", name: "Same Staff", role: "staff", version: 1, reference: "" }),
        staffDirectory: accounts,
        batteries: accounts.map((account, index) => ({ id: `BAT-${index}`, name: "Test battery", model: "", chemistry: "", loanId: `loan-${index}`, borrowerKind: "staff", borrowerName: "Same Staff", borrowerAccountId: account.id })),
        buildings: [{ id: "J18", name: "Willis Annexe" }], rooms: [],
    };
}
function select(tree, label) { return nodes(tree).find(node => node.type === "Select" && nodes(node).some(child => child.props["aria-label"] === label)); }
function options(select) { return nodes(select).filter(node => node.type === "SelectItem" && node.props.value !== "all").map(node => ({ id: node.props.value, label: text(node) })); }

test("registration distinguishes same-name owners, retains inactive guards and submits the chosen person ID", async () => {
    const state = hooks(), data = fixture(), writes = [];
    const { RecordEditor } = await component("components/inventory/record-editor.tsx", ["RecordEditor"], state);
    const props = { draft: { kind: "battery", initialTagId: "UNKNOWN-THEN-REGISTERED" }, data, onClose() {}, async write(kind, payload) { writes.push({ kind, payload }); } };
    const render = () => { state.reset(); return RecordEditor(props); };
    const owner = nodes(render()).find(node => node.type === "RecordPicker" && node.props.id === "edit-owner");
    assert.deepEqual(owner.props.options, [
        { id: "staff-account-prefix-one", label: "Same Staff (teacher-one)", disabled: false },
        { id: "staff-account-prefix-two", label: "Same Staff (teacher-two)", disabled: false },
        { id: "staff-account-prefix-disabled", label: "Same Staff (account-prefix-disabled) — Inactive account", disabled: true },
        { id: "staff-unavailable", label: "Same Staff (account-prefix-unavailable)", disabled: true },
    ]);
    assert.equal(new Set(owner.props.options.map(option => option.label)).size, 4);
    owner.props.onChange("staff-account-prefix-two");
    const tree = render();
    assert.equal(nodes(tree).find(node => node.type === "RecordPicker" && node.props.id === "edit-owner").props.value, "staff-account-prefix-two");
    assert.equal(nodes(tree).find(node => node.type === "Input" && node.props.id === "edit-tagId").props.value, "UNKNOWN-THEN-REGISTERED");
    await nodes(tree).find(node => node.type === "form").props.onSubmit({ preventDefault() {} });
    assert.equal(writes[0].kind, "battery");
    assert.equal(writes[0].payload.ownerId, "staff-account-prefix-two");
    assert.equal(writes[0].payload.tagId, "UNKNOWN-THEN-REGISTERED");
    assert.equal(client.staffIdentityLabel("Staff without account", null, "full-person-identifier"), "Staff without account (full-person-identifier)");
    assert.equal(client.staffIdentityLabel("Staff without username", "  ", "full-account-identifier"), "Staff without username (full-account-identifier)");
});

test("owner and holder filters use distinct identities and the same applied labels without changing filter keys", async () => {
    const data = fixture(), patches = [], filters = { ...defaultInventoryFilter(), owner: "staff-account-prefix-two", holder: "account-prefix-two" };
    const { InventoryFilterPanel, appliedFilterChips } = await component("components/inventory/inventory-filter-panel.tsx", ["InventoryFilterPanel", "appliedFilterChips"]);
    const tree = InventoryFilterPanel({ data, filters, asOfOn: "2026-10-03", onChange: patch => patches.push(patch) });
    const owner = select(tree, "Filter by responsible owner"), holder = select(tree, "Filter by current staff holder");
    assert.deepEqual(options(owner), [
        { id: "staff-account-prefix-one", label: "Same Staff (teacher-one)" },
        { id: "staff-account-prefix-two", label: "Same Staff (teacher-two)" },
        { id: "staff-account-prefix-disabled", label: "Same Staff (account-prefix-disabled)" },
        { id: "staff-unavailable", label: "Same Staff (account-prefix-unavailable)" },
    ]);
    assert.deepEqual(options(holder), [
        { id: "account-prefix-one", label: "Same Staff (teacher-one)" },
        { id: "account-prefix-two", label: "Same Staff (teacher-two)" },
        { id: "account-prefix-disabled", label: "Same Staff (account-prefix-disabled)" },
    ]);
    owner.props.onValueChange("staff-account-prefix-one"); holder.props.onValueChange("account-prefix-one");
    assert.deepEqual(patches, [{ owner: "staff-account-prefix-one" }, { holder: "account-prefix-one" }]);
    assert.deepEqual(appliedFilterChips(filters, data).filter(chip => ["owner", "holder"].includes(chip.key)), [
        { key: "owner", label: "Responsible owner: Same Staff (teacher-two)", reset: { owner: "all" } },
        { key: "holder", label: "Current holder: Same Staff (teacher-two)", reset: { holder: "all" } },
    ]);
    const missing = InventoryFilterPanel({ data, filters: { ...filters, holder: "account-prefix-unavailable" }, asOfOn: "2026-10-03", onChange() {} });
    assert.equal(options(select(missing, "Filter by current staff holder")).at(-1).label, "Staff account (account-prefix-unavailable) · no current loans");
    assert.equal(appliedFilterChips({ ...filters, owner: "unavailable-person-record", holder: "account-prefix-unavailable" }, data).find(chip => chip.key === "owner").label, "Responsible owner: Staff owner (unavailable-person-record)");
});

test("task staff choices and assignment summaries keep full identity fallbacks and account-ID selection", async () => {
    const data = fixture(), state = hooks();
    const taskCreate = await component("lib/task-create-session.ts", ["captureTaskCreate", "recoverTaskCreate", "taskCreateFailureStatus", "taskCreateStorageKey", "verifyTaskCreateReceipt"]);
    const { TaskPlanEditor, assignmentNames } = await component(["components/inventory/tasks/task-presentation.ts", "components/inventory/tasks/task-plan-editor.tsx"], ["TaskPlanEditor", "assignmentNames"], state, { ...taskCreate, sessionStorage: { getItem: () => null } });
    const original = schedule.taskPlanSchema.parse({ title: "Test plan", category: "inventory_reconciliation", assigneeIds: ["account-prefix-disabled"] });
    const render = () => { state.reset(); return TaskPlanEditor({ original, data, cycles: [], onClose() {}, async onSaved() {} }); };
    const assigned = tree => nodes(tree).find(node => node.type === "fieldset" && nodes(node).some(child => child.type === "legend" && text(child) === "Assigned staff"));
    const choices = nodes(assigned(render())).filter(node => node.type === "label");
    assert.deepEqual(choices.map(node => text(nodes(node).find(child => child.type === "strong"))), ["Same Staff (teacher-one)", "Same Staff (teacher-two)", "Same Staff (account-prefix-disabled)"]);
    nodes(choices[1]).find(node => node.type === "Checkbox").props.onCheckedChange(true);
    const current = nodes(assigned(render())).filter(node => node.type === "label");
    assert.equal(nodes(current[0]).find(node => node.type === "Checkbox").props.checked, false);
    assert.equal(nodes(current[1]).find(node => node.type === "Checkbox").props.checked, true);
    assert.equal(assignmentNames(["account-prefix-two", "account-prefix-disabled", "account-prefix-unavailable"], data), "Same Staff (teacher-two), Same Staff (account-prefix-disabled), Unavailable staff account (account-prefix-unavailable)");
});

function button(tree, label) { return nodes(tree).find(node => node.type === "Button" && text(node) === label); }

test("removal-record exports keep their captured selected IDs and prevent changing to filtered or page scope", async () => {
    const state = hooks(), downloads = [], closed = [];
    const { ExportDialog } = await component("components/inventory/export-dialog.tsx", ["ExportDialog"], state, {
        async downloadExportAttachment(input, format, filename) { downloads.push({ input: structuredClone(input), format, filename }); },
    });
    const draft = { selectedOnly: true, selectedIds: ["BAT-REMOVED-1", "BAT-REMOVED-2", "BAT-REMOVED-1"], filter: { ...defaultInventoryFilter(), lifecycle: "all" }, page: 3, pageSize: "25", matching: 58, pageCount: 25 };
    const render = () => { state.reset(); return ExportDialog({ draft, dataset: "demo", onClose: () => closed.push(true) }); };
    const initial = render(), range = select(initial, "Export battery range");
    assert.equal(select(initial, "Export information depth").props.value, "detail");
    assert.equal(range.props.value, "selected");
    assert.equal(range.props.disabled, true);
    assert.deepEqual(options(range), [{ id: "selected", label: "Selected batteries (2)" }]);
    assert.match(text(initial), /Includes the captured matching removal records only\./);
    assert.match(text(initial), /2 batteries/);
    assert.ok(nodes(initial).some(node => node.type === "fieldset"));
    draft.selectedIds.push("BAT-ADDED-AFTER-DIALOG-OPENED");
    draft.selectedIds[0] = "BAT-REPLACED-AFTER-DIALOG-OPENED";
    select(render(), "Export file format").props.onValueChange("json");
    await button(render(), "Download").props.onClick();
    assert.equal(downloads.length, 1);
    assert.equal(downloads[0].input.range, "selected");
    assert.equal(downloads[0].input.mode, "detail");
    assert.deepEqual(downloads[0].input.batteryIds, ["BAT-REMOVED-1", "BAT-REMOVED-2"]);
    assert.equal(downloads[0].input.filter.lifecycle, "all");
    assert.equal(downloads[0].input.sections.length, inventoryQuery.exportSections.length);
    assert.equal(downloads[0].format, "json");
    assert.equal(closed.length, 1);
});

test("ordinary inventory exports retain their selectable filtered and page ranges", async () => {
    const state = hooks(), downloads = [];
    const { ExportDialog } = await component("components/inventory/export-dialog.tsx", ["ExportDialog"], state, {
        async downloadExportAttachment(input, format) { downloads.push({ input: structuredClone(input), format }); },
    });
    const draft = { selectedIds: ["BAT-SELECTED"], filter: defaultInventoryFilter(), page: 2, pageSize: "10", matching: 34, pageCount: 10 };
    const render = () => { state.reset(); return ExportDialog({ draft, dataset: "demo", onClose() {} }); };
    const range = select(render(), "Export battery range");
    assert.equal(range.props.disabled, undefined);
    assert.deepEqual(options(range).map(option => option.id), ["selected", "filtered", "page"]);
    range.props.onValueChange("page");
    assert.match(text(render()), /10 batteriesPage 3/);
    await button(render(), "Download").props.onClick();
    assert.equal(downloads[0].input.range, "page");
    assert.equal(downloads[0].input.mode, "summary");
    assert.equal(downloads[0].input.batteryIds, undefined);
    assert.equal(downloads[0].input.page, 2);
});

function inventoryBattery(id, accountId, extra = {}) {
    return {
        id, name: "Personal test battery", chemistry: "", model: "", capacityMah: null, voltage: null,
        tagId: "DEMO-" + id, manufacturedOn: null, firstUsedOn: null, registeredAt: "2026-10-01T00:00:00.000Z",
        lifecycleStatus: "active", lifecycleAt: null, lifecycleReason: null, lifecycleDestination: null, version: 1,
        ownerId: "staff-" + accountId, ownerName: "Responsible staff", ownerAccountId: accountId,
        homeBuildingId: "J18", homeBuildingName: "Willis Annexe", homeRoomId: null, homeRoomName: null, homeRoomNumber: null,
        homeRoomIsPlaceholder: null, homeRoomSelectable: null, loanId: null, borrowerId: null, borrowerName: null,
        borrowerAccountId: null, borrowerKind: null, checkedOutAt: null, lastCheckedOutAt: null,
        observedRoom: null, observedBuilding: null, observationRoomSnapshot: null, observedAt: null, observationSource: null,
        chargedAt: null, chargeDurationMinutes: null, ...extra,
    };
}
async function personalTable(scope = "responsible") {
    const data = fixture(), state = hooks(), exports = [], movements = [];
    data.batteries = [inventoryBattery("BAT-PERSONAL", data.user.id), inventoryBattery("BAT-OTHER", "other-account")];
    const { appliedFilterChips } = await component("components/inventory/inventory-filter-panel.tsx", ["appliedFilterChips"]);
    const { InventoryTable } = await component("components/inventory/inventory-table.tsx", ["InventoryTable"], state, { appliedFilterChips });
    const props = { data, ready: true, personalScope: scope, onEdit() {}, onDetail() {}, onSetup() {}, onMovement: (kind, ids) => movements.push({ kind, ids }), onExport: draft => exports.push(structuredClone(draft)) };
    return { data, exports, movements, render() { state.reset(); return InventoryTable(props); } };
}

test("personal responsibility selections remain downloadable after scrap or permanent removal and stay disabled for movements", async () => {
    for (const lifecycleStatus of ["scrapped", "permanently_removed"]) {
        const table = await personalTable();
        nodes(table.render()).find(node => node.type === "Checkbox" && node.props["aria-label"] === "Select BAT-PERSONAL").props.onCheckedChange(true);
        table.data.batteries[0] = { ...table.data.batteries[0], lifecycleStatus, lifecycleAt: "2026-10-03T00:00:00.000Z", version: 2 };
        const tree = table.render();
        assert.match(text(tree), /1 selected · 1 outside current filters/);
        assert.doesNotMatch(text(tree), /Your selected batteries have changed scope/);
        assert.equal(button(tree, "Download selected").props.disabled, false);
        assert.equal(button(tree, "Check out selected").props.disabled, true);
        assert.equal(button(tree, "Return selected").props.disabled, true);
        button(tree, "Download selected").props.onClick();
        assert.equal(table.exports.length, 1);
        assert.deepEqual(table.exports[0].selectedIds, ["BAT-PERSONAL"]);
        assert.equal(table.exports[0].filter.personalScope, "responsible");
        assert.equal(table.exports[0].filter.lifecycle, "active");
        assert.equal(table.exports[0].matching, 0);
        assert.equal(table.movements.length, 0);
        nodes(tree).find(node => node.type === "Button" && node.props["aria-controls"] === "inventory-filter-panel").props.onClick();
        nodes(table.render()).find(node => node.type === "InventoryFilterPanel").props.onChange({ lifecycle: "all" });
        const all = table.render();
        assert.ok(nodes(all).some(node => node.type === "Checkbox" && node.props["aria-label"] === "Select BAT-PERSONAL" && node.props.checked === true));
        assert.ok(!nodes(all).some(node => node.type === "Checkbox" && node.props["aria-label"] === "Select BAT-OTHER"));
        assert.match(text(all), lifecycleStatus === "scrapped" ? /Scrapped/ : /Permanently removed/);
        assert.equal(button(all, "Download selected").props.disabled, false);
    }
});

test("real personal ownership or loan scope changes still block captured selections until they are removed", async () => {
    for (const scope of ["responsible", "borrowed"]) {
        const table = await personalTable(scope);
        if (scope === "borrowed") table.data.batteries[0] = { ...table.data.batteries[0], loanId: "loan-personal", borrowerAccountId: table.data.user.id, borrowerKind: "staff" };
        nodes(table.render()).find(node => node.type === "Checkbox" && node.props["aria-label"] === "Select BAT-PERSONAL").props.onCheckedChange(true);
        table.data.batteries[0] = { ...table.data.batteries[0], ...(scope === "responsible" ? { ownerAccountId: "other-account" } : { loanId: null, borrowerAccountId: null, borrowerKind: null }), version: 2 };
        const tree = table.render();
        assert.match(text(tree), /Your selected batteries have changed scope/);
        assert.equal(button(tree, "Download selected").props.disabled, true);
        button(tree, "Download selected").props.onClick();
        assert.equal(table.exports.length, 0);
        button(tree, "Remove batteries outside this view").props.onClick();
        assert.ok(!button(table.render(), "Download selected"));
    }
});
