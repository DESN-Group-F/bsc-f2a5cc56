import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Miniflare } from "miniflare";
import { IntakeStore } from "../work/qa/intake-store.mjs";
import { InventoryStore } from "../work/qa/store.mjs";
import { BatteryModelStore } from "../work/qa/battery-model-store.mjs";
import { listReferenceModels } from "../work/qa/battery-reference-catalog.mjs";
import { verifyIntakeReceipt } from "../work/qa/intake-session.mjs";

const mf = new Miniflare({ modules: true, script: "export default {fetch(){return new Response('intake-store-test')}}", compatibilityDate: "2026-05-15", d1Databases: { DB: "intake-store-test" }, d1Persist: false });
const db = await mf.getD1Database("DB"), journal = JSON.parse(await readFile("drizzle/meta/_journal.json", "utf8"));
for (const entry of journal.entries) {
    const sql = await readFile(`drizzle/${entry.tag}.sql`, "utf8");
    await db.batch(sql.split("--> statement-breakpoint").filter(statement => statement.trim()).map(statement => db.prepare(statement)));
}
after(() => mf.dispose());

const at = "2026-10-03T20:00:00.000Z";
const admin = { id: crypto.randomUUID(), displayName: "Intake Administrator", role: "admin", authVersion: 1 };
const secondAdmin = { id: crypto.randomUUID(), displayName: "Second Intake Administrator", role: "admin", authVersion: 1 };
const self = { id: crypto.randomUUID(), displayName: "Shared Staff Name", role: "staff", authVersion: 1 };
const other = { id: crypto.randomUUID(), displayName: "Shared Staff Name", role: "staff", authVersion: 1 };
for (const [index, actor] of [admin, secondAdmin, self, other].entries()) await db.prepare("INSERT INTO staff_accounts(id,username,display_name,role,password_hash,password_salt,hash_iterations,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)")
    .bind(actor.id, `intake-actor-${index}`, actor.displayName, actor.role, "test-only-no-login", "test-only-no-login", 600000, at, at).run();
const rows = async (table, scope) => (await db.prepare(`SELECT * FROM ${table} WHERE scope=? ORDER BY rowid`).bind(scope).all()).results;
const status = expected => error => error.status === expected;
const invalid = error => error.name === "ZodError" || error.status === 400;
const rejected = pattern => error => error.code === "intake_rejected_final" && pattern.test(error.message);
const modelSelection = model => ({ origin: model.origin, id: model.id, contentHash: model.contentHash, confirmed: true, appliedFields: ["name", "model", "chemistry", "capacityMah", "voltage"] });
const modelFields = model => Object.fromEntries(["name", "model", "chemistry", "capacityMah", "voltage"].map(key => [key, model[key]]));
async function fixture(name, dataset = "demo") {
    const scope = `intake-${name}:${dataset}`;
    const inventory = (actor = admin, database = db) => new InventoryStore(database, scope, dataset, { id: actor.id, name: actor.displayName, role: actor.role, authVersion: actor.authVersion }, () => new Date(at));
    await inventory().snapshot();
    return {
        scope, dataset, inventory,
        intake: (actor = self, database = db, clock = () => new Date(at)) => new IntakeStore(database, scope, dataset, actor, clock),
        models: (actor = self) => new BatteryModelStore(db, scope, dataset, actor, () => new Date(at)),
        common: { name: "Incoming example pack", model: "INCOMING-2200", chemistry: "LiPo", capacityMah: 2200, voltage: 7.4, ownerId: `staff-${other.id}`, homeBuildingId: "J18", homeRoomId: null, manufacturedOn: null, firstUsedOn: null },
    };
}
const input = (context, extra = {}) => ({ requestId: crypto.randomUUID(), sessionId: crypto.randomUUID(), tagId: `DEMO-INTAKE-${crypto.randomUUID()}`, common: { ...context.common }, firstUseMode: "at_registration", ...extra });
async function state(context) {
    return { counters: await rows("intake_counters", context.scope), sessions: await rows("intake_sessions", context.scope), batteries: await rows("batteries", context.scope), operations: (await rows("operations", context.scope)).filter(row => row.kind === "simulated_intake"), events: (await rows("audit_events", context.scope)).filter(row => JSON.parse(row.details_json).source === "simulated_intake"), loans: await rows("loans", context.scope), observations: await rows("observations", context.scope) };
}
function beforeAtomicCommit(intervene, operationKind = "simulated_intake") {
    const sqlByStatement = new WeakMap();
    let intercepted = false;
    return {
        prepare: sql => {
            const statement = db.prepare(sql);
            return { bind: (...values) => { const bound = statement.bind(...values); sqlByStatement.set(bound, sql); return bound; } };
        },
        batch: async statements => {
            if (!intercepted && statements.some(statement => (sqlByStatement.get(statement) ?? "").includes(`'${operationKind}'`))) { intercepted = true; await intervene(); }
            return db.batch(statements);
        },
    };
}
async function savedModel(context) {
    const modelInput = { id: crypto.randomUUID(), brand: "Example Brand", model: "SAVED-2200", variant: "Two-cell", name: "Saved incoming pack", chemistry: "LiPo", capacityMah: 2200, voltage: 7.4, notes: "Physical product label transcription." };
    return { modelInput, model: (await context.models().create(modelInput)).model };
}

