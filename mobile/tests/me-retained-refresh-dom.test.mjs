import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import ts from 'typescript';

// Actual Shell, navigation, Me, endpoint hook and inherited CSS. Only unrelated
// feature leaves and transport are controlled; no physical device is involved.
let runtime;
try { runtime = createRequire(import.meta.url)(process.env.MOBILE_BROWSER_TEST_MODULE || 'playwright'); } catch {}
const options = { skip: !runtime && 'Set MOBILE_BROWSER_TEST_MODULE for real React DOM and CSS checks.' };
const root = fileURLToPath(new URL('../', import.meta.url));
const shellUrl = new URL('../src/app/phone-app.jsx', import.meta.url);
const shellSource = await readFile(shellUrl, 'utf8');
const shellAst = ts.createSourceFile('phone-app.jsx', shellSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
const mocked = new Map();
for (const node of shellAst.statements.filter(ts.isImportDeclaration)) {
  const path = fileURLToPath(new URL(node.moduleSpecifier.text, shellUrl));
  if (/shared\/components\/|features\/(inventory\/inventory|lifecycle\/(intake|removal|manual-registration))\.jsx$|app\/(battery-page|mobile-import-dialog|missing-inspection-recovery)\.jsx$|business\/(registration|nfc-read)\.jsx$/.test(path.replaceAll('\\', '/'))) {
    const names = node.importClause?.namedBindings?.elements.map(item => item.propertyName?.text || item.name.text) || [];
    mocked.set(path, names.map(name => `export function ${name}(){return null;}`).join('\n'));
  }
}
const workspaceUrl = new URL('../src/features/workspace/workspace.jsx', import.meta.url);
const workspaceSource = await readFile(workspaceUrl, 'utf8');
const workspaceAst = ts.createSourceFile('workspace.jsx', workspaceSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
const meSource = `import {Pressable} from '../../app/phone-ui.jsx';
import {iosPresentation} from '../../app/ios-runtime-presentation.mjs';
import {ArrowRight,CalendarDays,ChevronRight,History,Inbox,Settings2,UserRound,Battery,LogOut} from 'lucide-react';
import {useTaskEndpoint} from '../../shared/hooks/use-task-endpoint.js';
import {currentSydneyDate} from '../../shared/lib/battery-age.js';
import {formatDateOnly} from '../../shared/lib/client-utils.js';
import {InkOrb} from '../scan/ink-orb.jsx';
import {PhoneResourceState} from './phone-controls.jsx';
import {actionableMessages,ownMessagesUrl,personalBatterySummary} from './workspace-model.mjs';
${workspaceAst.statements.filter(node => ts.isFunctionDeclaration(node) && ['WorkEntry', 'TodoPreview', 'MeScreen'].includes(node.name?.text)).map(node => node.getFullText(workspaceAst)).join('\n')}
export function WorkspaceScreen(){return null;}export function WorkspacePage(){return null;}`;
mocked.set(fileURLToPath(workspaceUrl), meSource);
const modelUrl = new URL('../src/shared/components/inventory/battery-model-picker.js', import.meta.url);
const modelSource = await readFile(modelUrl, 'utf8');
const modelAst = ts.createSourceFile('models.js', modelSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
mocked.set(fileURLToPath(modelUrl), `import {newBatteryModelSchema,updateBatteryModelSchema} from '../../lib/battery-models.js';${modelAst.statements.filter(node => ts.isFunctionDeclaration(node) && ['modelCreateStorageKey', 'recoverModelCreate'].includes(node.name?.text)).map(node => node.getFullText(modelAst)).join('\n')}`);
const fixture = `
import React from 'react';import{createRoot}from'react-dom/client';
import{MobileShell}from'./src/app/phone-app.jsx';import{createDurableStorage}from'./src/platform/durable-storage.mjs';
const f=window.fixture={requests:[],errors:[]};const user={id:'STAFF-A',defaultDataset:'demo',role:'staff',username:'fixture.staff',displayName:'Fixture staff'};
f.snapshot={user,dataset:'demo',events:[],batteries:[{id:'BAT-00000001',name:'A retained battery',lifecycleStatus:'active',loanId:'LOAN-A',borrowerAccountId:user.id,ownerAccountId:user.id}],people:[],staffDirectory:[],buildings:[],rooms:[],teachingGroups:[]};
const scenario=new URL(location.href).searchParams.get('scenario');
f.payload={messages:scenario==='nonempty'?[{id:'MESSAGE-A',title:'Retained equipment inspection task',taskStatus:'open',dueOn:'2026-10-13',cycle:{id:'CYCLE-A',canComplete:true,planRemoved:false}}]:[]};
f.storage=createDurableStorage({load:async()=>null,save:async()=>{}});await f.storage.initialize();
window.fetch=async(input,options={})=>{const path=String(input);if(path.startsWith('/api/inventory'))return new Response(JSON.stringify(f.snapshot));if(path.startsWith('/api/messages'))return new Promise(resolve=>f.requests.push({resolve,signal:options.signal}));throw Error('Unexpected controlled read '+path);};
f.respond=(index,status=200,body=f.payload)=>f.requests[index].resolve(new Response(JSON.stringify(status>=400?{error:'Controlled task refresh failed'}:body),{status}));
f.root=createRoot(document.getElementById('root'));f.root.render(<div className='phone-app'><MobileShell initialUser={user} origin='controlled-local' saving={false}/></div>);
`;
let compiled, styles;
async function mount(t, scenario = 'empty') {
  if (!compiled) {
    const result = await build({ stdin: { contents: fixture, resolveDir: root, sourcefile: 'me-retention.jsx', loader: 'jsx' }, bundle: true, write: false, jsx: 'automatic', format: 'esm', platform: 'browser', plugins: [{ name: 'controlled-leaves', setup(api) {
      api.onLoad({ filter: /\.(jsx|js|mjs|css)$/ }, async args => {
        if (args.path.endsWith('.css')) return { contents: '', loader: 'js' };
        if (mocked.has(args.path)) return { contents: mocked.get(args.path), loader: 'jsx' };
        if (args.path.endsWith('runtime.mjs')) return { contents: "export const native=false;export const businessStorage=()=>window.fixture.storage;export const saveFile=async()=>{};", loader: 'js' };
        if (args.path.endsWith('use-message-count.js')) return { contents: 'export const useMessageCount=()=>({unreadCount:0,acceptUnreadCount(){}});', loader: 'js' };
        if (args.path.endsWith('phone-arrivals.jsx')) return { contents: 'export const PhoneArrivalsProvider=({children})=>children;export const usePhoneArrivals=()=>({arrivals:null,pending:false,error:"",acknowledge(){}});', loader: 'jsx' };
      });
    } }] });
    compiled = result.outputFiles.find(file => file.path.endsWith('.js') || file.path === '<stdout>').text;
    styles = (await Promise.all(['shared/vendor/shadcn-tailwind-4.13.0.css', 'shared/styles/theme.css', 'shared/styles/base.css', 'shared/styles/components.css', 'app.css', 'app/phone.css', 'app/phone-choice.css', 'features/scan/scan.css', 'features/scan/ink-orb.css', 'features/workspace/workspace.css'].map(file => readFile(new URL('../src/' + file, import.meta.url), 'utf8')))).join('\n').replace(/@import[^;]+;/g, '');
  }
  const browser = await runtime.chromium.launch({ headless: true, ...(process.env.MOBILE_BROWSER_TEST_CHANNEL ? { channel: process.env.MOBILE_BROWSER_TEST_CHANNEL } : {}) });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 412, height: 828 } }); page.setDefaultTimeout(5000);
  const errors = []; page.on('pageerror', error => errors.push(error.message)); t.after(() => assert.deepEqual(errors, []));
  await page.route('https://me-retention.fixture.test/**', route => route.fulfill({ contentType: 'text/html', body: '<style>' + styles + 'html{font-size:16px}</style><div id="root"></div>' }));
  await page.goto('https://me-retention.fixture.test/?scenario=' + scenario);
  await page.addScriptTag({ content: compiled, type: 'module' });
  await page.locator('.scan-lookup-target').waitFor();
  await page.evaluate(() => [...document.querySelectorAll('.phone-bottom-bar button')].find(node => node.textContent.trim() === 'Me').click());
  await page.locator('.phone-route:not([hidden]) .mobile-me-home').waitFor();
  await page.waitForFunction(() => fixture.requests.length > 0);
  return page;
}
const measured = page => page.evaluate(() => { const node = document.querySelector('.phone-main'); const settings = [...document.querySelectorAll('.phone-route:not([hidden]) .mobile-work-entry')].find(node => node.textContent.includes('App settings')); return { top: node.scrollTop, height: node.scrollHeight, client: node.clientHeight, settings: settings?.getBoundingClientRect().top }; });
async function loadedBottom(page) {
  await page.evaluate(() => fixture.respond(0));
  await page.locator('.phone-route:not([hidden]) [data-resource-state=ready]').waitFor();
  await page.evaluate(() => { const node = document.querySelector('.phone-main'); node.scrollTop = node.scrollHeight; });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const original = await measured(page); assert.ok(original.top > 100, 'The regression runs at the actual bottom of a scrollable Me page'); return original;
}
async function focusRefresh(page) {
  const count = await page.evaluate(() => fixture.requests.length);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.waitForFunction(count => fixture.requests.length > count, count);
  await page.locator('.phone-route:not([hidden]) [data-resource-state=refreshing]').waitFor();
  return count;
}
function retainedGeometry(actual, original) {
  assert.equal(actual.height, original.height, 'Refreshing or stale content keeps the same content height');
  assert.equal(actual.client, original.client);
  assert.ok(Math.abs(actual.top - original.top) < 1, 'The browser never clamps the retained bottom');
  assert.ok(Math.abs(actual.settings - original.settings) < 1, 'The App settings entry remains in place');
}

