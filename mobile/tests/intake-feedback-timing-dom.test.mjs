import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

// Real React DOM and the actual Intake, orb, reader, bridge, feedback and durable
// controller execute in a headless desktop browser. Only platform/UI boundaries
// and unrelated preparation/choice presentation are controlled. No radio, hosted
// request, application build, mobile package or physical timing is exercised.
let browserRuntime;
try { browserRuntime = createRequire(import.meta.url)(process.env.MOBILE_BROWSER_TEST_MODULE || 'playwright'); } catch {}
const root = fileURLToPath(new URL('../',import.meta.url));
const fixture = `
import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {MobileIntake} from './src/features/lifecycle/intake.jsx';
import {createIntakeController,intakeDefaultValues} from './src/features/lifecycle/intake-controller.mjs';
import {createDurableStorage} from './src/platform/durable-storage.mjs';
import {PhoneContext} from './src/app/phone-ui.jsx';
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
const f=window.fixture={holds:new Set(),saves:[],reads:[],events:[],haptics:[],animations:[],errors:[],posts:0};
let persisted={},waiting=new Map();
f.storage=createDurableStorage({load:async()=>null,save:async raw=>{
 const entries=JSON.parse(raw).entries,key='battery-intake:STAFF-A:demo',before=JSON.parse(persisted[key]||'null'),next=JSON.parse(entries[key]||'null');
 let stage='preparation';
 if((next?.entries.length||0)>(before?.entries.length||0))stage='queue';
 else for(const [key,value]of Object.entries(entries))if(key.startsWith('preference:nfc-evidence:')&&value!==persisted[key]){const report=JSON.parse(value);stage=report.outcome==='pending'?'pending':report.adoptions?.length?'adoption':'raw';}
 f.saves.push({stage,raw});
 if(f.holds.has(stage)){const gate=deferred();waiting.set(stage,gate);try{await gate.promise;}finally{waiting.delete(stage);}}
 persisted=entries;
}});
f.release=(stage,fail=false)=>{const gate=waiting.get(stage);if(!gate)throw Error('Missing held '+stage);fail?gate.reject(Error('Controlled '+stage+' save failure')):gate.resolve();};
f.waiting=()=>[...waiting.keys()];
f.adapter={getAvailability:async()=>({available:true,enabled:true,platform:'android'}),read(){const gate=deferred();f.reads.push({...gate,settled:false});return gate.promise;},async cancel(){const read=f.reads.at(-1);if(read&&!read.settled){read.settled=true;read.reject(Object.assign(Error('Controlled cancellation'),{code:'CANCELLED'}));}}};
f.scan=(valid=true)=>{const read=f.reads.at(-1);if(!read||read.settled)throw Error('No pending controlled read');read.settled=true;read.resolve({uidHex:valid?'0004AB00':'wrong',technology:'Controlled NFC-A output',ndefStatus:'readWrite',capacityBytes:144,records:[],observedAt:new Date().toISOString()});};
window.__batteryMobileHaptic=async duration=>{f.haptics.push(duration);};
window.fetch=()=>{f.posts++;throw Error('A staging fixture must never send a business request');};
const animate=Element.prototype.animate;Element.prototype.animate=function(keyframes,options){f.animations.push({target:this.className,keyframes,options});return animate.call(this,keyframes,options);};
const data={dataset:'demo',user:{id:'STAFF-A',role:'staff'},batteries:[],people:[{id:'staff-person',accountId:'STAFF-A',name:'Fixture staff',role:'staff'}],staffDirectory:[{id:'STAFF-A',active:true}],rooms:[],buildings:[]};
await f.storage.initialize();await createIntakeController({storage:f.storage,data,accountId:'STAFF-A',write:()=>{throw Error('No submission');}}).prepare({...intakeDefaultValues(data,'STAFF-A'),name:'Battery'},'unknown');
function Root(){const[active,setActive]=useState(true),[reduced,setReduced]=useState(false);f.active=active;f.setActive=setActive;f.setReduced=setReduced;return <PhoneContext.Provider value={{active,reduced}}><MobileIntake data={data} write={()=>{f.posts++;throw Error('No submission');}}/></PhoneContext.Provider>;}
f.root=createRoot(document.getElementById('root'));f.root.render(<Root/>);
f.snapshot=()=>({queue:Number.parseInt(document.querySelector('.mi-review-entry b')?.textContent||'0',10),orb:document.querySelector('.ink-orb')?.className||'',title:document.querySelector('.scan-outcome-card strong')?.textContent||'',detail:document.querySelector('.scan-outcome-card>div>span')?.textContent||'',outcome:document.querySelector('.scan-outcome-card')?.dataset.outcome,haptics:f.haptics.length,posts:f.posts});
new MutationObserver(()=>f.events.push(f.snapshot())).observe(document.getElementById('root'),{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['class','data-outcome','data-pulse','aria-label']});
window.addEventListener('error',event=>f.errors.push(event.message));
`;

