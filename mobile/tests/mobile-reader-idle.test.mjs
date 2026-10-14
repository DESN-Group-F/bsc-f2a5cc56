import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { createDurableStorage } from '../src/platform/durable-storage.mjs';
import { createTeachingNfcBridge } from '../src/business/teaching-nfc-bridge.mjs';
import { NFC_PREFIX,withNfcFailureContext } from '../src/business/nfc-controller.mjs';
import { createIntakeController, intakeDefaultValues, intakeEntrySource, intakeError, intakeStringFields, reviewedIntakeCommon } from '../src/features/lifecycle/intake-controller.mjs';
import { applyIntakePreparationModel, changedIntakePreparation, normalizedIntakePreparation } from '../src/features/lifecycle/intake-preparation.mjs';
import { createRemovalController, acquireRemovalNative, createGuardedRemovalBridge, removalEligible, removalScopeMatches } from '../src/features/lifecycle/removal-controller.mjs';
import { removalDraftStorageKey } from '../src/shared/lib/removal-draft.js';
import { removalEntrySource } from '../src/features/scan/input-mode.mjs';
import { readFeedbackPreferences, scanFeedbackOutcome, expireScanFeedback, FEEDBACK_KEY } from '../src/features/scan/feedback.mjs';
import { createNativeReaderSession } from '../src/features/scan/native-reader-session.mjs';

// Execute the actual hook/JSX reader effects with the real durable evidence bridge.
// Adapter, clock, React commit and DOM are controlled; this is not a radio test.
const sources={scan:['../src/features/scan/use-scan-workflow.js','useScanWorkflow'],intake:['../src/features/lifecycle/intake.jsx','MobileIntake'],removal:['../src/features/lifecycle/removal.jsx','MobileRemoval']};
const flatten=(node,result=[])=>{if(!node||typeof node!=='object')return result;if(node.type)result.push(node);for(const child of [node.props?.children].flat(Infinity))flatten(child,result);return result;};
const words=node=>node==null||typeof node==='boolean'?'':typeof node!=='object'?String(node):[node.props?.children].flat(Infinity).map(words).join('');

async function compile(file,name,bindings){
  const source=await readFile(new URL(file,import.meta.url),'utf8');
  const parsed=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JSX),resolved={...bindings};
  for(const item of parsed.statements.filter(ts.isImportDeclaration)){
    if(item.importClause?.name)resolved[item.importClause.name.text]??=item.importClause.name.text;
    for(const value of item.importClause?.namedBindings?.elements||[])resolved[value.name.text]??=resolved[value.propertyName?.text]??value.name.text;
  }
  const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText.replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'').replace(/\bimport\(/g,'__load(');
  const jsx=(type,props)=>({type,props}),keys=Object.keys(resolved);
  return new Function(...keys,'_jsx','_jsxs',`${compiled}\nreturn ${name};`)(...keys.map(key=>resolved[key]),jsx,jsx);
}