test("first intake provisions missing directories without reading the inventory or unrelated history", async () => {
    const scope = "intake-provisioning-only:demo", queries = [], statements = new WeakMap();
    const trace = (statement, sql) => {
        const proxy = new Proxy(statement, {
            get(target, property) {
                if (property === "bind") return (...values) => trace(target.bind(...values), sql);
                if (["first", "all", "run", "raw"].includes(property)) return (...args) => {
                    queries.push(sql);
                    return target[property](...args);
                };
                const value = Reflect.get(target, property);
                return typeof value === "function" ? value.bind(target) : value;
            },
        });
        statements.set(proxy, { statement, sql });
        return proxy;
    };
    const database = {
        prepare: sql => trace(db.prepare(sql), sql),
        batch: prepared => {
            const real = prepared.map(statement => statements.get(statement));
            queries.push(...real.map(item => item.sql));
            return db.batch(real.map(item => item.statement));
        },
    };
    assert.equal((await rows("people", scope)).length, 0);
    assert.equal((await rows("buildings", scope)).length, 0);
    assert.equal((await rows("rooms", scope)).length, 0);
    const payload = {
        requestId: crypto.randomUUID(), sessionId: crypto.randomUUID(), tagId: "DEMO-INTAKE-PROVISIONING-ONLY",
        firstUseMode: "at_registration",
        common: {
            name: "First incoming battery", model: "FIRST-2200", chemistry: "LiPo", capacityMah: 2200, voltage: 7.4,
            ownerId: `staff-${other.id}`, homeBuildingId: "J18", homeRoomId: "J18-DEMO-ROOM", manufacturedOn: null, firstUsedOn: null,
        },
    };
    const receipt = await new IntakeStore(database, scope, "demo", self, () => new Date(at)).register(payload);
    assert.equal(receipt.batteryId, "BAT-00000001");
    assert.equal((await rows("batteries", scope)).length, 1);
    assert.ok((await rows("people", scope)).some(person => person.account_id === other.id));
    assert.ok((await rows("buildings", scope)).some(building => building.id === "J18"));
    assert.ok((await rows("rooms", scope)).some(room => room.id === "J18-DEMO-ROOM"));
    const reads = queries.filter(sql => /^\s*SELECT\b/i.test(sql));
    assert.ok(reads.length > 0);
    assert.ok(reads.every(sql => !/\b(loans|charges|observations|audit_events|teaching_groups)\b/i.test(sql)), "intake must not query unrelated inventory history or private groups");
    const batteryReads = reads.filter(sql => /\bFROM\s+batteries\b/i.test(sql));
    assert.ok(batteryReads.length > 0);
    assert.ok(batteryReads.every(sql => /\btag_id\s*=\s*\?/i.test(sql) || /\bLIMIT\s+1\b/i.test(sql)), "battery reads must stay bounded to the reviewed tag or automatic-number lookup");
});

