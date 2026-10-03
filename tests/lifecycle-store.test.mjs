import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Miniflare } from "miniflare";
import { InventoryStore } from "../work/qa/store.mjs";
import { verifyLifecycleReceipt } from "../work/qa/lifecycle-session.mjs";
import { createExport } from "../work/qa/exports.mjs";

const mf = new Miniflare({ modules: true, script: "export default {fetch(){return new Response('lifecycle-test')}}", compatibilityDate: "2026-05-15", d1Databases: { DB: "lifecycle-test" }, d1Persist: false });
const db = await mf.getD1Database("DB"), journal = JSON.parse(await readFile("drizzle/meta/_journal.json", "utf8"));
async function migrate(database, entries = journal.entries) {
    for (const entry of entries) {
        const sql = await readFile(`drizzle/${entry.tag}.sql`, "utf8");
        await database.batch(sql.split("--> statement-breakpoint").filter(statement => statement.trim()).map(statement => database.prepare(statement)));
    }
}
await migrate(db); after(() => mf.dispose());
const at = "2026-10-03T20:00:00.000Z";
const admin = { id: crypto.randomUUID(), name: "Lifecycle Administrator", role: "admin", authVersion: 1 };
const secondAdmin = { id: crypto.randomUUID(), name: "Second Lifecycle Administrator", role: "admin", authVersion: 1 };
const self = { id: crypto.randomUUID(), name: "Shared Staff Name", role: "staff", authVersion: 1 };
const other = { id: crypto.randomUUID(), name: "Shared Staff Name", role: "staff", authVersion: 1 };
for (const [index, actor] of [admin, secondAdmin, self, other].entries()) await db.prepare("INSERT INTO staff_accounts(id,username,display_name,role,password_hash,password_salt,hash_iterations,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)")
    .bind(actor.id, `lifecycle-actor-${index}`, actor.name, actor.role, "test-only-no-login", "test-only-no-login", 600000, at, at).run();
const rows = async (table, scope, database = db) => (await database.prepare(`SELECT * FROM ${table} WHERE scope=? ORDER BY rowid`).bind(scope).all()).results;
const status = expected => error => error.status === expected;
const rejected = pattern => error => error.code === "lifecycle_rejected_final" && pattern.test(error.message);
const invalid = error => error.name === "ZodError" || error.status === 400;
async function fixture(name, dataset = "demo", count = 2) {
    const scope = `lifecycle-${name}:${dataset}`, store = (actor = self, database = db, clock = () => new Date(at)) => new InventoryStore(database, scope, dataset, actor, clock);
    await store(admin).snapshot();
    for (let index = 0; index < count; index++) await store(admin).saveBattery({ id: index === 0 ? "BAT-ONE" : "BAT-TWO", name: "Preserved individual battery", model: "PRESERVED-MODEL", chemistry: "LiPo", capacityMah: 2200, voltage: 7.4, tagId: index === 0 ? "0000Exact-A" : null, ownerId: `staff-${other.id}`, homeBuildingId: "J18", homeRoomId: "J18-DEMO-ROOM", manufacturedOn: "2026-01-01", firstUsedOn: "2026-02-01" });
    return { scope, dataset, store };
}
async function requested(context, extra = {}, ids = ["BAT-ONE"]) {
    const snapshot = await context.store().snapshot();
    return { requestId: crypto.randomUUID(), kind: "scrapped", reason: "Recorded end of service.", destination: null, source: "manual_selection", items: ids.map(id => { const battery = snapshot.batteries.find(item => item.id === id); return { batteryId: id, version: battery.version, tagId: battery.tagId }; }), ...extra };
}
async function history(context) {
    return { batteries: await rows("batteries", context.scope), loans: await rows("loans", context.scope), charges: await rows("charges", context.scope), observations: await rows("observations", context.scope), events: (await rows("audit_events", context.scope)).filter(event => ["battery_scrapped", "battery_permanently_removed"].includes(event.action)), operations: (await rows("operations", context.scope)).filter(operation => operation.kind === "battery_lifecycle") };
}
async function checkout(context, id = "BAT-ONE", actor = other) { return context.store(actor).movement({ requestId: crypto.randomUUID(), kind: "checkout", batteryIds: [id] }); }
async function returnCurrent(context, id = "BAT-ONE") {
    const battery = (await context.store().snapshot()).batteries.find(item => item.id === id);
    return context.store().movement({ requestId: crypto.randomUUID(), kind: "return", batteryIds: [id], expectedLoans: [{ batteryId: id, loanId: battery.loanId }] });
}
function beforeAtomicCommit(intervene, kind = "battery_lifecycle") {
    const sqlByStatement = new WeakMap(); let intercepted = false;
    return {
        prepare: sql => { const statement = db.prepare(sql); return { bind: (...values) => { const bound = statement.bind(...values); sqlByStatement.set(bound, { sql, values }); return bound; } }; },
        batch: async statements => {
            if (!intercepted && statements.some(statement => { const record = sqlByStatement.get(statement); return record?.sql.startsWith("INSERT INTO operations(") && (record.values[2] === kind || record.sql.includes(`'${kind}'`)); })) { intercepted = true; await intervene(); }
            return db.batch(statements);
        },
    };
}

