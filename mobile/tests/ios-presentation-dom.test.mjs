import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import ts from 'typescript';

let browserRuntime; try { browserRuntime=createRequire(import.meta.url)(process.env.MOBILE_BROWSER_TEST_MODULE||'playwright'); } catch {}
const browserOptions={ skip:!browserRuntime&&'Set MOBILE_BROWSER_TEST_MODULE for composed iOS presentation browser checks.' };
const root=fileURLToPath(new URL('../',import.meta.url)), appUrl=new URL('../src/app/phone-app.jsx',import.meta.url);
const appSource=await readFile(appUrl,'utf8'), ast=ts.createSourceFile('phone-app.jsx',appSource,ts.ScriptTarget.Latest,true,ts.ScriptKind.JSX), mocked=new Map();
for(const node of ast.statements.filter(ts.isImportDeclaration)) {
  const path=fileURLToPath(new URL(node.moduleSpecifier.text,appUrl));
  if(/shared\/components\/|features\/(workspace\/workspace|lifecycle\/(intake|removal|manual-registration))\.jsx$|app\/(battery-page|mobile-import-dialog|missing-inspection-recovery)\.jsx$|business\/(registration|nfc-read)\.jsx$/.test(path.replaceAll('\\','/'))) {
    const names=node.importClause?.namedBindings?.elements.map(item=>item.propertyName?.text||item.name.text)||[];
    mocked.set(path,`import React from 'react';${names.map(name=>`export function ${name}(props){return <div data-controlled-view="${name}">${name==='MeScreen'?'<button onClick={()=>props.onPersonal("responsible")}>My responsibility</button>':''}</div>;}`).join('\n')}`);
  }
}
const scanUrl=new URL('../src/features/scan/scan.jsx',import.meta.url), scanSource=await readFile(scanUrl,'utf8');
const controlledScan=scanSource.slice(0,scanSource.indexOf('function useDialogFocus'))+`
import {useWorkflowLock} from '../../business/workflow-boundary.jsx';
export function ScanWorkflow(props){useWorkflowLock();useEffect(()=>{fixture.opens.push(props.kind);},[]);return <section><button onClick={props.onExit}>Exit controlled station</button></section>;}
`;
const fixture=`
import React,{useState} from 'react';import{createRoot}from'react-dom/client';import{MobileShell}from'./src/app/phone-app.jsx';import{createDurableStorage}from'./src/platform/durable-storage.mjs';import{readInventoryView,inventoryViewKey}from'./src/features/inventory/inventory-model.mjs';import './src/app/phone.css';
const f=window.fixture={opens:[],requests:[],exports:[]};
const user={id:'STAFF-A',role:'staff',username:'fixture',displayName:'Fixture staff',defaultDataset:'demo'};
const battery=(id,owner,room)=>({id,name:'Battery '+id,model:'Model one',chemistry:'',capacityMah:null,voltage:null,tagId:'nfc:uid:04111111111111',version:1,ownerAccountId:owner,ownerId:owner,ownerName:owner,homeBuildingId:'J18',homeRoomId:'R1',loanId:null,borrowerKind:null,borrowerAccountId:null,manufacturedOn:null,firstUsedOn:null,chargedAt:null,observedAt:'2026-10-14T04:00:00.000Z',observedRoomId:room,observedRoom:room,observationRoomSnapshot:'recorded',observationSource:'simulated',lifecycleStatus:'active'});
f.snapshot={user,dataset:'demo',batteries:[battery('BAT-1',user.id,'R1'),battery('BAT-2','STAFF-B','R1'),battery('BAT-3',user.id,'R2')],people:[],staffDirectory:[],buildings:[],rooms:[{id:'R1',name:'Room one',number:'1',buildingId:'J18',selectable:true},{id:'R2',name:'Room two',number:'2',buildingId:'J18',selectable:true}],teachingGroups:[]};
f.storage=createDurableStorage({load:async()=>null,save:async()=>{}});await f.storage.initialize();
window.fetch=async(input,options={})=>{f.requests.push({path:String(input),method:options.method||'GET'});if(String(input).startsWith('/api/inventory'))return new Response(JSON.stringify(f.snapshot));if(String(input).startsWith('/api/session'))return new Response(JSON.stringify({user}));throw Error('Unexpected fixture request '+input);};
f.view=scope=>readInventoryView(inventoryViewKey(user.id,'demo',scope),scope);
function Harness(){const[saving,setSaving]=useState(false);f.setSaving=setSaving;return <div className="phone-app"><MobileShell initialUser={user} origin="controlled-local" saving={saving} storageError="" onFieldTest={()=>{}} onExportRecovery={()=>{}} onSignedOut={()=>{}}/></div>;}
createRoot(document.getElementById('root')).render(<Harness/>);
`;
let bundled;
async function mount(t,{ ios=true, width=390, height=844, reducedMotion='no-preference' }={}) {
  if(!bundled) {
    const result=await build({stdin:{contents:fixture,resolveDir:root,sourcefile:'ios-dom.jsx',loader:'jsx'},bundle:true,write:false,outfile:'ios-fixture.js',jsx:'automatic',format:'esm',platform:'browser',plugins:[{name:'controlled-boundaries',setup(api){api.onLoad({filter:/\.(jsx|js|mjs)$/},async args=>{
      if(mocked.has(args.path))return{contents:mocked.get(args.path),loader:'jsx'};
      if(args.path===fileURLToPath(scanUrl))return{contents:controlledScan,loader:'jsx'};
      if(args.path.endsWith('runtime.mjs'))return{contents:'export const native=false;export const businessStorage=()=>window.fixture.storage;export const saveFile=async()=>{};',loader:'js'};
      if(args.path.endsWith('use-message-count.js'))return{contents:'export const useMessageCount=()=>({unreadCount:2,acceptUnreadCount(){}});',loader:'js'};
      if(args.path.endsWith('phone-arrivals.jsx'))return{contents:'export const PhoneArrivalsProvider=({children})=>children;export const usePhoneArrivals=()=>({arrivals:null,pending:false,error:"",acknowledge(){}});',loader:'jsx'};
      if(args.path.endsWith('mapping-scene.jsx'))return{contents:'import React from "react";export function MappingScene(props){return <button onClick={()=>props.onRoom({kind:"room",id:"R1",label:"Room one"})}>Open controlled Room one</button>;}',loader:'jsx'};
    });}}]});
    bundled={js:result.outputFiles.find(file=>file.path.endsWith('.js')).text,css:result.outputFiles.find(file=>file.path.endsWith('.css')).text};
  }
  const browser=await browserRuntime.chromium.launch({channel:process.env.MOBILE_BROWSER_TEST_CHANNEL||'msedge',headless:true});t.after(()=>browser.close());
  const page=await browser.newPage({viewport:{width,height},reducedMotion}), errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.route('https://ios.fixture.test/**',route=>route.fulfill({contentType:'text/html',body:'<meta name="viewport" content="width=device-width,initial-scale=1"><style>'+bundled.css+'</style><div id="root"></div><script type="module">'+bundled.js.replaceAll('</script','<\\/script')+'</script>'}));
  await page.goto('https://ios.fixture.test/'+(ios?'?presentation=ios':''));
  if(process.env.MOBILE_PRESENTATION_CSS)await page.addStyleTag({content:await readFile(process.env.MOBILE_PRESENTATION_CSS,'utf8')});
  await page.waitForSelector(ios?'.ios-operation':'.scan-lookup-target');assert.deepEqual(errors,[]);
  return page;
}
const visibleInventory=page=>page.locator('.phone-route:not([hidden]) .mobile-inventory');
async function search(page,text) { await page.getByRole('button',{name:'Search inventory',exact:true}).click();await page.locator('#ios-inventory-search').fill(text);await page.locator('.ios-search-panel').getByRole('button',{name:'Search',exact:true}).click(); }

