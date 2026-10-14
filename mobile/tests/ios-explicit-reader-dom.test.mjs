import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

// Execute the production React reader, ball, feedback, evidence and session
// ownership code. Only native calls are controlled; these are not radio tests.
let runtime;
try { runtime = createRequire(import.meta.url)(process.env.MOBILE_BROWSER_TEST_MODULE || 'playwright'); } catch {}
const options = { skip: !runtime && 'Set MOBILE_BROWSER_TEST_MODULE for the iOS explicit reader DOM checks.', timeout: 30_000 };
const root = fileURLToPath(new URL('../', import.meta.url));
let compiled;
const fixture = `
import React,{useState}from'react';import{createRoot}from'react-dom/client';
import{PhoneUIProvider,PhoneUIBoundary}from'./src/app/phone-ui.jsx';
import{activateIosPresentation}from'./src/app/ios-runtime-presentation.mjs';
import{useOwnedNfcReader}from'./src/features/scan/use-owned-nfc-reader.js';
import{NfcScanControl}from'./src/features/scan/nfc-scan-control.jsx';
import{ScanOutcomeStatus}from'./src/features/scan/outcome-status.jsx';
import{useScanFeedback}from'./src/features/scan/use-scan-feedback.js';
import{createDurableStorage}from'./src/platform/durable-storage.mjs';
const config=window.testConfig;
const f=window.fixture={reads:[],cancels:0,starts:0,acquired:[],errors:[],nextResult:'accepted',saved:null};
window.addEventListener('unhandledrejection',event=>f.errors.push(event.reason?.message||String(event.reason)));
f.storage=createDurableStorage({load:async()=>null,save:async raw=>{f.saved=raw;}});await f.storage.initialize();
f.adapter={getAvailability:async()=>({available:true,enabled:true,platform:'ios'}),read(options){return new Promise((resolve,reject)=>f.reads.push({options:{...options},resolve,reject,settled:false}));},async cancel(){f.cancels++;const read=f.reads.at(-1);if(read&&!read.settled){read.settled=true;read.reject(Object.assign(Error('Controlled cancellation'),{code:'CANCELLED'}));}}};
f.deliver=(uid='0004AB01',sessionId='owned-ios-session')=>{const read=f.reads.at(-1);if(!read||read.settled)throw Error('No pending native read');read.settled=true;read.resolve({uidHex:uid,technology:'Controlled NFC-A fixture',ndefStatus:'readWrite',capacityBytes:137,records:[],observedAt:new Date().toISOString(),...(config.single?{}:{readerSessionId:sessionId})});};
f.reject=(code='CANCELLED',message='Controlled system cancellation')=>{const read=f.reads.at(-1);if(!read||read.settled)throw Error('No pending native read');read.settled=true;read.reject(Object.assign(Error(message),{code}));};
let visibility='visible';Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>visibility});
f.visibility=value=>{visibility=value;document.dispatchEvent(new Event('visibilitychange'));};
function Reader(){
 const[review,setReview]=useState(false),[message,setMessage]=useState(false),[context,setContext]=useState('context-a'),[found,setFound]=useState(false);
 const{feedback,present,beginAcquisition}=useScanFeedback({preferences:{haptics:false,sounds:false},native:true});
 const{reader,resumeReader,cancelReader}=useOwnedNfcReader({storage:f.storage,continuous:!config.single,enabled:!review&&!message&&!found,contextKey:context,onStart:()=>{f.starts++;beginAcquisition();},onObserved:value=>beginAcquisition(value.tagId,value.attemptId,true),onRead:async({proposal,bridge,current})=>{
  if(!current())return;const evidence=await bridge.adopt(proposal);if(!current())return;f.acquired.push(evidence);
  const type=f.nextResult,result={type,message:type==='failure'?'This battery is retired and cannot be checked out.':type==='duplicate'?'This battery is already in the review queue.':'Battery added to review.',acquisitionId:proposal.attemptId,battery:{id:proposal.tagId,name:'Controlled battery'}};present(result);
  if(config.single){setFound(true);await cancelReader('Reading paused · Lookup result is ready');}return result;
 },onFailure:present});
 f.setReview=setReview;f.setContext=setContext;f.resume=resumeReader;f.pause=cancelReader;f.resetLookup=()=>setFound(false);f.reader=reader;f.feedback=feedback;
 return <main><ScanOutcomeStatus reader={reader} feedback={feedback} onOpenChange={open=>{setMessage(open);if(open)void cancelReader('Reading paused · Scan message is open');}}/><NfcScanControl reader={reader} onStart={resumeReader} onPause={cancelReader} batch={!config.single} disabled={review||message||found} active={!review&&!message&&!found} color="blue" feedback={[feedback.tone,feedback.expression].filter(Boolean).join(' ')} sequence={feedback.sequence} event={feedback.event} successSequence={feedback.successSequence}/><button onClick={()=>setReview(value=>!value)}>{review?'Close review':'Review queue'}</button>{found&&<><p>Lookup result is ready</p><button onClick={()=>setFound(false)}>Scan another battery</button></>}</main>;
}
function Harness(){const[active,setActive]=useState(true);f.setActive=setActive;return <PhoneUIProvider namespace="explicit-reader" reducedMotion><PhoneUIBoundary active={active}><Reader/></PhoneUIBoundary></PhoneUIProvider>;}
activateIosPresentation(document,true);f.root=createRoot(document.getElementById('root'));f.root.render(<Harness/>);
`;

