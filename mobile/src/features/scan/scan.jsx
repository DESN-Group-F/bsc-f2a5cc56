import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowLeft, ArrowRight, ArrowUpFromLine, BatteryPlus, ChevronDown, Expand, Nfc, Search, Settings2, Trash2, X } from 'lucide-react';
import { businessStorage, native, saveFile } from '../../platform/runtime.mjs';
import { isActiveBattery } from '../../shared/lib/battery-lifecycle.js';
import { isSelectableRoom } from '../../shared/lib/location-catalog.js';
import { InkOrb } from './ink-orb.jsx';
import { acquisitionOf, scanSourceLabel } from './scan-controller.mjs';
import { useScanWorkflow } from './use-scan-workflow.js';
import { scanInputMode } from './input-mode.mjs';
import { emptyScanCandidates, filterScanCandidates, projectScanCandidates } from './scan-candidates.mjs';
import { createPhoneWorkflowPortal, Pressable, usePhoneBack, usePhoneContext, usePhoneOverlayDismiss, usePhonePress } from '../../app/phone-ui.jsx';
import './scan.css';
import { PhoneChoice } from '../../app/phone-choice.jsx';
import { ScanOutcomeStatus } from './outcome-status.jsx';
import { useScanModeMotion } from './use-scan-mode-motion.js';
import { phoneEntryMessage, phoneEntryTitle } from '../../app/phone-entry-intent.mjs';

const titles = { checkout: 'Check out', return: 'Check in / Return', intake: 'New battery intake', removal: 'Retire or remove' };
const icons = { checkout: ArrowUpFromLine, return: ArrowDownToLine, intake: BatteryPlus, removal: Trash2 };
const colors = { checkout: 'blue', return: 'yellow', intake: 'purple', removal: 'slate' };
const datasetLabel = dataset => dataset === 'demo' ? 'Demonstration inventory' : 'Working inventory';
const timeLabel = value => new Date(value).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short', hour12: false });

export function ScanHome({ data, user, dataset, active = true, onOperation, onLookup, entryPending = null, onCancelOpening, onRetryOpening }) {
  const phoneContext=usePhoneContext();
  const preparing = !!entryPending && entryPending.phase !== 'failed';
  const labels = { checkout:'Check out',return:'Return',intake:'Intake',removal:'Removal' };
  const descriptions = { checkout:'Check out: prepare batteries for your account',return:'Return: prepare batteries from a recorded loan',intake:'Intake: register new batteries',removal:'Removal: review battery retirement or removal' };
  return <section className="mobile-scan-home" data-ink-gaze-scope>
    <div className="scan-home-heading" data-shell-heading={!!phoneContext}><h1 className={phoneContext?'scan-screen-reader-title':undefined}>Scan</h1></div>
    <div className="scan-home-composition">
      <div className="scan-lookup-entry" data-preparing={preparing} aria-busy={preparing}>
        <div className="scan-home-orb"><InkOrb color="blue" active={active && !preparing}/><i className="scan-entry-ring" aria-hidden="true"/></div>
        <div className="scan-lookup-copy">
          <strong>{entryPending ? phoneEntryTitle(entryPending) : 'Scan to view'}</strong>
          <small role={entryPending ? 'status' : undefined} aria-live="polite">{entryPending ? phoneEntryMessage(entryPending) : 'No stock changes'}</small>
          <div className="scan-entry-actions">
            <Pressable className="scan-lookup-target" onClick={onLookup} hidden={!!entryPending} disabled={!onLookup || !!entryPending} aria-label="Start scan to view battery details; no stock changes">Start scan</Pressable>
            {entryPending && <>{entryPending.phase === 'failed' && <Pressable className="scan-entry-retry" onClick={onRetryOpening}>Retry</Pressable>}<Pressable className="scan-entry-cancel" onClick={onCancelOpening} aria-label="Cancel opening">Cancel</Pressable></>}
          </div>
        </div>
      </div>
      <section className="scan-operation-group" aria-label="Battery operations">
        <div className="scan-action-grid">{Object.keys(labels).map(kind => { const Icon = icons[kind]; return <Pressable key={kind} className="scan-action-tile" data-color={colors[kind]} data-priority={kind === 'checkout' || kind === 'return' ? 'primary' : 'secondary'} aria-label={descriptions[kind]} disabled={!!entryPending || !onOperation} onClick={() => onOperation(kind)}><span className="scan-tile-icon" aria-hidden="true"><Icon size={24}/></span><strong>{labels[kind]}</strong></Pressable>; })}</div>
      </section>
    </div>
  </section>;
}