test("ordinary staff scrap another owner's available battery with exact native attribution and preserved metadata", async () => {
    const context = await fixture("staff"), payload = await requested(context), before = (await history(context)).batteries[0];
    const result = await context.store({ ...self, name: "Client-supplied wrong name" }).lifecycle(payload);
    assert.deepEqual(verifyLifecycleReceipt(result, { actorAccountId: self.id, dataset: "demo", payload }), result);
    assert.equal(result.actorAccountId, self.id); assert.equal(result.items[0].version, 2); assert.equal(result.at, at);
    const saved = await history(context), after = saved.batteries[0];
    for (const field of ["id", "key", "scope", "name", "model", "chemistry", "capacity_mah", "voltage", "tag_id", "owner_key", "home_building_key", "home_room_key", "created_at", "manufactured_on", "first_used_on"]) assert.equal(after[field], before[field]);
    assert.equal(after.lifecycle_status, "scrapped"); assert.equal(after.lifecycle_reason, payload.reason); assert.equal(after.lifecycle_at, at); assert.equal(after.lifecycle_destination, null);
    assert.equal(saved.events.length, 1); assert.equal(saved.events[0].actor_id, self.id); assert.equal(saved.events[0].actor_name, self.name);
    assert.equal(JSON.parse(saved.events[0].details_json).source, "manual_selection");
    assert.equal((await context.store(other).snapshot()).batteries[0].lifecycleStatus, "scrapped");
});

test("permanent removal is available to staff in working inventory and records the exact entered tag and optional destination", async () => {
    const context = await fixture("working", "live"), payload = await requested(context, { kind: "permanently_removed", destination: "External equipment store", source: "tag_entry" });
    const result = await context.store().lifecycle(payload), detail = await context.store(other).detail("BAT-ONE");
    assert.equal(result.kind, "permanently_removed"); assert.equal(result.dataset, "live");
    assert.equal(detail.battery.lifecycleDestination, "External equipment store"); assert.equal(detail.battery.tagId, payload.items[0].tagId);
    assert.equal(detail.battery.lifecycleStatus, "permanently_removed"); assert.equal(detail.events[0].action, "battery_permanently_removed");
    assert.equal((await context.store().scanLookup({ tagIds: [payload.items[0].tagId], source: "manual" })).results[0].battery.lifecycleStatus, "permanently_removed");
});

test("ordinary staff can retire batches without reasons while history and exports retain absent values without inventing evidence", async () => {
    for (const kind of ["scrapped", "permanently_removed"]) for (const [index, reason] of [undefined, "", " \t\r\n "].entries()) {
        const context = await fixture(`optional-${kind}-${index}`, index === 0 ? "live" : "demo"), payload = await requested(context, { kind, reason }, ["BAT-ONE", "BAT-TWO"]);
        if (reason === undefined) delete payload.reason;
        const result = await context.store().lifecycle(payload);
        assert.equal(result.items.length, 2); assert.equal(result.reason, ""); assert.equal(result.actorAccountId, self.id);
        assert.deepEqual(verifyLifecycleReceipt(result, { actorAccountId: self.id, dataset: context.dataset, payload: { ...payload, reason: "" } }), result);
        const saved = await history(context);
        assert.ok(saved.batteries.every(battery => battery.lifecycle_status === kind && battery.lifecycle_reason === null && battery.lifecycle_at === at && battery.version === 2));
        assert.equal(saved.events.length, 2); assert.equal(saved.operations.length, 1);
        assert.ok(saved.events.every(event => { const details = JSON.parse(event.details_json); return event.actor_id === self.id && details.reason === "" && details.after.lifecycle_reason === null && details.before.lifecycle_status === "active"; }));
        assert.deepEqual(await context.store().lifecycle({ ...payload, reason: " " }), { ...result, replayed: true });
        const summary = await createExport(context.store(), { dataset: context.dataset, mode: "summary", filter: { lifecycle: kind } });
        assert.equal(summary.tables.Inventory.length, 2); assert.ok(summary.tables.Inventory.every(battery => battery.lifecycle_reason === null && battery.lifecycle_status === kind));
        const exported = await createExport(context.store(), { dataset: context.dataset, mode: "detail", range: "selected", batteryIds: ["BAT-ONE", "BAT-TWO"] });
        assert.ok(exported.tables.Batteries.every(battery => battery.lifecycle_reason === null));
        assert.equal(exported.tables.Operations.filter(event => ["battery_scrapped", "battery_permanently_removed"].includes(event.action)).length, 2);
        const detail = await context.store().detail("BAT-ONE"); assert.equal(detail.battery.lifecycleReason, null);
        assert.equal(detail.events.find(event => event.action === (kind === "scrapped" ? "battery_scrapped" : "battery_permanently_removed")).details.reason, "");
    }
});

