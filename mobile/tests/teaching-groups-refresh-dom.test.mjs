import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import ts from 'typescript';

// Actual shell, inventory polling, group routes, dialog and durable storage.
// Only unrelated feature leaves and transport are controlled; no hosted writes.
let runtime;
try { runtime = createRequire(import.meta.url)(process.env.MOBILE_BROWSER_TEST_MODULE || 'playwright'); } catch {}
const options = { skip: !runtime && 'Set MOBILE_BROWSER_TEST_MODULE for actual React DOM checks.' };
const root = fileURLToPath(new URL('../', import.meta.url));
const mocked = new Map();
for (const relative of ['app/phone-app.jsx', 'features/workspace/workspace.jsx']) {
  const url = new URL('../src/' + relative, import.meta.url);
  const source = await readFile(url, 'utf8');
  const ast = ts.createSourceFile(relative, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
  for (const node of ast.statements.filter(ts.isImportDeclaration)) {
    const specifier = node.moduleSpecifier.text;
    if (!specifier.startsWith('.')) continue;
    const path = fileURLToPath(new URL(specifier, url));
    if (/shared\/components\/inventory\/(?!teaching-groups-panel)|features\/(inventory\/inventory|lifecycle\/(intake|removal|manual-registration)|workspace\/(mobile-tasks|mobile-messages|mobile-activity|mobile-account))\.jsx$|app\/(battery-page|mobile-import-dialog|missing-inspection-recovery)\.jsx$|business\/(registration|nfc-read)\.jsx$/.test(path.replaceAll('\\', '/'))) {
      const names = node.importClause?.namedBindings?.elements.map(item => item.propertyName?.text || item.name.text) || [];
      mocked.set(path, names.map(name => `export function ${name}(){return null;}`).join('\n'));
    }
  }
}
const fixture = `
import React,{useState} from 'react';import{createRoot}from'react-dom/client';
import{MobileShell}from'./src/app/phone-app.jsx';import{createDurableStorage}from'./src/platform/durable-storage.mjs';
const f=window.fixture={requests:[],writes:[],disabledEvents:[],hold:false};
const user={id:'70000000-0000-4000-8000-000000000010',defaultDataset:'live',role:'staff',username:'fixture.staff',displayName:'Fixture staff'};
const group={id:'70000000-0000-4000-8000-000000000020',name:'Retained teaching set',notes:'Controlled local group',batteryIds:[],ownerAccountId:user.id,dataset:'live',state:'active',version:1};
f.snapshot={user,dataset:'live',events:[],batteries:[],people:[],staffDirectory:[],buildings:[],rooms:[],teachingGroups:[group]};
f.storage=createDurableStorage({load:async()=>null,save:async()=>{}});await f.storage.initialize();window.__batteryWorkflowStorage=f.storage;
window.fetch=async(input,init={})=>{const url=String(input);if(init.method==='POST'){f.writes.push({url,body:init.body});throw Error('No business write is permitted in this fixture');}
if(url.startsWith('/api/inventory')){if(!f.hold)return new Response(JSON.stringify(f.snapshot));return new Promise(resolve=>f.requests.push({resolve,signal:init.signal}));}
if(url.startsWith('/api/teaching-checkouts'))return new Response(JSON.stringify({runs:[]}));if(url.startsWith('/api/messages'))return new Response(JSON.stringify({messages:[]}));throw Error('Unexpected controlled read: '+url);};
f.respond=(index,status=200,body=f.snapshot)=>f.requests[index].resolve(new Response(JSON.stringify(status>=400?{error:'Controlled inventory refresh failure'}:body),{status}));
function App(){const[saving,setSaving]=useState(false),[storageError,setStorageError]=useState('');f.setSaving=setSaving;f.setStorageError=setStorageError;return <div className='phone-app'><MobileShell initialUser={user} origin='controlled-local' saving={saving} storageError={storageError}/></div>;}
f.root=createRoot(document.getElementById('root'));f.root.render(<App/>);
`;
let compiled;
async function mount(t) {
  if (!compiled) {
    const result = await build({ stdin: { contents: fixture, resolveDir: root, loader: 'jsx' }, bundle: true, write: false, jsx: 'automatic', format: 'esm', platform: 'browser', plugins: [{ name: 'controlled-unrelated-leaves', setup(api) {
      api.onLoad({ filter: /\.(jsx|js|mjs|css)$/ }, args => {
        if (args.path.endsWith('.css')) return { contents: '', loader: 'js' };
        if (mocked.has(args.path)) return { contents: mocked.get(args.path), loader: 'jsx' };
        if (args.path.endsWith('runtime.mjs')) return { contents: "export const native=false;export const businessStorage=()=>window.fixture.storage;export const saveFile=async()=>{};", loader: 'js' };
        if (args.path.endsWith('use-message-count.js')) return { contents: 'export const useMessageCount=()=>({unreadCount:0,acceptUnreadCount(){}});', loader: 'js' };
        if (args.path.endsWith('phone-arrivals.jsx')) return { contents: 'export const PhoneArrivalsProvider=({children})=>children;export const usePhoneArrivals=()=>({arrivals:null,pending:false,error:"",acknowledge(){}});', loader: 'jsx' };
      });
    } }] });
    compiled = result.outputFiles[0].text;
  }
  const browser = await runtime.chromium.launch({ headless: true, ...(process.env.MOBILE_BROWSER_TEST_CHANNEL ? { channel: process.env.MOBILE_BROWSER_TEST_CHANNEL } : {}) });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 412, height: 828 }, reducedMotion: 'reduce' });
  page.setDefaultTimeout(6000);
  const errors = []; page.on('pageerror', error => errors.push(error.message)); t.after(() => assert.deepEqual(errors, []));
  await page.route('https://group-refresh.fixture.test/**', route => route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' }));
  await page.goto('https://group-refresh.fixture.test/?presentation=ios');
  await page.addScriptTag({ content: compiled, type: 'module' });
  await page.locator('.phone-main[data-phone-content-state=ready]').waitFor();
  await page.getByRole('button', { name: 'Workspace', exact: true }).click();
  await page.locator('.phone-route:not([hidden]) .mobile-work-entry').filter({ hasText: 'Teaching groups' }).click();
  await page.getByRole('button', { name: 'Create teaching group', exact: true }).waitFor();
  await page.waitForFunction(() => ![...document.querySelectorAll('button')].find(node => node.textContent.trim() === 'Create teaching group')?.disabled);
  return page;
}
const createButton = page => page.getByRole('button', { name: 'Create teaching group', exact: true });
async function refresh(page) {
  const index = await page.evaluate(() => { fixture.hold = true; const index = fixture.requests.length; window.dispatchEvent(new Event('focus')); return index; });
  await page.waitForFunction(index => fixture.requests.length > index, index);
  await page.locator('.phone-main[data-phone-content-state=refreshing]').waitFor();
  return index;
}

