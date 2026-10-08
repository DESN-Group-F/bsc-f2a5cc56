import { hasRowTextSelection } from "../work/qa/client/row-selection.mjs";
import { defaultInventoryFilter } from "../work/qa/inventory-query.mjs";
import * as batterySelection from "../work/qa/battery-selection-query.mjs";
import { getRolePermissions } from "../work/qa/permissions.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import { captureTaskCreate, recoverTaskCreate, taskCreateFailureStatus, taskCreateStorageKey, verifyTaskCreateReceipt } from "../work/qa/task-create-session.mjs";
import { createCustomTaskPlan, taskCategories, taskTemplates, taskPlanSchema, taskSchedulePreview, taskTargetsByCategory, taskPlanMatchesQuery } from "../work/qa/task-schedule.mjs";

const requestId = "22222222-2222-4222-8222-222222222222", planId = "33333333-3333-4333-8333-333333333333";
const accountId = "44444444-4444-4444-8444-444444444444";
const makePlan = () => ({ ...structuredClone(taskTemplates[1].plan), channels: ["messages"] });
const makeAttempt = () => captureTaskCreate(makePlan(), accountId, "demo", requestId);
const receipt = (attempt, changes = {}) => ({ id: planId, version: 1, requestId: attempt.input.requestId, action: "create", actorAccountId: attempt.accountId, dataset: attempt.input.dataset, ...changes });

test("task creation captures a validated plan independently of later draft edits", () => {
    const plan = makePlan(), captured = captureTaskCreate(plan, accountId, "demo", requestId);
    plan.title = "Changed after submission"; plan.assigneeIds.push(accountId); plan.channels.push("email");
    assert.notEqual(captured.input.payload.title, plan.title);
    assert.deepEqual(captured.input.payload.assigneeIds, []);
    assert.deepEqual(captured.input.payload.channels, ["messages"]);
    assert.equal(captured.input.action, "create");
    assert.equal(captured.status, "uncertain");
    assert.throws(() => captureTaskCreate({ ...makePlan(), title: "" }, accountId, "demo", requestId));
    assert.throws(() => captureTaskCreate(makePlan(), "", "demo", requestId));
    assert.throws(() => captureTaskCreate(makePlan(), accountId, "demo", "fresh"));
});

test("task create recovery restores exact requests only for the original account and inventory", () => {
    const captured = makeAttempt(), raw = JSON.stringify(captured);
    assert.deepEqual(recoverTaskCreate(raw, accountId, "demo"), captured);
    assert.equal(recoverTaskCreate(raw, "another-account", "demo"), null);
    assert.equal(recoverTaskCreate(raw, accountId, "live"), null);
    assert.notEqual(taskCreateStorageKey(accountId, "demo"), taskCreateStorageKey(accountId, "live"));
    assert.notEqual(taskCreateStorageKey(accountId, "demo"), taskCreateStorageKey("another-account", "demo"));
    for (const changes of [{ accountId: "other" }, { status: "completed" }, { message: 3 }, { input: { ...captured.input, action: "update" } }, { input: { ...captured.input, requestId: "new" } }, { input: { ...captured.input, extra: "unexpected" } }, { input: { ...captured.input, payload: { ...captured.input.payload, title: "" } } }]) {
        assert.equal(recoverTaskCreate(JSON.stringify({ ...captured, ...changes }), accountId, "demo"), null);
    }
    assert.equal(recoverTaskCreate("{", accountId, "demo"), null);
    assert.equal(recoverTaskCreate(null, accountId, "demo"), null);
});