test("optional reason bounds reject oversized batches before writing and retain the maximum recorded reason", async () => {
    const context = await fixture("reason-bounds"), payload = await requested(context, { reason: "R".repeat(1001) }, ["BAT-ONE", "BAT-TWO"]), before = await history(context);
    await assert.rejects(context.store().lifecycle(payload), invalid);
    assert.deepEqual(await history(context), before);
    const result = await context.store().lifecycle({ ...payload, reason: "R".repeat(1000) });
    assert.equal(result.reason.length, 1000); assert.ok((await history(context)).batteries.every(battery => battery.lifecycle_reason.length === 1000));
});

test("an active loan rejects an entire removal batch and its original request stays rejected after return", async () => {
    const context = await fixture("loan"), payload = await requested(context, { reason: "" }, ["BAT-ONE", "BAT-TWO"]);
    await checkout(context);
    await assert.rejects(context.store().lifecycle(payload), rejected(/Return every selected/));
    assert.ok((await history(context)).batteries.every(battery => battery.lifecycle_status === "active"));
    assert.equal((await history(context)).events.length, 0);
    await returnCurrent(context);
    await assert.rejects(context.store().lifecycle(payload), rejected(/Return every selected/));
    const successful = await context.store().lifecycle({ ...payload, requestId: crypto.randomUUID() });
    assert.equal(successful.items.length, 2); assert.equal((await history(context)).loans.length, 1);
});

test("stale versions, changed tags, unknown IDs and duplicate bindings never partially remove a batch", async () => {
    const context = await fixture("bindings"), payload = await requested(context, {}, ["BAT-ONE", "BAT-TWO"]);
    const before = (await context.store().snapshot()).batteries[0];
    await context.store(admin).saveBattery({ ...before, tagId: "REASSIGNED-EXACT-TAG", expectedVersion: before.version }, true);
    await assert.rejects(context.store().lifecycle(payload), rejected(/version or exact tag changed/));
    await assert.rejects(context.store().lifecycle({ ...payload, requestId: crypto.randomUUID(), items: [{ batteryId: "UNKNOWN", version: 1, tagId: null }] }), rejected(/not registered/));
    await assert.rejects(context.store().lifecycle({ ...payload, requestId: crypto.randomUUID(), items: [payload.items[1], payload.items[1]] }), invalid);
    assert.ok((await history(context)).batteries.every(battery => battery.lifecycle_status === "active"));
    assert.equal((await history(context)).events.length, 0);
});

test("concurrent metadata edits and new loans at commit reject every reviewed removal item atomically", async () => {
    for (const mode of ["metadata", "loan"]) {
        const context = await fixture(`atomic-${mode}`), payload = await requested(context, {}, ["BAT-ONE", "BAT-TWO"]);
        const proxy = beforeAtomicCommit(async () => {
            if (mode === "loan") await checkout(context);
            else { const before = (await context.store().snapshot()).batteries[0]; await context.store(admin).saveBattery({ ...before, name: "Concurrently updated name", expectedVersion: before.version }, true); }
        });
        await assert.rejects(context.store(self, proxy).lifecycle(payload), rejected(/reviewed battery, tag, loan/));
        const saved = await history(context); assert.ok(saved.batteries.every(battery => battery.lifecycle_status === "active")); assert.equal(saved.events.length, 0); assert.equal(saved.operations.length, 0);
    }
});

