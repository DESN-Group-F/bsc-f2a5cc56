import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Miniflare } from "miniflare";
import { InventoryStore } from "../work/qa/store.mjs";
import { TeachingGroupStore } from "../work/qa/teaching-group-store.mjs";
import { filterBatteries, defaultInventoryFilter } from "../work/qa/inventory-query.mjs";
import { createExport } from "../work/qa/exports.mjs";
import { captureTeachingGroupAttempt, recoverTeachingGroupAttempt, verifyTeachingGroupReceipt, teachingGroupStorageKey } from "../work/qa/teaching-groups.mjs";

const journal = JSON.parse(await readFile("drizzle/meta/_journal.json", "utf8"));
async function migrate(db, entries = journal.entries) { for (const entry of entries) await db.batch((await readFile(`drizzle/${entry.tag}.sql`, "utf8")).split("--> statement-breakpoint").filter(sql => sql.trim()).map(sql => db.prepare(sql))); }
const mf = new Miniflare({ modules: true, script: "export default {fetch(){return new Response('group-test')}}", compatibilityDate: "2026-05-15", d1Databases: { DB: "group-test" }, d1Persist: false });
const db = await mf.getD1Database("DB"); await migrate(db); after(() => mf.dispose());
const at = "2026-10-03T05:00:00.000Z", a = { id: "teaching-staff-a", name: "Same Name", role: "staff", authVersion: 1 }, b = { id: "teaching-staff-b", name: "Same Name", role: "staff", authVersion: 1 }, admin = { id: "teaching-admin", name: "Administrator", role: "admin", authVersion: 1 };
for (const actor of [a, b, admin]) await db.prepare("INSERT INTO staff_accounts(id,username,display_name,role,password_hash,password_salt,hash_iterations,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)").bind(actor.id, actor.id, actor.name, actor.role, "test-only-no-login", "test-only-no-login", 600000, at, at).run();
async function fixture(name, dataset = "demo") {
    const scope = `groups-${name}:${dataset}`, inventory = (actor = a, database = db) => new InventoryStore(database, scope, dataset, actor, () => new Date(at)), groups = (actor = a, database = db) => new TeachingGroupStore(database, scope, dataset, actor, () => new Date(at));
    await inventory().snapshot();
    for (const [id, capacityMah, voltage] of [["BAT-10", 2000, 7.4], ["BAT-2", 5000, 11.1], ["BAT-3", null, null]]) await inventory(admin).saveBattery({ id, name: "Teaching battery", model: "PACK", capacityMah, voltage, ownerId: `staff-${a.id}`, homeBuildingId: "J18" });
    return { scope, dataset, inventory, groups };
}
const draft = (batteryIds = ["BAT-10", "BAT-2"], extra = {}) => ({ action: "create", requestId: crypto.randomUUID(), id: crypto.randomUUID(), name: "Teaching set", notes: "A saved selection", batteryIds, ...extra });
const raw = async (table, scope, database = db) => (await database.prepare(`SELECT * FROM ${table} WHERE scope=? ORDER BY rowid`).bind(scope).all()).results;
function intercept(intervene) {
    const commands = new WeakMap(); let once = false;
    return { prepare(sql) { const statement = db.prepare(sql); return { bind(...values) { const bound = statement.bind(...values); commands.set(bound, sql); return bound; } }; }, async batch(statements) { if (!once && statements.some(statement => commands.get(statement)?.startsWith("INSERT INTO teaching_group_operations"))) { once = true; await intervene(); } return db.batch(statements); } };
}

test("numeric and timestamp sorting keeps unknowns last both ways, IDs break ties, and input records stay unchanged", () => {
    const records = [
        { id: "BAT-10", name: "Pack", capacityMah: 2000, voltage: 7.4, registeredAt: "2026-10-01T10:00:00+10:00", manufacturedOn: "2026-01-01", firstUsedOn: "2026-02-01", lastCheckedOutAt: "2026-10-03T01:00:00Z", chargeDurationMinutes: 60 },
        { id: "BAT-2", name: "Pack", capacityMah: 2000, voltage: 11.1, registeredAt: "2026-10-01T02:00:00Z", manufacturedOn: "2026-08-01", firstUsedOn: "2026-09-01", lastCheckedOutAt: "2026-10-02T23:00:00Z", chargeDurationMinutes: 90 },
        { id: "BAT-3", name: "Pack", capacityMah: null, voltage: null, registeredAt: null, manufacturedOn: null, firstUsedOn: null, lastCheckedOutAt: null, chargeDurationMinutes: null },
    ].map(value => ({ chemistry: "", model: "", ownerName: "Staff", borrowerName: null, homeRoomName: null, ...value }));
    const original = structuredClone(records), ids = (by, direction = "asc") => filterBatteries(records, { sortBy: by, sortDirection: direction }, "2026-10-03").map(record => record.id);
    assert.deepEqual(ids("capacity"), ["BAT-2", "BAT-10", "BAT-3"]); assert.deepEqual(ids("capacity", "desc"), ["BAT-2", "BAT-10", "BAT-3"]);
    assert.deepEqual(ids("voltage", "desc"), ["BAT-2", "BAT-10", "BAT-3"]); assert.deepEqual(ids("registered"), ["BAT-10", "BAT-2", "BAT-3"]);
    assert.deepEqual(ids("checkout"), ["BAT-2", "BAT-10", "BAT-3"]); assert.deepEqual(ids("age", "desc"), ["BAT-10", "BAT-2", "BAT-3"]);
    assert.deepEqual(ids("service_age"), ["BAT-2", "BAT-10", "BAT-3"]); assert.deepEqual(ids("charge_duration", "desc"), ["BAT-2", "BAT-10", "BAT-3"]);
    assert.deepEqual(records, original);
});

