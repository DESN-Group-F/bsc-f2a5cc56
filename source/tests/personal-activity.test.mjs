import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Miniflare } from "miniflare";
import { InventoryStore } from "../work/qa/store.mjs";
import { createExport } from "../work/qa/exports.mjs";
import { summaryCsv } from "../work/qa/downloads.mjs";
import { parseCsv } from "../work/qa/client-utils.mjs";

const mf = new Miniflare({ modules: true, script: "export default {fetch(){return new Response('personal-activity-test')}}", compatibilityDate: "2026-05-15", d1Databases: { DB: "personal-activity-test" }, d1Persist: false });
const db = await mf.getD1Database("DB"), journal = JSON.parse(await readFile("drizzle/meta/_journal.json", "utf8"));
for (const entry of journal.entries) {
    const sql = await readFile(`drizzle/${entry.tag}.sql`, "utf8");
    await db.batch(sql.split("--> statement-breakpoint").filter(statement => statement.trim()).map(statement => db.prepare(statement)));
}
after(() => mf.dispose());

const now = new Date("2026-10-02T04:00:00.000Z");
const self = { id: "activity-staff-one", name: "Same Staff Name", role: "staff", authVersion: 1 };
const other = { id: "activity-staff-two", name: "Same Staff Name", role: "staff", authVersion: 1 };
for (const actor of [self, other]) await db.prepare("INSERT INTO staff_accounts(id,username,display_name,role,password_hash,password_salt,hash_iterations,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)")
    .bind(actor.id, actor.id, actor.name, actor.role, "test-only-no-login", "test-only-no-login", 600000, now.toISOString(), now.toISOString()).run();

const store = (scope, actor = self, dataset = "demo") => new InventoryStore(db, scope, dataset, actor, () => now);
const asset = (id, owner) => ({ id, name: "Activity verification battery", ownerId: `staff-${owner.id}`, homeBuildingId: "J18", homeRoomId: null });
const ids = records => records.map(record => record.id).sort();
const byId = records => new Map(records.map(record => [record.id, record]));
const invalidInput = error => error.name === "ZodError" || error.status === 400;
const event = (scope, id, actor, extra = {}) => db.prepare("INSERT INTO audit_events(id,scope,action,battery_id,actor_id,actor_name,at,details_json) VALUES(?,?,?,?,?,?,?,?)")
    .bind(`${scope}/${id}`, scope, extra.action ?? "battery_updated", extra.batteryId ?? null, actor.id, actor.name, extra.at ?? now.toISOString(), JSON.stringify(extra.details ?? { note: "Isolated verification evidence" }));
async function returnBattery(inventory, batteryId) {
    const battery = (await inventory.snapshot()).batteries.find(row => row.id === batteryId);
    return inventory.movement({ requestId: crypto.randomUUID(), kind: "return", batteryIds: [batteryId], expectedLoans: [{ batteryId, loanId: battery.loanId }] });
}

test("My activity selects the operator account, independently of identical names, responsible owners and current borrowers", async () => {
    const scope = "activity-operators:demo", mine = store(scope), colleague = store(scope, other);
    await mine.saveBattery(asset("REGISTERED-BY-ME", other));
    await colleague.saveBattery(asset("REGISTERED-BY-OTHER", self));
    await mine.movement({ requestId: crypto.randomUUID(), kind: "checkout", batteryIds: ["REGISTERED-BY-ME"] });
    await returnBattery(colleague, "REGISTERED-BY-ME");
    await mine.movement({ requestId: crypto.randomUUID(), kind: "checkout", batteryIds: ["REGISTERED-BY-OTHER"] });
    await returnBattery(mine, "REGISTERED-BY-OTHER");

    const personal = await mine.fullActivity("mine"), theirs = await colleague.fullActivity("mine"), all = await mine.fullActivity();
    assert.deepEqual(personal.map(row => row.action).sort(), ["battery_registered", "checkout", "checkout", "return"]);
    assert.deepEqual(theirs.map(row => row.action).sort(), ["battery_registered", "return"]);
    assert.ok(personal.every(row => row.actorId === self.id && row.actorName === self.name));
    assert.ok(theirs.every(row => row.actorId === other.id && row.actorName === self.name));
    assert.equal(personal.find(row => row.action === "battery_registered").details.after.ownerId, `staff-${other.id}`);
    assert.equal(theirs.find(row => row.action === "return").details.borrowerAccountId, self.id);
    assert.equal(all.length, 6);
    assert.deepEqual(ids(all), ids([...personal, ...theirs]));
    assert.deepEqual(await mine.fullActivity("all"), all);
    assert.deepEqual(await colleague.fullActivity(), all);
    assert.equal((await mine.snapshot()).batteries.length, 2);
});

