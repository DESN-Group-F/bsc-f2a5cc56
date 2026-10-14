import test from 'node:test';
import assert from 'node:assert/strict';
import { gunzipSync } from 'node:zlib';
import { createDurableStorage } from '../src/platform/durable-storage.mjs';
import { BUSINESS_DATA_CODEC, createNativeBusinessDataDriver, createServiceScopeController } from '../src/platform/native-business-data.mjs';

const gate = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const rawOf = packet => packet.codec ? gunzipSync(Buffer.from(packet.data, 'base64')).toString('utf8') : packet.data;
const raw = JSON.stringify({ schemaVersion: 1, entries: { captured: 'Exact request é 中文 😀 \\"\n'.repeat(200) } }, null, 2);
const waitFor = async condition => {
  // Compression completion can outlast many immediate callbacks under load.
  // Bound elapsed time while still requiring the exact observable checkpoint.
  const deadline = performance.now() + 5_000;
  while (!condition() && performance.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5));
  assert.ok(condition(), 'Controlled async work reached its checkpoint.');
};
function fixture({ Encoder = CompressionStream, platform = 'android', configuration = { origin: 'https://old.example', businessDataCodecs: [BUSINESS_DATA_CODEC] } } = {}) {
  const calls = [], files = new Map(); let saveWork = async () => {}, configureWork = async () => {}, scope = configuration.origin;
  const service = {
    async getConfiguration() { return { ...configuration, origin: scope }; },
    async loadBusinessData() { return { data: files.get(scope) ?? null }; },
    async saveBusinessData(packet) { const target = scope; calls.push({ kind: 'save', packet, scope: target }); await saveWork(packet); files.set(target, rawOf(packet)); },
    async configure({ origin }) { calls.push({ kind: 'configure', origin }); await configureWork(origin); scope = origin; },
  };
  const driver = createNativeBusinessDataDriver({ service, platform, configuration, Encoder });
  return { service, driver, calls, files, configuration, setSave(work) { saveWork = work; }, setConfigure(work) { configureWork = work; }, setScope(value) { scope = value; } };
}

test('negotiated Android gzip saves the exact UTF-8 bytes without parsing or rewriting the envelope', async () => {
  const env = fixture(); await env.driver.save(raw);
  const packet = env.calls[0].packet;
  assert.equal(packet.codec, BUSINESS_DATA_CODEC); assert.ok(packet.data.length < Buffer.byteLength(raw));
  assert.deepEqual(gunzipSync(Buffer.from(packet.data, 'base64')), Buffer.from(raw, 'utf8'));
  assert.equal(await env.driver.load(), raw);
});

test('iOS, older native configuration and missing CompressionStream keep the original plain API', async () => {
  for (const options of [{ platform: 'ios' }, { configuration: { origin: 'https://old.example' } }, { configuration: { origin: 'https://old.example', businessDataCodecs: BUSINESS_DATA_CODEC } }, { Encoder: null }]) {
    const env = fixture(options); await env.driver.save(raw);
    assert.deepEqual(env.calls[0].packet, { data: raw });
  }
  const env = fixture(); await env.driver.save('tiny'); assert.deepEqual(env.calls[0].packet, { data: 'tiny' });
});

test('compression rejects isolated surrogates and oversized input before any native save', async () => {
  const env = fixture();
  for (const value of ['x\ud800y', 'x\udc00y', '\ud800', '\udbff\ud800']) await assert.rejects(env.driver.save(value), { code: 'INVALID_BUSINESS_DATA' });
  await assert.rejects(env.driver.save('é'.repeat(8 * 1024 * 1024 + 1)), { code: 'BUSINESS_DATA_TOO_LARGE' });
  assert.equal(env.calls.length, 0);
});

test('encoder or native save errors propagate without automatic plaintext fallback', async () => {
  const failed = new Error('Controlled compression failure');
  const env = fixture({ Encoder: class { constructor() { throw failed; } } });
  await assert.rejects(env.driver.save(raw), error => error === failed); assert.equal(env.calls.length, 0);
  const native = fixture(); native.setSave(async () => { throw new Error('Controlled native save failure'); });
  await assert.rejects(native.driver.save(raw), /native save failure/); assert.equal(native.calls.length, 1);
});