function useDialogFocus(open, ref, returnTo, onEscape) {
  const latestEscape = useRef(onEscape); latestEscape.current = onEscape;
  useEffect(() => {
    if (!open) return;
    const before = document.activeElement, target = ref.current;
    const timer = setTimeout(() => target?.querySelector('button, input, select, [tabindex="0"]')?.focus({ preventScroll: true }), 0);
    const key = event => {
      if (!target?.contains(document.activeElement)) return;
      if (event.key === 'Escape') { event.preventDefault(); latestEscape.current?.(); }
      if (event.key !== 'Tab' || !target) return;
      const controls = [...target.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]')].filter(element => element.getClientRects().length);
      if (!controls.length) return;
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', key);
    return () => { clearTimeout(timer); document.removeEventListener('keydown', key); const restore = returnTo?.current || before; setTimeout(() => { if (restore?.isConnected) restore.focus?.({ preventScroll: true }); }, 0); };
  }, [open, ref, returnTo]);
}

export function ScanWorkflow({ kind, data, user = data.user, dataset = data.dataset, initialIds = [], teachingGroup, scope, onExit, onChanged, onLockedChange }) {
  const [outcomeOpen,setOutcomeOpen]=useState(false);
  const [reviewOpen, setReviewOpen] = useState(false), [expanded, setExpanded] = useState(false), [input, setInput] = useState(initialIds.length ? 'selection' : 'native');
  const [selected, setSelected] = useState(() => [...new Set(initialIds)]), [search, setSearch] = useState(''), [tag, setTag] = useState(''), [confirm, setConfirm] = useState(null), [settings, setSettings] = useState(false), [details, setDetails] = useState(false), [moreInput, setMoreInput] = useState(false);
  const reviewEntry = useRef(null), reviewSheet = useRef(null), reviewScroll = useRef(null), confirmation = useRef(null), stageContent = useRef(null), scrollPositions = useRef({}), stageScrollMounted = useRef(false), settingsEntry = useRef(null), detailsEntry = useRef(null), moreEntry = useRef(null), stagePanel = useRef(null), [localError, setLocalError] = useState('');
  const wf = useScanWorkflow({ kind, data, user, dataset, teachingGroup, scope, onChanged, onLockedChange, reviewOpen: reviewOpen || !!confirm || settings || details || moreInput || outcomeOpen, input });
  const { session, controller } = wf, source = session.queue[0] ? acquisitionOf(session.queue[0]) : null;
  useEffect(() => { setInput(scanInputMode(controller.getSnapshot().session, initialIds)); }, [controller]);
  const selectionPress=usePhonePress();
  const operationLabel = kind === 'checkout' ? 'Check out' : 'Return';
  const paused = reviewOpen || !!confirm || settings || details || moreInput || outcomeOpen;
  const lastConfirmedRequest=session.completed.at(-1)?.receipt?.requestId;
  const lastConfirmedCount=lastConfirmedRequest?session.completed.filter(read=>read.receipt?.requestId===lastConfirmedRequest).length:0;
  const exitBlocked = !controller.canExit();
  const manualCandidatesUsed = input === 'selection' && !settings && !details;
  const candidates = useMemo(() => manualCandidatesUsed ? projectScanCandidates({ kind,data,accountId:user.id,scope:session.mobileScope,teachingGroup:session.teachingGroup,queue:session.queue,completed:session.completed }) : emptyScanCandidates,
    [manualCandidatesUsed,data,kind,user.id,session.mobileScope,session.teachingGroup?.id,session.teachingGroup?.version,session.queue,session.completed]);
  const visible = useMemo(() => filterScanCandidates(candidates,search),[candidates,search]);
  const groupName = data.teachingGroups?.find(group => group.id === session.teachingGroup?.id)?.name;
  const feedback = [wf.feedback.tone, wf.feedback.expression].filter((value, index, all) => value && all.indexOf(value) === index).join(' ');
  useEffect(() => {
    if (!reviewOpen && !confirm) return;
    const app = document.querySelector('.phone-workflow-layer') || document.querySelector('.phone-app:not(.scan-portal-root)');
    if (!app) return;
    const previous = app.inert; app.inert = true;
    return () => { app.inert = previous; };
  }, [reviewOpen, !!confirm]);
  useDialogFocus(reviewOpen, reviewSheet, reviewEntry, () => { if (!wf.busy && !session.attempt) setReviewOpen(false); });
  useDialogFocus(!!confirm, confirmation, null, () => { if (!wf.busy) setConfirm(null); });
  usePhoneOverlayDismiss(reviewSheet, () => { if (!wf.busy && !session.attempt) setReviewOpen(false); }, { enabled: reviewOpen });
  usePhoneOverlayDismiss(confirmation, () => { if (!wf.busy) setConfirm(null); }, { enabled: !!confirm });
  useEffect(() => { if (reviewOpen && (session.attempt || wf.storageError) && reviewScroll.current) reviewScroll.current.scrollTop = 0; }, [reviewOpen, session.attempt?.status, wf.storageError]);
  const contentKey = settings ? 'settings' : details ? 'details' : input;
  useScanModeMotion(stageContent,contentKey);
  useLayoutEffect(() => {
    const content = stageContent.current;
    if (content) {
      // A new container already starts at zero; avoid forcing its first layout.
      if (stageScrollMounted.current) content.scrollTop = scrollPositions.current[contentKey] || 0;
      stageScrollMounted.current = true;
    }
    return () => { if (content) scrollPositions.current[contentKey] = content.scrollTop; };
  }, [contentKey]);
  useEffect(() => {
    if (!settings && !details) return;
    const trigger = settings ? settingsEntry.current : detailsEntry.current || settingsEntry.current;
    stagePanel.current?.querySelector('button')?.focus({ preventScroll: true });
    return () => { setTimeout(() => { if (trigger?.isConnected) trigger.focus({ preventScroll: true }); }, 0); };
  }, [settings, details]);
  usePhoneBack(event => { event.preventDefault?.(); if (confirm) { if (!wf.busy) setConfirm(null); } else if (reviewOpen) { if (!wf.busy && !session.attempt) setReviewOpen(false); } else if (moreInput) { setMoreInput(false); moreEntry.current?.focus(); } else if (settings) setSettings(false); else if (details) setDetails(false); else void requestExit(); return true; }, {priority:40});
  useEffect(() => {
    const key = event => { if (event.key !== 'Escape' || reviewOpen || confirm) return; if (moreInput) { setMoreInput(false); moreEntry.current?.focus(); } else if (settings) setSettings(false); else if (details) setDetails(false); else return; event.preventDefault(); };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, [moreInput, settings, details, reviewOpen, confirm]);
  async function requestExit() {
    if (exitBlocked) { setLocalError(wf.storageError || (session.attempt ? 'Resolve the captured request before exiting.' : 'Wait for the current operation.')); return; }
    if (controller.needsExitConfirmation()) { setConfirm('exit'); return; }
    await finishExit(false);
  }
  async function finishExit(approved) {
    try { if(wf.pauseReader&&!await wf.pauseReader('Reading paused · Leaving scan'))throw new Error('Could not stop the NFC reader. Try leaving again.');if (await controller.exit(approved)) onExit?.(); } catch (error) { setLocalError(error.message); }
  }
  async function exportRecovery() {
    await wf.action(() => saveFile({ filename: `scan-recovery-${dataset}.json`, blob: new Blob([businessStorage().exportRaw()], { type: 'application/json' }) }));
  }
  async function performConfirmation() {
    const action = confirm; setConfirm(null);
    if (action === 'exit') await finishExit(true);
    else if (action === 'clear') await wf.action(() => controller.clearQueue());
    else if (action === 'discard') await wf.action(() => controller.discardRejected());
  }
  function inputLocked(next) { return wf.blocked || !!source && source !== (next === 'native' ? 'native-nfc-reader' : next); }
  function chooseInput(next) { if (inputLocked(next)) return; wf.pauseReader?.('Reading paused · Changing input source');setInput(next); setMoreInput(false); setSettings(false); setDetails(false); setLocalError(''); }
  async function addSelected() {
    const results = await wf.action(() => controller.addSelections(selected), true);
    if (results) setSelected(previous => previous.filter(id => !controller.getSnapshot().session.queue.some(read => read.battery.id === id)));
  }
  const readState = paused ? 'Reading paused' : !native ? 'Native NFC unavailable in browser' : wf.reader.state === 'ready' ? dataset === 'live' ? 'Ready · Device evidence only' : 'Ready to scan' : wf.reader.state === 'starting' ? 'Starting NFC reader' : wf.reader.state === 'lookup' ? 'Checking battery' : wf.reader.state === 'fault' ? 'Reading stopped. Try again.' : wf.reader.state === 'unavailable' ? 'NFC unavailable or disabled' : dataset === 'live' && wf.reader.state === 'evidence' ? 'Device evidence saved' : wf.reader.message;
  return <section className="mobile-scan-station" data-operation={kind} data-input={input} data-content={contentKey} data-selection-count={selected.length} data-queue-count={session.queue.length} aria-label={`${titles[kind]} scan station`}>
    <div className="mobile-scan-surface scan-focused-surface" data-ink-gaze-scope inert={reviewOpen || confirm ? true : undefined}>
      <header className="scan-station-top scan-focused-header">
        <button className="scan-icon-button" data-workflow-exit="scan" onClick={requestExit} disabled={exitBlocked} aria-label="Exit scanning"><ArrowLeft size={21}/></button>
        <div className="scan-focused-title"><h1>{titles[kind]}</h1><span>{dataset === 'demo' ? 'Demo' : 'Working'}</span></div>
        {manualCandidatesUsed && !!selected.length && <button className="scan-editing-clear scan-text-button" aria-label="Clear selected batteries while editing" onClick={() => setSelected([])} disabled={wf.blocked}>Clear selection ({selected.length})</button>}
        <button ref={settingsEntry} className="scan-icon-button" aria-label="Scan feedback preferences" aria-expanded={settings} onClick={() => { setSettings(value => !value); setDetails(false); setMoreInput(false); }}><Settings2 size={20}/></button>
      </header>
      <nav className="scan-input-tabs scan-focused-tabs" aria-label="Acquisition source" style={{'--scan-input-index':input==='selection'?1:0}}><span className="scan-input-indicator" aria-hidden="true"/>{[['native', 'NFC'], ['selection', 'Select']].map(([value, label]) => <button key={value} aria-pressed={input === value} disabled={inputLocked(value)} aria-describedby={source?'scan-source-lock':undefined} onClick={() => chooseInput(value)}>{label}</button>)}</nav>
      <div className="scan-stage-tools">
        {source&&<span className="scan-source-note" id="scan-source-lock">Queue uses {scanSourceLabel(session.queue[0])}. Remove or clear its items in Review before switching.</span>}
        {!settings&&!details&&<ScanOutcomeStatus className="scan-top-outcome" feedback={localError?{...wf.feedback,outcomeType:'failure',message:localError,capsule:''}:wf.feedback} reader={input==='native'?wf.reader:{}} idleTitle={input==='native'?'Ready to scan':input==='selection'?'Select batteries':'Enter a registered tag'} idleDetail={input==='native'?dataset==='live'?'Device evidence only · Use Select for Working transactions':undefined:'Review confirms the movement'} onOpenChange={open=>{setOutcomeOpen(open);if(open)void wf.pauseReader?.('Reading paused · Scan message is open');}}/>}
        <div className="scan-stage-utilities">{kind==='return'&&<button ref={detailsEntry} className="scan-context-control" onClick={()=>{setDetails(true);setSettings(false);setMoreInput(false);}} aria-label="Review optional return placement">Return placement<ChevronDown size={14}/></button>}
        {<div className="scan-more-input"><button ref={moreEntry} className="scan-text-button" aria-haspopup="menu" aria-expanded={moreInput} onClick={() => setMoreInput(value => !value)}>More input<ChevronDown size={14}/></button>{moreInput && <div className="scan-input-menu" role="menu" aria-label="More input"><button role="menuitem" disabled={inputLocked('tag')} onClick={() => chooseInput('tag')}>Tag input<small>Enter an exact registered tag</small></button>{!native && dataset === 'demo' && <button role="menuitem" disabled={inputLocked('simulated')} onClick={() => chooseInput('simulated')}>Demo preview<small>Local simulated tag input</small></button>}</div>}</div>}</div>
      </div>
      {(wf.storageError || session.attempt || session.roomConfirmationRequired) && <div className="scan-stage-alert" role="alert"><span>{wf.storageError ? 'Recovery storage needs attention' : session.attempt ? wf.busy ? 'Saving · Waiting for server' : session.attempt.status === 'uncertain' ? 'Result not confirmed' : 'Review saved request' : 'Confirm return placement'}</span><button className="scan-text-button" onClick={() => { if (session.attempt) setReviewOpen(true); else { setDetails(true); setSettings(false); } }}>{session.attempt ? 'Review' : 'Details'}</button></div>}
      <div ref={stageContent} data-phone-sheet-scroll className={`scan-stage-content ${input === 'native' && !details && !settings ? 'is-nfc' : ''}`}>
        {settings ? <section ref={stagePanel} className="scan-feedback-preferences scan-stage-panel" aria-label="Scan feedback settings"><div className="scan-stage-panel-heading"><h2>Feedback</h2><button className="scan-icon-button" aria-label="Close scan settings" onClick={() => setSettings(false)}><X size={20}/></button></div><label><input type="checkbox" checked={wf.preferences.haptics} onChange={event => wf.changePreferences({ haptics: event.target.checked })}/>Short haptics</label><label><input type="checkbox" checked={wf.preferences.sounds} onChange={event => wf.changePreferences({ sounds: event.target.checked })}/>Scan sounds</label><PhoneChoice label="Haptic strength" value={wf.preferences.strength} options={[{value:'light',label:'Light'},{value:'medium',label:'Medium'}]} onChange={value=>wf.changePreferences({strength:value})}/><button className="scan-secondary-button" onClick={()=>{setSettings(false);setDetails(true);}}>Session details</button></section> : details ? <section ref={stagePanel} className="scan-stage-panel" aria-label="Scan session details">
          <div className="scan-stage-panel-heading"><h2>Session details</h2><button className="scan-icon-button" aria-label="Close scan details" onClick={() => setDetails(false)}><X size={20}/></button></div>
          <div className="scan-context">{kind === 'checkout' ? <p>Check out to <strong>{user.displayName}</strong></p> : <PhoneChoice label="Return placement · optional" value={session.roomConfirmationRequired?'__required':session.room?.id||''} disabled={wf.busy||!!wf.storageError||!!session.attempt||!session.roomConfirmationRequired&&(!!session.queue.length||!!session.completed.length)} options={[...(session.roomConfirmationRequired?[{value:'__required',label:'Confirm return placement',disabled:true}]:[]),{value:'',label:'Room unspecified'},...data.rooms.filter(isSelectableRoom).map(room=>({value:room.id,label:room.name,description:room.isPlaceholder?'Unverified placeholder':undefined,disabled:dataset==='live'&&room.isPlaceholder}))]} onChange={value=>wf.action(()=>controller.chooseRoom(value))}/>}{session.room && <small>{session.room.isPlaceholder ? 'Demonstration placeholder; not verified physical location.' : 'Dated return confirmation; separate from registered storage.'}</small>}{groupName && <small>Teaching group · {groupName}</small>}{session.mobileScope && <small>Fixed view · {session.mobileScope.label || 'Reviewed selection'}</small>}</div>
          <p className="scan-help">{datasetLabel(dataset)} · One acquisition source per queue. Reads stage identities; only confirmation in Review saves a movement.</p>
          {source && <p className="scan-help">Current source: {scanSourceLabel(session.queue[0])}</p>}
          <p className="scan-help">{wf.reader.message}</p>
          {exitBlocked && <p className="scan-exit-reason">{wf.busy ? 'Wait for the current action.' : wf.storageError ? 'Restore recovery storage before exit.' : 'Resolve the captured request before exit.'}</p>}
          {(wf.feedback.message || localError) && <p className="scan-notice" role="status">{localError || wf.feedback.message}</p>}
          {wf.storageError && <div className="scan-protected-notice" role="alert"><strong>Device save needs attention</strong><p>Your original work is retained. Retry the device save before continuing.</p><details><summary>Technical details</summary><p>{wf.storageError}</p></details><button onClick={() => wf.action(() => controller.retryStorage())} disabled={wf.busy}>Retry device save</button><button disabled={wf.busy} onClick={exportRecovery}>Export preserved data</button></div>}
          {wf.deviceEvidence && <details className="scan-device-evidence"><summary>Saved native device evidence · {wf.deviceEvidence.tagId}</summary><p>Device-reported UID and raw NDEF are saved independently. Demonstration review does not establish physical hardware acceptance.</p><pre>{JSON.stringify(wf.deviceEvidence, null, 2)}</pre></details>}
          {!!session.completed.length && <details className="scan-completed"><summary>Saved this session · {session.completed.length}</summary>{session.completed.map(read => <article key={`${read.receipt.requestId}:${read.battery.id}`}><strong>{read.battery.name} · {read.battery.id}</strong><small>{kind === 'checkout' ? `Checked out to ${read.receipt.borrower}` : 'Returned'} · {timeLabel(read.receipt.at)}<br/>{scanSourceLabel(read)}</small></article>)}</details>}
          {!!session.issues.length && <details className="scan-issues"><summary>Read evidence and issues · {session.issues.length}</summary>{session.issues.map(issue => <article key={issue.id}><p>{issue.message}</p><small>{issue.tagId} · {issue.acknowledged ? 'Acknowledged' : 'Needs attention'}</small>{!issue.acknowledged && issue.id !== session.attempt?.payload.requestId && <button disabled={wf.blocked} onClick={() => wf.action(() => controller.acknowledge(issue.id))}>Acknowledge</button>}</article>)}</details>}
        </section> : input === 'native' ? <div className="scan-orb-stage scan-focused-orb"><InkOrb color={colors[kind]} feedback={feedback} active={!paused && wf.foreground} sequence={wf.feedback.sequence} event={wf.feedback.event} successSequence={wf.feedback.successSequence}/>{dataset==='live'&&<button className="scan-text-button" disabled={inputLocked('selection')} onClick={()=>chooseInput('selection')}>Use Select</button>}{!paused && native && ['fault', 'unavailable','paused'].includes(wf.reader.state) && <button className="scan-text-button" disabled={wf.blocked} onClick={wf.resumeReader}>Check reader again</button>}</div> : input === 'selection' ? <section className="scan-manual-panel scan-stage-panel">
          <div className="scan-panel-heading"><h2>Manual selection</h2><span>{selected.length} selected</span></div><div className="scan-selection-search"><label className="scan-search"><Search size={17}/><input placeholder="Find battery, name or tag" aria-label="Search manual selection" value={search} enterKeyHint="done" onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); } }} onChange={event => setSearch(event.target.value)} disabled={wf.blocked}/></label><button className="scan-text-button" onClick={() => setSearch('')} disabled={wf.blocked}>Clear filters</button></div><div className="scan-selection-list" {...selectionPress} onClick={undefined} onClickCapture={selectionPress.onClick}>{visible.map(battery => <label key={battery.id} className="scan-selection-row"><input type="checkbox" disabled={wf.blocked || !selected.includes(battery.id) && selected.length >= 100} checked={selected.includes(battery.id)} onChange={event => setSelected(previous => event.target.checked ? [...new Set([...previous, battery.id])] : previous.filter(id => id !== battery.id))}/><span><strong>{battery.name}</strong><small><span className="scan-candidate-id">{battery.id}</span><span className="scan-candidate-state">{battery.loanId ? `In use · ${battery.borrowerName || 'Staff holder'}` : 'In store'}</span></small></span></label>)}{!visible.length && <p className="scan-help">No eligible batteries match. Queued items remain in Review queue.</p>}</div>
        </section> : input === 'tag' ? <form className="scan-tag-panel scan-stage-panel" onSubmit={async event => { event.preventDefault(); const result = await wf.action(() => controller.addTag(tag), true); if (result?.type === 'accepted' || result?.type === 'duplicate') setTag(''); }}><h2>Tag input</h2><label>Registered tag identifier<input value={tag} onChange={event => setTag(event.target.value)} maxLength={128} disabled={wf.blocked} placeholder="Exact registered tag"/></label><button className="scan-filled-button" disabled={wf.blocked || !tag.trim()}>Add tag to review</button><p className="scan-help">Typed input is recorded separately from device evidence.</p></form> : !native && dataset === 'demo' ? <section className="scan-demo-panel scan-stage-panel"><strong>Local demonstration tag simulation</strong><p>This controlled preview is never native hardware evidence. Saved movements retain the simulated source.</p><div>{data.batteries.filter(battery => battery.tagId && isActiveBattery(battery)).slice(0, 12).map(battery => <button key={battery.id} disabled={wf.blocked} onClick={() => wf.action(() => controller.addTag(battery.tagId, 'simulated'), true)}>{battery.name}<small>{battery.id} · {battery.tagId}</small></button>)}</div></section> : null}
      </div>
      <div className="scan-stage-footer">
        
        {input === 'selection' && !settings && !details && <div className="scan-manual-actions"><button className="scan-secondary-button" onClick={() => setSelected([])} disabled={wf.blocked || !selected.length}>Clear selection</button><button className="scan-filled-button" onClick={addSelected} disabled={wf.blocked || !selected.length}>Add to review ({selected.length})</button></div>}
        <button ref={reviewEntry} className="scan-review-entry" data-feedback={wf.feedback.tone} onClick={() => { setMoreInput(false); setReviewOpen(true); }} aria-label={`Review queue, ${session.queue.length} ${session.queue.length===1?'battery':'batteries'}`}><span><strong>Review queue</strong><small>{wf.feedback.tone === 'success' && wf.feedback.latest && session.queue.some(read => read.battery.id === wf.feedback.latest.id) ? `${wf.feedback.latest.name} · Added to review` : session.queue.length ? 'Pending review · Not submitted' : 'No batteries awaiting review'}</small></span><span className="scan-queue-count">{session.queue.length}<ChevronDown size={17}/></span></button></div>
    </div>
    {reviewOpen && createPhoneWorkflowPortal(<div className="phone-app scan-portal-root" data-operation={kind}><div className="scan-review-backdrop"><section ref={reviewSheet} inert={confirm ? true : undefined} className={`scan-review-sheet ${expanded ? 'is-expanded' : ''}`} role="dialog" aria-modal="true" aria-labelledby="scan-review-title"><div className="scan-sheet-handle"/><header><div><h2 id="scan-review-title">Review queue <span>{session.queue.length}</span></h2><small>{titles[kind]} · {datasetLabel(dataset)}</small></div><button className="scan-icon-button" aria-label={expanded ? 'Reduce review height' : 'Expand review'} onClick={() => setExpanded(value => !value)}><Expand size={19}/></button><button className="scan-icon-button" aria-label="Close review and retain queue" disabled={wf.busy || !!session.attempt} onClick={() => setReviewOpen(false)}><X size={21}/></button></header><div ref={reviewScroll} className="scan-review-scroll" data-phone-sheet-scroll>{wf.storageError && <section className="scan-protected-notice" role="alert"><strong>Device save needs attention</strong><p>Your original work is retained. Retry the device save before continuing.</p><button disabled={wf.busy} onClick={()=>wf.action(()=>controller.retryStorage())}>Retry device save</button><button disabled={wf.busy} onClick={exportRecovery}>Export preserved data</button><details><summary>Technical details</summary><p>{wf.storageError}</p>{wf.feedback.message && wf.feedback.message !== wf.storageError && <p>{wf.feedback.message}</p>}</details></section>}{session.attempt && <section className="scan-protected-notice" role="alert"><strong>{wf.busy ? 'Saving · Waiting for the server' : session.attempt.status === 'uncertain' ? 'Result not confirmed' : 'Movement rejected'}</strong><p>{session.attempt.status==='uncertain' ? 'It may have been saved. Check the original request before doing anything else.' : 'This request was rejected. Review current records before preparing another.'}</p><details className="scan-reviewed-facts"><summary>Request details</summary><p>{session.attempt.message}</p>{wf.feedback.message && wf.feedback.message !== session.attempt.message && <p>{wf.feedback.message}</p>}<small>Original request: {session.attempt.payload.requestId}</small></details><button disabled={wf.busy || !!wf.storageError} onClick={() => wf.action(() => controller.retry())}>Check original request</button>{session.attempt.status === 'rejected' && <button disabled={wf.busy || !!wf.storageError} onClick={() => wf.action(() => controller.reviewLatest())}>Review current records</button>}{wf.latest && session.attempt.status === 'rejected' && <div>{session.attempt.reads.map(read => { const current = wf.latest.inventory.batteries.find(item => item.id === read.battery.id); return <p key={read.battery.id}>{read.battery.id}: Captured version {read.battery.version}, {read.battery.loanId ? 'active loan' : 'in store'}. Current: {current ? `version ${current.version}, ${current.loanId ? current.loanId === read.battery.loanId ? 'same loan' : 'different loan' : 'no active loan'}` : 'unavailable'}. Captured tag: {read.tagId || 'none'}; current tag: {current?.tagId || 'none'}.</p>; })}<button disabled={wf.busy || !!wf.storageError} onClick={() => setConfirm('discard')}>Discard rejected request after review</button></div>}</section>}{!!session.completed.length&&<section className="scan-saved-summary" role="status"><strong>{kind==='checkout'?'Last check out saved':'Last return saved'}</strong><p>{lastConfirmedCount} {lastConfirmedCount===1?'battery':'batteries'} confirmed · {timeLabel(session.completed.at(-1).receipt.at)}<br/>{session.queue.length} pending</p></section>}<p className="scan-help">Reading paused. Review the captured identities before confirming. {kind === 'checkout' ? `Holder: ${user.displayName}.` : `Return placement: ${session.room?.name || 'Room unspecified'}.`}</p>{session.queue.map(read => <article className="scan-review-row" key={read.battery.id}><div><strong>{read.battery.name}</strong><small>{read.battery.id}<br/>{read.battery.loanId ? `In use · ${read.battery.borrowerName || 'Staff holder'}` : 'In store'}</small><details className="scan-reviewed-facts"><summary>Reviewed details</summary><small>Tag: {read.tagId || 'No registered tag'}<br/>Owner: {read.battery.ownerName}<br/>{scanSourceLabel(read)} · Version {read.battery.version}{read.battery.loanId&&<><br/>Exact loan: {read.battery.loanId}</>}</small></details></div><button className="scan-icon-button" aria-label={`Remove ${read.battery.id} from queue`} disabled={wf.blocked} onClick={() => wf.action(() => controller.remove(read.battery.id))}><Trash2 size={18}/></button></article>)}{!session.queue.length && <p className="scan-help">No pending batteries. Close review to continue acquiring.</p>}{!session.attempt && !wf.storageError && wf.feedback.message && <p role="status">{wf.feedback.message}</p>}</div><footer><button className="scan-text-button" onClick={() => setConfirm('clear')} disabled={wf.blocked || !session.queue.length}>Clear queue</button><div>{wf.blocked && <small>{wf.busy ? 'Wait for the current action.' : session.attempt ? 'Resolve the original request.' : wf.storageError ? 'Restore recovery storage.' : 'Confirm return placement.'}</small>}<button className="scan-confirm-button" disabled={wf.blocked || !session.queue.length} onClick={() => wf.action(() => controller.confirmQueue())}>{wf.busy ? 'Saving…' : `${operationLabel} (${session.queue.length})`}</button></div></footer></section></div></div>, document.body)}
    {confirm && createPhoneWorkflowPortal(<div className="phone-app scan-portal-root scan-confirm-portal" data-operation={kind}><div className="scan-confirm-backdrop"><section ref={confirmation} role="alertdialog" aria-modal="true" aria-labelledby="scan-local-confirm" className="scan-local-confirm"><h2 id="scan-local-confirm">{confirm === 'exit' ? 'Exit scanning?' : confirm === 'clear' ? 'Clear unsubmitted queue?' : 'Discard rejected request?'}</h2><p>{confirm === 'exit' ? 'Unsubmitted reads and unacknowledged issues will leave this station. Saved movements remain in the official history.' : confirm === 'clear' ? 'Queued reads will be removed. No checkout or return is performed.' : 'This request was definitively rejected and current records have been reviewed. Discarding it does not act on a newer loan. Read and review again before a new request.'}</p><div><button onClick={() => setConfirm(null)}>Keep working</button><button className="scan-filled-button" onClick={performConfirmation}>{confirm === 'exit' ? 'Exit scanning' : confirm === 'clear' ? 'Clear queue' : 'Discard rejected request'}</button></div></section></div></div>, document.body)}
  </section>;
}