async function bundle() {
  const replacements = {
    '@capacitor/core': `export const Capacitor={getPlatform:()=> 'ios',isNativePlatform:()=>true};`,
    '@battery-inventory/nfc': `export const BatteryNfc={getAvailability:(...args)=>window.fixture.adapter.getAvailability(...args),read:(...args)=>window.fixture.adapter.read(...args),cancel:(...args)=>window.fixture.adapter.cancel(...args)};`,
    'runtime.mjs': `export const native=true;export const saveFile=async()=>{};`,
  };
  const result = await build({ stdin: { contents: fixture, resolveDir: root, loader: 'jsx' }, bundle: true, write: false, outfile: 'ios-explicit-fixture.js', jsx: 'automatic', format: 'esm', platform: 'browser', target: 'es2022', plugins: [{ name: 'controlled-native', setup(api) {
    api.onResolve({ filter: /.*/ }, args => { const key = Object.keys(replacements).find(key => args.path === key || args.path.endsWith('/' + key)); if (key) return { path: key, namespace: 'controlled' }; });
    api.onLoad({ filter: /.*/, namespace: 'controlled' }, args => ({ contents: replacements[args.path], loader: 'js' }));
  } }] });
  return { js: result.outputFiles.find(file => file.path.endsWith('.js')).text, css: result.outputFiles.find(file => file.path.endsWith('.css')).text };
}

async function mount(t, config = {}) {
  compiled ||= await bundle();
  const browser = await runtime.chromium.launch({ channel: process.env.MOBILE_BROWSER_TEST_CHANNEL || 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  page.setDefaultTimeout(5_000);
  const errors = [], requests = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    if (new URL(route.request().url()).origin !== 'https://explicit-reader.fixture.test') { requests.push(route.request().url()); return route.abort(); }
    return route.fulfill({ contentType: 'text/html', body: '<meta name="viewport" content="width=device-width,initial-scale=1"><style>body{background:#10141b;color:white}button{min-height:44px}'+compiled.css+'</style><div id="root"></div>' });
  });
  t.after(async () => { const fixtureErrors = await page.evaluate(() => window.fixture?.errors || []).catch(() => []); await browser.close(); assert.deepEqual(errors, []); assert.deepEqual(requests, []); assert.deepEqual(fixtureErrors, []); });
  await page.goto('https://explicit-reader.fixture.test/');
  await page.evaluate(config => { window.testConfig = config; }, config);
  await page.addScriptTag({ content: compiled.js, type: 'module' });
  await page.getByRole('button', { name: 'Start scanning', exact: true }).waitFor();
  return page;
}
const reads = (page, count) => page.waitForFunction(count => fixture.reads.length === count, count);
const started = (page, count) => page.waitForFunction(count => fixture.starts === count, count);
async function stableReads(page, count) { await page.waitForTimeout(650); assert.equal(await page.evaluate(() => fixture.reads.length), count); }
async function start(page) { await page.getByRole('button', { name: /^(Start|Continue) scanning$/ }).click(); }

test('iOS ball explicitly starts once, reuses one batch session and never replaces a cancelled sheet automatically', options, async t => {
  const page = await mount(t);
  await stableReads(page, 0);
  assert.equal(await page.evaluate(() => fixture.reader.manualActivation && fixture.reader.canStart), true);
  // Both clicks run in the same task, before React disables the control.
  await page.locator('.nfc-scan-ball').evaluate(button => { button.click(); button.click(); });
  await reads(page, 1); await started(page, 1);
  await stableReads(page, 1);
  assert.deepEqual(await page.evaluate(() => fixture.reads[0].options), { timeoutMs: 60000, keepSessionAlive: true });
  await page.evaluate(() => fixture.deliver('0004AB01')); await reads(page, 2);
  await page.evaluate(() => fixture.deliver('0004AB02')); await reads(page, 3);
  assert.deepEqual(await page.evaluate(() => fixture.reads.slice(1).map(read => read.options.sessionId)), ['owned-ios-session', 'owned-ios-session']);
  assert.deepEqual(await page.evaluate(() => fixture.acquired.map(value => value.tagId)), ['nfc:uid:0004AB01', 'nfc:uid:0004AB02']);
  assert.ok(await page.evaluate(() => fixture.acquired.every(value => !('readerSessionId' in value.result))));
  await page.evaluate(() => fixture.reject());
  await page.waitForFunction(() => fixture.reader.canStart); await stableReads(page, 3);
  await start(page); await reads(page, 4); await started(page, 2);
  assert.equal(await page.evaluate(() => fixture.reads[3].options.sessionId), undefined);
});

