import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Miniflare } from 'miniflare';
import { InventoryStore } from '../work/qa/store.mjs';
import { OperatorImportStore } from '../work/qa/server/inventory/operator-import.mjs';
import { operatorImportPayloadSchema, verifyOperatorImportOutcome, verifyOperatorImportReceipt } from '../work/qa/operator-import.mjs';

const mf = new Miniflare({ modules: true, script: "export default {fetch(){return new Response('reviewed-csv-test')}}", compatibilityDate: '2026-05-15', d1Databases: { DB: 'reviewed-csv-test' }, d1Persist: false });
const db = await mf.getD1Database('DB');
for (const entry of JSON.parse(await readFile('drizzle/meta/_journal.json', 'utf8')).entries)
  await db.batch((await readFile(`drizzle/${entry.tag}.sql`, 'utf8')).split('--> statement-breakpoint').filter(sql => sql.trim()).map(sql => db.prepare(sql)));
after(() => mf.dispose());
const at = '2026-10-12T02:00:00.000Z';
const admin = { id: crypto.randomUUID(), displayName: 'CSV Administrator', role: 'admin', authVersion: 1 };
const staff = { id: crypto.randomUUID(), displayName: 'CSV Staff', role: 'staff', authVersion: 1 };
const other = { id: crypto.randomUUID(), displayName: 'CSV Other Staff', role: 'staff', authVersion: 1 };
for (const [index, actor] of [admin, staff, other].entries())
  await db.prepare('INSERT INTO staff_accounts(id,username,display_name,role,password_hash,password_salt,hash_iterations,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').bind(actor.id, `csv-test-${index}`, actor.displayName, actor.role, 'test-only-no-login', 'test-only-no-login', 600000, at, at).run();
const actorForInventory = actor => ({ ...actor, name: actor.displayName });
const rows = async (table, scope) => (await db.prepare(`SELECT * FROM ${table} WHERE scope=? ORDER BY rowid`).bind(scope).all()).results;
const domainCode = code => error => error.code === code;
async function fixture(name, dataset = 'live') {
  const scope = `reviewed-csv-${name}:${dataset}`;
  const inventory = (actor = admin, database = db, clock = () => new Date(at)) => new InventoryStore(database, scope, dataset, actorForInventory(actor), clock);
  const snapshot = await inventory().snapshot(), owner = snapshot.people.find(person => person.accountId === other.id), building = snapshot.buildings.find(building => building.id === 'J18'), room = snapshot.rooms.find(room => room.id === 'J18-DEMO-ROOM');
  const record = (id, extra = {}) => ({ id, name: 'Explicit CSV battery', model: '', chemistry: '', capacityMah: null, voltage: null, tagId: null, ownerId: owner.id, homeBuildingId: 'J18', homeRoomId: null, manufacturedOn: null, firstUsedOn: null, ...extra });
  const payload = (records = [record('CSV-ONE')], extra = {}) => ({ requestId: crypto.randomUUID(), source: 'reviewed-csv-import', records, directoryBindings: { owners: [{ ownerId: owner.id, accountId: other.id, version: owner.version }], buildingVersion: building.version, rooms: records.some(record => record.homeRoomId) ? [{ roomId: room.id, version: room.version }] : [] }, ...extra });
  return { scope, dataset, owner, building, room, record, payload, inventory, importer: (actor = staff, database = db, clock = () => new Date(at)) => new OperatorImportStore(database, scope, dataset, actor, clock) };
}
function beforeBatch(kind, intervene, mode = 'before') {
  const statements = new WeakMap(); let intercepted = false;
  return {
    prepare: sql => ({ bind: (...values) => { const statement = db.prepare(sql).bind(...values); statements.set(statement, { sql, values }); return statement; } }),
    batch: async batch => {
      const matches = !intercepted && batch.some(statement => { const item = statements.get(statement); return item?.sql.startsWith('INSERT INTO operations(') && item.values[2] === kind; });
      if (matches) { intercepted = true; if (mode === 'before') await intervene(); }
      const result = await db.batch(batch);
      if (matches && mode === 'after') await intervene();
      return result;
    },
  };
}
async function assertRejected(context, payload, expectedStatus = 409, importer = context.importer()) {
  const result = await importer.import(payload);
  assert.equal(result.state, 'rejected'); assert.equal(result.code, 'csv_import_rejected_final'); assert.equal(result.status, expectedStatus);
  assert.deepEqual(await context.importer().lookup(payload), result);
  assert.deepEqual(await context.importer().import(payload), result);
  return result;
}