test('iOS home and navigation are scoped while Android-compatible browser home stays unchanged',browserOptions,async t=>{
  const page=await mount(t);assert.equal(await page.locator('.ios-operation').count(),3);assert.equal(await page.locator('.ios-intake-entry').count(),1);assert.equal(await page.locator('.ios-dock button').count(),4);assert.equal(await page.locator('.ios-scan-home .ink-orb').count(),1);assert.equal(await page.locator('.phone-bottom-bar').count(),0);
  const android=await mount(t,{ios:false});assert.equal(await android.locator('.phone-bottom-bar button').count(),4);assert.equal(await android.locator('.scan-action-tile').count(),4);assert.equal(await android.locator('.ios-operation').count(),0);
});
test('new operation entry retains cancellable saving admission and owns only one workflow',browserOptions,async t=>{
  const page=await mount(t);await page.evaluate(()=>fixture.setSaving(true));await page.getByRole('button',{name:'Check out: Prepare a loan',exact:true}).click();await page.waitForSelector('.ios-entry-status');assert.deepEqual(await page.evaluate(()=>fixture.opens),[]);
  await page.locator('.ios-entry-status').getByRole('button',{name:'Cancel',exact:true}).click();await page.evaluate(()=>fixture.setSaving(false));assert.deepEqual(await page.evaluate(()=>fixture.opens),[]);
  await page.getByRole('button',{name:'Check out: Prepare a loan',exact:true}).click();await page.waitForSelector('.ios-workflow');assert.deepEqual(await page.evaluate(()=>fixture.opens),['checkout']);assert.equal(await page.locator('.ios-shell[inert]').count(),1);assert.equal(await page.locator('.ios-search-trigger:disabled').count(),1);
});
test('dock drag commits its destination on release and Me shares the admitted navigation',browserOptions,async t=>{
  const page=await mount(t), dock=await page.locator('.ios-dock').boundingBox();
  await page.mouse.move(dock.x+30,dock.y+22);await page.mouse.down();await page.mouse.move(dock.x+dock.width-25,dock.y+22,{steps:7});assert.equal(await page.locator('.ios-dock[data-dragging=true]').count(),1);assert.equal(await page.locator('.ios-dock button[aria-current=page]').textContent(),'Scan');
  await page.mouse.up();await page.waitForFunction(()=>document.querySelector('.ios-dock button[aria-current=page]')?.textContent==='Me');await page.locator('.ios-dock').getByRole('button',{name:'Workspace',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.ios-dock button[aria-current=page]')?.textContent==='Workspace');assert.equal(await page.locator('.ios-dock button[aria-current=page]').count(),1);
});
test('floating search uses real inventory filters, retains owner scope and chosen records, and performs no business write',browserOptions,async t=>{
  const page=await mount(t);await page.getByRole('button',{name:'Me, 2 unread messages',exact:true}).click();await page.getByRole('button',{name:'My responsibility',exact:true}).click();await visibleInventory(page).waitFor();assert.equal(await visibleInventory(page).locator('.mi-record').count(),2);
  await page.evaluate(()=>fixture.requests=[]);
  await visibleInventory(page).getByRole('button',{name:'Select batteries',exact:true}).click();await visibleInventory(page).getByRole('checkbox',{name:'Select BAT-1',exact:true}).check();
  await search(page,'BAT-2');await page.waitForFunction(()=>document.querySelector('.phone-route:not([hidden]) .mi-inventory-search input')?.value==='BAT-2');assert.equal(await visibleInventory(page).locator('.mi-record').count(),0);assert.deepEqual(await page.evaluate(()=>fixture.view({kind:'owner',id:'STAFF-A'}).selectedIds),['BAT-1']);
  await search(page,'BAT-1');await page.waitForFunction(()=>document.querySelector('.phone-route:not([hidden]) .mi-inventory-search input')?.value==='BAT-1');assert.equal(await visibleInventory(page).locator('.mi-record').count(),1);assert.equal(await visibleInventory(page).getByRole('checkbox',{name:'Select BAT-1',exact:true}).isChecked(),true);
  assert.equal((await page.evaluate(()=>fixture.requests)).some(request=>request.method==='POST'),false);
});
test('floating search retains the internally opened Mapping room rather than widening its records',browserOptions,async t=>{
  const page=await mount(t);await page.locator('.ios-dock').getByRole('button',{name:'Inventory',exact:true}).click();await visibleInventory(page).getByRole('tab',{name:'Mapping',exact:true}).click();await page.getByRole('button',{name:'Open controlled Room one',exact:true}).click();assert.equal(await visibleInventory(page).locator('.mi-record').count(),2);
  await search(page,'BAT-3');await page.waitForFunction(()=>document.querySelector('.phone-route:not([hidden]) .mi-inventory-search input')?.value==='BAT-3');assert.equal(await visibleInventory(page).locator('.mi-record').count(),0);assert.equal(await visibleInventory(page).getByRole('region',{name:'Fixed inventory scope'}).textContent().then(text=>text.includes('Room one')),true);
});
test('search from Scan opens shared inventory without inheriting or replacing a retained Mapping room',browserOptions,async t=>{
  const page=await mount(t);await page.locator('.ios-dock').getByRole('button',{name:'Inventory',exact:true}).click();await visibleInventory(page).getByRole('tab',{name:'Mapping',exact:true}).click();await page.getByRole('button',{name:'Open controlled Room one',exact:true}).click();
  await page.locator('.ios-dock').getByRole('button',{name:'Scan',exact:true}).click();await search(page,'BAT-3');await page.waitForFunction(()=>document.querySelector('.phone-route:not([hidden]) .mi-inventory-search input')?.value==='BAT-3');assert.equal(await visibleInventory(page).locator('.mi-record').count(),1);assert.equal(await visibleInventory(page).getByRole('region',{name:'Fixed inventory scope'}).count(),0);
  await page.getByRole('button',{name:'Back to previous view',exact:true}).click();await page.locator('.ios-dock').getByRole('button',{name:'Inventory',exact:true}).click();assert.equal(await visibleInventory(page).getByRole('region',{name:'Fixed inventory scope'}).textContent().then(text=>text.includes('Room one')),true);assert.equal(await visibleInventory(page).locator('.mi-record').count(),2);
});
test('iOS inventory sheets retain readable foreground and full-size actions',browserOptions,async t=>{
  const page=await mount(t);await page.locator('.ios-dock').getByRole('button',{name:'Inventory',exact:true}).click();await visibleInventory(page).getByRole('button',{name:'Filter',exact:true}).click();
  const heading=page.getByRole('heading',{name:'Filter batteries',exact:true});await heading.waitFor();
  const colors=await heading.evaluate(node=>({foreground:getComputedStyle(node).color,background:getComputedStyle(node.closest('.mi-sheet')).backgroundColor}));
  const luminance=color=>color.match(/[\d.]+/g).slice(0,3).map(Number).map(value=>{const c=value/255;return c<=.04045?c/12.92:((c+.055)/1.055)**2.4;}).reduce((sum,value,index)=>sum+value*[.2126,.7152,.0722][index],0);
  const light=luminance(colors.foreground),dark=luminance(colors.background);assert.ok((Math.max(light,dark)+.05)/(Math.min(light,dark)+.05)>=4.5,JSON.stringify(colors));
  const apply=await page.getByRole('button',{name:'Apply filters',exact:true}).boundingBox();assert.ok(apply.height>=44);
});
test('search close restores focus and reduced-motion compact layouts keep actionable controls',browserOptions,async t=>{
  const page=await mount(t,{width:320,height:568,reducedMotion:'reduce'});await page.getByRole('button',{name:'Search inventory',exact:true}).click();await page.keyboard.press('Escape');assert.equal(await page.locator('.ios-search-panel').count(),0);assert.equal(await page.getByRole('button',{name:'Search inventory',exact:true}).evaluate(node=>node===document.activeElement),true);
  assert.equal(await page.evaluate(()=>document.querySelector('.ios-shell').scrollWidth>320),false);assert.equal(await page.locator('.ios-operation').count(),3);assert.equal(await page.locator('.ios-intake-entry').count(),1);
  if(process.env.IOS_PRESENTATION_SCREENSHOT_DIR){await mkdir(process.env.IOS_PRESENTATION_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:process.env.IOS_PRESENTATION_SCREENSHOT_DIR+'/ios-home-320.png'});await page.setViewportSize({width:390,height:844});await page.screenshot({path:process.env.IOS_PRESENTATION_SCREENSHOT_DIR+'/ios-home-390.png'});}
});

test('real iOS shell keeps four full-width bottom destinations after rotating to compact landscape',browserOptions,async t=>{
  const page=await mount(t);await page.setViewportSize({width:844,height:390});
  await page.locator('.ios-shell[data-phone-layout=wide]').waitFor();
  const geometry=await page.evaluate(()=>{
    const rect=selector=>{const r=document.querySelector(selector).getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom};};
    return{header:rect('.phone-topbar'),main:rect('.phone-main'),nav:rect('.ios-navigation'),dock:rect('.ios-dock'),buttons:[...document.querySelectorAll('.ios-dock>button')].map(n=>{const r=n.getBoundingClientRect();return{width:r.width,height:r.height,y:r.y};})};
  });
  assert.ok(geometry.header.height<=90,'Landscape header must not grow into the content area.');
  assert.ok(geometry.nav.width>=800&&geometry.dock.width>=500,'The iOS dock must not inherit the narrow Android side rail.');
  assert.ok(geometry.nav.y>=geometry.main.bottom-1&&geometry.nav.bottom<=391,'Navigation remains below the scroll owner and inside the viewport.');
  for(const button of geometry.buttons)assert.ok(button.width>=100&&button.height>=44&&Math.abs(button.y-geometry.buttons[0].y)<1,'All four destinations retain usable targets in one row.');
  await page.locator('.ios-dock').getByRole('button',{name:'Inventory',exact:true}).click();await visibleInventory(page).waitFor();
  await page.locator('.ios-dock').getByRole('button',{name:'Scan',exact:true}).click();await page.getByRole('button',{name:'Intake: Register new stock',exact:true}).click();
  await page.locator('.ios-workflow').waitFor();
});

