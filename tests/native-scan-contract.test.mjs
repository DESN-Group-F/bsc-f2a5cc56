import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

// Execute the current TypeScript contracts, rather than a stale generated client.
const root = fileURLToPath(new URL('../', import.meta.url)), work = join(root, 'work');
await mkdir(work, { recursive: true });
const scratch = await mkdtemp(join(work, 'native-scan-contract-'));
after(async () => {
  const resolved = resolve(scratch);
  if (!resolved.startsWith(`${resolve(work)}${sep}`) || !relative(work, resolved).startsWith('native-scan-contract-')) throw new Error('Refusing cleanup outside the isolated contract-test directory.');
  await rm(resolved, { recursive: true, force: true });
});
const require = createRequire(import.meta.url), compiled = new Set();
async function compileSource(file) {
  const filename = resolve(root, file), output = join(scratch, relative(root, filename).replace(/\.ts$/, '.mjs'));
  if (compiled.has(filename)) return output;
  compiled.add(filename);
  const result = ts.transpileModule(await readFile(filename, 'utf8'), { fileName: filename, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext }, reportDiagnostics: true });
  assert.deepEqual(result.diagnostics?.filter(item => item.category === ts.DiagnosticCategory.Error), [], `Syntax diagnostics in ${file}`);
  let code = result.outputText;
  for (const specifier of new Set([...code.matchAll(/from\s+["']([^"']+)["']/g)].map(match => match[1]))) {
    let replacement;
    if (specifier.startsWith('.')) {
      const dependency = resolve(dirname(filename), `${specifier}.ts`);
      await compileSource(relative(root, dependency));
      replacement = `${specifier}.mjs`;
    } else replacement = pathToFileURL(require.resolve(specifier)).href;
    code = code.replaceAll(`"${specifier}"`, JSON.stringify(replacement)).replaceAll(`'${specifier}'`, JSON.stringify(replacement));
  }
  await mkdir(dirname(output), { recursive: true }); await writeFile(output, code);
  return output;
}
const domain = await import(pathToFileURL(await compileSource('lib/domain.ts')).href);
const scan = await import(pathToFileURL(await compileSource('lib/scan-session.ts')).href);
const movement = await import(pathToFileURL(await compileSource('lib/movement-session.ts')).href);
const recovery = await import(pathToFileURL(await compileSource('lib/client/workflow-recovery.ts')).href);
const intake = await import(pathToFileURL(await compileSource('lib/intake-session.ts')).href);

const accountId = 'native-staff', sessionId = '11111111-1111-4111-8111-111111111111', requestId = '22222222-2222-4222-8222-222222222222';
const loanId = '33333333-3333-4333-8333-333333333333', otherLoanId = '44444444-4444-4444-8444-444444444444', attemptId = '55555555-5555-4555-8555-555555555555';
const at = '2026-10-12T05:00:00.000Z', later = '2026-10-12T05:00:01.000Z';
function evidence(uidHex = '0004AB00') {
  return { attemptId, source: 'native-nfc-reader', platform: 'android', startedAt: at, endedAt: later, adoptedAt: later, tagId: `nfc:uid:${uidHex}`,
    result: { uidHex, technology: 'Controlled NFC-A adapter', ndefStatus: 'readOnly', capacityBytes: 144, records: [{ tnf: 2, typeHex: '0001', idHex: '00', payloadHex: '000000AB' }], observedAt: at } };
}
function nativeRead(id = 'BAT-001', uidHex = '0004AB00', extra = {}) {
  const nfcEvidence = evidence(uidHex), tagId = nfcEvidence.tagId;
  return { source: 'native_nfc', tagId, readAt: later, nfcEvidence, battery: { id, name: 'Reviewed battery', ownerName: 'Responsible staff', version: 7, tagId, loanId: null, borrowerName: null, checkedOutAt: null, lifecycleStatus: 'active', ...extra } };
}
function capture(kind = 'checkout', reads = [nativeRead()], room = null) { return scan.scanMovementPayload(kind, reads, sessionId, room, requestId); }
function receipt(payload) { return { requestId: payload.requestId, kind: payload.kind, batteryIds: [...payload.batteryIds], count: payload.batteryIds.length, at: later, scan: structuredClone(payload.scan), ...(payload.kind === 'checkout' ? { borrower: 'Native staff', borrowerAccountId: accountId } : {}) }; }
function storage(entries) { const retained = new Map(entries); return { retained, getItem: key => retained.get(key) ?? null }; }
function pendingSession(kind = 'checkout') {
  const first = nativeRead('BAT-001', '0004AB00', kind === 'return' ? { loanId, borrowerName: 'Native staff', checkedOutAt: at } : {});
  const unrelated = nativeRead('BAT-002', '00000004001100', kind === 'return' ? { loanId: otherLoanId, borrowerName: 'Native staff', checkedOutAt: at } : {});
  const room = kind === 'return' ? { id: 'J18-DEMO-ROOM', name: 'Demo room', buildingId: 'J18', version: 4, isPlaceholder: true } : null;
  return { sessionId, mode: 'continuous', room, queue: [first, unrelated], completed: [], issues: [], attempt: { payload: capture(kind, [first], room), reads: [first], status: 'uncertain', message: 'The original response was lost.' } };
}

