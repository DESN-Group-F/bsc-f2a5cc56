import { prepareLookupReader } from './lookup-reader.mjs';
import { createIosReadContinuation } from './ios-read-continuation.mjs';

// Every station talks to the same native adapter. Admission and cancellation
// remain shared when React replaces one workflow instance with another.
let cancellationBarrier=Promise.resolve(true),nativeReadOwner=null,sessionSequence=0;

/** One projection owns lifecycle, stage and feedback semantics for the current cycle. */
export function projectNativeReaderFailure(error,{stage='setup',operation,attemptId=null,eventId,platform,continuous=false}={}) {
  const code=error.code || error.report?.error?.code || 'READ_FAILED';
  stage=error.stage || stage;operation=error.operation || operation;
  if(!error.stage && /^(BUSINESS_|QUEUE_PERSISTENCE)/.test(code)) {stage='evidence';operation='queue';}
  attemptId=error.attemptId || error.report?.id || attemptId;
  const context={stage,operation,attemptId,eventId,code};
  const message=error.message || 'The NFC operation could not be completed.';
  if(['setup','reader'].includes(stage)) {
    if(code==='BACKGROUND')return {action:'pause',reader:{state:'paused',message:'Reading paused · App left the foreground',...context}};
    if(code==='CANCELLED')return {action:'none',reader:{state:'paused',message:'Reading cancelled · Start again when ready',...context}};
    if(code==='BUSY'&&!(continuous&&platform==='ios'))return {action:'retry',reader:{state:'starting',message:'Finishing the previous NFC read',...context}};
    if(code==='TIMEOUT'&&platform==='android')return {action:'idle',reader:{state:'listening',message:'Waiting for the next tag',...context}};
    if(continuous&&platform==='ios'&&['TIMEOUT','SESSION_ENDED'].includes(code))return {action:'none',reader:{state:'paused',message:'Scan session ended · Saved tags are retained. Continue scanning when ready',...context}};
    if(['UNAVAILABLE','DISABLED'].includes(code))return {action:'none',reader:{state:'unavailable',message,...context}};
  }
  const infrastructure=['setup','evidence'].includes(stage) || error.failureKind==='infrastructure' || /^(NETWORK_|BUSINESS_|EVIDENCE_|SECURE_|CONFIGURATION|NATIVE_SERVICE_|RESPONSE_|REDIRECT_|SESSION_|REQUEST_)/.test(code) || ['NFC_SESSION','INVALID_ARGUMENT'].includes(code);
  const failureKind=infrastructure?'infrastructure':'tag';
  const reason=code==='TIMEOUT'?'No tag detected. Try again.':message;
  return {action:'failure',reader:{state:'fault',message:reason,failureKind,...context},feedback:{type:infrastructure?'notice':'failure',message:reason,failureKind,...context,acquisitionId:attemptId,error}};
}
async function claimNativeRead(identity,token,current){
  while(true){
    if(!current())return null;
    const barrier=cancellationBarrier,previous=nativeReadOwner;
    await barrier;if(previous)await previous.settled;
    if(barrier===cancellationBarrier&&!nativeReadOwner){
      if(!current())return null;
      let release;const claim={identity,token,settled:new Promise(resolve=>{release=resolve;}),release:()=>{if(nativeReadOwner===claim)nativeReadOwner=null;release();}};
      nativeReadOwner=claim;return claim;
    }
  }
}

