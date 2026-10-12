import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Miniflare } from 'miniflare';

const qa = process.env.NATIVE_LIFECYCLE_QA_ROOT ? pathToFileURL(path.resolve(process.env.NATIVE_LIFECYCLE_QA_ROOT) + path.sep) : new URL('../work/qa/', import.meta.url);
const { IntakeStore } = await import(new URL('intake-store.mjs', qa));
const { InventoryStore } = await import(new URL('store.mjs', qa));
const { TeachingGroupStore } = await import(new URL('teaching-group-store.mjs', qa));
const { verifyIntakeReceipt } = await import(new URL('intake-session.mjs', qa));
const { verifyLifecycleReceipt } = await import(new URL('lifecycle-session.mjs', qa));
const { createExport } = await import(new URL('exports.mjs', qa));
const { canonicalModelJson } = await import(new URL('battery-models.mjs', qa));

const mf = new Miniflare({ modules: true, script: "export default { fetch() { return new Response('native-lifecycle-controlled-test'); } }", compatibilityDate: '2026-05-15', d1Databases: { DB: 'native-lifecycle-controlled-test' }, d1Persist: false });
const db = await mf.getD1Database('DB');
const journal = JSON.parse(await readFile('drizzle/meta/_journal.json', 'utf8'));
for (const entry of journal.entries) { const sql = await readFile(`drizzle/${entry.tag}.sql`, 'utf8'); await db.batch(sql.split('--> statement-breakpoint').filter(value => value.trim()).map(value => db.prepare(value))); }
after(() => mf.dispose());
const at = '2026-10-12T03:00:00.000Z';
const actor = { id: crypto.randomUUID(), displayName: 'Controlled staff reader', role: 'staff', authVersion: 1 };
const owner = { id: crypto.randomUUID(), displayName: 'Controlled responsible owner', role: 'staff', authVersion: 1 };
const admin = { id: crypto.randomUUID(), displayName: 'Controlled administrator', role: 'admin', authVersion: 1 };
for (const [index, user] of [actor, owner, admin].entries()) await db.prepare('INSERT INTO staff_accounts(id,username,display_name,role,password_hash,password_salt,hash_iterations,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').bind(user.id, `native-controlled-${index}`, user.displayName, user.role, 'test-only-no-login', 'test-only-no-login', 600000, at, at).run();
const rows = async (table, scope) => (await db.prepare(`SELECT * FROM ${table} WHERE scope=? ORDER BY rowid`).bind(scope).all()).results;
const asInventoryActor = user => ({ id: user.id, name: user.displayName, role: user.role, authVersion: user.authVersion });
async function fixture(name, dataset = 'demo') {
  const scope = `native-lifecycle-${name}:${dataset}`;
  const store = (user = actor, database = db) => new InventoryStore(database, scope, dataset, asInventoryActor(user), () => new Date(at));
  await store().snapshot();
  return { scope, dataset, store, intake: (user = actor) => new IntakeStore(db, scope, dataset, user, () => new Date(at)), common: { name: 'Controlled native incoming pack', model: 'Recorded model', chemistry: 'Recorded chemistry', capacityMah: 2200, voltage: 7.4, ownerId: `staff-${owner.id}`, homeBuildingId: 'J18', homeRoomId: null, manufacturedOn: null, firstUsedOn: null } };
}
function evidence(uidHex = '0004AB00') { return { attemptId: crypto.randomUUID(), source: 'native-nfc-reader', platform: 'android', startedAt: '2026-10-12T02:59:56.000Z', endedAt: '2026-10-12T02:59:57.000Z', adoptedAt: '2026-10-12T02:59:58.000Z', tagId: `nfc:uid:${uidHex}`, result: { uidHex, technology: 'Controlled NFC-A output', ndefStatus: 'readWrite', capacityBytes: 144, records: [{ tnf: 1, typeHex: '5400', idHex: '0000', payloadHex: '00ffAa01' }], observedAt: '2026-10-12T02:59:57.000Z' } }; }
const input = (context, proof = evidence(), additions = {}) => ({ requestId: crypto.randomUUID(), sessionId: crypto.randomUUID(), source: 'native_nfc', nfcEvidence: proof, tagId: proof.tagId, scannedAt: proof.result.observedAt, common: { ...context.common }, firstUseMode: 'at_registration', ...additions });
async function registered(context, uid = '0004AB00') { const payload = input(context, evidence(uid)); return { payload, receipt: await context.intake().register(payload) }; }
function removal(receipt, proof, additions = {}) { return { requestId: crypto.randomUUID(), source: 'native_nfc', kind: 'scrapped', reason: '', destination: null, items: [{ batteryId: receipt.batteryId, version: 1, tagId: receipt.tagId, nfcEvidence: proof }], ...additions }; }

