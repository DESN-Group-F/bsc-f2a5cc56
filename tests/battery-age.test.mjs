import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Miniflare } from "miniflare";
import { InventoryStore } from "../work/qa/store.mjs";
import { parseCsv, importPayload } from "../work/qa/client-utils.mjs";
import { currentSydneyDate, isDateOnly, ageInDays, calendarAge } from "../work/qa/battery-age.mjs";

const runtimeOptions = name => ({ modules: true, script: "export default {fetch(){return new Response('test')}}", compatibilityDate: "2026-05-15", d1Databases: { DB: name }, d1Persist: false });
const runtime = new Miniflare(runtimeOptions("battery-age-test"));
const db = await runtime.getD1Database("DB");
const journal = JSON.parse(await readFile("drizzle/meta/_journal.json", "utf8"));
async function migrate(database, entries) {
    for (const entry of entries) {
        const sql = await readFile(`drizzle/${entry.tag}.sql`, "utf8");
        await database.batch(sql.split("--> statement-breakpoint").filter(value => value.trim()).map(value => database.prepare(value)));
    }
}
await migrate(db, journal.entries);
after(() => runtime.dispose());
const now = new Date("2026-10-01T14:05:00.000Z"), uuid = () => crypto.randomUUID();
const actor = role => ({ id: `age-${role}`, name: `Age Test ${role}`, role, authVersion: 1 });
for (const role of ["admin", "staff"]) {
    const value = actor(role);
    await db.prepare("INSERT INTO staff_accounts(id,username,display_name,role,password_hash,password_salt,hash_iterations,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)")
        .bind(value.id, value.id, value.name, value.role, "test-only-no-login", "test-only-no-login", 600000, now.toISOString(), now.toISOString()).run();
}
const store = (scope, role = "admin", database = db) => new InventoryStore(database, scope, "demo", actor(role), () => now);
async function demo(scope) { const value = store(scope); await value.initializeDemo(); return value; }
const asset = (id, dates = {}) => ({ id, name: "Age test battery", ownerId: "staff-age-admin", homeBuildingId: "J18", homeRoomId: null, ...dates });
const battery = async (value, id) => (await value.snapshot()).batteries.find(record => record.id === id);
const status = expected => error => error.status === expected;
const count = async (table, scope, database = db) => (await database.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE scope=?`).bind(scope).first()).count;

test("date-only validation rejects calendar normalization, malformed formats and year zero", () => {
    for (const value of ["0001-01-01", "0099-12-31", "1900-02-28", "2000-02-29", "2024-02-29", "9999-12-31"]) assert.equal(isDateOnly(value), true, value);
    for (const value of ["", "0000-01-01", "10000-01-01", "2026-1-01", "2026-01-1", "2026-00-01", "2026-13-01", "2026-01-00", "2026-01-32", "1900-02-29", "2026-02-29", "2026-04-31", "2026-10-02T00:00:00Z", " 2026-10-02", "2026-10-02 "]) assert.equal(isDateOnly(value), false, value);
});

test("the age reference date follows Sydney midnight in standard and daylight-saving time", () => {
    assert.equal(currentSydneyDate(new Date("2026-10-01T13:59:59Z")), "2026-10-01");
    assert.equal(currentSydneyDate(new Date("2026-10-01T14:00:00Z")), "2026-10-02");
    assert.equal(currentSydneyDate(new Date("2026-10-05T12:59:59Z")), "2026-10-05");
    assert.equal(currentSydneyDate(new Date("2026-10-05T13:00:00Z")), "2026-10-06");
});

test("elapsed days preserve leap years, century rules and early years without timezone drift", () => {
    assert.equal(ageInDays("2026-10-02", "2026-10-02"), 0);
    assert.equal(ageInDays("2024-02-28", "2024-03-01"), 2);
    assert.equal(ageInDays("1900-02-28", "1900-03-01"), 1);
    assert.equal(ageInDays("2000-02-28", "2000-03-01"), 2);
    assert.equal(ageInDays("0099-12-31", "0100-01-01"), 1);
    assert.equal(ageInDays("2025-12-31", "2026-01-01"), 1);
    for (const value of [null, "2026-10-03", "2026-02-30"]) assert.equal(ageInDays(value, "2026-10-02"), null);
    assert.equal(ageInDays("2026-10-02", "invalid"), null);
});

test("calendar age counts completed months with clamped month-end anniversaries", () => {
    assert.deepEqual(calendarAge("2026-10-02", "2026-10-02"), { years: 0, months: 0, days: 0 });
    assert.deepEqual(calendarAge("2025-01-31", "2025-02-28"), { years: 0, months: 1, days: 0 });
    assert.deepEqual(calendarAge("2025-01-31", "2025-03-30"), { years: 0, months: 1, days: 30 });
    assert.deepEqual(calendarAge("2025-01-31", "2025-03-31"), { years: 0, months: 2, days: 0 });
    assert.deepEqual(calendarAge("2024-02-29", "2025-02-28"), { years: 1, months: 0, days: 0 });
    assert.deepEqual(calendarAge("2024-02-29", "2025-03-01"), { years: 1, months: 0, days: 1 });
    assert.deepEqual(calendarAge("2025-12-31", "2026-01-01"), { years: 0, months: 0, days: 1 });
    for (const value of [null, "2026-10-03", "2026-02-30"]) assert.equal(calendarAge(value, "2026-10-02"), null);
    assert.equal(calendarAge("2026-10-02", "invalid"), null);
});

test("unknown dates remain null and are never inferred from registration or historical loans", async () => {
    const value = await demo("age-unknown:demo"), initial = await value.snapshot();
    assert.ok(initial.batteries.every(record => record.manufacturedOn === null && record.firstUsedOn === null));
    await value.saveBattery(asset("UNKNOWN-AGE"));
    const saved = await battery(value, "UNKNOWN-AGE");
    assert.equal(saved.manufacturedOn, null); assert.equal(saved.firstUsedOn, null);
    const raw = await db.prepare("SELECT manufactured_on,first_used_on,created_at FROM batteries WHERE scope=? AND id=?").bind(value.scope, saved.id).first();
    assert.equal(raw.created_at, now.toISOString()); assert.equal(raw.manufactured_on, null); assert.equal(raw.first_used_on, null);
    assert.equal(ageInDays(saved.manufacturedOn, currentSydneyDate(now)), null);
    await value.movement({ requestId: uuid(), kind: "checkout", batteryIds: ["BAT-003"] });
    assert.ok((await value.detail("BAT-003")).loans[0].checkedOutAt);
    assert.equal((await battery(value, "BAT-003")).firstUsedOn, null);
});

test("staff register known, partial and same-day dates, while only administrators edit them", async () => {
    const scope = "age-permissions:demo", admin = await demo(scope), staff = store(scope, "staff");
    const registrations = [
        asset("KNOWN", { manufacturedOn: "2024-02-29", firstUsedOn: "2024-03-01" }),
        asset("MANUFACTURE-ONLY", { manufacturedOn: "2020-01-31" }),
        asset("USE-ONLY", { firstUsedOn: "2026-10-02" }),
        asset("SAME-DAY", { manufacturedOn: "2026-10-02", firstUsedOn: "2026-10-02" }),
    ];
    for (const input of registrations) await staff.saveBattery(input);
    for (const input of registrations) {
        const saved = await battery(admin, input.id);
        assert.equal(saved.manufacturedOn, input.manufacturedOn ?? null); assert.equal(saved.firstUsedOn, input.firstUsedOn ?? null);
    }
    let known = await battery(admin, "KNOWN"), detail = await admin.detail(known.id);
    assert.equal(detail.events.find(event => event.action === "battery_registered").actorName, actor("staff").name);
    const beforeEvents = detail.events.length;
    await assert.rejects(staff.saveBattery({ ...known, manufacturedOn: "2023-02-28", expectedVersion: known.version }, true), status(403));
    assert.equal((await admin.detail(known.id)).events.length, beforeEvents);
    await admin.saveBattery({ ...known, manufacturedOn: "2023-02-28", firstUsedOn: null, expectedVersion: known.version }, true);
    known = await battery(admin, known.id); detail = await admin.detail(known.id);
    assert.equal(known.manufacturedOn, "2023-02-28"); assert.equal(known.firstUsedOn, null); assert.equal(known.version, 2);
    const edit = detail.events.find(event => event.action === "battery_updated");
    assert.equal(edit.details.before.manufactured_on, "2024-02-29"); assert.equal(edit.details.before.first_used_on, "2024-03-01");
    assert.equal(edit.details.after.manufacturedOn, "2023-02-28"); assert.equal(edit.details.after.firstUsedOn, null);
});

test("registration rejects impossible, future or reversed dates before saving rows or audit events", async () => {
    const value = await demo("age-invalid:demo"), before = await value.snapshot();
    const invalid = [
        { manufacturedOn: "2026-02-30" }, { firstUsedOn: "1900-02-29" }, { manufacturedOn: "0000-01-01" },
        { manufacturedOn: "2026-10-03" }, { firstUsedOn: "2026-10-03" }, { manufacturedOn: "2026-10-02T00:00:00Z" },
        { manufacturedOn: "2026-10-02", firstUsedOn: "2026-10-01" },
    ];
    for (const [index, dates] of invalid.entries()) await assert.rejects(value.saveBattery(asset(`BAD-DATE-${index}`, dates)));
    assert.deepEqual(await value.snapshot(), before);
});

test("CSV dates map to nullable fields and validation of a mixed batch saves no records or audit", async () => {
    const scope = "age-csv:demo", value = await demo(scope), staff = store(scope, "staff");
    const header = "id,name,owner_id,storage_building_id,storage_room_id,manufactured_on,first_used_on";
    const payload = importPayload("batteries", parseCsv(`${header}\nCSV-KNOWN,CSV known,staff-age-admin,J18,,2024-02-29,2024-03-01\nCSV-UNKNOWN,CSV unknown,staff-age-admin,J18,,,\n`));
    assert.equal(payload[0].manufacturedOn, "2024-02-29"); assert.equal(payload[0].firstUsedOn, "2024-03-01");
    assert.equal(payload[1].manufacturedOn, null); assert.equal(payload[1].firstUsedOn, null);
    await staff.importRecords("batteries", payload);
    assert.equal((await battery(value, "CSV-KNOWN")).manufacturedOn, "2024-02-29"); assert.equal((await battery(value, "CSV-UNKNOWN")).firstUsedOn, null);
    const beforeCount = await count("batteries", scope), beforeAudit = await count("audit_events", scope);
    const invalidCases = [{ manufacturedOn: "2026-02-30" }, { firstUsedOn: "2026-10-03" }, { manufacturedOn: "2026-10-02", firstUsedOn: "2026-10-01" }];
    for (const [index, invalid] of invalidCases.entries()) {
        await assert.rejects(staff.importRecords("batteries", [asset(`CSV-VALID-${index}`, { manufacturedOn: "2024-02-29" }), asset(`CSV-BAD-${index}`, invalid)]));
        assert.equal(await count("batteries", scope), beforeCount); assert.equal(await count("audit_events", scope), beforeAudit);
        assert.equal(await battery(value, `CSV-VALID-${index}`), undefined);
    }
    const oldFormat = importPayload("batteries", parseCsv("id,name,owner_id,storage_building_id,storage_room_id\nCSV-OLD,Older template,staff-age-admin,J18,\n"));
    await staff.importRecords("batteries", oldFormat);
    const old = await battery(value, "CSV-OLD"); assert.equal(old.manufacturedOn, null); assert.equal(old.firstUsedOn, null);
});

function pauseNextBatch(database = db) {
    let signal, resume;
    const ready = new Promise(resolve => { signal = resolve; }), gate = new Promise(resolve => { resume = resolve; });
    return { ready, resume, db: { prepare: sql => database.prepare(sql), async batch(statements) { signal(); await gate; return database.batch(statements); } } };
}

test("a date edit paused after validation cannot overwrite another date edit or append false history", async () => {
    const scope = "age-edit-race:demo", value = await demo(scope);
    await value.saveBattery(asset("AGE-RACE", { manufacturedOn: "2024-01-31", firstUsedOn: "2024-03-01" }));
    const initial = await battery(value, "AGE-RACE"), gate = pauseNextBatch(), delayed = store(scope, "admin", gate.db);
    const pending = delayed.saveBattery({ ...initial, manufacturedOn: "2023-01-31", expectedVersion: initial.version }, true);
    const rejected = assert.rejects(pending, error => error.status === 409 && error.code === "record_conflict");
    await gate.ready;
    await value.saveBattery({ ...initial, firstUsedOn: "2024-04-01", expectedVersion: initial.version }, true);
    gate.resume(); await rejected;
    const latest = await battery(value, initial.id);
    assert.equal(latest.manufacturedOn, initial.manufacturedOn); assert.equal(latest.firstUsedOn, "2024-04-01"); assert.equal(latest.version, 2);
    assert.equal((await value.detail(initial.id)).events.filter(event => event.action === "battery_updated").length, 1);
});

test("database date guards reject malformed dates and reversed ordering on insert and update", async () => {
    const scope = "age-db-guards:demo", value = await demo(scope);
    await value.saveBattery(asset("DATE-GUARD", { manufacturedOn: "2024-02-29", firstUsedOn: "2024-03-01" }));
    const initial = await battery(value, "DATE-GUARD"), before = await value.snapshot();
    for (const [index, date] of ["2026-02-30", "1900-02-29", "0000-01-01", "2026-1-01", "2026-04-31", "2026-10-02T00:00:00Z"].entries()) {
        await assert.rejects(db.prepare("INSERT INTO batteries(key,scope,id,name,owner_key,home_building_key,created_at,manufactured_on) VALUES(?,?,?,?,?,?,?,?)").bind(`${scope}/DIRECT-${index}`, scope, `DIRECT-${index}`, "Invalid direct date", `${scope}/staff-age-admin`, `${scope}/J18`, now.toISOString(), date).run(), /CONSTRAINT|CHECK/i);
        await assert.rejects(db.prepare("UPDATE batteries SET first_used_on=?,version=version+1 WHERE key=?").bind(date, `${scope}/${initial.id}`).run(), /CONSTRAINT|CHECK/i);
    }
    await assert.rejects(db.prepare("INSERT INTO batteries(key,scope,id,name,owner_key,home_building_key,created_at,manufactured_on,first_used_on) VALUES(?,?,?,?,?,?,?,?,?)").bind(`${scope}/REVERSED`, scope, "REVERSED", "Reversed dates", `${scope}/staff-age-admin`, `${scope}/J18`, now.toISOString(), "2024-03-01", "2024-02-29").run(), /CONSTRAINT|CHECK/i);
    await assert.rejects(db.prepare("UPDATE batteries SET manufactured_on='2024-03-02',version=version+1 WHERE key=?").bind(`${scope}/${initial.id}`).run(), /CONSTRAINT|CHECK/i);
    assert.deepEqual(await value.snapshot(), before);
});

test("the age migration preserves old records, actor history and all prior integrity guards", async () => {
    const legacyRuntime = new Miniflare(runtimeOptions("battery-age-legacy"));
    try {
        const legacyDb = await legacyRuntime.getD1Database("DB"), scope = "age-legacy:demo";
        const ageIndex = journal.entries.findIndex(entry => entry.tag.startsWith("0005_"));
        assert.ok(ageIndex >= 0, "The age migration must be registered in the journal.");
        await migrate(legacyDb, journal.entries.slice(0, ageIndex));
        const key = id => `${scope}/${id}`, loanId = uuid(), chargeId = uuid(), observationId = uuid(), eventId = uuid();
        await legacyDb.batch([
            legacyDb.prepare("INSERT INTO buildings(key,scope,id,name) VALUES(?,?,?,?)").bind(key("J18"), scope, "J18", "Legacy building"),
            legacyDb.prepare("INSERT INTO people(key,scope,id,name,role) VALUES(?,?,?,?,?)").bind(key("owner"), scope, "owner", "Legacy owner", "staff"),
            legacyDb.prepare("INSERT INTO people(key,scope,id,name,role) VALUES(?,?,?,?,?)").bind(key("borrower"), scope, "borrower", "Legacy borrower", "borrower"),
            legacyDb.prepare("INSERT INTO rooms(key,scope,id,name,building_key,number) VALUES(?,?,?,?,?,?)").bind(key("room"), scope, "room", "Legacy room", key("J18"), "115"),
            legacyDb.prepare("INSERT INTO batteries(key,scope,id,name,owner_key,home_building_key,home_room_key,created_at) VALUES(?,?,?,?,?,?,?,?)").bind(key("LEGACY"), scope, "LEGACY", "Legacy battery", key("owner"), key("J18"), key("room"), "2020-01-01T00:00:00.000Z"),
            legacyDb.prepare("INSERT INTO loans(id,scope,battery_key,borrower_key,borrower_name,checked_out_at,checkout_actor_id,checkout_actor_name) VALUES(?,?,?,?,?,?,?,?)").bind(loanId, scope, key("LEGACY"), key("borrower"), "Legacy borrower", "2025-01-01T00:00:00.000Z", "old-staff", "Original Staff"),
            legacyDb.prepare("INSERT INTO charges(id,scope,battery_key,completed_at,duration_minutes,recorded_at,actor_id,actor_name) VALUES(?,?,?,?,?,?,?,?)").bind(chargeId, scope, key("LEGACY"), now.toISOString(), 120, now.toISOString(), "old-staff", "Original Staff"),
            legacyDb.prepare("INSERT INTO observations(id,scope,battery_key,room_key,observed_at,received_at,source,room_name,room_building) VALUES(?,?,?,?,?,?,?,?,?)").bind(observationId, scope, key("LEGACY"), key("room"), now.toISOString(), now.toISOString(), "Legacy observed source", "115 - Legacy room", "J18 - Legacy building"),
            legacyDb.prepare("INSERT INTO audit_events(id,scope,action,battery_id,actor_id,actor_name,at,details_json) VALUES(?,?,?,?,?,?,?,?)").bind(eventId, scope, "checkout", "LEGACY", "old-staff", "Original Staff", now.toISOString(), JSON.stringify({ loanId, note: "Preserved original evidence" })),
        ]);
        const tables = ["batteries", "people", "buildings", "rooms", "loans", "charges", "observations", "audit_events"];
        const before = Object.fromEntries(await Promise.all(tables.map(async table => [table, (await legacyDb.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()).results])));
        await migrate(legacyDb, journal.entries.slice(ageIndex, ageIndex + 1));
        for (const table of tables) {
            const rows = (await legacyDb.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()).results;
            assert.deepEqual(rows, table === "batteries" ? before[table].map(row => ({ ...row, manufactured_on: null, first_used_on: null })) : before[table], table);
        }
        // The current reader also requires later additive columns. Check the age migration first,
        // then apply later migrations before reading through the current application.
        await migrate(legacyDb, journal.entries.slice(ageIndex + 1));
        const value = store(scope, "admin", legacyDb), saved = await battery(value, "LEGACY");
        assert.equal(saved.manufacturedOn, null); assert.equal(saved.firstUsedOn, null); assert.equal(saved.checkedOutAt, "2025-01-01T00:00:00.000Z");
        assert.equal((await value.detail("LEGACY")).loans[0].checkoutActorName, "Original Staff");
        const invalid = [
            legacyDb.prepare("UPDATE batteries SET name='Unversioned change' WHERE key=?").bind(key("LEGACY")),
            legacyDb.prepare("UPDATE batteries SET owner_key=?,version=version+1 WHERE key=?").bind(key("borrower"), key("LEGACY")),
            legacyDb.prepare("UPDATE batteries SET scope='other:demo',version=version+1 WHERE key=?").bind(key("LEGACY")),
            legacyDb.prepare("UPDATE people SET role='borrower',version=version+1 WHERE key=?").bind(key("owner")),
            legacyDb.prepare("UPDATE observations SET room_name='Changed evidence' WHERE id=?").bind(observationId),
            legacyDb.prepare("UPDATE charges SET duration_minutes=60 WHERE id=?").bind(chargeId),
            legacyDb.prepare("INSERT OR REPLACE INTO batteries(key,scope,id,name,owner_key,home_building_key,created_at) VALUES(?,?,?,?,?,?,?)").bind(key("LEGACY"), scope, "LEGACY", "Replacement", key("owner"), key("J18"), now.toISOString()),
        ];
        for (const statement of invalid) await assert.rejects(statement.run(), /CONSTRAINT|CHECK/i);
        assert.equal((await battery(value, "LEGACY")).version, 1);
        assert.deepEqual((await legacyDb.prepare("PRAGMA foreign_key_check").all()).results, []);
        const preserved = await value.detail("LEGACY");
        assert.equal(preserved.loans[0].id, loanId); assert.equal(preserved.charges[0].id, chargeId);
        assert.equal(preserved.observations[0].id, observationId); assert.equal(preserved.events[0].id, eventId);
    } finally { await legacyRuntime.dispose(); }
});