async function mount(kind,{platform='android',code='TIMEOUT',cancelSettles=true,deferCancel=false}={}){
  const storage=createDurableStorage({load:async()=>JSON.stringify({schemaVersion:1,entries:{}}),save:async()=>{}});await storage.initialize();
  const user={id:'11111111-1111-4111-8111-111111111111',role:'admin',displayName:'Staff A'};
  const data={dataset:'demo',user,batteries:[],people:[{id:'OWNER-A',role:'staff',accountId:user.id,name:'Staff A'}],staffDirectory:[{id:user.id,active:true}],rooms:[],buildings:[{id:'J18'}]};
  const reads=[],feedback=[],haptics=[],timers=[],listeners=new Map(),hooks=[],effects=[],cancelCalls=[],readerSessions=[],readerFrames=[];let pendingRead,cursor=0,dirty=true,result,closed=false,surfaceActive=true,readerHook,feedbackHook,clock=Date.now();
  const adapter={getAvailability:async()=>({platform,available:true,enabled:true}),read(options){reads.push(options);if(reads.length===1)return Promise.reject(Object.assign(new Error('Controlled reader stop'),{code}));return new Promise((resolve,reject)=>{pendingRead={resolve,reject};});},async cancel(){const owned=pendingRead,call={owned};cancelCalls.push(call);if(deferCancel)await new Promise(resolve=>{call.resolve=resolve;});if(cancelSettles)owned?.reject(Object.assign(new Error('Controlled cancellation'),{code:'CANCELLED'}));if(cancelSettles&&pendingRead===owned)pendingRead=null;}};
  const listen=(name,run)=>{if(!listeners.has(name))listeners.set(name,new Set());listeners.get(name).add(run);};
  const unlisten=(name,run)=>listeners.get(name)?.delete(run);
  const window={addEventListener:listen,removeEventListener:unlisten,__batteryMobileHaptic:duration=>haptics.push(duration)},document={visibilityState:'visible',activeElement:null,body:{},querySelector:()=>({inert:false}),addEventListener:listen,removeEventListener:unlisten};
  const effect=(run,deps)=>{const index=cursor++,old=hooks[index];if(!old||!deps||deps.some((value,i)=>!Object.is(value,old.deps?.[i]))){hooks[index]={deps,cleanup:old?.cleanup};effects.push(()=>{hooks[index].cleanup?.();hooks[index].cleanup=run();});}};
  const session={queue:[],completed:[],issues:[],attempt:null},scanController={getSnapshot:()=>({session,busy:false,blocked:false,storageError:''}),updateInventory(){},subscribe(){return()=>{};},addTag(){assert.fail('A timed-out read cannot acquire a battery.');}};
  let intakeQueueFeedback=()=>{};
  const intakeController=createIntakeController({storage,data,accountId:user.id,dataset:'demo',onQueueAccepted:value=>intakeQueueFeedback(value),write:async()=>assert.fail('Idle reading cannot register a battery.')});await intakeController.prepare({...intakeDefaultValues(data,user.id),name:'Prepared battery'});
  const removalController=createRemovalController({storage,accountId:user.id,dataset:'demo',inventory:data,defaultSource:'native_nfc',write:async()=>assert.fail('Idle reading cannot remove a battery.')});await removalController.initialize();
  const bindings={window,document,native:true,React:{Fragment:'fragment'},_Fragment:'fragment',InkOrb:'InkOrb',Pressable:'button',createPhoneWorkflowPortal:element=>element,usePhoneOverlayDismiss(){},
    useState(initial){const index=cursor++;if(!hooks[index])hooks[index]={value:typeof initial==='function'?initial():initial};return [hooks[index].value,next=>{const value=typeof next==='function'?next(hooks[index].value):next;if(!Object.is(value,hooks[index].value)){hooks[index].value=value;dirty=true;}}];},
    useRef(initial){return hooks[cursor++]??={current:initial};},useEffect:effect,useLayoutEffect:effect,useWorkflowLock(){},usePhoneBack(){},usePhoneContext:()=>({active:surfaceActive}),usePhoneFormDraft({initial}){const [value,setValue]=bindings.useState(initial);return{value,setValue,pending:false,error:'',save:async()=>value,clear:async()=>{},retry:async()=>{}};},usePhoneViewState(_key,initial){return bindings.useState(initial);},useScanModeMotion(){},
    setTimeout(run,delay){const timer={run,delay,active:true};timers.push(timer);return timer;},clearTimeout(timer){if(timer)timer.active=false;},
    Capacitor:{getPlatform:()=>platform},businessStorage:()=>storage,teachingNfcBridge:()=>null,createTeachingNfcBridge,withNfcFailureContext,createScanController:()=>scanController,acquisitionOf:()=>null,
    createIntakeController:options=>{intakeQueueFeedback=options.onQueueAccepted;return intakeController;},intakeDefaultValues,intakeEntrySource,intakeError,intakeStringFields,reviewedIntakeCommon,applyIntakePreparationModel,changedIntakePreparation,normalizedIntakePreparation,
    createRemovalController:()=>removalController,acquireRemovalNative,createGuardedRemovalBridge,removalEligible,removalScopeMatches,removalDraftStorageKey,removalEntrySource,
    readFeedbackPreferences,scanFeedbackOutcome,expireScanFeedback,FEEDBACK_KEY,playScanFeedback:outcome=>feedback.push(outcome),Date:class extends Date{static now(){return clock;}},
    modelCreateStorageKey:()=> 'model:none',getRolePermissions:()=>({retireBatteries:true}),currentSydneyDate:()=> '2026-10-12',isSelectableRoom:()=>true,modelApplication:old=>old,formatTime:value=>value,saveFile(){},
    __load:async specifier=>specifier==='@capacitor/core'?{Capacitor:{getPlatform:()=>platform}}:specifier==='@battery-inventory/nfc'?{BatteryNfc:adapter}:{createTeachingNfcBridge},
  };
  for(const name of ['ArrowLeft','ChevronDown','Expand','Pencil','Settings2','Trash2','X','Search','CheckCircle2','FileDown'])bindings[name]=name;
  const playScanFeedback=await compile('../src/features/scan/feedback.mjs','playScanFeedback',{window});
  bindings.playScanFeedback=(outcome,preferences,native)=>{feedback.push(outcome);playScanFeedback(outcome,preferences,native);};
  const prepareLookupReader=await compile('../src/features/scan/lookup-reader.mjs','prepareLookupReader',bindings);
  bindings.createNativeReaderSession=options=>{const owned=createNativeReaderSession({...options,prepare:prepareLookupReader,schedule:bindings.setTimeout,unschedule:bindings.clearTimeout});readerSessions.push(owned);return owned;};
  const useOwnedNfcReader=await compile('../src/features/scan/use-owned-nfc-reader.js','useOwnedNfcReader',bindings),useScanFeedback=await compile('../src/features/scan/use-scan-feedback.js','useScanFeedback',bindings);
  bindings.useOwnedNfcReader=options=>{readerHook=useOwnedNfcReader(options);return readerHook;};
  bindings.useScanFeedback=options=>{feedbackHook=useScanFeedback(options);return feedbackHook;};
  const [file,name]=sources[kind],Component=await compile(file,name,bindings);
  const props={kind:'checkout',data,user,dataset:'demo',reviewOpen:false,input:'native'};
  function render(){let count=0;do{assert.ok(count++<30,'Actual effects settle');dirty=false;cursor=0;result=Component(props);readerFrames.push(readerHook.reader.state);for(const node of flatten(result))if(node.props.ref&&!node.props.ref.current)node.props.ref.current={scrollTop:0,isConnected:true,querySelector:()=>({focus(){}}),querySelectorAll:()=>[],contains:()=>true,focus(){}};while(effects.length)effects.shift()();}while(dirty);return result;}
  async function settle(){for(let count=0;count<8;count++){await new Promise(setImmediate);if(!closed)render();}}
  const view={storage,reads,feedback,haptics,props,render,settle,cancelCalls,readerSessions,readerFrames,
    evidence:()=>Object.entries(storage.entries()).filter(([key])=>key.startsWith(NFC_PREFIX)).map(([,raw])=>JSON.parse(raw)),
    status:()=>readerHook.reader.message,
    readerState:()=>readerHook.reader.state,
    feedbackState:()=>feedbackHook.feedback,
    present(outcome){feedbackHook.present(outcome);render();},
    beginAcquisition(uid,attempt){feedbackHook.beginAcquisition(uid,attempt);render();},
    clearOutcome(){feedbackHook.clearOutcome();render();},
    async action(work,acquiring=false){assert.equal(kind,'scan');const value=await result.action(work,acquiring);render();return value;},
    setClock(value){clock=value;},
    resume:()=>readerHook.resumeReader(),
    pause:reason=>readerHook.cancelReader(reason),
    failureTone:()=>kind==='scan'?result.feedback.tone==='failure':flatten(result).some(node=>['InkOrb','NfcScanControl'].includes(node.type)&&String(node.props.feedback).split(' ').includes('failure')),
    queueSize:()=>kind==='scan'?session.queue.length:kind==='intake'?intakeController.getSnapshot().draft.entries.length:removalController.snapshot().draft.items.length,
    waitTimer:()=>timers.findLast(timer=>timer.active&&timer.delay===250),
    async completeRead(commit=true){assert.ok(pendingRead);pendingRead.resolve({uidHex:'0004AB00',technology:'Controlled NFC-A output',ndefStatus:'readWrite',capacityBytes:144,records:[],observedAt:'2026-10-12T05:00:00.000Z',...(platform==='ios'?{readerSessionId:reads.at(-1).sessionId||`controlled-ios-session-${reads.length}`}:{})});pendingRead=null;if(commit)await settle();else for(let count=0;count<8;count++)await new Promise(setImmediate);},
    key(key){for(const handler of [...listeners.get('keydown')||[]])handler({key,preventDefault(){}});render();},
    click(label){const button=flatten(result).find(node=>node.type==='button'&&(node.props['aria-label']===label||words(node)===label));assert.ok(button,`Actual button: ${label}`);button.props.onClick();render();},
    hasEditor:()=>flatten(result).some(node=>node.props.className==='mi-editor'),
    hasReview:()=>flatten(result).some(node=>node.props.className?.startsWith('mi-review-sheet')),
    async advance(){const timer=view.waitTimer();assert.ok(timer,'Actual effect schedules a bounded re-arm');timer.active=false;timer.run();await settle();},
    async review(){if(kind==='scan'){props.reviewOpen=true;render();}else{const trigger=flatten(result).find(node=>node.type==='button'&&(node.props['aria-label']?.startsWith('Review queue')||node.props.className?.includes('removal-review-entry')));assert.ok(trigger);trigger.props.onClick();render();}await settle();},
    async deactivate(){surfaceActive=false;render();await settle();},
    activate(){surfaceActive=true;render();},
    hiddenWithoutEvent(){document.visibilityState='hidden';},
    mismatchWithoutEffects(){props.dataset='live';props.data={...data,dataset:'live'};dirty=false;cursor=0;result=Component(props);},
    async foreground(){document.visibilityState='visible';for(const listener of [...listeners.get('visibilitychange')||[]])listener();render();await settle();},
    async pageshow(){for(const listener of [...listeners.get('pageshow')||[]])listener();render();await settle();},
    async background(){document.visibilityState='hidden';for(const listener of [...listeners.get('visibilitychange')||[]])listener();render();await settle();},
    async close(){
      closed=true;for(const hook of hooks)hook?.cleanup?.();
      // Release the controlled radio even when its deliberately broken cancel
      // cannot settle, so the real proposal bridge cannot leak across tests.
      pendingRead?.reject(Object.assign(new Error('Controlled test cleanup'),{code:'CANCELLED'}));pendingRead=null;
      for(let count=0;count<4;count++){await settle();for(const call of cancelCalls)call.resolve?.();}
    },
  };
  render();await settle();if(kind==='intake'){view.click('Continue with these details');await settle();}if(platform==='ios'){assert.equal(reads.length,0,'Mount and preparation must not open iOS NFC');view.resume();await settle();}return view;
}

