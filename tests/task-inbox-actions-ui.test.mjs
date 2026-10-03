import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const sources = await Promise.all(
  [
    "lib/client/task-record-action.ts",
    "components/inventory/messages-panel.tsx",
    "components/inventory/task-plans-panel.tsx",
    "components/inventory/tasks/task-cycle-dialog.tsx",
    "components/inventory/tasks/task-plan-removal-dialog.tsx",
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
  ];
  const bindings = {
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
    useEffect(callback) {
      const index = effectPointer++;
      if (!(index in effects)) effects[index] = callback();
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
    taskTemplates: [],
    recoverTaskCreate: () => null,
    taskCreateStorageKey: () => "key",
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
    `${compiled}\nreturn { MessagesPanel, TaskPlansPanel, TaskCycleDialog, TaskPlanRemovalDialog };`,
  )(...Object.values(bindings), jsx, jsx, "Fragment");
  return {
    components,
    resource,
    urls,
    storage,
    unmount() {
      effects.forEach((cleanup) => cleanup?.());
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

test("plan actions are next to the title, admin-only, and removed plans cannot be edited", () => {
  const h = harness({ plans: [plan], cycles: [] });
  let tree = h.render("TaskPlansPanel", { data });
  const firstCell = nodes(tree).find((node) => node.type === "TableCell");
  assert.ok(button(firstCell, "Remove"));
  assert.ok(button(firstCell, "Edit"));
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
  assert.equal(button(removed, "Edit"), undefined);
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
  await button(tree, "Retry original plan removal").props.onClick();
  assert.deepEqual(inputs[0], inputs[1]);
  assert.equal(storage.values.size, 0);
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
