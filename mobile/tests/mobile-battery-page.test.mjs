import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile(new URL('../src/app/battery-page.jsx',import.meta.url),'utf8');
const parsed = ts.createSourceFile('battery-page.jsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JSX), imports = {};
for (const statement of parsed.statements.filter(ts.isImportDeclaration)) for (const binding of statement.importClause?.namedBindings?.elements ?? []) imports[binding.name.text] = binding.name.text;
const code = ts.transpileModule(parsed.statements.filter(statement => !ts.isImportDeclaration(statement)).map(statement => statement.getFullText(parsed)).join('\n'),{ compilerOptions:{ target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX } }).outputText.replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'');
const jsx = (type,props) => ({ type,props:props || {} });
function nodes(tree,result=[]) { if (Array.isArray(tree)) tree.forEach(child => nodes(child,result)); else if (tree && typeof tree === 'object') { result.push(tree); nodes(tree.props?.children,result); } return result; }
function text(tree) { return typeof tree === 'string' ? tree : Array.isArray(tree) ? tree.map(text).join('') : tree && typeof tree === 'object' ? text(tree.props?.children) : ''; }
const tick = () => new Promise(resolve => setImmediate(resolve));
function mount(t) {
  const cells=[],views=new Map(),requests=[]; let index=0,effects=[],tree;
  const useState = initial => { const key=index++; if (!(key in cells)) cells[key]={ value:typeof initial==='function'?initial():initial }; return [cells[key].value,next => { cells[key].value=typeof next==='function'?next(cells[key].value):next; }]; };
  const useEffect = (fn,deps) => { const key=index++,previous=cells[key]; if (!previous || deps.some((value,i)=>!Object.is(value,previous.deps[i]))) effects.push(()=>{previous?.cleanup?.();cells[key]={deps,cleanup:fn()};}); };
  const usePhoneViewState = (key,initial) => { if (!views.has(key)) views.set(key,initial); return [views.get(key),next=>views.set(key,typeof next==='function'?next(views.get(key)):next)]; };
  const original = Object.getOwnPropertyDescriptor(globalThis,'fetch');
  Object.defineProperty(globalThis,'fetch',{configurable:true,value:(_url,{signal})=>new Promise((resolve,reject)=>requests.push({signal,resolve,reject}))});
  t.after(()=>{cells.forEach(cell=>cell?.cleanup?.());if(original)Object.defineProperty(globalThis,'fetch',original);else delete globalThis.fetch;});
  const bindings={...imports,useState,useEffect,useRef:initial=>useState({current:initial})[0],usePhoneContentMotion(){},usePhoneViewState,inventoryResponse:value=>value,batteryStatusLabel:()=> 'In store',isActiveBattery:()=>true,formatTime:value=>value,storageRoomLabel:()=> 'Room unknown',durationLabel:value=>value,actionNames:{}};
  const keys=Object.keys(bindings),Component=new Function(...keys,'_jsx','_jsxs','_Fragment',`${code}\nreturn BatteryPage;`)(...keys.map(key=>bindings[key]),jsx,jsx,'Fragment');
  const props={battery:{id:'BAT-00000001',name:'Original',loanId:null},data:{dataset:'demo'},active:true,revision:1};
  return { requests,views, render(patch={},commit=true) {Object.assign(props,patch);index=0;effects=[];tree=Component(props);if(commit)effects.forEach(fn=>fn());return tree;}, tree:()=>tree, complete(request,name='Loaded') {request.resolve({battery:{...props.battery,name},events:[]});} };
}
test('record refresh retains evidence and immediately blocks stale authority',async t=>{
  const view=mount(t);view.render();view.complete(view.requests[0]);await tick();
  const loaded=view.render();assert.ok(text(loaded).includes('Loaded'));
  const beforeEffect=view.render({revision:2},false);
  assert.equal(nodes(beforeEffect).find(node=>node.type==='Pressable'&&text(node)==='Prepare checkout').props.disabled,true);
  const refreshing=view.render({revision:2});assert.ok(text(refreshing).includes('Loaded'));
  view.requests[1].reject(new Error('Failed to fetch'));await tick();
  const failed=view.render();assert.ok(text(failed).includes('Loaded'));
  assert.equal(nodes(failed).find(node=>node.type==='PhoneReadError').props.stale,true);
});
test('inactive records abort reads and reject late responses; reactivation refetches',async t=>{
  const view=mount(t);view.render();view.render({active:false});
  assert.equal(view.requests[0].signal.aborted,true);view.complete(view.requests[0],'Late record');await tick();
  assert.equal(text(view.render()).includes('Late record'),false);assert.equal(view.requests.length,1);
  view.render({active:true});assert.equal(view.requests.length,2);
});
test('record tabs and specification disclosure use account/inventory-scoped view state',t=>{
  const view=mount(t),tree=view.render();
  nodes(tree).find(node=>node.type==='Pressable'&&node.props.role==='tab'&&text(node)==='History').props.onClick();
  const history=view.render();assert.equal(nodes(history).find(node=>node.props.role==='tab'&&text(node)==='History').props['aria-selected'],true);
  assert.equal(view.views.get('battery:BAT-00000001:tab'),'history');
});

test('read-only task detail exposes evidence and complete export without business action controls',async t=>{
  const view=mount(t);view.render({readOnly:true});view.complete(view.requests[0]);await tick();const tree=view.render();
  assert.ok(nodes(tree).find(node=>node.type==='Pressable'&&text(node)==='Download complete battery details'));
  assert.equal(nodes(tree).find(node=>node.type==='Pressable'&&/Prepare checkout|Prepare return|Loans, inspections & actions/.test(text(node))),undefined);
});
