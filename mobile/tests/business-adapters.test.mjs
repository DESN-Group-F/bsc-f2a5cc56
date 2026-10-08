import test from 'node:test';
import assert from 'node:assert/strict';
import { createDurableStorage, browserStorageDriver } from '../src/platform/durable-storage.mjs';
import { NFC_PREFIX, readNfcProposal, recoverNfcEvidence } from '../src/business/nfc-controller.mjs';
import { BatteryNfcWeb } from '../plugins/battery-nfc/web.js';

const validResult = () => ({ uidHex: '00:04:AB:00', technology: 'Controlled adapter NFC-A output', ndefStatus: 'readWrite', capacityBytes: 144, records: [], observedAt: '2026-10-05T02:00:00.000Z' });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
async function memoryStore(initial = null, onSave = () => {}) {
  let raw = initial;
  const storage = createDurableStorage({ load: async () => raw, save: async value => { await onSave(value); raw = value; } });
  await storage.initialize(); return { storage, saved: () => raw };
}

test('controlled durable storage acknowledges only serial completed saves before an operation may proceed', async () => {
  const gate = deferred(), stored = [];
  const storage = createDurableStorage({ load: async () => null, save: async raw => { stored.push(raw); if (stored.length === 1) await gate.promise; } });
  assert.throws(() => storage.getItem('request'), /not ready/);
  await storage.initialize();
  storage.setItem('request', 'first-captured-request');
  storage.setItem('draft', 'remaining-queue');
  let flushed = false; const operation = storage.flush().then(() => { flushed = true; });
  await tick(); assert.equal(flushed, false); assert.equal(stored.length, 1);
  gate.resolve(); await operation;
  assert.equal(stored.length, 2);
  assert.deepEqual(JSON.parse(stored[1]).entries, { request: 'first-captured-request', draft: 'remaining-queue' });
});

test('controlled corrupt recovery envelopes remain untouched, including a refused persistence retry', async () => {
  for (const raw of ['', '{broken', 'null', JSON.stringify({ schemaVersion: 1, entries: 'not-an-entry-map' }), JSON.stringify({ schemaVersion: 1, entries: 42 }), JSON.stringify({ schemaVersion: 1, entries: [] }), JSON.stringify({ schemaVersion: 2, entries: {} })]) {
    const saves = [];
    const storage = createDurableStorage({ load: async () => raw, save: async value => saves.push(value) });
    await assert.rejects(storage.initialize());
    assert.throws(() => storage.setItem('request', 'replacement'));
    await assert.rejects(storage.retryPersistence());
    assert.equal(saves.length, 0);
    assert.equal(JSON.parse(storage.exportRaw()).savedRaw, raw);
  }
});

test('controlled persistence failure blocks new operations and retains the exact request for explicit repair', async () => {
  let denied = true; const saved = [];
  const storage = createDurableStorage({ load: async () => null, save: async raw => { if (denied) throw new Error('Controlled durable write failure'); saved.push(raw); } });
  await storage.initialize();
  const captured = { requestId: 'original-request', payload: { batteryIds: ['BAT-ONE'], reviewedLoan: 'original-loan' } };
  storage.setItem('movement', JSON.stringify(captured));
  await assert.rejects(storage.flush(), /Controlled durable write failure/);
  assert.throws(() => storage.setItem('replacement', '{}'), /Controlled durable write failure/);
  assert.deepEqual(JSON.parse(JSON.parse(storage.exportRaw()).current.entries.movement), captured);
  denied = false; await storage.retryPersistence(); await storage.flush();
  assert.deepEqual(JSON.parse(storage.getItem('movement')), captured);
  assert.equal(JSON.parse(storage.exportRaw()).savedRaw, saved[0]);
});

test('controlled restart retains the original pending request independently of later queue edits', async () => {
  const { storage, saved } = await memoryStore();
  const captured = { requestId: 'first-attempt', kind: 'return', batteryIds: ['BAT-A'], expectedLoans: [{ batteryId: 'BAT-A', loanId: 'reviewed-loan' }] };
  storage.setItem('pending', JSON.stringify(captured));
  storage.setItem('queue', JSON.stringify(['BAT-A', 'BAT-B'])); await storage.flush();
  const restarted = createDurableStorage({ load: async () => saved(), save: async () => {} }); await restarted.initialize();
  restarted.setItem('queue', JSON.stringify(['BAT-A', 'BAT-B', 'BAT-C'])); await restarted.flush();
  assert.deepEqual(JSON.parse(restarted.getItem('pending')), captured);
  assert.deepEqual(JSON.parse(restarted.getItem('queue')), ['BAT-A', 'BAT-B', 'BAT-C']);
  assert.equal(restarted.hasPending(), true);
});

