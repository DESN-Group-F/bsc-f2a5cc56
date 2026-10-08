import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Miniflare } from "miniflare";
import { MobileRegistrationStore } from "../work/qa/server/inventory/mobile-registration.mjs";
import { InventoryStore } from "../work/qa/store.mjs";
import { IntakeStore } from "../work/qa/intake-store.mjs";
import { BatteryModelStore } from "../work/qa/battery-model-store.mjs";
import { captureMobileRegistrationAttempt, recoverMobileRegistrationAttempt, verifyMobileRegistrationReceipt, mobileRegistrationFailureStatus, mobileRegistrationPayloadSchema } from "../work/qa/mobile-registration-session.mjs";

const mf = new Miniflare({ modules: true, script: "export default {fetch(){return new Response('registration-test')}}", compatibilityDate: "2026-05-15", d1Databases: { DB: "mobile-registration-test" }, d1Persist: false });
const db = await mf.getD1Database("DB"), journal = JSON.parse(await readFile("drizzle/meta/_journal.json", "utf8"));
for (const entry of journal.entries) {
  const sql = await readFile(`drizzle/${entry.tag}.sql`, "utf8");
  await db.batch(sql.split("--> statement-breakpoint").filter(statement => statement.trim()).map(statement => db.prepare(statement)));
}
after(() => mf.dispose());
const at = "2026-10-04T14:01:00.000Z";
const self = { id: crypto.randomUUID(), displayName: "Shared Staff Name", role: "staff", authVersion: 1 };
const other = { id: crypto.randomUUID(), displayName: "Shared Staff Name", role: "staff", authVersion: 1 };
const admin = { id: crypto.randomUUID(), displayName: "Registration Administrator", role: "admin", authVersion: 1 };
for (const [index, actor] of [self, other, admin].entries()) await db.prepare("INSERT INTO staff_accounts(id,username,display_name,role,password_hash,password_salt,hash_iterations,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)")
  .bind(actor.id, `registration-actor-${index}`, actor.displayName, actor.role, "test-only-no-login", "test-only-no-login", 600000, at, at).run();
const rows = async (table, scope) => (await db.prepare(`SELECT * FROM ${table} WHERE scope=? ORDER BY rowid`).bind(scope).all()).results;
async function fixture(name, dataset = "demo") {
  const scope = `mobile-registration-${name}:${dataset}`;
  const inventory = new InventoryStore(db, scope, dataset, { ...admin, name: admin.displayName }, () => new Date(at));
  await inventory.snapshot();
  return {
    scope, dataset, inventory,
    registration: (actor = self, database = db, clock = () => new Date(at)) => new MobileRegistrationStore(database, scope, dataset, actor, clock),
    common: { name: "Operator-reviewed pack", model: "", chemistry: "", capacityMah: null, voltage: null, ownerId: `staff-${other.id}`, homeBuildingId: "J18", homeRoomId: null, manufacturedOn: null, firstUsedOn: null },
  };
}
const input = (context, extra = {}) => ({ requestId: crypto.randomUUID(), sessionId: crypto.randomUUID(), source: "operator-entered-registration", tagId: null, common: { ...context.common }, firstUseMode: "at_registration", ...extra });
const finalRejection = error => error.code === "registration_rejected_final";
function beforeCommit(intervene) {
  const sqlByStatement = new WeakMap();
  let intercepted = false;
  return {
    prepare: sql => {
      const statement = db.prepare(sql);
      return { bind: (...values) => { const bound = statement.bind(...values); sqlByStatement.set(bound, sql); return bound; } };
    },
    batch: async statements => {
      if (!intercepted && statements.some(statement => (sqlByStatement.get(statement) ?? "").includes("'manual_registration'"))) { intercepted = true; await intervene(); }
      return db.batch(statements);
    },
  };
}

test("manual registration keeps nullable unknowns, immutable server dates, identity and explicit source", async () => {
  const context = await fixture("one"), requested = input(context, { tagId: "nfc:uid:049F7C62A62090" });
  const receipt = await context.registration().register(requested);
  assert.equal(receipt.batteryId, "BAT-00000001");
  assert.equal(receipt.source, "operator-entered-registration");
  assert.equal(receipt.tagId, requested.tagId);
  assert.equal(receipt.registeredAt, at); assert.equal(receipt.firstUsedOn, "2026-10-05");
  assert.equal(receipt.actorAccountId, self.id); assert.equal(receipt.ownerId, `staff-${other.id}`);
  assert.equal(receipt.capacityMah, null); assert.equal(receipt.manufacturedOn, null);
  assert.deepEqual(verifyMobileRegistrationReceipt(receipt, captureMobileRegistrationAttempt(self.id, "demo", requested)), receipt);
  const [battery] = await rows("batteries", context.scope), [event] = await rows("audit_events", context.scope);
  assert.equal(battery.tag_id, requested.tagId); assert.equal(battery.created_at, at);
  assert.equal(event.actor_id, self.id); assert.equal(JSON.parse(event.details_json).source, receipt.source);
  assert.equal(JSON.parse(event.details_json).scannedAt, undefined);
  assert.equal((await rows("loans", context.scope)).length, 0);
  assert.equal((await rows("observations", context.scope)).length, 0);
});

