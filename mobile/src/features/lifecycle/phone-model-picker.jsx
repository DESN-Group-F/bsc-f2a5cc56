import React, { useEffect, useId, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { createPhoneWorkflowPortal, Pressable, usePhoneBack, usePhoneOverlayDismiss } from '../../app/phone-ui.jsx';
import { modelFieldNames, modelFieldValue } from '../../shared/lib/battery-models.js';
import { usePhoneModelController } from './phone-model-controller.js';
export { modelCreateStorageKey } from './phone-model-controller.js';
import './phone-model-picker.css';

const labels = { name:'Battery name', model:'Model', chemistry:'Chemistry', capacityMah:'Capacity (mAh)', voltage:'Nominal voltage (V)' };
const origins = { saved:'Saved model', inventory:'Registered batteries', reference:'Research reference' };
const keyOf = choice => `${choice.origin}:${choice.id}`;
const safeUrl = value => { try { const url = new URL(value); return ['https:','http:'].includes(url.protocol) ? url.href : null; } catch { return null; } };

/** Phone fields keep compact square glyphs and full labeled touch rows. */
export function PhoneModelPicker(props) {
  const m = usePhoneModelController(props), [search,setSearch] = useState(''), [finding,setFinding] = useState(false), id = useId();
  const root = useRef(null), entry = useRef(null), finder = useRef(null), searchInput = useRef(null);
  const closeFinder = () => setFinding(false);
  usePhoneBack(() => { closeFinder(); return true; }, { enabled:finding, priority:250 });
  usePhoneOverlayDismiss(finder,closeFinder,{enabled:finding});
  useEffect(() => {
    if (!finding) return;
    const parent = root.current?.closest('.mi-review-sheet,.manual-registration,[data-ink-gaze-scope]') || root.current?.closest('form'), wasInert = parent?.inert;
    const positions=[];for(let node=root.current?.parentElement;node;node=node.parentElement)if(node.scrollHeight>node.clientHeight)positions.push([node,node.scrollTop]);
    if(parent)parent.inert=true;
    searchInput.current?.focus({preventScroll:true});
    const key = event => {
      if(event.key==='Escape'){event.preventDefault();closeFinder();return;}
      if(event.key!=='Tab')return;
      const controls=[...(finder.current?.querySelectorAll('button:not(:disabled),input:not(:disabled),a[href]')||[])].filter(node=>node.getClientRects().length);
      if(!controls.length)return;const first=controls[0],last=controls.at(-1);
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
    };
    document.addEventListener('keydown',key);
    return()=>{document.removeEventListener('keydown',key);if(parent)parent.inert=wasInert;for(const[node,position]of positions)if(node.isConnected)node.scrollTop=position;entry.current?.focus({preventScroll:true});};
  },[finding]);
  const matching = m.choices.filter(choice => `${choice.label} ${choice.brand || ''} ${choice.model || ''} ${choice.variant || ''}`.toLowerCase().includes(search.toLowerCase()));
  const fields = [['brand','Brand / manufacturer',80],['model','Model *',120],['variant','Variant / configuration',120],['name','Suggested battery name *',120],['chemistry','Chemistry',40],['capacityMah','Capacity (mAh)',null],['voltage','Nominal voltage (V)',null]];
  return <section ref={root} className="phone-model" aria-label="Battery model assistance" aria-busy={m.saving}>
    <div className="phone-model-heading"><div><h3>Model template</h3><p>Check the physical model before using specifications.</p></div><Pressable className="phone-model-secondary" disabled={m.blocked || !!m.recovery.error || m.adding || !!m.pending} onClick={m.openNewModel}>Create model</Pressable></div>
    {!m.contextMatches && <p className="phone-model-error" role="alert">The inventory or account changed. Reopen registration before choosing a model.</p>}
    {!m.adding && <>
      <Pressable ref={entry} className="phone-model-pick" disabled={m.blocked || !!m.pending} aria-haspopup="dialog" aria-expanded={finding} onClick={() => setFinding(true)}><Search size={19}/><span>{m.choice?.label || 'Find a model'}</span></Pressable>
      {finding && createPhoneWorkflowPortal(<div className="phone-model-portal"><section ref={finder} className="phone-model-finder" role="dialog" aria-modal="true" aria-labelledby={`${id}-finder-title`}><header><h3 id={`${id}-finder-title`}>Find a model</h3><Pressable className="phone-model-close" aria-label="Close model finder and keep parameter details" onClick={closeFinder}><X size={21}/></Pressable></header><div className="phone-model-search"><label htmlFor={`${id}-search`} className="phone-model-search-label">Search model, brand or variant</label><div className="phone-model-search-box"><Search size={18}/><input ref={searchInput} id={`${id}-search`} type="search" value={search} onChange={event => setSearch(event.target.value)} disabled={m.blocked} placeholder="Model, brand or variant" autoComplete="off"/>{search && <Pressable className="phone-model-clear" aria-label="Clear model search" onClick={() => setSearch('')}><X size={18}/></Pressable>}</div></div><div className="phone-model-results" data-phone-sheet-scroll>{m.loading ? <p role="status">Loading models…</p> : matching.map(choice => <Pressable key={keyOf(choice)} aria-pressed={m.selectedKey === keyOf(choice)} disabled={m.blocked || !!m.pending} onClick={() => { m.selectModel(keyOf(choice)); setFinding(false); }}><span><strong>{choice.label}</strong><small>{origins[choice.origin]}</small></span></Pressable>)}{!m.loading && !matching.length && <p>No matching models. Close to continue with manual details.</p>}{m.current && m.loaded.error && <p className="phone-model-error" role="alert">{m.loaded.error}</p>}</div></section></div>,document.body)}
      <div className="phone-model-actions"><Pressable className="phone-model-text" disabled={m.blocked || m.loading || !!m.pending} onClick={() => m.setRevision(value => value + 1)}>Reload models</Pressable><Pressable className="phone-model-text" disabled={m.blocked || !!m.pending || !m.choice && !props.selection} onClick={m.manual}>Use manual details</Pressable></div>
      {m.current && m.loaded.error && <p className="phone-model-error" role="alert">{m.loaded.error}</p>}
      {m.choice && <section className="phone-model-preview"><h4>{m.choice.label}</h4><p>{origins[m.choice.origin]} · {m.choice.verificationStatus.replaceAll('_',' ')}</p><dl>{[['Brand',m.choice.brand],['Variant',m.choice.variant],['Capacity basis',m.choice.capacityBasis]].map(([label,value]) => <div key={label}><dt>{label}</dt><dd>{value || 'Not recorded'}</dd></div>)}</dl>
        {m.choice.warnings.length > 0 && <p className="phone-model-protected"><strong>Review before use:</strong> {m.choice.warnings[0]}{m.choice.warnings.length > 1 ? ` · ${m.choice.warnings.length} recorded limitations` : ''}</p>}
        <fieldset className="phone-model-choices"><legend>Information to use</legend>{modelFieldNames.map(field => { const suggested = modelFieldValue(m.choice,field); return <label key={field} className="phone-model-choice"><input type="checkbox" checked={m.appliedFields.includes(field)} disabled={m.blocked || !!m.pending || !suggested} onChange={event => m.reviewField(field,event.target.checked)}/><span><strong>{labels[field]}</strong><span>{suggested || 'Not recorded; your value is retained.'}</span>{m.conflicts(field) && suggested && <small>Entered: {props.values[field]}. Select to replace.</small>}</span></label>; })}</fieldset>
        {(m.choice.notes || m.choice.warnings.length > 0 || m.choice.sources.length > 0) && <details className="phone-model-evidence"><summary>Notes, limitations & sources</summary>{m.choice.notes && <p>{m.choice.notes}</p>}{m.choice.warnings.map((warning,index) => <p key={index}>{warning}</p>)}{m.choice.sources.map(source => <p key={source.id}>{safeUrl(source.url) ? <a href={safeUrl(source.url)} target="_blank" rel="noopener noreferrer">{source.title || 'Reference source'}</a> : source.title || 'Source link unavailable'}</p>)}</details>}
        <div className="phone-model-actions">{props.canEditModels && m.choice.origin === 'saved' && <Pressable className="phone-model-secondary" disabled={m.blocked || m.loading || m.adding || !!m.pending || !m.choice.version} onClick={m.openEditModel}>Edit saved model</Pressable>}<Pressable className="phone-model-primary" disabled={m.blocked || m.loading || !!m.pending || !m.appliedFields.length} onClick={m.apply}>Use this model</Pressable></div>
      </section>}
    </>}
    {props.selection && <p className="phone-model-note">{props.selection.appliedFields.length} model fields linked; individual battery edits are retained.</p>}
    {m.current && m.loaded.issues.length > 0 && <details><summary>Reference issues ({m.loaded.issues.length})</summary>{m.loaded.issues.map((issue,index) => <p key={index}>{issue.model}: {issue.message}</p>)}</details>}
    {m.adding && <section className="phone-model-editor"><h4>{m.editing ? 'Edit reusable model' : 'Create reusable model'}</h4><p>This saves a template. Existing batteries retain their recorded values. Leave unknown specifications blank.</p><div className="phone-model-form">{fields.map(([field,label,limit]) => <label key={field} htmlFor={`${id}-${field}`} className="phone-model-field"><span>{label}</span><input id={`${id}-${field}`} form={`${id}-model-template`} value={m.draft[field] || ''} disabled={m.blocked || !!m.pending} maxLength={limit || undefined} type={['capacityMah','voltage'].includes(field) ? 'number' : 'text'} min={['capacityMah','voltage'].includes(field) ? 0 : undefined} step="any" onChange={event => m.setDraft(value => ({...value,[field]:event.target.value}))}/></label>)}<label className="phone-model-field">Notes · optional<textarea form={`${id}-model-template`} value={m.draft.notes || ''} maxLength={1000} disabled={m.blocked || !!m.pending} onChange={event => m.setDraft(value => ({...value,notes:event.target.value}))}/></label></div>
      {m.editConflict && <section className="phone-model-conflict"><h4>The saved model changed</h4><Pressable className="phone-model-secondary" disabled={m.blocked} onClick={m.reviewLatestModel}>Review latest model</Pressable>{m.modelReview && <><p>Latest version {m.modelReview.version}. Your draft is retained.</p>{[...fields.map(([field]) => field),'notes'].filter(field => (m.draft[field] || '') !== (m.modelReview[field] == null ? '' : String(m.modelReview[field]))).map(field => <p key={field}><strong>{labels[field] || field}</strong>: Latest {String(m.modelReview[field] ?? 'Not recorded')}; draft {m.draft[field] || 'Not recorded'}.</p>)}<Pressable className="phone-model-secondary" disabled={m.blocked} onClick={m.useReviewedVersion}>Use reviewed version</Pressable></>}</section>}
      {m.pending && <p className="phone-model-protected" role="status">Original model request retained. Retry uses its exact ID and fields; it does not register a battery.</p>}
      <div className="phone-model-actions"><Pressable className="phone-model-secondary" disabled={m.blocked || !!m.pending} onClick={m.cancelModel}>Cancel model</Pressable><Pressable className="phone-model-primary" disabled={m.blocked || !!m.recovery.error || m.editConflict || m.editAccessLost && !m.pending} onClick={m.saveModel}>{m.saving ? 'Saving…' : m.pending ? 'Retry saved model request' : m.editing ? 'Save model changes' : 'Save reusable model'}</Pressable></div>
    </section>}
    {m.editAccessLost && <p className="phone-model-error" role="alert">Model edits require administrator access. The draft and original request are retained.</p>}
    {m.error && <p className="phone-model-error" role="alert">{m.error}</p>}{m.notice && <p className="phone-model-note" role="status">{m.notice}</p>}
  </section>;
}
