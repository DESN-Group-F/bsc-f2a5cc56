import { Pressable } from '../../app/phone-ui.jsx';
import { useCallback, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '../../shared/components/ui/dialog.js';
import { Button } from '../../shared/components/ui/button.js';
import { taskRequest } from '../../shared/lib/client/task-api.js';
import { formatDateOnly, formatTime } from '../../shared/lib/client-utils.js';
import { assignmentNames, cycleState, reminderLimitation, targetSummary, taskCategoryLabels } from '../../shared/components/inventory/tasks/task-presentation.js';
import { useWorkflowLock } from '../../business/workflow-boundary.jsx';
import { acknowledgeTaskCompletion, captureTaskCompletion, readTaskCompletion, saveTaskCompletion } from './task-completion.mjs';
import { PhoneFormDraftStatus, usePhoneFormDraft } from '../../app/phone-form-draft.jsx';

export function taskCompletionRecovery(data) {
  try { return { attempt: readTaskCompletion(window.__batteryWorkflowStorage, data.user.id, data.dataset), error: '' }; }
  catch (failure) { return { attempt: null, error: failure.message }; }
}

export function MobileTaskCycleDialog({ active = true, cycle, data, onClose, onSaved, onDetail }) {
  const titleRef = useRef(null);
  const bodyRef = useRef(null), bodyScroll = useRef(0), surfaceRef = useRef(null), surfaceScroll = useRef(0), requirementsRef = useRef(null);
  const [requirementsOpen, setRequirementsOpen] = useState(false);
  const attachBody = useCallback(node => {
    bodyRef.current = node;
    if (node) node.scrollTop = bodyScroll.current;
  }, []);
  const attachSurface = useCallback(node => {
    surfaceRef.current = node;
    if (node) node.scrollTop = surfaceScroll.current;
  }, []);
  function openAsset(id) {
    if (bodyRef.current) bodyScroll.current = bodyRef.current.scrollTop;
    if (surfaceRef.current) surfaceScroll.current = surfaceRef.current.scrollTop;
    if (requirementsRef.current) setRequirementsOpen(requirementsRef.current.open);
    onDetail?.(id);
  }
  const [recovery] = useState(() => taskCompletionRecovery(data));
  const [attempt, setAttempt] = useState(recovery.attempt);
  const [reviewed, setReviewed] = useState(recovery.attempt?.reviewedCycle ?? cycle);
  const noteDraft = usePhoneFormDraft({ accountId: data.user.id, dataset: data.dataset, kind: 'task-notes', recordId: reviewed.id, initial: { cycleId: reviewed.id, expectedVersion: reviewed.version, notes: recovery.attempt?.input.payload.notes ?? '' }, enabled: !recovery.attempt });
  const [lockedNotes, setLockedNotes] = useState(recovery.attempt?.input.payload.notes ?? '');
  const notes = attempt ? lockedNotes : noteDraft.value.notes;
  const draftStale = !attempt && noteDraft.value.expectedVersion !== reviewed.version;
  const [confirmed, setConfirmed] = useState(!!recovery.attempt);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(recovery.error);
  const [latest, setLatest] = useState(null);
  const [storageError, setStorageError] = useState(recovery.error);
  const locked = busy || !!attempt || !!storageError || noteDraft.clearing;
  useWorkflowLock(active);
  const snapshotBatteries = Array.isArray(reviewed.targetSnapshot?.batteries) ? reviewed.targetSnapshot.batteries.filter(item => item && typeof item.id === 'string') : reviewed.batteryIds.map(id => ({ id }));
  const room = reviewed.targetSnapshot?.room;
  const target = typeof room?.name === 'string' ? room.name : targetSummary(reviewed, data);
  async function complete() {
    if (busy || storageError || (!attempt && (!confirmed || draftStale || !!noteDraft.error || reviewed.status !== 'open' || !reviewed.canComplete || reviewed.planRemoved))) return;
    setBusy(true); setError('');
    let captured = attempt;
    let persisted = !!attempt;
    let acknowledged = false;
    let notesSaved = !!attempt;
    try {
      if (!attempt) { await noteDraft.save(); notesSaved = true; }
      captured ??= captureTaskCompletion(data.user.id, data.dataset, reviewed, notes);
      if (captured.actorAccountId !== data.user.id || captured.dataset !== data.dataset) throw new Error('This task request belongs to another account or inventory. It cannot be sent from the current context.');
      captured = await saveTaskCompletion(window.__batteryWorkflowStorage, captured);
      persisted = true;
      setLockedNotes(captured.input.payload.notes);
      setAttempt(captured);
      const body = await taskRequest('/api/task-plans', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(captured.input) });
      await acknowledgeTaskCompletion(window.__batteryWorkflowStorage, captured, body.result);
      acknowledged = true;
      setAttempt(null);
      try { await noteDraft.clear({ cycleId: reviewed.id, expectedVersion: body.result.version, notes: '' }); } catch { setError('Task completion was confirmed. Its local notes draft still needs clearing.'); }
      try { await onSaved(); } catch { setError('Task completion was confirmed. Refresh shared records if their status has not updated.'); }
    } catch (failure) {
      setError(failure.message);
      if (captured && persisted && !acknowledged) {
        try { setAttempt(readTaskCompletion(window.__batteryWorkflowStorage, data.user.id, data.dataset) ?? captured); }
        catch (storageFailure) { setStorageError(storageFailure.message); setAttempt(captured); }
      } else if (!persisted && notesSaved) setStorageError(`No completion was sent. The reviewed request could not be retained. ${failure.message}`);
    } finally { setBusy(false); }
  }
  async function reload() {
    if (busy) return;
    setBusy(true);
    try {
      const body = await taskRequest(`/api/task-plans?dataset=${data.dataset}&visibility=all`);
      const found = body.cycles.find(item => item.id === reviewed.id);
      if (!found) throw new Error('This recorded task is unavailable. Its original request and notes remain retained.');
      setLatest(found);
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }
  return <Dialog open={active} onOpenChange={open => { if (!open && !locked) onClose(); }}><DialogContent ref={attachSurface} className="mobile-task-cycle-dialog" data-phone-task="task-completion" showCloseButton={!locked} onScroll={event => { if (active) surfaceScroll.current = event.currentTarget.scrollTop; }} onOpenAutoFocus={event => { event.preventDefault(); titleRef.current?.focus({ preventScroll: true }); if (bodyRef.current) bodyRef.current.scrollTop = bodyScroll.current; if (surfaceRef.current) surfaceRef.current.scrollTop = surfaceScroll.current; }} onEscapeKeyDown={event => { if (locked) event.preventDefault(); }} onInteractOutside={event => { if (locked) event.preventDefault(); }}>
    <DialogHeader><DialogTitle ref={titleRef} tabIndex={-1}>{reviewed.title}</DialogTitle><DialogDescription>{taskCategoryLabels[reviewed.category]} · {reviewed.status === 'completed' ? 'Completed' : reviewed.planRemoved ? 'Plan removed' : cycleState(reviewed)}</DialogDescription></DialogHeader>
    <div ref={attachBody} className="mobile-task-cycle-body" data-phone-sheet-scroll onScroll={event => { if (active) bodyScroll.current = event.currentTarget.scrollTop; }}><section className="mobile-task-instructions"><h3>What to do</h3><p className="mobile-phone-body">{reviewed.description || 'Requirements not recorded.'}</p></section><dl className="mobile-phone-details"><dt>Due</dt><dd>{formatDateOnly(reviewed.dueOn)}</dd><dt>Target</dt><dd>{target}</dd><dt>Assigned</dt><dd>{assignmentNames(reviewed.currentAssigneeIds, data)}</dd></dl>
      {reviewed.status === 'completed' && !attempt ? <section className="mobile-task-completed"><h3>Recorded completion</h3><p>{formatTime(reviewed.completedAt)} · {reviewed.completedByName}</p><p className="mobile-phone-body">{reviewed.completionNotes || 'No completion notes.'}</p></section> : attempt || !reviewed.planRemoved && reviewed.canComplete ? <div className="mobile-task-completion-form"><label>Completion notes · optional<textarea value={notes} onChange={event => { if (!locked) { noteDraft.setValue(previous => ({ ...previous, notes: event.target.value })); setConfirmed(false); } }} maxLength={2000} disabled={locked} rows={4} placeholder="Record findings or follow-up actions." /></label><label className="mobile-task-confirmation"><input type="checkbox" checked={confirmed} onChange={event => { if (!locked) setConfirmed(event.target.checked); }} disabled={locked} /><span><strong>I have completed this task.</strong><small>Record the actual review. This is not a battery safety certification.</small></span></label>{!!notes && !locked && <Pressable type="button" className="mobile-phone-text-button" onClick={() => { void noteDraft.clear({ cycleId: reviewed.id, expectedVersion: reviewed.version, notes: '' }).catch(() => {}); setConfirmed(false); }}>Discard completion notes</Pressable>}</div> : <p className="mobile-phone-caption">{reviewed.planRemoved ? 'An administrator must restore this plan before completion.' : 'Only currently assigned staff or an administrator can complete this task.'}</p>}
      <details ref={requirementsRef} className="mobile-task-requirements" open={requirementsOpen} onToggle={event => { if (active) setRequirementsOpen(event.currentTarget.open); }}><summary>Recorded requirements & assets</summary><h3>Basis</h3><p>{reviewed.basis || 'Not recorded'}</p><h3>Scope</h3><p>{reviewed.scopeNote || target}</p><p>Reminder {formatDateOnly(reviewed.reminderOn)} · {reviewed.reminderTime || 'Time unavailable'} Sydney</p>{reminderLimitation(reviewed.reminderStatus) && <p>{reminderLimitation(reviewed.reminderStatus)}</p>}<div className="mobile-phone-actions">{snapshotBatteries.map(item => <Pressable type="button" key={item.id} disabled={locked} onClick={() => openAsset(item.id)} title={item.name}>{item.id}</Pressable>)}</div></details>
      {!attempt && <PhoneFormDraftStatus draft={noteDraft} />}{draftStale && <div className="mobile-work-load-error" role="alert"><p>These notes belong to an older task review. Review current requirements before confirming completion.</p><Pressable disabled={busy} onClick={reload}>Review latest task</Pressable></div>}
      {error && <div className="mobile-work-load-error" role="alert"><p>{error}</p>{attempt && <p>The original account, inventory, cycle, version and notes remain locked. Retry resolves only this captured request.</p>}<Pressable type="button" disabled={busy} onClick={reload}>View latest task state</Pressable>{storageError && <Pressable type="button" disabled={busy} onClick={() => { const saved = taskCompletionRecovery(data); setStorageError(saved.error); setError(saved.error); setAttempt(saved.attempt); if (saved.attempt) { setReviewed(saved.attempt.reviewedCycle); setLockedNotes(saved.attempt.input.payload.notes); setConfirmed(true); } }}>Retry saved completion recovery</Pressable>}</div>}
      {latest && <section className="mobile-task-latest"><h3>Latest recorded task state</h3><p>{latest.title} · {cycleState(latest)} · Due {formatDateOnly(latest.dueOn)}</p><p>Assigned: {assignmentNames(latest.currentAssigneeIds, data)}</p>{!attempt && !storageError && <Button variant="outline" disabled={busy} onClick={() => { setReviewed(latest); noteDraft.setValue({ cycleId: latest.id, expectedVersion: latest.version, notes }); setLatest(null); setConfirmed(false); setError(''); }}>Accept reviewed task state</Button>}{attempt && <p className="mobile-phone-caption">This view does not replace the retained request. A rejection without a terminal receipt remains unresolved.</p>}</section>}
    </div>
    <DialogFooter><Button variant="outline" onClick={onClose} disabled={locked}>Close</Button>{(attempt || reviewed.status !== 'completed' && !reviewed.planRemoved && reviewed.canComplete) && <Button onClick={complete} disabled={busy || !!storageError || (!attempt && (!confirmed || draftStale || !!noteDraft.error || noteDraft.clearing))}>{busy ? 'Saving…' : attempt ? 'Retry original completion' : 'Record completion'}</Button>}</DialogFooter>
  </DialogContent></Dialog>;
}
