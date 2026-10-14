import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

let runtime;try{runtime=createRequire(import.meta.url)(process.env.MOBILE_BROWSER_TEST_MODULE||'playwright');}catch{}
const options={skip:!runtime&&'Set MOBILE_BROWSER_TEST_MODULE for real iOS dock pointer and character checks.'};
const root=fileURLToPath(new URL('../',import.meta.url));let bundle;
async function mount(t,{reduced=false}={}) {
  if(!bundle){const result=await build({stdin:{contents:`
    import React,{useState}from'react';import{createRoot}from'react-dom/client';
    import{IosDock,IosScanHome}from'./src/app/ios-chrome.jsx';import{PhoneUIProvider}from'./src/app/phone-ui.jsx';import{activateIosPresentation}from'./src/app/ios-runtime-presentation.mjs';import './src/app/phone.css';import './src/features/scan/scan.css';
    activateIosPresentation(document,true);
    const f=window.fixture={requests:[],opens:[],admit:true,unmountOnOpen:false};
    function Harness(){const[area,setArea]=useState('scan'),[disabled,setDisabled]=useState(false),[hidden,setHidden]=useState(false),[reduced,setReduced]=useState(false),[homeActive,setHomeActive]=useState(true),[homeMounted,setHomeMounted]=useState(false);Object.assign(f,{setArea,setDisabled,setHidden,setReduced,setHomeActive,setHomeMounted});const open=kind=>{f.opens.push({kind,feedbackAtCallback:document.querySelectorAll('[data-ios-activation-feedback]').length});setHomeActive(false);if(f.unmountOnOpen)setHomeMounted(false);};return <PhoneUIProvider namespace="dock-fixture" reducedMotion={reduced}><div className="phone-app">{homeMounted&&<div className="ios-shell" data-home-fixture style={{position:'fixed',left:0,right:0,top:28,height:660}}><IosScanHome active={homeActive} onLookup={()=>open('lookup')} onOperation={open}/></div>}<div className="ios-shell" style={{position:'fixed',left:0,right:0,bottom:40}}><IosDock area={area} disabled={disabled} hidden={hidden} unreadCount={2} onNavigate={value=>{f.requests.push(value);if(f.admit)setArea(value);return f.admit;}}/></div></div></PhoneUIProvider>;}
    createRoot(document.getElementById('root')).render(<Harness/>);
  `,loader:'jsx',resolveDir:root},bundle:true,write:false,outfile:'dock.js',jsx:'automatic',format:'esm',platform:'browser'});bundle={js:result.outputFiles.find(file=>file.path.endsWith('.js')).text,css:result.outputFiles.find(file=>file.path.endsWith('.css')).text};}
  const browser=await runtime.chromium.launch({channel:process.env.MOBILE_BROWSER_TEST_CHANNEL||'msedge',headless:true});t.after(()=>browser.close());
  const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,reducedMotion:reduced?'reduce':'no-preference'}),page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.route('https://dock.fixture.test/**',route=>route.fulfill({contentType:'text/html',body:'<meta name="viewport" content="width=device-width,initial-scale=1"><style>'+bundle.css+'</style><div id="root"></div><script type="module">'+bundle.js.replaceAll('</script','<\\/script')+'</script>'}));
  await page.goto('https://dock.fixture.test/');await page.waitForSelector('.ios-dock');if(reduced)await page.evaluate(()=>fixture.setReduced(true));
  t.after(()=>assert.deepEqual(errors,[]));return page;
}
const requests=page=>page.evaluate(()=>fixture.requests);
async function geometry(page){return page.evaluate(()=>{const bar=document.querySelector('.ios-dock'),b=bar.getBoundingClientRect(),tabs=[...bar.querySelectorAll(':scope>button')].map(el=>{const r=el.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};});return{left:b.left,right:b.right,top:b.top,bottom:b.bottom,tabs,step:tabs[1].x-tabs[0].x};});}
const lens=page=>page.evaluate(()=>{const m=new DOMMatrix(getComputedStyle(document.querySelector('.ios-dock-selection')).transform);return{x:m.m41,y:m.m42};});
const current=page=>page.locator('.ios-dock button[aria-current=page]').textContent();
async function showHome(page){await page.evaluate(()=>{fixture.setHomeMounted(true);fixture.setHomeActive(true);});await page.waitForSelector('[data-home-fixture] .ios-ink[data-active=true]');return page.locator('[data-home-fixture]');}
const bodyScale=element=>element.locator('.ios-ink-body').evaluate(el=>new DOMMatrix(getComputedStyle(el).transform).a);

