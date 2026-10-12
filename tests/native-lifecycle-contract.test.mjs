import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const qa = process.env.NATIVE_LIFECYCLE_QA_ROOT ? pathToFileURL(path.resolve(process.env.NATIVE_LIFECYCLE_QA_ROOT) + path.sep) : new URL('../work/qa/', import.meta.url);
const { intakePayloadSchema, captureIntakeAttempt, recoverIntakeSession, verifyIntakeReceipt } = await import(new URL('intake-session.mjs', qa));
const { captureIntakeDraft, recoverIntakeDraft } = await import(new URL('intake-draft.mjs', qa));
const { lifecyclePayloadSchema, captureLifecycleAttempt, recoverLifecycleSession, verifyLifecycleReceipt } = await import(new URL('lifecycle-session.mjs', qa));
const { captureRemovalDraft, recoverRemovalDraft } = await import(new URL('removal-draft.mjs', qa));
const { canonicalModelJson } = await import(new URL('battery-models.mjs', qa));
const { createHumanReport } = await import(new URL('export-report.mjs', qa));

const at = '2026-10-12T03:00:00.000Z';
function evidence(uidHex = '0004AB00') { return { attemptId: crypto.randomUUID(), source: 'native-nfc-reader', platform: 'android', startedAt: '2026-10-12T02:59:57.000Z', endedAt: '2026-10-12T02:59:58.000Z', adoptedAt: '2026-10-12T02:59:59.000Z', tagId: `nfc:uid:${uidHex}`, result: { uidHex, technology: 'Controlled NFC-A output', ndefStatus: 'readWrite', capacityBytes: 144, records: [{ tnf: 1, typeHex: '5400', idHex: '0001', payloadHex: '0000ffFe01' }], observedAt: '2026-10-12T02:59:58.000Z' } }; }
const common = { name: 'Controlled incoming battery', model: '', chemistry: '', capacityMah: null, voltage: null, ownerId: 'staff-owner', homeBuildingId: 'J18', homeRoomId: null, manufacturedOn: null, firstUsedOn: null };
function intake(proof = evidence()) { return { requestId: crypto.randomUUID(), sessionId: crypto.randomUUID(), source: 'native_nfc', nfcEvidence: proof, tagId: proof.tagId, scannedAt: proof.result.observedAt, common, firstUseMode: 'at_registration' }; }
function intakeReceipt(payload) { return { requestId: payload.requestId, sessionId: payload.sessionId, dataset: 'demo', actorAccountId: 'reader-account', batteryId: 'BAT-00000001', tagId: payload.tagId, registeredAt: at, source: 'native_nfc', nfcEvidence: payload.nfcEvidence, replayed: false, scannedAt: payload.scannedAt, ...common, firstUsedOn: '2026-10-12' }; }
function lifecycle(proof = evidence()) { return { requestId: crypto.randomUUID(), source: 'native_nfc', kind: 'scrapped', reason: '', destination: null, items: [{ batteryId: 'BAT-ONE', version: 3, tagId: proof.tagId, nfcEvidence: proof }] }; }
function lifecycleReceipt(payload) { return { requestId: payload.requestId, source: payload.source, dataset: 'demo', actorAccountId: 'reader-account', kind: payload.kind, reason: payload.reason, destination: payload.destination, at, replayed: false, items: payload.items.map(item => ({ ...item, version: item.version + 1, status: payload.kind })) }; }

test('legacy implicit simulated intake keeps its payload and canonical original fingerprint', () => {
  const legacy = { requestId: crypto.randomUUID(), sessionId: crypto.randomUUID(), tagId: 'DEMO-INTAKE-original', common, firstUseMode: 'at_registration' };
  assert.deepEqual(intakePayloadSchema.parse(legacy), legacy);
  assert.equal(Object.hasOwn(intakePayloadSchema.parse(legacy), 'source'), false);
  assert.equal(canonicalModelJson({ actorAccountId: 'reader-account', payload: intakePayloadSchema.parse(legacy) }), canonicalModelJson({ actorAccountId: 'reader-account', payload: legacy }));
  assert.throws(() => intakePayloadSchema.parse({ ...legacy, nfcEvidence: evidence() }));
});

test('native intake preserves leading zeros and raw NDEF across capture, recovery and receipt validation', () => {
  const payload = intake(), attempt = captureIntakeAttempt('reader-account', 'demo', payload);
  assert.deepEqual(attempt.payload.nfcEvidence, payload.nfcEvidence);
  assert.equal(attempt.payload.tagId, 'nfc:uid:0004AB00');
  assert.equal(attempt.payload.nfcEvidence.result.records[0].payloadHex, '0000ffFe01');
  assert.deepEqual(recoverIntakeSession(JSON.stringify(attempt), 'reader-account', 'demo'), attempt);
  assert.deepEqual(verifyIntakeReceipt(intakeReceipt(payload), attempt).nfcEvidence, payload.nfcEvidence);
  const altered = intakeReceipt(payload); altered.nfcEvidence = structuredClone(payload.nfcEvidence); altered.nfcEvidence.result.records[0].payloadHex = '0000ffFe02';
  assert.throws(() => verifyIntakeReceipt(altered, attempt), /evidence/);
  assert.throws(() => intakePayloadSchema.parse({ ...payload, tagId: 'nfc:uid:0004AB01' }));
  assert.throws(() => captureIntakeAttempt('reader-account', 'live', payload), /Demonstration/);
});

