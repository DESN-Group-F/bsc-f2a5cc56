import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Miniflare } from 'miniflare';
import { OperatorRegistrationStore } from '../work/qa/server/inventory/operator-registration.mjs';
import { MobileRegistrationStore } from '../work/qa/server/inventory/mobile-registration.mjs';
import { IntakeStore } from '../work/qa/intake-store.mjs';
import { InventoryStore } from '../work/qa/store.mjs';
import { verifyOperatorRegistrationReceipt } from '../work/qa/operator-registration-session.mjs';

const mf = new Miniflare({ modules: true, script: "export default {fetch(){return new Response('operator-test')}}", compatibilityDate: '2026-05-15', d1Databases: { DB: 'operator-registration' }, d1Persist: false });
const db = await mf.getD1Database('DB');
const journal = JSON.parse(await readFile('drizzle/meta/_journal.json', 'utf8'));
for (const entry of journal.entries) {
  const sql = await readFile(`drizzle/${entry.tag}.sql`, 'utf8');
  await db.batch(sql.split('--> statement-breakpoint').filter(value => value.trim()).map(value => db.prepare(value)));
}
after(() => mf.dispose());
const at = '2026-10-04T14:01:00.000Z';
const actors = ['First staff', 'Other staff'].map(displayName => ({ id: crypto.randomUUID(), displayName, role: 'staff', authVersion: 1 }));
for (const [index, actor] of actors.entries()) await db.prepare('INSERT INTO staff_accounts(id,username,display_name,role,password_hash,password_salt,hash_iterations,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').bind(actor.id, `operator-test-${index}`, actor.displayName, actor.role, 'test-only', 'test-only', 600000, at, at).run();
const [self, other] = actors;
async function fixture(name, dataset = 'live') {
  const scope = `operator-${name}:${dataset}`;
  const inventory = new InventoryStore(db, scope, dataset, { ...self, name: self.displayName }, () => new Date(at));
  const snapshot = await inventory.snapshot();
  const owner = snapshot.people.find(person => person.accountId === other.id), building = snapshot.buildings.find(building => building.id === 'J18');
  return { scope, dataset, inventory, store: (actor = self, database = db) => new OperatorRegistrationStore(database, scope, dataset, actor, () => new Date(at)), input: { requestId: crypto.randomUUID(), sessionId: crypto.randomUUID(), source: 'operator-entered-registration', directoryBindings: { ownerVersion: owner.version, ownerAccountId: other.id, buildingVersion: building.version, roomVersion: null }, tagId: 'KNOWN-LABEL-001', firstUseMode: 'at_registration', common: { name: 'Reviewed working battery', model: '', chemistry: '', capacityMah: null, voltage: null, ownerId: `staff-${other.id}`, homeBuildingId: 'J18', homeRoomId: null, manufacturedOn: null, firstUsedOn: null } } };
}
const rows = async (table, scope) => (await db.prepare(`SELECT * FROM ${table} WHERE scope=? ORDER BY rowid`).bind(scope).all()).results;
const finalRejection = error => error.code === 'registration_rejected_final';
function beforeCommit(intervene) {
  let intercepted = false;
  const sqls = new WeakMap();
  return { prepare: sql => ({ bind: (...values) => { const statement = db.prepare(sql).bind(...values); sqls.set(statement, sql); return statement; } }), batch: async statements => {
    if (!intercepted && statements.some(statement => (sqls.get(statement) ?? '').includes("'operator_registration'"))) { intercepted = true; await intervene(); }
    return db.batch(statements);
  } };
}

