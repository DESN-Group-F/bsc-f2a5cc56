import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import ts from 'typescript';

// Render the actual App, Shell, Me page and CSS with real DOM scroll/clipping.
// Only unrelated business/radio presentation and transport are controlled.
// Held ordinary durable saves are real; there are no hosted or device actions.
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

// Keep the actual Me/Workspace landing pages; unrelated business panels stay controlled.
const workspaceUrl=new URL('../src/features/workspace/workspace.jsx',import.meta.url),workspaceSource=await readFile(workspaceUrl,'utf8');
mocked.set(fileURLToPath(workspaceUrl),workspaceSource.slice(0,workspaceSource.indexOf('export function WorkspacePage'))+'export const WorkspacePage=()=>null;');

const modelUrl=new URL('../src/shared/components/inventory/battery-model-picker.js',import.meta.url),modelSource=await readFile(modelUrl,'utf8'),modelAst=ts.createSourceFile('models.js',modelSource,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
mocked.set(fileURLToPath(modelUrl),`import {newBatteryModelSchema,updateBatteryModelSchema} from '../../lib/battery-models.js';${modelAst.statements.filter(node=>ts.isFunctionDeclaration(node)&&['modelCreateStorageKey','recoverModelCreate'].includes(node.name?.text)).map(node=>node.getFullText(modelAst)).join('\n')}`);
const fixture=`
import React from 'react';import{createRoot}from'react-dom/client';import{MobileApp}from'./src/main.jsx';import{createDurableStorage}from'./src/platform/durable-storage.mjs';import{captureIntakeDraft}from'./src/shared/lib/intake-draft.js';import{intakeCommonSchema}from'./src/shared/lib/intake-session.js';
const f=window.fixture={opens:[],activeOwners:0,maxOwners:0,boundary:false,saving:0,saves:[],holdInventory:false,inventoryRelease:null,holdSave:false,saveRelease:null};
const user={id:'STAFF-A',defaultDataset:'demo',role:'staff',username:'fixture',displayName:'Fixture staff'};
f.snapshot={user,dataset:'demo',batteries:Array.from({length:3},(_,index)=>({id:'BAT-0000000'+(index+1),name:'Controlled retained battery '+(index+1),ownerAccountId:user.id,ownerName:'Fixture staff',borrowerAccountId:user.id,borrowerName:'Fixture staff',loanId:'controlled-loan-'+index,lifecycleStatus:'active',version:1,tagId:null})),people:[],staffDirectory:[],buildings:[],rooms:[],teachingGroups:[],events:[]};
const common=intakeCommonSchema.parse({name:'Battery',model:'',chemistry:'',capacityMah:null,voltage:null,ownerId:'owner-a',homeBuildingId:'J18',homeRoomId:null,manufacturedOn:null,firstUsedOn:null});
const prepared=captureIntakeDraft({actorAccountId:user.id,dataset:'demo',batch:{sessionId:crypto.randomUUID(),common,firstUseMode:'unknown',source:'native_nfc'},entries:[],attempt:null,attemptEntryId:null,completed:[]});
f.original=JSON.stringify(prepared);const seed=new URL(location.href).searchParams.has('draft')?JSON.stringify({schemaVersion:1,entries:{['battery-intake:'+user.id+':demo']:f.original}}):null;
f.storage=createDurableStorage({load:async()=>seed,save:async raw=>{f.saves.push(raw);if(f.holdSave)await new Promise(resolve=>f.saveRelease=resolve);}});await f.storage.initialize();
f.storage.subscribe(value=>f.saving=value.pending);f.save=()=>{f.holdSave=true;f.storage.setItem('preference:controlled-save',String(f.saves.length));};f.releaseSave=()=>{f.holdSave=false;f.saveRelease?.();};
window.addEventListener('battery-mobile-workflow-active',event=>f.boundary=event.detail);
window.fetch=async(input,options={})=>{const path=String(input);if(path.startsWith('/api/messages'))return new Response(JSON.stringify({messages:[],unreadCount:0,issues:[]}));if(path==='/api/session')return new Response(JSON.stringify({user}));if(path.startsWith('/api/inventory')){if(options.method==='POST')return new Response('{}');if(f.holdInventory)await new Promise(resolve=>f.inventoryRelease=resolve);return new Response(JSON.stringify(f.snapshot));}throw Error('Unexpected controlled request '+path);};
f.releaseInventory=()=>{f.holdInventory=false;f.inventoryRelease?.();};
f.root=createRoot(document.getElementById('root'));f.root.render(<MobileApp/>);
`;
const scanUrl=new URL('../src/features/scan/scan.jsx',import.meta.url),scanSource=await readFile(scanUrl,'utf8');
const controlledScan=scanSource.slice(0,scanSource.indexOf('function useDialogFocus'))+`
import{useWorkflowLock}from'../../business/workflow-boundary.jsx';
export function ScanWorkflow(props){useWorkflowLock();useEffect(()=>{const f=window.fixture;f.opens.push(props.kind);f.activeOwners++;f.maxOwners=Math.max(f.maxOwners,f.activeOwners);return()=>f.activeOwners--;},[]);return <section aria-label={props.kind+' controlled station'}><button aria-label="Exit controlled station" onClick={props.onExit}>Exit</button></section>;}
`;
let bundle;
async function mount(t,{viewport={width:412,height:828},large=false}={}){
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
 const browser=await browserRuntime.chromium.launch({channel:process.env.MOBILE_BROWSER_TEST_CHANNEL||'msedge',headless:true});t.after(()=>browser.close());const page=await browser.newPage({viewport}),errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.route('https://state.fixture.test/**',route=>route.fulfill({contentType:'text/html',body:`<div id="root"></div><script type="module">${bundle.replaceAll('</script','<\\/script')}</script>`}));await page.goto('https://state.fixture.test/');
 await page.waitForFunction(()=>document.querySelector('.scan-lookup-target')||window.fixture?.error,{timeout:5000}).catch(error=>{throw Error('Fixture mount failed: '+errors.join('; ')+' '+error.message);});assert.deepEqual(errors,[]);const css=await Promise.all(['app/phone.css','app/phone-choice.css','features/workspace/workspace.css','features/scan/scan.css','features/scan/ink-orb.css'].map(file=>readFile(new URL('../src/'+file,import.meta.url),'utf8')));await page.addStyleTag({content:css.join('\n').replace(/@import[^;]+;/g,'')});if(large)await page.addStyleTag({content:'html{font-size:24px}'});t.after(()=>assert.deepEqual(errors,[]));return page;
}

async function meBottom(page){
 await page.locator('.phone-bottom-bar').getByRole('button',{name:'Me',exact:true}).click();await page.locator('.phone-route:not([hidden]) .mobile-me-home').waitFor();await page.locator('.mobile-me-loans summary').click();
 await page.waitForFunction(()=>document.querySelector('.mobile-me-home .mobile-phone-signout'));
 const position=await page.evaluate(()=>{const main=document.querySelector('.phone-main');main.scrollTop=main.scrollHeight;return{top:main.scrollTop,height:main.clientHeight,scrollHeight:main.scrollHeight};});assert.ok(position.top>50,'Actual Me content must exceed its CSS scroll viewport');return position;
}
async function ordinarySave(page){await page.evaluate(()=>fixture.save());await page.waitForFunction(()=>fixture.saving===1);}
async function visibleAction(page,selector){
 const evidence=await page.evaluate(selector=>{const control=document.querySelector(selector),main=document.querySelector('.phone-main'),header=document.querySelector('.phone-topbar'),panel=document.querySelector('.phone-shell-status'),rect=control.getBoundingClientRect(),clip=main.getBoundingClientRect(),style=getComputedStyle(panel),top=document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2);return{rect:{x:rect.x,y:rect.y,width:rect.width,height:rect.height},clip:{x:clip.x,y:clip.y,width:clip.width,height:clip.height},headerBottom:header.getBoundingClientRect().bottom,position:style.position,background:style.backgroundColor,hit:control===top||control.contains(top),scrollTop:main.scrollTop};},selector);
 assert.equal(evidence.position,'sticky');assert.notEqual(evidence.background,'rgba(0, 0, 0, 0)');assert.ok(evidence.scrollTop>50,'Showing status must not scroll the retained view to the top');assert.ok(evidence.rect.y>=evidence.clip.y&&evidence.rect.y+evidence.rect.height<=evidence.clip.y+evidence.clip.height,'Action stays inside the actual scrolling viewport');assert.ok(evidence.rect.x>=evidence.clip.x&&evidence.rect.x+evidence.rect.width<=evidence.clip.x+evidence.clip.width);assert.ok(evidence.rect.y>=evidence.headerBottom,'Status stays below the ordinary header');assert.equal(evidence.hit,true,'Rendered control is not covered by content or another status');return evidence;
}

