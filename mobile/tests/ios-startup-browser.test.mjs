import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

let runtime;try{runtime=createRequire(import.meta.url)(process.env.MOBILE_BROWSER_TEST_MODULE||'playwright');}catch{}
const options={skip:!runtime&&'Set MOBILE_BROWSER_TEST_MODULE to exercise real startup rendering.'};
const root=fileURLToPath(new URL('../',import.meta.url));let bundled;
async function mount(t,{reducedMotion='no-preference',ios=true}={}){
  if(!bundled){
    const entry=`
      function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject}}
      const f=window.fixture={prepare:deferred(),session:deferred(),data:deferred()};
      f.resetPrepare=()=>{f.prepare=deferred()};
      f.storage={entries:()=>({}),getItem:()=>null,subscribe:()=>()=>{},flush:async()=>{},exportRaw:()=>'{"fixture":true}'};
      window.fetch=async()=>{const user=await f.session.promise;return new Response(JSON.stringify({user}))};
      await import('./src/main.jsx');`;
    const result=await build({stdin:{contents:entry,resolveDir:root,loader:'jsx'},bundle:true,write:false,outfile:'ios-startup.js',jsx:'automatic',format:'esm',platform:'browser',plugins:[{name:'controlled-native-and-inventory',setup(api){api.onLoad({filter:/\.(jsx|mjs)$/},args=>{
      const path=args.path.replaceAll('\\','/');
      if(path.endsWith('/platform/runtime.mjs'))return{contents:`export const native=false;export async function initializeRuntime(){await fixture.prepare.promise;return{origin:'https://fixture.test',storage:fixture.storage}};export const businessStorage=()=>fixture.storage;export const configureOrigin=async()=>{};export const saveFile=async()=>{};export const clearNativeSession=async()=>{};`,loader:'js'};
      if(path.endsWith('/app/phone-app.jsx'))return{contents:`import React,{useEffect,useState} from 'react';import {IosInkCharacter} from './ios-ink-character.jsx';export function MobileShell({onEntryState}){const[ready,setReady]=useState(false);fixture.setEntry=onEntryState;useEffect(()=>{let live=true;fixture.data.promise.then(()=>{if(live)setReady(true)});return()=>{live=false}},[]);useEffect(()=>{if(ready)onEntryState(fixture.entry||'scan')},[ready]);return <div className="phone-shell ios-shell"><div className="phone-route">{ready&&<button className="ios-scan-primary" onClick={()=>fixture.clicks=(fixture.clicks||0)+1} style={{position:'absolute',top:90,left:130}}><IosInkCharacter/><span>Scan</span></button>}</div></div>}`,loader:'jsx'};
      if(path.endsWith('/diagnostics-app.jsx'))return{contents:'import React from "react";export default function DiagnosticApp({onExit}){return <button onClick={onExit}>Return from diagnostics</button>}',loader:'jsx'};
    });api.onLoad({filter:/shared[\\/]app[\\/]globals\.css$/},()=>({contents:'',loader:'css'}));}}]});
    bundled={js:result.outputFiles.find(f=>f.path.endsWith('.js')).text,css:result.outputFiles.find(f=>f.path.endsWith('.css')).text};
  }
  const browser=await runtime.chromium.launch({channel:process.env.MOBILE_BROWSER_TEST_CHANNEL||'msedge',headless:true});t.after(()=>browser.close());
  const page=await browser.newPage({viewport:{width:390,height:844},reducedMotion}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('https://startup.fixture.test/**',route=>route.fulfill({contentType:'text/html',body:`<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#f5f6f8"><style>${bundled.css}</style><div id="root"></div><script type="module">${bundled.js.replaceAll('</script','<\\/script')}</script>`}));
  await page.goto('https://startup.fixture.test/'+(ios?'?presentation=ios':''));
  await page.waitForSelector(ios?'.ios-launch-scene':'.phone-startup');t.after(()=>assert.deepEqual(errors,[]));return page;
}

test('real iOS entry animates the mark while actual gates wait, then lands in Scan only when inventory is ready',options,async t=>{
  const page=await mount(t);
  assert.equal(await page.locator('.phone-startup-progress').count(),0);
  assert.equal(await page.locator('.phone-signin').count(),0);
  assert.equal(await page.locator('.ios-launch-scene').evaluate(node=>getComputedStyle(node).backgroundColor),'rgb(16, 20, 27)');
  assert.ok(await page.locator('.ios-brand-cells').evaluate(node=>node.getAnimations().length)>0);
  assert.equal(await page.locator('.ios-brand-cells rect').count(),2);
  await page.evaluate(()=>fixture.prepare.resolve());await page.waitForSelector('.ios-launch-scene[data-startup-phase="checking-session"]');
  await page.evaluate(()=>fixture.session.resolve({id:'fixture-user'}));await page.waitForSelector('.ios-launch-scene[data-startup-phase=authenticated]');
  assert.equal(await page.locator('.ios-launch-scene[data-ready=false]').count(),1);
  if(process.env.IOS_AUDIT_SCREENSHOT_DIR){await mkdir(process.env.IOS_AUDIT_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:process.env.IOS_AUDIT_SCREENSHOT_DIR+'/startup-loading.png'});}
  await page.evaluate(()=>fixture.data.resolve());await page.waitForSelector('.ios-launch-scene[data-departing=true]');
  assert.equal(await page.locator('.ios-launch-ink .ink-orb').count(),1,'Entry uses the original character.');
  assert.equal(await page.locator('[data-launch-arrival]').count(),0,'The splash belongs to arrival, not the beginning of flight.');
  assert.equal(await page.locator('.ios-launch-scene').evaluate(node=>getComputedStyle(node).pointerEvents),'none');
  const aligned=await page.locator('.ios-launch-mark').evaluate(node=>{
    const flight=node.getAnimations()[0];flight.pause();flight.currentTime=760;
    const pose=node.getBoundingClientRect(),target=document.querySelector('.ios-scan-primary .ios-ink').getBoundingClientRect();
    return Math.abs(pose.x-target.x)<1&&Math.abs(pose.y-target.y)<1&&Math.abs(pose.width-target.width)<1;
  });
  assert.equal(aligned,true,'The original character lands at the actual rendered Scan position.');
  await page.locator('.ios-launch-mark').evaluate(node=>node.getAnimations()[0].finish());
  await page.waitForSelector('.ios-scan-primary [data-launch-arrival=true]');
  assert.ok(await page.locator('.ios-scan-primary .ios-ink').evaluate(node=>node.getAnimations({subtree:true}).length)>0);
  await page.waitForSelector('.ios-launch-scene',{state:'detached'});assert.equal(await page.getByRole('button',{name:'Scan',exact:true}).isVisible(),true);
  assert.equal(await page.locator('[data-ios-launch-destination]').count(),0);
  await page.waitForSelector('.ios-scan-primary .ink-orb[data-motion-paused=false]');
  await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));assert.equal(await page.locator('.ios-launch-scene').count(),0);
});

