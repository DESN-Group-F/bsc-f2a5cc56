import { recoverScanSession, resolveRegisteredTagIssues, saveScanSession, verifySavedScanSession, scanCompletedReadMatches, scanFailureStatus, scanMovementPayload, scanReadProblem } from '../../shared/lib/scan-session.js';
import { verifyMovementReceipt } from '../../shared/lib/movement-session.js';
import { isSelectableRoom } from '../../shared/lib/location-catalog.js';
import { validateTeachingNfcTag } from '../../shared/lib/teaching-nfc.js';
import { mappingBucket } from '../../shared/lib/inventory-mapping.js';

const copy = value => structuredClone(value);
const message = error => error instanceof Error ? error.message : 'The operation could not be completed.';
export const scanStorageKey = (account, dataset, kind) => `battery-scan:${account}:${dataset}:${kind}`;
export const acquisitionOf = read => read.acquisition || (read.source === 'native_nfc' ? 'native-nfc-reader' : read.source === 'selection' ? 'selection' : read.source === 'simulated' ? 'simulated' : 'tag');
export const scanSourceLabel = read => acquisitionOf(read) === 'native-nfc-reader' ? 'Native NFC · Device-reported evidence' : read.source === 'selection' ? 'Manual selection' : read.source === 'simulated' ? 'Demonstration simulation' : 'Typed tag input';

function validateScope(scope, accountId) {
  if (scope === undefined || scope === null) return;
  if (!scope || typeof scope !== 'object' || !['owner', 'holder', 'room', 'group', 'ids'].includes(scope.kind) || scope.label !== undefined && typeof scope.label !== 'string') throw new Error('Saved scan scope is unreadable. Its original work has been retained.');
  if (scope.kind === 'ids' ? !Array.isArray(scope.batteryIds) || scope.batteryIds.some(id => typeof id !== 'string' || !id) : typeof scope.id !== 'string' || !scope.id) throw new Error('The fixed scan boundary is invalid.');
  if (['owner', 'holder'].includes(scope.kind) && scope.id !== accountId) throw new Error('Personal scan scope must belong to the authenticated native account.');
  if (scope.kind === 'group' && (!Array.isArray(scope.batteryIds) || scope.batteryIds.some(id => typeof id !== 'string' || !id))) throw new Error('Saved teaching scan membership is unreadable.');
}
export function scanScopeMatches(scope, battery, data, accountId) {
  if (!scope) return true;
  if (scope.kind === 'owner') return scope.id === accountId && battery.ownerAccountId === accountId;
  if (scope.kind === 'holder') return scope.id === accountId && !!battery.loanId && battery.borrowerAccountId === accountId;
  if (scope.kind === 'room') return mappingBucket(battery, data.rooms) === scope.id;
  return ['group', 'ids'].includes(scope.kind) && scope.batteryIds.includes(battery.id);
}

function validateMobileSession(session) {
  if (session.queue.some(read => acquisitionOf(read) !== acquisitionOf(session.queue[0]))) throw new Error('Saved scan input sources are inconsistent. Recovery data has been retained.');
  for (const read of [...session.queue, ...session.completed]) {
    if (read.acquisition !== undefined && !['selection', 'simulated', 'tag', 'native-nfc-reader'].includes(read.acquisition)) throw new Error('Saved acquisition attribution is unreadable.');
    if (acquisitionOf(read) === 'native-nfc-reader') {
      if (read.source !== 'native_nfc') throw new Error('Saved native input has an incompatible service source.');
      validateTeachingNfcTag(read.nfcEvidence, read.tagId);
    }
  }
  return session;
}

/** Validate retained phone attribution and scope before recovery or classification. */
export function recoverMobileScanSession(raw, kind, accountId) {
  const full=recoverScanSession(raw,kind,true);
  if(raw!==null&&!full)throw new Error('Saved scan recovery data is unreadable. It has been kept unchanged.');
  if(full) { validateMobileSession(full);validateScope(full.mobileScope,accountId); }
  return full;
}

