import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import { captureTaskCreate, recoverTaskCreate, taskCreateFailureStatus, taskCreateStorageKey, verifyTaskCreateReceipt } from "../work/qa/task-create-session.mjs";
import { taskTemplates, taskPlanSchema, taskSchedulePreview, taskTargetsByCategory, taskPlanMatchesQuery } from "../work/qa/task-schedule.mjs";

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
    const uiNames = ["CalendarDays", "CheckCircle2", "Download", "Pencil", "Plus", "RefreshCw", "Button", "Input", "Textarea", "Label", "Checkbox", "Select", "SelectTrigger", "SelectValue", "SelectContent", "SelectItem", "Dialog", "DialogContent", "DialogHeader", "DialogTitle", "DialogDescription", "DialogFooter", "Table", "TableHeader", "TableBody", "TableRow", "TableHead", "TableCell", "Skeleton"];
    return { reset() { pointer = 0; }, hooks, jsx, ui: Object.fromEntries(uiNames.map(name => [name, name])) };
}
function nodes(node, result = []) {
    if (Array.isArray(node)) { node.forEach(value => nodes(value, result)); return result; }
    if (!node || typeof node !== "object") return result;
    result.push(node); nodes(node.props?.children, result); return result;
}
function label(node) { return Array.isArray(node) ? node.map(label).join("") : node && typeof node === "object" ? label(node.props?.children) : node == null ? "" : String(node); }
async function loadEditor(harness) {
    const source = await readFile("components/inventory/task-plans-panel.tsx", "utf8");
    const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } }).outputText.replace(/^import .*;\r?\n/gm, "").replace(/^export \{.*\}(?: from "[^"]+")?;\r?\n/gm, "").replace(/\bexport (?=(?:async )?function|const|let|var)/g, "");
    const bindings = { ...harness.hooks, ...harness.ui, captureTaskCreate, recoverTaskCreate, taskCreateFailureStatus, taskCreateStorageKey, verifyTaskCreateReceipt, taskTemplates, taskPlanSchema, taskSchedulePreview, taskTargetsByCategory, taskPlanMatchesQuery,
        currentSydneyDate: () => "2026-10-03", formatDateOnly: value => value || "Not configured", formatTime: value => value, roomLabel: room => room.name, staffIdentityLabel: (name, username) => `${name} (${username})`, isSelectableRoom: room => room.selectable, reloadSessionPage() { throw new Error("Unexpected sign-in navigation"); }, downloadTaskJson() { throw new Error("No download expected"); } };
    return new Function(...Object.keys(bindings), "_jsx", "_jsxs", "_Fragment", `${compiled}\nreturn { TaskPlanEditor, TaskPlansPanel };`)(...Object.values(bindings), harness.jsx, harness.jsx, "Fragment");
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