test("a deliberate demo intake atomically creates one numbered asset and a native attributable receipt", async () => {
    const context = await fixture("one"), requested = input(context), receipt = await context.intake().register(requested);
    assert.equal(receipt.batteryId, "BAT-00000001"); assert.equal(receipt.tagId, requested.tagId);
    assert.equal(receipt.registeredAt, at); assert.equal(receipt.firstUsedOn, "2026-10-04"); assert.equal(receipt.manufacturedOn, null);
    assert.equal(receipt.actorAccountId, self.id); assert.equal(receipt.ownerId, `staff-${other.id}`);
    assert.deepEqual(verifyIntakeReceipt(receipt, { actorAccountId: self.id, dataset: "demo", payload: requested }), receipt);
    const saved = await state(context);
    assert.equal(saved.counters[0].last_number, 1); assert.equal(saved.sessions.length, 1);
    assert.equal(saved.batteries.length, 1); assert.equal(saved.operations.length, 1); assert.equal(saved.events.length, 1);
    assert.equal(saved.batteries[0].created_at, at); assert.equal(saved.batteries[0].first_used_on, "2026-10-04");
    assert.equal(saved.events[0].actor_id, self.id); assert.equal(saved.events[0].battery_id, receipt.batteryId);
    assert.equal(saved.observations.length, 0); assert.equal(saved.loans.length, 0);
});

test("concurrent same-name staff scans share durable inventory numbering with distinct session actors", async () => {
    const context = await fixture("concurrent"), sessions = [crypto.randomUUID(), crypto.randomUUID()];
    const receipts = await Promise.all(Array.from({ length: 10 }, (_, index) => context.intake(index % 2 ? other : self).register(input(context, { sessionId: sessions[index % 2] }))));
    assert.equal(new Set(receipts.map(receipt => receipt.batteryId)).size, 10);
    assert.deepEqual(receipts.map(receipt => receipt.batteryId).sort(), Array.from({ length: 10 }, (_, index) => `BAT-${String(index + 1).padStart(8, "0")}`));
    const saved = await state(context);
    assert.equal(saved.counters[0].last_number, 10); assert.equal(saved.sessions.length, 2);
    assert.equal(saved.batteries.length, 10); assert.equal(saved.events.length, 10); assert.equal(saved.operations.length, 10);
    assert.equal(saved.events.filter(event => event.actor_id === self.id).length, 5);
    assert.equal(saved.events.filter(event => event.actor_id === other.id).length, 5);
});

test("exact retries and lost responses preserve the original asset, first-use date and counter", async () => {
    const context = await fixture("retry"), requested = input(context), proxy = beforeAtomicCommit(async () => {}), batch = proxy.batch;
    let lost = false;
    proxy.batch = async statements => { const result = await batch(statements); if (!lost) { lost = true; throw new Error("Synthetic response loss after commit"); } return result; };
    const first = await context.intake(self, proxy).register(requested);
    assert.equal(first.replayed, true);
    const retry = await context.intake(self, db, () => new Date("2026-10-06T01:00:00Z")).register(requested);
    assert.deepEqual(retry, first); assert.equal(retry.firstUsedOn, "2026-10-04");
    await assert.rejects(context.intake().register({ ...requested, tagId: "DEMO-INTAKE-ALTERED" }), error => error.code === "idempotency_conflict");
    await assert.rejects(context.intake(other).register(requested), error => error.code === "idempotency_conflict");
    const saved = await state(context);
    assert.equal(saved.counters[0].last_number, 1); assert.equal(saved.batteries.length, 1); assert.equal(saved.events.length, 1);
});

test("a repeated or existing tag is never interpreted as a new intake or return", async () => {
    const context = await fixture("duplicate"), requested = input(context);
    const first = await context.intake().register(requested);
    await assert.rejects(context.intake().register({ ...requested, requestId: crypto.randomUUID() }), rejected(/already belongs/));
    assert.equal((await state(context)).counters[0].last_number, 1);
    const separate = await fixture("existing-tag"), tagId = "DEMO-INTAKE-ALREADY-REGISTERED";
    await separate.inventory().saveBattery({ id: "MANUAL-ASSET", ...separate.common, tagId });
    const before = await state(separate);
    await assert.rejects(separate.intake().register(input(separate, { tagId })), rejected(/already belongs/));
    assert.deepEqual(await state(separate), before);
    assert.equal(first.source, "simulated_intake");
});

