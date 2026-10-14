import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDurableStorage } from '../src/platform/durable-storage.mjs';
import { accountHasDeviceWork } from '../src/app/recovery.mjs';
import { clearPhoneFormDraft, phoneFormDraftKey, readPhoneFormDraft, savePhoneFormDraft } from '../src/app/phone-form-draft.mjs';

const scope = (kind = 'profile', recordId = 'native-account', additions = {}) => ({ accountId: 'native-account', dataset: 'demo', kind, recordId, ...additions });
const profile = () => ({ expectedVersion: 4, baseline: { displayName: 'Original name', email: '', role: 'staff', active: true, defaultDataset: 'demo', version: 4 }, displayName: 'Unsubmitted name', email: '', defaultDataset: 'live' });
async function fixture() {
  let raw = null, fail = false;
  const storage = createDurableStorage({ load: async () => raw, save: async value => { if (fail) throw new Error('Controlled native save failure'); raw = value; } });
  await storage.initialize();
  return { storage, raw: () => raw, fail: value => { fail = value; }, restart: async () => { const next = createDurableStorage({ load: async () => raw, save: async value => { raw = value; } }); await next.initialize(); return next; } };
}

test('profile and task-note drafts restore after a new native storage instance with original versions', async () => {
  const context = await fixture(), cycleId = crypto.randomUUID();
  const notes = { cycleId, expectedVersion: 7, notes: 'Actual findings, not yet submitted' };
  await savePhoneFormDraft(context.storage, scope(), profile());
  await savePhoneFormDraft(context.storage, scope('task-notes', cycleId), notes);
  const restarted = await context.restart();
  assert.deepEqual(readPhoneFormDraft(restarted, scope()).data, profile());
  assert.deepEqual(readPhoneFormDraft(restarted, scope('task-notes', cycleId)).data, notes);
  assert.equal(restarted.hasPending(), false);
  assert.equal(accountHasDeviceWork(restarted, 'native-account'), false);
  assert.equal(Object.keys(restarted.entries()).some(key => !key.startsWith('preference:mobile-form-draft:')), false);
});

test('draft scope and reviewed version cannot be replaced by another account, inventory or record', async () => {
  const context = await fixture();
  await savePhoneFormDraft(context.storage, scope(), profile());
  const key = phoneFormDraftKey(scope()), original = context.storage.getItem(key);
  assert.equal(readPhoneFormDraft(context.storage, scope('profile', 'other-account', { accountId: 'other-account' })), null);
  assert.equal(readPhoneFormDraft(context.storage, scope('profile', 'native-account', { dataset: 'live' })), null);
  assert.throws(() => savePhoneFormDraft(context.storage, scope(), { ...profile(), expectedVersion: 5 }), /reviewed version/);
  assert.throws(() => savePhoneFormDraft(context.storage, scope('profile', 'other-account'), profile()), /original record context/);
  context.storage.setItem(key, original.replace('"accountId":"native-account"', '"accountId":"other-account"')); await context.storage.flush();
  const mismatched = context.storage.getItem(key);
  assert.throws(() => readPhoneFormDraft(context.storage, scope()), /unreadable/);
  await assert.rejects(savePhoneFormDraft(context.storage, scope(), profile()), /unreadable/);
  assert.equal(context.storage.getItem(key), mismatched);
});

test('strict form allowlists reject credentials, captured requests and oversized input before storage', async () => {
  const context = await fixture();
  for (const field of ['password', 'currentPassword', 'token', 'sessionToken', 'requestId']) assert.throws(() => savePhoneFormDraft(context.storage, scope(), { ...profile(), [field]: 'Sensitive value' }));
  assert.throws(() => savePhoneFormDraft(context.storage, scope(), { ...profile(), displayName: 'x'.repeat(121) }));
  const cycleId = crypto.randomUUID();
  assert.throws(() => savePhoneFormDraft(context.storage, scope('task-notes', cycleId), { cycleId, expectedVersion: 1, notes: 'x'.repeat(2001) }));
  assert.equal(context.raw(), null);
});

test('native save failure remains visible and latest input is recoverable after explicit persistence retry', async () => {
  const context = await fixture();
  await savePhoneFormDraft(context.storage, scope(), profile());
  const previous = context.raw(), changed = { ...profile(), displayName: 'Latest unsaved edit' };
  context.fail(true);
  await assert.rejects(savePhoneFormDraft(context.storage, scope(), changed), /Controlled native save failure/);
  assert.equal(context.raw(), previous);
  const exported = JSON.parse(context.storage.exportRaw());
  assert.equal(exported.persistenceError, 'Controlled native save failure');
  assert.equal(JSON.parse(exported.current.entries[phoneFormDraftKey(scope())]).data.displayName, 'Latest unsaved edit');
  context.fail(false); await context.storage.retryPersistence();
  assert.deepEqual(readPhoneFormDraft(await context.restart(), scope()).data, changed);
});

test('explicit clear is durable and refuses to erase a newer edit', async () => {
  const context = await fixture();
  await savePhoneFormDraft(context.storage, scope(), profile());
  const newer = { ...profile(), email: 'new@example.test' };
  await savePhoneFormDraft(context.storage, scope(), newer);
  await assert.rejects(clearPhoneFormDraft(context.storage, scope(), profile()), /newer form draft/);
  assert.deepEqual(readPhoneFormDraft(context.storage, scope()).data, newer);
  context.fail(true);
  await assert.rejects(clearPhoneFormDraft(context.storage, scope(), newer), /Controlled native save failure/);
  assert.deepEqual(readPhoneFormDraft(await context.restart(), scope()).data, newer);
  context.fail(false); await context.storage.retryPersistence();
  await clearPhoneFormDraft(context.storage, scope(), newer);
  assert.equal(readPhoneFormDraft(await context.restart(), scope()), null);
});

test('rapid field edits serialize to the latest complete draft and intake keeps only allowed preparation', async () => {
  const context = await fixture();
  await Promise.all([savePhoneFormDraft(context.storage, scope(), profile()), savePhoneFormDraft(context.storage, scope(), { ...profile(), displayName: 'Latest name' })]);
  assert.equal(readPhoneFormDraft(context.storage, scope()).data.displayName, 'Latest name');
  const intake = { values: { name: '', model: '', chemistry: '', capacityMah: '', voltage: '', ownerId: 'native-owner', homeBuildingId: 'J18', homeRoomId: '', manufacturedOn: '', firstUsedOn: '' }, firstUseMode: 'unknown', modelSelection: null };
  await savePhoneFormDraft(context.storage, scope('intake-common', 'common'), intake);
  assert.deepEqual(readPhoneFormDraft(await context.restart(), scope('intake-common', 'common')).data, intake);
  assert.throws(() => savePhoneFormDraft(context.storage, scope('intake-common', 'common'), { ...intake, attempt: { requestId: crypto.randomUUID() } }));
});
