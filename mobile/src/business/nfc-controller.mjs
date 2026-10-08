import { normalizeUid, canonicalTagId, validateReadResult } from '../diagnostics.mjs';
export const NFC_PREFIX = 'preference:nfc-evidence:';
let active = null;
export async function readNfcProposal({ adapter, storage, id, now = () => new Date().toISOString() }) {
  if (active) throw new Error('Finish the current NFC read first.');
  const key = NFC_PREFIX + id;
  const report = { id, source: 'native-nfc-reader', startedAt: now(), endedAt: null, outcome: 'pending', result: null, error: null };
  active = id;
  try {
    storage.setItem(key, JSON.stringify(report)); await storage.flush();
    try {
      const result = await adapter.read({ timeoutMs: 20000 });
      result.uidHex = normalizeUid(result.uidHex);
      if (!validateReadResult(result)) throw new Error('The NFC reader returned incomplete evidence.');
      Object.assign(report, { outcome: 'read', result, endedAt: now() });
    } catch (error) {
      Object.assign(report, { outcome: /cancel/i.test(error.code || '') ? 'cancelled' : 'failed', endedAt: now(), error: { code: error.code || 'READ_FAILED', message: error.message || 'NFC read failed.' } });
    }
    storage.setItem(key, JSON.stringify(report)); await storage.flush();
    if (report.outcome !== 'read') throw Object.assign(new Error(report.error.message), { report });
    return { report, tagId: canonicalTagId(report.result.uidHex) };
  } finally { active = null; }
}
function validSavedReport(report, key) {
  const timestamp = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value));
  if (!report || typeof report !== 'object' || report.id !== key.slice(NFC_PREFIX.length) || report.source !== 'native-nfc-reader') return false;
  if (!['pending', 'read', 'failed', 'cancelled', 'interrupted'].includes(report.outcome) || !timestamp(report.startedAt)) return false;
  if (['pending', 'interrupted'].includes(report.outcome) ? report.endedAt !== null : !timestamp(report.endedAt)) return false;
  if (report.outcome === 'read') return validateReadResult(report.result) && report.error === null;
  if (report.result !== null) return false;
  return report.outcome === 'pending' ? report.error === null : !!report.error && typeof report.error.code === 'string' && typeof report.error.message === 'string';
}
export function recoverNfcEvidence(storage) {
  const reports = Object.entries(storage.entries()).filter(([key])=>key.startsWith(NFC_PREFIX)).map(([key,raw])=>[key,JSON.parse(raw)]);
  for (const [key, report] of reports) if (!validSavedReport(report, key)) throw new Error('Saved NFC evidence is unreadable. It has not been replaced; export recovery data for review.');
  for (const [key, report] of reports) {
    if (report.outcome === 'pending') storage.setItem(key, JSON.stringify({ ...report, outcome: 'interrupted', error: { code: 'APP_INTERRUPTED', message: 'App closed before a confirmed NFC result. No read has been invented.' } }));
  }
}