for(const kind of Object.keys(sources)){
  test(`${kind}: actual Android idle timeout retains failed evidence and re-arms a new read without failure feedback`,async()=>{
    const view=await mount(kind);
    try{
      assert.equal(view.reads.length,1);assert.match(view.status(),/Waiting for the next tag/);
      assert.equal(view.evidence().length,1);assert.equal(view.evidence()[0].outcome,'failed');assert.equal(view.evidence()[0].error.code,'TIMEOUT');
      assert.equal(view.feedback.length,0);assert.equal(view.failureTone(),false);assert.equal(view.queueSize(),0);
      await view.advance();assert.equal(view.reads.length,2);assert.equal(view.evidence().length,2);assert.equal(view.evidence()[1].outcome,'pending');assert.equal(view.queueSize(),0);assert.equal(view.feedback.length,0);assert.equal(view.failureTone(),false);
    }finally{await view.close();}
  });
  for(const interruption of ['review','background','deactivate'])test(`${kind}: ${interruption} during the idle wait cancels re-arm and rejects an already queued timer callback`,async()=>{
    const view=await mount(kind);try{
      const stale=view.waitTimer();assert.ok(stale);await view[interruption]();assert.equal(stale.active,false);
      stale.run();await view.settle();assert.equal(view.reads.length,1);assert.equal(view.evidence().length,1);assert.equal(view.queueSize(),0);assert.equal(view.feedback.length,0);
    }finally{await view.close();}
  });
  test(`${kind}: an inactive outgoing surface keeps a late native result as evidence without adopting or staging it`,async()=>{
    const view=await mount(kind,{cancelSettles:false});try{
      await view.advance();assert.equal(view.reads.length,2);await view.deactivate();await view.completeRead();
      assert.equal(view.evidence().length,2);assert.equal(view.evidence()[1].outcome,'read');assert.equal(view.evidence()[1].result.uidHex,'0004AB00');assert.equal(view.evidence()[1].adoptions,undefined);
      assert.equal(view.queueSize(),0);assert.equal(view.feedback.length,0);assert.equal(view.waitTimer(),undefined);
    }finally{await view.close();}
  });
  test(`${kind}: native BACKGROUND preserves its raw failure without red feedback or automatic rearm`,async()=>{
    const view=await mount(kind,{code:'BACKGROUND'});try{
      assert.equal(view.reads.length,1);assert.equal(view.evidence()[0].error.code,'BACKGROUND');assert.equal(view.evidence()[0].outcome,'failed');
      assert.match(view.status(),/foreground|background/);assert.equal(view.waitTimer(),undefined);assert.equal(view.queueSize(),0);assert.equal(view.failureTone(),false);assert.deepEqual(view.haptics,[]);assert.deepEqual(view.feedback,[]);
    }finally{await view.close();}
  });
  test(`${kind}: document hidden synchronously rejects a settled read before visibility events or React effects`,async()=>{
    const view=await mount(kind,{cancelSettles:false});try{
      await view.advance();view.hiddenWithoutEvent();await view.completeRead(false);
      assert.equal(view.evidence()[1].outcome,'read');assert.equal(view.evidence()[1].result.uidHex,'0004AB00');assert.equal(view.evidence()[1].adoptions,undefined);
      assert.equal(view.queueSize(),0);assert.deepEqual(view.haptics,[]);assert.deepEqual(view.feedback,[]);assert.equal(view.waitTimer(),undefined);
    }finally{await view.close();}
  });
  test(`${kind}: new account/inventory context rejects old raw evidence before effects commit`,async()=>{
    const view=await mount(kind,{cancelSettles:false});try{
      await view.advance();view.mismatchWithoutEffects();await view.completeRead(false);
      assert.equal(view.evidence()[1].outcome,'read');assert.equal(view.evidence()[1].adoptions,undefined);assert.equal(view.queueSize(),0);
      assert.deepEqual(view.haptics,[]);assert.deepEqual(view.feedback,[]);assert.equal(view.waitTimer(),undefined);
    }finally{await view.close();}
  });
}

