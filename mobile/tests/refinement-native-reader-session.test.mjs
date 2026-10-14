import test from 'node:test';
import assert from 'node:assert/strict';
import {createNativeReaderSession} from '../src/features/scan/native-reader-session.mjs';
import {createLookupReader} from '../src/features/scan/lookup-reader.mjs';
import {NFC_PREFIX} from '../src/business/nfc-controller.mjs';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
function fixture({read,cancel=async()=>{},onRead=async()=>{},platform='android'}={}){
  const states=[],failures=[],idle=[],scheduled=[],calls=[];let allowed=true;
  const bridge={getAvailability:async()=>({available:true,enabled:true,platform}),read:()=>{calls.push('read');return read();},cancel:()=>{calls.push('cancel');return cancel();}};
  const session=createNativeReaderSession({storage:{},isAllowed:()=>allowed,prepare:async({current,onReady})=>({...bridge,read:()=>{if(!current())throw Object.assign(new Error('stale'),{code:'CANCELLED'});const result=bridge.read();onReady();return result;}}),onState:value=>states.push(value),onFailure:value=>failures.push(value),onIdle:()=>idle.push('idle'),onRead,schedule:(run,delay)=>{const task={run,delay,active:true};scheduled.push(task);return task;},unschedule:task=>{task.active=false;}});
  return{session,states,failures,idle,scheduled,calls,deny:()=>{allowed=false;},next(){const task=scheduled.find(task=>task.active);assert.ok(task);task.active=false;task.run();}};
}
test('delayed global cancel settles before a newer resume can activate the adapter after old owner release',async()=>{
  const first=deferred(),second=deferred(),cancel=deferred(),globalEvents=[];let nextId=0,activeId=0;
  const f=fixture({read:()=>{activeId=++nextId;globalEvents.push(['read',activeId]);return activeId===1?first.promise:second.promise;},cancel:async()=>{await cancel.promise;globalEvents.push(['cancel',activeId]);activeId=0;}});
  f.session.start('original');await tick();assert.equal(nextId,1);
  const paused=f.session.pause();f.session.resume('new');first.resolve({attemptId:'old'});await tick();assert.equal(f.session.getOwner(),0);assert.equal(nextId,1,'release of old read must not bypass global cancel');
  cancel.resolve();assert.equal(await paused,true);await tick();assert.equal(nextId,2);assert.equal(globalEvents.at(-1)[0],'read');assert.equal(globalEvents.at(-1)[1],2);f.session.dispose();second.resolve({attemptId:'new'});await tick();
});
test('old cancellation error is retained without replacing new session state',async()=>{
  const read=deferred(),cancel=deferred();const f=fixture({read:()=>read.promise,cancel:()=>cancel.promise});
  f.session.start('one');await tick();const paused=f.session.pause();f.session.resume('two');read.resolve({});cancel.reject(Object.assign(new Error('controlled cancel failure'),{code:'USB_CANCEL'}));assert.equal(await paused,false);await tick();
  assert.equal(f.states.some(state=>state.state==='fault'),false);assert.equal(f.session.getCancellationIssues().length>=1,true);assert.equal(f.session.getCancellationIssues()[0].code,'USB_CANCEL');f.session.dispose();await tick();
});
test('Android idle TIMEOUT quietly rearms without emitting failure or a previous outcome',async()=>{
  const f=fixture({read:async()=>{throw Object.assign(new Error('No tag in native deadline'),{code:'TIMEOUT'});}});f.session.start('demo');await tick();
  assert.deepEqual(f.failures,[]);assert.deepEqual(f.idle,['idle']);assert.equal(f.states.at(-1).state,'listening');assert.equal(f.scheduled.at(-1).delay,250);f.next();await tick();assert.deepEqual(f.failures,[]);assert.equal(f.calls.filter(value=>value==='read').length,2);f.session.dispose();
});
test('BACKGROUND and explicit CANCELLED preserve interruption without red feedback or automatic retry',async()=>{
  for(const code of ['BACKGROUND','CANCELLED']){const f=fixture({read:async()=>{throw Object.assign(new Error('original interruption'),{code});}});f.session.start('demo');await tick();assert.deepEqual(f.failures,[]);assert.equal(f.states.at(-1).state,'paused');assert.equal(f.scheduled.filter(task=>task.active).length,0);f.session.dispose();}
});
test('BUSY retries quietly but true native failure keeps its original code and reason',async()=>{
  const busy=fixture({read:async()=>{throw Object.assign(new Error('another native owner'),{code:'BUSY'});}});busy.session.start('demo');await tick();assert.deepEqual(busy.failures,[]);assert.equal(busy.scheduled.at(-1).delay,250);busy.session.dispose();
  const fault=fixture({read:async()=>{throw Object.assign(new Error('controlled NDEF transport failure'),{code:'TAG_LOST'});}});fault.session.start('demo');await tick();assert.equal(fault.failures.length,1);assert.equal(fault.failures[0].code,'TAG_LOST');assert.equal(fault.failures[0].message,'controlled NDEF transport failure');assert.equal(fault.scheduled.length,0);fault.session.dispose();
});
test('actual adapter call precedes Ready and pending business resolution prevents rearm',async()=>{
  const process=deferred(),events=[];const f=fixture({read:async()=>{events.push('adapter');return{attemptId:'one'};},onRead:async()=>{events.push('resolve');await process.promise;}});
  f.session.start('demo');await tick();assert.equal(events[0],'adapter');assert.equal(f.states.some(state=>state.state==='ready'),true);assert.equal(f.scheduled.length,0);process.resolve();await tick();assert.equal(f.scheduled.at(-1).delay,250);f.session.dispose();
});
test('different actual attempts with the same UID each retain their complete proposal',async()=>{
  const proposals=[];let attempt=0;const f=fixture({read:async()=>({attemptId:`attempt-${++attempt}`,tagId:'nfc:uid:91E5BF3A',result:{uidHex:'91E5BF3A',records:[]}}),onRead:async({proposal})=>proposals.push(proposal)});
  f.session.start('demo');await tick();f.next();await tick();assert.equal(proposals.length,2);assert.notEqual(proposals[0].attemptId,proposals[1].attemptId);assert.equal(proposals[0].tagId,proposals[1].tagId);f.session.dispose();
});
test('a direct foreground gate closes before read settlement even without a React commit',async()=>{
  const pending=deferred(),adopted=[];const f=fixture({read:()=>pending.promise,onRead:async value=>adopted.push(value)});f.session.start('demo');await tick();f.deny();pending.resolve({});await tick();assert.deepEqual(adopted,[]);assert.deepEqual(f.failures,[]);assert.equal(f.scheduled.length,0);f.session.dispose();
});

