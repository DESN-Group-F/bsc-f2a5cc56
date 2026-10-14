import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

let runtime;
try { runtime = createRequire(import.meta.url)(process.env.MOBILE_BROWSER_TEST_MODULE || 'playwright'); } catch {}
const options = { skip: !runtime && 'Set MOBILE_BROWSER_TEST_MODULE for actual Mapping and task-dialog geometry checks.' };
const root = fileURLToPath(new URL('../', import.meta.url));
let bundled;

async function mount(t, { width = 390, height = 844, safeArea = { top:47, bottom:34, left:0, right:0 } } = {}) {
  if (!bundled) {
    // Components, room summaries, template choices, focus and actions are real.
    // Only graphics projection, task GET response and isolated storage are controlled.
    const entry = `
      import React,{useLayoutEffect} from 'react';import{createRoot}from'react-dom/client';
      import{MappingScene}from'./src/features/inventory/mapping-scene.jsx';
      import{MobileTasks}from'./src/features/workspace/mobile-tasks.jsx';
      import{PhoneUIProvider}from'./src/app/phone-ui.jsx';
      import{activateIosPresentation}from'./src/app/ios-runtime-presentation.mjs';
      import './src/app.css';import './src/app/phone.css';
      import './src/features/inventory/inventory.css';import './src/features/workspace/workspace.css';
      import './src/app/ios-presentation.css';
      const f=window.fixture={opened:[],writes:[],storage:{getItem:()=>null,setItem:()=>{throw Error('Unexpected fixture write')},removeItem:()=>{throw Error('Unexpected fixture removal')},flush:async()=>{}}};
      window.__batteryWorkflowStorage=f.storage;
      const battery=id=>({id,name:id,lifecycleStatus:'active',observedAt:'2026-10-14T04:00:00.000Z',observedRoomId:'R1',observedRoom:'Storage',observedBuilding:'J18',observationRoomSnapshot:'recorded',observationSource:'fixture',loanId:null});
      f.data={user:{id:'fixture-admin',role:'admin'},dataset:'demo',events:[],people:[],staffDirectory:[],teachingGroups:[],buildings:[],batteries:[battery('BAT-1'),battery('BAT-2')],rooms:[{id:'R1',name:'Storage',number:'1',buildingId:'J18',selectable:true},{id:'R2',name:'Teaching preparation and inspection room',number:'2',buildingId:'J18',selectable:true}]};
      window.fetch=async()=>{throw Error('Unexpected fixture network request')};
      function App(){useLayoutEffect(()=>activateIosPresentation(document),[]);return <PhoneUIProvider namespace="mapping-dialog-fixture"><div className="phone-app"><div className="phone-shell ios-shell"><main className="phone-main"><div className="mobile-inventory"><MappingScene data={f.data} memoryKey="dialog-fixture" onRoom={scope=>f.opened.push(scope)}/></div><div className="mobile-work-page"><MobileTasks data={f.data}/></div></main></div></div></PhoneUIProvider>}
      createRoot(document.getElementById('root')).render(<App/>);`;
    const result = await build({ stdin:{ contents:entry, resolveDir:root, loader:'jsx' }, bundle:true, write:false, outfile:'mapping-dialog.js', jsx:'automatic', format:'esm', platform:'browser', plugins:[{ name:'controlled-fixture-boundaries', setup(api) {
      api.onLoad({ filter:/\.(jsx|js|mjs)$/ }, args => {
        const path = args.path.replaceAll('\\', '/');
        if (path.endsWith('/mapping-renderer.mjs')) return { contents:`export function createMappingRenderer(canvas,modules,onLabels){return{draw(){onLabels(modules.map((room,index)=>({id:room.id,x:index?4:96,y:46,visible:true})))},pick(){return modules[0]?.id},dispose(){}}}`, loader:'js' };
        if (path.endsWith('/platform/runtime.mjs')) return { contents:'export const native=false;export const businessStorage=()=>fixture.storage;export const saveFile=async()=>{};', loader:'js' };
        if (path.endsWith('/use-task-endpoint.js')) return { contents:'export const useTaskEndpoint=()=>({payload:{plans:[],cycles:[]},loading:false,error:"",refresh(){}});', loader:'js' };
      });
    } }] });
    bundled = { js:result.outputFiles.find(file => file.path.endsWith('.js')).text, css:result.outputFiles.find(file => file.path.endsWith('.css')).text };
  }
  const browser = await runtime.chromium.launch({ channel:process.env.MOBILE_BROWSER_TEST_CHANNEL || 'msedge', headless:true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport:{ width,height }, reducedMotion:'reduce' });
  const errors = [];page.on('pageerror', error => errors.push(error.message));t.after(() => assert.deepEqual(errors, []));
  await (await page.context().newCDPSession(page)).send('Emulation.setSafeAreaInsetsOverride', { insets:safeArea });
  await page.route('https://mapping.fixture.test/**', route => route.fulfill({ contentType:'text/html', body:`<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>${bundled.css}</style><div id="root"></div><script type="module">${bundled.js.replaceAll('</script','<\\/script')}</script>` }));
  await page.goto('https://mapping.fixture.test/?presentation=ios');
  if (process.env.MOBILE_PRESENTATION_CSS) await page.addStyleTag({ content:await readFile(process.env.MOBILE_PRESENTATION_CSS, 'utf8') });
  await page.locator('.mi-scene-label').first().waitFor();
  return page;
}