test("renaming an account retains its older operation attribution and does not adopt a colleague's matching-name history", async () => {
    const scope = "activity-rename:demo";
    await db.batch([event(scope, "before-rename", self), event(scope, "other-before-rename", other)]);
    const renamed = { ...self, name: "Updated Staff Name" };
    await db.prepare("UPDATE staff_accounts SET display_name=?,version=version+1,updated_at=? WHERE id=?").bind(renamed.name, now.toISOString(), self.id).run();
    await store(scope, renamed).saveBattery(asset("AFTER-RENAME", self));
    const personal = await store(scope, renamed).fullActivity("mine");
    assert.equal(personal.length, 2);
    assert.ok(personal.every(row => row.actorId === self.id));
    assert.equal(personal.find(row => row.id === `${scope}/before-rename`).actorName, self.name);
    assert.equal(personal.find(row => row.action === "battery_registered").actorName, renamed.name);
    assert.ok(!personal.some(row => row.id === `${scope}/other-before-rename`));
    assert.equal((await store(scope, other).fullActivity("mine"))[0].actorId, other.id);
    await db.prepare("UPDATE staff_accounts SET display_name=?,version=version+1,updated_at=? WHERE id=?").bind(self.name, now.toISOString(), self.id).run();
});

test("complete personal activity and downloads retain older records beyond the 200-event shared snapshot", async () => {
    const scope = "activity-complete:demo", mine = store(scope);
    const ownIds = Array.from({ length: 205 }, (_, index) => `OWN-${String(index).padStart(3, "0")}`);
    await db.batch(ownIds.map(id => event(scope, id, self, { at: "2026-10-01T01:00:00.000Z", details: { record: id } })));
    await db.batch(Array.from({ length: 210 }, (_, index) => event(scope, `OTHER-${index}`, other, { at: "2026-10-02T01:00:00.000Z" })));
    const snapshot = await mine.snapshot();
    assert.equal(snapshot.events.length, 200);
    assert.ok(snapshot.events.every(row => row.id.startsWith(`${scope}/OTHER-`)));
    const personal = await mine.fullActivity("mine");
    assert.equal(personal.length, 205);
    assert.deepEqual(ids(personal), ownIds.map(id => `${scope}/${id}`));
    assert.ok(personal.every(row => row.actorId === self.id));
    assert.equal((await mine.fullActivity()).length, 415);
    const document = await createExport(mine, { dataset: "demo", mode: "activity", activityScope: "mine" });
    assert.equal(document.metadata.activity_scope, "mine");
    assert.equal(document.metadata.exported_records, 205);
    assert.deepEqual(ids(document.tables.Activity), ids(personal));
    const csv = summaryCsv(document);
    assert.equal(csv.split("\r\n").length, 206);
    for (const id of ownIds) assert.ok(csv.includes(`"${scope}/${id}"`));
    assert.ok(!csv.includes(`${scope}/OTHER-`));
});

