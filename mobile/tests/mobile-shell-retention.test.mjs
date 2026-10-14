import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import React, { memo } from 'react';
import * as navigation from '../src/app/phone-navigation.mjs';
import * as interaction from '../src/app/phone-interaction.mjs';
import * as entryIntent from '../src/app/phone-entry-intent.mjs';
import {phoneAdmission} from '../src/app/phone-admission.mjs';
import * as detailBoundary from '../src/app/detail-boundary.mjs';
import * as scrolling from '../src/app/phone-scroll.mjs';
import { markPhoneMilestone } from '../src/app/phone-milestones.mjs';
import * as inventoryModel from '../src/features/inventory/inventory-model.mjs';

// Actual Shell, RouteView, React.memo objects and UI context helpers execute.
// Feature bodies stay descriptors; shallow-prop/context evidence does not
// establish actual React DOM bailout duration or native presentation cost.
const sameDeps=(a,b)=>a&&b&&a.length===b.length&&a.every((value,index)=>Object.is(value,b[index]));
const shallow=(a,b)=>Object.keys(a).length===Object.keys(b).length&&Object.keys(a).every(key=>Object.hasOwn(b,key)&&Object.is(a[key],b[key]));
const nodes=(tree,result=[])=>{if(Array.isArray(tree))tree.forEach(child=>nodes(child,result));else if(tree&&typeof tree==='object'){result.push(tree);nodes(tree.props?.children,result);}return result;};
const text=tree=>typeof tree==='string'||typeof tree==='number'?String(tree):Array.isArray(tree)?tree.map(text).join(''):tree&&typeof tree==='object'?text(tree.props?.children):'';
const jsx=(type,props,key)=>typeof type==='function'&&type.name==='RouteView'?type(props):({type,props:props??{},key});
function compile(input,exports,bindings){
  const parsed=ts.createSourceFile('actual.jsx',input,ts.ScriptTarget.Latest,true,ts.ScriptKind.JSX),imports={};
  for(const declaration of parsed.statements.filter(ts.isImportDeclaration)){
    if(declaration.importClause?.name)imports[declaration.importClause.name.text]=declaration.importClause.name.text;
    for(const name of declaration.importClause?.namedBindings?.elements??[])imports[name.name.text]=name.name.text;
  }
  const result=ts.transpileModule(parsed.statements.filter(value=>!ts.isImportDeclaration(value)).map(value=>value.getFullText(parsed)).join('\n'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX},reportDiagnostics:true});
  assert.equal(result.diagnostics.some(value=>value.category===ts.DiagnosticCategory.Error),false);
  const values={...imports,...bindings,_jsx:jsx,_jsxs:jsx,_Fragment:'Fragment'},names=Object.keys(values);
  return new Function(...names,result.outputText.replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'')+`\nreturn {${exports.join(',')}};`)(...names.map(name=>values[name]));
}
const shellSource=await readFile(new URL('../src/app/phone-app.jsx',import.meta.url),'utf8'),contextSource=await readFile(new URL('../src/app/phone-ui.jsx',import.meta.url),'utf8');
function snapshot(actor='STAFF-A',dataset='demo',changes={}){
  return {dataset,user:{id:actor,defaultDataset:dataset,role:'staff',displayName:'Staff'},batteries:[{id:'BAT-42',name:'Recorded battery',version:1,ownerAccountId:actor,loanId:null,lifecycleStatus:'active'}],rooms:[],teachingGroups:[],...changes};
}
function mount(t){
  let current=null;
  const env={data:snapshot(),unread:1,overlays:[],observers:new Set(),calls:[],runners:[]},window=new EventTarget(),documentEvents=new EventTarget();
  window.getComputedStyle=node=>({zIndex:node.zIndex??'auto'});
  const body={dataset:{},classList:{add(){},remove(){}},getAttribute(){return null;},setAttribute(){},removeAttribute(){}},document={body,activeElement:null,visibilityState:'visible',querySelectorAll:()=>env.overlays,addEventListener:documentEvents.addEventListener.bind(documentEvents),removeEventListener:documentEvents.removeEventListener.bind(documentEvents)};
  const main={scrollTop:0,scrollTo({top}){this.scrollTop=top;}},storage={getItem:()=>null,entries:()=>({}),flush:async()=>{}};
  const descriptors=Object.fromEntries(['window','document','MutationObserver','requestAnimationFrame','fetch'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  class Observer{constructor(callback){this.callback=callback;}observe(){env.observers.add(this.callback);}disconnect(){env.observers.delete(this.callback);}}
  for(const [key,value]of Object.entries({window,document,MutationObserver:Observer,requestAnimationFrame:()=>{},fetch:()=>assert.fail('Presentation retention must not make a business request.')}))Object.defineProperty(globalThis,key,{configurable:true,value});
  const effect=(run,deps)=>{const runner=current,index=runner.cursor++,old=runner.cells[index];if(!old||!sameDeps(old.deps,deps))runner.effects.push(()=>{old?.cleanup?.();runner.cells[index]={deps,cleanup:run()};});};
  const hooks={React,memo,
    createContext(initial){return {value:initial,Provider:'ActualPhoneContext.Provider'};},useContext:context=>context.value,
    useState(initial){const runner=current,index=runner.cursor++;if(!(index in runner.cells)){const cell={value:typeof initial==='function'?initial():initial};cell.set=update=>{const next=typeof update==='function'?update(cell.value):update;if(!Object.is(next,cell.value)){cell.value=next;runner.dirty=true;}};runner.cells[index]=cell;}return [runner.cells[index].value,runner.cells[index].set];},
    useRef(initial){const runner=current;return runner.cells[runner.cursor++]??={current:initial};},
    useMemo(calculate,deps){const runner=current,index=runner.cursor++;if(!runner.cells[index]||!sameDeps(runner.cells[index].deps,deps))runner.cells[index]={deps,value:calculate()};return runner.cells[index].value;},
    useCallback(callback,deps){return hooks.useMemo(()=>callback,deps);},useEffect:effect,useLayoutEffect:effect,
    useSyncExternalStore(subscribe,getSnapshot){const runner=current,index=runner.cursor++,old=runner.cells[index];if(!old||old.subscribe!==subscribe){old?.cleanup?.();runner.cells[index]={subscribe,cleanup:subscribe(()=>runner.dirty=true)};}return getSnapshot();},
  };
  function runner(Component,props){
    const instance={Component,props,cells:[],cursor:0,effects:[],dirty:true,output:null,
      render(){for(let count=0;count<15;count++){instance.cursor=0;instance.effects=[];instance.dirty=false;current=instance;try{instance.output=Component(instance.props);}finally{current=null;}if(instance===shellRunner)nodes(instance.output).find(node=>node.type==='main').props.ref.current=main;instance.effects.forEach(run=>run());if(!instance.dirty)return instance.output;}assert.fail('Actual component did not settle.');},
      update(props){instance.props={...instance.props,...props};return instance.render();},dispose(){instance.cells.forEach(cell=>cell?.cleanup?.());},
    };env.runners.push(instance);return instance;
  }
  const ui=compile(contextSource,['PhoneUIProvider','PhoneUIBoundary','PhoneContext'],{...hooks,...interaction,...scrolling});
  const load=async()=>{},refresh=()=>{},changeDataset=dataset=>{env.data={...env.data,dataset,user:{...env.data.user,defaultDataset:dataset}};},acceptUnreadCount=()=>{};
  const features={ScanHome:function ScanHome(){},WorkspaceScreen:function WorkspaceScreen(){},MeScreen:function MeScreen(){}};
  const actual=compile(shellSource,['MobileShell','MemoScanHome','MemoArrivalInventoryView','MemoWorkspaceScreen','MemoMeScreen'],{...hooks,...navigation,...interaction,...entryIntent,...scrolling,...detailBoundary,...inventoryModel,...ui,...features,markPhoneMilestone,
    registerPlugin:()=>({}),native:false,MOBILE_BUILD:'controlled',businessStorage:()=>storage,accountHasDeviceWork:()=>false,discoverMobileRecovery:()=>null,discoverMobileDrafts:()=>[],phoneAdmission,
    clearEmptyDeviceWork:async()=>{env.calls.push('recovery-check');},
    useInventoryData:()=>({data:env.data,user:env.data.user,dataset:env.data.dataset,loading:false,error:'',revision:0,load,refresh,changeDataset,acceptReviewedInventory(){},setError(){}}),
    useInventoryPolling(){},useMessageCount:()=>({unreadCount:env.unread,acceptUnreadCount}),usePhoneViewport:()=>({keyboardOpen:false,systemReduced:false}),usePhoneArrivals:()=>({arrivals:undefined,acknowledge:undefined,pending:false,error:''}),
  });
  let shellRunner=runner(actual.MobileShell,{initialUser:env.data.user,origin:'controlled',storageError:'',saving:false}),providerRunner=null;
  const boundaries=new Map();
  function render(){
    shellRunner.render();const providerElement=shellRunner.output;
    if(!providerRunner)providerRunner=runner(ui.PhoneUIProvider,providerElement.props);providerRunner.update(providerElement.props);ui.PhoneContext.value=providerRunner.output.props.value;
    for(const element of nodes(shellRunner.output).filter(node=>node.type===ui.PhoneUIBoundary)){
      if(!boundaries.has(element.key))boundaries.set(element.key,runner(ui.PhoneUIBoundary,element.props));boundaries.get(element.key).update(element.props);
    }
    return shellRunner.output;
  }
  const view={env,render,main,actual,
    isDirty:()=>shellRunner.dirty,
    root(name,active){return nodes(shellRunner.output).find(node=>node.type?.$$typeof===Symbol.for('react.memo')&&node.type.type?.name===name&&(active===undefined||node.props.active===active));},
    context(name,active){const root=view.root(name,active);assert.ok(root);const boundary=nodes(shellRunner.output).find(node=>node.type===ui.PhoneUIBoundary&&nodes(node).includes(root));return boundaries.get(boundary.key).output.props.value;},
    workflow(){return nodes(shellRunner.output).find(node=>node.type==='ScanWorkflow');},
    nav(label){const nav=nodes(shellRunner.output).find(node=>node.type==='nav'),button=nodes(nav).find(node=>node.type==='Pressable'&&text(node).trim()===label);assert.equal(button.props.disabled,false);button.props.onClick();render();},
    boundary(locked){const event=new Event('battery-mobile-workflow-active');Object.defineProperty(event,'detail',{value:locked});window.dispatchEvent(event);render();},
    overlay(open){env.overlays=open?[{tagName:'SECTION',parentElement:null,zIndex:'900',classList:{contains:()=>false},getAttribute:()=>null,closest:()=>null,hasAttribute:()=>false,getClientRects:()=>[{}]}]:[];env.observers.forEach(callback=>callback());render();},
    providerContext:()=>providerRunner.output.props.value,
    route:()=>nodes(shellRunner.output).find(node=>node.props.className==='phone-route'&&!node.props.hidden)?.props['data-route'],
    source(type){return nodes(shellRunner.output).find(node=>node.type===type&&node.props.active!==false);},
  };
  t.after(()=>{env.runners.forEach(instance=>instance.dispose());for(const [key,descriptor]of Object.entries(descriptors))if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];});
  render();return view;
}

test('ordinary roots use actual default React.memo objects and inactive props/context remain shallow-equal across entry and locks',async t=>{
  const view=mount(t),names=['ScanHome','ArrivalInventoryView','WorkspaceScreen','MeScreen'],before=new Map(names.map(name=>[name,view.root(name)])),contexts=new Map(names.map(name=>[name,view.context(name)])),provider=view.providerContext();
  for(const name of names){const root=before.get(name);assert.ok(root);assert.equal(root.type.$$typeof,Symbol.for('react.memo'));assert.equal(root.type.compare,null);}
  await before.get('ScanHome').props.onOperation('checkout',['BAT-42']);view.render();assert.ok(view.workflow());
  const paused=view.root('ScanHome');assert.equal(paused.props.active,false);assert.equal(shallow(before.get('ScanHome').props,paused.props),false);assert.equal(view.context('ScanHome').active,false);assert.notEqual(view.context('ScanHome'),contexts.get('ScanHome'));
  for(const name of names.slice(1)){assert.equal(view.root(name).type,before.get(name).type);assert.equal(shallow(view.root(name).props,before.get(name).props),true);assert.equal(view.context(name),contexts.get(name));}
  view.boundary(true);view.overlay(true);view.overlay(false);view.boundary(false);
  for(const name of names.slice(1)){assert.equal(shallow(view.root(name).props,before.get(name).props),true);assert.equal(view.context(name),contexts.get(name));}
  assert.equal(view.providerContext(),provider);view.workflow().props.onExit();view.render();assert.equal(view.root('ScanHome').props.active,true);assert.equal(shallow(paused.props,view.root('ScanHome').props),false);assert.equal(view.context('ScanHome').active,true);assert.equal(view.root('ScanHome').type,before.get('ScanHome').type);
});

test('reactivation passes current snapshot, unread count, scope and stable root handlers instead of freezing old authority',t=>{
  const view=mount(t);view.nav('Inventory');const inventory=view.root('ArrivalInventoryView',true),oldData=inventory.props.data;
  view.nav('Workspace');assert.equal(view.root('ArrivalInventoryView').props.active,false);
  view.env.data={...oldData,batteries:[{...oldData.batteries[0],version:2,name:'Refreshed battery'}]};view.env.unread=7;view.render();
  assert.equal(view.root('ArrivalInventoryView').props.data,view.env.data);assert.equal(view.root('MeScreen').props.unreadCount,7);assert.equal(view.root('ArrivalInventoryView').props.onOperation,inventory.props.onOperation);assert.equal(view.root('ArrivalInventoryView').props.onDetail,inventory.props.onDetail);
  view.nav('Inventory');assert.equal(view.root('ArrivalInventoryView',true).props.data.batteries[0].version,2);assert.equal(shallow(inventory.props,view.root('ArrivalInventoryView',true).props),false);
  view.nav('Me');view.root('MeScreen',true).props.onPersonal('owner');view.render();const scoped=view.root('ArrivalInventoryView',true);assert.deepEqual(scoped.props.scope,{kind:'owner',id:'STAFF-A',label:'Under my responsibility'});assert.equal(scoped.props.onOperation,inventory.props.onOperation);
  view.nav('Workspace');view.nav('Inventory');assert.equal(view.root('ArrivalInventoryView',true).props.scope,scoped.props.scope);
});

test('the same-namespace root forwarder uses latest group authority but an old namespace cannot enter the new actor inventory',async t=>{
  const view=mount(t),original=view.root('ScanHome').props.onOperation;
  const group={id:'GROUP-A',version:2,ownerAccountId:'STAFF-A',state:'active',batteryIds:['BAT-42']};view.env.data={...view.env.data,teachingGroups:[group]};view.render();assert.equal(view.root('ScanHome').props.onOperation,original);
  await original('checkout',['BAT-42'],{id:'GROUP-A',version:2});view.render();const teaching=view.source('TeachingCheckoutDialog');assert.ok(teaching);assert.equal(teaching.props.draft.group,group);teaching.props.onClose(view.env.data);view.render();
  view.env.data=snapshot('STAFF-B','live');view.env.data.batteries[0]={...view.env.data.batteries[0],loanId:'reviewed-loan-b',borrowerAccountId:'STAFF-B'};view.render();const latest=view.root('ScanHome',true).props.onOperation;assert.notEqual(latest,original);const before=view.env.calls.length;
  await original('return',['BAT-42']);view.render();assert.equal(view.env.calls.length,before);assert.equal(view.workflow(),undefined);
  view.nav('Me');assert.equal(view.root('MeScreen',true).props.user.id,'STAFF-B');assert.equal(view.root('MeScreen').props.dataset,'live');view.root('MeScreen',true).props.onPersonal('holder');view.render();assert.equal(view.root('ArrivalInventoryView',true).props.scope.id,'STAFF-B');
  await latest('return',['BAT-42']);view.render();assert.ok(view.workflow());assert.equal(view.workflow().props.dataset,'live');assert.equal(view.workflow().props.user.id,'STAFF-B');assert.equal(view.env.calls.length,before+1);
});

test('an unseen owner false is a state no-op while one owner release cannot unlock another protected route',t=>{
  const view=mount(t);view.nav('Workspace');view.root('WorkspaceScreen',true).props.onOpen('task-plans');view.render();const tasks=view.source('WorkspacePage');assert.ok(tasks);
  assert.equal(view.isDirty(),false);tasks.props.onLockedChange(false);assert.equal(view.isDirty(),false);
  view.nav('Me');view.root('MeScreen',true).props.onOpen('messages');view.render();const messages=view.source('WorkspacePage');assert.equal(messages.props.view,'messages');messages.props.onLockedChange(false);assert.equal(view.isDirty(),false);
  const navigationButtons=()=>nodes(view.render()).filter(node=>node.type==='Pressable'&&['Scan','Inventory','Workspace','Me'].includes(text(node).trim()));
  tasks.props.onLockedChange(true);assert.equal(view.isDirty(),true);view.render();messages.props.onLockedChange(true);view.render();
  tasks.props.onLockedChange(false);assert.equal(view.isDirty(),true);view.render();assert.equal(navigationButtons().length,4);assert.ok(navigationButtons().every(node=>node.props.disabled));
  tasks.props.onLockedChange(false);assert.equal(view.isDirty(),false);assert.ok(navigationButtons().every(node=>node.props.disabled));
  messages.props.onLockedChange(false);assert.equal(view.isDirty(),true);view.render();assert.ok(navigationButtons().every(node=>!node.props.disabled));
});