async function dialogGeometry(dialog) {
  return dialog.evaluate(node => {
    const rect = element => { const r=element.getBoundingClientRect();return{top:r.top,bottom:r.bottom,left:r.left,right:r.right,height:r.height,width:r.width}; };
    const body = node.querySelector('.mobile-task-dialog-body');
    return { viewport:innerHeight,dialog:rect(node),header:rect(node.querySelector('header')),body:{...rect(body),clientHeight:body.clientHeight,scrollHeight:body.scrollHeight},footer:node.querySelector('footer')&&rect(node.querySelector('footer')),targets:[...node.querySelectorAll('button')].map(button=>({text:button.textContent,...rect(button)})) };
  });
}

test('real Mapping room summary keeps readable body, dated evidence and explicit room navigation on a safe-area iPhone viewport', options, async t => {
  const page=await mount(t),scene=page.locator('.mi-scene');
  await scene.click({position:{x:180,y:160}});
  const dialog=page.getByRole('dialog',{name:'Room summary',exact:true});await dialog.waitFor();
  const geometry=await dialogGeometry(dialog);
  if(process.env.IOS_GEOMETRY_DEBUG)t.diagnostic(JSON.stringify(geometry));
  assert.ok(geometry.body.height>=240&&geometry.body.height<=280,'The compact summary reserves about 250px for evidence between the fixed header and footer: '+JSON.stringify(geometry));
  assert.ok(geometry.dialog.height<=400,'Short room summaries must not become tall empty task-template frames.');
  assert.ok(geometry.dialog.top>=47&&geometry.dialog.bottom<=844-34,'The complete frame stays inside the safe area.');
  assert.ok(geometry.header.bottom<=geometry.body.top+1&&geometry.body.bottom<=geometry.footer.top+1);
  assert.equal(await dialog.getByRole('heading',{name:'Storage',exact:true}).isVisible(),true);
  assert.match(await dialog.textContent(),/Latest dated observations; present location is not confirmed/);
  assert.match(await dialog.textContent(),/BAT-1/);assert.match(await dialog.textContent(),/BAT-2/);
  for(const button of geometry.targets)assert.ok(button.height>=44);
  assert.deepEqual(await page.evaluate(()=>fixture.opened),[]);
  if(process.env.IOS_AUDIT_SCREENSHOT_DIR){await mkdir(process.env.IOS_AUDIT_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:process.env.IOS_AUDIT_SCREENSHOT_DIR+'/mapping-room-summary.png'});}
  const body=dialog.locator('.mobile-task-dialog-body');
  assert.ok(geometry.body.scrollHeight>geometry.body.clientHeight,'Two complete dated observations remain available through body scrolling.');
  await body.evaluate(node=>{node.scrollTop=node.scrollHeight;});
  assert.ok(await body.evaluate(node=>node.scrollTop)>0);
  const lastEvidence=await body.locator('.mi-evidence-preview li').last().boundingBox();
  assert.ok(lastEvidence.y+lastEvidence.height<=geometry.body.bottom+1,'The final observation can be read without moving the fixed action.');
  const afterScroll=await dialogGeometry(dialog);assert.equal(afterScroll.footer.top,geometry.footer.top);
  await dialog.getByRole('button',{name:'View room records',exact:true}).click();
  assert.deepEqual(await page.evaluate(()=>fixture.opened),[{kind:'room',id:'R1',label:'Storage'}]);
  assert.equal(await page.locator('dialog[open]').count(),0);
  await page.locator('.mi-room-list').getByRole('button',{name:/Teaching preparation and inspection room/}).click();
  await dialog.waitFor();
  assert.match(await dialog.textContent(),/No active batteries mapped to this room/);
  assert.ok((await dialogGeometry(dialog)).dialog.height<=400,'An empty room keeps the same compact frame.');
  await dialog.getByRole('button',{name:'Close Room summary',exact:true}).click();
});

