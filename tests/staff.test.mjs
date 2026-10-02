import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { Miniflare } from "miniflare";
import ExcelJS from "exceljs";
import { AccountStore } from "../work/qa/accounts.mjs";
import { InventoryStore } from "../work/qa/store.mjs";
import { sharedInventoryScope } from "../work/qa/shared-inventory.mjs";
import { createExport } from "../work/qa/exports.mjs";
import { excelBuffer, summaryCsv } from "../work/qa/downloads.mjs";
import { digest } from "../work/qa/credentials.mjs";
import { safeReturnPath } from "../work/qa/return-path.mjs";

const mf = new Miniflare({ modules: true, script: "export default {fetch(){return new Response('test')}}", compatibilityDate: "2026-05-15", d1Databases: { DB: "staff-test" }, d1Persist: false });
const db = await mf.getD1Database("DB"), journal = JSON.parse(await readFile("drizzle/meta/_journal.json", "utf8"));
for (const entry of journal.entries) await db.batch((await readFile(`drizzle/${entry.tag}.sql`, "utf8")).split("--> statement-breakpoint").filter(sql => sql.trim()).map(sql => db.prepare(sql)));
after(() => mf.dispose());
const accounts = new AccountStore(db), pass = "Verification-password-2026", status = code => error => error.status === code;
const actor = user => ({ id: user.id, name: user.displayName, role: user.role, authVersion: user.authVersion });
let admin, staff, secondStaff, scope;
const uuid = () => crypto.randomUUID();

test("setup has one administrator; passwords and session tokens are hashed; profiles cannot grant access", async () => {
    const result = await Promise.allSettled(["admin-one", "admin-two"].map(username => accounts.create({ username, displayName: username, role: "admin", password: pass })));
    assert.equal(result.filter(item => item.status === "fulfilled").length, 1);
    admin = result.find(item => item.status === "fulfilled").value;
    staff = await accounts.create({ username: "staff-one", displayName: "Staff One", role: "staff", password: pass }, admin);
    secondStaff = await accounts.create({ username: "staff-two", displayName: "Staff Two", role: "staff", password: pass }, admin);
    const login = await accounts.signIn({ username: "STAFF-ONE", password: pass });
    assert.equal((await accounts.authenticate(login.token)).id, staff.id);
    const stored = await db.prepare("SELECT password_hash,password_salt FROM staff_accounts WHERE id=?").bind(staff.id).first();
    assert.notEqual(stored.password_hash, pass); assert.equal(stored.password_hash.length, 64);
    assert.ok(await db.prepare("SELECT token_hash FROM staff_sessions WHERE token_hash=?").bind(await digest(login.token)).first());
    assert.equal(await db.prepare("SELECT token_hash FROM staff_sessions WHERE token_hash=?").bind(login.token).first(), null);
    await assert.rejects(accounts.create({ username: "unauthorized", displayName: "No access", role: "admin", password: pass }, staff), status(403));
    await assert.rejects(accounts.update({ id: staff.id, expectedVersion: staff.version, displayName: "Staff One", role: "admin" }, staff, true), status(403));
    await assert.rejects(accounts.update({ id: secondStaff.id, expectedVersion: secondStaff.version, displayName: "Other account" }, staff, true), status(403));
    staff = await accounts.update({ id: staff.id, expectedVersion: staff.version, displayName: "Updated Staff One", email: "one@example.invalid", defaultDataset: "live" }, staff, true);
    assert.equal((await accounts.user(secondStaff.id)).displayName, "Staff Two");
    await assert.rejects(accounts.list(staff), status(403));
    await assert.rejects(accounts.signIn({ username: "staff-one", password: "incorrect" }), status(401));
    await accounts.signOut(login.token); assert.equal(await accounts.authenticate(login.token), null);
});

