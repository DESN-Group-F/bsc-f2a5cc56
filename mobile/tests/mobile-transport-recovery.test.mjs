import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createDurableStorage } from '../src/platform/durable-storage.mjs';
import { createNativeRecoveryLocks } from '../src/platform/recovery-locks.mjs';
import { BatteryServiceWeb } from '../plugins/battery-service/web.js';
import { LOCATION_HARDWARE_INGESTION } from '../src/shared/lib/location-observations.js';

const origin = 'http://127.0.0.1:5182';
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

/** Exercise the actual browser runtime with controlled transport and durable driver. */
async function browserRuntime(t, transport, { onSave = () => {} } = {}) {
  const names = ['fetch', 'window', 'location', 'localStorage'];
  const previous = Object.fromEntries(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const persisted = new Map(), windowEvents = new EventTarget();
  globalThis.window = windowEvents;
  globalThis.location = { origin };
  globalThis.localStorage = { getItem: key => persisted.get(key) ?? null, setItem: (key, value) => { onSave(key, value); persisted.set(key, value); } };
  globalThis.fetch = transport;
  t.after(() => { for (const name of names) { if (previous[name]) Object.defineProperty(globalThis, name, previous[name]); else delete globalThis[name]; } });
  const runtime = await import(`../src/platform/runtime.mjs?transportTest=${crypto.randomUUID()}`);
  const { storage } = await runtime.initializeRuntime();
  assert.equal(runtime.native, false, 'This harness is a controlled browser runtime, not native hardware acceptance.');
  return { runtime, storage, persisted, windowEvents };
}

test('actual mobileFetch preserves Request POST body, headers and signal without consuming the original Request', async t => {
  const calls = [], env = await browserRuntime(t, async (path, init) => { calls.push({ path, ...init }); return new Response('{"result":"controlled"}'); });
  const abort = new AbortController(), body = JSON.stringify({ dataset: 'demo', action: 'movement', payload: { requestId: 'captured-id', batteryIds: ['BAT-1'] } });
  const request = new Request(origin + '/api/inventory?dataset=demo', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Reviewed-Request': 'exact-request' }, body, signal: abort.signal });
  env.storage.setItem('battery-scan:STAFF-A:demo:checkout', 'controlled-original-recovery');
  const response = await env.runtime.mobileFetch(request);
  assert.equal(response.status, 200); assert.equal(calls.length, 1);
  assert.equal(calls[0].path, '/api/inventory?dataset=demo'); assert.equal(calls[0].method, 'POST'); assert.equal(calls[0].body, body);
  assert.equal(calls[0].headers.get('content-type'), 'application/json'); assert.equal(calls[0].headers.get('x-reviewed-request'), 'exact-request');
  assert.equal(calls[0].signal, request.signal); assert.equal(calls[0].credentials, 'same-origin'); assert.equal(calls[0].redirect, 'error');
  assert.equal(request.bodyUsed, false); assert.equal(await request.text(), body);
  assert.equal(JSON.parse(env.persisted.get('battery-mobile-business-v1:' + origin)).entries['battery-scan:STAFF-A:demo:checkout'], 'controlled-original-recovery');
});

test('actual mobileFetch uses explicit Request overrides and honors its Request abort signal before transport', async t => {
  const calls = [], env = await browserRuntime(t, async (path, init) => { calls.push({ path, ...init }); return new Response('{}'); });
  const originalAbort = new AbortController(), overrideAbort = new AbortController();
  const request = new Request(origin + '/api/inventory', { method: 'POST', body: 'original-body', headers: { 'X-Original': 'original' }, signal: originalAbort.signal });
  await env.runtime.mobileFetch(request, { body: 'reviewed-override', headers: { 'X-Override': 'override' }, signal: overrideAbort.signal });
  assert.equal(calls[0].body, 'reviewed-override'); assert.equal(calls[0].headers.get('x-original'), null); assert.equal(calls[0].headers.get('x-override'), 'override'); assert.equal(calls[0].signal, overrideAbort.signal);
  originalAbort.abort(); await assert.rejects(env.runtime.mobileFetch(request), error => error.name === 'AbortError'); assert.equal(calls.length, 1);
});

test('POST aborted during durable save is rechecked after flush and never sent', async t => {
  let calls = 0, saves = 0; const abort = new AbortController();
  const env = await browserRuntime(t, async () => { calls++; return new Response('{}'); }, { onSave: () => { saves++; abort.abort(); } });
  env.storage.setItem('battery-location-request:STAFF-A:demo', 'original-captured-request');
  await assert.rejects(env.runtime.mobileFetch('/api/inventory', { method: 'POST', body: '{"requestId":"original-aborted-request"}', signal: abort.signal }), error => error.name === 'AbortError' && /before sending/.test(error.message));
  assert.equal(calls, 0); assert.equal(saves, 1); assert.equal(env.storage.getItem('battery-location-request:STAFF-A:demo'), 'original-captured-request');
});

test('401 session notification preserves original business recovery and other account state', async t => {
  const env = await browserRuntime(t, async () => new Response('{"error":"Session expired"}', { status: 401 }));
  let notifications = 0; env.windowEvents.addEventListener('battery-mobile-session', () => notifications++);
  env.storage.setItem('battery-scan:STAFF-A:demo:checkout', 'original-account-A-request');
  env.storage.setItem('battery-location-request:STAFF-B:live', 'original-account-B-request');
  env.storage.setItem('preference:mobile-feedback', '{"haptics":true,"sounds":false}'); await env.storage.flush();
  const before = structuredClone(env.storage.entries());
  assert.equal((await env.runtime.mobileFetch('/api/inventory?dataset=demo')).status, 401);
  assert.equal(notifications, 1); assert.deepEqual(env.storage.entries(), before);
  await assert.rejects(env.runtime.clearNativeSession(), /unavailable in the browser/); assert.deepEqual(env.storage.entries(), before); assert.equal(notifications, 1);
});

test('location routes are allowlisted in actual JS and both native policies; browser native capabilities stay unavailable', async t => {
  const calls = [], env = await browserRuntime(t, async path => { calls.push(path); return new Response('{}'); });
  for (const path of ['/api/locations?dataset=demo', '/api/location-observations?dataset=demo']) { assert.equal(env.runtime.checkedApiPath(path), path); assert.equal((await env.runtime.mobileFetch(path)).status, 200); }
  assert.deepEqual(calls, ['/api/locations?dataset=demo', '/api/location-observations?dataset=demo']);
  for (const path of ['../plugins/battery-service/android/src/main/java/com/batteryinventory/service/ServicePolicy.java', '../plugins/battery-service/ios/Sources/BatteryServicePlugin/ServicePolicy.swift']) {
    const source = await readFile(new URL(path, import.meta.url), 'utf8');
    assert.match(source, /"\/api\/locations"/); assert.match(source, /"\/api\/location-observations"/);
  }
  assert.equal(LOCATION_HARDWARE_INGESTION, false);
  assert.equal((await window.__batteryTeachingNfc.getAvailability()).available, false);
  await assert.rejects(window.__batteryTeachingNfc.read(), /unavailable in the browser/);
  const adapter = new BatteryServiceWeb();
  assert.deepEqual(await adapter.getConfiguration(), { origin: null });
  await assert.rejects(adapter.request({ path: '/api/locations' }), /unavailable in the browser/);
  await assert.rejects(adapter.loadBusinessData(), /unavailable in the browser/);
});

test('native recovery mutex refuses overlapping original operation without waiting, while distinct records remain independent', async () => {
  const locks = createNativeRecoveryLocks(), gate = deferred(), name = 'battery-location-request:STAFF-A:demo';
  let firstDone = false, overlappingStarted = false;
  const first = locks.request(name, { ifAvailable: true }, async lock => { assert.equal(lock.name, name); assert.equal(lock.mode, 'exclusive'); await gate.promise; firstDone = true; return 'original-result'; });
  const skipped = await locks.request(name, { ifAvailable: true }, lock => { if (!lock) return 'locked'; overlappingStarted = true; return 'replacement-result'; });
  assert.equal(skipped, 'locked'); assert.equal(overlappingStarted, false); assert.equal(firstDone, false);
  assert.equal(await locks.request('battery-location-request:STAFF-B:demo', { ifAvailable: true }, lock => lock ? 'independent' : 'blocked'), 'independent');
  gate.resolve(); assert.equal(await first, 'original-result');
  assert.equal(await locks.request(name, { ifAvailable: true }, lock => lock ? 'released' : 'still-held'), 'released');
});

test('native recovery mutex releases on failed original operation and rejects implicit blocking semantics', async () => {
  const locks = createNativeRecoveryLocks(), name = 'original-operation';
  await assert.rejects(locks.request(name, { ifAvailable: true }, async () => { throw new Error('Controlled request failure'); }), /Controlled request failure/);
  assert.equal(await locks.request(name, { ifAvailable: true }, lock => !!lock), true);
  await assert.rejects(locks.request(name, {}, () => 'not-permitted'), /nonblocking lock/);
});

test('actual location acknowledgement uses atomic durable clear; failed acknowledgement retains the original request', async () => {
  const location = await import('../src/shared/lib/client/location-request.js');
  assert.equal(typeof location.acknowledgeLocationAttempt, 'function', 'The shared mobile graph must be synchronized before this acceptance check.');
  const attempt = location.captureLocationAttempt('STAFF-A', 'demo', { kind: 'capture', payload: { requestId: '11111111-1111-4111-8111-111111111111', source: 'demo_room_scan', batteryId: 'BAT-1', tagId: 'tag:BAT-1', expectedBatteryVersion: 3, capturedAt: '2026-10-12T03:00:00.000Z', candidates: [] } });
  const key = location.locationRequestStorageKey('STAFF-A', 'demo'); let raw = null, denyClear = false;
  const storage = createDurableStorage({ load: async () => raw, save: async value => { if (denyClear && !Object.hasOwn(JSON.parse(value).entries, key)) throw new Error('Controlled location acknowledgement failure'); raw = value; } });
  await storage.initialize(); location.persistLocationAttempt(attempt, storage); await storage.flush(); denyClear = true;
  await assert.rejects(location.acknowledgeLocationAttempt(attempt, storage), /Controlled location acknowledgement failure/);
  assert.deepEqual(JSON.parse(JSON.parse(raw).entries[key]), attempt);
  assert.deepEqual(JSON.parse(JSON.parse(storage.exportRaw()).current.entries[key]), attempt);
  denyClear = false; await storage.retryPersistence();
  assert.deepEqual(location.recoverLocationAttempt(storage.getItem(key), 'STAFF-A', 'demo'), attempt);
  await location.acknowledgeLocationAttempt(attempt, storage); assert.equal(storage.getItem(key), null); assert.equal(Object.hasOwn(JSON.parse(raw).entries, key), false);
});

test('location acknowledgement never removes a different original request or another account recovery', async () => {
  const location = await import('../src/shared/lib/client/location-request.js');
  const original = location.captureLocationAttempt('STAFF-A', 'demo', { kind: 'capture', payload: { requestId: '11111111-1111-4111-8111-111111111111', source: 'demo_room_scan', batteryId: 'BAT-1', tagId: 'tag:BAT-1', expectedBatteryVersion: 3, capturedAt: '2026-10-12T03:00:00.000Z', candidates: [] } });
  let raw = null; const storage = createDurableStorage({ load: async () => raw, save: async value => { raw = value; } }); await storage.initialize();
  location.persistLocationAttempt(original, storage); storage.setItem('battery-location-request:STAFF-B:demo', 'separate-account-original'); await storage.flush();
  await assert.rejects(location.acknowledgeLocationAttempt({ ...original, payload: { ...original.payload, requestId: '22222222-2222-4222-8222-222222222222' } }, storage), /original location request changed/);
  const retained = JSON.parse(storage.exportRaw()).current.entries;
  assert.deepEqual(JSON.parse(retained[location.locationRequestStorageKey('STAFF-A', 'demo')]), original); assert.equal(retained['battery-location-request:STAFF-B:demo'], 'separate-account-original');
});
