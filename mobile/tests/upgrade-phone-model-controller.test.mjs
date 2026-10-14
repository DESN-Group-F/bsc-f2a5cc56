import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createDurableStorage } from '../src/platform/durable-storage.mjs';
import { acknowledgeWorkflowStorage } from '../src/shared/lib/client/workflow-storage.js';
import { modelCreateStorageKey, recoverModelCreate, verifyModelCreateReceipt } from '../src/shared/components/inventory/battery-model-picker.js';
import { numberOrNull } from '../src/shared/lib/client-utils.js';
import { modelFieldNames, modelFieldValue, newBatteryModelSchema, updateBatteryModelSchema } from '../src/shared/lib/battery-models.js';

const accountId='STAFF-A', dataset='demo', model={origin:'saved',id:'00000000-0000-4000-8000-000000000001',label:'Reviewed model',version:2,contentHash:'a'.repeat(64),brand:'Acme',model:'M1',variant:'',name:'Suggested battery',chemistry:'Li-ion',capacityMah:null,voltage:12,notes:'',warnings:[],sources:[],verificationStatus:'staff_entered'};
const tick=()=>new Promise(resolve=>setImmediate(resolve));

/** Executes the actual extracted hook with controlled React effects and service responses. */
async function harness({models=[model],values={name:'Manual name',model:'',chemistry:'',capacityMah:'3000',voltage:''},canEditModels=true,entries={},post}={}) {
  let raw=JSON.stringify({schemaVersion:1,entries}), dirty=true,cursor=0, view;
  const hooks=[],effects=[],calls=[];
  const storage=createDurableStorage({load:async()=>raw,save:async value=>{raw=value;}});await storage.initialize();
  const window={__batteryWorkflowStorage:storage};
  function useState(initial){const index=cursor++;hooks[index]??={value:typeof initial==='function'?initial():initial};return [hooks[index].value,next=>{const value=typeof next==='function'?next(hooks[index].value):next;if(!Object.is(value,hooks[index].value)){hooks[index].value=value;dirty=true;}}];}
  function useRef(initial){return hooks[cursor++]??={current:initial};}
  function useEffect(run,deps){const index=cursor++,old=hooks[index];if(!old || deps.some((value,i)=>!Object.is(value,old.deps[i]))){hooks[index]={deps,cleanup:old?.cleanup};effects.push(()=>{hooks[index].cleanup?.();hooks[index].cleanup=run();});}}
  const props={dataset,actorAccountId:accountId,canEditModels,values,selection:null,disabled:false,onApply:(choice,fields)=>calls.push({apply:{choice,fields:[...fields]}}),onManual:()=>calls.push({manual:true}),onBusyChange:()=>{}};
  async function fetch(url,options={}){
    if(options.method==='POST'){
      await storage.flush(); const input=JSON.parse(options.body);calls.push({post:input,saved:JSON.parse(raw).entries});
      if(post)return post(input);
      const created={...model,...input.payload,origin:'saved',version:input.update?input.payload.expectedVersion+1:1,contentHash:'b'.repeat(64)};
      const body={ok:true,result:{model:created,requestId:input.update?input.payload.requestId:input.payload.id,actorAccountId:accountId,dataset,replayed:false}};
      return {ok:true,status:200,json:async()=>body};
    }
    return {ok:true,status:200,json:async()=>({dataset,models,issues:[]})};
  }
  const source=(await readFile(new URL('../src/features/lifecycle/phone-model-controller.js',import.meta.url),'utf8')).replace(/^import .*;\r?\n/gm,'').replace(/^export \{.*\};?\r?\n/gm,'').replace(/^export /gm,'');
  const bindings={useState,useRef,useEffect,window,fetch,acknowledgeWorkflowStorage:args=>acknowledgeWorkflowStorage({...args,storage}),modelCreateStorageKey,recoverModelCreate,verifyModelCreateReceipt,numberOrNull,modelFieldNames,modelFieldValue,newBatteryModelSchema,updateBatteryModelSchema};
  const names=Object.keys(bindings),Hook=new Function(...names,source+'\nreturn usePhoneModelController;')(...names.map(name=>bindings[name]));
  function render(){let count=0;do{assert.ok(count++<20);dirty=false;cursor=0;view=Hook(props);while(effects.length)effects.shift()();}while(dirty);return view;}
  render();await tick();render();
  return {get:()=>view,render,props,calls,storage,settle:async()=>{await tick();return render();}};
}