test("own teaching groups persist on the shared inventory without leaking to same-name staff or administrator snapshots", async () => {
    const context = await fixture("private"), payload = draft(), saved = await context.groups().save(payload);
    assert.deepEqual(verifyTeachingGroupReceipt(saved, captureTeachingGroupAttempt(a.id, context.dataset, payload)), saved);
    assert.equal((await context.groups().list())[0].ownerAccountId, a.id);
    assert.deepEqual(await context.groups(b).list(), []); assert.deepEqual(await context.groups(admin).list(), []);
    assert.equal((await context.inventory().snapshot()).teachingGroups.length, 1); assert.equal((await context.inventory(b).snapshot()).teachingGroups.length, 0);
    await context.groups(b).save(draft()); assert.equal((await context.groups(b).list()).length, 1);
    assert.deepEqual((await context.inventory(b).snapshot()).batteries.map(battery => battery.id), (await context.inventory().snapshot()).batteries.map(battery => battery.id));
    await assert.rejects(context.groups(b).save({ action: "update", requestId: crypto.randomUUID(), id: payload.id, name: "Take over", notes: "", batteryIds: ["BAT-2"], expectedVersion: 1 }), error => error.status === 404);
    assert.equal((await context.groups().list())[0].name, payload.name);
    await assert.rejects(context.groups().save({ ...draft(), ownerAccountId: b.id }), error => error.name === "ZodError");
});

test("groups are independent between inventories and refuse foreign or duplicate members without partial saves", async () => {
    const context = await fixture("scope", "live"), other = await fixture("scope", "demo"), payload = draft();
    await context.groups().save(payload); assert.deepEqual(await other.groups().list(), []);
    await assert.rejects(other.groups().save(draft(["BAT-2", "FOREIGN"])), error => error.code === "teaching_group_rejected_final");
    await assert.rejects(other.groups().save(draft(["BAT-2", "BAT-2"])), error => error.name === "ZodError");
    assert.deepEqual(await other.groups().list(), []);
});

test("group filters, sorted pages and summary/detail/selected exports share one exact ordering and private scope", async () => {
    const context = await fixture("exports"), saved = await context.groups().save(draft()), snapshot = await context.inventory().snapshot();
    const filter = { ...defaultInventoryFilter(), groupId: saved.group.id, sortBy: "capacity", sortDirection: "desc" };
    const ordered = filterBatteries(snapshot.batteries, filter, "2026-10-03", a.id, snapshot.teachingGroups).map(battery => battery.id);
    assert.deepEqual(ordered, ["BAT-2", "BAT-10"]);
    for (const mode of ["summary", "detail"]) {
        const document = await createExport(context.inventory(), { dataset: context.dataset, mode, filter, range: "page", pageSize: "10", page: 0 });
        assert.deepEqual((document.tables.Inventory || document.tables.Batteries).map(row => row.battery_id), ordered);
        assert.equal(document.metadata.teaching_group.name, saved.group.name); assert.equal(document.metadata.sort.direction, "desc");
    }
    const selected = await createExport(context.inventory(), { dataset: "demo", mode: "summary", range: "selected", batteryIds: ["BAT-3", "BAT-10", "BAT-2"], filter });
    assert.deepEqual(selected.tables.Inventory.map(row => row.battery_id), ["BAT-2", "BAT-10", "BAT-3"]);
    await assert.rejects(createExport(context.inventory(b), { dataset: "demo", mode: "summary", filter }), error => error.status === 409);
    assert.throws(() => filterBatteries(snapshot.batteries, filter, "2026-10-03", b.id, snapshot.teachingGroups), error => error.status === 409);
});

