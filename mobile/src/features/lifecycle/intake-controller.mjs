import { captureIntakeDraft, recoverIntakeDraft } from '../../shared/lib/intake-draft.js';
import { captureIntakeAttempt, intakeCommonSchema, intakeFailureStatus, intakePayloadSchema, intakeStorageKey, verifyIntakeReceipt } from '../../shared/lib/intake-session.js';
import { currentSydneyDate } from '../../shared/lib/battery-age.js';
import { dateOnlyOrNull, numberOrNull } from '../../shared/lib/client-utils.js';
import { isSelectableRoom } from '../../shared/lib/location-catalog.js';
import { validateTeachingNfcTag } from '../../shared/lib/teaching-nfc.js';
import { intakeConfigurationFailure, loadIntakeModelChoices, verifyIntakeModelSelection } from './intake-validation.mjs';

export const intakeError = error => (error?.issues?.[0]?.message || error?.message || 'Intake could not be completed.').slice(0, 4000);
export const intakeStringFields = common => Object.fromEntries(Object.entries(common || {}).filter(([key]) => key !== 'modelSelection').map(([key, value]) => [key, value === null ? '' : String(value)]));
export const intakeEntrySource = entry => entry.source === 'native_nfc' ? 'native_nfc' : 'simulated_intake';
export function intakeDefaultValues(data, accountId) {
  return { name: '', model: '', chemistry: '', capacityMah: '', voltage: '', ownerId: data.people.find(person => person.role === 'staff' && person.accountId === accountId && data.staffDirectory.some(account => account.id === accountId && account.active))?.id || '', homeBuildingId: 'J18', homeRoomId: '', manufacturedOn: '', firstUsedOn: '' };
}
export function reviewedIntakeCommon(data, values, firstUseMode, modelSelection, today = currentSydneyDate()) {
  const field = name => String(values[name] ?? '');
  const common = intakeCommonSchema.parse({ name: field('name'), model: field('model'), chemistry: field('chemistry'), capacityMah: numberOrNull(field('capacityMah'), 'Capacity'), voltage: numberOrNull(field('voltage'), 'Nominal voltage'), ownerId: field('ownerId'), homeBuildingId: field('homeBuildingId'), homeRoomId: field('homeRoomId') || null, manufacturedOn: dateOnlyOrNull(field('manufacturedOn'), 'Manufacture date'), firstUsedOn: firstUseMode === 'date' ? dateOnlyOrNull(field('firstUsedOn'), 'First-use date') : null, ...(modelSelection ? { modelSelection } : {}) });
  if (common.homeBuildingId !== 'J18') throw new Error('Choose J18 for new intake.');
  const person = data.people.find(item => item.id === common.ownerId && item.role === 'staff' && item.accountId);
  if (!person || !data.staffDirectory.some(account => account.id === person.accountId && account.active)) throw new Error('Choose an active native staff account as the responsible owner.');
  if (common.homeRoomId && !data.rooms.some(room => room.id === common.homeRoomId && isSelectableRoom(room))) throw new Error('Choose a selectable J18 room, or leave it unspecified.');
  if (common.manufacturedOn && common.manufacturedOn > today || common.firstUsedOn && common.firstUsedOn > today) throw new Error('Recorded battery dates cannot be in the future.');
  if (common.manufacturedOn && common.firstUsedOn && common.firstUsedOn < common.manufacturedOn) throw new Error('The first-use date cannot precede manufacture.');
  if (firstUseMode === 'date' && !common.firstUsedOn) throw new Error('Record the known first-use date, or choose registration date / unknown.');
  return common;
}

