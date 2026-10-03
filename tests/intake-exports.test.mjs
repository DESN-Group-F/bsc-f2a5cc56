import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Miniflare } from "miniflare";
import { IntakeStore } from "../work/qa/intake-store.mjs";
import { InventoryStore } from "../work/qa/store.mjs";
import { createExport } from "../work/qa/exports.mjs";

const mf = new Miniflare({ modules: true, script: "export default {fetch(){return new Response('test')}}", compatibilityDate: "2026-05-15", d1Databases: { DB: "intake-export-tests" }, d1Persist: false });
const db = await mf.getD1Database("DB");
const journal = JSON.parse(await readFile("drizzle/meta/_journal.json", "utf8"));
for (const entry of journal.entries) {
    const sql = await readFile(`drizzle/${entry.tag}.sql`, "utf8");
    await db.batch(sql.split("--> statement-breakpoint").filter(part => part.trim()).map(part => db.prepare(part)));
}
after(() => mf.dispose());
const at = "2026-10-03T14:30:00.000Z", clock = () => new Date(at);
const actor = { id: "intake-export-admin", displayName: "Intake Administrator", role: "admin", authVersion: 1 };
await db.prepare("INSERT INTO staff_accounts(id,username,display_name,role,password_hash,password_salt,hash_iterations,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)")
    .bind(actor.id, actor.id, actor.displayName, actor.role, "test-only-no-login", "test-only-no-login", 600000, at, at).run();
const inventory = scope => new InventoryStore(db, scope, "demo", { ...actor, name: actor.displayName }, clock);
const intake = scope => new IntakeStore(db, scope, "demo", actor, clock);
const common = { name: "New demo battery", model: "PACK-A", chemistry: "Li-ion", capacityMah: 3000, voltage: 12, ownerId: `staff-${actor.id}`, homeBuildingId: "J18", homeRoomId: null, manufacturedOn: null, firstUsedOn: null };
const request = (tag, extra = {}) => ({ requestId: crypto.randomUUID(), sessionId: crypto.randomUUID(), tagId: `DEMO-INTAKE-${tag}`, common, firstUseMode: "at_registration", ...extra });

test("intake exports separate registration, manufacture age and confirmed service start in all scopes", async context => {
    context.mock.timers.enable({ apis: ["Date"], now: new Date(at) });
    const scope = "intake-exports-ages", s = inventory(scope);
    const first = await intake(scope).register(request("UNKNOWN-PRODUCTION"));
    const second = await intake(scope).register(request("KNOWN-PRODUCTION", { common: { ...common, manufacturedOn: "2026-09-01" } }));
    const summary = await createExport(s, { dataset: "demo", mode: "summary" });
    const unknown = summary.tables.Inventory.find(row => row.battery_id === first.batteryId);
    assert.equal(unknown.registered_at_utc, at);
    assert.equal(unknown.model, common.model);
    assert.equal(unknown.chemistry, common.chemistry);
    assert.equal(unknown.manufactured_on, null);
    assert.equal(unknown.manufacturing_age_days, null);
    assert.equal(unknown.first_used_on, "2026-10-04");
    assert.equal(unknown.time_in_service_days, 0);
    const known = summary.tables.Inventory.find(row => row.battery_id === second.batteryId);
    assert.equal(known.manufacturing_age_days, 33);
    const filtered = await createExport(s, { dataset: "demo", mode: "summary", filter: { ageMode: "unknown" } });
    assert.deepEqual(filtered.tables.Inventory.map(row => row.battery_id), [first.batteryId]);
    const selected = await createExport(s, { dataset: "demo", mode: "detail", range: "selected", batteryIds: [first.batteryId, second.batteryId], sections: ["specifications", "audit"] });
    assert.equal(selected.tables.Batteries.length, 2);
    assert.ok(selected.tables.Batteries.every(row => row.created_at === at && row.registered_at_utc === at));
    const events = selected.tables.Operations.map(row => JSON.parse(row.details_json));
    assert.ok(events.every(details => details.source === "simulated_intake" && details.firstUseMode === "at_registration"));
});

test("registration timestamp survives metadata correction, loans and subsequent returns", async () => {
    const scope = "intake-exports-history", s = inventory(scope), saved = await intake(scope).register(request("HISTORY"));
    const asset = (await s.detail(saved.batteryId)).battery;
    assert.equal(asset.registeredAt, at);
    await s.saveBattery({ id: saved.batteryId, ...common, name: "Corrected battery name", firstUsedOn: saved.firstUsedOn, expectedVersion: asset.version }, true);
    await s.movement({ requestId: crypto.randomUUID(), kind: "checkout", batteryIds: [saved.batteryId] });
    const loan = (await s.detail(saved.batteryId)).battery;
    await s.movement({ requestId: crypto.randomUUID(), kind: "return", batteryIds: [saved.batteryId], expectedLoans: [{ batteryId: saved.batteryId, loanId: loan.loanId }] });
    assert.equal((await s.detail(saved.batteryId)).battery.registeredAt, at);
    const document = await createExport(s, { dataset: "demo", mode: "detail", batteryId: saved.batteryId, sections: ["specifications", "loans", "audit"] });
    assert.equal(document.tables.Batteries[0].created_at, at);
    assert.equal(document.tables.Batteries[0].registered_at_utc, at);
    assert.equal(document.tables.Loans.length, 1);
    assert.ok(document.tables.Operations.some(row => row.action === "battery_registered"));
    assert.ok(document.tables.Operations.some(row => row.action === "battery_updated"));
});
