import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Miniflare } from "miniflare";
import { BatteryModelStore } from "../work/qa/battery-model-store.mjs";
import { InventoryStore } from "../work/qa/store.mjs";

const mf = new Miniflare({ modules: true, script: "export default {fetch(){return new Response('battery-model-test')}}", compatibilityDate: "2026-05-15", d1Databases: { DB: "battery-model-test" }, d1Persist: false });
const db = await mf.getD1Database("DB"), journal = JSON.parse(await readFile("drizzle/meta/_journal.json", "utf8"));
for (const entry of journal.entries) {
    const sql = await readFile(`drizzle/${entry.tag}.sql`, "utf8");
    await db.batch(sql.split("--> statement-breakpoint").filter(statement => statement.trim()).map(statement => db.prepare(statement)));
}
after(() => mf.dispose());

const at = "2026-10-03T01:00:00.000Z";
const admin = { id: crypto.randomUUID(), displayName: "Model Administrator", role: "admin", authVersion: 1 };
const self = { id: crypto.randomUUID(), displayName: "Shared Staff Name", role: "staff", authVersion: 1 };
const other = { id: crypto.randomUUID(), displayName: "Shared Staff Name", role: "staff", authVersion: 1 };
const secondAdmin = { id: crypto.randomUUID(), displayName: "Second Model Administrator", role: "admin", authVersion: 1 };
for (const [index, actor] of [admin, self, other, secondAdmin].entries()) await db.prepare("INSERT INTO staff_accounts(id,username,display_name,role,password_hash,password_salt,hash_iterations,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)")
    .bind(actor.id, `model-actor-${index}`, actor.displayName, actor.role, "test-only-no-login", "test-only-no-login", 600000, at, at).run();

const status = expected => error => error.status === expected;
const invalid = error => error.name === "ZodError" || error.status === 400;
const rows = async (table, scope) => (await db.prepare(`SELECT * FROM ${table} WHERE scope=? ORDER BY rowid`).bind(scope).all()).results;
const draft = (extra = {}) => ({ id: crypto.randomUUID(), brand: "Example Brand", model: "EP-2200", variant: "2-cell pack", name: "Example rechargeable pack", chemistry: "LiPo", capacityMah: 2200, voltage: 7.4, notes: "Taken from the physical product label.", ...extra });
const selection = model => ({ origin: model.origin, id: model.id, contentHash: model.contentHash, confirmed: true, appliedFields: ["name", "model", "chemistry", "capacityMah", "voltage"] });