test("untagged concurrent registrations and simulated intake share one automatic counter without changing sources", async () => {
  const context = await fixture("concurrent");
  const receipts = await Promise.all(Array.from({ length: 6 }, (_, index) => context.registration(index % 2 ? self : other).register(input(context))));
  assert.deepEqual(receipts.map(receipt => receipt.batteryId).sort(), Array.from({ length: 6 }, (_, index) => `BAT-${String(index + 1).padStart(8, "0")}`));
  assert.ok(receipts.every(receipt => receipt.tagId === null));
  const simulated = await new IntakeStore(db, context.scope, "demo", self, () => new Date(at)).register({ requestId: crypto.randomUUID(), sessionId: crypto.randomUUID(), tagId: "DEMO-INTAKE-SHARED-COUNTER", common: context.common, firstUseMode: "unknown" });
  assert.equal(simulated.batteryId, "BAT-00000007"); assert.equal(simulated.source, "simulated_intake");
  assert.equal((await rows("intake_counters", context.scope))[0].last_number, 7);
  assert.equal((await rows("batteries", context.scope)).length, 7);
  assert.equal((await rows("operations", context.scope)).filter(row => row.kind === "manual_registration").length, 6);
});

test("lost-response exact retries replay the original result after later edits and date changes", async () => {
  const context = await fixture("retry"), requested = input(context), proxy = beforeCommit(async () => {}), batch = proxy.batch;
  let lost = false;
  proxy.batch = async statements => { const result = await batch(statements); if (!lost) { lost = true; throw new Error("Controlled response loss after committed registration"); } return result; };
  const receipt = await context.registration(self, proxy).register(requested);
  assert.equal(receipt.replayed, true);
  await db.prepare("UPDATE batteries SET name='Later reviewed edit',version=version+1 WHERE scope=? AND id=?").bind(context.scope, receipt.batteryId).run();
  const replay = await context.registration(self, db, () => new Date("2026-10-09T04:00:00Z")).register(requested);
  assert.deepEqual(replay, receipt);
  assert.equal((await rows("batteries", context.scope)).length, 1);
  assert.equal((await rows("intake_counters", context.scope))[0].last_number, 1);
  assert.equal((await rows("audit_events", context.scope)).length, 1);
  await assert.rejects(context.registration().register({ ...requested, tagId: "nfc:uid:00000000" }), error => error.code === "idempotency_conflict");
  await assert.rejects(context.registration(other).register(requested), error => error.code === "idempotency_conflict");
});

test("duplicate UID gets a durable rejection; changed session details never create an asset", async () => {
  const context = await fixture("duplicate"), requested = input(context, { tagId: "nfc:uid:00000001" });
  await context.registration().register(requested);
  const duplicate = { ...requested, requestId: crypto.randomUUID() };
  await assert.rejects(context.registration().register(duplicate), finalRejection);
  await assert.rejects(context.registration().register(duplicate), finalRejection);
  await assert.rejects(context.registration().register({ ...requested, requestId: crypto.randomUUID(), tagId: null, common: { ...requested.common, name: "Changed session details" } }), finalRejection);
  assert.equal((await rows("batteries", context.scope)).length, 1);
  assert.equal((await rows("intake_counters", context.scope))[0].last_number, 1);
  assert.equal((await rows("operations", context.scope)).filter(row => row.kind === "manual_registration_rejected").length, 2);
});

test("unknown and stale accounts fail before writing; live mobile registration remains disabled", async () => {
  const context = await fixture("authority");
  await assert.rejects(context.registration({ ...self, id: crypto.randomUUID() }).register(input(context)), error => error.status === 403);
  await assert.rejects(context.registration({ ...self, authVersion: 2 }).register(input(context)), error => error.status === 403);
  assert.equal((await rows("batteries", context.scope)).length, 0);
  assert.equal((await rows("operations", context.scope)).length, 0);
  const live = await fixture("live", "live");
  await assert.rejects(live.registration().register(input(live)), error => error.status === 501);
  assert.equal((await rows("batteries", live.scope)).length, 0);
});

