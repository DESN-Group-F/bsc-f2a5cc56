import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import * as client from "../work/qa/client-utils.mjs";
import * as locations from "../work/qa/location-catalog.mjs";
import * as schedule from "../work/qa/task-schedule.mjs";
import { defaultInventoryFilter } from "../work/qa/inventory-query.mjs";

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
const ui = Object.fromEntries(["Search", "X", "CalendarDays", "CheckCircle2", "Button", "Input", "Textarea", "Label", "Checkbox", "RecordPicker", "Dialog", "DialogContent", "DialogHeader", "DialogTitle", "DialogDescription", "DialogFooter", "Select", "SelectTrigger", "SelectContent", "SelectValue", "SelectItem"].map(name => [name, name]));
async function component(path, exports, state = hooks(), additional = {}) {
    const input = await readFile(path, "utf8");
    const output = ts.transpileModule(input, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } }).outputText.replace(/^import .*;\r?\n/gm, "").replace(/^export \{[^\n]*\} from [^;]+;\r?\n/gm, "").replace(/^export /gm, "");
    const bindings = { ...ui, ...client, ...locations, ...schedule, ...state, ...additional, currentSydneyDate: () => "2026-10-03" }, names = Object.keys(bindings);
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
    const { TaskPlanEditor, assignmentNames } = await component("components/inventory/task-plans-panel.tsx", ["TaskPlanEditor", "assignmentNames"], state, { ...taskCreate, sessionStorage: { getItem: () => null } });
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
