import test from 'node:test';
import assert from 'node:assert/strict';
import { createNativeHapticAdapter } from '../src/platform/runtime.mjs';
import { playScanFeedback, readFeedbackPreferences } from '../src/features/scan/feedback.mjs';

test('iOS maps existing feedback strengths to UIKit styles and honors disabled preferences', t => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const calls = [];
  const haptic = createNativeHapticAdapter({ platform: 'ios', service: { haptic: async options => { calls.push(options); } }, register: () => { throw new Error('iOS must not register Android BatteryUi'); } });
  globalThis.window = { __batteryMobileHaptic: haptic };
  t.after(() => { if (previous) Object.defineProperty(globalThis, 'window', previous); else delete globalThis.window; });
  for (const strength of ['light', 'medium']) {
    const preferences = readFeedbackPreferences({ getItem: () => JSON.stringify({ haptics: true, sounds: false, strength }) });
    playScanFeedback({ type: 'accepted' }, preferences, true);
  }
  assert.deepEqual(calls, [{ strength: 'light' }, { strength: 'medium' }]);
  playScanFeedback({ type: 'accepted' }, { haptics: false, sounds: false, strength: 'medium' }, true);
  playScanFeedback({ type: 'paused' }, { haptics: true, sounds: false, strength: 'medium' }, true);
  assert.equal(calls.length, 2, 'Disabled and routine states never request native feedback');
  for (const value of [0, -1, NaN, Infinity, undefined, '25']) haptic(value);
  assert.equal(calls.length, 2, 'Invalid or disabled duration inputs cannot trigger a native effect');
});

test('Android keeps BatteryUi duration contract and unsupported platforms have no native adapter', async () => {
  const registrations = [], calls = [];
  const haptic = createNativeHapticAdapter({ platform: 'android', register: name => { registrations.push(name); return { haptic: async options => calls.push(options) }; } });
  await haptic(12);
  await haptic(25);
  assert.deepEqual(registrations, ['BatteryUi']);
  assert.deepEqual(calls, [{ durationMs: 12 }, { durationMs: 25 }]);
  assert.equal(createNativeHapticAdapter({ platform: 'web' }), undefined);
});

test('native feedback rejection does not interrupt the existing textual scan outcome', async t => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  globalThis.window = { __batteryMobileHaptic: createNativeHapticAdapter({ platform: 'ios', service: { haptic: async () => { throw new Error('Controlled unavailable native effect'); } } }) };
  t.after(() => { if (previous) Object.defineProperty(globalThis, 'window', previous); else delete globalThis.window; });
  assert.doesNotThrow(() => playScanFeedback({ type: 'failure' }, { haptics: true, sounds: false, strength: 'light' }, true));
  await new Promise(resolve => setImmediate(resolve));
});