test("an uncertain task create needs a terminal server reservation before its captured input can be released", () => {
    assert.equal(taskCreateFailureStatus(new Error("Connection interrupted")), "uncertain");
    assert.equal(taskCreateFailureStatus({ status: 503 }), "uncertain");
    assert.equal(taskCreateFailureStatus({ status: 200 }), "uncertain");
    for (const status of [400, 401, 403, 404, 409, 429]) {
        assert.equal(taskCreateFailureStatus({ status }), "rejected");
        assert.equal(taskCreateFailureStatus({ status }, true), "uncertain");
        assert.equal(taskCreateFailureStatus({ status, code: "record_conflict" }, true), "uncertain");
        assert.equal(taskCreateFailureStatus({ status, code: "task_create_rejected_final" }, true), "rejected");
    }
    assert.equal(taskCreateFailureStatus({ status: 503, code: "task_create_rejected_final" }, true), "uncertain");
    const terminal = { ...makeAttempt(), status: taskCreateFailureStatus({ status: 400, code: "task_create_rejected_final" }, true), message: "An assigned account is inactive." };
    assert.deepEqual(recoverTaskCreate(JSON.stringify(terminal), accountId, "demo"), terminal);
});

test("task creation receipts establish success only for the captured request, account and inventory", () => {
    const captured = makeAttempt();
    assert.equal(verifyTaskCreateReceipt(receipt(captured), captured).id, planId);
    for (const changes of [{ id: "similar-plan" }, { version: 2 }, { requestId: planId }, { action: "update" }, { actorAccountId: "another-account" }, { dataset: "live" }, { requestId: undefined }])
        assert.throws(() => verifyTaskCreateReceipt(receipt(captured, changes), captured), /result is uncertain/);
    assert.throws(() => verifyTaskCreateReceipt(null, captured), /result is uncertain/);
    assert.throws(() => verifyTaskCreateReceipt({ id: planId, version: 1 }, captured), /result is uncertain/);
});

function dialogHarness() {
    const state = [], jsx = (type, props) => ({ type, props: props ?? {} });
    let pointer = 0;
    const hooks = {
        useState(initial) { const index = pointer++; if (!(index in state)) state[index] = typeof initial === "function" ? initial() : initial; return [state[index], next => { state[index] = typeof next === "function" ? next(state[index]) : next; }]; },
        useRef(initial) { const index = pointer++; if (!(index in state)) state[index] = { current: initial }; return state[index]; },
        useEffect() {},
    };
    const uiNames = ["BatteryFilterControls", "CalendarDays", "CheckCircle2", "Download", "Pencil", "Plus", "RefreshCw", "Button", "Input", "Textarea", "Label", "Checkbox", "Select", "SelectTrigger", "SelectValue", "SelectContent", "SelectItem", "Dialog", "DialogContent", "DialogHeader", "DialogTitle", "DialogDescription", "DialogFooter", "Table", "TableHeader", "TableBody", "TableRow", "TableHead", "TableCell", "Skeleton"];
    return { reset() { pointer = 0; }, hooks, jsx, ui: Object.fromEntries(uiNames.map(name => [name, name])) };
}
function nodes(node, result = []) {
    if (Array.isArray(node)) { node.forEach(value => nodes(value, result)); return result; }
    if (!node || typeof node !== "object") return result;
    result.push(node); nodes(node.props?.children, result); return result;
}
function label(node) { return Array.isArray(node) ? node.map(label).join("") : node && typeof node === "object" ? label(node.props?.children) : node == null ? "" : String(node); }
async function loadEditor(harness) {
    const files = ["lib/client/task-api.ts", "components/inventory/tasks/task-presentation.ts", "components/inventory/tasks/task-plan-editor.tsx"];
    const source = (await Promise.all(files.map(file => readFile(file, "utf8")))).join("\n");
    const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } }).outputText.replace(/^import .*;\r?\n/gm, "").replace(/^export \{.*\}(?: from "[^"]+")?;\r?\n/gm, "").replace(/\bexport (?=(?:async )?function|const|let|var)/g, "");
    const bindings = { hasRowTextSelection, ...batterySelection, defaultInventoryFilter, styles: new Proxy({}, { get: (_, key) => String(key) }), getRolePermissions, ...harness.hooks, ...harness.ui, captureTaskCreate, recoverTaskCreate, taskCreateFailureStatus, taskCreateStorageKey, verifyTaskCreateReceipt, taskCategories, taskTemplates, taskPlanSchema, taskSchedulePreview, taskTargetsByCategory, taskPlanMatchesQuery,
        currentSydneyDate: () => "2026-10-03", formatDateOnly: value => value || "Not configured", formatTime: value => value, roomLabel: room => room.name, staffIdentityLabel: (name, username) => `${name} (${username})`, isSelectableRoom: room => room.selectable, reloadSessionPage() { throw new Error("Unexpected sign-in navigation"); }, downloadTaskJson() { throw new Error("No download expected"); } };
    return new Function(...Object.keys(bindings), "_jsx", "_jsxs", "_Fragment", `${compiled}\nreturn { TaskPlanEditor };`)(...Object.values(bindings), harness.jsx, harness.jsx, "Fragment");
}

