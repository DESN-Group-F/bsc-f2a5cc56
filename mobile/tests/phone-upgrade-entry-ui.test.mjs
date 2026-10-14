import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { createStartupCoordinator, startupPresentation } from '../src/app/startup-state.mjs';
import { markPhoneMilestone } from '../src/app/phone-milestones.mjs';
import { recoverNfcEvidence } from '../src/business/nfc-controller.mjs';
import { createServiceScopeController } from '../src/platform/native-business-data.mjs';
import * as interaction from '../src/app/phone-interaction.mjs';
import * as scrolling from '../src/app/phone-scroll.mjs';

// Actual entry and primitive JSX execute; native service/storage and React lifecycle
// are controlled. These cases do not claim browser geometry or native startup timing.
const sources=Object.fromEntries(await Promise.all(['main.jsx','app/startup-surface.jsx','app/phone-ui.jsx'].map(async file=>[file,await readFile(new URL('../src/'+file,import.meta.url),'utf8')])));
const nodes=(tree,result=[])=>{if(Array.isArray(tree))tree.forEach(child=>nodes(child,result));else if(tree&&typeof tree==='object'){result.push(tree);nodes(tree.props?.children,result);}return result;};
const text=tree=>typeof tree==='string'||typeof tree==='number'?String(tree):Array.isArray(tree)?tree.map(text).join(''):tree&&typeof tree==='object'?text(tree.props?.children):'';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return{promise,resolve};};
const sameDeps=(a,b)=>a&&b&&a.length===b.length&&a.every((item,index)=>Object.is(item,b[index]));
function hooks(){
  const cells=[];let index=0,effects=[],dirty=false,disposed=false,late=0;
  const api={
    reset(){index=0;effects=[];dirty=false;},
    useState(initial){const key=index++;if(!(key in cells))cells[key]={value:typeof initial==='function'?initial():initial};return[cells[key].value,update=>{if(disposed)late++;const next=typeof update==='function'?update(cells[key].value):update;if(!Object.is(next,cells[key].value)){cells[key].value=next;dirty=true;}}];},
    useRef(initial){return cells[index++]??={current:initial};},
    useMemo(calculate,deps){const key=index++;if(!cells[key]||!sameDeps(cells[key].deps,deps))cells[key]={deps,value:calculate()};return cells[key].value;},
    useEffect(run,deps){const key=index++,old=cells[key];if(!old||!sameDeps(old.deps,deps))effects.push(()=>{old?.cleanup?.();cells[key]={deps,cleanup:run()};});},
    useSyncExternalStore(subscribe,getSnapshot){const key=index++,old=cells[key];if(!old||old.subscribe!==subscribe){old?.cleanup?.();cells[key]={subscribe,cleanup:subscribe(()=>dirty=true)};}return getSnapshot();},
    commit(){effects.forEach(run=>run());return dirty;},
    dispose(){if(disposed)return;disposed=true;cells.forEach(cell=>cell?.cleanup?.());},
    late:()=>late,
    createContext:value=>({value,Provider:'Provider'}),useContext:context=>context.value,
  };api.useCallback=(callback,deps)=>api.useMemo(()=>callback,deps);return api;
}
function compile(source,exports,bindings,jsx){
  const parsed=ts.createSourceFile('actual.jsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JSX),imports={};
  for(const declaration of parsed.statements.filter(ts.isImportDeclaration)){if(declaration.importClause?.name)imports[declaration.importClause.name.text]=declaration.importClause.name.text;for(const item of declaration.importClause?.namedBindings?.elements??[])imports[item.name.text]=item.name.text;}
  const input=parsed.statements.filter(item=>!ts.isImportDeclaration(item)&&!item.getText(parsed).startsWith('createRoot(')).map(item=>item.getFullText(parsed)).join('\n');
  const output=ts.transpileModule(input,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX},reportDiagnostics:true});
  assert.equal(output.diagnostics.some(item=>item.category===ts.DiagnosticCategory.Error),false);
  const values={...imports,...bindings,_jsx:jsx,_jsxs:jsx,_Fragment:'Fragment'},names=Object.keys(values);
  return new Function(...names,output.outputText.replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'')+'\nreturn {'+exports.join(',')+'};')(...names.map(name=>values[name]));
}
function entry(t,{origin='https://fixture.example',session='deferred',savedMotion=false,failSave=false}={}){
  const state=hooks(),window=new EventTarget(),document={getElementById:()=>({}),querySelector:()=>null},response=deferred();
  const values=new Map(savedMotion?[['preference:mobile-motion','reduce']]:[]),listeners=new Set();
  const env={origin,requests:[],prepares:0,retries:0,configurations:[],failSave,session,marks:[],viewport:{layout:'portrait',keyboardOpen:false,systemReduced:false},values};
  const storage={entries:()=>Object.fromEntries(values),getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key),transact:async()=>{},hasPending:()=>[...values.keys()].some(key=>!key.startsWith('preference:')),subscribe:callback=>{listeners.add(callback);return()=>listeners.delete(callback);},
    async flush(){if(env.failSave){listeners.forEach(callback=>callback({pending:0,error:'Durable save unavailable'}));throw new Error('Durable save unavailable');}},
    async retryPersistence(){env.retries++;env.failSave=false;listeners.forEach(callback=>callback({pending:0,error:null}));},exportRaw:()=>JSON.stringify({entries:Object.fromEntries(values)})};
  const scope=createServiceScopeController({storage,origin,service:{configure:async({origin:value})=>{env.configurations.push(value);env.origin=value;},getConfiguration:async()=>({origin:env.origin})}});
  const jsx=(type,props,key)=>typeof type==='function'&&['StartupSurface','InitialContentSurface'].includes(type.name)?type(props):({type,props:props??{},key});
  const surfaces=compile(sources['app/startup-surface.jsx'],['StartupSurface','InitialContentSurface'],{startupPresentation},jsx);
  const actual=compile(sources['main.jsx'],['MobileApp'],{...state,...surfaces,createStartupCoordinator,recoverNfcEvidence,iosPresentation:false,native:true,window,document,
    usePhoneViewport:()=>env.viewport,initializeRuntime:async()=>{env.prepares++;return{origin:env.origin,storage};},businessStorage:()=>storage,
    configureOrigin:value=>scope.configure(value),clearNativeSession:async()=>assert.fail('Entry must not silently clear credentials.'),saveFile:async()=>{},
    markPhoneMilestone:name=>markPhoneMilestone(name,{getEntriesByName:key=>env.marks.filter(item=>item===key),mark:key=>env.marks.push(key)}),
    fetch:async(path,init)=>{env.requests.push({path,method:init?.method||'GET',body:init?.body});if(init?.method==='POST')return{ok:true,json:async()=>({user:{id:'fixture-staff'}})};if(env.session==='deferred')return response.promise;if(env.session==='failed')throw new Error('Connection unavailable');return{ok:true,json:async()=>({user:env.session})};},
  },jsx);
  let tree;
  function render(){for(let count=0;count<20;count++){state.reset();tree=actual.MobileApp();if(!state.commit())return tree;}assert.fail('Entry did not settle.');}
  const view={env,render,nodes:()=>nodes(render()),text:()=>text(render()),resolveSession:user=>response.resolve({ok:true,json:async()=>({user})}),
    button(label){return nodes(render()).find(node=>node.type==='Pressable'&&text(node)===label);},
    emitStorage(pending=0,error=null){listeners.forEach(callback=>callback({pending,error}));render();},
    dispose:()=>state.dispose(),late:()=>state.late(),async settle(){await tick();render();await tick();return render();}};
  t.after(()=>state.dispose());
  render();return view;
}