test('actual owned reader hook waits for every delayed native cancellation before a replacement read, even after old ownership releases',async()=>{
  const view=await mount('scan',{cancelSettles:false,deferCancel:true});try{
    await view.advance();assert.equal(view.reads.length,2);
    const stopped=view.pause('Reading paused · Original route is closing');await view.settle();assert.equal(view.cancelCalls.length,1);
    view.resume();await view.completeRead(false);assert.equal(view.readerSessions[0].getOwner(),0);assert.equal(view.reads.length,2,'Raw settlement cannot bypass native cancellation');
    assert.equal(view.evidence()[1].outcome,'read');assert.equal(view.evidence()[1].adoptions,undefined);
    view.cancelCalls[0].resolve();assert.equal(await stopped,true);await view.settle();
    assert.equal(view.cancelCalls.length,1,'The queued old cancellation verifies its original claim and skips a released owner');
    assert.equal(view.reads.length,3,'After the original acknowledgement and obsolete-cancel check, only the replacement activates');assert.equal(view.evidence()[2].outcome,'pending');assert.deepEqual(view.haptics,[]);assert.equal(view.queueSize(),0);
  }finally{await view.close();}
});

test('actual feedback hook deduplicates one attempt/outcome while retaining separate feedback for a new attempt of the same UID',async()=>{
  const view=await mount('scan');try{
    const battery={id:'BAT-001',name:'Controlled battery'},accepted={type:'accepted',message:'Added to review',battery};
    view.beginAcquisition('nfc:uid:0004AB00','attempt-a');view.present(accepted);const first=view.feedbackState();
    view.present(accepted);assert.deepEqual(view.haptics,[12]);assert.equal(view.feedbackState().sequence,first.sequence);assert.equal(view.feedbackState().until,first.until);
    const duplicate={type:'duplicate',message:'Already recorded'};view.present(duplicate);view.present(duplicate);
    assert.deepEqual(view.haptics,[12,12]);assert.equal(view.feedbackState().until,first.until,'Duplicate feedback cannot renew the green success deadline');
    view.beginAcquisition('nfc:uid:0004AB00','attempt-b');assert.equal(view.feedbackState().tone,'');assert.equal(view.feedbackState().expression,'');assert.equal(view.feedbackState().message,'');assert.deepEqual(view.feedbackState().latest,battery);assert.equal(view.feedbackState().lastOutcome.type,'duplicate');
    view.present(accepted);view.present(accepted);assert.deepEqual(view.haptics,[12,12,12]);assert.equal(view.feedback.length,3);assert.equal(view.queueSize(),0);
  }finally{await view.close();}
});