test('actual Shell CSS keeps waiting and Cancel visible on scrolled Me in portrait, landscape and large text',browserOptions,async t=>{
 for(const [label,viewport,large]of [['portrait',{width:412,height:828},false],['small portrait',{width:320,height:640},false],['landscape',{width:828,height:388},false],['large text',{width:412,height:828},true],['wide large text',{width:828,height:388},true]])await t.test(label,async child=>{
  const page=await mount(child,{viewport,large});const before=await meBottom(page);await ordinarySave(page);await page.getByRole('button',{name:/^App settings Motion/}).click();await page.waitForFunction(()=>document.querySelector('.scan-entry-progress [aria-label="Cancel opening"]'));
  assert.match(await page.locator('.scan-entry-progress').innerText(),/Opening App settings… Finishing the device save…/);await visibleAction(page,'.scan-entry-progress [aria-label="Cancel opening"]');assert.equal(await page.evaluate(()=>document.querySelector('.phone-main').scrollTop),before.top,'The main scroll position remains retained');
  await page.getByRole('button',{name:'Cancel opening',exact:true}).click();await page.evaluate(()=>fixture.releaseSave());await page.waitForFunction(()=>fixture.saving===0);assert.equal(await page.locator('.scan-entry-progress').count(),0);assert.equal(await page.locator('.phone-route:not([hidden]) .mobile-me-home').count(),1);assert.equal(await page.locator('.phone-settings').count(),0,'Cancel never permits a delayed App settings open');
 });
});