test('held dock selection follows fractional and vertical pointer travel without snapping or early navigation',options,async t=>{
  const page=await mount(t),g=await geometry(page),a=g.tabs[0];
  await page.mouse.move(a.x+g.step*.38,a.y-8);await page.mouse.down();
  assert.equal(await page.locator('.ios-dock').evaluate(el=>el.hasPointerCapture(1)),true);
  await page.waitForFunction(expected=>Math.abs(new DOMMatrix(getComputedStyle(document.querySelector('.ios-dock-selection')).transform).m41-expected)<1,g.step*.38);
  assert.deepEqual(await requests(page),[]);assert.equal(await current(page),'Scan');
  await page.mouse.move(a.x+g.step*.64,a.y+16);let p=await lens(page);assert.ok(Math.abs(p.x-g.step*.64)<3,JSON.stringify(p));assert.ok(p.y>12,JSON.stringify(p));
  await page.mouse.move(a.x+g.step*1.35,a.y-12);p=await lens(page);assert.ok(Math.abs(p.x-g.step*1.35)<4,JSON.stringify(p));assert.ok(p.y< -10,JSON.stringify(p));assert.deepEqual(await requests(page),[]);
  await page.mouse.up();assert.deepEqual(await requests(page),['inventory']);assert.equal(await current(page),'Inventory');
});

test('outside release, lost capture, hidden and disabled ownership cancel without clamped-edge navigation',options,async t=>{
  const page=await mount(t),g=await geometry(page),a=g.tabs[0];
  for(const end of [{x:g.right+35,y:a.y},{x:g.tabs[2].x,y:g.top-24}]){await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(end.x,end.y,{steps:3});assert.equal(await page.locator('.ios-dock').getAttribute('data-drop-allowed'),'false');await page.mouse.up();assert.deepEqual(await requests(page),[]);assert.equal(await current(page),'Scan');}
  await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(g.tabs[2].x,a.y);await page.evaluate(()=>document.querySelector('.ios-dock').releasePointerCapture(1));await page.mouse.up();assert.deepEqual(await requests(page),[]);
  await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(g.tabs[1].x,a.y);await page.evaluate(()=>fixture.setHidden(true));await page.waitForSelector('.ios-navigation[hidden]',{state:'attached'});await page.mouse.up();assert.deepEqual(await requests(page),[]);await page.evaluate(()=>fixture.setHidden(false));await page.locator('.ios-navigation').waitFor({state:'visible'});
  await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(g.tabs[1].x,a.y);await page.evaluate(()=>fixture.setDisabled(true));await page.waitForSelector('.ios-dock button:disabled');await page.mouse.up();assert.deepEqual(await requests(page),[]);
  await page.evaluate(()=>fixture.setDisabled(false));await page.locator('.ios-dock').getByRole('button',{name:'Workspace',exact:true}).click();assert.deepEqual(await requests(page),['workspace']);
});

test('real touch movement remains owned across vertical travel and touch cancellation never commits',options,async t=>{
  const page=await mount(t),g=await geometry(page),cdp=await page.context().newCDPSession(page);
  const touch=(type,x,y)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:type==='touchEnd'||type==='touchCancel'?[]:[{x,y,id:5}]});
  assert.equal(await page.locator('.ios-dock button').first().evaluate(el=>getComputedStyle(el).touchAction),'none');
  await touch('touchStart',g.tabs[0].x,g.tabs[0].y-15);await touch('touchMove',g.tabs[0].x+2,g.tabs[0].y+16);await touch('touchMove',g.tabs[1].x+g.step*.22,g.tabs[1].y+8);
  assert.equal(await page.locator('.ios-dock').getAttribute('data-dragging'),'true');assert.deepEqual(await requests(page),[]);
  await touch('touchCancel');assert.deepEqual(await requests(page),[]);assert.equal(await current(page),'Scan');
  await touch('touchStart',g.tabs[0].x,g.tabs[0].y);await touch('touchMove',g.tabs[2].x,g.tabs[2].y);await touch('touchEnd');assert.deepEqual(await requests(page),['workspace']);
});

test('rejected admission restores the admitted area and keyboard activation remains independent of pointer capture',options,async t=>{
  const page=await mount(t),g=await geometry(page);await page.evaluate(()=>fixture.admit=false);
  await page.mouse.move(g.tabs[0].x,g.tabs[0].y);await page.mouse.down();await page.mouse.move(g.tabs[2].x,g.tabs[2].y);await page.mouse.up();assert.deepEqual(await requests(page),['workspace']);assert.equal(await current(page),'Scan');
  await page.waitForFunction(()=>Math.abs(new DOMMatrix(getComputedStyle(document.querySelector('.ios-dock-selection')).transform).m41)<.1);
  await page.evaluate(()=>fixture.admit=true);await page.locator('.ios-dock').getByRole('button',{name:'Inventory',exact:true}).focus();await page.keyboard.press('Enter');assert.equal(await current(page),'Inventory');assert.deepEqual(await requests(page),['workspace','inventory']);
});