test("all staff share one register; native staff owners register and move batteries without editing saved data", async () => {
    const initial = new InventoryStore(db, "local_seedy:demo", "demo", actor(admin));
    await initial.initializeDemo();
    scope = await sharedInventoryScope(db, "demo"); assert.equal(scope, "local_seedy:demo");
    const one = new InventoryStore(db, scope, "demo", actor(staff)), two = new InventoryStore(db, await sharedInventoryScope(db, "demo"), "demo", actor(secondStaff));
    await one.saveBattery({ id: "STAFF-NEW", name: "New shared battery", ownerId: `staff-${staff.id}`, homeBuildingId: "J18" });
    assert.ok((await two.snapshot()).batteries.some(battery => battery.id === "STAFF-NEW"));
    const saved = (await one.snapshot()).batteries.find(battery => battery.id === "STAFF-NEW");
    assert.equal(saved.ownerAccountId, staff.id);
    for (const operation of [() => one.saveBattery({ ...saved, expectedVersion: saved.version, name: "Unauthorized edit" }, true), () => one.saveBuilding({ id: "NEW", name: "New building" }), () => one.saveRoom({ id: "ROOM", name: "New room", buildingId: "J18", number: "1" }), () => one.savePerson({ id: "PERSON", name: "New person", role: "staff" }), () => one.charge({}), () => one.observation({}), () => one.correctLoan({}), () => one.importRecords("people", [])]) await assert.rejects(operation, status(403));
    await one.movement({ requestId: uuid(), kind: "checkout", batteryIds: ["STAFF-NEW"] });
    await two.movement({ requestId: uuid(), kind: "return", batteryIds: ["STAFF-NEW"], expectedLoans: [{ batteryId: "STAFF-NEW", loanId: (await one.snapshot()).batteries.find(b => b.id === "STAFF-NEW").loanId }] });
    const loan = (await one.detail("STAFF-NEW")).loans[0];
    assert.equal(loan.checkoutActorName, staff.displayName); assert.equal(loan.returnActorName, secondStaff.displayName);
    const results = await Promise.allSettled([one, two].map(store => store.movement({ requestId: uuid(), kind: "checkout", batteryIds: ["STAFF-NEW"] })));
    assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
    assert.equal((await one.detail("STAFF-NEW")).loans.length, 2);
    const live = await sharedInventoryScope(db, "live"); assert.notEqual(live, scope);
});

test("access changes between movement validation and commit cannot save a loan or partial history", async () => {
    let user = await accounts.create({ username: "race-staff", displayName: "Race Staff", role: "staff", password: pass }, admin);
    const verified = new InventoryStore(db, scope, "demo", actor(admin));
    const before = await verified.detail("BAT-002");
    for (const change of [{ active: false }, { role: "admin" }]) {
        const delayedDb = {
            prepare: sql => db.prepare(sql),
            batch: async statements => {
                user = await accounts.update({ ...user, ...change, expectedVersion: user.version }, admin);
                return db.batch(statements);
            },
        };
        const raced = new InventoryStore(delayedDb, scope, "demo", actor(user));
        await assert.rejects(raced.movement({ requestId: uuid(), kind: "checkout", batteryIds: ["BAT-002"] }), status(409));
        const after = await verified.detail("BAT-002");
        assert.deepEqual(after.loans, before.loans); assert.deepEqual(after.events, before.events);
        user = await accounts.update({ ...user, active: true, role: "staff", expectedVersion: user.version }, admin);
    }
});

test("selected single/bulk exports preserve all history beyond 200 rows and Excel text without loss", async () => {
    const store = new InventoryStore(db, scope, "demo", actor(admin));
    const key = `${scope}/BAT-001`, at = new Date().toISOString();
    await db.batch(Array.from({ length: 205 }, (_, index) => db.prepare("INSERT INTO charges(id,scope,battery_key,completed_at,duration_minutes,recorded_at,actor_id,actor_name) VALUES(?,?,?,?,?,?,?,?)").bind(uuid(), scope, key, at, 10 + index, at, staff.id, staff.displayName)));
    assert.equal((await store.detail("BAT-001")).charges.length, 200);
    const input = { dataset: "demo", mode: "detail", batteryId: "BAT-001" }, document = await createExport(store, input);
    assert.equal(document.tables.Charges.length, 206); assert.ok(document.tables.Charges.every(row => "actor_id" in row && "recorded_at" in row));
    assert.ok(document.tables.People.length); assert.ok(document.tables.Buildings.length);
    const selected = await createExport(store, { ...input, sections: ["loans"] });
    assert.deepEqual(Object.keys(selected.tables), ["Batteries", "Loans"]); assert.deepEqual(Object.keys(selected.tables.Batteries[0]), ["battery_id"]);
    const summary = await createExport(store, { dataset: "demo", mode: "summary", filter: { search: "BAT-00" }, range: "page", page: 0, pageSize: "10" });
    assert.equal(summary.metadata.matching_batteries, 6); assert.equal(summary.tables.Inventory.length, 6);
    assert.ok(summaryCsv(summary).includes("export_record_count"));
    const longText = "a".repeat(31999) + "🔋" + "b".repeat(40000);
    document.tables.Operations.push({ id: "long-text-test", battery_id: "BAT-001", details_json: longText });
    document.tables.Batteries[0].name = "=1+1";
    const bytes = await excelBuffer(document); await writeFile("work/qa/staff-export.xlsx", bytes);
    const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(bytes);
    assert.equal(workbook.getWorksheet("Charges").rowCount, 207);
    const parts = workbook.getWorksheet("Complete text");
    assert.ok(parts); let restored = ""; parts.eachRow((row, number) => { if (number > 1) restored += row.getCell(5).value; }); assert.equal(restored, longText);
    assert.equal(workbook.getWorksheet("Batteries").getRow(2).getCell(4).value, "=1+1");
    assert.ok(!JSON.stringify(document).includes("password_hash"));
    await writeFile("work/qa/staff-export.json", JSON.stringify(document, null, 2));
});

