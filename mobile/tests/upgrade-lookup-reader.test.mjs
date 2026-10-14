import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { createLookupController } from '../src/features/scan/lookup-controller.mjs';
import { createLookupReader } from '../src/features/scan/lookup-reader.mjs';
import { NFC_PREFIX,withNfcFailureContext } from '../src/business/nfc-controller.mjs';
import { scanFeedbackOutcome, expireScanFeedback } from '../src/features/scan/feedback.mjs';
import { createNativeReaderSession } from '../src/features/scan/native-reader-session.mjs';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
const flatten=(node,items=[])=>{if(!node||typeof node!=='object')return items;if(node.type)items.push(node);for(const child of [node.props?.children].flat(Infinity))flatten(child,items);return items;};

/** Actual lookup hook lifecycle with a controlled native adapter; not hardware evidence. */
async function readerHarness({dataset='demo',acquisition,knownBattery,renderResultBeforeContinuation=false}={}) {
  const pending=deferred(),calls=[],hooks=[],effects=[],listeners=new Map();let cursor=0,dirty=true,tree,back,active=true,attempt=0;
  const bridge={getAvailability:async()=>({available:true,enabled:true,platform:'android'}),read:()=>{calls.push('read');return pending.promise;},cancel:async()=>{calls.push('cancel');},adopt:async proposal=>{calls.push('adopt');return proposal;}};
  const add=(name,fn)=>{if(!listeners.has(name))listeners.set(name,new Set());listeners.get(name).add(fn);},remove=(name,fn)=>listeners.get(name)?.delete(fn),dispatch=name=>{for(const fn of [...listeners.get(name)||[]])fn();};
  const document={visibilityState:'visible',addEventListener:add,removeEventListener:remove};
  const window={addEventListener:add,removeEventListener:remove};
  const props={dataset,data:{dataset,user:{id:'staff'},batteries:[]},onExit:()=>calls.push('exit')};
  const bindings={Capacitor:{getPlatform:()=> 'android'},NfcScanControl:'NfcScanControl',React:{},ArrowLeft:'icon',Download:'icon',Search:'icon',InkOrb:'InkOrb',Pressable:'button',native:true,businessStorage:()=>acquisition?.storage||({getItem:()=>null}),prepareLookupReader:async options=>acquisition?createLookupReader({...options,adapter:acquisition.adapter,platform:'android',id:()=>`lookup-owner-${++attempt}`,now:()=> '2026-10-13T00:00:01.000Z'}):bridge,useWorkflowLock(){},usePhoneContext:()=>({active}),usePhoneBack:handler=>{back=handler;},createLookupController,withNfcFailureContext,scanFeedbackOutcome,expireScanFeedback,readFeedbackPreferences:()=>({haptics:false,sounds:false}),playScanFeedback(){},inventoryResponse:async response=>response,fetch:()=>{calls.push('query');throw new Error('A stale native callback must never query');},batteryStatusLabel:()=>'',formatTime:value=>value,storageRoomLabel:()=>'',document,window,
    useState(initial){const index=cursor++;hooks[index]??={value:typeof initial==='function'?initial():initial};return [hooks[index].value,next=>{const value=typeof next==='function'?next(hooks[index].value):next;if(!Object.is(value,hooks[index].value)){hooks[index].value=value;dirty=true;}}];},
    useRef(initial){return hooks[cursor++]??={current:initial};},
    useEffect(run,deps){const index=cursor++,old=hooks[index];if(!old||deps.some((value,i)=>!Object.is(value,old.deps[i]))){hooks[index]={deps,cleanup:old?.cleanup};effects.push(()=>{hooks[index].cleanup?.();hooks[index].cleanup=run();});}},
  };
  if(knownBattery){
    bindings.fetch=async(url,options)=>{calls.push('query');return options?.method==='POST'?{result:{source:'native_nfc',results:[{tagId:knownBattery.tagId,battery:knownBattery}]}}:{battery:knownBattery,events:[]};};
    bindings.createLookupController=options=>{const controller=createLookupController(options);return{...controller,subscribe(listener){return controller.subscribe(()=>{listener();if(renderResultBeforeContinuation&&controller.getSnapshot().phase==='result')render();});}};};
  }
  bindings.ScanOutcomeStatus='ScanOutcomeStatus';bindings.useScanModeMotion=()=>{};
  for(const [file,name,extra]of [['use-scan-feedback.js','useScanFeedback',{}],['use-owned-nfc-reader.js','useOwnedNfcReader',{createNativeReaderSession:options=>createNativeReaderSession({...options,prepare:bindings.prepareLookupReader})}]]){
    const code=(await readFile(new URL(`../src/features/scan/${file}`,import.meta.url),'utf8')).replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,''),supplied={...bindings,...extra},keys=Object.keys(supplied);
    bindings[name]=new Function(...keys,code+`\nreturn ${name};`)(...keys.map(key=>supplied[key]));
  }
  const source=ts.transpileModule(await readFile(new URL('../src/features/scan/lookup.jsx',import.meta.url),'utf8'),{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText.replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'');
  const jsx=(type,props)=>({type,props}),keys=Object.keys(bindings),Component=new Function(...keys,'_jsx','_jsxs','_Fragment',source+'\nreturn LookupWorkflow;')(...keys.map(key=>bindings[key]),jsx,jsx,'fragment');
  function render(){let tries=0;do{assert.ok(tries++<20);dirty=false;cursor=0;tree=Component(props);while(effects.length)effects.shift()();}while(dirty);return tree;}
  render();await tick();render();
  return {calls,pending,render,back:()=>back(),deactivate:()=>{active=false;render();},activate:()=>{active=true;render();},search:()=>{flatten(tree).find(node=>node.props?.children==='Inventory search').props.onClick();render();},hide:({renderNow=true}={})=>{document.visibilityState='hidden';dispatch('visibilitychange');if(renderNow)render();},show:()=>{document.visibilityState='visible';dispatch('visibilitychange');render();},pagehide:({renderNow=true}={})=>{dispatch('pagehide');if(renderNow)render();},nodes:()=>flatten(tree),unmount:()=>{for(const hook of hooks)hook.cleanup?.();}};
}

