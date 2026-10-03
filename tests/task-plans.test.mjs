import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Miniflare } from "miniflare";
import { AccountStore } from "../work/qa/accounts.mjs";
import { InventoryStore } from "../work/qa/store.mjs";
import { TaskPlanStore, taskCapabilities } from "../work/qa/task-plans.mjs";
import { taskTemplates, taskPlanSchema } from "../work/qa/task-schedule.mjs";

const journal = JSON.parse(await readFile("drizzle/meta/_journal.json", "utf8"));
async function migrate(database, entries = journal.entries) {
    for (const entry of entries) {
        const sql = await readFile(`drizzle/${entry.tag}.sql`, "utf8");
        await database.batch(sql.split("--> statement-breakpoint").filter(statement => statement.trim()).map(statement => database.prepare(statement)));
    }
}
const mf = new Miniflare({ modules: true, script: "export default {fetch(){return new Response('task-plan-test')}}", compatibilityDate: "2026-05-15", d1Databases: { DB: "task-plan-test" }, d1Persist: false });
const db = await mf.getD1Database("DB");
await migrate(db);
after(() => mf.dispose());

const initialTime = "2026-01-31T00:00:00.000Z";
async function seedAccounts(database) {
    const identities = [
        { id: crypto.randomUUID(), username: "task-admin", displayName: "Task Administrator", role: "admin" },
        { id: crypto.randomUUID(), username: "task-second-admin", displayName: "Second Administrator", role: "admin" },
        { id: crypto.randomUUID(), username: "task-staff-one", displayName: "Same Staff Name", role: "staff" },
        { id: crypto.randomUUID(), username: "task-staff-two", displayName: "Same Staff Name", role: "staff" },
    ];
    for (const value of identities) await database.prepare("INSERT INTO staff_accounts(id,username,display_name,role,password_hash,password_salt,hash_iterations,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)")
        .bind(value.id, value.username, value.displayName, value.role, "test-only-no-login", "test-only-no-login", 600000, initialTime, initialTime).run();
    const accounts = new AccountStore(database, () => new Date(initialTime));
    return Promise.all(identities.map(value => accounts.user(value.id)));
}
const [admin, secondAdmin, self, other] = await seedAccounts(db);
const inventoryActor = user => ({ id: user.id, name: user.displayName, role: user.role, authVersion: user.authVersion });
const status = code => error => error.status === code;
const invalid = error => error.name === "ZodError" || error.status === 400;
const rows = async (table, scope, database = db) => (await database.prepare(`SELECT * FROM ${table} WHERE scope=? ORDER BY rowid`).bind(scope).all()).results;
const messages = result => result.messages;

async function fixture(name, dataset = "demo") {
    const scope = `task-${name}:${dataset}`;
    let currentTime = initialTime;
    const clock = () => new Date(currentTime);
    const inventory = user => new InventoryStore(db, scope, dataset, inventoryActor(user ?? admin), clock);
    await inventory().snapshot();
    return {
        scope, dataset, inventory,
        tasks: (user = admin, database = db) => new TaskPlanStore(database, scope, dataset, user, clock),
        setTime: value => { currentTime = value; },
        battery: async (id = "BAT-ONE", model = "Confirmed Model One") => inventory().saveBattery({ id, name: "Task verification battery", model, ownerId: `staff-${self.id}`, homeBuildingId: "J18", homeRoomId: "J18-DEMO-ROOM" }),
    };
}
const activePlan = (extra = {}) => ({
    category: "storage_review", title: "Confirmed storage-area review", description: "Review the selected area and record findings, decisions and follow-up actions.",
    basis: "Confirmed local review procedure, revision 2.", scopeNote: "Selected J18 storage area.", targetKind: "storage_area", targetRef: "J18-DEMO-ROOM", batteryIds: [],
    assigneeIds: [self.id], firstDueOn: "2026-01-31", recurrenceBasis: "calendar", interval: 1, unit: "months", scheduledDates: [],
    reminderDaysBefore: 0, reminderTime: "09:00", channels: ["messages"], state: "active", applicabilityConfirmed: true, ...extra,
});
async function savedPlan(context, id) { return (await context.tasks().list()).plans.find(plan => plan.id === id); }
async function openCycle(context, id) { return (await context.tasks().list()).cycles.find(cycle => cycle.planId === id && cycle.status === "open"); }

test("a task create whose success response is lost replays its exact receipt without duplicate plans, cycles or reminders", async () => {
    const context = await fixture("create-response-lost"), input = activePlan(), requestId = crypto.randomUUID();
    const committed = await context.tasks().savePlan(input, false, requestId);
    // The client receives no usable success result, then resends the same captured request.
    assert.deepEqual(await context.tasks().savePlan(input, false, requestId), committed);
    assert.equal(committed.requestId, requestId); assert.equal(committed.action, "create");
    assert.equal(committed.actorAccountId, admin.id); assert.equal(committed.dataset, "demo");
    const tasks = await context.tasks().list(), inbox = await context.tasks(self).messages();
    assert.equal(tasks.plans.length, 1); assert.equal(tasks.cycles.length, 1); assert.equal(inbox.messages.length, 1);
    assert.equal((await rows("audit_events", context.scope)).filter(row => row.action === "task_plan_created").length, 1);
    await assert.rejects(context.tasks().savePlan({ ...input, title: "Changed uncertain draft" }, false, requestId), error => error.code === "idempotency_conflict");
    await assert.rejects(context.tasks(secondAdmin).savePlan(input, false, requestId), error => error.code === "idempotency_conflict");
});

test("earlier task creation receipts retain their saved identity and gain verifiable request context without rewriting history", async () => {
    const context = await fixture("create-prior-receipt"), input = activePlan(), requestId = crypto.randomUUID();
    const saved = await context.tasks().savePlan(input);
    const storedResult = { id: saved.id, version: saved.version }, fingerprint = JSON.stringify({ actorId: admin.id, action: "create", plan: taskPlanSchema.parse(input), edit: null });
    await db.prepare("INSERT INTO operations(id,scope,kind,fingerprint,result_json,created_at,guard) VALUES(?,?,'task_plan_change',?,?,?,1)").bind(`${context.scope}/${requestId}`, context.scope, fingerprint, JSON.stringify(storedResult), initialTime).run();
    const replayed = await context.tasks().savePlan(input, false, requestId);
    assert.deepEqual(replayed, { ...storedResult, requestId, action: "create", actorAccountId: admin.id, dataset: "demo" });
    const persisted = await db.prepare("SELECT result_json FROM operations WHERE id=?").bind(`${context.scope}/${requestId}`).first();
    assert.deepEqual(JSON.parse(persisted.result_json), storedResult);
    assert.equal((await rows("task_plans", context.scope)).length, 1);
    assert.equal((await rows("audit_events", context.scope)).filter(row => row.action === "task_plan_created").length, 1);
});