test("paused owner and directory changes atomically reject creation without burning an automatic ID", async () => {
  const context = await fixture("guards"), requested = input(context);
  const proxy = beforeCommit(() => db.prepare("UPDATE people SET version=version+1 WHERE scope=? AND account_id=?").bind(context.scope, other.id).run());
  await assert.rejects(context.registration(self, proxy).register(requested), finalRejection);
  assert.equal((await rows("batteries", context.scope)).length, 0);
  assert.equal((await rows("intake_counters", context.scope)).length, 0);
  assert.equal((await rows("intake_sessions", context.scope)).length, 0);
  assert.equal((await rows("audit_events", context.scope)).length, 0);
});

test("a terminal rejection prevents a delayed registration even after the invalid owner is restored", async () => {
  const context = await fixture("late"), requested = input(context);
  const proxy = beforeCommit(async () => {
    await db.prepare("UPDATE staff_accounts SET active=0 WHERE id=?").bind(other.id).run();
    try { await assert.rejects(context.registration().register(requested), finalRejection); }
    finally { await db.prepare("UPDATE staff_accounts SET active=1 WHERE id=?").bind(other.id).run(); }
  });
  await assert.rejects(context.registration(self, proxy).register(requested), finalRejection);
  assert.equal((await rows("batteries", context.scope)).length, 0);
  assert.equal((await rows("intake_counters", context.scope)).length, 0);
  assert.equal((await rows("operations", context.scope)).length, 1);
});

test("saved model mutation cannot overwrite reviewed registration evidence", async () => {
  const context = await fixture("model"), models = new BatteryModelStore(db, context.scope, "demo", self, () => new Date(at));
  const fields = { id: crypto.randomUUID(), brand: "Example", model: "Review-2200", variant: "Two-cell", name: "Reviewed model", chemistry: "LiPo", capacityMah: 2200, voltage: 7.4, notes: "Operator transcription." };
  const model = (await models.create(fields)).model;
  const appliedFields = ["name", "model", "chemistry", "capacityMah", "voltage"];
  const common = { ...context.common, ...Object.fromEntries(appliedFields.map(field => [field, model[field]])), modelSelection: { origin: model.origin, id: model.id, contentHash: model.contentHash, confirmed: true, appliedFields } };
  const requested = input(context, { common });
  const proxy = beforeCommit(() => db.prepare("UPDATE battery_models SET version=version+1 WHERE scope=? AND id=?").bind(context.scope, model.id).run());
  await assert.rejects(context.registration(self, proxy).register(requested), finalRejection);
  assert.equal((await rows("batteries", context.scope)).length, 0);
});

test("durable request recovery and receipt validation never substitute another account, UID, date or source", async () => {
  const context = await fixture("client"), requested = input(context), attempt = captureMobileRegistrationAttempt(self.id, "demo", requested);
  assert.deepEqual(recoverMobileRegistrationAttempt(JSON.stringify(attempt), self.id, "demo"), attempt);
  assert.equal(recoverMobileRegistrationAttempt(JSON.stringify(attempt), other.id, "demo"), null);
  assert.equal(recoverMobileRegistrationAttempt(JSON.stringify(attempt), self.id, "live"), null);
  const receipt = await context.registration().register(requested);
  for (const changed of [{ source: "simulated_intake" }, { tagId: "nfc:uid:00000000" }, { actorAccountId: other.id }, { firstUsedOn: "2026-10-04" }, { requestId: crypto.randomUUID() }])
    assert.throws(() => verifyMobileRegistrationReceipt({ ...receipt, ...changed }, attempt));
  assert.equal(mobileRegistrationFailureStatus({ status: 400 }, true), "uncertain");
  assert.equal(mobileRegistrationFailureStatus({ status: 409, code: "registration_rejected_final" }, true), "rejected");
  assert.equal(mobileRegistrationFailureStatus({ status: 401 }, true), "uncertain");
  assert.equal(mobileRegistrationFailureStatus({ status: 501 }), "rejected");
  for (const changed of [{ source: "native-nfc-reader" }, { scannedAt: at }, { tagId: "nfc:uid:049f7c62a62090" }, { common: { ...requested.common, teachingGroup: { id: crypto.randomUUID(), version: 1 } } }])
    assert.equal(mobileRegistrationPayloadSchema.safeParse({ ...requested, ...changed }).success, false);
});
