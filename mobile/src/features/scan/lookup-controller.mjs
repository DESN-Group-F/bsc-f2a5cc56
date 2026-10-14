import { validateTeachingNfcTag } from '../../shared/lib/teaching-nfc.js';

const copy = value => structuredClone(value);
const identity = battery => battery && typeof battery.id === 'string' && battery.id.length > 0 && typeof battery.name === 'string' && Number.isInteger(battery.version) && battery.version > 0;

/** Read-only service queries. No movement controller, queue, receipt or business draft. */
export function createLookupController({ dataset, accountId, lookup, detail }) {
  if (!['demo', 'live'].includes(dataset) || !accountId) throw new Error('An authenticated inventory context is required.');
  let epoch = 0, abort, disposed = false;
  let state = { phase: 'idle', result: null, input: null, error: '', message: '' };
  const listeners = new Set();
  const emit = patch => { state = { ...state, ...patch }; for (const listener of listeners) listener(); };
  const current = token => !disposed && token === epoch;
  function interrupt() { epoch++; abort?.abort(); abort = null; }
  async function resolve(input) {
    if (disposed) return { type: 'cancelled' };
    if (state.phase === 'resolving') return { type: 'busy' };
    if (state.phase === 'result') return { type: 'duplicate', message: 'Battery details are open. Choose Scan another to continue.' };
    interrupt(); const token = epoch; abort = new AbortController();
    emit({ phase: 'resolving', input: copy(input), result: null, error: '', message: 'Finding recorded battery details…' });
    try {
      let battery;
      if (input.kind === 'tag') {
        const response = await lookup({ tagIds: [input.tagId], source: input.source }, abort.signal);
        if (!current(token)) return { type: 'cancelled' };
        if (response?.source !== input.source || !Array.isArray(response.results) || response.results.length !== 1 || response.results[0]?.tagId !== input.tagId) throw new Error('The tag lookup response could not be verified. No battery was adopted.');
        battery = response.results[0].battery;
        if (battery === null) {
          emit({ phase: 'unknown', message: 'No battery record in this inventory' });
          return { type: 'unknown', message: state.message };
        }
        if (!identity(battery) || battery.tagId !== input.tagId) throw new Error('The returned battery does not match this tag. Try the lookup again.');
      }
      const batteryId = input.kind === 'selection' ? input.batteryId : battery.id;
      const result = await detail(batteryId, abort.signal);
      if (!current(token)) return { type: 'cancelled' };
      if (!identity(result?.battery) || result.battery.id !== batteryId || !Array.isArray(result.events) || input.kind === 'tag' && result.battery.tagId !== input.tagId) throw new Error('The battery detail response could not be verified for this identity. Try the lookup again.');
      emit({ phase: 'result', result: copy(result), message: 'Battery found · No stock changes' });
      return { type: 'accepted', battery: result.battery, message: state.message };
    } catch (failure) {
      if (!current(token)) return { type: 'cancelled' };
      emit({ phase: 'error', error: failure.message || 'Battery lookup is unavailable. Try again.', message: 'Lookup unavailable' });
      return { type:'failure',message:state.error,code:failure.code || 'LOOKUP_UNAVAILABLE',stage:'processing',operation:'lookup',failureKind:'infrastructure',acquisitionId:input.evidence?.attemptId || null,eventId:`lookup:${token}` };
    }
  }
  return {
    getSnapshot: () => state,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    resolveTag(tagId, source, evidence) {
      if (source === 'native_nfc') {
        if (dataset !== 'demo') return Promise.reject(new Error('Working NFC lookup is not enabled. Use inventory search.'));
        validateTeachingNfcTag(evidence, tagId);
      } else if (source !== 'manual' || evidence) return Promise.reject(new Error('Use the original acquisition source. Hardware evidence cannot be relabelled as manual input.'));
      if (typeof tagId !== 'string' || !tagId.trim() || tagId.length > 128) return Promise.reject(new Error('Enter a complete registered tag identifier.'));
      return resolve({ kind: 'tag', tagId, source, ...(evidence ? { evidence: copy(evidence) } : {}) });
    },
    selectBattery(batteryId) {
      if (typeof batteryId !== 'string' || !batteryId) return Promise.reject(new Error('Choose an existing battery record.'));
      return resolve({ kind: 'selection', batteryId });
    },
    retry() { return state.input ? resolve(state.input) : Promise.resolve({ type: 'idle' }); },
    clear() { interrupt(); emit({ phase: 'idle', result: null, input: null, error: '', message: '' }); },
    suspend() { if (state.phase === 'resolving') { interrupt(); emit({ phase: 'error', error: 'Lookup was paused. Retry when the app is active.', message: 'Lookup paused' }); } },
    dispose() { interrupt(); disposed = true; listeners.clear(); },
  };
}
