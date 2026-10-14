import React, { useEffect, useId, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Copy, Info, Nfc, Pause, Search } from 'lucide-react';
import { createPhoneWorkflowPortal, PhoneDialogActions, PhoneDialogBody, PhoneDialogHeader, Pressable, usePhoneBack, usePhoneOverlayDismiss, usePhoneReducedMotion } from '../../app/phone-ui.jsx';
import './outcome-status.css';

function readerFaultTitle(value) {
  return value.stage==='evidence'?value.operation==='queue'?'Review queue not saved':'Read evidence not saved':value.stage==='setup'||value.failureKind==='infrastructure'&&value.stage==='reader'?'NFC reader needs attention':value.stage==='processing'?value.failureKind==='infrastructure'?value.operation==='lookup'?'Lookup unavailable':'Review unavailable':'Scan not accepted':'Read failed';
}

// An acquisition outcome and the reader's current lifecycle are separate facts.
// A pause never acknowledges an error or a duplicate on the operator's behalf.
function outcomePresentation(feedback,reader,acceptedTitle,idleTitle,idleDetail) {
  const sameAttempt=feedback.acquisitionId&&feedback.acquisitionId===reader.attemptId||feedback.eventId&&feedback.eventId===reader.eventId;
  const preparing=['starting','lookup','processing'].includes(reader.state);
  const retainedFailure=feedback.outcomeType==='failure'&&(!preparing||sameAttempt);
  const retainedInfrastructure=feedback.failureKind==='infrastructure'&&!['starting','ready','listening','lookup','processing'].includes(reader.state);
  const kind=reader.state==='fault'?'fault':retainedInfrastructure?'fault':feedback.outcomeType==='duplicate'?'duplicate':retainedFailure?'failure':['paused','unavailable'].includes(reader.state)?reader.state:feedback.outcomeType==='accepted'?'accepted':reader.state==='starting'?'preparing':['lookup','processing'].includes(reader.state)?'checking':feedback.outcomeType==='notice'?'notice':'ready';
  const usesFeedback=['accepted','duplicate','failure','notice'].includes(kind)||kind==='fault'&&reader.state!=='fault';
  const origin=usesFeedback?feedback:reader;
  const title=kind==='accepted'?acceptedTitle:kind==='duplicate'?'Already recorded':kind==='failure'?origin.stage?readerFaultTitle(origin):'Scan not accepted':kind==='fault'?readerFaultTitle(origin):kind==='preparing'?'Preparing NFC reader':kind==='checking'?reader.state==='processing'?'Tag read':'Checking tag':kind==='paused'?'Reading paused':kind==='unavailable'?'NFC unavailable':idleTitle;
  const identity=feedback.latest&&(feedback.latest.name||feedback.latest.id)?[feedback.latest.name,feedback.latest.id].filter(Boolean).join(' · '):'';
  const detail=String((usesFeedback?kind==='accepted'?identity||feedback.message:feedback.capsule||feedback.message||idleDetail:kind==='ready'?idleDetail:reader.message||idleDetail)??'');
  const lifecycleTitle=reader.state==='paused'?'Reading paused':reader.state==='unavailable'?'NFC unavailable':reader.state==='starting'?'Preparing NFC reader':['lookup','processing'].includes(reader.state)?'Checking tag':['ready','listening'].includes(reader.state)?'Reader ready':'';
  const lifecycle=usesFeedback&&lifecycleTitle?{title:lifecycleTitle,detail:reader.message||lifecycleTitle,...reader}:null;
  const previous=!usesFeedback&&['duplicate','failure'].includes(feedback.outcomeType)&&feedback.message!==detail?{title:feedback.outcomeType==='duplicate'?'Already recorded':'Scan not accepted',detail:feedback.capsule||feedback.message,...feedback}:null;
  return {kind,title,detail,usesFeedback,origin,lifecycle,previous};
}

