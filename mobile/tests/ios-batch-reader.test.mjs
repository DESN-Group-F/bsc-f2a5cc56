import test from 'node:test';
import assert from 'node:assert/strict';
import { createNativeReaderSession } from '../src/features/scan/native-reader-session.mjs';
import { createLookupReader } from '../src/features/scan/lookup-reader.mjs';
import { createDurableStorage } from '../src/platform/durable-storage.mjs';
import { createIntakeController, intakeDefaultValues } from '../src/features/lifecycle/intake-controller.mjs';
import { NFC_PREFIX, withNfcFailureContext } from '../src/business/nfc-controller.mjs';
import { teachingNfcEvidenceSchema } from '../src/shared/lib/teaching-nfc.js';

const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
async function until(predicate, description) {
  for (let i = 0; i < 30; i++) { if (predicate()) return; await tick(); }
  assert.ok(predicate(), description);
}
const at = '2026-10-14T02:00:00.000Z';
let identifier = 1000;
const id = () => `00000000-0000-4000-8000-${String(++identifier).padStart(12, '0')}`;
const raw = (uidHex = '0004AB00', readerSessionId = 'controlled-reader-session') => ({
  uidHex, technology: 'Controlled NFC-A output', ndefStatus: 'readWrite', capacityBytes: 144,
  records: [{ tnf: 1, typeHex: '54', idHex: '', payloadHex: '02656E74657374' }], observedAt: at,
  ...(readerSessionId ? { readerSessionId } : {}),
});
const data = () => ({
  dataset: 'demo', user: { id: 'STAFF-A' }, batteries: [],
  people: [{ id: 'OWNER-A', accountId: 'STAFF-A', role: 'staff' }],
  staffDirectory: [{ id: 'STAFF-A', active: true }], rooms: [], buildings: [],
});
async function fixture({ platform = 'ios', continuous = true, read = async () => raw(), cancel = async () => {}, save = async () => {}, onRead, availability } = {}) {
  let disk = null, allowed = true, readNumber = 0;
  const calls = [], states = [], failures = [], accepted = [], proposals = [], scheduled = [], posts = [];
  const storage = createDurableStorage({ load: async () => disk, save: async value => { await save(value); disk = value; } });
  await storage.initialize();
  const inventory = data();
  const controller = createIntakeController({ storage, data: inventory, accountId: inventory.user.id, dataset: 'demo', id, now: () => at,
    onQueueAccepted: result => accepted.push(result), write: async (...args) => { posts.push(args); throw Error('Tests must not submit intake'); },
  });
  await controller.prepare({ ...intakeDefaultValues(inventory, inventory.user.id), name: 'Battery' });
  const adapter = {
    getAvailability: async () => availability ? availability() : { available: true, enabled: true, platform },
    read: async options => { calls.push({ type: 'read', options: { ...options } }); return read(options, ++readNumber); },
    cancel: async () => { calls.push({ type: 'cancel' }); await cancel(); },
  };
  const session = createNativeReaderSession({ storage, continuous, isAllowed: () => allowed,
    prepare: async options => createLookupReader({ ...options, adapter, platform, id, now: () => at }),
    onState: value => states.push(value), onFailure: value => failures.push(value),
    onRead: async value => {
      proposals.push(value.proposal);
      if (onRead) return onRead(value, { storage, controller, accepted });
      const evidence = await value.bridge.adopt(value.proposal);
      if (!value.current()) return;
      try { return await controller.addTag(value.proposal.tagId, evidence, value.current); }
      catch (error) { throw withNfcFailureContext(error, { stage: controller.getSnapshot().storageError ? 'evidence' : 'processing', operation: 'queue', code: 'QUEUE_PERSISTENCE', attemptId: value.proposal.attemptId }); }
    },
    schedule: (run, delay) => { const task = { run, delay, active: true }; scheduled.push(task); return task; },
    unschedule: task => { task.active = false; },
  });
  return { session, storage, controller, calls, states, failures, accepted, proposals, scheduled, posts,
    disk: () => disk, reads: () => calls.filter(call => call.type === 'read'), cancels: () => calls.filter(call => call.type === 'cancel'),
    reports: () => Object.entries(storage.entries()).filter(([key]) => key.startsWith(NFC_PREFIX)).map(([, value]) => JSON.parse(value)),
    deny: () => { allowed = false; },
    next() { const task = scheduled.find(item => item.active); assert.ok(task, 'a next read was scheduled'); task.active = false; task.run(); },
    async close() { await session.pause(); session.dispose(); await tick(); },
  };
}