test('controlled NFC adapter starts only after the pending evidence is durable, with UID bytes preserved', async () => {
  const gate = deferred(); let savedRaw = null, reads = 0;
  const storage = createDurableStorage({ load: async () => null, save: async raw => { if (!savedRaw) await gate.promise; savedRaw = raw; } }); await storage.initialize();
  const adapter = { read: async () => { reads++; const report = JSON.parse(JSON.parse(savedRaw).entries[NFC_PREFIX + 'controlled-read']); assert.equal(report.outcome, 'pending'); assert.equal(report.result, null); return validResult(); } };
  const reading = readNfcProposal({ adapter, storage, id: 'controlled-read', now: () => '2026-10-05T02:00:00.000Z' });
  await tick(); assert.equal(reads, 0); gate.resolve();
  const proposal = await reading;
  assert.equal(reads, 1); assert.equal(proposal.tagId, 'nfc:uid:0004AB00');
  assert.equal(proposal.report.result.uidHex, '0004AB00');
  assert.equal(JSON.parse(JSON.parse(savedRaw).entries[NFC_PREFIX + 'controlled-read']).outcome, 'read');
  // The injected adapter is a controlled test double, not physical phone evidence.
});

test('controlled failed evidence persistence blocks the NFC reader and never yields an operator proposal', async () => {
  let reads = 0;
  const storage = createDurableStorage({ load: async () => null, save: async () => { throw new Error('Controlled save denial'); } }); await storage.initialize();
  await assert.rejects(readNfcProposal({ adapter: { read: async () => { reads++; return validResult(); } }, storage, id: 'blocked-read' }), /Controlled save denial/);
  assert.equal(reads, 0);
  const exported = JSON.parse(storage.exportRaw());
  assert.equal(JSON.parse(exported.current.entries[NFC_PREFIX + 'blocked-read']).outcome, 'pending');
});

test('controlled result-save failure preserves its evidence but never returns a confirmed proposal', async () => {
  let writes = 0;
  const storage = createDurableStorage({ load: async () => null, save: async () => { if (++writes === 2) throw new Error('Controlled result persistence denial'); } }); await storage.initialize();
  await assert.rejects(readNfcProposal({ adapter: { read: async () => validResult() }, storage, id: 'unconfirmed-result' }), /Controlled result persistence denial/);
  const report = JSON.parse(JSON.parse(storage.exportRaw()).current.entries[NFC_PREFIX + 'unconfirmed-result']);
  assert.equal(report.outcome, 'read'); assert.equal(report.result.uidHex, '0004AB00');
});

test('controlled cancellation and malformed adapter results retain unsuccessful attempts', async () => {
  const { storage } = await memoryStore();
  await assert.rejects(readNfcProposal({ adapter: { read: async () => { throw Object.assign(new Error('Controlled operator cancellation'), { code: 'CANCELLED' }); } }, storage, id: 'cancelled' }), /Controlled operator cancellation/);
  assert.equal(JSON.parse(storage.getItem(NFC_PREFIX + 'cancelled')).outcome, 'cancelled');
  await assert.rejects(readNfcProposal({ adapter: { read: async () => ({ ...validResult(), uidHex: 'bad' }) }, storage, id: 'malformed' }));
  assert.equal(JSON.parse(storage.getItem(NFC_PREFIX + 'malformed')).outcome, 'failed');
  assert.equal(JSON.parse(storage.getItem(NFC_PREFIX + 'malformed')).result, null);
});

test('controlled NFC sessions cannot overlap and late completion cannot invent another attempt', async () => {
  const { storage } = await memoryStore(), gate = deferred();
  const first = readNfcProposal({ adapter: { read: async () => gate.promise }, storage, id: 'first-read' });
  await tick();
  await assert.rejects(readNfcProposal({ adapter: { read: async () => validResult() }, storage, id: 'second-read' }), /Finish the current NFC read/);
  assert.equal(storage.getItem(NFC_PREFIX + 'second-read'), null);
  gate.resolve(validResult()); await first;
  const second = await readNfcProposal({ adapter: { read: async () => validResult() }, storage, id: 'second-read' });
  assert.equal(second.report.id, 'second-read');
});

