import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import postcss from 'postcss';
import { inventoryResponse } from '../src/shared/lib/client/inventory-request.js';
import { inventoryRevisionKey } from '../src/shared/lib/new-arrivals.js';

const same=(a,b)=>a&&b&&a.length===b.length&&a.every((value,index)=>Object.is(value,b[index]));
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function hooks(){
  const cells=[];let index=0,effects=[];
  const api={
    reset(){index=0;effects=[];},
    useState(initial){const key=index++;if(!cells[key]){const cell=cells[key]={value:typeof initial==='function'?initial():initial};cell.set=next=>{cell.value=typeof next==='function'?next(cell.value):next;};}return[cells[key].value,cells[key].set];},
    useRef(initial){return cells[index++]??={current:initial};},
    useCallback(callback,deps){const key=index++;if(!cells[key]||!same(cells[key].deps,deps))cells[key]={deps,value:callback};return cells[key].value;},
    useEffect(callback,deps){const key=index++,previous=cells[key];if(!previous||!same(previous.deps,deps))effects.push(()=>{previous?.cleanup?.();cells[key]={deps,cleanup:callback()};});},
    commit(){effects.forEach(run=>run());},dispose(){cells.forEach(cell=>cell?.cleanup?.());},
  };return api;
}
const hookSource=await readFile(new URL('../src/shared/hooks/use-inventory-data.js',import.meta.url),'utf8');
function actualHooks(state){return new Function('useState','useRef','useCallback','useEffect','inventoryResponse','inventoryRevisionKey',hookSource.replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'')+'\nreturn {useInventoryData,useInventoryPolling};')(state.useState,state.useRef,state.useCallback,state.useEffect,inventoryResponse,inventoryRevisionKey);}

test('actual initial, manual, focus and periodic inventory reads preserve loaded data and never restart the session path',async t=>{
  const requests=[],intervals=new Map(),window=new EventTarget(),document={visibilityState:'visible'};
  const saved=Object.fromEntries(['window','document','fetch','setInterval','clearInterval'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));let serial=0;
  const fetch=async(path,init)=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});init?.signal?.addEventListener('abort',()=>reject(new DOMException('Cancelled','AbortError')),{once:true});requests.push({path,resolve:snapshot=>resolve(new Response(JSON.stringify(snapshot))),reject});return promise;};
  for(const[key,value]of Object.entries({window,document,fetch,setInterval:callback=>{const id=++serial;intervals.set(id,callback);return id;},clearInterval:id=>intervals.delete(id)}))Object.defineProperty(globalThis,key,{configurable:true,value});
  const state=hooks(),actual=actualHooks(state),user={id:'fixture-staff',defaultDataset:'live'},snapshot={dataset:'live',user,batteries:[{id:'BAT-42',version:1,loanId:null}],teachingGroups:[]};let data;
  const render=()=>{state.reset();data=actual.useInventoryData(user);state.commit();return data;};
  const pollState=hooks(),poll=actualHooks(pollState);let paused=false;
  const renderPoll=()=>{pollState.reset();poll.useInventoryPolling({paused,dataset:data.dataset,load:data.load,onError:data.setError});pollState.commit();};
  t.after(()=>{pollState.dispose();state.dispose();for(const[key,descriptor]of Object.entries(saved))if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];});
  render();await tick();assert.equal(requests.length,1);requests[0].resolve(snapshot);await tick();render();assert.equal(data.loading,false);assert.deepEqual(data.data,snapshot);const loaded=data.data;
  const refresh=data.refresh();render();assert.equal(data.loading,true);assert.equal(data.data,loaded);assert.equal(data.user.id,user.id);requests[1].resolve(snapshot);await refresh;render();assert.equal(data.data,loaded);assert.equal(data.loading,false);
  renderPoll();window.dispatchEvent(new Event('focus'));assert.equal(requests.length,3);render();assert.equal(data.data,loaded);window.dispatchEvent(new Event('focus'));assert.equal(requests.length,3,'A focus read already in flight is not duplicated');requests[2].reject(new TypeError('Failed to fetch'));await tick();render();assert.equal(data.data,loaded);assert.equal(data.error,'Failed to fetch');
  const periodic=[...intervals.values()][0]();assert.equal(requests.length,4);render();assert.equal(data.data,loaded);requests[3].resolve({...snapshot,batteries:[{...snapshot.batteries[0],version:2}]});await periodic;render();assert.equal(data.data.batteries[0].version,2);assert.equal(data.error,'');assert.equal(data.user.id,user.id);
  paused=true;renderPoll();window.dispatchEvent(new Event('focus'));await [...intervals.values()][0]();assert.equal(requests.length,4);assert.ok(requests.every(request=>request.path==='/api/inventory?dataset=live'),'Retained reads do not fetch session or call service configuration');
});

const jsx=(type,props)=>({type,props:props??{}}),all=(tree,result=[])=>{if(Array.isArray(tree))tree.forEach(child=>all(child,result));else if(tree&&typeof tree==='object'){result.push(tree);all(tree.props?.children,result);}return result;};
const text=tree=>typeof tree==='string'?tree:Array.isArray(tree)?tree.map(text).join(''):tree&&typeof tree==='object'?text(tree.props?.children):'';
test('retained resource feedback keeps its status and empty-content slots through ready, refresh, failure and retry',async()=>{
  const source=await readFile(new URL('../src/features/workspace/phone-controls.jsx',import.meta.url),'utf8');
  const parsed=ts.createSourceFile('controls.jsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JSX);
  const code=ts.transpileModule(parsed.statements.filter(item=>!ts.isImportDeclaration(item)).map(item=>item.getFullText(parsed)).join('\n'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText.replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'');
  const State=new Function('Pressable','_jsx','_jsxs','_Fragment',code+'\nreturn PhoneResourceState;')('Pressable',jsx,jsx,'Fragment');
  let retries=0;const render=extra=>State({retained:true,empty:true,emptyText:'No matches for this saved view.',onRetry:()=>retries++,...extra});
  const ready=render({}),refresh=render({loading:true}),failed=render({error:'Original native read exception'}),retrying=render({error:'Original native read exception',loading:true});
  for(const tree of [ready,refresh,failed,retrying]){assert.equal(tree.props.children[0].props.className,'mobile-phone-resource-status');assert.equal(text(tree.props.children[1]),'No matches for this saved view.');}
  assert.equal(text(refresh.props.children[0]),'Updating…');assert.equal(failed.props.children[0].props.role,'alert');assert.ok(all(failed).some(node=>node.type==='details'&&text(node).includes('Original native read exception')));all(failed).find(node=>node.type==='Pressable').props.onClick();assert.equal(retries,1);assert.equal(all(retrying).find(node=>node.type==='Pressable').props.disabled,true);
  const css=postcss.parse(await readFile(new URL('../src/features/workspace/workspace.css',import.meta.url),'utf8')),status=css.nodes.find(node=>node.type==='rule'&&node.selector==='.mobile-phone-resource-status');assert.equal(status.nodes.find(node=>node.prop==='height').value,'56px');const details=css.nodes.find(node=>node.type==='rule'&&node.selector==='.mobile-phone-resource-status>details>div');assert.equal(details.nodes.find(node=>node.prop==='position').value,'absolute','User-opened diagnostics do not push the retained list');
});
