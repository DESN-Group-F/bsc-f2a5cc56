import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Miniflare } from "miniflare";
import { InventoryStore } from "../work/qa/store.mjs";

const mf = new Miniflare({ modules: true, script: "export default {fetch(){return new Response('scan-station-test')}}", compatibilityDate: "2026-05-15", d1Databases: { DB: "scan-station-test" }, d1Persist: false });
const db = await mf.getD1Database("DB"), journal = JSON.parse(await readFile("drizzle/meta/_journal.json", "utf8"));
for (const entry of journal.entries) {
    const sql = await readFile(`drizzle/${entry.tag}.sql`, "utf8");
    await db.batch(sql.split("--> statement-breakpoint").filter(statement => statement.trim()).map(statement => db.prepare(statement)));
}
after(() => mf.dispose());

const now = new Date("2026-10-02T05:00:00.000Z");
const admin = { id: crypto.randomUUID(), name: "Scan Administrator", role: "admin", authVersion: 1 };
const self = { id: crypto.randomUUID(), name: "Same Staff Name", role: "staff", authVersion: 1 };
const other = { id: crypto.randomUUID(), name: "Same Staff Name", role: "staff", authVersion: 1 };
for (const [index, actor] of [admin, self, other].entries()) await db.prepare("INSERT INTO staff_accounts(id,username,display_name,role,password_hash,password_salt,hash_iterations,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)")
    .bind(actor.id, `scan-actor-${index}`, actor.name, actor.role, "test-only-no-login", "test-only-no-login", 600000, now.toISOString(), now.toISOString()).run();

