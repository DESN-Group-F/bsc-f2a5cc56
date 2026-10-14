import { PhoneChoice } from '../../app/phone-choice.jsx';
import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Battery, Check, FileDown, LockKeyhole, RefreshCw } from 'lucide-react';
import { businessStorage, saveFile } from '../../platform/runtime.mjs';
import { useWorkflowLock } from '../../business/workflow-boundary.jsx';
import { PhoneModelPicker as BatteryModelPicker, modelCreateStorageKey } from './phone-model-picker.jsx';
import { TemporalInput } from '../../shared/components/ui/temporal-input.js';
import { modelApplication } from '../../shared/lib/battery-models.js';
import { currentSydneyDate } from '../../shared/lib/battery-age.js';
import { isSelectableRoom } from '../../shared/lib/location-catalog.js';
import { getRolePermissions } from '../../shared/lib/permissions.js';
import { formatTime } from '../../shared/lib/client-utils.js';
import { acknowledgeOperatorRegistration, captureOperatorRegistrationAttempt, defaultRegistrationValues, discardOperatorRegistrationDraft, operatorRegistrationDraftKey, operatorRegistrationDraftSchema, operatorRegistrationStorageKey, persistOperatorRegistrationAttempt, recoverOperatorRegistrationAttempt, recoverOperatorRegistrationDraft, registrationFailureStatus, registrationValuesFromAttempt, verifyRegistrationResult } from './manual-registration-model.mjs';
import { usePhoneBack } from '../../app/phone-ui.jsx';
import './manual-registration.css';

