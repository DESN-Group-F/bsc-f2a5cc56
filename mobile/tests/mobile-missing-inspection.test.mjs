import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveMissingInspection } from '../src/app/missing-inspection-recovery.mjs';
import { inspectionStorageKey } from '../src/shared/components/inventory/inspection-request.js';
const input={accountId:'staff-a',dataset:'demo',batteryId:'BAT-00000042',action:'inspection',payload:{requestId:'b21c6b10-5d80-4ef6-9f2b-701b0664cb65',batteryId:'BAT-00000042',expectedBatteryVersion:3,kind:'visual_check',outcome:'inconclusive',performedAt:'2026-10-12T00:00:00Z',method:'',notes:'',reference:'',capacityMah:null}};
function fixture() {
  const key=inspectionStorageKey(input.accountId,input.dataset,input.batteryId),entries=new Map([[key,JSON.stringify(input)]]),calls=[];
  const storage={getItem:key=>entries.get(key)??null,flush:async()=>{calls.push('flush');}};
  const args={accountId:input.accountId,dataset:input.dataset,batteryId:input.batteryId,storage,expectedInput:input,acknowledge:async captured=>{assert.deepEqual(captured,input);calls.push('ack');entries.delete(key);}};
  return {key,entries,calls,args};
}
test('the exact retained inspection is flushed and retried even when the battery is absent',async()=>{
  const f=fixture(),result={requestId:input.payload.requestId,dataset:'demo',actorAccountId:'staff-a',batteryId:input.batteryId,inspectionId:'ee64635e-2b7e-4c99-9359-dc4ae61443c6',action:'inspection',at:'2026-10-12T00:00:00Z',replayed:true};
  const resolved=await resolveMissingInspection({...f.args,write:async(action,payload)=>{f.calls.push('write');assert.equal(action,input.action);assert.deepEqual(payload,input.payload);return result;}});
  assert.equal(resolved.outcome,'confirmed');assert.deepEqual(f.calls,['flush','write','ack']);assert.equal(f.entries.size,0);
});
test('only an explicit terminal inspection rejection permits durable acknowledgement',async()=>{
  const f=fixture(),failure=Object.assign(new Error('Asset evidence was permanently deleted.'),{status:409,code:'inspection_rejected_final'});
  const resolved=await resolveMissingInspection({...f.args,write:async()=>{throw failure;}});assert.equal(resolved.outcome,'rejected');assert.equal(f.entries.size,0);
});
test('ordinary rejection, transport uncertainty and unrelated receipt errors retain the original bytes',async()=>{
  for(const [status,code] of [[404,undefined],[401,undefined],[403,undefined],[500,undefined],[409,'idempotency_conflict'],[500,'inspection_rejected_final']]) {
    const f=fixture(),before=f.entries.get(f.key),failure=Object.assign(new Error('Result unresolved'),{status,code});
    await assert.rejects(resolveMissingInspection({...f.args,write:async()=>{throw failure;}}));assert.equal(f.entries.get(f.key),before);assert.equal(f.calls.includes('ack'),false);
  }
  const f=fixture();await assert.rejects(resolveMissingInspection({...f.args,write:async()=>({})}),/uncertain/);assert.equal(f.entries.get(f.key),JSON.stringify(input));
});
test('a failed durable terminal acknowledgement leaves recovery available',async()=>{
  const f=fixture();await assert.rejects(resolveMissingInspection({...f.args,write:async()=>{throw Object.assign(new Error('Deleted'),{status:404,code:'inspection_rejected_final'});},acknowledge:async()=>{throw new Error('Local storage failed');}}),/Local storage failed/);assert.equal(f.entries.get(f.key),JSON.stringify(input));
});
test('identity or payload changes before and during flush prevent any request',async()=>{
  for(const duringFlush of [false,true]) {
    const f=fixture(),replacement={...input,payload:{...input.payload,expectedBatteryVersion:4}};
    if(duringFlush)f.args.storage.flush=async()=>f.entries.set(f.key,JSON.stringify(replacement));else f.entries.set(f.key,JSON.stringify(replacement));
    await assert.rejects(resolveMissingInspection({...f.args,write:async()=>assert.fail('Changed requests must not be sent')}),/changed/);
  }
  const f=fixture();await assert.rejects(resolveMissingInspection({...f.args,accountId:'staff-b',write:async()=>assert.fail('Different actors must not send')}));
});
test('inspection corrections preserve their original inspection ID and reason without adding a battery version',async()=>{
  const f=fixture(),correction={...input,action:'inspection_void',payload:{requestId:input.payload.requestId,batteryId:input.batteryId,inspectionId:'ee64635e-2b7e-4c99-9359-dc4ae61443c6',reason:'Incorrect original entry'}};f.entries.set(f.key,JSON.stringify(correction));
  const result={requestId:correction.payload.requestId,dataset:'demo',actorAccountId:'staff-a',batteryId:input.batteryId,inspectionId:correction.payload.inspectionId,action:'inspection_void',at:'2026-10-12T00:00:00Z',replayed:true};
  await resolveMissingInspection({...f.args,expectedInput:correction,write:async(action,payload)=>{assert.equal(action,'inspection_void');assert.deepEqual(payload,correction.payload);assert.equal('expectedBatteryVersion' in payload,false);return result;},acknowledge:async value=>assert.deepEqual(value,correction)});
});
