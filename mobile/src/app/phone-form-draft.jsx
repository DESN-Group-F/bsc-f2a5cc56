import { useEffect, useRef, useState } from 'react';
import { businessStorage } from '../platform/runtime.mjs';
import { clearPhoneFormDraft, readPhoneFormDraft, savePhoneFormDraft } from './phone-form-draft.mjs';
import { Pressable } from './phone-ui.jsx';

/** Only the strictly allowed form fields are durable; captured business requests remain separate. */
export function usePhoneFormDraft({ accountId, dataset, kind, recordId, initial, enabled = true, storage: suppliedStorage }) {
  const scope = { accountId, dataset, kind, recordId }, storage = suppliedStorage ?? businessStorage();
  const [start] = useState(() => {
    const fallback = typeof initial === 'function' ? initial() : initial;
    if (!enabled) return { value: fallback, restored: false, error: '' };
    try { const saved = readPhoneFormDraft(storage, scope); return { value: saved?.data ?? fallback, restored: !!saved, error: '' }; }
    catch (failure) { return { value: fallback, restored: false, error: failure.message }; }
  });
  const [value, update] = useState(start.value), latest = useRef(start.value), mounted = useRef(true);
  const [pending, setPending] = useState(0), [error, setError] = useState(start.error), [restored, setRestored] = useState(start.restored);
  const unreadable = useRef(!!start.error);
  const pendingClear = useRef(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  async function run(operation) {
    if (mounted.current) setPending(count => count + 1);
    try { const result = await operation(); if (mounted.current) setError(''); return result; }
    catch (failure) { if (mounted.current) setError(failure.message); throw failure; }
    finally { if (mounted.current) setPending(count => count - 1); }
  }
  async function save(next = latest.current) {
    if (!enabled) return next;
    if (unreadable.current) throw new Error(start.error);
    if (pendingClear.current) throw new Error('Resolve clearing the previous form draft before another save.');
    return run(() => savePhoneFormDraft(storage, scope, next));
  }
  function setValue(next) {
    if (pendingClear.current) return;
    const captured = typeof next === 'function' ? next(latest.current) : next;
    latest.current = captured; update(captured);
    if (enabled) void save(captured).catch(() => {});
  }
  async function clear(next) {
    if (unreadable.current) throw new Error(start.error);
    const clearing = pendingClear.current ?? { expected: latest.current, next };
    pendingClear.current = clearing;
    if (clearing.next !== undefined) { latest.current = clearing.next; if (mounted.current) update(clearing.next); }
    await run(() => clearPhoneFormDraft(storage, scope, clearing.expected));
    pendingClear.current = null;
    if (mounted.current) setRestored(false);
  }
  async function retry() {
    if (unreadable.current) { const saved = readPhoneFormDraft(storage, scope); unreadable.current = false; if (saved) { latest.current = saved.data; update(saved.data); setRestored(true); } setError(''); return; }
    await run(async () => { if (storage.retryPersistence) await storage.retryPersistence(); });
    if (pendingClear.current) await clear();
    else await save();
  }
  return { value, setValue, pending: pending > 0, error, restored, clearing: !!pendingClear.current, save, clear, retry };
}

export function PhoneFormDraftStatus({ draft }) {
  if (draft.error) return <div className="phone-recovery" role="alert"><p>{draft.clearing ? 'Draft clearing is not confirmed. Retry device storage.' : 'Draft not saved. Keep this page open.'}</p><Pressable className="phone-secondary" onClick={() => { void draft.retry().catch(() => {}); }} disabled={draft.pending}>Retry draft storage</Pressable><details><summary>Storage details</summary><p>{draft.error}</p></details></div>;
  if (draft.restored) return <p className="mobile-phone-caption" role="status">Unsubmitted draft restored. Review before saving.</p>;
  return null;
}
