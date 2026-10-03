import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Miniflare } from "miniflare";
import { InventoryStore } from "../work/qa/store.mjs";
import { BatteryModelStore } from "../work/qa/battery-model-store.mjs";
import { listReferenceModels } from "../work/qa/battery-reference-catalog.mjs";

const mf = new Miniflare({ modules: true, script: "export default {fetch(){return new Response('test')}}", compatibilityDate: "2026-05-15", d1Databases: { DB: "model-registration-test" }, d1Persist: false });
const db = await mf.getD1Database("DB");
const journal = JSON.parse(await readFile("drizzle/meta/_journal.json", "utf8"));
for (const entry of journal.entries) {
    const sql = await readFile(`drizzle/${entry.tag}.sql`, "utf8");
    await db.batch(sql.split("--> statement-breakpoint").filter(part => part.trim()).map(part => db.prepare(part)));
}
after(() => mf.dispose());
const at = "2026-10-03T00:00:00.000Z";
for (const [id, role] of [["model-admin", "admin"], ["model-staff", "staff"]]) {
    await db.prepare("INSERT INTO staff_accounts(id,username,display_name,role,password_hash,password_salt,hash_iterations,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)")
        .bind(id, id, id, role, "test-only-no-login", "test-only-no-login", 600000, at, at).run();
}
const actor = { id: "model-staff", name: "Model Staff", role: "staff", authVersion: 1 };
const admin = { id: "model-admin", name: "Model Admin", role: "admin", authVersion: 1 };
const clock = () => new Date(at);
const inventory = (scope, database = db, user = actor) => new InventoryStore(database, scope, "live", user, clock);
const models = scope => new BatteryModelStore(db, scope, "live", { ...actor, displayName: actor.name }, clock);
const selection = choice => ({ origin: choice.origin, id: choice.id, contentHash: choice.contentHash, confirmed: true, appliedFields: ["name", "model", "chemistry", "capacityMah", "voltage"] });
const asset = (id, choice = {}) => ({ id, name: "Individual battery", model: "", chemistry: "", capacityMah: null, voltage: null, ...choice, ownerId: "staff-model-admin", homeBuildingId: "J18", homeRoomId: null, tagId: null, manufacturedOn: null, firstUsedOn: null });
const fields = choice => Object.fromEntries(["name", "model", "chemistry", "capacityMah", "voltage"].map(key => [key, choice[key]]));

test("reference-assisted registration keeps asset identity separate and saves authoritative evidence with overrides", async () => {
    const s = inventory("registration-reference"), refs = await listReferenceModels();
    const choice = refs.find(candidate => candidate.capacityMah !== null && candidate.voltage !== null);
    assert.ok(choice);
    await s.saveBattery({ ...asset("REF-001", fields(choice)), name: "Workshop individual pack", tagId: "INDIVIDUAL-REF-TAG", manufacturedOn: "2026-01-01", modelSelection: selection(choice), provenance: { fake: true } });
    const detail = await s.detail("REF-001"), saved = detail.battery;
    assert.equal(saved.ownerAccountId, "model-admin");
    assert.equal(saved.borrowerAccountId, null);
    assert.equal(saved.tagId, "INDIVIDUAL-REF-TAG");
    assert.equal(saved.manufacturedOn, "2026-01-01");
    assert.equal(saved.homeRoomId, null);
    assert.equal(saved.capacityMah, choice.capacityMah);
    assert.equal(detail.loans.length, 0);
    const event = detail.events.find(item => item.action === "battery_registered");
    const reference = event.details.modelReference;
    assert.equal(reference.model.contentHash, choice.contentHash);
    assert.equal(reference.provenance.modelRecord.catalog_id, choice.id);
    assert.ok(reference.provenance.sources.every(source => source.source_id && source.url));
    assert.ok(!reference.appliedFields.includes("name"));
    assert.ok(reference.overrides.includes("name"));
    assert.equal(reference.provenance.fake, undefined);
    const exported = await s.exportData();
    assert.ok(exported.raw.audit_events.some(item => item.battery_id === "REF-001" && JSON.parse(item.details_json).modelReference.provenance.modelRecord.catalog_id === choice.id));
});

