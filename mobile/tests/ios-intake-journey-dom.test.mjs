import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

// Real iOS UI, ownership, evidence, controller and durable-store code. Only the
// native boundary and HTTP responses are controlled; no service or phone is used.
let runtime;
try { runtime = createRequire(import.meta.url)(process.env.MOBILE_BROWSER_TEST_MODULE || 'playwright'); } catch {}
const options = { skip: !runtime && 'Set MOBILE_BROWSER_TEST_MODULE for the real iOS intake journey checks.', timeout: 45_000 };
const root = fileURLToPath(new URL('../', import.meta.url));
let compiled;
const fixture = `
import React from 'react';import{createRoot}from'react-dom/client';
import{MobileIntake}from'./src/features/lifecycle/intake.jsx';
import{PhoneUIProvider}from'./src/app/phone-ui.jsx';
import{FloatingWorkflow}from'./src/app/floating-workflow.jsx';
import{activateIosPresentation}from'./src/app/ios-runtime-presentation.mjs';
import{createDurableStorage}from'./src/platform/durable-storage.mjs';
import{intakeDefaultValues,reviewedIntakeCommon}from'./src/features/lifecycle/intake-controller.mjs';
import{captureIntakeDraft}from'./src/shared/lib/intake-draft.js';
import{currentSydneyDate}from'./src/shared/lib/battery-age.js';
import './src/app/phone.css';import './src/app/ios-presentation.css';
const f=window.fixture={reads:[],cancels:0,requests:[],posts:[],haptics:[],errors:[],exits:0,scenario:new URL(location.href).searchParams.get('scenario')||'new'};
window.addEventListener('unhandledrejection',e=>f.errors.push(e.reason?.message||String(e.reason)));
const account='IOS-JOURNEY-STAFF',key='battery-intake:'+account+':demo';
const data=f.data={dataset:'demo',user:{id:account,role:'staff',username:'ios.journey',displayName:'Journey staff'},batteries:[],people:[{id:'IOS-OWNER',accountId:account,name:'Journey owner',role:'staff'}],staffDirectory:[{id:account,username:'ios.journey',active:true}],rooms:[{id:'IOS-ROOM',name:'Journey storage room',buildingId:'J18',selectable:true}],buildings:[{id:'J18',name:'Willis Annexe'}]};
const common=reviewedIntakeCommon(data,{...intakeDefaultValues(data,account),name:'Retained battery',homeRoomId:'IOS-ROOM'},'at_registration');
const at=new Date().toISOString(),sessionId=crypto.randomUUID();
const evidence=uid=>({attemptId:crypto.randomUUID(),source:'native-nfc-reader',platform:'ios',startedAt:at,endedAt:at,adoptedAt:at,tagId:'nfc:uid:'+uid,result:{uidHex:uid,technology:'Controlled NFC-A fixture',ndefStatus:'readWrite',capacityBytes:144,records:[],observedAt:at}});
const seedCount=f.scenario==='limit'?199:f.scenario==='uncertain'?3:0;
const entries=Array.from({length:seedCount},(_,i)=>{const uid=(1000+i).toString(16).padStart(8,'0').toUpperCase(),nfcEvidence=evidence(uid);return{id:crypto.randomUUID(),sessionId,tagId:nfcEvidence.tagId,scannedAt:at,common,firstUseMode:'at_registration',selected:true,error:'',source:'native_nfc',nfcEvidence};});
const seed=seedCount?captureIntakeDraft({actorAccountId:account,dataset:'demo',batch:{sessionId,common,firstUseMode:'at_registration',source:'native_nfc'},entries,attempt:null,attemptEntryId:null,completed:[]}):null;
let disk=seed?JSON.stringify({schemaVersion:1,entries:{[key]:JSON.stringify(seed)}}):null;
f.storage=createDurableStorage({load:async()=>disk,save:async value=>{disk=value;}});await f.storage.initialize();
window.__batteryWorkflowStorage=f.storage;window.__batteryMobileHaptic=async duration=>f.haptics.push(duration);
f.business=()=>JSON.parse(f.storage.getItem(key)||'null');f.disk=()=>JSON.parse(JSON.parse(disk).entries[key]||'null');
f.original=JSON.stringify(seed?.entries||[]);
f.adapter={getAvailability:async()=>({available:true,enabled:true,platform:'ios'}),read(options){return new Promise((resolve,reject)=>f.reads.push({options:{...options},resolve,reject,settled:false}));},cancel:async()=>{f.cancels++;const read=f.reads.at(-1);if(read&&!read.settled){read.settled=true;read.reject(Object.assign(Error('Controlled cancellation'),{code:'CANCELLED'}));}}};
f.deliver=(uid,readerSessionId='ios-physical-session-1')=>{const read=f.reads.at(-1);if(!read||read.settled)throw Error('No pending controlled read');read.settled=true;read.resolve({uidHex:uid,technology:'Controlled NFC-A fixture',ndefStatus:'readWrite',capacityBytes:144,records:[{tnf:1,typeHex:'54',idHex:'',payloadHex:'02656E74657374'}],observedAt:new Date().toISOString(),readerSessionId});};
f.cancelFromSystem=()=>{const read=f.reads.at(-1);if(!read||read.settled)throw Error('No pending controlled read');read.settled=true;read.reject(Object.assign(Error('Controlled system cancellation'),{code:'CANCELLED'}));};
let visibility='visible';Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>visibility});
f.setVisibility=value=>{visibility=value;document.dispatchEvent(new Event('visibilitychange'));};
const receipts=new Map();let lost=false;
window.fetch=async(input,options={})=>{
 const path=String(input);f.requests.push({path,method:options.method||'GET'});
 if(path.startsWith('/api/battery-models')&&!options.method)return new Response(JSON.stringify({dataset:'demo',models:[],issues:[]}),{status:200});
 if(path==='/api/inventory'&&options.method==='POST'){
  const body=JSON.parse(options.body);if(body.action!=='intake'||body.dataset!=='demo')throw Error('Unexpected controlled action');
  const p=body.payload;f.posts.push({payload:structuredClone(p),durableAtSend:f.disk()});
  let receipt=receipts.get(p.requestId),replayed=!!receipt;
  if(!receipt){const now=new Date().toISOString(),c=p.common;receipt={requestId:p.requestId,sessionId:p.sessionId,dataset:'demo',actorAccountId:account,batteryId:'BAT-'+String(receipts.size+1).padStart(8,'0'),tagId:p.tagId,registeredAt:now,replayed:false,source:p.source||'simulated_intake',...(p.scannedAt?{scannedAt:p.scannedAt}:{}),...(p.nfcEvidence?{nfcEvidence:structuredClone(p.nfcEvidence)}:{}),...Object.fromEntries(['name','model','chemistry','capacityMah','voltage','ownerId','homeBuildingId','homeRoomId','manufacturedOn'].map(field=>[field,c[field]])),firstUsedOn:p.firstUseMode==='at_registration'?currentSydneyDate(new Date(now)):p.firstUseMode==='date'?c.firstUsedOn:null};receipts.set(p.requestId,receipt);}
  if(f.scenario==='uncertain'&&receipts.size===2&&!lost){lost=true;throw Error('Controlled lost response after registration');}
  return new Response(JSON.stringify({result:{...receipt,replayed}}),{status:200});
 }
 f.errors.push('Unexpected fixture request '+path);throw Error('No external request is allowed');
};
activateIosPresentation(document,true);
function Harness(){return <PhoneUIProvider namespace={account+':demo'} reducedMotion={true}><div className="phone-app ios-shell"><FloatingWorkflow open label="Intake fixture" iosPresentation reducedMotion owner="ios-intake-journey"><MobileIntake data={data} onChanged={async()=>{}} onExit={()=>{f.exits++;}}/></FloatingWorkflow></div></PhoneUIProvider>;}
f.root=createRoot(document.getElementById('root'));f.root.render(<Harness/>);
`;

