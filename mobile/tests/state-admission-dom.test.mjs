import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import ts from 'typescript';

// Compose the actual App storage subscription, Shell, Home, FloatingWorkflow,
// workflow boundary and inventory hook in React DOM. Feature business/radio
// actions are controlled; this is not a physical reader or native timing test.
let browserRuntime;try{browserRuntime=createRequire(import.meta.url)(process.env.MOBILE_BROWSER_TEST_MODULE||'playwright');}catch{}
const browserOptions={skip:!browserRuntime&&'Set MOBILE_BROWSER_TEST_MODULE to an available Playwright runtime for real React DOM lifecycle checks.'};
const root=fileURLToPath(new URL('../',import.meta.url)),appUrl=new URL('../src/app/phone-app.jsx',import.meta.url);
const appSource=await readFile(appUrl,'utf8'),ast=ts.createSourceFile('phone-app.jsx',appSource,ts.ScriptTarget.Latest,true,ts.ScriptKind.JSX);
const mocked=new Map();
for(const node of ast.statements.filter(ts.isImportDeclaration)){
 const path=fileURLToPath(new URL(node.moduleSpecifier.text,appUrl));
 if(/shared\/components\/|features\/(inventory\/inventory|workspace\/workspace|lifecycle\/(intake|removal|manual-registration))\.jsx$|app\/(battery-page|mobile-import-dialog|missing-inspection-recovery)\.jsx$|business\/(registration|nfc-read)\.jsx$/.test(path.replaceAll('\\','/'))){
  const names=node.importClause?.namedBindings?.elements.map(item=>item.propertyName?.text||item.name.text)||[];
  mocked.set(path,`import React from 'react';${names.map(name=>`export function ${name}(props){return <div data-controlled-view="${name}" data-page={props.view}>${name==='MeScreen'?'<button aria-label="Open controlled account" onClick={()=>props.onOpen("account")}>Account</button>':''}</div>;}`).join('\n')}`);
 }
}
const modelUrl=new URL('../src/shared/components/inventory/battery-model-picker.js',import.meta.url),modelSource=await readFile(modelUrl,'utf8'),modelAst=ts.createSourceFile('models.js',modelSource,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
mocked.set(fileURLToPath(modelUrl),`import {newBatteryModelSchema,updateBatteryModelSchema} from '../../lib/battery-models.js';${modelAst.statements.filter(node=>ts.isFunctionDeclaration(node)&&['modelCreateStorageKey','recoverModelCreate'].includes(node.name?.text)).map(node=>node.getFullText(modelAst)).join('\n')}`);
const fixture=`
import React from 'react';import{createRoot}from'react-dom/client';import{MobileApp}from'./src/main.jsx';import{createDurableStorage}from'./src/platform/durable-storage.mjs';import{captureIntakeDraft}from'./src/shared/lib/intake-draft.js';import{intakeCommonSchema}from'./src/shared/lib/intake-session.js';
const f=window.fixture={opens:[],activeOwners:0,maxOwners:0,boundary:false,saving:0,saves:[],holdInventory:false,inventoryRelease:null,holdSave:false,saveRelease:null};
const user={id:'STAFF-A',defaultDataset:'demo',role:'staff',username:'fixture',displayName:'Fixture staff'};
f.snapshot={user,dataset:'demo',batteries:[],people:[],staffDirectory:[],buildings:[],rooms:[],teachingGroups:[]};
const common=intakeCommonSchema.parse({name:'Battery',model:'',chemistry:'',capacityMah:null,voltage:null,ownerId:'owner-a',homeBuildingId:'J18',homeRoomId:null,manufacturedOn:null,firstUsedOn:null});
const prepared=captureIntakeDraft({actorAccountId:user.id,dataset:'demo',batch:{sessionId:crypto.randomUUID(),common,firstUseMode:'unknown',source:'native_nfc'},entries:[],attempt:null,attemptEntryId:null,completed:[]});
f.original=JSON.stringify(prepared);const seed=new URL(location.href).searchParams.has('draft')?JSON.stringify({schemaVersion:1,entries:{['battery-intake:'+user.id+':demo']:f.original}}):null;
f.storage=createDurableStorage({load:async()=>seed,save:async raw=>{f.saves.push(raw);if(f.holdSave)await new Promise(resolve=>f.saveRelease=resolve);}});await f.storage.initialize();
f.storage.subscribe(value=>f.saving=value.pending);f.save=()=>{f.holdSave=true;f.storage.setItem('preference:controlled-save',String(f.saves.length));};f.releaseSave=()=>{f.holdSave=false;f.saveRelease?.();};
window.addEventListener('battery-mobile-workflow-active',event=>f.boundary=event.detail);
window.fetch=async(input,options={})=>{const path=String(input);if(path==='/api/session')return new Response(JSON.stringify({user}));if(path.startsWith('/api/inventory')){if(options.method==='POST')return new Response('{}');if(f.holdInventory)await new Promise(resolve=>f.inventoryRelease=resolve);return new Response(JSON.stringify(f.snapshot));}throw Error('Unexpected controlled request '+path);};
f.releaseInventory=()=>{f.holdInventory=false;f.inventoryRelease?.();};
f.root=createRoot(document.getElementById('root'));f.root.render(<MobileApp/>);
`;
const scanUrl=new URL('../src/features/scan/scan.jsx',import.meta.url),scanSource=await readFile(scanUrl,'utf8');
const controlledScan=scanSource.slice(0,scanSource.indexOf('function useDialogFocus'))+`
import{useWorkflowLock}from'../../business/workflow-boundary.jsx';
export function ScanWorkflow(props){useWorkflowLock();useEffect(()=>{const f=window.fixture;f.opens.push(props.kind);f.activeOwners++;f.maxOwners=Math.max(f.maxOwners,f.activeOwners);return()=>f.activeOwners--;},[]);return <section aria-label={props.kind+' controlled station'}><button aria-label="Exit controlled station" onClick={props.onExit}>Exit</button></section>;}
`;
let bundle;
async function mount(t,{draft=false}={}){
 if(!bundle){const result=await build({stdin:{contents:fixture,resolveDir:root,sourcefile:'state-dom.jsx',loader:'jsx'},bundle:true,write:false,jsx:'automatic',format:'esm',platform:'browser',plugins:[{name:'controlled-boundaries',setup(api){api.onLoad({filter:/\.(?:jsx|js|mjs|css)$/},async args=>{
  if(args.path.endsWith('.css'))return{contents:'',loader:'js'};
  if(args.path.endsWith('/src/main.jsx')||args.path.endsWith('\\src\\main.jsx'))return{contents:(await readFile(args.path,'utf8')).replace(/createRoot\(document\.getElementById\('root'\)\)\.render\([\s\S]*$/,''),loader:'jsx'};
  if(args.path===fileURLToPath(scanUrl))return{contents:controlledScan,loader:'jsx'};
  if(mocked.has(args.path))return{contents:mocked.get(args.path),loader:'jsx'};
  if(args.path.endsWith('runtime.mjs'))return{contents:"export const native=false;export const businessStorage=()=>window.fixture.storage;export const initializeRuntime=async()=>({storage:window.fixture.storage,origin:'controlled-local'});export const configureOrigin=async()=>{};export const clearNativeSession=async()=>{};export const saveFile=async()=>{};",loader:'js'};
  if(args.path.endsWith('diagnostics-app.jsx'))return{contents:'export default function DiagnosticApp(){return null;}',loader:'jsx'};
  if(args.path.endsWith('use-message-count.js'))return{contents:'export const useMessageCount=()=>({unreadCount:0,acceptUnreadCount(){}});',loader:'js'};
  if(args.path.endsWith('phone-arrivals.jsx'))return{contents:'export const PhoneArrivalsProvider=({children})=>children;export const usePhoneArrivals=()=>({arrivals:null,pending:false,error:"",acknowledge(){}});',loader:'jsx'};
 });}}]});bundle=result.outputFiles.find(file=>file.path.endsWith('.js')||file.path==='<stdout>').text;}
 const browser=await browserRuntime.chromium.launch({channel:process.env.MOBILE_BROWSER_TEST_CHANNEL||'msedge',headless:true});t.after(()=>browser.close());const page=await browser.newPage({viewport:{width:412,height:828}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.route('https://state.fixture.test/**',route=>route.fulfill({contentType:'text/html',body:`<div id="root"></div><script type="module">${bundle.replaceAll('</script','<\\/script')}</script>`}));await page.goto('https://state.fixture.test/'+(draft?'?draft=1':''));
 await page.waitForFunction(()=>document.querySelector('.scan-lookup-target')||window.fixture?.error,{timeout:5000}).catch(error=>{throw Error('Fixture mount failed: '+errors.join('; ')+' '+error.message);});assert.deepEqual(errors,[]);return page;
}
const click=async(page,label)=>page.evaluate(label=>{const button=[...document.querySelectorAll('button')].find(node=>node.getAttribute('aria-label')===label&&!node.closest('[hidden],[inert]'));if(!button||button.disabled)throw Error('Unavailable '+label);button.click();},label);
const waiting=page=>page.waitForFunction(()=>document.querySelector('.scan-entry-cancel'));

test('real composed App accepts a Home tap during routine persistence and opens once after save',browserOptions,async t=>{
 const page=await mount(t);await page.evaluate(()=>fixture.save());await page.waitForFunction(()=>fixture.saving===1);await click(page,'Check out: prepare batteries for your account');await waiting(page);assert.deepEqual(await page.evaluate(()=>fixture.opens),[]);
 await page.evaluate(()=>fixture.releaseSave());await page.waitForFunction(()=>fixture.opens.length===1);assert.deepEqual(await page.evaluate(()=>({opens:fixture.opens,max:fixture.maxOwners})),{opens:['checkout'],max:1});
});
test('real retained closing child keeps ownership while the next Home intent visibly waits',browserOptions,async t=>{
 const page=await mount(t);await click(page,'Check out: prepare batteries for your account');await page.waitForFunction(()=>fixture.opens.length===1);
 await page.evaluate(()=>{document.querySelector('[aria-label="Exit controlled station"]').click();});await page.waitForFunction(()=>document.querySelector('.phone-workflow-layer[data-state="closed"]'));
 const during=await page.evaluate(()=>{const closed=document.querySelector('.phone-workflow-layer[data-state="closed"]');const before={closing:!!closed,boundary:fixture.boundary,saving:fixture.saving};document.querySelector('[aria-label="Return: prepare batteries from a recorded loan"]').click();return before;});assert.deepEqual(during,{closing:true,boundary:true,saving:0});
 await waiting(page);await page.waitForFunction(()=>fixture.opens.length===2);assert.deepEqual(await page.evaluate(()=>({opens:fixture.opens,max:fixture.maxOwners})),{opens:['checkout','return'],max:1});
});
test('real composed inventory waiting survives a later save and cancellation has no late open',browserOptions,async t=>{
 const page=await mount(t);await page.evaluate(()=>fixture.holdInventory=true);await click(page,'Refresh inventory');await page.waitForFunction(()=>fixture.inventoryRelease);await click(page,'Check out: prepare batteries for your account');await waiting(page);
 await page.evaluate(()=>fixture.save());await page.waitForFunction(()=>fixture.saving===1);assert.equal(await page.locator('.scan-entry-cancel').count(),1);
 await page.evaluate(()=>fixture.releaseInventory());await page.waitForTimeout(30);assert.deepEqual(await page.evaluate(()=>fixture.opens),[]);
 await click(page,'Cancel opening');await page.evaluate(()=>fixture.releaseSave());await page.waitForFunction(()=>fixture.saving===0);assert.deepEqual(await page.evaluate(()=>fixture.opens),[]);assert.equal(await page.locator('.scan-entry-cancel').count(),0);
});

test('real bottom and Me page intents share cancellable save admission without late navigation',browserOptions,async t=>{
 const page=await mount(t);const bottom=label=>page.evaluate(label=>{const button=[...document.querySelectorAll('.phone-bottom-bar button')].find(node=>node.textContent.trim()===label);if(!button||button.disabled)throw Error('Unavailable area '+label);button.click();},label);
 await page.evaluate(()=>fixture.save());await page.waitForFunction(()=>fixture.saving===1);await bottom('Workspace');await waiting(page);await click(page,'Cancel opening');await page.evaluate(()=>fixture.releaseSave());await page.waitForFunction(()=>fixture.saving===0);assert.equal(await page.locator('.phone-route:not([hidden]) .mobile-scan-home').count(),1);
 await page.evaluate(()=>fixture.save());await page.waitForFunction(()=>fixture.saving===1);await bottom('Me');await waiting(page);await page.evaluate(()=>fixture.releaseSave());await page.waitForFunction(()=>document.querySelector('.phone-route:not([hidden]) [data-controlled-view="MeScreen"]'));
 await page.evaluate(()=>fixture.save());await page.waitForFunction(()=>fixture.saving===1);await click(page,'Open controlled account');await page.waitForFunction(()=>document.querySelector('.scan-entry-progress'));assert.equal(await page.locator('[data-page="account"]').count(),0);
 await page.evaluate(()=>fixture.releaseSave());await page.waitForFunction(()=>document.querySelector('[data-page="account"]'));assert.equal(await page.locator('[data-page="account"]').count(),1);assert.deepEqual(await page.evaluate(()=>fixture.opens),[]);
});

test('real startup retains a prepared batch on Home behind a collapsed saved-work cue without mounting a scanner',browserOptions,async t=>{
 const page=await mount(t,{draft:true});assert.equal(await page.locator('.phone-saved-work:not([open])').count(),1);assert.equal(await page.locator('.phone-workflow-layer').count(),0);assert.deepEqual(await page.evaluate(()=>fixture.opens),[]);
 assert.equal(await page.evaluate(()=>fixture.storage.getItem('battery-intake:STAFF-A:demo')===fixture.original),true);
 await page.locator('.phone-saved-work summary').click();assert.equal(await page.locator('.phone-saved-work[open]').count(),1);assert.equal(await page.getByRole('button',{name:'Continue Intake',exact:true}).count(),1);assert.equal(await page.locator('.phone-workflow-layer').count(),0);
});