test("actual task creation handlers lock a lost-response payload, recover it after remount and retry without a replacement ID", async context => {
    const storage = new Map(), originalStorage = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
    Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) } });
    context.after(() => { if (originalStorage) Object.defineProperty(globalThis, "sessionStorage", originalStorage); else delete globalThis.sessionStorage; });
    const inputs = [], data = { dataset: "demo", user: { id: accountId, role: "admin" }, batteries: [], rooms: [], staffDirectory: [], events: [] };
    let responseLost = true, closes = 0, saved = 0;
    context.mock.method(globalThis, "fetch", async (url, options) => {
        assert.equal(url, "/api/task-plans"); inputs.push(JSON.parse(options.body));
        if (responseLost) return Response.json({ error: "Connection interrupted after the save" }, { status: 503 });
        const captured = recoverTaskCreate([...storage.values()][0], accountId, "demo");
        return Response.json({ ok: true, result: receipt(captured) });
    });
    const first = dialogHarness(), component = await loadEditor(first), plan = makePlan();
    const props = { original: plan, data, cycles: [], onClose() { closes++; }, async onSaved() { saved++; } };
    const render = () => { first.reset(); return component.TaskPlanEditor(props); };
    let tree = render();
    await nodes(tree).find(node => node.type === "form").props.onSubmit({ preventDefault() {} });
    tree = render();
    const captured = recoverTaskCreate([...storage.values()][0], accountId, "demo");
    assert.equal(captured.status, "uncertain"); assert.equal(inputs.length, 1);
    const title = nodes(tree).find(node => node.props.id === "task-title");
    assert.equal(title.props.disabled, true);
    title.props.onChange({ target: { value: "An attempted replacement title" } });
    nodes(tree).find(node => node.type === "Dialog").props.onOpenChange(false);
    const escape = { prevented: false, preventDefault() { this.prevented = true; } };
    nodes(tree).find(node => node.type === "DialogContent").props.onEscapeKeyDown(escape);
    tree = render();
    assert.equal(nodes(tree).find(node => node.props.id === "task-title").props.value, captured.input.payload.title);
    assert.equal(closes, 0); assert.equal(escape.prevented, true);
    assert.equal(nodes(tree).find(node => node.type === "DialogContent").props.showCloseButton, false);
    // A new component instance represents returning to the task page after a reload.
    const recoveredHarness = dialogHarness(), recoveredComponent = await loadEditor(recoveredHarness);
    recoveredHarness.reset();
    const recoveredTree = recoveredComponent.TaskPlanEditor({ ...props, original: { ...plan, title: "An unrelated current draft" } });
    assert.equal(nodes(recoveredTree).find(node => node.props.id === "task-title").props.value, captured.input.payload.title);
    responseLost = false;
    await nodes(recoveredTree).find(node => node.type === "Button" && label(node) === "Retry original task creation").props.onClick();
    // The UI click intentionally dispatches asynchronously; let its response/body promises settle.
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.deepEqual(inputs, [captured.input, captured.input]);
    assert.equal(storage.size, 0); assert.equal(saved, 1);
});