test('actual entry never shows login while a saved session is being checked',async t=>{
  const view=entry(t);await view.settle();assert.match(view.text(),/Checking sign-in/);assert.equal(view.nodes().some(node=>node.type==='form'),false);
  assert.equal(view.env.marks.includes('phone:first-interactive'),false);view.resolveSession({id:'fixture-staff'});await view.settle();
  assert.ok(view.nodes().some(node=>node.type==='MobileShell'));assert.equal(view.nodes().some(node=>node.props['aria-label']==='Staff sign-in'),false);
});

test('actual connection failure offers retry without exposing login or resetting credentials',async t=>{
  const view=entry(t,{session:'failed'});await view.settle();assert.match(view.text(),/Sign-in could not be checked/);assert.equal(view.nodes().some(node=>node.props.className==='phone-signin-form'),false);assert.equal(view.nodes().some(node=>node.type==='input'&&node.props.autoComplete==='current-password'),false);
  view.env.session=null;await view.button('Retry connection').props.onClick();await view.settle();
  assert.equal(view.env.prepares,1);assert.ok(view.nodes().some(node=>node.props['aria-label']==='Staff sign-in'));assert.equal(view.env.requests.length,2);
});

test('actual failed session exposes the same guarded connection form and preserves retained work when a switch is blocked',async t=>{
  const view=entry(t,{session:'failed'});view.env.values.set('original-request','exact retained request');await view.settle();
  assert.match(view.text(),/Connection settings/);assert.equal(view.nodes().some(node=>node.props.className==='phone-signin-form'),false);
  const address=view.nodes().find(node=>node.type==='input'&&node.props.type==='url');address.props.onChange({target:{value:'https://replacement.fixture'}});view.render();
  await view.nodes().find(node=>node.props.className==='phone-connection-form').props.onSubmit({preventDefault(){}});view.render();
  assert.equal(view.env.requests.length,1);assert.deepEqual(view.env.configurations,[]);assert.equal(view.env.values.get('original-request'),'exact retained request');assert.match(view.text(),/pending business work before changing the service/);
  view.env.values.delete('original-request');
  await view.nodes().find(node=>node.props.className==='phone-connection-form').props.onSubmit({preventDefault(){}});view.render();
  assert.deepEqual(view.env.configurations,['https://replacement.fixture']);assert.equal(view.env.requests.length,1);assert.match(view.text(),/Sign-in could not be checked/);
  view.dispose();const next=entry(t,{origin:view.env.origin,session:null});await next.settle();assert.equal(next.env.requests.length,1);assert.ok(next.nodes().some(node=>node.props['aria-label']==='Staff sign-in'));
});

