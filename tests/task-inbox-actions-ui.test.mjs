import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import { getRolePermissions } from "../work/qa/permissions.mjs";
import { createCustomTaskPlan, taskTemplates } from "../work/qa/task-schedule.mjs";
import { captureTaskCreate, recoverTaskCreate, taskCreateStorageKey } from "../work/qa/task-create-session.mjs";

const sources = await Promise.all(
  [
    "lib/client/task-record-action.ts",
    "components/inventory/messages-panel.tsx",
    "components/inventory/task-plans-panel.tsx",
    "components/inventory/tasks/task-cycle-dialog.tsx",
    "components/inventory/tasks/task-plan-removal-dialog.tsx",
    "components/inventory/tasks/task-plan-details.tsx",
  ].map((path) => readFile(path, "utf8")),
);
const compiled = ts
  .transpileModule(sources.join("\n"), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      jsx: ts.JsxEmit.ReactJSX,
    },
  })
  .outputText.replace(/^import .*;\r?\n/gm, "")
  .replace(/\bexport (?=(?:async )?function|const|let|var)/g, "");

const data = {
  dataset: "demo",
  user: { id: "staff-1", role: "admin" },
  events: [],
  rooms: [],
  staffDirectory: [],
  batteries: [],
};
const plan = {
  id: "11111111-1111-4111-8111-111111111111",
  version: 1,
  title: "Storage review",
  state: "active",
  category: "storage_review",
  assigneeIds: ["staff-1"],
  removedAt: null,
  preview: {},
};
const cycle = {
  ...plan,
  id: "22222222-2222-4222-8222-222222222222",
  planId: plan.id,
  status: "open",
  dueOn: "2026-10-03",
  currentAssigneeIds: ["staff-1"],
  canComplete: true,
  planRemoved: false,
  targetSnapshot: {},
  batteryIds: [],
  description: "Review the area",
  basis: "Local plan",
  reminderStatus: "valid",
};
const message = {
  id: "33333333-3333-4333-8333-333333333333",
  version: 1,
  title: plan.title,
  body: "A retained reminder",
  cycle,
  taskStatus: "open",
  readAt: null,
  removedAt: null,
  dueOn: cycle.dueOn,
};
const receipt = (input, accountId = data.user.id) => ({
  result: {
    id: input.payload.id,
    version: input.payload.expectedVersion + 1,
    requestId: input.requestId,
    action: input.action,
    actorAccountId: accountId,
    dataset: input.dataset,
    removedAt: input.action === "remove" ? "2026-10-03T01:00:00Z" : null,
  },
});

function nodes(node, result = []) {
  if (Array.isArray(node)) {
    node.forEach((value) => nodes(value, result));
    return result;
  }
  if (!node || typeof node !== "object") return result;
  result.push(node);
  nodes(node.props?.children, result);
  return result;
}
const label = (node) =>
  Array.isArray(node)
    ? node.map(label).join("")
    : node && typeof node === "object"
      ? label(node.props?.children)
      : node == null
        ? ""
        : String(node);
const button = (tree, text) =>
  nodes(tree).find((node) => node.type === "Button" && label(node) === text);