test("visible plan status choices explain incomplete activation and allow a deliberate draft save", async context => {
    const storage = new Map(), originalStorage = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
    Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) } });
    context.after(() => { if (originalStorage) Object.defineProperty(globalThis, "sessionStorage", originalStorage); else delete globalThis.sessionStorage; });
    const writes = [], data = { dataset: "demo", user: { id: accountId, role: "admin" }, batteries: [], rooms: [], staffDirectory: [], events: [] };
    let saves = 0;
    context.mock.method(globalThis, "fetch", async (_url, options) => {
        writes.push(JSON.parse(options.body));
        return Response.json({ ok: true, result: receipt(recoverTaskCreate([...storage.values()][0], accountId, "demo")) });
    });
    const harness = dialogHarness(), { TaskPlanEditor } = await loadEditor(harness);
    const render = () => { harness.reset(); return TaskPlanEditor({ original: makePlan(), data, cycles: [], onClose() {}, async onSaved() { saves++; } }); };
    let tree = render();
    assert.deepEqual(nodes(tree).filter(node => node.type === "section").map(node => label(nodes(node).find(child => child.type === "h3"))), ["Task instructions", "Targets and scope", "Assigned staff", "Schedule and reminders", "Review and save"]);
    const status = value => nodes(tree).find(node => node.type === "input" && node.props.name === "task-plan-state" && node.props.value === value);
    assert.equal(status("draft").props.checked, true);
    status("active").props.onChange();
    tree = render();
    assert.equal(status("active").props.checked, true);
    assert.ok(nodes(tree).some(node => node.type === "Button" && label(node) === "Create and activate"));
    assert.match(label(tree), /Before activation.*Assign at least one active staff account/);
    await nodes(tree).find(node => node.type === "form").props.onSubmit({ preventDefault() {} });
    tree = render();
    const footer = nodes(tree).find(node => node.props.className === "footer");
    assert.ok(nodes(footer).some(node => node.props.role === "alert"));
    assert.equal(writes.length, 0);
    status("draft").props.onChange();
    tree = render();
    assert.equal(nodes(tree).some(node => node.props.role === "alert"), false);
    assert.ok(nodes(tree).some(node => node.type === "Button" && label(node) === "Create draft"));
    await nodes(tree).find(node => node.type === "form").props.onSubmit({ preventDefault() {} });
    assert.equal(writes.length, 1);
    assert.equal(writes[0].payload.state, "draft");
    assert.equal(writes[0].payload.applicabilityConfirmed, false);
    assert.equal(saves, 1);
});

test("a blank custom editor accepts original instructions and a one-off schedule before saving", async context => {
    const storage = new Map(), originalStorage = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
    Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) } });
    context.after(() => { if (originalStorage) Object.defineProperty(globalThis, "sessionStorage", originalStorage); else delete globalThis.sessionStorage; });
    const writes = [], data = { dataset: "demo", user: { id: accountId, role: "admin" }, batteries: [], rooms: [], staffDirectory: [], events: [] };
    context.mock.method(globalThis, "fetch", async (_url, options) => {
        writes.push(JSON.parse(options.body));
        return Response.json({ ok: true, result: receipt(recoverTaskCreate([...storage.values()][0], accountId, "demo")) });
    });
    const harness = dialogHarness(), { TaskPlanEditor } = await loadEditor(harness);
    const render = () => { harness.reset(); return TaskPlanEditor({ original: createCustomTaskPlan(), data, cycles: [], onClose() {}, async onSaved() {} }); };
    let tree = render();
    assert.equal(nodes(tree).find(node => node.props.id === "task-title").props.value, "");
    const selectFor = name => nodes(tree).find(node => node.type === "Select" && nodes(node).some(child => child.type === "SelectTrigger" && child.props["aria-label"] === name));
    assert.equal(selectFor("Task type").props.value, "custom");
    assert.deepEqual(nodes(selectFor("Periodic task target")).filter(node => node.type === "SelectItem").map(node => node.props.value), ["inventory", "storage_area", "model", "group", "batteries"]);
    await nodes(tree).find(node => node.type === "form").props.onSubmit({ preventDefault() {} });
    assert.equal(writes.length, 0, "An empty task cannot be submitted");
    for (const [id, value] of [["task-title", "Workshop handover"], ["task-description", "Review equipment and record the handover outcome."], ["task-basis", "Workshop coordinator's agreed handover procedure."]]) {
        tree = render();
        nodes(tree).find(node => node.props.id === id).props.onChange({ target: { value } });
    }
    tree = render();
    selectFor("Task recurrence basis").props.onValueChange("dates");
    tree = render();
    assert.match(label(tree), /one date for a one-off task/);
    nodes(tree).find(node => node.props.id === "task-dates").props.onChange({ target: { value: "2026-10-15" } });
    tree = render();
    await nodes(tree).find(node => node.type === "form").props.onSubmit({ preventDefault() {} });
    assert.equal(writes.length, 1);
    assert.equal(writes[0].payload.category, "custom");
    assert.equal(writes[0].payload.title, "Workshop handover");
    assert.equal(writes[0].payload.description, "Review equipment and record the handover outcome.");
    assert.equal(writes[0].payload.basis, "Workshop coordinator's agreed handover procedure.");
    assert.deepEqual(writes[0].payload.scheduledDates, ["2026-10-15"]);
    assert.deepEqual(writes[0].payload.channels, ["messages"]);
    assert.equal(storage.size, 0);
});