test("a checkout racing a removal has only one winning state transition", async () => {
    const context = await fixture("checkout-race"), payload = await requested(context);
    const results = await Promise.allSettled([context.store().lifecycle(payload), checkout(context)]);
    assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
    const saved = await history(context), activeLoans = saved.loans.filter(loan => !loan.returned_at && !loan.cancelled_at);
    assert.equal(saved.batteries[0].lifecycle_status === "scrapped" ? activeLoans.length : saved.events.length, 0);
    assert.equal(saved.batteries[0].lifecycle_status === "scrapped" ? saved.events.length : activeLoans.length, 1);
});

test("a 100-battery removal uses the reviewed batch atomically without per-item binding overflow", async () => {
    const context = await fixture("hundred", "demo", 0);
    await db.batch(Array.from({ length: 100 }, (_, index) => { const id = `BULK-${String(index).padStart(3, "0")}`; return db.prepare("INSERT INTO batteries(key,scope,id,name,tag_id,owner_key,home_building_key,created_at) VALUES(?,?,?,?,?,?,?,?)").bind(`${context.scope}/${id}`, context.scope, id, "Bulk fixture battery", `BULK-TAG-${index}`, `${context.scope}/staff-${other.id}`, `${context.scope}/J18`, at); }));
    const ids = (await context.store().snapshot()).batteries.map(battery => battery.id), payload = await requested(context, { kind: "permanently_removed", destination: null }, ids);
    const result = await context.store().lifecycle(payload);
    assert.equal(result.items.length, 100); assert.equal((await history(context)).events.length, 100);
    assert.ok((await history(context)).batteries.every(battery => battery.lifecycle_status === "permanently_removed" && battery.version === 2));
});

test("lost responses and exact retries preserve the first immutable removal receipt without repeating history", async () => {
    const context = await fixture("retry"), payload = await requested(context, { reason: "" }), proxy = beforeAtomicCommit(async () => {}), batch = proxy.batch;
    let lost = false;
    proxy.batch = async statements => { const result = await batch(statements); if (!lost) { lost = true; throw new Error("Synthetic response loss after removal commit"); } return result; };
    const result = await context.store(self, proxy).lifecycle(payload);
    assert.equal(result.replayed, true);
    assert.deepEqual(await context.store(self, db, () => new Date("2026-10-05T20:00:00Z")).lifecycle(payload), result);
    await assert.rejects(context.store().lifecycle({ ...payload, reason: "Changed unknown draft" }), error => error.code === "idempotency_conflict");
    await assert.rejects(context.store(other).lifecycle(payload), error => error.code === "idempotency_conflict");
    const saved = await history(context); assert.equal(saved.events.length, 1); assert.equal(saved.operations.length, 1); assert.equal(saved.batteries[0].version, 2);
});

test("removal requires current native staff authority even for earlier receipt replay", async () => {
    const context = await fixture("authority"), payload = await requested(context);
    for (const actor of [{ ...self, id: crypto.randomUUID() }, { ...self, role: "admin" }, { ...self, authVersion: 2 }]) await assert.rejects(context.store(actor).lifecycle(payload), status(403));
    await assert.rejects(context.store({ ...self, authVersion: undefined }).lifecycle(payload), status(401));
    await context.store().lifecycle(payload);
    try {
        await db.prepare("UPDATE staff_accounts SET active=0,auth_version=auth_version+1,version=version+1 WHERE id=?").bind(self.id).run();
        await assert.rejects(context.store().lifecycle(payload), status(403));
    } finally { await db.prepare("UPDATE staff_accounts SET active=1,auth_version=1,version=version+1 WHERE id=?").bind(self.id).run(); }
});

test("account changes at commit remain uncertain and create neither removal nor false final rejection", async () => {
    const context = await fixture("authority-race"), payload = await requested(context);
    try {
        const proxy = beforeAtomicCommit(async () => { await db.prepare("UPDATE staff_accounts SET active=0,auth_version=auth_version+1,version=version+1 WHERE id=?").bind(self.id).run(); });
        await assert.rejects(context.store(self, proxy).lifecycle(payload), status(403));
        assert.equal((await history(context)).events.length, 0); assert.equal((await rows("operations", context.scope)).filter(row => row.kind.startsWith("battery_lifecycle")).length, 0);
    } finally { await db.prepare("UPDATE staff_accounts SET active=1,auth_version=1,version=version+1 WHERE id=?").bind(self.id).run(); }
    assert.equal((await context.store().lifecycle(payload)).items[0].version, 2);
});