test('the durable queue preserves FIFO and flush waits for compression and native acknowledgement', async () => {
  const env = fixture(), ack = gate(); env.setSave(async () => ack.promise);
  const storage = createDurableStorage(env.driver); await storage.initialize();
  storage.setItem('first', 'captured-first'.repeat(200)); storage.setItem('second', 'captured-second'.repeat(200));
  let flushed = false; const done = storage.flush().then(() => { flushed = true; });
  await waitFor(() => env.calls.length === 1); assert.equal(flushed, false);
  assert.equal(JSON.parse(rawOf(env.calls[0].packet)).entries.second, undefined);
  ack.resolve(); await done;
  assert.equal(env.calls.length, 2); assert.deepEqual(JSON.parse(rawOf(env.calls[1].packet)).entries, storage.entries());
});

test('a failed compressed save blocks a POST and explicit retry preserves the original captured request', async () => {
  const env = fixture(); env.setSave(async () => { throw new Error('Controlled durable failure'); });
  const storage = createDurableStorage(env.driver); await storage.initialize();
  const request = { requestId: 'original-request', items: Array.from({ length: 80 }, (_, index) => ({ batteryId: `BAT-${index + 1}`, version: 4, tagId: null })) };
  storage.setItem('battery-scan:staff:demo', JSON.stringify(request));
  let posts = 0; const send = async () => { await storage.flush(); posts++; return request; };
  await assert.rejects(send(), /durable failure/); assert.equal(posts, 0);
  assert.equal(env.calls[0].packet.codec, BUSINESS_DATA_CODEC);
  const original = rawOf(env.calls[0].packet); env.setSave(async () => {});
  await storage.retryPersistence(); assert.equal(env.calls[1].packet.codec, BUSINESS_DATA_CODEC); assert.equal(rawOf(env.calls[1].packet), original);
  assert.deepEqual(await send(), request); assert.equal(posts, 1);
});

test('origin switching drains preferences or a final removal and seals all old-scope mutation entries', async () => {
  for (const finalRemoval of [false, true]) {
    const env = fixture(), storage = createDurableStorage(env.driver); await storage.initialize();
    const controller = createServiceScopeController({ service: env.service, storage, origin: env.configuration.origin });
    if (finalRemoval) { storage.setItem('pending-business', 'original'); await storage.flush(); }
    const ack = gate(); env.setSave(async () => ack.promise);
    if (finalRemoval) storage.removeItem('pending-business'); else storage.setItem('preference:feedback', 'kept'.repeat(200));
    const change = controller.configure('https://new.example'); await waitFor(() => env.calls.some(call => call.kind === 'save' && !env.files.get(env.configuration.origin)?.includes('kept')));
    const entries = storage.entries();
    const blocked = async () => {
      assert.throws(() => storage.setItem('extra', 'forbidden'), { code: 'CONFIGURATION_IN_PROGRESS' });
      assert.throws(() => storage.removeItem('preference:feedback'), { code: 'CONFIGURATION_IN_PROGRESS' });
      await assert.rejects(storage.transact(() => assert.fail('Locked transaction cannot run.')), { code: 'CONFIGURATION_IN_PROGRESS' });
      await assert.rejects(storage.retryPersistence(), { code: 'CONFIGURATION_IN_PROGRESS' });
      assert.deepEqual(storage.entries(), entries);
    };
    await blocked(); assert.equal(env.calls.some(call => call.kind === 'configure'), false);
    ack.resolve(); await change; await blocked();
    assert.equal(env.files.has('https://new.example'), false, 'No old envelope was written into the new scope.');
    assert.deepEqual(JSON.parse(env.files.get('https://old.example')).entries, entries);
  }
});