test('iOS local preparation and connection failure expose truthful recovery actions instead of an endless launch',options,async t=>{
  const local=await mount(t);await local.evaluate(()=>fixture.prepare.reject(Error('Controlled local recovery failure')));
  await local.waitForSelector('.ios-startup-failure');await local.waitForSelector('.ios-launch-scene',{state:'detached'});
  assert.equal(await local.getByRole('button',{name:'Export retained data'}).isVisible(),true);
  await local.evaluate(()=>fixture.resetPrepare());await local.getByRole('button',{name:'Retry opening',exact:true}).click();
  await local.waitForSelector('.ios-launch-scene[data-startup-phase=opening]');
  assert.equal(await local.locator('.ios-launch-copy').isVisible(),true);
  await local.evaluate(()=>{fixture.prepare.resolve();fixture.session.resolve({id:'retry-user'});fixture.data.resolve()});
  await local.waitForSelector('.ios-launch-scene',{state:'detached'});assert.equal(await local.getByRole('button',{name:'Scan',exact:true}).isVisible(),true);
  const connection=await mount(t);await connection.evaluate(()=>fixture.prepare.resolve());await connection.evaluate(()=>fixture.session.reject(Error('Controlled network failure')));
  await connection.waitForSelector('.ios-startup-failure');await connection.waitForSelector('.ios-launch-scene',{state:'detached'});
  assert.equal(await connection.getByRole('button',{name:'Retry connection'}).isVisible(),true);assert.equal(await connection.getByRole('button',{name:'Export retained data'}).count(),0);
});

test('reduced motion suppresses startup loops and flight; signed-out entry reveals sign-in without inventing a session',options,async t=>{
  const page=await mount(t,{reducedMotion:'reduce'});
  assert.equal(await page.locator('.ios-launch-scene').evaluate(node=>node.getAnimations({subtree:true}).length),0);
  await page.evaluate(()=>fixture.prepare.resolve());await page.evaluate(()=>fixture.session.resolve(null));
  await page.waitForSelector('.phone-signin');await page.waitForSelector('.ios-launch-scene',{state:'detached'});
  assert.equal(await page.locator('.ios-brand-mark').count(),1);assert.equal(await page.locator('.ios-scan-primary').count(),0);
  await page.getByText('Device diagnostics',{exact:true}).click();await page.getByRole('button',{name:'NFC field test',exact:true}).click();await page.getByRole('button',{name:'Return from diagnostics'}).click();assert.equal(await page.locator('.ios-launch-scene').count(),0);
});

