import test from 'node:test';
import assert from 'node:assert/strict';
import {createNativeReaderSession} from '../src/features/scan/native-reader-session.mjs';
import {createLookupReader} from '../src/features/scan/lookup-reader.mjs';
import {createDurableStorage} from '../src/platform/durable-storage.mjs';
import {NFC_PREFIX,withNfcFailureContext} from '../src/business/nfc-controller.mjs';

// Actual session, bridge and durable storage under controlled scheduling. No radio.
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
const attemptId='70000000-0000-4000-8000-000000000001';
const result=()=>({uidHex:'0004AB00',technology:'Controlled NFC-A',ndefStatus:'notSupported',capacityBytes:null,records:[],observedAt:'2026-10-13T00:00:01.000Z'});
async function fixture({adapter={},save=async()=>{},prepare,onRead=async()=>{},observed=false,id=attemptId}={}) {
  const states=[],feedback=[],observations=[],timers=[],reads=[];
  const storage=createDurableStorage({load:async()=>null,save});await storage.initialize();
  const native={getAvailability:async()=>({platform:'android',available:true,enabled:true}),read:async()=>{reads.push(true);return result();},cancel:async()=>{},...adapter};
  const session=createNativeReaderSession({storage,isAllowed:()=>true,
    prepare:prepare|| (async options=>createLookupReader({...options,adapter:native,platform:'android',id:()=>id})),
    onState:value=>states.push(value),onFailure:value=>feedback.push(value),...(observed?{onObserved:value=>observations.push(value)}:{}),onRead,
    schedule:(run,delay)=>{const timer={run,delay};timers.push(timer);return timer;},unschedule:()=>{},
  });
  return{session,storage,states,feedback,observations,timers,reads,async start(){session.start('controlled-context');await tick();},reports:()=>Object.entries(JSON.parse(storage.exportRaw()).current.entries).filter(([key])=>key.startsWith(NFC_PREFIX)).map(([,raw])=>JSON.parse(raw))};
}

test('initial preparation is immediately neutral and a setup fault keeps its exact reason without tag failure',async()=>{
  const preparation=deferred(),f=await fixture({prepare:()=>preparation.promise});
  try {
    f.session.start('context');assert.equal(f.states.at(-1).state,'starting');await tick();assert.equal(f.states.some(state=>state.state==='paused'),false);
    preparation.reject(Object.assign(Error('Controlled adapter import denied'),{code:'MODULE_UNAVAILABLE'}));await tick();
    assert.equal(f.states.at(-1).stage,'setup');assert.equal(f.states.at(-1).message,'Controlled adapter import denied');assert.equal(f.states.at(-1).state,'fault');
    assert.equal(f.feedback[0].type,'notice');assert.equal(f.feedback[0].failureKind,'infrastructure');assert.equal(f.feedback[0].acquisitionId,null);assert.match(f.feedback[0].eventId,/^reader:/);assert.equal(f.timers.length,0);
  } finally {f.session.dispose();}
});

test('availability failure before, during recheck or at native invocation has the same quiet unavailable projection',async t=>{
  for(const location of ['initial','recheck','native'])for(const code of ['DISABLED','UNAVAILABLE'])await t.test(`${location} ${code}`,async()=>{
    let calls=0,reads=0;
    const f=await fixture({adapter:{getAvailability:async()=>{calls++;const blocked=location==='initial'||location==='recheck'&&calls===2;return{platform:'android',available:!(blocked&&code==='UNAVAILABLE'),enabled:!blocked,reason:'Controlled availability changed'};},read:async()=>{reads++;throw Object.assign(Error('Controlled native availability changed'),{code});}}});
    try {await f.start();assert.equal(f.states.at(-1).state,'unavailable');assert.equal(f.states.at(-1).code,code);assert.deepEqual(f.feedback,[]);assert.equal(reads,location==='native'?1:0);assert.equal(f.reports().length,location==='native'?1:0);if(location==='native')assert.equal(f.reports()[0].error.code,code);}
    finally {f.session.dispose();}
  });
});

