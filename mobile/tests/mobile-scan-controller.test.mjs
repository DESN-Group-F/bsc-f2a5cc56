import test from 'node:test';
import assert from 'node:assert/strict';
import { createDurableStorage } from '../src/platform/durable-storage.mjs';
import { createScanController, scanStorageKey, acquisitionOf } from '../src/features/scan/scan-controller.mjs';

const accountId = 'STAFF-A', at = '2026-10-12T03:00:00.000Z';
const uuid = number => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const battery = (id = 'BAT-1', overrides = {}) => ({ id, name: `Battery ${id}`, ownerName: 'Responsible owner', tagId: `tag:${id}`, version: 3, loanId: null, borrowerName: null, checkedOutAt: null, lifecycleStatus: 'active', ...overrides });
const receipt = payload => ({ requestId: payload.requestId, kind: payload.kind, batteryIds: payload.batteryIds, count: payload.batteryIds.length, at, ...(payload.scan ? { scan: structuredClone(payload.scan) } : {}), ...(payload.kind === 'checkout' ? { borrowerAccountId: accountId, borrower: 'Staff A' } : {}), ...(payload.teachingGroup ? { teachingGroup: { ...payload.teachingGroup, name: 'Teaching group', ownerAccountId: accountId, operationId: payload.requestId, batteryIds: payload.batteryIds } } : {}) });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
async function fixture({ batteries = [battery()], kind = 'checkout', dataset = 'demo', entries = {}, onSave = async () => {}, movement, lookup, teachingGroup, teachingGroups = [], scope } = {}) {
  let raw = JSON.stringify({ schemaVersion: 1, entries }), serial = 10;
  const storage = createDurableStorage({ load: async () => raw, save: async value => { await onSave(value); raw = value; } }); await storage.initialize();
  const inventory = { dataset, user: { id: accountId }, batteries, rooms: [], teachingGroups }, calls = [];
  const write = async (action, payload) => {
    calls.push({ action, payload: structuredClone(payload), saved: JSON.parse(raw) });
    return action === 'movement' ? movement ? movement(payload) : receipt(payload) : lookup ? lookup(payload) : { source: payload.source, results: payload.tagIds.map(tagId => ({ tagId, battery: batteries.find(item => item.tagId === tagId) || null })) };
  };
  const controller = createScanController({ storage, accountId, dataset, kind, inventory, teachingGroup, scope, write, loadInventory: async () => inventory, id: () => uuid(serial++), now: () => at });
  return { controller, storage, calls, inventory, saved: () => JSON.parse(raw), recreate: () => createScanController({ storage, accountId, dataset, kind, inventory, write, loadInventory: async () => inventory, id: () => uuid(serial++), now: () => at }) };
}

test('accepted acquisition waits for durable acknowledgement and never writes a movement', async () => {
  const gate = deferred(), env = await fixture({ onSave: () => gate.promise });
  let settled = false; const pending = env.controller.addSelections(['BAT-1']).then(result => { settled = true; return result; });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(settled, false); assert.equal(env.controller.getSnapshot().busy, true); assert.equal(env.calls.length, 0);
  gate.resolve(); const result = await pending;
  assert.equal(result[0].type, 'accepted'); assert.equal(env.controller.getSnapshot().session.queue.length, 1);
  assert.equal(env.saved().entries[env.controller.key], JSON.stringify(env.controller.getSnapshot().session));
});

test('movement captures full session and exact null-tag version and loan before sending; station remains open', async () => {
  const env = await fixture({ kind: 'return', batteries: [battery('BAT-1', { tagId: null, loanId: uuid(3), borrowerName: 'Staff B' })] });
  await env.controller.addSelections(['BAT-1']); const outcome = await env.controller.confirmQueue();
  const call = env.calls.find(item => item.action === 'movement'), captured = JSON.parse(call.saved.entries[env.controller.key]);
  assert.deepEqual(call.payload.scan.bindings, [{ batteryId: 'BAT-1', tagId: null, version: 3 }]);
  assert.deepEqual(call.payload.expectedLoans, [{ batteryId: 'BAT-1', loanId: uuid(3) }]);
  assert.deepEqual(captured.attempt.payload, call.payload); assert.equal(captured.attempt.status, 'uncertain'); assert.equal(captured.queue.length, 1);
  assert.equal(outcome.type, 'saved'); assert.equal(env.controller.getSnapshot().session.completed.length, 1);
  assert.ok(env.storage.getItem(env.controller.key)); assert.equal(env.controller.canExit(), true);
});