/** Serial foreground acquisition. Every real attempt keeps the existing durable report. */
export function createNativeReaderSession({storage,prepare=prepareLookupReader,isAllowed,onState=()=>{},onRead,onObserved,onFailure=()=>{},onIdle=()=>{},schedule=setTimeout,unschedule=clearTimeout,continuous=false}) {
  let generation=0,owner=0,bridge=null,timer=null,desired=false,contextKey='',disposed=false;
  let retainedClaim=null,continuation=null;
  const identity={},sessionId=++sessionSequence;let cycleSequence=0;
  let snapshot={state:'paused',attemptId:null};
  const emit=value=>{snapshot=value;onState(value);};
  const cancellationIssues=[];
  function cancelClaim(claim,owned) {
    const retained=retainedClaim===claim;
    const cancellation=cancellationBarrier.then(()=>nativeReadOwner===claim?owned.cancel():undefined);
    cancellationBarrier=cancellation.then(()=>true,error=>{
      cancellationIssues.push({at:new Date().toISOString(),code:error.code||'CANCEL_FAILED',message:error.message||'Reader cancellation failed.'});
      return false;
    }).finally(async()=>{
      if(retained){
        // A completed RF read can still be saving its original evidence. A
        // successor must not overlap that durable read after closing the sheet.
        await claim.readSettled;
        claim.release();if(retainedClaim===claim)retainedClaim=null;
      }
    });
    return cancellationBarrier;
  }
  function current(token,key){return !disposed&&desired&&generation===token&&contextKey===key&&isAllowed(key);}
  function later(token,key,delay){if(current(token,key))timer=schedule(()=>{timer=null;void cycle(token,key);},delay);}
  async function cycle(token,key){
    if(!current(token,key))return;
    // Cancellation controls the global native adapter. A new read waits until every
    // earlier cancellation has settled, even if the old read released its owner.
    const cycleBarrier=cancellationBarrier;
    await cycleBarrier;
    if(!current(token,key))return;
    if(owner){later(token,key,80);return;}
    let platform='',stage='setup',operation='preparation',attemptId=null;
    const eventId=`reader:${sessionId}:${++cycleSequence}`;
    const publish=value=>{if(current(token,key))emit({stage,operation,attemptId,eventId,...value});};
    try{
      publish({state:'starting',message:'Preparing NFC reader'});
      const owned=await prepare({storage,continuation,current:()=>current(token,key),beforeRead:()=>cycleBarrier,onReady:()=>{stage='reader';operation='read';publish({state:'ready',message:'Ready to scan'});},onObserved:value=>{if(!current(token,key))return;attemptId=value.attemptId;stage='evidence';operation='raw';if(onObserved){publish({state:'processing',message:'Preparing review…'});onObserved(value);}}});
      if(!current(token,key))return;bridge=owned;
      const availability=await owned.getAvailability();platform=availability.platform;
      if(!current(token,key))return;
      if(!availability.available||!availability.enabled){if(retainedClaim?.token===token)await cancelClaim(retainedClaim,owned);publish({state:'unavailable',operation:'availability',code:availability.available?'DISABLED':'UNAVAILABLE',message:availability.reason||'Enable NFC or choose another input source.'});return;}
      const claim=retainedClaim?.token===token?retainedClaim:await claimNativeRead(identity,token,()=>current(token,key));if(!claim)return;
      if(!current(token,key)){if(retainedClaim===claim)await cancelClaim(claim,owned);else claim.release();return;}
      owner=token;
      if(owned.keepsSessionAlive)retainedClaim=claim;
      stage='reader';operation='arming';
      let settleRead;
      claim.readSettled=new Promise(resolve=>{settleRead=resolve;});
      let proposal;try{proposal=await owned.read();}finally{settleRead();if(!owned.keepsSessionAlive)claim.release();}
      if(!current(token,key))return;
      attemptId=proposal.attemptId;stage='processing';operation='review';
      publish({state:'lookup',message:'Checking recorded identity'});
      const result=await onRead({proposal,bridge:owned,current:()=>current(token,key)});
      if(continuous&&platform==='ios'&&result?.type==='failure'){
        if(current(token,key))await pause('Reading paused · Review the scan result before continuing');
        return;
      }
      later(token,key,250);
    }catch(error){
      if(!current(token,key))return;
      if(retainedClaim?.token===token&&bridge)await cancelClaim(retainedClaim,bridge);
      if(!current(token,key))return;
      const projected=projectNativeReaderFailure(error,{stage,operation,attemptId,eventId,platform,continuous});
      if(projected.action==='pause'){pause(projected.reader.message);return;}
      emit(projected.reader);
      if(projected.action==='idle'){onIdle();later(token,key,250);}
      else if(projected.action==='retry')later(token,key,250);
      else if(projected.feedback)onFailure(projected.feedback);
    }finally{
      if(owner===token)owner=0;
      // The native sheet can outlive a resolved read. A lost foreground gate
      // must close that lease even before React publishes the matching pause.
      if(!current(token,key)&&retainedClaim?.token===token&&bridge)await cancelClaim(retainedClaim,bridge);
    }
  }
  function pause(message='Reading paused',{state='paused',failure}={}){
    desired=false;generation++;if(timer!==null){unschedule(timer);timer=null;}
    if(failure)emit(projectNativeReaderFailure(Object.assign(new Error(failure.message),failure),{attemptId:snapshot.attemptId,eventId:snapshot.eventId}).reader);
    else emit({state,message,stage:state==='starting'?'setup':undefined,operation:state==='starting'?'preparation':undefined,attemptId:null});
    const cancellationGeneration=generation,cancelledBridge=bridge,cancelledOwner=nativeReadOwner?.identity===identity?nativeReadOwner:null;
    if(cancelledOwner&&cancelledBridge){
      const cancellation=cancelClaim(cancelledOwner,cancelledBridge);
      cancellation.then(ok=>{
        if(!ok&&!disposed&&generation===cancellationGeneration&&!desired&&!failure){const error=cancellationIssues.at(-1);emit({state:'fault',stage:'setup',operation:'cancellation',attemptId:null,failureKind:'infrastructure',message:`Reader cancellation failed. ${error.message}`,code:error.code});}
      });
    }
    return cancellationBarrier;
  }
  function start(key,{force=false}={}){
    if(disposed)return;
    if(desired&&contextKey===key&&!force)return;
    pause('Preparing NFC reader',{state:'starting'});continuation=continuous?createIosReadContinuation():null;contextKey=key;desired=true;const token=++generation;void cycle(token,key);
  }
  return {start,pause,resume(key){start(key,{force:true});},dispose(){pause();disposed=true;},getOwner:()=>owner,getGeneration:()=>generation,getSnapshot:()=>snapshot,getCancellationIssues:()=>[...cancellationIssues]};
}
