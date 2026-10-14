import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Download, Search } from 'lucide-react';
import { businessStorage, native } from '../../platform/runtime.mjs';
import { inventoryResponse } from '../../shared/lib/client/inventory-request.js';
import { batteryStatusLabel } from '../../shared/lib/battery-lifecycle.js';
import { formatTime, storageRoomLabel } from '../../shared/lib/client-utils.js';
import { useWorkflowLock } from '../../business/workflow-boundary.jsx';
import { Pressable, usePhoneBack, usePhoneContext } from '../../app/phone-ui.jsx';
import { ScanCharacter as InkOrb } from './scan-character.jsx';
import { NfcScanControl } from './nfc-scan-control.jsx';
import { createLookupController } from './lookup-controller.mjs';
import { readFeedbackPreferences } from './feedback.mjs';
import { useScanFeedback } from './use-scan-feedback.js';
import { useOwnedNfcReader } from './use-owned-nfc-reader.js';
import { ScanOutcomeStatus } from './outcome-status.jsx';
import { withNfcFailureContext } from '../../business/nfc-controller.mjs';
import { useScanModeMotion } from './use-scan-mode-motion.js';
import './lookup.css';

export function LookupWorkflow({ data, user = data.user, dataset = data.dataset, onExit, onLockedChange, onExport }) {
  useWorkflowLock(true);
  const active = usePhoneContext()?.active !== false, live = useRef(true), closing = useRef(false),body=useRef(null);
  const [context] = useState({ dataset, accountId: user.id });
  const contextMatches = context.dataset === dataset && context.accountId === user.id && data.dataset === dataset && data.user.id === user.id;
  const [controller] = useState(() => createLookupController({ dataset, accountId: user.id,
    lookup: async (payload, signal) => (await inventoryResponse(await fetch('/api/inventory', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dataset, action: 'scan_lookup', payload }), signal }))).result,
    detail: async (id, signal) => inventoryResponse(await fetch(`/api/inventory?dataset=${dataset}&batteryId=${encodeURIComponent(id)}`, { cache: 'no-store', signal })),
  }));
  const [state, setState] = useState(controller.getSnapshot), [mode, setMode] = useState(native && dataset === 'demo' ? 'nfc' : 'search');
  const [search, setSearch] = useState(''), [foreground, setForeground] = useState(document.visibilityState !== 'hidden'), [readerError, setReaderError] = useState(''), [leaving, setLeaving] = useState(false);
  const [outcomeOpen,setOutcomeOpen]=useState(false);
  const [armed,setArmed]=useState(true),[readerEpoch,setReaderEpoch]=useState(0);
  const latestGate = useRef({ active, contextMatches }), pageVisible = useRef(document.visibilityState !== 'hidden');
  latestGate.current = { active, contextMatches };
  const preferences = useRef(readFeedbackPreferences(businessStorage()));
  const {feedback,present:feedbackOutcome,beginAcquisition,resetEncounter}=useScanFeedback({preferences:preferences.current,native});
  const allowed = armed && !outcomeOpen && active && foreground && contextMatches && native && dataset === 'demo' && mode === 'nfc' && !leaving;
  function present(result){if(live.current&&pageVisible.current&&document.visibilityState!=='hidden'&&latestGate.current.active&&latestGate.current.contextMatches&&result?.type!=='cancelled')feedbackOutcome(result?.type==='unknown'?{...result,type:'failure'}:result);}
  const {reader,resumeReader,cancelReader}=useOwnedNfcReader({storage:businessStorage(),onStart:()=>{beginAcquisition();setReaderError('');},enabled:allowed,contextKey:`${user.id}:${dataset}:lookup:${readerEpoch}`,onRead:async({proposal,bridge,current})=>{
    beginAcquisition(proposal.tagId,proposal.attemptId);const evidence=await bridge.adopt(proposal);if(!current())return;
    const result=await controller.resolveTag(proposal.tagId,'native_nfc',evidence);if(!current())return;
    if(result.failureKind==='infrastructure')throw withNfcFailureContext(new Error(result.message),{stage:result.stage,operation:result.operation,code:result.code,attemptId:proposal.attemptId,failureKind:result.failureKind});
    present({...result,acquisitionId:proposal.attemptId});setArmed(false);void cancelReader('Reading paused · Lookup result is ready');
  },onFailure:present,onIdle:resetEncounter});
  useScanModeMotion(body,mode);
  useEffect(() => { onLockedChange?.(true); return () => onLockedChange?.(false); }, [onLockedChange]);
  useEffect(() => controller.subscribe(() => setState(controller.getSnapshot())), [controller]);
  useEffect(() => { live.current = true; return () => { live.current = false; controller.dispose(); }; }, [controller]);
  useEffect(() => {
    const hide = () => {
      pageVisible.current = false; controller.suspend();void cancelReader('Reading paused · App is in the background');
      setForeground(false);
    };
    const change = () => { if (document.visibilityState === 'hidden') hide(); else { pageVisible.current = true; setForeground(true); } };
    document.addEventListener('visibilitychange', change); window.addEventListener('pagehide', hide); window.addEventListener('pageshow', change);
    return () => { document.removeEventListener('visibilitychange', change); window.removeEventListener('pagehide', hide); window.removeEventListener('pageshow', change); };
  }, [controller]);
  useEffect(() => { if (!active || !foreground || !contextMatches) controller.suspend(); }, [active, foreground, contextMatches, controller]);
  async function exit() {
    if (closing.current) return; closing.current = true; setLeaving(true);controller.suspend();
    try { if(!await cancelReader('Reading paused · Leaving lookup'))throw new Error('The reader could not stop. Check reader diagnostics and retry.');if (live.current) onExit?.(); }
    catch (failure) { if (live.current) { closing.current = false; setReaderError(`Reader could not stop. ${failure.message}`); setLeaving(false); } }
  }
  usePhoneBack(() => { void exit(); return true; }, { priority: 40 });
  async function select(id) { try { beginAcquisition();present(await controller.selectBattery(id)); } catch (failure) { setReaderError(failure.message); } }
  const current = state.result?.battery;
  const rows = data.batteries.filter(battery => `${battery.name} ${battery.id} ${battery.model || ''} ${battery.tagId || ''}`.toLowerCase().includes(search.toLowerCase()));
  const reset = () => { controller.clear(); setReaderError('');beginAcquisition();setArmed(true);setReaderEpoch(value=>value+1); };
  const chooseMode=next=>{void cancelReader('Reading paused · Changing input');reset();setMode(next);};
  return <section className="lookup-workflow" data-input={mode} aria-label="Scan to view">
    <header className="lookup-header"><Pressable className="scan-icon-button" aria-label="Exit scan to view" disabled={leaving} onClick={exit}><ArrowLeft size={21}/></Pressable><div><h1>Scan to view</h1><p>{dataset === 'demo' ? 'Demonstration' : 'Working'} · No stock changes</p></div></header>
    <div ref={body} className="lookup-body" data-phone-sheet-scroll>
      {contextMatches&&<div className="lookup-input-header"><div className="lookup-modes" data-result-open={state.phase==='result'} inert={state.phase==='result'?true:undefined} aria-hidden={state.phase==='result'?true:undefined} role="group" aria-label="Lookup input">{native && dataset === 'demo' && <Pressable aria-pressed={mode === 'nfc'} disabled={!contextMatches || state.phase === 'resolving' || state.phase === 'result'} onClick={() => chooseMode('nfc')}>NFC</Pressable>}<Pressable aria-pressed={mode === 'search'} disabled={!contextMatches || state.phase === 'resolving' || state.phase === 'result'} onClick={() => chooseMode('search')}>Inventory search</Pressable></div><ScanOutcomeStatus className="lookup-top-outcome" feedback={feedback} reader={mode==='nfc'&&['idle','resolving','error'].includes(state.phase)?reader:state.phase==='resolving'?{state:'lookup',message:'Finding recorded battery details'}:{}} acceptedTitle="Battery found" idleTitle={mode==='nfc'?'Ready to scan':'Choose a battery'} idleDetail="Read-only lookup · No stock changes" onOpenChange={open=>{setOutcomeOpen(open);if(open)void cancelReader('Reading paused · Scan message is open');}}/></div>}
      {contextMatches&&mode==='nfc'&&<div className="lookup-native-stage" data-phase={state.phase}><div className="lookup-orb-frame"><NfcScanControl reader={reader} onStart={resumeReader} onPause={cancelReader} disabled={!allowed||!['idle','error'].includes(state.phase)} color="blue" active={active&&foreground} feedback={[feedback.tone,feedback.expression].filter(Boolean).join(' ')} sequence={feedback.sequence} event={feedback.event} successSequence={feedback.successSequence}/></div></div>}
      {!contextMatches && <p className="scan-protected-notice" role="alert">The account or inventory changed. Close this lookup and reopen it in the active inventory.</p>}
      {contextMatches && state.phase === 'result' && current ? <section className="lookup-result" aria-label="Read-only battery result">
        <p className="lookup-id">{current.id}</p><h2>{current.name}</h2><span className="lookup-state">{batteryStatusLabel(current)}</span><p className="scan-help">Recorded loan state; this does not establish physical presence.</p>
        <dl>{[['Current holder', current.borrowerName || 'No active checkout'], ['Responsible owner', current.ownerName || 'Account label unavailable'], ['Registered home', `${current.homeBuildingId || 'Building unassigned'} · ${storageRoomLabel(current)}`], ...(!current.observedAt ? [['Last observation','None recorded']] : [['Last observed building',current.observedBuilding || 'Historical label unavailable'],['Last observed room',current.observedRoom || 'Historical label unavailable'],['Observed at',formatTime(current.observedAt)],['Observation source',current.observationSource || 'Source unavailable']])].map(([label,value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
        <details><summary>Specifications & identifiers</summary><dl>{[['Model',current.model],['Chemistry',current.chemistry],['Capacity (mAh)',current.capacityMah],['Nominal voltage (V)',current.voltage],['Registered tag',current.tagId],['Manufactured',current.manufacturedOn],['First use',current.firstUsedOn]].map(([label,value]) => <div key={label}><dt>{label}</dt><dd>{value == null || value === '' ? 'Unknown' : String(value)}</dd></div>)}</dl></details>
        <details><summary>Recent recorded history</summary><p className="scan-help">Up to 200 latest events per category. Download complete history for all evidence.</p>{state.result.events.map(event => <article key={event.id}><strong>{event.action.replaceAll('_',' ')}</strong><p>{formatTime(event.at)} · {event.actorName}</p><details><summary>Event evidence</summary><pre>{JSON.stringify(event.details,null,2)}</pre></details></article>)}{!state.result.events.length && <p>No events recorded.</p>}</details>
        {state.input?.evidence && <details><summary>Original device read evidence</summary><pre>{JSON.stringify(state.input.evidence,null,2)}</pre></details>}
        {onExport && <Pressable className="scan-secondary-button" onClick={() => onExport(current.id)}><Download size={18}/>Download complete history</Pressable>}
      </section> : <>
        
        
        {state.phase === 'unknown' && <section className="lookup-message" role="status"><h2>No battery record in this inventory</h2><p>The response does not identify whether a record exists elsewhere.</p><Pressable className="scan-filled-button" onClick={reset}>{mode === 'nfc' ? 'Scan another' : 'Search again'}</Pressable></section>}
        {state.phase === 'error' && <section className="lookup-message" role="alert"><h2>Lookup unavailable</h2><p>{state.error}</p><Pressable className="scan-filled-button" disabled={!active || !foreground || !contextMatches} onClick={async () => present(await controller.retry())}>Retry lookup</Pressable><Pressable className="scan-secondary-button" onClick={reset}>Back to input</Pressable></section>}
        {readerError&&<div className="lookup-message" role="alert"><p>{readerError}</p></div>}
        {contextMatches && state.phase === 'idle' && mode === 'search' && <section className="lookup-search"><p className="scan-help">{dataset === 'live' ? 'Working NFC lookup is not enabled. ' : !native ? 'Native NFC is unavailable in browser preview. ' : ''}Choose a record to view its details.</p><div className="lookup-search-toolbar"><label className="scan-search"><Search size={18}/><input type="search" value={search} maxLength={200} onChange={event => setSearch(event.target.value)} aria-label="Search battery name, ID, model or registered tag" placeholder="Find battery name or ID"/></label><Pressable className="scan-secondary-button" disabled={!search || leaving} onClick={() => setSearch('')}>Clear filters</Pressable></div><div className="lookup-records">{rows.map(battery => <Pressable key={battery.id} disabled={leaving} onClick={() => select(battery.id)}><span><strong>{battery.name}</strong><small>{battery.id} · {batteryStatusLabel(battery)}</small></span><span>View</span></Pressable>)}{!rows.length && <p>No matching records. Try another name or ID.</p>}</div></section>}
      </>}
    </div>
    {contextMatches && state.phase === 'result' && current && <footer className="lookup-footer"><Pressable className="scan-filled-button" onClick={reset}>{mode === 'nfc' ? 'Scan another' : 'Find another battery'}</Pressable></footer>}
  </section>;
}