test('controlled restart marks unfinished NFC evidence interrupted without fabricating a UID', async () => {
  const pending = { id: 'interrupted-read', source: 'native-nfc-reader', startedAt: '2026-10-05T02:00:00.000Z', endedAt: null, outcome: 'pending', result: null, error: null };
  const { storage, saved } = await memoryStore(JSON.stringify({ schemaVersion: 1, entries: { [NFC_PREFIX + pending.id]: JSON.stringify(pending) } }));
  recoverNfcEvidence(storage); await storage.flush();
  const recovered = JSON.parse(JSON.parse(saved()).entries[NFC_PREFIX + pending.id]);
  assert.equal(recovered.outcome, 'interrupted'); assert.equal(recovered.result, null); assert.equal(recovered.endedAt, null); assert.equal(recovered.error.code, 'APP_INTERRUPTED');
  assert.equal(storage.hasPending(), false);
});

test('actual web NFC adapter remains unavailable and cannot fabricate a browser hardware success', async () => {
  const adapter = new BatteryNfcWeb();
  assert.deepEqual(await adapter.getAvailability(), { available: false, enabled: false, platform: 'web', reason: 'NFC diagnostics require the installed native application on a compatible device.' });
  const { storage } = await memoryStore();
  await assert.rejects(readNfcProposal({ adapter, storage, id: 'web-unavailable' }), /unavailable in the browser/);
  const report = JSON.parse(storage.getItem(NFC_PREFIX + 'web-unavailable'));
  assert.equal(report.outcome, 'failed'); assert.equal(report.result, null);
});

test('controlled browser driver checks durable readback instead of trusting a discarded write', async () => {
  const driver = browserStorageDriver({ getItem: () => null, setItem: () => {} }, 'controlled-preview');
  await assert.rejects(driver.save('{"schemaVersion":1,"entries":{}}'), /was not saved/);
});

test('controlled atomic receipt acknowledgement preserves its pending request when the clear cannot be saved', async () => {
  let denied = true, raw = null;
  const storage = createDurableStorage({ load: async () => raw, save: async value => { const candidate = JSON.parse(value); if (denied && candidate.entries['preference:confirmed-receipt']) throw new Error('Controlled atomic acknowledgement denial'); raw = value; } });
  await storage.initialize(); storage.setItem('pending', 'original-captured-request'); storage.setItem('draft', 'original-reviewed-details'); await storage.flush();
  await assert.rejects(storage.transact(entries => { entries['preference:confirmed-receipt'] = 'verified-server-result'; delete entries.pending; delete entries.draft; }), /Controlled atomic acknowledgement denial/);
  const failed = JSON.parse(storage.exportRaw());
  assert.deepEqual(failed.current.entries, { pending: 'original-captured-request', draft: 'original-reviewed-details' });
  assert.deepEqual(JSON.parse(raw).entries, failed.current.entries);
  denied = false; await storage.retryPersistence();
  assert.equal(storage.getItem('pending'), 'original-captured-request');
  await storage.transact(entries => { entries['preference:confirmed-receipt'] = 'verified-server-result'; delete entries.pending; delete entries.draft; });
  assert.deepEqual(storage.entries(), { 'preference:confirmed-receipt': 'verified-server-result' });
  assert.deepEqual(JSON.parse(raw).entries, storage.entries());
});

test('controlled simultaneous atomic acknowledgements are serialized without discarding either update', async () => {
  const gate = deferred(), attempts = [];
  const storage = createDurableStorage({ load: async () => null, save: async raw => { attempts.push(raw); const entries = JSON.parse(raw).entries; if (entries.first === 'first-acknowledgement' && !entries.second) await gate.promise; } });
  await storage.initialize(); storage.setItem('seed', 'kept'); await storage.flush();
  const first = storage.transact(entries => { entries.first = 'first-acknowledgement'; });
  const second = storage.transact(entries => { entries.second = 'second-acknowledgement'; });
  await tick(); const writesBeforeFirstCompletion = attempts.length;
  gate.resolve(); await Promise.all([first, second]); await storage.flush();
  assert.equal(writesBeforeFirstCompletion, 2, 'Second acknowledgement must not write before the first one settles.');
  assert.deepEqual(storage.entries(), { seed: 'kept', first: 'first-acknowledgement', second: 'second-acknowledgement' });
  assert.deepEqual(JSON.parse(attempts.at(-1)).entries, storage.entries());
});