test('iOS intake stages two tags within one reader session, with independent durable evidence and no transport handles', async () => {
  const env = await fixture({ read: async (_, n) => raw(n === 2 ? '0004AB01' : '0004AB00') });
  try {
    env.session.start('staff-demo');
    await until(() => env.accepted.length === 1 && env.scheduled.some(task => task.active), 'first draft is durable');
    env.next();
    await until(() => env.accepted.length === 2 && env.scheduled.some(task => task.active), 'second draft is durable');
    assert.deepEqual(env.reads().map(call => call.options), [
      { timeoutMs: 60000, keepSessionAlive: true },
      { timeoutMs: 60000, keepSessionAlive: true, sessionId: 'controlled-reader-session' },
    ]);
    assert.equal(env.cancels().length, 0, 'successful staging keeps the same sheet');
    const entries = env.controller.getSnapshot().draft.entries;
    assert.deepEqual(entries.map(entry => entry.tagId), ['nfc:uid:0004AB00', 'nfc:uid:0004AB01']);
    assert.notEqual(entries[0].nfcEvidence.attemptId, entries[1].nfcEvidence.attemptId);
    for (const entry of entries) {
      assert.equal(teachingNfcEvidenceSchema.safeParse(entry.nfcEvidence).success, true);
      assert.equal(Object.hasOwn(entry.nfcEvidence.result, 'readerSessionId'), false);
    }
    assert.equal(env.reports().length, 2);
    assert.ok(env.reports().every(report => report.outcome === 'read' && report.adoptions.length === 1));
    assert.equal(env.disk().includes('controlled-reader-session'), false);
    assert.deepEqual(env.posts, [], 'reading stages drafts without registration');
    env.next();
    await until(() => env.reports().length === 3 && env.scheduled.some(task => task.active), 'duplicate read completed');
    assert.equal(env.controller.getSnapshot().draft.entries.length, 2, 'same UID does not add another draft');
    assert.equal(env.accepted.length, 2);
    assert.equal(new Set(env.reports().map(report => report.id)).size, 3, 'duplicate has its own retained attempt');
  } finally { await env.close(); }
});

test('the parked iOS sheet is cancelled during processing and the inter-read gap before a successor enters', async t => {
  for (const phase of ['processing', 'gap']) await t.test(phase, async () => {
    const processing = deferred(), cancel = deferred();
    const old = await fixture({ cancel: () => cancel.promise, onRead: phase === 'processing' ? async () => processing.promise : undefined });
    const successor = await fixture({ read: async () => raw('0004AB01', 'next-reader-session') });
    try {
      old.session.start('old');
      await until(() => phase === 'processing' ? old.proposals.length === 1 : old.scheduled.some(task => task.active), 'old sheet is parked');
      const paused = old.session.pause();
      successor.session.start('successor');
      await until(() => old.cancels().length === 1, 'parked native sheet is cancelled');
      assert.equal(successor.reads().length, 0, 'successor waits for cancellation acknowledgement');
      processing.resolve(); cancel.resolve(); await paused;
      await until(() => successor.accepted.length === 1, 'successor can read after closure');
      assert.equal(old.reads().length, 1);
      assert.equal(old.scheduled.filter(task => task.active).length, 0);
      assert.equal(successor.failures.length, 0);
    } finally { processing.resolve(); cancel.resolve(); await old.close(); await successor.close(); }
  });
});

test('cancel during durable raw save does not let a successor overtake the pending evidence transaction', async () => {
  const flush = deferred(), entered = deferred(); let hold = true;
  const old = await fixture({ save: async value => {
    const reports = Object.entries(JSON.parse(value).entries).filter(([key]) => key.startsWith(NFC_PREFIX)).map(([, report]) => JSON.parse(report));
    if (hold && reports.some(report => report.outcome === 'read')) { entered.resolve(); await flush.promise; }
  } });
  const successor = await fixture({ read: async () => raw('0004AB01', 'successor-session') });
  try {
    old.session.start('old'); await entered.promise;
    const paused = old.session.pause(); successor.session.start('successor');
    await until(() => old.cancels().length === 1, 'native cancellation proceeds without waiting for storage');
    await tick(); await tick();
    assert.equal(successor.reads().length, 0, 'successor waits for old durable proposal settlement');
    assert.equal(successor.failures.length, 0, 'successor must not fail with an inherited BUSY transaction');
    hold = false; flush.resolve(); await paused;
    await until(() => successor.accepted.length === 1, 'successor reads after original evidence is retained');
    assert.equal(old.reports()[0].outcome, 'read');
    assert.equal(old.reports()[0].adoptions, undefined);
    assert.equal(old.controller.getSnapshot().draft.entries.length, 0);
  } finally { hold = false; flush.resolve(); await old.close(); await successor.close(); }
});