test("new scanning sessions cannot change a saved setup or adopt another account's session", async () => {
    const context = await fixture("session"), requested = input(context);
    await context.intake().register(requested);
    for (const extra of [{ common: { ...requested.common, name: "Another pack" } }, { firstUseMode: "unknown" }, { common: { ...requested.common, homeRoomId: "J18-DEMO-ROOM" } }]) {
        await assert.rejects(context.intake().register(input(context, { ...extra, sessionId: requested.sessionId })), rejected(/different batch details/));
    }
    await assert.rejects(context.intake(other).register(input(context, { sessionId: requested.sessionId })), rejected(/another staff account/));
    const saved = await state(context); assert.equal(saved.batteries.length, 1); assert.equal(saved.counters[0].last_number, 1);
});

test("simulated intake rejects working inventory, arbitrary tags and client-chosen identity or source", async () => {
    const demo = await fixture("validation"), live = await fixture("validation", "live");
    await assert.rejects(live.intake().register(input(live)), status(501));
    for (const extra of [{ tagId: "REAL-RFID-001" }, { tagId: "DEMO-TAG-001" }, { tagId: "DEMO-INTAKE-" }, { tagId: `DEMO-INTAKE-${"a".repeat(128)}` }, { batteryId: "CHOSEN-ID" }, { source: "hardware" }, { common: { ...demo.common, tagId: "PER-ASSET-TAG" } }, { common: { ...demo.common, capacityMah: 0 } }]) await assert.rejects(demo.intake().register(input(demo, extra)), invalid);
    for (const context of [demo, live]) {
        const saved = await state(context);
        assert.equal(saved.batteries.length, 0); assert.equal(saved.counters.length, 0); assert.equal(saved.sessions.length, 0); assert.equal(saved.operations.length, 0);
    }
});

test("first-use modes preserve actual dates and unknown values while registration time remains server-owned", async () => {
    const context = await fixture("dates");
    const known = await context.intake().register(input(context, { firstUseMode: "date", common: { ...context.common, manufacturedOn: "2026-01-01", firstUsedOn: "2026-02-01" } }));
    assert.equal(known.firstUsedOn, "2026-02-01"); assert.equal(known.registeredAt, at);
    const unknown = await context.intake().register(input(context, { firstUseMode: "unknown", common: { ...context.common, chemistry: "", capacityMah: null, voltage: null } }));
    assert.equal(unknown.firstUsedOn, null); assert.equal(unknown.manufacturedOn, null); assert.equal(unknown.capacityMah, null); assert.equal(unknown.voltage, null);
    const before = await state(context);
    for (const extra of [{ firstUseMode: "date" }, { firstUseMode: "unknown", common: { ...context.common, firstUsedOn: "2026-01-01" } }, { common: { ...context.common, manufacturedOn: "2026-12-01" } }, { firstUseMode: "date", common: { ...context.common, manufacturedOn: "2026-02-01", firstUsedOn: "2026-01-01" } }, { firstUseMode: "date", common: { ...context.common, firstUsedOn: "2026-02-30" } }]) await assert.rejects(context.intake().register(input(context, extra)), invalid);
    assert.deepEqual(await state(context), before);
});

test("manual numeric IDs and racing manual registrations cannot collide with automatic numbering", async () => {
    const context = await fixture("manual-id");
    await context.inventory().saveBattery({ id: "BAT-00000001", ...context.common });
    const first = await context.intake().register(input(context)); assert.equal(first.batteryId, "BAT-00000002");
    const proxy = beforeAtomicCommit(async () => { await context.inventory().saveBattery({ id: "BAT-00000003", ...context.common }); });
    const next = await context.intake(self, proxy).register(input(context)); assert.equal(next.batteryId, "BAT-00000004");
    const saved = await state(context); assert.equal(saved.batteries.length, 4); assert.equal(saved.counters[0].last_number, 4); assert.equal(saved.operations.length, 2);
});