test('scene labels at both projection edges retain readable width and stay inside the schematic', options, async t => {
  const page=await mount(t);
  const geometry=await page.locator('.mi-scene-wrap').evaluate(scene=>{
    const area=scene.getBoundingClientRect();return [...scene.querySelectorAll('.mi-scene-label')].map(label=>{const box=label.getBoundingClientRect();return{text:label.textContent,width:box.width,height:box.height,left:box.left-area.left,right:box.right-area.left,sceneWidth:area.width};});
  });
  if(process.env.IOS_GEOMETRY_DEBUG)t.diagnostic(JSON.stringify(geometry));
  for(const label of geometry){assert.ok(label.width>=70,'Projected labels must not become one-letter columns: '+JSON.stringify(label));assert.ok(label.height<85,JSON.stringify(label));assert.ok(label.left>=0&&label.right<=label.sceneWidth,JSON.stringify(label));}
});

test('real task-template dialog preserves a usable scroll body and close control in portrait and compact landscape', options, async t => {
  const page=await mount(t);
  await page.getByRole('button',{name:'Create task plan',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Create a task plan',exact:true});await dialog.waitFor();
  let geometry=await dialogGeometry(dialog);
  assert.ok(geometry.body.height>=280,JSON.stringify(geometry));assert.ok(geometry.dialog.top>=47&&geometry.dialog.bottom<=810);
  assert.ok(geometry.body.scrollHeight>geometry.body.clientHeight,'The actual template collection remains scrollable.');
  const first=dialog.getByRole('button',{name:/Start from scratch/});assert.equal(await first.isVisible(),true);
  await dialog.locator('.mobile-task-dialog-body').evaluate(node=>{node.scrollTop=node.scrollHeight;});
  assert.ok(await dialog.locator('.mobile-task-dialog-body').evaluate(node=>node.scrollTop)>0);
  await page.setViewportSize({width:844,height:390});
  await (await page.context().newCDPSession(page)).send('Emulation.setSafeAreaInsetsOverride',{insets:{top:0,bottom:21,left:47,right:47}});
  geometry=await dialogGeometry(dialog);
  assert.ok(geometry.body.height>=180,JSON.stringify(geometry));assert.ok(geometry.dialog.top>=8&&geometry.dialog.bottom<=369);
  const close=dialog.getByRole('button',{name:'Close Create a task plan',exact:true});const box=await close.boundingBox();assert.ok(box.height>=44&&box.y>=0&&box.y+box.height<390);
  await close.click();assert.equal(await page.locator('dialog[open]').count(),0);
  assert.equal(await page.getByRole('button',{name:'Create task plan',exact:true}).evaluate(node=>node===document.activeElement),true);
});