export function ScanOutcomeStatus({feedback={},reader={},acceptedTitle='Added to review',idleTitle='Ready to scan',idleDetail='Hold a tag near the phone',className='',onOpenChange}) {
  const card=useRef(null),entry=useRef(null),dialog=useRef(null),sequence=useRef(feedback.sequence),reduced=usePhoneReducedMotion(),id=useId(),[opened,setOpened]=useState(null),change=useRef(onOpenChange);change.current=onOpenChange;
  const [recovery,setRecovery]=useState({phase:'idle'}),[resolvedFailure,setResolvedFailure]=useState(null);
  async function recover(kind) {
    setRecovery({phase:kind});
    try {await opened.recovery[kind]();if(kind==='retry')setResolvedFailure(opened.feedbackSequence);setRecovery({phase:'complete',message:kind==='retry'?'Device save completed. Close this message to continue.':'Preserved recovery exported.'});}
    catch(error) {setRecovery({phase:'failed',message:error.message||'Device recovery could not be completed. Original work is retained.'});}
  }
  const presentedFeedback=resolvedFailure!==null&&resolvedFailure===feedback.sequence&&feedback.failureKind==='infrastructure'?{}:feedback;
  const {kind,title,detail,usesFeedback,origin,lifecycle,previous}=outcomePresentation(presentedFeedback,reader,acceptedTitle,idleTitle,idleDetail);
  const Icon=kind==='accepted'?CheckCircle2:kind==='duplicate'?Copy:kind==='failure'||kind==='fault'?AlertCircle:kind==='checking'?Search:kind==='paused'?Pause:Nfc;
  const visibleDetail=detail.trim().toLowerCase()===title.trim().toLowerCase()?'':detail;
  const close=()=>{change.current?.(false);setOpened(null);};
  usePhoneBack(()=>{close();return true;},{enabled:!!opened,priority:180});usePhoneOverlayDismiss(dialog,close,{enabled:!!opened});
  useEffect(()=>{if(!opened)return;const parent=entry.current?.closest('.mobile-scan-surface,.mi-focused-surface,.lookup-workflow,.manual-registration'),before=parent?.inert;if(parent)parent.inert=true;dialog.current?.querySelector('button')?.focus({preventScroll:true});const key=event=>{if(event.key==='Escape'){event.preventDefault();close();}if(event.key==='Tab'){const controls=[...(dialog.current?.querySelectorAll('button:not(:disabled),summary,a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"])')||[])].filter(element=>element.getClientRects().length);if(!controls.length)return;const first=controls[0],last=controls.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}}};document.addEventListener('keydown',key);return()=>{document.removeEventListener('keydown',key);if(parent)parent.inert=before;entry.current?.focus({preventScroll:true});};},[!!opened]);
  useEffect(()=>{const changed=sequence.current!==feedback.sequence;sequence.current=feedback.sequence;if(!changed||reduced)return;const animation=card.current?.animate?.([{opacity:.35,transform:'translateY(3px)'},{opacity:1,transform:'translateY(0)'}],{duration:180,easing:'ease-out'});return()=>animation?.cancel();},[feedback.sequence,reduced]);
  const openMessage=()=>{
    setRecovery({phase:'idle'});change.current?.(true);
    setOpened({title,detail,lifecycle,previous,recovery:reader.recovery,feedbackSequence:feedback.sequence,
      code:origin.code,stage:origin.stage,operation:origin.operation,attemptId:usesFeedback?origin.acquisitionId:origin.attemptId,eventId:origin.eventId,
      issues:reader.controlIssues,noticeMessage:feedback.noticeMessage});
  };
  return <div className={`scan-outcome-lane ${className}`}>
    <div className="scan-outcome-reserve" aria-hidden="true"><span className="scan-outcome-reserve-icon"/><div><strong>{'\u00a0'}<br/>{'\u00a0'}</strong><span>{'\u00a0'}<br/>{'\u00a0'}</span></div><span className="scan-outcome-reserve-action"/></div>
    <div ref={card} className="scan-outcome-card" data-outcome={kind} data-stage={origin.stage} data-pulse={usesFeedback&&!['fault','duplicate'].includes(kind)&&!['paused','unavailable','fault'].includes(reader.state)&&(feedback.tone!=='failure'||kind==='failure')?feedback.tone||undefined:undefined} role={kind==='failure'||kind==='fault'?'alert':'status'}>
      <Icon size={23} aria-hidden="true"/><div><strong>{title}</strong>{visibleDetail&&<span>{visibleDetail}</span>}{lifecycle&&<small className="scan-outcome-reader-state">{lifecycle.title}</small>}</div>
      <Pressable ref={entry} className="scan-outcome-details-button" aria-label="Read complete scan message" onClick={openMessage}><Info size={20}/></Pressable>
    </div>
    {opened&&createPhoneWorkflowPortal(<div className="scan-outcome-portal"><section ref={dialog} className="scan-outcome-dialog" data-phone-dialog-frame role="dialog" aria-modal="true" aria-labelledby={`${id}-message`}>
      <PhoneDialogHeader><h2 id={`${id}-message`}>{opened.title}</h2></PhoneDialogHeader>
      <PhoneDialogBody>
        <p>{opened.detail}</p>
        {opened.lifecycle&&<section className="scan-outcome-reader-context" aria-label="Current reader state"><h3>{opened.lifecycle.title}</h3><p>{opened.lifecycle.detail}</p>{opened.lifecycle.code&&<p>Code: {opened.lifecycle.code}</p>}</section>}
        {opened.previous&&<section className="scan-outcome-reader-context" aria-label="Previous acquisition result"><h3>Previous result · {opened.previous.title}</h3><p>{opened.previous.detail}</p>{opened.previous.acquisitionId&&<p>Attempt: {opened.previous.acquisitionId}</p>}{opened.previous.code&&<p>Code: {opened.previous.code}</p>}</section>}
        {opened.noticeMessage&&opened.noticeMessage!==opened.detail&&<p>{opened.noticeMessage}</p>}
        {(opened.code||opened.stage||opened.attemptId||opened.eventId||opened.issues?.length>0)&&<details className="scan-reviewed-facts"><summary>Reader diagnostics</summary>{opened.stage&&<p>Stage: {opened.stage}{opened.operation?` · ${opened.operation}`:''}</p>}{opened.attemptId&&<p>Attempt: {opened.attemptId}</p>}{opened.eventId&&<p>Event: {opened.eventId}</p>}{opened.code&&<p>Code: {opened.code}</p>}{opened.issues?.map((issue,index)=><p key={index}>{issue.at} · {issue.code} · {issue.message}</p>)}</details>}
        {recovery.message&&<p role={recovery.phase==='failed'?'alert':'status'}>{recovery.message}</p>}
      </PhoneDialogBody>
      <PhoneDialogActions>{opened.stage==='evidence'&&opened.recovery&&<><Pressable className="scan-secondary-button" disabled={['retry','export'].includes(recovery.phase)} onClick={()=>recover('retry')}>Retry device save</Pressable><Pressable className="scan-secondary-button" disabled={['retry','export'].includes(recovery.phase)} onClick={()=>recover('export')}>Export preserved data</Pressable></>}<Pressable className="scan-secondary-button" onClick={close}>Close message</Pressable></PhoneDialogActions>
    </section></div>,document.body)}
  </div>;
}
