import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Miniflare } from "miniflare";
import { AccountStore } from "../work/qa/accounts.mjs";
import { InventoryStore } from "../work/qa/store.mjs";
import { createExport } from "../work/qa/exports.mjs";
import { summaryCsv } from "../work/qa/downloads.mjs";
import { parseCsv } from "../work/qa/client-utils.mjs";

const mf = new Miniflare({ modules: true, script: "export default {fetch(){return new Response('traceability-test')}}", compatibilityDate: "2026-05-15", d1Databases: { DB: "directory-import-traceability" }, d1Persist: false });
const db = await mf.getD1Database("DB"), journal = JSON.parse(await readFile("drizzle/meta/_journal.json", "utf8"));
for (const entry of journal.entries) await db.batch((await readFile(`drizzle/${entry.tag}.sql`, "utf8")).split("--> statement-breakpoint").filter(sql => sql.trim()).map(sql => db.prepare(sql)));
after(() => mf.dispose());

const now = new Date("2026-10-03T02:00:00.000Z"), accounts = new AccountStore(db, () => now);
const password = "Traceability-verification-password-2026";
const admin = await accounts.create({ username: "traceability-admin", displayName: "Traceability Administrator", role: "admin", password });
const firstStaff = await accounts.create({ username: "traceability-first", displayName: "Original Registering Staff", role: "staff", password }, admin);
const secondStaff = await accounts.create({ username: "traceability-second", displayName: "Second Registering Staff", role: "staff", password }, admin);
const actor = user => ({ id: user.id, name: user.displayName, role: user.role, authVersion: user.authVersion });
const inventory = (scope, user = admin, database = db) => new InventoryStore(database, scope, "live", actor(user), () => now);
const asset = (id, owner = firstStaff, extra = {}) => ({ id, name: "Imported battery", ownerId: `staff-${owner.id}`, homeBuildingId: "J18", ...extra });
const uuid = () => crypto.randomUUID(), status = code => error => error.status === code;
const details = row => JSON.parse(row.details_json);

test("current staff directory names agree with downloads without rewriting historical borrower or actor names", async () => {
    const scope = "directory-rename:live", store = inventory(scope, firstStaff);
    await store.saveBattery(asset("NAME-CHECK"));
    await store.movement({ requestId: uuid(), kind: "checkout", batteryIds: ["NAME-CHECK"] });
    const renamed = await accounts.update({ id: firstStaff.id, expectedVersion: firstStaff.version, displayName: "Current Registering Staff" }, firstStaff, true);
    const current = inventory(scope, renamed), snapshot = await current.snapshot();
    const visible = snapshot.people.find(person => person.accountId === firstStaff.id);
    assert.equal(visible.name, renamed.displayName);
    const document = await createExport(current, { dataset: "live", mode: "records", kind: "people", search: renamed.displayName });
    assert.equal(document.tables.people.length, 1);
    assert.equal(document.tables.people[0].id, visible.id);
    assert.equal(document.tables.people[0].account_id, firstStaff.id);
    assert.equal(document.tables.people[0].name, renamed.displayName);
    assert.equal(parseCsv(summaryCsv(document))[0].name, renamed.displayName);
    assert.equal(await db.prepare("SELECT name FROM people WHERE scope=? AND account_id=?").bind(scope, firstStaff.id).first("name"), firstStaff.displayName);
    const full = await createExport(current, { dataset: "live", mode: "detail", batteryId: "NAME-CHECK" });
    assert.equal(full.tables.People[0].name, renamed.displayName);
    assert.equal(full.tables.Batteries[0].owner_name, renamed.displayName);
    assert.equal(full.tables.Loans[0].borrower_name, firstStaff.displayName);
    assert.equal(full.tables.Loans[0].checkout_actor_name, firstStaff.displayName);
    assert.ok(full.tables.Operations.every(event => event.actor_name === firstStaff.displayName));
    const detail = await current.detail("NAME-CHECK");
    assert.equal(detail.loans[0].borrowerName, firstStaff.displayName);
    assert.ok(detail.events.every(event => event.actorName === firstStaff.displayName));
});