test("personal activity retains dataset boundaries, including the same actor in the separate live inventory", async () => {
    const demoScope = "activity-boundary:demo", liveScope = "activity-boundary:live";
    await db.batch([event(demoScope, "demo-own", self), event(demoScope, "demo-other", other), event(liveScope, "live-own", self), event(liveScope, "live-other", other)]);
    const demo = store(demoScope), live = store(liveScope, self, "live");
    assert.deepEqual(ids(await demo.fullActivity("mine")), [`${demoScope}/demo-own`]);
    assert.deepEqual(ids(await live.fullActivity("mine")), [`${liveScope}/live-own`]);
    for (const [inventory, dataset, expectedScope] of [[demo, "demo", demoScope], [live, "live", liveScope]]) {
        const document = await createExport(inventory, { dataset, mode: "activity", activityScope: "mine" });
        assert.equal(document.metadata.dataset, dataset);
        assert.equal(document.tables.Activity.length, 1);
        assert.equal(document.tables.Activity[0].scope, expectedScope);
        assert.equal(document.tables.Activity[0].actor_id, self.id);
    }
    assert.deepEqual(await store("activity-empty:demo").fullActivity("mine"), []);
});

test("personal activity exports search only the authenticated operator's complete records and preserve raw details in JSON and CSV", async () => {
    const scope = "activity-download:demo", mine = store(scope);
    const details = { reason: 'Unique NEEDLE, with "quoted text"\nand a second line', before: { version: 2 }, after: { version: 3 }, source: "Manual verification" };
    await db.batch([
        event(scope, "own-detail", self, { batteryId: "SEARCH-BATTERY", details }),
        event(scope, "own-directory", self, { action: "records_imported", details: { kind: "batteries", count: 3, note: "Needle directory operation" } }),
        event(scope, "own-unmatched", self, { batteryId: "DIFFERENT-BATTERY" }),
        event(scope, "other-matching", other, { batteryId: "SEARCH-BATTERY", details }),
    ]);
    const document = await createExport(mine, { dataset: "demo", mode: "activity", activityScope: "mine", search: "nEeDlE", actorId: other.id, viewerAccountId: other.id, actorName: other.name });
    assert.equal(document.metadata.activity_scope, "mine");
    assert.equal(document.metadata.search, "nEeDlE");
    assert.equal(document.metadata.exported_records, 2);
    assert.deepEqual(ids(document.tables.Activity), [`${scope}/own-detail`, `${scope}/own-directory`]);
    assert.ok(document.tables.Activity.every(row => row.actor_id === mine.viewerAccountId));
    assert.equal(document.tables.Activity.find(row => row.battery_id === null).action, "records_imported");
    const json = JSON.parse(JSON.stringify(document));
    assert.deepEqual(JSON.parse(byId(json.tables.Activity).get(`${scope}/own-detail`).details_json), details);
    const csv = parseCsv(summaryCsv(document)), rows = byId(csv);
    assert.deepEqual(ids(csv), ids(document.tables.Activity));
    assert.deepEqual(JSON.parse(rows.get(`${scope}/own-detail`).details_json), details);
    assert.ok(csv.every(row => row.actor_id === self.id && row.activity_scope === "mine" && row.search_query === "nEeDlE" && row.export_record_count === "2"));

    for (const search of ["search-battery", "BATTERY_UPDATED", "same staff name", "2026-10-02T04:00"]) {
        const filtered = await createExport(mine, { dataset: "demo", mode: "activity", activityScope: "mine", search });
        assert.ok(filtered.tables.Activity.length > 0);
        assert.ok(filtered.tables.Activity.every(row => row.actor_id === self.id));
    }
    assert.equal((await createExport(mine, { dataset: "demo", mode: "activity", activityScope: "mine", search: "not present" })).tables.Activity.length, 0);
    const all = await createExport(mine, { dataset: "demo", mode: "activity", search: "needle" });
    assert.equal(all.metadata.activity_scope, "all");
    assert.equal(all.tables.Activity.length, 3);
    assert.ok(all.tables.Activity.some(row => row.actor_id === other.id));
    assert.deepEqual(await createExport(mine, { dataset: "demo", mode: "activity", activityScope: "all", search: "needle" }).then(result => result.tables), all.tables);
});

test("malformed activity scopes reject instead of widening a personal request", async () => {
    const mine = store("activity-invalid:demo");
    for (const activityScope of ["", "staff", "MINE", self.id, null, [], {}]) {
        await assert.rejects(mine.fullActivity(activityScope), invalidInput);
        await assert.rejects(createExport(mine, { dataset: "demo", mode: "activity", activityScope }), invalidInput);
    }
});
