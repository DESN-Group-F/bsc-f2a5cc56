import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Miniflare } from 'miniflare';
import { InventoryStore } from '../work/qa/store.mjs';
import { OperatorEditStore } from '../work/qa/server/inventory/operator-edit.mjs';
import { verifyOperatorEditOutcome } from '../work/qa/operator-edit.mjs';

const mf = new Miniflare({ modules: true, script: "export default {fetch(){return new Response('operator-edit-test')}}", compatibilityDate: '2026-05-15', d1Databases: { DB: 'operator-edit' }, d1Persist: false });
const db = await mf.getD1Database('DB');
for (const entry of JSON.parse(await readFile('drizzle/meta/_journal.json', 'utf8')).entries) {
  const sql = await readFile(`drizzle/${entry.tag}.sql`, 'utf8');
  await db.batch(sql.split('--> statement-breakpoint').filter(value => value.trim()).map(value => db.prepare(value)));
}
after(() => mf.dispose());
const at = '2026-10-11T03:00:00.000Z';
const fieldNames = ['name', 'model', 'chemistry', 'capacityMah', 'voltage', 'tagId', 'ownerId', 'homeBuildingId', 'homeRoomId', 'manufacturedOn', 'firstUsedOn'];
const fieldsOf = battery => Object.fromEntries(fieldNames.map(field => [field, battery[field]]));
const rows = async (table, scope) => (await db.prepare(`SELECT * FROM ${table} WHERE scope=? ORDER BY rowid`).bind(scope).all()).results;
const rejectsAccess = error => error.status === 403;
const conflict = error => error.code === 'idempotency_conflict';

async function fixture(name, dataset = 'live') {
  const scope = `operator-edit-${name}:${dataset}`;
  const actors = ['admin', 'staff', 'admin'].map((role, index) => ({ id: crypto.randomUUID(), displayName: `Edit ${name} ${index}`, role, authVersion: 1 }));
  for (const actor of actors) await db.prepare('INSERT INTO staff_accounts(id,username,display_name,role,password_hash,password_salt,hash_iterations,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').bind(actor.id, actor.id, actor.displayName, actor.role, 'test-only', 'test-only', 600000, at, at).run();
  const [admin, owner, otherAdmin] = actors;
  const inventory = (actor = admin) => new InventoryStore(db, scope, dataset, { ...actor, name: actor.displayName }, () => new Date(at));
  await inventory().snapshot();
  await inventory().saveBattery({ id: 'BAT-ONE', name: 'Original battery', model: '', chemistry: '', capacityMah: null, voltage: null, tagId: null, ownerId: `staff-${owner.id}`, homeBuildingId: 'J18', homeRoomId: null, manufacturedOn: null, firstUsedOn: null });
  const request = async (changes = {}) => {
    const snapshot = await inventory().snapshot(), battery = snapshot.batteries.find(battery => battery.id === 'BAT-ONE');
    const fields = { ...fieldsOf(battery), ...changes }, person = snapshot.people.find(person => person.id === fields.ownerId), building = snapshot.buildings.find(building => building.id === 'J18'), room = snapshot.rooms.find(room => room.id === fields.homeRoomId);
    return { requestId: crypto.randomUUID(), batteryId: battery.id, before: { ...fieldsOf(battery), version: battery.version, registeredAt: battery.registeredAt }, fields, directoryBindings: { ownerVersion: person.version, ownerAccountId: person.accountId, buildingVersion: building.version, roomVersion: room?.version ?? null } };
  };
  return { scope, dataset, admin, owner, otherAdmin, inventory, request, store: (actor = admin, database = db) => new OperatorEditStore(database, scope, dataset, actor, () => new Date(at)) };
}
function beforeCommit(intervene, { failure, after = false } = {}) {
  const sqls = new WeakMap(); let intercepted = false;
  return {
    prepare: sql => ({ bind: (...values) => { const statement = db.prepare(sql).bind(...values); sqls.set(statement, { sql, values }); return statement; } }),
    batch: async statements => {
      const target = !intercepted && statements.some(statement => { const record = sqls.get(statement); return record?.sql.startsWith('INSERT INTO operations(') && record.values[2] === 'metadata_edit'; });
      if (target) { intercepted = true; await intervene(); if (failure && !after) throw failure; }
      const result = await db.batch(statements);
      if (target && failure && after) throw failure;
      return result;
    },
  };
}
async function assertFinal(f, input, outcome) {
  assert.equal(outcome.state, 'rejected');
  assert.equal(outcome.code, 'metadata_edit_rejected_final');
  assert.deepEqual(await verifyOperatorEditOutcome(outcome, input, f.admin.id, f.dataset), outcome);
  assert.deepEqual(await f.store().edit(input), outcome);
  assert.deepEqual(await f.store().lookup(input), outcome);
  assert.equal((await rows('audit_events', f.scope)).filter(event => event.action === 'battery_updated').length, 0);
}

