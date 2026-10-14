import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDurableStorage } from '../src/platform/durable-storage.mjs';
import { lifecycleStorageKey } from '../src/shared/lib/lifecycle-session.js';
import { removalDraftStorageKey } from '../src/shared/lib/removal-draft.js';
import { acquireRemovalNative, createGuardedRemovalBridge, createRemovalController, recoverRemovalScope, removalScopeStorageKey } from '../src/features/lifecycle/removal-controller.mjs';

const actor = '11111111-1111-4111-8111-111111111111', requestId = '22222222-2222-4222-8222-222222222222', groupId = '33333333-3333-4333-8333-333333333333', at = '2026-10-12T05:00:00.000Z';
const battery = (id, patch = {}) => ({ id, name: `Battery ${id}`, version: 7, tagId: id === 'A' ? null : `tag-${id}`, ownerAccountId: actor, lifecycleStatus: 'active', loanId: null, ...patch });
const data = () => ({ dataset: 'demo', user: { id: actor, role: 'staff' }, rooms: [{ id: 'ROOM', name: 'Room', buildingId: 'J18', selectable: true }], teachingGroups: [{ id: groupId, ownerAccountId: actor, state: 'active', version: 4, batteryIds: ['A', 'B'] }], batteries: [battery('A'), battery('B'), battery('LOAN', { loanId: requestId }), battery('OLD', { lifecycleStatus: 'scrapped' }), battery('OTHER', { ownerAccountId: 'other' })] });
function receipt(payload) { return { requestId: payload.requestId, dataset: 'demo', actorAccountId: actor, kind: payload.kind, reason: payload.reason, destination: payload.destination, source: payload.source, at, replayed: false, items: payload.items.map(item => ({ ...item, version: item.version + 1, status: payload.kind })), ...(payload.teachingGroup ? { teachingGroup: { ...payload.teachingGroup, name: 'Own group', ownerAccountId: actor, operationId: payload.requestId, batteryIds: payload.items.map(item => item.batteryId) } } : {}) }; }
async function fixture({ snapshot = data(), entries = {}, failSave, handler, scope, teachingGroup } = {}) {
  let raw = JSON.stringify({ schemaVersion: 1, entries }), sent = [], lookup = [], receipts = [];
  const storage = createDurableStorage({ load: async () => raw, save: async value => { if (failSave?.(JSON.parse(value).entries)) throw new Error('Controlled durable update denial'); raw = value; } }); await storage.initialize();
  const write = async (action, payload) => {
    if (action === 'scan_lookup') { lookup.push(structuredClone(payload)); return handler ? handler(action, payload) : { source: payload.source, results: payload.tagIds.map(tagId => ({ tagId, battery: snapshot.batteries.find(item => item.tagId === tagId) ?? null })) }; }
    const retained = JSON.parse(raw).entries[lifecycleStorageKey(actor, snapshot.dataset)]; assert.ok(retained, 'The request exists durably before network submission'); assert.deepEqual(JSON.parse(retained).payload, payload);
    sent.push(structuredClone(payload)); const result = handler ? await handler(action, payload) : receipt(payload); receipts.push(result); return result;
  };
  const controller = createRemovalController({ storage, accountId: actor, dataset: snapshot.dataset, inventory: snapshot, scope, teachingGroup, write, id: () => requestId }); await controller.initialize();
  return { controller, storage, snapshot, sent, lookup, receipts, raw: () => raw };
}
test('manual removal admits tagged and untagged active in-store assets with exact frozen versions, and duplicate acquisition leaves count unchanged', async () => {
  const f = await fixture(); assert.equal((await f.controller.add('A')).kind, 'accepted'); assert.equal((await f.controller.add('A')).kind, 'duplicate'); assert.equal(f.controller.snapshot().draft.items.length, 1);
  assert.equal(f.controller.snapshot().draft.items[0].tagId, null); assert.equal(f.controller.snapshot().draft.items[0].version, 7);
  await f.controller.add('LOAN'); await f.controller.add('OLD'); assert.equal(f.controller.snapshot().draft.items.length, 1); assert.equal(f.sent.length, 0);
  f.snapshot.batteries[0].version = 8; f.controller.setInventory(f.snapshot); assert.deepEqual(f.controller.snapshot().staleIds, ['A']);
  assert.equal(await f.controller.submit(['A']), null); assert.equal(f.sent.length, 0);
});
test('one source per queue, exact typed lookup and no simulated or native-to-typed attribution are preserved', async () => {
  const f = await fixture(); await f.controller.change({ source: 'tag_entry' }); assert.equal((await f.controller.addTag('tag-B')).kind, 'accepted');
  assert.deepEqual(f.lookup, [{ source: 'manual', tagIds: ['tag-B'] }]); await assert.rejects(f.controller.change({ source: 'manual_selection' }), /before changing/);
  await f.controller.add('A'); assert.equal(f.controller.snapshot().draft.items.length, 1); assert.equal(f.controller.snapshot().latest.kind, 'failure');
  await f.controller.addTag('unregistered'); assert.equal(f.controller.snapshot().draft.items.length, 1); assert.equal(f.sent.length, 0);
});
test('selected atomic removal keeps the unsubmitted residual queue and receipt acknowledgement in one durable update', async () => {
  const f = await fixture(); await f.controller.add('A'); await f.controller.add('B'); await f.controller.change({ kind: 'permanently_removed', reason: 'Transfer', destination: 'Recorded destination', selectedIds: ['A'] });
  const result = await f.controller.submit(['A']); assert.ok(result); assert.equal(f.sent.length, 1); assert.equal(f.sent[0].items.length, 1); assert.equal(f.sent[0].source, 'manual_selection');
  const retained = JSON.parse(f.raw()).entries; assert.equal(retained[lifecycleStorageKey(actor, 'demo')], undefined);
  assert.deepEqual(JSON.parse(retained[removalDraftStorageKey(actor, 'demo')]).items.map(item => item.batteryId), ['B']); assert.ok(retained[`preference:removal-receipt:${requestId}`]);
  assert.equal(f.controller.snapshot().blocked, false); assert.equal(f.controller.snapshot().completed.length, 1);
  await f.controller.exit(); assert.deepEqual(JSON.parse(f.raw()).entries[removalDraftStorageKey(actor, 'demo')], retained[removalDraftStorageKey(actor, 'demo')]);
});
test('failed atomic acknowledgement retains the original attempt and all queue records; exact retry resolves only its captured subset', async () => {
  let deny = false;
  const f = await fixture({ failSave: entries => deny && !entries[lifecycleStorageKey(actor, 'demo')] && !!entries[`preference:removal-receipt:${requestId}`] }); await f.controller.add('A'); await f.controller.add('B'); deny = true;
  assert.equal(await f.controller.submit(['A']), null); assert.ok(f.controller.snapshot().attempt); assert.equal(f.controller.snapshot().completed.length, 0); assert.equal(f.controller.snapshot().draft.items.length, 2);
  const retained = JSON.parse(f.storage.exportRaw()).current.entries; assert.ok(retained[lifecycleStorageKey(actor, 'demo')]); assert.equal(JSON.parse(retained[removalDraftStorageKey(actor, 'demo')]).items.length, 2);
  deny = false; assert.ok(await f.controller.retry()); assert.deepEqual(f.sent[1], f.sent[0]); assert.deepEqual(f.controller.snapshot().draft.items.map(item => item.batteryId), ['B']); assert.equal(f.sent.length, 2);
});
test('response uncertainty survives reconstruction without automatic submission or replacing reviewed bindings', async () => {
  const f = await fixture({ handler: async () => { throw new Error('Controlled lost response'); } }); await f.controller.add('A'); await f.controller.add('B'); await f.controller.submit(['A']);
  assert.equal(f.sent.length, 1); const original = f.controller.snapshot().attempt.payload;
  const resumed = await fixture({ entries: JSON.parse(f.raw()).entries }); assert.equal(resumed.sent.length, 0); assert.deepEqual(resumed.controller.snapshot().attempt.payload, original);
  assert.ok(await resumed.controller.retry()); assert.deepEqual(resumed.sent[0], original); assert.deepEqual(resumed.controller.snapshot().draft.items.map(item => item.batteryId), ['B']);
});
test('fixed personal, observed-room and group membership boundaries apply to inputs and survive draft restore', async () => {
  const owner = await fixture({ scope: { kind: 'owner', id: actor, label: 'My batteries' } }); await owner.controller.add('OTHER'); assert.equal(owner.controller.snapshot().draft.items.length, 0);
  await owner.controller.add('A'); const restored = await fixture({ entries: JSON.parse(owner.raw()).entries }); assert.equal(restored.controller.snapshot().scope.kind, 'owner'); assert.equal(restored.controller.snapshot().draft.items.length, 1);
  const observed = data(); observed.batteries[1].observedAt = at; observed.batteries[1].observedRoomId = 'ROOM';
  const room = await fixture({ snapshot: observed, scope: { kind: 'room', id: 'ROOM' } }); await room.controller.add('A'); await room.controller.add('B'); assert.deepEqual(room.controller.snapshot().draft.items.map(item => item.batteryId), ['B']);
  const group = await fixture({ scope: { kind: 'group', id: groupId }, teachingGroup: { id: groupId, version: 4 } }); await group.controller.add('A'); await group.controller.add('OTHER'); assert.equal(group.controller.snapshot().draft.items.length, 1);
  assert.ok(await group.controller.submit(['A'])); assert.deepEqual(group.sent[0].teachingGroup, { id: groupId, version: 4 });
});
test('corrupt including empty recovery keys block new work and normal exit without replacing original bytes', async () => {
  for (const key of [lifecycleStorageKey(actor, 'demo'), removalDraftStorageKey(actor, 'demo'), removalScopeStorageKey(actor, 'demo')]) for (const raw of ['', 'not JSON']) {
    const f = await fixture({ entries: { [key]: raw } }); assert.equal(f.controller.snapshot().blocked, true); assert.equal(f.storage.getItem(key), raw); await assert.rejects(f.controller.exit(), /before exit/); assert.equal(await f.controller.add('A'), null); assert.equal(f.sent.length, 0);
  }
});
test('pause or account change during pending lookup cannot stage a late result; a queue accepts at most 100 unique records', async () => {
  let finish; const pending = new Promise(resolve => { finish = resolve; });
  const f = await fixture({ handler: () => pending }); await f.controller.change({ source: 'tag_entry' }); const input = f.controller.addTag('tag-B'); f.controller.pause(true); finish({ source: 'manual', results: [{ tagId: 'tag-B', battery: f.snapshot.batteries[1] }] }); await input; assert.equal(f.controller.snapshot().draft.items.length, 0);
  const snapshot = data(); snapshot.batteries = Array.from({ length: 101 }, (_, index) => battery(`B${index}`)); const many = await fixture({ snapshot });
  for (const item of snapshot.batteries) await many.controller.add(item.id); assert.equal(many.controller.snapshot().draft.items.length, 100); assert.equal(many.controller.snapshot().latest.kind, 'failure');
});
test('native removal retains complete adopted evidence, rejects input downgrade and blocks Working business staging', async () => {
  const snapshot = data(); snapshot.batteries[1].tagId = 'nfc:uid:0004AB00'; const f = await fixture({ snapshot }); await f.controller.change({ source: 'native_nfc' });
  const evidence = { attemptId: crypto.randomUUID(), source: 'native-nfc-reader', platform: 'android', startedAt: at, endedAt: at, adoptedAt: at, tagId: 'nfc:uid:0004AB00', result: { uidHex: '0004AB00', technology: 'Controlled native fixture', ndefStatus: 'readOnly', capacityBytes: 144, records: [{ tnf: 2, typeHex: '0001', idHex: '00', payloadHex: '000000AB' }], observedAt: at } };
  assert.equal((await f.controller.addNative(evidence)).kind, 'accepted'); assert.equal(f.lookup[0].source, 'native_nfc'); assert.deepEqual(f.controller.snapshot().draft.items[0].nfcEvidence, evidence);
  assert.ok(await f.controller.submit(['B'])); assert.equal(f.sent[0].source, 'native_nfc'); assert.deepEqual(f.sent[0].items[0].nfcEvidence, evidence);
  const working = data(); working.dataset = 'live'; const live = await fixture({ snapshot: working }); await live.controller.addNative(evidence); assert.equal(live.lookup.length, 0); assert.equal(live.sent.length, 0); assert.equal(live.controller.snapshot().draft.items.length, 0);
});
test('native removal keeps transport faults distinct from unknown and invalid tag outcomes without changing any original request',async()=>{
  const evidence={attemptId:crypto.randomUUID(),source:'native-nfc-reader',platform:'android',startedAt:at,endedAt:at,adoptedAt:at,tagId:'nfc:uid:0004AB00',result:{uidHex:'0004AB00',technology:'Controlled fixture',ndefStatus:'notSupported',capacityBytes:null,records:[],observedAt:at}};
  const network=await fixture({handler:async()=>{throw Object.assign(Error('Exact controlled removal lookup network error'),{code:'NETWORK_UNCERTAIN'});}});await network.controller.change({source:'native_nfc'});await network.controller.addNative(evidence);let failed=network.controller.snapshot().latest;assert.equal(failed.kind,'failure');assert.equal(failed.failureKind,'infrastructure');assert.equal(failed.code,'NETWORK_UNCERTAIN');assert.equal(failed.stage,'processing');assert.equal(failed.operation,'lookup');assert.equal(failed.acquisitionId,evidence.attemptId);assert.equal(network.sent.length,0);assert.equal(network.controller.snapshot().attempt,null);
  const unknown=await fixture();await unknown.controller.change({source:'native_nfc'});await unknown.controller.addNative(evidence);failed=unknown.controller.snapshot().latest;assert.equal(failed.kind,'failure');assert.notEqual(failed.failureKind,'infrastructure');assert.match(failed.message,/not registered/);await unknown.controller.addNative({...evidence,tagId:'wrong'});assert.notEqual(unknown.controller.snapshot().latest.failureKind,'infrastructure');assert.equal(unknown.sent.length,0);
  const pending=await fixture({handler:async(action,payload)=>{if(action==='scan_lookup')return{source:payload.source,results:[{tagId:payload.tagIds[0],battery:data().batteries[1]}]};throw Error('Controlled original removal response lost');}});await pending.controller.add('B');await pending.controller.submit(['B']);const original=pending.storage.getItem(lifecycleStorageKey(actor,'demo'));assert.ok(original);await pending.controller.addNative(evidence);assert.equal(pending.storage.getItem(lifecycleStorageKey(actor,'demo')),original);assert.equal(pending.sent.length,1,'No replacement business request was sent');
});
test('scope recovery distinguishes absent data from empty, null, malformed and foreign personal boundaries', () => {
  assert.equal(recoverRemovalScope(null, actor), null);
  for (const raw of ['', 'null', '{}', 'not JSON', JSON.stringify({ kind: 'owner', id: 'other' })]) assert.throws(() => recoverRemovalScope(raw, actor));
  assert.deepEqual(recoverRemovalScope(JSON.stringify({ kind: 'room', id: 'ROOM', label: 'Saved room view' }), actor), { kind: 'room', id: 'ROOM', label: 'Saved room view' });
});
test('a changed native receipt byte retains the exact original attempt and cannot display a saved removal', async () => {
  const snapshot = data(); snapshot.batteries[1].tagId = 'nfc:uid:0004AB00';
  const f = await fixture({ snapshot, handler: (action, payload) => action === 'scan_lookup' ? { source: 'native_nfc', results: [{ tagId: 'nfc:uid:0004AB00', battery: snapshot.batteries[1] }] } : (() => { const result = receipt(payload); result.items[0].nfcEvidence.result.records[0].payloadHex = '00FF'; return result; })() });
  await f.controller.change({ source: 'native_nfc' });
  const evidence = { attemptId: crypto.randomUUID(), source: 'native-nfc-reader', platform: 'android', startedAt: at, endedAt: at, adoptedAt: at, tagId: 'nfc:uid:0004AB00', result: { uidHex: '0004AB00', technology: 'Controlled native fixture', ndefStatus: 'readOnly', capacityBytes: 144, records: [{ tnf: 2, typeHex: '0001', idHex: '00', payloadHex: '000000AB' }], observedAt: at } };
  await f.controller.addNative(evidence); assert.equal(await f.controller.submit(['B']), null);
  assert.equal(f.controller.snapshot().completed.length, 0); assert.equal(f.controller.snapshot().draft.items.length, 1); assert.ok(f.controller.snapshot().attempt);
  assert.deepEqual(f.controller.snapshot().attempt.payload.items[0].nfcEvidence, evidence); assert.ok(JSON.parse(f.raw()).entries[lifecycleStorageKey(actor, 'demo')]);
});
test('empty ordinary exit atomically clears its draft and boundary; nonempty queue remains resumable', async () => {
  const f = await fixture({ scope: { kind: 'room', id: 'ROOM' }, entries: { 'preference:keep': 'retained preference' } });
  assert.ok(f.storage.getItem(removalDraftStorageKey(actor, 'demo'))); assert.ok(f.storage.getItem(removalScopeStorageKey(actor, 'demo')));
  await f.controller.exit(); assert.equal(f.storage.getItem(removalDraftStorageKey(actor, 'demo')), null); assert.equal(f.storage.getItem(removalScopeStorageKey(actor, 'demo')), null); assert.equal(f.storage.getItem('preference:keep'), 'retained preference');
  assert.equal(f.storage.hasPending(), false, 'An empty removal no longer prevents ordinary sign-out');
  const nonempty = await fixture({ scope: { kind: 'owner', id: actor } }); await nonempty.controller.add('A'); await nonempty.controller.exit(); assert.ok(nonempty.storage.getItem(removalDraftStorageKey(actor, 'demo'))); assert.ok(nonempty.storage.getItem(removalScopeStorageKey(actor, 'demo')));
});
function readerStorage() { const entries = {}; return { entries, getItem: key => entries[key] ?? null, setItem: (key, value) => { entries[key] = value; }, flush: async () => {} }; }
const nativeResult = () => ({ uidHex: '0004AB00', technology: 'Controlled native callback', ndefStatus: 'readOnly', capacityBytes: 144, records: [{ tnf: 2, typeHex: '0001', idHex: '00', payloadHex: '000000AB' }], observedAt: at });
test('pausing during availability or durable pre-read flush causes zero actual native reader starts', async () => {
  for (const phase of ['availability', 'flush']) {
    let current = true, starts = 0, cancels = 0, release, entered;
    const gate = new Promise(resolve => { release = resolve; }), began = new Promise(resolve => { entered = resolve; });
    const storage = readerStorage();
    if (phase === 'flush') { let first = true; storage.flush = async () => { if (first) { first = false; entered(); await gate; } }; }
    const adapter = { getAvailability: async () => { if (phase === 'availability') { entered(); await gate; } return { platform: 'android', available: true, enabled: true }; }, read: async () => { starts++; return nativeResult(); }, cancel: async () => { cancels++; } };
    const bridge = createGuardedRemovalBridge({ adapter, storage, platform: 'android', isCurrent: () => current });
    const pending = acquireRemovalNative({ bridge, isCurrent: () => current, controller: { addNative: () => { throw new Error('No acquisition may stage while paused'); } } });
    await began; current = false; await bridge.cancel(); release();
    await assert.rejects(pending, /cancelled before reader activation/); assert.equal(starts, 0); assert.equal(cancels, 1);
  }
});
test('late native completion retains device evidence but cannot adopt or stage after review/context cancellation', async () => {
  let current = true, starts = 0, stages = 0, adoptions = 0, finish, started;
  const began = new Promise(resolve => { started = resolve; }), read = new Promise(resolve => { finish = resolve; }), storage = readerStorage();
  const adapter = { getAvailability: async () => ({ platform: 'android', available: true, enabled: true }), read: () => { starts++; started(); return read; }, cancel: async () => {} };
  const bridge = createGuardedRemovalBridge({ adapter, storage, platform: 'android', isCurrent: () => current }), adopt = bridge.adopt;
  bridge.adopt = async proposal => { adoptions++; return adopt(proposal); };
  const pending = acquireRemovalNative({ bridge, isCurrent: () => current, controller: { addNative: () => { stages++; } } });
  await began; current = false; await bridge.cancel(); finish(nativeResult());
  assert.equal(await pending, null); assert.equal(starts, 1); assert.equal(adoptions, 0); assert.equal(stages, 0);
  const reports = Object.values(storage.entries).map(raw => JSON.parse(raw)); assert.equal(reports.length, 1); assert.equal(reports[0].result.uidHex, '0004AB00'); assert.equal(reports[0].result.records[0].payloadHex, '000000AB'); assert.equal(reports[0].adoptions, undefined);
});