test('actual feedback hook expires a success while hidden and never replays haptics or a green pulse on foreground return',async()=>{
  const view=await mount('scan');try{
    view.beginAcquisition('nfc:uid:0004AB00','attempt-visible');view.present({type:'accepted',message:'Added to review',battery:{id:'BAT-001',name:'Controlled battery'}});
    const original=view.feedbackState();view.setClock(original.until+1);await view.background();
    assert.equal(view.feedbackState().tone,'');assert.equal(view.feedbackState().expression,'');assert.equal(view.feedbackState().sequence,original.sequence);assert.deepEqual(view.haptics,[12]);
    await view.foreground();assert.equal(view.feedbackState().tone,'');assert.equal(view.feedbackState().sequence,original.sequence);assert.deepEqual(view.haptics,[12]);assert.equal(view.feedback.length,1);
  }finally{await view.close();}
});

test('workflow controls keep their reason visible without playing a tag failure; real acquiring errors remain red',async()=>{
  const view=await mount('scan');try{
    await view.action(async()=>{throw Error('Controlled review is blocked');});assert.equal(view.feedbackState().message,'Controlled review is blocked');assert.equal(view.failureTone(),false);assert.deepEqual(view.haptics,[]);
    await view.action(async()=>({type:'failure',message:'Original confirmation needs review'}));assert.equal(view.feedbackState().message,'Original confirmation needs review');assert.equal(view.failureTone(),false);
    await view.action(async()=>{throw Error('Controlled tag is ineligible');},true);assert.equal(view.failureTone(),true);assert.deepEqual(view.haptics,[12]);
  } finally {await view.close();}
});
test('failure provenance never borrows the preceding accepted attempt and an explicit clear creates no acquisition',async()=>{
  const view=await mount('scan');try{
    view.beginAcquisition('nfc:uid:0004AB00','accepted-attempt');view.present({type:'accepted',message:'Added',battery:{id:'BAT-1',name:'Battery'}});
    view.present({type:'failure',message:'New reader failure',stage:'reader',eventId:'current-cycle'});assert.equal(view.feedbackState().acquisitionId,null);assert.equal(view.feedbackState().eventId,'current-cycle');assert.equal(view.feedbackState().stage,'reader');
    view.beginAcquisition('nfc:uid:0004AB00','new-attempt');assert.equal(view.feedbackState().stage,undefined);assert.equal(view.feedbackState().code,'');
    const count=view.feedbackState().sequence,haptics=view.haptics.length;view.clearOutcome();assert.equal(view.feedbackState().sequence,count);assert.equal(view.feedbackState().event,'');assert.equal(view.feedbackState().tone,'');assert.equal(view.feedbackState().acquisitionId,null);assert.equal(view.haptics.length,haptics);
  } finally {await view.close();}
});