test("native authorization and inactive responsible owners block every intake allocation", async () => {
    const context = await fixture("permission");
    for (const actor of [{ ...self, id: crypto.randomUUID() }, { ...self, authVersion: 2 }, { ...self, role: "admin" }]) await assert.rejects(context.intake(actor).register(input(context)), status(403));
    try {
        await db.prepare("UPDATE staff_accounts SET active=0,auth_version=auth_version+1,version=version+1 WHERE id=?").bind(other.id).run();
        await assert.rejects(context.intake().register(input(context)), invalid);
        const saved = await state(context); assert.equal(saved.batteries.length, 0); assert.equal(saved.counters.length, 0); assert.equal(saved.sessions.length, 0); assert.equal(saved.operations.length, 0);
    } finally { await db.prepare("UPDATE staff_accounts SET active=1,auth_version=1,version=version+1 WHERE id=?").bind(other.id).run(); }
});

test("actor and owner changes at atomic commit save neither counter, session, asset nor audit", async () => {
    for (const target of [self, other]) {
        const context = await fixture(`permission-race-${target.id}`);
        try {
            const proxy = beforeAtomicCommit(async () => { await db.prepare("UPDATE staff_accounts SET active=0,auth_version=auth_version+1,version=version+1 WHERE id=?").bind(target.id).run(); });
            await assert.rejects(context.intake(self, proxy).register(input(context)), target.id === self.id ? status(403) : rejected(/owner or storage records changed/));
            const saved = await state(context); assert.equal(saved.batteries.length, 0); assert.equal(saved.counters.length, 0); assert.equal(saved.sessions.length, 0); assert.equal(saved.events.length, 0); assert.equal(saved.operations.length, 0);
        } finally { await db.prepare("UPDATE staff_accounts SET active=1,auth_version=1,version=version+1 WHERE id=?").bind(target.id).run(); }
    }
});

test("storage changes between review and commit reject the original room without guessing a replacement", async () => {
    const context = await fixture("room-race"), requested = input(context, { common: { ...context.common, homeRoomId: "J18-DEMO-ROOM" } });
    const proxy = beforeAtomicCommit(async () => { await db.prepare("UPDATE rooms SET selectable=0,version=version+1 WHERE scope=? AND id='J18-DEMO-ROOM'").bind(context.scope).run(); });
    await assert.rejects(context.intake(self, proxy).register(requested), rejected(/owner or storage records changed/));
    const saved = await state(context); assert.equal(saved.counters.length, 0); assert.equal(saved.sessions.length, 0); assert.equal(saved.batteries.length, 0);
});

test("saved model evidence is authoritative and later template edits stop an existing intake session", async () => {
    const context = await fixture("saved-model"), { modelInput, model } = await savedModel(context);
    const common = { ...context.common, ...modelFields(model), modelSelection: modelSelection(model) }, first = input(context, { common });
    const receipt = await context.intake().register(first);
    const event = (await state(context)).events[0], evidence = JSON.parse(event.details_json).modelReference;
    assert.equal(evidence.model.contentHash, model.contentHash); assert.equal(evidence.model.origin, "saved");
    await context.models(admin).update({ ...modelInput, id: model.id, expectedVersion: model.version, requestId: crypto.randomUUID(), capacityMah: 3000 });
    await assert.rejects(context.intake().register(input(context, { common, sessionId: first.sessionId })), rejected(/model or its original source records changed/));
    const saved = await state(context); assert.equal(saved.counters[0].last_number, 1); assert.equal(saved.batteries[0].id, receipt.batteryId); assert.equal(saved.batteries[0].capacity_mah, 2200);
});

test("initial saved template races reject the complete intake transaction", async () => {
    const context = await fixture("saved-model-race"), { modelInput, model } = await savedModel(context);
    const common = { ...context.common, ...modelFields(model), modelSelection: modelSelection(model) };
    const proxy = beforeAtomicCommit(async () => { await context.models(admin).update({ ...modelInput, id: model.id, expectedVersion: model.version, requestId: crypto.randomUUID(), voltage: 11.1 }); });
    await assert.rejects(context.intake(self, proxy).register(input(context, { common })), rejected(/model or its original source records changed/));
    const saved = await state(context); assert.equal(saved.counters.length, 0); assert.equal(saved.sessions.length, 0); assert.equal(saved.batteries.length, 0); assert.equal(saved.events.length, 0);
});

