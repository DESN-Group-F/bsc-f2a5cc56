import { normalizeUid, canonicalTagId, validateReadResult, partialReadEvidence, validateRetainedPartialEvidence } from '../diagnostics.mjs';
import { MOBILE_BUILD } from '../app/build-info.mjs';
export const NFC_PREFIX = 'preference:nfc-evidence:';
let active = null;
/** Error context is presentation metadata; the original durable report stays unchanged. */
export function withNfcFailureContext(error, { stage, operation, attemptId, failureKind, code } = {}) {
  const failure = new Error(error?.message || (typeof error==='string'?error:'The NFC operation could not be completed.'), { cause:error });
  Object.assign(failure, {
    code:error?.code || code || error?.report?.error?.code || 'READ_FAILED',
    stage:error?.stage || stage,
    operation:error?.operation || operation,
    attemptId:error?.attemptId || error?.report?.id || attemptId || null,
    ...(error?.failureKind || failureKind ? { failureKind:error?.failureKind || failureKind } : {}),
    ...(error?.report ? { report:error.report } : {}),
    ...(error?.status !== undefined ? { status:error.status } : {}),
  });
  return failure;
}
export async function readNfcProposal({ adapter, storage, id, now = () => new Date().toISOString(), platform, onObserved = () => {} }) {
  if (active) throw withNfcFailureContext(new Error('Finish the current NFC read first.'), { stage:'reader',operation:'read',attemptId:id,code:'BUSY' });
  const key = NFC_PREFIX + id;
  const report = { id, source: 'native-nfc-reader', buildVersion: MOBILE_BUILD, ...(platform ? { platform } : {}), startedAt: now(), endedAt: null, outcome: 'pending', result: null, error: null };
  active = id;
  try {
    try { storage.setItem(key, JSON.stringify(report)); await storage.flush(); }
    catch (error) { throw withNfcFailureContext(error, { stage:'evidence',operation:'pending',attemptId:id,code:'EVIDENCE_PERSISTENCE' }); }
    let readFailure;
    try {
      const result = await adapter.read({ timeoutMs: 20000 });
      result.uidHex = normalizeUid(result.uidHex);
      if (!validateReadResult(result)) throw Object.assign(new Error('The NFC reader returned incomplete evidence.'), { code:'INVALID_EVIDENCE' });
      Object.assign(report, { outcome: 'read', result, endedAt: now() });
      // This is neutral observation, before durability or inventory acceptance.
      try { onObserved({ attemptId:id,tagId:canonicalTagId(result.uidHex) }); }
      catch (error) { console.error('NFC observation feedback could not be presented.',error); }
    } catch (error) {
      readFailure=error;
      Object.assign(report, { outcome: /cancel/i.test(error.code || '') ? 'cancelled' : 'failed', endedAt: now(), error: { code: error.code || 'READ_FAILED', message: error.message || 'NFC read failed.' }, ...partialReadEvidence(error) });
    }
    try { storage.setItem(key, JSON.stringify(report)); await storage.flush(); }
    catch (error) { throw withNfcFailureContext(Object.assign(new Error(error.message, { cause:error }), { code:error.code,report }), { stage:'evidence',operation:report.outcome==='read'?'raw':'terminal',attemptId:id,code:'EVIDENCE_PERSISTENCE' }); }
    if (report.outcome !== 'read') throw withNfcFailureContext(Object.assign(new Error(report.error.message, { cause:readFailure }), { code:report.error.code,report }), { stage:'reader',operation:'read',attemptId:id });
    return { report, tagId: canonicalTagId(report.result.uidHex) };
  } finally { active = null; }
}
function validSavedReport(report, key) {
  const timestamp = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value));
  if (!report || typeof report !== 'object' || report.id !== key.slice(NFC_PREFIX.length) || report.source !== 'native-nfc-reader') return false;
  if (!['pending', 'read', 'failed', 'cancelled', 'interrupted'].includes(report.outcome) || !timestamp(report.startedAt)) return false;
  if (!validateRetainedPartialEvidence(report)) return false;
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
