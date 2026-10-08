import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Miniflare } from "miniflare";
import { InventoryStore } from "../work/qa/store.mjs";
import { TeachingGroupStore } from "../work/qa/teaching-group-store.mjs";
import { TaskPlanStore } from "../work/qa/task-plans.mjs";
import { IntakeStore } from "../work/qa/intake-store.mjs";
import { BatteryModelStore } from "../work/qa/battery-model-store.mjs";
import { groupActivity } from "../work/qa/group-activity.mjs";

const mf = new Miniflare({ modules: true, script: "export default {fetch(){return new Response('retired-reference-audit')}}", compatibilityDate: "2026-05-15", d1Databases: { DB: "retired-reference-audit" }, d1Persist: false });
const db = await mf.getD1Database("DB");
for (const entry of JSON.parse(await readFile("drizzle/meta/_journal.json", "utf8")).entries) {
    const sql = await readFile(`drizzle/${entry.tag}.sql`, "utf8");
    await db.batch(sql.split("--> statement-breakpoint").filter(statement => statement.trim()).map(statement => db.prepare(statement)));
}
after(() => mf.dispose());

const at = "2026-10-08T05:00:00.000Z";
const admin = { id: crypto.randomUUID(), displayName: "Reference Audit Administrator", role: "admin", authVersion: 1 };
const staff = { id: crypto.randomUUID(), displayName: "Reference Audit Staff", role: "staff", authVersion: 1 };
for (const [index, actor] of [admin, staff].entries()) await db.prepare("INSERT INTO staff_accounts(id,username,display_name,role,password_hash,password_salt,hash_iterations,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)")
    .bind(actor.id, `retired-reference-actor-${index}`, actor.displayName, actor.role, "test-only-no-login", "test-only-no-login", 600000, at, at).run();
const inventoryActor = actor => ({ id: actor.id, name: actor.displayName, role: actor.role, authVersion: actor.authVersion });
const rows = async (table, scope) => (await db.prepare(`SELECT * FROM ${table} WHERE scope=? ORDER BY rowid`).bind(scope).all()).results;
const domainRejection = error => Number.isInteger(error.status) && error.status >= 400 && error.status < 500;
const modelFields = model => Object.fromEntries(["name", "model", "chemistry", "capacityMah", "voltage"].map(key => [key, model[key]]));
const modelSelection = model => ({ origin: model.origin, id: model.id, contentHash: model.contentHash, confirmed: true, appliedFields: ["name", "model", "chemistry", "capacityMah", "voltage"] });

async function fixture(name, count = 2) {
    const scope = `retired-reference-${name}:demo`, dataset = "demo", clock = () => new Date(at);
    const inventory = (actor = admin, database = db) => new InventoryStore(database, scope, dataset, inventoryActor(actor), clock);
    await inventory().snapshot();
    const common = { name: "Independent incoming battery", model: "REFERENCE-2200", chemistry: "LiPo", capacityMah: 2200, voltage: 7.4, ownerId: `staff-${staff.id}`, homeBuildingId: "J18", homeRoomId: null, manufacturedOn: null, firstUsedOn: null };
    const ids = ["BAT-ERASED", "BAT-RETAINED"].slice(0, count);
    for (const [index, id] of ids.entries()) await inventory().saveBattery({ ...common, id, name: index ? "Retained individual battery" : "Erased individual identity", model: index ? "RETAINED-MODEL" : "ERASED-MODEL", tagId: index ? "REFERENCE-RETAINED-TAG" : "REFERENCE-ERASED-TAG" });
    return {
        scope, dataset, ids, common, inventory,
        groups: (actor = admin) => new TeachingGroupStore(db, scope, dataset, inventoryActor(actor), clock),
        tasks: (actor = admin) => new TaskPlanStore(db, scope, dataset, actor, clock),
        intake: (actor = staff, database = db) => new IntakeStore(database, scope, dataset, actor, clock),
        models: () => new BatteryModelStore(db, scope, dataset, staff, clock),
    };
}
async function bindings(context, ids = context.ids) {
    const snapshot = await context.inventory().snapshot();
    return ids.map(id => {
        const battery = snapshot.batteries.find(item => item.id === id);
        assert.ok(battery, `Fixture battery ${id} must exist before reviewing its version.`);
        return { batteryId: id, version: battery.version, tagId: battery.tagId };
    });
}
async function scrap(context, ids = [context.ids[0]]) {
    return context.inventory(staff).lifecycle({ requestId: crypto.randomUUID(), kind: "scrapped", reason: "", destination: null, source: "manual_selection", items: await bindings(context, ids) });
}
async function purge(context, ids = [context.ids[0]]) {
    await scrap(context, ids);
    return context.inventory().retiredAsset({ requestId: crypto.randomUUID(), kind: "purge", items: await bindings(context, ids) });
}
const intakeInput = (context, extra = {}) => ({ requestId: crypto.randomUUID(), sessionId: crypto.randomUUID(), tagId: `DEMO-INTAKE-${crypto.randomUUID()}`, common: { ...context.common }, firstUseMode: "at_registration", ...extra });
const groupPlan = (ids, extra = {}) => ({
    category: "custom", title: "Independent preparation task", description: "Staff instruction mentioning BAT-ERASED remains independent task text.",
    basis: "Staff-defined local procedure.", scopeNote: "Independent task scope.", targetKind: "group", targetRef: "Independent named set", batteryIds: ids,
    assigneeIds: [staff.id], firstDueOn: "2026-10-08", recurrenceBasis: "calendar", interval: 1, unit: "months", scheduledDates: [],
    reminderDaysBefore: 0, reminderTime: "09:00", channels: ["messages"], state: "active", applicabilityConfirmed: true, ...extra,
});

