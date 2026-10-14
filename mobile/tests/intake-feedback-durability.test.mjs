import test from 'node:test';
import assert from 'node:assert/strict';
import { createDurableStorage } from '../src/platform/durable-storage.mjs';
import { createTeachingNfcBridge } from '../src/business/teaching-nfc-bridge.mjs';
import { NFC_PREFIX } from '../src/business/nfc-controller.mjs';
import { createIntakeController, intakeDefaultValues } from '../src/features/lifecycle/intake-controller.mjs';

const data={dataset:'demo',user:{id:'STAFF-A'},batteries:[],people:[{id:'OWNER-A',accountId:'STAFF-A',role:'staff'}],staffDirectory:[{id:'STAFF-A',active:true}],rooms:[],buildings:[]};
const now='2026-10-13T02:00:00.000Z',id='00000000-0000-4000-8000-000000000700';
const result=()=>({uidHex:'0004AB00',technology:'Controlled NFC-A output',ndefStatus:'readWrite',capacityBytes:144,records:[{tnf:1,typeHex:'55',idHex:'',payloadHex:'046578616D706C652E636F6D'}],observedAt:now});
const evidence=()=>({attemptId:id,source:'native-nfc-reader',platform:'android',startedAt:now,endedAt:now,adoptedAt:now,tagId:'nfc:uid:0004AB00',result:result()});
const adapter={getAvailability:async()=>({platform:'android',available:true,enabled:true}),read:async()=>result(),cancel:async()=>{}};
async function storage(save=async()=>{}){const value=createDurableStorage({load:async()=>null,save});await value.initialize();return value;}

test('raw observation listener failures cannot relabel a validated read or alter its original evidence',async t=>{
  const messages=[],original=console.error;console.error=(...args)=>messages.push(args);t.after(()=>{console.error=original;});
  const saved=await storage(),bridge=createTeachingNfcBridge({adapter,storage:saved,platform:'android',id:()=>id,now:()=>now,onObserved:observation=>{observation.tagId='different';throw Error('Controlled presentation exception');}});
  const proposal=await bridge.read();assert.equal(proposal.tagId,'nfc:uid:0004AB00');assert.deepEqual(proposal.result,result());const adopted=await bridge.adopt(proposal);assert.deepEqual(adopted.result,result());
  const report=JSON.parse(saved.getItem(NFC_PREFIX+id));assert.equal(report.outcome,'read');assert.equal(report.error,null);assert.deepEqual(report.result,result());assert.equal(report.adoptions.length,1);assert.equal(messages.length,1);
});

test('raw and adoption save failures retain evidence without returning trusted adoption',async t=>{
  for(const phase of ['raw','adoption'])await t.test(phase,async()=>{
    const observed=[],saved=await storage(raw=>{const report=JSON.parse(JSON.parse(raw).entries[NFC_PREFIX+id]||'null');if(report?.outcome==='read'&&(phase==='raw'||report.adoptions?.length))throw Error('Controlled '+phase+' save denial');});
    const bridge=createTeachingNfcBridge({adapter,storage:saved,platform:'android',id:()=>id,now:()=>now,onObserved:value=>observed.push(value)});
    if(phase==='raw')await assert.rejects(bridge.read(),/raw save denial/);else{const proposal=await bridge.read();await assert.rejects(bridge.adopt(proposal),/adoption save denial/);}
    assert.equal(observed.length,1);const report=JSON.parse(JSON.parse(saved.exportRaw()).current.entries[NFC_PREFIX+id]);assert.equal(report.outcome,'read');assert.deepEqual(report.result,result());
  });
});

test('queue acceptance publishes only after flush and exact readback, before the new queue snapshot',async()=>{
  const order=[],saved=await storage(()=>order.push('save')),controller=createIntakeController({storage:saved,data,accountId:data.user.id,write:()=>assert.fail('Staging cannot submit'),onQueueAccepted:outcome=>{order.push('accepted');assert.equal(outcome.acquisitionId,id);assert.equal(controller.getSnapshot().draft.entries.length,1);assert.deepEqual(controller.getSnapshot().draft.entries[0].nfcEvidence,evidence());}});
  await controller.prepare({...intakeDefaultValues(data,data.user.id),name:'Battery'},'unknown');controller.subscribe(value=>{if(value.draft.entries.length)order.push('queue');});order.length=0;
  assert.equal((await controller.addTag(evidence().tagId,evidence())).type,'accepted');assert.ok(order.indexOf('save')<order.indexOf('accepted'));assert.ok(order.indexOf('accepted')<order.indexOf('queue'));assert.equal(order.filter(value=>value==='accepted').length,1);
});

test('failed queue save or mismatched readback cannot publish accepted and retain the original draft/evidence',async t=>{
  for(const failure of ['save','readback'])await t.test(failure,async()=>{
    let armed=false,accepted=0;const saved=await storage(()=>{if(armed&&failure==='save')throw Error('Controlled queue save denial');});
    const proxy={...saved,getItem(key){const raw=saved.getItem(key);return armed&&failure==='readback'&&key.startsWith('battery-intake:')&&raw?raw+' ':raw;}};
    const controller=createIntakeController({storage:proxy,data,accountId:data.user.id,write:()=>assert.fail('No submission'),onQueueAccepted:()=>accepted++});await controller.prepare({...intakeDefaultValues(data,data.user.id),name:'Battery'},'unknown');armed=true;
    await assert.rejects(controller.addTag(evidence().tagId,evidence()),failure==='save'?/queue save denial/:/read back/);assert.equal(accepted,0);assert.ok(controller.getSnapshot().storageError);assert.equal(controller.canExit(),false);const original=JSON.parse(JSON.parse(saved.exportRaw()).current.entries[controller.key]);assert.deepEqual(original.entries[0].nfcEvidence,evidence());assert.equal(original.attempt,null);
  });
});

test('accepted presentation exceptions do not turn a durable simulation queue into storage failure or replay success on duplicate',async t=>{
  const messages=[],original=console.error;console.error=(...args)=>messages.push(args);t.after(()=>{console.error=original;});let notifications=0;
  const saved=await storage(),controller=createIntakeController({storage:saved,data,accountId:data.user.id,write:()=>assert.fail('No submission'),onQueueAccepted:()=>{notifications++;throw Error('Controlled outcome listener failure');}});
  await controller.prepare({...intakeDefaultValues(data,data.user.id),name:'Battery'},'unknown');assert.equal((await controller.addTag('DEMO-INTAKE-PRESENTATION')).type,'accepted');assert.equal(controller.getSnapshot().storageError,'');assert.equal(controller.getSnapshot().draft.entries.length,1);assert.equal(notifications,1);assert.equal(messages.length,1);
  assert.equal((await controller.addTag('DEMO-INTAKE-PRESENTATION')).type,'duplicate');assert.equal(controller.getSnapshot().draft.entries.length,1);assert.equal(notifications,1);assert.equal(messages.length,1);
});
