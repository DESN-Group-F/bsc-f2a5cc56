import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import { bindDownloadFeedback } from "./helpers/download-feedback-harness.mjs";
import { defaultInventoryFilter, exportSections } from "../work/qa/inventory-query.mjs";
import { getRolePermissions } from "../work/qa/permissions.mjs";
import { readDownloadAttachment } from "../work/qa/client-utils.mjs";

// Run real handlers and the shared hook with inert UI/attachment boundaries.
// Geometry, focus restoration and file saving need a separate browser review.
const jsx = (type, props, key) => ({ type, props: props ?? {}, key });
function nodes(value, result = []) { if (Array.isArray(value)) value.forEach(child => nodes(child, result)); else if (value && typeof value === "object") { result.push(value); nodes(value.props?.children, result); } return result; }
function text(value) { return typeof value === "string" || typeof value === "number" ? String(value) : Array.isArray(value) ? value.map(text).join("") : value && typeof value === "object" ? text(value.props?.children) : ""; }
const action = tree => nodes(tree).find(node => node.type === "DownloadAction");
const button = (tree, label) => nodes(tree).find(node => node.type === "Button" && text(node) === label);
const select = (tree, label) => nodes(tree).find(node => node.type === "Select" && nodes(node).some(child => child.props?.["aria-label"] === label));
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function hooks() {
  const state = [], effects = []; let pointer = 0, ep = 0, pending = [], disposed = false, writesAfterUnmount = 0;
  return {
    reset() { pointer = 0; ep = 0; pending = []; },
    useState(initial) { const index = pointer++; if (!(index in state)) state[index] = typeof initial === "function" ? initial() : initial; return [state[index], value => { if (disposed) writesAfterUnmount++; state[index] = typeof value === "function" ? value(state[index]) : value; }]; },
    useRef(initial) { const index = pointer++; if (!(index in state)) state[index] = { current: initial }; return state[index]; },
    useEffect(callback, deps) { const index = ep++, prior = effects[index]; if (!prior || deps.some((value, at) => !Object.is(value, prior.deps[at]))) pending.push(() => { prior?.cleanup?.(); effects[index] = { deps, cleanup: callback() }; }); },
    commit() { pending.forEach(callback => callback()); },
    unmount() { effects.forEach(effect => effect?.cleanup?.()); disposed = true; },
    get writesAfterUnmount() { return writesAfterUnmount; },
  };
}
async function compile(file, name, bindings) {
  const source = ts.transpileModule(await readFile(file, "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } }).outputText.replace(/^import .*;\r?\n/gm, "").replace(/^export /gm, "");
  return new Function(...Object.keys(bindings), "_jsx", "_jsxs", "_Fragment", `${source}\nreturn ${name};`)(...Object.values(bindings), jsx, jsx, "Fragment");
}
async function mount(file, name, props, extra = {}) {
  const state = hooks(), ui = Object.fromEntries(["Button", "DownloadAction", "Download", "Label", "Checkbox", "Select", "SelectTrigger", "SelectValue", "SelectContent", "SelectItem", "Dialog", "DialogContent", "DialogHeader", "DialogTitle", "DialogDescription", "DialogFooter", "MotionDisclosure", "MotionPresence"].map(value => [value, value]));
  const Component = await compile(file, name, { ...ui, ...state, useDownloadFeedback: bindDownloadFeedback(state), exportSections, ...extra });
  return { props, render() { state.reset(); const tree = Component(props); state.commit(); return tree; }, unmount: state.unmount, get writesAfterUnmount() { return state.writesAfterUnmount; } };
}
const draft = () => ({ selectedIds: ["BAT-1", "BAT-2"], filter: defaultInventoryFilter(), teachingGroup: { id: "group-owned", version: 3 }, page: 1, pageSize: "25", matching: 42, pageCount: 25 });

test("inventory download waits for its real outcome, rejects duplicate clicks and preserves exact failed review for retry", async () => {
  const first = deferred(), calls = [], closes = [];
  const view = await mount("components/inventory/export-dialog.tsx", "ExportDialog", { draft: draft(), dataset: "demo", onClose: () => closes.push(true) }, {
    downloadExportAttachment(...args) { calls.push(structuredClone(args)); return calls.length === 1 ? first.promise : Promise.resolve(); },
  });
  select(view.render(), "Export information depth").props.onValueChange("detail");
  nodes(view.render()).find(node => node.type === "Checkbox").props.onCheckedChange(false);
  const loans = nodes(view.render()).find(node => node.type === "label" && text(node).includes("Complete loan history"));
  nodes(loans).find(node => node.type === "Checkbox").props.onCheckedChange(true);
  const captured = action(view.render());
  const pending = captured.props.onClick();
  await captured.props.onClick();
  let tree = view.render();
  assert.equal(calls.length, 1); assert.equal(action(tree).props.pending, true); assert.equal(action(tree).props.completion, null);
  assert.equal(button(tree, "Cancel").props.disabled, true);
  const content = nodes(tree).find(node => node.type === "DialogContent"), cancelled = [];
  content.props.onEscapeKeyDown({ preventDefault: () => cancelled.push("escape") }); content.props.onInteractOutside({ preventDefault: () => cancelled.push("outside") });
  nodes(tree).find(node => node.type === "Dialog").props.onOpenChange(false);
  assert.deepEqual(cancelled, ["escape", "outside"]); assert.equal(closes.length, 0);
  first.reject(new Error("Teaching group changed. No partial download was prepared.")); await pending;
  tree = view.render(); assert.match(text(tree), /Teaching group changed/); assert.equal(action(tree).props.pending, false); assert.equal(action(tree).props.completion, null);
  assert.deepEqual(calls[0][0].batteryIds, ["BAT-1", "BAT-2"]); assert.deepEqual(calls[0][0].teachingGroup, { id: "group-owned", version: 3 }); assert.deepEqual(calls[0][0].sections, ["loans"]);
  await action(tree).props.onClick(); tree = view.render();
  assert.deepEqual(calls[1], calls[0]); assert.ok(action(tree).props.completion); assert.equal(closes.length, 0);
  button(tree, "Done").props.onClick(); assert.equal(closes.length, 1); view.unmount();
});

test("changing a completed file's format clears its acknowledgement while retained detailed choices remain usable", async () => {
  const view = await mount("components/inventory/export-dialog.tsx", "ExportDialog", { draft: draft(), dataset: "demo", onClose() {} }, { async downloadExportAttachment() {} });
  await action(view.render()).props.onClick(); assert.ok(action(view.render()).props.completion);
  select(view.render(), "Export file format").props.onValueChange("json");
  assert.equal(action(view.render()).props.completion, null); assert.ok(button(view.render(), "Cancel"));
  const disclosure = nodes(view.render()).find(node => node.type === "MotionDisclosure" && nodes(node).some(child => child.type === "fieldset"));
  assert.equal(disclosure.props.open, false); assert.equal(nodes(disclosure).find(node => node.type === "fieldset").props.disabled, true);
  select(view.render(), "Export information depth").props.onValueChange("detail");
  assert.equal(nodes(view.render()).find(node => node.type === "MotionDisclosure" && nodes(node).some(child => child.type === "fieldset")).props.open, true);
  assert.equal(nodes(view.render()).filter(node => node.type === "Checkbox" && node.props.checked === true).length, exportSections.length + 1);
  view.unmount();
});

test("Activity keeps its own historical scope and captured selected operations through error and success", async () => {
  const calls = [], props = { dataset: "live", scope: "mine", search: "Workshop", groupId: "group-recorded", selectedIds: ["operation-original"], count: 7, batteryFilter: { ...defaultInventoryFilter(), ownerId: "owner-1" }, onClose() {} };
  const view = await mount("components/inventory/activity-export-dialog.tsx", "ActivityExportDialog", props, {
    async downloadExportAttachment(...args) { calls.push(structuredClone(args)); if (calls.length === 1) throw new Error("Unavailable evidence; retry the captured selection."); },
  });
  select(view.render(), "Activity information depth").props.onValueChange("battery_details");
  props.selectedIds = ["operation-later"]; props.scope = "all"; props.groupId = "other-group";
  await action(view.render()).props.onClick(); assert.equal(action(view.render()).props.completion, null); assert.match(text(view.render()), /Unavailable evidence/);
  await action(view.render()).props.onClick(); assert.ok(action(view.render()).props.completion);
  assert.deepEqual(calls[1], calls[0]); assert.deepEqual(calls[0][0].activityIds, ["operation-original"]); assert.equal(calls[0][0].activityScope, "mine"); assert.equal(calls[0][0].activityGroupId, "group-recorded"); assert.equal(calls[0][0].activityBatteryFilter.ownerId, "owner-1"); assert.equal(calls[0][0].activityDepth, "battery_details"); assert.equal(calls[0][1], "xlsx"); view.unmount();
});

test("Task and Messages download keeps captured URL and parent busy locks until actual handoff", async () => {
  const transfer = deferred(), calls = [], locks = [], closes = [];
  const view = await mount("components/inventory/tasks/task-download-dialog.tsx", "TaskDownloadDialog", { request: { url: "/api/messages?dataset=live&readState=unread&taskStatus=completed", filename: "own-messages", title: "Download Messages report", scope: "Your filtered messages." }, onClose: () => closes.push(true), onBusyChange: busy => locks.push(busy) }, {
    downloadTaskReport(...args) { calls.push(args); return transfer.promise; },
  });
  const pending = action(view.render()).props.onClick();
  await action(view.render()).props.onClick();
  let tree = view.render();
  nodes(tree).find(node => node.type === "input" && node.props.value === "json").props.onChange();
  assert.equal(nodes(view.render()).find(node => node.type === "input" && node.props.value === "xlsx").props.checked, true);
  assert.equal(calls.length, 1); assert.deepEqual(locks, [true]); assert.equal(action(tree).props.completion, null); assert.equal(nodes(tree).find(node => node.type === "DialogContent").props.showCloseButton, false);
  transfer.resolve(); await pending; await new Promise(resolve => setTimeout(resolve, 0)); tree = view.render();
  assert.deepEqual(calls[0], ["/api/messages?dataset=live&readState=unread&taskStatus=completed&download=xlsx", "xlsx", "own-messages.xlsx"]); assert.deepEqual(locks, [true, false]); assert.ok(action(tree).props.completion); assert.equal(closes.length, 0);
  button(tree, "Done").props.onClick(); assert.equal(closes.length, 1); view.unmount();
});

test("a late result is owned by its original review and does not acknowledge or report an error in another view", async () => {
  const state = hooks(), invokeFeedback = bindDownloadFeedback(state), first = deferred(); let key = "staff-directory|original";
  const render = () => { state.reset(); const feedback = invokeFeedback(key); state.commit(); return feedback; };
  const pending = render().run(() => first.promise);
  key = "rooms|new-view"; assert.equal(render().busy, true); first.resolve(); await pending;
  assert.equal(render().completion, null); assert.equal(render().error, ""); assert.equal(render().busy, false);
  key = "staff-directory|original"; assert.ok(render().completion);
  const failure = deferred(), failed = render().run(() => failure.promise);
  key = "rooms|new-view"; failure.reject(new Error("Only the original directory failed.")); await failed;
  assert.equal(render().error, ""); assert.equal(render().completion, null);
  key = "staff-directory|original"; assert.equal(render().error, "Only the original directory failed."); state.unmount();
});

test("an unmounted download releases its parent lock and never writes result state into a replacement component", async () => {
  const state = hooks(), invokeFeedback = bindDownloadFeedback(state), transfer = deferred(), locks = [];
  state.reset(); const feedback = invokeFeedback("captured-review"); state.commit();
  const pending = feedback.run(() => transfer.promise, value => locks.push(value));
  state.unmount(); transfer.resolve(); await pending;
  assert.deepEqual(locks, [true, false]); assert.equal(state.writesAfterUnmount, 0); assert.equal(feedback.running.current, false);
});

test("the download acknowledgement exposes actual preparation and handoff without transaction wording", async () => {
  const Component = await compile("components/ui/download-action.tsx", "DownloadAction", { ReceiptAction: "ReceiptAction" });
  const result = Component({ pending: true, completion: null, reviewKey: "report-1", actionLabel: "Download records", children: "Download records" });
  assert.equal(result.props.confirmation, null); assert.equal(result.props["aria-busy"], true); assert.equal(result.props.pendingAnnouncement, "Preparing your download.");
  const finished = Component({ pending: false, completion: { identity: "actual-attachment", reviewKey: "report-1" }, reviewKey: "report-1", actionLabel: "Download records", children: "Download records" });
  assert.equal(finished.props.confirmation.identity, "actual-attachment"); assert.equal(finished.props.confirmation.text, "Download ready"); assert.equal(finished.props.confirmationAnnouncement, "The file is ready. Your browser was asked to save it.");
});

test("account report preserves administrator access, suppresses duplicate saves and acknowledges only the actual attachment", async context => {
  const transfer = deferred(), calls = [], saved = [], currentUser = { id: "admin-native", role: "admin" };
  context.mock.method(globalThis, "fetch", async url => {
    calls.push(String(url));
    return String(url).includes("download=") ? transfer.promise : Response.json({ accounts: [{ id: "staff-native", username: "tutor", displayName: "Teaching Tutor", email: "", role: "staff", active: true }], events: [] });
  });
  context.mock.method(URL, "createObjectURL", () => "blob:validated-report"); context.mock.method(URL, "revokeObjectURL", () => {});
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", { configurable: true, value: { body: { appendChild() {} }, createElement() { return { click() { saved.push({ href: this.href, download: this.download }); }, remove() {} }; } } });
  context.after(() => { if (originalDocument) Object.defineProperty(globalThis, "document", originalDocument); else delete globalThis.document; });
  const realTimeout = globalThis.setTimeout;
  context.mock.method(globalThis, "setTimeout", (callback, delay, ...args) => delay === 60000 ? 1 : realTimeout(callback, delay, ...args));
  const extra = { getRolePermissions, readDownloadAttachment, formatTime: value => value, ...Object.fromEntries(["Input", "Plus", "Pencil", "Shield", "UserRound", "RefreshCw", "Table", "TableHeader", "TableBody", "TableRow", "TableHead", "TableCell"].map(value => [value, value])) };
  const staff = await mount("components/inventory/accounts-panel.tsx", "AccountManagement", { currentUser: { ...currentUser, role: "staff" }, onSaved() {} }, extra);
  assert.match(text(staff.render()), /Only administrators/); assert.equal(calls.length, 0); staff.unmount();
  const view = await mount("components/inventory/accounts-panel.tsx", "AccountManagementContent", { currentUser, onSaved() {} }, extra);
  view.render(); await new Promise(resolve => setTimeout(resolve, 0));
  const search = nodes(view.render()).find(node => node.type === "Input" && node.props["aria-label"] === "Search staff accounts"); search.props.onChange({ target: { value: "Teaching Tutor" } });
  const captured = action(view.render()), pending = captured.props.onClick(); await captured.props.onClick();
  assert.equal(action(view.render()).props.pending, true); assert.equal(action(view.render()).props.completion, null); assert.equal(calls.filter(url => url.includes("download=")).length, 1); assert.equal(saved.length, 0);
  transfer.resolve(new Response("validated-nonempty-report", { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": 'attachment; filename="staff-report.xlsx"' } })); await pending;
  assert.deepEqual(saved, [{ href: "blob:validated-report", download: "staff-report.xlsx" }]); assert.ok(action(view.render()).props.completion); assert.match(calls[1], /search=Teaching\+Tutor/);
  nodes(view.render()).find(node => node.type === "Input" && node.props["aria-label"] === "Search staff accounts").props.onChange({ target: { value: "other-scope" } }); assert.equal(action(view.render()).props.completion, null); view.unmount();
});