test('uncertain requests block acquisition, removal and exit, then retry only their original payload', async () => {
  let fail = true;
  const env = await fixture({ movement: payload => { if (fail) throw new Error('Controlled lost response'); return { ...receipt(payload), replayed: true }; } });
  await env.controller.addSelections(['BAT-1']); await env.controller.confirmQueue();
  const original = structuredClone(env.controller.getSnapshot().session.attempt.payload);
  assert.equal(env.controller.getSnapshot().session.attempt.status, 'uncertain'); assert.equal(env.controller.canExit(), false);
  await assert.rejects(env.controller.addTag('tag:BAT-1'), /protected/); await assert.rejects(env.controller.remove('BAT-1'), /original/); await assert.rejects(env.controller.exit(true), /captured/);
  const recovered = env.recreate(); assert.deepEqual(recovered.getSnapshot().session.attempt.payload, original);
  fail = false; assert.equal((await recovered.retry()).type, 'saved');
  assert.deepEqual(env.calls.filter(call => call.action === 'movement').map(call => call.payload), [original, original]);
});

test('older continuous session recovers as review and subset retry leaves remaining queue unsubmitted', async () => {
  const reads = [battery('BAT-1'), battery('BAT-2')].map(item => ({ battery: item, tagId: item.tagId, source: 'manual', readAt: at }));
  const payload = { requestId: uuid(2), kind: 'checkout', batteryIds: ['BAT-1'], scan: { sessionId: uuid(1), source: 'manual', bindings: [{ batteryId: 'BAT-1', tagId: 'tag:BAT-1', version: 3 }] } };
  const saved = { sessionId: uuid(1), mode: 'continuous', room: null, queue: reads, completed: [], issues: [], attempt: { reads: [reads[0]], payload, status: 'uncertain', message: 'Lost response' } };
  const env = await fixture({ batteries: reads.map(read => read.battery), entries: { [scanStorageKey(accountId, 'demo', 'checkout')]: JSON.stringify(saved) } });
  assert.equal(env.calls.length, 0); assert.equal(env.controller.getSnapshot().session.mode, 'batch');
  await env.controller.retry();
  assert.deepEqual(env.calls.map(call => call.payload.batteryIds), [['BAT-1']]);
  assert.deepEqual(env.controller.getSnapshot().session.queue.map(read => read.battery.id), ['BAT-2']);
});

test('receipt identity mismatch is uncertain and cannot establish saved checkout', async () => {
  const env = await fixture({ movement: payload => ({ ...receipt(payload), borrowerAccountId: 'OTHER-STAFF' }) });
  await env.controller.addSelections(['BAT-1']); const result = await env.controller.confirmQueue();
  assert.equal(result.type, 'uncertain'); assert.equal(env.controller.getSnapshot().session.completed.length, 0); assert.equal(env.controller.getSnapshot().session.queue.length, 1);
});

test('failed durable receipt acknowledgement retains exact original request and recovery succeeds by replay', async () => {
  let rejectAcknowledgement = true;
  const env = await fixture({ onSave: async raw => { const session = JSON.parse(JSON.parse(raw).entries[scanStorageKey(accountId, 'demo', 'checkout')]); if (rejectAcknowledgement && session?.completed.length) throw new Error('Controlled acknowledgement failure'); } });
  await env.controller.addSelections(['BAT-1']);
  await assert.rejects(env.controller.confirmQueue(), /acknowledgement failure/);
  const original = env.controller.getSnapshot().session.attempt.payload;
  assert.equal(env.controller.getSnapshot().session.completed.length, 0); assert.equal(JSON.parse(env.saved().entries[env.controller.key]).attempt.payload.requestId, original.requestId);
  rejectAcknowledgement = false; await env.controller.retryStorage(); assert.equal((await env.controller.retry()).type, 'saved');
  assert.deepEqual(env.calls.filter(call => call.action === 'movement').map(call => call.payload), [original, original]);
});

test('definitive rejection requires loading current records and deliberate discard without adopting a new loan', async () => {
  const env = await fixture({ kind: 'return', batteries: [battery('BAT-1', { loanId: uuid(3) })], movement: () => { throw Object.assign(new Error('Version conflict'), { status: 409 }); } });
  await env.controller.addSelections(['BAT-1']); assert.equal((await env.controller.confirmQueue()).type, 'rejected');
  await assert.rejects(env.controller.discardRejected(), /Load and review/);
  env.inventory.batteries = [battery('BAT-1', { loanId: uuid(4), version: 4 })];
  await env.controller.reviewLatest(); await env.controller.discardRejected();
  assert.equal(env.controller.getSnapshot().session.attempt, null); assert.equal(env.controller.getSnapshot().session.queue.length, 0);
  assert.equal(env.calls.filter(call => call.action === 'movement').length, 1);
});