test('reviewed staff CSV import preserves explicit IDs, nullable fields, dates, actor and complete attributed history', async () => {
  for (const dataset of ['live', 'demo']) {
    const f = await fixture(`preserved-${dataset}`, dataset);
    const payload = f.payload([f.record('CSV-EXPLICIT-ID', { homeRoomId: f.room.id, tagId: 'CSV-KNOWN-TAG', model: 'Labelled-model', chemistry: 'LiPo', capacityMah: 2200, voltage: 7.4, manufacturedOn: '2026-01-01', firstUsedOn: '2026-02-02' }), f.record('CSV-UNKNOWN-SPECS')]);
    assert.equal((await f.importer().lookup(payload)).state, 'missing'); assert.equal((await rows('operations', f.scope)).length, 0);
    const result = await f.importer().import(payload); assert.equal(result.state, 'confirmed');
    assert.deepEqual(verifyOperatorImportReceipt(result.receipt, payload, staff.id, dataset), result.receipt);
    const saved = await rows('batteries', f.scope); assert.equal(saved.length, 2);
    assert.equal(saved.find(row => row.id === 'CSV-UNKNOWN-SPECS').first_used_on, null);
    assert.equal(saved.find(row => row.id === 'CSV-UNKNOWN-SPECS').capacity_mah, null);
    assert.equal((await rows('inventory_arrivals', f.scope)).length, 2);
    assert.equal((await rows('loans', f.scope)).length, 0); assert.equal((await rows('observations', f.scope)).length, 0);
    const events = await rows('audit_events', f.scope); assert.equal(events.length, 3); assert.ok(events.every(event => event.actor_id === staff.id));
    const detail = await f.inventory().detail('CSV-EXPLICIT-ID');
    assert.ok(detail.events.some(event => event.action === 'records_imported' && event.details.requestId === payload.requestId));
    assert.equal(detail.events.find(event => event.action === 'battery_registered').details.source, 'reviewed-csv-import');
    assert.deepEqual((await f.importer().lookup(payload)).receipt, { ...result.receipt, replayed: true });
    assert.deepEqual((await f.importer().import(payload)).receipt, { ...result.receipt, replayed: true });
    assert.equal((await rows('audit_events', f.scope)).length, 3);
  }
});

test('whole-batch receipts reject changed rows, bindings, account or inventory and original IDs cannot be repurposed', async () => {
  const f = await fixture('receipt'), payload = f.payload([f.record('CSV-ONE'), f.record('CSV-TWO')]);
  const result = await f.importer().import(payload);
  for (const receipt of [
    { ...result.receipt, records: result.receipt.records.slice(0, 1) },
    { ...result.receipt, batteryIds: [...result.receipt.batteryIds].reverse() },
    { ...result.receipt, records: result.receipt.records.map((record, i) => i ? record : { ...record, voltage: 12 }) },
    { ...result.receipt, directoryBindings: { ...result.receipt.directoryBindings, buildingVersion: 99 } },
    { ...result.receipt, actorAccountId: other.id }, { ...result.receipt, dataset: 'demo' },
  ]) assert.throws(() => verifyOperatorImportReceipt(receipt, payload, staff.id, f.dataset));
  await assert.rejects(f.importer(other).lookup(payload), domainCode('idempotency_conflict'));
  await assert.rejects(f.importer().import({ ...payload, records: [...payload.records].reverse() }), domainCode('idempotency_conflict'));
  await assert.rejects(verifyOperatorImportOutcome({ state: 'missing', requestId: payload.requestId, actorAccountId: other.id, dataset: f.dataset }, payload, staff.id, f.dataset));
  assert.equal((await rows('batteries', f.scope)).length, 2);
});

test('duplicate CSV IDs or tags and mismatched directory bindings reserve a terminal rejection without partial rows', async () => {
  for (const [name, make] of [
    ['ids', f => f.payload([f.record('CSV-SAME'), f.record('CSV-SAME')])],
    ['tags', f => f.payload([f.record('CSV-ONE', { tagId: 'SAME-TAG' }), f.record('CSV-TWO', { tagId: 'SAME-TAG' })])],
    ['extra-owner', f => { const payload = f.payload(); payload.directoryBindings.owners.push({ ownerId: `staff-${staff.id}`, accountId: staff.id, version: 1 }); return payload; }],
    ['duplicate-owner', f => { const payload = f.payload(); payload.directoryBindings.owners.push(payload.directoryBindings.owners[0]); return payload; }],
    ['missing-room', f => { const payload = f.payload([f.record('CSV-ONE', { homeRoomId: f.room.id })]); payload.directoryBindings.rooms = []; return payload; }],
  ]) {
    const f = await fixture(name); await assertRejected(f, make(f), 400);
    assert.equal((await rows('batteries', f.scope)).length, 0); assert.equal((await rows('audit_events', f.scope)).length, 0); assert.equal((await rows('inventory_arrivals', f.scope)).length, 0);
    assert.equal((await rows('operations', f.scope)).length, 1);
  }
});