test('iOS filter calendar stays inside its sheet when the date field is scrolled into view',browserOptions,async t=>{
  const page=await mount(t);
  await page.locator('.ios-dock').getByRole('button',{name:'Inventory',exact:true}).click();
  await visibleInventory(page).getByRole('button',{name:'Filter',exact:true}).click();
  const sheet=page.getByRole('dialog',{name:'Filter batteries',exact:true});
  await sheet.locator('summary').filter({hasText:'Age & activity'}).click();
  await page.getByRole('button',{name:'Open date picker: Latest checkout date minimum',exact:true}).click();
  const picker=page.getByRole('dialog',{name:'Choose Latest checkout date minimum',exact:true});await picker.waitFor();
  await page.waitForFunction(()=>{
    const popup=document.querySelector('.mi-mobile-date-picker'),sheet=document.querySelector('.mi-sheet');if(!popup||!sheet)return false;
    const p=popup.getBoundingClientRect(),s=sheet.getBoundingClientRect();return p.top>=s.top&&p.bottom<=s.bottom&&p.left>=s.left&&p.right<=s.right;
  });
  await picker.getByRole('button',{name:'Close',exact:true}).click();await picker.waitFor({state:'hidden'});
  assert.equal(await page.getByRole('button',{name:'Open date picker: Latest checkout date minimum',exact:true}).evaluate(node=>node===document.activeElement),true);
  await sheet.getByRole('button',{name:'Close Filter batteries',exact:true}).click();
});