test('native intake drafts bind full source evidence to the exact pending entry and retain the 200 cap', () => {
  const payload = intake(), attempt = captureIntakeAttempt('reader-account', 'demo', payload);
  const entry = { id: crypto.randomUUID(), tagId: payload.tagId, source: payload.source, nfcEvidence: payload.nfcEvidence, scannedAt: payload.scannedAt, common, firstUseMode: payload.firstUseMode, sessionId: payload.sessionId, selected: true, error: '' };
  const draft = captureIntakeDraft({ actorAccountId: 'reader-account', dataset: 'demo', batch: { sessionId: payload.sessionId, common, firstUseMode: payload.firstUseMode, source: 'native_nfc' }, entries: [entry], attempt, attemptEntryId: entry.id, completed: [] });
  assert.deepEqual(recoverIntakeDraft(JSON.stringify(draft), 'reader-account', 'demo'), draft);
  const changed = structuredClone(draft); changed.entries[0].nfcEvidence.result.records[0].payloadHex = 'AA';
  assert.throws(() => captureIntakeDraft(changed), /exact captured request/);
  assert.throws(() => captureIntakeDraft({ ...draft, attempt: null, attemptEntryId: null, entries: [...draft.entries, { ...entry, id: crypto.randomUUID(), source: undefined, nfcEvidence: undefined, tagId: 'DEMO-INTAKE-mixed' }] }));
  const entries = Array.from({ length: 200 }, (_, index) => { const proof = evidence(index.toString(16).toUpperCase().padStart(8, '0')); return { ...entry, id: crypto.randomUUID(), tagId: proof.tagId, nfcEvidence: proof }; });
  assert.equal(captureIntakeDraft({ ...draft, entries, attempt: null, attemptEntryId: null }).entries.length, 200);
  assert.throws(() => captureIntakeDraft({ ...draft, entries: [...entries, { ...entry, id: crypto.randomUUID() }], attempt: null, attemptEntryId: null }));
});

test('native removal requires full matching per-item evidence and typed sources cannot masquerade as NFC', () => {
  const payload = lifecycle(), attempt = captureLifecycleAttempt('reader-account', 'demo', payload);
  assert.deepEqual(recoverLifecycleSession(JSON.stringify(attempt), 'reader-account', 'demo'), attempt);
  assert.deepEqual(verifyLifecycleReceipt(lifecycleReceipt(payload), attempt).items[0].nfcEvidence, payload.items[0].nfcEvidence);
  const changed = lifecycleReceipt(payload); changed.items[0].nfcEvidence = { ...payload.items[0].nfcEvidence, adoptedAt: at };
  assert.throws(() => verifyLifecycleReceipt(changed, attempt), /reviewed battery/);
  assert.throws(() => lifecyclePayloadSchema.parse({ ...payload, source: 'manual_selection' }));
  assert.throws(() => lifecyclePayloadSchema.parse({ ...payload, source: 'tag_entry' }));
  assert.throws(() => lifecyclePayloadSchema.parse({ ...payload, items: [{ ...payload.items[0], tagId: null }] }));
  assert.throws(() => captureLifecycleAttempt('reader-account', 'live', payload), /Demonstration/);
});

test('native removal draft retains evidence and selections, rejects live, and enforces the existing 100 cap', () => {
  const payload = lifecycle();
  const input = { actorAccountId: 'reader-account', dataset: 'demo', source: payload.source, kind: payload.kind, reason: '', destination: '', items: payload.items.map(item => ({ ...item, name: 'Controlled battery' })), selectedIds: ['BAT-ONE'] };
  const draft = captureRemovalDraft(input);
  assert.deepEqual(recoverRemovalDraft(JSON.stringify(draft), 'reader-account', 'demo'), draft);
  assert.throws(() => captureRemovalDraft({ ...input, dataset: 'live' }));
  assert.throws(() => captureRemovalDraft({ ...input, source: 'manual_selection' }));
  const items = Array.from({ length: 100 }, (_, index) => { const proof = evidence(index.toString(16).toUpperCase().padStart(8, '0')); return { ...input.items[0], batteryId: `BAT-${index}`, tagId: proof.tagId, nfcEvidence: proof }; });
  assert.equal(captureRemovalDraft({ ...input, items, selectedIds: [] }).items.length, 100);
  assert.throws(() => captureRemovalDraft({ ...input, items: [...items, { ...input.items[0], batteryId: 'BAT-OVER' }], selectedIds: [] }));
});

test('native human exports label ordinary scans, intake and removal while preserving complete original JSON', () => {
  const proof = evidence();
  const document = { metadata: { mode: 'activity', dataset: 'demo', exported_at_utc: at }, tables: { Activity: [
    { action: 'checkout', battery_id: 'BAT-ONE', at, actor_name: 'Controlled actor', details_json: JSON.stringify({ borrower: 'Controlled actor', scan: { source: 'native_nfc', bindings: [{ batteryId: 'BAT-ONE', nfcEvidence: proof }] } }) },
    { action: 'battery_registered', battery_id: 'BAT-TWO', at, actor_name: 'Controlled actor', details_json: JSON.stringify({ after: { name: 'Controlled pack' }, source: 'native_nfc', nfcEvidence: proof }) },
    { action: 'battery_scrapped', battery_id: 'BAT-THREE', at, actor_name: 'Controlled actor', details_json: JSON.stringify({ source: 'native_nfc', nfcEvidence: proof, reason: '', destination: null }) },
  ] } };
  const before = structuredClone(document);
  const report = createHumanReport(document);
  for (const row of report.sheets.find(sheet => sheet.name === 'Activity').rows) assert.match(row['What happened'], /native NFC \(device-reported\)/);
  assert.deepEqual(document, before);
  assert.ok(JSON.stringify(document).includes('0000ffFe01'));
});
