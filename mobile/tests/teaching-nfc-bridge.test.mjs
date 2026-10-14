import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTeachingNfcBridge } from '../src/business/teaching-nfc-bridge.mjs';
import { NFC_PREFIX } from '../src/business/nfc-controller.mjs';
import { createDurableStorage } from '../src/platform/durable-storage.mjs';

const attemptId = '11111111-1111-4111-8111-111111111111';
const result = () => ({ uidHex: '0004AB00', technology: 'Controlled NFC-A adapter output', ndefStatus: 'readWrite', capacityBytes: 144, records: [{ tnf: 1, typeHex: '55', idHex: '', payloadHex: '046578616D706C652E636F6D' }], observedAt: '2026-10-08T05:00:01.000Z' });
async function fixture({ platform = 'ios', read = async () => result(), save = async () => {} } = {}) {
    let raw = null, reads = 0, cancels = 0;
    const storage = createDurableStorage({ load: async () => raw, save: async value => { await save(value); raw = value; } }); await storage.initialize();
    const adapter = { getAvailability: async () => ({ available: true, enabled: true, platform }), read: async options => { reads++; return read(options); }, cancel: async () => { cancels++; } };
    const bridge = createTeachingNfcBridge({ adapter, storage, platform, id: () => attemptId, now: () => '2026-10-08T05:00:03.000Z' });
    return { bridge, storage, reads: () => reads, cancels: () => cancels };
}

test('controlled native bridge preserves read evidence and only explicit adoption yields business source evidence', async () => {
    for (const platform of ['ios', 'android']) {
        const { bridge, storage, reads } = await fixture({ platform });
        const proposal = await bridge.read();
        assert.equal(reads(), 1); assert.equal(proposal.tagId, 'nfc:uid:0004AB00'); assert.deepEqual(proposal.result, result());
        assert.equal(proposal.adoptedAt, undefined);
        assert.equal(JSON.parse(storage.getItem(NFC_PREFIX + attemptId)).adoptions, undefined);
        const evidence = await bridge.adopt(proposal);
        assert.equal(evidence.platform, platform); assert.equal(evidence.adoptedAt, '2026-10-08T05:00:03.000Z');
        assert.deepEqual(JSON.parse(storage.getItem(NFC_PREFIX + attemptId)).adoptions, [evidence]);
        await assert.rejects(bridge.adopt({ ...proposal, tagId: 'nfc:uid:FFFFFFFF' }), /differs/);
        // Controlled injected adapters do not establish physical NFC acceptance.
    }
});

test('bridge rejects malformed native UID without guessing identity from its NDEF URL', async () => {
    for (const uidHex of ['00:04:AB:00', '0004ab00', '0004AB', 'https://example.com']) {
        const { bridge, storage } = await fixture({ read: async () => ({ ...result(), uidHex }) });
        await assert.rejects(bridge.read(), /complete supported NFC-A UID/);
        const report = JSON.parse(storage.getItem(NFC_PREFIX + attemptId));
        assert.equal(report.outcome, 'failed'); assert.equal(report.result, null);
    }
});

test('controlled cancelled/failed reads retain attempts and do not propose alternatives', async () => {
    for (const [code, outcome] of [['CANCELLED', 'cancelled'], ['TIMEOUT', 'failed'], ['READ_FAILED', 'failed']]) {
        const { bridge, storage, cancels } = await fixture({ read: async () => { throw Object.assign(new Error('Controlled ' + code), { code }); } });
        await assert.rejects(bridge.read(), /Controlled/);
        assert.equal(JSON.parse(storage.getItem(NFC_PREFIX + attemptId)).outcome, outcome);
        await bridge.cancel(); assert.equal(cancels(), 1);
    }
});

test('NFC read and adoption both wait for durable storage and fail closed on denied saves', async () => {
    const blocked = await fixture({ save: async () => { throw new Error('Controlled save denial'); } });
    await assert.rejects(blocked.bridge.read(), /save denial/); assert.equal(blocked.reads(), 0);
    let saves = 0;
    const adoption = await fixture({ save: async () => { if (++saves === 3) throw new Error('Controlled adoption save denial'); } });
    const proposal = await adoption.bridge.read();
    await assert.rejects(adoption.bridge.adopt(proposal), /adoption save denial/);
});

test('browser bridge reports unavailable and never starts a controlled native adapter', async () => {
    const { bridge, reads } = await fixture({ platform: 'web' });
    assert.deepEqual(await bridge.getAvailability(), { available: false, enabled: false, platform: 'web', reason: 'Native NFC is unavailable in the browser.' });
    await assert.rejects(bridge.read(), /unavailable in the browser/);
    await assert.rejects(bridge.adopt({}), /unavailable in the browser/);
    assert.equal(reads(), 0);
});
