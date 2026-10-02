import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Miniflare } from "miniflare";
import { AccountStore } from "../work/qa/accounts.mjs";
import { InventoryStore } from "../work/qa/store.mjs";
import { createExport } from "../work/qa/exports.mjs";
import { filterBatteries, defaultInventoryFilter } from "../work/qa/inventory-query.mjs";

const mf = new Miniflare({ modules: true, script: "export default {fetch(){return new Response('personal-inventory')}}", compatibilityDate: "2026-05-15", d1Databases: { DB: "personal-inventory" }, d1Persist: false });
const db = await mf.getD1Database("DB"), journal = JSON.parse(await readFile("drizzle/meta/_journal.json", "utf8"));
async function migrate(database, entries = journal.entries) {
    for (const entry of entries) await database.batch((await readFile(`drizzle/${entry.tag}.sql`, "utf8")).split("--> statement-breakpoint").filter(sql => sql.trim()).map(sql => database.prepare(sql)));
}
await migrate(db);
after(() => mf.dispose());
const now = new Date("2026-10-02T04:00:00.000Z"), accounts = new AccountStore(db, () => now), password = "Personal-inventory-verification-2026";
const admin = await accounts.create({ username: "personal-admin", displayName: "Inventory Administrator", role: "admin", password });
let staff = await accounts.create({ username: "personal-one", displayName: "Same Staff Name", role: "staff", password }, admin);
const other = await accounts.create({ username: "personal-two", displayName: "Same Staff Name", role: "staff", password }, admin);
const uuid = () => crypto.randomUUID(), status = code => error => error.status === code;
const actor = user => ({ id: user.id, name: user.displayName, role: user.role, authVersion: user.authVersion });
const inventory = (scope, user = admin, database = db) => new InventoryStore(database, scope, "demo", actor(user), () => now);
const ownerId = user => `staff-${user.id}`;
const asset = (id, owner = staff, extra = {}) => ({ id, name: "Personal test battery", ownerId: ownerId(owner), homeBuildingId: "J18", homeRoomId: "J18-DEMO-ROOM", ...extra });
const checkout = (store, batteryIds) => store.movement({ requestId: uuid(), kind: "checkout", batteryIds });
async function fixture(scope) { const store = inventory(scope); await store.initializeDemo(); return store; }
function beforeAtomicCommit(intervene) {
    const sqlByStatement = new WeakMap(); let intercepted = false;
    return {
        prepare: sql => {
            const prepared = db.prepare(sql);
            return { bind: (...values) => { const bound = prepared.bind(...values); sqlByStatement.set(bound, sql); return bound; } };
        },
        batch: async statements => {
            if (!intercepted && statements.some(statement => /^INSERT INTO operations\(/.test(sqlByStatement.get(statement) ?? ""))) { intercepted = true; await intervene(); }
            return db.batch(statements);
        },
    };
}

test("fresh demonstration uses native owners and no seeded borrowers; staff directory has only basic account fields", async () => {
    const store = await fixture("native-demo:demo"), first = await store.snapshot();
    assert.equal(first.batteries.length, 6);
    assert.ok(first.batteries.every(row => row.ownerId === ownerId(admin) && row.ownerAccountId === admin.id && row.loanId === null));
    assert.equal(first.people.length, 3); assert.ok(first.people.every(row => row.role === "staff" && row.accountId));
    assert.ok(first.staffDirectory.every(row => Object.keys(row).sort().join() === "active,displayName,id,username"));
    assert.ok(first.staffDirectory.every(row => typeof row.active === "boolean"));
    assert.ok(!JSON.stringify(first).includes("password_hash")); assert.ok(!JSON.stringify(first).includes("auth_version"));
    const before = (await db.prepare("SELECT * FROM people WHERE scope=? ORDER BY id").bind(store.scope).all()).results;
    await store.snapshot(); await store.exportData();
    assert.deepEqual((await db.prepare("SELECT * FROM people WHERE scope=? ORDER BY id").bind(store.scope).all()).results, before);
});

test("personal responsibility and current loans are distinct explicit-account views and retain shared access", async () => {
    const scope = "personal-views:demo"; await fixture(scope); const self = inventory(scope, staff);
    await self.saveBattery(asset("OWN-ONE")); await self.saveBattery(asset("OWN-TWO", staff, { chemistry: "LiPo" })); await self.saveBattery(asset("OTHER", other));
    await checkout(self, ["BAT-001", "OWN-ONE"]);
    const all = (await inventory(scope, other).snapshot()).batteries;
    assert.equal(all.length, 9);
    const mine = filterBatteries(all, { personalScope: "responsible" }, "2026-10-02", staff.id);
    assert.deepEqual(mine.map(row => row.id), ["OWN-ONE", "OWN-TWO"]);
    assert.deepEqual(filterBatteries(all, { personalScope: "borrowed" }, "2026-10-02", staff.id).map(row => row.id), ["BAT-001", "OWN-ONE"]);
    assert.deepEqual(filterBatteries(all, { personalScope: "responsible", status: "in", chemistry: "LiPo" }, "2026-10-02", staff.id).map(row => row.id), ["OWN-TWO"]);
    assert.deepEqual(filterBatteries(all, { personalScope: "responsible" }, "2026-10-02", other.id).map(row => row.id), ["OTHER"]);
    assert.deepEqual(filterBatteries(all, { personalScope: "borrowed" }, "2026-10-02", other.id), []);
    assert.deepEqual(filterBatteries(all, { personalScope: "responsible" }, "2026-10-02"), []);
    assert.equal(defaultInventoryFilter().personalScope, "all");
});

test("filtered personal exports and pagination use the server actor; selected downloads preserve explicit IDs within the personal view", async () => {
    const scope = "personal-export:demo"; await fixture(scope); const self = inventory(scope, staff);
    await self.importRecords("batteries", Array.from({ length: 12 }, (_, index) => asset(`MINE-${String(index).padStart(2, "0")}`)));
    await checkout(self, ["BAT-001", "MINE-00"]);
    const filter = { personalScope: "responsible" };
    const summary = await createExport(self, { dataset: "demo", mode: "summary", filter, viewerAccountId: other.id });
    assert.equal(summary.metadata.matching_batteries, 12); assert.equal(summary.tables.Inventory.length, 12);
    assert.ok(summary.tables.Inventory.every(row => row.responsible_owner_account_id === staff.id));
    const page = await createExport(self, { dataset: "demo", mode: "summary", range: "page", page: 1, pageSize: "10", filter });
    assert.equal(page.metadata.matching_batteries, 12); assert.deepEqual(page.tables.Inventory.map(row => row.battery_id), ["MINE-10", "MINE-11"]);
    const loans = await createExport(self, { dataset: "demo", mode: "detail", filter: { personalScope: "borrowed" }, sections: ["responsibility", "loans"] });
    assert.deepEqual(loans.tables.Batteries.map(row => row.battery_id), ["BAT-001", "MINE-00"]);
    assert.equal(loans.tables.Loans.length, 2); assert.ok(loans.tables.Loans.every(row => row.borrower_account_id === staff.id));
    const selected = await createExport(self, { dataset: "demo", mode: "summary", filter: { ...filter, search: "No ordinary filter match" }, range: "selected", batteryIds: ["MINE-01", "MINE-11"] });
    assert.deepEqual(selected.tables.Inventory.map(row => row.battery_id), ["MINE-01", "MINE-11"]);
    assert.equal(selected.metadata.filters, null); assert.equal(selected.metadata.selection_filter_context.personalScope, "responsible");
    await assert.rejects(createExport(self, { dataset: "demo", mode: "summary", filter, range: "selected", batteryIds: ["BAT-002", "MINE-11"] }), status(409));
    const allSelected = await createExport(self, { dataset: "demo", mode: "summary", filter: { search: "No ordinary filter match" }, range: "selected", batteryIds: ["BAT-002", "MINE-11"] });
    assert.deepEqual(allSelected.tables.Inventory.map(row => row.battery_id), ["BAT-002", "MINE-11"]);
});

test("selected personal downloads reject returned loans, changed responsibility and another account's current loan", async () => {
    const scope = "personal-selection-race:demo", store = await fixture(scope), self = inventory(scope, staff);
    await self.saveBattery(asset("MINE")); await checkout(self, ["BAT-001", "MINE"]);
    const current = (await self.snapshot()).batteries.find(row => row.id === "MINE");
    await inventory(scope, other).movement({ requestId: uuid(), kind: "return", batteryIds: ["MINE"], expectedLoans: [{ batteryId: "MINE", loanId: current.loanId }] });
    await assert.rejects(createExport(self, { dataset: "demo", mode: "detail", filter: { personalScope: "borrowed" }, range: "selected", batteryIds: ["BAT-001", "MINE"] }), status(409));
    const returned = (await store.snapshot()).batteries.find(row => row.id === "MINE");
    await store.saveBattery({ ...returned, ownerId: ownerId(other), expectedVersion: returned.version }, true);
    await assert.rejects(createExport(self, { dataset: "demo", mode: "summary", filter: { personalScope: "responsible" }, range: "selected", batteryIds: ["MINE"] }), status(409));
    await checkout(inventory(scope, other), ["MINE"]);
    await assert.rejects(createExport(self, { dataset: "demo", mode: "detail", filter: { personalScope: "borrowed" }, viewerAccountId: other.id, range: "selected", batteryIds: ["MINE"] }), status(409));
});

test("single battery downloads preserve native personal scope without applying ordinary list filters or pagination", async () => {
    const scope = "personal-single-export:demo"; await fixture(scope); const self = inventory(scope, staff);
    await self.saveBattery(asset("MINE")); await self.saveBattery(asset("OTHER", other));
    await checkout(self, ["BAT-001", "MINE"]); await checkout(inventory(scope, other), ["OTHER"]);
    for (const mode of ["summary", "detail"]) {
        for (const personalScope of ["responsible", "borrowed"]) {
            const input = { dataset: "demo", mode, filter: { personalScope, search: "No ordinary filter match", status: "in" }, range: "page", page: 9, pageSize: "10", sections: ["responsibility"] };
            const document = await createExport(self, { ...input, batteryId: "MINE", viewerAccountId: other.id, actorId: other.id });
            const rows = document.tables.Inventory ?? document.tables.Batteries;
            assert.deepEqual(rows.map(row => row.battery_id), ["MINE"]);
            assert.equal(document.metadata.range, "single"); assert.equal(document.metadata.page, null); assert.equal(document.metadata.page_size, null);
            assert.equal(document.metadata.filters.personalScope, personalScope);
            await assert.rejects(createExport(self, { ...input, batteryId: "OTHER", viewerAccountId: other.id }), status(404));
        }
        const borrowed = await createExport(self, { dataset: "demo", mode, batteryId: "BAT-001", filter: { personalScope: "borrowed" }, sections: ["responsibility"] });
        assert.deepEqual((borrowed.tables.Inventory ?? borrowed.tables.Batteries).map(row => row.battery_id), ["BAT-001"]);
        await assert.rejects(createExport(self, { dataset: "demo", mode, batteryId: "BAT-001", filter: { personalScope: "responsible" } }), status(404));
        const shared = await createExport(self, { dataset: "demo", mode, batteryId: "OTHER", sections: ["responsibility"] });
        assert.deepEqual((shared.tables.Inventory ?? shared.tables.Batteries).map(row => row.battery_id), ["OTHER"]);
    }
});

test("single personal downloads reject a returned or reassigned battery instead of widening the captured scope", async () => {
    const scope = "personal-single-race:demo", store = await fixture(scope), self = inventory(scope, staff);
    await self.saveBattery(asset("MINE")); await checkout(self, ["MINE"]);
    const captured = (await self.snapshot()).batteries.find(row => row.id === "MINE");
    await inventory(scope, other).movement({ requestId: uuid(), kind: "return", batteryIds: ["MINE"], expectedLoans: [{ batteryId: "MINE", loanId: captured.loanId }] });
    await assert.rejects(createExport(self, { dataset: "demo", mode: "detail", batteryId: "MINE", filter: { personalScope: "borrowed" } }), status(404));
    const returned = (await store.snapshot()).batteries.find(row => row.id === "MINE");
    await store.saveBattery({ ...returned, ownerId: ownerId(other), expectedVersion: returned.version }, true);
    await assert.rejects(createExport(self, { dataset: "demo", mode: "detail", batteryId: "MINE", filter: { personalScope: "responsible" } }), status(404));
    await checkout(inventory(scope, other), ["MINE"]);
    await assert.rejects(createExport(self, { dataset: "demo", mode: "summary", batteryId: "MINE", filter: { personalScope: "borrowed" }, viewerAccountId: other.id }), status(404));
    const shared = await createExport(self, { dataset: "demo", mode: "detail", batteryId: "MINE", sections: ["responsibility"] });
    assert.equal(shared.tables.Batteries[0].owner_account_id, other.id); assert.equal(shared.tables.Batteries[0].current_borrower_account_id, other.id);
});

test("matching names and unlinked directory rows cannot assign a new responsible owner", async () => {
    const scope = "no-name-association:demo", store = await fixture(scope);
    await store.savePerson({ id: "unlinked-name", name: staff.displayName, role: "staff" });
    await assert.rejects(store.saveBattery({ ...asset("NO-LINK"), ownerId: "unlinked-name" }), status(400));
    const snapshot = await store.snapshot();
    assert.equal(snapshot.people.find(row => row.id === "unlinked-name").accountId, null);
    assert.deepEqual(filterBatteries(snapshot.batteries, { personalScope: "responsible" }, "2026-10-02", staff.id), []);
    const directory = await createExport(store, { dataset: "demo", mode: "records", kind: "people" });
    assert.ok(directory.tables.people.every(row => row.account_id)); assert.ok(!directory.tables.people.some(row => row.id === "unlinked-name"));
    await assert.rejects(db.prepare("UPDATE people SET account_id=?,version=version+1 WHERE scope=? AND id='unlinked-name'").bind(staff.id, scope).run(), /CONSTRAINT/);
});

test("reference buildings are real catalog entries; only J18 and selectable rooms may receive new assets", async () => {
    const scope = "reference-policy:demo", store = await fixture(scope), self = inventory(scope, staff), snapshot = await store.snapshot();
    assert.deepEqual(snapshot.buildings.map(row => [row.id, row.name]), [["E10", "Hilmer Building"], ["G17", "Electrical Engineering Building"], ["J18", "Willis Annexe"]]);
    assert.equal(snapshot.rooms.length, 2); assert.ok(snapshot.rooms.every(row => row.buildingId === "J18" && row.isPlaceholder && row.selectable));
    await assert.rejects(self.saveBattery(asset("WRONG-BUILDING", staff, { homeBuildingId: "E10", homeRoomId: null })), status(400));
    await assert.rejects(store.saveRoom({ id: "E10-ROOM", buildingId: "E10", number: "G19", name: "Unsupported room" }), status(400));
    await assert.rejects(store.importRecords("rooms", [{ id: "G17-ROOM", buildingId: "G17", number: "120", name: "Unsupported room" }]), status(400));
    await assert.rejects(self.importRecords("batteries", [asset("GOOD-ROW"), asset("BAD-ROW", staff, { homeBuildingId: "G17", homeRoomId: null })]), status(400));
    assert.ok(!(await self.snapshot()).batteries.some(row => ["GOOD-ROW", "BAD-ROW"].includes(row.id)));
    await self.saveBattery(asset("NO-ROOM", staff, { homeRoomId: null }));
    const saved = (await self.snapshot()).batteries.find(row => row.id === "NO-ROOM"); assert.equal(saved.homeRoomName, null); assert.equal(saved.homeRoomIsPlaceholder, null);
});

test("admin room verification is versioned and audited; catalog reads do not reset confirmed names", async () => {
    const scope = "room-verification:demo", store = await fixture(scope), self = inventory(scope, staff), room = (await store.snapshot()).rooms.find(row => row.id === "J18-DEMO-ROOM");
    const edit = { id: room.id, buildingId: "J18", number: "115", name: "Confirmed test room", isPlaceholder: false, expectedVersion: room.version };
    await assert.rejects(self.saveRoom(edit, true), status(403));
    await store.saveRoom(edit, true);
    await assert.rejects(store.saveRoom({ ...edit, name: "Stale room name" }, true), status(409));
    const after = (await store.snapshot()).rooms.find(row => row.id === room.id);
    assert.equal(after.name, edit.name); assert.equal(after.isPlaceholder, false); assert.equal(after.selectable, true); assert.equal(after.version, room.version + 1);
    const audit = (await store.snapshot()).events.filter(row => row.action === "room_updated");
    assert.equal(audit.length, 1); assert.equal(audit[0].details.after.isPlaceholder, false);
    const battery = (await store.snapshot()).batteries.find(row => row.id === "BAT-001"); assert.equal(battery.homeRoomIsPlaceholder, false);
    const exportDocument = await createExport(store, { dataset: "demo", mode: "detail", batteryId: "BAT-001", sections: ["storage"] });
    assert.equal(exportDocument.tables.Batteries[0].home_room_is_placeholder, false);
});

test("owner account disable between validation and commit rejects new registration/import without partial history", async () => {
    for (const [index, kind] of ["registration", "import"].entries()) {
        const scope = `owner-commit-${index}:demo`, store = await fixture(scope), before = (await store.snapshot()).events;
        const raced = inventory(scope, admin, beforeAtomicCommit(async () => { staff = await accounts.update({ ...staff, active: false, expectedVersion: staff.version }, admin); }));
        const operation = kind === "registration" ? raced.saveBattery(asset("RACE-OWNER")) : raced.importRecords("batteries", [asset("RACE-OWNER")]);
        await assert.rejects(operation, status(409));
        assert.ok(!(await store.snapshot()).batteries.some(row => row.id === "RACE-OWNER"));
        assert.deepEqual((await store.snapshot()).events, before);
        assert.equal(await db.prepare("SELECT COUNT(*) FROM operations WHERE scope=? AND kind IN ('battery_registered','records_imported')").bind(scope).first("COUNT(*)"), 0);
        staff = await accounts.update({ ...staff, active: true, expectedVersion: staff.version }, admin);
    }
});

test("disabled staff keep existing asset attribution; current account names appear without directory rewrites", async () => {
    const scope = "disabled-attribution:demo", store = await fixture(scope);
    await store.saveBattery(asset("ATTRIBUTED"));
    const native = (await db.prepare("SELECT * FROM people WHERE scope=? AND account_id=?").bind(scope, staff.id).all()).results[0];
    staff = await accounts.update({ ...staff, displayName: "Updated Staff Profile", active: false, expectedVersion: staff.version }, admin);
    const snapshot = await store.snapshot(), battery = snapshot.batteries.find(row => row.id === "ATTRIBUTED");
    assert.equal(battery.ownerAccountId, staff.id); assert.equal(battery.ownerName, staff.displayName);
    assert.equal(snapshot.staffDirectory.find(row => row.id === staff.id).active, false);
    assert.deepEqual((await db.prepare("SELECT * FROM people WHERE key=?").bind(native.key).all()).results[0], native);
    await assert.rejects(store.saveBattery(asset("NEW-DISABLED")), status(400));
    await store.saveBattery({ ...battery, name: "Edited existing attribution", expectedVersion: battery.version }, true);
    assert.equal((await store.snapshot()).batteries.find(row => row.id === "ATTRIBUTED").ownerAccountId, staff.id);
    staff = await accounts.update({ ...staff, active: true, expectedVersion: staff.version }, admin);
});

test("room availability migration is additive and preserves room identities, evidence and existing integrity triggers", async () => {
    const isolated = new Miniflare({ modules: true, script: "export default {fetch(){return new Response('room-migration')}}", compatibilityDate: "2026-05-15", d1Databases: { DB: "room-migration" }, d1Persist: false });
    try {
        const database = await isolated.getD1Database("DB"), entry = journal.entries.find(row => row.tag === "0007_room_availability");
        await migrate(database, journal.entries.filter(row => row.idx < entry.idx));
        await database.batch([
            database.prepare("INSERT INTO buildings(key,scope,id,name) VALUES('migration/J18','migration','J18','Existing building')"),
            database.prepare("INSERT INTO people(key,scope,id,name,role) VALUES('migration/OWNER','migration','OWNER','Existing owner','staff')"),
            database.prepare("INSERT INTO rooms(key,scope,id,name,building_key,number) VALUES('migration/ROOM','migration','ROOM','Existing room','migration/J18','115')"),
            database.prepare("INSERT INTO batteries(key,scope,id,name,owner_key,home_building_key,home_room_key,created_at) VALUES('migration/BAT','migration','BAT','Existing battery','migration/OWNER','migration/J18','migration/ROOM','2026-10-02T00:00:00.000Z')"),
            database.prepare("INSERT INTO observations(id,scope,battery_key,room_key,observed_at,received_at,source,room_name,room_building) VALUES('observation','migration','migration/BAT','migration/ROOM','2026-10-02T00:00:00.000Z','2026-10-02T00:00:00.000Z','Manual test evidence','115 - Existing room','J18 - Existing building')"),
        ]);
        const before = {}, tables = ["rooms", "batteries", "people", "observations"];
        for (const table of tables) before[table] = (await database.prepare(`SELECT * FROM ${table}`).all()).results;
        const triggers = (await database.prepare("SELECT name FROM sqlite_master WHERE type='trigger'").all()).results.map(row => row.name);
        await migrate(database, [entry]);
        for (const table of tables) {
            const after = (await database.prepare(`SELECT * FROM ${table}`).all()).results;
            assert.equal(after.length, before[table].length);
            for (const [index, row] of before[table].entries()) for (const [key, value] of Object.entries(row)) assert.equal(after[index][key], value);
        }
        const room = await database.prepare("SELECT is_placeholder,selectable FROM rooms").first(); assert.deepEqual(room, { is_placeholder: 0, selectable: 0 });
        const retained = (await database.prepare("SELECT name FROM sqlite_master WHERE type='trigger'").all()).results.map(row => row.name);
        assert.ok(triggers.every(name => retained.includes(name)));
        await assert.rejects(database.prepare("UPDATE rooms SET version=version+1,selectable=2 WHERE id='ROOM'").run(), /CONSTRAINT|CHECK/);
        await assert.rejects(database.prepare("INSERT OR REPLACE INTO rooms(key,scope,id,name,building_key,number,selectable) VALUES('migration/ROOM','migration','ROOM','Replaced room','migration/J18','115',1)").run(), /CONSTRAINT/);
        assert.deepEqual((await database.prepare("PRAGMA foreign_key_check").all()).results, []);
    } finally { await isolated.dispose(); }
});