test("terminal batteries retain full history while refusing metadata edits, new movements, charging, observations, imports and corrections", async () => {
    const context = await fixture("terminal-guards");
    await checkout(context); await returnCurrent(context);
    await context.store(admin).charge({ requestId: crypto.randomUUID(), batteryId: "BAT-ONE", completedAt: at, durationMinutes: 60 });
    await context.store(admin).observation({ requestId: crypto.randomUUID(), batteryId: "BAT-ONE", roomId: "J18-DEMO-ROOM", observedAt: at });
    await context.store().lifecycle(await requested(context, { kind: "permanently_removed", destination: "Recorded external location" }));
    const detail = await context.store().detail("BAT-ONE"), before = await history(context), loan = detail.loans[0];
    assert.equal(detail.loans.length, 1); assert.equal(detail.charges.length, 1); assert.equal(detail.observations.length, 1);
    await assert.rejects(context.store().movement({ requestId: crypto.randomUUID(), kind: "checkout", batteryIds: ["BAT-ONE"] }), error => error.code === "movement_rejected_final");
    await assert.rejects(context.store(admin).saveBattery({ ...detail.battery, name: "Forbidden edit", expectedVersion: detail.battery.version }, true), error => error.code === "battery_inactive");
    await assert.rejects(context.store(admin).charge({ requestId: crypto.randomUUID(), batteryId: "BAT-ONE", completedAt: at, durationMinutes: 30 }), error => error.code === "battery_inactive");
    await assert.rejects(context.store(admin).observation({ requestId: crypto.randomUUID(), batteryId: "BAT-ONE", roomId: "J18-DEMO-ROOM", observedAt: at }), error => error.code === "battery_inactive");
    for (const action of ["return_reopened", "checkout_voided"]) await assert.rejects(context.store(admin).correctLoan({ requestId: crypto.randomUUID(), loanId: loan.id, action, expectedReturnedAt: loan.returnedAt, reason: "Preserve terminal history." }), error => error.code === "battery_inactive");
    const asset = { name: "Imported battery", ownerId: `staff-${other.id}`, homeBuildingId: "J18", homeRoomId: null };
    await assert.rejects(context.store(admin).importRecords("batteries", [{ ...asset, id: "NEW-PARTIAL" }, { ...asset, id: "BAT-ONE", tagId: detail.battery.tagId }]), status(409));
    await assert.rejects(context.store(admin).saveBattery({ ...asset, id: "TAG-REUSED", tagId: detail.battery.tagId }), status(409));
    for (const table of ["loans", "charges", "observations"]) await assert.rejects(db.prepare(`DELETE FROM ${table} WHERE scope=? AND battery_key=?`).bind(context.scope, `${context.scope}/BAT-ONE`).run(), /retain terminal battery/);
    assert.deepEqual(await history(context), before);
});

test("retirement at another operation's commit blocks metadata, charge, observation and old-loan reopening atomically", async () => {
    for (const kind of ["battery_updated", "charge", "observation", "correction"]) {
        const context = await fixture(`other-operation-${kind}`);
        if (kind === "correction") { await checkout(context); await returnCurrent(context); }
        const reviewed = (await context.store().snapshot()).batteries[0], removal = await requested(context), proxy = beforeAtomicCommit(async () => { await context.store().lifecycle(removal); }, kind);
        const operation = kind === "battery_updated" ? () => context.store(admin, proxy).saveBattery({ ...reviewed, name: "Late metadata edit", expectedVersion: reviewed.version }, true)
            : kind === "charge" ? () => context.store(admin, proxy).charge({ requestId: crypto.randomUUID(), batteryId: "BAT-ONE", completedAt: at, durationMinutes: 30 })
                : kind === "observation" ? () => context.store(admin, proxy).observation({ requestId: crypto.randomUUID(), batteryId: "BAT-ONE", roomId: "J18-DEMO-ROOM", observedAt: at })
                    : async () => { const loan = (await context.store().detail("BAT-ONE")).loans[0]; return context.store(admin, proxy).correctLoan({ requestId: crypto.randomUUID(), loanId: loan.id, action: "return_reopened", expectedReturnedAt: loan.returnedAt, reason: "Reviewed return correction." }); };
        await assert.rejects(operation(), status(409));
        const saved = await history(context); assert.equal(saved.batteries[0].lifecycle_status, "scrapped"); assert.equal(saved.batteries[0].name, "Preserved individual battery"); assert.equal(saved.charges.length, 0); assert.equal(saved.observations.length, 0);
        if (kind === "correction") assert.ok(saved.loans[0].returned_at);
    }
});