test('model field review retains conflicting manual and unknown values, with the reviewed content hash',async()=>{
  const h=await harness();h.get().selectModel('saved:'+model.id);h.render();
  assert.deepEqual(h.get().appliedFields,['model','chemistry','voltage']);
  h.get().reviewField('name',true);h.render();assert.ok(h.get().appliedFields.includes('name'));
  h.get().apply();assert.deepEqual(h.calls[0].apply.choice.contentHash,model.contentHash);assert.equal(h.calls[0].apply.fields.includes('capacityMah'),false);
  h.props.values={...h.props.values,name:'Changed after review'};h.render();assert.equal(h.get().appliedFields.includes('name'),false);assert.equal(h.props.values.capacityMah,'3000');
});
test('an interrupted model create persists exact fields before POST and retries the original request',async()=>{
  let lost=true;const payloads=[];
  const h=await harness({post:input=>{payloads.push(structuredClone(input));if(lost)throw new Error('Controlled lost response');const saved={...model,...input.payload,contentHash:'b'.repeat(64),version:1};return {ok:true,status:200,json:async()=>({ok:true,result:{model:saved,requestId:input.payload.id,actorAccountId:accountId,dataset,replayed:true}})};}});
  h.get().openNewModel();h.render();h.get().setDraft({...h.get().draft,model:'M2',name:'Created model',capacityMah:'',voltage:'12'});h.render();
  await h.get().saveModel();h.render();const key=modelCreateStorageKey(accountId,dataset),original=h.storage.getItem(key);assert.ok(original);assert.equal(h.calls[0].saved[key],original);assert.equal(h.get().pending.payload.model,'M2');
  h.get().cancelModel();h.render();assert.equal(h.get().adding,true);h.get().manual();assert.equal(h.calls.some(call=>call.manual),false);
  lost=false;await h.get().saveModel();await h.settle();assert.deepEqual(payloads[0],payloads[1]);assert.equal(h.storage.getItem(key),null);assert.equal(h.get().pending,null);assert.equal(h.calls.some(call=>call.apply),false);
});
test('version conflict retains the model draft until latest version is explicitly reviewed',async()=>{
  const h=await harness({post:()=>({ok:false,status:409,json:async()=>({error:'Model changed',code:'model_conflict'})})});
  h.get().selectModel('saved:'+model.id);h.render();h.get().openEditModel();h.render();h.get().setDraft({...h.get().draft,name:'Manual revised name'});h.render();
  await h.get().saveModel();h.render();assert.equal(h.get().editConflict,true);assert.equal(h.get().draft.name,'Manual revised name');assert.equal(h.get().pending,null);assert.equal(h.get().editing.expectedVersion,2);
  await h.get().reviewLatestModel();h.render();assert.equal(h.get().draft.name,'Manual revised name');assert.equal(h.get().modelReview.version,2);h.get().useReviewedVersion();h.render();assert.equal(h.get().editConflict,false);assert.equal(h.get().draft.name,'Manual revised name');
});
test('original saved-model request recovery remains usable after loss of edit authority',async()=>{
  const attempt={dataset,actorAccountId:accountId,update:true,payload:{id:model.id,brand:model.brand,model:model.model,variant:'',name:model.name,chemistry:model.chemistry,capacityMah:null,voltage:model.voltage,notes:'',expectedVersion:2,requestId:'00000000-0000-4000-8000-000000000002'}};
  const h=await harness({canEditModels:false,entries:{[modelCreateStorageKey(accountId,dataset)]:JSON.stringify(attempt)}});assert.equal(h.get().editAccessLost,true);assert.deepEqual(h.get().pending,attempt);h.get().openEditModel();h.render();assert.equal(h.get().editing.expectedVersion,2);
  await h.get().saveModel();h.render();assert.deepEqual(h.calls.find(call=>call.post).post,{dataset,payload:attempt.payload,update:true});assert.equal(h.get().pending,null);
});