async function bundle() {
  const ui=`import React,{createContext,useContext}from'react';import{createPortal}from'react-dom';export const PhoneContext=createContext({active:true,reduced:false});export const usePhoneContext=()=>useContext(PhoneContext);export const usePhoneReducedMotion=()=>useContext(PhoneContext).reduced;export const Pressable=React.forwardRef((props,ref)=>React.createElement('button',{...props,ref}));export const createPhoneWorkflowPortal=node=>createPortal(node,document.body);export const usePhoneBack=()=>{};export const usePhoneOverlayDismiss=()=>{};export const PhoneDialogHeader=props=>React.createElement('header',props);export const PhoneDialogBody=props=>React.createElement('div',props);export const PhoneDialogActions=props=>React.createElement('footer',props);`;
  const replacements={
    'runtime.mjs':`export const native=true;export const businessStorage=()=>window.fixture.storage;export const saveFile=()=>{throw Error('No export');};`,
    'phone-ui.jsx':ui,
    'workflow-boundary.jsx':'export const useWorkflowLock=()=>{};',
    'intake-preparation.jsx':'export const CommonFields=()=>null;export const IntakePreparation=()=>null;export const IntakeBatchSummary=()=>null;',
    'phone-model-picker.jsx':"export const modelCreateStorageKey=()=> 'unused-preparation-model-key';",
    'phone-choice.jsx':'export const PhoneChoice=()=>null;',
    '@capacitor/core':"export const Capacitor={getPlatform:()=> 'android'};",
    '@battery-inventory/nfc':'export const BatteryNfc=window.fixture.adapter;',
  };
  const result=await build({stdin:{contents:fixture,resolveDir:root,loader:'jsx'},bundle:true,write:false,jsx:'automatic',format:'esm',platform:'browser',target:'es2022',plugins:[{name:'controlled-boundaries',setup(plugin){
    plugin.onResolve({filter:/\.css$/},args=>({path:args.path,namespace:'empty-css'}));plugin.onLoad({filter:/.*/,namespace:'empty-css'},()=>({contents:'',loader:'js'}));
    plugin.onResolve({filter:/.*/},args=>{const key=Object.keys(replacements).find(key=>args.path===key||args.path.endsWith('/'+key));return key?{path:key,namespace:'controlled'}:undefined;});
    plugin.onLoad({filter:/.*/,namespace:'controlled'},args=>({contents:replacements[args.path],loader:'jsx',resolveDir:root}));
  }}]});
  return result.outputFiles[0].text;
}
const snapshot=page=>page.evaluate(()=>window.fixture.snapshot());
async function mount(t) {
  const browser=await browserRuntime.chromium.launch({headless:true,...(process.env.MOBILE_BROWSER_TEST_CHANNEL?{channel:process.env.MOBILE_BROWSER_TEST_CHANNEL}:{})});t.after(()=>browser.close());
  const page=await browser.newPage();page.setDefaultTimeout(5000);const pageErrors=[];page.on('pageerror',error=>pageErrors.push(error.message));const css=await readFile(new URL('../src/features/scan/ink-orb.css',import.meta.url),'utf8');
  await page.route('https://intake.fixture.test/',route=>route.fulfill({contentType:'text/html',body:`<style>${css}</style><div id="root"></div>`}));
  await page.goto('https://intake.fixture.test/');await page.addScriptTag({content:await bundle(),type:'module'});
  await page.getByRole('button',{name:'Continue with these details',exact:true}).click();
  try { await page.waitForFunction(()=>window.fixture?.reads.length===1); }
  catch(error){assert.fail(JSON.stringify({pageErrors,...await page.evaluate(()=>({secure:window.isSecureContext,uuid:typeof crypto.randomUUID,body:document.body.textContent,fixture:window.fixture?{reads:fixture.reads.length,saves:fixture.saves.length,errors:fixture.errors}:null}))}));}return page;
}
const options={skip:!browserRuntime&&'Set MOBILE_BROWSER_TEST_MODULE to an available Playwright package for real React DOM tests.'};