function controlledAcquisition(windowName) {
  const gate=deferred(),entered=deferred(),saved=new Map(),calls=[];let availabilityCalls=0,flushCalls=0;
  const result={uidHex:'00010203',technology:'NfcA',ndefStatus:'notSupported',capacityBytes:null,records:[],observedAt:'2026-10-13T00:00:01.000Z'};
  return {calls,entered:entered.promise,release:gate.resolve,saved,
    storage:{getItem:key=>saved.get(key)||null,setItem:(key,value)=>saved.set(key,value),async flush(){flushCalls++;if(windowName==='durable flush'&&flushCalls===1){entered.resolve();await gate.promise;}}},
    adapter:{async getAvailability(){availabilityCalls++;if(windowName==='second availability'&&availabilityCalls===2){entered.resolve();await gate.promise;}return{platform:'android',available:true,enabled:true};},async read(){calls.push('native read');if(windowName==='native result'){entered.resolve();await gate.promise;}return structuredClone(result);},async cancel(){calls.push('native cancel');}},
  };
}

test('Working lookup never starts hardware, and the actual component offers inventory search',async()=>{
  const phone=await readerHarness({dataset:'live'});assert.equal(phone.calls.includes('read'),false);assert.equal(phone.nodes().some(node=>node.props?.className==='lookup-search'),true);phone.unmount();
});
test('Back cancels the owned read before exit; a late callback cannot adopt evidence or query',async()=>{
  const phone=await readerHarness();assert.equal(phone.calls.filter(call=>call==='read').length,1);phone.back();await tick();assert.deepEqual(phone.calls,['read','cancel','exit']);
  phone.pending.resolve({tagId:'nfc:uid:00010203'});await tick();phone.render();assert.equal(phone.calls.includes('adopt'),false);assert.equal(phone.calls.includes('query'),false);phone.unmount();
});
test('backgrounding pauses the actual native owner and discards late callbacks without a lookup',async()=>{
  const phone=await readerHarness();phone.hide();await tick();assert.ok(phone.calls.includes('cancel'));phone.pending.resolve({tagId:'nfc:uid:00010203'});await tick();phone.render();assert.equal(phone.calls.includes('adopt'),false);assert.equal(phone.calls.includes('query'),false);phone.unmount();
});