function revealRegistrationField(event){let group=event.target?.closest?.('details');while(group){group.open=true;group=group.parentElement?.closest?.('details');}}
function focusRegistrationIssue(form,issue){const field=issue?.issues?.[0]?.path?.at(-1)||(/owner/i.test(issue?.message||'')?'ownerId':/room/i.test(issue?.message||'')?'homeRoomId':/first.use/i.test(issue?.message||'')?'firstUsedOn':null);const input=field&&form?.querySelector?.(`[name="${field}"]`);if(input){revealRegistrationField({target:input});input.focus({preventScroll:true});input.scrollIntoView?.({block:'nearest',behavior:'instant'});}}
const errorText = error => error?.issues?.[0]?.message || error?.message || 'Registration could not be completed.';
export function ManualRegistration({ data, user = data.user, dataset = data.dataset, onExit, onChanged, onLockedChange }) {
  useWorkflowLock();
  const storage = businessStorage(), key = operatorRegistrationStorageKey(user.id, dataset), draftKey = operatorRegistrationDraftKey(user.id, dataset);
  const [context] = useState({ actorAccountId: user.id, dataset });
  const [saved] = useState(() => {
    try {
      const attemptRaw = storage.getItem(key), draftRaw = storage.getItem(draftKey), attempt = recoverOperatorRegistrationAttempt(attemptRaw, user.id, dataset), draft = recoverOperatorRegistrationDraft(draftRaw, user.id, dataset);
      return { attempt, draft, invalid: !!(attemptRaw !== null && !attempt || draftRaw !== null && !draft || attempt && draft && attempt.payload.sessionId !== draft.sessionId), error: '' };
    } catch (error) { return { attempt: null, draft: null, invalid: true, error: errorText(error) }; }
  });
  const [values, setValues] = useState(saved.draft?.values ?? (saved.attempt ? registrationValuesFromAttempt(saved.attempt) : defaultRegistrationValues(data, user.id)));
  const [sessionId, setSessionId] = useState(saved.draft?.sessionId ?? saved.attempt?.payload.sessionId ?? crypto.randomUUID());
  const [firstUseMode, setFirstUseMode] = useState(saved.draft?.firstUseMode ?? saved.attempt?.payload.firstUseMode ?? 'at_registration'), [modelSelection, setModelSelection] = useState(saved.draft?.modelSelection ?? saved.attempt?.payload.common.modelSelection ?? null);
  const [attempt, setAttempt] = useState(saved.attempt), [reviewed, setReviewed] = useState(null), [reviewLabels, setReviewLabels] = useState(null), [receipt, setReceipt] = useState(null);
  const [busy, setBusy] = useState(false), [modelBusy, setModelBusy] = useState(false), [error, setError] = useState(saved.invalid ? saved.error || 'Retained registration data is unreadable or belongs to another account. It has not been replaced.' : ''), [notice, setNotice] = useState('');
  const [discardReview, setDiscardReview] = useState(null), [discardFailed, setDiscardFailed] = useState(false), [discarded, setDiscarded] = useState(false);
  const sending = useRef(false), mounted = useRef(true), reviewSurface = useRef(null), discardSurface = useRef(null), cancellation = useRef(false), leaving = useRef(false), currentContext = useRef(true);
  const contextChanged = context.actorAccountId !== user.id || context.dataset !== dataset || data.dataset !== context.dataset || data.user.id !== context.actorAccountId;
  currentContext.current = !contextChanged;
  const modelRequestKey = modelCreateStorageKey(context.actorAccountId, context.dataset);
  let unresolvedModel = false;
  try { unresolvedModel = storage.getItem(modelRequestKey) !== null; } catch { unresolvedModel = true; }
  const supported = data.capabilities?.operatorRegistration === 1, permitted = getRolePermissions(user.role).registerBatteries;
  const locked = !discarded && (busy || modelBusy || !!attempt || saved.invalid || contextChanged || !!reviewed || !!discardReview);
  useEffect(() => { onLockedChange?.(locked); return () => onLockedChange?.(false); }, [locked, onLockedChange]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { if (reviewed && !attempt && reviewSurface.current) { reviewSurface.current.focus({ preventScroll: true }); reviewSurface.current.scrollIntoView({ block: 'start', behavior: 'instant' }); } }, [reviewed, attempt]);
  useEffect(() => { if (discardReview && discardSurface.current) { discardSurface.current.focus({ preventScroll: true }); discardSurface.current.scrollIntoView({ block: 'start', behavior: 'instant' }); } }, [discardReview]);
  useEffect(() => {
    if (cancellation.current || leaving.current || saved.invalid || receipt || attempt || contextChanged || reviewed || discarded) return;
    try { storage.setItem(draftKey, JSON.stringify(operatorRegistrationDraftSchema.parse({ ...context, sessionId, values, firstUseMode, modelSelection }))); }
    catch (failure) { setError(`The draft could not be saved: ${errorText(failure)}. No registration was sent.`); }
  }, [sessionId, values, firstUseMode, modelSelection, receipt, attempt, contextChanged, reviewed, discardReview, discarded]);
  function change(field, value) {
    if (locked || cancellation.current || leaving.current) return;
    setValues(old => ({ ...old, [field]: value })); setError('');
    if (modelSelection?.appliedFields.includes(field)) setModelSelection(old => ({ ...old, appliedFields: old.appliedFields.filter(item => item !== field) }));
  }
  function review(event) {
    event.preventDefault(); if (locked || cancellation.current || leaving.current || unresolvedModel || !supported || !permitted) return;
    try { const draft = { ...context, sessionId, values, firstUseMode, modelSelection }, captured = captureOperatorRegistrationAttempt(data, user, dataset, draft, crypto.randomUUID()); setReviewed(captured); setReviewLabels({ ownerName: data.people.find(item => item.id === captured.payload.common.ownerId)?.name ?? 'Staff owner', ownerUsername: data.staffDirectory?.find(item => item.id === captured.payload.directoryBindings.ownerAccountId)?.username ?? 'Username unavailable', roomName: data.rooms.find(item => item.id === captured.payload.common.homeRoomId)?.name ?? 'Room unspecified', roomPlaceholder: !!data.rooms.find(item => item.id === captured.payload.common.homeRoomId)?.isPlaceholder }); setError(''); }
    catch (failure) { setError(errorText(failure)); focusRegistrationIssue(event.currentTarget,failure); }
  }
  async function send(existing = null) {
    if (sending.current || cancellation.current || leaving.current || modelBusy || unresolvedModel || saved.invalid || contextChanged || !permitted || existing?.status === 'rejected' || !existing && !reviewed) return;
    const captured = existing ?? reviewed; sending.current = true; setBusy(true); setAttempt(captured); setError(''); setNotice('');
    let sent = false;
    try {
      await persistOperatorRegistrationAttempt(storage, captured);
      sent = true;
      const response = await fetch('/api/inventory', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dataset: captured.dataset, action: 'operator_register', payload: captured.payload }) });
      const body = await response.json();
      if (!response.ok) throw Object.assign(new Error(body.error || `Registration request failed (${response.status}).`), { status: response.status, code: body.code });
      const confirmed = verifyRegistrationResult(body.result, captured);
      await acknowledgeOperatorRegistration(storage, captured, confirmed);
      if (!mounted.current) return;
      setReceipt(confirmed); setAttempt(null); setReviewed(null);
      try { await onChanged?.(); } catch (failure) { if (mounted.current) setNotice(`Registration is confirmed. Refresh failed: ${errorText(failure)}`); }
    } catch (failure) {
      if (!mounted.current) return;
      if (sent && registrationFailureStatus(failure, !!existing) === 'rejected') {
        const rejected = { ...captured, status: 'rejected', message: errorText(failure) };
        try { await storage.transact(entries => { entries[key] = JSON.stringify(rejected); }); setAttempt(rejected); }
        catch (saveError) { setAttempt(captured); setError(`${errorText(saveError)} The original request remains unresolved.`); }
      } else setError(sent ? `${errorText(failure)} The original request is retained; its result remains unresolved.` : `${errorText(failure)} No registration was sent. Save the original request before retrying.`);
    } finally { sending.current = false; if (mounted.current) setBusy(false); }
  }
  async function editRejected() {
    if (busy || attempt?.status !== 'rejected') return;
    try {
      const nextSession = crypto.randomUUID();
      await storage.transact(entries => { const retained = recoverOperatorRegistrationAttempt(entries[key], context.actorAccountId, context.dataset); if (!retained || retained.status !== 'rejected' || JSON.stringify(retained.payload) !== JSON.stringify(attempt.payload)) throw new Error('The original rejected request changed. Export recovery data before continuing.'); delete entries[key]; entries[draftKey] = JSON.stringify({ ...context, sessionId: nextSession, values, firstUseMode, modelSelection }); });
      setSessionId(nextSession); setAttempt(null); setReviewed(null); setError(''); setNotice('The rejected request was acknowledged. Review current details before preparing another registration.');
    } catch (failure) { setError(errorText(failure)); }
  }
  async function exit() {
    if (sending.current || cancellation.current || leaving.current || busy || modelBusy || unresolvedModel || attempt || saved.invalid || contextChanged) return;
    leaving.current = true;
    try { await storage.flush(); if (mounted.current && currentContext.current) onExit?.(); } catch (failure) { if (mounted.current) setError(`${errorText(failure)} The draft must be saved before exit.`); }
    finally { leaving.current = false; }
  }
  function reviewDiscard() {
    if (sending.current || cancellation.current || leaving.current || busy || modelBusy || unresolvedModel || attempt || saved.invalid || contextChanged || receipt) return;
    try {
      if (storage.getItem(key) !== null || storage.getItem(modelRequestKey) !== null) throw new Error('Resolve the retained registration or model request before discarding.');
      const raw = storage.getItem(draftKey), retained = recoverOperatorRegistrationDraft(raw, context.actorAccountId, context.dataset);
      const currentDraft = operatorRegistrationDraftSchema.parse({ ...context, sessionId, values, firstUseMode, modelSelection });
      if (!retained || JSON.stringify(retained) !== JSON.stringify(currentDraft)) throw new Error('The saved draft differs from this form or needs recovery. It has not been discarded.');
      cancellation.current = true; setDiscardReview({ expectedDraftRaw: raw, name: retained.values.name || 'Unnamed battery' }); setDiscardFailed(false); setError('');
    } catch (failure) { setError(errorText(failure)); }
  }
  function keepDraft() {
    if (sending.current || busy || discardFailed || !currentContext.current) return;
    cancellation.current = false; setDiscardReview(null); setError('');
  }
  async function discardDraft() {
    if (sending.current || busy || !discardReview || modelBusy || attempt || saved.invalid || contextChanged) return;
    sending.current = true; setBusy(true); setError('');
    let acknowledged = false;
    try {
      await discardOperatorRegistrationDraft(storage, { ...context, expectedDraftRaw: discardReview.expectedDraftRaw, modelRequestKey }, () => mounted.current && currentContext.current);
      acknowledged = true;
      if (!mounted.current || !currentContext.current) return;
      setDiscarded(true); setReviewed(null); setDiscardReview(null); setDiscardFailed(false);
      onLockedChange?.(false); onExit?.();
    } catch (failure) { if (mounted.current) { if (acknowledged) setError(`The draft was discarded on this device. Leaving registration failed: ${errorText(failure)}`); else { setDiscardFailed(true); setError(`${errorText(failure)} The draft is retained. Registration remains locked until discard can be acknowledged.`); } } }
    finally { sending.current = false; if (mounted.current) setBusy(false); }
  }
  function exitDiscarded() {
    if (!discarded || busy || !currentContext.current) return;
    try { onExit?.(); } catch (failure) { setError(`The draft was discarded on this device. Leaving registration failed: ${errorText(failure)}`); }
  }
  async function exportRecovery() { try { await saveFile({ filename: `manual-registration-recovery-${context.dataset}.json`, blob: new Blob([storage.exportRaw()], { type: 'application/json' }) }); } catch (failure) { setError(errorText(failure)); } }
  function another() {
    if (busy) return;
    setReceipt(null); setNotice(''); setError(''); setSessionId(crypto.randomUUID());
    setValues(old => ({ ...old, tagId: '', manufacturedOn: '', firstUsedOn: '' }));
  }
  usePhoneBack(()=>{if(discardReview){keepDraft();}else if(reviewed&&!attempt&&!busy){setReviewed(null);}else if(exitBlocked){setNotice(attempt?'Check the original request before leaving.':'Finish the current step before leaving.');}else void exit();return true;},{priority:40});
  const ownerOptions = (data.people ?? []).filter(item => item.role === 'staff' && item.accountId && data.staffDirectory?.some(account => account.id === item.accountId && account.active));
  const roomOptions = (data.rooms ?? []).filter(isSelectableRoom);
  const exitBlocked = busy || modelBusy || unresolvedModel || !!attempt || saved.invalid || contextChanged || !!discardReview || discarded;
  return <section className="manual-registration" aria-label="Manual registration">
    <header className="mr-sticky-header"><button type="button" aria-label="Exit manual registration" disabled={exitBlocked} onClick={exit}><ArrowLeft size={20} />Exit</button><div><h1>Manual registration</h1></div></header>
    {exitBlocked && !discarded && <p className="mr-blocked"><LockKeyhole size={15} />{attempt ? 'Resolve the original request before leaving or switching inventory.' : saved.invalid ? 'Retained evidence needs recovery; normal exit is blocked.' : discardReview ? busy ? 'Saving the draft cancellation. Wait for device storage confirmation.' : 'Choose whether to keep or discard this unsubmitted draft.' : busy ? 'Saving the reviewed request.' : modelBusy || unresolvedModel ? 'Resolve the model request before leaving or discarding registration.' : 'The account or inventory changed; original work is preserved.'}</p>}
    <div className="mr-body"><p className="mr-intro">Register one battery. Its permanent ID is assigned after confirmation.</p>
      {!supported && !attempt && <p className="mr-warning" role="alert">This service has not confirmed manual registration support. Refresh or use a compatible service; this inventory will not be switched automatically.</p>}
      {!permitted && <p className="mr-warning" role="alert">Your account cannot register batteries.</p>}
      {error && <p className="mr-error" role="alert">{error}</p>}{notice && <p className="mr-notice" role="status">{notice}</p>}
      {saved.invalid && <div className="mr-recovery"><h2>Retained data needs review</h2><p>Unreadable data has not been replaced. Export it before investigating recovery.</p><button type="button" onClick={exportRecovery}><FileDown size={17} />Export recovery data</button></div>}
      {attempt && <section className="mr-recovery"><h2>{attempt.status === 'rejected' ? 'Registration rejected' : 'Result not confirmed'}</h2><p>{attempt.status === 'rejected' ? attempt.message : 'It may have been registered. Check the original request before registering again.'}</p><dl><div><dt>Request</dt><dd>{attempt.payload.requestId}</dd></div><div><dt>Battery name</dt><dd>{attempt.payload.common.name}</dd></div><div><dt>Tag</dt><dd>{attempt.payload.tagId || 'Untagged'}</dd></div><div><dt>Inventory</dt><dd>{attempt.dataset === 'live' ? 'Working' : 'Demonstration'}</dd></div></dl><details><summary>Original reviewed evidence</summary><pre>{JSON.stringify(attempt.payload, null, 2)}</pre></details><div className="mr-button-row">{attempt.status === 'rejected' ? <button type="button" className="mr-primary" disabled={busy || saved.invalid} onClick={editRejected}>Back to details</button> : <button type="button" className="mr-primary" disabled={busy || saved.invalid || contextChanged} onClick={() => send(attempt)}><RefreshCw size={17} />{busy ? 'Checking…' : 'Check original request'}</button>}<button type="button" disabled={busy} onClick={exportRecovery}>Export recovery data</button></div></section>}
      {receipt ? <section className="mr-success"><span className="mr-success-mark"><Check size={28} /></span><h2>Battery registered</h2><strong>{receipt.batteryId}</strong><p>{receipt.name}</p><p>Confirmed registration: {formatTime(receipt.registeredAt)}</p><p>{receipt.tagId ? `Registered tag: ${receipt.tagId}` : 'No tag bound'} · {receipt.firstUsedOn ? `First used: ${receipt.firstUsedOn}` : 'First use not recorded'}</p><div className="mr-button-row"><button type="button" className="mr-primary" disabled={busy} onClick={another}>Register another</button><button type="button" disabled={busy} onClick={exit}>Exit registration</button></div></section> : !attempt && !saved.invalid && !reviewed && !discardReview && !discarded && <form onSubmit={review} onInvalidCapture={revealRegistrationField}>
        <fieldset disabled={locked || !supported || !permitted}><legend className="mr-section-title"><Battery size={18} />Battery details</legend>
          <label className="mr-field">Battery name *<input name="name" value={values.name} onChange={event=>change('name',event.target.value)} required maxLength={120} autoComplete="off"/></label>
          <h2 className="mr-section-title">Responsible owner & registered storage</h2><PhoneChoice className="mr-field" label="Responsible staff owner" name="ownerId" value={values.ownerId} disabled={locked || cancellation.current || leaving.current} onChange={value => change("ownerId", value)} placeholder="Choose an active staff owner" options={ownerOptions.map(item => ({value:item.id,label:item.name,description:data.staffDirectory.find(account => account.id === item.accountId)?.username ?? item.accountId}))}/>
          <p className="mr-help">J18 · Willis Annexe</p><PhoneChoice className="mr-field" label="Storage room (optional)" name="homeRoomId" value={values.homeRoomId} disabled={locked || cancellation.current || leaving.current} onChange={value => change("homeRoomId", value)} options={[{value:"",label:"Room unspecified"}, ...roomOptions.map(item => ({value:item.id,label:`${item.number} · ${item.name}`,description:item.isPlaceholder ? "Placeholder" : undefined}))]}/><p className="mr-help">Registered home is separate from dated location evidence. A placeholder is not verified room evidence.</p>
          <details className="mr-field-group"><summary>Model, specifications & tag · optional</summary><div><details className="mr-model-assistance"><summary>Use a model template</summary><div><BatteryModelPicker dataset={dataset} actorAccountId={user.id} canEditModels={getRolePermissions(user.role).editModels} values={values} selection={modelSelection} disabled={locked || !supported} onApply={(choice, fields) => { if (cancellation.current || leaving.current || !currentContext.current) return; setValues(old => modelApplication(old, choice, fields)); setModelSelection({ origin: choice.origin, id: choice.id, contentHash: choice.contentHash, confirmed: true, appliedFields: fields }); }} onManual={() => { if (!cancellation.current && !leaving.current && currentContext.current) setModelSelection(null); }} onBusyChange={setModelBusy} /></div></details>
          {[['model', 'Model', false], ['chemistry', 'Chemistry', false], ['capacityMah', 'Capacity (mAh)', false], ['voltage', 'Nominal voltage (V)', false], ['tagId', 'Typed registered tag (optional)', false]].map(([field, label, required]) => <label className="mr-field" key={field}>{label}<input name={field} type={['capacityMah', 'voltage'].includes(field) ? 'number' : 'text'} value={values[field]} onChange={event => change(field, event.target.value)} required={required} min={['capacityMah', 'voltage'].includes(field) ? '0.000001' : undefined} maxLength={field === 'chemistry' ? 40 : field === 'tagId' ? 128 : 120} step="any" autoComplete="off" /></label>)}
          <p className="mr-help">Leave unknown specifications blank. Model suggestions need a physical check; a typed tag is not hardware evidence.</p>
          </div></details><details className="mr-field-group"><summary>Age & service start · optional</summary><div><label className="mr-field">Manufacture date (optional)<TemporalInput name="manufacturedOn" type="date" aria-label="Manufacture date" value={values.manufacturedOn} max={currentSydneyDate()} onChange={event => change('manufacturedOn', event.target.value)} /></label><PhoneChoice className="mr-field" label="First-use record" value={firstUseMode} disabled={locked || cancellation.current || leaving.current} onChange={value => { if (!locked && !cancellation.current && !leaving.current) { setFirstUseMode(value); setError(""); } }} options={[{value:"at_registration",label:"Starts on the registration date"},{value:"date",label:"Known first-use date"},{value:"unknown",label:"First use unknown"}]}/>{firstUseMode === 'date' && <label className="mr-field">First used on<TemporalInput name="firstUsedOn" type="date" aria-label="First used on" required value={values.firstUsedOn} min={values.manufacturedOn || undefined} max={currentSydneyDate()} onChange={event => change('firstUsedOn', event.target.value)} /></label>}
        </div></details></fieldset>
        {!reviewed && <div className="mr-sticky-actions"><span>Unsubmitted draft retained on exit</span><button className="mr-primary" type="submit" disabled={locked || unresolvedModel || !supported || !permitted}>Review registration</button></div>}
      </form>}
      {reviewed && !attempt && !discardReview && !discarded && <section ref={reviewSurface} tabIndex={-1} className="mr-review" aria-label="Reviewed registration"><h2>Confirm this new battery</h2><p>Permanent ID: allocated by the server after confirmation</p><dl>{[['Name', reviewed.payload.common.name], ['Model', reviewed.payload.common.model || 'Not recorded'], ['Chemistry', reviewed.payload.common.chemistry || 'Not recorded'], ['Capacity', reviewed.payload.common.capacityMah === null ? 'Not recorded' : `${reviewed.payload.common.capacityMah} mAh`], ['Nominal voltage', reviewed.payload.common.voltage === null ? 'Not recorded' : `${reviewed.payload.common.voltage} V`], ['Registered tag', reviewed.payload.tagId || 'Untagged'], ['Responsible owner', `${reviewLabels?.ownerName ?? 'Staff owner'} · ${reviewLabels?.ownerUsername ?? 'Username unavailable'}`], ['Registered home', `J18 · ${reviewLabels?.roomName ?? 'Room unspecified'}${reviewLabels?.roomPlaceholder ? ' · Placeholder' : ''}`], ['Manufactured on', reviewed.payload.common.manufacturedOn || 'Not recorded'], ['First used', reviewed.payload.firstUseMode === 'at_registration' ? 'Authoritative registration date' : reviewed.payload.firstUseMode === 'unknown' ? 'Not recorded' : reviewed.payload.common.firstUsedOn]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl><p className="mr-help">This registers in {dataset === 'live' ? 'Working' : 'Demonstration'} inventory with the reviewed owner, room and model evidence. It does not check out a battery or capture a location.</p><div className="mr-button-row"><button type="button" onClick={() => { if (!cancellation.current && !leaving.current) setReviewed(null); }}>Back to details</button><button type="button" className="mr-primary" onClick={() => send()}>Confirm registration</button></div></section>}
      {!receipt && !attempt && !saved.invalid && !discardReview && !discarded && <div className="mr-cancel-action"><button type="button" disabled={busy || modelBusy || unresolvedModel || contextChanged} onClick={reviewDiscard}>Cancel registration</button><p>Discard an unsubmitted draft after local confirmation.</p></div>}
      {discardReview && <section ref={discardSurface} tabIndex={-1} className="mr-discard" role="dialog" aria-labelledby="mr-discard-title"><h2 id="mr-discard-title">Discard unsubmitted draft?</h2><p><strong>{discardReview.name}</strong></p><p>This removes the saved registration draft from this device. No battery has been registered. Retained registration and model requests cannot be discarded here.</p><div className="mr-button-row"><button type="button" disabled={busy || discardFailed || contextChanged} onClick={keepDraft}>Keep draft</button><button type="button" className="mr-danger" disabled={busy || modelBusy || !!attempt || saved.invalid || contextChanged} onClick={discardDraft}>{busy ? 'Saving cancellation…' : discardFailed ? 'Retry discard and exit' : 'Discard draft and exit'}</button></div>{discardFailed && <button type="button" disabled={busy} onClick={exportRecovery}>Export recovery data</button>}</section>}
      {discarded && <div className="mr-notice"><p role="status">Unsubmitted draft discarded. Leaving registration.</p><button type="button" disabled={busy || contextChanged} onClick={exitDiscarded}>Exit registration</button></div>}
    </div>
  </section>;
}