test("group updates and removals are versioned preferences; retained retired members cannot be silently borrowed", async () => {
    const context = await fixture("edit"), original = await context.groups().save(draft()), record = (await context.inventory().snapshot()).batteries.find(battery => battery.id === "BAT-2");
    await context.inventory().lifecycle({ requestId: crypto.randomUUID(), kind: "scrapped", source: "manual_selection", items: [{ batteryId: record.id, version: record.version, tagId: record.tagId }] });
    assert.deepEqual((await context.groups().list())[0].batteryIds, ["BAT-10", "BAT-2"]);
    await assert.rejects(context.inventory().movement({ requestId: crypto.randomUUID(), kind: "checkout", batteryIds: original.group.batteryIds }), error => error.status === 409);
    const update = { action: "update", requestId: crypto.randomUUID(), id: original.group.id, expectedVersion: 1, name: "Updated teaching set", notes: "Changed deliberately", batteryIds: ["BAT-10", "BAT-3"] };
    const edited = await context.groups().save(update); assert.equal(edited.group.version, 2);
    await assert.rejects(context.groups().save({ ...update, requestId: crypto.randomUUID() }), error => error.code === "teaching_group_rejected_final");
    const remove = { action: "remove", requestId: crypto.randomUUID(), id: edited.group.id, expectedVersion: 2 }, archived = await context.groups().save(remove);
    assert.equal(archived.group.state, "archived"); assert.deepEqual(await context.groups().list(), []);
    assert.equal((await context.inventory().snapshot()).batteries.length, 3); assert.equal((await raw("teaching_group_events", context.scope)).length, 3);
    await assert.rejects(createExport(context.inventory(), { dataset: "demo", mode: "summary", filter: { groupId: original.group.id } }), error => error.status === 409);
});

test("uncertain group creates replay one immutable result and reject altered drafts with the same request ID", async () => {
    const context = await fixture("replay"), payload = draft(), saved = await context.groups().save(payload);
    assert.deepEqual(await context.groups().save(payload), { ...saved, replayed: true });
    await assert.rejects(context.groups().save({ ...payload, name: "Changed after unknown response" }), error => error.code === "idempotency_conflict");
    assert.equal((await raw("teaching_group_events", context.scope)).length, 1);
    const attempt = captureTeachingGroupAttempt(a.id, "demo", payload), serialized = JSON.stringify(attempt);
    assert.deepEqual(recoverTeachingGroupAttempt(serialized, a.id, "demo"), attempt); assert.equal(recoverTeachingGroupAttempt(serialized, b.id, "demo"), null); assert.equal(recoverTeachingGroupAttempt(serialized, a.id, "live"), null);
    assert.notEqual(teachingGroupStorageKey(a.id, "demo"), teachingGroupStorageKey(b.id, "demo"));
    assert.throws(() => verifyTeachingGroupReceipt({ ...saved, actorAccountId: b.id }, attempt));
});

test("account changes and concurrent group versions reject the whole write with no unauthorized preference or event", async () => {
    const context = await fixture("races"), payload = draft(), proxy = intercept(async () => { await db.prepare("UPDATE staff_accounts SET active=0 WHERE id=?").bind(a.id).run(); });
    try { await assert.rejects(context.groups(a, proxy).save(payload), error => error.status === 403); assert.equal((await raw("teaching_groups", context.scope)).length, 0); }
    finally { await db.prepare("UPDATE staff_accounts SET active=1 WHERE id=?").bind(a.id).run(); }
    const first = await context.groups().save(payload), edit = { action: "update", requestId: crypto.randomUUID(), id: first.group.id, expectedVersion: 1, name: "Draft", notes: "", batteryIds: ["BAT-2"] };
    const racing = intercept(async () => { await context.groups().save({ ...edit, requestId: crypto.randomUUID(), name: "Other tab wins" }); });
    await assert.rejects(context.groups(a, racing).save(edit), error => error.code === "teaching_group_rejected_final");
    assert.equal((await context.groups().list())[0].name, "Other tab wins"); assert.equal((await raw("teaching_group_events", context.scope)).length, 2);
});

test("private group identities, memberships, receipts and events resist SQL replacement and cross-inventory shortcuts", async () => {
    const context = await fixture("guards"), saved = await context.groups().save(draft()), [row] = await raw("teaching_groups", context.scope), [receipt] = await raw("teaching_group_operations", context.scope), [event] = await raw("teaching_group_events", context.scope);
    await assert.rejects(db.prepare("UPDATE teaching_groups SET owner_account_id=?,version=version+1 WHERE key=?").bind(b.id, row.key).run(), /immutable/);
    await assert.rejects(db.prepare("UPDATE teaching_groups SET member_ids_json='[\"FOREIGN\"]',version=version+1 WHERE key=?").bind(row.key).run(), /members/);
    await assert.rejects(db.prepare("DELETE FROM teaching_groups WHERE key=?").bind(row.key).run(), /archive/);
    await assert.rejects(db.prepare("UPDATE teaching_group_operations SET result_json='{}' WHERE key=?").bind(receipt.key).run(), /immutable/);
    await assert.rejects(db.prepare("DELETE FROM teaching_group_events WHERE id=?").bind(event.id).run(), /retained/);
    assert.equal((await context.groups().list())[0].id, saved.group.id); assert.deepEqual((await db.prepare("PRAGMA foreign_key_check").all()).results, []);
});

