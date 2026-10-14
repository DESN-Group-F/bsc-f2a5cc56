import { captureLifecycleAttempt, lifecycleFailureStatus, lifecycleStorageKey, recoverLifecycleSession, verifyLifecycleReceipt } from '../../shared/lib/lifecycle-session.js';
import { captureRemovalDraft, recoverRemovalDraft, removalDraftStorageKey } from '../../shared/lib/removal-draft.js';
import { isActiveBattery } from '../../shared/lib/battery-lifecycle.js';
import { mappingBucket } from '../../shared/lib/inventory-mapping.js';
import { validateTeachingNfcTag } from '../../shared/lib/teaching-nfc.js';
import { createTeachingNfcBridge } from '../../business/teaching-nfc-bridge.mjs';
import { withNfcFailureContext } from '../../business/nfc-controller.mjs';

const copy = value => structuredClone(value), message = error => error?.issues?.[0]?.message || error?.message || 'Removal could not be completed.';
export const removalScopeStorageKey = (accountId, dataset) => `battery-removal-scope:${accountId}:${dataset}`;
export function removalEligible(battery) { return !!battery && isActiveBattery(battery) && !battery.loanId; }
export function removalScopeMatches(scope, battery, data, accountId) {
  if (!scope) return true;
  if (scope.kind === 'owner') return scope.id === accountId && battery.ownerAccountId === accountId;
  if (scope.kind === 'holder') return scope.id === accountId && !!battery.loanId && battery.borrowerAccountId === accountId;
  if (scope.kind === 'room') return mappingBucket(battery, data.rooms ?? []) === scope.id;
  if (scope.kind === 'ids') return scope.batteryIds.includes(battery.id);
  return data.teachingGroups?.find(group => group.id === scope.id && group.ownerAccountId === accountId && group.state === 'active')?.batteryIds.includes(battery.id) ?? false;
}
function validateScope(scope, accountId) {
  if (!scope) return null;
  if (!['owner', 'holder', 'room', 'group', 'ids'].includes(scope.kind) || scope.label !== undefined && typeof scope.label !== 'string' || (scope.kind === 'ids' ? !Array.isArray(scope.batteryIds) || scope.batteryIds.some(id => typeof id !== 'string' || !id) : typeof scope.id !== 'string' || !scope.id)) throw new Error('The retained removal boundary is unreadable. Its original evidence is preserved.');
  if (['owner', 'holder'].includes(scope.kind) && scope.id !== accountId) throw new Error('The removal personal boundary belongs to another account.');
  return copy(scope);
}
export function recoverRemovalScope(raw, accountId) {
  if (raw === null) return null;
  if (!raw) throw new Error('The retained removal boundary is unreadable. It has not been replaced.');
  const value = JSON.parse(raw); if (!value) throw new Error('The retained removal boundary is unreadable. It has not been replaced.');
  return validateScope(value, accountId);
}
export function createGuardedRemovalBridge({ adapter, storage, platform, isCurrent, id, now, onReadStart }) {
  const cancelled = () => Object.assign(new Error('Native removal read cancelled before reader activation.'), { code: 'CANCELLED' });
  return createTeachingNfcBridge({ storage, platform, ...(id ? { id } : {}), ...(now ? { now } : {}), adapter: {
    async getAvailability() { if (!isCurrent()) throw cancelled(); const availability = await adapter.getAvailability(); if (!isCurrent()) throw cancelled(); return availability; },
    read(options) { if (!isCurrent()) throw cancelled(); onReadStart?.(); return adapter.read(options); },
    cancel: () => adapter.cancel(),
  } });
}
export async function acquireRemovalNative({ bridge, isCurrent, controller, deviceOnly = false, onEvidence = () => {} }) {
  if (!isCurrent()) return null;
  const proposal = await bridge.read(); if (!isCurrent()) return null;
  onEvidence(proposal); if (deviceOnly) return { deviceOnly: true, proposal };
  const evidence = await bridge.adopt(proposal); if (!isCurrent()) return null;
  return controller.addNative(evidence);
}
/** Dedicated phone removal station. No native lifecycle source is inferred. */
export function createRemovalController({ storage, accountId, dataset, inventory, initialIds = [], teachingGroup, scope, defaultSource = 'manual_selection', write, onChanged = async () => {}, id = () => crypto.randomUUID() }) {
  if (!accountId || !['demo', 'live'].includes(dataset)) throw new Error('Use a signed-in staff account and shared inventory.');
  const key = lifecycleStorageKey(accountId, dataset), draftKey = removalDraftStorageKey(accountId, dataset), scopeKey = removalScopeStorageKey(accountId, dataset), listeners = new Set();
  let data = inventory, running = false, exited = false, unreadable = false, acquisitionPaused = false, revision = 0, storageError = '', error = '', latest = null, completed = [], attempt = null, rejected = false, feedbackSequence = 0, boundary = null, draft;
  const fresh = () => ({ actorAccountId: accountId, dataset, source: !initialIds.length && dataset === 'demo' ? defaultSource : 'manual_selection', kind: 'scrapped', reason: '', destination: '', items: [], selectedIds: [], ...(teachingGroup ? { teachingGroup: { id: teachingGroup.id, version: teachingGroup.version } } : {}) });
  function groupAvailable() { return !draft.teachingGroup || data.teachingGroups?.some(group => group.id === draft.teachingGroup.id && group.version === draft.teachingGroup.version && group.state === 'active' && group.ownerAccountId === accountId); }
  function bindingCurrent(item) {
    const battery = data.batteries.find(battery => battery.id === item.batteryId), group = draft.teachingGroup && data.teachingGroups?.find(group => group.id === draft.teachingGroup.id && group.version === draft.teachingGroup.version && group.ownerAccountId === accountId && group.state === 'active');
    return removalEligible(battery) && battery.version === item.version && battery.tagId === item.tagId && removalScopeMatches(boundary, battery, data, accountId) && (!draft.teachingGroup || group?.batteryIds.includes(item.batteryId));
  }
  function restore() {
    const raw = storage.getItem(key), draftRaw = storage.getItem(draftKey), scopeRaw = storage.getItem(scopeKey);
    attempt = recoverLifecycleSession(raw, accountId, dataset); const restored = recoverRemovalDraft(draftRaw, accountId, dataset);
    if (raw !== null && !attempt || draftRaw !== null && !restored || scopeRaw !== null && !scopeRaw) throw new Error('Retained removal request, draft or boundary is unreadable. It has not been replaced.');
    boundary = scopeRaw !== null ? recoverRemovalScope(scopeRaw, accountId) : validateScope(scope, accountId);
    if (scope && scopeRaw !== null) { const wanted = validateScope(scope, accountId); if (wanted.kind !== boundary?.kind || wanted.id !== boundary?.id || wanted.kind === 'ids' && JSON.stringify(wanted.batteryIds) !== JSON.stringify(boundary.batteryIds)) throw new Error('Resume the original removal boundary before starting another view.'); }
    draft = restored ?? fresh();
    if (teachingGroup && draft.teachingGroup && (teachingGroup.id !== draft.teachingGroup.id || teachingGroup.version !== draft.teachingGroup.version)) throw new Error('Resume the original reviewed teaching group before starting another removal.');
    if (!draft.teachingGroup && boundary?.kind === 'group') { const group = data.teachingGroups?.find(group => group.id === boundary.id && group.ownerAccountId === accountId && group.state === 'active'); if (!group) throw new Error('The own teaching group is unavailable. Its boundary has not been changed.'); draft.teachingGroup = { id: group.id, version: group.version }; }
    if (attempt) {
      if (restored && (restored.source !== attempt.payload.source || JSON.stringify(restored.teachingGroup) !== JSON.stringify(attempt.payload.teachingGroup))) throw new Error('The retained removal request and residual queue have different sources or groups. Both are preserved.');
      const originalIds = new Set(attempt.payload.items.map(item => item.batteryId));
      draft = captureRemovalDraft({ ...draft, source: attempt.payload.source, kind: attempt.payload.kind, reason: attempt.payload.reason, destination: attempt.payload.destination ?? '', teachingGroup: attempt.payload.teachingGroup,
        items: [...draft.items.filter(item => !originalIds.has(item.batteryId)), ...attempt.payload.items.map(item => ({ ...item, name: draft.items.find(saved => saved.batteryId === item.batteryId)?.name ?? data.batteries.find(battery => battery.id === item.batteryId)?.name ?? 'Recorded battery' }))], selectedIds: [...new Set([...draft.selectedIds, ...originalIds])] });
    } else if (!draft.items.length && initialIds.length) {
      const unique = [...new Set(initialIds)]; if (unique.length > 100) throw new Error('A removal queue can contain at most 100 batteries. The existing draft is preserved.');
      draft.items = unique.flatMap(batteryId => { const battery = data.batteries.find(item => item.id === batteryId); return removalEligible(battery) && removalScopeMatches(boundary, battery, data, accountId) && (!draft.teachingGroup || data.teachingGroups?.find(group => group.id === draft.teachingGroup.id && group.version === draft.teachingGroup.version)?.batteryIds.includes(batteryId)) ? [{ batteryId, version: battery.version, tagId: battery.tagId, name: battery.name }] : []; });
      draft.selectedIds = draft.items.map(item => item.batteryId); if (draft.items.length !== unique.length) error = 'Some initial records are in use, retired or outside this fixed boundary. Only eligible records were queued.';
    }
    draft = captureRemovalDraft(draft);
  }
  try { restore(); } catch (failure) { unreadable = true; storageError = message(failure); draft = fresh(); }
  const snapshot = () => ({ draft, attempt, rejected, completed, latest, error, storageError, busy: running, scope: boundary, blocked: exited || unreadable || running || !!attempt || !!storageError || data.dataset !== dataset || data.user?.id !== accountId, staleIds: draft.items.filter(item => !bindingCurrent(item)).map(item => item.batteryId), groupAvailable: groupAvailable() });
  const emit = () => listeners.forEach(listener => listener(snapshot()));
  function editable() { if (snapshot().blocked) throw new Error('Resolve the original removal request or storage issue before changing this queue.'); if (data.dataset !== dataset || data.user?.id !== accountId) throw new Error('The account or inventory changed. Original removal work is preserved.'); }
  async function persist(next) {
    const captured = captureRemovalDraft(next), version = ++revision; draft = captured; emit();
    try { await storage.transact(entries => { entries[draftKey] = JSON.stringify(captured); if (boundary) entries[scopeKey] = JSON.stringify(boundary); }); if (version === revision) storageError = ''; emit(); }
    catch (failure) { storageError = `The removal draft could not be saved: ${message(failure)}`; emit(); throw failure; }
  }
  function feedback(kind, text, context = {}) { latest = { kind,message:text,sequence:++feedbackSequence,...context }; emit(); return latest; }
  async function addBattery(battery, source, nfcEvidence) {
    if (acquisitionPaused) return feedback('paused', 'Acquisition paused; no battery was queued.');
    if (data.dataset !== dataset || data.user?.id !== accountId) throw new Error('The account or inventory changed during acquisition. No battery was queued.');
    if (source !== draft.source) throw new Error('One queue uses one input source. Confirm or clear it before switching.');
    if (draft.items.some(item => item.batteryId === battery.id)) return feedback('duplicate', `${battery.id} is already queued.`);
    if (completed.some(receipt => receipt.items.some(item => item.batteryId === battery.id))) return feedback('duplicate', `${battery.id} was already retired in this station.`);
    if (!removalEligible(battery)) throw new Error('Only active batteries in store can be queued. Return the recorded loan first.');
    if (!groupAvailable() || !removalScopeMatches(boundary, battery, data, accountId) || draft.teachingGroup && !data.teachingGroups.find(group => group.id === draft.teachingGroup.id && group.version === draft.teachingGroup.version)?.batteryIds.includes(battery.id)) throw new Error('The battery is outside this fixed view or the reviewed teaching group changed.');
    if (source !== 'manual_selection' && !battery.tagId) throw new Error('An untagged battery requires Manual selection.');
    if (source === 'native_nfc') validateTeachingNfcTag(nfcEvidence, battery.tagId);
    if (draft.items.length >= 100) throw new Error('Confirm or reduce the queue before adding more than 100 batteries.');
    await persist({ ...draft, items: [...draft.items, { batteryId: battery.id, version: battery.version, tagId: battery.tagId, name: battery.name, ...(source === 'native_nfc' ? { nfcEvidence: copy(nfcEvidence) } : {}) }], selectedIds: [...draft.selectedIds, battery.id] });
    return feedback('accepted', `${battery.id} added. No removal has been saved.`);
  }
  async function acquire(task) {
    try { editable(); if (acquisitionPaused) return null; running = true; error = ''; latest = null; emit(); return await task(); }
    catch (failure) { error = message(failure);const transport=/^(NETWORK_|NATIVE_SERVICE_|RESPONSE_|SECURE_)/.test(failure.code||'');feedback('failure',error,{code:failure.code,stage:failure.stage||'processing',operation:failure.operation||(transport?'lookup':'eligibility'),failureKind:failure.failureKind||(transport?'infrastructure':'tag'),acquisitionId:failure.attemptId||null}); return null; }
    finally { running = false; emit(); }
  }
  async function submit(ids, retry = false) {
    if (running || unreadable || exited || retry && !attempt || rejected) return null;
    if (data.dataset !== dataset || data.user?.id !== accountId) { error = 'Resume the original account and inventory before resolving this request.'; emit(); return null; }
    const original = retry ? attempt : null; let captured = original, sent = false;
    try {
      if (!retry) {
        editable(); if (!groupAvailable()) throw new Error('The reviewed teaching group changed. Reopen its current members before a new removal.');
        if (draft.source === 'native_nfc' && dataset !== 'demo') throw new Error('Native removal business input is demonstration-only pending physical acceptance.');
        const distinct = [...new Set(ids)], items = draft.items.filter(item => distinct.includes(item.batteryId));
        if (!items.length || items.length !== distinct.length || items.some(item => !bindingCurrent(item))) throw new Error('Review 1–100 unchanged eligible queue records within this fixed boundary.');
        captured = captureLifecycleAttempt(accountId, dataset, { requestId: id(), kind: draft.kind, source: draft.source, reason: draft.reason, destination: draft.kind === 'permanently_removed' ? draft.destination || null : null, items: items.map(({ name, ...binding }) => binding), ...(draft.teachingGroup ? { teachingGroup: draft.teachingGroup } : {}) });
      }
      running = true; error = ''; attempt = captured; emit();
      await storage.retryPersistence?.();
      const retained = storage.getItem(key);
      if (retained !== null) { const existing = recoverLifecycleSession(retained, accountId, dataset); if (!existing || JSON.stringify(existing.payload) !== JSON.stringify(captured.payload)) throw new Error('A different original removal is retained. It has not been replaced.'); }
      else await storage.transact(entries => { entries[key] = JSON.stringify(captured); entries[draftKey] = JSON.stringify(draft); if (boundary) entries[scopeKey] = JSON.stringify(boundary); });
      await storage.flush(); if (JSON.stringify(recoverLifecycleSession(storage.getItem(key), accountId, dataset)?.payload) !== JSON.stringify(captured.payload)) throw new Error('Original removal recovery could not be verified. No request was sent.');
      sent = true; const receipt = verifyLifecycleReceipt(await write('lifecycle', copy(captured.payload)), captured);
      const affected = new Set(captured.payload.items.map(item => item.batteryId)), residual = captureRemovalDraft({ ...draft, items: draft.items.filter(item => !affected.has(item.batteryId)), selectedIds: draft.selectedIds.filter(batteryId => !affected.has(batteryId)) });
      await storage.transact(entries => { const existing = recoverLifecycleSession(entries[key], accountId, dataset); if (!existing || JSON.stringify(existing.payload) !== JSON.stringify(captured.payload)) throw new Error('The original removal changed before receipt acknowledgement.'); delete entries[key]; entries[draftKey] = JSON.stringify(residual); entries[`preference:removal-receipt:${receipt.requestId}`] = JSON.stringify(receipt); });
      draft = residual; attempt = null; rejected = false; completed = [...completed, receipt]; storageError = ''; feedback('saved', `${receipt.items.length} ${receipt.items.length === 1 ? 'battery' : 'batteries'} ${receipt.kind === 'scrapped' ? 'scrapped' : 'permanently removed'}. Confirmed by the service.`);
      try { await onChanged(); } catch (failure) { error = `Removal is confirmed. Refresh failed: ${message(failure)}`; }
      return receipt;
    } catch (failure) {
      error = message(failure);
      if (!captured) feedback('failure', error);
      else if (sent && (!original || failure?.code === 'lifecycle_rejected_final') && lifecycleFailureStatus(failure) === 'rejected') { rejected = true; feedback('failure', `The reviewed removal was rejected: ${error}`); }
      else { if (!sent) storageError = `${error} No removal was sent; the original request is retained.`; feedback('failure', `${error} Resolve only the original preserved request.`); }
      return null;
    } finally { running = false; emit(); }
  }
  return {
    snapshot, subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    pause(value) { acquisitionPaused = !!value; },
    setInventory(next) { data = next; emit(); },
    async initialize() { if (!unreadable && !attempt) await persist(draft); },
    add(id) { return acquire(async () => { const battery = data.batteries.find(item => item.id === id); if (!battery) throw new Error('This battery is no longer in the shared register.'); return addBattery(battery, 'manual_selection'); }); },
    addTag(tag) { return acquire(async () => { if (draft.source !== 'tag_entry' || !tag.trim()) throw new Error('Enter one exact registered tag in Tag entry.'); const input = tag.trim(), result = await write('scan_lookup', { tagIds: [input], source: 'manual' }); if (result?.source !== 'manual' || result.results?.length !== 1 || result.results[0].tagId !== input) throw new Error('The registered tag lookup could not be verified.'); const battery = result.results[0].battery; if (!battery) throw new Error('This exact tag is not registered. No battery was queued.'); if (battery.tagId !== input) throw new Error('The saved battery does not retain that exact registered tag.'); return addBattery(battery, 'tag_entry'); }); },
    addNative(evidence) { return acquire(async () => { if (dataset !== 'demo') throw new Error('Native removal business input is demonstration-only pending physical acceptance. Device evidence is separate.'); if (draft.source !== 'native_nfc') throw new Error('Native input cannot be mixed with manual selection or typed tag entry.'); const adopted=validateTeachingNfcTag(evidence,evidence?.tagId);let result;try{result=await write('scan_lookup',{tagIds:[adopted.tagId],source:'native_nfc'});}catch(failure){throw withNfcFailureContext(failure,{stage:'processing',operation:'lookup',attemptId:adopted.attemptId,failureKind:'infrastructure',code:'LOOKUP_UNAVAILABLE'});}if(result?.source!=='native_nfc'||result.results?.length!==1||result.results[0].tagId!==adopted.tagId)throw withNfcFailureContext(new Error('The native registered tag lookup could not be verified.'),{stage:'processing',operation:'lookup',attemptId:adopted.attemptId,failureKind:'infrastructure',code:'LOOKUP_INVALID'}); const battery = result.results[0].battery; if (!battery) throw new Error('The complete native UID is not registered. No battery was queued.'); return addBattery(battery, 'native_nfc', adopted); }); },
    async change(patch) { editable(); if (patch.source && patch.source !== draft.source && draft.items.length) throw new Error('Confirm or clear this queue before changing its input source.'); await persist({ ...draft, ...patch }); },
    async remove(id) { editable(); await persist({ ...draft, items: draft.items.filter(item => item.batteryId !== id), selectedIds: draft.selectedIds.filter(item => item !== id) }); },
    submit, retry() { return submit([], true); },
    async acknowledgeRejected() { if (!rejected || running || unreadable) return; await storage.transact(entries => { const existing = recoverLifecycleSession(entries[key], accountId, dataset); if (!existing || JSON.stringify(existing.payload) !== JSON.stringify(attempt.payload)) throw new Error('The original rejected removal changed. It has not been discarded.'); delete entries[key]; entries[draftKey] = JSON.stringify(draft); }); attempt = null; rejected = false; error = ''; emit(); },
    async retryStorage() { if (unreadable) throw new Error('Unreadable original evidence cannot be overwritten. Export recovery data.'); await storage.retryPersistence(); storageError = ''; emit(); if (!attempt) await persist(draft); },
    async exit() {
      if (snapshot().blocked) throw new Error('Resolve the original request or storage issue before exit.');
      running = true; emit();
      try {
        if (!draft.items.length && !attempt) await storage.transact(entries => { if (entries[key] !== undefined) throw new Error('An original removal request is retained. Resolve it before exit.'); delete entries[draftKey]; delete entries[scopeKey]; });
        else await persist(draft);
        exited = true;
      } catch (failure) { storageError = `Exit could not preserve recovery: ${message(failure)}`; throw failure; }
      finally { running = false; emit(); }
    },
  };
}
