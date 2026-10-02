import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Miniflare } from "miniflare";
import { AccountStore } from "../work/qa/accounts.mjs";
import { InventoryStore } from "../work/qa/store.mjs";
import { createExport } from "../work/qa/exports.mjs";

const mf = new Miniflare({ modules: true, script: "export default {fetch(){return new Response('workflow-test')}}", compatibilityDate: "2026-05-15", d1Databases: { DB: "workflow-reliability" }, d1Persist: false });
const db = await mf.getD1Database("DB"), journal = JSON.parse(await readFile("drizzle/meta/_journal.json", "utf8"));
async function migrate(database, entries = journal.entries) {
    for (const entry of entries) await database.batch((await readFile(`drizzle/${entry.tag}.sql`, "utf8")).split("--> statement-breakpoint").filter(sql => sql.trim()).map(sql => database.prepare(sql)));
}
await migrate(db);
after(() => mf.dispose());
let now = new Date("2026-10-02T02:00:00.000Z");
const accounts = new AccountStore(db, () => now), uuid = () => crypto.randomUUID(), status = code => error => error.status === code;
const password = "Workflow-verification-password-2026";
const admin = await accounts.create({ username: "workflow-admin", displayName: "Workflow Administrator", role: "admin", password });
const staff = await accounts.create({ username: "workflow-staff", displayName: "Responsible Staff", role: "staff", password }, admin);
const otherStaff = await accounts.create({ username: "workflow-receiver", displayName: "Receiving Staff", role: "staff", password }, admin);
const actor = user => ({ id: user.id, name: user.displayName, role: user.role, authVersion: user.authVersion });
const inventory = (scope, user = admin, database = db) => new InventoryStore(database, scope, "demo", actor(user), () => now);
async function fixture(scope) { const store = inventory(scope); await store.initializeDemo(); return store; }
const checkout = (store, batteryIds, requestId = uuid()) => store.movement({ requestId, kind: "checkout", batteryIds });
async function reviewedReturn(store, batteryIds) {
    const all = (await store.snapshot()).batteries;
    return { requestId: uuid(), kind: "return", batteryIds, expectedLoans: batteryIds.map(batteryId => ({ batteryId, loanId: all.find(row => row.id === batteryId).loanId })) };
}
const correction = (loan, action) => ({ requestId: uuid(), loanId: loan.id, action, expectedReturnedAt: loan.returnedAt, reason: "A documented test correction of this reviewed transaction." });
function beforeCommit(intervene) {
    let first = true; const sqlByStatement = new WeakMap();
    return { prepare: sql => {
        const prepared = db.prepare(sql);
        return { bind: (...values) => { const bound = prepared.bind(...values); sqlByStatement.set(bound, sql); return bound; } };
    }, batch: async statements => {
        if (first && statements.some(statement => /^INSERT INTO operations\(/.test(sqlByStatement.get(statement) ?? ""))) { first = false; await intervene(); }
        return db.batch(statements);
    } };
}

test("self checkout uses a stable account ID; same-name people are never adopted; another staff receives the return", async () => {
    const scope = "self-responsibility:demo", store = await fixture(scope), self = inventory(scope, staff), receiver = inventory(scope, otherStaff);
    await store.savePerson({ id: "same-name-legacy", name: staff.displayName, role: "staff" });
    const before = (await store.snapshot()).batteries.find(row => row.id === "BAT-001");
    await checkout(self, ["BAT-001"]);
    const current = (await store.snapshot()).batteries.find(row => row.id === "BAT-001");
    assert.equal(current.ownerId, before.ownerId);
    assert.equal(current.borrowerAccountId, staff.id); assert.equal(current.borrowerKind, "staff");
    assert.equal(current.borrowerId, `staff-${staff.id}`); assert.equal(current.borrowerName, staff.displayName);
    const people = (await store.snapshot()).people;
    assert.equal(people.find(row => row.id === "same-name-legacy").accountId, null);
    assert.equal(people.find(row => row.id === current.borrowerId).accountId, staff.id);
    const input = await reviewedReturn(receiver, ["BAT-001"]);
    await receiver.movement(input); assert.equal((await receiver.movement(input)).replayed, true);
    const loan = (await store.detail("BAT-001")).loans[0];
    assert.equal(loan.borrowerAccountId, staff.id); assert.equal(loan.checkoutActorName, staff.displayName); assert.equal(loan.returnActorName, otherStaff.displayName);
    const returned = (await store.snapshot()).batteries.find(row => row.id === "BAT-001");
    assert.equal(returned.borrowerAccountId, null); assert.equal(returned.borrowerKind, null); assert.equal(returned.lastCheckedOutAt, loan.checkedOutAt);
    const exported = await createExport(store, { dataset: "demo", mode: "detail", batteryId: "BAT-001" });
    assert.equal(exported.tables.Loans[0].borrower_account_id, staff.id);
    assert.equal(exported.tables.Loans[0].return_actor_id, otherStaff.id);
});

test("client-supplied borrower identities and unauthenticated checkout actors cannot create loans", async () => {
    const scope = "identity-forgery:demo", store = await fixture(scope), self = inventory(scope, staff);
    for (const identity of [{ borrowerId: "demo-student-1" }, { borrowerAccountId: otherStaff.id }, { borrowerName: otherStaff.displayName }, { actorId: otherStaff.id }])
        await assert.rejects(self.movement({ requestId: uuid(), kind: "checkout", batteryIds: ["BAT-001"], ...identity }), error => error.name === "ZodError");
    const noSession = new InventoryStore(db, scope, "demo", { id: staff.id, name: staff.displayName, role: "staff" }, () => now);
    await assert.rejects(checkout(noSession, ["BAT-001"]), status(401));
    await assert.rejects(checkout(new InventoryStore(db, scope, "demo", { id: uuid(), name: "Forged Staff", role: "staff", authVersion: 1 }, () => now), ["BAT-001"]), status(409));
    assert.equal((await store.detail("BAT-001")).loans.length, 0);
    const suppliedName = new InventoryStore(db, scope, "demo", { ...actor(staff), name: "Forged Staff Name" }, () => now);
    await checkout(suppliedName, ["BAT-001"]);
    const loan = (await store.detail("BAT-001")).loans[0];
    assert.equal(loan.borrowerName, staff.displayName); assert.equal(loan.checkoutActorName, staff.displayName);
});

test("a colliding unlinked person ID requires review instead of adopting or rewriting that record", async () => {
    const scope = "identity-collision:demo", store = inventory(scope);
    await store.savePerson({ id: `staff-${staff.id}`, name: "Unrelated Legacy Staff", role: "staff" });
    await store.initializeDemo();
    const before = (await store.snapshot()).people.find(row => row.id === `staff-${staff.id}`);
    await assert.rejects(checkout(inventory(scope, staff), ["BAT-001"]), status(409));
    assert.deepEqual((await store.snapshot()).people.find(row => row.id === `staff-${staff.id}`), before);
    assert.equal((await store.detail("BAT-001")).loans.length, 0);
    assert.equal(await db.prepare("SELECT COUNT(*) FROM audit_events WHERE scope=? AND action='staff_directory_linked'").bind(scope).first("COUNT(*)"), 0);
});

test("native loans retain original responsibility and times when received by another staff member", async () => {
    const scope = "native-return:demo", store = await fixture(scope), receiver = inventory(scope, otherStaff);
    await checkout(inventory(scope, staff), ["BAT-003"]);
    const original = (await store.detail("BAT-003")).loans[0];
    assert.equal(original.borrowerKind, "staff"); assert.equal(original.borrowerAccountId, staff.id);
    await receiver.movement(await reviewedReturn(receiver, ["BAT-003"]));
    const returned = (await store.detail("BAT-003")).loans[0];
    for (const key of ["id", "borrowerName", "borrowerAccountId", "borrowerKind", "checkedOutAt", "checkoutActorName"]) assert.equal(returned[key], original[key]);
    assert.equal(returned.returnActorName, otherStaff.displayName); assert.ok(returned.returnedAt);
});

test("a stale return draft cannot close a replacement loan, including an atomic commit race", async () => {
    const scope = "stale-return:demo", store = await fixture(scope), self = inventory(scope, staff), receiver = inventory(scope, otherStaff);
    await checkout(self, ["BAT-001"]);
    const stale = await reviewedReturn(receiver, ["BAT-001"]);
    await receiver.movement({ ...stale, requestId: uuid() });
    now = new Date(now.getTime() + 1000); await checkout(self, ["BAT-001"]);
    const replacement = (await store.snapshot()).batteries.find(row => row.id === "BAT-001").loanId;
    await assert.rejects(receiver.movement(stale), status(409));
    assert.equal((await store.snapshot()).batteries.find(row => row.id === "BAT-001").loanId, replacement);
    const reviewed = await reviewedReturn(receiver, ["BAT-001"]);
    const raced = inventory(scope, otherStaff, beforeCommit(async () => {
        await receiver.movement({ ...reviewed, requestId: uuid() });
        now = new Date(now.getTime() + 1000); await checkout(self, ["BAT-001"]);
    }));
    await assert.rejects(raced.movement(reviewed), status(409));
    const loans = (await store.detail("BAT-001")).loans;
    assert.equal(loans.length, 3); assert.equal(loans[0].returnedAt, null);
    assert.equal((await store.detail("BAT-001")).events.filter(row => row.action === "return").length, 2);
});

test("reviewed return maps must match the entire batch and remain part of idempotency", async () => {
    const scope = "return-mapping:demo", store = await fixture(scope), self = inventory(scope, staff);
    await checkout(self, ["BAT-001", "BAT-002"]);
    const input = await reviewedReturn(self, ["BAT-001", "BAT-002"]);
    for (const expectedLoans of [input.expectedLoans.slice(0, 1), [input.expectedLoans[0], input.expectedLoans[0]], input.expectedLoans.map(row => ({ ...row, loanId: input.expectedLoans[0].loanId }))])
        await assert.rejects(self.movement({ ...input, expectedLoans }), status(400));
    await assert.rejects(self.movement({ ...input, expectedLoans: input.expectedLoans.map((row, index) => ({ ...row, loanId: input.expectedLoans[1 - index].loanId })) }), status(409));
    await self.movement(input);
    await assert.rejects(self.movement({ ...input, expectedLoans: input.expectedLoans.map(row => ({ ...row, loanId: uuid() })) }), status(409));
    assert.equal((await store.detail("BAT-001")).events.filter(row => row.action === "return").length, 1);
});

test("stale corrections never reverse the intended action; both directions guard the commit and replay", async () => {
    const scope = "correction-intent:demo", store = await fixture(scope), self = inventory(scope, staff);
    await checkout(self, ["BAT-001"]);
    const active = (await store.detail("BAT-001")).loans[0], voidDraft = correction(active, "checkout_voided");
    const racedVoid = inventory(scope, admin, beforeCommit(async () => self.movement(await reviewedReturn(self, ["BAT-001"]))));
    await assert.rejects(racedVoid.correctLoan(voidDraft), status(409));
    let loan = (await store.detail("BAT-001")).loans[0]; assert.ok(loan.returnedAt); assert.equal(loan.cancelledAt, null);
    await assert.rejects(store.correctLoan(voidDraft), status(409));
    const reopenDraft = correction(loan, "return_reopened");
    const peerReopen = { ...reopenDraft, requestId: uuid() };
    const racedReopen = inventory(scope, admin, beforeCommit(async () => store.correctLoan(peerReopen)));
    await assert.rejects(racedReopen.correctLoan(reopenDraft), status(409));
    assert.equal((await store.detail("BAT-001")).loans[0].returnedAt, null);
    assert.equal((await store.correctLoan(peerReopen)).replayed, true);
    await assert.rejects(store.correctLoan({ ...peerReopen, action: "checkout_voided", expectedReturnedAt: null }), status(409));
    loan = (await store.detail("BAT-001")).loans[0];
    await store.correctLoan(correction(loan, "checkout_voided"));
    assert.equal((await store.snapshot()).batteries.find(row => row.id === "BAT-001").lastCheckedOutAt, null);
    const events = (await store.detail("BAT-001")).events;
    assert.equal(events.filter(row => row.action === "return_reopened").length, 1);
    assert.equal(events.filter(row => row.action === "checkout_voided").length, 1);
});

test("89, 90, 91 and 100 battery checkout/return batches succeed under native authorization guards", async () => {
    for (const count of [89, 90, 91, 100]) {
        const scope = `batch-${count}:demo`, store = await fixture(scope), self = inventory(scope, staff), receiver = inventory(scope, otherStaff);
        const ids = Array.from({ length: count }, (_, index) => `BATCH-${String(index + 1).padStart(3, "0")}`);
        await store.importRecords("batteries", ids.map(id => ({ id, name: "Batch test battery", ownerId: `staff-${admin.id}`, homeBuildingId: "J18" })));
        const requestId = uuid(); assert.equal((await checkout(self, ids, requestId)).count, count); assert.equal((await checkout(self, ids, requestId)).replayed, true);
        assert.equal((await self.snapshot()).batteries.filter(row => ids.includes(row.id) && row.loanId).length, count);
        const input = await reviewedReturn(receiver, ids); assert.equal((await receiver.movement(input)).count, count); assert.equal((await receiver.movement(input)).replayed, true);
        assert.equal((await self.snapshot()).batteries.filter(row => ids.includes(row.id) && row.loanId).length, 0);
        const counts = await db.prepare("SELECT COUNT(*) AS total,SUM(returned_at IS NOT NULL) AS returned FROM loans WHERE scope=? AND borrower_account_id=?").bind(scope, staff.id).first();
        assert.equal(counts.total, count); assert.equal(counts.returned, count);
    }
});

test("one conflict rejects the entire 100-battery batch without partial loans or movement history", async () => {
    const scope = "large-atomic-conflict:demo", store = await fixture(scope), fresh = await accounts.create({ username: "fresh-linked-staff", displayName: "Fresh Staff", role: "staff", password }, admin);
    const ids = Array.from({ length: 99 }, (_, index) => `ATOMIC-${index}`);
    await store.importRecords("batteries", ids.map(id => ({ id, name: "Atomic test battery", ownerId: `staff-${admin.id}`, homeBuildingId: "J18" })));
    await checkout(store, ["BAT-003"]);
    const nativePerson = (await store.snapshot()).people.find(row => row.accountId === fresh.id);
    await assert.rejects(checkout(inventory(scope, fresh), [...ids, "BAT-003"]), status(409));
    assert.equal((await store.snapshot()).batteries.filter(row => ids.includes(row.id) && row.loanId).length, 0);
    assert.deepEqual((await store.snapshot()).people.find(row => row.accountId === fresh.id), nativePerson);
    assert.equal(await db.prepare("SELECT COUNT(*) FROM audit_events WHERE scope=? AND actor_id=? AND action IN ('checkout','staff_directory_linked')").bind(scope, fresh.id).first("COUNT(*)"), 0);
});

test("CSV commit rechecks account disable, demotion and password reset without records or successful import history", async () => {
    for (const [index, change, kind] of [[0, { active: false }, "batteries"], [1, { role: "staff" }, "people"], [2, { password: "Reset-workflow-verification-password-2026" }, "batteries"]]) {
        const scope = `csv-race-${index}:demo`, store = await fixture(scope);
        let user = await accounts.create({ username: `import-race-${index}`, displayName: "Import Race Staff", role: kind === "people" ? "admin" : "staff", password }, admin);
        const data = kind === "people" ? [{ id: "RACE-ROW", name: "Imported person", role: "staff" }] : [{ id: "RACE-ROW", name: "Imported battery", ownerId: `staff-${admin.id}`, homeBuildingId: "J18" }];
        const raced = inventory(scope, user, beforeCommit(async () => { user = await accounts.update({ ...user, ...change, expectedVersion: user.version }, admin); }));
        await assert.rejects(raced.importRecords(kind, data), status(409));
        assert.equal(await db.prepare(`SELECT COUNT(*) FROM ${kind} WHERE scope=? AND id='RACE-ROW'`).bind(scope).first("COUNT(*)"), 0);
        assert.equal(await db.prepare("SELECT COUNT(*) FROM audit_events WHERE scope=? AND action='records_imported'").bind(scope).first("COUNT(*)"), 0);
        assert.equal(await db.prepare("SELECT COUNT(*) FROM operations WHERE scope=? AND kind='records_imported'").bind(scope).first("COUNT(*)"), 0);
        assert.equal((await store.snapshot()).batteries.length, 6);
    }
});

test("linked directory and historical borrower account/name/checkout evidence cannot be rewritten or replaced", async () => {
    const scope = "link-immutability:demo", store = await fixture(scope), self = inventory(scope, staff);
    await checkout(self, ["BAT-001"]); const loan = (await store.detail("BAT-001")).loans[0], personKey = `${scope}/staff-${staff.id}`;
    const statements = [
        db.prepare("UPDATE people SET account_id=?,version=version+1 WHERE key=?").bind(otherStaff.id, personKey),
        db.prepare("UPDATE people SET account_id=NULL,version=version+1 WHERE key=?").bind(personKey),
        db.prepare("UPDATE people SET account_id=?,version=version+1 WHERE key=?").bind(staff.id, `${scope}/staff-${admin.id}`),
        db.prepare("UPDATE people SET role='borrower',version=version+1 WHERE key=?").bind(personKey),
        db.prepare("UPDATE loans SET borrower_account_id=? WHERE id=?").bind(otherStaff.id, loan.id),
        db.prepare("UPDATE loans SET borrower_name='Rewritten name' WHERE id=?").bind(loan.id),
        db.prepare("UPDATE loans SET checkout_actor_id=? WHERE id=?").bind(otherStaff.id, loan.id),
        db.prepare("UPDATE loans SET checked_out_at=? WHERE id=?").bind("2020-01-01T00:00:00.000Z", loan.id),
        db.prepare("INSERT OR REPLACE INTO people(key,scope,id,name,role,account_id) VALUES(?,?,?,?,?,?)").bind(personKey, scope, `staff-${staff.id}`, "Replacement Staff", "staff", otherStaff.id),
    ];
    for (const statement of statements) await assert.rejects(statement.run(), /CONSTRAINT/i);
    assert.deepEqual((await store.detail("BAT-001")).loans[0], loan);
    assert.deepEqual((await db.prepare("PRAGMA foreign_key_check").all()).results, []);
});

test("the additive account-link migration preserves legacy rows and existing integrity triggers", async () => {
    const legacy = new Miniflare({ modules: true, script: "export default {fetch(){return new Response('migration-test')}}", compatibilityDate: "2026-05-15", d1Databases: { DB: "link-migration" }, d1Persist: false });
    try {
        const database = await legacy.getD1Database("DB"), scope = "migration-history:demo", at = now.toISOString();
        const entry = journal.entries.find(row => row.tag === "0006_staff_self_checkout");
        await migrate(database, journal.entries.filter(row => row.idx < entry.idx));
        await database.batch([
            database.prepare("INSERT INTO people(key,scope,id,name,role) VALUES(?,?,?,?,?)").bind(`${scope}/OWNER`, scope, "OWNER", "Original Owner", "staff"),
            database.prepare("INSERT INTO people(key,scope,id,name,role) VALUES(?,?,?,?,?)").bind(`${scope}/STUDENT`, scope, "STUDENT", "Original Student", "borrower"),
            database.prepare("INSERT INTO buildings(key,scope,id,name) VALUES(?,?,?,?)").bind(`${scope}/J18`, scope, "J18", "Original Building"),
            database.prepare("INSERT INTO batteries(key,scope,id,name,owner_key,home_building_key,created_at) VALUES(?,?,?,?,?,?,?)").bind(`${scope}/BATTERY`, scope, "BATTERY", "Original Battery", `${scope}/OWNER`, `${scope}/J18`, at),
            database.prepare("INSERT INTO loans(id,scope,battery_key,borrower_key,borrower_name,checked_out_at,checkout_actor_id,checkout_actor_name) VALUES(?,?,?,?,?,?,?,?)").bind(uuid(), scope, `${scope}/BATTERY`, `${scope}/STUDENT`, "Original Student", at, "original-teacher", "Original Teacher"),
        ]);
        const before = {}, tables = ["people", "batteries", "loans"];
        for (const table of tables) before[table] = (await database.prepare(`SELECT * FROM ${table}`).all()).results;
        const triggers = (await database.prepare("SELECT name FROM sqlite_master WHERE type='trigger'").all()).results.map(row => row.name);
        await migrate(database, [entry]);
        for (const table of tables) {
            const after = (await database.prepare(`SELECT * FROM ${table}`).all()).results;
            assert.equal(after.length, before[table].length);
            after.forEach((row, index) => { for (const [key, value] of Object.entries(before[table][index])) assert.equal(row[key], value); });
        }
        assert.ok((await database.prepare("SELECT account_id FROM people").all()).results.every(row => row.account_id === null));
        assert.equal(await database.prepare("SELECT borrower_account_id FROM loans").first("borrower_account_id"), null);
        const retained = (await database.prepare("SELECT name FROM sqlite_master WHERE type='trigger'").all()).results.map(row => row.name);
        assert.ok(triggers.every(name => retained.includes(name)));
        assert.deepEqual((await database.prepare("PRAGMA foreign_key_check").all()).results, []);
    } finally { await legacy.dispose(); }
});
