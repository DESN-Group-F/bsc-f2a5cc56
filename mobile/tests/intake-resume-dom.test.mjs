import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';

// Actual React DOM, controller, preparation, summary, choices, reader and local
// storage run together. Native hardware, transport and unrelated model-picker
// presentation are controlled boundaries. This does not qualify a physical phone.
let runtime;
try{runtime=createRequire(import.meta.url)(process.env.MOBILE_BROWSER_TEST_MODULE||'playwright');}catch{}
const root=fileURLToPath(new URL('../',import.meta.url));
const fixture=`
import React,{useState}from'react';import{createRoot}from'react-dom/client';
import{MobileIntake}from'./src/features/lifecycle/intake.jsx';
import{createIntakeController,intakeDefaultValues}from'./src/features/lifecycle/intake-controller.mjs';
import{createDurableStorage}from'./src/platform/durable-storage.mjs';import{phoneFormDraftKey}from'./src/app/phone-form-draft.mjs';
import{PhoneContext}from'./src/app/phone-ui.jsx';
const f=window.fixture={reads:[],haptics:[],modelReads:0,posts:0,failSave:false,errors:[],exits:0};
window.addEventListener('unhandledrejection',event=>f.errors.push(event.reason?.message));
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
let raw=null;f.storage=createDurableStorage({load:async()=>raw,save:async value=>{if(f.failSave)throw Error('Controlled local save failed');raw=value;}});await f.storage.initialize();
f.adapter={getAvailability:async()=>({available:true,enabled:true,platform:'android'}),read(){const gate=deferred();f.reads.push({...gate,settled:false});return gate.promise;},cancel:async()=>{const last=f.reads.at(-1);if(last&&!last.settled){last.settled=true;last.reject(Object.assign(Error('Cancelled'),{code:'CANCELLED'}));}}};
window.__batteryMobileHaptic=async value=>f.haptics.push(value);
f.holdModels=()=>{f.modelWait=deferred();};f.releaseModels=()=>{f.modelWait.resolve();f.modelWait=null;};
f.model={origin:'saved',id:'00000000-0000-4000-8000-000000000900',contentHash:'a'.repeat(64),confirmed:true,appliedFields:['model']};f.choices=[f.model];
window.fetch=async url=>{if(String(url).startsWith('/api/battery-models')){f.modelReads++;if(f.modelWait)await f.modelWait.promise;return{ok:true,json:async()=>({dataset:'demo',models:f.choices,issues:[]})};}f.posts++;throw Error('No hosted business request');};
const data=f.data={dataset:'demo',user:{id:'STAFF-A',role:'staff'},batteries:[],people:[{id:'owner-a',accountId:'STAFF-A',name:'Responsible fixture owner',role:'staff'}],staffDirectory:[{id:'STAFF-A',username:'fixture.staff',active:true}],rooms:[{id:'room-a',name:'Fixture storage room',buildingId:'J18',selectable:true}],buildings:[{id:'J18'}]};
const write=async()=>{f.posts++;throw Error('Controlled lost response');};
const initial=createIntakeController({storage:f.storage,data,accountId:'STAFF-A',write});
if(window.scenario!=='new'){
 await initial.prepare({...intakeDefaultValues(data,'STAFF-A'),name:'Saved battery',model:window.scenario==='model'?'Reviewed model':'',homeRoomId:'room-a',chemistry:'Li-ion',capacityMah:'3200',voltage:'3.7'},'at_registration',window.scenario==='model'?f.model:null);
 const at=new Date().toISOString();const evidence={attemptId:crypto.randomUUID(),source:'native-nfc-reader',platform:'android',startedAt:at,endedAt:at,adoptedAt:at,tagId:'nfc:uid:0004AB00',result:{uidHex:'0004AB00',technology:'Controlled NFC-A',ndefStatus:'readWrite',capacityBytes:144,records:[],observedAt:at}};
 await initial.addTag(evidence.tagId,evidence);if(window.scenario==='saved-two'){const second=structuredClone(evidence);second.attemptId=crypto.randomUUID();second.tagId='nfc:uid:0004AB01';second.result.uidHex='0004AB01';await initial.addTag(second.tagId,second);}f.original=JSON.stringify(initial.getSnapshot().draft.entries);
 if(window.scenario==='uncertain'){await initial.confirm([initial.getSnapshot().draft.entries[0].id]);f.originalAttempt=JSON.stringify(initial.getSnapshot().draft.attempt);}
}
f.originalDraft=JSON.stringify(initial.getSnapshot().draft);f.formKey=phoneFormDraftKey({accountId:'STAFF-A',dataset:'demo',kind:'intake-common',recordId:'common'});f.beforePosts=f.posts;f.durableBusiness=()=>JSON.parse(JSON.parse(raw).entries['battery-intake:STAFF-A:demo']||'null');f.business=()=>JSON.parse(f.storage.getItem('battery-intake:STAFF-A:demo')||'null');
function Root(){const[active,setActive]=useState(true),[inventory,setInventory]=useState(data),[shown,setShown]=useState(true);f.renderedActive=active;f.setActive=setActive;f.update=patch=>setInventory(old=>({...old,...patch}));return <PhoneContext.Provider value={{active,reduced:true,namespace:'STAFF-A:demo',workflowOwner:'intake'}}>{shown&&<MobileIntake data={inventory} write={write} onExit={()=>{f.exits++;setShown(false);}}/>}</PhoneContext.Provider>;}
f.root=createRoot(document.getElementById('root'));f.root.render(<Root/>);f.remount=()=>{f.root.unmount();f.root=createRoot(document.getElementById('root'));f.root.render(<Root/>);};window.addEventListener('error',event=>f.errors.push(event.message));
`;
async function bundle(){
 const ui=`import React,{createContext,useContext}from'react';import{createPortal}from'react-dom';export const PhoneContext=createContext({active:true});export const usePhoneContext=()=>useContext(PhoneContext);export const usePhoneReducedMotion=()=>true;export const Pressable=React.forwardRef(({children,...props},ref)=>React.createElement('button',{type:'button',...props,ref},children));export const createPhoneWorkflowPortal=node=>createPortal(node,document.body);export const usePhoneBack=()=>{};export const usePhoneOverlayDismiss=()=>{};export const PhoneDialogHeader=props=>React.createElement('header',props);export const PhoneDialogBody=props=>React.createElement('div',props);export const PhoneDialogActions=props=>React.createElement('footer',props);`;
 const replacements={'runtime.mjs':`export const native=true;export const businessStorage=()=>window.fixture.storage;export const saveFile=()=>{throw Error('Controlled export failure');};`,'phone-ui.jsx':ui,'workflow-boundary.jsx':'export const useWorkflowLock=()=>{};','phone-model-picker.jsx':`export const modelCreateStorageKey=()=> 'no-model-request';export const PhoneModelPicker=()=>null;`,'@capacitor/core':`export const Capacitor={getPlatform:()=> 'android'};`,'@battery-inventory/nfc':`export const BatteryNfc=window.fixture.adapter;`};
 const built=await build({stdin:{contents:fixture,resolveDir:root,loader:'jsx'},bundle:true,write:false,format:'esm',platform:'browser',target:'es2022',plugins:[{name:'controlled-boundaries',setup(p){p.onResolve({filter:/\.css$/},a=>({path:a.path,namespace:'empty'}));p.onLoad({filter:/.*/,namespace:'empty'},()=>({contents:'',loader:'js'}));p.onResolve({filter:/.*/},a=>{const key=Object.keys(replacements).find(key=>a.path===key||a.path.endsWith('/'+key));return key?{path:key,namespace:'boundary'}:undefined;});p.onLoad({filter:/.*/,namespace:'boundary'},a=>({contents:replacements[a.path],loader:'jsx',resolveDir:root}));}}]});return built.outputFiles[0].text;
}
let compiled;const options={skip:!runtime&&'Set MOBILE_BROWSER_TEST_MODULE for real React DOM checks.'};
async function mount(t,scenario='saved',viewport={width:412,height:828}){
 const browser=await runtime.chromium.launch({headless:true,...(process.env.MOBILE_BROWSER_TEST_CHANNEL?{channel:process.env.MOBILE_BROWSER_TEST_CHANNEL}:{})});t.after(()=>browser.close());const page=await browser.newPage({viewport});page.setDefaultTimeout(7000);const errors=[];page.on('pageerror',e=>errors.push(e.message));t.after(()=>assert.deepEqual(errors,[]));
 const styles=await Promise.all(['features/lifecycle/intake.css','features/scan/workflow-controls.css','app/phone-choice.css','app/phone.css','features/scan/ink-orb.css'].map(file=>readFile(new URL('../src/'+file,import.meta.url),'utf8')));
 await page.route('https://intake.fixture.test/',route=>route.fulfill({contentType:'text/html',body:'<style>'+styles.join('\n').replace(/@import[^;]+;/g,'')+'html,body,#root{height:100%;margin:0}body{overflow:hidden;background:#f7f9fc}button{cursor:pointer}*{box-sizing:border-box}</style><div id="root"></div>'}));
 await page.goto('https://intake.fixture.test/');await page.evaluate(value=>window.scenario=value,scenario);compiled??=await bundle();await page.addScriptTag({content:compiled,type:'module'});try{await page.getByRole('heading',{name:scenario==='new'?'Battery details':scenario==='uncertain'?'Review queue · 1':'Continue saved intake',exact:true}).waitFor();}catch(error){throw new Error(JSON.stringify({errors,...await page.evaluate(()=>({body:document.body.innerText,html:document.getElementById('root').innerHTML,reads:fixture?.reads.length,stored:fixture?.storage?.entries(),fixtureErrors:fixture?.errors}))}));}return page;
}
async function reviewIfRetained(page){const open=page.getByRole('button',{name:'Review queue, 1 intake draft',exact:true});if(await open.count()){await open.click();await page.getByRole('dialog').waitFor();assert.equal(await page.evaluate(()=>JSON.stringify(fixture.business().entries)===fixture.original),true);await page.getByRole('button',{name:'Close intake review and retain drafts',exact:true}).click();}}
async function prepare(page,name){await page.getByRole('textbox',{name:'Battery name *',exact:true}).fill(name);await page.getByRole('button',{name:'Continue',exact:true}).click();await page.getByRole('heading',{name:'Owner & location',exact:true}).waitFor();await reviewIfRetained(page);await page.getByRole('button',{name:'Continue',exact:true}).click();await page.getByRole('heading',{name:'Ready to scan',exact:true}).waitFor();await reviewIfRetained(page);await page.getByRole('button',{name:'Start scanning',exact:true}).click();await page.waitForFunction(()=>fixture.reads.length===1);}

