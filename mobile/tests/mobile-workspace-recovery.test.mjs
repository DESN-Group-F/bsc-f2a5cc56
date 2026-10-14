import test from 'node:test';
import assert from 'node:assert/strict';
import { createDurableStorage } from '../src/platform/durable-storage.mjs';
import { captureTaskRecordAction, readTaskRecordAction, saveTaskRecordAction, taskRecordActionStorageKey } from '../src/shared/lib/client/task-record-action.js';
import { acknowledgeMessageAction, verifyMessageRead } from '../src/features/workspace/workspace-requests.mjs';

async function fixture(t) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  t.after(() => { if (previous) Object.defineProperty(globalThis, 'window', previous); else delete globalThis.window; });
  let raw = null;
  let rejectAcknowledgement = false;
  const storage = createDurableStorage({ load: async () => raw, save: async value => {
    if (rejectAcknowledgement && Object.keys(JSON.parse(value).entries).length === 0) throw new Error('Controlled acknowledgement failure');
    raw = value;
  } });
  await storage.initialize();
  globalThis.window = { __batteryWorkflowStorage: storage };
  const input = captureTaskRecordAction('demo', 'remove', { id: crypto.randomUUID(), version: 3 });
  saveTaskRecordAction('messages', 'own-account', input);
  await storage.flush();
  const result = { id: input.payload.id, version: 4, requestId: input.requestId, action: 'remove', actorAccountId: 'own-account', dataset: 'demo', removedAt: '2026-10-12T03:00:00.000Z' };
  return { storage, input, result, raw: () => raw, denyAcknowledgement: () => { rejectAcknowledgement = true; } };
}

test('mobile message acknowledgement clears only a validated original result after durable save', async t => {
  const { storage, input, result } = await fixture(t);
  await assert.rejects(acknowledgeMessageAction(storage, 'own-account', input, { ...result, actorAccountId: 'other-account' }), /uncertain/);
  assert.deepEqual(readTaskRecordAction('messages', 'own-account', 'demo').input, input);
  await acknowledgeMessageAction(storage, 'own-account', input, result);
  assert.equal(storage.getItem(taskRecordActionStorageKey('messages', 'own-account', 'demo')), null);
});

test('failed durable message acknowledgement retains exact original request in memory and native file', async t => {
  const context = await fixture(t);
  context.denyAcknowledgement();
  await assert.rejects(acknowledgeMessageAction(context.storage, 'own-account', context.input, context.result), /Controlled acknowledgement failure/);
  const key = taskRecordActionStorageKey('messages', 'own-account', 'demo');
  assert.deepEqual(JSON.parse(JSON.parse(context.raw()).entries[key]).input, context.input);
  const retained = JSON.parse(context.storage.exportRaw()).current.entries;
  assert.deepEqual(JSON.parse(retained[key]).input, context.input);
});

test('message read state requires the specific message and a server timestamp', () => {
  assert.equal(verifyMessageRead({ id: 'message-a', readAt: '2026-10-12T03:00:00.000Z' }, 'message-a'), '2026-10-12T03:00:00.000Z');
  assert.throws(() => verifyMessageRead({ id: 'message-b', readAt: '2026-10-12T03:00:00.000Z' }, 'message-a'), /incomplete/);
  assert.throws(() => verifyMessageRead({ id: 'message-a', readAt: 'not-a-date' }, 'message-a'), /incomplete/);
});
