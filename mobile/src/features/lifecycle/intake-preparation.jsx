import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Check, Pencil } from 'lucide-react';
import { PhoneChoice } from '../../app/phone-choice.jsx';
import { Pressable, usePhoneBack, usePhoneContext, usePhoneReducedMotion } from '../../app/phone-ui.jsx';
import { PhoneModelPicker } from './phone-model-picker.jsx';
import { TemporalInput } from '../../shared/components/ui/temporal-input.js';
import { currentSydneyDate } from '../../shared/lib/battery-age.js';
import { isSelectableRoom } from '../../shared/lib/location-catalog.js';
import { getRolePermissions } from '../../shared/lib/permissions.js';
import { intakeBatchRows, intakeModelInput } from './intake-preparation.mjs';

export function IntakeBatchSummary({batch,data}) {
  const rows=intakeBatchRows(batch,data),list=items=><dl className="mi-batch-values">{items.map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>;
  return <div className="mi-batch-summary">{list(rows.slice(0,4))}<details className="mi-batch-extra"><summary>Specifications, dates & model evidence</summary>{list(rows.slice(4))}</details></div>;
}

const firstUseOptions = [{ value: 'at_registration', label: 'Starts on each registration date' }, { value: 'date', label: 'Known first-use date' }, { value: 'unknown', label: 'First use unknown' }];
export function CommonFields({ data, user, values, mode, selection, nameSource = 'custom', section = 'all', disabled, pickerDisabled = disabled, onChange, onMode, onApply, onManual, onModelBusy, onDefaultName }) {
  const owners = data.people.filter(person => person.role === 'staff' && person.accountId && data.staffDirectory.some(account => account.id === person.accountId && account.active));
  const ownerOptions = [{ value: '', label: 'Choose an active staff owner', disabled: true }, ...owners.map(person => ({ value: person.id, label: person.name, description: `${person.accountId === user.id ? 'You · ' : ''}${data.staffDirectory.find(account => account.id === person.accountId)?.username || person.accountId}` }))];
  const rooms = [{ value: '', label: 'Room unspecified', description: 'No registered room recorded' }, ...data.rooms.filter(isSelectableRoom).map(room => ({ value: room.id, label: `${room.number ? `${room.number} · ` : ''}${room.name}`, description: room.isPlaceholder ? 'Unverified placeholder' : undefined }))];
  return <div className="mi-common-fields"><fieldset aria-disabled={disabled}>
    {section !== 'owner' && <>
      <label>Battery name *<input name="name" disabled={disabled} value={values.name || ''} onChange={event => onChange('name', event.target.value)} required minLength={2} maxLength={120} autoComplete="off" /></label>
      <div className="mi-naming-help"><p>{nameSource === 'default' ? 'Keep Battery, apply a model name, or enter your own.' : nameSource === 'model' ? 'Name applied from your reviewed model.' : 'Your entered name is retained.'}</p>{onDefaultName && nameSource !== 'default' && <Pressable disabled={disabled} onClick={onDefaultName}>Use Battery default</Pressable>}</div>
      <PhoneModelPicker dataset="demo" actorAccountId={user.id} canEditModels={getRolePermissions(user.role).editModels} values={intakeModelInput(values, nameSource)} selection={selection} disabled={pickerDisabled} onApply={onApply} onManual={onManual} onBusyChange={onModelBusy} />
      <details className="mi-form-group"><summary>Manual specifications · optional</summary><div className="mi-form-group-body">{[['model', 'Model'], ['chemistry', 'Chemistry'], ['capacityMah', 'Capacity (mAh)'], ['voltage', 'Nominal voltage (V)']].map(([field, label]) => <label key={field}>{label}<input name={field} disabled={disabled} value={values[field] || ''} onChange={event => onChange(field, event.target.value)} type={['capacityMah', 'voltage'].includes(field) ? 'number' : 'text'} inputMode={['capacityMah', 'voltage'].includes(field) ? 'decimal' : undefined} min={['capacityMah', 'voltage'].includes(field) ? '0.000001' : undefined} step="any" maxLength={field === 'chemistry' ? 40 : 120} autoComplete="off" /></label>)}<p className="mi-help">Leave unknown specifications blank. Model suggestions need a physical check.</p>{selection && <details className="mi-model-evidence"><summary>Reviewed model evidence</summary><p>{selection.origin} · {selection.id}<br />Content hash: {selection.contentHash}<br />Applied fields: {selection.appliedFields.join(', ') || 'None; manual values retained'}</p></details>}</div></details>
    </>}
    {section !== 'battery' && <>
      <PhoneChoice label="Responsible staff owner *" name="ownerId" disabled={disabled} value={values.ownerId || ''} options={ownerOptions} searchable onChange={next => onChange('ownerId', next)} />
      <PhoneChoice label="Registered room · optional" name="homeRoomId" disabled={disabled} value={values.homeRoomId || ''} options={rooms} searchable onChange={next => onChange('homeRoomId', next)} />
      <p className="mi-help mi-storage-summary">J18 · Willis Annexe. Registered home is separate from dated location evidence. A placeholder is not verified room evidence.</p>
      <details className="mi-form-group"><summary>Age & service start · optional</summary><div className="mi-form-group-body"><label>Manufactured on<TemporalInput name="manufacturedOn" disabled={disabled} type="date" aria-label="Intake manufacture date" value={values.manufacturedOn || ''} max={currentSydneyDate()} onChange={event => onChange('manufacturedOn', event.target.value)} /></label><PhoneChoice label="First-use record" name="firstUseMode" disabled={disabled} value={mode} options={firstUseOptions} onChange={onMode} />{mode === 'date' && <label>First used on *<TemporalInput name="firstUsedOn" disabled={disabled} type="date" aria-label="Intake first-use date" required value={values.firstUsedOn || ''} min={values.manufacturedOn || undefined} max={currentSydneyDate()} onChange={event => onChange('firstUsedOn', event.target.value)} /></label>}<p className="mi-help">The default uses the confirmed registration date in Sydney. Leave manufacture date blank when unknown.</p></div></details>
    </>}
  </fieldset></div>;
}

/** Step changes only save local preparation. Start scanning is the sole batch preparation action. */
export function IntakePreparation({ fields, draft, disabled, error, notice, onSave, onValidate, onPrepare, onReset, onError, onBusyChange, scrollRef, manualReaderStart = false }) {
  const [step, setStep] = useState(0), [moving, setMoving] = useState(false), submitting = useRef(false), form = useRef(null), heading = useRef(null), positions = useRef({}), previousStep = useRef(0), focusField = useRef(null), reduced = usePhoneReducedMotion(), context = usePhoneContext(), mounted = useRef(false), latest = useRef(null);
  const contextKey = JSON.stringify([context?.namespace, context?.workflowOwner, fields.user.id, fields.data.user?.id || fields.user.id, fields.data.dataset || 'demo']), originalContext = useRef(contextKey);
  latest.current = { contextKey, active: context?.active !== false, disabled, draft, onSave, onValidate, onPrepare, onError, onBusyChange };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const titles = ['Battery details', 'Owner & location', 'Ready to scan'];
  const locked = disabled || moving;
  function goStep(next) { if (scrollRef?.current) positions.current[step] = scrollRef.current.scrollTop; setStep(next); }
  useLayoutEffect(() => { if (scrollRef?.current) scrollRef.current.scrollTop = positions.current[step] || 0; heading.current?.focus({ preventScroll: true }); if (focusField.current) { const control = form.current?.querySelector?.(`[name="${focusField.current}"]`); focusField.current = null; let details = control?.closest?.('details'); while (details) { details.open = true; details = details.parentElement?.closest?.('details'); } control?.focus?.({ preventScroll: true }); control?.scrollIntoView?.({ block: 'nearest', behavior: 'instant' }); } const changed = previousStep.current !== step; previousStep.current = step; const animation = changed && !reduced ? form.current?.animate?.([{ opacity: .45 }, { opacity: 1 }], { duration: 140, easing: 'ease-out' }) : null; return () => animation?.cancel(); }, [step, reduced, scrollRef, error]);
  usePhoneBack(() => { if (!locked && step > 0) goStep(step - 1); return true; }, { enabled: step > 0, priority: 70 });
  function locateFailure(failure) { const field = failure?.issues?.[0]?.path?.at(-1) || (/owner/i.test(failure?.message || '') ? 'ownerId' : /room/i.test(failure?.message || '') ? 'homeRoomId' : /first.use/i.test(failure?.message || '') ? 'firstUsedOn' : /manufacture|battery dates/i.test(failure?.message || '') ? 'manufacturedOn' : null); if (!field) return; const next = ['name','model','chemistry','capacityMah','voltage'].includes(field) ? 0 : 1; focusField.current = field; goStep(next); }
  async function advance(event) {
    event.preventDefault(); if (locked || submitting.current) return;
    const busy = latest.current.onBusyChange;
    submitting.current = true; busy?.(true); setMoving(true);
    const current = () => { const value = latest.current; if (!mounted.current) return null; if (value.contextKey !== originalContext.current || !value.active) throw new Error('The account or inventory changed. Preparation is retained; reopen intake.'); if (value.disabled || value.draft.clearing) throw new Error('Preparation is paused while protected work is resolved. Your details are retained.'); return value; };
    try {
      const start = current(); if (!start) return;
      await start.onSave();
      const checked = current(); if (!checked) return;
      if (step === 1) checked.onValidate();
      if (step < 2) goStep(step + 1);
      else { const result = await checked.onPrepare(form.current); if (mounted.current && result !== true) locateFailure(result); }
    } catch (failure) { if (mounted.current) { latest.current.onError(failure); locateFailure(failure); } }
    finally { submitting.current = false; busy?.(false); if (mounted.current) setMoving(false); }
  }
  const values = fields.values, owner = fields.data.people.find(person => person.id === values.ownerId), room = fields.data.rooms.find(item => item.id === values.homeRoomId);
  return <form ref={form} className="mi-setup mi-preparation" data-preparation-step={step + 1} onSubmit={advance}>
    <ol className="mi-step-progress" aria-label="Intake preparation steps">{titles.map((title, index) => <li key={title} aria-current={index === step ? 'step' : undefined}><span>{index < step ? <Check size={15} /> : index + 1}</span><small>{title}</small></li>)}</ol>
    <h2 ref={heading} tabIndex={-1}>{titles[step]}</h2><p className="mi-step-intro">{step === 0 ? 'Set details once for this batch. Individual drafts can still be edited in Review.' : step === 1 ? 'Choose who is responsible and where this batch is registered.' : 'These details will be copied to each new draft. Scanning stages drafts for Review.'}</p>
    {draft.restored && <p className="mi-local-status" role="status">Saved preparation restored. Review these details before scanning.</p>}
    {step < 2 ? <CommonFields {...fields} section={step === 0 ? 'battery' : 'owner'} disabled={locked || fields.disabled} /> : <div className="mi-preparation-review"><dl>{[['Battery name', values.name], ['Model', values.model || 'Not recorded'], ['Responsible owner', owner ? `${owner.name} · ${fields.data.staffDirectory.find(account => account.id === owner.accountId)?.username || owner.accountId}` : 'Selection unavailable'], ['Registered home', `J18 · ${room?.name || (values.homeRoomId ? 'Selection unavailable' : 'Room unspecified')}${room?.isPlaceholder ? ' · Unverified placeholder' : ''}`], ['Manufactured on', values.manufacturedOn || 'Not recorded'], ['First use', fields.mode === 'at_registration' ? 'Each confirmed registration date' : fields.mode === 'unknown' ? 'Unknown' : values.firstUsedOn || 'Not recorded']].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl><Pressable className="mi-secondary" disabled={locked} onClick={() => goStep(0)}><Pencil size={16} />Edit details</Pressable><p className="mi-id-explanation">Unique BAT IDs are assigned after you confirm registration in Review. Starting the reader does not register a battery.</p></div>}
    {error && <p className="mi-error" role="alert">{error}</p>}{notice && <p className="mi-notice" role="status">{notice}</p>}
    <footer>{step > 0 ? <Pressable className="mi-secondary" disabled={locked} onClick={() => goStep(step - 1)}>Back</Pressable> : <Pressable className="mi-secondary" disabled={locked} onClick={onReset}>Reset common details</Pressable>}<button type="submit" className="mi-primary" disabled={locked || !!draft.error || draft.pending}>{moving ? 'Saving…' : step === 2 ? manualReaderStart ? 'Open scanner' : 'Start scanning' : 'Continue'}</button></footer>
  </form>;
}