test('origin switching waits for an already admitted retry and rechecks its durable result', async () => {
  for (const failRetry of [false, true]) {
    const env = fixture(), storage = createDurableStorage(env.driver); await storage.initialize();
    const controller = createServiceScopeController({ service: env.service, storage, origin: env.configuration.origin });
    env.setSave(async () => { throw new Error('Initial save failure'); }); storage.setItem('preference:retained', 'exact');
    await assert.rejects(storage.flush(), /Initial save failure/);
    const ack = gate(); env.setSave(async () => ack.promise); const retry = storage.retryPersistence();
    const change = controller.configure('https://new.example');
    const retryResult = retry.then(() => null, error => error), changeResult = change.then(() => null, error => error);
    await waitFor(() => env.calls.length === 2); assert.equal(env.calls.some(call => call.kind === 'configure'), false);
    if (failRetry) ack.reject(new Error('Retry save failure')); else ack.resolve();
    const results = await Promise.all([retryResult, changeResult]);
    if (failRetry) {
      assert.match(results[1].message, /Retry save failure/); assert.equal(env.calls.some(call => call.kind === 'configure'), false);
      env.setSave(async () => {}); await storage.retryPersistence(); storage.setItem('preference:after', 'kept'); await storage.flush();
    } else assert.equal(results[1], null);
  }
});

test('a rejected pending-work or unchanged-origin switch unlocks, but an unconfirmed changed scope stays sealed', async () => {
  const env = fixture(), storage = createDurableStorage(env.driver); await storage.initialize();
  const controller = createServiceScopeController({ service: env.service, storage, origin: env.configuration.origin });
  storage.setItem('pending', 'exact'); await assert.rejects(controller.configure('https://new.example'), /pending business work/);
  storage.removeItem('pending'); await storage.flush();
  env.setConfigure(async () => { throw new Error('Origin rejected'); });
  await assert.rejects(controller.configure('https://new.example'), /Origin rejected/);
  storage.setItem('preference:after', 'kept'); await storage.flush();
  env.setConfigure(async origin => { env.setScope(origin); throw new Error('Lost configuration response'); });
  await assert.rejects(controller.configure('https://new.example'), /Lost configuration response/);
  assert.throws(() => storage.setItem('extra', 'forbidden'), { code: 'CONFIGURATION_IN_PROGRESS' });
  assert.equal(env.files.has('https://new.example'), false);
});

test('scope admission wrappers preserve method receivers, arguments and return or promise identity', async () => {
  const receiver = {}, calls = [], value = {}, transaction = Promise.resolve('transaction'), retry = Promise.resolve('retry');
  const storage = {};
  for (const name of ['setItem', 'removeItem', 'transact', 'retryPersistence']) storage[name] = function (...args) { calls.push({ name, receiver: this, args }); return name === 'transact' ? transaction : name === 'retryPersistence' ? retry : value; };
  createServiceScopeController({ service: {}, storage, origin: null });
  assert.equal(storage.setItem.call(receiver, 'key', 'bytes'), value);
  assert.equal(storage.removeItem.call(receiver, 'key'), value);
  assert.equal(storage.transact.call(receiver, value), transaction);
  assert.equal(storage.retryPersistence.call(receiver), retry);
  assert.ok(calls.every(call => call.receiver === receiver));
  assert.deepEqual(calls.map(call => call.args), [['key', 'bytes'], ['key'], [value], []]);
  await retry;
});

test('missing or failed configuration readback cannot unseal storage after an unconfirmed switch', async () => {
  for (const response of [{}, { origin: 123 }, null, new Error('Readback unavailable')]) {
    const env = fixture({ configuration: { origin: null } }), storage = createDurableStorage(env.driver); await storage.initialize();
    const controller = createServiceScopeController({ service: env.service, storage, origin: null });
    const original = Object.assign(new Error('Original configuration error'), { code: 'CONFIGURATION_STORAGE' });
    env.setConfigure(async () => { throw original; });
    env.service.getConfiguration = async () => { if (response instanceof Error) throw response; return response; };
    await assert.rejects(controller.configure('https://new.example'), error => error.code === original.code && error.cause === original && /Reload or restart/.test(error.message));
    assert.throws(() => storage.setItem('extra', 'forbidden'), /Reload or restart/);
    assert.equal(env.calls.filter(call => call.kind === 'save').length, 0);
  }
});
