import { prepareLookupReader } from './lookup-reader.mjs';

// Every station talks to the same native adapter. Admission and cancellation
// remain shared when React replaces one workflow instance with another.
let cancellationBarrier=Promise.resolve(true),nativeReadOwner=null,sessionSequence=0;

/** One projection owns lifecycle, stage and feedback semantics for the current cycle. */
export function projectNativeReaderFailure(error,{stage='setup',operation,attemptId=null,eventId,platform}={}) {
  const code=error.code || error.report?.error?.code || 'READ_FAILED';
  stage=error.stage || stage;operation=error.operation || operation;
  if(!error.stage && /^(BUSINESS_|QUEUE_PERSISTENCE)/.test(code)) {stage='evidence';operation='queue';}
  attemptId=error.attemptId || error.report?.id || attemptId;
  const context={stage,operation,attemptId,eventId,code};
  const message=error.message || 'The NFC operation could not be completed.';
  if(['setup','reader'].includes(stage)) {
    if(code==='BACKGROUND')return {action:'pause',reader:{state:'paused',message:'Reading paused · App left the foreground',...context}};
    if(code==='CANCELLED')return {action:'none',reader:{state:'paused',message:'Reading cancelled · Start again when ready',...context}};
    if(code==='BUSY')return {action:'retry',reader:{state:'starting',message:'Finishing the previous NFC read',...context}};
    if(code==='TIMEOUT'&&platform==='android')return {action:'idle',reader:{state:'listening',message:'Waiting for the next tag',...context}};
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
export function createNativeReaderSession({storage,prepare=prepareLookupReader,isAllowed,onState=()=>{},onRead,onObserved,onFailure=()=>{},onIdle=()=>{},schedule=setTimeout,unschedule=clearTimeout}) {
  let generation=0,owner=0,bridge=null,timer=null,desired=false,contextKey='',disposed=false;
  const identity={},sessionId=++sessionSequence;let cycleSequence=0;
  let snapshot={state:'paused',attemptId:null};
  const emit=value=>{snapshot=value;onState(value);};
  const cancellationIssues=[];
  function current(token,key){return !disposed&&desired&&generation===token&&contextKey===key&&isAllowed(key);}
  function later(token,key,delay){if(current(token,key))timer=schedule(()=>{timer=null;void cycle(token,key);},delay);}
  async function cycle(token,key){
    if(!current(token,key))return;
    // Cancellation controls the global native adapter. A new read waits until every
    // earlier cancellation has settled, even if the old read released its owner.
    await cancellationBarrier;
    if(!current(token,key))return;
    if(owner){later(token,key,80);return;}
    let platform='',stage='setup',operation='preparation',attemptId=null;
    const eventId=`reader:${sessionId}:${++cycleSequence}`;
    const publish=value=>{if(current(token,key))emit({stage,operation,attemptId,eventId,...value});};
    try{
      publish({state:'starting',message:'Preparing NFC reader'});
      const owned=await prepare({storage,current:()=>current(token,key),beforeRead:()=>cancellationBarrier,onReady:()=>{stage='reader';operation='read';publish({state:'ready',message:'Ready to scan'});},onObserved:value=>{if(!current(token,key))return;attemptId=value.attemptId;stage='evidence';operation='raw';if(onObserved){publish({state:'processing',message:'Preparing review…'});onObserved(value);}}});
      if(!current(token,key))return;bridge=owned;
      const availability=await owned.getAvailability();platform=availability.platform;
      if(!current(token,key))return;
      if(!availability.available||!availability.enabled){publish({state:'unavailable',operation:'availability',code:availability.available?'DISABLED':'UNAVAILABLE',message:availability.reason||'Enable NFC or choose another input source.'});return;}
      const claim=await claimNativeRead(identity,token,()=>current(token,key));if(!claim)return;
      if(!current(token,key)){claim.release();return;}
      owner=token;
      stage='reader';operation='arming';
      let proposal;try{proposal=await owned.read();}finally{claim.release();}
      if(!current(token,key))return;
      attemptId=proposal.attemptId;stage='processing';operation='review';
      publish({state:'lookup',message:'Checking recorded identity'});
      await onRead({proposal,bridge:owned,current:()=>current(token,key)});
      later(token,key,250);
    }catch(error){
      if(!current(token,key))return;
      const projected=projectNativeReaderFailure(error,{stage,operation,attemptId,eventId,platform});
      if(projected.action==='pause'){pause(projected.reader.message);return;}
      emit(projected.reader);
      if(projected.action==='idle'){onIdle();later(token,key,250);}
      else if(projected.action==='retry')later(token,key,250);
      else if(projected.feedback)onFailure(projected.feedback);
    }finally{if(owner===token)owner=0;}
  }
  function pause(message='Reading paused',{state='paused',failure}={}){
    desired=false;generation++;if(timer!==null){unschedule(timer);timer=null;}
    if(failure)emit(projectNativeReaderFailure(Object.assign(new Error(failure.message),failure),{attemptId:snapshot.attemptId,eventId:snapshot.eventId}).reader);
    else emit({state,message,stage:state==='starting'?'setup':undefined,operation:state==='starting'?'preparation':undefined,attemptId:null});
    const cancellationGeneration=generation,cancelledBridge=bridge,cancelledOwner=nativeReadOwner?.identity===identity?nativeReadOwner:null;
    if(cancelledOwner&&cancelledBridge)cancellationBarrier=cancellationBarrier.then(()=>nativeReadOwner===cancelledOwner?cancelledBridge.cancel():undefined).then(()=>true).catch(error=>{
      cancellationIssues.push({at:new Date().toISOString(),code:error.code||'CANCEL_FAILED',message:error.message||'Reader cancellation failed.'});
      if(!disposed&&generation===cancellationGeneration&&!desired&&!failure)emit({state:'fault',stage:'setup',operation:'cancellation',attemptId:null,failureKind:'infrastructure',message:`Reader cancellation failed. ${error.message}`,code:error.code||'CANCEL_FAILED'});
      return false;
    });
    return cancellationBarrier;
  }
  function start(key,{force=false}={}){
    if(disposed)return;
    if(desired&&contextKey===key&&!force)return;
    pause('Preparing NFC reader',{state:'starting'});contextKey=key;desired=true;const token=++generation;void cycle(token,key);
  }
  return {start,pause,resume(key){start(key,{force:true});},dispose(){pause();disposed=true;},getOwner:()=>owner,getGeneration:()=>generation,getSnapshot:()=>snapshot,getCancellationIssues:()=>[...cancellationIssues]};
}
