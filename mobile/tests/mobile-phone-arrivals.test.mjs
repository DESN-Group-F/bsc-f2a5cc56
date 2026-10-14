import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { memo } from 'react';
import { createPhoneArrivalStore } from '../src/app/phone-arrivals.mjs';
import { advanceArrivalClock, NEW_ARRIVAL_WINDOW_MS } from '../src/shared/lib/new-arrivals.js';
import { inventoryResponse } from '../src/shared/lib/client/inventory-request.js';
import * as navigation from '../src/app/phone-navigation.mjs';
import * as interaction from '../src/app/phone-interaction.mjs';
import * as scrolling from '../src/app/phone-scroll.mjs';
import { markPhoneMilestone } from '../src/app/phone-milestones.mjs';
import {phoneAdmission} from '../src/app/phone-admission.mjs';

// Actual provider, shared hook, store and shell consumer functions run against
// controlled hooks/timers/transport. Feature JSX is retained as descriptors;
// this does not measure React DOM presentation or native device CPU.
const jsx=(type,props,key)=>({type,props:props??{},key});
const nodes=(tree,result=[])=>{if(Array.isArray(tree))tree.forEach(child=>nodes(child,result));else if(tree&&typeof tree==='object'){result.push(tree);nodes(tree.props?.children,result);}return result;};
const sameDeps=(a,b)=>a&&b&&a.length===b.length&&a.every((value,index)=>Object.is(value,b[index]));
const source=async file=>readFile(new URL(file,import.meta.url),'utf8');
function compile(input,exports,bindings){
  const parsed=ts.createSourceFile('actual.jsx',input,ts.ScriptTarget.Latest,true,ts.ScriptKind.JSX),imports={};
  for(const statement of parsed.statements.filter(ts.isImportDeclaration)){
    if(statement.importClause?.name)imports[statement.importClause.name.text]=statement.importClause.name.text;
    for(const item of statement.importClause?.namedBindings?.elements??[])imports[item.name.text]=item.name.text;
  }
  const code=ts.transpileModule(parsed.statements.filter(value=>!ts.isImportDeclaration(value)).map(value=>value.getFullText(parsed)).join('\n'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX},reportDiagnostics:true});
  assert.equal(code.diagnostics.some(value=>value.category===ts.DiagnosticCategory.Error),false);
  const values={...imports,...bindings,_jsx:jsx,_jsxs:jsx,_Fragment:'Fragment'},names=Object.keys(values);
  return new Function(...names,code.outputText.replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'')+`\nreturn {${exports.join(',')}};`)(...names.map(name=>values[name]));
}
const sharedSource=await source('../src/shared/hooks/use-new-arrivals.js'),providerSource=await source('../src/app/phone-arrivals.jsx'),shellSource=await source('../src/app/phone-app.jsx');
const BASE=Date.UTC(2026,9,13),stamp=milliseconds=>new Date(milliseconds).toISOString();
function snapshot({actor='STAFF-A',dataset='demo',serverNow=BASE,items=[{batteryId:'BAT-1',registeredAt:stamp(BASE-NEW_ARRIVAL_WINDOW_MS+2000),isUnread:true}],throughSequence=17}={}){
  return {dataset,user:{id:actor,role:'staff',displayName:'Staff'},batteries:[],rooms:[],teachingGroups:[],newArrivals:{serverNow:stamp(serverNow),items,throughSequence,unreadCount:items.filter(item=>item.isUnread).length}};
}
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const reply=(data,cursor)=>({ok:true,status:200,json:async()=>({ok:true,result:{dataset:data.dataset,actorAccountId:data.user.id,acknowledgedThroughSequence:cursor}})});