test('filter validation brings repeated errors into view without losing its draft, fixed scope or chosen records',browserOptions,async t=>{
  const page=await mount(t,{width:390,height:568});
  await page.getByRole('button',{name:'Me, 2 unread messages',exact:true}).click();await page.getByRole('button',{name:'My responsibility',exact:true}).click();
  const inventory=visibleInventory(page),scope=inventory.getByRole('region',{name:'Fixed inventory scope'});
  await inventory.waitFor();const scopeText=await scope.textContent();
  await inventory.getByRole('button',{name:'Select batteries',exact:true}).click();await inventory.getByRole('checkbox',{name:'Select BAT-1',exact:true}).check();
  const saved=await page.evaluate(()=>fixture.view({kind:'owner',id:'STAFF-A'}));
  // Exclude the fixture's initial initialize_demo request from this read-only interaction.
  await page.evaluate(()=>fixture.requests=[]);
  await inventory.getByRole('button',{name:'Filter',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Filter batteries',exact:true}),body=dialog.locator('.mi-sheet-body');
  await dialog.locator('summary').filter({hasText:'Battery details'}).click();
  const minimum=dialog.getByRole('spinbutton',{name:'Capacity (mAh) minimum',exact:true}),maximum=dialog.getByRole('spinbutton',{name:'Capacity (mAh) maximum',exact:true});
  await minimum.fill('2000');await maximum.fill('1000');
  await body.evaluate(node=>{node.scrollTop=0;});
  await dialog.getByRole('button',{name:'Apply filters',exact:true}).click();
  const error=dialog.getByRole('alert');
  await page.waitForFunction(()=>{
    const error=document.querySelector('.mi-sheet [role="alert"]'),body=document.querySelector('.mi-sheet-body');
    if(!error||!body||document.activeElement!==error)return false;
    const content=body.getBoundingClientRect(),message=error.getBoundingClientRect();
    return message.top>=content.top-1&&message.bottom<=content.bottom+1;
  });
  assert.match(await error.textContent(),/Capacity: the maximum must be at least the minimum\./);
  assert.equal(await minimum.inputValue(),'2000');assert.equal(await maximum.inputValue(),'1000');
  // Repeating the same invalid Apply must restore visibility and focus even
  // though the error text has not changed since the preceding attempt.
  await body.evaluate(node=>{node.scrollTop=node.scrollHeight;});assert.ok(await body.evaluate(node=>node.scrollTop)>0);
  await dialog.getByRole('button',{name:'Apply filters',exact:true}).click();
  await page.waitForFunction(()=>{
    const error=document.querySelector('.mi-sheet [role="alert"]'),body=document.querySelector('.mi-sheet-body');
    if(!error||!body||document.activeElement!==error)return false;
    const content=body.getBoundingClientRect(),message=error.getBoundingClientRect();
    return message.top>=content.top-1&&message.bottom<=content.bottom+1;
  });
  assert.equal(await minimum.inputValue(),'2000');assert.equal(await maximum.inputValue(),'1000');
  await dialog.getByRole('button',{name:'Close Filter batteries',exact:true}).click();
  assert.equal(await scope.textContent(),scopeText);assert.equal(await inventory.locator('.mi-record').count(),2);
  assert.equal(await inventory.getByRole('checkbox',{name:'Select BAT-1',exact:true}).isChecked(),true);
  const retained=await page.evaluate(()=>fixture.view({kind:'owner',id:'STAFF-A'}));
  assert.deepEqual(retained.selectedIds,['BAT-1']);assert.deepEqual(retained.filter,saved.filter);
  assert.equal((await page.evaluate(()=>fixture.requests)).some(request=>request.method==='POST'),false);
});