test('iOS review, background return and inactive workflow boundaries require another deliberate tap', options, async t => {
  const page = await mount(t); await start(page); await reads(page, 1);
  await page.getByRole('button', { name: 'Review queue', exact: true }).click();
  await page.waitForFunction(() => fixture.reads[0].settled);
  await page.getByRole('button', { name: 'Close review', exact: true }).click(); await stableReads(page, 1);
  await start(page); await reads(page, 2);
  await page.evaluate(() => fixture.visibility('hidden'));
  await page.waitForFunction(() => fixture.reads[1].settled);
  await page.evaluate(() => fixture.visibility('visible')); await stableReads(page, 2);
  await start(page); await reads(page, 3);
  await page.evaluate(() => fixture.setActive(false));
  await page.waitForFunction(() => fixture.reads[2].settled);
  await page.evaluate(() => fixture.setActive(true)); await stableReads(page, 3);
  await start(page); await reads(page, 4);
});

test('iOS context replacement cancels the previous pending reader and does not grant the next context a session', options, async t => {
  const page = await mount(t); await start(page); await reads(page, 1);
  await page.evaluate(() => fixture.setContext('context-b'));
  await page.waitForFunction(() => fixture.reads[0].settled);
  await stableReads(page, 1);
  assert.equal(await page.evaluate(() => fixture.acquired.length), 0);
  await start(page); await reads(page, 2);
  assert.equal(await page.evaluate(() => fixture.reads[1].options.sessionId), undefined);
});

test('iOS business rejection stays readable through its pause and message dismissal until the next tap', options, async t => {
  const page = await mount(t); await start(page); await reads(page, 1);
  await page.evaluate(() => { fixture.nextResult = 'failure'; fixture.deliver(); });
  await page.getByText('This battery is retired and cannot be checked out.', { exact: true }).waitFor();
  await page.waitForFunction(() => fixture.reader.state === 'paused');
  await page.waitForTimeout(1250); await stableReads(page, 1);
  assert.equal(await page.locator('.scan-outcome-card strong').textContent(), 'Scan not accepted');
  await page.getByRole('button', { name: 'Read complete scan message', exact: true }).click();
  await page.getByRole('dialog').getByText('This battery is retired and cannot be checked out.', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Close message', exact: true }).click(); await stableReads(page, 1);
  assert.equal(await page.locator('.scan-outcome-card strong').textContent(), 'Scan not accepted');
  await start(page); await reads(page, 2);
  assert.equal(await page.locator('.scan-outcome-card strong').textContent(), 'Ready to scan');
});

test('iOS duplicate survives the next same-session wait and cancellation while reader failures remain inspectable', options, async t => {
  const page = await mount(t); await start(page); await reads(page, 1);
  await page.evaluate(() => { fixture.nextResult = 'duplicate'; fixture.deliver(); });
  await reads(page, 2);
  assert.equal(await page.locator('.scan-outcome-card strong').textContent(), 'Already recorded');
  await page.evaluate(() => fixture.reject()); await page.waitForFunction(() => fixture.reader.state === 'paused');
  await page.waitForTimeout(1250); await stableReads(page, 2);
  assert.equal(await page.locator('.scan-outcome-card strong').textContent(), 'Already recorded');
  await start(page); await reads(page, 3);
  await page.evaluate(() => fixture.reject('TAG_CONNECTION', 'The tag left the reader before the read completed.'));
  await page.getByText('The tag left the reader before the read completed.', { exact: true }).waitFor();
  await stableReads(page, 3);
  assert.equal(await page.locator('.scan-outcome-card strong').textContent(), 'Read failed');
  await page.getByRole('button', { name: 'Read complete scan message', exact: true }).click();
  await page.getByRole('button', { name: 'Close message', exact: true }).click(); await stableReads(page, 3);
  await start(page); await reads(page, 4);
});

test('iOS single lookup consumer stops after its result and waits for a ball tap after scan-another', options, async t => {
  const page = await mount(t, { single: true }); await stableReads(page, 0);
  await start(page); await reads(page, 1);
  assert.equal(await page.evaluate(() => fixture.reads[0].options.keepSessionAlive), undefined);
  await page.evaluate(() => fixture.deliver()); await page.getByText('Lookup result is ready', { exact: true }).waitFor();
  await stableReads(page, 1);
  await page.getByRole('button', { name: 'Scan another battery', exact: true }).click(); await stableReads(page, 1);
  await start(page); await reads(page, 2);
});
