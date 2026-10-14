import test from 'node:test';
import assert from 'node:assert/strict';
import { createDurableStorage } from '../src/platform/durable-storage.mjs';
import { acknowledgeTaskCompletion, captureTaskCompletion, readTaskCompletion, saveTaskCompletion, taskCompletionStorageKey, verifyTaskCompletionResult } from '../src/features/workspace/task-completion.mjs';

const cycle = () => ({ id: crypto.randomUUID(), version: 4, title: 'Recorded review', category: 'custom', status: 'open', canComplete: true, planRemoved: false, dueOn: '2026-10-12', description: 'Review agreed records.', basis: 'Confirmed local procedure', scopeNote: 'Shared inventory', targetKind: 'inventory', targetRef: null, targetSnapshot: {}, batteryIds: [], assigneeIds: ['own-account'], currentAssigneeIds: ['own-account'] });
const result = attempt => ({ id: attempt.input.payload.cycleId, version: attempt.input.payload.expectedVersion + 1, status: 'completed', nextDueOn: null, skippedPeriods: 0, calculationRule: 'Selected recorded due date' });
async function storageFixture() {
  let raw = null;
  let rejectSave = false;
  let rejectAcknowledgement = false;
  const storage = createDurableStorage({ load: async () => raw, save: async value => {
    if (rejectSave || rejectAcknowledgement && Object.keys(JSON.parse(value).entries).length === 0) throw new Error('Controlled durable denial');
    raw = value;
  } });
  await storage.initialize();
  return { storage, raw: () => raw, failSave: () => { rejectSave = true; }, failAcknowledgement: () => { rejectAcknowledgement = true; } };
}

test('native task completion capture preserves account, inventory, exact reviewed cycle version and notes', async () => {
  const { storage } = await storageFixture();
  const reviewed = cycle();
  const attempt = captureTaskCompletion('own-account', 'demo', reviewed, 'Original notes');
  reviewed.version = 5;
  await saveTaskCompletion(storage, attempt);
  const restored = readTaskCompletion(storage, 'own-account', 'demo');
  assert.deepEqual(restored, attempt);
  assert.equal(restored.input.payload.expectedVersion, 4);
  assert.equal(restored.input.payload.notes, 'Original notes');
  assert.equal(readTaskCompletion(storage, 'another-account', 'demo'), null);
  assert.equal(readTaskCompletion(storage, 'own-account', 'live'), null);
  await assert.rejects(saveTaskCompletion(storage, captureTaskCompletion('own-account', 'demo', cycle(), 'Replacement notes')), /original task completion/);
});

test('task completion is unavailable when preservation fails and the request was never saved', async () => {
  const context = await storageFixture();
  context.failSave();
  const attempt = captureTaskCompletion('own-account', 'demo', cycle(), 'Retain before sending');
  await assert.rejects(saveTaskCompletion(context.storage, attempt), /Controlled durable denial/);
  assert.equal(context.raw(), null);
  assert.deepEqual(JSON.parse(context.storage.exportRaw()).current.entries, {});
});

test('confirmed task receipt verifies exact cycle and version before durable acknowledgement', async () => {
  const { storage } = await storageFixture();
  const attempt = captureTaskCompletion('own-account', 'demo', cycle(), 'Actual notes');
  await saveTaskCompletion(storage, attempt);
  assert.throws(() => verifyTaskCompletionResult({ ...result(attempt), id: crypto.randomUUID() }, attempt), /uncertain/);
  await assert.rejects(acknowledgeTaskCompletion(storage, attempt, { ...result(attempt), version: 99 }), /uncertain/);
  assert.deepEqual(readTaskCompletion(storage, 'own-account', 'demo'), attempt);
  await acknowledgeTaskCompletion(storage, attempt, result(attempt));
  assert.equal(readTaskCompletion(storage, 'own-account', 'demo'), null);
});

test('failed task receipt acknowledgement retains the original capture after process restart', async () => {
  const context = await storageFixture();
  const attempt = captureTaskCompletion('own-account', 'live', cycle(), 'Exact notes across restart');
  await saveTaskCompletion(context.storage, attempt);
  context.failAcknowledgement();
  await assert.rejects(acknowledgeTaskCompletion(context.storage, attempt, result(attempt)), /Controlled durable denial/);
  const restarted = createDurableStorage({ load: async () => context.raw(), save: async () => {} });
  await restarted.initialize();
  assert.deepEqual(readTaskCompletion(restarted, 'own-account', 'live'), attempt);
});

test('malformed and mismatched retained completion is rejected without overwriting the raw evidence', async () => {
  for (const raw of ['{broken', JSON.stringify({ schemaVersion: 1, actorAccountId: 'other-account' }), JSON.stringify({ schemaVersion: 2 })]) {
    const context = await storageFixture();
    const key = taskCompletionStorageKey('own-account', 'demo');
    context.storage.setItem(key, raw); await context.storage.flush();
    assert.throws(() => readTaskCompletion(context.storage, 'own-account', 'demo'), /unreadable/);
    assert.equal(context.storage.getItem(key), raw);
    await assert.rejects(saveTaskCompletion(context.storage, captureTaskCompletion('own-account', 'demo', cycle(), 'New input')), /unreadable/);
    assert.equal(context.storage.getItem(key), raw);
  }
  const context = await storageFixture();
  const key = taskCompletionStorageKey('own-account', 'demo');
  const wrongActor = captureTaskCompletion('other-account', 'demo', cycle(), 'A different account');
  context.storage.setItem(key, JSON.stringify(wrongActor)); await context.storage.flush();
  assert.throws(() => readTaskCompletion(context.storage, 'own-account', 'demo'), /another account/);
  assert.equal(context.storage.getItem(key), JSON.stringify(wrongActor));
});