test('real React: validated raw read is neutral during evidence/adoption/queue saves, and durable count + green + capsule publish together',options,async t=>{
  const page=await mount(t);await page.evaluate(()=>{fixture.holds=new Set(['raw','adoption','queue']);fixture.scan();});
  await page.waitForFunction(()=>fixture.waiting().includes('raw')&&fixture.snapshot().title==='Tag read');let state=await snapshot(page);
  assert.equal(state.queue,0);assert.equal(state.haptics,0);assert.equal(state.posts,0);assert.equal(state.detail,'Preparing review…');assert.doesNotMatch(state.orb,/ink-success|ink-failure/);
  await page.waitForFunction(()=>fixture.animations.some(animation=>animation.target==='ink-orb__activation'));
  const pulses=()=>page.evaluate(()=>fixture.animations.filter(animation=>animation.target==='ink-orb__activation').length);assert.equal(await pulses(),1);
  for(const [release,next]of [['raw','adoption'],['adoption','queue']]){await page.evaluate(stage=>fixture.release(stage),release);await page.waitForFunction(stage=>fixture.waiting().includes(stage),next);state=await snapshot(page);assert.equal(state.queue,0);assert.equal(state.haptics,0);assert.equal(state.title,'Tag read');assert.equal(await pulses(),1,'The same read never repeats neutral activation after evidence/adoption flush');}
  await page.evaluate(()=>fixture.release('queue'));await page.waitForFunction(()=>fixture.snapshot().queue===1&&fixture.snapshot().orb.includes('ink-success'));state=await snapshot(page);
  assert.equal(state.title,'Added to review');assert.equal(state.haptics,1);assert.equal(state.posts,0);assert.equal(await pulses(),2,'One neutral acquisition, then one accepted activation');
  const observations=await page.evaluate(()=>fixture.events);assert.ok(observations.some(state=>state.queue===1));assert.ok(observations.filter(state=>state.queue===1).every(state=>state.orb.includes('ink-success')&&state.outcome==='accepted'),'No committed DOM observation exposes an added queue before its truthful success feedback');
  await page.waitForFunction(()=>fixture.reads.length===2);assert.equal((await snapshot(page)).title,'Added to review','Preparing the next reader does not cover the accepted outcome');
  await page.waitForFunction(()=>!fixture.snapshot().orb.includes('ink-success'));assert.equal((await snapshot(page)).haptics,1,'Deadline expiry never replays the accepted haptic');
  await page.evaluate(()=>{fixture.holds.clear();fixture.scan();});await page.waitForFunction(()=>fixture.snapshot().outcome==='duplicate');state=await snapshot(page);assert.equal(state.queue,1);assert.equal(state.title,'Already recorded');assert.doesNotMatch(state.orb,/ink-success|ink-failure/);assert.equal(state.haptics,2);
  await page.waitForFunction(()=>fixture.reads.length===3);assert.equal((await snapshot(page)).title,'Already recorded','Reader rearm also retains the duplicate outcome');assert.deepEqual(await page.evaluate(()=>fixture.errors),[]);
});

test('real React: invalid native evidence never produces neutral acquired or green accepted feedback',options,async t=>{
  const page=await mount(t);await page.evaluate(()=>fixture.scan(false));await page.waitForFunction(()=>fixture.snapshot().outcome==='fault');const state=await snapshot(page);
  assert.equal(state.queue,0);assert.doesNotMatch(state.orb,/ink-success/);assert.match(state.orb,/ink-failure/);assert.equal(state.haptics,1);assert.equal(state.posts,0);
  assert.equal(await page.evaluate(()=>fixture.events.some(event=>event.title==='Tag read')),false);assert.deepEqual(await page.evaluate(()=>fixture.errors),[]);
});

test('real React: inactive late observed read remains evidence without adoption, queue or accepted feedback',options,async t=>{
  const page=await mount(t);await page.evaluate(()=>{fixture.holds.add('raw');fixture.scan();});await page.waitForFunction(()=>fixture.waiting().includes('raw'));
  await page.evaluate(()=>fixture.setActive(false));await page.waitForFunction(()=>fixture.snapshot().title==='Reading paused');await page.evaluate(()=>fixture.release('raw'));
  await page.waitForFunction(()=>!fixture.waiting().length);const state=await snapshot(page);assert.equal(state.queue,0);assert.equal(state.haptics,0);assert.doesNotMatch(state.orb,/ink-success/);
  assert.equal(await page.evaluate(()=>Object.values(fixture.storage.entries()).map(raw=>JSON.parse(raw)).filter(report=>report.source==='native-nfc-reader').some(report=>report.adoptions?.length)),false);
  await page.evaluate(()=>fixture.setActive(true));await page.waitForFunction(()=>fixture.reads.length===2);assert.notEqual((await snapshot(page)).title,'Tag read','Resuming before another observed tag cannot replay abandoned processing');assert.deepEqual(await page.evaluate(()=>fixture.errors),[]);
});