test("account version guards, disable/reset revocation, and last-admin protection are atomic", async () => {
    let current = await accounts.user(secondStaff.id), login = await accounts.signIn({ username: current.username, password: pass });
    const beforeCount = (await accounts.list(admin)).events.length;
    current = await accounts.update({ ...current, expectedVersion: current.version, displayName: "Updated Staff Two", active: false }, admin);
    assert.equal(await accounts.authenticate(login.token), null);
    await assert.rejects(accounts.update({ ...current, expectedVersion: current.version - 1, displayName: "Stale name" }, admin), status(409));
    assert.equal((await accounts.list(admin)).events.length, beforeCount + 1);
    await assert.rejects(db.prepare("INSERT OR REPLACE INTO staff_account_events(id,action,actor_id,actor_name,target_id,at,details_json,guard) SELECT id,'replaced',actor_id,actor_name,target_id,at,details_json,1 FROM staff_account_events LIMIT 1").run());
    assert.equal((await accounts.list(admin)).events.length, beforeCount + 1);
    current = await accounts.update({ ...current, expectedVersion: current.version, active: true, password: "New-verification-password-2026" }, admin);
    await assert.rejects(accounts.signIn({ username: current.username, password: pass }), status(401));
    login = await accounts.signIn({ username: current.username, password: "New-verification-password-2026" });
    await accounts.changePassword({ currentPassword: "New-verification-password-2026", newPassword: "Another-verification-password-2026" }, login.user);
    assert.equal(await accounts.authenticate(login.token), null);
    await assert.rejects(accounts.update({ ...admin, expectedVersion: admin.version, role: "staff" }, admin), status(409));
    await assert.rejects(db.prepare("DELETE FROM staff_accounts WHERE id=?").bind(staff.id).run());
    const secondAdmin = await accounts.create({ username: "backup-admin", displayName: "Backup Admin", role: "admin", password: pass }, admin);
    const results = await Promise.allSettled([admin, secondAdmin].map(user => accounts.update({ ...user, expectedVersion: user.version, role: "staff" }, user)));
    assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
    assert.equal(await db.prepare("SELECT COUNT(*) FROM staff_accounts WHERE active=1 AND role='admin'").first("COUNT(*)"), 1);
});

test("sign-in return paths stay on the application origin after URL normalization", () => {
    for (const path of [null, "https://example.invalid/", "//example.invalid/", "/\\example.invalid/", "/\t/example.invalid/", "/\n/example.invalid/", "/signin?return_to=/signin"]) assert.equal(safeReturnPath(path), "/");
    assert.equal(safeReturnPath("/inventory?building=J18#records"), "/inventory?building=J18#records");
});

test("multiple legacy registers remain unchanged and require review instead of silent merging", async () => {
    const sql = "INSERT INTO people(key,scope,id,name,reference,role) VALUES(?,?,?,?,?,?)";
    await db.batch([db.prepare(sql).bind("old-one:live/P", "old-one:live", "P", "First owner", "", "staff"), db.prepare(sql).bind("old-two:live/P", "old-two:live", "P", "Second owner", "", "staff")]);
    await db.prepare("DELETE FROM shared_inventories WHERE dataset='live'").run();
    await assert.rejects(sharedInventoryScope(db, "live"), error => error.code === "legacy_inventory_review");
    assert.equal(await db.prepare("SELECT COUNT(*) FROM people WHERE scope IN ('old-one:live','old-two:live')").first("COUNT(*)"), 2);
});