test("switching a saved template to Custom preserves content and schedule while unlocking all targets", async context => {
    const original = { ...makePlan(), id: planId, version: 9, scheduledDates: ["2026-11-01"], scopeNote: "Confirmed workshop inventory" };
    const data = { dataset: "demo", user: { id: accountId, role: "admin" }, batteries: [], rooms: [], staffDirectory: [], events: [] }, writes = [];
    context.mock.method(globalThis, "fetch", async (_url, options) => { writes.push(JSON.parse(options.body)); return Response.json({ ok: true }); });
    const harness = dialogHarness(), { TaskPlanEditor } = await loadEditor(harness);
    const render = () => { harness.reset(); return TaskPlanEditor({ original, data, cycles: [], onClose() {}, async onSaved() {} }); };
    let tree = render();
    const type = () => nodes(tree).find(node => node.type === "Select" && nodes(node).some(child => child.type === "SelectTrigger" && child.props["aria-label"] === "Task type"));
    type().props.onValueChange("custom");
    tree = render();
    assert.equal(nodes(tree).find(node => node.props.id === "task-title").props.value, original.title);
    assert.equal(nodes(tree).find(node => node.props.id === "task-description").props.value, original.description);
    assert.equal(nodes(tree).find(node => node.props.id === "task-dates").props.value, "2026-11-01");
    await nodes(tree).find(node => node.type === "form").props.onSubmit({ preventDefault() {} });
    assert.equal(writes[0].payload.category, "custom");
    assert.equal(writes[0].payload.targetKind, "inventory");
    assert.equal(writes[0].payload.expectedVersion, 9);
    assert.equal(writes[0].payload.id, planId);
    assert.deepEqual(writes[0].payload.scheduledDates, original.scheduledDates);
    type().props.onValueChange("storage_review");
    tree = render();
    assert.match(label(tree), /Your previous target is retained/);
    assert.equal(nodes(tree).find(node => node.props.id === "task-title").props.value, original.title);
});