test('stale reviewed owner, building and room versions reject even when current records remain selectable', async () => {
  for (const target of ['owner', 'building', 'room']) {
    const f = await fixture(`stale-${target}`), payload = f.payload([f.record('CSV-ONE', { homeRoomId: f.room.id })]);
    if (target === 'owner') await db.prepare('UPDATE people SET version=version+1 WHERE scope=? AND id=?').bind(f.scope, f.owner.id).run();
    if (target === 'building') await db.prepare('UPDATE buildings SET version=version+1 WHERE scope=? AND id=?').bind(f.scope, 'J18').run();
    if (target === 'room') await db.prepare('UPDATE rooms SET version=version+1 WHERE scope=? AND id=?').bind(f.scope, f.room.id).run();
    await assertRejected(f, payload); assert.equal((await rows('batteries', f.scope)).length, 0);
  }
});

test('atomic guards reject concurrent tag insertion and room withdrawal without importing any other row', async () => {
  for (const target of ['tag', 'room']) {
    const f = await fixture(`atomic-${target}`), payload = f.payload([f.record('CSV-ONE', { tagId: 'RACE-TAG', homeRoomId: f.room.id }), f.record('CSV-TWO')]);
    const proxy = beforeBatch('csv_import', async () => {
      if (target === 'tag') await f.inventory().saveBattery(f.record('CONCURRENT-ASSET', { tagId: 'RACE-TAG' }));
      else await db.prepare('UPDATE rooms SET selectable=0,version=version+1 WHERE scope=? AND id=?').bind(f.scope, f.room.id).run();
    });
    await assertRejected(f, payload, 409, f.importer(staff, proxy));
    assert.deepEqual((await rows('batteries', f.scope)).map(row => row.id), target === 'tag' ? ['CONCURRENT-ASSET'] : []);
    assert.equal((await rows('audit_events', f.scope)).filter(event => JSON.parse(event.details_json).importRequestId === payload.requestId).length, 0);
  }
});

test('an immutable rejection wins over a delayed otherwise-valid batch and cannot become a later ghost import', async () => {
  const f = await fixture('rejection-wins'), payload = f.payload([f.record('CSV-ONE', { manufacturedOn: '2026-10-11' }), f.record('CSV-TWO')]);
  let reserved;
  const proxy = beforeBatch('csv_import', async () => { reserved = await f.importer(staff, db, () => new Date('2026-10-10T00:00:00.000Z')).import(payload); assert.equal(reserved.state, 'rejected'); });
  assert.deepEqual(await f.importer(staff, proxy).import(payload), reserved);
  assert.deepEqual(await f.importer().import(payload), reserved);
  assert.equal((await rows('batteries', f.scope)).length, 0); assert.equal((await rows('inventory_arrivals', f.scope)).length, 0);
});

test('a concurrent success wins over an attempted rejection reservation and is reported as confirmed', async () => {
  const f = await fixture('success-wins'), payload = f.payload([f.record('CSV-ONE', { manufacturedOn: '2026-10-11' })]);
  let winner;
  const proxy = beforeBatch('csv_import_rejected', async () => { winner = await f.importer().import(payload); assert.equal(winner.state, 'confirmed'); });
  const result = await f.importer(staff, proxy, () => new Date('2026-10-10T00:00:00.000Z')).import(payload);
  assert.equal(result.state, 'confirmed'); assert.deepEqual(result.receipt, { ...winner.receipt, replayed: true });
  assert.equal((await rows('batteries', f.scope)).length, 1); assert.equal((await rows('audit_events', f.scope)).length, 2);
});

test('database failure before commit stays missing and a lost response after commit resolves without a second import', async () => {
  const f = await fixture('database'), payload = f.payload();
  const before = { prepare: sql => db.prepare(sql), batch: async () => { throw new Error('Synthetic connection interruption before batch'); } };
  await assert.rejects(f.importer(staff, before).import(payload), /Synthetic connection interruption/);
  assert.equal((await f.importer().lookup(payload)).state, 'missing'); assert.equal((await rows('operations', f.scope)).length, 0);
  const after = beforeBatch('csv_import', async () => { throw new Error('Synthetic response interruption after batch'); }, 'after');
  const result = await f.importer(staff, after).import(payload);
  assert.equal(result.state, 'confirmed'); assert.equal(result.receipt.replayed, true);
  assert.equal((await rows('batteries', f.scope)).length, 1); assert.equal((await rows('audit_events', f.scope)).length, 2);
});