test('real D1 native intake retains raw source, independent device time, authoritative IDs/date and exact replay', async () => {
  const context = await fixture('intake');
  const { payload, receipt } = await registered(context);
  assert.equal(receipt.source, 'native_nfc'); assert.equal(receipt.tagId, 'nfc:uid:0004AB00'); assert.equal(receipt.registeredAt, at); assert.equal(receipt.firstUsedOn, '2026-10-12');
  assert.deepEqual(verifyIntakeReceipt(receipt, { actorAccountId: actor.id, dataset: 'demo', payload }), receipt);
  assert.deepEqual(receipt.nfcEvidence, payload.nfcEvidence);
  const replay = await context.intake().register(payload); assert.equal(replay.replayed, true); assert.equal(replay.batteryId, receipt.batteryId);
  assert.equal((await rows('batteries', context.scope)).length, 1); assert.equal((await rows('loans', context.scope)).length, 0); assert.equal((await rows('observations', context.scope)).length, 0);
  const event = (await rows('audit_events', context.scope)).find(value => value.action === 'battery_registered');
  const detail = JSON.parse(event.details_json); assert.equal(event.actor_id, actor.id); assert.deepEqual(detail.nfcEvidence, payload.nfcEvidence); assert.equal(detail.scanTimeSource, 'native_nfc_device');
  assert.equal((await rows('operations', context.scope))[0].fingerprint, canonicalModelJson({ actorAccountId: actor.id, payload }));
  const changed = structuredClone(payload); changed.nfcEvidence.result.records[0].payloadHex = '00ffAa02';
  await assert.rejects(context.intake().register(changed), error => error.code === 'idempotency_conflict');
});

test('native intake keeps immutable common configuration and a single session source while old simulation remains valid', async () => {
  const context = await fixture('intake-session');
  const first = input(context); await context.intake().register(first);
  const second = input(context, evidence('0004AB01'), { sessionId: first.sessionId }); await context.intake().register(second);
  assert.equal((await rows('batteries', context.scope)).length, 2);
  const mixed = { requestId: crypto.randomUUID(), sessionId: first.sessionId, tagId: 'DEMO-INTAKE-MIXED', common: context.common, firstUseMode: 'at_registration' };
  await assert.rejects(context.intake().register(mixed), error => error.code === 'intake_rejected_final');
  const legacy = { ...mixed, requestId: crypto.randomUUID(), sessionId: crypto.randomUUID(), tagId: 'DEMO-INTAKE-LEGACY' };
  const legacyReceipt = await context.intake().register(legacy); assert.equal(legacyReceipt.source, 'simulated_intake'); assert.equal(Object.hasOwn(legacyReceipt, 'nfcEvidence'), false);
  const ledger = (await rows('operations', context.scope)).find(row => row.id.endsWith(legacy.requestId));
  assert.equal(ledger.fingerprint, canonicalModelJson({ actorAccountId: actor.id, payload: legacy }));
});

test('server rejects native live intake and removal without stock writes', async () => {
  const context = await fixture('live-gate', 'live');
  const payload = input(context); await assert.rejects(context.intake().register(payload), error => error.status === 501);
  const native = removal({ batteryId: 'BAT-NOT-CREATED', tagId: payload.tagId }, payload.nfcEvidence);
  await assert.rejects(context.store().lifecycle(native), error => error.status === 501);
  assert.equal((await rows('batteries', context.scope)).length, 0); assert.equal((await rows('operations', context.scope)).length, 0);
});