test('two actual session instances with the real durable bridge cannot let old queued cancellation stop the successor',async()=>{
  const first=deferred(),second=deferred(),cancelReply=deferred(),events=[],saved=new Map(),delivered=[];let active=0,reads=0,attempt=0;
  const storage={getItem:key=>saved.get(key)||null,setItem:(key,value)=>saved.set(key,value),flush:async()=>{}};
  const raw={uidHex:'91E5BF3A',technology:'NfcA',ndefStatus:'notSupported',capacityBytes:null,records:[],observedAt:'2026-10-13T00:00:01.000Z'};
  const adapter={getAvailability:async()=>({available:true,enabled:true,platform:'android'}),read(){active=++reads;events.push(['read',active]);return reads===1?first.promise:second.promise;},async cancel(){events.push(['cancel',active]);active=0;await cancelReply.promise;}};
  const make=name=>createNativeReaderSession({storage,isAllowed:()=>true,prepare:async options=>createLookupReader({...options,adapter,platform:'android',id:()=>`00000000-0000-4000-8000-${String(++attempt).padStart(12,'0')}`,now:()=> '2026-10-13T00:00:01.000Z'}),onRead:async value=>delivered.push([name,value.proposal]),schedule:()=>0,unschedule(){}});
  const old=make('old'),successor=make('successor');try{
    old.start('old');await tick();assert.equal(reads,1);const paused=old.pause();await tick();assert.deepEqual(events,[['read',1],['cancel',1]]);old.dispose();first.resolve(structuredClone(raw));await tick();assert.equal(old.getOwner(),0);
    successor.start('successor');await tick();assert.equal(reads,1,'the successor still waits for native cancel acknowledgement after old report settlement');cancelReply.resolve();assert.equal(await paused,true);await tick();assert.equal(reads,2);assert.deepEqual(events,[['read',1],['cancel',1],['read',2]],'old disposal cancellation is obsolete and cannot cancel reader 2');
    assert.equal([...saved.entries()].filter(([key])=>key.startsWith(NFC_PREFIX)).length,2);const original=JSON.parse([...saved.values()][0]);assert.equal(original.outcome,'read');assert.equal(original.result.uidHex,raw.uidHex);assert.equal(original.adoptions,undefined);assert.deepEqual(delivered,[]);
  }finally{old.dispose();successor.dispose();second.resolve(structuredClone(raw));cancelReply.resolve();await tick();}
});
test('two instances serialize actual acquisition while an old proposal is still being durably saved',async()=>{
  const first=deferred(),second=deferred(),flushGate=deferred(),flushEntered=deferred(),events=[],saved=new Map();let hold=false,reads=0,attempt=0;
  const storage={getItem:key=>saved.get(key)||null,setItem:(key,value)=>saved.set(key,value),async flush(){if(hold){flushEntered.resolve();await flushGate.promise;}}};
  const raw={uidHex:'91E5BF3A',technology:'NfcA',ndefStatus:'notSupported',capacityBytes:null,records:[],observedAt:'2026-10-13T00:00:01.000Z'},adapter={getAvailability:async()=>({available:true,enabled:true,platform:'android'}),read(){events.push(['read',++reads]);return reads===1?first.promise:second.promise;},cancel:async()=>events.push(['cancel',reads])};
  const make=()=>createNativeReaderSession({storage,isAllowed:()=>true,prepare:async options=>createLookupReader({...options,adapter,platform:'android',id:()=>`10000000-0000-4000-8000-${String(++attempt).padStart(12,'0')}`,now:()=> '2026-10-13T00:00:01.000Z'}),onRead:async()=>{},schedule:()=>0,unschedule(){}}),old=make(),successor=make();
  try{old.start('old');await tick();hold=true;first.resolve(structuredClone(raw));await flushEntered.promise;successor.start('new');await tick();assert.equal(reads,1,'raw native settlement alone must not overlap durable proposals');old.dispose();await tick();hold=false;flushGate.resolve();await tick();assert.equal(reads,2);assert.equal(events.at(-1)[0],'read');assert.equal(JSON.parse([...saved.values()][0]).outcome,'read');}finally{old.dispose();successor.dispose();flushGate.resolve();second.resolve(structuredClone(raw));await tick();}
});
test('two simultaneous instance starts acquire the global adapter atomically across await continuations',async()=>{
  const first=deferred(),second=deferred();let reads=0;const read=()=>++reads===1?first.promise:second.promise,a=fixture({read}),b=fixture({read});
  try{a.session.start('one');b.session.start('two');await tick();assert.equal(reads,1,'both resolved admission promises must not claim the same vacant adapter');first.resolve({attemptId:'one'});await tick();assert.equal(reads,2);assert.deepEqual(a.failures,[]);assert.deepEqual(b.failures,[]);}finally{a.session.dispose();b.session.dispose();second.resolve({attemptId:'two'});await tick();}
});