test('actual restored Intake waits for explicit Continue, exposes complete summary, and Review alone never starts a reader',options,async t=>{
 const page=await mount(t);assert.equal(await page.evaluate(()=>fixture.reads.length),0);assert.equal(await page.locator('.ink-orb').count(),0);
 await page.getByText('Responsible fixture owner · fixture.staff',{exact:true}).waitFor();await page.getByText('J18 · Fixture storage room',{exact:true}).waitFor();await page.getByText('Specifications, dates & model evidence',{exact:true}).click();await page.getByText('Li-ion · 3200 mAh · 3.7 V',{exact:true}).waitFor();await page.getByText('Each confirmed registration date in Sydney',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Review saved drafts · 1',exact:true}).click();await page.getByRole('dialog').waitFor();assert.equal(await page.evaluate(()=>fixture.reads.length),0);await page.getByRole('button',{name:'Close intake review and retain drafts',exact:true}).click();await page.getByRole('button',{name:'Continue with these details',exact:true}).click();await page.waitForFunction(()=>fixture.reads.length===1);
 assert.equal(await page.evaluate(()=>JSON.stringify(fixture.business().entries)===fixture.original),true);assert.equal(await page.evaluate(()=>fixture.posts),0);await page.getByRole('button',{name:'View current batch details',exact:true}).click();await page.getByText('Responsible fixture owner · fixture.staff',{exact:true}).waitFor();
});

test('actual Set details pre-fills old batch, keeps Review during all preparation steps, and new prepare preserves native entries',options,async t=>{
 const page=await mount(t);await page.getByRole('button',{name:'Set details for next scans',exact:true}).click();await page.getByRole('heading',{name:'Battery details',exact:true}).waitFor();assert.equal(await page.getByRole('textbox',{name:'Battery name *',exact:true}).inputValue(),'Saved battery');assert.equal(await page.evaluate(()=>fixture.business().batch),null);
 await page.getByRole('button',{name:'Review queue, 1 intake draft',exact:true}).click();await page.getByRole('dialog').waitFor();assert.equal(await page.evaluate(()=>JSON.stringify(fixture.business().entries)===fixture.original),true);await page.getByRole('button',{name:'Close intake review and retain drafts',exact:true}).click();
 await prepare(page,'Next batch name');assert.equal(await page.evaluate(()=>fixture.business().batch.common.name),'Next batch name');assert.equal(await page.evaluate(()=>JSON.stringify(fixture.business().entries)===fixture.original),true);assert.equal(await page.evaluate(()=>fixture.business().batch.source),'native_nfc');assert.equal(await page.evaluate(()=>fixture.posts),0);assert.equal(await page.getByRole('heading',{name:'Continue saved intake',exact:true}).count(),0);
});

test('actual new preparation completes all three steps and starts directly without a restored-batch gate',options,async t=>{
 const page=await mount(t,'new');assert.equal(await page.evaluate(()=>fixture.reads.length),0);await prepare(page,'New prepared battery');assert.equal(await page.evaluate(()=>fixture.business().entries.length),0);assert.equal(await page.getByRole('heading',{name:'Continue saved intake',exact:true}).count(),0);assert.equal(await page.evaluate(()=>fixture.haptics.length),0);assert.equal(await page.evaluate(()=>fixture.posts),0);
});

test('actual unavailable saved owner and model block Continue without red tag feedback or replacing drafts',options,async t=>{
 for(const kind of ['owner','model']){
  const page=await mount(t,kind==='model'?'model':'saved');if(kind==='owner')await page.evaluate(()=>fixture.update({staffDirectory:[{id:'STAFF-A',active:false}]}));else await page.evaluate(()=>fixture.choices=[]);
  if(kind==='owner')await page.getByText('Unavailable saved owner · owner-a',{exact:true}).waitFor();await page.getByRole('button',{name:'Continue with these details',exact:true}).click();await page.getByRole('alert').filter({hasText:kind==='owner'?'active native staff':'saved model is unavailable'}).waitFor();
  assert.equal(await page.evaluate(()=>fixture.reads.length),0);assert.equal(await page.evaluate(()=>fixture.haptics.length),0);assert.equal(await page.evaluate(()=>JSON.stringify(fixture.business().entries)===fixture.original),true);assert.equal(await page.evaluate(()=>fixture.posts),0);await page.close();
 }
});

test('actual uncertain request opens original Review immediately; configuration cannot replace it',options,async t=>{
 const page=await mount(t,'uncertain');await page.getByRole('button',{name:'Check original request',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Continue with these details',exact:true}).count(),0);assert.equal(await page.evaluate(()=>fixture.reads.length),0);assert.equal(await page.evaluate(()=>fixture.posts===fixture.beforePosts),true);assert.equal(await page.evaluate(()=>JSON.stringify(fixture.business().attempt)===fixture.originalAttempt),true);assert.equal(await page.getByRole('button',{name:'Close intake review and retain drafts',exact:true}).isDisabled(),true);
});

test('actual failed future-common save leaves the old batch and entries recoverable, and form failures do not create a red scan outcome',options,async t=>{
 const page=await mount(t);await page.evaluate(()=>fixture.failSave=true);await page.getByRole('button',{name:'Set details for next scans',exact:true}).click();await page.getByText('Technical details',{exact:true}).first().click();await page.getByRole('alert').filter({hasText:'Controlled local save failed'}).waitFor();assert.equal(await page.evaluate(()=>fixture.durableBusiness().batch.common.name),'Saved battery');assert.equal(await page.evaluate(()=>JSON.stringify(fixture.durableBusiness().entries)===fixture.original),true);assert.equal(await page.evaluate(()=>fixture.haptics.length),0);assert.equal(await page.locator('.ink-failure').count(),0);assert.equal(await page.evaluate(()=>fixture.posts),0);
 await page.evaluate(()=>fixture.failSave=false);await page.getByRole('button',{name:'Retry common save',exact:true}).click();await page.getByRole('button',{name:'Set details for next scans',exact:true}).click();await page.getByRole('heading',{name:'Battery details',exact:true}).waitFor();assert.equal(await page.evaluate(()=>JSON.stringify(fixture.business().entries)===fixture.original),true);
});

test('actual resume summary stays within width and all actions remain scroll-reachable on a small or large-font page',options,async t=>{
 for(const large of [false,true]){
  const page=await mount(t,'saved',{width:320,height:640});if(large)await page.addStyleTag({content:'.mobile-intake :is(button,p,dt,dd,summary,small){font-size:24px!important;line-height:1.5!important}.mi-focused-title h1{font-size:30px!important}'});await page.getByText('Specifications, dates & model evidence',{exact:true}).click();
  for(const name of ['Continue with these details','Review saved drafts · 1','Set details for next scans']){const button=page.getByRole('button',{name,exact:true});await button.scrollIntoViewIfNeeded();const rect=await button.boundingBox();assert.ok(rect.x>=-1&&rect.x+rect.width<=321);assert.ok(rect.y>=0&&rect.y+rect.height<=641);}
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.equal(await page.evaluate(()=>fixture.reads.length),0);await page.close();
 }
});


test('actual delayed Continue cannot arm NFC after the surface hides and returns before model verification settles',options,async t=>{
 const page=await mount(t,'model');await page.evaluate(()=>fixture.holdModels());await page.getByRole('button',{name:'Continue with these details',exact:true}).click();await page.getByRole('button',{name:'Checking details…',exact:true}).waitFor();assert.equal(await page.evaluate(()=>fixture.reads.length),0);
 await page.evaluate(()=>fixture.setActive(false));await page.waitForFunction(()=>fixture.renderedActive===false);await page.evaluate(()=>fixture.setActive(true));await page.waitForFunction(()=>fixture.renderedActive===true);await page.evaluate(()=>fixture.releaseModels());await page.getByRole('button',{name:'Continue with these details',exact:true}).waitFor();assert.equal(await page.evaluate(()=>fixture.reads.length),0);assert.equal(await page.evaluate(()=>JSON.stringify(fixture.business().entries)===fixture.original),true);
 await page.getByRole('button',{name:'Continue with these details',exact:true}).click();await page.waitForFunction(()=>fixture.reads.length===1);assert.equal(await page.evaluate(()=>fixture.posts),0);
});

test('actual non-acquisition export failure remains in Details and never becomes a scanner red outcome',options,async t=>{
 const page=await mount(t);await page.getByRole('button',{name:'Continue with these details',exact:true}).click();await page.waitForFunction(()=>fixture.reads.length===1);await page.getByRole('button',{name:'View current batch details',exact:true}).click();await page.evaluate(()=>fixture.failSave=true);await page.getByRole('button',{name:'Set details for next scans',exact:true}).click();await page.getByRole('button',{name:'Export preserved data',exact:true}).click();await page.getByRole('alert').filter({hasText:'Controlled export failure'}).waitFor();assert.equal(await page.evaluate(()=>fixture.haptics.length),0);assert.equal(await page.locator('.ink-failure').count(),0);assert.equal(await page.evaluate(()=>fixture.posts),0);
});


test('actual hidden-document Continue invalidates its pending model check across foreground return',options,async t=>{
 const page=await mount(t,'model');await page.evaluate(()=>fixture.holdModels());await page.getByRole('button',{name:'Continue with these details',exact:true}).click();await page.getByRole('button',{name:'Checking details…',exact:true}).waitFor();
 await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});document.dispatchEvent(new Event('visibilitychange'));});assert.equal(await page.evaluate(()=>fixture.reads.length),0);
 await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});document.dispatchEvent(new Event('visibilitychange'));fixture.releaseModels();});await page.getByRole('button',{name:'Continue with these details',exact:true}).waitFor();assert.equal(await page.evaluate(()=>fixture.reads.length),0);assert.equal(await page.evaluate(()=>JSON.stringify(fixture.business().entries)===fixture.original),true);assert.equal(await page.evaluate(()=>fixture.posts),0);
});