for(const event of ['hide','pagehide'])test(`${event} synchronously cancels and invalidates a complete native proposal before React rerenders`,async()=>{
  const phone=await readerHarness();phone[event]({renderNow:false});await tick();assert.ok(phone.calls.includes('cancel'),'the synchronously invalidated owner requests native cancellation before React effect cleanup');
  phone.pending.resolve({attemptId:'00000000-0000-4000-8000-000000000001',source:'native-nfc-reader',platform:'android',startedAt:'2026-10-13T00:00:00.000Z',endedAt:'2026-10-13T00:00:01.000Z',adoptedAt:'2026-10-13T00:00:02.000Z',tagId:'nfc:uid:00010203',result:{uidHex:'00010203',technology:'NfcA',ndefStatus:'notSupported',capacityBytes:null,records:[],observedAt:'2026-10-13T00:00:01.000Z'}});
  await tick();assert.equal(phone.calls.includes('adopt'),false);assert.equal(phone.calls.includes('query'),false);phone.render();phone.unmount();
});

for(const event of ['hide','pagehide'])test(`actual durable reader preserves raw evidence after ${event} without adopting or querying before React rerenders`,async()=>{
  const acquisition=controlledAcquisition('native result'),phone=await readerHarness({acquisition});await acquisition.entered;phone[event]({renderNow:false});await tick();assert.ok(acquisition.calls.includes('native cancel'));acquisition.release();await tick();await tick();
  const reports=[...acquisition.saved.values()].map(raw=>JSON.parse(raw));assert.equal(reports.length,1);assert.equal(reports[0].outcome,'read');assert.equal(reports[0].result.uidHex,'00010203');assert.equal(reports[0].adoptions,undefined,'a late real read stays original device evidence only');assert.equal(phone.calls.includes('query'),false);phone.render();phone.unmount();
});

for(const windowName of ['second availability','durable flush'])for(const transition of ['inventory search','Exit','deactivation'])test(`actual bridge and durable evidence: ${transition} during ${windowName} never invokes native acquisition`,async()=>{
  const acquisition=controlledAcquisition(windowName),phone=await readerHarness({acquisition});await acquisition.entered;
  assert.equal(acquisition.calls.includes('native read'),false);
  assert.equal(phone.nodes().some(node=>node.props?.role==='status'&&node.props.children==='Ready to scan'),false,'Ready must mean actual native activation, not an awaiting bridge');
  if(transition==='inventory search')phone.search();else if(transition==='Exit'){phone.back();phone.render();}else phone.deactivate();
  await tick();acquisition.release();await tick();await tick();phone.render();
  assert.equal(acquisition.calls.includes('native read'),false,'the real readNfcProposal adapter boundary must reject a stale owner after every await');
  assert.equal(phone.calls.includes('query'),false);
  const reports=[...acquisition.saved.entries()].filter(([key])=>key.startsWith(NFC_PREFIX)).map(([,raw])=>JSON.parse(raw));
  assert.equal(reports.length,1);assert.equal(reports[0].outcome,'cancelled');assert.equal(reports[0].error.code,'CANCELLED');assert.equal(reports[0].result,null);
  assert.ok(acquisition.calls.includes('native cancel'));phone.unmount();
});