test("D1 lifecycle guards forbid restoring or deleting assets and rewriting removal outcomes or audit snapshots", async () => {
    const context = await fixture("immutable"), payload = await requested(context);
    await context.store().lifecycle(payload);
    const saved = await history(context), battery = saved.batteries[0], operation = saved.operations[0], event = saved.events[0];
    await assert.rejects(db.prepare("UPDATE batteries SET lifecycle_status='active',lifecycle_at=NULL,lifecycle_reason=NULL,version=version+1 WHERE key=?").bind(battery.key).run(), /terminal battery records are immutable/);
    await assert.rejects(db.prepare("DELETE FROM batteries WHERE key=?").bind(battery.key).run(), /retain battery identity/);
    await assert.rejects(db.prepare("INSERT INTO loans(id,scope,battery_key,borrower_key,borrower_name,borrower_account_id,checked_out_at,checkout_actor_id,checkout_actor_name) VALUES(?,?,?,?,?,?,?,?,?)").bind(crypto.randomUUID(), context.scope, battery.key, `${context.scope}/staff-${self.id}`, self.name, self.id, at, self.id, self.name).run(), /active battery/);
    await assert.rejects(db.prepare("UPDATE operations SET result_json='{}' WHERE id=?").bind(operation.id).run(), /immutable/);
    await assert.rejects(db.prepare("DELETE FROM operations WHERE id=?").bind(operation.id).run(), /cannot be deleted/);
    await assert.rejects(db.prepare("INSERT OR REPLACE INTO operations(id,scope,kind,fingerprint,result_json,created_at,guard) SELECT id,scope,kind,fingerprint,'{}',created_at,guard FROM operations WHERE id=?").bind(operation.id).run(), /cannot be replaced/);
    await assert.rejects(db.prepare("UPDATE audit_events SET details_json='{}' WHERE id=?").bind(event.id).run(), /immutable/);
    await assert.rejects(db.prepare("DELETE FROM audit_events WHERE id=?").bind(event.id).run(), /cannot be deleted/);
    assert.deepEqual(await history(context), saved);
});

test("a final loan rejection prevents a delayed original removal after the loan is returned", async () => {
    const context = await fixture("delayed-rejected"), payload = await requested(context);
    let signalStarted, releaseOriginal;
    const started = new Promise(resolve => { signalStarted = resolve; }), release = new Promise(resolve => { releaseOriginal = resolve; });
    const proxy = beforeAtomicCommit(async () => { signalStarted(); await release; });
    const original = context.store(self, proxy).lifecycle(payload).then(receipt => ({ receipt }), error => ({ error }));
    await started;
    try {
        await checkout(context); await assert.rejects(context.store().lifecycle(payload), rejected(/Return every selected/));
        await returnCurrent(context); releaseOriginal();
        const completed = await original; assert.equal(completed.error.code, "lifecycle_rejected_final");
        await assert.rejects(context.store().lifecycle(payload), rejected(/Return every selected/));
        const saved = await history(context); assert.equal(saved.batteries[0].lifecycle_status, "active"); assert.equal(saved.events.length, 0); assert.equal(saved.operations.length, 0);
    } finally { releaseOriginal(); }
});

test("a successful removal winning a rejection reservation race returns its original receipt", async () => {
    const context = await fixture("success-rejection-race"), payload = await requested(context);
    let signalOriginal, releaseOriginal, signalRejection, releaseRejection;
    const originalStarted = new Promise(resolve => { signalOriginal = resolve; }), originalRelease = new Promise(resolve => { releaseOriginal = resolve; });
    const rejectionStarted = new Promise(resolve => { signalRejection = resolve; }), rejectionRelease = new Promise(resolve => { releaseRejection = resolve; });
    const originalProxy = beforeAtomicCommit(async () => { signalOriginal(); await originalRelease; });
    const rejectionProxy = beforeAtomicCommit(async () => { signalRejection(); await rejectionRelease; }, "battery_lifecycle_rejected");
    const original = context.store(self, originalProxy).lifecycle(payload);
    await originalStarted;
    try {
        await checkout(context); const reservation = context.store(self, rejectionProxy).lifecycle(payload); await rejectionStarted;
        await returnCurrent(context); releaseOriginal(); const first = await original;
        releaseRejection(); assert.deepEqual(await reservation, { ...first, replayed: true });
        const saved = await history(context); assert.equal(saved.events.length, 1); assert.equal(saved.operations.length, 1);
    } finally { releaseOriginal(); releaseRejection(); }
});