function environment(t){
  let current=null;
  const env={now:10000,intervals:new Map(),requests:[],loads:[],runners:[],nextTimer:0,data:snapshot()},events=new EventTarget();
  const descriptors=Object.fromEntries(['window','document','performance','fetch','MutationObserver','requestAnimationFrame'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  const body={dataset:{},classList:{add(){},remove(){}},removeAttribute(){},getAttribute(){return null;},setAttribute(){}},documentEvents=new EventTarget();
  const document={body,visibilityState:'visible',activeElement:null,querySelectorAll:()=>[],addEventListener:documentEvents.addEventListener.bind(documentEvents),removeEventListener:documentEvents.removeEventListener.bind(documentEvents)};
  const window={setInterval(callback,delay){const id=++env.nextTimer;env.intervals.set(id,{callback,delay,owner:current});return id;},clearInterval(id){env.intervals.delete(id);},addEventListener:events.addEventListener.bind(events),removeEventListener:events.removeEventListener.bind(events)};
  class Observer{observe(){}disconnect(){}}
  const fetch=(_url,options)=>{const request={...deferred(),options,payload:JSON.parse(options.body)};env.requests.push(request);return request.promise;};
  for(const [key,value]of Object.entries({window,document,performance:{now:()=>env.now},fetch,MutationObserver:Observer,requestAnimationFrame:()=>{}}))Object.defineProperty(globalThis,key,{configurable:true,value});
  const effect=(callback,deps)=>{const runner=current,index=runner.cursor++,old=runner.cells[index];if(!old||!sameDeps(old.deps,deps))runner.effects.push(()=>{old?.cleanup?.();runner.cells[index]={deps,cleanup:callback()};});};
  const hooks={
    createContext(initial){return {value:initial,Provider:'ActualArrivalContext.Provider'};},
    useContext(context){return context.value;},
    useState(initial){const runner=current,index=runner.cursor++;if(!(index in runner.cells))runner.cells[index]={value:typeof initial==='function'?initial():initial};return [runner.cells[index].value,update=>{const next=typeof update==='function'?update(runner.cells[index].value):update;if(!Object.is(next,runner.cells[index].value)){runner.cells[index].value=next;runner.dirty=true;if(runner.disposed)runner.late++;}}];},
    useRef(initial){const runner=current;return runner.cells[runner.cursor++]??={current:initial};},
    useMemo(calculate,deps){const runner=current,index=runner.cursor++;if(!runner.cells[index]||!sameDeps(runner.cells[index].deps,deps))runner.cells[index]={deps,value:calculate()};return runner.cells[index].value;},
    useCallback(callback,deps){return hooks.useMemo(()=>callback,deps);},
    useEffect:effect,useLayoutEffect:effect,
    useSyncExternalStore(subscribe,getSnapshot){
      const runner=current,index=runner.cursor++;let cell=runner.cells[index];
      if(!cell||cell.subscribe!==subscribe){cell?.cleanup?.();cell={subscribe,getSnapshot,value:getSnapshot()};runner.cells[index]=cell;cell.cleanup=subscribe(()=>{runner.notifications++;const next=cell.getSnapshot();if(!Object.is(next,cell.value)){cell.value=next;runner.dirty=true;if(runner.disposed)runner.late++;}});}
      cell.getSnapshot=getSnapshot;cell.value=getSnapshot();return cell.value;
    },
  };
  function runner(Component,props,name){
    const instance={Component,props,name,cells:[],effects:[],cursor:0,dirty:true,disposed:false,late:0,renders:0,notifications:0,output:null,
      render(){assert.equal(instance.disposed,false);for(let attempt=0;attempt<15;attempt++){instance.dirty=false;instance.cursor=0;instance.effects=[];current=instance;try{instance.output=Component(instance.props);instance.renders++;}finally{current=null;}if(instance.dirty)continue;instance.effects.forEach(run=>run());return instance.output;}assert.fail('Controlled hooks did not settle.');},
      update(props){instance.props={...instance.props,...props};instance.dirty=true;return instance.render();},
      dispose(){if(instance.disposed)return;instance.disposed=true;instance.cells.forEach(cell=>cell?.cleanup?.());},
    };env.runners.push(instance);instance.render();return instance;
  }
  const shared=compile(sharedSource,['useNewArrivals'],{...hooks,advanceArrivalClock,inventoryResponse});
  const actual=compile(providerSource,['PhoneArrivalsProvider','usePhoneArrivals','ArrivalContext'],{...hooks,...shared,createPhoneArrivalStore});
  const load=async(dataset,signal)=>{env.loads.push({dataset,signal});};
  function provider(data=env.data,children={type:'Retained children'},namespace=`${data.user.id}:${data.dataset}`){
    const instance=runner(actual.PhoneArrivalsProvider,{data,load,children,namespace},'Provider');
    const render=instance.render;instance.render=()=>{const output=render();actual.ArrivalContext.value=output.props.value;return output;};actual.ArrivalContext.value=instance.output.props.value;return instance;
  }
  function consumer(active=true){return runner(({active})=>({value:actual.usePhoneArrivals(active),marker:hooks.useRef({})}),{active},'Consumer');}
  env.flush=()=>{for(let attempt=0;attempt<20;attempt++){let count=0;for(const instance of env.runners)if(instance.dirty&&!instance.disposed){instance.render();count++;}if(!count)return;}assert.fail('Controlled provider did not settle.');};
  env.tick=time=>{env.now=time;for(const timer of [...env.intervals.values()])timer.callback();env.flush();};
  env.hooks=hooks;env.runner=runner;env.provider=provider;env.consumer=consumer;env.actual=actual;env.load=load;
  t.after(()=>{env.runners.forEach(instance=>instance.dispose());for(const [key,descriptor]of Object.entries(descriptors))if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];});
  return env;
}

test('actual store publishes changed snapshots, isolates realms, and unsubscribe is authoritative',()=>{
  const first={arrivals:{unreadCount:1}},a=createPhoneArrivalStore(first),b=createPhoneArrivalStore(first);let calls=0,foreign=0;
  const off=a.subscribe(()=>calls++);b.subscribe(()=>foreign++);a.publish(first);assert.equal(calls,0);
  const second={arrivals:{unreadCount:0}};a.publish(second);assert.equal(calls,1);assert.equal(foreign,0);assert.equal(a.getSnapshot(),second);assert.equal(b.getSnapshot(),first);
  off();a.publish(first);assert.equal(calls,1);
});

test('actual provider clock retains context and child identity while inactive consumers resume latest without remount',t=>{
  const env=environment(t),children=[{type:'Scanner',key:'scan'},{type:'Inactive route',key:'me'}],provider=env.provider(env.data,children),store=provider.output.props.value,active=env.consumer(),inactive=env.consumer(false),marker=inactive.output.marker;
  const retained=inactive.output.value,notifications=inactive.notifications,renders=inactive.renders;
  assert.equal(env.intervals.size,1);assert.equal([...env.intervals.values()][0].delay,1000);assert.equal([...env.intervals.values()][0].owner,provider);
  env.tick(12000);assert.equal(provider.output.props.value,store);assert.equal(provider.output.props.children,children);assert.equal(active.output.value.arrivals.unreadCount,0);
  assert.equal(inactive.output.value,retained);assert.equal(inactive.notifications,notifications);assert.equal(inactive.renders,renders);
  inactive.update({active:true});assert.equal(inactive.output.marker,marker);assert.equal(inactive.output.value,store.getSnapshot());assert.equal(inactive.output.value.arrivals.unreadCount,0);
});

test('actual 48-hour expiry and fresh snapshot anchoring use monotonic elapsed time',t=>{
  const env=environment(t),provider=env.provider(),consumer=env.consumer();
  env.tick(11999);assert.equal(consumer.output.value.arrivals.items.length,1);assert.equal(consumer.output.value.arrivals.serverNow,stamp(BASE+1000));
  env.tick(12000);assert.equal(consumer.output.value.arrivals.items.length,0);assert.equal(consumer.output.value.arrivals.serverNow,stamp(BASE+2000));
  const fresh=snapshot({serverNow:BASE+30000,items:[{batteryId:'BAT-fresh',registeredAt:stamp(BASE+30000-NEW_ARRIVAL_WINDOW_MS+1000),isUnread:true}]});
  env.now=20000;provider.update({data:fresh});env.flush();assert.equal(consumer.output.value.arrivals.serverNow,stamp(BASE+30000));assert.equal(consumer.output.value.arrivals.items[0].batteryId,'BAT-fresh');
  env.tick(21000);assert.equal(consumer.output.value.arrivals.items.length,0);assert.equal(consumer.output.value.arrivals.serverNow,stamp(BASE+31000));
});

test('actual shell has no arrival clock subscription while its inventory and badge consumers update',t=>{
  const env=environment(t),storage={getItem:()=>null},bindings={...env.hooks,...navigation,...interaction,...scrolling,...env.actual,memo,markPhoneMilestone,
    registerPlugin:()=>({}),businessStorage:()=>storage,native:false,MOBILE_BUILD:'controlled',discoverMobileRecovery:()=>null,discoverMobileDrafts:()=>[],phoneAdmission,
    useInventoryData:()=>({data:env.data,user:env.data.user,dataset:'demo',loading:false,error:'',revision:0,load:env.load,refresh(){},setError(){}}),
    useMessageCount:()=>({unreadCount:0,acceptUnreadCount(){}}),useInventoryPolling(){},usePhoneViewport:()=>({keyboardOpen:false,systemReduced:false}),
  };
  const shell=compile(shellSource,['MobileShell','ArrivalInventoryView','ArrivalNavigationIndicator'],bindings);
  const parent=env.runner(shell.MobileShell,{initialUser:env.data.user},'Actual MobileShell');env.flush();
  const element=nodes(parent.output).find(node=>node.type===env.actual.PhoneArrivalsProvider);assert.ok(element);assert.equal(env.intervals.size,0);
  const provider=env.provider(element.props.data,element.props.children,element.props.namespace),inventory=env.runner(shell.ArrivalInventoryView,{active:true,scope:{kind:'owner',id:'STAFF-A'}},'Actual inventory consumer'),badge=env.runner(shell.ArrivalNavigationIndicator,{active:true},'Actual badge consumer'),inactive=env.runner(shell.ArrivalInventoryView,{active:false},'Inactive inventory route');
  const children=provider.output.props.children,renderCount=parent.renders,inactiveCount=inactive.renders;
  assert.equal(badge.output.props['aria-label'],'1 unread new arrivals');assert.equal(inventory.output.props.arrivals.unreadCount,1);assert.equal(env.intervals.size,1);
  env.tick(12000);assert.equal(parent.renders,renderCount);assert.equal(provider.output.props.children,children);assert.equal(inactive.renders,inactiveCount);assert.equal(badge.output,null);assert.equal(inventory.output.props.arrivals.unreadCount,0);
  assert.equal(inventory.output.props.scope.kind,'owner');assert.equal([...env.intervals.values()][0].owner,provider);
});

test('clock publications retain pending/error and an original acknowledgement retries its captured cursor',async t=>{
  const env=environment(t),provider=env.provider(),consumer=env.consumer(),original=consumer.output.value.acknowledge;
  const first=original(17);env.flush();assert.equal(consumer.output.value.pending,true);env.tick(11000);assert.equal(consumer.output.value.pending,true);await original(99);assert.equal(env.requests.length,1);
  env.requests[0].reject(new Error('Controlled reply dropped'));await first;env.flush();const error=consumer.output.value.error;assert.match(error,/Controlled reply dropped/);assert.equal(consumer.output.value.pending,false);
  env.tick(12000);assert.equal(consumer.output.value.error,error);const retry=original(99);env.flush();assert.equal(env.requests.length,2);assert.deepEqual(env.requests[0].payload,env.requests[1].payload);assert.equal(env.requests[1].payload.payload.throughSequence,17);
  env.requests[1].resolve(reply(env.data,17));await retry;env.flush();assert.equal(consumer.output.value.error,'');assert.equal(consumer.output.value.pending,false);assert.equal(env.loads.length,1);assert.equal(env.loads[0].dataset,'demo');assert.equal(provider.output.props.value.getSnapshot().acknowledge,consumer.output.value.acknowledge);
});

test('context replacement aborts the original request and cannot broadcast across account or inventory realms',async t=>{
  for(const change of [{actor:'STAFF-B'},{dataset:'live'}])await t.test(Object.keys(change)[0],async child=>{
    const env=environment(child),provider=env.provider(),consumer=env.consumer(),oldStore=provider.output.props.value,oldCallback=consumer.output.value.acknowledge;let oldCalls=0;const off=oldStore.subscribe(()=>oldCalls++);
    const pending=oldCallback(17);env.flush();const request=env.requests[0],before=oldCalls,next=snapshot({...change,items:[],throughSequence:30});
    provider.update({namespace:`${next.user.id}:${next.dataset}`,data:next});const newStore=provider.output.props.value;assert.notEqual(newStore,oldStore);consumer.render();assert.equal(consumer.output.value.arrivals.unreadCount,0);assert.equal(consumer.output.value.pending,false);assert.equal(consumer.output.value.error,'');assert.equal(request.options.signal.aborted,true);assert.equal(oldCalls,before);
    await oldCallback(99);assert.equal(env.requests.length,1);request.resolve(reply(env.data,17));await pending;env.flush();assert.equal(env.loads.length,0);assert.equal(consumer.output.value,newStore.getSnapshot());
    const notifications=consumer.notifications;oldStore.publish({arrivals:{unreadCount:999}});assert.equal(consumer.notifications,notifications);env.tick(12000);assert.equal(oldCalls,before+1);assert.equal(consumer.output.value.arrivals.unreadCount,0);off();
  });
});

test('a changed namespace exposes no old projection or acknowledgement until its matching snapshot arrives',async t=>{
  for(const change of [{actor:'STAFF-B'},{dataset:'live'}])await t.test(Object.keys(change)[0],child=>{
    const env=environment(child),provider=env.provider(),consumer=env.consumer(),next=snapshot({...change,throughSequence:31});
    const namespace=`${next.user.id}:${next.dataset}`;provider.update({namespace});consumer.render();const store=provider.output.props.value;
    assert.equal(consumer.output.value.arrivals,undefined);assert.equal(consumer.output.value.acknowledge,undefined);assert.equal(consumer.output.value.pending,false);assert.equal(consumer.output.value.error,'');
    const notifications=consumer.notifications;env.tick(11000);assert.equal(provider.output.props.value,store);assert.equal(consumer.notifications,notifications);assert.equal(consumer.output.value.acknowledge,undefined);
    provider.update({data:null});env.flush();assert.equal(consumer.output.value.arrivals,undefined);assert.equal(consumer.output.value.acknowledge,undefined);
    provider.update({data:next});env.flush();assert.equal(provider.output.props.value,store);assert.equal(consumer.output.value.arrivals.throughSequence,31);assert.equal(typeof consumer.output.value.acknowledge,'function');assert.equal(env.requests.length,0);
  });
});

test('provider and consumer lifecycle cleanup removes clock and store subscriptions',t=>{
  const env=environment(t),provider=env.provider(),consumer=env.consumer(),store=provider.output.props.value;
  assert.equal(env.intervals.size,1);provider.dispose();assert.equal(env.intervals.size,0);consumer.dispose();const notifications=consumer.notifications;
  store.publish({arrivals:{unreadCount:4}});env.tick(25000);assert.equal(consumer.notifications,notifications);assert.equal(consumer.late,0);assert.equal(provider.late,0);
});
