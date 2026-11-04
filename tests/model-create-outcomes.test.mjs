import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Miniflare } from 'miniflare';
import { BatteryModelStore } from '../work/qa/battery-model-store.mjs';
import { verifyModelCreateReceipt, verifyModelCreateOutcome } from '../work/qa/model-create.mjs';

const mf = new Miniflare({ modules: true, script: "export default {fetch(){return new Response('model-outcome-test')}}", compatibilityDate: '2026-05-15', d1Databases: { DB: 'model-outcome-test' }, d1Persist: false });
const db = await mf.getD1Database('DB');
for (const entry of JSON.parse(await readFile('drizzle/meta/_journal.json', 'utf8')).entries)
  await db.batch((await readFile(`drizzle/${entry.tag}.sql`, 'utf8')).split('--> statement-breakpoint').filter(sql => sql.trim()).map(sql => db.prepare(sql)));
after(() => mf.dispose());
const at = '2026-10-12T02:00:00.000Z';
const admin = { id: crypto.randomUUID(), displayName: 'Template Administrator', role: 'admin', authVersion: 1 };
const staff = { id: crypto.randomUUID(), displayName: 'Template Staff', role: 'staff', authVersion: 1 };
const other = { id: crypto.randomUUID(), displayName: 'Template Other Staff', role: 'staff', authVersion: 1 };
for (const [index, actor] of [admin, staff, other].entries())
  await db.prepare('INSERT INTO staff_accounts(id,username,display_name,role,password_hash,password_salt,hash_iterations,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').bind(actor.id, `model-outcome-${index}`, actor.displayName, actor.role, 'test-only-no-login', 'test-only-no-login', 600000, at, at).run();
const draft = extra => ({ id: crypto.randomUUID(), brand: 'Example Brand', model: 'Example model', variant: 'Known variant', name: 'Labelled rechargeable pack', chemistry: 'LiPo', capacityMah: 2200, voltage: 7.4, notes: 'Synthetic reviewed physical-label specifications.', ...extra });
const rows = async (table, scope) => (await db.prepare(`SELECT * FROM ${table} WHERE scope=? ORDER BY rowid`).bind(scope).all()).results;
const fixture = name => { const scope = `model-outcome-${name}:demo`; return { scope, store: (actor = staff, database = db) => new BatteryModelStore(database, scope, 'demo', actor, () => new Date(at)) }; };
function batchProxy(intervene) {
  const statements = new WeakMap();
  return { prepare: sql => ({ bind: (...values) => { const statement = db.prepare(sql).bind(...values); statements.set(statement, sql); return statement; } }), batch: async batch => { const kind = batch.map(statement => statements.get(statement)).find(sql => sql?.startsWith('INSERT INTO operations(')); await intervene(kind, batch); return db.batch(batch); } };
}

test('query-only template outcome remains missing until explicit staff creation and verifies the exact saved model receipt', async () => {
  const f = fixture('verified'), input = draft({ capacityMah: null, voltage: null });
  assert.equal((await f.store().createOutcome(input)).state, 'missing'); assert.equal((await rows('operations', f.scope)).length, 0);
  const result = await f.store().createReviewed(input); assert.equal(result.state, 'confirmed');
  assert.deepEqual(await verifyModelCreateReceipt(result.receipt, input, staff.id, 'demo'), result.receipt);
  const tampered = [
    { ...result.receipt, actorAccountId: other.id }, { ...result.receipt, dataset: 'live' },
    { ...result.receipt, model: { ...result.receipt.model, name: 'Different saved model' } },
    { ...result.receipt, model: { ...result.receipt.model, capacityMah: 1200 } },
    { ...result.receipt, model: { ...result.receipt.model, contentHash: '0'.repeat(64) } },
  ];
  for (const receipt of tampered) await assert.rejects(verifyModelCreateReceipt(receipt, input, staff.id, 'demo'));
  assert.deepEqual((await f.store().createOutcome(input)).receipt, { ...result.receipt, replayed: true });
  assert.deepEqual((await f.store().createReviewed(input)).receipt, { ...result.receipt, replayed: true });
  assert.equal((await f.store(other).list()).models.length, 1);
  assert.equal((await rows('batteries', f.scope)).length, 0); assert.equal((await rows('audit_events', f.scope)).length, 1);
});