for(const settings of [{platform:'ios',code:'TIMEOUT'},{platform:'android',code:'TAG_LOST'}])test(`${settings.platform} ${settings.code}: all actual workflows require deliberate continuation instead of auto-opening a reader`,async()=>{
  for(const kind of Object.keys(sources)){
    const view=await mount(kind,settings);try{
      assert.equal(view.reads.length,1);assert.equal(view.waitTimer(),undefined);assert.equal(view.evidence()[0].error.code,settings.code);assert.equal(view.queueSize(),0);
      const batchEnded=settings.platform==='ios'&&settings.code==='TIMEOUT';
      assert.equal(view.failureTone(),!batchEnded);
      if(batchEnded){
        assert.equal(view.readerSessions[0].getSnapshot().state,'paused');assert.match(view.status(),/Saved tags are retained/);
        view.resume();await view.settle();assert.equal(view.reads.length,2);assert.equal(view.reads[1].keepSessionAlive,true);assert.equal(view.reads[1].sessionId,undefined);
      }
    }finally{await view.close();}
  }
});

for(const code of ['TIMEOUT','CANCELLED','BACKGROUND'])test(`iOS batch ${code}: foreground and enabled-control return retain a visible pause until Continue`,async()=>{
  const view=await mount('intake',{platform:'ios',code});try{
    assert.equal(view.readerState(),'paused');assert.equal(view.reads.length,1);
    await view.background();const frame=view.readerFrames.length;
    await view.foreground();await view.pageshow();await view.deactivate();view.activate();await view.settle();
    assert.equal(view.reads.length,1,'Returning foreground or re-enabling the surface cannot open another system sheet');
    assert.equal(view.readerState(),'paused');assert.equal(view.waitTimer(),undefined);
    assert.ok(view.readerFrames.slice(frame).every(state=>state!=='starting'),'Manual pause cannot flash a preparation state during control re-admission');
    view.resume();await view.settle();
    assert.equal(view.reads.length,2);assert.equal(view.reads[1].keepSessionAlive,true);assert.equal(view.reads[1].sessionId,undefined,'Continue starts an explicitly new physical session');
    await view.background();await view.foreground();assert.equal(view.reads.length,2,'An active batch interrupted by background also needs Continue');assert.equal(view.readerState(),'paused');
    view.resume();await view.settle();assert.equal(view.reads.length,3);assert.equal(view.reads[2].sessionId,undefined);
  }finally{await view.close();}
});

