import { test } from 'node:test';
import assert from 'node:assert/strict';
import { teachingNfcEvidenceSchema, validateTeachingNfcTag } from '../work/qa/teaching-nfc.mjs';

const evidence = () => ({ attemptId: '11111111-1111-4111-8111-111111111111', source: 'native-nfc-reader', platform: 'ios', startedAt: '2026-10-08T05:00:00.000Z', endedAt: '2026-10-08T05:00:01.000Z', adoptedAt: '2026-10-08T05:00:03.000Z', tagId: 'nfc:uid:0004AB00', result: { uidHex: '0004AB00', technology: 'Controlled NFC-A adapter evidence', ndefStatus: 'notSupported', capacityBytes: null, records: [], ndefError: 'NDEF unsupported', observedAt: '2026-10-08T05:00:01.000Z' } });

test('native teaching alternative evidence retains full UID bytes, NDEF and explicit adoption', () => {
    const value = evidence();
    value.result.records = [{ tnf: 1, typeHex: '55', idHex: '', payloadHex: '046578616D706C652E636F6D' }];
    assert.deepEqual(validateTeachingNfcTag(value, 'nfc:uid:0004AB00'), value);
    assert.throws(() => validateTeachingNfcTag(value, 'nfc:uid:04AB00'), /registered tag/);
    for (const uidHex of ['0004AB00', '00049F7C62A620', '00010203040506070809']) {
        const candidate = evidence(); candidate.result.uidHex = uidHex; candidate.tagId = 'nfc:uid:' + uidHex;
        assert.equal(teachingNfcEvidenceSchema.safeParse(candidate).success, true);
    }
});

test('teaching NFC evidence cannot infer identity from URLs or silently normalize unrelated UID output', () => {
    for (const uidHex of ['00:04:AB:00', ' 0004AB00', '0004ab00', '04AB00', 'https://example.com/BAT-1', '0004AB0000']) {
        const value = evidence(); value.result.uidHex = uidHex; value.tagId = 'nfc:uid:' + uidHex;
        assert.equal(teachingNfcEvidenceSchema.safeParse(value).success, false);
    }
    for (const mutate of [value => delete value.adoptedAt, value => { value.platform = 'web'; }, value => { value.source = 'manual'; }, value => { value.tagId = 'nfc:uid:FFFFFFFF'; }, value => { value.result.records = [{ tnf: 1, typeHex: '55', idHex: '', payloadHex: 'xyz' }]; }]) {
        const value = evidence(); mutate(value); assert.equal(teachingNfcEvidenceSchema.safeParse(value).success, false);
    }
});