test("editing an active plan still requires reconfirmation and preserves the reviewed version and open cycle", async context => {
    const original = { ...makePlan(), id: planId, version: 7, state: "active", applicabilityConfirmed: true, scopeNote: "Shared demonstration register", assigneeIds: [accountId], scheduledDates: ["2026-11-01"], reminderTime: "09:00" };
    const cycles = [{ planId, status: "open", dueOn: "2026-10-01", reminderOn: "2026-09-30", reminderTime: "09:00" }];
    const data = { dataset: "demo", user: { id: accountId, role: "admin" }, batteries: [], rooms: [], staffDirectory: [{ id: accountId, displayName: "Reviewer", username: "reviewer", active: true }], events: [] };
    const writes = [];
    context.mock.method(globalThis, "fetch", async (_url, options) => { writes.push(JSON.parse(options.body)); return Response.json({ ok: true }); });
    const harness = dialogHarness(), { TaskPlanEditor } = await loadEditor(harness);
    const render = () => { harness.reset(); return TaskPlanEditor({ original, data, cycles, onClose() {}, async onSaved() {} }); };
    let tree = render();
    nodes(tree).find(node => node.props.id === "task-title").props.onChange({ target: { value: "Updated review title" } });
    tree = render();
    const confirmation = () => nodes(nodes(tree).find(node => node.type === "label" && label(node).includes("Confirm the plan before activation"))).find(node => node.type === "Checkbox");
    assert.equal(confirmation().props.checked, false);
    assert.match(label(tree), /Recorded open cycle: due 2026-10-01/);
    await nodes(tree).find(node => node.type === "form").props.onSubmit({ preventDefault() {} });
    assert.equal(writes.length, 0);
    confirmation().props.onCheckedChange(true);
    tree = render();
    await nodes(tree).find(node => node.type === "form").props.onSubmit({ preventDefault() {} });
    assert.equal(writes.length, 1);
    assert.equal(writes[0].action, "update");
    assert.equal(writes[0].payload.id, planId);
    assert.equal(writes[0].payload.expectedVersion, 7);
    assert.equal(writes[0].payload.state, "active");
    assert.equal(writes[0].payload.title, "Updated review title");
    assert.equal(cycles[0].dueOn, "2026-10-01");
    globalThis.fetch.mock.mockImplementation(async () => Response.json({ error: "A newer version was saved." }, { status: 409 }));
    nodes(tree).find(node => node.props.id === "task-title").props.onChange({ target: { value: "Another reviewed title" } });
    tree = render();
    confirmation().props.onCheckedChange(true);
    tree = render();
    await nodes(tree).find(node => node.type === "form").props.onSubmit({ preventDefault() {} });
    tree = render();
    assert.match(label(nodes(tree).find(node => node.props.role === "alert")), /A newer version was saved/);
    nodes(tree).find(node => node.props.id === "task-title").props.onChange({ target: { value: "Preserved conflict draft" } });
    tree = render();
    assert.match(label(nodes(tree).find(node => node.props.role === "alert")), /A newer version was saved/);
    assert.equal(nodes(tree).find(node => node.type === "Button" && node.props.type === "submit").props.disabled, true);
});

test("custom task battery filters preserve hidden targets and draft content, including retired records", async context => {
    const original = { ...makePlan(), id: planId, version: 4, category: "custom", targetKind: "batteries", batteryIds: ["BAT-A"], title: "My reviewed task" };
    const base = { name: "Teaching pack", chemistry: "LiPo", model: "PACK", voltage: 7.4, tagId: null, loanId: null, registeredAt: "2026-10-03T01:00:00.000Z", ownerAccountId: accountId, ownerName: "Teacher", manufacturedOn: null, firstUsedOn: null, lastCheckedOutAt: null, chargedAt: null, observedAt: null };
    const data = { dataset: "demo", user: { id: accountId, role: "admin" }, batteries: [{ ...base, id: "BAT-A", capacityMah: 2000, lifecycleStatus: "scrapped" }, { ...base, id: "BAT-B", capacityMah: 3000, lifecycleStatus: "active" }], rooms: [], staffDirectory: [], events: [] };
    const writes = [];
    context.mock.method(globalThis, "fetch", async (_url, options) => { writes.push(JSON.parse(options.body)); return Response.json({ ok: true }); });
    const harness = dialogHarness(), { TaskPlanEditor } = await loadEditor(harness);
    const render = () => { harness.reset(); return TaskPlanEditor({ original, data, cycles: [], onClose() {}, async onSaved() {} }); };
    const filters = () => nodes(render()).find(node => node.type === "BatteryFilterControls");
    assert.equal(filters().props.filters.lifecycle, "all");
    assert.match(label(render()), /2 matching batteries/);
    filters().props.onChange({ capacityMinMah: 2500, chemistry: "LiPo", sortBy: "capacity", sortDirection: "desc" });
    assert.match(label(render()), /1 matching batteries · 1 selected outside these filters/);
    const row = nodes(render()).find(node => node.type === "label" && label(node).includes("BAT-B"));
    const priorWindow = globalThis.window, anchor = {};
    let prevented = false;
    globalThis.window = { getSelection: () => ({ isCollapsed: false, anchorNode: anchor, focusNode: anchor }) };
    try {
        row.props.onClick({ currentTarget: { contains: node => node === anchor }, preventDefault() { prevented = true; } });
        assert.equal(prevented, true);
        assert.match(label(render()), /Registered batteries · 1 selected/);
    } finally { if (priorWindow === undefined) delete globalThis.window; else globalThis.window = priorWindow; }
    nodes(render()).find(node => node.type === "Button" && label(node) === "Select filtered batteries").props.onClick();
    assert.match(label(render()), /Registered batteries · 2 selected/);
    filters().props.onClear();
    assert.equal(filters().props.filters.lifecycle, "all");
    assert.equal(filters().props.filters.sortBy, "id");
    assert.equal(nodes(render()).find(node => node.props.id === "task-title").props.value, "My reviewed task");
    await nodes(render()).find(node => node.type === "form").props.onSubmit({ preventDefault() {} });
    assert.deepEqual(writes[0].payload.batteryIds, ["BAT-A", "BAT-B"]);
    assert.equal(writes[0].payload.expectedVersion, 4);
});