test('operator registration works in Working inventory with automatic ID, server Sydney date and native attribution', async () => {
  const f = await fixture('working');
  const receipt = await f.store().register(f.input);
  assert.equal(receipt.batteryId, 'BAT-00000001'); assert.equal(receipt.firstUsedOn, '2026-10-05'); assert.equal(receipt.registeredAt, at);
  assert.equal(receipt.actorAccountId, self.id); assert.equal(receipt.ownerId, `staff-${other.id}`);
  assert.deepEqual(verifyOperatorRegistrationReceipt(receipt, f.input, self.id, 'live'), receipt);
  assert.equal(receipt.capacityMah, null); assert.equal(receipt.manufacturedOn, null);
  const [event] = await rows('audit_events', f.scope);
  assert.equal(event.actor_id, self.id); assert.equal(JSON.parse(event.details_json).source, 'operator-entered-registration');
  assert.equal((await rows('loans', f.scope)).length, 0); assert.equal((await rows('observations', f.scope)).length, 0);
  assert.equal((await rows('inventory_arrivals', f.scope)).length, 1);
  assert.equal((await f.store().register(f.input)).replayed, true);
  await assert.rejects(f.store(other).register(f.input), error => error.code === 'idempotency_conflict');
});
test('operator registration preserves mobile and simulated intake Working-inventory gates', async () => {
  const f = await fixture('gates');
  await assert.rejects(new MobileRegistrationStore(db, f.scope, 'live', self).register({ ...f.input, tagId: null }), error => error.status === 501);
  await assert.rejects(new IntakeStore(db, f.scope, 'live', self).register({ ...f.input, tagId: 'DEMO-INTAKE-TEST' }), error => error.status === 501);
  assert.equal((await rows('batteries', f.scope)).length, 0);
});
test('untagged concurrent registrations share one counter and retain explicit unknown service age', async () => {
  const f = await fixture('concurrent', 'demo');
  const receipts = await Promise.all(Array.from({ length: 4 }, (_, i) => f.store(i % 2 ? other : self).register({ ...f.input, requestId: crypto.randomUUID(), sessionId: crypto.randomUUID(), tagId: null, firstUseMode: 'unknown' })));
  assert.deepEqual(receipts.map(receipt => receipt.batteryId).sort(), ['BAT-00000001', 'BAT-00000002', 'BAT-00000003', 'BAT-00000004']);
  assert.ok(receipts.every(receipt => receipt.firstUsedOn === null));
});
test('duplicate tag and concurrent directory edits reserve final rejection without consuming a number', async () => {
  const f = await fixture('conflicts');
  await f.store().register(f.input);
  const duplicate = { ...f.input, requestId: crypto.randomUUID() };
  await assert.rejects(f.store().register(duplicate), finalRejection);
  await assert.rejects(f.store().register(duplicate), finalRejection);
  const changed = { ...f.input, requestId: crypto.randomUUID(), sessionId: crypto.randomUUID(), tagId: null };
  const proxy = beforeCommit(() => db.prepare('UPDATE people SET version=version+1 WHERE scope=? AND account_id=?').bind(f.scope, other.id).run());
  await assert.rejects(f.store(self, proxy).register(changed), finalRejection);
  assert.equal((await rows('batteries', f.scope)).length, 1);
  assert.equal((await rows('intake_counters', f.scope))[0].last_number, 1);
});
test('invalid native authority and future dates do not create a working battery', async () => {
  const f = await fixture('invalid');
  await assert.rejects(f.store({ ...self, authVersion: 2 }).register(f.input), error => error.status === 403);
  await assert.rejects(f.store().register({ ...f.input, common: { ...f.input.common, manufacturedOn: '2099-01-01' } }), finalRejection);
  assert.equal((await rows('batteries', f.scope)).length, 0);
});
test('directory changes between operator preparation and submission reject the captured versions', async () => {
  const f = await fixture('reviewed-directory');
  await db.prepare('UPDATE buildings SET name=?,version=version+1 WHERE scope=? AND id=?').bind('Later reviewed building name', f.scope, 'J18').run();
  await assert.rejects(f.store().register(f.input), finalRejection);
  await assert.rejects(f.store().register(f.input), finalRejection);
  assert.equal((await rows('batteries', f.scope)).length, 0);
  assert.equal((await rows('intake_counters', f.scope)).length, 0);
});
test('concurrent session creation cannot substitute newer directory bindings for the original review', async () => {
  const f = await fixture('concurrent-session-directory');
  const original = { ...f.input, tagId: null };
  const competing = { ...original, requestId: crypto.randomUUID(), directoryBindings: { ...original.directoryBindings, ownerVersion: original.directoryBindings.ownerVersion + 1 } };
  let competingReceipt;
  const proxy = beforeCommit(async () => {
    await db.prepare('UPDATE people SET version=version+1 WHERE scope=? AND account_id=?').bind(f.scope, other.id).run();
    competingReceipt = await f.store().register(competing);
  });
  // Both requests share one session and common fields; only the captured owner version differs.
  await assert.rejects(f.store(self, proxy).register(original), finalRejection);
  assert.equal(competingReceipt.batteryId, 'BAT-00000001');
  await assert.rejects(f.store().register(original), finalRejection);
  assert.equal((await f.store().register(competing)).replayed, true);
  assert.equal((await rows('batteries', f.scope)).length, 1);
  assert.equal((await rows('intake_counters', f.scope))[0].last_number, 1);
  const operations = await rows('operations', f.scope);
  assert.equal(operations.length, 2);
  assert.equal(operations.filter(operation => operation.kind === 'operator_registration_rejected').length, 1);
});