test('actual Exit ends an empty prepared session but reopening restores editable common parameters without NFC',options,async t=>{
 const page=await mount(t,'new');await prepare(page,'Empty configured batch');await page.getByRole('button',{name:'Exit intake',exact:true}).click();await page.waitForFunction(()=>fixture.exits===1);assert.equal(await page.evaluate(()=>fixture.business()),null);await page.evaluate(()=>fixture.remount());await page.getByRole('heading',{name:'Battery details',exact:true}).waitFor();assert.equal(await page.getByRole('textbox',{name:'Battery name *',exact:true}).inputValue(),'Empty configured batch');assert.equal(await page.evaluate(()=>fixture.reads.length),1,'Remount does not request another controlled native read');assert.equal(await page.evaluate(()=>fixture.posts),0);await page.getByText('Saved preparation restored. Review these details before scanning.',{exact:true}).waitFor();
});

test('actual failed empty-batch Exit retains the old batch until explicit device-save retry and never reports a tag failure',options,async t=>{
 const page=await mount(t,'new');await prepare(page,'Protected empty batch');await page.evaluate(()=>fixture.failSave=true);await page.getByRole('button',{name:'Exit intake',exact:true}).click();await page.getByText('Common details need a device save',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>fixture.exits),0);assert.equal(await page.evaluate(()=>fixture.durableBusiness().batch.common.name),'Protected empty batch');assert.equal(await page.evaluate(()=>fixture.durableBusiness().entries.length),0);assert.equal(await page.evaluate(()=>fixture.haptics.length),0);assert.equal(await page.evaluate(()=>fixture.posts),0);
 await page.evaluate(()=>fixture.failSave=false);await page.getByRole('button',{name:'Retry common save',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('[aria-label="Exit intake"]').disabled);await page.getByRole('button',{name:'Exit intake',exact:true}).click();await page.waitForFunction(()=>fixture.exits===1);await page.evaluate(()=>fixture.remount());await page.getByRole('heading',{name:'Battery details',exact:true}).waitFor();assert.equal(await page.getByRole('textbox',{name:'Battery name *',exact:true}).inputValue(),'Protected empty batch');assert.equal(await page.evaluate(()=>fixture.posts),0);
});

test('actual Exit with two retained native entries preserves their complete bytes and writes no additional preparation form',options,async t=>{
 const page=await mount(t,'saved-two');assert.equal(await page.evaluate(()=>fixture.storage.getItem(fixture.formKey)),null);await page.getByRole('button',{name:'Exit intake',exact:true}).click();await page.waitForFunction(()=>fixture.exits===1);assert.equal(await page.evaluate(()=>JSON.stringify(fixture.business().entries)===fixture.original),true);assert.equal(await page.evaluate(()=>JSON.stringify(fixture.business())===fixture.originalDraft),true);assert.equal(await page.evaluate(()=>Object.hasOwn(fixture.storage.entries(),fixture.formKey)),false);assert.equal(await page.evaluate(()=>fixture.posts),0);assert.equal(await page.evaluate(()=>fixture.reads.length),0);
});