test('iOS batch background keeps late raw evidence without adoption or foreground automatic restart',async()=>{
  const view=await mount('intake',{platform:'ios',cancelSettles:false});try{
    view.resume();await view.settle();assert.equal(view.reads.length,2);
    await view.background();await view.completeRead();await view.foreground();await view.pageshow();
    assert.equal(view.evidence()[1].outcome,'read');assert.equal(view.evidence()[1].result.uidHex,'0004AB00');assert.equal(view.evidence()[1].adoptions,undefined);
    assert.equal(view.queueSize(),0);assert.deepEqual(view.haptics,[]);assert.deepEqual(view.feedback,[]);assert.equal(view.reads.length,2);assert.equal(view.readerState(),'paused');
    view.resume();await view.settle();assert.equal(view.reads.length,3);assert.equal(view.reads[2].sessionId,undefined);
  }finally{await view.close();}
});

for(const [kind,platform]of [['scan','ios'],['removal','ios'],['intake','android']])test(`${platform} ${kind}: foreground return respects each platform activation policy`,async()=>{
  const view=await mount(kind,{platform});try{
    assert.equal(view.reads.length,1);await view.background();await view.foreground();assert.equal(view.reads.length,platform==='ios'?1:2);if(platform==='ios'){view.resume();await view.settle();assert.equal(view.reads.length,2);}
  }finally{await view.close();}
});

test('actual intake Escape closes only its draft editor, then Review close resumes the native reader with the original queued draft',async()=>{
  const view=await mount('intake');try{
    await view.advance();await view.completeRead();assert.equal(view.queueSize(),1);
    await view.review();assert.equal(view.hasReview(),true);
    view.click('Edit nfc:uid:0004AB00');assert.equal(view.hasEditor(),true);
    view.key('Escape');await view.settle();assert.equal(view.hasEditor(),false);assert.equal(view.hasReview(),true);assert.equal(view.queueSize(),1);
    view.click('Close intake review and retain drafts');await view.settle();assert.equal(view.hasReview(),false);assert.equal(view.queueSize(),1);assert.equal(view.reads.length,3);
  }finally{await view.close();}
});