const tagOne = "000000000000000001", tagTwo = "0000aB02", roomId = "J18-DEMO-WORKSPACE";
const uuid = () => crypto.randomUUID();
const status = expected => error => error.status === expected;
const invalid = error => error.name === "ZodError" || error.status === 400;
const table = async (name, scope) => (await db.prepare(`SELECT * FROM ${name} WHERE scope=? ORDER BY rowid`).bind(scope).all()).results;
async function fixture(name, dataset = "demo") {
    const scope = `scan-${name}:${dataset}`, store = (actor = self, database = db) => new InventoryStore(database, scope, dataset, actor, () => now);
    for (const [id, tagId] of [["BAT-ONE", tagOne], ["BAT-TWO", tagTwo]]) await store(admin).saveBattery({ id, name: "Scan verification battery", tagId, ownerId: `staff-${other.id}`, homeBuildingId: "J18", homeRoomId: "J18-DEMO-ROOM" });
    return { scope, dataset, store };
}
async function scan(context, batteryIds = ["BAT-ONE"], source = "simulated", sessionId = uuid()) {
    const snapshot = await context.store().snapshot();
    return { sessionId, source, bindings: batteryIds.map(batteryId => {
        const battery = snapshot.batteries.find(record => record.id === batteryId);
        return { batteryId, tagId: battery.tagId, version: battery.version };
    }) };
}
async function returnInput(context, batteryIds = ["BAT-ONE"], source = "simulated", withRoom = true) {
    const snapshot = await context.store().snapshot(), room = snapshot.rooms.find(record => record.id === roomId);
    return {
        requestId: uuid(), kind: "return", batteryIds,
        expectedLoans: batteryIds.map(batteryId => ({ batteryId, loanId: snapshot.batteries.find(record => record.id === batteryId).loanId })),
        scan: await scan(context, batteryIds, source),
        ...(withRoom ? { returnRoom: { roomId: room.id, version: room.version } } : {}),
    };
}
async function ordinaryCheckout(context, batteryIds = ["BAT-ONE"], actor = self) {
    return context.store(actor).movement({ requestId: uuid(), kind: "checkout", batteryIds });
}
async function counts(context) {
    return {
        loans: await table("loans", context.scope), observations: await table("observations", context.scope),
        checkoutEvents: (await table("audit_events", context.scope)).filter(event => event.action === "checkout"),
        returnEvents: (await table("audit_events", context.scope)).filter(event => event.action === "return"),
        movementOperations: (await table("operations", context.scope)).filter(operation => ["checkout", "return"].includes(operation.kind)),
    };
}
async function rejectedScan(context, input, reason, database = db) {
    let firstError;
    await assert.rejects(context.store(self, database).movement(input), error => {
        firstError = error;
        return error.status === 409 && error.code === "movement_rejected_final" && reason.test(error.message);
    });
    await assert.rejects(context.store().movement(input), error => error.status === 409 && error.code === "movement_rejected_final" && error.message === firstError.message);
    const records = (await table("operations", context.scope)).filter(row => row.id === `${context.scope}/${input.requestId}`);
    assert.equal(records.length, 1);
    assert.equal(records[0].kind, "movement_rejected");
    const result = JSON.parse(records[0].result_json);
    assert.equal(result.kind, input.kind);
    assert.equal(result.rejected, true);
    assert.equal(result.status, 409);
    assert.equal(result.error, firstError.message);
}
function beforeAtomicCommit(intervene) {
    const sqlByStatement = new WeakMap();
    let intercepted = false;
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
async function editBattery(context, id, changes) {
    const before = (await context.store(admin).snapshot()).batteries.find(battery => battery.id === id);
    return context.store(admin).saveBattery({ ...before, ...changes, expectedVersion: before.version }, true);
}
async function editRoom(context, changes) {
    const before = (await context.store(admin).snapshot()).rooms.find(room => room.id === roomId);
    return context.store(admin).saveRoom({ ...before, buildingId: "J18", ...changes, expectedVersion: before.version }, true);
}

test("scan lookup resolves one scoped asset per exact tag, retains zero prefixes and case, and leaves unknown reads explicit", async () => {
    const context = await fixture("lookup"), before = await counts(context);
    const response = await context.store().scanLookup({ tagIds: [tagTwo, tagOne, tagTwo, "1", "0000AB02", "UNKNOWN"], source: "simulated" });
    assert.equal(response.source, "simulated");
    assert.deepEqual(response.results.map(result => result.tagId), [tagTwo, tagOne, "1", "0000AB02", "UNKNOWN"]);
    assert.deepEqual(response.results.map(result => result.battery?.id ?? null), ["BAT-TWO", "BAT-ONE", null, null, null]);
    assert.equal(response.results[1].battery.tagId, tagOne);
    assert.deepEqual(await counts(context), before);
    await assert.rejects(context.store(admin).saveBattery({ id: "DUPLICATE-TAG", name: "Duplicate test asset", tagId: tagOne, ownerId: `staff-${self.id}`, homeBuildingId: "J18" }), status(409));

    const foreign = await fixture("lookup-foreign");
    await foreign.store(admin).saveBattery({ id: "FOREIGN-ONLY", name: "Foreign scan asset", tagId: "FOREIGN-TAG", ownerId: `staff-${self.id}`, homeBuildingId: "J18" });
    assert.equal((await context.store().scanLookup({ tagIds: ["FOREIGN-TAG"], source: "manual" })).results[0].battery, null);
    assert.equal((await foreign.store().scanLookup({ tagIds: [tagOne], source: "manual" })).results[0].battery.id, "BAT-ONE");
});

test("simulation is confined to demonstration data and unsupported real-device sources are rejected", async () => {
    const demo = await fixture("source-policy"), live = await fixture("source-policy", "live");
    await assert.rejects(live.store().scanLookup({ tagIds: [tagOne], source: "simulated" }), invalid);
    await assert.rejects(live.store().movement({ requestId: uuid(), kind: "checkout", batteryIds: ["BAT-ONE"], scan: await scan(live) }), invalid);
    assert.equal((await live.store().scanLookup({ tagIds: [tagOne], source: "manual" })).results[0].battery.id, "BAT-ONE");
    for (const source of ["rfid", "reader", "hardware", "camera"]) {
        await assert.rejects(demo.store().scanLookup({ tagIds: [tagOne], source }), invalid);
        await assert.rejects(demo.store().movement({ requestId: uuid(), kind: "checkout", batteryIds: ["BAT-ONE"], scan: { ...await scan(demo), source } }), invalid);
    }
    for (const tagIds of [[], [123], [""], ["X".repeat(129)], Array.from({ length: 101 }, (_, index) => `TAG-${index}`)])
        await assert.rejects(demo.store().scanLookup({ tagIds, source: "manual" }), invalid);
    assert.equal((await counts(demo)).loans.length, 0);
    assert.equal((await counts(live)).loans.length, 0);
});

test("staff scan checkout borrows to the authenticated account and does not alter responsible ownership", async () => {
    const context = await fixture("checkout-identity"), reviewed = await scan(context, ["BAT-ONE", "BAT-TWO"]);
    const input = { requestId: uuid(), kind: "checkout", batteryIds: ["BAT-ONE", "BAT-TWO"], scan: reviewed };
    await assert.rejects(context.store().movement({ ...input, borrowerAccountId: other.id }), invalid);
    const result = await context.store().movement(input), snapshot = await context.store(other).snapshot();
    assert.equal(result.borrowerAccountId, self.id);
    assert.ok(snapshot.batteries.every(battery => battery.ownerAccountId === other.id && battery.borrowerAccountId === self.id));
    assert.equal(result.scan.sessionId, reviewed.sessionId);
    assert.equal(result.scan.source, "simulated");
    assert.equal(result.requestId, input.requestId);
    const events = (await table("audit_events", context.scope)).filter(event => event.action === "checkout");
    assert.equal(events.length, 2);
    assert.ok(events.every(event => event.actor_id === self.id && JSON.parse(event.details_json).scan.sessionId === reviewed.sessionId));
    for (const event of events) {
        const details = JSON.parse(event.details_json);
        assert.equal(details.requestId, result.requestId);
        assert.deepEqual(details.scan.bindings, reviewed.bindings.filter(binding => binding.batteryId === event.battery_id));
    }
    await assert.rejects(context.store().saveBattery({ ...snapshot.batteries[0], name: "Unauthorized scan metadata change", expectedVersion: snapshot.batteries[0].version }, true), status(403));
});

test("scan bindings must cover the selected batch exactly and cannot resolve a different asset or unknown tag", async () => {
    const context = await fixture("bindings"), reviewed = await scan(context, ["BAT-ONE", "BAT-TWO"]), before = await counts(context);
    const operation = bindings => context.store().movement({ requestId: uuid(), kind: "checkout", batteryIds: ["BAT-ONE", "BAT-TWO"], scan: { ...reviewed, bindings } });
    for (const bindings of [[], reviewed.bindings.slice(0, 1), [reviewed.bindings[0], reviewed.bindings[0]], [...reviewed.bindings, { batteryId: "OTHER", tagId: "OTHER", version: 1 }]])
        await assert.rejects(operation(bindings), invalid);
    await assert.rejects(operation([{ ...reviewed.bindings[0], tagId: tagTwo }, reviewed.bindings[1]]), error => error.status === 409 || error.status === 400);
    await rejectedScan(context, { requestId: uuid(), kind: "checkout", batteryIds: ["BAT-ONE", "BAT-TWO"], scan: { ...reviewed, bindings: [{ ...reviewed.bindings[0], tagId: "UNKNOWN" }, reviewed.bindings[1]] } }, /A scanned tag binding or battery record changed/);
    assert.deepEqual(await counts(context), before);
});

test("tag rebindings and metadata changes after review reject the entire batch before any loan is created", async () => {
    for (const [index, changes] of [{ tagId: "REBOUND-TAG" }, { name: "Renamed after scan review" }].entries()) {
        const context = await fixture(`stale-binding-${index}`), reviewed = await scan(context, ["BAT-ONE", "BAT-TWO"]);
        await editBattery(context, "BAT-TWO", changes);
        if (index === 0) await editBattery(context, "BAT-ONE", { tagId: tagTwo });
        const before = await counts(context);
        await rejectedScan(context, { requestId: uuid(), kind: "checkout", batteryIds: ["BAT-ONE", "BAT-TWO"], scan: reviewed }, /A scanned tag binding or battery record changed/);
        assert.deepEqual(await counts(context), before);
        assert.ok((await context.store().snapshot()).batteries.every(battery => battery.loanId === null));
    }
});

test("metadata-version and occupied-battery races at commit roll back the remaining selected batteries", async () => {
    const context = await fixture("binding-commit"), reviewed = await scan(context, ["BAT-ONE", "BAT-TWO"]), before = await counts(context);
    const raced = beforeAtomicCommit(async () => { await editBattery(context, "BAT-TWO", { name: "Version changed during confirmation" }); });
    await rejectedScan(context, { requestId: uuid(), kind: "checkout", batteryIds: ["BAT-ONE", "BAT-TWO"], scan: reviewed }, /The scanned battery bindings, loan state or account access changed/, raced);
    assert.deepEqual(await counts(context), before);
    const occupied = await fixture("occupied-batch"), occupiedReview = await scan(occupied, ["BAT-ONE", "BAT-TWO"]);
    await ordinaryCheckout(occupied, ["BAT-TWO"], other);
    const afterOtherLoan = await counts(occupied);
    await rejectedScan(occupied, { requestId: uuid(), kind: "checkout", batteryIds: ["BAT-ONE", "BAT-TWO"], scan: occupiedReview }, /The scanned battery bindings, loan state or account access changed/);
    assert.deepEqual(await counts(occupied), afterOtherLoan);
    assert.equal((await occupied.store().snapshot()).batteries.find(battery => battery.id === "BAT-ONE").loanId, null);
});

test("a staff scan return records explicit placement evidence with time, source and room snapshots while keeping the home unchanged", async () => {
    for (const source of ["manual", "simulated"]) {
        const context = await fixture(`placement-${source}`);
        await ordinaryCheckout(context, ["BAT-ONE", "BAT-TWO"]);
        const before = await context.store().snapshot(), input = await returnInput(context, ["BAT-ONE", "BAT-TWO"], source);
        const result = await context.store(other).movement(input), after = await context.store().snapshot(), observations = await table("observations", context.scope);
        assert.equal(result.count, 2);
        assert.equal(result.requestId, input.requestId);
        assert.equal(result.returnPlacement.roomId, roomId);
        assert.equal(result.returnPlacement.observedAt, now.toISOString());
        assert.match(result.returnPlacement.source, source === "simulated" ? /simulat/i : /staff|manual/i);
        assert.doesNotMatch(result.returnPlacement.source, /RFID reader|hardware detection/i);
        assert.equal(observations.length, 2);
        for (const observation of observations) {
            assert.equal(observation.room_key, `${context.scope}/${roomId}`);
            assert.equal(observation.observed_at, now.toISOString());
            assert.equal(observation.received_at, now.toISOString());
            assert.equal(observation.source, result.returnPlacement.source);
            assert.equal(observation.room_name, result.returnPlacement.roomName);
            assert.equal(observation.room_building, result.returnPlacement.building);
        }
        assert.ok(after.batteries.every(battery => battery.loanId === null && battery.homeRoomId === "J18-DEMO-ROOM" && battery.observedAt === now.toISOString()));
        assert.deepEqual(after.batteries.map(battery => battery.ownerAccountId), before.batteries.map(battery => battery.ownerAccountId));
        const events = (await table("audit_events", context.scope)).filter(event => event.action === "return");
        assert.ok(events.every(event => event.actor_id === other.id && JSON.parse(event.details_json).returnPlacement.roomId === roomId));
        assert.ok(events.every(event => JSON.parse(event.details_json).requestId === result.requestId));
        await editRoom(context, { name: "Different future room label" });
        assert.ok((await context.store().detail("BAT-ONE")).observations.every(observation => observation.roomName === result.returnPlacement.roomName));
    }
});

test("return confirmation cannot switch to a later loan or partially close the other reviewed assets", async () => {
    const context = await fixture("return-loans");
    await ordinaryCheckout(context, ["BAT-ONE", "BAT-TWO"]);
    const reviewed = await returnInput(context, ["BAT-ONE", "BAT-TWO"]), one = await returnInput(context, ["BAT-ONE"], "manual", false);
    await context.store().movement(one);
    await ordinaryCheckout(context, ["BAT-ONE"], other);
    const before = await counts(context);
    await assert.rejects(context.store().movement(reviewed), status(409));
    assert.deepEqual(await counts(context), before);
    assert.equal((await context.store().snapshot()).batteries.find(battery => battery.id === "BAT-TWO").loanId, reviewed.expectedLoans.find(loan => loan.batteryId === "BAT-TWO").loanId);

    const race = await fixture("return-loan-commit");
    await ordinaryCheckout(race, ["BAT-ONE", "BAT-TWO"]);
    const raceReview = await returnInput(race, ["BAT-ONE", "BAT-TWO"]), oneReview = await returnInput(race, ["BAT-ONE"], "manual", false);
    const raced = beforeAtomicCommit(async () => { await race.store(other).movement(oneReview); await ordinaryCheckout(race, ["BAT-ONE"], other); });
    await assert.rejects(race.store(self, raced).movement(raceReview), status(409));
    assert.equal((await table("observations", race.scope)).length, 0);
    assert.equal((await race.store().snapshot()).batteries.find(battery => battery.id === "BAT-TWO").loanId, raceReview.expectedLoans.find(loan => loan.batteryId === "BAT-TWO").loanId);
});

test("invalid, unavailable and changed return rooms reject all returns and location evidence", async () => {
    const context = await fixture("room-policy");
    await ordinaryCheckout(context, ["BAT-ONE", "BAT-TWO"]);
    const reviewed = await returnInput(context, ["BAT-ONE", "BAT-TWO"]), before = await counts(context);
    await assert.rejects(context.store().movement({ ...reviewed, requestId: uuid(), returnRoom: { roomId: "MISSING", version: 1 } }), invalid);
    await assert.rejects(context.store().movement({ ...reviewed, requestId: uuid(), scan: undefined }), invalid);
    await assert.rejects(context.store().movement({ requestId: uuid(), kind: "checkout", batteryIds: ["BAT-ONE"], scan: reviewed.scan, returnRoom: reviewed.returnRoom }), invalid);
    await editRoom(context, { name: "Changed after room review" });
    await rejectedScan(context, reviewed, /This return room changed/);
    assert.deepEqual(await counts(context), before);
    const fresh = await returnInput(context, ["BAT-ONE", "BAT-TWO"]);
    const raced = beforeAtomicCommit(async () => { await editRoom(context, { name: "Changed during return confirmation" }); });
    await rejectedScan(context, fresh, /The reviewed loan, scanned binding, return room or account access changed/, raced);
    assert.deepEqual(await counts(context), before);
    await db.prepare("UPDATE rooms SET selectable=0,version=version+1 WHERE scope=? AND id=?").bind(context.scope, roomId).run();
    const unavailable = await returnInput(context, ["BAT-ONE", "BAT-TWO"]);
    await assert.rejects(context.store().movement(unavailable), invalid);
    assert.deepEqual(await counts(context), before);

    const live = await fixture("verified-live-room", "live");
    await ordinaryCheckout(live);
    const provisional = await returnInput(live, ["BAT-ONE"], "manual");
    await assert.rejects(live.store().movement(provisional), invalid);
    assert.equal((await table("observations", live.scope)).length, 0);
    assert.ok((await live.store().snapshot()).batteries.find(battery => battery.id === "BAT-ONE").loanId);
    await editRoom(live, { name: "Verified local return room", number: "115", isPlaceholder: false });
    const verified = await returnInput(live, ["BAT-ONE"], "manual");
    const receipt = await live.store(other).movement(verified);
    assert.equal(receipt.returnPlacement.isPlaceholder, false);
    assert.equal(receipt.returnPlacement.source, "Staff return confirmation");
    assert.equal((await table("observations", live.scope)).length, 1);
    await assert.rejects(live.store().observation({ requestId: uuid(), batteryId: "BAT-ONE", roomId, observedAt: now.toISOString() }), status(403));

    const buildingRace = await fixture("building-commit");
    await ordinaryCheckout(buildingRace);
    const buildingReview = await returnInput(buildingRace), buildingBefore = await counts(buildingRace);
    const building = (await buildingRace.store(admin).snapshot()).buildings.find(record => record.id === "J18");
    const buildingChanged = beforeAtomicCommit(async () => { await buildingRace.store(admin).saveBuilding({ ...building, name: "Changed building label during confirmation", expectedVersion: building.version }, true); });
    await rejectedScan(buildingRace, buildingReview, /The reviewed loan, scanned binding, return room or account access changed/, buildingChanged);
    assert.deepEqual(await counts(buildingRace), buildingBefore);
});

test("successful scan requests replay their receipt after later tag/room edits without duplicate loans, returns or observations", async () => {
    const context = await fixture("retry"), checkout = { requestId: uuid(), kind: "checkout", batteryIds: ["BAT-ONE", "BAT-TWO"], scan: await scan(context, ["BAT-ONE", "BAT-TWO"]) };
    const firstCheckout = await context.store().movement(checkout);
    assert.equal((await context.store().movement(checkout)).replayed, true);
    assert.equal((await context.store().movement({ ...checkout, batteryIds: [...checkout.batteryIds].reverse(), scan: { ...checkout.scan, bindings: [...checkout.scan.bindings].reverse() } })).replayed, true);
    assert.equal((await counts(context)).loans.length, 2);
    assert.equal((await counts(context)).checkoutEvents.length, 2);
    const input = await returnInput(context), receipt = await context.store(other).movement(input);
    await editBattery(context, "BAT-ONE", { tagId: "NEW-TAG-AFTER-COMMIT" });
    await editRoom(context, { name: "New room name after commit" });
    const before = await counts(context), replay = await context.store(other).movement(input);
    assert.equal(replay.replayed, true);
    assert.deepEqual({ ...replay, replayed: undefined }, { ...receipt, replayed: undefined });
    assert.deepEqual(await counts(context), before);
    assert.equal(before.observations.length, 1);
    assert.equal(before.returnEvents.length, 1);
    await assert.rejects(context.store(other).movement({ ...input, scan: { ...input.scan, sessionId: uuid() } }), status(409));
    await assert.rejects(context.store(other).movement({ ...input, scan: { ...input.scan, source: "manual" } }), status(409));
    assert.equal(firstCheckout.scan.sessionId, checkout.scan.sessionId);
});

test("ordinary movements remain supported and manual scans do not fabricate placement when no room was selected", async () => {
    const context = await fixture("ordinary"), result = await ordinaryCheckout(context);
    assert.equal(result.borrowerAccountId, self.id);
    const expectedLoans = (await context.store().snapshot()).batteries.filter(battery => battery.id === "BAT-ONE").map(battery => ({ batteryId: battery.id, loanId: battery.loanId }));
    await context.store(other).movement({ requestId: uuid(), kind: "return", batteryIds: ["BAT-ONE"], expectedLoans });
    assert.equal((await table("observations", context.scope)).length, 0);
    const live = await fixture("ordinary", "live");
    await live.store().movement({ requestId: uuid(), kind: "checkout", batteryIds: ["BAT-ONE"], scan: await scan(live, ["BAT-ONE"], "manual") });
    await live.store(other).movement(await returnInput(live, ["BAT-ONE"], "manual", false));
    assert.equal((await table("observations", live.scope)).length, 0);
    assert.ok((await live.store().snapshot()).batteries.every(battery => battery.loanId === null && battery.observedAt === null));
});

test("a 100-battery scanned return retains every loan binding and placement atomically without exceeding D1 parameters", async () => {
    const context = await fixture("maximum-return"), batteryIds = Array.from({ length: 100 }, (_, index) => `BULK-${String(index).padStart(3, "0")}`);
    await context.store().importRecords("batteries", batteryIds.map((id, index) => ({ id, name: "Bulk scan verification battery", tagId: `000-BULK-${String(index).padStart(3, "0")}`, ownerId: `staff-${other.id}`, homeBuildingId: "J18", homeRoomId: "J18-DEMO-ROOM" })));
    await ordinaryCheckout(context, batteryIds);
    const input = await returnInput(context, batteryIds), result = await context.store(other).movement(input);
    assert.equal(result.count, 100);
    assert.equal(result.scan.bindings.length, 100);
    const current = await counts(context);
    assert.equal(current.loans.length, 100);
    assert.ok(current.loans.every(loan => loan.returned_at === now.toISOString()));
    assert.equal(current.returnEvents.length, 100);
    assert.equal(current.observations.length, 100);
    assert.equal(new Set(current.observations.map(observation => observation.battery_key)).size, 100);
    assert.ok(current.observations.every(observation => observation.room_key === `${context.scope}/${roomId}` && observation.source === "Simulated return confirmation"));
    assert.equal((await context.store(other).movement(input)).replayed, true);
    assert.deepEqual(await counts(context), current);
});