test("purging a member keeps independent private groups and Task definitions while redacting saved asset snapshots", async () => {
    const context = await fixture("task-and-groups"), notes = "Private class note mentioning BAT-ERASED remains independent group text.";
    const groupRequest = { action: "create", id: crypto.randomUUID(), requestId: crypto.randomUUID(), name: "Independent named set", notes, batteryIds: context.ids };
    const privateGroup = (await context.groups(staff).save(groupRequest)).group;
    const requestedPlan = groupPlan([context.ids[0]]), requestId = crypto.randomUUID();
    const created = await context.tasks().savePlan(requestedPlan, false, requestId);
    const mixedCreated = await context.tasks().savePlan(groupPlan(context.ids, { title: "Mixed independent equipment task", targetRef: "A separate explicit mixed set" }), false, crypto.randomUUID());
    const before = await context.tasks(staff).list(), originalCycle = before.cycles.find(cycle => cycle.planId === created.id);
    assert.equal(originalCycle.targetSnapshot.batteries[0].name, "Erased individual identity");
    assert.deepEqual(before.plans.find(plan => plan.id === created.id).batteryIds, [context.ids[0]]);
    assert.deepEqual(privateGroup.batteryIds, context.ids, "A same-named private Teaching group must retain its own independent membership.");

    await purge(context);
    assert.deepEqual((await context.inventory().snapshot()).batteries.map(battery => battery.id), [context.ids[1]]);
    const retainedGroup = (await context.groups(staff).list()).find(group => group.id === privateGroup.id);
    assert.deepEqual(retainedGroup.batteryIds, context.ids);
    assert.equal(retainedGroup.notes, notes);
    assert.deepEqual(await context.groups(admin).list(), [], "Administrators must not acquire another staff account's private definition.");
    const after = await context.tasks(staff).list(), retainedPlan = after.plans.find(plan => plan.id === created.id), retainedCycle = after.cycles.find(cycle => cycle.id === originalCycle.id);
    assert.deepEqual(retainedPlan.batteryIds, [context.ids[0]], "The saved Task definition must retain a minimal missing-ID reference.");
    assert.equal(retainedPlan.description, requestedPlan.description);
    assert.equal(retainedCycle.description, requestedPlan.description);
    assert.equal(retainedCycle.dueOn, originalCycle.dueOn);
    assert.deepEqual(retainedCycle.targetSnapshot.batteries, [{ id: context.ids[0], deleted: true }]);
    const completionNotes = "Independent completion note mentioning BAT-ERASED must remain.";
    await context.tasks(staff).completeCycle({ cycleId: retainedCycle.id, expectedVersion: retainedCycle.version, notes: completionNotes }, crypto.randomUUID());
    const completed = (await context.tasks(staff).list()).cycles.find(cycle => cycle.id === originalCycle.id);
    assert.equal(completed.status, "completed");
    assert.equal(completed.completionNotes, completionNotes);
    assert.deepEqual(completed.targetSnapshot.batteries, [{ id: context.ids[0], deleted: true }]);
    const mixedCycle = (await context.tasks(staff).list()).cycles.find(cycle => cycle.planId === mixedCreated.id);
    assert.deepEqual(mixedCycle.batteryIds, context.ids);
    assert.deepEqual(mixedCycle.targetSnapshot.batteries, [{ id: context.ids[0], deleted: true }, { id: context.ids[1], name: "Retained individual battery", model: "RETAINED-MODEL" }]);
    await assert.rejects(context.tasks().savePlan(requestedPlan, false, requestId), domainRejection);
    const updated = await context.groups(staff).save({ action: "update", id: retainedGroup.id, requestId: crypto.randomUUID(), expectedVersion: retainedGroup.version, name: "Renamed independent set", notes, batteryIds: retainedGroup.batteryIds });
    assert.deepEqual(updated.group.batteryIds, context.ids);
    await context.groups(staff).save({ action: "remove", id: updated.group.id, requestId: crypto.randomUUID(), expectedVersion: updated.group.version });
    assert.deepEqual(await context.groups(staff).list(), []);
    assert.equal((await rows("task_plans", context.scope)).length, 2);
    assert.deepEqual((await db.prepare("PRAGMA foreign_key_check").all()).results, []);
});