test('real React: queue save may finish after deactivation but its accepted feedback never arrives late or replays on resume',options,async t=>{
  const page=await mount(t);await page.evaluate(()=>{fixture.holds.add('queue');fixture.scan();});await page.waitForFunction(()=>fixture.waiting().includes('queue'));assert.equal((await snapshot(page)).queue,0);
  await page.evaluate(()=>fixture.setActive(false));await page.waitForFunction(()=>fixture.snapshot().title==='Reading paused');await page.evaluate(()=>fixture.release('queue'));await page.waitForFunction(()=>fixture.snapshot().queue===1);
  let state=await snapshot(page);assert.equal(state.haptics,0);assert.doesNotMatch(state.orb,/ink-success/);assert.notEqual(state.outcome,'accepted');
  const retained=await page.evaluate(()=>JSON.parse(fixture.storage.getItem('battery-intake:STAFF-A:demo')));assert.equal(retained.entries.length,1);assert.equal(retained.entries[0].source,'native_nfc');assert.equal(retained.entries[0].nfcEvidence.tagId,'nfc:uid:0004AB00');assert.equal(retained.attempt,null);
  await page.evaluate(()=>fixture.setActive(true));await page.waitForFunction(()=>fixture.reads.length===2);state=await snapshot(page);assert.equal(state.queue,1);assert.equal(state.haptics,0);assert.doesNotMatch(state.orb,/ink-success/);assert.notEqual(state.outcome,'accepted');assert.equal(state.posts,0);assert.deepEqual(await page.evaluate(()=>fixture.errors),[]);
});

test('real React: a failed queue save keeps evidence fault recovery after the controller disables reading, and one retry clears both latches',options,async t=>{
  const page=await mount(t);await page.evaluate(()=>{fixture.holds.add('queue');fixture.scan();});await page.waitForFunction(()=>fixture.waiting().includes('queue'));await page.evaluate(()=>fixture.release('queue',true));
  await page.waitForFunction(()=>fixture.snapshot().outcome==='fault'&&fixture.snapshot().title==='Review queue not saved');let state=await snapshot(page);assert.equal(state.haptics,0);assert.doesNotMatch(state.orb,/ink-success|ink-failure/);assert.equal(state.posts,0);
  await page.getByRole('button',{name:'Read complete scan message',exact:true}).click();await page.getByRole('button',{name:'Retry device save',exact:true}).waitFor();await page.getByRole('button',{name:'Close message',exact:true}).click();assert.equal((await snapshot(page)).title,'Review queue not saved');await page.evaluate(()=>fixture.setActive(false));await page.waitForFunction(()=>fixture.active===false);await page.evaluate(()=>fixture.setActive(true));await page.waitForFunction(()=>fixture.active===true);await page.evaluate(()=>window.dispatchEvent(new Event('pagehide')));assert.equal((await snapshot(page)).title,'Review queue not saved');await page.evaluate(()=>window.dispatchEvent(new Event('pageshow')));assert.equal((await snapshot(page)).title,'Review queue not saved');assert.equal(await page.evaluate(()=>fixture.reads.length),1);await page.getByRole('button',{name:'Read complete scan message',exact:true}).click();await page.getByRole('button',{name:'Retry device save',exact:true}).waitFor();await page.evaluate(()=>fixture.holds.clear());await page.getByRole('button',{name:'Retry device save',exact:true}).click();await page.getByText('Device save completed. Close this message to continue.',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>JSON.parse(fixture.storage.exportRaw()).persistenceError),null);await page.getByRole('button',{name:'Close message',exact:true}).click();await page.waitForFunction(()=>fixture.reads.length===2);state=await snapshot(page);assert.equal(state.queue,1);assert.notEqual(state.outcome,'fault');assert.equal(state.haptics,0);assert.equal(state.posts,0);assert.doesNotMatch(state.orb,/ink-success|ink-failure/);
});
