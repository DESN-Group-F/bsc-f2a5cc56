import assert from 'node:assert/strict';
import { test } from 'node:test';
import { withOperationDeadline } from '../scripts/operation-deadline.mjs';

const options = { timeoutMs: 5000, message: 'The isolated operation timed out.' };

test('a deadline rejects an operation that never settles or honors abort', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  let observedSignal;
  const pending = withOperationDeadline(signal => {
    observedSignal = signal;
    return new Promise(() => {});
  }, options);
  await Promise.resolve();
  context.mock.timers.tick(5000);
  await assert.rejects(pending, /isolated operation timed out/);
  assert.equal(observedSignal.aborted, true);
});

test('external cancellation rejects a pending response body independently of transport cooperation', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const controller = new AbortController();
  let reachedBody = false;
  const pending = withOperationDeadline(async () => {
    await Promise.resolve({ ok: true });
    reachedBody = true;
    return new Promise(() => {});
  }, { ...options, signal: controller.signal });
  await Promise.resolve(); await Promise.resolve();
  assert.equal(reachedBody, true);
  const reason = new Error('Fixture startup was cancelled.');
  controller.abort(reason);
  await assert.rejects(pending, error => error === reason);
});

test('a completed operation removes the external listener and deadline', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const controller = new AbortController();
  let operationSignal;
  const result = await withOperationDeadline(signal => {
    operationSignal = signal;
    return 'complete body';
  }, { ...options, signal: controller.signal });
  assert.equal(result, 'complete body');
  controller.abort(new Error('Later unrelated cancellation'));
  context.mock.timers.tick(5000);
  assert.equal(operationSignal.aborted, false);
});

test('a previously aborted caller never starts the operation', async () => {
  const controller = new AbortController(), reason = new Error('Already cancelled');
  controller.abort(reason);
  let called = false;
  await assert.rejects(withOperationDeadline(() => { called = true; }, { ...options, signal: controller.signal }), error => error === reason);
  assert.equal(called, false);
});

test('operation failures retain the original error and remove the deadline', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const reason = new Error('Original body decoding failure');
  let operationSignal;
  await assert.rejects(withOperationDeadline(signal => {
    operationSignal = signal;
    throw reason;
  }, options), error => error === reason);
  context.mock.timers.tick(5000);
  assert.equal(operationSignal.aborted, false);
});
