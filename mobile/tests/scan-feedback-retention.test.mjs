import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {expireScanFeedback,scanFeedbackOutcome} from '../src/features/scan/feedback.mjs';

// The actual hook runs against controlled React state and time. These checks
// validate outcome ownership/reset semantics, not native radio behavior.
async function feedbackHarness() {
  const hooks=[],effects=[],timers=new Map(),played=[];let cursor=0,dirty=true,value,now=1000,nextTimer=0;
  const bindings={scanFeedbackOutcome,expireScanFeedback,playScanFeedback:result=>played.push(result),
    Date:{now:()=>now},setTimeout:(run,delay)=>{const id=++nextTimer;timers.set(id,{run,at:now+delay});return id;},clearTimeout:id=>timers.delete(id),
    document:{addEventListener(){},removeEventListener(){}},window:{addEventListener(){},removeEventListener(){}},
    useRef:initial=>hooks[cursor++]??={current:initial},
    useState(initial){const i=cursor++;hooks[i]??={value:typeof initial==='function'?initial():initial};return[hooks[i].value,next=>{hooks[i].value=typeof next==='function'?next(hooks[i].value):next;dirty=true;}];},
    useEffect(run,deps){const i=cursor++,old=hooks[i];if(!old||deps.some((dep,index)=>!Object.is(dep,old.deps[index]))){hooks[i]={deps,cleanup:old?.cleanup};effects.push(()=>{hooks[i].cleanup?.();hooks[i].cleanup=run();});}},
  };
  const source=(await readFile(new URL('../src/features/scan/use-scan-feedback.js',import.meta.url),'utf8')).replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,''),names=Object.keys(bindings);
  const run=new Function(...names,source+'\nreturn useScanFeedback;')(...names.map(name=>bindings[name]));
  function render(){let passes=0;do{assert.ok(passes++<12);dirty=false;cursor=0;value=run({preferences:{haptics:true,sounds:false},native:true});while(effects.length)effects.shift()();}while(dirty);return value;}
  render();return{get:()=>value,played,call(method,...args){value[method](...args);return render();},advance(ms){now+=ms;for(const[id,timer]of[...timers])if(timer.at<=now){timers.delete(id);timer.run();}return render();},dispose(){for(const hook of hooks)hook?.cleanup?.();}};
}

test('the actual feedback hook keeps an acquisition error readable until an explicit new acquisition',async()=>{
  const f=await feedbackHarness();try{
    f.call('beginAcquisition','nfc:uid:0004AB00','attempt-1');
    f.call('present',{type:'failure',message:'This battery is retired.',code:'RETIRED',stage:'processing',operation:'eligibility',acquisitionId:'attempt-1',eventId:'reader-1'});
    f.advance(10000);let state=f.get().feedback;assert.equal(state.tone,'');assert.equal(state.outcomeType,'failure');assert.equal(state.message,'This battery is retired.');assert.equal(state.acquisitionId,'attempt-1');
    f.call('present',{type:'notice',message:'Reading paused'});state=f.get().feedback;assert.equal(state.message,'This battery is retired.');assert.equal(state.noticeMessage,'Reading paused');assert.equal(state.eventId,'reader-1');assert.equal(state.code,'RETIRED');
    f.call('beginAcquisition');state=f.get().feedback;assert.equal(state.message,'');assert.equal(state.outcomeType,'');assert.equal(state.code,'');assert.equal(state.acquisitionId,null);assert.equal(state.noticeMessage,'');
    assert.equal(f.played.length,2,'The notice uses the feedback adapter but cannot start an acquisition pulse');
  }finally{f.dispose();}
});

test('accepted and duplicate feedback keep their own attempt and never inherit an older fault code or stage',async()=>{
  const f=await feedbackHarness();try{
    f.call('present',{type:'failure',message:'Earlier unavailable record',code:'OLD_ERROR',stage:'processing',operation:'eligibility',acquisitionId:'old-attempt'});
    f.call('beginAcquisition','nfc:uid:0004AB00','accepted-attempt');
    f.call('present',{type:'accepted',message:'Added to review',battery:{id:'BAT-41'}});
    assert.equal(f.get().feedback.acquisitionId,'accepted-attempt');assert.equal(f.get().feedback.code,'');assert.equal(f.get().feedback.stage,undefined);
    f.call('beginAcquisition','nfc:uid:0004AB00','duplicate-attempt');
    f.call('present',{type:'duplicate',message:'BAT-41 is already queued.',acquisitionId:'duplicate-attempt',eventId:'duplicate-event'});
    const duplicate=f.advance(10000).feedback;assert.equal(duplicate.outcomeType,'duplicate');assert.equal(duplicate.acquisitionId,'duplicate-attempt');assert.equal(duplicate.eventId,'duplicate-event');assert.equal(duplicate.code,'');assert.equal(duplicate.stage,undefined);assert.equal(duplicate.capsule,'BAT-41 is already queued.');
    f.call('clearOutcome');assert.equal(f.get().feedback.outcomeType,'');assert.equal(f.get().feedback.latest,null);
  }finally{f.dispose();}
});

test('an infrastructure fault stays neutral and retains its original provenance through routine lifecycle updates',async()=>{
  const f=await feedbackHarness();try{
    f.call('present',{type:'notice',failureKind:'infrastructure',message:'Could not save the original queue.',code:'QUEUE_PERSISTENCE',stage:'evidence',operation:'queue',acquisitionId:'save-attempt',eventId:'save-event'});
    f.call('present',{type:'notice',message:'Reading paused'});const state=f.advance(10000).feedback;
    assert.equal(state.message,'Could not save the original queue.');assert.equal(state.failureKind,'infrastructure');assert.equal(state.stage,'evidence');assert.equal(state.acquisitionId,'save-attempt');assert.equal(state.eventId,'save-event');assert.equal(state.tone,'');assert.equal(state.expression,'');assert.equal(state.noticeMessage,'Reading paused');
  }finally{f.dispose();}
});