test("batch registrations link each battery and its actor to exactly its own import summary", async () => {
    const scope = "import-links:live", first = inventory(scope, await accounts.user(firstStaff.id)), second = inventory(scope, secondStaff), reviewer = inventory(scope);
    const receipt = await first.importRecords("batteries", [asset("FIRST-ONE", firstStaff, { capacityMah: 2200, tagId: "TAG-FIRST-ONE" }), asset("FIRST-TWO")]);
    const unrelated = await second.importRecords("batteries", [asset("UNRELATED", secondStaff)]);
    for (const [action, evidence] of [["records_imported", { kind: "batteries", count: 1 }], ["demo_initialized", { note: "Unlinked historical setup event" }]])
        await db.prepare("INSERT INTO audit_events(id,scope,action,battery_id,actor_id,actor_name,at,details_json) VALUES(?,?,?,?,?,?,?,?)").bind(uuid(), scope, action, null, secondStaff.id, secondStaff.displayName, now.toISOString(), JSON.stringify(evidence)).run();
    for (const id of ["FIRST-ONE", "FIRST-TWO"]) {
        const detail = await reviewer.detail(id);
        assert.equal(detail.events.length, 2);
        const registration = detail.events.find(event => event.action === "battery_registered"), summary = detail.events.find(event => event.action === "records_imported");
        assert.equal(registration.batteryId, id);
        assert.equal(registration.actorName, (await accounts.user(firstStaff.id)).displayName);
        assert.equal(registration.details.after.id, id);
        assert.equal(registration.details.after.version, 1);
        assert.equal(registration.details.registrationSource, "csv");
        assert.equal(registration.details.importRequestId, receipt.requestId);
        assert.equal(summary.details.requestId, receipt.requestId);
        assert.deepEqual(summary.details.batteryIds, ["FIRST-ONE", "FIRST-TWO"]);
        assert.equal(summary.details.count, 2);
        assert.equal(summary.actorName, registration.actorName);
        const exported = await createExport(reviewer, { dataset: "live", mode: "detail", batteryId: id, sections: ["audit"] });
        assert.equal(exported.tables.Operations.length, 2);
        assert.ok(exported.tables.Operations.every(event => event.actor_id === firstStaff.id));
        assert.deepEqual(exported.tables.Operations.map(event => event.id).sort(), detail.events.map(event => event.id).sort());
        assert.equal(details(exported.tables.Operations.find(event => event.action === "records_imported")).requestId, receipt.requestId);
    }
    const selected = await createExport(reviewer, { dataset: "live", mode: "detail", range: "selected", batteryIds: ["FIRST-ONE", "FIRST-TWO"], sections: ["audit"] });
    assert.equal(selected.tables.Operations.filter(event => event.action === "records_imported").length, 1);
    assert.equal(selected.tables.Operations.filter(event => event.action === "battery_registered").length, 2);
    const other = await reviewer.detail("UNRELATED");
    assert.equal(other.events.length, 2);
    assert.ok(other.events.every(event => event.actorName === secondStaff.displayName));
    assert.equal(other.events.find(event => event.action === "records_imported").details.requestId, unrelated.requestId);
    const all = await reviewer.fullActivity();
    assert.equal(all.filter(event => event.action === "records_imported").length, 3);
    assert.equal(all.filter(event => event.action === "demo_initialized").length, 1);
});