test('Me belongs to the same four-destination dock and pointer admission is shared',options,async t=>{
  const page=await mount(t),g=await geometry(page);assert.equal(g.tabs.length,4);assert.equal(await page.locator('.ios-navigation .ink-orb').count(),0);
  await page.mouse.move(g.tabs[0].x,g.tabs[0].y);await page.mouse.down();await page.mouse.move(g.tabs[3].x,g.tabs[3].y,{steps:5});assert.deepEqual(await requests(page),[]);
  await page.mouse.up();assert.deepEqual(await requests(page),['me']);assert.equal(await current(page),'Me');
  await page.waitForFunction(expected=>Math.abs(new DOMMatrix(getComputedStyle(document.querySelector('.ios-dock-selection')).transform).m41-expected)<.1,g.step*3);
  await page.evaluate(()=>fixture.setDisabled(true));assert.equal(await page.locator('.ios-dock button:disabled').count(),4);
  await page.evaluate(()=>fixture.setDisabled(false));await page.getByRole('button',{name:'Me, 2 unread messages',exact:true}).focus();await page.keyboard.press('Enter');assert.deepEqual(await requests(page),['me','me']);
});

test('reduced motion retains four-area pointer and keyboard navigation without decoration',options,async t=>{
  const page=await mount(t,{reduced:true}),g=await geometry(page);await page.mouse.move(g.tabs[0].x,g.tabs[0].y);await page.mouse.down();await page.mouse.move(g.tabs[1].x,g.tabs[1].y);await page.mouse.up();assert.equal(await current(page),'Inventory');
  await page.getByRole('button',{name:'Me, 2 unread messages',exact:true}).focus();await page.keyboard.press('Enter');assert.equal(await current(page),'Me');
  assert.equal(await page.locator('.ios-dock').evaluate(el=>el.getAnimations({subtree:true}).length),0);
});

test('the single Scan character shrinks and preserves finite feedback across immediate admission and unmount',options,async t=>{
  const page=await mount(t),home=await showHome(page),scan=home.locator('.ios-scan-primary'),box=await scan.boundingBox();assert.equal(await home.locator('.ink-orb').count(),1);
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.waitForFunction(()=>new DOMMatrix(getComputedStyle(document.querySelector('.ios-scan-primary .ios-ink-body')).transform).a<.8);assert.deepEqual(await page.evaluate(()=>fixture.opens),[]);
  await page.mouse.up();assert.deepEqual(await page.evaluate(()=>fixture.opens),[{kind:'lookup',feedbackAtCallback:1}]);const echo=page.locator('[data-ios-activation-feedback]');assert.equal(await echo.count(),1);
  await page.waitForFunction(()=>[...document.querySelectorAll('[data-ios-activation-feedback] .ios-ink-drop')].some(el=>Number(getComputedStyle(el).opacity)>.2));
  await page.evaluate(()=>fixture.setHomeMounted(false));await home.waitFor({state:'detached'});assert.equal(await echo.count(),1);await echo.waitFor({state:'detached',timeout:2000});
});

test('all four stock operation entries retain their actual callbacks without duplicating the reader character',options,async t=>{
  const page=await mount(t);
  for(const[kind,label]of [['intake','Intake: Register new stock'],['checkout','Check out: Prepare a loan'],['return','Check in: Receive batteries'],['removal','Removal: Retire or remove']]){
    const home=await showHome(page);assert.equal(await home.locator('.ink-orb').count(),1);const before=await page.evaluate(()=>fixture.opens.length);await home.getByRole('button',{name:label,exact:true}).click();assert.deepEqual(await page.evaluate(()=>fixture.opens.at(-1)),{kind,feedbackAtCallback:0});assert.equal(await page.evaluate(()=>fixture.opens.length),before+1);
  }
});