test('native source preserves complete leading-zero UID bytes, NDEF records and independent device times for 4, 7 and 10-byte identifiers', () => {
  for (const uid of ['0004AB00', '00000004001100', '00000000040011002200']) {
    const read = nativeRead('BAT-001', uid), original = structuredClone(read.nfcEvidence), payload = capture('checkout', [read]);
    assert.equal(domain.scanSourceSchema.parse('native_nfc'), 'native_nfc');
    assert.deepEqual(domain.scanLookupSchema.parse({ tagIds: [read.tagId], source: 'native_nfc' }), { tagIds: [`nfc:uid:${uid}`], source: 'native_nfc' });
    assert.deepEqual(payload.scan.bindings[0], { batteryId: 'BAT-001', tagId: `nfc:uid:${uid}`, version: 7, nfcEvidence: original });
    assert.equal(domain.movementSchema.parse(payload).scan.source, 'native_nfc');
    read.nfcEvidence.result.records[0].payloadHex = 'FF'; read.nfcEvidence.result.uidHex = 'FFFFFFFF';
    assert.deepEqual(payload.scan.bindings[0].nfcEvidence, original, 'Captured evidence is independent of later device evidence mutation');
    assert.equal(payload.scan.bindings[0].nfcEvidence.result.observedAt, at);
    assert.equal(payload.returnRoom, undefined);
  }
});
test('native bindings require matching full evidence and reject missing evidence, null tags, normalized-away zeros and malformed record bytes', () => {
  const valid = capture().scan;
  for (const mutate of [
    value => { delete value.bindings[0].nfcEvidence; },
    value => { value.bindings[0].tagId = null; },
    value => { value.bindings[0].tagId = 'nfc:uid:FFFFFFFF'; },
    value => { value.bindings[0].nfcEvidence.tagId = 'nfc:uid:00000001'; },
    value => { value.bindings[0].nfcEvidence.result.uidHex = '04AB00'; },
    value => { value.bindings[0].nfcEvidence.result.records[0].payloadHex = '0'; },
  ]) { const changed = structuredClone(valid); mutate(changed); assert.equal(domain.scanContextSchema.safeParse(changed).success, false); }
  const missing = nativeRead(); delete missing.nfcEvidence; assert.throws(() => capture('checkout', [missing]));
  const mismatch = nativeRead(); mismatch.nfcEvidence = evidence('FFFFFFFF'); assert.throws(() => capture('checkout', [mismatch]), /does not match/);
});
test('legacy input sources cannot adopt native evidence and native/manual acquisition cannot share one reviewed movement or queue', () => {
  for (const source of ['manual', 'selection', 'simulated']) {
    const read = { ...nativeRead(), source }; assert.throws(() => capture('checkout', [read]));
    const context = structuredClone(capture().scan); context.source = source;
    assert.equal(domain.scanContextSchema.safeParse(context).success, false);
  }
  const manual = { ...nativeRead('BAT-002', '00000004001100'), source: 'manual' }; delete manual.nfcEvidence;
  assert.throws(() => capture('checkout', [nativeRead(), manual]), /separate batches/);
  const saved = pendingSession(); saved.attempt = null; saved.queue[1] = manual;
  assert.equal(scan.recoverScanSession(JSON.stringify(saved), 'checkout'), null);
});
test('return capture retains exact reviewed Loan ID, tag/version and optional room separately from native observations', () => {
  const read = nativeRead('BAT-001', '0004AB00', { loanId, borrowerName: 'Native staff', checkedOutAt: at });
  const room = { id: 'J18-DEMO-ROOM', name: 'Demo room', buildingId: 'J18', version: 4, isPlaceholder: true }, payload = capture('return', [read], room);
  read.battery.loanId = otherLoanId; read.battery.version = 8; room.version = 5;
  assert.deepEqual(payload.expectedLoans, [{ batteryId: 'BAT-001', loanId }]); assert.equal(payload.scan.bindings[0].version, 7);
  assert.deepEqual(payload.returnRoom, { roomId: 'J18-DEMO-ROOM', version: 4 });
  assert.equal(payload.scan.bindings[0].nfcEvidence.result.observedAt, at);
  assert.equal('roomId' in payload.scan.bindings[0].nfcEvidence.result, false);
});
test('authoritative receipt must retain the same native source and every evidence byte; bindings may only reorder', () => {
  const payload = capture('checkout', [nativeRead(), nativeRead('BAT-002', '00000004001100')]), saved = receipt(payload);
  assert.equal(movement.verifyMovementReceipt(saved, payload, accountId), saved);
  const reordered = structuredClone(saved); reordered.scan.bindings.reverse(); reordered.batteryIds.reverse();
  assert.ok(movement.verifyMovementReceipt(reordered, payload, accountId));
  for (const mutate of [
    value => { delete value.scan; },
    value => { value.scan.source = 'manual'; value.scan.bindings.forEach(item => delete item.nfcEvidence); },
    value => { value.scan.bindings[0].nfcEvidence.result.records[0].payloadHex = 'FF'; },
    value => { value.scan.bindings[0].nfcEvidence.platform = 'ios'; },
    value => { value.scan.bindings[0].nfcEvidence.attemptId = requestId; },
    value => { value.scan.bindings[0].nfcEvidence.result.observedAt = later; },
    value => { value.scan.bindings[0].version++; },
    value => { value.scan.sessionId = requestId; },
  ]) { const changed = structuredClone(saved); mutate(changed); assert.throws(() => movement.verifyMovementReceipt(changed, payload, accountId), /exact evidence/); }
  assert.throws(() => movement.verifyMovementReceipt({ ...saved, borrowerAccountId: 'other-staff' }, payload, accountId), /result is uncertain/);
});
test('legacy continuous native recovery retains exact captured request and leaves unrelated queued reads unsubmitted', () => {
  for (const kind of ['checkout', 'return']) {
    const saved = pendingSession(kind), raw = JSON.stringify(saved), recovered = scan.recoverScanSession(raw, kind);
    assert.ok(recovered); assert.equal(recovered.mode, 'batch'); assert.deepEqual(recovered.attempt.payload, saved.attempt.payload);
    assert.deepEqual(recovered.queue, saved.queue); assert.equal(recovered.attempt.payload.batteryIds.length, 1);
    assert.equal(recovered.queue[1].battery.id, 'BAT-002'); assert.equal(recovered.queue[1].nfcEvidence.tagId, 'nfc:uid:00000004001100');
    assert.equal(JSON.stringify(saved), raw, 'Recovery does not rewrite its saved source');
    const key = `battery-scan:${accountId}:demo:${kind}`, store = storage([[key, raw]]), state = recovery.readWorkflowRecovery(store, accountId);
    assert.deepEqual(state.scans, [{ dataset: 'demo', kind }]); assert.equal(store.getItem(key), raw);
  }
});
test('native recovery rejects corrupted read/binding evidence without converting source or inventing a new request', () => {
  for (const mutate of [
    saved => { delete saved.queue[0].nfcEvidence; },
    saved => { saved.queue[1].nfcEvidence.tagId = 'nfc:uid:FFFFFFFF'; },
    saved => { saved.queue[0].nfcEvidence.result.records[0].payloadHex = 'FF'; },
    saved => { saved.attempt.payload.scan.bindings[0].nfcEvidence.result.records[0].idHex = 'FF'; },
    saved => { saved.attempt.payload.scan.source = 'manual'; },
    saved => { saved.attempt.payload.requestId = 'replacement-request'; },
  ]) { const saved = structuredClone(pendingSession()); mutate(saved); assert.equal(scan.recoverScanSession(JSON.stringify(saved), 'checkout'), null); }
});
test('workflow discovery blocks malformed or foreign scan/movement/intake raw keys and preserves the original bytes', () => {
  const validMovement = movement.captureMovementAttempt('checkout', [nativeRead().battery], accountId, 'demo', requestId);
  const foreignMovement = { ...validMovement, accountId: 'other-staff' };
  for (const [key, raw, message] of [
    [`battery-scan:${accountId}:demo:checkout`, 'not JSON', /scan session is unreadable/],
    [`battery-scan:${accountId}:live:return`, JSON.stringify({ mode: 'batch', queue: [] }), /scan session is unreadable/],
    [movement.movementStorageKey(accountId, 'demo', 'checkout'), 'not JSON', /request is unreadable/],
    [movement.movementStorageKey(accountId, 'demo', 'checkout'), JSON.stringify(foreignMovement), /different account context/],
    [intake.intakeStorageKey(accountId, 'demo'), 'not JSON', /intake draft is unreadable/],
    [intake.intakeStorageKey(accountId, 'live'), 'retained-working-inventory-data', /unsupported working-inventory intake recovery key/],
  ]) { const store = storage([[key, raw]]); assert.throws(() => recovery.readWorkflowRecovery(store, accountId), message); assert.equal(store.getItem(key), raw); assert.equal(store.retained.size, 1); }
  const key = `battery-scan:${accountId}:demo:checkout`, corrupted = pendingSession(); delete corrupted.queue[0].nfcEvidence;
  assert.throws(() => recovery.readWorkflowRecovery(storage([[key, JSON.stringify(corrupted)]]), accountId), /new scanning is blocked/);
});