/** Device-local intentions using the established demonstration intake contract. */
export function createIntakeController({ storage, data, accountId, dataset = 'demo', write, onChanged = async () => {}, onQueueAccepted = () => {}, readModels = loadIntakeModelChoices, id = () => crypto.randomUUID(), now = () => new Date().toISOString() }) {
  if (dataset !== 'demo' || !accountId) throw new Error('Batch intake accepts Demonstration inventory and a signed-in staff account only.');
  const key = intakeStorageKey(accountId, dataset), listeners = new Set();
  let inventory = data, running = false, unreadable = false, storageError = '', exited = false, validatedSessionId = null;
  const fresh = () => ({ actorAccountId: accountId, dataset, batch: null, entries: [], attempt: null, attemptEntryId: null, completed: [] });
  let draft;
  function recover() {
    const raw = storage.getItem(key), restored = recoverIntakeDraft(raw, accountId, dataset);
    if (raw !== null && !restored) throw new Error('Saved intake recovery is unreadable or belongs to another account. It has been retained unchanged.');
    return restored || fresh();
  }
  try { draft = recover(); } catch (error) { draft = fresh(); unreadable = true; storageError = intakeError(error); }
  const snapshot = () => ({ draft, busy: running, storageError, blocked: exited || running || unreadable || !!storageError || !!draft.attempt });
  const emit = () => listeners.forEach(listener => listener(snapshot()));
  async function persist(value, atomic = false, accepted = null) {
    if (unreadable) throw new Error(storageError);
    const next = captureIntakeDraft(value), raw = JSON.stringify(next);
    try {
      if (atomic) {
        if (!storage.transact) throw new Error('Atomic durable intake acknowledgement is unavailable. The original request is retained.');
        const original = draft.attempt;
        await storage.transact(entries => {
          const saved = recoverIntakeDraft(entries[key] ?? null, accountId, dataset);
          if (!saved || JSON.stringify(saved.attempt) !== JSON.stringify(original) || saved.attemptEntryId !== draft.attemptEntryId) throw new Error('The original intake request changed. It has not been acknowledged.');
          entries[key] = raw;
        });
      } else { storage.setItem(key, raw); await storage.flush?.(); }
      if (storage.getItem(key) !== raw) throw new Error('The complete intake draft could not be read back from recovery storage.');
      draft = next; storageError = '';
      if (accepted) { try { onQueueAccepted(accepted); } catch (error) { console.error('Intake feedback could not be presented.',error); } }
      emit();
    } catch (error) {
      if (!atomic) draft = next;
      storageError = `Recovery storage is not confirmed. ${intakeError(error)} Original work is retained.`;
      emit(); throw error;
    }
  }
  async function exclusive(work, recovery = false) {
    if (exited || running || unreadable || storageError || draft.attempt && !recovery) throw new Error(storageError || 'Resolve the original intake confirmation before changing drafts or starting another registration.');
    running = true; emit(); try { return await work(); } finally { running = false; emit(); }
  }
  function tagProblem(tag, excludingId) {
    if (draft.entries.some(entry => entry.id !== excludingId && entry.tagId === tag)) return 'Already in review';
    if (draft.completed.some(receipt => receipt.tagId === tag) || inventory.batteries.some(battery => battery.tagId === tag)) return 'Already registered';
    return '';
  }
  function common(values, mode, model) { return reviewedIntakeCommon(inventory, values, mode, model, currentSydneyDate(new Date(now()))); }
  async function validateCommon(values,mode,selection) {
    try {
      const reviewed = common(values,mode,selection);
      if (selection) verifyIntakeModelSelection(selection,await readModels(dataset));
      // Directory data may have changed while the model request was in flight.
      common(values,mode,selection);
      return reviewed;
    } catch (failure) { throw intakeConfigurationFailure(failure); }
  }
  async function validateBatch() {
    if (snapshot().blocked || !draft.batch) throw new Error(storageError || 'Resolve protected work and prepare batch details before continuing.');
    const batch = draft.batch;
    await validateCommon(intakeStringFields(batch.common),batch.firstUseMode,batch.common.modelSelection);
    if (draft.batch !== batch || snapshot().blocked) throw new Error('The batch changed while checking its details. Review the current saved batch.');
    validatedSessionId = batch.sessionId;
    return batch;
  }
  async function processEntry(entryId, original, retry = false) {
    const entry = draft.entries.find(item => item.id === entryId);
    if (!entry) throw new Error('This pending draft is unavailable.');
    const attempt = original || captureIntakeAttempt(accountId, dataset, { requestId: id(), sessionId: entry.sessionId, tagId: entry.tagId, ...(entry.scannedAt ? { scannedAt: entry.scannedAt } : {}), common: entry.common, firstUseMode: entry.firstUseMode, ...(entry.source ? { source: entry.source } : {}), ...(intakeEntrySource(entry) === 'native_nfc' ? { nfcEvidence: entry.nfcEvidence } : {}) });
    await persist({ ...draft, attempt, attemptEntryId: entryId });
    let receipt;
    try { receipt = verifyIntakeReceipt(await write('intake', attempt.payload), attempt); }
    catch (error) {
      // After an uncertain result, ordinary HTTP errors cannot release its key.
      const final = retry ? error?.code === 'intake_rejected_final' : intakeFailureStatus(error) === 'rejected';
      const reason = (final ? intakeError(error) : `Result uncertain. ${intakeError(error)} Retry only the original captured confirmation.`).slice(0, 4000);
      await persist({ ...draft, entries: draft.entries.map(item => item.id === entryId ? { ...item, error: reason } : item), ...(final ? { attempt: null, attemptEntryId: null } : {}) }, final);
      return { type: final ? 'rejected' : 'uncertain', entryId, message: reason };
    }
    await persist({ ...draft, entries: draft.entries.filter(item => item.id !== entryId), completed: draft.completed.some(item => item.requestId === receipt.requestId) ? draft.completed : [...draft.completed, receipt], attempt: null, attemptEntryId: null }, true);
    return { type: 'saved', receipt, message: `${receipt.name} · Registered as ${receipt.batteryId}${receipt.replayed ? ' · Original result recovered' : ''}` };
  }
  return {
    key, getSnapshot: snapshot, subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); }, updateInventory(value) { inventory = value; },
    validateBatch,
    async prepare(values, mode = 'at_registration', model = null) { return exclusive(async () => { const reviewed = await validateCommon(values, mode, model); await persist({ ...draft, batch: { sessionId: id(), common: reviewed, firstUseMode: mode, ...(draft.entries[0]?.source === 'native_nfc' ? { source: 'native_nfc' } : {}) } }); validatedSessionId=draft.batch.sessionId; return { type: 'prepared', message: 'Common details are ready. Scanning stages drafts; registration still requires review.' }; }); },
    async changeCommon() { return exclusive(async () => { await persist({ ...draft, batch: null }); validatedSessionId=null; }); },
    async addTag(identifier, nfcEvidence, current = () => true) { return exclusive(async () => {
      if (!draft.batch) throw new Error('Review common details before staging a demonstration draft.');
      const tag = String(identifier).trim();
      const source = nfcEvidence ? 'native_nfc' : 'simulated_intake';
      if (source === 'native_nfc') validateTeachingNfcTag(nfcEvidence, tag);
      if (draft.entries.length && intakeEntrySource(draft.entries[0]) !== source) throw new Error('Use one input source per intake queue. Confirm or remove the current drafts before changing sources.');
      const problem = tagProblem(tag);
      if (problem) return { type: 'duplicate', message: `${tag} · ${problem}` };
      if (draft.entries.length >= 200) throw new Error('Review at most 200 intake drafts. Confirm or remove entries before adding another.');
      if(validatedSessionId!==draft.batch.sessionId)throw intakeConfigurationFailure(new Error('Review the saved batch and continue with its details before scanning.'));
      try{common(intakeStringFields(draft.batch.common),draft.batch.firstUseMode,draft.batch.common.modelSelection);}catch(failure){validatedSessionId=null;throw intakeConfigurationFailure(failure);}
      if (!current()) throw Object.assign(new Error('This read is no longer active. Its device evidence is retained.'),{code:'CANCELLED'});
      const checked = intakePayloadSchema.parse({ requestId: id(), sessionId: draft.batch.sessionId, tagId: tag, scannedAt: nfcEvidence ? nfcEvidence.endedAt : now(), common: draft.batch.common, firstUseMode: draft.batch.firstUseMode, ...(nfcEvidence ? { source: 'native_nfc', nfcEvidence } : {}) });
      const entry = { id: id(), sessionId: checked.sessionId, tagId: checked.tagId, scannedAt: checked.scannedAt, common: checked.common, firstUseMode: checked.firstUseMode, selected: true, error: '', ...(nfcEvidence ? { source: 'native_nfc', nfcEvidence: structuredClone(nfcEvidence) } : {}) };
      const batch = { ...draft.batch }; delete batch.source;
      const result = { type: 'accepted', battery: { id: entry.tagId, name: entry.common.name }, message: `${entry.common.name} · Added to review` };
      await persist({ ...draft, batch: { ...batch, ...(source === 'native_nfc' ? { source } : {}) }, entries: [...draft.entries, entry] },false,{...result,acquisitionId:nfcEvidence?.attemptId});
      return result;
    }); },
    async select(ids, selected) { return exclusive(() => persist({ ...draft, entries: draft.entries.map(entry => ids.includes(entry.id) ? { ...entry, selected } : entry) })); },
    async only(entryId) { return exclusive(async () => { if (!draft.entries.some(entry => entry.id === entryId)) throw new Error('This pending draft is unavailable.'); await persist({ ...draft, entries: draft.entries.map(entry => ({ ...entry, selected: entry.id === entryId })) }); }); },
    async remove(entryId) { return exclusive(() => persist({ ...draft, entries: draft.entries.filter(entry => entry.id !== entryId) })); },
    async edit(entryId, values, mode, model) { return exclusive(async () => {
      const entry = draft.entries.find(item => item.id === entryId); if (!entry) throw new Error('This intake draft is unavailable.');
      const tag = String(values.tagId || '').trim(), problem = tagProblem(tag, entryId); if (problem) throw new Error(`${tag} · ${problem}`);
      const reviewed = await validateCommon(values, mode, model), changed = JSON.stringify(reviewed) !== JSON.stringify(entry.common) || mode !== entry.firstUseMode;
      const next = { ...entry, tagId: tag, common: reviewed, firstUseMode: mode, sessionId: changed ? id() : entry.sessionId, error: '' };
      intakePayloadSchema.parse({ requestId: id(), sessionId: next.sessionId, tagId: next.tagId, ...(next.scannedAt ? { scannedAt: next.scannedAt } : {}), common: next.common, firstUseMode: next.firstUseMode, ...(next.source ? { source: next.source } : {}), ...(intakeEntrySource(next) === 'native_nfc' ? { nfcEvidence: next.nfcEvidence } : {}) });
      await persist({ ...draft, entries: draft.entries.map(item => item.id === entryId ? next : item) }); return { type: 'edited', message: 'Draft updated. Its original demonstration scan time is retained.' };
    }); },
    async confirm(ids) { return exclusive(async () => {
      const requested = [...new Set(ids)], known = draft.entries.filter(entry => requested.includes(entry.id));
      if (!known.length || known.length !== requested.length) throw new Error('Review the pending drafts before choosing entries to register.');
      const outcomes = [];
      for (const entry of known) { const result = await processEntry(entry.id); outcomes.push(result); if (result.type === 'uncertain') break; }
      if (outcomes.some(result => result.type === 'saved')) { try { await onChanged(); } catch { outcomes.push({ type: 'notice', message: 'Registration receipts are confirmed. Shared inventory refresh is unavailable.' }); } }
      return outcomes;
    }); },
    async retry() { return exclusive(async () => { if (!draft.attempt || !draft.attemptEntryId) throw new Error('There is no original confirmation to retry.'); const result = await processEntry(draft.attemptEntryId, structuredClone(draft.attempt), true); if (result.type === 'saved') { try { await onChanged(); } catch { result.message += ' Shared inventory refresh is unavailable.'; } } return result; }, true); },
    async retryStorage() { if (running || exited) throw new Error('Wait for the current operation.'); running = true; emit(); try { await storage.retryPersistence?.(); if (unreadable) { const recovered = recover(); unreadable = false; draft = recovered; } await persist(draft); } finally { running = false; emit(); } },
    canExit() { return !exited && !running && !unreadable && !storageError && !draft.attempt; },
    async exit() {
      if (!this.canExit()) throw new Error(storageError || 'Resolve the original confirmation before exiting intake.');
      running = true; emit();
      try {
        if (draft.entries.length) await persist(draft);
        else {
          if (!storage.transact) throw new Error('Atomic durable intake exit is unavailable. Recovery has been retained.');
          const original = storage.getItem(key); await storage.flush?.();
          await storage.transact(entries => {
            if ((entries[key] ?? null) !== original) throw new Error('The intake recovery record changed. Exit is blocked.');
            const saved = recoverIntakeDraft(original, accountId, dataset);
            if (original !== null && !saved || saved?.entries.length || saved?.attempt) throw new Error('Retained intake work is not empty. It has not been removed.');
            for (const receipt of saved?.completed || []) {
              const receiptKey = `preference:intake-receipt:${receipt.requestId}`, receiptRaw = JSON.stringify(receipt);
              if (Object.hasOwn(entries, receiptKey) && entries[receiptKey] !== receiptRaw) throw new Error('A retained intake receipt differs from this station. Its history has not been replaced.');
              entries[receiptKey] = receiptRaw;
            }
            delete entries[key];
          });
          if (storage.getItem(key) !== null) throw new Error('Empty intake recovery was not durably acknowledged. Exit is blocked.');
        }
        exited = true;
      } catch (error) { storageError = `Recovery storage is not confirmed. ${intakeError(error)} Original work is retained.`; throw error; }
      finally { running = false; emit(); }
    },
  };
}