test('ordinary browser and Android presentation keep the previous startup and artwork',options,async t=>{
  const page=await mount(t,{ios:false});assert.equal(await page.locator('.ios-launch-scene').count(),0);assert.equal(await page.locator('.phone-startup-progress').count(),1);
});

test('initial HTML selects the iOS canvas before JavaScript bundles and ignores preview query on native Android',options,async t=>{
  const source=await readFile(new URL('../index.html',import.meta.url),'utf8');
  const browser=await runtime.chromium.launch({channel:process.env.MOBILE_BROWSER_TEST_CHANNEL||'msedge',headless:true});t.after(()=>browser.close());
  for(const platform of ['ios','android']){
    const page=await browser.newPage();await page.addInitScript(platform=>{window.Capacitor={isNativePlatform:()=>true,getPlatform:()=>platform}},platform);
    await page.route('https://firstpaint.fixture.test/**',route=>route.fulfill({contentType:'text/html',body:source.replace(/<script type="module"[\s\S]*?<\/script>/,'')}));
    await page.goto('https://firstpaint.fixture.test/?presentation=ios');
    assert.equal(await page.locator('.ios-early-mark').isVisible(),platform==='ios');
    assert.equal(await page.locator('.phone-startup-progress').isVisible(),platform==='android');
    assert.equal(await page.evaluate(()=>getComputedStyle(document.body).backgroundColor),platform==='ios'?'rgb(16, 20, 27)':'rgb(245, 246, 248)');await page.close();
  }
});


test('a readiness reversal cancels departure without losing loading text or the mark',options,async t=>{
  const page=await mount(t);await page.evaluate(()=>{fixture.prepare.resolve();fixture.session.resolve({id:'interruption-user'});fixture.data.resolve()});
  await page.waitForSelector('.ios-launch-scene[data-departing=true]');await page.evaluate(()=>fixture.setEntry('loading'));
  await page.waitForSelector('.ios-launch-scene[data-ready=false]');assert.equal(await page.locator('.ios-launch-scene').getAttribute('data-departing'),null);
  assert.equal(await page.locator('[data-ios-launch-destination]').count(),0);
  assert.equal(await page.locator('.ios-launch-copy').evaluate(node=>getComputedStyle(node).opacity),'1');
  assert.equal(await page.locator('.ios-launch-mark>.ios-brand-mark').evaluate(node=>getComputedStyle(node).opacity),'1');
  await page.evaluate(()=>fixture.setEntry('scan'));await page.waitForSelector('.ios-launch-scene',{state:'detached'});
});

test('ready input is immediate and resize, background or reduced motion cancels decoration without hiding the destination',options,async t=>{
  for(const interruption of ['input','resize','background','reduce']){
    const page=await mount(t);await page.evaluate(()=>{fixture.prepare.resolve();fixture.session.resolve({id:'interactive-user'});fixture.data.resolve()});
    await page.waitForSelector('.ios-launch-scene[data-departing=true]');
    if(interruption==='input')await page.getByRole('button',{name:'Scan',exact:true}).click();
    else if(interruption==='resize')await page.setViewportSize({width:430,height:820});
    else if(interruption==='background')await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'hidden'});document.dispatchEvent(new Event('visibilitychange'));});
    else await page.emulateMedia({reducedMotion:'reduce'});
    await page.waitForSelector('.ios-launch-scene',{state:'detached'});
    assert.equal(await page.locator('[data-ios-launch-destination],[data-launch-arrival]').count(),0);
    assert.equal(await page.locator('.ios-scan-primary .ios-ink').evaluate(node=>getComputedStyle(node).visibility),'visible');
    if(interruption==='input')assert.equal(await page.evaluate(()=>fixture.clicks),1,'Startup never delays or consumes the ready action.');
  }
});

test('restored and recovery-attention destinations do not receive a Scan flight or splash',options,async t=>{
  for(const entry of ['restored','attention']){
    const page=await mount(t);await page.evaluate(entry=>{fixture.entry=entry;fixture.prepare.resolve();fixture.session.resolve({id:'recovery-user'});fixture.data.resolve()},entry);
    await page.waitForSelector('.ios-launch-scene',{state:'detached'});
    assert.equal(await page.locator('[data-ios-launch-destination],[data-launch-arrival]').count(),0);
  }
});