test("unconfirmed, stale or forged model choices cannot register a physical battery", async () => {
    const s = inventory("registration-invalid"), [choice] = await listReferenceModels();
    await assert.rejects(s.saveBattery({ ...asset("BAD-CONFIRM"), modelSelection: { ...selection(choice), confirmed: false } }));
    await assert.rejects(s.saveBattery({ ...asset("BAD-HASH"), modelSelection: { ...selection(choice), contentHash: "0".repeat(64) } }), error => error.status === 409);
    await assert.rejects(s.saveBattery({ ...asset("BAD-ID"), modelSelection: { ...selection(choice), id: "nonexistent-reference" } }), error => error.status === 409);
    assert.equal((await s.snapshot()).batteries.length, 0);
    assert.equal((await s.fullActivity()).length, 0);
});

test("saving a reusable model creates no asset; staff reuse it for independent batteries", async () => {
    const scope = "registration-saved", s = inventory(scope);
    const result = await models(scope).create({ id: crypto.randomUUID(), brand: "Workshop", model: "PACK-A", variant: "Label revision A", name: "Workshop pack", chemistry: "Li-ion", capacityMah: 3000, voltage: 12, notes: "Staff-entered label information." });
    const choice = result.model;
    assert.equal((await s.snapshot()).batteries.length, 0);
    for (const id of ["SAVED-001", "SAVED-002"]) await s.saveBattery({ ...asset(id, fields(choice)), modelSelection: selection(choice) });
    const first = await s.detail("SAVED-001"), second = await s.detail("SAVED-002");
    assert.equal(first.battery.capacityMah, 3000);
    assert.equal(second.battery.capacityMah, 3000);
    assert.equal(first.events[0].details.modelReference.model.origin, "saved");
    assert.equal(first.events[0].details.modelReference.model.verificationStatus, "staff_entered");
    const editor = inventory(scope, db, admin);
    await editor.saveBattery({ ...asset("SAVED-001", fields(choice)), capacityMah: 2800, expectedVersion: 1 }, true);
    assert.equal((await editor.detail("SAVED-001")).battery.capacityMah, 2800);
    assert.equal((await editor.detail("SAVED-002")).battery.capacityMah, 3000);
    assert.equal((await models(scope).list()).models.find(candidate => candidate.id === choice.id).capacityMah, 3000);
});

test("model selection cannot bypass saved-metadata permissions; manual unknown registration remains available", async () => {
    const scope = "registration-manual", s = inventory(scope);
    await s.saveBattery(asset("SELF-BUILT"));
    const detail = await s.detail("SELF-BUILT");
    assert.equal(detail.battery.capacityMah, null);
    assert.equal(detail.battery.voltage, null);
    assert.equal(detail.events[0].details.modelReference, undefined);
    const [choice] = await listReferenceModels();
    await assert.rejects(s.saveBattery({ ...asset("SELF-BUILT"), expectedVersion: 1, modelSelection: selection(choice) }, true), error => error.status === 403);
    await assert.rejects(inventory(scope, db, admin).saveBattery({ ...asset("SELF-BUILT"), expectedVersion: 1, modelSelection: selection(choice) }, true), error => error.status === 400);
});

test("registered-model evidence is guarded again inside the physical registration transaction", async () => {
    const scope = "registration-race", s = inventory(scope);
    await s.saveBattery(asset("SOURCE", { model: "Existing source pack", chemistry: "Li-ion", capacityMah: 5000, voltage: 18 }));
    const choice = (await models(scope).list()).models.find(candidate => candidate.origin === "inventory");
    assert.ok(choice);
    let armed = true;
    const racingDb = {
        prepare: sql => db.prepare(sql),
        async batch(statements) {
            // The prepared reference data already exists. The remaining three-
            // statement batch is registration's guard, asset and audit write.
            if (armed && statements.length === 3) {
                armed = false;
                await db.prepare("UPDATE batteries SET capacity_mah=4000,version=version+1 WHERE scope=? AND id='SOURCE'").bind(scope).run();
            }
            return db.batch(statements);
        },
    };
    await assert.rejects(inventory(scope, racingDb).saveBattery({ ...asset("RACE-NEW", fields(choice)), modelSelection: selection(choice) }), error => error.status === 409);
    assert.equal(armed, false);
    assert.equal((await s.snapshot()).batteries.some(battery => battery.id === "RACE-NEW"), false);
    assert.equal((await s.fullActivity()).some(event => event.batteryId === "RACE-NEW"), false);
});
