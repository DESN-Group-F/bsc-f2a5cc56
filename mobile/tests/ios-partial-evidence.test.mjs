import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { transform } from 'esbuild';
import * as diagnostics from '../src/diagnostics.mjs';
import { createDurableStorage } from '../src/platform/durable-storage.mjs';
import { NFC_PREFIX, readNfcProposal, recoverNfcEvidence } from '../src/business/nfc-controller.mjs';
import { createTeachingNfcBridge } from '../src/business/teaching-nfc-bridge.mjs';

const observedAt = '2026-10-14T08:00:00.000Z';
const partial = (code = 'CANCELLED') => ({ uidHex: '00020306', technology: 'NFC-A / ISO 14443 / MIFARE Ultralight', ndefStatus: 'unknown', capacityBytes: null, records: [], observedAt, ndefError: `${code}: Controlled read interruption` });
const failure = (code, value = partial(code)) => Object.assign(new Error('Controlled read interruption'), { code, data: { partialResult: value } });
async function store(initial = null, save = () => {}) {
  let raw = initial;
  const storage = createDurableStorage({ load: async () => raw, save: async value => { await save(value); raw = value; } });
  await storage.initialize();
  return { storage, raw: () => raw };
}
const diagnosticReport = (code = 'CANCELLED') => ({ id: 'partial-attempt', startedAt: observedAt, endedAt: observedAt, outcome: code === 'CANCELLED' ? 'cancelled' : 'failed', setup: { ...diagnostics.emptyState().settings }, platform: 'ios', source: 'native-nfc-reader', result: null, error: { code, message: 'Controlled read interruption' }, ...diagnostics.partialReadEvidence(failure(code)) });

test('rejected-read progress keeps exact bytes and drops transport capability without sharing mutable arrays', () => {
  const raw = { ...partial(), readerSessionId: 'expired-native-session', records: [{ tnf: 1, typeHex: '54', idHex: '', payloadHex: '0041' }] };
  const evidence = diagnostics.partialReadEvidence(failure('CANCELLED', raw));
  assert.equal(evidence.partialResult.uidHex, '00020306');
  assert.equal('readerSessionId' in evidence.partialResult, false);
  raw.records[0].payloadHex = 'FFFF';
  assert.equal(evidence.partialResult.records[0].payloadHex, '0041');
  assert.deepEqual(diagnostics.partialReadEvidence({ code: 'CANCELLED' }), {});
});

test('malformed rejected-read progress is reported without inventing a usable identifier', () => {
  for (const value of [null, [], { ...partial(), uidHex: 'bad' }, { ...partial(), uidHex: '00:02:03:06' }, { ...partial(), observedAt: 'unknown' }, { ...partial(), ndefError: undefined }, { ...partial(), records: [{ tnf: 1, typeHex: '54', idHex: '', payloadHex: 'xx' }] }, { ...partial(), guessedBattery: 'BAT-1' }]) {
    const evidence = diagnostics.partialReadEvidence(failure('CANCELLED', value));
    assert.equal(evidence.partialResult, undefined);
    assert.match(evidence.partialResultIssue, /could not be validated/);
  }
});

test('cancelled and background NFC reads durably retain partial evidence without producing or adopting a proposal', async t => {
  for (const code of ['CANCELLED', 'BACKGROUND']) await t.test(code, async () => {
    const saved = await store();
    let observations = 0;
    const bridge = createTeachingNfcBridge({ platform: 'ios', storage: saved.storage, id: () => code, now: () => observedAt, onObserved: () => { observations++; }, adapter: {
      getAvailability: async () => ({ platform: 'ios', available: true, enabled: true }),
      read: async () => { throw failure(code, { ...partial(code), readerSessionId: 'expired' }); }, cancel: async () => {},
    } });
    await assert.rejects(bridge.read(), error => error.code === code && error.stage === 'reader' && error.report.partialResult.uidHex === '00020306');
    const report = JSON.parse(saved.storage.getItem(NFC_PREFIX + code));
    assert.equal(report.outcome, code === 'CANCELLED' ? 'cancelled' : 'failed');
    assert.equal(report.result, null);
    assert.deepEqual(report.partialResult, partial(code));
    assert.equal(observations, 0, 'Rejected progress must not publish accepted-observation feedback');
    await assert.rejects(bridge.adopt({ attemptId: code, source: 'native-nfc-reader', platform: 'ios', startedAt: report.startedAt, endedAt: report.endedAt, tagId: 'nfc:uid:00020306', result: partial(code) }), /differs from its original/);
    const restarted = await store(saved.raw());
    recoverNfcEvidence(restarted.storage);
    assert.equal(restarted.storage.getItem(NFC_PREFIX + code), saved.storage.getItem(NFC_PREFIX + code));
  });
});