test('cancelling during the next pending-report save closes the old sheet and never invokes another tag read', async () => {
  const flush = deferred(), entered = deferred(); let hold = false;
  const env = await fixture({ save: async value => {
    const reports = Object.entries(JSON.parse(value).entries).filter(([key]) => key.startsWith(NFC_PREFIX)).map(([, report]) => JSON.parse(report));
    if (hold && reports.some(report => report.outcome === 'pending')) { entered.resolve(); await flush.promise; }
  } });
  try {
    env.session.start('staff-demo');
    await until(() => env.accepted.length === 1 && env.scheduled.some(task => task.active), 'first tag is retained');
    hold = true; env.next(); await entered.promise;
    const paused = env.session.pause();
    await until(() => env.cancels().length === 1, 'parked native sheet closes before pending save completes');
    assert.equal(env.reads().length, 1);
    hold = false; flush.resolve(); await paused;
    await until(() => env.reports()[1]?.outcome === 'cancelled', 'the attempted continuation retains its cancellation');
    assert.equal(env.reads().length, 1, 'current gate is rechecked before calling native');
    assert.equal(env.accepted.length, 1);
    assert.equal(env.scheduled.filter(task => task.active).length, 0);
  } finally { hold = false; flush.resolve(); await env.close(); }
});

test('failure to save the next pending attempt closes the parked sheet before any new RF read', async () => {
  let deny = false;
  const env = await fixture({ save: async value => {
    const reports = Object.entries(JSON.parse(value).entries).filter(([key]) => key.startsWith(NFC_PREFIX)).map(([, report]) => JSON.parse(report));
    if (deny && reports.some(report => report.outcome === 'pending')) throw Error('Controlled pending report failure');
  } });
  try {
    env.session.start('staff-demo');
    await until(() => env.accepted.length === 1 && env.scheduled.some(task => task.active), 'first tag is retained');
    deny = true; env.next(); await until(() => env.failures.length === 1, 'pending-report save failure is visible');
    assert.equal(env.cancels().length, 1);
    assert.equal(env.reads().length, 1);
    assert.equal(env.failures[0].stage, 'evidence');
    assert.equal(env.failures[0].operation, 'pending');
    assert.equal(env.accepted.length, 1);
    assert.equal(env.scheduled.filter(task => task.active).length, 0);
  } finally { await env.close(); }
});

test('raw, adoption and intake queue persistence failures close the parked sheet without another read', async t => {
  for (const phase of ['raw', 'adoption', 'queue']) await t.test(phase, async () => {
    const env = await fixture({ save: async value => {
      const entries = JSON.parse(value).entries;
      const reports = Object.entries(entries).filter(([key]) => key.startsWith(NFC_PREFIX)).map(([, report]) => JSON.parse(report));
      const draft = Object.entries(entries).filter(([key]) => !key.startsWith(NFC_PREFIX)).map(([, entry]) => JSON.parse(entry)).find(entry => Array.isArray(entry.entries));
      if (phase === 'raw' && reports.some(report => report.outcome === 'read') || phase === 'adoption' && reports.some(report => report.adoptions?.length) || phase === 'queue' && draft?.entries.length) throw Error('Controlled ' + phase + ' persistence failure');
    } });
    try {
      env.session.start('staff-demo');
      await until(() => env.failures.length === 1, 'persistence failure is presented');
      assert.equal(env.cancels().length, 1);
      assert.equal(env.reads().length, 1);
      assert.equal(env.scheduled.filter(task => task.active).length, 0);
      assert.equal(env.accepted.length, 0, 'failed storage never receives acceptance feedback');
      assert.equal(env.failures[0].stage, 'evidence');
      const retained = Object.entries(JSON.parse(env.storage.exportRaw()).current.entries).filter(([key]) => key.startsWith(NFC_PREFIX)).map(([, value]) => JSON.parse(value));
      assert.equal(retained[0].outcome, 'read', 'observed raw evidence stays available through recovery export');
      assert.deepEqual(env.posts, []);
    } finally { await env.close(); }
  });
});