test("a rejection reservation transport failure cannot claim an irreversible action was finally rejected", async () => {
    const context = await fixture("rejection-unknown"), payload = await requested(context, { reason: "" });
    await checkout(context);
    const proxy = beforeAtomicCommit(async () => { throw new Error("Synthetic rejection storage outage"); }, "battery_lifecycle_rejected");
    await assert.rejects(context.store(self, proxy).lifecycle(payload), error => !error.status && /storage outage/.test(error.message));
    assert.equal((await rows("operations", context.scope)).filter(row => row.kind === "battery_lifecycle_rejected").length, 0);
    await returnCurrent(context); assert.equal((await context.store().lifecycle(payload)).items[0].status, "scrapped");
});

test("additive migration preserves earlier metadata and history while defaulting every earlier battery to active", async () => {
    const isolated = new Miniflare({ modules: true, script: "export default {fetch(){return new Response('migration-test')}}", compatibilityDate: "2026-05-15", d1Databases: { DB: "lifecycle-migration-test" }, d1Persist: false });
    const database = await isolated.getD1Database("DB"), earlier = journal.entries.filter(entry => entry.idx < 12), latest = journal.entries.filter(entry => entry.idx === 12);
    try {
        await migrate(database, earlier);
        const scope = "lifecycle-migration:demo", actor = { id: "migration-admin", name: "Migration Administrator", role: "admin", authVersion: 1 };
        await database.prepare("INSERT INTO staff_accounts(id,username,display_name,role,password_hash,password_salt,hash_iterations,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)").bind(actor.id, actor.id, actor.name, actor.role, "test-only-no-login", "test-only-no-login", 600000, at, at).run();
        const store = new InventoryStore(database, scope, "demo", actor, () => new Date(at));
        await store.saveBattery({ id: "BEFORE", name: "Earlier registered battery", ownerId: "staff-migration-admin", homeBuildingId: "J18", tagId: "EARLIER-TAG", manufacturedOn: "2026-01-01", firstUsedOn: "2026-02-01" });
        const before = (await rows("batteries", scope, database))[0], auditBefore = await rows("audit_events", scope, database);
        await migrate(database, latest);
        const after = (await rows("batteries", scope, database))[0];
        assert.deepEqual(Object.fromEntries(Object.keys(before).map(key => [key, after[key]])), before);
        assert.equal(after.lifecycle_status, "active"); assert.equal(after.lifecycle_at, null); assert.equal(after.lifecycle_reason, null);
        assert.deepEqual(await rows("audit_events", scope, database), auditBefore);
        const record = (await store.detail("BEFORE")).battery; assert.equal(record.lifecycleStatus, "active");
        await assert.rejects(database.prepare("UPDATE batteries SET owner_key='foreign/staff-migration-admin',version=version+1 WHERE scope=? AND id='BEFORE'").bind(scope).run(), /owner/);
    } finally { await isolated.dispose(); }
});