async function fixture(name, dataset = "demo") {
    const scope = `battery-model-${name}:${dataset}`;
    const inventory = (actor = admin) => new InventoryStore(db, scope, dataset, { id: actor.id, name: actor.displayName, role: actor.role, authVersion: actor.authVersion }, () => new Date(at));
    await inventory().snapshot();
    return {
        scope, dataset, inventory,
        models: (actor = self, database = db, clock = () => new Date(at)) => new BatteryModelStore(database, scope, dataset, actor, clock),
        battery: async (id, extra = {}) => inventory().saveBattery({ id, name: "Individually labelled asset", model: "EXISTING-2200", chemistry: "LiPo", capacityMah: 2200, voltage: 7.4, ownerId: `staff-${self.id}`, homeBuildingId: "J18", homeRoomId: "J18-DEMO-ROOM", ...extra }),
    };
}
function beforeAtomicCommit(intervene) {
    const sqlByStatement = new WeakMap();
    let intercepted = false;
    return {
        prepare: sql => {
            const statement = db.prepare(sql);
            return { bind: (...values) => { const bound = statement.bind(...values); sqlByStatement.set(bound, sql); return bound; } };
        },
        batch: async statements => {
            if (!intercepted && statements.some(statement => /^INSERT INTO operations\(/.test(sqlByStatement.get(statement) ?? ""))) { intercepted = true; await intervene(); }
            return db.batch(statements);
        },
    };
}

test("ordinary staff create one reusable model for all staff without registering a physical battery", async () => {
    const context = await fixture("shared"), created = await context.models().create(draft());
    const viewed = await context.models(other).list();
    assert.equal(viewed.models.length, 1);
    assert.deepEqual(viewed.models[0], created.model);
    assert.equal(created.actorAccountId, self.id);
    assert.equal(created.model.verificationStatus, "staff_entered");
    assert.equal(created.model.origin, "saved");
    assert.equal(created.model.sources.length, 0);
    assert.match(created.model.contentHash, /^[a-f0-9]{64}$/);
    assert.equal((await rows("batteries", context.scope)).length, 0);
    assert.equal((await rows("loans", context.scope)).length, 0);
    const events = await rows("audit_events", context.scope);
    assert.equal(events.length, 1); assert.equal(events[0].actor_id, self.id);
    assert.equal(JSON.parse(events[0].details_json).model.contentHash, created.model.contentHash);
});

test("demonstration model templates remain separate from working inventory templates", async () => {
    const demo = await fixture("isolation"), live = await fixture("isolation", "live"), input = draft();
    const demoModel = await demo.models().create(input);
    assert.equal((await live.models().list()).models.length, 0);
    await assert.rejects(live.models().resolve(selection(demoModel.model)), error => error.code === "model_conflict");
    const liveModel = await live.models(other).create(input);
    assert.equal(liveModel.actorAccountId, other.id);
    assert.equal((await demo.models().list()).models.length, 1);
    assert.equal((await live.models().list()).models.length, 1);
});

test("unknown model specifications remain null and physical identity, ownership and storage are not accepted", async () => {
    const context = await fixture("unknown"), input = { id: crypto.randomUUID(), name: "Unknown battery model", model: "UNKNOWN-MODEL" };
    const created = await context.models().create(input);
    assert.equal(created.model.capacityMah, null); assert.equal(created.model.voltage, null); assert.equal(created.model.chemistry, "");
    for (const extra of [{ capacityMah: 0 }, { voltage: 0 }, { capacityMah: -1 }, { voltage: Infinity }, { tagId: "ASSET-TAG" }, { ownerId: self.id }, { manufacturedOn: "2026-01-01" }, { homeRoomId: "J18-DEMO-ROOM" }]) {
        await assert.rejects(context.models().create({ ...input, id: crypto.randomUUID(), ...extra }), invalid);
    }
    assert.equal((await rows("battery_models", context.scope)).length, 1);
});

test("exact creation retries retain the first receipt and author without duplicate models or events", async () => {
    const context = await fixture("retry"), input = draft(), first = await context.models().create(input);
    const retry = await context.models(self, db, () => new Date("2026-10-04T01:00:00Z")).create(input);
    assert.deepEqual(retry, { ...first, replayed: true });
    assert.equal(retry.model.createdAt, at);
    await assert.rejects(context.models().create({ ...input, voltage: 11.1 }), error => error.code === "idempotency_conflict");
    await assert.rejects(context.models(other).create(input), error => error.code === "idempotency_conflict");
    assert.equal((await rows("battery_models", context.scope)).length, 1);
    assert.equal((await rows("operations", context.scope)).length, 1);
    assert.equal((await rows("audit_events", context.scope)).length, 1);
});

test("a lost success response safely retries its original model draft", async () => {
    const context = await fixture("response-lost"), input = draft();
    const wrapped = beforeAtomicCommit(async () => {}), originalBatch = wrapped.batch;
    let lost = false;
    wrapped.batch = async statements => {
        const result = await originalBatch(statements);
        if (!lost) { lost = true; throw new Error("Synthetic connection loss after commit"); }
        return result;
    };
    // The create method can establish its committed receipt even if the D1 response is lost.
    const result = await context.models(self, wrapped).create(input);
    assert.equal(result.replayed, true);
    assert.equal(result.requestId, input.id);
    assert.equal((await rows("battery_models", context.scope)).length, 1);
    assert.equal((await rows("audit_events", context.scope)).length, 1);
});

test("normalized brand/model/variant duplicates reject atomically while explicit variants remain reusable", async () => {
    const context = await fixture("duplicates"), input = draft({ brand: "Example   Brand", model: "EP-2200", variant: "2-cell pack" });
    await context.models().create(input);
    await assert.rejects(context.models(other).create(draft({ brand: " example brand ", model: "ep-2200", variant: "2-CELL   PACK", capacityMah: 2500 })), error => error.code === "model_duplicate");
    const variant = await context.models(other).create(draft({ brand: "Example Brand", model: "EP-2200", variant: "3-cell pack", voltage: 11.1 }));
    assert.equal(variant.model.voltage, 11.1);
    assert.equal((await rows("battery_models", context.scope)).length, 2);
    assert.equal((await rows("operations", context.scope)).length, 2);
    assert.equal((await rows("audit_events", context.scope)).length, 2);
});

test("competing staff model registrations save a duplicate identity once", async () => {
    const context = await fixture("duplicate-race"), input = draft();
    const results = await Promise.allSettled([context.models().create(input), context.models(other).create({ ...input, id: crypto.randomUUID() })]);
    assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
    assert.equal(results.find(result => result.status === "rejected").reason.code, "model_duplicate");
    assert.equal((await rows("battery_models", context.scope)).length, 1);
    assert.equal((await rows("operations", context.scope)).length, 1);
    assert.equal((await rows("audit_events", context.scope)).length, 1);
});

test("native account authorization is required for viewing, creation and replay", async () => {
    const context = await fixture("authorization"), input = draft();
    await context.models().create(input);
    for (const actor of [{ ...self, id: crypto.randomUUID() }, { ...self, authVersion: 2 }, { ...self, role: "admin" }]) {
        await assert.rejects(context.models(actor).list(), status(403));
        await assert.rejects(context.models(actor).create(input), status(403));
    }
    try {
        await db.prepare("UPDATE staff_accounts SET active=0,auth_version=auth_version+1,version=version+1 WHERE id=?").bind(self.id).run();
        await assert.rejects(context.models().list(), status(403));
        await assert.rejects(context.models().create(input), status(403));
    } finally { await db.prepare("UPDATE staff_accounts SET active=1,auth_version=1,version=version+1 WHERE id=?").bind(self.id).run(); }
    assert.equal((await rows("battery_models", context.scope)).length, 1);
});

test("account changes between validation and atomic commit save neither model nor audit", async () => {
    const context = await fixture("authorization-race");
    try {
        const proxy = beforeAtomicCommit(async () => { await db.prepare("UPDATE staff_accounts SET active=0,auth_version=auth_version+1,version=version+1 WHERE id=?").bind(self.id).run(); });
        await assert.rejects(context.models(self, proxy).create(draft()), status(403));
        assert.equal((await rows("battery_models", context.scope)).length, 0);
        assert.equal((await rows("operations", context.scope)).length, 0);
        assert.equal((await rows("audit_events", context.scope)).length, 0);
    } finally { await db.prepare("UPDATE staff_accounts SET active=1,auth_version=1,version=version+1 WHERE id=?").bind(self.id).run(); }
});

test("registered battery specifications are reused only when every same-code record agrees", async () => {
    const context = await fixture("inventory-values");
    await context.battery("BAT-ONE"); await context.battery("BAT-TWO");
    const listed = await context.models().list(), model = listed.models.find(choice => choice.origin === "inventory");
    assert.equal(model.model, "EXISTING-2200"); assert.equal(model.name, "EXISTING-2200");
    assert.equal(model.capacityMah, 2200); assert.equal(model.verificationStatus, "registered_asset_values");
    const resolved = await context.models().resolve(selection(model));
    assert.deepEqual(resolved.snapshot.sourceBindings.map(binding => binding.id), ["BAT-ONE", "BAT-TWO"]);
    assert.equal((await db.prepare(`SELECT (${resolved.guardSql}) AS allowed`).bind(...resolved.guardValues).first()).allowed, 1);
    await context.battery("BAT-THREE", { capacityMah: null });
    const changed = await context.models().list();
    assert.equal(changed.models.filter(choice => choice.origin === "inventory").length, 0);
    assert.equal(changed.issues.length, 1); assert.match(changed.issues[0].message, /different specifications/);
    await assert.rejects(context.models().resolve(selection(model)), error => error.code === "model_conflict");
    assert.equal((await db.prepare(`SELECT (${resolved.guardSql}) AS allowed`).bind(...resolved.guardValues).first()).allowed, 0);
});

test("source asset version changes invalidate a previously reviewed inventory model", async () => {
    const context = await fixture("inventory-version"); await context.battery("BAT-ONE");
    const model = (await context.models().list()).models[0], resolved = await context.models().resolve(selection(model));
    const before = (await context.inventory().snapshot()).batteries[0];
    await context.inventory().saveBattery({ ...before, name: "Updated individual asset name", expectedVersion: before.version }, true);
    const updated = (await context.models().list()).models[0];
    assert.notEqual(updated.contentHash, model.contentHash);
    assert.equal(updated.capacityMah, model.capacityMah);
    await assert.rejects(context.models().resolve(selection(model)), error => error.code === "model_conflict");
    assert.equal((await db.prepare(`SELECT (${resolved.guardSql}) AS allowed`).bind(...resolved.guardValues).first()).allowed, 0);
});

test("saved choices retain unknown values and resolve only with the exact immutable details", async () => {
    const context = await fixture("saved-resolution"), created = await context.models().create(draft({ capacityMah: null, voltage: null, chemistry: "" }));
    const resolved = await context.models(other).resolve(selection(created.model));
    assert.equal(resolved.snapshot.model.capacityMah, null); assert.equal(resolved.snapshot.model.voltage, null);
    assert.equal((await db.prepare(`SELECT (${resolved.guardSql}) AS allowed`).bind(...resolved.guardValues).first()).allowed, 1);
    await assert.rejects(context.models().resolve({ ...selection(created.model), contentHash: "0".repeat(64) }), error => error.code === "model_conflict");
    await assert.rejects(context.models().resolve({ ...selection(created.model), confirmed: false }), invalid);
    await assert.rejects(context.models().resolve({ ...selection(created.model), appliedFields: ["tagId"] }), invalid);
});

test("D1 triggers reject replacement, identity rewrites, unversioned edits and deletion of saved model evidence", async () => {
    const context = await fixture("immutable"), created = await context.models().create(draft());
    const before = (await rows("battery_models", context.scope))[0];
    await assert.rejects(db.prepare("INSERT OR REPLACE INTO battery_models(key,scope,id,identity_key,brand,model,variant,name,chemistry,capacity_mah,voltage,notes,version,created_at,created_by,actor_name,updated_at,updated_by,updated_actor_name) SELECT key,scope,id,identity_key,brand,model,variant,'Replaced model',chemistry,capacity_mah,voltage,notes,1,created_at,created_by,actor_name,created_at,created_by,actor_name FROM battery_models WHERE key=?").bind(before.key).run(), /replacement forbidden/);
    await assert.rejects(db.prepare("UPDATE battery_models SET name='Edited model' WHERE key=?").bind(before.key).run(), /version must advance/);
    await assert.rejects(db.prepare("UPDATE battery_models SET id='REWRITTEN',version=version+1,updated_by=? WHERE key=?").bind(admin.id, before.key).run(), /identity is immutable/);
    await assert.rejects(db.prepare("UPDATE battery_models SET name='Edited model',version=version+1 WHERE key=?").bind(before.key).run(), /active administrator/);
    await assert.rejects(db.prepare("DELETE FROM battery_models WHERE key=?").bind(before.key).run(), /history cannot be deleted/);
    assert.deepEqual((await rows("battery_models", context.scope))[0], before);
    assert.equal((await context.models().list()).models[0].contentHash, created.model.contentHash);
});

function editPayload(input, choice, extra = {}) {
    return { ...input, id: choice.id, expectedVersion: choice.version, requestId: crypto.randomUUID(), ...extra };
}

test("administrators edit reusable model versions while preserving creation evidence and prior receipts", async () => {
    const context = await fixture("admin-update"), input = draft(), created = await context.models().create(input), selectedBefore = selection(created.model);
    const resolvedBefore = await context.models().resolve(selectedBefore);
    const edit = editPayload(input, created.model, { name: "Corrected reusable model label", notes: "Corrected product label transcription.", capacityMah: 2500 });
    await assert.rejects(context.models().update(edit), status(403));
    const updated = await context.models(admin).update(edit);
    assert.equal(updated.model.version, 2); assert.equal(updated.model.capacityMah, 2500);
    assert.notEqual(updated.model.contentHash, created.model.contentHash);
    assert.equal(updated.model.actorName, self.displayName); assert.equal(updated.model.createdAt, created.model.createdAt);
    assert.equal(updated.requestId, edit.requestId); assert.equal(updated.actorAccountId, admin.id);
    assert.deepEqual(await context.models(admin).update(edit), { ...updated, replayed: true });
    await assert.rejects(context.models(secondAdmin).update(edit), error => error.code === "idempotency_conflict");
    assert.deepEqual(await context.models().create(input), { ...created, replayed: true });
    await assert.rejects(context.models().resolve(selectedBefore), error => error.code === "model_conflict");
    assert.equal((await db.prepare(`SELECT (${resolvedBefore.guardSql}) AS allowed`).bind(...resolvedBefore.guardValues).first()).allowed, 0);
    const events = await rows("audit_events", context.scope);
    assert.equal(events.length, 2);
    const editEvent = events.find(event => event.action === "battery_model_updated"), details = JSON.parse(editEvent.details_json);
    assert.equal(editEvent.actor_id, admin.id);
    assert.equal(details.before.version, 1); assert.equal(details.before.capacityMah, 2200);
    assert.equal(details.after.version, 2); assert.equal(details.after.capacityMah, 2500);
    assert.equal((await rows("battery_models", context.scope))[0].created_by, self.id);
    assert.equal((await rows("battery_models", context.scope))[0].updated_by, admin.id);
});

test("stale and competing administrator model edits cannot overwrite reviewed newer versions", async () => {
    const context = await fixture("update-race"), input = draft(), created = await context.models().create(input);
    const first = editPayload(input, created.model, { notes: "First independent review." }), second = editPayload(input, created.model, { notes: "Second independent review." });
    const results = await Promise.allSettled([context.models(admin).update(first), context.models(admin).update(second)]);
    assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
    assert.equal(results.find(result => result.status === "rejected").reason.code, "model_conflict");
    const current = (await context.models().list()).models[0]; assert.equal(current.version, 2);
    await assert.rejects(context.models(admin).update(editPayload(input, created.model, { notes: "Stale later attempt." })), error => error.code === "model_conflict");
    assert.equal((await rows("audit_events", context.scope)).length, 2);
    assert.equal((await rows("operations", context.scope)).length, 2);
});

test("administrator model edits cannot collide with another saved identity or reuse another request's payload", async () => {
    const context = await fixture("update-duplicates"), input = draft(), created = await context.models().create(input);
    await context.models().create(draft({ variant: "3-cell pack", voltage: 11.1 }));
    await assert.rejects(context.models(admin).update(editPayload(input, created.model, { variant: "3-cell pack" })), error => error.code === "model_duplicate");
    const edit = editPayload(input, created.model, { notes: "First submitted model edit." }), updated = await context.models(admin).update(edit);
    await assert.rejects(context.models(admin).update({ ...edit, notes: "Changed uncertain edit." }), error => error.code === "idempotency_conflict");
    assert.equal(updated.model.version, 2);
    assert.equal((await rows("battery_models", context.scope)).length, 2);
    assert.equal((await rows("audit_events", context.scope)).length, 3);
});

test("administrator access changes at update commit preserve the old template and its history", async () => {
    const context = await fixture("update-auth-race"), input = draft(), created = await context.models().create(input), edit = editPayload(input, created.model, { notes: "Review interrupted by access change." });
    try {
        const proxy = beforeAtomicCommit(async () => { await db.prepare("UPDATE staff_accounts SET role='staff',auth_version=auth_version+1,version=version+1 WHERE id=?").bind(admin.id).run(); });
        await assert.rejects(context.models(admin, proxy).update(edit), status(403));
        assert.equal((await context.models().list()).models[0].version, 1);
        assert.equal((await rows("operations", context.scope)).length, 1);
        assert.equal((await rows("audit_events", context.scope)).length, 1);
    } finally { await db.prepare("UPDATE staff_accounts SET role='admin',auth_version=1,version=version+1 WHERE id=?").bind(admin.id).run(); }
});

test("a lost administrator edit response replays once and does not modify already registered assets", async () => {
    const context = await fixture("update-response-lost"), input = draft(), created = await context.models().create(input);
    await context.battery("BAT-EXISTING", { model: input.model, capacityMah: input.capacityMah, voltage: input.voltage });
    const physicalBefore = (await context.inventory().snapshot()).batteries[0], edit = editPayload(input, created.model, { capacityMah: 3000, voltage: 11.1 });
    const wrapped = beforeAtomicCommit(async () => {}), originalBatch = wrapped.batch;
    let lost = false;
    wrapped.batch = async statements => {
        const result = await originalBatch(statements);
        if (!lost) { lost = true; throw new Error("Synthetic connection loss after template update"); }
        return result;
    };
    const updated = await context.models(admin, wrapped).update(edit);
    assert.equal(updated.replayed, true); assert.equal(updated.model.version, 2);
    assert.equal(updated.model.capacityMah, 3000); assert.equal(updated.model.voltage, 11.1);
    assert.deepEqual((await context.inventory().snapshot()).batteries[0], physicalBefore);
    assert.equal((await rows("audit_events", context.scope)).filter(event => event.action === "battery_model_updated").length, 1);
});