test("late task create success wins over a retry's subsequent stale assignment preflight", async () => {
    const context = await fixture("create-late-success"), input = activePlan(), requestId = crypto.randomUUID();
    let releaseOriginal, enterOriginal;
    const paused = new Promise(resolve => { enterOriginal = resolve; });
    const release = new Promise(resolve => { releaseOriginal = resolve; });
    const original = context.tasks(admin, beforeAtomicCommit(async () => { enterOriginal(); await release; })).savePlan(input, false, requestId);
    await paused;
    const sqlByStatement = new WeakMap();
    let intervened = false;
    const retryDb = {
        prepare(sql) {
            const prepared = db.prepare(sql);
            return { bind(...values) { const bound = prepared.bind(...values); sqlByStatement.set(bound, sql); return bound; } };
        },
        async batch(statements) {
            if (!intervened && statements.some(statement => sqlByStatement.get(statement)?.startsWith("SELECT * FROM task_plans"))) {
                intervened = true; releaseOriginal(); await original;
                await db.prepare("UPDATE staff_accounts SET active=0 WHERE id=?").bind(self.id).run();
            }
            return db.batch(statements);
        },
    };
    try {
        const replayed = await context.tasks(admin, retryDb).savePlan(input, false, requestId);
        assert.deepEqual(replayed, await original);
        assert.equal((await rows("task_plans", context.scope)).length, 1);
        assert.equal((await rows("operations", context.scope)).filter(row => row.kind === "task_plan_create_rejected").length, 0);
        assert.equal((await rows("audit_events", context.scope)).filter(row => row.action === "task_plan_created").length, 1);
    } finally { releaseOriginal(); await db.prepare("UPDATE staff_accounts SET active=1 WHERE id=?").bind(self.id).run(); }
});

