import assert from "node:assert/strict";

/** Exercise recoverable inbox and shared plan actions through authenticated HTTP. */
export async function checkTaskRemoval({
  check,
  json,
  adminCookie,
  staffCookie,
}) {
  const read = async (name, url, cookie = staffCookie) =>
    (await check(name, url, { headers: { Cookie: cookie } })).json();
  const post = async (
    name,
    url,
    action,
    payload,
    cookie = staffCookie,
    status = 200,
    requestId = crypto.randomUUID(),
  ) => {
    const response = await check(
      name,
      url,
      json({ dataset: "demo", action, payload, requestId }, cookie),
      status,
    );
    return { body: await response.json(), requestId };
  };
  const admin = (
    await read(
      "task review resolves the administrator identity",
      "/api/inventory?dataset=demo",
      adminCookie,
    )
  ).user;
  const staff = (
    await read(
      "task review resolves the staff identity",
      "/api/inventory?dataset=demo",
    )
  ).user;
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Sydney",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const plan = {
    category: "inventory_reconciliation",
    title: "Inbox usability verification",
    description:
      "Review this isolated software fixture. No physical battery procedure is implied.",
    basis: "Temporary software verification only.",
    scopeNote: "Isolated demonstration inventory.",
    targetKind: "inventory",
    targetRef: null,
    batteryIds: [],
    assigneeIds: [admin.id, staff.id],
    firstDueOn: today,
    recurrenceBasis: "calendar",
    interval: 1,
    unit: "months",
    scheduledDates: [],
    reminderDaysBefore: 0,
    reminderTime: "00:00",
    channels: ["messages"],
    state: "active",
    applicabilityConfirmed: true,
  };
  const created = (
    await post(
      "administrator creates a reviewable recurring plan",
      "/api/task-plans",
      "create",
      plan,
      adminCookie,
    )
  ).body.result;
  const listed = await read(
    "current plans include the new plan and its recorded cycle",
    "/api/task-plans?dataset=demo",
  );
  const cycle = listed.cycles.find(
    (item) => item.planId === created.id && item.status === "open",
  );
  assert.ok(cycle?.canComplete);
  const inbox = await read(
    "assigned staff receive a task in their own inbox",
    "/api/messages?dataset=demo",
  );
  const message = inbox.messages.find((item) => item.cycleId === cycle.id);
  assert.ok(message);
  assert.equal(message.removedAt, null);
  const adminInbox = await read(
    "the other recipient receives an independent message",
    "/api/messages?dataset=demo",
    adminCookie,
  );
  assert.ok(
    adminInbox.messages.some(
      (item) => item.cycleId === cycle.id && item.id !== message.id,
    ),
  );

  await post(
    "an administrator cannot remove another recipient's message",
    "/api/messages",
    "remove",
    { id: message.id, expectedVersion: message.version },
    adminCookie,
    404,
  );
  const removed = await post(
    "a staff member can remove their own message",
    "/api/messages",
    "remove",
    { id: message.id, expectedVersion: message.version },
  );
  assert.ok(removed.body.result.removedAt);
  const afterRemoval = await read(
    "removed messages leave the current inbox and unread count",
    "/api/messages?dataset=demo",
  );
  assert.ok(!afterRemoval.messages.some((item) => item.id === message.id));
  assert.equal(afterRemoval.unreadCount, inbox.unreadCount - 1);
  const bin = await read(
    "the removed view retains the recoverable message",
    "/api/messages?dataset=demo&visibility=removed",
  );
  const recoverable = bin.messages.find((item) => item.id === message.id);
  assert.ok(recoverable?.removedAt);
  assert.equal(recoverable.readAt, message.readAt);
  const exportBin = await read(
    "removed-message downloads retain the selected visibility",
    "/api/messages?dataset=demo&visibility=removed&download=json",
  );
  assert.ok(exportBin.messages.some((item) => item.id === message.id));
  assert.ok(exportBin.messages.every((item) => item.recipientId === staff.id));
  const restored = (
    await post(
      "a removed message can be restored",
      "/api/messages",
      "restore",
      { id: message.id, expectedVersion: recoverable.version },
    )
  ).body.result;
  assert.equal(restored.removedAt, null);
  const replay = await post(
    "an old removal retry returns its original receipt",
    "/api/messages",
    "remove",
    { id: message.id, expectedVersion: message.version },
    staffCookie,
    200,
    removed.requestId,
  );
  assert.deepEqual(replay.body.result, removed.body.result);
  const restoredInbox = await read(
    "an old removal retry cannot undo a later restoration",
    "/api/messages?dataset=demo",
  );
  assert.equal(
    restoredInbox.messages.find((item) => item.id === message.id).version,
    restored.version,
  );
  assert.equal(restoredInbox.unreadCount, inbox.unreadCount);

  await post(
    "ordinary staff cannot remove shared recurring plans",
    "/api/task-plans",
    "remove",
    { id: created.id, expectedVersion: created.version },
    staffCookie,
    403,
  );
  const removedPlan = (
    await post(
      "an administrator can remove a shared plan",
      "/api/task-plans",
      "remove",
      { id: created.id, expectedVersion: created.version },
      adminCookie,
    )
  ).body.result;
  assert.ok(removedPlan.removedAt);
  const currentPlans = await read(
    "removed plans leave the current plan list",
    "/api/task-plans?dataset=demo",
  );
  assert.ok(!currentPlans.plans.some((item) => item.id === created.id));
  const removedPlans = await read(
    "removed plans retain their original recorded cycle",
    "/api/task-plans?dataset=demo&visibility=removed",
  );
  assert.ok(removedPlans.plans.some((item) => item.id === created.id));
  const held = removedPlans.cycles.find((item) => item.id === cycle.id);
  assert.equal(held.status, "open");
  assert.equal(held.planRemoved, true);
  assert.equal(held.canComplete, false);
  await post(
    "completion cannot bypass a removed plan",
    "/api/task-plans",
    "complete",
    { cycleId: cycle.id, expectedVersion: cycle.version },
    staffCookie,
    409,
  );
  const todo = await read(
    "removed-plan reminders no longer appear as actionable to-do tasks",
    "/api/messages?dataset=demo&taskStatus=open",
  );
  assert.ok(!todo.messages.some((item) => item.cycleId === cycle.id));
  const history = await read(
    "all messages still explain that the linked plan is removed",
    "/api/messages?dataset=demo",
  );
  assert.equal(
    history.messages.find((item) => item.id === message.id).cycle.planRemoved,
    true,
  );
  const otherAfter = await read(
    "personal removal does not alter another recipient's message",
    "/api/messages?dataset=demo",
    adminCookie,
  );
  assert.ok(
    otherAfter.messages.some(
      (item) => item.cycleId === cycle.id && item.removedAt === null,
    ),
  );

  await post(
    "the administrator can restore the original plan state",
    "/api/task-plans",
    "restore",
    { id: created.id, expectedVersion: removedPlan.version },
    adminCookie,
  );
  const resumed = await read(
    "restoration makes the same recorded cycle available again",
    "/api/task-plans?dataset=demo",
  );
  assert.equal(
    resumed.plans.find((item) => item.id === created.id).state,
    "active",
  );
  const actionable = resumed.cycles.find((item) => item.id === cycle.id);
  assert.ok(actionable.canComplete);
  assert.equal(actionable.planRemoved, false);
  await post(
    "assigned staff record actual completion after restoration",
    "/api/task-plans",
    "complete",
    {
      cycleId: cycle.id,
      expectedVersion: actionable.version,
      notes: "Isolated software review completed.",
    },
  );
  const completed = await read(
    "the message links to its saved completion result",
    "/api/messages?dataset=demo&taskStatus=completed",
  );
  const completedMessage = completed.messages.find(
    (item) => item.id === message.id,
  );
  assert.equal(completedMessage.cycle.status, "completed");
  assert.equal(completedMessage.cycle.completedBy, staff.id);
  assert.equal(completedMessage.readAt, message.readAt);
  const current = await read(
    "completed task evidence remains in the shared plan",
    "/api/task-plans?dataset=demo",
  );
  const savedPlan = current.plans.find((item) => item.id === created.id);
  await post(
    "removing a completed plan preserves its history",
    "/api/task-plans",
    "remove",
    { id: created.id, expectedVersion: savedPlan.version },
    adminCookie,
  );
  const exported = await read(
    "removed-plan exports contain complete completion history",
    "/api/task-plans?dataset=demo&visibility=removed&download=json",
  );
  assert.ok(exported.plans.some((item) => item.id === created.id));
  assert.equal(
    exported.cycles.find((item) => item.id === cycle.id).completionNotes,
    "Isolated software review completed.",
  );
}
