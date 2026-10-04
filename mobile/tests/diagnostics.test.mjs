import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeUid, canonicalTagId, decodeRecord, inventoryLookupUrl, emptyState, loadState, summarizeTrials, createExport, validateReadResult } from '../src/diagnostics.mjs';

const hex = (text) => Buffer.from(text, 'utf8').toString('hex');
const record = (typeHex, payloadHex, tnf = 1) => ({ tnf, typeHex, idHex: '', payloadHex });
const result = () => ({ uidHex: '0004ABCDEF1200', technology: 'ISO14443 / MIFARE', ndefStatus: 'readWrite', capacityBytes: 144, records: [], observedAt: '2026-10-04T08:00:00.000Z' });
const report = (outcome = 'read', id = 'attempt-1') => ({ id, startedAt: '2026-10-04T08:00:00.000Z', endedAt: '2026-10-04T08:00:01.000Z', outcome,
  setup: { ...emptyState().settings }, platform: 'ios', source: 'native-nfc-reader', result: outcome === 'read' ? result() : null,
  error: ['failed', 'cancelled'].includes(outcome) ? { code: outcome === 'cancelled' ? 'CANCELLED' : 'TIMEOUT', message: outcome } : null });

test('UID normalization preserves all bytes and leading zeros without reversing native byte order', () => {
  assert.equal(normalizeUid('00:04:ab:00'), '0004AB00');
  assert.equal(canonicalTagId('00-04 ab 00'), 'nfc:uid:0004AB00');
  assert.equal(normalizeUid('00:04:ab:cd:ef:12:00'), '0004ABCDEF1200');
  assert.equal(normalizeUid('00:04:ab:cd:ef:12:00:00:00:00'), '0004ABCDEF1200000000');
  for (const invalid of ['', 'abc', '0x0004', '00/04', 'ZZ', '0004', '0004ABCD00', null, 4]) assert.throws(() => normalizeUid(invalid));
});

test('well-known URI records decode prefix and UTF-8 without opening or changing the URI', () => {
  assert.deepEqual(decodeRecord(record('55', `04${hex('example.edu/电池')}`)), { kind: 'URI', value: 'https://example.edu/电池' });
  assert.equal(decodeRecord(record('55', `00${hex('javascript:alert(1)')}`)).value, 'javascript:alert(1)');
  assert.equal(decodeRecord(record('55', '24')).kind, 'Undecoded record');
  assert.equal(decodeRecord(record('55', '')).kind, 'Undecoded record');
  assert.equal(decodeRecord(record('55', '04c328')).kind, 'Undecoded record');
});

test('text records decode language, UTF-8, UTF-16BE and a UTF-16LE BOM', () => {
  assert.deepEqual(decodeRecord(record('54', `02656e${hex('Battery 电池')}`)), { kind: 'Text', value: 'Battery 电池', language: 'en', encoding: 'utf-8' });
  assert.equal(decodeRecord(record('54', '82656e004100420043')).value, 'ABC');
  assert.equal(decodeRecord(record('54', '82656efffe410042004300')).value, 'ABC');
  assert.equal(decodeRecord(record('54', '82656efeff75356c60')).value, '电池');
});

test('malformed NDEF keeps raw record available and reports a decode problem', () => {
  for (const value of ['ff', '42', '05656e', '82656e00', '02fffe', '02656ec328']) assert.equal(decodeRecord(record('54', value)).kind, 'Undecoded record');
  assert.equal(decodeRecord(record('55', 'abc')).kind, 'Undecoded record');
  assert.deepEqual(decodeRecord(record(hex('application/octet-stream'), '0001', 2)), { kind: 'Raw record', value: null });
});

