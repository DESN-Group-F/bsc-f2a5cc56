import test from 'node:test';
import assert from 'node:assert/strict';
import { createLookupController } from '../src/features/scan/lookup-controller.mjs';
const battery = { id:'BAT-00000009',name:'Retained battery',version:2,tagId:'nfc:uid:00010203',lifecycleStatus:'scrapped',loanId:null };
const evidence = { attemptId:'00000000-0000-4000-8000-000000000001',source:'native-nfc-reader',platform:'android',startedAt:'2026-10-13T00:00:00.000Z',endedAt:'2026-10-13T00:00:01.000Z',adoptedAt:'2026-10-13T00:00:02.000Z',tagId:battery.tagId,result:{uidHex:'00010203',technology:'NfcA',ndefStatus:'notSupported',capacityBytes:null,records:[],observedAt:'2026-10-13T00:00:01.000Z'} };
const deferred = () => { let resolve; const promise = new Promise(done => {resolve=done;}); return {promise,resolve}; };
function fixture(overrides = {}) { const calls=[]; const controller=createLookupController({dataset:'demo',accountId:'staff',lookup:async (payload,signal) => {calls.push({payload:structuredClone(payload),signal}); return {source:payload.source,results:[{tagId:payload.tagIds[0],battery}]};},detail:async (id,signal) => {calls.push({id,signal}); return {battery,events:[]};},...overrides}); return {controller,calls}; }
test('native read-only lookup preserves raw evidence and resolves retired records without movement eligibility',async () => {
  const {controller,calls}=fixture(); const result=await controller.resolveTag(battery.tagId,'native_nfc',evidence);
  assert.equal(result.type,'accepted'); assert.equal(controller.getSnapshot().phase,'result'); assert.equal(controller.getSnapshot().result.battery.lifecycleStatus,'scrapped');
  assert.deepEqual(calls.map(call=>call.payload||call.id),[{tagIds:[battery.tagId],source:'native_nfc'},battery.id]);
  assert.deepEqual(controller.getSnapshot().input.evidence,evidence); assert.equal(controller.getSnapshot().input.evidence.result.uidHex,'00010203');
  evidence.result.records.push({tnf:1,typeHex:'54',idHex:'',payloadHex:'0000'}); assert.equal(controller.getSnapshot().input.evidence.result.records.length,0); evidence.result.records.pop();
});
test('a null query result is inventory-scoped unknown; unavailable lookup is a distinct error',async () => {
  const unknown=fixture({lookup:async payload=>({source:payload.source,results:[{tagId:battery.tagId,battery:null}]}),detail:()=>{throw new Error('Unknown must not load details');}});
  assert.equal((await unknown.controller.resolveTag(battery.tagId,'manual')).type,'unknown'); assert.equal(unknown.controller.getSnapshot().message,'No battery record in this inventory');
  const offline=fixture({lookup:()=>{throw new Error('Network unavailable');}}); assert.equal((await offline.controller.resolveTag(battery.tagId,'manual')).type,'failure'); assert.equal(offline.controller.getSnapshot().phase,'error'); assert.equal(offline.controller.getSnapshot().error,'Network unavailable');
});
test('a native lookup infrastructure error retains current evidence identity and manual errors remain visible without a tag identity',async()=>{
  const cause=Object.assign(Error('Exact controlled native transport error'),{code:'NETWORK_UNCERTAIN'}),native=fixture({lookup:async()=>{throw cause;}});
  const result=await native.controller.resolveTag(battery.tagId,'native_nfc',evidence);assert.equal(result.type,'failure');assert.equal(result.failureKind,'infrastructure');assert.equal(result.stage,'processing');assert.equal(result.operation,'lookup');assert.equal(result.code,cause.code);assert.equal(result.acquisitionId,evidence.attemptId);assert.equal(result.message,cause.message);assert.equal(native.controller.getSnapshot().phase,'error');
  const manual=fixture({detail:async()=>{throw Error('Exact controlled manual lookup error');}}),failed=await manual.controller.selectBattery(battery.id);assert.equal(failed.failureKind,'infrastructure');assert.equal(failed.acquisitionId,null);assert.equal(manual.controller.getSnapshot().error,'Exact controlled manual lookup error');
});
test('Working rejects hardware lookup and manual relabelling, while direct inventory selection is supported',async () => {
  const {controller,calls}=fixture({dataset:'live'}); await assert.rejects(controller.resolveTag(battery.tagId,'native_nfc',evidence),/Working NFC/); await assert.rejects(controller.resolveTag(battery.tagId,'manual',evidence),/relabelled/); assert.equal(calls.length,0);
  assert.equal((await controller.selectBattery(battery.id)).type,'accepted'); assert.equal(calls.length,1); assert.equal(calls[0].id,battery.id);
});
test('mismatched tag, lookup source, and detail identity cannot establish a result',async () => {
  for(const override of [{lookup:async ()=>({source:'selection',results:[]})},{lookup:async ()=>({source:'manual',results:[{tagId:battery.tagId,battery:{...battery,tagId:'other'}}]})},{detail:async ()=>({battery:{...battery,id:'BAT-OTHER'},events:[]})}]) {
    const {controller}=fixture(override); assert.equal((await controller.resolveTag(battery.tagId,'manual')).type,'failure'); assert.equal(controller.getSnapshot().result,null);
  }
});
test('clear, background suspension and disposal invalidate late lookup/detail callbacks',async () => {
  for(const action of ['clear','suspend','dispose']) { const wait=deferred(); const {controller,calls}=fixture({detail:()=>wait.promise}); const pending=controller.selectBattery(battery.id); controller[action](); wait.resolve({battery,events:[]}); assert.equal((await pending).type,'cancelled'); assert.notEqual(controller.getSnapshot().phase,'result'); }
  const wait=deferred(); const {controller,calls}=fixture({lookup:()=>wait.promise}); const pending=controller.resolveTag(battery.tagId,'manual'); controller.clear(); wait.resolve({source:'manual',results:[{tagId:battery.tagId,battery}]}); assert.equal((await pending).type,'cancelled'); assert.equal(calls.length,0);
});
test('duplicate acquisition never replaces open details; retry retains only the original lookup input',async () => {
  let fail=true; const {controller,calls}=fixture({lookup:async payload=>{calls.push({payload:structuredClone(payload)}); if(fail)throw new Error('Interrupted');return {source:payload.source,results:[{tagId:battery.tagId,battery}]};}});
  assert.equal((await controller.resolveTag(battery.tagId,'manual')).type,'failure'); fail=false; assert.equal((await controller.retry()).type,'accepted'); assert.deepEqual(calls.filter(call=>call.payload).map(call=>call.payload),[{tagIds:[battery.tagId],source:'manual'},{tagIds:[battery.tagId],source:'manual'}]);
  const before=controller.getSnapshot(); assert.equal((await controller.selectBattery('BAT-OTHER')).type,'duplicate'); assert.equal(controller.getSnapshot(),before); controller.clear(); assert.equal(controller.getSnapshot().phase,'idle');
});
