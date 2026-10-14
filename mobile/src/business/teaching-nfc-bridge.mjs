import { NFC_PREFIX, readNfcProposal, withNfcFailureContext } from './nfc-controller.mjs';

const canonicalUid = /^(?:[0-9A-F]{8}|[0-9A-F]{14}|[0-9A-F]{20})$/;
const copy = value => JSON.parse(JSON.stringify(value));

/** Native adapter output only. Controlled tests of this factory are not hardware acceptance. */
export function createTeachingNfcBridge({ adapter, storage, platform, id = () => crypto.randomUUID(), now = () => new Date().toISOString(), onObserved }) {
  const native = platform === 'ios' || platform === 'android';
  const requireNative = () => { if (!native) throw new Error('Native NFC is unavailable in the browser. Use filtered inventory or exact registered tag input.'); };
  async function getAvailability() {
    if (!native) return { available: false, enabled: false, platform: 'web', reason: 'Native NFC is unavailable in the browser.' };
    const result = await adapter.getAvailability();
    if (result.platform !== platform) throw new Error('The NFC adapter platform does not match this native runtime.');
    return result;
  }
  return {
    getAvailability,
    async read() {
      requireNative();
      const availability = await getAvailability();
      if (!availability.available || !availability.enabled) throw withNfcFailureContext(new Error(availability.reason || 'Native NFC is unavailable or disabled.'), { stage:'setup',operation:'availability',code:availability.available?'DISABLED':'UNAVAILABLE' });
      const proposal = await readNfcProposal({
        adapter: { read: async options => {
          const result = await adapter.read(options);
          // The installed NFC-A adapter declares uppercase bytes in native order.
          // Reject unrelated or malformed identifiers rather than coercing them.
          if (!canonicalUid.test(result?.uidHex || '')) throw Object.assign(new Error('The native reader did not return the complete supported NFC-A UID. No identifier was adopted.'), { code:'INVALID_EVIDENCE' });
          return copy(result);
        } }, storage, id: id(), now, platform, onObserved,
      });
      return { attemptId: proposal.report.id, source: 'native-nfc-reader', platform,
        startedAt: proposal.report.startedAt, endedAt: proposal.report.endedAt,
        tagId: proposal.tagId, result: copy(proposal.report.result) };
    },
    async cancel() { requireNative(); await adapter.cancel(); },
    async adopt(proposal) {
      requireNative();
      try {
      if (!proposal || proposal.platform !== platform || proposal.source !== 'native-nfc-reader') throw new Error('Use a confirmed native read from this runtime.');
      const key = NFC_PREFIX + proposal.attemptId;
      const raw = storage.getItem(key);
      if (!raw) throw new Error('The original device read evidence is unavailable. No alternative was selected.');
      const report = JSON.parse(raw);
      const expected = { attemptId: report.id, source: report.source, platform: report.platform,
        startedAt: report.startedAt, endedAt: report.endedAt,
        tagId: `nfc:uid:${report.result?.uidHex}`, result: report.result };
      if (report.outcome !== 'read' || !canonicalUid.test(report.result?.uidHex || '') || JSON.stringify(expected) !== JSON.stringify(proposal)) throw new Error('The identifier proposal differs from its original saved device read.');
      const evidence = { ...copy(proposal), adoptedAt: now() };
      storage.setItem(key, JSON.stringify({ ...report, adoptions: [...(report.adoptions || []), copy(evidence)] }));
      await storage.flush();
      return evidence;
      } catch (error) { throw withNfcFailureContext(error, { stage:'evidence',operation:'adoption',attemptId:proposal?.attemptId,code:'EVIDENCE_ADOPTION' }); }
    },
  };
}
