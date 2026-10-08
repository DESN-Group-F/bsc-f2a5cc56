import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import ts from "typescript";
import { bindDownloadFeedback } from "./helpers/download-feedback-harness.mjs";
import ExcelJS from "exceljs";
import { taskPlanSchema, taskSchedulePreview } from "../work/qa/task-schedule.mjs";
import { createTaskReportDocument, createMessageReportDocument } from "../work/qa/task-export-report.mjs";
import { downloadTaskReport } from "../work/qa/client-utils.mjs";

const directory = [{ id: "teacher-1", displayName: "Teaching Coordinator", username: "teacher", active: true }, { id: "teacher-2", displayName: "Workshop Tutor", username: "tutor", active: true }];
const actor = { id: "teacher-1", displayName: "Teaching Coordinator", username: "teacher", role: "staff", authVersion: 1 };
const planInput = taskPlanSchema.parse({ category: "custom", title: "Workshop handover", description: "Review the workshop equipment and record the result.", basis: "Confirmed teaching plan", scopeNote: "Design workshop register", assigneeIds: ["teacher-1"], recurrenceBasis: "dates", scheduledDates: ["2026-10-05"], reminderTime: "09:00" });
const plan = { ...planInput, id: "plan-1", version: 3, removedAt: null, createdAt: "2026-10-03T23:15:00Z", updatedAt: "2026-10-04T01:00:00Z", createdBy: "teacher-1", updatedBy: "teacher-2", preview: taskSchedulePreview(planInput) };
const cycle = { ...planInput, id: "cycle-1", planId: plan.id, planVersion: 2, dueOn: "2026-10-05", reminderOn: "2026-10-04", reminderStatus: "scheduled", reminderAtUtc: "2026-10-03T22:00:00Z", status: "completed", version: 2, createdAt: "2026-10-03T23:15:00Z", completedAt: "2026-10-04T01:00:00Z", completedBy: "teacher-2", completedByName: "Name at completion", completionNotes: "Reviewed and handed over.", currentAssigneeIds: ["teacher-2"], canComplete: false, planRemoved: false, planRemovedAt: null, targetSnapshot: { kind: "inventory", scopeNote: "Design workshop register" } };
const message = { id: "message-1", version: 1, removedAt: null, cycleId: cycle.id, planId: plan.id, recipientId: actor.id, title: "Workshop handover reminder", body: "Your workshop handover is due.", createdAt: "2026-10-03T23:15:00Z", readAt: null, dueOn: cycle.dueOn, reminderOn: cycle.reminderOn, reminderTime: cycle.reminderTime, reminderAtUtc: cycle.reminderAtUtc, taskStatus: "completed", cycleVersion: 2, cycle };
const capabilities = { schedulerAvailable: false, emailAvailable: false, messageGeneration: "on_request", note: "Generated while in use." };
const context = { dataset: "demo", operator: actor, staffDirectory: directory };
const taskSource = () => ({ plans: [structuredClone(plan)], cycles: [structuredClone(cycle)], staffDirectory: directory, capabilities, generationIssues: [], metadata: { generatedAt: "2026-10-04T02:00:00Z", visibility: "current", search: "Workshop" } });
const messageSource = () => ({ messages: [structuredClone(message)], unreadCount: 7, capabilities, generationIssues: [], metadata: { generatedAt: "2026-10-04T02:00:00Z", filters: { visibility: "current", readState: "unread", taskStatus: "completed", search: "Workshop" } } });