async function bundle() {
  const replacements = {
    '@capacitor/core': `export const Capacitor={getPlatform:()=> 'ios',isNativePlatform:()=>true};`,
    '@battery-inventory/nfc': `export const BatteryNfc={getAvailability:(...args)=>window.fixture.adapter.getAvailability(...args),read:(...args)=>window.fixture.adapter.read(...args),cancel:(...args)=>window.fixture.adapter.cancel(...args)};`,
    'runtime.mjs': `export const native=true;export const businessStorage=()=>window.fixture.storage;export const saveFile=async value=>{window.fixture.exports??=[];window.fixture.exports.push(value.filename);};`,
  };
  const output = await build({ stdin: { contents: fixture, resolveDir: root, loader: 'jsx' }, bundle: true, write: false, outfile: 'ios-intake-fixture.js', jsx: 'automatic', format: 'esm', platform: 'browser', target: 'es2022', plugins: [{ name: 'controlled-native-and-transport', setup(api) {
    api.onResolve({ filter: /.*/ }, args => { const key = Object.keys(replacements).find(key => args.path === key || args.path.endsWith('/' + key)); if (key) return { path: key, namespace: 'controlled' }; });
    api.onLoad({ filter: /.*/, namespace: 'controlled' }, args => ({ contents: replacements[args.path], loader: 'js' }));
  } }] });
  return { js: output.outputFiles.find(file => file.path.endsWith('.js')).text, css: output.outputFiles.find(file => file.path.endsWith('.css')).text };
}