test('real D1 native removal stores complete per-item evidence, does not change metadata, and replays only the original bytes', async () => {
  const context = await fixture('removal'); const first = await registered(context);
  const before = (await rows('batteries', context.scope))[0], payload = removal(first.receipt, first.payload.nfcEvidence);
  const receipt = await context.store().lifecycle(payload);
  assert.deepEqual(verifyLifecycleReceipt(receipt, { actorAccountId: actor.id, dataset: 'demo', payload }), receipt); assert.equal(receipt.items[0].version, 2); assert.deepEqual(receipt.items[0].nfcEvidence, payload.items[0].nfcEvidence);
  const after = (await rows('batteries', context.scope))[0]; for (const field of ['id', 'name', 'model', 'chemistry', 'capacity_mah', 'voltage', 'owner_key', 'home_building_key', 'manufactured_on', 'first_used_on', 'created_at', 'tag_id']) assert.equal(after[field], before[field]);
  const event = (await rows('audit_events', context.scope)).find(row => row.action === 'battery_scrapped'); assert.deepEqual(JSON.parse(event.details_json).nfcEvidence, payload.items[0].nfcEvidence);
  assert.equal((await context.store().lifecycle(payload)).replayed, true);
  const changed = structuredClone(payload); changed.items[0].nfcEvidence.result.records[0].payloadHex = 'AA'; await assert.rejects(context.store().lifecycle(changed), error => error.code === 'idempotency_conflict');
  assert.equal((await rows('audit_events', context.scope)).filter(row => row.action === 'battery_scrapped').length, 1);
  const document = await createExport(context.store(), { dataset: 'demo', mode: 'detail', range: 'selected', batteryIds: [first.receipt.batteryId] }); assert.ok(JSON.stringify(document).includes('00ffAa01'));
});

test('active-loan rejection reserves native removal against delayed writes and prevents partial batches', async () => {
  const context = await fixture('loan'); const first = await registered(context), second = await registered(context, '0004AB01');
  await context.store().movement({ requestId: crypto.randomUUID(), kind: 'checkout', batteryIds: [first.receipt.batteryId] });
  const snapshot = await context.store().snapshot();
  const payload = removal(first.receipt, first.payload.nfcEvidence, { items: [first, second].map(value => { const battery = snapshot.batteries.find(item => item.id === value.receipt.batteryId); return { batteryId: battery.id, version: battery.version, tagId: battery.tagId, nfcEvidence: value.payload.nfcEvidence }; }) });
  await assert.rejects(context.store().lifecycle(payload), error => error.code === 'lifecycle_rejected_final');
  assert.equal((await rows('batteries', context.scope)).every(row => row.lifecycle_status === 'active'), true);
  const held = snapshot.batteries.find(item => item.id === first.receipt.batteryId); await context.store().movement({ requestId: crypto.randomUUID(), kind: 'return', batteryIds: [held.id], expectedLoans: [{ batteryId: held.id, loanId: held.loanId }] });
  await assert.rejects(context.store().lifecycle(payload), error => error.code === 'lifecycle_rejected_final');
  assert.equal((await rows('batteries', context.scope)).every(row => row.lifecycle_status === 'active'), true);
});

test('native retirement respects current private group version and membership, retaining group evidence', async () => {
  const context = await fixture('group'); const first = await registered(context), second = await registered(context, '0004AB01');
  const groups = new TeachingGroupStore(db, context.scope, 'demo', asInventoryActor(actor), () => new Date(at));
  const group = (await groups.save({ action: 'create', requestId: crypto.randomUUID(), id: crypto.randomUUID(), name: 'Controlled private group', notes: '', batteryIds: [first.receipt.batteryId] })).group;
  const outside = removal(second.receipt, second.payload.nfcEvidence, { teachingGroup: { id: group.id, version: group.version } }); await assert.rejects(context.store().lifecycle(outside), error => error.code === 'lifecycle_rejected_final');
  const success = removal(first.receipt, first.payload.nfcEvidence, { teachingGroup: { id: group.id, version: group.version } }); const receipt = await context.store().lifecycle(success);
  assert.deepEqual(receipt.teachingGroup.batteryIds, [first.receipt.batteryId]); assert.equal(receipt.teachingGroup.name, group.name);
});