test("sectioned task editing keeps optional drafts and an explicit defined group independent of Teaching groups", async context => {
    const base = { chemistry: "LiPo", model: "Workshop model", capacityMah: 2200, voltage: 11.1, tagId: null, loanId: null, registeredAt: "2026-10-03T01:00:00.000Z", ownerAccountId: accountId, ownerName: "Teacher", manufacturedOn: null, firstUsedOn: null, lastCheckedOutAt: null, chargedAt: null, observedAt: null, lifecycleStatus: "active" };
    const original = { ...createCustomTaskPlan(), id: planId, version: 11, title: "Workshop review", targetKind: "group", targetRef: "Task review selection", batteryIds: ["BAT-A"] };
    const data = { dataset: "demo", user: { id: accountId, role: "admin" }, batteries: [{ ...base, id: "BAT-A", name: "Robotics battery" }, { ...base, id: "BAT-B", name: "Portable battery" }], rooms: [], staffDirectory: [], events: [], teachingGroups: [{ id: "private-group", name: "Task review selection", batteryIds: ["BAT-B"] }] };
    const writes = [];
    context.mock.method(globalThis, "fetch", async (_url, options) => { writes.push(JSON.parse(options.body)); return Response.json({ ok: true }); });
    const harness = dialogHarness(), { TaskPlanEditor } = await loadEditor(harness);
    const render = () => { harness.reset(); return TaskPlanEditor({ original, data, cycles: [], onClose() {}, async onSaved() {} }); };
    let tree = render();
    const sections = nodes(tree).filter(node => node.type === "details" && node.props.className === "sectionDisclosure");
    assert.equal(sections.length, 5);
    assert.equal(sections[0].props.open, true);
    assert.ok(sections.slice(1).every(section => !section.props.open));
    assert.ok(nodes(sections[1]).some(node => node.props.id === "task-group"), "Collapsed sections keep their editable fields mounted");
    assert.match(label(tree), /separate from private Teaching groups/);
    assert.match(label(tree), /BAT-A · Robotics battery/);
    assert.match(label(tree), /BAT-B · Portable battery/);
    nodes(tree).find(node => node.props.id === "task-description").props.onChange({ target: { value: "Optional draft instructions" } });
    data.teachingGroups[0] = { ...data.teachingGroups[0], name: "Renamed private group", batteryIds: ["BAT-B"] };
    tree = render();
    assert.equal(nodes(tree).find(node => node.props.id === "task-group").props.value, "Task review selection");
    assert.match(label(nodes(tree).find(node => node.props["aria-labelledby"] === "task-targets-heading")), /1 selected batteries/);
    await nodes(tree).find(node => node.type === "form").props.onSubmit({ preventDefault() {} });
    assert.equal(writes.length, 1);
    assert.equal(writes[0].payload.state, "draft");
    assert.equal(writes[0].payload.expectedVersion, 11);
    assert.equal(writes[0].payload.targetKind, "group");
    assert.equal(writes[0].payload.targetRef, "Task review selection");
    assert.deepEqual(writes[0].payload.batteryIds, ["BAT-A"]);
    assert.equal(writes[0].payload.description, "Optional draft instructions");
    assert.equal(writes[0].payload.basis, "");
    assert.equal(writes[0].payload.scopeNote, "");
    assert.equal(writes[0].payload.firstDueOn, null);
    assert.equal(writes[0].payload.reminderTime, null);
});