test('actual first configuration exposes connection only and a fresh configured entry checks sign-in',async t=>{
  const view=entry(t,{origin:'unconfigured',session:null});await view.settle();assert.equal(view.env.requests.length,0);assert.equal(view.nodes().some(node=>node.type==='input'&&node.props.autoComplete==='current-password'),false);
  const address=view.nodes().find(node=>node.type==='input'&&node.props.type==='url');address.props.onChange({target:{value:'https://configured.fixture'}});view.render();
  await view.nodes().find(node=>node.type==='form').props.onSubmit({preventDefault(){}});assert.deepEqual(view.env.configurations,['https://configured.fixture']);
  view.dispose();const next=entry(t,{origin:view.env.origin,session:null});await next.settle();assert.equal(next.env.requests.length,1);assert.ok(next.nodes().some(node=>node.props['aria-label']==='Staff sign-in'));
});

test('actual initial save failure uses durable retry before session checking and retains data',async t=>{
  const view=entry(t,{session:null,failSave:true});view.env.values.set('original-request','retained');await view.settle();assert.equal(view.env.requests.length,0);assert.match(view.text(),/Device save needs attention/);
  await view.button('Retry device save').props.onClick();await view.settle();assert.equal(view.env.retries,1);assert.equal(view.env.requests.length,1);assert.equal(view.env.values.get('original-request'),'retained');
});

test('saved reduced motion updates the root only after confirmed persistence',async t=>{
  const view=entry(t,{session:null,savedMotion:true});await view.settle();assert.equal(view.render().props['data-phone-reduced-motion'],'true');
  view.env.values.set('preference:mobile-motion','system');view.emitStorage(1);assert.equal(view.render().props['data-phone-reduced-motion'],'true');
  view.emitStorage(0,'Save failed');assert.equal(view.render().props['data-phone-reduced-motion'],'true');view.emitStorage();assert.equal(view.render().props['data-phone-reduced-motion'],'false');
});

test('unmounting actual entry rejects a late session result without late React updates',async t=>{
  const view=entry(t);await view.settle();view.dispose();view.resolveSession({id:'late-staff'});await tick();assert.equal(view.late(),0);
});

test('busy and disabled actual Pressable suppress activation but keyboard works after cancellation',()=>{
  const state=hooks(),jsx=(type,props)=>({type,props:props??{}}),actual=compile(sources['app/phone-ui.jsx'],['Pressable'],{...state,...interaction,...scrolling},jsx);
  let calls=0,props={onClick:()=>calls++,busy:true,type:'submit'};
  const render=()=>{state.reset();return actual.Pressable(props);};let button=render();button.props.onClick({detail:0});assert.equal(calls,0);assert.equal(button.props.disabled,true);assert.equal(button.props.type,'submit');
  props={...props,busy:false};button=render();button.props.onPointerCancel();button=render();button.props.onClick({detail:0});assert.equal(calls,1);state.dispose();
});
