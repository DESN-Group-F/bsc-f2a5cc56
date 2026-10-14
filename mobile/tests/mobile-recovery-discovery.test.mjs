import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { createDurableStorage } from '../src/platform/durable-storage.mjs';
import { captureDetailBoundary, verifyDetailBoundary } from '../src/app/detail-boundary.mjs';
import { newBatteryModelSchema } from '../src/shared/lib/battery-models.js';
import { inspectionSchema } from '../src/shared/lib/battery-inspections.js';
import { inspectionStorageKey } from '../src/shared/components/inventory/inspection-request.js';
import { captureRemovalDraft, removalDraftStorageKey } from '../src/shared/lib/removal-draft.js';
import { captureIntakeDraft } from '../src/shared/lib/intake-draft.js';
import { intakeReceiptSchema, intakeStorageKey, intakeCommonSchema, captureIntakeAttempt } from '../src/shared/lib/intake-session.js';
import { captureLifecycleAttempt, lifecycleStorageKey } from '../src/shared/lib/lifecycle-session.js';
import { removalScopeStorageKey } from '../src/features/lifecycle/removal-controller.mjs';
import { teachingCheckoutStorageKey } from '../src/shared/lib/client/teaching-checkout-request.js';
import { teachingCheckoutDraftStorageKey } from '../src/shared/lib/client/teaching-checkout-draft.js';
import { locationRequestStorageKey } from '../src/shared/lib/client/location-request.js';
import { captureMovementAttempt, recoverMovementAttempt, movementStorageKey, verifyMovementReceipt, movementFailureStatus } from '../src/shared/lib/movement-session.js';
import { acknowledgeWorkflowStorage } from '../src/shared/lib/client/workflow-storage.js';
import { captureGroupMaintenance, recoverGroupMaintenance, groupMaintenanceKey, verifyGroupMaintenance } from '../src/shared/lib/group-maintenance.js';
import { captureTeachingGroupAttempt, teachingGroupStorageKey } from '../src/shared/lib/teaching-groups.js';
import { operatorRegistrationDraftSchema, operatorRegistrationDraftKey } from '../src/features/lifecycle/manual-registration-model.mjs';