test("task reports distinguish current plans from historical cycles and retain original evidence", () => {
    const source = taskSource(), output = createTaskReportDocument(source, context);
    const current = output.report.sheets.find(sheet => sheet.name === "Task plans").rows[0];
    const history = output.report.sheets.find(sheet => sheet.name === "Task history").rows[0];
    assert.equal(current["Task type"], "Custom task");
    assert.equal(current["Assigned staff"], "Teaching Coordinator (@teacher)");
    assert.equal(history["Currently assigned staff"], "Workshop Tutor (@tutor)");
    assert.equal(history["Completed by (recorded name)"], "Name at completion");
    assert.equal(history["Task completion"], "Completed");
    assert.equal(history["Completed at (Sydney)"].toISOString(), "2026-10-04T12:00:00.000Z");
    assert.match(current.Schedule, /^One-off:/);
    assert.equal(history["Due date"].toISOString(), "2026-10-05T00:00:00.000Z");
    assert.deepEqual(output.document.tables.Plans, source.plans);
    assert.deepEqual(output.document.tables.Cycles, source.cycles);
    assert.ok(output.report.glossary.some(item => /not an automatic safety certification/.test(item.meaning)));
    source.plans[0].targetKind = "storage_area"; source.plans[0].targetRef = "ROOM-TEST";
    source.cycles[0].targetKind = "storage_area"; source.cycles[0].targetSnapshot.room = { id: "ROOM-TEST", name: "Historical demo room", buildingId: "J18", buildingName: "Willis Annexe", isPlaceholder: true };
    source.generationIssues.push({ planId: plan.id, message: "A assigned account is unavailable." });
    const changed = createTaskReportDocument(source, { ...context, storageAreas: [{ id: "ROOM-TEST", name: "Current demo room", number: null, buildingId: "J18", buildingName: "Willis Annexe", isPlaceholder: true }] });
    assert.match(changed.report.sheets[0].rows[0]["Targets and scope (current labels)"], /Current demo room.*Placeholder/);
    assert.match(changed.report.sheets[1].rows[0]["Recorded targets"], /Historical demo room.*Placeholder/);
    assert.equal(changed.report.sheets.find(sheet => sheet.name === "Scheduling issues").rows[0]["Task title"], "Workshop handover");
    assert.equal(changed.report.facts.find(fact => fact.label === "Scheduling issues requiring review").value, 1);
});

test("personal message report separates unread status from completed tasks without inventing other cycles", () => {
    const source = messageSource(), output = createMessageReportDocument(source, context);
    const row = output.report.sheets[0].rows[0];
    assert.equal(row["Read status"], "Unread");
    assert.equal(row["Task completion"], "Completed");
    assert.equal(row["Read at (Sydney)"], "Not recorded");
    assert.equal(row.Recipient, "Teaching Coordinator (@teacher)");
    assert.equal(output.report.sheets[1].rows.length, 1);
    assert.equal(output.report.facts.find(fact => fact.label.startsWith("Unread in your current inbox")).value, 7);
    assert.deepEqual(output.document.tables.Messages, source.messages);
    assert.equal(output.document.tables.Cycles.length, 1);
    source.messages.push({ ...source.messages[0], id: "message-2", readAt: "2026-10-04T02:00:00Z" });
    assert.equal(createMessageReportDocument(source, context).report.sheets[1].rows.length, 1, "Multiple reminders for one cycle do not duplicate task history");
});