test('pending, raw and adoption persistence failures retain current attempt and stay distinct from a bad tag',async t=>{
  for(const operation of ['pending','raw','adoption'])await t.test(operation,async()=>{
    let saves=0;
    const denial=Error(`Controlled ${operation} durable denial`),target={pending:1,raw:2,adoption:3}[operation];
    const f=await fixture({save:async()=>{if(++saves===target)throw denial;},onRead:async({proposal,bridge})=>bridge.adopt(proposal),observed:true});
    try {
      await f.start();const state=f.states.at(-1),feedback=f.feedback[0];assert.equal(state.state,'fault');assert.equal(state.stage,'evidence');assert.equal(state.operation,operation);assert.equal(state.attemptId,attemptId);assert.equal(state.message,denial.message);
      assert.equal(feedback.type,'notice');assert.equal(feedback.acquisitionId,attemptId);assert.equal(feedback.failureKind,'infrastructure');assert.equal(f.reads.length,operation==='pending'?0:1);assert.equal(f.observations.length,operation==='pending'?0:1);
      assert.equal(f.reports()[0].outcome,operation==='pending'?'pending':'read');assert.equal(f.reports()[0].stage,undefined,'Presentation context must not alter the raw report format');
      await assert.rejects(f.storage.flush(),new RegExp(operation+' durable denial'));
    } finally {f.session.dispose();}
  });
});

test('a failed terminal save cannot hide behind a normally quiet cancellation or Android timeout',async t=>{
  for(const code of ['CANCELLED','TIMEOUT'])await t.test(code,async()=>{
    let saves=0;const f=await fixture({adapter:{read:async()=>{throw Object.assign(Error('Original reader stop'),{code});}},save:async()=>{if(++saves===2)throw Error('Controlled terminal evidence save denied');}});
    try {await f.start();assert.equal(f.states.at(-1).state,'fault');assert.equal(f.states.at(-1).stage,'evidence');assert.equal(f.states.at(-1).operation,'terminal');assert.equal(f.states.at(-1).code,'EVIDENCE_PERSISTENCE');assert.equal(f.feedback[0].type,'notice');assert.equal(f.reports()[0].error.code,code);assert.equal(f.timers.length,0);}
    finally {f.session.dispose();}
  });
});

test('tag reading and eligibility faults remain red outcomes; queue and network faults retain their own stages',async t=>{
  const cases=[
    {name:'reader',adapter:{read:async()=>{throw Object.assign(Error('Controlled tag lost'),{code:'TAG_LOST'});}},stage:'reader',kind:'tag'},
    {name:'eligibility',onRead:async()=>{throw Error('This battery has an active loan');},stage:'processing',kind:'tag'},
    {name:'queue',onRead:async()=>{throw withNfcFailureContext(Error('Controlled queue readback mismatch'),{stage:'evidence',operation:'queue',attemptId});},stage:'evidence',kind:'infrastructure'},
    {name:'network',onRead:async()=>{throw Object.assign(Error('Controlled network unavailable'),{code:'NETWORK_UNCERTAIN'});},stage:'processing',kind:'infrastructure'},
  ];
  for(const item of cases)await t.test(item.name,async()=>{const f=await fixture(item);try{await f.start();assert.equal(f.states.at(-1).state,'fault');assert.equal(f.states.at(-1).stage,item.stage);assert.equal(f.feedback[0].failureKind,item.kind);assert.equal(f.feedback[0].type,item.kind==='tag'?'failure':'notice');assert.equal(f.feedback[0].acquisitionId,attemptId);assert.equal(f.timers.length,0);}finally{f.session.dispose();}});
});

test('an old owner failure remains evidence and cannot present its error in a successor session',async()=>{
  const first=deferred(),second=deferred(),old=await fixture({adapter:{read:()=>first.promise}}),nextId='70000000-0000-4000-8000-000000000002',next=await fixture({id:nextId,adapter:{read:()=>second.promise}});
  try {
    await old.start();old.session.pause();await tick();await next.start();assert.equal(next.states.at(-1).state,'starting');
    first.reject(Object.assign(Error('Old tag failure'),{code:'TAG_LOST'}));await tick();assert.deepEqual(old.feedback,[]);assert.equal(old.reports()[0].error.code,'TAG_LOST');
    second.reject(Object.assign(Error('Current tag failure'),{code:'TAG_LOST'}));await tick();assert.equal(next.feedback.length,1);assert.equal(next.feedback[0].message,'Current tag failure');assert.equal(next.feedback[0].acquisitionId,nextId);
  } finally {old.session.dispose();next.session.dispose();first.resolve(result());second.resolve(result());await tick();}
});

test('error wrapping preserves an existing stage, exact code, current attempt and original cause',()=>{
  const original=Object.assign(Error('Exact storage cause'),{code:'BUSINESS_STORAGE',stage:'evidence',operation:'raw',attemptId});
  const error=withNfcFailureContext(original,{stage:'processing',operation:'eligibility',attemptId:'previous',code:'READ_FAILED'});
  assert.equal(error.message,original.message);assert.equal(error.code,original.code);assert.equal(error.stage,'evidence');assert.equal(error.operation,'raw');assert.equal(error.attemptId,attemptId);assert.equal(error.cause,original);
});