// Execute the actual recovery module and its complete model recovery functions.
// Only React presentation imports are excluded; no recovery decision is stubbed.
const modelUrl = new URL('../src/shared/components/inventory/battery-model-picker.js', import.meta.url);
const modelSource = await readFile(modelUrl, 'utf8');
const modelAst = ts.createSourceFile(modelUrl.pathname, modelSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const modelFunctions = modelAst.statements.filter(statement => ts.isFunctionDeclaration(statement) && ['modelCreateStorageKey', 'recoverModelCreate'].includes(statement.name?.text)).map(statement => statement.getFullText(modelAst));
assert.equal(modelFunctions.length, 2, 'The harness must retain both actual model recovery functions.');
const modelModule = 'data:text/javascript,' + encodeURIComponent(`import { newBatteryModelSchema, updateBatteryModelSchema } from ${JSON.stringify(new URL('../src/shared/lib/battery-models.js', import.meta.url).href)};\n${modelFunctions.join('\n')}`);
const models = await import(modelModule);
const recoveryUrl = new URL('../src/app/recovery.mjs', import.meta.url);
const recoverySource = (await readFile(recoveryUrl, 'utf8')).replace(/from (['"])(\.[^'"]+)\1/g, (_, quote, specifier) => `from ${JSON.stringify(specifier.endsWith('/components/inventory/battery-model-picker.js') ? modelModule : new URL(specifier, recoveryUrl).href)}`);
const { discoverMobileRecovery, accountHasDeviceWork, clearEmptyDeviceWork } = await import('data:text/javascript,' + encodeURIComponent(recoverySource));
const actor = 'review-account', other = 'another-review-account', at = '2026-10-12T04:00:00.000Z';

async function fixture(t, seed = {}) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  let raw = JSON.stringify({ schemaVersion: 1, entries: seed });
  const writes = [], control = { rejectSave: false };
  const storage = createDurableStorage({ load: async () => raw, save: async value => { writes.push(value); if (control.rejectSave) throw new Error('Controlled durable save denial'); raw = value; } });
  await storage.initialize();
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { __batteryWorkflowStorage: storage } });
  t.after(() => { if (previous) Object.defineProperty(globalThis, 'window', previous); else delete globalThis.window; });
  return { storage, writes, control, raw: () => raw };
}
function modelAttempt(dataset = 'demo', accountId = actor) {
  return { dataset, actorAccountId: accountId, payload: newBatteryModelSchema.parse({ id: crypto.randomUUID(), model: 'Reviewed model', name: 'Reviewed battery model' }) };
}
function inspectionAttempt(dataset = 'demo', accountId = actor, batteryId = 'BAT-00000042') {
  return { accountId, dataset, batteryId, action: 'inspection', payload: inspectionSchema.parse({ requestId: crypto.randomUUID(), batteryId, expectedBatteryVersion: 3, kind: 'visual_check', outcome: 'inconclusive', performedAt: at }) };
}
function removalDraft(dataset = 'demo', items = []) {
  return captureRemovalDraft({ actorAccountId: actor, dataset, source: 'manual_selection', kind: 'scrapped', reason: '', destination: '', items, selectedIds: items.map(item => item.batteryId) });
}
function completedIntake() {
  const receipt = intakeReceiptSchema.parse({ requestId: crypto.randomUUID(), sessionId: crypto.randomUUID(), dataset: 'demo', actorAccountId: actor, batteryId: 'BAT-00000042', tagId: 'DEMO-INTAKE-COMPLETED', registeredAt: at, source: 'simulated_intake', replayed: false, name: 'Registered battery', model: 'Reviewed model', chemistry: '', capacityMah: null, voltage: null, ownerId: 'staff-owner', homeBuildingId: 'J18', homeRoomId: null, manufacturedOn: null, firstUsedOn: '2026-10-12' });
  return captureIntakeDraft({ actorAccountId: actor, dataset: 'demo', batch: null, entries: [], attempt: null, attemptEntryId: null, completed: [receipt] });
}

function pendingIntake(withAttempt=false) {
  const common=intakeCommonSchema.parse({name:'Battery',model:'',chemistry:'',capacityMah:null,voltage:null,ownerId:'owner-a',homeBuildingId:'J18',homeRoomId:null,manufacturedOn:null,firstUsedOn:null});
  const entry={id:crypto.randomUUID(),sessionId:crypto.randomUUID(),tagId:'DEMO-INTAKE-RETAINED',scannedAt:at,common,firstUseMode:'unknown',selected:true,error:'',source:'simulated_intake'};
  const attempt=withAttempt?captureIntakeAttempt(actor,'demo',{requestId:crypto.randomUUID(),sessionId:entry.sessionId,tagId:entry.tagId,scannedAt:at,common,firstUseMode:'unknown',source:entry.source}):null;
  return captureIntakeDraft({actorAccountId:actor,dataset:'demo',batch:null,entries:[entry],attempt,attemptEntryId:attempt?entry.id:null,completed:[]});
}
function scanDraft(overrides={}) {
  const battery={id:'BAT-00000042',name:'Battery',ownerName:'Responsible staff',version:3,tagId:null,loanId:null};
  return {sessionId:crypto.randomUUID(),mode:'batch',room:null,queue:[{source:'selection',acquisition:'selection',tagId:null,readAt:at,battery}],completed:[],issues:[],attempt:null,...overrides};
}

test('entry discovery skips valid ordinary drafts without changing startup recovery or any saved bytes',async t=>{
  const intakeKey=intakeStorageKey(actor,'demo'),removalKey=removalDraftStorageKey(actor,'demo'),scanKey=`battery-scan:${actor}:demo:checkout`;
  const seeds=[{[intakeKey]:JSON.stringify(pendingIntake())},{[removalKey]:JSON.stringify(removalDraft('demo',[{batteryId:'BAT-00000042',version:3,tagId:null,name:'Battery'}]))},{[scanKey]:JSON.stringify(scanDraft())}];
  for(const seed of seeds) {
    const context=await fixture(t,seed);assert.ok(discoverMobileRecovery(context.storage,actor));
    assert.equal(discoverMobileRecovery(context.storage,actor,{protectedOnly:true}),null);assert.equal(accountHasDeviceWork(context.storage,actor),true);
    assert.deepEqual(context.storage.entries(),seed);assert.equal(context.writes.length,0);
  }
  const accountId=crypto.randomUUID(),draftKey=operatorRegistrationDraftKey(accountId,'demo'),draft=operatorRegistrationDraftSchema.parse({actorAccountId:accountId,dataset:'demo',sessionId:crypto.randomUUID(),values:Object.fromEntries(['name','model','chemistry','capacityMah','voltage','tagId','ownerId','homeRoomId','manufacturedOn','firstUsedOn'].map(key=>[key,''])),firstUseMode:'unknown',modelSelection:null});
  const context=await fixture(t,{[draftKey]:JSON.stringify(draft)});assert.equal(discoverMobileRecovery(context.storage,accountId).type,'manual_registration');assert.equal(discoverMobileRecovery(context.storage,accountId,{protectedOnly:true}),null);assert.equal(context.writes.length,0);
});

test('entry recovery preserves exact Intake attempts and return-room decisions ahead of ordinary drafts',async t=>{
  const ordinaryKey=removalDraftStorageKey(actor,'demo'),ordinary=JSON.stringify(removalDraft('demo',[{batteryId:'BAT-00000042',version:3,tagId:null,name:'Battery'}]));
  for(const [key,raw,expected] of [[intakeStorageKey(actor,'demo'),JSON.stringify(pendingIntake(true)),{type:'intake',dataset:'demo'}],[`battery-scan:${actor}:demo:return`,JSON.stringify(scanDraft({queue:[],roomConfirmationRequired:true})),{type:'scan',dataset:'demo',kind:'return'}]]) {
    const seed={[ordinaryKey]:ordinary,[key]:raw},context=await fixture(t,seed);assert.deepEqual(discoverMobileRecovery(context.storage,actor,{protectedOnly:true}),expected);assert.deepEqual(context.storage.entries(),seed);assert.equal(context.writes.length,0);
  }
});

test('protected-only discovery still rejects malformed ordinary scope, acquisition and account records',async t=>{
  const scanKey=`battery-scan:${actor}:demo:checkout`,ordinary=scanDraft(),badAcquisition=structuredClone(ordinary);badAcquisition.queue[0].acquisition='unknown-input';
  const badNative=structuredClone(ordinary);badNative.queue[0].acquisition='native-nfc-reader';
  for(const seed of [{[scanKey]:JSON.stringify(scanDraft({mobileScope:''}))},{[scanKey]:JSON.stringify(scanDraft({mobileScope:{kind:'holder',id:other}}))},{[scanKey]:JSON.stringify(badAcquisition)},{[scanKey]:JSON.stringify(badNative)},{[intakeStorageKey(actor,'demo')]:JSON.stringify({...pendingIntake(),actorAccountId:other})},{[removalScopeStorageKey(actor,'demo')]:'not-json'}]) {
    const context=await fixture(t,seed);assert.throws(()=>discoverMobileRecovery(context.storage,actor,{protectedOnly:true}));assert.deepEqual(context.storage.entries(),seed);assert.equal(context.writes.length,0);
  }
});

test('orphan model requests discover the exact account and dataset without submitting or rewriting', async t => {
  for (const dataset of ['demo', 'live']) {
    const key = models.modelCreateStorageKey(actor, dataset), original = JSON.stringify(modelAttempt(dataset));
    const context = await fixture(t, { [key]: original });
    assert.deepEqual(discoverMobileRecovery(context.storage, actor), { type: 'manual_registration', dataset });
    assert.equal(accountHasDeviceWork(context.storage, actor), true);
    assert.equal(context.storage.getItem(key), original); assert.equal(context.writes.length, 0);
  }
});

test('retained private group definitions restore the definition editor in their original inventory without recapture', async t => {
  for (const dataset of ['demo','live']) {
    const attempt = captureTeachingGroupAttempt(actor,dataset,{ action:'create',requestId:crypto.randomUUID(),id:crypto.randomUUID(),name:'Reviewed teaching set',notes:'',batteryIds:['BAT-00000042'] });
    const key = teachingGroupStorageKey(actor,dataset), original = JSON.stringify(attempt), context = await fixture(t,{ [key]:original });
    assert.deepEqual(discoverMobileRecovery(context.storage,actor),{ type:'workspace',dataset,view:'teaching-groups',initialTools:true });
    assert.equal(accountHasDeviceWork(context.storage,actor),true);
    assert.equal(context.storage.getItem(key),original); assert.equal(context.writes.length,0);
  }
});

test('unreadable or mismatched private group originals fail closed and another account remains independent', async t => {
  const attempt = captureTeachingGroupAttempt(other,'demo',{ action:'remove',requestId:crypto.randomUUID(),id:crypto.randomUUID(),expectedVersion:3 });
  const key = teachingGroupStorageKey(actor,'demo');
  for (const original of ['unreadable original group request',JSON.stringify(attempt),JSON.stringify({ ...attempt,actorAccountId:actor,dataset:'live' })]) {
    const context = await fixture(t,{ [key]:original });
    assert.throws(() => discoverMobileRecovery(context.storage,actor),/retained teaching group definition/i);
    assert.deepEqual(context.storage.entries(),{ [key]:original }); assert.equal(context.writes.length,0);
  }
  const otherKey = teachingGroupStorageKey(other,'demo'), context = await fixture(t,{ [otherKey]:JSON.stringify(attempt) });
  assert.equal(discoverMobileRecovery(context.storage,actor),null); assert.equal(accountHasDeviceWork(context.storage,actor),false); assert.equal(context.writes.length,0);
});

test('orphan inspection requests open their exact battery in both inventories without acknowledging them', async t => {
  for (const dataset of ['demo', 'live']) {
    const input = inspectionAttempt(dataset), key = inspectionStorageKey(actor, dataset, input.batteryId), original = JSON.stringify(input);
    const context = await fixture(t, { [key]: original });
    assert.deepEqual(discoverMobileRecovery(context.storage, actor), { type: 'inspection', dataset, batteryId: input.batteryId });
    assert.equal(context.storage.getItem(key), original); assert.equal(context.writes.length, 0);
  }
});

test('orphan removal boundaries restore the original fixed view and never infer a new group version', async t => {
  const scope = { kind: 'group', id: crypto.randomUUID(), label: 'Reviewed group' };
  const key = removalScopeStorageKey(actor, 'live'), original = JSON.stringify(scope), context = await fixture(t, { [key]: original });
  assert.deepEqual(discoverMobileRecovery(context.storage, actor), { type: 'removal', dataset: 'live', scope });
  assert.equal(accountHasDeviceWork(context.storage, actor), true);
  assert.equal(context.storage.getItem(key), original); assert.equal(context.writes.length, 0);
});

test('malformed model, inspection and removal boundary records fail closed and retain all original bytes', async t => {
  const keys = [models.modelCreateStorageKey(actor, 'demo'), inspectionStorageKey(actor, 'demo', 'BAT-00000042'), removalScopeStorageKey(actor, 'demo')];
  for (const key of keys) {
    const original = 'unreadable original review', context = await fixture(t, { [key]: original });
    assert.throws(() => discoverMobileRecovery(context.storage, actor));
    assert.deepEqual(context.storage.entries(), { [key]: original }); assert.equal(context.writes.length, 0);
  }
});

test('malformed teaching and location originals cannot disappear from recovery discovery', async t => {
  for (const key of [teachingCheckoutStorageKey(actor, 'demo'), teachingCheckoutDraftStorageKey(actor, 'demo'), locationRequestStorageKey(actor, 'demo')]) {
    const original = 'unreadable original transaction', context = await fixture(t, { [key]: original });
    assert.throws(() => discoverMobileRecovery(context.storage, actor), undefined, `Retained ${key} must block a new workflow.`);
    assert.deepEqual(context.storage.entries(), { [key]: original }); assert.equal(context.writes.length, 0);
  }
});

test('model recovery never trims, fills or drops fields in an original captured request', () => {
  const original = modelAttempt();
  assert.deepEqual(models.recoverModelCreate(JSON.stringify(original), actor, 'demo'), original);
  const missingField = structuredClone(original); delete missingField.payload.notes;
  const paddedField = structuredClone(original); paddedField.payload.model = ' Reviewed model ';
  for (const invalid of [missingField, paddedField, { ...original, unexpected: 'retained metadata' }]) assert.equal(models.recoverModelCreate(JSON.stringify(invalid), actor, 'demo'), null);
});

test('empty intake and removal drafts or saved preferences do not trap sign-out as unfinished work', async t => {
  const intake = captureIntakeDraft({ actorAccountId: actor, dataset: 'demo', batch: null, entries: [], attempt: null, attemptEntryId: null, completed: [] });
  for (const seed of [{ [intakeStorageKey(actor, 'demo')]: JSON.stringify(intake) }, { [removalDraftStorageKey(actor, 'demo')]: JSON.stringify(removalDraft()) }, { [`preference:${actor}:feedback`]: 'true' }]) {
    const context = await fixture(t, seed);
    assert.equal(accountHasDeviceWork(context.storage, actor), false);
    assert.equal(discoverMobileRecovery(context.storage, actor), null);
    assert.deepEqual(context.storage.entries(), seed); assert.equal(context.writes.length, 0);
  }
  const queued = removalDraft('demo', [{ batteryId: 'BAT-00000042', version: 3, tagId: null, name: 'Reviewed battery' }]);
  const context = await fixture(t, { [removalDraftStorageKey(actor, 'demo')]: JSON.stringify(queued) });
  assert.equal(accountHasDeviceWork(context.storage, actor), true);
  assert.deepEqual(discoverMobileRecovery(context.storage, actor), { type: 'removal', dataset: 'demo' });
});

test('another account with a matching substring cannot lock or reroute the signed-in account', async t => {
  const input = modelAttempt('demo', other), key = models.modelCreateStorageKey(other, 'demo'), context = await fixture(t, { [key]: JSON.stringify(input) });
  assert.equal(accountHasDeviceWork(context.storage, actor), false);
  assert.equal(discoverMobileRecovery(context.storage, actor), null);
  assert.equal(context.writes.length, 0);
});

test('a valid empty removal draft and paired boundary clear together while orphan boundaries remain work', async t => {
  const draftKey = removalDraftStorageKey(actor, 'demo'), scopeKey = removalScopeStorageKey(actor, 'demo'), scope = { kind: 'owner', id: actor, label: 'My owned batteries' };
  const seed = { [draftKey]: JSON.stringify(removalDraft()), [scopeKey]: JSON.stringify(scope) }, context = await fixture(t, seed);
  assert.equal(accountHasDeviceWork(context.storage, actor), false);
  assert.equal(discoverMobileRecovery(context.storage, actor), null);
  await clearEmptyDeviceWork(context.storage, actor);
  assert.deepEqual(context.storage.entries(), {}); assert.equal(context.writes.length, 1);
  const orphan = await fixture(t, { [scopeKey]: JSON.stringify(scope) });
  assert.equal(accountHasDeviceWork(orphan.storage, actor), true);
  await clearEmptyDeviceWork(orphan.storage, actor);
  assert.deepEqual(orphan.storage.entries(), { [scopeKey]: JSON.stringify(scope) }); assert.equal(orphan.writes.length, 0);
});

test('empty intake cleanup preserves complete service receipts as preferences in the same durable transaction', async t => {
  const draft = completedIntake(), key = intakeStorageKey(actor, 'demo'), receipt = draft.completed[0], context = await fixture(t, { [key]: JSON.stringify(draft) });
  assert.equal(accountHasDeviceWork(context.storage, actor), false);
  await clearEmptyDeviceWork(context.storage, actor);
  const receiptKey = `preference:intake-receipt:${receipt.requestId}`;
  assert.equal(context.storage.getItem(key), null); assert.deepEqual(JSON.parse(context.storage.getItem(receiptKey)), receipt);
  assert.deepEqual(JSON.parse(context.raw()).entries, { [receiptKey]: JSON.stringify(receipt) }); assert.equal(context.writes.length, 1);
});

test('failed atomic empty cleanup retains the original draft and receipts in memory and the native file', async t => {
  const draft = completedIntake(), key = intakeStorageKey(actor, 'demo'), seed = { [key]: JSON.stringify(draft) }, context = await fixture(t, seed), originalRaw = context.raw();
  context.control.rejectSave = true;
  await assert.rejects(clearEmptyDeviceWork(context.storage, actor), /Controlled durable save denial/);
  assert.equal(context.raw(), originalRaw); assert.deepEqual(JSON.parse(context.storage.exportRaw()).current.entries, seed);
  context.control.rejectSave = false; await context.storage.retryPersistence();
  await clearEmptyDeviceWork(context.storage, actor);
  assert.equal(context.storage.getItem(key), null);
  assert.deepEqual(JSON.parse(context.storage.getItem(`preference:intake-receipt:${draft.completed[0].requestId}`)), draft.completed[0]);
});

test('an unresolved lifecycle request or corrupt paired boundary prevents empty cleanup', async t => {
  const attempt = captureLifecycleAttempt(actor, 'demo', { requestId: crypto.randomUUID(), source: 'manual_selection', kind: 'scrapped', reason: '', destination: null, items: [{ batteryId: 'BAT-00000042', version: 3, tagId: null }] });
  const draftKey = removalDraftStorageKey(actor, 'demo'), attemptKey = lifecycleStorageKey(actor, 'demo'), seed = { [draftKey]: JSON.stringify(removalDraft()), [attemptKey]: JSON.stringify(attempt) }, pending = await fixture(t, seed);
  assert.equal(accountHasDeviceWork(pending.storage, actor), true);
  await clearEmptyDeviceWork(pending.storage, actor); assert.deepEqual(pending.storage.entries(), seed); assert.equal(pending.writes.length, 0);
  const corruptSeed = { [draftKey]: JSON.stringify(removalDraft()), [removalScopeStorageKey(actor, 'demo')]: 'corrupt fixed boundary' }, corrupt = await fixture(t, corruptSeed);
  assert.equal(accountHasDeviceWork(corrupt.storage, actor), true);
  await assert.rejects(clearEmptyDeviceWork(corrupt.storage, actor)); assert.deepEqual(corrupt.storage.entries(), corruptSeed); assert.equal(corrupt.writes.length, 0);
});

test('empty cleanup cannot delete a newer draft changed while the original flush was pending', async t => {
  const key = removalDraftStorageKey(actor, 'demo'), original = JSON.stringify(removalDraft()), newer = JSON.stringify(removalDraft('demo', [{ batteryId: 'BAT-00000042', version: 3, tagId: null, name: 'Newly reviewed battery' }])), context = await fixture(t, { [key]: original });
  const originalFlush = context.storage.flush.bind(context.storage); let replaced = false;
  context.storage.flush = async () => { await originalFlush(); if (!replaced) { replaced = true; context.storage.setItem(key, newer); await originalFlush(); } };
  await assert.rejects(clearEmptyDeviceWork(context.storage, actor), /original recovery record changed/);
  assert.equal(JSON.parse(context.raw()).entries[key], newer); assert.equal(JSON.parse(context.storage.exportRaw()).current.entries[key], newer);
});

test('detail group boundaries capture an independent version and reject owner, status, membership or version drift', () => {
  const group = { id: crypto.randomUUID(), ownerAccountId: actor, state: 'active', version: 7, batteryIds: ['BAT-00000042'] }, data = { teachingGroups: [group] };
  const scope = { kind: 'group', id: group.id, label: 'Reviewed members' }, detail = captureDetailBoundary(data, actor, 'BAT-00000042', scope);
  scope.label = 'Later view'; assert.equal(detail.scope.label, 'Reviewed members');
  assert.deepEqual(verifyDetailBoundary(detail, data, actor), { id: group.id, version: 7 });
  assert.throws(() => captureDetailBoundary(data, actor, 'BAT-00000042', { id: group.id, version: 6 }), /changed/);
  for (const patch of [{ version: 8 }, { ownerAccountId: other }, { state: 'removed' }, { batteryIds: [] }]) assert.throws(() => verifyDetailBoundary(detail, { teachingGroups: [{ ...group, ...patch }] }, actor), /blocked/);
});

test('a delayed movement receipt cannot overwrite a newer original when acknowledgement rejects the old identity', async t => {
  const sourceUrl = new URL('../src/shared/components/inventory/movement-dialog.js', import.meta.url), source = await readFile(sourceUrl, 'utf8');
  const parsed = ts.createSourceFile(sourceUrl.pathname, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const component = parsed.statements.find(statement => ts.isFunctionDeclaration(statement) && statement.name?.text === 'MovementDialog');
  const handlers = component.body.statements.filter(statement => ts.isFunctionDeclaration(statement) && ['persist', 'acknowledge', 'runAttempt'].includes(statement.name?.text)).map(statement => statement.getFullText(parsed));
  assert.equal(handlers.length, 3, 'Execute the full actual persistence, acknowledgement and submission handler graph.');
  const battery = { id: 'BAT-00000042', name: 'Reviewed battery', ownerName: 'Responsible staff', version: 3, tagId: null, loanId: null, borrowerName: null, checkedOutAt: null };
  const original = captureMovementAttempt('checkout', [battery], actor, 'demo', crypto.randomUUID()), newer = captureMovementAttempt('checkout', [battery], actor, 'demo', crypto.randomUUID()), storageKey = movementStorageKey(actor, 'demo', 'checkout');
  const context = await fixture(t, { [storageKey]: JSON.stringify(original) });
  window.dispatchEvent = () => true;
  const posts = [], closes = [], messages = [];
  const bindings = { running: { current: false }, recovery: { invalidSaved: false }, captured: { current: original }, storageKey, data: { user: { id: actor }, dataset: 'demo' }, draft: { kind: 'checkout' }, setBusy() {}, setAttempt() {}, setMessage: value => messages.push(value), recoverMovementAttempt, verifyMovementReceipt, movementFailureStatus, acknowledgeWorkflowStorage, onClose: () => closes.push(true), async write(action, payload) {
    posts.push({ action, payload: structuredClone(payload) }); await context.storage.flush();
    await context.storage.transact(entries => { entries[storageKey] = JSON.stringify(newer); });
    return { requestId: payload.requestId, kind: payload.kind, batteryIds: payload.batteryIds, count: payload.batteryIds.length, at, borrower: 'Signed-in staff', borrowerAccountId: actor };
  } };
  const keys = Object.keys(bindings), runAttempt = new Function(...keys, `${handlers.join('\n')}\nreturn runAttempt;`)(...keys.map(key => bindings[key]));
  await runAttempt(original, true); await context.storage.flush();
  assert.equal(context.storage.getItem(storageKey), JSON.stringify(newer));
  assert.equal(JSON.parse(context.raw()).entries[storageKey], JSON.stringify(newer));
  assert.equal(posts.length, 1); assert.deepEqual(posts[0].payload, original.payload); assert.equal(closes.length, 0);
});

test('an older group review cannot replace or send over another captured group request', async t => {
  const sourceUrl = new URL('../src/shared/components/inventory/group-maintenance-dialog.js', import.meta.url), source = await readFile(sourceUrl, 'utf8');
  const parsed = ts.createSourceFile(sourceUrl.pathname, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const component = parsed.statements.find(statement => ts.isFunctionDeclaration(statement) && statement.name?.text === 'GroupMaintenanceDialog');
  const handlers = component.body.statements.filter(statement => ts.isFunctionDeclaration(statement) && ['preserve', 'save'].includes(statement.name?.text)).map(statement => statement.getFullText(parsed));
  assert.equal(handlers.length, 2, 'Execute both actual group persistence and submission handlers.');
  const payload = { requestId: crypto.randomUUID(), teachingGroup: { id: crypto.randomUUID(), version: 7 }, items: [{ batteryId: 'BAT-00000042', version: 3, tagId: null }], kind: 'charge', completedAt: at, durationMinutes: 10 };
  const original = captureGroupMaintenance(actor, 'demo', payload), newer = captureGroupMaintenance(actor, 'demo', { ...payload, requestId: crypto.randomUUID() }), key = groupMaintenanceKey(actor, 'demo');
  const context = await fixture(t, { [key]: JSON.stringify(newer) }); window.dispatchEvent = () => true;
  const posts = [], closes = [], changes = [], errors = [];
  const bindings = { key, context: { accountId: actor, dataset: 'demo' }, pending: { current: original }, running: { current: false }, live: { current: true }, permitted: true, saved: false, busy: false, recovery: { invalid: false }, contextChanged: false, locked: true, setBusy() {}, setAttempt() {}, setStorageError: value => errors.push(value), setError: value => errors.push(value), setSaved() {}, captureGroupMaintenance, recoverGroupMaintenance, verifyGroupMaintenance, acknowledgeWorkflowStorage, onClose: () => closes.push(true), onChanged: async () => changes.push(true), async write(action, input) { posts.push({ action, input }); throw new Error('An older review must never reach the service.'); } };
  const keys = Object.keys(bindings), save = new Function(...keys, `${handlers.join('\n')}\nreturn save;`)(...keys.map(key => bindings[key]));
  await save(true); await context.storage.flush();
  assert.equal(context.storage.getItem(key), JSON.stringify(newer)); assert.equal(JSON.parse(context.raw()).entries[key], JSON.stringify(newer));
  assert.equal(posts.length, 0); assert.equal(closes.length, 0); assert.equal(changes.length, 0); assert.ok(errors.some(Boolean));
});

test('an older pending model cannot submit when its durable original has changed', async t => {
  const source = await readFile(modelUrl, 'utf8'), parsed = ts.createSourceFile(modelUrl.pathname, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const component = parsed.statements.find(statement => ts.isFunctionDeclaration(statement) && statement.name?.text === 'BatteryModelPicker');
  const handlers = component.body.statements.filter(statement => ts.isFunctionDeclaration(statement) && statement.name?.text === 'saveModel').map(statement => statement.getFullText(parsed));
  const pure = parsed.statements.filter(statement => ts.isFunctionDeclaration(statement) && ['errorMessage', 'verifyModelCreateReceipt'].includes(statement.name?.text)).map(statement => statement.getFullText(parsed).replace(/^\s*export /, '\n'));
  assert.equal(handlers.length, 1); assert.equal(pure.length, 2);
  const original = modelAttempt(), newer = modelAttempt(), key = models.modelCreateStorageKey(actor, 'demo'), context = await fixture(t, { [key]: JSON.stringify(newer) });
  const previousFetch = Object.getOwnPropertyDescriptor(globalThis, 'fetch'), posts = [], releases = [], errors = [];
  Object.defineProperty(globalThis, 'fetch', { configurable: true, value: async (...args) => { posts.push(args); return { ok: true, json: async () => ({}) }; } });
  t.after(() => { if (previousFetch) Object.defineProperty(globalThis, 'fetch', previousFetch); else delete globalThis.fetch; });
  const bindings = { blocked: false, submitting: { current: false }, recovery: { error: '' }, editConflict: false, editAccessLost: false, pending: original, actorAccountId: actor, dataset: 'demo', live: { current: true }, setSaving() {}, onBusyChange() {}, setNotice() {}, setError: value => errors.push(value), setPending: value => releases.push(value), modelCreateStorageKey: models.modelCreateStorageKey, recoverModelCreate: models.recoverModelCreate, acknowledgeWorkflowStorage };
  const keys = Object.keys(bindings), saveModel = new Function(...keys, `${pure.join('\n')}\n${handlers.join('\n')}\nreturn saveModel;`)(...keys.map(key => bindings[key]));
  await saveModel(); await context.storage.flush();
  assert.equal(context.storage.getItem(key), JSON.stringify(newer)); assert.equal(JSON.parse(context.raw()).entries[key], JSON.stringify(newer));
  assert.equal(posts.length, 0); assert.deepEqual(releases, []); assert.ok(errors.some(Boolean));
});