async function mount(t, scenario = 'new') {
  compiled ||= await bundle();
  const browser = await runtime.chromium.launch({ channel: process.env.MOBILE_BROWSER_TEST_CHANNEL || 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  page.setDefaultTimeout(10_000);
  const errors = [], requests = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    if (new URL(route.request().url()).origin !== 'https://ios-intake.fixture.test') { requests.push(route.request().url()); return route.abort(); }
    return route.fulfill({ contentType: 'text/html', body: '<meta name="viewport" content="width=device-width,initial-scale=1"><style>' + compiled.css + '</style><div id="root"></div><script type="module">' + compiled.js.replaceAll('</script', '<\\/script') + '</script>' });
  });
  t.after(async () => { const fixtureErrors = await page.evaluate(() => window.fixture?.errors || []).catch(() => []); await browser.close(); assert.deepEqual(errors, []); assert.deepEqual(requests, []); assert.deepEqual(fixtureErrors, []); });
  await page.goto('https://ios-intake.fixture.test/?scenario=' + scenario);
  await page.getByRole('heading', { name: scenario === 'new' ? 'Battery details' : 'Continue saved intake', exact: true }).waitFor();
  assert.equal(await page.locator('body').getAttribute('data-ios-presentation'), 'true');
  assert.equal(await page.locator('.ios-workflow').count(), 1);
  return page;
}

async function waitReads(page, count) { await page.waitForFunction(count => fixture.reads.length === count, count); }
async function waitEntries(page, count) { await page.waitForFunction(count => fixture.business()?.entries.length === count && fixture.disk()?.entries.length === count, count); }
async function stableReads(page, count) { await page.waitForTimeout(375); assert.equal(await page.evaluate(() => fixture.reads.length), count); }
const review = (page, count) => page.getByRole('button', { name: `Review queue, ${count} intake ${count === 1 ? 'draft' : 'drafts'}`, exact: true }).click();