test('Scan departure gives up the body promptly, preserves its real pose and colour, and restores a retained source',options,async t=>{
  const page=await mount(t),home=await showHome(page),scan=home.locator('.ios-scan-primary');
  // Synchronous activation samples a light tap before any press transition settles.
  const sample=await scan.evaluate(button=>{
    const source=button.querySelector('.ios-ink'),body=source.querySelector('.ios-ink-body');
    const before={transform:new DOMMatrix(getComputedStyle(body).transform).toString(),colour:getComputedStyle(source.querySelector('[data-ink-body]')).fill};
    button.click();
    const echo=document.querySelector('[data-ios-activation-feedback]'),echoBody=echo.querySelector('.ios-ink-body'),motions=echo.getAnimations({subtree:true});
    for(const animation of motions){animation.pause();animation.currentTime=0;}
    const initial={transform:new DOMMatrix(getComputedStyle(echoBody).transform).toString(),colour:getComputedStyle(echo.querySelector('[data-ink-body]')).fill};
    const frames=[80,180,260].map(time=>{for(const animation of motions)animation.currentTime=time;return{time,scale:new DOMMatrix(getComputedStyle(echoBody).transform).a,opacity:Number(getComputedStyle(echoBody).opacity)};});
    return{before,initial,frames,sourceHidden:getComputedStyle(body).visibility,maximum:Math.max(...motions.map(animation=>animation.effect.getComputedTiming().endTime))};
  });
  assert.deepEqual(sample.initial,sample.before,'Departure begins at the rendered pose and preserves the scoped home colour.');
  assert.equal(sample.sourceHidden,'hidden','Only the detached visual is visible while admission can still be waiting.');
  assert.ok(sample.frames[0].scale<.74,'Departure shrinks instead of rebounding to full size.');
  assert.equal(sample.frames[1].opacity,0,'The original ball no longer covers the new page after 180ms.');
  assert.equal(sample.frames[2].opacity,0,'Only liquid droplets may remain during the short tail.');
  assert.ok(sample.maximum<=350,'Departure must finish within a third of a second, not linger through the page transition.');
  assert.deepEqual(await page.evaluate(()=>fixture.opens),[{kind:'lookup',feedbackAtCallback:1}],'Business admission remains immediate.');
  await page.locator('[data-ios-activation-feedback]').evaluate(echo=>echo.getAnimations({subtree:true}).forEach(animation=>animation.finish()));
  await page.locator('[data-ios-activation-feedback]').waitFor({state:'detached'});
  assert.equal(await home.locator('[data-activation-echo]').count(),0);
  assert.equal(await home.locator('.ios-ink-body').evaluate(body=>getComputedStyle(body).visibility),'visible','A retained or denied entry must never leave its source hidden.');
});

test('cancelled Scan press creates no echo and a new accepted action replaces the only detached feedback',options,async t=>{
  const page=await mount(t),home=await showHome(page),scan=home.locator('.ios-scan-primary'),box=await scan.boundingBox();
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2+32,box.y+box.height/2,{steps:3});await page.mouse.up();
  assert.deepEqual(await page.evaluate(()=>fixture.opens),[]);assert.equal(await page.locator('[data-ios-activation-feedback]').count(),0);assert.equal(await scan.getAttribute('data-pressed'),null);
  await scan.click();await page.evaluate(()=>fixture.previousEcho=document.querySelector('[data-ios-activation-feedback]'));
  await showHome(page);await home.locator('.ios-scan-primary').click();
  assert.deepEqual(await page.evaluate(()=>fixture.opens.map(value=>value.kind)),['lookup','lookup']);assert.equal(await page.locator('[data-ios-activation-feedback]').count(),1);assert.equal(await page.evaluate(()=>fixture.previousEcho.isConnected),false);
  await page.emulateMedia({reducedMotion:'reduce'});await page.locator('[data-ios-activation-feedback]').waitFor({state:'detached'});
  await page.emulateMedia({reducedMotion:'no-preference'});await showHome(page);await page.waitForSelector('[data-home-fixture] .ios-ink[data-reduced-motion=false]');await scan.click();assert.equal(await page.locator('[data-ios-activation-feedback]').count(),1);
  await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});document.dispatchEvent(new Event('visibilitychange'));});assert.equal(await page.locator('[data-ios-activation-feedback]').count(),0);
});

test('reduced-motion Scan admits the workflow without shrink or detached feedback',options,async t=>{
  const page=await mount(t,{reduced:true}),home=await showHome(page),scan=home.locator('.ios-scan-primary'),box=await scan.boundingBox();
  await page.waitForSelector('[data-home-fixture] .ios-ink[data-reduced-motion=true]');await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();
  assert.equal(await scan.getAttribute('data-pressed'),'true');assert.equal(await bodyScale(scan),1);assert.equal(await scan.evaluate(el=>el.getAnimations({subtree:true}).length),0);
  await page.mouse.up();assert.deepEqual(await page.evaluate(()=>fixture.opens),[{kind:'lookup',feedbackAtCallback:0}]);assert.equal(await page.locator('[data-ios-activation-feedback]').count(),0);
});