test("the optional-reason migration preserves saved removals and every other trigger while retaining terminal, date, loan and metadata guards", async () => {
    const isolated = new Miniflare({ modules: true, script: "export default {fetch(){return new Response('optional-migration-test')}}", compatibilityDate: "2026-05-15", d1Databases: { DB: "optional-removal-migration-test" }, d1Persist: false });
    const database = await isolated.getD1Database("DB"), scope = "optional-removal-migration:demo";
    const administrator = { id: "optional-admin", name: "Optional Migration Administrator", role: "admin", authVersion: 1 }, staff = { id: "optional-staff", name: "Optional Migration Staff", role: "staff", authVersion: 1 };
    const nativeStore = actor => new InventoryStore(database, scope, "demo", actor, () => new Date(at));
    const triggerRows = async () => (await database.prepare("SELECT name,sql FROM sqlite_master WHERE type='trigger' ORDER BY name").all()).results;
    try {
        await migrate(database, journal.entries.filter(entry => entry.idx <= 12));
        for (const actor of [administrator, staff]) await database.prepare("INSERT INTO staff_accounts(id,username,display_name,role,password_hash,password_salt,hash_iterations,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)")
            .bind(actor.id, actor.id, actor.name, actor.role, "test-only-no-login", "test-only-no-login", 600000, at, at).run();
        for (const id of ["OLD-RETIRED", "NO-REASON", "ON-LOAN", "CHECK-GUARDS"]) await nativeStore(administrator).saveBattery({ id, name: "Migration battery", ownerId: "staff-optional-staff", homeBuildingId: "J18", tagId: `TAG-${id}` });
        const saved = (await nativeStore(staff).detail("OLD-RETIRED")).battery;
        const originalPayload = { requestId: crypto.randomUUID(), kind: "permanently_removed", reason: "Earlier recorded reason", destination: "Earlier recorded destination", source: "manual_selection", items: [{ batteryId: saved.id, version: saved.version, tagId: saved.tagId }] };
        const originalReceipt = await nativeStore(staff).lifecycle(originalPayload);
        await nativeStore(staff).movement({ requestId: crypto.randomUUID(), kind: "checkout", batteryIds: ["ON-LOAN"] });
        const tables = ["batteries", "loans", "charges", "observations", "audit_events", "operations"], before = await Promise.all(tables.map(table => rows(table, scope, database))), triggersBefore = await triggerRows();
        await migrate(database, journal.entries.filter(entry => entry.idx === 13));
        assert.deepEqual(await Promise.all(tables.map(table => rows(table, scope, database))), before);
        const triggersAfter = await triggerRows();
        assert.deepEqual(triggersAfter.map(trigger => trigger.name), triggersBefore.map(trigger => trigger.name));
        assert.deepEqual(triggersAfter.filter(trigger => trigger.name !== "batteries_lifecycle_update"), triggersBefore.filter(trigger => trigger.name !== "batteries_lifecycle_update"));
        assert.notEqual(triggersAfter.find(trigger => trigger.name === "batteries_lifecycle_update").sql, triggersBefore.find(trigger => trigger.name === "batteries_lifecycle_update").sql);
        assert.deepEqual(await nativeStore(staff).lifecycle(originalPayload), { ...originalReceipt, replayed: true });
        const guardKey = `${scope}/CHECK-GUARDS`;
        await assert.rejects(database.prepare("UPDATE batteries SET lifecycle_status='scrapped',lifecycle_reason=NULL,version=version+1 WHERE key=?").bind(guardKey).run(), /requires dated evidence/);
        await assert.rejects(database.prepare("UPDATE batteries SET lifecycle_status='scrapped',lifecycle_at=?,lifecycle_reason=?,version=version+1 WHERE key=?").bind(at, "R".repeat(1001), guardKey).run(), /bounded optional details/);
        await assert.rejects(database.prepare("UPDATE batteries SET lifecycle_status='scrapped',lifecycle_at=?,name='Changed at removal',version=version+1 WHERE key=?").bind(at, guardKey).run(), /cannot modify saved battery/);
        await assert.rejects(database.prepare("UPDATE batteries SET lifecycle_reason='Unexpected active evidence',version=version+1 WHERE key=?").bind(guardKey).run(), /active batteries cannot contain removal evidence/);
        await assert.rejects(database.prepare("UPDATE batteries SET lifecycle_status='scrapped',lifecycle_at=?,version=version+1 WHERE key=?").bind(at, `${scope}/ON-LOAN`).run(), /return the active loan/);
        await assert.rejects(database.prepare("UPDATE batteries SET name='Rewrite earlier history',version=version+1 WHERE key=?").bind(`${scope}/OLD-RETIRED`).run(), /terminal battery records are immutable/);
        await assert.rejects(database.prepare("DELETE FROM batteries WHERE key=?").bind(guardKey).run(), /retain battery identity/);
        const blank = (await nativeStore(staff).detail("NO-REASON")).battery;
        const blankReceipt = await nativeStore(staff).lifecycle({ requestId: crypto.randomUUID(), kind: "scrapped", source: "manual_selection", items: [{ batteryId: blank.id, version: blank.version, tagId: blank.tagId }] });
        assert.equal(blankReceipt.reason, ""); assert.equal((await nativeStore(staff).detail(blank.id)).battery.lifecycleReason, null);
        assert.equal((await nativeStore(staff).detail("OLD-RETIRED")).battery.lifecycleReason, originalPayload.reason);
    } finally { await isolated.dispose(); }
});