test('authoritative metadata edit preserves loans, creation clock, unknown values, observation and arrival history', async () => {
  for (const dataset of ['live', 'demo']) {
    const f = await fixture(`success-${dataset}`, dataset);
    await f.inventory(f.owner).movement({ requestId: crypto.randomUUID(), kind: 'checkout', batteryIds: ['BAT-ONE'] });
    const loans = await rows('loans', f.scope), arrivals = await rows('inventory_arrivals', f.scope);
    const input = await f.request({ name: 'Edited battery', model: 'Reviewed model', manufacturedOn: '2026-01-01', firstUsedOn: '2026-02-01', tagId: 'EDIT-TAG' });
    assert.equal((await f.store().lookup(input)).state, 'missing');
    const outcome = await f.store().edit(input);
    assert.equal(outcome.state, 'confirmed');
    assert.deepEqual(await verifyOperatorEditOutcome(outcome, input, f.admin.id, dataset), outcome);
    assert.deepEqual(await rows('loans', f.scope), loans); assert.deepEqual(await rows('inventory_arrivals', f.scope), arrivals);
    assert.deepEqual(await rows('observations', f.scope), []);
    const battery = (await f.inventory().detail('BAT-ONE')).battery;
    assert.equal(battery.registeredAt, input.before.registeredAt); assert.equal(battery.loanId, loans[0].id); assert.equal(battery.version, input.before.version + 1);
    assert.deepEqual(fieldsOf(battery), input.fields);
    const events = (await rows('audit_events', f.scope)).filter(event => event.action === 'battery_updated');
    assert.equal(events.length, 1); assert.equal(events[0].actor_id, f.admin.id);
    assert.equal(JSON.parse(events[0].details_json).requestId, input.requestId);
    assert.deepEqual(await f.store().edit(input), { state: 'confirmed', receipt: { ...outcome.receipt, replayed: true } });
    assert.deepEqual(await f.store().lookup(input), { state: 'confirmed', receipt: { ...outcome.receipt, replayed: true } });
  }
});
test('same request identity rejects changed fields, reviewed directory, actor and cross-inventory reuse', async () => {
  const f = await fixture('identity'), input = await f.request({ name: 'Saved name' });
  await f.store().edit(input);
  await assert.rejects(f.store().edit({ ...input, fields: { ...input.fields, name: 'Changed payload' } }), conflict);
  await assert.rejects(f.store().lookup({ ...input, directoryBindings: { ...input.directoryBindings, ownerVersion: 20 } }), conflict);
  await assert.rejects(f.store(f.otherAdmin).lookup(input), conflict);
  await assert.rejects(new OperatorEditStore(db, f.scope, 'demo', f.admin).lookup(input), conflict);
  assert.equal((await f.inventory().detail('BAT-ONE')).battery.name, 'Saved name');
});
test('staff cannot edit, but a reauthenticated demoted administrator can resolve only their original outcome', async () => {
  const f = await fixture('demoted'), input = await f.request({ name: 'Saved before demotion' });
  await assert.rejects(f.store(f.owner).edit(input), rejectsAccess);
  const outcome = await f.store().edit(input);
  await db.prepare("UPDATE staff_accounts SET role='staff',auth_version=auth_version+1 WHERE id=?").bind(f.admin.id).run();
  await assert.rejects(f.store().lookup(input), rejectsAccess);
  const demoted = { ...f.admin, role: 'staff', authVersion: 2 };
  assert.deepEqual(await f.store(demoted).lookup(input), { state: 'confirmed', receipt: { ...outcome.receipt, replayed: true } });
  assert.deepEqual(await f.store(demoted).edit(input), { state: 'confirmed', receipt: { ...outcome.receipt, replayed: true } });
  const next = await f.request({ name: 'Forbidden after demotion' });
  assert.equal((await f.store(demoted).lookup(next)).state, 'missing');
  await assert.rejects(f.store(demoted).edit(next), rejectsAccess);
  await db.prepare('UPDATE staff_accounts SET active=0,auth_version=auth_version+1 WHERE id=?').bind(f.admin.id).run();
  await assert.rejects(f.store({ ...demoted, authVersion: 3 }).lookup(input), rejectsAccess);
});
test('current inactive owner can be retained, but a different inactive owner cannot be assigned', async () => {
  const f = await fixture('inactive-owner');
  await db.prepare('UPDATE staff_accounts SET active=0,auth_version=auth_version+1 WHERE id=?').bind(f.owner.id).run();
  const retained = await f.request({ name: 'Retain inactive owner' });
  assert.equal((await f.store().edit(retained)).state, 'confirmed');
  const assign = await f.request({ ownerId: `staff-${f.otherAdmin.id}` });
  await db.prepare('UPDATE staff_accounts SET active=0,auth_version=auth_version+1 WHERE id=?').bind(f.otherAdmin.id).run();
  const outcome = await f.store().edit(assign);
  assert.equal(outcome.state, 'rejected'); assert.equal((await f.inventory().detail('BAT-ONE')).battery.ownerAccountId, f.owner.id);
});
test('stale original fields or future dates reserve terminal rejection without changing metadata', async () => {
  for (const kind of ['before', 'date']) {
    const f = await fixture(`invalid-${kind}`), input = await f.request({ name: 'Must not save' });
    if (kind === 'before') input.before.name = 'Fabricated original'; else input.fields.manufacturedOn = '2099-01-01';
    await assertFinal(f, input, await f.store().edit(input));
    assert.equal((await f.inventory().detail('BAT-ONE')).battery.name, 'Original battery');
  }
});
for (const directory of ['owner', 'building', 'room']) test(`atomic ${directory} directory version guard rejects a change after validation`, async () => {
  const f = await fixture(`race-${directory}`), input = await f.request({ name: 'Must not save', ...(directory === 'room' ? { homeRoomId: 'J18-DEMO-ROOM' } : {}) });
  const table = directory === 'owner' ? 'people' : directory === 'building' ? 'buildings' : 'rooms';
  const id = directory === 'owner' ? input.fields.ownerId : directory === 'building' ? 'J18' : input.fields.homeRoomId;
  const proxy = beforeCommit(() => db.prepare(`UPDATE ${table} SET version=version+1 WHERE scope=? AND id=?`).bind(f.scope, id).run());
  await assertFinal(f, input, await f.store(f.admin, proxy).edit(input));
  assert.equal((await f.inventory().detail('BAT-ONE')).battery.version, input.before.version);
});
test('exact version and null-tag guards reject a competing administrator metadata edit atomically', async () => {
  const f = await fixture('race-battery'), input = await f.request({ name: 'Must not save' });
  const other = await f.request({ tagId: 'COMPETING-TAG', name: 'Competing saved name' });
  const proxy = beforeCommit(() => f.store(f.otherAdmin).edit(other));
  const outcome = await f.store(f.admin, proxy).edit(input);
  assert.equal(outcome.state, 'rejected');
  assert.deepEqual(await f.store().edit(input), outcome);
  const battery = (await f.inventory().detail('BAT-ONE')).battery;
  assert.equal(battery.tagId, 'COMPETING-TAG'); assert.equal(battery.name, 'Competing saved name');
  assert.equal((await rows('audit_events', f.scope)).filter(event => event.action === 'battery_updated').length, 1);
});
test('duplicate tag and retired lifecycle at the commit boundary cannot save an edit', async () => {
  for (const race of ['tag', 'lifecycle']) {
    const f = await fixture(`race-${race}`), input = await f.request({ name: 'Must not save', tagId: 'CLAIMED-TAG' });
    const proxy = beforeCommit(() => race === 'tag'
      ? f.inventory().saveBattery({ id: 'BAT-TWO', name: 'Other battery', tagId: input.fields.tagId, ownerId: input.fields.ownerId, homeBuildingId: 'J18' })
      : f.inventory().lifecycle({ requestId: crypto.randomUUID(), kind: 'scrapped', source: 'manual_selection', reason: '', destination: null, items: [{ batteryId: input.batteryId, version: input.before.version, tagId: input.before.tagId }] }));
    await assertFinal(f, input, await f.store(f.admin, proxy).edit(input));
    assert.equal((await f.inventory().detail('BAT-ONE')).battery.name, 'Original battery');
  }
});
test('native authority revocation during commit rolls back metadata and leaves no fabricated final outcome', async () => {
  const f = await fixture('race-authority'), input = await f.request({ name: 'Must not save' });
  const proxy = beforeCommit(() => db.prepare("UPDATE staff_accounts SET role='staff',auth_version=auth_version+1 WHERE id=?").bind(f.admin.id).run());
  await assert.rejects(f.store(f.admin, proxy).edit(input), rejectsAccess);
  const demoted = { ...f.admin, role: 'staff', authVersion: 2 };
  assert.equal((await f.store(demoted).lookup(input)).state, 'missing');
  assert.equal((await f.inventory().detail('BAT-ONE')).battery.name, 'Original battery');
});
test('concurrent exact retry and a lost post-commit response resolve one mutation and one audit event', async () => {
  for (const mode of ['concurrent', 'lost-response']) {
    const f = await fixture(mode), input = await f.request({ name: 'Saved once' });
    const proxy = beforeCommit(() => mode === 'concurrent' ? f.store().edit(input) : Promise.resolve(), mode === 'lost-response' ? { failure: new Error('Simulated response dropped after commit'), after: true } : {});
    const outcome = await f.store(f.admin, proxy).edit(input);
    assert.equal(outcome.state, 'confirmed'); assert.equal(outcome.receipt.replayed, true);
    assert.equal((await f.inventory().detail('BAT-ONE')).battery.version, input.before.version + 1);
    assert.equal((await rows('audit_events', f.scope)).filter(event => event.action === 'battery_updated').length, 1);
  }
});
test('unknown database failures remain unresolved and an explicit original retry can later succeed', async () => {
  const f = await fixture('unknown'), input = await f.request({ name: 'Saved after retry' });
  const proxy = beforeCommit(async () => {}, { failure: new Error('Simulated unavailable database') });
  await assert.rejects(f.store(f.admin, proxy).edit(input), /Simulated unavailable database/);
  assert.equal((await f.store().lookup(input)).state, 'missing');
  assert.equal((await rows('operations', f.scope)).filter(operation => operation.kind.startsWith('metadata_edit')).length, 0);
  assert.equal((await f.store().edit(input)).state, 'confirmed');
});
test('a terminal rejection that wins a race prevents the delayed prepared write from committing', async () => {
  const f = await fixture('delayed-write'), input = await f.request({ name: 'Must not save' });
  const proxy = beforeCommit(async () => {
    await db.prepare('UPDATE buildings SET version=version+1 WHERE scope=? AND id=?').bind(f.scope, 'J18').run();
    assert.equal((await f.store().edit(input)).state, 'rejected');
  });
  await assertFinal(f, input, await f.store(f.admin, proxy).edit(input));
  assert.equal((await f.inventory().detail('BAT-ONE')).battery.name, 'Original battery');
});
test('successful and rejected request reservations resist update, deletion, replacement and upsert', async () => {
  for (const rejected of [false, true]) {
    const f = await fixture(`immutable-${rejected}`), input = await f.request({ name: 'Saved name' });
    if (rejected) input.before.name = 'Wrong reviewed name';
    await f.store().edit(input);
    const key = `${f.scope}/${input.requestId}`;
    await assert.rejects(db.prepare("UPDATE operations SET result_json='{}' WHERE id=?").bind(key).run(), /immutable/);
    await assert.rejects(db.prepare('DELETE FROM operations WHERE id=?').bind(key).run(), /cannot be deleted/);
    const operation = (await rows('operations', f.scope)).find(operation => operation.id === key);
    const values = [operation.id, operation.scope, operation.kind, operation.fingerprint, operation.result_json, operation.created_at];
    await assert.rejects(db.prepare('INSERT OR REPLACE INTO operations(id,scope,kind,fingerprint,result_json,created_at,guard) VALUES(?,?,?,?,?,?,1)').bind(...values).run(), /cannot be replaced/);
    await assert.rejects(db.prepare('INSERT INTO operations(id,scope,kind,fingerprint,result_json,created_at,guard) VALUES(?,?,?,?,?,?,1) ON CONFLICT(id) DO UPDATE SET result_json=excluded.result_json').bind(...values).run(), /cannot be replaced/);
    assert.notEqual((await f.store().lookup(input)).state, 'missing');
  }
});
test('authorized purge redacts saved edit metadata while preserving hash-only recovery and no delayed recreation', async () => {
  const f = await fixture('purge'), input = await f.request({ name: 'Private updated name', tagId: 'PRIVATE-UPDATED-TAG' });
  await f.store().edit(input);
  const binding = async () => { const battery = (await f.inventory().detail('BAT-ONE')).battery; return { batteryId: battery.id, version: battery.version, tagId: battery.tagId }; };
  await f.inventory().lifecycle({ requestId: crypto.randomUUID(), kind: 'scrapped', source: 'manual_selection', reason: '', destination: null, items: [await binding()] });
  await f.inventory().retiredAsset({ requestId: crypto.randomUUID(), kind: 'purge', items: [await binding()] });
  const outcome = await f.store().lookup(input);
  assert.equal(outcome.state, 'purged'); assert.deepEqual(await verifyOperatorEditOutcome(outcome, input, f.admin.id, f.dataset), outcome);
  assert.deepEqual(await f.store().edit(input), outcome);
  const operation = (await rows('operations', f.scope)).find(operation => operation.id === `${f.scope}/${input.requestId}`);
  assert.deepEqual(JSON.parse(operation.result_json), { purgedBatteryIds: ['BAT-ONE'] });
  assert.match(operation.fingerprint, /^sha256:[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(await rows('operations', f.scope)).includes('Private updated name'), false);
  assert.equal((await rows('batteries', f.scope)).length, 0);
  await assert.rejects(f.store(f.otherAdmin).lookup(input), conflict);
});