test('one queue source, duplicate issues and demo attribution remain durable', async () => {
  const env = await fixture({ batteries: [battery('BAT-1'), battery('BAT-2')] });
  assert.equal((await env.controller.addTag('tag:BAT-1', 'simulated')).type, 'accepted');
  assert.equal((await env.controller.addTag('tag:BAT-1', 'simulated')).type, 'duplicate');
  assert.equal((await env.controller.addSelections(['BAT-2']))[0].type, 'failure');
  assert.equal((await env.controller.addTag('tag:BAT-2', 'tag')).type, 'failure');
  assert.equal(env.controller.getSnapshot().session.queue.length, 1); assert.equal(env.controller.getSnapshot().session.queue[0].source, 'simulated');
  assert.equal(env.controller.getSnapshot().session.issues.find(issue => issue.category === 'duplicate').acknowledged, true);
  const live = await fixture({ dataset: 'live' }); await assert.rejects(live.controller.addTag('tag:BAT-1', 'simulated'), /Demonstration/);
});

test('corrupt saved queues are retained and block all new operations', async () => {
  const key = scanStorageKey(accountId, 'demo', 'checkout'), env = await fixture({ entries: { [key]: '{malformed' } });
  assert.match(env.controller.getSnapshot().storageError, /unreadable/); assert.equal(env.controller.canExit(), false);
  await assert.rejects(env.controller.addSelections(['BAT-1']), /unreadable/); assert.equal(env.storage.getItem(key), '{malformed'); assert.equal(env.calls.length, 0);
});

test('empty scan recovery values and empty mobile scopes are corruption, never fresh drafts', async () => {
  const key = scanStorageKey(accountId, 'demo', 'checkout'), empty = await fixture({ entries: { [key]: '' } });
  assert.match(empty.controller.getSnapshot().storageError, /unreadable/); assert.equal(empty.controller.canExit(), false);
  await assert.rejects(empty.controller.addSelections(['BAT-1']), /unreadable/); assert.equal(empty.storage.getItem(key), '');
  const env = await fixture(); await env.controller.addSelections(['BAT-1']);
  const saved = JSON.parse(env.storage.getItem(env.controller.key)); saved.mobileScope = '';
  env.storage.setItem(env.controller.key, JSON.stringify(saved)); await env.storage.flush();
  const recovered = env.recreate(); assert.match(recovered.getSnapshot().storageError, /scope is unreadable/); assert.equal(recovered.canExit(), false);
  assert.deepEqual(JSON.parse(env.storage.getItem(env.controller.key)), saved);
});

test('queue bounds and reviewed teaching group version apply during acquisition', async () => {
  const env = await fixture({ teachingGroup: { id: uuid(80), version: 2 }, teachingGroups: [{ id: uuid(80), version: 2, batteryIds: ['BAT-1'] }], batteries: [battery('BAT-1'), battery('BAT-2')] });
  assert.equal((await env.controller.addSelections(['BAT-2']))[0].type, 'failure');
  await env.controller.addSelections(['BAT-1']); await env.controller.confirmQueue();
  assert.deepEqual(env.calls.find(call => call.action === 'movement').payload.teachingGroup, { id: uuid(80), version: 2 });
  await assert.rejects(env.controller.addSelections(Array.from({ length: 101 }, (_, index) => `BAT-${index}`)), /1 and 100/);
});

const evidence = () => ({ attemptId: uuid(70), source: 'native-nfc-reader', platform: 'android', startedAt: at, endedAt: at, adoptedAt: at, tagId: 'nfc:uid:0004AB00', result: { uidHex: '0004AB00', technology: 'Controlled NFC-A output', ndefStatus: 'readWrite', capacityBytes: 144, records: [{ tnf: 1, typeHex: '55', idHex: '', payloadHex: '046578616D706C652E636F6D' }], observedAt: at } });
test('controlled native source binds complete UID/NDEF into the reviewed request and never mixes typed input', async () => {
  const value = evidence(), env = await fixture({ batteries: [battery('BAT-1', { tagId: value.tagId }), battery('BAT-2')] });
  const result = await env.controller.addTag(value.tagId, 'native-nfc-reader', value);
  assert.equal(result.type, 'accepted'); const read = env.controller.getSnapshot().session.queue[0];
  assert.equal(read.source, 'native_nfc'); assert.equal(acquisitionOf(read), 'native-nfc-reader'); assert.deepEqual(read.nfcEvidence, value);
  assert.deepEqual(env.recreate().getSnapshot().session.queue[0]?.nfcEvidence, value);
  assert.equal((await env.controller.addTag('tag:BAT-2', 'tag')).type, 'failure');
  await env.controller.confirmQueue();
  const payload = env.calls.find(call => call.action === 'movement').payload;
  assert.equal(payload.scan.source, 'native_nfc'); assert.deepEqual(payload.scan.bindings[0].nfcEvidence, value);
  assert.deepEqual(JSON.parse(env.saved().entries[env.controller.key]).completed[0].nfcEvidence, value);
});