function sessionStore() {
  const values = new Map();
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

function harness(
  payload = {},
  request = async () => {
    throw new Error("Unexpected request");
  },
  storage = sessionStore(),
) {
  const state = [],
    jsx = (type, props) => ({ type, props: props ?? {} });
  let pointer = 0,
    effectPointer = 0;
  const effects = [];
  const urls = [];
  const resource = {
    payload,
    loading: false,
    error: "",
    refreshes: 0,
    refresh() {
      this.refreshes++;
    },
  };
  const uiNames = [
    "Button",
    "Input",
    "Textarea",
    "Label",
    "Checkbox",
    "Tabs",
    "TabsList",
    "TabsTrigger",
    "Select",
    "SelectTrigger",
    "SelectValue",
    "SelectContent",
    "SelectItem",
    "Skeleton",
    "LoadingState",
    "RefreshStatus",
    "Table",
    "TableHeader",
    "TableBody",
    "TableRow",
    "TableHead",
    "TableCell",
    "Dialog",
    "DialogContent",
    "DialogHeader",
    "DialogTitle",
    "DialogDescription",
    "DialogFooter",
    "Check",
    "CheckCircle2",
    "Download",
    "Mail",
    "RefreshCw",
    "RotateCcw",
    "Trash2",
    "Undo2",
    "CalendarDays",
    "Pencil",
    "Plus",
    "TaskDeliveryNotice",
    "TaskGenerationWarnings",
    "TaskPlanEditor",
    "TaskDownloadDialog",
  ];
  const bindings = { getRolePermissions,
    ...Object.fromEntries(uiNames.map((name) => [name, name])),
    useState(initial) {
      const index = pointer++;
      if (!(index in state))
        state[index] = typeof initial === "function" ? initial() : initial;
      return [
        state[index],
        (next) => {
          state[index] = typeof next === "function" ? next(state[index]) : next;
        },
      ];
    },
    useRef(initial) {
      const index = pointer++;
      if (!(index in state)) state[index] = { current: initial };
      return state[index];
    },
    useEffect(callback, dependencies) {
      const index = effectPointer++;
      const previous = effects[index];
      if (
        !previous ||
        !dependencies ||
        dependencies.some((value, position) => !Object.is(value, previous.dependencies?.[position]))
      ) {
        previous?.cleanup?.();
        effects[index] = { dependencies, cleanup: callback() };
      }
    },
    useTaskEndpoint(url) {
      urls.push(url);
      return resource;
    },
    taskRequest: request,
    taskCategoryLabels: { storage_review: "Storage area review" },
    currentSydneyDate: () => "2026-10-03",
    formatTime: (value) => value || "Unavailable",
    formatDateOnly: (value) => value || "Unavailable",
    assignmentNames: () => "Assigned staff",
    targetSummary: () => "Storage area",
    cycleState: (item) => (item.status === "completed" ? "Completed" : "Open"),
    reminderLimitation: () => null,
    taskPlanMatchesQuery: (item, query) => item.title.includes(query),
    taskTemplates,
    createCustomTaskPlan,
    recoverTaskCreate,
    taskCreateStorageKey,
    sessionStorage: storage,
    downloadTaskJson() {
      throw new Error("Unexpected download");
    },
  };
  const components = new Function(
    ...Object.keys(bindings),
    "_jsx",
    "_jsxs",
    "_Fragment",
    `${compiled}\nreturn { MessagesPanel, TaskPlansPanel, TaskCycleDialog, TaskPlanRemovalDialog, TaskPlanDetails };`,
  )(...Object.values(bindings), jsx, jsx, "Fragment");
  return {
    components,
    resource,
    urls,
    storage,
    unmount() {
      effects.forEach((effect) => effect.cleanup?.());
    },
    render(name, props) {
      pointer = 0;
      effectPointer = 0;
      return components[name](props);
    },
  };
}

test("message cards distinguish completion, current authority and removed plans before opening details", () => {
  const h = harness({
    messages: [
      message,
      {
        ...message,
        id: "done",
        taskStatus: "completed",
        cycle: { ...cycle, status: "completed", canComplete: false },
      },
      { ...message, id: "reassigned", cycle: { ...cycle, canComplete: false } },
      {
        ...message,
        id: "removed-plan",
        cycle: { ...cycle, planRemoved: true, canComplete: false },
      },
    ],
  });
  const tree = h.render("MessagesPanel", { data });
  assert.equal(
    new URL(h.urls[0], "http://local").searchParams.get("visibility"),
    "current",
  );
  assert.ok(button(tree, "Complete task"));
  assert.ok(button(tree, "View completion"));
  assert.match(
    label(tree),
    /Only currently assigned staff or an administrator/,
  );
  const cards = nodes(tree).filter((node) => node.type === "article");
  assert.equal(cards.length, 4);
  assert.match(label(cards[3]), /Plan removed/);
  assert.doesNotMatch(label(cards[3]), /To do|Complete task/);
  assert.equal(
    nodes(tree)
      .filter((node) => node.type === "details")
      .every((node) => !node.props.open),
    true,
  );
});

const messageDetails = (tree) => nodes(tree).find((node) => node.type === "details");
const unreadDots = (tree) => nodes(tree).filter((node) => node.props?.className === "unread-dot");
const settleMessageAction = () => new Promise((resolve) => setImmediate(resolve));

test("opening message details acknowledges only that message in its current inventory", async () => {
  for (const dataset of ["demo", "live"]) {
    const inputs = [], counts = [];
    let changed = 0;
    const h = harness({ messages: [message], unreadCount: 1 }, async (url, options) => {
      assert.equal(url, "/api/messages");
      assert.equal(options.method, "POST");
      inputs.push(JSON.parse(options.body));
      return { ok: true };
    });
    const props = {
      data: { ...data, dataset },
      onUnreadCount: (value) => counts.push(value),
      async onChanged() { changed++; },
    };
    const render = () => h.render("MessagesPanel", props);
    let tree = render();
    assert.equal(inputs.length, 0, "Displaying an inbox is not reading every message");
    assert.equal(messageDetails(tree).props.open, false);
    messageDetails(tree).props.onToggle({ currentTarget: { open: false } });
    assert.equal(inputs.length, 0, "Closing details must not acknowledge a message");
    messageDetails(tree).props.onToggle({ currentTarget: { open: true } });
    await settleMessageAction();
    assert.deepEqual(inputs, [{ dataset, action: "read", payload: { id: message.id } }]);
    assert.equal(changed, 1);
    assert.equal(h.resource.refreshes, 1);
    tree = render();
    assert.equal(messageDetails(tree).props.open, true);
    assert.equal(unreadDots(tree).length, 1, "Unread evidence remains until the refreshed server result arrives");
    assert.ok(button(tree, "Complete task"), "Reading must not complete the shared task");
    assert.equal(nodes(tree).some((node) => node.type === h.components.TaskCycleDialog), false);

    h.resource.payload = {
      messages: [{ ...message, readAt: "2026-10-03T02:00:00Z" }],
      unreadCount: 0,
    };
    tree = render();
    assert.equal(messageDetails(tree).props.open, true, "Refreshing read evidence must preserve expanded details");
    assert.equal(unreadDots(tree).length, 0);
    assert.equal(button(tree, "Mark read"), undefined);
    assert.equal(counts.at(-1), 0, "The refreshed own unread count must reach the sidebar callback");
    messageDetails(tree).props.onToggle({ currentTarget: { open: false } });
    tree = render();
    assert.equal(messageDetails(tree).props.open, false);
    messageDetails(tree).props.onToggle({ currentTarget: { open: true } });
    await settleMessageAction();
    assert.equal(inputs.length, 1, "Reopening an already read message must not send another acknowledgement");
  }
});

test("opening a message task or completion records reading without completing the task", async () => {
  for (const [taskStatus, canComplete, action] of [
    ["open", true, "Complete task"],
    ["open", false, "View task"],
    ["completed", false, "View completion"],
  ]) {
    const current = {
      ...message,
      taskStatus,
      cycle: { ...cycle, status: taskStatus, canComplete },
    };
    const inputs = [];
    const h = harness({ messages: [current], unreadCount: 1 }, async (url, options) => {
      inputs.push({ url, input: JSON.parse(options.body) });
      return { ok: true };
    });
    let tree = h.render("MessagesPanel", { data });
    assert.equal(inputs.length, 0, "A completed task can still have an unread message");
    button(tree, action).props.onClick();
    await settleMessageAction();
    assert.deepEqual(inputs, [{
      url: "/api/messages",
      input: { dataset: data.dataset, action: "read", payload: { id: message.id } },
    }]);
    tree = h.render("MessagesPanel", { data });
    const dialog = nodes(tree).find((node) => node.type === h.components.TaskCycleDialog);
    assert.equal(dialog.props.cycle, current.cycle);
    assert.equal(dialog.props.cycle.status, taskStatus);
  }
});

test("already read messages open their task without sending an acknowledgement", async () => {
  let sent = 0;
  const h = harness({ messages: [{ ...message, readAt: "2026-10-03T02:00:00Z" }], unreadCount: 0 }, async () => { sent++; });
  let tree = h.render("MessagesPanel", { data });
  messageDetails(tree).props.onToggle({ currentTarget: { open: true } });
  button(tree, "Complete task").props.onClick();
  await settleMessageAction();
  tree = h.render("MessagesPanel", { data });
  assert.equal(sent, 0);
  assert.ok(nodes(tree).find((node) => node.type === h.components.TaskCycleDialog));
  assert.equal(unreadDots(tree).length, 0);
});

test("repeated open and explicit read events share one in-flight message acknowledgement", async () => {
  const inputs = [];
  let resolve;
  const response = new Promise((done) => { resolve = done; });
  const h = harness({ messages: [message], unreadCount: 1 }, async (_url, options) => {
    inputs.push(JSON.parse(options.body));
    return response;
  });
  const tree = h.render("MessagesPanel", { data });
  messageDetails(tree).props.onToggle({ currentTarget: { open: true } });
  messageDetails(tree).props.onToggle({ currentTarget: { open: true } });
  button(tree, "Complete task").props.onClick();
  button(tree, "Mark read").props.onClick();
  assert.equal(inputs.length, 1, "Events arriving before a React rerender must not duplicate the read request");
  assert.equal(button(h.render("MessagesPanel", { data }), "Mark read").props.disabled, true);
  resolve({ ok: true });
  await settleMessageAction();
  assert.equal(h.resource.refreshes, 1);
});

test("a failed implicit read remains unread and can be retried explicitly", async () => {
  const inputs = [];
  let failed = true;
  const h = harness({ messages: [message], unreadCount: 1 }, async (_url, options) => {
    inputs.push(JSON.parse(options.body));
    if (failed) throw new Error("Read could not be saved");
    return { ok: true };
  });
  const render = () => h.render("MessagesPanel", { data });
  messageDetails(render()).props.onToggle({ currentTarget: { open: true } });
  await settleMessageAction();
  let tree = render();
  assert.match(label(tree), /Read could not be saved/);
  assert.equal(messageDetails(tree).props.open, true);
  assert.equal(unreadDots(tree).length, 1);
  assert.equal(button(tree, "Mark read").props.disabled, false);
  assert.equal(h.resource.refreshes, 0);
  render();
  await settleMessageAction();
  assert.equal(inputs.length, 1, "Leaving failed details open must not retry without another action");
  failed = false;
  await button(tree, "Mark read").props.onClick();
  assert.equal(inputs.length, 2);
  assert.deepEqual(inputs[0], inputs[1]);
  assert.equal(h.resource.refreshes, 1);
  h.resource.payload = { messages: [{ ...message, readAt: "2026-10-03T02:00:00Z" }], unreadCount: 0 };
  tree = render();
  assert.equal(unreadDots(tree).length, 0);
  assert.equal(button(tree, "Mark read"), undefined);
});

test("opening details cannot bypass pending or malformed message-request recovery", async () => {
  const storage = sessionStore();
  const first = harness({ messages: [message] }, async () => { throw new Error("Response lost"); }, storage);
  await button(first.render("MessagesPanel", { data }), "Remove").props.onClick();
  first.unmount();
  const key = `battery-task-messages-action:${data.user.id}:${data.dataset}`;
  const saved = storage.getItem(key);
  assert.ok(saved);
  for (const raw of [saved, "{broken"]) {
    storage.setItem(key, raw);
    let sent = 0;
    const h = harness({ messages: [message], unreadCount: 1 }, async () => { sent++; }, storage);
    const tree = h.render("MessagesPanel", { data });
    const summary = nodes(tree).find((node) => node.type === "summary");
    let prevented = false;
    summary.props.onClick({ preventDefault() { prevented = true; } });
    assert.equal(summary.props["aria-disabled"], true);
    assert.equal(prevented, true, "Blocked recovery must prevent the browser's native detail opening action");
    messageDetails(tree).props.onToggle({ currentTarget: { open: true } });
    button(tree, "Mark read").props.onClick();
    await settleMessageAction();
    assert.equal(sent, 0);
    assert.equal(storage.getItem(key), raw);
    assert.equal(unreadDots(h.render("MessagesPanel", { data })).length, 1);
  }
});

test("message removal retries its exact version and request ID after an uncertain response", async () => {
  const inputs = [];
  let lost = true;
  const h = harness({ messages: [message] }, async (url, options) => {
    assert.equal(url, "/api/messages");
    const input = JSON.parse(options.body);
    inputs.push(input);
    if (lost) throw Object.assign(new Error("Response lost"), { status: 503 });
    return receipt(input);
  });
  const render = () => h.render("MessagesPanel", { data });
  await button(render(), "Remove").props.onClick();
  let tree = render();
  assert.equal(button(tree, "Remove").props.disabled, true);
  assert.equal(button(tree, "Complete task").props.disabled, true);
  lost = false;
  await button(tree, "Retry original removal").props.onClick();
  assert.deepEqual(inputs[0], inputs[1]);
  assert.deepEqual(inputs[0].payload, { id: message.id, expectedVersion: 1 });
  assert.equal(inputs[0].action, "remove");
  tree = render();
  assert.equal(button(tree, "Retry original removal"), undefined);
  assert.match(label(tree), /shared task is unchanged/);
});

test("Removed is a separate message location and restore preserves read state", async () => {
  const removed = {
    ...message,
    removedAt: "2026-10-02",
    readAt: "2026-10-01",
    version: 2,
  };
  const inputs = [];
  const h = harness({ messages: [removed] }, async (_url, options) => {
    const input = JSON.parse(options.body);
    inputs.push(input);
    return receipt(input);
  });
  const render = () => h.render("MessagesPanel", { data });
  nodes(render())
    .find((node) => node.type === "Tabs" && node.props.value === "current")
    .props.onValueChange("removed");
  let tree = render();
  assert.equal(
    new URL(h.urls.at(-1), "http://local").searchParams.get("visibility"),
    "removed",
  );
  button(tree, "Clear filters").props.onClick();
  tree = render();
  assert.equal(
    new URL(h.urls.at(-1), "http://local").searchParams.get("visibility"),
    "removed",
  );
  assert.equal(button(tree, "Mark read"), undefined);
  await button(tree, "Restore").props.onClick();
  assert.equal(inputs[0].action, "restore");
  assert.deepEqual(inputs[0].payload, { id: removed.id, expectedVersion: 2 });
});

test("message action receipts must match the account before the UI reports success", async () => {
  const h = harness({ messages: [message] }, async (_url, options) =>
    receipt(JSON.parse(options.body), "another-account"),
  );
  const render = () => h.render("MessagesPanel", { data });
  await button(render(), "Remove").props.onClick();
  assert.ok(button(render(), "Retry original removal"));
  assert.equal(h.resource.refreshes, 0);
});

test("completion is explicit, permits blank notes, and preserves an uncertain request", async () => {
  let lost = true,
    saved = 0,
    closed = 0;
  const inputs = [];
  const h = harness({}, async (_url, options) => {
    inputs.push(JSON.parse(options.body));
    if (lost) throw new Error("Response lost");
    return { ok: true };
  });
  const render = () =>
    h.render("TaskCycleDialog", {
      cycle,
      data,
      onClose() {
        closed++;
      },
      async onSaved() {
        saved++;
      },
    });
  let tree = render();
  assert.equal(button(tree, "Record completion").props.disabled, true);
  assert.ok(
    nodes(tree).find(
      (node) =>
        node.type === "Label" && label(node) === "Completion notes (optional)",
    ),
  );
  nodes(tree)
    .find((node) => node.type === "Checkbox")
    .props.onCheckedChange(true);
  tree = render();
  await button(tree, "Record completion").props.onClick();
  tree = render();
  assert.equal(
    nodes(tree).find((node) => node.type === "Textarea").props.disabled,
    true,
  );
  nodes(tree)
    .find((node) => node.type === "Textarea")
    .props.onChange({ target: { value: "Changed after submission" } });
  nodes(tree)
    .find((node) => node.type === "Dialog")
    .props.onOpenChange(false);
  assert.equal(closed, 0);
  lost = false;
  await button(render(), "Retry original completion").props.onClick();
  assert.deepEqual(inputs[0], inputs[1]);
  assert.equal(inputs[0].payload.notes, "");
  assert.equal(saved, 1);
});

test("editing completion notes clears confirmation and footer stays outside the scrolling body", () => {
  const h = harness();
  const props = { cycle, data, onClose() {}, async onSaved() {} };
  const render = () => h.render("TaskCycleDialog", props);
  nodes(render())
    .find((node) => node.type === "Checkbox")
    .props.onCheckedChange(true);
  nodes(render())
    .find((node) => node.type === "Textarea")
    .props.onChange({ target: { value: "Reviewed" } });
  const tree = render();
  assert.equal(button(tree, "Record completion").props.disabled, true);
  const content = nodes(tree).find((node) => node.type === "DialogContent");
  const children = content.props.children.flat(Infinity).filter(Boolean);
  assert.ok(
    children.some((node) => node.props.className === "task-cycle-body"),
  );
  assert.ok(children.some((node) => node.type === "DialogFooter"));
  assert.equal(
    nodes(tree).find((node) => node.type === "details").props.open,
    undefined,
  );
});

test("completed and removed cycles have no completion action", () => {
  for (const current of [
    { ...cycle, status: "completed", completedByName: "Reviewer" },
    { ...cycle, planRemoved: true, canComplete: false },
  ]) {
    const h = harness();
    const tree = h.render("TaskCycleDialog", {
      cycle: current,
      data,
      onClose() {},
      async onSaved() {},
    });
    assert.equal(button(tree, "Record completion"), undefined);
    assert.equal(
      nodes(tree).find((node) => node.type === "Checkbox"),
      undefined,
    );
    assert.match(
      label(tree),
      current.status === "completed"
        ? /Recorded completion/
        : /Completion is unavailable/,
    );
  }
});

test("a completion conflict requires reviewing latest state and never bypasses a removed plan", async () => {
  const h = harness({}, async (_url, options) => {
    if (options)
      throw Object.assign(new Error("Plan removed"), { status: 409 });
    return {
      cycles: [{ ...cycle, version: 2, planRemoved: true, canComplete: false }],
    };
  });
  const render = () =>
    h.render("TaskCycleDialog", {
      cycle,
      data,
      onClose() {},
      async onSaved() {},
    });
  nodes(render())
    .find((node) => node.type === "Checkbox")
    .props.onCheckedChange(true);
  await button(render(), "Record completion").props.onClick();
  assert.equal(button(render(), "Record completion").props.disabled, true);
  await button(render(), "Load latest task state").props.onClick();
  button(render(), "Accept reviewed task state").props.onClick();
  assert.equal(button(render(), "Record completion"), undefined);
  assert.match(label(render()), /Completion is unavailable/);
});

test("Create task is a visible action and each template opens its own unsaved editor draft", () => {
  for (const template of taskTemplates) {
    const h = harness({ plans: [], cycles: [] });
    let tree = h.render("TaskPlansPanel", { data });
    assert.ok(button(tree, "Create task"));
    assert.equal(nodes(tree).some((node) => node.type === "details"), false);
    assert.equal(button(tree, "Use this template"), undefined);
    button(tree, "Create task").props.onClick();
    tree = h.render("TaskPlansPanel", { data });
    assert.ok(nodes(tree).find((node) => node.type === "DialogTitle" && label(node) === "Create a recurring task"));
    const choices = nodes(tree).filter((node) => node.type === "Button" && label(node) === "Use this template");
    assert.equal(choices.length, 3);
    for (const choice of choices) assert.match(choice.props["aria-label"], /^Choose template: /);
    choices.find((choice) => choice.props["aria-label"] === `Choose template: ${template.label}`).props.onClick();
    tree = h.render("TaskPlansPanel", { data });
    assert.equal(button(tree, "Use this template"), undefined);
    const editor = nodes(tree).find((node) => node.type === "TaskPlanEditor");
    assert.equal(editor.props.original.category, template.plan.category);
    assert.equal(editor.props.original.title, template.plan.title);
    assert.deepEqual(editor.props.original.assigneeIds, template.plan.category === "storage_maintenance" ? [] : [data.user.id]);
    assert.notEqual(editor.props.original.batteryIds, template.plan.batteryIds);
    assert.equal(h.storage.values.size, 0, "Choosing a template does not submit or persist a request");
    editor.props.onClose();
    tree = h.render("TaskPlansPanel", { data });
    assert.equal(nodes(tree).some((node) => node.type === "TaskPlanEditor"), false);
    assert.equal(button(tree, "Create task").props.disabled, false);
  }
});

test("Start from scratch opens a genuinely blank custom draft alongside optional templates", () => {
  const h = harness({ plans: [], cycles: [] });
  button(h.render("TaskPlansPanel", { data }), "Create task").props.onClick();
  let tree = h.render("TaskPlansPanel", { data });
  assert.match(label(tree), /Optional templates/);
  assert.ok(button(tree, "Start from scratch"));
  assert.equal(nodes(tree).filter(node => node.type === "Button" && label(node) === "Use this template").length, 3);
  button(tree, "Start from scratch").props.onClick();
  tree = h.render("TaskPlansPanel", { data });
  const editor = nodes(tree).find(node => node.type === "TaskPlanEditor");
  assert.equal(editor.props.original.category, "custom");
  for (const field of ["title", "description", "basis", "scopeNote"]) assert.equal(editor.props.original[field], "");
  assert.deepEqual(editor.props.original.assigneeIds, [data.user.id]);
  assert.deepEqual(editor.props.original.channels, ["messages"]);
  assert.equal(button(tree, "Start from scratch"), undefined);
  assert.equal(h.storage.values.size, 0, "An unsubmitted blank draft is not an uncertain request");
});

test("task and Messages report choices capture the original filter scope before a file is requested", () => {
  for (const [component, payload, downloadLabel] of [
    ["TaskPlansPanel", { plans: [plan], cycles: [cycle] }, "Download filtered task records"],
    ["MessagesPanel", { messages: [message], unreadCount: 1 }, "Download messages"],
  ]) {
    const h = harness(payload);
    let tree = h.render(component, { data });
    const search = () => nodes(tree).find(node => node.type === "Input" && node.props.placeholder?.startsWith("Search"));
    search().props.onChange({ target: { value: "Storage" } });
    tree = h.render(component, { data });
    button(tree, downloadLabel).props.onClick();
    tree = h.render(component, { data });
    const dialog = nodes(tree).find(node => node.type === "TaskDownloadDialog");
    assert.ok(dialog); assert.match(dialog.props.request.url, /search=Storage/);
    search().props.onChange({ target: { value: "Changed later" } });
    tree = h.render(component, { data });
    assert.equal(nodes(tree).find(node => node.type === "TaskDownloadDialog").props.request.url, dialog.props.request.url);
    assert.match(dialog.props.request.scope, /all pages/);
    if (component === "MessagesPanel") assert.match(dialog.props.request.scope, /your own.*Reading and completion/);
    dialog.props.onClose();
    assert.equal(nodes(h.render(component, { data })).some(node => node.type === "TaskDownloadDialog"), false);
  }
});

test("the template chooser can be cancelled or dismissed without starting a task", () => {
  for (const dismiss of ["cancel", "close"]) {
    const h = harness({ plans: [], cycles: [] });
    button(h.render("TaskPlansPanel", { data }), "Create task").props.onClick();
    const tree = h.render("TaskPlansPanel", { data });
    if (dismiss === "cancel") button(tree, "Cancel").props.onClick();
    else nodes(tree).find((node) => node.type === "Dialog").props.onOpenChange(false);
    const closed = h.render("TaskPlansPanel", { data });
    assert.equal(button(closed, "Use this template"), undefined);
    assert.equal(button(closed, "Start from scratch"), undefined);
    assert.equal(nodes(closed).some((node) => node.type === "TaskPlanEditor"), false);
    assert.equal(button(closed, "Create task").props.disabled, false);
    assert.equal(h.storage.values.size, 0);
  }
});

test("template creation cannot replace a saved uncertain request or malformed recovery data", () => {
  const attempt = captureTaskCreate(taskTemplates[0].plan, data.user.id, data.dataset, "44444444-4444-4444-8444-444444444444");
  for (const raw of [JSON.stringify(attempt), "{broken"]) {
    const storage = sessionStore();
    const key = taskCreateStorageKey(data.user.id, data.dataset);
    storage.setItem(key, raw);
    const h = harness({ plans: [], cycles: [] }, undefined, storage);
    let tree = h.render("TaskPlansPanel", { data });
    assert.equal(button(tree, "Create task").props.disabled, true);
    button(tree, "Create task").props.onClick();
    tree = h.render("TaskPlansPanel", { data });
    assert.equal(button(tree, "Use this template"), undefined);
    assert.equal(button(tree, "Start from scratch"), undefined);
    assert.equal(storage.getItem(key), raw);
    const editor = nodes(tree).find((node) => node.type === "TaskPlanEditor");
    if (raw === "{broken") {
      assert.equal(editor, undefined);
      assert.match(label(tree), /New task creation is blocked/);
    } else assert.deepEqual(editor.props.original, attempt.input.payload);
  }
});

test("an open template chooser disappears when administrator access is lost", () => {
  const h = harness({ plans: [plan], cycles: [] });
  button(h.render("TaskPlansPanel", { data }), "Create task").props.onClick();
  assert.ok(button(h.render("TaskPlansPanel", { data }), "Use this template"));
  const tree = h.render("TaskPlansPanel", { data: { ...data, user: { ...data.user, role: "staff" } } });
  assert.equal(button(tree, "Create task"), undefined);
  assert.equal(button(tree, "Use this template"), undefined);
  assert.equal(button(tree, "Start from scratch"), undefined);
  assert.ok(button(tree, "View plan"));
});

test("plan actions are next to the title, admin-only, and removed plans cannot be edited", () => {
  const h = harness({ plans: [plan], cycles: [] });
  let tree = h.render("TaskPlansPanel", { data });
  const firstCell = nodes(tree).find((node) => node.type === "TableCell");
  assert.ok(button(firstCell, "Remove"));
  assert.ok(button(firstCell, "Edit plan"));
  button(tree, "Remove").props.onClick();
  tree = h.render("TaskPlansPanel", { data });
  assert.ok(
    nodes(tree).find(
      (node) => node.type === h.components.TaskPlanRemovalDialog,
    ),
  );
  const staff = harness({ plans: [plan], cycles: [] }).render(
    "TaskPlansPanel",
    { data: { ...data, user: { ...data.user, role: "staff" } } },
  );
  assert.equal(button(staff, "Remove"), undefined);
  const removed = harness({
    plans: [{ ...plan, removedAt: "2026-10-03" }],
    cycles: [],
  }).render("TaskPlansPanel", { data });
  assert.ok(button(removed, "Restore"));
  assert.equal(button(removed, "Edit plan"), undefined);
});

test("Staff can inspect shared plans without seeing configuration controls or administrator empty-state instructions", () => {
  const staffData = { ...data, user: { ...data.user, role: "staff" } };
  for (const removedAt of [null, "2026-10-03"]) {
    const sharedPlan = { ...plan, removedAt };
    const h = harness({ plans: [sharedPlan], cycles: [] });
    const props = { data: staffData };
    let tree = h.render("TaskPlansPanel", props);
    assert.ok(button(tree, "Download filtered task records"));
    assert.doesNotMatch(label(tree), /Create task|Use this template/);
    for (const action of ["Edit plan", "Remove", "Restore"]) {
      assert.equal(button(tree, action), undefined);
    }
    button(tree, "View plan").props.onClick();
    tree = h.render("TaskPlansPanel", props);
    const detail = nodes(tree).find((node) => node.type === h.components.TaskPlanDetails);
    assert.equal(detail.props.plan, sharedPlan);
    assert.equal(detail.props.data.user.id, staffData.user.id);
  }
  const empty = harness({ plans: [], cycles: [] }).render("TaskPlansPanel", { data: staffData });
  assert.match(label(empty), /An administrator can create a plan/);
  assert.doesNotMatch(label(empty), /Select Create task/);
});

test("switching from Admin to Staff hides plan management while preserving shared visibility", () => {
  const h = harness({ plans: [plan], cycles: [] });
  let tree = h.render("TaskPlansPanel", { data });
  for (const action of ["Create task", "Edit plan", "Remove", "View plan"]) {
    assert.ok(button(tree, action));
  }
  tree = h.render("TaskPlansPanel", { data: { ...data, user: { ...data.user, role: "staff" } } });
  for (const action of ["Create task", "Edit plan", "Remove", "Restore"]) {
    assert.equal(button(tree, action), undefined);
  }
  assert.ok(button(tree, "View plan"));
  assert.ok(button(tree, "Download filtered task records"));
  assert.ok(nodes(tree).find((node) => node.type === "TabsTrigger" && label(node) === "Removed"));
});

test("refreshing task plans keeps readable details but blocks starting changes from stale records", () => {
  for (const removedAt of [null, "2026-10-03"]) {
    const h = harness({ plans: [{ ...plan, removedAt }], cycles: [cycle] });
    h.resource.loading = true;
    let tree = h.render("TaskPlansPanel", { data });
    for (const action of ["Create task", removedAt ? "Restore" : "Remove", ...(!removedAt ? ["Edit plan"] : [])]) {
      assert.equal(button(tree, action).props.disabled, true);
      button(tree, action).props.onClick();
    }
    const tasks = nodes(tree).filter(node => node.type === "Button" && label(node) === "Complete task");
    assert.equal(tasks.length, 2, "Both plan-row and recorded-cycle actions must be protected");
    for (const action of tasks) { assert.equal(action.props.disabled, true); action.props.onClick(); }
    tree = h.render("TaskPlansPanel", { data });
    assert.equal(nodes(tree).some(node => ["TaskPlanEditor", h.components.TaskCycleDialog, h.components.TaskPlanRemovalDialog].includes(node.type)), false);
    button(tree, "View plan").props.onClick();
    assert.ok(nodes(h.render("TaskPlansPanel", { data })).find(node => node.type === h.components.TaskPlanDetails));
  }
  const h = harness({ plans: [plan], cycles: [cycle] });
  h.resource.error = "The server is taking too long to respond.";
  const tree = h.render("TaskPlansPanel", { data });
  assert.equal(button(tree, "Create task").props.disabled, true);
  button(tree, "Create task").props.onClick();
  assert.equal(button(h.render("TaskPlansPanel", { data }), "Start from scratch"), undefined);
});

test("task completion controls continue to follow current server authority for either role", () => {
  for (const role of ["staff", "admin"]) {
    for (const canComplete of [false, true]) {
      const current = { ...cycle, canComplete };
      const props = { data: { ...data, user: { ...data.user, role } } };
      const panel = harness({ plans: [plan], cycles: [current] }).render("TaskPlansPanel", props);
      assert.equal(!!button(panel, "Complete task"), canComplete);
      const dialog = harness().render("TaskCycleDialog", { ...props, cycle: current, onClose() {}, async onSaved() {} });
      assert.equal(!!button(dialog, "Record completion"), canComplete);
    }
  }
});

test("shared plan details show requirements and pause/removal rules without editing controls", () => {
  const savedPlan = {
    ...taskTemplates[0].plan,
    ...plan,
    description: "Inspect the agreed storage conditions.",
    basis: "Confirmed local procedure",
    scopeNote: "The selected storage area",
    firstDueOn: "2026-10-04",
    reminderTime: "09:00",
    updatedAt: "2026-10-03T01:00:00Z",
  };
  for (const state of ["draft", "active", "paused", "removed"]) {
    const tree = harness().render("TaskPlanDetails", {
      plan: { ...savedPlan, state: state === "removed" ? "active" : state, removedAt: state === "removed" ? "2026-10-03" : null },
      data,
      onClose() {},
    });
    assert.match(label(tree), /Inspect the agreed storage conditions/);
    assert.match(label(tree), /Confirmed local procedure/);
    assert.match(label(tree), /09:00 Sydney/);
    assert.match(label(tree), /not a battery safety certification/);
    assert.ok(button(tree, "Close"));
    assert.equal(nodes(tree).some((node) => ["Input", "Select", "Checkbox", "Textarea"].includes(node.type)), false);
    if (state === "paused") assert.match(label(tree), /Existing open tasks can still be completed/);
    if (state === "removed") assert.match(label(tree), /restore this plan before its pending tasks can be completed/);
  }
});

test("Staff cannot send a plan removal or restoration through a directly mounted management dialog", async () => {
  let sent = 0;
  for (const removedAt of [null, "2026-10-03"]) {
    const h = harness({}, async () => { sent++; });
    const tree = h.render("TaskPlanRemovalDialog", {
      original: { ...plan, removedAt },
      data: { ...data, user: { ...data.user, role: "staff" } },
      onClose() {},
      async onSaved() {},
    });
    const action = button(tree, removedAt ? "Restore plan" : "Remove plan");
    assert.equal(action.props.disabled, true);
    await action.props.onClick();
  }
  assert.equal(sent, 0);
});

test("plan removal and restoration capture reviewed versions and verify exact retry receipts", async () => {
  for (const restoring of [false, true]) {
    let lost = true,
      saved = 0,
      closed = 0;
    const inputs = [];
    const h = harness({}, async (_url, options) => {
      const input = JSON.parse(options.body);
      inputs.push(input);
      if (lost) throw new Error("Connection lost");
      return receipt(input);
    });
    const original = { ...plan, removedAt: restoring ? "2026-10-03" : null };
    const render = () =>
      h.render("TaskPlanRemovalDialog", {
        original,
        data,
        onClose() {
          closed++;
        },
        async onSaved() {
          saved++;
        },
      });
    await button(
      render(),
      restoring ? "Restore plan" : "Remove plan",
    ).props.onClick();
    nodes(render())
      .find((node) => node.type === "Dialog")
      .props.onOpenChange(false);
    assert.equal(closed, 0);
    lost = false;
    await button(
      render(),
      restoring ? "Retry original restoration" : "Retry original removal",
    ).props.onClick();
    assert.deepEqual(inputs[0], inputs[1]);
    assert.equal(inputs[0].action, restoring ? "restore" : "remove");
    assert.equal(saved, 1);
  }
});

test("plan conflicts require an explicit review before a new version and request are submitted", async () => {
  const inputs = [];
  const h = harness({}, async (_url, options) => {
    if (!options) return { plans: [{ ...plan, version: 2, state: "paused" }] };
    const input = JSON.parse(options.body);
    inputs.push(input);
    if (inputs.length === 1)
      throw Object.assign(new Error("Changed"), {
        status: 409,
        code: "task_visibility_rejected_final",
      });
    return receipt(input);
  });
  const render = () =>
    h.render("TaskPlanRemovalDialog", {
      original: plan,
      data,
      onClose() {},
      async onSaved() {},
    });
  await button(render(), "Remove plan").props.onClick();
  assert.equal(button(render(), "Remove plan").props.disabled, true);
  await button(render(), "Load latest plan state").props.onClick();
  assert.equal(button(render(), "Remove plan").props.disabled, true);
  button(render(), "Accept reviewed plan state").props.onClick();
  await button(render(), "Remove plan").props.onClick();
  assert.equal(inputs[1].payload.expectedVersion, 2);
  assert.notEqual(inputs[1].requestId, inputs[0].requestId);
});

test("message requests survive remounts, remain account and inventory scoped, and clear only after a verified outcome", async () => {
  const storage = sessionStore(),
    inputs = [];
  const first = harness(
    { messages: [message] },
    async (_url, options) => {
      inputs.push(JSON.parse(options.body));
      throw new Error("Response lost");
    },
    storage,
  );
  await button(
    first.render("MessagesPanel", { data }),
    "Remove",
  ).props.onClick();
  first.unmount();
  assert.equal(storage.values.size, 1);
  for (const otherData of [
    { ...data, dataset: "live" },
    { ...data, user: { ...data.user, id: "another-account" } },
  ]) {
    const other = harness({ messages: [message] }, undefined, storage);
    assert.equal(
      button(
        other.render("MessagesPanel", { data: otherData }),
        "Retry original removal",
      ),
      undefined,
    );
  }
  const recovered = harness(
    { messages: [] },
    async (_url, options) => {
      const input = JSON.parse(options.body);
      inputs.push(input);
      return receipt(input);
    },
    storage,
  );
  const tree = recovered.render("MessagesPanel", { data });
  assert.ok(
    button(tree, "Retry original removal"),
    "Recovery must not depend on the removed message remaining in Inbox",
  );
  assert.equal(
    inputs.length,
    1,
    "Recovery is explicit and does not auto-submit",
  );
  await button(tree, "Retry original removal").props.onClick();
  assert.deepEqual(inputs[0], inputs[1]);
  assert.equal(storage.values.size, 0);
});

test("an unmounted plan removal resumes from the plans panel even when the plan is no longer current", async () => {
  const storage = sessionStore(),
    inputs = [];
  const first = harness(
    {},
    async (_url, options) => {
      inputs.push(JSON.parse(options.body));
      throw new Error("Response lost");
    },
    storage,
  );
  await button(
    first.render("TaskPlanRemovalDialog", {
      original: plan,
      data,
      onClose() {},
      async onSaved() {},
    }),
    "Remove plan",
  ).props.onClick();
  first.unmount();
  const recovered = harness(
    { plans: [], cycles: [] },
    async (_url, options) => {
      const input = JSON.parse(options.body);
      inputs.push(input);
      return receipt(input);
    },
    storage,
  );
  const tree = recovered.render("TaskPlansPanel", { data });
  assert.equal(button(tree, "Create task").props.disabled, true);
  button(tree, "Create task").props.onClick();
  assert.equal(button(recovered.render("TaskPlansPanel", { data }), "Use this template"), undefined);
  await button(tree, "Retry original plan removal").props.onClick();
  assert.deepEqual(inputs[0], inputs[1]);
  assert.equal(storage.values.size, 0);
  assert.equal(button(recovered.render("TaskPlansPanel", { data }), "Create task").props.disabled, false);
});

test("storage write failure prevents both message and plan requests from being sent", async () => {
  for (const component of ["MessagesPanel", "TaskPlanRemovalDialog"]) {
    let sent = 0;
    const storage = {
      ...sessionStore(),
      setItem() {
        throw new Error("Storage quota exceeded");
      },
    };
    const h = harness(
      { messages: [message] },
      async () => {
        sent++;
      },
      storage,
    );
    const props = { data, original: plan, onClose() {}, async onSaved() {} };
    await button(
      h.render(component, props),
      component === "MessagesPanel" ? "Remove" : "Remove plan",
    ).props.onClick();
    assert.equal(sent, 0);
    assert.match(label(h.render(component, props)), /No change was sent/);
  }
});

test("ordinary 409 responses retain saved requests until the server reserves a terminal rejection", async () => {
  for (const component of ["MessagesPanel", "TaskPlanRemovalDialog"]) {
    const storage = sessionStore(),
      inputs = [];
    let final = false;
    const h = harness(
      { messages: [message] },
      async (_url, options) => {
        inputs.push(JSON.parse(options.body));
        throw Object.assign(new Error("The record changed"), {
          status: 409,
          ...(final ? { code: "task_visibility_rejected_final" } : {}),
        });
      },
      storage,
    );
    const props = { data, original: plan, onClose() {}, async onSaved() {} };
    const render = () => h.render(component, props);
    await button(
      render(),
      component === "MessagesPanel" ? "Remove" : "Remove plan",
    ).props.onClick();
    assert.equal(storage.values.size, 1);
    const retry = button(render(), "Retry original removal");
    assert.ok(retry);
    final = true;
    await retry.props.onClick();
    assert.deepEqual(inputs[0], inputs[1]);
    assert.equal(storage.values.size, 0);
  }
});

test("malformed saved requests block new actions instead of being overwritten", () => {
  const storage = sessionStore();
  storage.setItem(
    `battery-task-messages-action:${data.user.id}:${data.dataset}`,
    "{broken",
  );
  const h = harness({ messages: [message] }, undefined, storage);
  const tree = h.render("MessagesPanel", { data });
  assert.equal(button(tree, "Remove").props.disabled, true);
  assert.ok(button(tree, "Retry saved request recovery"));
  assert.equal(
    storage.getItem(
      `battery-task-messages-action:${data.user.id}:${data.dataset}`,
    ),
    "{broken",
  );
});

test("late successful responses clear their saved request without refreshing an unmounted inventory", async () => {
  const storage = sessionStore();
  let resolve,
    input,
    refreshed = 0;
  const response = new Promise((done) => {
    resolve = done;
  });
  const h = harness(
    { messages: [message] },
    async (_url, options) => {
      input = JSON.parse(options.body);
      return response;
    },
    storage,
  );
  const pending = button(
    h.render("MessagesPanel", {
      data,
      async onChanged() {
        refreshed++;
      },
    }),
    "Remove",
  ).props.onClick();
  assert.equal(
    storage.values.size,
    1,
    "The exact request must be durable before fetch starts",
  );
  h.unmount();
  resolve(receipt(input));
  await pending;
  assert.equal(refreshed, 0);
  assert.equal(storage.values.size, 0);
});