test('actual iOS intake prepares once, reuses a reader session, and requires deliberate continuation after cancel and background', options, async t => {
  const page = await mount(t);
  assert.equal(await page.evaluate(() => fixture.reads.length), 0);
  await page.getByRole('textbox', { name: 'Battery name *', exact: true }).fill('Journey battery');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('heading', { name: 'Owner & location', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('heading', { name: 'Ready to scan', exact: true }).waitFor();
  assert.equal(await page.evaluate(() => fixture.reads.length), 0);
  await page.getByRole('button', { name: 'Open scanner', exact: true }).click(); await stableReads(page, 0);
  await page.getByRole('button', { name: 'Start scanning', exact: true }).click(); await waitReads(page, 1);
  const acquisitionTheme = await page.evaluate(() => {
    const orb = document.querySelector('.mi-focused-orb .ink-orb');
    const body = orb.querySelector('[data-ink-body]');
    const button = document.querySelector('.mi-focused-tabs>.scan-more-input>button');
    const color = value => value.match(/[\d.]+/g).map(Number);
    const fg = color(getComputedStyle(button).color);
    let bg = [16, 20, 27];
    const layers = [];
    for (let node = button; node; node = node.parentElement) layers.push(color(getComputedStyle(node).backgroundColor));
    for (const layer of layers.reverse()) {
      const alpha = layer[3] ?? 1;
      bg = bg.map((channel, i) => layer[i] * alpha + channel * (1 - alpha));
    }
    const luminance = rgb => rgb.slice(0, 3).map(channel => { const c = channel / 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; }).reduce((sum, value, i) => sum + value * [.2126, .7152, .0722][i], 0);
    const a = luminance(fg), b = luminance(bg);
    return { base: getComputedStyle(orb).getPropertyValue('--ink-orb-base-color').trim(), render: getComputedStyle(orb).getPropertyValue('--ink-orb-render-color').trim(), fill: getComputedStyle(body).fill, color: getComputedStyle(button).color, contrast: (Math.max(a, b) + .05) / (Math.min(a, b) + .05) };
  });
  assert.equal(acquisitionTheme.base, '#438cec');
  assert.equal(acquisitionTheme.render, '#438cec');
  assert.equal(acquisitionTheme.fill, 'rgb(67, 140, 236)');
  assert.equal(acquisitionTheme.color, 'rgb(154, 196, 255)');
  assert.ok(acquisitionTheme.contrast >= 4.5, `More input contrast: ${acquisitionTheme.contrast}`);
  assert.deepEqual(await page.evaluate(() => fixture.reads[0].options), { timeoutMs: 60000, keepSessionAlive: true });
  await page.evaluate(() => fixture.deliver('0004AB01')); await waitEntries(page, 1); await waitReads(page, 2);
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.mi-focused-orb [data-ink-body]')).fill === 'rgb(69, 169, 122)');
  assert.equal(await page.evaluate(() => fixture.reads[1].options.sessionId), 'ios-physical-session-1');
  await page.evaluate(() => fixture.deliver('0004AB02')); await waitEntries(page, 2); await waitReads(page, 3);
  const captured = await page.evaluate(() => fixture.business().entries);
  assert.deepEqual(captured.map(entry => entry.tagId), ['nfc:uid:0004AB01', 'nfc:uid:0004AB02']);
  assert.ok(captured.every(entry => entry.source === 'native_nfc' && entry.nfcEvidence.platform === 'ios' && !('readerSessionId' in entry.nfcEvidence.result)));
  assert.equal(await page.evaluate(() => fixture.posts.length), 0);
  await page.evaluate(() => fixture.cancelFromSystem());
  await page.getByRole('button', { name: 'Continue scanning', exact: true }).waitFor(); await stableReads(page, 3);
  await page.waitForFunction(() => {
    const orb = document.querySelector('.mi-focused-orb .ink-orb');
    return getComputedStyle(orb.querySelector('[data-ink-body]')).fill === 'rgb(67, 140, 236)';
  });
  await page.getByRole('button', { name: 'Continue scanning', exact: true }).click(); await waitReads(page, 4);
  assert.equal(await page.evaluate(() => fixture.reads[3].options.sessionId), undefined);
  await page.evaluate(() => fixture.setVisibility('hidden'));
  await page.waitForFunction(() => fixture.reads[3].settled);
  await page.evaluate(() => fixture.setVisibility('visible'));
  await page.getByRole('button', { name: 'Continue scanning', exact: true }).waitFor(); await stableReads(page, 4);
  await page.getByRole('button', { name: 'Continue scanning', exact: true }).click(); await waitReads(page, 5);
  await review(page, 2); await page.getByRole('heading', { name: 'Review queue · 2', exact: true }).waitFor();
  await page.waitForFunction(() => fixture.reads[4].settled); await stableReads(page, 5);
  assert.equal(await page.locator('.mi-review-row').count(), 2);
  assert.deepEqual(await page.evaluate(() => fixture.disk().entries), captured);
  assert.equal(await page.evaluate(() => fixture.posts.length), 0);
});

test('actual iOS restored intake keeps 200 drafts, rejects a 201st tag, and retains Review and removal controls', options, async t => {
  const page = await mount(t, 'limit');
  assert.equal(await page.evaluate(() => fixture.reads.length), 0);
  await page.getByRole('button', { name: 'Continue with these details', exact: true }).click(); await stableReads(page, 0);
  await page.getByRole('button', { name: 'Start scanning', exact: true }).click(); await waitReads(page, 1);
  await page.evaluate(() => fixture.deliver('0004FF00')); await waitEntries(page, 200); await waitReads(page, 2);
  await page.evaluate(() => fixture.deliver('0004FF01'));
  await page.getByText('Review at most 200 intake drafts. Confirm or remove entries before adding another.', { exact: true }).waitFor();
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.mi-focused-orb [data-ink-body]')).fill === 'rgb(223, 100, 102)');
  await stableReads(page, 2);
  assert.equal(await page.evaluate(() => fixture.disk().entries.length), 200);
  assert.equal(await page.evaluate(() => fixture.disk().entries.some(entry => entry.tagId === 'nfc:uid:0004FF01')), false);
  assert.equal(await page.evaluate(() => fixture.posts.length), 0);
  await review(page, 200); await page.getByRole('heading', { name: 'Review queue · 200', exact: true }).waitFor();
  assert.equal(await page.locator('.mi-review-row').count(), 200);
  await page.getByRole('button', { name: 'Remove draft nfc:uid:0004FF00', exact: true }).click(); await waitEntries(page, 199);
  assert.equal(await page.locator('.mi-review-row').count(), 199);
  assert.equal(await page.evaluate(() => JSON.stringify(fixture.disk().entries) === fixture.original), true);
  await stableReads(page, 2);
});

test('actual iOS Review persists the original request before HTTP and recovery does not register the remaining draft', options, async t => {
  const page = await mount(t, 'uncertain');
  await page.getByRole('button', { name: 'Review saved drafts · 3', exact: true }).click();
  await page.getByRole('button', { name: 'Register selected (3)', exact: true }).click();
  await page.getByText('Result not confirmed', { exact: true }).last().waitFor();
  await page.waitForFunction(() => fixture.posts.length === 2 && fixture.disk().attempt !== null);
  const original = await page.evaluate(() => fixture.disk().attempt);
  const retained = await page.evaluate(() => fixture.disk().entries.at(-1));
  assert.equal(await page.evaluate(() => fixture.disk().completed.length), 1);
  assert.equal(await page.evaluate(() => fixture.disk().entries.length), 2);
  assert.equal(await page.getByRole('button', { name: 'Close intake review and retain drafts', exact: true }).isDisabled(), true);
  assert.equal(await page.getByRole('button', { name: 'Register selected (2)', exact: true }).isDisabled(), true);
  for (const post of await page.evaluate(() => fixture.posts)) assert.deepEqual(post.durableAtSend.attempt.payload, post.payload);
  await page.getByRole('button', { name: 'Check original request', exact: true }).click();
  await page.waitForFunction(() => fixture.posts.length === 3 && fixture.disk().attempt === null && fixture.disk().completed.length === 2);
  assert.deepEqual(await page.evaluate(() => fixture.posts[2].payload), original.payload);
  assert.deepEqual(await page.evaluate(() => fixture.disk().entries), [retained]);
  assert.equal(await page.locator('.mi-review-row').count(), 1);
  assert.equal(await page.getByRole('button', { name: 'Register selected (1)', exact: true }).isEnabled(), true);
  await stableReads(page, 0);
  assert.equal(await page.evaluate(() => fixture.posts.length), 3);
  assert.equal(await page.evaluate(() => fixture.disk().completed[1].replayed), true);
});