test('native cancellation and session deadlines between tags require explicit resume and preserve failed attempts', async t => {
  for (const code of ['CANCELLED', 'TIMEOUT', 'SESSION_ENDED']) await t.test(code, async () => {
    const env = await fixture({ read: async (_, n) => {
      if (n === 2) throw Object.assign(Error('Controlled ' + code), { code });
      return raw(n === 1 ? '0004AB00' : '0004AB01', n === 1 ? 'first-session' : 'resumed-session');
    } });
    try {
      env.session.start('staff-demo');
      await until(() => env.accepted.length === 1 && env.scheduled.some(task => task.active), 'first draft retained');
      env.next(); await until(() => env.states.at(-1)?.code === code, 'terminal status is visible');
      assert.equal(env.states.at(-1).state, 'paused');
      assert.equal(env.scheduled.filter(task => task.active).length, 0);
      env.session.start('staff-demo'); await tick();
      assert.equal(env.reads().length, 2, 'routine same-context start cannot replace a terminated sheet');
      assert.equal(env.reports()[1].outcome, code === 'CANCELLED' ? 'cancelled' : 'failed');
      assert.equal(env.reports()[1].error.code, code);
      env.session.resume('staff-demo');
      await until(() => env.accepted.length === 2, 'explicit resume stages another tag');
      assert.equal(Object.hasOwn(env.reads()[2].options, 'sessionId'), false, 'explicit resume creates a fresh session');
      assert.equal(env.controller.getSnapshot().draft.entries.length, 2);
    } finally { await env.close(); }
  });
});

test('a late result after cancellation retains raw UID and NDEF without adopting or queuing it', async () => {
  const result = deferred();
  const env = await fixture({ read: () => result.promise });
  try {
    env.session.start('staff-demo'); await until(() => env.reads().length === 1, 'native call started');
    const paused = env.session.pause();
    await until(() => env.cancels().length === 1, 'cancel forwarded');
    result.resolve(raw()); await paused;
    await until(() => env.reports()[0]?.outcome === 'read', 'late read evidence retained');
    const { readerSessionId, ...expected } = raw();
    assert.deepEqual(env.reports()[0].result, expected);
    assert.equal(env.reports()[0].adoptions, undefined);
    assert.equal(env.controller.getSnapshot().draft.entries.length, 0);
    assert.deepEqual(env.accepted, []);
    assert.equal(env.scheduled.filter(task => task.active).length, 0);
  } finally { result.resolve(raw()); await env.close(); }
});

test('availability loss between iOS batch reads closes the parked native session', async () => {
  let available = true;
  const env = await fixture({ availability: () => ({ available, enabled: available, platform: 'ios' }) });
  try {
    env.session.start('staff-demo');
    await until(() => env.accepted.length === 1 && env.scheduled.some(task => task.active), 'first read completed');
    available = false; env.next();
    await until(() => env.states.at(-1)?.state === 'unavailable', 'availability loss is visible');
    assert.equal(env.cancels().length, 1, 'availability failure must close the existing sheet');
    assert.equal(env.reads().length, 1);
    assert.equal(env.scheduled.filter(task => task.active).length, 0);
  } finally { await env.close(); }
});

test('Android and ordinary iOS readers retain the original single-read adapter options', async t => {
  for (const [platform, continuous] of [['android', true], ['ios', false]]) await t.test(platform, async () => {
    const env = await fixture({ platform, continuous, read: async () => raw('0004AB00', null) });
    try {
      env.session.start('staff-demo'); await until(() => env.accepted.length === 1 && env.scheduled.some(task => task.active), 'single read completed');
      assert.deepEqual(env.reads()[0].options, { timeoutMs: 20000 });
      await env.session.pause();
      assert.equal(env.cancels().length, 0, 'completed single-read ownership is already released');
      assert.equal(env.reports()[0].adoptions.length, 1);
    } finally { await env.close(); }
  });
});