test('native business source is rejected in working inventory while malformed or missing evidence is never staged', async () => {
  const value = evidence(), live = await fixture({ dataset: 'live', batteries: [battery('BAT-1', { tagId: value.tagId })] });
  await assert.rejects(live.controller.addTag(value.tagId, 'native-nfc-reader', value), /demonstration-only/);
  const env = await fixture(); await assert.rejects(env.controller.addTag(value.tagId, 'native-nfc-reader', { ...value, tagId: 'nfc:uid:FFFFFFFF' }));
  assert.equal(env.controller.getSnapshot().session.queue.length, 0); assert.equal(env.calls.length, 0); assert.equal(live.calls.length, 0);
});

test('fixed personal owner and holder scopes reject tag lookups outside the authenticated boundary and survive generic recovery', async () => {
  const env = await fixture({ scope: { kind: 'owner', id: accountId, label: 'My batteries' }, batteries: [battery('BAT-1', { ownerAccountId: accountId }), battery('BAT-2', { ownerAccountId: 'OTHER-STAFF' })] });
  assert.equal((await env.controller.addTag('tag:BAT-2')).type, 'failure'); assert.equal((await env.controller.addTag('tag:BAT-1')).type, 'accepted');
  const recovered = env.recreate(); assert.equal(recovered.getSnapshot().session.mobileScope.id, accountId);
  assert.equal((await recovered.addTag('tag:BAT-2')).type, 'failure'); assert.equal(recovered.getSnapshot().session.queue.length, 1);
  const holder = await fixture({ kind: 'return', scope: { kind: 'holder', id: accountId }, batteries: [battery('BAT-1', { loanId: uuid(3), borrowerAccountId: accountId }), battery('BAT-2', { loanId: uuid(4), borrowerAccountId: 'OTHER-STAFF' })] });
  assert.equal((await holder.controller.addTag('tag:BAT-2')).type, 'failure'); assert.equal((await holder.controller.addTag('tag:BAT-1')).type, 'accepted');
});

test('room scope uses last dated observation instead of registered storage, and group fixed membership cannot widen on refresh', async () => {
  const env = await fixture({ scope: { kind: 'room', id: 'ROOM-A' }, batteries: [battery('BAT-1', { observedRoomId: 'ROOM-A', observedAt: at }), battery('BAT-2', { homeRoomId: 'ROOM-A', observedRoomId: 'ROOM-B', observedAt: at })] });
  env.inventory.rooms = [{ id: 'ROOM-A', buildingId: 'J18', selectable: true }, { id: 'ROOM-B', buildingId: 'J18', selectable: true }];
  assert.equal((await env.controller.addTag('tag:BAT-2')).type, 'failure'); assert.equal((await env.controller.addTag('tag:BAT-1')).type, 'accepted');
  const grouped = await fixture({ scope: { kind: 'group', id: uuid(80) }, teachingGroup: { id: uuid(80), version: 2 }, teachingGroups: [{ id: uuid(80), version: 2, batteryIds: ['BAT-1'] }], batteries: [battery('BAT-1'), battery('BAT-2')] });
  grouped.inventory.teachingGroups[0].batteryIds.push('BAT-2');
  assert.equal((await grouped.controller.addTag('tag:BAT-2')).type, 'failure');
});

test('corrupt durable scan scope blocks recovery without removing captured work', async () => {
  const env = await fixture(); await env.controller.addSelections(['BAT-1']);
  const saved = JSON.parse(env.storage.getItem(env.controller.key)); saved.mobileScope = { kind: 'holder', id: 'OTHER-STAFF' };
  env.storage.setItem(env.controller.key, JSON.stringify(saved)); await env.storage.flush();
  const recovered = env.recreate(); assert.match(recovered.getSnapshot().storageError, /authenticated native account/); assert.equal(recovered.canExit(), false);
  assert.deepEqual(JSON.parse(env.storage.getItem(env.controller.key)).queue, saved.queue);
});