test('duplicate model identity has a reserved final outcome while request reuse and another actor remain conflicts', async () => {
  const f = fixture('duplicate'), first = draft(); await f.store().createReviewed(first);
  const duplicate = { ...first, id: crypto.randomUUID() }, result = await f.store().createReviewed(duplicate);
  assert.equal(result.state, 'rejected'); assert.equal(result.code, 'model_rejected_final'); assert.equal(result.status, 409);
  assert.deepEqual(await f.store().createOutcome(duplicate), result); assert.deepEqual(await f.store().createReviewed(duplicate), result);
  await assert.rejects(f.store().createReviewed({ ...duplicate, variant: 'Changed payload' }), error => error.code === 'idempotency_conflict');
  await assert.rejects(f.store(other).createOutcome(duplicate), error => error.code === 'idempotency_conflict');
  await assert.rejects(verifyModelCreateOutcome({ ...result, fingerprint: 'sha256:' + '0'.repeat(64) }, duplicate, staff.id, 'demo'));
  assert.equal((await rows('battery_models', f.scope)).length, 1); assert.equal((await rows('audit_events', f.scope)).length, 1); assert.equal((await rows('operations', f.scope)).length, 2);
});

test('a reserved template rejection wins over a delayed otherwise-valid create and prevents a ghost template', async () => {
  const f = fixture('rejection-wins'), input = draft(); let release, reached;
  const gate = new Promise(resolve => { release = resolve; }), prepared = new Promise(resolve => { reached = resolve; });
  let held = false;
  const delayed = batchProxy(async sql => { if (!held && sql?.includes("'battery_model_registered'")) { held = true; reached(); await gate; } });
  const pending = f.store(staff, delayed).createReviewed(input); await prepared;
  let failedOnce = false;
  const rejecting = batchProxy(async sql => { if (!failedOnce && sql?.includes("'battery_model_registered'")) { failedOnce = true; throw new Error('CONSTRAINT: synthetic rejection before an atomic create'); } });
  let rejection;
  try { rejection = await f.store(staff, rejecting).createReviewed(input); assert.equal(rejection.state, 'rejected'); }
  finally { release(); }
  assert.deepEqual(await pending, rejection); assert.deepEqual(await f.store().createReviewed(input), rejection);
  assert.equal((await rows('battery_models', f.scope)).length, 0); assert.equal((await rows('audit_events', f.scope)).length, 0);
});

test('a concurrent confirmed create wins over an attempted terminal rejection and remains exactly once', async () => {
  const f = fixture('success-wins'), input = draft(); let rejectedOnce = false, winner;
  const proxy = batchProxy(async sql => {
    if (!rejectedOnce && sql?.includes("'battery_model_registered'")) { rejectedOnce = true; throw new Error('CONSTRAINT: synthetic initial model write rejection'); }
    if (sql?.includes("'battery_model_registered_rejected'")) winner = await f.store().createReviewed(input);
  });
  const result = await f.store(staff, proxy).createReviewed(input);
  assert.equal(winner.state, 'confirmed'); assert.equal(result.state, 'confirmed'); assert.deepEqual(result.receipt, { ...winner.receipt, replayed: true });
  assert.equal((await rows('battery_models', f.scope)).length, 1); assert.equal((await rows('audit_events', f.scope)).length, 1);
});

test('unreserved database or authentication failure stays uncertain until exact query or explicit retry', async () => {
  const f = fixture('uncertain'), input = draft();
  const broken = batchProxy(async () => { throw new Error('Synthetic database transport interruption'); });
  await assert.rejects(f.store(staff, broken).createReviewed(input), /Synthetic database transport interruption/);
  assert.equal((await f.store().createOutcome(input)).state, 'missing'); assert.equal((await rows('operations', f.scope)).length, 0);
  await assert.rejects(f.store({ ...staff, authVersion: 2 }).createReviewed(input), error => error.status === 403);
  assert.equal((await rows('operations', f.scope)).length, 0);
  assert.equal((await f.store().createReviewed(input)).state, 'confirmed');
});

test('legacy model creation and later administrator updates retain the immutable original reviewed receipt', async () => {
  const f = fixture('legacy'), input = draft(), legacy = await f.store().create(input);
  assert.deepEqual((await f.store().createOutcome(input)).receipt, { ...legacy, replayed: true });
  const updated = await f.store(admin).update({ ...input, name: 'Later template name', expectedVersion: 1, requestId: crypto.randomUUID() }); assert.equal(updated.model.version, 2);
  assert.equal((await f.store().createReviewed(input)).receipt.model.name, input.name); assert.equal((await f.store().createOutcome(input)).receipt.model.version, 1);
  const operation = (await rows('operations', f.scope)).find(row => row.kind === 'battery_model_registered');
  for (const statement of [
    db.prepare('INSERT OR REPLACE INTO operations(id,scope,kind,fingerprint,result_json,created_at,guard) VALUES(?,?,?,?,?,?,1)').bind(operation.id, operation.scope, 'other', 'other', '{}', at),
    db.prepare('UPDATE operations SET result_json=? WHERE id=?').bind('{}', operation.id),
    db.prepare('DELETE FROM operations WHERE id=?').bind(operation.id),
  ]) await assert.rejects(statement.run());
  assert.equal((await f.store().createOutcome(input)).state, 'confirmed');
});