test('controlled draft edits during acknowledgement are preserved or explicitly refused, never silently lost', async () => {
  const gate = deferred(); let raw = null;
  const storage = createDurableStorage({ load: async () => null, save: async value => { if (JSON.parse(value).entries['preference:receipt']) await gate.promise; raw = value; } });
  await storage.initialize(); storage.setItem('pending', 'captured-request'); await storage.flush();
  const clearing = storage.transact(entries => { delete entries.pending; entries['preference:receipt'] = 'verified'; });
  await tick(); let explicitRefusal = null;
  try { storage.setItem('new-draft', 'later-operator-input'); } catch (error) { explicitRefusal = error; }
  gate.resolve(); await clearing; await storage.flush();
  assert.equal(storage.getItem('pending'), null);
  if (explicitRefusal) assert.ok(explicitRefusal instanceof Error);
  else assert.equal(storage.getItem('new-draft'), 'later-operator-input');
  assert.deepEqual(JSON.parse(raw).entries, storage.entries());
});

async function browserRuntime(t, transport, { denyWrites = false } = {}) {
  const names = ['fetch', 'window', 'location', 'localStorage'];
  const previous = Object.fromEntries(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const persisted = new Map();
  globalThis.window = {};
  globalThis.location = { origin: 'http://127.0.0.1:5182' };
  globalThis.localStorage = { getItem: key => persisted.get(key) ?? null, setItem: (key, value) => { if (denyWrites) throw new Error('Controlled browser persistence denial'); persisted.set(key, value); } };
  globalThis.fetch = transport;
  t.after(() => { for (const name of names) { if (previous[name]) Object.defineProperty(globalThis, name, previous[name]); else delete globalThis[name]; } });
  const runtime = await import(`../src/platform/runtime.mjs?controlled=${crypto.randomUUID()}`);
  const initialized = await runtime.initializeRuntime();
  return { runtime, storage: initialized.storage, persisted };
}

test('controlled actual browser transport saves before POST and preserves exact retry after response loss', async t => {
  const calls = [], captured = { requestId: 'original-mobile-request', kind: 'return', batteryIds: ['BAT-ONE'], expectedLoans: [{ batteryId: 'BAT-ONE', loanId: 'original-reviewed-loan' }] };
  let persisted;
  const context = await browserRuntime(t, async (path, init) => {
    const saved = JSON.parse(persisted.get('battery-mobile-business-v1:http://127.0.0.1:5182'));
    assert.deepEqual(JSON.parse(saved.entries.pending), captured, 'The original request must already be durable at transport entry.');
    calls.push({ path, body: init.body, credentials: init.credentials });
    if (calls.length === 1) throw new Error('Controlled response loss');
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  });
  persisted = context.persisted;
  context.storage.setItem('pending', JSON.stringify(captured));
  const send = () => fetch('/api/inventory', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dataset: 'demo', action: 'movement', payload: JSON.parse(context.storage.getItem('pending')) }) });
  await assert.rejects(send(), /Controlled response loss/);
  context.storage.setItem('remaining-queue', JSON.stringify(['BAT-ONE', 'BAT-TWO']));
  assert.equal((await send()).status, 200);
  assert.equal(calls.length, 2); assert.equal(calls[0].body, calls[1].body);
  assert.equal(calls[0].credentials, 'same-origin');
  assert.deepEqual(JSON.parse(context.storage.getItem('pending')), captured);
});

test('controlled actual browser transport refuses business POST when durable storage fails', async t => {
  let calls = 0;
  const { storage } = await browserRuntime(t, async () => { calls++; return new Response('{}'); }, { denyWrites: true });
  storage.setItem('pending', 'captured-before-send');
  await assert.rejects(fetch('/api/inventory', { method: 'POST', body: '{}' }), /Controlled browser persistence denial/);
  assert.equal(calls, 0);
  assert.equal(JSON.parse(storage.exportRaw()).current.entries.pending, 'captured-before-send');
});

test('controlled actual browser transport cannot request a foreign or unlisted API origin', async t => {
  let calls = 0;
  const { runtime } = await browserRuntime(t, async () => { calls++; return new Response('{}'); });
  for (const target of ['https://foreign.example/api/inventory', '/api/unknown', '/mobile-preview/setup', '/api/session#fragment']) await assert.rejects(fetch(target));
  assert.equal(calls, 0);
  assert.equal(runtime.checkedApiPath('/api/inventory?dataset=demo'), '/api/inventory?dataset=demo');
});