test('actual Me retains empty content and bottom scroll during delayed focus refresh and recovery', options, async t => {
  const page = await mount(t), original = await loadedBottom(page), index = await focusRefresh(page);
  await page.getByText('No tasks to complete.', { exact: true }).waitFor();
  retainedGeometry(await measured(page), original);
  await page.evaluate(index => fixture.respond(index), index);
  await page.locator('.phone-route:not([hidden]) [data-resource-state=ready]').waitFor();
  retainedGeometry(await measured(page), original);
});
test('actual Me retains nonempty task rows and bottom scroll during delayed focus refresh', options, async t => {
  const page = await mount(t, 'nonempty'), original = await loadedBottom(page), index = await focusRefresh(page);
  await page.getByText('Retained equipment inspection task', { exact: true }).waitFor();
  retainedGeometry(await measured(page), original);
  assert.equal(await page.getByText('No tasks to complete.', { exact: true }).count(), 0);
  await page.evaluate(index => fixture.respond(index), index);
  await page.locator('.phone-route:not([hidden]) [data-resource-state=ready]').waitFor();
  retainedGeometry(await measured(page), original);
});
test('actual Me retains empty content, stale diagnostics and scroll through refresh failure and Retry', options, async t => {
  const page = await mount(t), original = await loadedBottom(page), index = await focusRefresh(page);
  await page.evaluate(index => fixture.respond(index, 503), index);
  await page.locator('.phone-route:not([hidden]) [data-resource-state=stale]').waitFor();
  await page.getByText('No tasks to complete.', { exact: true }).waitFor();
  assert.match(await page.locator('.phone-route:not([hidden]) [data-resource-state=stale]').textContent(), /Couldn't refresh/);
  retainedGeometry(await measured(page), original);
  const next = await page.evaluate(() => fixture.requests.length);
  await page.evaluate(() => document.querySelector('.phone-route:not([hidden]) [data-resource-state=stale]>button').click());
  await page.waitForFunction(count => fixture.requests.length > count, next);
  retainedGeometry(await measured(page), original);
  await page.evaluate(index => fixture.respond(index), next);
  await page.locator('.phone-route:not([hidden]) [data-resource-state=ready]').waitFor();
  retainedGeometry(await measured(page), original);
});
test('actual Me never invents an empty result during initial loading, initial failure or malformed payload', options, async t => {
  const page = await mount(t);
  assert.equal(await page.getByText('No tasks to complete.', { exact: true }).count(), 0);
  await page.evaluate(() => fixture.respond(0, 503));
  await page.getByText("Couldn't load these records.", { exact: true }).waitFor();
  assert.equal(await page.getByText('No tasks to complete.', { exact: true }).count(), 0);
  await page.evaluate(() => document.querySelector('.phone-route:not([hidden]) .mobile-work-load-error>button').click());
  await page.waitForFunction(() => fixture.requests.length === 2);
  await page.evaluate(() => fixture.respond(1, 200, { messages: null }));
  await page.waitForFunction(() => !document.querySelector('.phone-route:not([hidden]) .mobile-work-load-error'));
  assert.equal(await page.getByText('No tasks to complete.', { exact: true }).count(), 0);
});