test('lookup always uses the explicitly configured HTTPS origin and demo UID route', () => {
  const url = new URL(inventoryLookupUrl('https://inventory.example.edu:8443/', '00:04:aa:00'));
  assert.equal(url.origin, 'https://inventory.example.edu:8443');
  assert.equal(url.pathname, '/nfc-test');
  assert.equal(url.searchParams.get('tagId'), 'nfc:uid:0004AA00');
  assert.equal(url.searchParams.get('dataset'), 'demo');
  for (const bad of ['http://inventory.example.edu', 'javascript:alert(1)', '//inventory.example.edu', 'https://staff:secret@inventory.example.edu', 'https://inventory.example.edu/app', 'https://inventory.example.edu/?dataset=live', 'https://inventory.example.edu/#x']) assert.throws(() => inventoryLookupUrl(bad, '0004AB00'));
});

test('damaged storage is rejected as a whole rather than quietly losing report entries', () => {
  assert.equal(loadState(null).error, null);
  for (const raw of ['{bad', 'null', JSON.stringify({ version: 2 }), JSON.stringify({ ...emptyState(), reports: [{}] })]) {
    const loaded = loadState(raw); assert.ok(loaded.error); assert.equal(loaded.state.reports.length, 0);
  }
  const broken = report(); broken.result.uidHex = 'not-a-uid';
  assert.ok(loadState(JSON.stringify({ ...emptyState(), reports: [broken] })).error);
  broken.result = result(); broken.error = { message: { unexpected: true }, code: 'BROKEN' };
  assert.ok(loadState(JSON.stringify({ ...emptyState(), reports: [broken] })).error);
});

test('a saved pending read becomes interrupted on restart without inventing a completion time', () => {
  const pending = report('pending'); pending.endedAt = null;
  const loaded = loadState(JSON.stringify({ ...emptyState(), reports: [report(), pending] }));
  assert.equal(loaded.error, null); assert.equal(loaded.recovered, true);
  assert.equal(loaded.state.reports[0].outcome, 'read');
  assert.equal(loaded.state.reports[1].outcome, 'interrupted');
  assert.equal(loaded.state.reports[1].endedAt, null);
  assert.equal(loaded.state.reports[1].result, null);
});

test('repeatability uses only the latest ten completed attempts matching all declared conditions', () => {
  const state = emptyState();
  state.reports = Array.from({ length: 12 }, (_, index) => report(index === 11 ? 'cancelled' : index === 10 ? 'failed' : 'read', `r${index}`));
  state.reports.push(report('pending', 'pending'));
  const other = report('read', 'other'); other.setup.surface = 'metal'; state.reports.push(other);
  const stats = summarizeTrials(state.reports, state.settings);
  assert.equal(stats.total, 10); assert.equal(stats.reads, 8); assert.equal(stats.failed, 1); assert.equal(stats.cancelled, 1);
  assert.deepEqual(stats.distinctUids, ['0004ABCDEF1200']);
});

test('a UID read with an NDEF issue stays distinct from a complete NDEF read', () => {
  const reports = [report(), report('failed', 'failure'), report('cancelled', 'cancel')];
  reports[0].result.ndefError = 'Tag moved away'; reports[0].result.ndefStatus = 'unknown';
  assert.equal(validateReadResult(reports[0].result), true);
  const stats = summarizeTrials(reports, emptyState().settings);
  assert.equal(stats.reads, 1); assert.equal(stats.ndefIssues, 1); assert.equal(stats.failed, 1); assert.equal(stats.cancelled, 1);
});

test('bridge results must have valid UID, records, capacity and observed time before rendering', () => {
  assert.equal(validateReadResult(result()), true);
  for (const change of [{ uidHex: 'xy' }, { capacityBytes: -1 }, { ndefStatus: 'guessed' }, { observedAt: 'unknown' }, { records: [record('55', 'xyz')] }]) assert.equal(validateReadResult({ ...result(), ...change }), false);
});

test('exports keep every report and distinguish device observations from business records', () => {
  const state = emptyState(); state.reports = Array.from({ length: 17 }, (_, index) => report('read', `r${index}`));
  const output = createExport(state, 'ios', '2026-10-04T10:00:00.000Z');
  assert.equal(output.reports.length, 17); assert.equal(output.reports[0].result.uidHex, '0004ABCDEF1200');
  assert.equal(output.exportedAt, '2026-10-04T10:00:00.000Z'); assert.match(output.scope, /no registration, loan or location changes/);
});