test("mixed asset movement and group charge history retain the other asset and reserve old exact requests", async () => {
    const context = await fixture("mixed-history");
    const privateGroup = (await context.groups().save({ action: "create", id: crypto.randomUUID(), requestId: crypto.randomUUID(), name: "Mixed equipment set", notes: "Independent class notes", batteryIds: context.ids })).group;
    const teachingGroup = { id: privateGroup.id, version: privateGroup.version };
    const checkout = { requestId: crypto.randomUUID(), kind: "checkout", batteryIds: context.ids };
    await context.inventory(staff).movement(checkout);
    const snapshot = await context.inventory(staff).snapshot();
    const returned = { requestId: crypto.randomUUID(), kind: "return", batteryIds: context.ids, expectedLoans: snapshot.batteries.map(battery => ({ batteryId: battery.id, loanId: battery.loanId })) };
    await context.inventory(staff).movement(returned);
    const charged = { requestId: crypto.randomUUID(), teachingGroup, kind: "charge", items: await bindings(context), completedAt: at, durationMinutes: 45 };
    await context.inventory().groupMaintenance(charged);
    const before = await context.inventory().detail(context.ids[1]);
    await purge(context);
    const after = await context.inventory().detail(context.ids[1]);
    assert.deepEqual(after.battery, before.battery);
    assert.deepEqual(after.loans, before.loans);
    assert.deepEqual(after.charges, before.charges);
    assert.deepEqual(after.observations, before.observations);
    assert.deepEqual(after.events, before.events, "The other asset's attributed historical evidence must remain intact.");
    for (const table of ["loans", "charges", "observations", "audit_events"]) assert.ok((await rows(table, context.scope)).every(row => row.battery_id !== context.ids[0] && row.battery_key !== `${context.scope}/${context.ids[0]}`));
    const activity = groupActivity(await context.inventory().fullActivity()).find(entry => entry.teachingGroup?.id === privateGroup.id && entry.action === "charge_recorded");
    assert.ok(activity);
    assert.deepEqual(activity.members.map(event => event.batteryId), [context.ids[1]]);
    const operations = await rows("operations", context.scope);
    for (const payload of [checkout, returned, charged]) {
        const operation = operations.find(row => row.id === `${context.scope}/${payload.requestId}`);
        assert.ok(operation, "An old request key must remain reserved after associated asset data is cleared.");
        assert.ok(!operation.fingerprint.includes("Erased individual identity") && !operation.fingerprint.includes("REFERENCE-ERASED-TAG"));
        const call = payload.kind === "charge" ? context.inventory().groupMaintenance(payload) : context.inventory(staff).movement(payload);
        await assert.rejects(call, domainRejection);
    }
    assert.deepEqual(await context.inventory().detail(context.ids[1]), after);
    assert.deepEqual((await context.inventory().snapshot()).batteries.map(battery => battery.id), [context.ids[1]]);
});