test("a full 100-battery teaching group retains every member in filtering and complete downloads; 101 is explicitly refused", async () => {
    const context = await fixture("full-batch"), ids = Array.from({ length: 100 }, (_, index) => `CLASS-${String(index + 1).padStart(3, "0")}`);
    await context.inventory(admin).importRecords("batteries", ids.map(id => ({ id, name: "Teaching group software fixture", ownerId: `staff-${a.id}`, homeBuildingId: "J18" })));
    const saved = await context.groups().save(draft(ids)), snapshot = await context.inventory().snapshot();
    assert.equal(saved.group.batteryIds.length, 100); assert.equal(filterBatteries(snapshot.batteries, { groupId: saved.group.id }, "2026-10-03", a.id, snapshot.teachingGroups).length, 100);
    const exported = await createExport(context.inventory(), { dataset: "demo", mode: "detail", filter: { groupId: saved.group.id }, sections: ["specifications", "audit"] }); assert.equal(exported.tables.Batteries.length, 100);
    await assert.rejects(context.groups().save(draft([...ids, "BAT-2"], { name: "Too large" })), error => error.name === "ZodError"); assert.equal((await context.groups().list()).length, 1);
});

test("final rejected group creation prevents a paused original from committing after the conflicting name becomes free", async () => {
    const context = await fixture("final-reservation"), payload = draft(); let entered, release;
    const started = new Promise(resolve => { entered = resolve; }), paused = new Promise(resolve => { release = resolve; });
    const original = context.groups(a, intercept(async () => { entered(); await paused; })).save(payload).then(result => ({ result }), error => ({ error }));
    await started;
    try {
        const winner = await context.groups().save(draft());
        await assert.rejects(context.groups().save(payload), error => error.code === "teaching_group_rejected_final");
        await context.groups().save({ action: "remove", requestId: crypto.randomUUID(), id: winner.group.id, expectedVersion: 1 });
        release(); assert.equal((await original).error.code, "teaching_group_rejected_final"); assert.deepEqual(await context.groups().list(), []);
    } finally { release(); }
});

test("personal teaching group migration is additive and leaves all prior rows and database guards unchanged", async () => {
    const isolated = new Miniflare({ modules: true, script: "export default {fetch(){return new Response('group-migration-test')}}", compatibilityDate: "2026-05-15", d1Databases: { DB: "group-migration-test" }, d1Persist: false });
    try {
        const database = await isolated.getD1Database("DB"); await migrate(database, journal.entries.filter(entry => entry.idx < 14));
        await database.prepare("INSERT INTO staff_accounts(id,username,display_name,role,password_hash,password_salt,hash_iterations,created_at,updated_at) VALUES('migration-teacher','migration-teacher','Migration teacher','admin','test-only-no-login','test-only-no-login',600000,?,?)").bind(at, at).run();
        const inventory = new InventoryStore(database, "group-migration:demo", "demo", { id: "migration-teacher", name: "Migration teacher", role: "admin", authVersion: 1 }, () => new Date(at));
        await inventory.initializeDemo();
        await inventory.movement({ requestId: crypto.randomUUID(), kind: "checkout", batteryIds: ["BAT-001"] });
        const loan = await database.prepare("SELECT id FROM loans WHERE scope='group-migration:demo' AND returned_at IS NULL").first("id");
        await inventory.movement({ requestId: crypto.randomUUID(), kind: "return", batteryIds: ["BAT-001"], expectedLoans: [{ batteryId: "BAT-001", loanId: loan }] });
        const tables = (await database.prepare("SELECT name,sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT GLOB '_cf_*' ORDER BY name").all()).results;
        const guards = (await database.prepare("SELECT type,name,sql FROM sqlite_master WHERE type IN ('trigger','index') ORDER BY type,name").all()).results;
        const before = new Map(); for (const table of tables) before.set(table.name, (await database.prepare(`SELECT * FROM ${table.name} ORDER BY rowid`).all()).results);
        await migrate(database, journal.entries.filter(entry => entry.idx === 14));
        for (const table of tables) { assert.deepEqual((await database.prepare(`SELECT * FROM ${table.name} ORDER BY rowid`).all()).results, before.get(table.name)); assert.equal(await database.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").bind(table.name).first("sql"), table.sql); }
        for (const guard of guards) assert.equal(await database.prepare("SELECT sql FROM sqlite_master WHERE type=? AND name=?").bind(guard.type, guard.name).first("sql"), guard.sql);
    } finally { await isolated.dispose(); }
});