test('authentication change at commit cannot mark failure final and reauthentication can query the exact missing request', async () => {
  const f = await fixture('authority'), payload = f.payload();
  const proxy = beforeBatch('csv_import', () => db.prepare('UPDATE staff_accounts SET auth_version=auth_version+1 WHERE id=?').bind(staff.id).run());
  try {
    await assert.rejects(f.importer(staff, proxy).import(payload), error => error.status === 403);
    const reauthenticated = { ...staff, authVersion: 2 };
    assert.equal((await f.importer(reauthenticated).lookup(payload)).state, 'missing');
    assert.equal((await rows('operations', f.scope)).length, 0); assert.equal((await rows('batteries', f.scope)).length, 0);
    assert.equal((await f.importer(reauthenticated).import(payload)).state, 'confirmed');
  } finally { await db.prepare('UPDATE staff_accounts SET auth_version=1 WHERE id=?').bind(staff.id).run(); }
});

test('permanent deletion clears retained import asset snapshots and reserves both original outcome and deleted IDs/tags', async () => {
  const f = await fixture('purge'), payload = f.payload([f.record('CSV-PRIVATE', { name: 'Private imported asset', model: 'Private model', tagId: 'PRIVATE-CSV-TAG' }), f.record('CSV-SURVIVOR')]);
  await f.importer().import(payload);
  const binding = async () => { const battery = (await f.inventory().detail('CSV-PRIVATE')).battery; return { batteryId: battery.id, version: battery.version, tagId: battery.tagId }; };
  await f.inventory(staff).lifecycle({ requestId: crypto.randomUUID(), kind: 'scrapped', reason: 'Synthetic CSV purge qualification', destination: null, source: 'manual_selection', items: [await binding()] });
  await f.inventory().retiredAsset({ requestId: crypto.randomUUID(), kind: 'purge', items: [await binding()] });
  const outcome = await f.importer().lookup(payload); assert.equal(outcome.state, 'purged'); assert.deepEqual(outcome.purgedBatteryIds, ['CSV-PRIVATE']);
  assert.deepEqual(await f.importer().import(payload), outcome);
  const original = await db.prepare('SELECT result_json FROM operations WHERE scope=? AND id=?').bind(f.scope, `${f.scope}/${payload.requestId}`).first('result_json');
  assert.ok(!original.includes('Private imported asset')); assert.ok(!original.includes('Private model')); assert.ok(!original.includes('PRIVATE-CSV-TAG'));
  await assertRejected(f, f.payload([f.record('CSV-PRIVATE')]));
  await assertRejected(f, f.payload([f.record('CSV-NEW', { tagId: 'PRIVATE-CSV-TAG' })]));
  assert.deepEqual((await rows('batteries', f.scope)).map(row => row.id), ['CSV-SURVIVOR']);
});

test('request immutability survives SQL replacement, upsert, update and deletion attempts', async () => {
  const f = await fixture('immutable'), payload = f.payload(); await f.importer().import(payload);
  const operation = (await rows('operations', f.scope))[0];
  for (const statement of [
    db.prepare('INSERT OR REPLACE INTO operations(id,scope,kind,fingerprint,result_json,created_at,guard) VALUES(?,?,?,?,?,?,1)').bind(operation.id, operation.scope, 'other', 'other', '{}', at),
    db.prepare('INSERT INTO operations(id,scope,kind,fingerprint,result_json,created_at,guard) VALUES(?,?,?,?,?,?,1) ON CONFLICT(id) DO UPDATE SET result_json=excluded.result_json').bind(operation.id, operation.scope, operation.kind, operation.fingerprint, '{}', at),
    db.prepare('UPDATE operations SET result_json=? WHERE id=?').bind('{}', operation.id),
    db.prepare('DELETE FROM operations WHERE id=?').bind(operation.id),
  ]) await assert.rejects(statement.run());
  assert.equal((await f.importer().lookup(payload)).state, 'confirmed'); assert.equal((await rows('batteries', f.scope)).length, 1);
});

test('CSV payload refuses inferred fields and invalid dates while a 200-row exact batch remains complete', async () => {
  const f = await fixture('limits');
  assert.throws(() => operatorImportPayloadSchema.parse(f.payload([f.record('CSV-ONE', { modelSelection: { confirmed: true } })])));
  assert.throws(() => operatorImportPayloadSchema.parse(f.payload([f.record('CSV-ONE', { manufacturedOn: '2026-02-30' })])));
  assert.throws(() => operatorImportPayloadSchema.parse(f.payload(Array.from({ length: 201 }, (_, i) => f.record(`CSV-${i}`)))));
  const payload = f.payload(Array.from({ length: 200 }, (_, i) => f.record(`CSV-${String(i + 1).padStart(3, '0')}`)));
  const result = await f.importer().import(payload); assert.equal(result.state, 'confirmed'); assert.equal(result.receipt.count, 200); assert.equal(result.receipt.records.length, 200);
  assert.equal((await rows('batteries', f.scope)).length, 200); assert.equal((await rows('inventory_arrivals', f.scope)).length, 200); assert.equal((await rows('audit_events', f.scope)).length, 201);
});