test("a purged automatic identity cannot be replayed, manually recreated or reused by the next intake", async () => {
    const context = await fixture("automatic-identity", 0), original = intakeInput(context);
    const first = await context.intake().register(original);
    assert.equal(first.batteryId, "BAT-00000001");
    await purge(context, [first.batteryId]);
    const tombstones = await rows("purged_batteries", context.scope);
    assert.equal(tombstones.length, 1);
    assert.equal(tombstones[0].id, first.batteryId);
    await assert.rejects(context.intake().register(original), domainRejection);
    assert.equal((await rows("batteries", context.scope)).length, 0);
    await assert.rejects(context.inventory().saveBattery({ ...context.common, id: first.batteryId, tagId: "EXPLICIT-RECREATION-TAG" }), domainRejection);
    await assert.rejects(db.prepare("INSERT INTO batteries(key,scope,id,name,owner_key,home_building_key,created_at) VALUES(?,?,?,?,?,?,?)").bind(`${context.scope}/${first.batteryId}`, context.scope, first.batteryId, "Direct ID recreation attempt", `${context.scope}/staff-${staff.id}`, `${context.scope}/J18`, at).run());
    const next = await context.intake().register(intakeInput(context));
    assert.equal(next.batteryId, "BAT-00000002");
    assert.equal((await rows("intake_counters", context.scope))[0].last_number, 2);
    assert.deepEqual((await context.inventory().snapshot()).batteries.map(battery => battery.id), [next.batteryId]);
    assert.equal((await rows("purged_batteries", context.scope)).length, 1);
});

test("purging an inventory-model source clears its frozen associated binding without deleting the dependent asset's own specifications", async () => {
    const context = await fixture("model-source", 0), sourceId = "BAT-MODEL-SOURCE";
    await context.inventory().saveBattery({ ...context.common, id: sourceId, name: "Erased model source identity", tagId: "ERASED-MODEL-SOURCE-TAG" });
    const model = (await context.models().list()).models.find(choice => choice.origin === "inventory");
    assert.ok(model);
    const common = { ...context.common, ...modelFields(model), modelSelection: modelSelection(model) };
    const original = intakeInput(context, { common }), registered = await context.intake().register(original);
    const before = await context.inventory().detail(registered.batteryId);
    assert.deepEqual(before.events.find(event => event.action === "battery_registered").details.modelReference.sourceBindings.map(binding => binding.id), [sourceId]);
    await purge(context, [sourceId]);
    const after = await context.inventory().detail(registered.batteryId);
    assert.deepEqual(after.battery, before.battery);
    assert.deepEqual(after.loans, before.loans);
    assert.deepEqual(after.charges, before.charges);
    const registration = after.events.find(event => event.action === "battery_registered");
    assert.ok(registration, "The independently registered dependent asset must retain its attributable registration event.");
    assert.deepEqual(registration.details.modelReference.sourceBindings, [{ id: sourceId, deleted: true }]);
    const session = (await rows("intake_sessions", context.scope)).find(row => row.id === original.sessionId);
    assert.ok(session);
    assert.deepEqual(JSON.parse(session.context_json).modelReference.sourceBindings, [{ id: sourceId, deleted: true }]);
    const replay = await context.intake().register(original);
    assert.equal(replay.batteryId, registered.batteryId, "Replaying the retained asset's own safe receipt must not recreate the purged source.");
    await assert.rejects(context.intake().register(intakeInput(context, { sessionId: original.sessionId, common })), domainRejection);
    assert.equal((await rows("batteries", context.scope)).length, 1);
    assert.equal((await rows("intake_counters", context.scope))[0].last_number, 1);
    assert.equal((await context.inventory().detail(registered.batteryId)).battery.capacityMah, 2200);
    assert.equal((await context.inventory().detail(registered.batteryId)).battery.voltage, 7.4);
    assert.deepEqual(JSON.parse((await rows("intake_sessions", context.scope)).find(row => row.id === original.sessionId).context_json).modelReference.sourceBindings, [{ id: sourceId, deleted: true }]);
});