test('lookup exposes an explicit Clear filters action which restores the search without a request',async()=>{
  const phone=await readerHarness({dataset:'live'}),searchInput=()=>phone.nodes().find(node=>node.type==='input'),clear=()=>phone.nodes().find(node=>node.props?.children==='Clear filters');
  assert.equal(clear().props.disabled,true);searchInput().props.onChange({target:{value:'known model'}});phone.render();assert.equal(clear().props.disabled,false);assert.equal(searchInput().props.value,'known model');clear().props.onClick();phone.render();assert.equal(searchInput().props.value,'');assert.equal(clear().props.disabled,true);assert.equal(phone.calls.length,0);phone.unmount();
});

const completeProposal={attemptId:'00000000-0000-4000-8000-000000000001',source:'native-nfc-reader',platform:'android',startedAt:'2026-10-13T00:00:00.000Z',endedAt:'2026-10-13T00:00:01.000Z',adoptedAt:'2026-10-13T00:00:02.000Z',tagId:'nfc:uid:00010203',result:{uidHex:'00010203',technology:'NfcA',ndefStatus:'notSupported',capacityBytes:null,records:[],observedAt:'2026-10-13T00:00:01.000Z'}};
test('actual result commit before resolve continuation still presents finite success on the persistent full orb',async()=>{
  const knownBattery={id:'BAT-001',name:'A recorded battery',version:2,tagId:completeProposal.tagId,lifecycleStatus:'scrapped'},phone=await readerHarness({knownBattery,renderResultBeforeContinuation:true});
  phone.pending.resolve(completeProposal);await tick();phone.render();
  const result=phone.nodes().find(node=>node.props?.className==='lookup-result');assert.ok(result);const orb=phone.nodes().find(node=>['InkOrb','NfcScanControl'].includes(node.type));assert.ok(orb);assert.equal(orb.props.compact,undefined);assert.equal(orb.props.feedback,'success');assert.equal(orb.props.event,'accepted');
  const lane=phone.nodes().find(node=>node.type==='ScanOutcomeStatus');assert.equal(lane.props.feedback.outcomeType,'accepted');assert.equal(lane.props.feedback.until>0,true);assert.equal(lane.props.acceptedTitle,'Battery found');assert.deepEqual(lane.props.reader,{});assert.equal(phone.calls.filter(value=>value==='query').length,2);assert.ok(phone.nodes().some(node=>node.props?.children==='Scan another'));phone.unmount();
});
test('an open result remains disarmed after background and foreign overlay return until Scan another',async()=>{
  const knownBattery={id:'BAT-001',name:'A recorded battery',version:2,tagId:completeProposal.tagId},phone=await readerHarness({knownBattery,renderResultBeforeContinuation:true});phone.pending.resolve(completeProposal);await tick();phone.render();assert.equal(phone.calls.filter(value=>value==='read').length,1);
  phone.hide();await tick();phone.show();await tick();phone.deactivate();phone.activate();await tick();phone.render();assert.equal(phone.calls.filter(value=>value==='read').length,1,'result return must not enable a new reader or replace success with duplicate');
  assert.equal(phone.nodes().find(node=>node.type==='ScanOutcomeStatus').props.feedback.outcomeType,'accepted');phone.nodes().find(node=>node.props?.children==='Scan another').props.onClick();phone.render();await tick();phone.render();assert.equal(phone.calls.filter(value=>value==='read').length,2);phone.unmount();
});
test('message details retain explicit acquisition pause across background without rearming',async()=>{
  const phone=await readerHarness(),lane=()=>phone.nodes().find(node=>node.type==='ScanOutcomeStatus');lane().props.onOpenChange(true);phone.render();await tick();phone.pending.resolve(completeProposal);await tick();phone.hide();phone.show();await tick();phone.render();assert.equal(phone.calls.filter(value=>value==='read').length,1);assert.equal(phone.calls.includes('query'),false);lane().props.onOpenChange(false);phone.render();await tick();assert.equal(phone.calls.filter(value=>value==='read').length,2);phone.unmount();
});