test("a final rejected task creation blocks a delayed same-ID commit even after its assignment becomes valid again", async () => {
    const context = await fixture("create-terminal-rejection"), input = activePlan(), requestId = crypto.randomUUID();
    let releaseOriginal, enterOriginal;
    const paused = new Promise(resolve => { enterOriginal = resolve; });
    const release = new Promise(resolve => { releaseOriginal = resolve; });
    const original = context.tasks(admin, beforeAtomicCommit(async () => { enterOriginal(); await release; })).savePlan(input, false, requestId).then(result => ({ result }), error => ({ error }));
    await paused;
    try {
        await db.prepare("UPDATE staff_accounts SET active=0 WHERE id=?").bind(self.id).run();
        await assert.rejects(context.tasks().savePlan(input, false, requestId), error => error.status === 400 && error.code === "task_create_rejected_final");
        await db.prepare("UPDATE staff_accounts SET active=1 WHERE id=?").bind(self.id).run();
        releaseOriginal();
        const delayed = await original;
        assert.equal(delayed.error?.code, "task_create_rejected_final");
        assert.equal((await rows("task_plans", context.scope)).length, 0);
        assert.equal((await rows("task_cycles", context.scope)).length, 0);
        assert.equal((await rows("audit_events", context.scope)).filter(row => row.action === "task_plan_created").length, 0);
        assert.equal((await rows("operations", context.scope)).filter(row => row.kind === "task_plan_create_rejected").length, 1);
        await assert.rejects(context.tasks().savePlan(input, false, requestId), error => error.code === "task_create_rejected_final");
        await assert.rejects(context.tasks(secondAdmin).savePlan(input, false, requestId), error => error.code === "idempotency_conflict");
        await assert.rejects(context.tasks().savePlan({ ...input, title: "Replacement request content" }, false, requestId), error => error.code === "idempotency_conflict");
        const reviewed = await context.tasks().savePlan(input, false, crypto.randomUUID());
        assert.equal(reviewed.version, 1);
        assert.equal((await context.tasks().list()).plans.length, 1);
        assert.equal((await context.tasks(self).messages()).messages.length, 1);
    } finally { releaseOriginal(); await db.prepare("UPDATE staff_accounts SET active=1 WHERE id=?").bind(self.id).run(); await original; }
});
async function updatePlan(context, id, changes = {}, database = db) {
    const before = await savedPlan(context, id);
    return context.tasks(admin, database).savePlan({ ...before, ...changes, expectedVersion: before.version }, true);
}
function beforeAtomicCommit(intervene) {
    const sqlByStatement = new WeakMap();
    let intercepted = false;
    return {
        prepare: sql => {
            const prepared = db.prepare(sql);
            return { bind: (...values) => { const bound = prepared.bind(...values); sqlByStatement.set(bound, sql); return bound; } };
        },
        batch: async statements => {
            if (!intercepted && statements.some(statement => /^INSERT INTO operations\(/.test(sqlByStatement.get(statement) ?? ""))) {
                intercepted = true;
                await intervene();
            }
            return db.batch(statements);
        },
    };
}

test("administrators configure only the three supported task categories; drafts do not activate unknown requirements", async () => {
    const context = await fixture("configuration");
    for (const template of taskTemplates) await context.tasks().savePlan(template.plan);
    const initial = await context.tasks().list();
    assert.equal(initial.plans.length, 3);
    assert.ok(initial.plans.every(plan => plan.state === "draft" && plan.firstDueOn === null && plan.reminderTime === null));
    await assert.rejects(context.tasks(self).savePlan(activePlan()), status(403));
    for (const changes of [{ category: "daily_observation" }, { category: "battery_issue" }, { category: "record_correction" }, { basis: "" }, { applicabilityConfirmed: false }, { assigneeIds: [] }, { reminderTime: null }])
        await assert.rejects(context.tasks().savePlan(activePlan(changes)), invalid);
    assert.equal((await context.tasks().list()).plans.length, 3);
    const [first] = initial.plans;
    await context.tasks().savePlan({ ...first, title: "Updated draft title", expectedVersion: first.version }, true);
    const beforeStale = await rows("audit_events", context.scope);
    await assert.rejects(context.tasks().savePlan({ ...first, title: "Stale replacement title", expectedVersion: first.version }, true), status(409));
    await assert.rejects(context.tasks(self).savePlan({ ...first, expectedVersion: first.version }, true), status(403));
    assert.deepEqual(await rows("audit_events", context.scope), beforeStale);
    assert.equal((await savedPlan(context, first.id)).title, "Updated draft title");
});

test("activation validates actual model/group assets and rejects unavailable targets or unverified working rooms", async () => {
    const context = await fixture("targets");
    await context.battery();
    await context.tasks().savePlan(activePlan({ category: "storage_maintenance", targetKind: "model", targetRef: "Confirmed Model One" }));
    await context.tasks().savePlan(activePlan({ category: "storage_maintenance", targetKind: "group", targetRef: "Confirmed teaching group", batteryIds: ["BAT-ONE"] }));
    await assert.rejects(context.tasks().savePlan(activePlan({ category: "storage_maintenance", targetKind: "model", targetRef: "Unknown Model" })), invalid);
    await assert.rejects(context.tasks().savePlan(activePlan({ category: "storage_maintenance", targetKind: "group", targetRef: "Undefined group", batteryIds: [] })), invalid);
    await assert.rejects(context.tasks().savePlan(activePlan({ category: "storage_maintenance", targetKind: "batteries", targetRef: null, batteryIds: ["NOT-REGISTERED"] })), invalid);
    await assert.rejects(context.tasks().savePlan(activePlan({ targetRef: "NOT-A-ROOM" })), invalid);
    await context.tasks().sync();
    const modelCycle = (await context.tasks().list()).cycles.find(cycle => cycle.targetKind === "model");
    assert.ok(JSON.stringify(modelCycle.targetSnapshot).includes("BAT-ONE"));

    const working = await fixture("targets-working", "live");
    await assert.rejects(working.tasks().savePlan(activePlan()), invalid);
    await working.tasks().savePlan(activePlan({ state: "draft", applicabilityConfirmed: false }));
    const room = (await working.inventory().snapshot()).rooms.find(row => row.id === "J18-DEMO-ROOM");
    await working.inventory().saveRoom({ ...room, buildingId: "J18", name: "Verified local storage room", number: "115", isPlaceholder: false, expectedVersion: room.version }, true);
    await working.tasks().savePlan(activePlan());
    const foreign = await fixture("target-foreign");
    await foreign.battery("FOREIGN-ONLY");
    await assert.rejects(context.tasks().savePlan(activePlan({ category: "storage_maintenance", targetKind: "batteries", targetRef: null, batteryIds: ["FOREIGN-ONLY"] })), invalid);
});

test("administrator-role and assignee changes at commit reject all plan data and audit changes atomically", async () => {
    const context = await fixture("plan-commit");
    const before = await rows("audit_events", context.scope);
    try {
        const raced = beforeAtomicCommit(async () => { await db.prepare("UPDATE staff_accounts SET role='staff',auth_version=auth_version+1,version=version+1 WHERE id=?").bind(admin.id).run(); });
        await assert.rejects(context.tasks(admin, raced).savePlan(activePlan()), status(409));
        assert.equal((await context.tasks(secondAdmin).list()).plans.length, 0);
        assert.deepEqual(await rows("audit_events", context.scope), before);
    } finally { await db.prepare("UPDATE staff_accounts SET role='admin',active=1,auth_version=1,version=version+1 WHERE id=?").bind(admin.id).run(); }
    try {
        const raced = beforeAtomicCommit(async () => { await db.prepare("UPDATE staff_accounts SET active=0,auth_version=auth_version+1,version=version+1 WHERE id=?").bind(self.id).run(); });
        await assert.rejects(context.tasks(admin, raced).savePlan(activePlan()), status(409));
        assert.equal((await context.tasks().list()).plans.length, 0);
        assert.deepEqual(await rows("audit_events", context.scope), before);
    } finally { await db.prepare("UPDATE staff_accounts SET active=1,auth_version=1,version=version+1 WHERE id=?").bind(self.id).run(); }
});

test("request-triggered synchronization respects reminder time and deduplicates concurrent cycle and recipient creation", async () => {
    const context = await fixture("synchronization");
    context.setTime("2026-02-06T21:59:00.000Z");
    const result = await context.tasks().savePlan(activePlan({ firstDueOn: "2026-02-10", reminderDaysBefore: 3, assigneeIds: [self.id, other.id] }));
    await context.tasks().sync();
    assert.equal((await rows("task_messages", context.scope)).length, 0);
    context.setTime("2026-02-06T22:00:00.000Z");
    await Promise.all([context.tasks().sync(), context.tasks(self).sync(), context.tasks(other).sync()]);
    const cycles = (await rows("task_cycles", context.scope)).filter(row => row.status === "open");
    assert.equal(cycles.length, 1);
    assert.equal((await rows("task_messages", context.scope)).length, 2);
    assert.equal((await openCycle(context, result.id)).dueOn, "2026-02-10");
    await context.tasks().sync();
    assert.equal((await rows("task_messages", context.scope)).length, 2);
    assert.equal(taskCapabilities.schedulerAvailable, false);
    assert.equal(taskCapabilities.emailAvailable, false);
    assert.equal(taskCapabilities.messageGeneration, "on_request");
});

test("same-name staff share task plans but inbox recipients and read states use authenticated account identity", async () => {
    const context = await fixture("inbox-identity");
    await context.tasks().savePlan(activePlan({ assigneeIds: [self.id, other.id] }));
    await context.tasks().sync();
    const mine = messages(await context.tasks(self).messages()), theirs = messages(await context.tasks(other).messages());
    assert.equal(mine.length, 1);
    assert.equal(theirs.length, 1);
    assert.equal(mine[0].recipientId, self.id);
    assert.equal(theirs[0].recipientId, other.id);
    assert.notEqual(mine[0].id, theirs[0].id);
    assert.equal(mine[0].cycleId, theirs[0].cycleId);
    assert.equal(messages(await context.tasks().messages()).length, 0);
    assert.equal((await context.tasks(other).list()).plans.length, 1);
    await assert.rejects(context.tasks(other).markRead({ id: mine[0].id }), error => error.status === 403 || error.status === 404);
    assert.ok(messages(await context.tasks(other).messages({ recipientId: self.id })).every(message => message.recipientId === other.id));
    await Promise.all([context.tasks(self).markRead({ id: mine[0].id }), context.tasks(self).markRead({ id: mine[0].id })]);
    const readAt = messages(await context.tasks(self).messages())[0].readAt;
    assert.ok(readAt);
    await context.tasks(self).markRead({ id: mine[0].id });
    assert.equal(messages(await context.tasks(self).messages())[0].readAt, readAt);
    assert.equal(messages(await context.tasks(other).messages())[0].readAt, null);
    assert.equal((await context.tasks(self).messages()).unreadCount, 0);
    assert.equal((await context.tasks(other).messages()).unreadCount, 1);
    const counts = await context.tasks(self).messageCounts();
    assert.equal(counts.messageCount, 1);
    assert.equal(counts.unreadCount, 0);
    assert.equal(counts.messages, undefined);
    assert.equal(messages(await context.tasks(self).messages({ allUnread: true })).length, 0);
    assert.equal(messages(await context.tasks(other).messages({ search: "CONFIRMED STORAGE-AREA" })).length, 1);
    assert.equal(messages(await context.tasks(other).messages({ search: "No matching work" })).length, 0);
    assert.equal((await rows("audit_events", context.scope)).filter(row => row.action === "task_message_read").length, 1);
    assert.equal(messages(await context.tasks(self).messages())[0].taskStatus, "open");
    assert.equal((await rows("task_cycles", context.scope))[0].completed_at, null);

    const separate = await fixture("inbox-identity", "live");
    assert.equal(messages(await separate.tasks(self).messages()).length, 0);
    await assert.rejects(separate.tasks(self).markRead({ id: mine[0].id }), status(404));
});

test("create/edit request identities replay once, and completion-based early work can retain the same next due date", async () => {
    const context = await fixture("request-identity"), input = activePlan(), requestId = crypto.randomUUID();
    const results = await Promise.all([context.tasks().savePlan(input, false, requestId), context.tasks().savePlan(input, false, requestId)]);
    assert.equal(results[0].id, results[1].id);
    assert.equal((await context.tasks().list()).plans.length, 1);
    assert.equal((await rows("audit_events", context.scope)).filter(row => row.action === "task_plan_created").length, 1);
    await assert.rejects(context.tasks().savePlan({ ...input, title: "Conflicting retry" }, false, requestId), error => error.status === 409 && error.code === "idempotency_conflict");
    await assert.rejects(context.tasks(secondAdmin).savePlan(input, false, requestId), status(409));
    const before = await savedPlan(context, results[0].id), editId = crypto.randomUUID(), edit = { ...before, title: "One reviewed title change", expectedVersion: before.version };
    const updated = await context.tasks().savePlan(edit, true, editId);
    assert.deepEqual(await context.tasks().savePlan(edit, true, editId), updated);
    assert.equal((await savedPlan(context, before.id)).version, before.version + 1);
    assert.equal((await rows("audit_events", context.scope)).filter(row => row.action === "task_plan_updated").length, 1);

    const early = await fixture("early-completion"), earlyPlan = await early.tasks().savePlan(activePlan({ recurrenceBasis: "completion", interval: 6, unit: "months", firstDueOn: "2026-07-31" }));
    await early.tasks().sync();
    const first = await openCycle(early, earlyPlan.id);
    const completed = await early.tasks(self).completeCycle({ cycleId: first.id, expectedVersion: first.version, notes: "Required review completed early; actual completion recorded." });
    assert.equal(completed.nextDueOn, "2026-07-31");
    await early.tasks().sync();
    const next = await openCycle(early, earlyPlan.id);
    assert.ok(next, "A new pending cycle was lost because its due date matches a completed cycle.");
    assert.notEqual(next.id, first.id);
    assert.equal(next.dueOn, first.dueOn);
    assert.equal((await rows("task_cycles", early.scope)).filter(row => row.status === "open").length, 1);
    assert.equal((await rows("task_cycles", early.scope)).filter(row => row.status === "completed").length, 1);
});

test("a model asset change during generation prevents a stale target snapshot and reports why no work was created", async () => {
    const context = await fixture("generation-race");
    await context.battery();
    const saved = await context.tasks().savePlan(activePlan({ category: "storage_maintenance", targetKind: "model", targetRef: "Confirmed Model One" }));
    const original = (await context.inventory().snapshot()).batteries.find(battery => battery.id === "BAT-ONE");
    const raced = beforeAtomicCommit(async () => { await context.inventory().saveBattery({ ...original, model: "Replacement Model", expectedVersion: original.version }, true); });
    await context.tasks(admin, raced).sync();
    assert.equal((await rows("task_cycles", context.scope)).length, 0);
    assert.equal((await rows("audit_events", context.scope)).filter(row => row.action === "task_cycle_created").length, 0);
    const latest = await context.tasks().list();
    assert.equal(latest.cycles.length, 0);
    assert.ok(latest.generationIssues.some(issue => issue.planId === saved.id && issue.message.includes("registered")));
    assert.equal(latest.plans[0].state, "active");
    assert.equal((await rows("task_messages", context.scope)).length, 0);
});

test("completion requires current authorization and reviewed cycle version; late calendar completion preserves evidence and explains skipped periods", async () => {
    const context = await fixture("completion");
    const plan = await context.tasks().savePlan(activePlan());
    await context.tasks().sync();
    const cycle = await openCycle(context, plan.id);
    await assert.rejects(context.tasks(other).completeCycle({ cycleId: cycle.id, expectedVersion: cycle.version, notes: "Unassigned completion attempt." }), status(403));
    await assert.rejects(context.tasks(self).completeCycle({ cycleId: cycle.id, expectedVersion: cycle.version + 1, notes: "Incorrect reviewed version." }), status(409));
    context.setTime("2026-05-02T02:00:00.000Z");
    const requestId = crypto.randomUUID(), input = { cycleId: cycle.id, expectedVersion: cycle.version, notes: "Area reviewed; no unresolved discrepancies. Local checklist retained." };
    const result = await context.tasks(self).completeCycle(input, requestId);
    assert.equal(result.status, "completed");
    assert.equal(result.nextDueOn, "2026-05-31");
    assert.equal(result.skippedPeriods, 3);
    const replay = await context.tasks(self).completeCycle(input, requestId);
    assert.equal(replay.id, result.id);
    assert.equal(replay.version, result.version);
    const history = (await context.tasks().list()).cycles.find(row => row.id === cycle.id);
    assert.equal(history.dueOn, "2026-01-31");
    assert.equal(history.completedAt, "2026-05-02T02:00:00.000Z");
    assert.equal(history.completedBy, self.id);
    assert.equal(history.completionNotes, input.notes);
    assert.equal(history.title, cycle.title);
    assert.equal((await rows("audit_events", context.scope)).filter(row => row.action === "task_cycle_completed").length, 1);
    assert.equal(messages(await context.tasks(self).messages())[0].taskStatus, "completed");
    await context.tasks().sync();
    assert.equal((await openCycle(context, plan.id)).dueOn, "2026-05-31");
    await updatePlan(context, plan.id, { reminderDaysBefore: 5 });
    const completedHistory = (await context.tasks().list()).cycles.find(row => row.id === cycle.id);
    assert.equal(completedHistory.reminderDaysBefore, 0);
    assert.equal(completedHistory.reminderOn, cycle.dueOn);
    assert.equal((await openCycle(context, plan.id)).reminderDaysBefore, 5);
});

test("completion accepts omitted or blank notes, stores no note and replays without duplicate evidence", async () => {
    for (const [name, notes] of [["omitted", undefined], ["empty", ""], ["whitespace", " \n\t "]]) {
        const context = await fixture(`completion-notes-${name}`);
        const plan = await context.tasks().savePlan(activePlan());
        await context.tasks().sync();
        const cycle = await openCycle(context, plan.id);
        const input = { cycleId: cycle.id, expectedVersion: cycle.version, ...(notes === undefined ? {} : { notes }) };
        const requestId = crypto.randomUUID();
        const result = await context.tasks(self).completeCycle(input, requestId);
        assert.equal(result.status, "completed");
        assert.deepEqual(await context.tasks(self).completeCycle(input, requestId), result);
        assert.deepEqual(await context.tasks(self).completeCycle({ ...input, notes: "" }, requestId), result);
        const history = (await context.tasks().list()).cycles.find(row => row.id === cycle.id);
        assert.equal(history.completionNotes, null);
        assert.equal(history.completedBy, self.id);
        assert.equal(history.completedAt, initialTime);
        const evidence = (await rows("audit_events", context.scope)).filter(row => row.action === "task_cycle_completed");
        assert.equal(evidence.length, 1);
        assert.equal(JSON.parse(evidence[0].details_json).completionNotes, null);
        assert.equal((await rows("operations", context.scope)).filter(row => row.kind === "task_cycle_completion").length, 1);
    }
});

test("optional completion notes retain trimming, short text and the 2000-character limit", async () => {
    const context = await fixture("completion-notes-length");
    const plan = await context.tasks().savePlan(activePlan());
    await context.tasks().sync();
    const cycle = await openCycle(context, plan.id);
    const input = { cycleId: cycle.id, expectedVersion: cycle.version };
    await assert.rejects(context.tasks(self).completeCycle({ ...input, notes: "x".repeat(2001) }), invalid);
    assert.equal((await openCycle(context, plan.id)).version, cycle.version);
    assert.equal((await rows("audit_events", context.scope)).filter(row => row.action === "task_cycle_completed").length, 0);
    await context.tasks(self).completeCycle({ ...input, notes: " x " });
    assert.equal((await context.tasks().list()).cycles.find(row => row.id === cycle.id).completionNotes, "x");
    await context.tasks().sync();
    const next = await openCycle(context, plan.id);
    await context.tasks(self).completeCycle({ cycleId: next.id, expectedVersion: next.version, notes: ` ${"x".repeat(2000)} ` });
    assert.equal((await context.tasks().list()).cycles.find(row => row.id === next.id).completionNotes.length, 2000);
});

test("optional-note migration preserves task evidence and requires completion identity, time, limits and immutable history", async () => {
    const isolated = new Miniflare({ modules: true, script: "export default {fetch(){return new Response('optional-notes-migration-test')}}", compatibilityDate: "2026-05-15", d1Databases: { DB: "optional-notes-migration-test" }, d1Persist: false });
    try {
        const database = await isolated.getD1Database("DB"), migration = journal.entries.find(entry => entry.tag === "0009_optional_task_completion_notes");
        await migrate(database, journal.entries.filter(entry => entry.idx < migration.idx));
        const [migrationAdmin, , migrationStaff] = await seedAccounts(database), scope = "optional-note-migration:demo";
        const inventory = new InventoryStore(database, scope, "demo", inventoryActor(migrationAdmin), () => new Date(initialTime));
        await inventory.initializeDemo();
        const tasks = new TaskPlanStore(database, scope, "demo", migrationAdmin, () => new Date(initialTime));
        const plan = await tasks.savePlan(activePlan({ assigneeIds: [migrationStaff.id] }));
        await tasks.sync();
        const first = (await tasks.list()).cycles.find(cycle => cycle.planId === plan.id && cycle.status === "open");
        await tasks.completeCycle({ cycleId: first.id, expectedVersion: first.version, notes: "Existing completion evidence." });
        await tasks.sync();
        const next = (await tasks.list()).cycles.find(cycle => cycle.planId === plan.id && cycle.status === "open");
        await assert.rejects(tasks.completeCycle({ cycleId: next.id, expectedVersion: next.version }), status(409));
        const tables = (await database.prepare("SELECT name,sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT GLOB '_cf_*' ORDER BY name").all()).results;
        const triggers = (await database.prepare("SELECT name,sql FROM sqlite_master WHERE type='trigger' ORDER BY name").all()).results;
        const before = new Map();
        for (const table of tables) before.set(table.name, (await database.prepare(`SELECT * FROM ${table.name} ORDER BY rowid`).all()).results);
        await migrate(database, [migration]);
        for (const table of tables) {
            assert.deepEqual((await database.prepare(`SELECT * FROM ${table.name} ORDER BY rowid`).all()).results, before.get(table.name), `${table.name} rows changed`);
            assert.equal(await database.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").bind(table.name).first("sql"), table.sql);
        }
        for (const trigger of triggers.filter(trigger => trigger.name !== "task_cycles_update_history"))
            assert.equal(await database.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name=?").bind(trigger.name).first("sql"), trigger.sql);
        const cycleKey = `${scope}/${next.id}`;
        for (const evidence of [[null, migrationAdmin.id, migrationAdmin.displayName], [initialTime, null, migrationAdmin.displayName], [initialTime, migrationAdmin.id, null]])
            await assert.rejects(database.prepare("UPDATE task_cycles SET status='completed',completed_at=?,completed_by=?,completed_by_name=?,completion_notes=NULL,version=version+1 WHERE key=?").bind(...evidence, cycleKey).run(), /CONSTRAINT|evidence required/);
        await assert.rejects(database.prepare("UPDATE task_cycles SET status='completed',completed_at=?,completed_by=?,completed_by_name=?,completion_notes=?,version=version+1 WHERE key=?").bind(initialTime, migrationAdmin.id, migrationAdmin.displayName, "x".repeat(2001), cycleKey).run(), /CONSTRAINT|maximum length/);
        await tasks.completeCycle({ cycleId: next.id, expectedVersion: next.version });
        const completed = (await tasks.list()).cycles.find(cycle => cycle.id === next.id);
        assert.equal(completed.status, "completed");
        assert.equal(completed.completionNotes, null);
        assert.equal(completed.completedBy, migrationAdmin.id);
        assert.equal(completed.completedAt, initialTime);
        await assert.rejects(database.prepare("UPDATE task_cycles SET completion_notes='Later replacement',version=version+1 WHERE key=?").bind(cycleKey).run(), /CONSTRAINT|immutable/);
        assert.equal((await tasks.list()).cycles.find(cycle => cycle.id === first.id).completionNotes, "Existing completion evidence.");
        assert.deepEqual((await database.prepare("PRAGMA foreign_key_check").all()).results, []);
    } finally { await isolated.dispose(); }
});

test("schedule and reminder edits retain open-cycle deadlines, original content and target snapshots", async () => {
    const context = await fixture("open-snapshot");
    const plan = await context.tasks().savePlan(activePlan());
    await context.tasks().sync();
    const original = await openCycle(context, plan.id), originalMessage = messages(await context.tasks(self).messages())[0];
    await updatePlan(context, plan.id, { title: "Future procedure title", description: "Different future work description.", firstDueOn: "2026-06-30", interval: 6, reminderDaysBefore: 2, reminderTime: "10:30", targetRef: "J18-DEMO-WORKSPACE" });
    const edited = await openCycle(context, plan.id);
    assert.equal(edited.id, original.id);
    assert.equal(edited.dueOn, original.dueOn);
    assert.equal(edited.title, original.title);
    assert.equal(edited.description, original.description);
    assert.deepEqual(edited.targetSnapshot, original.targetSnapshot);
    assert.equal(edited.planVersion, original.planVersion);
    assert.equal(edited.reminderOn, "2026-01-29");
    assert.equal(edited.reminderTime, "10:30");
    assert.equal(edited.version, original.version + 1);
    await context.tasks().sync();
    const history = messages(await context.tasks(self).messages());
    assert.equal(history.length, 1);
    assert.equal(history[0].id, originalMessage.id);
    assert.equal(history[0].title, originalMessage.title);
    assert.equal(history[0].body, originalMessage.body);
    assert.equal(history[0].reminderOn, originalMessage.reminderOn);
    assert.equal(history[0].reminderTime, originalMessage.reminderTime);
    assert.equal(history[0].reminderAtUtc, originalMessage.reminderAtUtc);
    assert.equal(history[0].reminderOn, "2026-01-31");
    assert.equal(history[0].reminderTime, "09:00");
    assert.equal(history[0].cycle.reminderOn, edited.reminderOn);
    assert.equal(history[0].cycle.reminderTime, edited.reminderTime);
    assert.equal(history[0].cycle.reminderAtUtc, edited.reminderAtUtc);
    assert.notEqual(history[0].reminderOn, history[0].cycle.reminderOn);
    assert.notEqual(history[0].reminderTime, history[0].cycle.reminderTime);
    assert.notEqual(history[0].reminderAtUtc, history[0].cycle.reminderAtUtc);
    await assert.rejects(context.tasks(self).completeCycle({ cycleId: original.id, expectedVersion: original.version, notes: "Completion from outdated review." }), status(409));
});

test("reassignment routes one message to the new account while preserving the previous recipient's read history", async () => {
    const context = await fixture("reassignment");
    const plan = await context.tasks().savePlan(activePlan());
    await context.tasks().sync();
    const previousMessage = messages(await context.tasks(self).messages())[0];
    await context.tasks(self).markRead({ id: previousMessage.id });
    const readAt = messages(await context.tasks(self).messages())[0].readAt;
    await updatePlan(context, plan.id, { assigneeIds: [other.id] });
    await context.tasks().sync();
    const mine = messages(await context.tasks(self).messages()), theirs = messages(await context.tasks(other).messages());
    assert.equal(mine.length, 1);
    assert.equal(mine[0].id, previousMessage.id);
    assert.equal(mine[0].readAt, readAt);
    assert.equal(mine[0].cycle.canComplete, false);
    assert.equal(theirs.length, 1);
    assert.equal(theirs[0].recipientId, other.id);
    assert.equal(theirs[0].cycleId, previousMessage.cycleId);
    assert.equal(theirs[0].cycle.canComplete, true);
    await assert.rejects(context.tasks(self).completeCycle({ cycleId: theirs[0].cycleId, expectedVersion: theirs[0].cycleVersion, notes: "Completion after responsibility changed." }), status(403));
    await context.tasks().sync();
    assert.equal((await rows("task_messages", context.scope)).length, 2);
});

test("draft and paused plans do not remind, and disabled assignees receive no new message", async () => {
    const context = await fixture("inactive");
    await context.tasks().savePlan(activePlan({ title: "Draft review", state: "draft" }));
    await context.tasks().savePlan(activePlan({ title: "Paused review", state: "paused" }));
    const active = await context.tasks().savePlan(activePlan({ firstDueOn: "2026-02-10" }));
    await context.tasks().sync();
    assert.equal((await rows("task_messages", context.scope)).length, 0);
    try {
        await db.prepare("UPDATE staff_accounts SET active=0,auth_version=auth_version+1,version=version+1 WHERE id=?").bind(self.id).run();
        context.setTime("2026-02-10T00:00:00.000Z");
        const generationIssues = await context.tasks().sync();
        assert.equal((await rows("task_messages", context.scope)).length, 0);
        assert.ok(generationIssues.some(issue => issue.planId === active.id && /inactive|disabled/i.test(issue.message)));
    } finally { await db.prepare("UPDATE staff_accounts SET active=1,auth_version=1,version=version+1 WHERE id=?").bind(self.id).run(); }
    await context.tasks().sync();
    assert.equal((await rows("task_messages", context.scope)).length, 1);
    assert.equal((await rows("task_messages", context.scope))[0].recipient_id, self.id);
    assert.equal((await openCycle(context, active.id)).dueOn, "2026-02-10");
});

test("assignment changes during completion commit reject the stale operator without completing any cycle", async () => {
    const context = await fixture("completion-commit");
    const plan = await context.tasks().savePlan(activePlan());
    await context.tasks().sync();
    const original = await openCycle(context, plan.id);
    const raced = beforeAtomicCommit(async () => { await updatePlan(context, plan.id, { assigneeIds: [other.id] }); });
    await assert.rejects(context.tasks(self, raced).completeCycle({ cycleId: original.id, expectedVersion: original.version, notes: "Reviewed before reassignment." }), status(409));
    const after = await openCycle(context, plan.id);
    assert.equal(after.status, "open");
    assert.equal(after.completedAt, null);
    assert.deepEqual(after.currentAssigneeIds, [other.id]);
    assert.equal((await rows("audit_events", context.scope)).filter(row => row.action === "task_cycle_completed").length, 0);
});

test("database guards preserve task identity, immutable evidence and one open cycle against replacement and upsert shortcuts", async () => {
    const context = await fixture("sql-guards");
    const plan = await context.tasks().savePlan(activePlan());
    await context.tasks().sync();
    const [storedPlan] = await rows("task_plans", context.scope), [cycle] = await rows("task_cycles", context.scope), [message] = await rows("task_messages", context.scope);
    await assert.rejects(db.prepare("UPDATE task_plans SET id=? WHERE key=?").bind(crypto.randomUUID(), storedPlan.key).run(), /CONSTRAINT|immutable|identity/);
    await assert.rejects(db.prepare("UPDATE task_cycles SET due_on='2026-12-31',version=version+1 WHERE key=?").bind(cycle.key).run(), /CONSTRAINT|immutable|evidence/);
    await assert.rejects(db.prepare("UPDATE task_cycles SET snapshot_json='{}',version=version+1 WHERE key=?").bind(cycle.key).run(), /CONSTRAINT|immutable|evidence/);
    await assert.rejects(db.prepare("UPDATE task_messages SET body='Rewritten evidence' WHERE key=?").bind(message.key).run(), /CONSTRAINT|immutable|evidence/);
    await assert.rejects(db.prepare("UPDATE task_messages SET reminder_on='2026-12-31' WHERE key=?").bind(message.key).run(), /CONSTRAINT|immutable|evidence/);
    await assert.rejects(db.prepare("UPDATE task_messages SET reminder_time='23:59' WHERE key=?").bind(message.key).run(), /CONSTRAINT|immutable|evidence/);
    await assert.rejects(db.prepare("UPDATE task_messages SET reminder_at_utc='2026-12-31T12:59:00.000Z' WHERE key=?").bind(message.key).run(), /CONSTRAINT|immutable|evidence/);
    await assert.rejects(db.prepare("DELETE FROM task_messages WHERE key=?").bind(message.key).run(), /CONSTRAINT|immutable|history/);
    for (const [table, record] of [["task_plans", storedPlan], ["task_cycles", cycle], ["task_messages", message]]) {
        const columns = Object.keys(record), placeholders = columns.map(() => "?").join(","), values = Object.values(record);
        await assert.rejects(db.prepare(`INSERT OR REPLACE INTO ${table}(${columns.join(",")}) VALUES(${placeholders})`).bind(...values).run(), /CONSTRAINT|UNIQUE/);
        await assert.rejects(db.prepare(`INSERT INTO ${table}(${columns.join(",")}) VALUES(${placeholders}) ON CONFLICT(key) DO UPDATE SET key=excluded.key`).bind(...values).run(), /CONSTRAINT|UNIQUE/);
    }
    const duplicate = { ...cycle, key: `${context.scope}/${crypto.randomUUID()}`, id: crypto.randomUUID(), due_on: "2026-02-28" };
    await assert.rejects(db.prepare(`INSERT INTO task_cycles(${Object.keys(duplicate).join(",")}) VALUES(${Object.keys(duplicate).map(() => "?").join(",")})`).bind(...Object.values(duplicate)).run(), /CONSTRAINT|UNIQUE/);
    assert.equal((await openCycle(context, plan.id)).dueOn, "2026-01-31");
    assert.deepEqual((await db.prepare("PRAGMA foreign_key_check").all()).results, []);
});

test("the additive task migration preserves all prior tables, stored rows and existing integrity triggers", async () => {
    const isolated = new Miniflare({ modules: true, script: "export default {fetch(){return new Response('task-migration-test')}}", compatibilityDate: "2026-05-15", d1Databases: { DB: "task-migration-test" }, d1Persist: false });
    try {
        const database = await isolated.getD1Database("DB"), migration = journal.entries.find(entry => entry.tag === "0008_periodic_tasks_messages");
        await migrate(database, journal.entries.filter(entry => entry.idx < migration.idx));
        const [migrationAdmin] = await seedAccounts(database);
        const inventory = new InventoryStore(database, "prior-tables:demo", "demo", inventoryActor(migrationAdmin), () => new Date(initialTime));
        await inventory.initializeDemo();
        // Seed evidence against this historical schema, before later lifecycle columns exist.
        const borrowerKey = await database.prepare("SELECT key FROM people WHERE scope=? AND account_id=?").bind("prior-tables:demo", migrationAdmin.id).first("key");
        await database.batch([
            database.prepare("INSERT INTO loans(id,scope,battery_key,borrower_key,borrower_name,borrower_account_id,checked_out_at,returned_at,checkout_actor_id,checkout_actor_name,return_actor_id,return_actor_name) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)").bind("prior-migration-loan", "prior-tables:demo", "prior-tables:demo/BAT-001", borrowerKey, migrationAdmin.displayName, migrationAdmin.id, initialTime, initialTime, migrationAdmin.id, migrationAdmin.displayName, migrationAdmin.id, migrationAdmin.displayName),
            database.prepare("INSERT INTO observations(id,scope,battery_key,room_key,observed_at,received_at,source,room_name,room_building) SELECT ?,?,?,r.key,?,?,?,CASE WHEN r.is_placeholder=1 THEN r.name || ' — Placeholder' WHEN r.number IS NULL THEN r.name ELSE r.number || ' - ' || r.name END,COALESCE(b.id || ' - ' || b.name,r.building) FROM rooms r LEFT JOIN buildings b ON b.key=r.building_key WHERE r.key=?").bind("prior-migration-observation", "prior-tables:demo", "prior-tables:demo/BAT-001", initialTime, initialTime, "Migration fixture", "prior-tables:demo/J18-DEMO-ROOM"),
        ]);
        await database.prepare("INSERT INTO shared_inventories(dataset,scope) VALUES('demo','prior-tables:demo')").run();
        await database.prepare("INSERT INTO staff_sessions(token_hash,account_id,auth_version,created_at,expires_at) VALUES('isolated-test-session-hash',?,1,?,?)").bind(migrationAdmin.id, initialTime, "2026-02-01T00:00:00.000Z").run();
        await database.prepare("INSERT INTO sign_in_attempts(key,failures,window_started_at) VALUES('isolated-test-attempt',1,?)").bind(initialTime).run();
        const tables = (await database.prepare("SELECT name,sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT GLOB '_cf_*' ORDER BY name").all()).results;
        const triggers = (await database.prepare("SELECT name,sql FROM sqlite_master WHERE type='trigger' ORDER BY name").all()).results;
        const before = new Map();
        for (const table of tables) before.set(table.name, (await database.prepare(`SELECT * FROM ${table.name} ORDER BY rowid`).all()).results);
        await migrate(database, [migration]);
        for (const table of tables) {
            assert.deepEqual((await database.prepare(`SELECT * FROM ${table.name} ORDER BY rowid`).all()).results, before.get(table.name), `${table.name} rows changed`);
            assert.equal(await database.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").bind(table.name).first("sql"), table.sql);
        }
        for (const trigger of triggers) assert.equal(await database.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name=?").bind(trigger.name).first("sql"), trigger.sql);
        assert.ok(tables.length >= 15);
        assert.deepEqual((await database.prepare("PRAGMA foreign_key_check").all()).results, []);
    } finally { await isolated.dispose(); }
});

test("inbox task status and read state combine independently within the authenticated recipient's complete history", async () => {
    const context = await fixture("independent-message-filters"), own = context.tasks(self);
    const completedPlan = await context.tasks().savePlan(activePlan({ title: "Completed review remains unread", assigneeIds: [self.id, other.id] }));
    const readPlan = await context.tasks().savePlan(activePlan({ title: "Read review remains outstanding", assigneeIds: [self.id, other.id] }));
    const unreadPlan = await context.tasks().savePlan(activePlan({ title: "Unread outstanding review", assigneeIds: [self.id, other.id] }));
    const initial = messages(await own.messages());
    const completedMessage = initial.find(message => message.planId === completedPlan.id), readMessage = initial.find(message => message.planId === readPlan.id), unreadMessage = initial.find(message => message.planId === unreadPlan.id);
    await own.completeCycle({ cycleId: completedMessage.cycleId, expectedVersion: completedMessage.cycleVersion, notes: "Review completed with the confirmed local checklist." });
    await own.markRead({ id: readMessage.id });

    const cases = [
        [{}, [completedMessage.id, readMessage.id, unreadMessage.id]],
        [{ readState: "unread" }, [completedMessage.id, unreadMessage.id]],
        [{ readState: "read" }, [readMessage.id]],
        [{ taskStatus: "completed" }, [completedMessage.id]],
        [{ taskStatus: "open" }, [readMessage.id, unreadMessage.id]],
        [{ taskStatus: "completed", readState: "unread" }, [completedMessage.id]],
        [{ taskStatus: "open", readState: "read" }, [readMessage.id]],
        [{ taskStatus: "open", readState: "unread" }, [unreadMessage.id]],
        [{ taskStatus: "completed", readState: "read" }, []],
        [{ taskStatus: "open", readState: "read", search: "Storage area review" }, [readMessage.id]],
        [{ taskStatus: "open", readState: "unread", search: "No matching text" }, []],
        [{ allUnread: true }, [completedMessage.id, unreadMessage.id]],
        [{ allUnread: true, readState: "read" }, [readMessage.id]],
    ];
    for (const [filter, expected] of cases) {
        const result = await own.messages(filter);
        assert.deepEqual(result.messages.map(message => message.id).sort(), expected.sort(), JSON.stringify(filter));
        assert.equal(result.unreadCount, 2, "The global own unread count must not inherit task or search filters.");
        assert.ok(result.messages.every(message => message.recipientId === self.id));
    }
    const otherRead = await context.tasks(other).messages({ taskStatus: "open", readState: "read" });
    assert.deepEqual(otherRead.messages, []);
    assert.equal(otherRead.unreadCount, 3);
    const otherCompleted = await context.tasks(other).messages({ taskStatus: "completed", readState: "unread" });
    assert.equal(otherCompleted.messages.length, 1);
    assert.notEqual(otherCompleted.messages[0].id, completedMessage.id);
    assert.equal(otherCompleted.messages[0].recipientId, other.id);
    await assert.rejects(context.tasks(other).markRead({ id: completedMessage.id }), status(404));
    await assert.rejects(own.messages({ readState: "invalid" }), invalid);
    await assert.rejects(own.messages({ taskStatus: "invalid" }), invalid);
});