test("a battery ID equal to a room ID must not redact independent directory or storage-task evidence", async () => {
    const context = await fixture("entity-namespace", 0), roomId = "J18-DEMO-ROOM";
    await context.inventory().saveBattery({ ...context.common, id: roomId, name: "Battery with an independent entity ID collision" });
    const plan = groupPlan([], { title: "Independent storage-area procedure", targetKind: "storage_area", targetRef: roomId });
    const requestId = crypto.randomUUID(), created = await context.tasks().savePlan(plan, false, requestId);
    const before = (await context.tasks().list()).cycles.find(cycle => cycle.planId === created.id);
    assert.equal(before.targetSnapshot.room.id, roomId);
    assert.ok(before.targetSnapshot.room.name);
    const roomBefore = (await context.inventory().snapshot()).rooms.find(room => room.id === roomId);
    await purge(context, [roomId]);
    const after = (await context.tasks().list()).cycles.find(cycle => cycle.id === before.id);
    assert.deepEqual(after.targetSnapshot, before.targetSnapshot, "Room IDs live in a separate entity namespace from battery IDs.");
    assert.deepEqual((await context.inventory().snapshot()).rooms.find(room => room.id === roomId), roomBefore);
    assert.deepEqual(await context.tasks().savePlan(plan, false, requestId), created, "A room-only Task request must not become a purged-battery reservation.");
    assert.equal((await rows("task_plans", context.scope)).length, 1);
    const planAudit = (await rows("audit_events", context.scope)).find(event => event.action === "task_plan_created");
    assert.equal(JSON.parse(planAudit.details_json).after.targetRef, roomId);
});

test("battery IDs equal to saved model and Task IDs must not redact those entities or their own exact receipts", async () => {
    const context = await fixture("model-task-namespaces", 0);
    const modelInput = { id: crypto.randomUUID(), brand: "Independent template brand", model: "INDEPENDENT-MODEL", variant: "Reviewed variant", name: "Independent reusable model", chemistry: "LiPo", capacityMah: 3300, voltage: 11.1, notes: "Independent staff-entered model note." };
    const modelCreated = await context.models().create(modelInput);
    const plan = groupPlan([], { title: "Independent inventory-wide task", targetKind: "inventory", targetRef: null });
    const taskRequestId = crypto.randomUUID(), taskCreated = await context.tasks().savePlan(plan, false, taskRequestId);
    const cycleBefore = (await context.tasks().list()).cycles.find(cycle => cycle.planId === taskCreated.id);
    const eventsBefore = (await rows("audit_events", context.scope)).filter(event => ["battery_model_registered", "task_plan_created"].includes(event.action));
    for (const id of [modelCreated.model.id, taskCreated.id]) await context.inventory().saveBattery({ ...context.common, id, name: "Physical battery with a distinct entity namespace" });
    await purge(context, [modelCreated.model.id, taskCreated.id]);
    assert.deepEqual((await context.models().list()).models.find(model => model.origin === "saved"), modelCreated.model);
    assert.deepEqual(await context.models().create(modelInput), { ...modelCreated, replayed: true });
    assert.deepEqual(await context.tasks().savePlan(plan, false, taskRequestId), taskCreated);
    assert.deepEqual((await context.tasks().list()).cycles.find(cycle => cycle.id === cycleBefore.id), cycleBefore);
    assert.deepEqual((await rows("audit_events", context.scope)).filter(event => ["battery_model_registered", "task_plan_created"].includes(event.action)), eventsBefore);
    assert.equal((await rows("batteries", context.scope)).length, 0);
    assert.equal((await rows("purged_batteries", context.scope)).length, 2);
});