test("inventory model sessions freeze original source bindings while allowing repeated new same-model assets", async () => {
    const context = await fixture("inventory-model");
    await context.inventory().saveBattery({ id: "ORIGINAL-SOURCE", ...context.common });
    const model = (await context.models().list()).models.find(choice => choice.origin === "inventory");
    const common = { ...context.common, ...modelFields(model), modelSelection: modelSelection(model) }, sessionId = crypto.randomUUID();
    await Promise.all(Array.from({ length: 3 }, () => context.intake().register(input(context, { common, sessionId }))));
    const saved = await state(context); assert.equal(saved.batteries.length, 4); assert.equal(saved.sessions.length, 1); assert.equal(saved.counters[0].last_number, 3);
    for (const event of saved.events) assert.deepEqual(JSON.parse(event.details_json).modelReference.sourceBindings.map(binding => binding.id), ["ORIGINAL-SOURCE"]);
    await db.prepare("UPDATE batteries SET capacity_mah=1800,version=version+1 WHERE scope=? AND id='ORIGINAL-SOURCE'").bind(context.scope).run();
    await assert.rejects(context.intake().register(input(context, { common, sessionId })), rejected(/model or its original source records changed/));
    assert.equal((await state(context)).counters[0].last_number, 3);
    assert.equal((await state(context)).batteries.length, 4);
});

test("reference-assisted intake preserves published provenance without fabricating physical location readings", async () => {
    const context = await fixture("reference"), model = (await listReferenceModels()).find(choice => choice.capacityMah !== null && choice.voltage !== null);
    const common = { ...context.common, ...modelFields(model), modelSelection: modelSelection(model) }, sessionId = crypto.randomUUID();
    await context.intake().register(input(context, { common, sessionId }));
    await context.intake().register(input(context, { common, sessionId }));
    const saved = await state(context), reference = JSON.parse(saved.events[0].details_json).modelReference;
    assert.equal(reference.provenance.modelRecord.catalog_id, model.id);
    assert.ok(reference.provenance.sources.length > 0);
    assert.equal(saved.observations.length, 0); assert.equal(saved.loans.length, 0);
    assert.equal(saved.sessions.length, 1); assert.equal(saved.batteries.length, 2);
});

test("demo and working number scopes are separate, and durable session/counter history cannot be rewritten", async () => {
    const demo = await fixture("scope"), otherDemo = await fixture("scope-other"), live = await fixture("scope", "live");
    const first = await demo.intake().register(input(demo));
    assert.equal((await otherDemo.intake().register(input(otherDemo))).batteryId, first.batteryId);
    assert.equal((await state(live)).counters.length, 0);
    const saved = await state(demo), session = saved.sessions[0];
    await assert.rejects(db.prepare("UPDATE intake_counters SET last_number=0 WHERE scope=?").bind(demo.scope).run(), /must advance/);
    await assert.rejects(db.prepare("INSERT OR REPLACE INTO intake_counters(scope,last_number) VALUES(?,99)").bind(demo.scope).run(), /replacement forbidden/);
    await assert.rejects(db.prepare("DELETE FROM intake_counters WHERE scope=?").bind(demo.scope).run(), /cannot be deleted/);
    await assert.rejects(db.prepare("UPDATE intake_sessions SET configuration_json='{}' WHERE key=?").bind(session.key).run(), /immutable/);
    await assert.rejects(db.prepare("DELETE FROM intake_sessions WHERE key=?").bind(session.key).run(), /history cannot be deleted/);
    assert.deepEqual((await state(demo)).sessions, saved.sessions);
    assert.equal((await state(demo)).counters[0].last_number, 1);
});