/** One mobile review station, using the existing service and exact recovery record. */
export function createScanController({ storage, accountId, dataset, kind, inventory, teachingGroup, scope, write, loadInventory, id = () => crypto.randomUUID(), now = () => new Date().toISOString(), onChanged = async () => {} }) {
  if (!['checkout', 'return'].includes(kind) || !accountId || !['demo', 'live'].includes(dataset)) throw new Error('Use a signed-in staff account, inventory and movement.');
  const key = scanStorageKey(accountId, dataset, kind), listeners = new Set();
  const initialScope = scope?.kind === 'group' ? { ...scope, batteryIds: inventory.teachingGroups?.find(group => group.id === scope.id)?.batteryIds.slice() || [] } : scope ? copy(scope) : undefined;
  validateScope(initialScope, accountId);
  let data = inventory, running = false, storageError = '', unreadable = false, latest = null, exited = false;
  const fresh = () => ({ sessionId: id(), mode: 'batch', room: null, queue: [], completed: [], issues: [], attempt: null, ...(teachingGroup ? { teachingGroup: { id: teachingGroup.id, version: teachingGroup.version } } : {}), ...(initialScope ? { mobileScope: initialScope } : {}) });
  let session;
  function recover() {
    const raw = storage.getItem(key);
    recoverMobileScanSession(raw,kind,accountId);
    const restored = recoverScanSession(raw, kind);
    if (restored && scope && (restored.mobileScope?.kind !== scope.kind || restored.mobileScope?.id !== scope.id || scope.kind === 'ids' && JSON.stringify(restored.mobileScope.batteryIds) !== JSON.stringify(scope.batteryIds))) throw new Error('Resume the original fixed scan boundary before entering another view.');
    if (restored && teachingGroup && (restored.teachingGroup?.id !== teachingGroup.id || restored.teachingGroup?.version !== teachingGroup.version)) throw new Error('Resume the original scan context before entering this teaching group.');
    return restored || fresh();
  }
  try { session = recover(); } catch (error) { session = fresh(); storageError = message(error); unreadable = true; }
  const snapshot = () => ({ session, busy: running, storageError, latest, blocked: exited || running || !!storageError || !!session.attempt || !!session.roomConfirmationRequired });
  const emit = () => listeners.forEach(listener => listener(snapshot()));
  async function persist(next, { acknowledge = false } = {}) {
    if (unreadable) throw new Error(storageError);
    try {
      if (acknowledge && storage.transact) {
        const captured = JSON.stringify(next);
        await storage.transact(entries => { entries[key] = captured; });
        if (storage.getItem(key) !== captured) throw new Error('The saved receipt acknowledgement could not be verified.');
      } else {
        const captured = saveScanSession(storage, key, next);
        await verifySavedScanSession(storage, key, captured);
      }
      session = next; storageError = ''; emit();
    } catch (error) {
      // A failed acknowledgement keeps the original uncertain request in memory.
      if (!acknowledge) session = next;
      storageError = `Recovery storage is not confirmed. ${message(error)} Keep the original work until storage is restored.`;
      emit(); throw error;
    }
  }
  function available() {
    if (exited || running || storageError || session.attempt || session.roomConfirmationRequired) throw new Error(storageError || (exited ? 'This scan station has ended.' : session.attempt ? 'Resolve the original captured request before changing the queue.' : session.roomConfirmationRequired ? 'Confirm a return room or explicitly choose Room unspecified.' : 'Wait for the current operation.'));
  }
  async function exclusive(work, allowAttempt = false) {
    if (exited || running || unreadable || storageError || (!allowAttempt && (session.attempt || session.roomConfirmationRequired))) throw new Error(storageError || 'The scan station is protected. Resolve its current work first.');
    running = true; emit();
    try { return await work(); } finally { running = false; emit(); }
  }
  const group = () => data.teachingGroups?.find(item => item.id === session.teachingGroup?.id && item.version === session.teachingGroup.version);
  async function issue(category, tagId, text, acknowledged = false) {
    await persist({ ...session, issues: [...session.issues, { id: id(), category, tagId, message: text, acknowledged }] });
    return { type: category === 'duplicate' ? 'duplicate' : 'failure', message: text };
  }
  async function addBattery(battery, tagId, source, acquisition, deviceEvidence) {
    if (session.queue.some(read => read.battery.id === battery.id)) return issue('duplicate', tagId || battery.id, `${battery.name || battery.id} · Already in review`, true);
    if (scanCompletedReadMatches(kind, battery, session.completed)) return issue('duplicate', tagId || battery.id, `${battery.name || battery.id} · Already processed`, true);
    if (session.teachingGroup && !group()?.batteryIds.includes(battery.id)) return issue('state', tagId || battery.id, 'This battery is outside the reviewed teaching group, or that group changed. No movement was saved.');
    if (!scanScopeMatches(session.mobileScope, battery, data, accountId)) return issue('state', tagId || battery.id, 'This battery is outside the fixed view that opened this station. No movement was saved.');
    const problem = scanReadProblem(kind, battery, tagId);
    if (problem) return issue('state', tagId || battery.id, `${battery.id}: ${problem}`);
    if (session.queue.length >= 100) return issue('limit', tagId || battery.id, 'Review at most 100 batteries. Confirm or clear this queue before another read.');
    if (session.queue.length && acquisitionOf(session.queue[0]) !== acquisition) return issue('source', tagId || battery.id, 'Use one input source per queue. Confirm or clear this queue before changing sources.');
    const read = { battery: copy(battery), tagId, source, acquisition, readAt: now(), ...(deviceEvidence ? { nfcEvidence: copy(deviceEvidence) } : {}) };
    await persist({ ...session, issues: resolveRegisteredTagIssues(session.issues, tagId, battery), queue: [...session.queue, read] });
    return { type: 'accepted', battery: read.battery, message: `${battery.name || battery.id} · Added to review` };
  }
  async function runAttempt(attempt) {
    const priorStatus = attempt.status;
    await persist({ ...session, attempt: { ...attempt, status: 'uncertain', message: 'Waiting for the server to confirm this exact request.' } });
    let receipt;
    try {
      receipt = verifyMovementReceipt(await write('movement', attempt.payload), attempt.payload, accountId);
    } catch (error) {
      const status = scanFailureStatus(error, priorStatus === 'uncertain');
      const text = status === 'uncertain' ? `Result uncertain. ${message(error)} Retry the same captured request before scanning or exiting.` : message(error);
      const failed = { ...attempt, status, message: text, ...(Number.isInteger(error.status) ? { statusCode: error.status } : {}) };
      await persist({ ...session, attempt: failed, issues: status === 'rejected' && !session.issues.some(item => item.id === attempt.payload.requestId) ? [...session.issues, { id: attempt.payload.requestId, category: 'state', tagId: attempt.reads.map(read => read.tagId || read.battery.id).join(', '), message: text, acknowledged: false }] : session.issues });
      return { type: status, message: text };
    }
    const ids = new Set(attempt.reads.map(read => read.battery.id));
    const acknowledged = { ...session, attempt: null, queue: session.queue.filter(read => !ids.has(read.battery.id)), completed: [...session.completed, ...attempt.reads.filter(read => !session.completed.some(item => item.battery.id === read.battery.id && item.receipt.requestId === receipt.requestId)).map(read => ({ ...read, receipt }))], issues: session.issues.map(item => item.id === attempt.payload.requestId ? { ...item, acknowledged: true } : item) };
    await persist(acknowledged, { acknowledge: true });
    latest = null;
    let warning = '';
    try { await onChanged(); } catch { warning = ' The server saved this movement; the shared inventory could not be refreshed.'; }
    return { type: 'saved', receipt, message: `${receipt.count} ${receipt.count === 1 ? 'battery' : 'batteries'} ${kind === 'checkout' ? 'checked out' : 'returned'}${receipt.replayed ? ' · Original request confirmed' : ''}.${warning}` };
  }
  return {
    key, getSnapshot: snapshot, subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    updateInventory(value) { data = value; },
    async addTag(tagId, acquisition = 'tag', deviceEvidence) {
      return exclusive(async () => {
        const tag = String(tagId).trim();
        if (!tag || tag.length > 128) throw new Error('Enter a registered tag of 1–128 characters.');
        if (!['tag', 'simulated', 'native-nfc-reader'].includes(acquisition)) throw new Error('Unknown acquisition source.');
        if (acquisition === 'simulated' && dataset !== 'demo') throw new Error('Tag simulation is available only in Demonstration inventory.');
        if (acquisition === 'native-nfc-reader') {
          validateTeachingNfcTag(deviceEvidence, tag);
          if (dataset !== 'demo') throw new Error('Native business scanning is demonstration-only pending physical acceptance. Device evidence is retained; use Manual selection in Working inventory.');
        }
        if (session.queue.length && acquisitionOf(session.queue[0]) !== acquisition) return issue('source', tag, 'Use one input source per queue. Confirm or clear this queue before changing sources.');
        const source = acquisition === 'simulated' ? 'simulated' : acquisition === 'native-nfc-reader' ? 'native_nfc' : 'manual';
        let result;
        try {
          const response = await write('scan_lookup', { tagIds: [tag], source });
          if (response?.source !== source || !Array.isArray(response.results)) throw new Error('The tag lookup response could not be verified.');
          result = response.results.find(item => item.tagId === tag);
          if (!result) throw new Error('No lookup result was returned for this exact tag.');
        } catch (error) { return issue('lookup', tag, `Lookup failed. ${message(error)} No movement was attempted.`); }
        if (!result.battery) return issue('unknown', tag, 'Unregistered tag. Check the identifier or use New battery intake. No movement was saved.');
        return addBattery(result.battery, tag, source, acquisition, deviceEvidence);
      });
    },
    async addSelections(ids) {
      return exclusive(async () => {
        const unique = [...new Set(ids)];
        if (!unique.length || unique.length > 100) throw new Error('Select between 1 and 100 batteries.');
        if (session.queue.length && acquisitionOf(session.queue[0]) !== 'selection') return [await issue('source', unique.join(', '), 'Confirm or clear the tag-input queue before using Manual selection.')];
        const results = [];
        for (const batteryId of unique) {
          const battery = data.batteries.find(item => item.id === batteryId);
          results.push(battery ? await addBattery(battery, battery.tagId, 'selection', 'selection') : await issue('state', batteryId, `${batteryId} is unavailable in the current inventory.`));
        }
        return results;
      });
    },
    async confirmQueue() { return exclusive(async () => {
      if (!session.queue.length) throw new Error('Add at least one battery to review.');
      const reads = copy(session.queue);
      return runAttempt({ reads, payload: scanMovementPayload(kind, reads, session.sessionId, session.room, id(), session.teachingGroup), status: 'rejected', message: '' });
    }); },
    async retry() { return exclusive(async () => { if (!session.attempt) throw new Error('There is no captured request to retry.'); return runAttempt(copy(session.attempt)); }, true); },
    async remove(idToRemove) { available(); return exclusive(() => persist({ ...session, queue: session.queue.filter(read => read.battery.id !== idToRemove) })); },
    async clearQueue() { available(); return exclusive(() => persist({ ...session, queue: [] })); },
    async acknowledge(issueId) { available(); return exclusive(() => persist({ ...session, issues: session.issues.map(item => item.id === issueId ? { ...item, acknowledged: true } : item) })); },
    async chooseRoom(roomId) {
      if (running || storageError || session.attempt || kind !== 'return' || !session.roomConfirmationRequired && (session.queue.length || session.completed.length)) throw new Error('Return placement is captured before accepted reads. Start a new station to change it.');
      const room = roomId ? data.rooms.find(item => item.id === roomId) : null;
      if (roomId && (!room || !isSelectableRoom(room) || dataset === 'live' && room.isPlaceholder)) throw new Error('Use a selectable verified J18 room, or Room unspecified.');
      await exclusive(() => persist({ ...session, roomConfirmationRequired: false, room: room ? { id: room.id, version: room.version, name: room.name, isPlaceholder: room.isPlaceholder, buildingId: room.buildingId } : null }), true);
    },
    async chooseGroup(groupId) {
      available(); if (session.queue.length || session.completed.length) throw new Error('Start a new scan station to change the teaching group.');
      const selected = groupId ? data.teachingGroups?.find(item => item.id === groupId) : null;
      if (groupId && !selected) throw new Error('This teaching group is unavailable.');
      await exclusive(() => persist({ ...session, teachingGroup: selected ? { id: selected.id, version: selected.version } : undefined }));
    },
    async reviewLatest() { return exclusive(async () => {
      if (session.attempt?.status !== 'rejected') throw new Error('Only a definitive rejected request can be reviewed for discard.');
      const value = await loadInventory();
      if (value.dataset !== dataset || value.user?.id !== accountId || !Array.isArray(value.batteries) || !Array.isArray(value.rooms)) throw new Error('Current records do not match the captured request context.');
      latest = { requestId: session.attempt.payload.requestId, inventory: value }; emit(); return latest;
    }, true); },
    async discardRejected() { return exclusive(async () => {
      const attempt = session.attempt;
      if (attempt?.status !== 'rejected' || latest?.requestId !== attempt.payload.requestId) throw new Error('Load and review current records before discarding this rejected request.');
      const ids = new Set(attempt.reads.map(read => read.battery.id));
      const roomChanged = kind === 'return' && !!session.room && (attempt.statusCode === 422 || latest.inventory.rooms.find(room => room.id === session.room.id)?.version !== session.room.version);
      await persist({ ...session, attempt: null, queue: session.queue.filter(read => !ids.has(read.battery.id)), ...(roomChanged ? { room: null, roomConfirmationRequired: true } : {}), issues: session.issues.map(item => item.id === attempt.payload.requestId ? { ...item, acknowledged: true } : item) });
      data = latest.inventory; latest = null; emit();
      try { await onChanged(); } catch { /* Captured rejection was discarded; current lookup still validates future reads. */ }
    }, true); },
    async retryStorage() {
      if (running) throw new Error('Wait for the current operation.');
      running = true; emit();
      try { await storage.retryPersistence?.(); if (unreadable) { const restored = recover(); unreadable = false; session = restored; } await persist(session); } finally { running = false; emit(); }
    },
    canExit() { return !exited && !running && !storageError && !session.attempt; },
    needsExitConfirmation() { return !!session.queue.length || session.issues.some(item => !item.acknowledged); },
    async exit(confirmed = false) {
      if (!this.canExit()) throw new Error(storageError || 'Resolve the captured request before exiting.');
      if (this.needsExitConfirmation() && !confirmed) return false;
      running = true; emit();
      try { storage.removeItem(key); await storage.flush?.(); exited = true; } catch (error) { storageError = message(error); throw error; } finally { running = false; emit(); }
      return true;
    },
  };
}
