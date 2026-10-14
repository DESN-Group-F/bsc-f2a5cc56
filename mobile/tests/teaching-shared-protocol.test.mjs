import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import ts from 'typescript';
import { createDurableStorage } from '../src/platform/durable-storage.mjs';
import * as requests from '../src/shared/lib/client/teaching-checkout-request.js';
import * as drafts from '../src/shared/lib/client/teaching-checkout-draft.js';
import { inventoryResponse } from '../src/shared/lib/client/inventory-request.js';

const digest = value => createHash('sha256').update(value).digest('hex');
const shared = new URL('../src/shared/', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('source-manifest.json', shared), 'utf8'));
const source = await readFile(new URL('components/inventory/teaching-checkout-dialog.js', shared), 'utf8');
const tree = ts.createSourceFile('teaching-checkout-dialog.js', source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS);
const declarations = new Map();
function collect(node) { if (ts.isFunctionDeclaration(node) && node.name) declarations.set(node.name.text, node.getText(tree)); ts.forEachChild(node, collect); }
collect(tree);
const at = '2026-10-08T06:00:00.000Z';
const evidence = () => ({ attemptId: crypto.randomUUID(), source: 'native-nfc-reader', platform: 'android', startedAt: at, endedAt: at, adoptedAt: at, tagId: 'nfc:uid:0004AB00', result: { uidHex: '0004AB00', technology: 'Controlled NFC-A adapter', ndefStatus: 'notSupported', capacityBytes: null, records: [], observedAt: at } });
const payload = () => ({ action: 'checkout', requestId: crypto.randomUUID(), teachingGroup: { id: crypto.randomUUID(), version: 1 }, personalScope: 'all', mappings: [{ original: { batteryId: 'ORIGINAL', tagId: 'original-tag', version: 1 }, actual: { batteryId: 'ACTUAL', tagId: 'nfc:uid:0004AB00', version: 1 }, originalLoanId: crypto.randomUUID(), method: 'manual', source: { kind: 'native_nfc', evidence: evidence() } }] });
const snapshot = binding => ({ ...binding, name: binding.batteryId, model: '', chemistry: '', capacityMah: null, voltage: null, homeBuildingId: 'J18', homeRoomId: null, homeRoomName: null, homeRoomIsPlaceholder: null });
function receipt(attempt) {
    const value = attempt.payload;
    const run = { id: value.requestId, dataset: 'demo', actorAccountId: 'teacher', actorName: 'Teacher', teachingGroup: { ...value.teachingGroup, name: 'Controlled class group', ownerAccountId: 'teacher', operationId: value.requestId, batteryIds: ['ACTUAL'] }, requestedBatteryIds: ['ORIGINAL'], mappings: value.mappings.map(mapping => ({ original: snapshot(mapping.original), actual: snapshot(mapping.actual), originalLoanId: mapping.originalLoanId, method: mapping.method, source: mapping.source, loanId: crypto.randomUUID(), specificationMatch: false, differences: ['model: unknown information', 'chemistry: unknown information', 'capacityMah: unknown information', 'voltage: unknown information'] })), createdAt: at };
    return { requestId: value.requestId, actorAccountId: 'teacher', dataset: 'demo', action: 'checkout', run, at };
}