test("a confirmed rejection prevents a delayed original scan committing after its owner is reactivated", async () => {
    const context = await fixture("rejected-delayed"), requested = input(context);
    let signalStarted, releaseOriginal;
    const started = new Promise(resolve => { signalStarted = resolve; }), release = new Promise(resolve => { releaseOriginal = resolve; });
    const proxy = beforeAtomicCommit(async () => { signalStarted(); await release; });
    const original = context.intake(self, proxy).register(requested).then(receipt => ({ receipt }), error => ({ error }));
    await started;
    try {
        await db.prepare("UPDATE staff_accounts SET active=0,auth_version=auth_version+1,version=version+1 WHERE id=?").bind(other.id).run();
        await assert.rejects(context.intake().register(requested), rejected(/active staff owner/));
        await db.prepare("UPDATE staff_accounts SET active=1,auth_version=1,version=version+1 WHERE id=?").bind(other.id).run();
        releaseOriginal();
        const completed = await original;
        assert.equal(completed.error.code, "intake_rejected_final");
        await assert.rejects(context.intake().register(requested), rejected(/active staff owner/));
        const saved = await state(context); assert.equal(saved.batteries.length, 0); assert.equal(saved.counters.length, 0); assert.equal(saved.sessions.length, 0); assert.equal(saved.events.length, 0);
        const operations = await rows("operations", context.scope); assert.equal(operations.length, 1); assert.equal(operations[0].kind, "simulated_intake_rejected");
    } finally { releaseOriginal(); await db.prepare("UPDATE staff_accounts SET active=1,auth_version=1,version=version+1 WHERE id=?").bind(other.id).run(); }
});

test("a success that wins against a delayed rejection returns its receipt instead of claiming the scan failed", async () => {
    const context = await fixture("success-rejection-race"), requested = input(context);
    let signalOriginal, releaseOriginal, signalRejection, releaseRejection;
    const originalStarted = new Promise(resolve => { signalOriginal = resolve; }), originalRelease = new Promise(resolve => { releaseOriginal = resolve; });
    const rejectionStarted = new Promise(resolve => { signalRejection = resolve; }), rejectionRelease = new Promise(resolve => { releaseRejection = resolve; });
    const originalProxy = beforeAtomicCommit(async () => { signalOriginal(); await originalRelease; });
    const rejectionProxy = beforeAtomicCommit(async () => { signalRejection(); await rejectionRelease; }, "simulated_intake_rejected");
    const original = context.intake(self, originalProxy).register(requested);
    await originalStarted;
    try {
        await db.prepare("UPDATE staff_accounts SET active=0,auth_version=auth_version+1,version=version+1 WHERE id=?").bind(other.id).run();
        const reservation = context.intake(self, rejectionProxy).register(requested);
        await rejectionStarted;
        await db.prepare("UPDATE staff_accounts SET active=1,auth_version=1,version=version+1 WHERE id=?").bind(other.id).run();
        releaseOriginal(); const first = await original;
        releaseRejection(); const competing = await reservation;
        assert.deepEqual(competing, { ...first, replayed: true });
        const saved = await state(context); assert.equal(saved.batteries.length, 1); assert.equal(saved.counters[0].last_number, 1); assert.equal(saved.events.length, 1); assert.equal(saved.operations.length, 1);
        assert.equal((await rows("operations", context.scope)).filter(row => row.kind === "simulated_intake_rejected").length, 0);
    } finally { releaseOriginal(); releaseRejection(); await db.prepare("UPDATE staff_accounts SET active=1,auth_version=1,version=version+1 WHERE id=?").bind(other.id).run(); }
});

test("an unconfirmed rejection reservation remains uncertain and preserves the scan for a safe retry", async () => {
    const context = await fixture("rejection-storage-failure"), requested = input(context);
    try {
        await db.prepare("UPDATE staff_accounts SET active=0,auth_version=auth_version+1,version=version+1 WHERE id=?").bind(other.id).run();
        const proxy = beforeAtomicCommit(async () => { throw new Error("Synthetic storage outage before reserving rejection"); }, "simulated_intake_rejected");
        await assert.rejects(context.intake(self, proxy).register(requested), error => !error.status && /storage outage/.test(error.message));
        assert.equal((await rows("operations", context.scope)).length, 0);
        await db.prepare("UPDATE staff_accounts SET active=1,auth_version=1,version=version+1 WHERE id=?").bind(other.id).run();
        const receipt = await context.intake().register(requested);
        assert.equal(receipt.batteryId, "BAT-00000001"); assert.equal(receipt.requestId, requested.requestId);
        assert.equal((await state(context)).batteries.length, 1);
    } finally { await db.prepare("UPDATE staff_accounts SET active=1,auth_version=1,version=version+1 WHERE id=?").bind(other.id).run(); }
});