test('a rejected read whose terminal save fails keeps the partial evidence in the recovery export', async () => {
  let writes = 0;
  const saved = await store(null, () => { if (++writes === 2) throw new Error('Controlled terminal save failure'); });
  await assert.rejects(readNfcProposal({ adapter: { read: async () => { throw failure('BACKGROUND'); } }, storage: saved.storage, id: 'save-failure', platform: 'ios', now: () => observedAt }), error => error.stage === 'evidence' && error.report.result === null && error.report.partialResult.uidHex === '00020306');
  const report = JSON.parse(JSON.parse(saved.storage.exportRaw()).current.entries[NFC_PREFIX + 'save-failure']);
  assert.equal(report.outcome, 'failed');
  assert.equal(report.result, null);
  assert.deepEqual(report.partialResult, partial('BACKGROUND'));
});

test('recovery rejects corrupted or promoted partial evidence without rewriting saved records', async () => {
  const base = { ...diagnosticReport(), id: 'stored' };
  delete base.setup;
  for (const change of [{ partialResult: { ...partial(), readerSessionId: 'capability' } }, { partialResult: { ...partial(), uidHex: 'bad' } }, { outcome: 'read', result: partial() }, { outcome: 'pending', endedAt: null, error: null }]) {
    const report = { ...base, ...change };
    const raw = JSON.stringify({ schemaVersion: 1, entries: { [NFC_PREFIX + 'stored']: JSON.stringify(report) } });
    const saved = await store(raw);
    assert.throws(() => recoverNfcEvidence(saved.storage), /unreadable/);
    assert.equal(saved.raw(), raw);
  }
});

test('diagnostic reopen/export retains stopped evidence while success counts remain zero', () => {
  const report = diagnosticReport();
  const state = { ...diagnostics.emptyState(), reports: [report] };
  const loaded = diagnostics.loadState(JSON.stringify(state));
  assert.equal(loaded.error, null);
  assert.equal(loaded.recovered, false);
  assert.deepEqual(loaded.state.reports[0], report);
  const exported = diagnostics.createExport(loaded.state, 'ios', observedAt);
  assert.deepEqual(exported.reports[0].partialResult, partial());
  const stats = diagnostics.summarizeTrials(exported.reports, state.settings);
  assert.equal(stats.reads, 0);
  assert.equal(stats.cancelled, 1);
  assert.deepEqual(stats.distinctUids, []);
  for (const partialResult of [{ ...partial(), uidHex: 'broken' }, { ...partial(), readerSessionId: 'old' }]) {
    assert.ok(diagnostics.loadState(JSON.stringify({ ...state, reports: [{ ...report, partialResult }] })).error);
  }
});

test('actual diagnostic rendering labels retained progress and offers no inventory lookup action for it', async t => {
  const source = await readFile(new URL('../src/diagnostics-app.jsx', import.meta.url), 'utf8');
  const compiled = await transform(source, { loader: 'jsx', format: 'cjs' });
  const module = { exports: {} };
  const imports = {
    react: React,
    '@capacitor/core': { Capacitor: { getPlatform: () => 'ios', isNativePlatform: () => true } },
    '@battery-inventory/nfc': { BatteryNfc: {} },
    './diagnostics.mjs': diagnostics,
    './diagnostics.css': {},
  };
  new Function('require', 'module', 'exports', compiled.code)(name => { assert.ok(name in imports, name); return imports[name]; }, module, module.exports);
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  globalThis.localStorage = { getItem: () => JSON.stringify({ ...diagnostics.emptyState(), reports: [diagnosticReport()] }) };
  t.after(() => { if (previous) Object.defineProperty(globalThis, 'localStorage', previous); else delete globalThis.localStorage; });
  const html = renderToStaticMarkup(React.createElement(module.exports.default));
  assert.match(html, /Retained partial evidence/);
  assert.match(html, /not a completed read or an inventory selection/);
  assert.match(html, /00020306/);
  assert.match(html, /outcome-cancelled/);
  assert.doesNotMatch(html, /<button[^>]*>Open inventory lookup/);
});