test("editing a task retains deleted target IDs through filtering and metadata saves until explicit removal", async context => {
    const base = { name: "Registered individual battery", chemistry: "LiPo", model: "Current model", capacityMah: 2200, voltage: 11.1, tagId: null, loanId: null, registeredAt: "2026-10-03T01:00:00.000Z", ownerAccountId: accountId, ownerName: "Teacher", manufacturedOn: null, firstUsedOn: null, lastCheckedOutAt: null, chargedAt: null, observedAt: null, lifecycleStatus: "active" };
    const original = { ...createCustomTaskPlan(), id: planId, version: 13, title: "Existing equipment task", targetKind: "group", targetRef: "Independent named targets", batteryIds: ["BAT-A", "BAT-DELETED"] };
    const data = { dataset: "demo", user: { id: accountId, role: "admin" }, batteries: [{ ...base, id: "BAT-A" }, { ...base, id: "BAT-B" }], purgedBatteries: [{ id: "BAT-DELETED", actorAccountId: accountId, at: "2026-10-08T05:00:00.000Z" }], rooms: [], staffDirectory: [], events: [] };
    const writes = [];
    context.mock.method(globalThis, "fetch", async (_url, options) => { writes.push(JSON.parse(options.body)); return Response.json({ ok: true }); });
    const harness = dialogHarness(), { TaskPlanEditor } = await loadEditor(harness);
    const render = () => { harness.reset(); return TaskPlanEditor({ original, data, cycles: [], onClose() {}, async onSaved() {} }); };
    let tree = render();
    const selectedDeleted = nodes(tree).find(node => node.type === "label" && label(node).includes("BAT-DELETED · Deleted record"));
    assert.ok(selectedDeleted, "The selected missing ID must remain explicitly visible with its recorded deletion status.");
    assert.equal(nodes(selectedDeleted).find(node => node.type === "Checkbox").props.checked, true);
    assert.match(label(tree), /Only|only their Battery ID/);
    assert.match(label(tree), /Future task generation needs available targets/);
    assert.match(label(nodes(tree).find(node => node.props["aria-labelledby"] === "task-targets-heading")), /1 deleted target/);
    const filters = () => nodes(render()).find(node => node.type === "BatteryFilterControls");
    filters().props.onChange({ search: "BAT-B" });
    tree = render();
    assert.match(label(tree), /1 matching batteries · 1 selected outside these filters/);
    assert.match(label(tree), /BAT-DELETED · Deleted record/);
    filters().props.onClear();
    nodes(render()).find(node => node.props.id === "task-title").props.onChange({ target: { value: "Reviewed task title" } });
    tree = render();
    await nodes(tree).find(node => node.type === "form").props.onSubmit({ preventDefault() {} });
    assert.deepEqual(writes[0].payload.batteryIds, ["BAT-A", "BAT-DELETED"]);
    assert.equal(writes[0].payload.expectedVersion, 13);
    assert.equal(writes[0].payload.title, "Reviewed task title");
    assert.equal(writes[0].payload.targetRef, "Independent named targets");
    const retainedCheckbox = nodes(nodes(render()).find(node => node.type === "label" && label(node).includes("BAT-DELETED · Deleted record"))).find(node => node.type === "Checkbox");
    retainedCheckbox.props.onCheckedChange(false);
    tree = render();
    assert.ok(!label(tree).includes("BAT-DELETED · Deleted record"));
    retainedCheckbox.props.onCheckedChange(true);
    filters().props.onChange({ search: "BAT-B" });
    tree = render();
    nodes(tree).find(node => node.type === "Button" && label(node) === "Select filtered batteries").props.onClick();
    tree = render();
    await nodes(tree).find(node => node.type === "form").props.onSubmit({ preventDefault() {} });
    assert.deepEqual(writes[1].payload.batteryIds, ["BAT-A", "BAT-B"], "Filtered selection cannot reintroduce a deleted ID after explicit removal.");
    assert.equal(writes[1].payload.targetRef, original.targetRef);
    assert.equal(writes[1].payload.expectedVersion, 13);
});