test('real shell keeps group creation enabled through repeated background refresh and opens the actual editor during one', options, async t => {
  const page = await mount(t);
  await page.evaluate(() => {
    const button = [...document.querySelectorAll('button')].find(node => node.textContent.trim() === 'Create teaching group');
    new MutationObserver(records => records.forEach(record => fixture.disabledEvents.push({attribute:record.attributeName,disabled:button.disabled}))).observe(button,{attributes:true,attributeFilter:['disabled']});
  });
  for (let iteration = 0; iteration < 2; iteration++) {
    const index = await refresh(page);
    assert.equal(await createButton(page).isEnabled(), true);
    await page.evaluate(index => fixture.respond(index), index);
    await page.locator('.phone-sync-status[data-sync-state=ready]').waitFor({ state: 'attached' });
  }
  assert.deepEqual(await page.evaluate(() => fixture.disabledEvents), []);
  const index = await refresh(page);
  await createButton(page).click();
  const name = page.getByRole('textbox', { name: 'Group name', exact: true });
  await name.fill('Local draft retained during refresh');
  await page.evaluate(index => fixture.respond(index), index);
  assert.equal(await name.inputValue(), 'Local draft retained during refresh');
  assert.deepEqual(await page.evaluate(() => fixture.writes), []);
});

test('group navigation stays available during refresh while actual checkout stays guarded', options, async t => {
  const page = await mount(t);
  await refresh(page);
  await page.getByRole('button', { name: 'Members & checkout runs', exact: true }).click();
  await page.getByRole('button', { name: 'Review group checkout', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Review group checkout', exact: true }).isDisabled(), true);
  assert.equal(await page.getByRole('button', { name: 'Edit group definition', exact: true }).isEnabled(), true);
  await page.getByRole('button', { name: 'Edit group definition', exact: true }).click();
  await page.getByRole('textbox', { name: 'Group name', exact: true }).waitFor();
  assert.deepEqual(await page.evaluate(() => fixture.writes), []);
});

test('retained group creation still respects saving, storage failure and failed or mismatched refresh', options, async t => {
  const page = await mount(t);
  for (const failure of ['saving', 'storage']) {
    await page.evaluate(failure => failure === 'saving' ? fixture.setSaving(true) : fixture.setStorageError('Controlled recovery storage failure'), failure);
    await page.waitForFunction(() => [...document.querySelectorAll('button')].find(node => node.textContent.trim() === 'Create teaching group')?.disabled);
    assert.equal(await createButton(page).isDisabled(), true);
    await page.evaluate(() => { fixture.setSaving(false); fixture.setStorageError(''); });
    await page.waitForFunction(() => ![...document.querySelectorAll('button')].find(node => node.textContent.trim() === 'Create teaching group')?.disabled);
  }
  let index = await refresh(page);
  await page.evaluate(index => fixture.respond(index, 503), index);
  await page.locator('.phone-main[data-phone-content-state=stale]').waitFor();
  assert.equal(await createButton(page).isDisabled(), true);
  index = await refresh(page);
  await page.evaluate(index => fixture.respond(index, 200, {...fixture.snapshot,user:{...fixture.snapshot.user,id:'different-account'}}), index);
  await page.locator('.phone-main[data-phone-content-state=stale]').waitFor();
  assert.equal(await createButton(page).isDisabled(), true);
  assert.deepEqual(await page.evaluate(() => fixture.writes), []);
});

test('a changed account permission never inherits the retained group create action', options, async t => {
  const page = await mount(t), index = await refresh(page);
  await page.evaluate(index => fixture.respond(index, 200, {...fixture.snapshot,user:{...fixture.snapshot.user,role:'unavailable'}}), index);
  await page.getByRole('heading', { name: 'Access unavailable', exact: true }).waitFor();
  assert.equal(await createButton(page).count(), 0);
  assert.deepEqual(await page.evaluate(() => fixture.writes), []);
});