test('latest mobile snapshot includes teaching protocols, recovery, native input and safe client graph with verified output hashes', async () => {
    for (const expected of ['lib/client/teaching-checkout-request.js', 'lib/client/teaching-checkout-draft.js', 'lib/client/teaching-checkout-download.js', 'lib/teaching-checkouts.js', 'lib/teaching-checkout-selection.js', 'lib/teaching-nfc.js', 'components/inventory/teaching-checkout-dialog.js', 'components/inventory/teaching-checkout-runs.js', 'components/inventory/teaching-nfc-input.js']) assert.ok(manifest.files.some(file => file.path === expected), expected);
    for (const file of manifest.files) {
        assert.equal(/^(?:db|lib\/server|app\/api)\//.test(file.source), false, file.source);
        assert.equal(digest(await readFile(new URL(file.path, shared))), file.sha256, file.path);
        if (file.path.endsWith('.js')) assert.doesNotMatch(await readFile(new URL(file.path, shared), 'utf8'), /(?:from\s+|import\s*\()['"](?:cloudflare:|node:|next\/)/, file.path);
    }
    assert.match(source, /export function TeachingCheckoutDialog\(props\).*WorkflowBoundary/);
    assert.match(source, /await storage\.transact/);
    assert.match(source, /await acknowledgeConfirmedTeachingRequest\(false\)/);
    assert.match(source, /async function discardRejected\(\)[\s\S]*?await acknowledgeConfirmedTeachingRequest\(\)/);
});

test('actual synchronized teaching handlers atomically acknowledge receipt and retain complete original source after failed durable save', async t => {
    const prior = Object.getOwnPropertyDescriptor(globalThis, 'window');
    t.after(() => { if (prior) Object.defineProperty(globalThis, 'window', prior); else delete globalThis.window; });
    const data = { dataset: 'demo', user: { id: 'teacher' } }, key = requests.teachingCheckoutStorageKey('teacher', 'demo'), draftKey = drafts.teachingCheckoutDraftStorageKey('teacher', 'demo');
    let raw = null, denyAcknowledgement = false;
    const storage = createDurableStorage({ load: async () => raw, save: async value => { const entries = JSON.parse(value).entries; if (denyAcknowledgement && !entries[key]) throw new Error('Controlled atomic acknowledgement denial'); raw = value; } });
    await storage.initialize();
    const window = new EventTarget(); window.__batteryWorkflowStorage = storage; globalThis.window = window;
    const original = requests.captureTeachingCheckoutAttempt('teacher', 'demo', payload());
    storage.setItem(draftKey, 'original-reviewed-draft'); requests.persistTeachingCheckoutAttempt('teacher', 'demo', original); await storage.flush();
    denyAcknowledgement = true;
    const sent = [], closed = [], changed = [], states = [], messages = [], captured = { current: original };
    const bindings = { ...requests, ...drafts, inventoryResponse, data, window, captured, recovery: { blocked: false }, mounted: { current: true }, finished: { current: false }, running: { current: false }, setBusy() {}, setMessage: value => messages.push(value), setAttempt: value => states.push(value), onClose: () => closed.push(true), onChanged: async () => changed.push(true), fetch: async (path, options) => {
        const persisted = JSON.parse(raw).entries;
        assert.ok(persisted[key]); assert.ok(persisted[draftKey]);
        const body = JSON.parse(options.body); sent.push({ path, body });
        return { ok: true, status: 200, json: async () => ({ result: receipt(captured.current) }) };
    } };
    const names = Object.keys(bindings);
    const functions = ['flushRecoveryStorage', 'persist', 'acknowledgeConfirmedTeachingRequest', 'send'].map(name => { assert.ok(declarations.has(name), name); return declarations.get(name); }).join('\n');
    const execute = new Function(...names, functions + '\nreturn send;')(...names.map(name => bindings[name]));
    await execute(original, false);
    assert.equal(sent.length, 1); assert.equal(closed.length, 0); assert.equal(changed.length, 0); assert.equal(captured.current.status, 'uncertain');
    assert.deepEqual(requests.recoverTeachingCheckoutAttempt(JSON.parse(raw).entries[key], 'teacher', 'demo').payload, original.payload);
    const retained = JSON.parse(storage.exportRaw()).current.entries;
    assert.ok(retained[key]); assert.equal(retained[draftKey], 'original-reviewed-draft');
    assert.ok(messages.some(value => value.includes('storage')));
    denyAcknowledgement = false; await storage.retryPersistence(); await execute(captured.current, true);
    assert.deepEqual(sent[1], sent[0]); assert.equal(closed.length, 1); assert.equal(changed.length, 1); assert.equal(captured.current, null);
    assert.equal(storage.getItem(key), null); assert.equal(storage.getItem(draftKey), null); assert.deepEqual(JSON.parse(raw).entries, {});
});

test('actual mobile teaching download awaits native share and propagates a cancelled or failed save', async t => {
    const names = ['window', 'fetch'], prior = Object.fromEntries(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
    t.after(() => { for (const name of names) { if (prior[name]) Object.defineProperty(globalThis, name, prior[name]); else delete globalThis[name]; } });
    const value = requests.captureTeachingCheckoutAttempt('teacher', 'demo', payload()), result = receipt(value);
    const listed = { ...result.run, items: result.run.mappings.map(mapping => ({ batteryId: mapping.actual.batteryId, loanId: mapping.loanId, status: 'outstanding', tagId: mapping.actual.tagId, version: mapping.actual.version, returnedAt: null })) };
    let release, shareCalls = 0;
    globalThis.window = { __batteryMobileSaveFile: async () => { shareCalls++; await new Promise(resolve => { release = resolve; }); } };
    globalThis.fetch = async () => new Response(JSON.stringify({ metadata: { dataset: 'demo', runId: result.run.id }, tables: { teaching_evidence: [{ snapshot: listed }] } }), { headers: { 'Content-Type': 'application/json', 'Content-Disposition': 'attachment; filename=teaching-checkout-demo.json' } });
    const { downloadTeachingCheckoutReport } = await import('../src/shared/lib/client/teaching-checkout-download.js');
    let resolved = false; const download = downloadTeachingCheckoutReport('demo', result.run.id, 'json').then(() => { resolved = true; });
    for (let pass = 0; pass < 20 && !release; pass++) await new Promise(resolve => setImmediate(resolve));
    assert.equal(shareCalls, 1); assert.equal(resolved, false); release(); await download; assert.equal(resolved, true);
    window.__batteryMobileSaveFile = async () => { throw new Error('Controlled native share cancellation'); };
    await assert.rejects(downloadTeachingCheckoutReport('demo', result.run.id, 'json'), /native share cancellation/);
});