const routeDirectory = "work/qa/task-report-tests";
await mkdir(routeDirectory, { recursive: true });
for (const route of ["task-plans", "messages"]) {
    const compiled = ts.transpileModule(await readFile(`app/api/${route}/route.ts`, "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
        .replace(/from "@\/(?:db|lib\/(?:api|shared-inventory|task-plans))"/g, 'from "./context.mjs"')
        .replace(/from "@\/lib\/([^\"]+)"/g, (_, name) => `from "../${name}.mjs"`);
    await writeFile(`${routeDirectory}/${route}.mjs`, compiled);
}
await writeFile(`${routeDirectory}/context.mjs`, `
import { DomainError } from "../domain.mjs";
import { z } from "zod";
const state = () => globalThis[Symbol.for("task-report-route-tests")];
export const requestUser = async () => { if (!state().actor) throw new DomainError(401, "Sign in required"); return state().actor; };
export const requestJson = request => request.json();
export const apiJson = (value, status = 200, headers = {}) => Response.json(value, { status, headers });
export const apiError = error => apiJson({ error: error instanceof z.ZodError ? error.issues.map(item => item.message).join("; ") : error.message }, error.status ?? 400);
export const sharedInventoryScope = async (_db, mode) => "review:" + mode;
export const getD1Database = () => ({ prepare(sql) { return { bind(...args) { if (sql.includes("FROM rooms")) { state().roomScope = args[0]; return { async all() { return { results: [] }; } }; } const ids = JSON.parse(args[0]); state().directoryIds = ids; return { async all() { return { results: state().directory.filter(person => ids.includes(person.id)).map(person => ({ ...person, active: Number(person.active) })) }; } }; } }; } });
export class TaskPlanStore {
 constructor(_db, scope, mode, actor) { this.actor = actor; this.scope = scope; state().accountIds.push(actor.id); }
 async list(options) { state().listOptions = options; if (state().failure) throw state().failure; return state().taskResult; }
 async messages(options) { state().messageOptions = options; if (state().failure) throw state().failure; const records = state().messageResult; return { ...records, messages: records.messages.filter(message => message.recipientId === this.actor.id && (options.readState === "all" || (options.readState === "unread" ? !message.readAt : !!message.readAt)) && (options.taskStatus === "all" || options.taskStatus === message.taskStatus) && (!options.search || message.title.includes(options.search))) }; }
 async messageCounts() { state().countReads++; return { unreadCount: 7 }; }
}
`);
const taskRoute = await import(`../${routeDirectory}/task-plans.mjs`), messageRoute = await import(`../${routeDirectory}/messages.mjs`);
function routeState() {
    const state = { actor, directory, accountIds: [], directoryIds: [], countReads: 0, taskResult: taskSource(), messageResult: messageSource() };
    delete state.taskResult.metadata; delete state.messageResult.metadata;
    state.taskResult.plans.push({ ...plan, id: "different-plan", title: "Unrelated task", description: "Separate equipment check.", scopeNote: "Different area" });
    state.taskResult.cycles.push({ ...cycle, id: "different-cycle", planId: "different-plan", title: "Unrelated task" });
    state.messageResult.messages.push({ ...message, id: "private-other", recipientId: "teacher-2", body: "Other private recipient text" });
    globalThis[Symbol.for("task-report-route-tests")] = state;
    return state;
}
function tableRows(workbook, name) {
    const worksheet = workbook.getWorksheet(name), headers = worksheet.getRow(4).values.slice(1);
    return [...Array(Math.max(0, worksheet.rowCount - 4)).keys()].map(index => Object.fromEntries(headers.map((header, column) => [header, worksheet.getRow(index + 5).getCell(column + 1).value])));
}

test("actual task route downloads filtered Excel with complete matching cycles and compatible JSON", async () => {
    const state = routeState();
    for (const format of ["xlsx", "json"]) {
        const response = await taskRoute.GET(new Request(`http://inventory.test/api/task-plans?dataset=demo&visibility=removed&search=Workshop&download=${format}`));
        assert.equal(response.status, 200);
        assert.deepEqual(state.listOptions, { visibility: "removed" });
        assert.match(response.headers.get("content-disposition"), new RegExp(`\\.${format}"$`));
        if (format === "json") {
            const result = await response.json();
            assert.deepEqual(result.plans.map(item => item.id), ["plan-1"]);
            assert.deepEqual(result.cycles.map(item => item.id), ["cycle-1"]);
            assert.equal(result.metadata.scope, "shared_task_records");
            assert.equal(result.metadata.totalPlans, 2);
            assert.equal(result.tables, undefined);
        } else {
            const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(await response.arrayBuffer());
            assert.equal(response.headers.get("cache-control"), "no-store");
            assert.ok(workbook.getWorksheet("Report guide"));
            assert.deepEqual(tableRows(workbook, "Task plans").map(row => row["Task title"]), ["Workshop handover"]);
            assert.equal(tableRows(workbook, "Task history")[0]["Task completion"], "Completed");
            assert.equal(tableRows(workbook, "Evidence Plans")[0].id, "plan-1");
            assert.equal(tableRows(workbook, "Evidence Cycles")[0].id, "cycle-1");
        }
    }
    assert.deepEqual(state.accountIds, [actor.id, actor.id]);
});

test("actual Messages Excel route uses personal filters and excludes other private messages", async () => {
    const state = routeState();
    const response = await messageRoute.GET(new Request("http://inventory.test/api/messages?dataset=demo&visibility=current&readState=unread&taskStatus=completed&search=Workshop&download=xlsx&countOnly=true"));
    assert.equal(response.status, 200); assert.equal(state.countReads, 0);
    assert.deepEqual(state.messageOptions, { visibility: "current", readState: "unread", taskStatus: "completed", search: "Workshop" });
    assert.deepEqual(state.directoryIds.sort(), ["teacher-1", "teacher-2"]);
    const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(await response.arrayBuffer());
    assert.equal(tableRows(workbook, "Messages").length, 1);
    assert.equal(tableRows(workbook, "Messages")[0]["Read status"], "Unread");
    assert.equal(tableRows(workbook, "Messages")[0]["Task completion"], "Completed");
    assert.deepEqual(tableRows(workbook, "Evidence Messages").map(row => row.recipientId), [actor.id]);
    assert.doesNotMatch(JSON.stringify(workbook.model), /Other private recipient text/);
    const json = await messageRoute.GET(new Request("http://inventory.test/api/messages?dataset=demo&readState=unread&taskStatus=completed&download=json"));
    const result = await json.json(); assert.equal(result.messages.length, 1); assert.equal(result.metadata.recipientId, actor.id); assert.equal(result.tables, undefined);
});

test("task report routes preserve authentication, unsupported-format and data-read failures without attachments", async () => {
    for (const route of [taskRoute, messageRoute]) {
        const state = routeState(); state.actor = null;
        const denied = await route.GET(new Request("http://inventory.test/api/records?dataset=demo&download=xlsx"));
        assert.equal(denied.status, 401); assert.equal(denied.headers.get("content-disposition"), null);
        state.actor = actor;
        const invalid = await route.GET(new Request("http://inventory.test/api/records?dataset=demo&download=csv"));
        assert.equal(invalid.status, 400); assert.equal(invalid.headers.get("content-disposition"), null);
        state.failure = Object.assign(new Error("The current records could not be read."), { status: 503 });
        const failed = await route.GET(new Request("http://inventory.test/api/records?dataset=demo&download=xlsx"));
        assert.equal(failed.status, 503); assert.equal(failed.headers.get("content-disposition"), null);
    }
});

test("Excel task download rejects an HTML response without starting a browser save", async context => {
    context.mock.method(globalThis, "fetch", async () => new Response("<html>Sign in</html>", { headers: { "Content-Type": "text/html" } }));
    await assert.rejects(downloadTaskReport("/api/messages?dataset=demo&download=xlsx", "xlsx", "messages.xlsx"), /did not return the requested file/);
});

test("download dialog defaults to the readable report, shows transfer errors and keeps technical JSON selectable", async () => {
    const source = await readFile("components/inventory/tasks/task-download-dialog.tsx", "utf8");
    const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } }).outputText.replace(/^import .*;\r?\n/gm, "").replace(/^export /gm, "");
    const state = [], calls = [], busy = [], jsx = (type, props) => ({ type, props: props ?? {} });
    let pointer = 0, closes = 0, fail = true;
    const bindings = {
        ...Object.fromEntries(["Button", "MotionPresence", "Dialog", "DialogContent", "DialogDescription", "DialogFooter", "DialogHeader", "DialogTitle"].map(name => [name, name])),
        DownloadAction: "Button",
        useEffect() {},
        useState(initial) { const i = pointer++; if (!(i in state)) state[i] = initial; return [state[i], next => { state[i] = next; }]; },
        useRef(initial) { const i = pointer++; if (!(i in state)) state[i] = { current: initial }; return state[i]; },
        async downloadTaskReport(...args) { calls.push(args); if (fail) throw new Error("File transfer interrupted; no file was downloaded."); },
    };
    bindings.useDownloadFeedback = bindDownloadFeedback(bindings);
    const component = new Function(...Object.keys(bindings), "_jsx", "_jsxs", `${compiled}; return TaskDownloadDialog;`)(...Object.values(bindings), jsx, jsx);
    function nodes(node) { if (Array.isArray(node)) return node.flatMap(nodes); if (!node || typeof node !== "object") return []; return [node, ...nodes(node.props.children)]; }
    function label(node) { if (Array.isArray(node)) return node.map(label).join(""); return node && typeof node === "object" ? label(node.props.children) : String(node ?? ""); }
    const render = () => { pointer = 0; return component({ request: { url: "/api/messages?dataset=demo&readState=unread&taskStatus=completed", filename: "own-messages", title: "Download Messages report", scope: "Your own filtered messages." }, onClose() { closes++; }, onBusyChange(value) { busy.push(value); } }); };
    let tree = render();
    assert.equal(nodes(tree).find(node => node.type === "input" && node.props.value === "xlsx").props.checked, true);
    assert.match(label(tree), /Recommended.*reading guide/);
    nodes(tree).find(node => node.type === "Button" && label(node) === "Download Excel report").props.onClick();
    await new Promise(resolve => setTimeout(resolve, 0));
    tree = render();
    assert.equal(closes, 0); assert.match(label(nodes(tree).find(node => node.props.role === "alert")), /File transfer interrupted/);
    assert.deepEqual(calls[0], ["/api/messages?dataset=demo&readState=unread&taskStatus=completed&download=xlsx", "xlsx", "own-messages.xlsx"]);
    nodes(tree).find(node => node.type === "input" && node.props.value === "json").props.onChange();
    fail = false; tree = render();
    nodes(tree).find(node => node.type === "Button" && label(node) === "Download JSON data").props.onClick();
    await new Promise(resolve => setTimeout(resolve, 0));
    tree = render();
    assert.equal(closes, 0); assert.equal(calls[1][1], "json"); assert.deepEqual(busy, [true, false, true, false]);
    assert.equal(nodes(tree).find(node => node.type === "Button" && label(node) === "Download JSON data").props.completion !== null, true);
    nodes(tree).find(node => node.type === "Button" && label(node) === "Done").props.onClick();
    assert.equal(closes, 1);
});
