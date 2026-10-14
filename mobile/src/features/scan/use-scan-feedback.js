import { useEffect, useRef, useState } from 'react';
import { expireScanFeedback, playScanFeedback, scanFeedbackOutcome } from './feedback.mjs';

/** The event identity is a real acquisition attempt, never a UID cooldown. */
export function useScanFeedback({ preferences, native = false }) {
  const current = useRef({ tone:'',expression:'',until:0,expressionUntil:0,capsule:'',message:'',latest:null });
  const [feedback,setFeedback] = useState(current.current), settings = useRef({preferences,native}), acquisition = useRef(null), lastEvent = useRef('');
  settings.current = { preferences,native };
  function update(value) { current.current=value;setFeedback(value);return value; }
  function expire() {
    const next=expireScanFeedback(current.current,Date.now());
    if(next.tone!==current.current.tone||next.expression!==current.current.expression)update(next);
  }
  useEffect(()=>{
    const deadline=Math.min(...[feedback.until,feedback.expressionUntil].filter(value=>value>Date.now()));
    if(!Number.isFinite(deadline)){expire();return;}
    const timer=setTimeout(expire,Math.max(0,deadline-Date.now())+1);return()=>clearTimeout(timer);
  },[feedback]);
  useEffect(()=>{document.addEventListener('visibilitychange',expire);window.addEventListener('pageshow',expire);return()=>{document.removeEventListener('visibilitychange',expire);window.removeEventListener('pageshow',expire);};},[]);
  function present(result) {
    if(!result)return;
    expire();
    const eventId=result.acquisitionId||result.eventId||(result.type!=='failure'&&result.failureKind!=='infrastructure'?acquisition.current?.attemptId:null);
    const eventKey=eventId&&(['accepted','duplicate','failure'].includes(result.type)||result.failureKind==='infrastructure')?`${eventId}:${result.stage||''}:${result.operation||''}:${result.type}:${result.message||''}`:'';
    if(eventKey&&eventKey===lastEvent.current)return;
    if(eventKey)lastEvent.current=eventKey;
    if(result.failureKind==='infrastructure') {
      update({...current.current,sequence:(current.current.sequence||0)+1,event:'notice',outcomeType:'notice',tone:'',expression:'',until:0,expressionUntil:0,capsule:'',latest:null,message:result.message,code:result.code,stage:result.stage,operation:result.operation,failureKind:result.failureKind,acquisitionId:result.acquisitionId||null,eventId:result.eventId});
    } else {
      update({...scanFeedbackOutcome(current.current,result,Date.now()),...(result.type==='failure'?{stage:result.stage,operation:result.operation,failureKind:result.failureKind,acquisitionId:result.acquisitionId||null,eventId:result.eventId}: {})});
      playScanFeedback(result,settings.current.preferences,settings.current.native);
    }
  }
  function beginAcquisition(tagId,attemptId,observed = false) {
    if(attemptId&&acquisition.current?.attemptId===attemptId)return;
    acquisition.current=attemptId?{tagId,attemptId}:null;
    if(!attemptId)lastEvent.current='';
    update({...current.current,...(observed?{sequence:(current.current.sequence||0)+1,event:'acquired'}:{}),lastOutcome:{type:current.current.outcomeType,message:current.current.message,battery:current.current.latest},capsule:'',message:'',outcomeType:'',tone:'',expression:'',until:0,expressionUntil:0,code:'',stage:undefined,operation:undefined,failureKind:undefined,acquisitionId:attemptId||null,eventId:undefined});
  }
  function clearOutcome() {
    acquisition.current=null;lastEvent.current='';
    update({sequence:current.current.sequence||0,tone:'',expression:'',until:0,expressionUntil:0,capsule:'',message:'',latest:null,outcomeType:'',event:'',acquisitionId:null});
  }
  return {feedback,present,beginAcquisition,clearOutcome,resetEncounter:expire};
}