test("200-row imports retain complete per-asset audit evidence within prepared-statement bind limits", async () => {
    const scope = "import-limit:live", bindCounts = [];
    const guardedDatabase = { prepare: sql => {
        const prepared = db.prepare(sql);
        return { bind: (...values) => { bindCounts.push(values.length); assert.ok(values.length <= 100, "D1 statement parameter limit exceeded"); return prepared.bind(...values); } };
    }, batch: statements => db.batch(statements) };
    const store = inventory(scope, await accounts.user(firstStaff.id), guardedDatabase);
    const rows = Array.from({ length: 200 }, (_, index) => asset(`BULK-${String(index).padStart(3, "0")}`, index % 2 ? firstStaff : secondStaff));
    const receipt = await store.importRecords("batteries", rows);
    assert.equal(receipt.count, 200);
    assert.equal((await store.snapshot()).batteries.length, 200);
    const exported = await createExport(store, { dataset: "live", mode: "detail", sections: ["audit"] });
    assert.equal(exported.tables.Operations.filter(event => event.action === "battery_registered").length, 200);
    const summaries = exported.tables.Operations.filter(event => event.action === "records_imported");
    assert.equal(summaries.length, 1);
    assert.equal(details(summaries[0]).batteryIds.length, 200);
    assert.equal(details(summaries[0]).requestId, receipt.requestId);
    const tail = await store.detail("BULK-199");
    assert.equal(tail.events.length, 2);
    assert.ok(bindCounts.length > 400);
});

test("import conflicts and authorization races roll back per-battery registrations and batch summaries together", async () => {
    const scope = "import-rollback:live", store = inventory(scope, secondStaff);
    await store.saveBattery(asset("EXISTING", secondStaff, { tagId: "CONFLICT-TAG" }));
    const rows = Array.from({ length: 200 }, (_, index) => asset(`REJECTED-${index}`, secondStaff, { tagId: index === 173 ? "CONFLICT-TAG" : `UNUSED-${index}` }));
    await assert.rejects(store.importRecords("batteries", rows), status(409));
    assert.deepEqual((await store.snapshot()).batteries.map(battery => battery.id), ["EXISTING"]);
    assert.equal(await db.prepare("SELECT COUNT(*) FROM audit_events WHERE scope=? AND action='records_imported'").bind(scope).first("COUNT(*)"), 0);
    assert.equal(await db.prepare("SELECT COUNT(*) FROM audit_events WHERE scope=? AND action='battery_registered' AND battery_id!='EXISTING'").bind(scope).first("COUNT(*)"), 0);
    assert.equal(await db.prepare("SELECT COUNT(*) FROM operations WHERE scope=? AND kind='records_imported'").bind(scope).first("COUNT(*)"), 0);

    let importer = await accounts.create({ username: "traceability-revoked", displayName: "Revoked Importer", role: "staff", password }, admin), intercepted = false;
    const statementSql = new WeakMap(), racedDatabase = { prepare: sql => {
        const prepared = db.prepare(sql);
        return { bind: (...values) => { const bound = prepared.bind(...values); statementSql.set(bound, sql); return bound; } };
    }, batch: async statements => {
        if (!intercepted && statements.some(statement => /^INSERT INTO operations\(/.test(statementSql.get(statement) ?? ""))) {
            intercepted = true;
            importer = await accounts.update({ id: importer.id, expectedVersion: importer.version, displayName: importer.displayName, active: false }, admin);
        }
        return db.batch(statements);
    } };
    const raced = inventory("import-access-race:live", importer, racedDatabase);
    await assert.rejects(raced.importRecords("batteries", [asset("REVOKED-ROW", secondStaff)]), status(409));
    assert.equal(intercepted, true);
    assert.equal(await db.prepare("SELECT COUNT(*) FROM batteries WHERE scope=?").bind("import-access-race:live").first("COUNT(*)"), 0);
    assert.equal(await db.prepare("SELECT COUNT(*) FROM audit_events WHERE scope=?").bind("import-access-race:live").first("COUNT(*)"), 0);
    assert.equal(await db.prepare("SELECT COUNT(*) FROM operations WHERE scope=?").bind("import-access-race:live").first("COUNT(*)"), 0);
});