test('actual Shell stacks a visible record refusal with waiting; neither dismiss nor Cancel is hidden by the other',browserOptions,async t=>{
 const page=await mount(t);await meBottom(page);await ordinarySave(page);await page.locator('.mobile-me-loan-list button').first().click();await page.getByRole('button',{name:/^App settings Motion/}).click();await page.waitForFunction(()=>document.querySelector('.scan-entry-progress'));
 assert.match(await page.locator('.phone-notice').innerText(),/Device work is being saved. Try opening this record again when the save finishes./);
 await visibleAction(page,'.phone-notice [aria-label="Dismiss status"]');await visibleAction(page,'.scan-entry-progress [aria-label="Cancel opening"]');
 const rectangles=await page.evaluate(()=>({notice:document.querySelector('.phone-notice').getBoundingClientRect().top,progress:document.querySelector('.scan-entry-progress').getBoundingClientRect().bottom}));assert.ok(rectangles.progress<=rectangles.notice,'Waiting and its Cancel remain before the separate original notice');
 await page.getByRole('button',{name:'Dismiss status',exact:true}).click();await visibleAction(page,'.scan-entry-progress [aria-label="Cancel opening"]');await page.getByRole('button',{name:'Cancel opening',exact:true}).click();await page.evaluate(()=>fixture.releaseSave());await page.waitForFunction(()=>fixture.saving===0);assert.equal(await page.locator('.phone-route:not([hidden]) .mobile-me-home').count(),1);
});

 test('actual lower-page view opens once after a real ordinary save and returns to retained Me scroll',browserOptions,async t=>{
 const page=await mount(t);const before=await meBottom(page);await ordinarySave(page);await page.getByRole('button',{name:/^App settings Motion/}).click();await page.waitForFunction(()=>document.querySelector('.scan-entry-progress'));await visibleAction(page,'.scan-entry-progress [aria-label="Cancel opening"]');await page.evaluate(()=>fixture.releaseSave());await page.waitForFunction(()=>document.querySelector('.phone-route:not([hidden]) .phone-settings'));assert.equal(await page.locator('.scan-entry-progress').count(),0);
 await page.getByRole('button',{name:'Back to previous view',exact:true}).click();await page.locator('.phone-route:not([hidden]) .mobile-me-home').waitFor();assert.equal(await page.evaluate(()=>document.querySelector('.phone-main').scrollTop),before.top);
 });


test('actual CSS regression control puts a normal-flow Cancel outside the scrolled viewport, while sticky restores its hit target',browserOptions,async t=>{
 const page=await mount(t);await meBottom(page);await ordinarySave(page);await page.getByRole('button',{name:/^App settings Motion/}).click();await page.waitForFunction(()=>document.querySelector('.scan-entry-progress'));
 const normal=await page.addStyleTag({content:'.phone-main>.phone-shell-status[data-scroll-status=view]{position:static!important}'});
 const hidden=await page.evaluate(()=>({cancel:document.querySelector('.scan-entry-progress [aria-label="Cancel opening"]').getBoundingClientRect().bottom,main:document.querySelector('.phone-main').getBoundingClientRect().top}));assert.ok(hidden.cancel<hidden.main,'The original normal-flow placement reproduces an offscreen Cancel on the same actual scrolled page');
 await normal.evaluate(element=>element.remove());await visibleAction(page,'.scan-entry-progress [aria-label="Cancel opening"]');await page.getByRole('button',{name:'Cancel opening',exact:true}).click();await page.evaluate(()=>fixture.releaseSave());await page.waitForFunction(()=>fixture.saving===0);assert.equal(await page.locator('.phone-route:not([hidden]) .mobile-me-home').count(),1);
});