test("existing Task metadata edits retain only their own deleted targets and never grant new deleted membership", async () => {
    const context = await fixture("task-deleted-member-edit");
    const original = await context.tasks().savePlan(groupPlan([context.ids[0]]), false, crypto.randomUUID());
    const separate = await context.tasks().savePlan(groupPlan([context.ids[1]], { title: "Separate target selection", targetRef: "Separate named set" }), false, crypto.randomUUID());
    const before = await context.tasks().list(), originalCycle = before.cycles.find(cycle => cycle.planId === original.id);
    await purge(context);
    let listed = await context.tasks().list(), retained = listed.plans.find(plan => plan.id === original.id);
    const edit = { ...retained, title: "Updated independent task title", expectedVersion: retained.version };
    const edited = await context.tasks().savePlan(edit, true, crypto.randomUUID());
    assert.equal(edited.version, retained.version + 1);
    listed = await context.tasks().list();
    retained = listed.plans.find(plan => plan.id === original.id);
    assert.deepEqual(retained.batteryIds, [context.ids[0]]);
    assert.equal(retained.title, edit.title);
    const retainedCycle = listed.cycles.find(cycle => cycle.id === originalCycle.id);
    assert.equal(retainedCycle.title, originalCycle.title, "Metadata edits must not rewrite the recorded open-cycle instructions.");
    assert.equal(retainedCycle.dueOn, originalCycle.dueOn);
    assert.deepEqual(retainedCycle.targetSnapshot.batteries, [{ id: context.ids[0], deleted: true }]);
    assert.deepEqual(await rows("task_target_retentions", context.scope), [], "The atomic retention authorization must not survive a successful edit.");
    await assert.rejects(context.tasks().savePlan(groupPlan([context.ids[0]], { title: "New plan cannot adopt deleted targets" }), false, crypto.randomUUID()), domainRejection);
    const unrelated = listed.plans.find(plan => plan.id === separate.id);
    await assert.rejects(context.tasks().savePlan({ ...unrelated, expectedVersion: unrelated.version, batteryIds: context.ids }, true, crypto.randomUUID()), domainRejection);
    listed = await context.tasks().list();
    assert.equal(listed.plans.length, 2);
    assert.deepEqual(listed.plans.find(plan => plan.id === separate.id).batteryIds, [context.ids[1]]);
    assert.equal(listed.plans.find(plan => plan.id === separate.id).version, unrelated.version);
    assert.deepEqual(await rows("task_target_retentions", context.scope), []);
    await context.tasks(staff).completeCycle({ cycleId: retainedCycle.id, expectedVersion: retainedCycle.version, notes: "Completed the already recorded task." }, crypto.randomUUID());
    listed = await context.tasks().list();
    assert.ok(listed.generationIssues.some(issue => issue.planId === original.id), "A retained missing target must produce a generation issue instead of silently reducing future work.");
    assert.ok(!listed.cycles.some(cycle => cycle.planId === original.id && cycle.status === "open"));
    assert.deepEqual(listed.plans.find(plan => plan.id === original.id).batteryIds, [context.ids[0]]);
    const replacement = { ...listed.plans.find(plan => plan.id === original.id), expectedVersion: edited.version, batteryIds: [context.ids[1]] };
    const replaced = await context.tasks().savePlan(replacement, true, crypto.randomUUID());
    await assert.rejects(context.tasks().savePlan({ ...replacement, expectedVersion: replaced.version, batteryIds: context.ids }, true, crypto.randomUUID()), domainRejection);
    assert.deepEqual((await context.tasks().list()).plans.find(plan => plan.id === original.id).batteryIds, [context.ids[1]], "A deleted reference explicitly removed from a plan cannot be freshly added back.");
    assert.deepEqual(await rows("task_target_retentions", context.scope), []);
    assert.deepEqual((await db.prepare("PRAGMA foreign_key_check").all()).results, []);
});

test("a delayed mixed-asset charge reviewed before purge cannot commit against a removed member or change the retained member", { timeout: 20000 }, async () => {
    const context = await fixture("delayed-charge");
    const privateGroup = (await context.groups().save({ action: "create", id: crypto.randomUUID(), requestId: crypto.randomUUID(), name: "Delayed mixed set", notes: "", batteryIds: context.ids })).group;
    const payload = { requestId: crypto.randomUUID(), teachingGroup: { id: privateGroup.id, version: privateGroup.version }, kind: "charge", items: await bindings(context), completedAt: at, durationMinutes: 60 };
    const statements = new WeakMap();
    let announce, release, intercepted = false;
    const reached = new Promise(resolve => { announce = resolve; }), waiting = new Promise(resolve => { release = resolve; });
    const database = {
        prepare: sql => {
            const statement = db.prepare(sql);
            return { bind: (...values) => { const bound = statement.bind(...values); statements.set(bound, sql); return bound; } };
        },
        batch: async prepared => {
            if (!intercepted && prepared.some(statement => statements.get(statement)?.startsWith("INSERT INTO operations"))) { intercepted = true; announce(); await waiting; }
            return db.batch(prepared);
        },
    };
    const original = context.inventory(admin, database).groupMaintenance(payload).then(receipt => ({ receipt }), error => ({ error }));
    await reached;
    try {
        await purge(context);
        const before = await context.inventory().detail(context.ids[1]);
        release();
        const outcome = await original;
        assert.ok(outcome.error && domainRejection(outcome.error), "The delayed operation must have a final domain rejection, not an apparent success.");
        await assert.rejects(context.inventory().groupMaintenance(payload), domainRejection);
        assert.deepEqual(await context.inventory().detail(context.ids[1]), before);
        assert.equal((await rows("charges", context.scope)).length, 0);
        assert.deepEqual((await context.inventory().snapshot()).batteries.map(battery => battery.id), [context.ids[1]]);
    } finally { release(); }
});
