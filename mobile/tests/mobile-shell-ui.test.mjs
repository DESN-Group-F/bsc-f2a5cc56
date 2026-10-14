import { test } from 'node:test';
import * as iosPresentation from '../src/app/ios-presentation.mjs';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import * as navigation from '../src/app/phone-navigation.mjs';
import * as interaction from '../src/app/phone-interaction.mjs';
import * as entryIntent from '../src/app/phone-entry-intent.mjs';
import {phoneAdmission} from '../src/app/phone-admission.mjs';
import {phoneFormDraftKey} from '../src/app/phone-form-draft.mjs';
import * as detailBoundary from '../src/app/detail-boundary.mjs';
import * as scrolling from '../src/app/phone-scroll.mjs';
import { markPhoneMilestone } from '../src/app/phone-milestones.mjs';
import * as inventoryModel from '../src/features/inventory/inventory-model.mjs';
import * as inventoryInteraction from '../src/features/inventory/inventory-interaction.mjs';
import * as inventoryQuery from '../src/shared/lib/inventory-query.js';
import * as batteryLifecycle from '../src/shared/lib/battery-lifecycle.js';
import { getRolePermissions } from '../src/shared/lib/permissions.js';
import { recentNewArrivals } from '../src/shared/lib/new-arrivals.js';
import { currentSydneyDate } from '../src/shared/lib/battery-age.js';
import { formatTime } from '../src/shared/lib/client-utils.js';
import { createDurableStorage } from '../src/platform/durable-storage.mjs';
import { captureIntakeDraft, recoverIntakeDraft } from '../src/shared/lib/intake-draft.js';
import { intakeStorageKey, intakeCommonSchema } from '../src/shared/lib/intake-session.js';
import { captureMovementAttempt, movementStorageKey } from '../src/shared/lib/movement-session.js';
import { captureRemovalDraft, recoverRemovalDraft, removalDraftStorageKey } from '../src/shared/lib/removal-draft.js';
import { lifecycleStorageKey } from '../src/shared/lib/lifecycle-session.js';
import { removalScopeStorageKey, recoverRemovalScope } from '../src/features/lifecycle/removal-controller.mjs';
import { acknowledgeWorkflowStorage } from '../src/shared/lib/client/workflow-storage.js';
import { inventoryResponse } from '../src/shared/lib/client/inventory-request.js';
import { inventoryRevisionKey } from '../src/shared/lib/new-arrivals.js';
import { createIntakeController } from '../src/features/lifecycle/intake-controller.mjs';

// Load the real discovery graph, excluding only the model picker's React view.
const modelUrl=new URL('../src/shared/components/inventory/battery-model-picker.js',import.meta.url);
const modelSource=await readFile(modelUrl,'utf8'),modelAst=ts.createSourceFile(modelUrl.pathname,modelSource,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const modelFunctions=modelAst.statements.filter(statement=>ts.isFunctionDeclaration(statement)&&['modelCreateStorageKey','recoverModelCreate'].includes(statement.name?.text)).map(statement=>statement.getFullText(modelAst));
assert.equal(modelFunctions.length,2);
const modelModule='data:text/javascript,'+encodeURIComponent(`import { newBatteryModelSchema, updateBatteryModelSchema } from ${JSON.stringify(new URL('../src/shared/lib/battery-models.js',import.meta.url).href)};\n${modelFunctions.join('\n')}`);
const recoveryUrl=new URL('../src/app/recovery.mjs',import.meta.url);
const {discoverMobileRecovery:realDiscoverMobileRecovery,discoverMobileDrafts:realDiscoverMobileDrafts}=await import('data:text/javascript,'+encodeURIComponent((await readFile(recoveryUrl,'utf8')).replace(/from (['"])(\.[^'"]+)\1/g,(_,quote,specifier)=>`from ${JSON.stringify(specifier.endsWith('/components/inventory/battery-model-picker.js')?modelModule:new URL(specifier,recoveryUrl).href)}`)));

// Execute MobileShell, RouteView and their public event callbacks. React hooks,
// browser surfaces, inventory transport and feature presentation are controlled.
// No actual business request, browser layout or native keyboard is exercised.
// memo passes through at this guard layer; the independent retention suite uses
// real React.memo descriptors to assess prop identity and default comparison.
const source = await readFile(new URL('../src/app/phone-app.jsx', import.meta.url), 'utf8');
const inventoryHookSource = await readFile(new URL('../src/shared/hooks/use-inventory-data.js',import.meta.url),'utf8');
const recoverySource = await readFile(new URL('../src/app/recovery.mjs',import.meta.url),'utf8');
const cleanupBindings = { recoverRemovalDraft,removalDraftStorageKey,lifecycleStorageKey,removalScopeStorageKey,recoverRemovalScope,intakeStorageKey,recoverIntakeDraft,acknowledgeWorkflowStorage };
const realClearEmptyDeviceWork = new Function(...Object.keys(cleanupBindings),recoverySource.slice(recoverySource.indexOf('function emptyLifecycleKeys')).replace(/^export /gm,'')+'\nreturn clearEmptyDeviceWork;')(...Object.values(cleanupBindings));
const parsed = ts.createSourceFile('phone-app.jsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
const importNames = {};
for (const statement of parsed.statements.filter(ts.isImportDeclaration)) {
  if (statement.importClause?.name) importNames[statement.importClause.name.text] = statement.importClause.name.text;
  for (const binding of statement.importClause?.namedBindings?.elements ?? []) importNames[binding.name.text] = binding.name.text;
}
const compiled = ts.transpileModule(parsed.statements.filter(statement => !ts.isImportDeclaration(statement)).map(statement => statement.getFullText(parsed)).join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX }, reportDiagnostics: true });
assert.equal(compiled.diagnostics.some(value => value.category === ts.DiagnosticCategory.Error), false);
const code = compiled.outputText.replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
const jsx = (type, props, key) => typeof type === 'function' && ['RouteView','ArrivalInventoryView','ArrivalNavigationIndicator'].includes(type.name) ? type(props) : ({ type, props: props ?? {}, key });
const sameDeps = (before, next) => before && next && before.length === next.length && before.every((value, index) => Object.is(value, next[index]));

function hooks() {
  const cells = []; let index = 0, layout = [], effects = [], dirty = false, unmounted = false, lateUpdates = 0;
  function effect(callback, deps, queue) { const key = index++, previous = cells[key]; if (!previous || !sameDeps(previous.deps, deps)) queue.push(() => { previous?.cleanup?.(); cells[key] = { deps, cleanup: callback() }; }); }
  const api = {
    reset() { index = 0; layout = []; effects = []; dirty = false; },
    useState(initial) { const key = index++; if (!(key in cells)) { const cell = cells[key] = { value: typeof initial === 'function' ? initial() : initial }; cell.set = update => { if (unmounted) lateUpdates++; const next = typeof update === 'function' ? update(cell.value) : update; if (!Object.is(next, cell.value)) { cell.value = next; dirty = true; } }; } return [cells[key].value,cells[key].set]; },
    useRef(initial) { const key = index++; if (!(key in cells)) cells[key] = { current: initial }; return cells[key]; },
    useMemo(factory, deps) { const key = index++; if (!cells[key] || !sameDeps(cells[key].deps, deps)) cells[key] = { deps, value: factory() }; return cells[key].value; },
    useCallback(callback, deps) { return api.useMemo(() => callback, deps); },
    useEffect(callback, deps) { effect(callback, deps, effects); },
    useLayoutEffect(callback, deps) { effect(callback, deps, layout); },
    useSyncExternalStore(subscribe, snapshot) { const key = index++, previous = cells[key]; if (!previous || previous.subscribe !== subscribe) { previous?.cleanup?.(); cells[key] = { subscribe, cleanup: subscribe(() => { dirty = true; }) }; } return snapshot(); },
    commit() { layout.forEach(callback => callback()); effects.forEach(callback => callback()); return dirty; },
    unmount() { if (!unmounted) { unmounted = true; cells.forEach(cell => cell?.cleanup?.()); } },
    lateUpdates() { return lateUpdates; },
  };
  return api;
}
function nodes(tree, result = []) { if (Array.isArray(tree)) tree.forEach(child => nodes(child, result)); else if (tree && typeof tree === 'object') { result.push(tree); nodes(tree.props?.children, result); } return result; }
function text(tree) { return typeof tree === 'string' || typeof tree === 'number' ? String(tree) : Array.isArray(tree) ? tree.map(text).join('') : tree && typeof tree === 'object' ? text(tree.props?.children) : ''; }
const settle = () => new Promise(resolve => setImmediate(resolve));
function windowSurface() {
  const listeners = new Map();
  return { addEventListener(type, handler, options) { const entries = listeners.get(type) ?? []; entries.push({ handler, capture: options?.capture === true }); listeners.set(type, entries); }, removeEventListener(type, handler) { listeners.set(type, (listeners.get(type) ?? []).filter(entry => entry.handler !== handler)); }, dispatchEvent(event) { for (const entry of [...(listeners.get(event.type) ?? [])].sort((a, b) => Number(b.capture) - Number(a.capture))) { entry.handler(event); if (event.immediateStopped) break; } return !event.defaultPrevented; }, getComputedStyle: node => ({ zIndex: node.zIndex ?? 'auto' }), scrollTo() { assert.fail('The shell must restore the main scroll owner, not window scroll.'); } };
}
class BackEvent extends Event { constructor() { super('battery-mobile-back', { cancelable: true }); this.immediateStopped = false; } stopImmediatePropagation() { this.immediateStopped = true; super.stopImmediatePropagation(); } }
class KeyboardEventStub extends Event { constructor(type, options = {}) { super(type, options); this.key = options.key; this.code = options.code; } }

function mount(t, { deferRecovery = false, initialRecovery = null, missingBattery = false, loanId = null, realInventory = false, realRecovery = false, seed = {} } = {}) {
  const state = hooks(), entries = new Map(Object.entries(seed)), observers = new Set(), frames = [], clearCalls = [], requests = [];
  const env = { dataset: 'demo', actor: 'staff-a', loanId, groups: [], overlays: [], observers, keyboardOpen: false, systemReduced: false, error: '', loading:false,saving:false,storageError:'',animations:[],entries,load:async()=>{},refresh:async()=>{},polling:null, deferRecovery, clearCalls, requests, frames, pendingRecovery:initialRecovery };
  if(realRecovery)env.discoverRecovery=realDiscoverMobileRecovery;
  env.acceptRead=()=>{env.acceptedUser={...env.acceptedUser};};
  const readRequests=[];
  const window = windowSurface(), documentEvents = new EventTarget(), classes = new Set();
  const body = { dataset: {}, style: {}, classList: { add: name => classes.add(name), remove: name => classes.delete(name) }, getAttribute(name) { return name === 'data-phone-input' ? this.dataset.phoneInput ?? null : null; }, setAttribute(name,value) { if(name==='data-phone-input')this.dataset.phoneInput=value; }, removeAttribute(name) { if(name==='data-phone-input')delete this.dataset.phoneInput; } };
  const trigger = { isConnected: true, matches: () => false, closest: () => null, getClientRects: () => [{}], focus() {} };
  const document = { body, activeElement: trigger, visibilityState:'visible', querySelectorAll: () => env.overlays, addEventListener: documentEvents.addEventListener.bind(documentEvents), removeEventListener: documentEvents.removeEventListener.bind(documentEvents), dispatchEvent: documentEvents.dispatchEvent.bind(documentEvents) };
  const main = Object.assign(new EventTarget(),{ scrollTop: 0, getBoundingClientRect:()=>({top:0}), scrollTo({ top }) { this.scrollTop = top; } });
  main.querySelector = selector => { assert.equal(selector,'.phone-route:not([hidden])');const route=nodes(tree).find(node=>node.props.className==='phone-route'&&!node.props.hidden);return route ? { animate(keyframes,options){const animation={route:route.props['data-route'],keyframes,options,cancelled:false,cancel(){this.cancelled=true;}};env.animations.push(animation);return animation;} } : null; };
  const storage = { getItem: key => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, value), flush: async () => {}, entries: () => Object.fromEntries(entries) };
  const descriptors = Object.fromEntries(['window', 'document', 'MutationObserver', 'requestAnimationFrame', 'cancelAnimationFrame', 'KeyboardEvent', 'fetch'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  class Observer { constructor(callback) { this.callback = callback; } observe() { observers.add(this.callback); } disconnect() { observers.delete(this.callback); } }
  for (const [key, value] of Object.entries({ window, document, MutationObserver: Observer, requestAnimationFrame: callback => frames.push(callback), cancelAnimationFrame:id=>{frames[id-1]=null;}, KeyboardEvent: KeyboardEventStub, fetch: async (...args) => {
    requests.push(args);if(!realInventory)assert.fail('A routing-only test must not send network requests.');
    if(args[1]?.method==='POST')return new Response('{}');
    let resolve,reject;const response=new Promise((yes,no)=>{resolve=yes;reject=no;});const signal=args[1]?.signal;
    const abort=()=>reject(new DOMException('Cancelled','AbortError'));signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
    readRequests.push({path:args[0],signal,resolve:(snapshot,status=200)=>resolve(new Response(JSON.stringify(snapshot),{status})),reject});return response;
  } })) Object.defineProperty(globalThis, key, { configurable: true, value });
  const currentUser=()=>{if(!env.acceptedUser || env.acceptedUser.id!==env.actor || env.acceptedUser.defaultDataset!==env.dataset)env.acceptedUser={id:env.actor,defaultDataset:env.dataset,role:'staff',username:'operator',displayName:'Staff member'};return env.acceptedUser;};
  const data = () => ({ dataset: env.dataset, user: currentUser(), batteries: missingBattery ? [] : [{ id: 'BAT-00000042', name: 'Recorded battery', version: 3, tagId: null, model:'',chemistry:'', ownerAccountId: env.actor, ownerName:'Staff member',ownerId:'staff-person', lifecycleStatus: 'active', loanId: env.loanId,borrowerAccountId:env.loanId ? env.actor : null,borrowerName:env.loanId ? 'Staff member' : null,manufacturedOn:null,firstUsedOn:null }], teachingGroups: env.groups, people: [], rooms: [], staffDirectory: [], buildings: [] });
  const actualInventory = new Function('useState','useRef','useCallback','useEffect','inventoryResponse','inventoryRevisionKey',inventoryHookSource.replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'')+'\nreturn {useInventoryData,useInventoryPolling};')(state.useState,state.useRef,state.useCallback,state.useEffect,inventoryResponse,inventoryRevisionKey);
  const load = (...args) => env.load(...args), refresh = () => env.refresh(), setReadError = value => { env.error = value; }, changeDataset = value => { env.dataset = value; };
  const bindings = { ...importNames, ...navigation, ...interaction, ...entryIntent, ...detailBoundary, ...scrolling, ...inventoryModel, ...state, markPhoneMilestone,phoneAdmission,
    memo: component => component,
    ...iosPresentation,Capacitor:{getPlatform:()=> 'web'},registerPlugin: () => ({ backgroundApp: async () => {} }), native: false, MOBILE_BUILD: 'controlled-test',
    businessStorage: () => env.storage || storage, accountHasDeviceWork: () => false, discoverMobileRecovery: (...args) => env.discoverRecovery ? env.discoverRecovery(...args) : env.pendingRecovery || null,
    discoverMobileDrafts:(...args)=>env.discoverRecovery?realDiscoverMobileDrafts(...args):[],
    clearEmptyDeviceWork: async (_storage, accountId) => { if (env.clearEmpty) return env.clearEmpty(_storage,accountId); if (!env.deferRecovery) return; let resolve; const promise = new Promise(done => { resolve = done; }); clearCalls.push({ accountId, resolve }); await promise; },
    useInventoryData() { if(realInventory)return actualInventory.useInventoryData(currentUser());const snapshot = data(); return { data: snapshot, user: snapshot.user, dataset: env.dataset, loading: env.loading, error: env.error, revision: 1, load, refresh, changeDataset, acceptReviewedInventory() {}, setError: setReadError }; },
    useInventoryPolling(options) { env.polling=options;if(realInventory)actualInventory.useInventoryPolling(options); }, usePhoneViewport: () => ({ keyboardOpen: env.keyboardOpen, systemReduced: env.systemReduced }),
    useMessageCount: () => ({ unreadCount: 2, acceptUnreadCount() {} }), usePhoneArrivals: () => ({ arrivals: null, acknowledge() {}, pending: false, error: '' }),
    defaultInventoryFilter: () => ({ lifecycle: 'active' }),
  };
  const names = Object.keys(bindings), Component = new Function(...names, '_jsx', '_jsxs', '_Fragment', `${code}\nreturn MobileShell;`)(...names.map(name => bindings[name]), jsx, jsx, 'Fragment');
  let tree;
  function render() {
    for (let attempt = 0; attempt < 10; attempt++) {
      state.reset(); tree = Component({ initialUser: data().user, origin: 'controlled-local-service', storageError: env.storageError, saving: env.saving, onSignedOut() {}, onFieldTest() {}, onExportRecovery() {} });
      const owner = nodes(tree).find(node => node.type === 'main'); owner.props.ref.current = main;
      if (!state.commit()) return tree;
    }
    assert.fail('Controlled shell did not settle.');
  }
  t.after(() => { state.unmount(); for (const [key, descriptor] of Object.entries(descriptors)) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } });
  const view = { env, main, document, window, render, readRequests,snapshot:data,unmount: state.unmount, lateUpdates: state.lateUpdates,
    active(type) { return nodes(render()).find(node => node.type === type && node.props.active !== false); },
    provider() { return nodes(render()).find(node => node.type === 'PhoneUIProvider'); },
    beginRead() { env.loading=true; const read=env.polling.load(env.dataset); read.catch(()=>{}); return read; },
    route() { return nodes(render()).find(node => node.props.className === 'phone-route' && !node.props.hidden)?.props['data-route']; },
    notice() { return text(nodes(render()).find(node => node.props.className === 'phone-notice')?.props.children[0]); },
    nav(label) { const nav = nodes(render()).find(node => node.type === 'nav'); const button = nodes(nav).find(node => node.type === 'Pressable' && text(node).trim() === label); assert.ok(button); assert.equal(button.props.disabled, false); button.props.onClick(); return render(); },
    scroll(position) { main.scrollTop = position; nodes(render()).find(node => node.type === 'main').props.onScroll({ currentTarget: main }); },
    back() { const event = new BackEvent(); window.dispatchEvent(event); render(); return event; },
    addOverlay(node) { env.overlays.push(node); observers.forEach(callback => callback()); render(); },
  };
  render(); return view;
}

function retainedNativeIntake(accountId) {
  const at='2026-10-13T02:00:00.000Z',common=intakeCommonSchema.parse({name:'Battery',model:'',chemistry:'',capacityMah:null,voltage:null,ownerId:'owner-a',homeBuildingId:'J18',homeRoomId:null,manufacturedOn:null,firstUsedOn:null});
  const entries=['0004AB00','0004AB01'].map(uidHex=>({id:crypto.randomUUID(),sessionId:crypto.randomUUID(),tagId:'nfc:uid:'+uidHex,scannedAt:at,common,firstUseMode:'unknown',selected:true,error:'',source:'native_nfc',nfcEvidence:{attemptId:crypto.randomUUID(),source:'native-nfc-reader',platform:'android',startedAt:at,endedAt:at,adoptedAt:at,tagId:'nfc:uid:'+uidHex,result:{uidHex,technology:'Controlled NFC-A output',ndefStatus:'readWrite',capacityBytes:144,records:[],observedAt:at}}}));
  return captureIntakeDraft({actorAccountId:accountId,dataset:'demo',batch:null,entries,attempt:null,attemptEntryId:null,completed:[]});
}

test('all five explicit Scan entries retain two native Intake drafts and open the selected workflow',async t=>{
  for(const [kind,component] of [['lookup','LookupWorkflow'],['checkout','ScanWorkflow'],['return','ScanWorkflow'],['intake','MobileIntake'],['removal','MobileRemoval']])await t.test(kind,async child=>{
    const view=mount(child),key=intakeStorageKey('staff-a','demo'),draft=retainedNativeIntake('staff-a'),original=JSON.stringify(draft),writes=[];
    const storage=createDurableStorage({load:async()=>JSON.stringify({schemaVersion:1,entries:{[key]:original,'preference:private':'Preserved bytes'}}),save:async raw=>writes.push(raw)});await storage.initialize();
    view.env.storage=storage;view.env.discoverRecovery=realDiscoverMobileRecovery;view.env.clearEmpty=realClearEmptyDeviceWork;
    const home=view.active('ScanHome');await (kind==='lookup'?home.props.onLookup():home.props.onOperation(kind));view.render();
    assert.ok(view.active(component));if(component==='ScanWorkflow')assert.equal(view.active(component).props.kind,kind);
    assert.equal(view.notice(),'');assert.equal(storage.getItem(key),original);assert.equal(storage.getItem('preference:private'),'Preserved bytes');assert.equal(writes.length,0);assert.equal(view.env.requests.length,0);
    if(kind==='intake'){
      const controller=createIntakeController({storage,data:view.snapshot(),accountId:'staff-a',write:()=>assert.fail('Restoring the queue cannot submit')});
      assert.deepEqual(controller.getSnapshot().draft,draft);assert.equal(controller.getSnapshot().draft.entries.length,2);assert.equal(controller.getSnapshot().draft.attempt,null);
    }
  });
});

test('ready Scan entries show cancellable preparation and never open after cancellation',async t=>{
  for(const kind of ['lookup','checkout','return','intake','removal'])await t.test(kind,async child=>{
    const view=mount(child,{deferRecovery:true}),home=view.active('ScanHome'),opening=kind==='lookup'?home.props.onLookup():home.props.onOperation(kind);
    const pending=view.active('ScanHome').props.entryPending;assert.equal(pending.kind,kind);assert.equal(pending.phase,'opening');assert.equal(view.env.clearCalls.length,1);
    await home.props.onOperation('intake');assert.equal(view.env.clearCalls.length,1,'A second click cannot start another preparation');
    view.active('ScanHome').props.onCancelOpening();view.render();view.env.clearCalls[0].resolve();await opening;view.render();
    assert.equal(view.active('ScanHome').props.entryPending,null);for(const component of ['LookupWorkflow','ScanWorkflow','MobileIntake','MobileRemoval'])assert.equal(view.active(component),undefined);
  });
});

test('an explicit entry still restores an exact pending movement ahead of ordinary Intake drafts',async t=>{
  const view=mount(t),intakeKey=intakeStorageKey('staff-a','demo'),requestKey=movementStorageKey('staff-a','demo','checkout');
  const originalIntake=JSON.stringify(retainedNativeIntake('staff-a')),request=JSON.stringify(captureMovementAttempt('checkout',view.snapshot().batteries.map(battery=>({...battery,borrowerName:null,checkedOutAt:null})),'staff-a','demo',crypto.randomUUID()));
  view.env.entries.set(intakeKey,originalIntake);view.env.entries.set(requestKey,request);view.env.discoverRecovery=realDiscoverMobileRecovery;
  await view.active('ScanHome').props.onLookup();view.render();assert.equal(view.active('LookupWorkflow'),undefined);assert.equal(view.active('MovementDialog').props.draft.kind,'checkout');
  assert.match(view.notice(),/^Unfinished device work restored/);assert.equal(view.env.entries.get(intakeKey),originalIntake);assert.equal(view.env.entries.get(requestKey),request);assert.equal(view.env.requests.length,0);
});

test('ordinary startup Intake stays on Home with an explicit saved-work entry and unchanged bytes',async t=>{
  const key=intakeStorageKey('staff-a','demo'),raw=JSON.stringify(retainedNativeIntake('staff-a')),view=mount(t,{realRecovery:true,seed:{[key]:raw}});
  assert.ok(view.active('ScanHome'));assert.equal(view.active('MobileIntake'),undefined);assert.equal(view.active('LookupWorkflow'),undefined);
  const cue=nodes(view.render()).find(node=>node.props['aria-label']==='Saved device work');assert.ok(cue);const choice=nodes(cue).find(node=>node.type==='Pressable'&&text(node)==='Continue Intake');assert.ok(choice);
  choice.props.onClick();view.render();await settle();view.render();assert.ok(view.active('MobileIntake'));assert.equal(view.env.entries.get(key),raw);assert.equal(view.env.requests.length,0);
});

test('a prepared empty Intake batch survives restart, explicit Continue and another feature entry',async t=>{
  for(const action of ['continue','lookup'])await t.test(action,async child=>{
    const draft=retainedNativeIntake('staff-a');draft.batch={sessionId:crypto.randomUUID(),common:draft.entries[0].common,firstUseMode:'unknown',source:'native_nfc'};draft.entries=[];
    const key=intakeStorageKey('staff-a','demo'),raw=JSON.stringify(captureIntakeDraft(draft)),view=mount(child,{realRecovery:true,seed:{[key]:raw}});view.env.clearEmpty=realClearEmptyDeviceWork;
    assert.equal(view.active('MobileIntake'),undefined);assert.ok(nodes(view.render()).some(node=>node.type==='Pressable'&&text(node)==='Continue Intake'));
    if(action==='continue'){nodes(view.render()).find(node=>node.type==='Pressable'&&text(node)==='Continue Intake').props.onClick();await settle();view.render();assert.ok(view.active('MobileIntake'));}
    else{await view.active('ScanHome').props.onLookup();view.render();assert.ok(view.active('LookupWorkflow'));}
    assert.equal(view.env.entries.get(key),raw);assert.equal(view.env.requests.length,0);
  });
});

test('form-only preparation is visible on startup and corrupt preparation remains protected',async t=>{
  const scope={accountId:'staff-a',dataset:'demo',kind:'intake-common',recordId:'common'},key=phoneFormDraftKey(scope),common=retainedNativeIntake('staff-a').entries[0].common;
  const form=JSON.stringify({...scope,schemaVersion:1,savedAt:new Date().toISOString(),data:{values:Object.fromEntries(Object.entries(common).map(([name,value])=>[name,value===null?'':String(value)])),firstUseMode:'unknown',modelSelection:null,nameSource:'default'}});
  await t.test('valid',child=>{const view=mount(child,{realRecovery:true,seed:{[key]:form}});assert.ok(view.active('ScanHome'));assert.equal(view.active('MobileIntake'),undefined);assert.ok(nodes(view.render()).some(node=>node.type==='Pressable'&&text(node)==='Continue Intake preparation'));assert.equal(view.env.entries.get(key),form);});
  await t.test('corrupt',async child=>{const corrupt=mount(child,{realRecovery:true,seed:{[key]:'Unmodified corrupt preparation'}});await corrupt.active('ScanHome').props.onOperation('checkout');corrupt.render();assert.equal(corrupt.active('ScanWorkflow'),undefined);assert.equal(corrupt.active('ScanHome').props.entryPending,null);assert.match(text(nodes(corrupt.render()).find(node=>node.props.className==='phone-recovery')),/form draft is unreadable/);assert.equal(corrupt.env.entries.get(key),'Unmodified corrupt preparation');});
});

test('startup exact pending requests retain mandatory recovery ahead of ordinary Intake',t=>{
  const battery={id:'BAT-00000042',name:'Battery',ownerName:'Staff',version:3,loanId:null,borrowerName:null,checkedOutAt:null},request=JSON.stringify(captureMovementAttempt('checkout',[battery],'staff-a','demo',crypto.randomUUID())),key=movementStorageKey('staff-a','demo','checkout'),draft=JSON.stringify(retainedNativeIntake('staff-a'));
  const view=mount(t,{realRecovery:true,seed:{[key]:request,[intakeStorageKey('staff-a','demo')]:draft}});assert.ok(view.active('MovementDialog'));assert.equal(view.active('MobileIntake'),undefined);assert.match(view.notice(),/^Unfinished device work restored/);assert.equal(view.env.entries.get(key),request);assert.equal(view.env.entries.get(intakeStorageKey('staff-a','demo')),draft);
});

test('routine persistence accepts a single entry and preserves it through later saves until resources release',async t=>{
  const view=mount(t);view.env.saving=true;view.render();await view.active('ScanHome').props.onOperation('checkout');view.render();
  assert.equal(view.active('ScanHome').props.entryPending.phase,'waiting');await view.active('ScanHome').props.onOperation('return');assert.equal(view.active('ScanHome').props.entryPending.kind,'checkout');
  view.env.saving=false;view.render();await settle();view.render();const opened=view.active('ScanWorkflow');assert.equal(opened.props.kind,'checkout');
  await view.active('ScanHome')?.props.onOperation?.('return');view.render();assert.equal(view.active('ScanWorkflow').props.nonce,opened.props.nonce);
});

test('a captured read wait survives unrelated saving and opens only after both resources settle',async t=>{
  const view=mount(t);view.beginRead();view.render();await view.active('ScanHome').props.onOperation('checkout');view.env.saving=true;view.render();assert.equal(view.active('ScanHome').props.entryPending.phase,'waiting');
  view.env.loading=false;view.render();assert.equal(view.active('ScanWorkflow'),undefined);assert.equal(view.active('ScanHome').props.entryPending.kind,'checkout');
  view.env.saving=false;view.render();await settle();view.render();assert.equal(view.active('ScanWorkflow').props.kind,'checkout');
});

test('a next operation waits for the genuinely released closing boundary',async t=>{
  const view=mount(t);await view.active('ScanHome').props.onOperation('checkout');view.render();
  const boundary=value=>{const event=new Event('battery-mobile-workflow-active');Object.defineProperty(event,'detail',{value});view.window.dispatchEvent(event);view.render();};
  boundary(true);view.active('ScanWorkflow').props.onExit();view.render();await view.active('ScanHome').props.onOperation('return');view.render();assert.equal(view.active('ScanHome').props.entryPending.kind,'return');assert.equal(view.active('ScanWorkflow'),undefined);
  await settle();view.render();assert.equal(view.active('ScanWorkflow'),undefined);boundary(false);await settle();view.render();assert.equal(view.active('ScanWorkflow').props.kind,'return');
});

test('area, page and personal intents wait for saves and do not require a fresh inventory GET',async t=>{
  for(const kind of ['area','page','personal'])await t.test(kind,async child=>{
    const view=mount(child);if(kind!=='area')view.nav('Me');const route=view.route(),me=view.active('MeScreen');view.env.saving=true;view.render();
    if(kind==='area')view.nav('Workspace');else if(kind==='page')me.props.onOpen('account');else me.props.onPersonal('holder');view.render();
    assert.equal(view.route(),route);if(kind==='area')assert.match(view.active('ScanHome').props.entryPending.waitReason,/Finishing the device save/);else assert.ok(nodes(view.render()).some(node=>text(node).includes('Finishing the device save')));
    view.env.error='Retained inventory read error';view.env.loading=true;view.env.saving=false;view.render();await settle();view.render();
    if(kind==='area')assert.ok(view.active('WorkspaceScreen'));else if(kind==='page')assert.equal(view.active('WorkspacePage').props.view,'account');else assert.equal(view.active('InventoryScreen').props.scope.kind,'holder');
    const opened=view.route();await settle();view.render();assert.equal(view.route(),opened);assert.equal(view.env.requests.length,0);
  });
});

test('view intent cancellation and namespace/background changes never navigate after late save completion',async t=>{
  for(const change of ['cancel','back','actor','dataset','hidden'])await t.test(change,async child=>{
    const view=mount(child);view.nav('Me');view.env.saving=true;view.render();view.active('MeScreen').props.onOpen('account');view.render();
    if(change==='cancel')nodes(view.render()).find(node=>node.type==='Pressable'&&node.props['aria-label']==='Cancel opening').props.onClick();
    if(change==='back')view.back();if(change==='actor')view.env.actor='staff-b';if(change==='dataset')view.env.dataset='live';if(change==='hidden'){view.document.visibilityState='hidden';view.document.dispatchEvent(new Event('visibilitychange'));view.document.visibilityState='visible';}
    view.render();const route=view.route();view.env.saving=false;view.render();await settle();view.render();assert.equal(view.route(),route);assert.equal(view.active('WorkspacePage'),undefined);
  });
});

test('actual Me personal detail Back restores the personal scope and then its original Me position', t => {
  const view = mount(t); view.nav('Me'); view.scroll(226);
  const meKey = view.route(); view.active('MeScreen').props.onPersonal('holder'); view.render();
  const inventory = view.active('InventoryScreen'); assert.deepEqual(inventory.props.scope, { kind: 'holder', id: 'staff-a', label: 'Checked out to me' });
  view.scroll(438); const scopeKey = view.route(); inventory.props.onDetail('BAT-00000042', inventory.props.scope); view.render();
  const detail = view.active('BatteryPage'); assert.equal(detail.props.battery.id, 'BAT-00000042'); view.scroll(91);
  detail.props.onBack(); view.render(); assert.equal(view.route(), scopeKey); assert.equal(view.main.scrollTop, 438); assert.equal(view.active('InventoryScreen').props.scope.kind, 'holder');
  assert.equal(view.back().defaultPrevented, true); assert.equal(view.route(), meKey); assert.ok(view.active('MeScreen')); assert.equal(view.main.scrollTop, 226); assert.equal(view.env.requests.length, 0);
});

test('actual area changes retain their child routes and main positions while selected-area taps do nothing', t => {
  const view = mount(t); view.nav('Workspace'); view.active('WorkspaceScreen').props.onOpen('task-plans', { taskId: 'cycle-a' }); view.render(); view.scroll(729);
  const workspaceKey = view.route(); assert.equal(view.active('WorkspacePage').props.initialTaskId, 'cycle-a');
  view.nav('Me'); view.active('MeScreen').props.onOpen('messages', { messageId: 'message-a' }); view.render(); view.scroll(183); const meKey = view.route();
  view.nav('Workspace'); assert.equal(view.route(), workspaceKey); assert.equal(view.main.scrollTop, 729); assert.equal(view.active('WorkspacePage').props.view, 'task-plans');
  view.scroll(735); view.nav('Workspace'); assert.equal(view.route(), workspaceKey); assert.equal(view.main.scrollTop, 735);
  view.nav('Me'); assert.equal(view.route(), meKey); assert.equal(view.main.scrollTop, 183); assert.equal(view.active('WorkspacePage').props.initialMessageId, 'message-a');
});

test('a preparing entry ignores repeated clicks and an explicitly cancelled entry cannot overwrite its replacement', async t => {
  const view = mount(t, { deferRecovery: true }), scan = view.active('ScanHome');
  const older = scan.props.onOperation('checkout', ['BAT-00000042']);view.env.loanId='reviewed-loan';view.render();
  await scan.props.onOperation('return', ['BAT-00000042']);assert.equal(view.env.clearCalls.length,1);assert.equal(view.active('ScanHome').props.entryPending.kind,'checkout');
  view.active('ScanHome').props.onCancelOpening();view.render();
  const newer = scan.props.onOperation('return', ['BAT-00000042']);
  assert.equal(view.env.clearCalls.length, 2);
  view.env.clearCalls[1].resolve(); await newer; view.render(); const current = view.active('ScanWorkflow'); assert.equal(current.props.kind, 'return');
  view.env.clearCalls[0].resolve(); await older; view.render(); assert.equal(view.active('ScanWorkflow').props.nonce, current.props.nonce); assert.equal(view.active('ScanWorkflow').props.kind, 'return'); assert.equal(view.env.requests.length, 0);
});

test('actual navigation or dataset changes invalidate an entry awaiting recovery persistence', async t => {
  const view = mount(t, { deferRecovery: true });
  const first = view.active('ScanHome').props.onOperation('checkout', ['BAT-00000042']); view.nav('Workspace'); const workspaceKey = view.route();
  view.env.clearCalls[0].resolve(); await first; view.render(); assert.equal(view.route(), workspaceKey); assert.equal(view.active('ScanWorkflow'), undefined);
  view.nav('Scan'); const second = view.active('ScanHome').props.onOperation('checkout', ['BAT-00000042']);
  const selector = nodes(view.render()).find(node => node.type === 'PhoneChoice' && node.props['aria-label'] === 'Shared inventory'); selector.props.onChange('live');
  assert.equal(view.env.clearCalls.length, 3); view.env.clearCalls[2].resolve(); await settle(); view.render(); assert.equal(view.provider().props.namespace, 'staff-a:live');
  view.env.clearCalls[1].resolve(); await second; view.render(); assert.equal(view.active('ScanWorkflow'), undefined); assert.equal(view.provider().props.namespace, 'staff-a:live');
});

test('an ordinary-root operation callback retained from an old namespace cannot open work in its replacement', async t => {
  const view = mount(t), previousOperation = view.active('ScanHome').props.onOperation;
  const selector = nodes(view.render()).find(node => node.type === 'PhoneChoice' && node.props['aria-label'] === 'Shared inventory');
  selector.props.onChange('live'); await settle(); view.render();
  assert.equal(view.provider().props.namespace, 'staff-a:live');
  const currentOperation = view.active('ScanHome').props.onOperation;
  assert.notEqual(currentOperation, previousOperation);
  await previousOperation('checkout', ['BAT-00000042']); view.render();
  assert.equal(view.active('ScanWorkflow'), undefined);
  await currentOperation('checkout', ['BAT-00000042']); view.render();
  assert.equal(view.active('ScanWorkflow').props.dataset, 'live');
  assert.deepEqual(view.active('ScanWorkflow').props.initialIds, ['BAT-00000042']);
  assert.equal(view.env.requests.length, 0);
});

test('a stale entry callback cannot stage after the actual shell unmount cleanup', async t => {
  const view = mount(t, { deferRecovery: true }); const pending = view.active('ScanHome').props.onOperation('checkout', ['BAT-00000042']);
  view.unmount(); view.env.clearCalls[0].resolve(); await pending;
  assert.equal(view.lateUpdates(), 0); assert.equal(view.env.requests.length, 0);
});

test('native Back dismisses keyboard first and a protected HTML sheet prevents route release', t => {
  const view = mount(t); view.nav('Me'); view.active('MeScreen').props.onOpen('messages'); view.render(); const sourceKey = view.route();
  let blurs = 0; const input = { matches: () => true, blur() { blurs++; view.document.activeElement = view.document.body; } };
  view.env.keyboardOpen = true; view.document.activeElement = input; view.render();
  assert.equal(view.back().defaultPrevented, true); assert.equal(blurs, 1); assert.equal(view.route(), sourceKey);
  view.env.keyboardOpen = false; view.render();
  const dialog = Object.assign(new EventTarget(), { tagName: 'DIALOG', zIndex: '800', parentElement: null, closes: 0, classList: { contains: () => false }, getAttribute: () => 'open', hasAttribute: () => false, closest: () => null, getClientRects: () => [{}], close() { this.closes++; } });
  dialog.addEventListener('cancel', event => event.preventDefault()); view.addOverlay(dialog);
  assert.equal(view.back().defaultPrevented, true); assert.equal(dialog.closes, 0); assert.equal(view.route(), sourceKey);
});

test('native Back respects child priority and an inactive owner release cannot unlock another protected route', t => {
  const view = mount(t); view.nav('Workspace'); view.active('WorkspaceScreen').props.onOpen('task-plans'); view.render();
  const tasks = view.active('WorkspacePage'); view.nav('Me'); view.active('MeScreen').props.onOpen('messages'); view.render(); const sourceKey = view.route(), messages = view.active('WorkspacePage');
  let childCalls = 0; const unregister = view.provider().props.backRegistry.register(() => { childCalls++; return true; }, 100);
  assert.equal(view.back().defaultPrevented, true); assert.equal(childCalls, 1); assert.equal(view.route(), sourceKey); unregister();
  tasks.props.onLockedChange(true); view.render(); messages.props.onLockedChange(false); view.render();
  assert.equal(view.back().defaultPrevented, true); assert.equal(view.route(), sourceKey);
  const navigationButtons = nodes(view.render()).filter(node => node.type === 'Pressable' && ['Scan','Inventory','Workspace','Me'].includes(text(node).trim()));
  assert.equal(navigationButtons.length, 4); assert.ok(navigationButtons.every(node => node.props.disabled));
});

test('idle task reviews can open a read-only child and Back restores their retained route and scroll', t => {
  const view = mount(t); view.nav('Workspace'); view.active('WorkspaceScreen').props.onOpen('task-plans',{taskId:'cycle-a'}); view.render(); view.scroll(427);
  const sourceKey=view.route(), source=view.active('WorkspacePage');
  const lock=value=>{const event=new Event('battery-mobile-workflow-active');Object.defineProperty(event,'detail',{value});view.window.dispatchEvent(event);view.render();};
  lock(true); source.props.onDetail('BAT-00000042'); view.render();
  const detail=view.active('BatteryPage');assert.ok(detail);assert.equal(detail.props.readOnly,true);
  const retained=nodes(view.render()).find(node=>node.type==='WorkspacePage'&&node.props.initialTaskId==='cycle-a');assert.equal(retained.props.active,false);
  lock(false); detail.props.onBack(); view.render();assert.equal(view.route(),sourceKey);assert.equal(view.main.scrollTop,427);assert.equal(view.active('WorkspacePage').props.initialTaskId,'cycle-a');
  lock(true);view.env.pendingRecovery={type:'workspace',dataset:'demo'};view.active('WorkspacePage').props.onDetail('BAT-00000042');view.render();assert.equal(view.route(),sourceKey);assert.equal(view.active('BatteryPage'),undefined);
});

test('task child detail cannot bypass a protected panel lock or use a stale source callback', t => {
  const view=mount(t);view.nav('Workspace');view.active('WorkspaceScreen').props.onOpen('task-plans');view.render();const source=view.active('WorkspacePage'),sourceKey=view.route();
  source.props.onLockedChange(true);view.render();source.props.onDetail('BAT-00000042');view.render();assert.equal(view.route(),sourceKey);
  source.props.onLockedChange(false);view.render();view.nav('Me');const meKey=view.route();source.props.onDetail('BAT-00000042');view.render();assert.equal(view.route(),meKey);assert.equal(view.active('BatteryPage'),undefined);
});

test('idle Intake & removal offers Back and guarded area exits while retaining internal history',async t=>{
  const view=mount(t);view.nav('Workspace');view.scroll(233);const root=view.route();view.active('WorkspaceScreen').props.onOpen('assets');view.render();const landing=view.route();
  const selector=nodes(view.render()).find(node=>node.type==='PhoneChoice');assert.equal(selector.props.disabled,true);
  assert.ok(nodes(view.render()).filter(node=>node.type==='Pressable'&&['Scan','Inventory','Workspace','Me'].includes(text(node).trim())).every(node=>!node.props.disabled));
  assert.equal(nodes(view.render()).find(node=>node.type==='Pressable'&&node.props['aria-label']==='Back to previous view').props.disabled,false);
  nodes(view.render()).find(node=>node.type==='Pressable'&&text(node).startsWith('Removal history')).props.onClick();view.render();assert.notEqual(view.route(),landing);
  assert.equal(view.back().defaultPrevented,true);assert.equal(view.route(),landing);
  const intake=nodes(view.render()).find(node=>node.type==='Pressable'&&text(node).startsWith('New battery intake'));await intake.props.onClick();view.render();assert.ok(view.active('MobileIntake'));
  view.active('MobileIntake').props.onExit();view.render();view.env.frames.splice(0).forEach(fn=>fn());
  const exit=nodes(view.render()).find(node=>node.type==='Pressable'&&node.props['aria-label']==='Exit Intake & removal');assert.equal(exit.props.disabled,false);exit.props.onClick();view.render();assert.equal(view.route(),root);assert.equal(view.main.scrollTop,233);
});

test('browser Back and native Back release an idle lifecycle hub through the same exit guard',async t=>{
  for(const nativeBack of [false,true])await t.test(nativeBack?'native Back':'header Back',child=>{
    const view=mount(child);view.nav('Workspace');view.scroll(211);const root=view.route();view.active('WorkspaceScreen').props.onOpen('assets');view.render();
    view.env.entries.set('retained-intake-draft','Unsubmitted draft bytes');
    if(nativeBack)assert.equal(view.back().defaultPrevented,true);else nodes(view.render()).find(node=>node.type==='Pressable'&&node.props['aria-label']==='Back to previous view').props.onClick();
    view.render();assert.equal(view.route(),root);assert.equal(view.main.scrollTop,211);assert.ok(view.active('WorkspaceScreen'));assert.equal(view.env.entries.get('retained-intake-draft'),'Unsubmitted draft bytes');assert.equal(view.notice(),'');assert.equal(view.env.requests.length,0);
  });
});

test('idle lifecycle history exits to a requested retained area without losing its selection or position',t=>{
  const view=mount(t);view.nav('Inventory');view.scroll(384);const inventoryKey=view.route();view.nav('Workspace');view.active('WorkspaceScreen').props.onOpen('assets');view.render();nodes(view.render()).find(node=>node.type==='Pressable'&&text(node).startsWith('Removal history')).props.onClick();view.render();
  view.env.entries.set('retained-removal-draft','Unsubmitted removal bytes');view.nav('Inventory');assert.equal(view.route(),inventoryKey);assert.equal(view.main.scrollTop,384);assert.ok(view.active('InventoryScreen'));assert.equal(view.env.entries.get('retained-removal-draft'),'Unsubmitted removal bytes');view.nav('Workspace');assert.ok(view.active('WorkspaceScreen'));assert.equal(view.active('RemovalHistory'),undefined);assert.equal(view.notice(),'');
});

test('active task, request, storage and model/portal guards still block lifecycle Back and direct area handlers',async t=>{
  for(const protection of ['task','request','storage','model'])await t.test(protection,async child=>{
    const view=mount(child);view.nav('Workspace');view.active('WorkspaceScreen').props.onOpen('assets');view.render();const route=view.route();
    if(protection==='task'){await nodes(view.render()).find(node=>node.type==='Pressable'&&text(node).startsWith('New battery intake')).props.onClick();view.render();}
    if(protection==='request'){nodes(view.render()).find(node=>node.type==='Pressable'&&text(node).startsWith('Removal history')).props.onClick();view.render();view.active('RemovalHistory').props.onBusyChange(true);view.render();}
    if(protection==='storage')view.env.storageError='Durable request save failed';
    if(protection==='saving')view.env.saving=true;
    if(protection==='model')view.addOverlay({tagName:'SECTION',classList:{contains:()=>false},getAttribute:()=>null,closest:()=>null,getClientRects:()=>[{}],parentElement:null});
    view.render();const blockedRoute=view.route(),nav=nodes(view.render()).find(node=>node.type==='nav'),buttons=nodes(nav).filter(node=>node.type==='Pressable');assert.ok(buttons.every(node=>node.props.disabled));buttons.find(node=>text(node).trim()==='Inventory').props.onClick();view.render();assert.equal(view.route(),blockedRoute);if(protection!=='task'&&protection!=='model'){assert.equal(view.back().defaultPrevented,true);assert.equal(view.route(),blockedRoute);}assert.notEqual(view.notice(),'');assert.equal(view.env.requests.length,0);if(protection==='task')assert.equal(blockedRoute,route);
  });
});

test('destination motion cancels on interruption and reduced motion while refreshes retain route and scroll without replay',async t=>{
  const view=mount(t);view.nav('Inventory');view.scroll(395);const inventoryKey=view.route(),before=view.env.animations.at(-1);assert.equal(before.options.duration,190);assert.equal(before.keyframes[0].transform,'translateX(4px)');
  view.nav('Workspace');assert.equal(before.cancelled,true);const workspaceMotion=view.env.animations.at(-1);view.nav('Inventory');assert.equal(workspaceMotion.cancelled,true);assert.equal(view.route(),inventoryKey);assert.equal(view.main.scrollTop,395);
  const count=view.env.animations.length;view.env.loading=true;view.render();assert.equal(view.route(),inventoryKey);assert.equal(view.main.scrollTop,395);assert.equal(view.env.animations.length,count);assert.ok(view.active('InventoryScreen'));assert.equal(view.active('InitialContentSurface'),undefined);
  view.env.acceptRead();view.env.loading=false;view.env.error='No authoritative response was received.';view.render();assert.equal(view.env.animations.length,count);assert.equal(view.active('PhoneReadError').props.compact,true);assert.equal(view.route(),inventoryKey);assert.equal(view.main.scrollTop,395);
  view.env.systemReduced=true;view.render();assert.equal(view.env.animations.at(-1).cancelled,true);view.nav('Workspace');assert.equal(view.env.animations.length,count);
});

test('periodic or focus reads report in place, preserve content on overlap, and ignore completion after shell disposal',async t=>{
  const view=mount(t);view.nav('Workspace');view.active('WorkspaceScreen').props.onOpen('task-plans');view.render();view.scroll(401);const route=view.route(),motions=view.env.animations.length;
  const pending=[];view.env.load=()=>new Promise(resolve=>pending.push(resolve));const first=view.env.polling.load('demo');view.render();const second=view.env.polling.load('demo');view.render();
  const status=()=>nodes(view.render()).find(node=>node.props.className==='phone-sync-status');assert.equal(text(status()),'Refreshing records…');assert.equal(view.active('InitialContentSurface'),undefined);assert.equal(view.route(),route);assert.equal(view.main.scrollTop,401);
  pending[0]();await first;view.render();assert.equal(text(status()),'Refreshing records…');pending[1]();await second;view.render();assert.equal(text(status()),'');assert.equal(view.env.animations.length,motions);
  const late=view.env.polling.load('demo');view.unmount();pending[2]();await late;assert.equal(view.lateUpdates(),0);
});

test('header inventory choice excludes only its own visible portal and still revalidates the closed handoff',async t=>{
  const view=mount(t),choice=()=>nodes(view.render()).find(node=>node.type==='PhoneChoice'&&node.props.label==='Shared inventory');
  assert.equal(choice().props.variant,'compact');assert.equal(choice().props.disabled,false);
  const owner=nodes(view.render()).find(node=>node.type==='PhoneUIBoundary'&&node.props.workflowOwner?.startsWith('dataset-picker:')).props.workflowOwner;
  const marker={getAttribute:name=>name==='data-phone-workflow-owner'?owner:null};
  const own={tagName:'DIALOG',classList:{contains:()=>false},getAttribute:()=>null,closest:selector=>selector==='[data-phone-workflow-owner]'?marker:null,getClientRects:()=>[{}],parentElement:null};
  view.addOverlay(own);assert.equal(choice().props.disabled,false);assert.ok(nodes(nodes(view.render()).find(node=>node.type==='nav')).filter(node=>node.type==='Pressable').every(node=>node.props.disabled));
  choice().props.onChange('live');await settle();view.render();assert.equal(view.provider().props.namespace,'staff-a:demo','The choice cannot bypass the still-visible portal entry gate');
  view.env.overlays=[];view.env.observers.forEach(callback=>callback());view.render();choice().props.onChange('live');await settle();view.render();assert.equal(view.provider().props.namespace,'staff-a:live');
  const foreign={...own,closest:()=>null};view.addOverlay(foreign);assert.equal(choice().props.disabled,true);choice().props.onChange('demo');await settle();view.render();assert.equal(view.provider().props.namespace,'staff-a:live');assert.equal(view.env.requests.length,0);
});

test('missing-asset inspection recovery renders original recovery controls without a fake battery or full-record trap',t=>{
  const view=mount(t,{initialRecovery:{type:'inspection',dataset:'demo',batteryId:'BAT-00000042'},missingBattery:true});
  const restoredNotice=view.notice();assert.ok(restoredNotice);
  const panel=view.active('MissingInspectionRecovery');assert.ok(panel);assert.equal(panel.props.batteryId,'BAT-00000042');assert.equal(panel.props.data.batteries.length,0);assert.equal(typeof panel.props.onExportRecovery,'function');
  assert.equal(view.active('BatteryDetails'),undefined);assert.equal(view.active('BatteryPage'),undefined);
  assert.equal(nodes(view.render()).find(node=>node.type==='PhoneChoice').props.disabled,true);
  panel.props.onLockedChange(true);view.render();panel.props.onExit();view.render();assert.ok(view.active('MissingInspectionRecovery'));assert.equal(view.notice(),restoredNotice);
  panel.props.onLockedChange(false);view.render();view.active('MissingInspectionRecovery').props.onExit();view.render();assert.ok(view.active('InventoryScreen'));assert.equal(view.notice(),'');
});

test('restored scan and lifecycle workflows clear only their recovery notice when the child exits',async t=>{
  for (const recovery of [
    {type:'scan',kind:'return',component:'ScanWorkflow'},
    {type:'intake',component:'MobileIntake'},
    {type:'removal',component:'MobileRemoval'},
  ]) await t.test(recovery.type,child=>{
    const view=mount(child,{initialRecovery:{type:recovery.type,kind:recovery.kind,dataset:'demo'}});
    const workflow=view.active(recovery.component);assert.ok(workflow);assert.equal(view.notice(),'Unfinished device work restored. Nothing was submitted automatically.');
    workflow.props.onLockedChange(true);view.render();workflow.props.onLockedChange(false);view.render();
    view.env.pendingRecovery=null;view.env.error='Inventory refresh failed after recovery.';view.render();
    workflow.props.onExit();view.render();
    assert.equal(view.active(recovery.component),undefined);assert.ok(view.active('ScanHome'));assert.equal(view.notice(),'');
    assert.equal(view.active('PhoneReadError').props.error,'Inventory refresh failed after recovery.');assert.equal(view.env.requests.length,0);
  });
});

test('completed lifecycle exit clears only its owned guard notice and retains recovery/read evidence',async t=>{
  for (const guarded of [false,true]) await t.test(guarded?'protected then resolved':'resolved',child=>{
    const view=mount(child,{initialRecovery:{type:'retired',dataset:'demo'}}), history=view.active('RemovalHistory');assert.ok(history);
    const restoredNotice=view.notice();assert.ok(restoredNotice);
    const exit=()=>nodes(view.render()).find(node=>node.type==='Pressable'&&node.props['aria-label']==='Exit Intake & removal');
    let independentNotice='';
    if(guarded){history.props.onBusyChange(true);view.render();assert.equal(exit().props.disabled,true);exit().props.onClick();view.render();assert.ok(view.active('RemovalHistory'));independentNotice=view.notice();assert.ok(independentNotice);assert.notEqual(independentNotice,restoredNotice);history.props.onBusyChange(false);view.render();}
    view.env.pendingRecovery=null;view.env.error='Removal history refresh failed.';view.render();assert.equal(exit().props.disabled,false);exit().props.onClick();view.render();
    assert.equal(view.active('RemovalHistory').props.paused,true);assert.ok(view.active('ScanHome'));assert.equal(exit(),undefined);assert.equal(view.notice(),guarded?'':restoredNotice);
    assert.equal(view.active('PhoneReadError').props.error,'Removal history refresh failed.');assert.equal(view.env.requests.length,0);
  });
});

test('refreshing records retain the first entry and open it exactly once after guards pass',async t=>{
  for(const kind of ['lookup','checkout','return','intake','removal'])await t.test(kind,async child=>{
    const view=mount(child);view.beginRead();view.render();const scan=view.active('ScanHome');
    await (kind==='lookup'?scan.props.onLookup():scan.props.onOperation(kind));view.render();
    assert.equal(view.active('ScanHome').props.entryPending.kind,kind);assert.equal(view.notice(),'');
    await scan.props.onOperation('intake');view.render();assert.equal(view.active('ScanHome').props.entryPending.kind,kind);
    view.env.acceptRead();view.env.loading=false;view.render();await settle();view.render();
    const workflow=nodes(view.render()).find(node=>['LookupWorkflow','ScanWorkflow','MobileIntake','MobileRemoval'].includes(node.type));
    assert.ok(workflow);if(kind==='checkout'||kind==='return')assert.equal(workflow.props.kind,kind);
    const nonce=workflow.key;await settle();view.render();assert.equal(nodes(view.render()).find(node=>node.type===workflow.type).key,nonce);assert.equal(view.env.requests.length,0);
  });
});

test('a failed entry stops waiting and retries only an inventory read, without automatic reopening',async t=>{
  const view=mount(t);view.beginRead();view.render();await view.active('ScanHome').props.onOperation('intake');
  view.env.acceptRead();view.env.loading=false;view.env.error='Controlled failed read';view.render();assert.equal(view.active('ScanHome').props.entryPending.phase,'failed');assert.ok(view.active('PhoneReadError'));
  view.env.error='';view.render();await settle();view.render();assert.equal(view.active('MobileIntake'),undefined,'An unrelated successful refresh must not replay a failed entry');
  let finish,reads=0;view.env.load=()=>{reads++;view.env.loading=true;return new Promise(resolve=>{finish=resolve;});};
  const retry=view.active('ScanHome').props.onRetryOpening();view.render();assert.equal(view.active('ScanHome').props.entryPending.phase,'waiting');assert.equal(reads,1);
  await view.active('ScanHome').props.onRetryOpening();assert.equal(reads,1);assert.equal(view.active('MobileIntake'),undefined);
  view.env.acceptRead();view.env.loading=false;finish();await retry;view.render();await settle();view.render();assert.ok(view.active('MobileIntake'));assert.equal(view.env.requests.length,0);
});

test('a retry failure settles to Retry and Cancel instead of spinning indefinitely',async t=>{
  const view=mount(t);view.env.error='First failure';view.render();await view.active('ScanHome').props.onLookup();
  view.env.load=async()=>{view.env.error='Still unavailable';};await view.active('ScanHome').props.onRetryOpening();view.render();
  assert.equal(view.active('ScanHome').props.entryPending.phase,'failed');assert.equal(view.active('LookupWorkflow'),undefined);view.active('ScanHome').props.onCancelOpening();view.render();assert.equal(view.active('ScanHome').props.entryPending,null);
});

test('actual inventory refresh superseded by a failed poll cannot open from the retained snapshot',async t=>{
  const view=mount(t,{realInventory:true});await settle();view.readRequests[0].resolve(view.snapshot());await settle();view.render();const loaded=view.active('ScanHome').props.data;
  const refresh=nodes(view.render()).find(node=>node.type==='Pressable'&&node.props['aria-label']==='Refresh inventory').props.onClick();view.render();await view.active('ScanHome').props.onOperation('intake');view.render();
  view.window.dispatchEvent(new Event('focus'));assert.equal(view.readRequests.length,3);view.render();
  view.readRequests[1].resolve({error:'First refresh unavailable'},503);await refresh;view.render();assert.equal(view.active('ScanHome').props.entryPending.phase,'waiting');assert.equal(view.active('MobileIntake'),undefined,'The superseding poll remains in flight');
  view.readRequests[2].resolve({error:'Poll unavailable'},503);await settle();view.render();assert.equal(view.active('ScanHome').props.entryPending.phase,'failed');assert.equal(view.active('MobileIntake'),undefined);assert.equal(view.active('ScanHome').props.data,loaded);assert.match(view.active('PhoneReadError').props.error,/Poll unavailable/);
  const retry=view.active('ScanHome').props.onRetryOpening();view.render();view.readRequests[3].resolve(view.snapshot());await retry;view.render();await settle();view.render();
  const intake=view.active('MobileIntake');assert.ok(intake);assert.equal(intake.props.data,loaded,'An identical successful snapshot remains valid even when setData retains its prior object');const key=intake.key;await settle();view.render();assert.equal(view.active('MobileIntake').key,key);assert.ok(view.env.requests.every(([,options])=>!options?.method || options.method==='POST'&&JSON.parse(options.body).action==='initialize_demo'),'No task submission is made');
});

test('actual initial inventory failure retries into a busy surface until the tracked read settles',async t=>{
  const input=await readFile(new URL('../src/app/startup-surface.jsx',import.meta.url),'utf8'),ast=ts.createSourceFile('startup-surface.jsx',input,ts.ScriptTarget.Latest,true,ts.ScriptKind.JSX);
  const initial=ast.statements.find(statement=>ts.isFunctionDeclaration(statement)&&statement.name?.text==='InitialContentSurface');assert.ok(initial);
  const code=ts.transpileModule(initial.getFullText(ast),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText.replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'');
  const Surface=new Function('_jsx','_jsxs','_Fragment','PhoneReadError',code+'\nreturn InitialContentSurface;')(jsx,jsx,'Fragment','PhoneReadError');
  const view=mount(t,{realInventory:true});await settle();view.readRequests[0].resolve({error:'Initial inventory unavailable'},503);await settle();view.render();
  const failed=view.active('InitialContentSurface');assert.equal(failed.props.loading,false);assert.match(failed.props.error,/Initial inventory unavailable/);assert.ok(nodes(Surface(failed.props)).some(node=>node.type==='PhoneReadError'));
  const retry=failed.props.onRetry();view.render();const loading=view.active('InitialContentSurface'),busy=Surface(loading.props);assert.equal(loading.props.loading,true);assert.equal(busy.props['aria-busy'],true);assert.equal(busy.props['data-phone-initial-state'],'loading');assert.equal(nodes(busy).some(node=>node.type==='PhoneReadError'),false,'The failed read Retry is absent while its new read is in flight');
  await settle();assert.equal(view.readRequests.length,2);view.readRequests[1].resolve(view.snapshot());await retry;view.render();assert.equal(view.active('InitialContentSurface'),undefined);assert.ok(view.active('ScanHome'));assert.equal(view.active('ScanHome').props.entryPending,null);
  assert.ok(view.env.requests.every(([,options])=>!options?.method || JSON.parse(options.body).action==='initialize_demo'));
});

test('actual superseding latest read must complete successfully; abort or ignored failure with no error is insufficient',async t=>{
  for(const outcome of ['abort','failure','success'])await t.test(outcome,async child=>{
    const view=mount(child,{realInventory:true});await settle();view.readRequests[0].resolve(view.snapshot());await settle();view.render();
    const refresh=nodes(view.render()).find(node=>node.type==='Pressable'&&node.props['aria-label']==='Refresh inventory').props.onClick();view.render();await view.active('ScanHome').props.onLookup();view.render();
    const abort=new AbortController(),latest=view.env.polling.load('demo',abort.signal).catch(()=>{});view.render();view.readRequests[1].resolve({error:'Superseded first read'},503);await refresh;view.render();assert.equal(view.active('LookupWorkflow'),undefined);
    if(outcome==='abort')abort.abort();else view.readRequests[2].resolve(outcome==='success'?view.snapshot():{error:'Latest raw failure'},outcome==='success'?200:503);
    await latest;view.render();await settle();view.render();
    if(outcome==='success'){assert.ok(view.active('LookupWorkflow'));const key=view.active('LookupWorkflow').key;await settle();view.render();assert.equal(view.active('LookupWorkflow').key,key);}
    else{assert.equal(view.active('LookupWorkflow'),undefined);assert.equal(view.active('ScanHome').props.entryPending.phase,'failed');assert.equal(view.active('PhoneReadError'),undefined,'The shared hook ignored the abort or the raw caller owns its exception; neither implies success');}
  });
});

test('an intermediate accepted read never authorizes entry after a newer failed or aborted read',async t=>{
  for(const outcome of ['failure','abort','success'])for(const oldStatus of [200,503])await t.test(`${outcome}; obsolete refresh ${oldStatus}`,async child=>{
    const view=mount(child,{realInventory:true});await settle();view.readRequests[0].resolve(view.snapshot());await settle();view.render();
    const refresh=nodes(view.render()).find(node=>node.type==='Pressable'&&node.props['aria-label']==='Refresh inventory').props.onClick();view.render();await view.active('ScanHome').props.onLookup();view.render();
    const intermediate=view.env.polling.load('demo');view.render();view.readRequests[2].resolve(view.snapshot());await intermediate;view.render();assert.equal(view.active('LookupWorkflow'),undefined,'The original refresh remains in flight');
    const abort=new AbortController(),latest=view.env.polling.load('demo',abort.signal).catch(()=>{});view.render();
    if(outcome==='abort')abort.abort();else view.readRequests[3].resolve(outcome==='success'?view.snapshot():{error:'Latest failed after accepted read'},outcome==='success'?200:503);
    await latest;view.render();assert.equal(view.active('LookupWorkflow'),undefined);
    view.readRequests[1].resolve(oldStatus===200?view.snapshot():{error:'Obsolete refresh failure'},oldStatus);await refresh;view.render();await settle();view.render();
    if(outcome==='success'){const result=view.active('LookupWorkflow');assert.ok(result);await settle();view.render();assert.equal(view.active('LookupWorkflow').key,result.key);}
    else{assert.equal(view.active('LookupWorkflow'),undefined);assert.equal(view.active('ScanHome').props.entryPending.phase,'failed');assert.equal(view.active('PhoneReadError'),undefined,'The raw latest caller owns its exception; error remains empty, but latest outcome still blocks entry');}
  });
});

test('an obsolete foreground read settling first cannot replace a pending newer read outcome',async t=>{
  for(const outcome of ['failure','success'])await t.test(outcome,async child=>{
    const view=mount(child,{realInventory:true});await settle();view.readRequests[0].resolve(view.snapshot());await settle();view.render();
    const refresh=nodes(view.render()).find(node=>node.type==='Pressable'&&node.props['aria-label']==='Refresh inventory').props.onClick();view.render();await view.active('ScanHome').props.onOperation('intake');view.render();
    const latest=view.env.polling.load('demo').catch(()=>{});view.render();view.readRequests[1].resolve(view.snapshot());await refresh;view.render();assert.equal(view.active('MobileIntake'),undefined);assert.equal(view.active('ScanHome').props.entryPending.phase,'waiting');
    view.readRequests[2].resolve(outcome==='success'?view.snapshot():{error:'Current read rejected'},outcome==='success'?200:503);await latest;view.render();await settle();view.render();
    if(outcome==='success')assert.ok(view.active('MobileIntake'));else{assert.equal(view.active('MobileIntake'),undefined);assert.equal(view.active('ScanHome').props.entryPending.phase,'failed');}
  });
});

test('entry proof is rechecked after local recovery cleanup before opening the workflow',async t=>{
  for(const outcome of ['failure','abort','success','still-reading'])await t.test(outcome,async child=>{
    const view=mount(child,{realInventory:true,deferRecovery:true});await settle();view.readRequests[0].resolve(view.snapshot());await settle();view.render();
    const refresh=nodes(view.render()).find(node=>node.type==='Pressable'&&node.props['aria-label']==='Refresh inventory').props.onClick();view.render();await view.active('ScanHome').props.onLookup();view.readRequests[1].resolve(view.snapshot());await refresh;view.render();assert.equal(view.env.clearCalls.length,1);assert.equal(view.active('ScanHome').props.entryPending.phase,'opening');
    const abort=new AbortController(),latest=view.env.polling.load('demo',abort.signal).catch(()=>{});view.render();
    if(outcome==='abort')abort.abort();else if(outcome!=='still-reading')view.readRequests[2].resolve(outcome==='success'?view.snapshot():{error:'Late latest read failed'},outcome==='success'?200:503);
    if(outcome!=='still-reading')await latest;view.render();view.env.clearCalls[0].resolve();await settle();view.render();
    if(outcome==='success')assert.ok(view.active('LookupWorkflow'));
    else if(outcome==='still-reading'){assert.equal(view.active('LookupWorkflow'),undefined);assert.equal(view.active('ScanHome').props.entryPending.phase,'waiting');view.readRequests[2].resolve({error:'Late read failed'},503);await latest;view.render();assert.equal(view.active('ScanHome').props.entryPending.phase,'failed');}
    else{assert.equal(view.active('LookupWorkflow'),undefined);assert.equal(view.active('ScanHome').props.entryPending.phase,'failed');}
    assert.equal(view.env.clearCalls.length,1,'Returning to the same pending intent never repeats its durable acknowledgement');
  });
});

test('mobile update and arrivals read paths also retain a pending entry until their latest read settles',async t=>{
  for(const source of ['updated','arrivals'])await t.test(source,async child=>{
    const view=mount(child,{realInventory:true});await settle();view.readRequests[0].resolve(view.snapshot());await settle();view.render();
    const refresh=nodes(view.render()).find(node=>node.type==='Pressable'&&node.props['aria-label']==='Refresh inventory').props.onClick();view.render();await view.active('ScanHome').props.onOperation('intake');view.render();
    let latest;if(source==='updated')view.window.dispatchEvent(new Event('battery-mobile-inventory-refresh'));else latest=nodes(view.render()).find(node=>node.type==='PhoneArrivalsProvider').props.load('demo').catch(()=>{});view.render();
    view.readRequests[1].resolve({error:'Superseded'},503);await refresh;view.render();assert.equal(view.active('ScanHome').props.entryPending.phase,'waiting');assert.equal(view.active('MobileIntake'),undefined);
    view.readRequests[2].resolve({error:'Latest mobile read failed'},503);if(latest)await latest;await settle();view.render();assert.equal(view.active('ScanHome').props.entryPending.phase,'failed');assert.equal(view.active('MobileIntake'),undefined);
  });
});

test('cancel, Back, navigation, account, dataset and foreground changes invalidate a waiting entry',async t=>{
  for(const change of ['cancel','Back','navigation','account','dataset','hidden','pagehide','unmount'])await t.test(change,async child=>{
    const view=mount(child);view.beginRead();view.render();await view.active('ScanHome').props.onOperation('intake');view.render();
    if(change==='cancel')view.active('ScanHome').props.onCancelOpening();
    else if(change==='Back')assert.equal(view.back().defaultPrevented,true);
    else if(change==='navigation')view.nav('Workspace');
    else if(change==='account')view.env.actor='staff-b';
    else if(change==='dataset')view.env.dataset='live';
    else if(change==='hidden'){view.document.visibilityState='hidden';view.document.dispatchEvent(new Event('visibilitychange'));}
    else if(change==='pagehide')view.window.dispatchEvent(new Event('pagehide'));
    else view.unmount();
    view.env.acceptRead();view.env.loading=false;if(change==='hidden')view.document.visibilityState='visible';if(change!=='unmount')view.render();await settle();
    if(change!=='unmount'){view.render();assert.equal(view.active('MobileIntake'),undefined);assert.equal(view.active('ScanHome')?.props.entryPending || null,null);}
    assert.equal(view.lateUpdates(),0);assert.equal(view.env.requests.length,0);
  });
});

test('cancel during recovery persistence cannot resume late work and only same-route Cancel restores focus',async t=>{
  const view=mount(t,{deferRecovery:true});let restored=0;const trigger={isConnected:true,matches:()=>false,closest:()=>null,getClientRects:()=>[{}],focus(){restored++;}};view.document.activeElement=trigger;
  view.beginRead();view.render();await view.active('ScanHome').props.onOperation('intake');view.env.acceptRead();view.env.loading=false;view.render();assert.equal(view.env.clearCalls.length,1);
  view.document.activeElement={};view.active('ScanHome').props.onCancelOpening();view.render();view.env.frames.splice(0).forEach(fn=>fn());assert.equal(restored,1);
  view.env.pendingRecovery={type:'scan',kind:'return',dataset:'demo'};view.env.clearCalls[0].resolve();await settle();view.render();assert.equal(view.active('ScanWorkflow'),undefined);assert.equal(view.active('MobileIntake'),undefined);assert.equal(view.notice(),'');
  view.env.pendingRecovery=null;view.beginRead();view.render();view.document.activeElement=trigger;await view.active('ScanHome').props.onOperation('intake');view.nav('Workspace');view.env.frames.splice(0).forEach(fn=>fn());assert.equal(restored,1);
});

test('hide and show invalidate a visible ready entry still awaiting local persistence',async t=>{
  for(const signal of ['visibilitychange','pagehide'])await t.test(signal,async child=>{
    const view=mount(child,{deferRecovery:true}),opening=view.active('ScanHome').props.onOperation('intake');assert.equal(view.env.clearCalls.length,1);assert.equal(view.active('ScanHome').props.entryPending.phase,'opening');
    view.document.visibilityState='hidden';if(signal==='visibilitychange')view.document.dispatchEvent(new Event(signal));else view.window.dispatchEvent(new Event(signal));view.document.visibilityState='visible';view.document.dispatchEvent(new Event('visibilitychange'));
    view.env.clearCalls[0].resolve();await opening;view.render();assert.equal(view.active('MobileIntake'),undefined);assert.equal(view.notice(),'');assert.equal(view.env.requests.length,0);
  });
});

test('waiting entry rechecks exact selection and saved group version against fresh records',async t=>{
  for(const change of ['loan','group-version','recovery'])await t.test(change,async child=>{
    const view=mount(child),groupId=crypto.randomUUID();view.env.groups=[{id:groupId,version:1,ownerAccountId:'staff-a',state:'active',batteryIds:['BAT-00000042']}];view.beginRead();view.render();
    const ids=['BAT-00000042'],context=change==='group-version'?{kind:'group',id:groupId,version:1}:null;
    await view.active('ScanHome').props.onOperation('checkout',ids,context);ids[0]='BAT-other';if(context)context.version=2;
    if(change==='loan')view.env.loanId='new-loan';if(change==='group-version')view.env.groups[0]={...view.env.groups[0],version:2};if(change==='recovery')view.env.pendingRecovery={type:'scan',kind:'return',dataset:'demo'};
    view.env.acceptRead();view.env.loading=false;view.render();await settle();view.render();
    if(change==='recovery'){assert.equal(view.active('ScanWorkflow').props.kind,'return');assert.match(view.notice(),/^Unfinished device work restored/);}
    else{assert.equal(view.active('ScanWorkflow'),undefined);assert.equal(view.active('TeachingCheckoutDialog'),undefined);assert.match(text(nodes(view.render()).find(node=>node.props.className==='phone-alert')),change==='loan'?/recorded loan state changed/:/reviewed group changed/);}
    assert.equal(view.env.requests.length,0);
  });
});

test('actual empty lifecycle acknowledgement keeps its entry through its own durable saving notification',async t=>{
  for(const kind of ['intake','removal'])await t.test(kind,async child=>{
    const view=mount(child),draft=kind==='intake'?captureIntakeDraft({actorAccountId:'staff-a',dataset:'demo',batch:null,entries:[],attempt:null,attemptEntryId:null,completed:[]}):captureRemovalDraft({actorAccountId:'staff-a',dataset:'demo',source:'manual_selection',kind:'scrapped',reason:'',destination:'',items:[],selectedIds:[]});
    const key=kind==='intake'?intakeStorageKey('staff-a','demo'):removalDraftStorageKey('staff-a','demo'),writes=[];let release;
    const storage=createDurableStorage({load:async()=>JSON.stringify({schemaVersion:1,entries:{[key]:JSON.stringify(draft),'preference:private':'Preserved bytes'}}),save:raw=>{writes.push(raw);return new Promise(resolve=>{release=resolve;});}});await storage.initialize();
    view.env.storage=storage;view.env.clearEmpty=realClearEmptyDeviceWork;const stop=storage.subscribe(state=>{view.env.saving=state.pending>0;view.env.storageError=state.error || '';view.render();});child.after(stop);
    view.beginRead();view.render();await view.active('ScanHome').props.onOperation(kind);view.env.acceptRead();view.env.loading=false;view.render();await settle();view.render();
    assert.equal(view.env.saving,true);assert.equal(view.active('ScanHome').props.entryPending.phase,'opening');assert.equal(writes.length,1);assert.equal(view.active('MobileIntake'),undefined);assert.equal(view.active('MobileRemoval'),undefined);
    release();await settle();view.render();await settle();view.render();assert.ok(view.active(kind==='intake'?'MobileIntake':'MobileRemoval'));assert.equal(storage.getItem(key),null);assert.equal(storage.getItem('preference:private'),'Preserved bytes');assert.equal(writes.length,1);assert.equal(view.env.requests.length,0);
  });
});

test('external protection and durable failure still block an entry performing its own cleanup',async t=>{
  for(const problem of ['protected','save-error'])await t.test(problem,async child=>{
    const view=mount(child,{deferRecovery:true});view.beginRead();view.render();await view.active('ScanHome').props.onOperation('intake');view.env.acceptRead();view.env.loading=false;view.render();view.env.saving=true;
    if(problem==='protected'){const event=new Event('battery-mobile-workflow-active');Object.defineProperty(event,'detail',{value:true});view.window.dispatchEvent(event);}else view.env.storageError='The original device write is unresolved';
    view.render();assert.equal(view.active('ScanHome').props.entryPending,null);view.env.saving=false;view.env.clearCalls[0].resolve();await settle();view.render();assert.equal(view.active('MobileIntake'),undefined);assert.equal(view.env.requests.length,0);
  });
});

test('actual failed empty-draft acknowledgement retains its original bytes and blocks entry',async t=>{
  const view=mount(t),key=intakeStorageKey('staff-a','demo'),draft=JSON.stringify(captureIntakeDraft({actorAccountId:'staff-a',dataset:'demo',batch:null,entries:[],attempt:null,attemptEntryId:null,completed:[]}));let deny;
  const storage=createDurableStorage({load:async()=>JSON.stringify({schemaVersion:1,entries:{[key]:draft}}),save:()=>new Promise((_resolve,reject)=>{deny=reject;})});await storage.initialize();view.env.storage=storage;view.env.clearEmpty=realClearEmptyDeviceWork;
  const stop=storage.subscribe(state=>{view.env.saving=state.pending>0;view.env.storageError=state.error || '';view.render();});t.after(stop);
  view.beginRead();view.render();await view.active('ScanHome').props.onOperation('intake');view.env.acceptRead();view.env.loading=false;view.render();await settle();deny(new Error('Controlled durable save denial'));await settle();view.render();
  assert.equal(view.active('MobileIntake'),undefined);assert.equal(view.active('ScanHome').props.entryPending,null);assert.match(view.env.storageError,/durable save denial/);assert.equal(JSON.parse(storage.exportRaw()).current.entries[key],draft);assert.equal(view.env.requests.length,0);
});

test('ready recovery preserves independent action errors, restored-work and protected-navigation notices',async t=>{
  const view=mount(t);view.nav('Me');view.active('MeScreen').props.onPersonal('invalid-boundary');view.render();const actionError=()=>text(nodes(view.render()).find(node=>node.props.className==='phone-alert')?.props.children[0]),originalError=actionError();assert.ok(originalError);
  view.nav('Scan');view.env.loading=true;view.render();await view.active('ScanHome').props.onOperation('checkout',['BAT-00000042']);view.render();assert.equal(view.active('ScanHome').props.entryPending.phase,'waiting');view.active('ScanHome').props.onCancelOpening();view.render();view.env.acceptRead();view.env.loading=false;view.render();assert.equal(view.notice(),'');assert.equal(actionError(),originalError);
  view.nav('Inventory');const source=view.active('InventoryScreen');view.env.pendingRecovery={type:'scan',kind:'return',dataset:'demo'};await source.props.onOperation('return',['BAT-00000042']);view.render();const restoredNotice=view.notice();assert.equal(restoredNotice,'Unfinished device work restored. Nothing was submitted automatically.');
  view.env.loading=true;view.render();view.env.acceptRead();view.env.loading=false;view.render();assert.equal(view.notice(),restoredNotice);assert.equal(actionError(),originalError);
  source.props.onDetail('BAT-00000042');view.render();const protectedNotice=view.notice();assert.equal(protectedNotice,'Finish or resolve protected work before opening another record.');view.env.loading=true;view.render();view.env.acceptRead();view.env.loading=false;view.render();assert.equal(view.notice(),protectedNotice);assert.equal(actionError(),originalError);assert.ok(view.active('ScanWorkflow'));assert.equal(view.env.requests.length,0);
});

test('closing restored work preserves an earlier action error and a newer protected-navigation notice',async t=>{
  const view=mount(t);view.nav('Me');view.active('MeScreen').props.onPersonal('invalid-boundary');view.render();
  const actionError=()=>text(nodes(view.render()).find(node=>node.props.className==='phone-alert')?.props.children[0]);
  const originalError=actionError();assert.ok(originalError);view.nav('Inventory');const source=view.active('InventoryScreen');
  view.env.pendingRecovery={type:'scan',kind:'return',dataset:'demo'};await source.props.onOperation('return',['BAT-00000042']);view.render();
  const workflow=view.active('ScanWorkflow');assert.ok(workflow);const restoredNotice=view.notice();assert.ok(restoredNotice);
  source.props.onDetail('BAT-00000042');view.render();const independentNotice=view.notice();assert.ok(independentNotice);assert.notEqual(independentNotice,restoredNotice);
  view.env.pendingRecovery=null;workflow.props.onExit();view.render();
  assert.equal(view.active('ScanWorkflow'),undefined);assert.ok(view.active('InventoryScreen'));assert.equal(view.notice(),independentNotice);assert.equal(actionError(),originalError);assert.equal(view.env.requests.length,0);
});

test('inspection recovery exit retains a newer native Back protection notice and an independent read error',t=>{
  const view=mount(t,{initialRecovery:{type:'inspection',dataset:'demo',batteryId:'BAT-00000042'},missingBattery:true}), panel=view.active('MissingInspectionRecovery');
  const restoredNotice=view.notice(), sourceKey=view.route();panel.props.onLockedChange(true);view.render();assert.equal(view.back().defaultPrevented,true);assert.equal(view.route(),sourceKey);
  const independentNotice=view.notice();assert.ok(independentNotice);assert.notEqual(independentNotice,restoredNotice);
  panel.props.onLockedChange(false);view.env.pendingRecovery=null;view.env.error='Inspection recovery refresh failed.';view.render();view.active('MissingInspectionRecovery').props.onExit();view.render();
  assert.ok(view.active('InventoryScreen'));assert.equal(view.active('MissingInspectionRecovery'),undefined);assert.equal(view.notice(),independentNotice);assert.equal(view.active('PhoneReadError').props.error,'Inspection recovery refresh failed.');assert.equal(view.env.requests.length,0);
});

test('Scan to view enters its separate owned workflow and a stale or recovered entry cannot replace current work',async t=>{
  const view=mount(t,{deferRecovery:true,loanId:'reviewed-loan'}), scan=view.active('ScanHome');
  const earlier=scan.props.onLookup();view.active('ScanHome').props.onCancelOpening();view.render();const later=scan.props.onOperation('return',['BAT-00000042']);
  view.env.clearCalls[1].resolve();await later;view.render();
  view.env.clearCalls[0].resolve();await earlier;view.render();
  assert.equal(view.active('LookupWorkflow'),undefined);assert.equal(view.active('ScanWorkflow').props.kind,'return');
  view.active('ScanWorkflow').props.onExit();view.render();await settle();view.render();
  const lookup=view.active('ScanHome').props.onLookup();view.env.clearCalls[2].resolve();await lookup;view.render();
  const station=view.active('LookupWorkflow');assert.ok(station);assert.equal(station.props.dataset,'demo');
  const owner=nodes(view.render()).find(node=>node.type==='FloatingWorkflow');assert.ok(owner.props.owner);assert.equal(owner.props.children.type,'LookupWorkflow');
  station.props.onExport('BAT-00000042');view.render();
  const download=view.active('ExportDialog');assert.equal(download.props.draft.batteryId,'BAT-00000042');assert.equal(download.props.draft.filter.lifecycle,'all');
  download.props.onClose();view.render();station.props.onExit();view.render();await settle();view.render();
  const recovery=view.active('ScanHome').props.onLookup();view.env.pendingRecovery={type:'workspace',dataset:'demo',view:'teaching-groups',initialTools:true};view.env.clearCalls[3].resolve();await recovery;view.render();
  assert.equal(view.active('LookupWorkflow'),undefined);assert.equal(view.active('WorkspacePage').props.initialTools,true);assert.equal(view.env.requests.length,0);
});

test('Save as teaching group opens the private definition with exact selected IDs and group selection routes to fixed Inventory',async t=>{
  const view=mount(t);view.nav('Inventory');const inventory=view.active('InventoryScreen');
  await inventory.props.onGroup(['BAT-00000042']);view.render();
  const definition=view.active('TeachingGroupsPanel');assert.ok(definition);assert.deepEqual(definition.props.initialIds,['BAT-00000042']);assert.equal(view.active('GroupMaintenanceDialog'),undefined);
  assert.ok(nodes(view.render()).filter(node=>node.type==='Pressable'&&['Scan','Inventory','Workspace','Me'].includes(text(node).trim())).every(node=>node.props.disabled));
  const group={id:crypto.randomUUID(),name:'Reviewed set',ownerAccountId:'staff-a',state:'active',version:2,batteryIds:['BAT-00000042']};view.env.groups=[group];view.render();
  definition.props.onSelect(group);view.render();
  assert.equal(view.active('TeachingGroupsPanel'),undefined);
  const grouped=view.active('InventoryScreen');assert.deepEqual(grouped.props.scope,{kind:'group',id:group.id,label:group.name,version:group.version});
  const remembered=inventoryModel.readInventoryView(inventoryModel.inventoryViewKey('staff-a','demo',grouped.props.scope),grouped.props.scope);
  assert.deepEqual(remembered.selectedIds,['BAT-00000042']);assert.equal(remembered.selecting,true);assert.equal(remembered.filter.lifecycle,'all');assert.equal(remembered.page,0);assert.equal(view.env.requests.length,0);
});

test('group definition entry respects recovery, original namespace and the current view boundary',async t=>{
  const view=mount(t,{deferRecovery:true});view.nav('Inventory');const original=view.active('InventoryScreen').props.onGroup;
  const pending=original(['BAT-00000042']);view.nav('Me');view.env.clearCalls[0].resolve();await pending;view.render();assert.equal(view.active('TeachingGroupsPanel'),undefined);
  view.active('MeScreen').props.onPersonal('holder');view.render();
  const restricted=view.active('InventoryScreen').props.onGroup(['BAT-00000042']);view.env.clearCalls[1].resolve();await restricted;view.render();assert.equal(view.active('TeachingGroupsPanel'),undefined);
  const back=nodes(view.render()).find(node=>node.type==='Pressable'&&node.props['aria-label']==='Back to previous view');back.props.onClick();view.render();
  view.nav('Inventory');const recovered=view.active('InventoryScreen').props.onGroup(['BAT-00000042']);view.env.pendingRecovery={type:'workspace',dataset:'demo',view:'teaching-groups',initialTools:true};view.env.clearCalls[2].resolve();await recovered;view.render();
  assert.equal(view.active('TeachingGroupsPanel'),undefined);assert.equal(view.active('WorkspacePage').props.view,'teaching-groups');assert.equal(view.active('WorkspacePage').props.initialTools,true);assert.equal(view.env.requests.length,0);
});

test('My tasks has its contextual title and owned manual model portals inherit the active workflow nonce',async t=>{
  const view=mount(t);view.nav('Me');view.active('MeScreen').props.onOpen('messages',{taskContext:'open'});view.render();
  assert.equal(text(nodes(view.render()).find(node=>node.type==='h1')),'My tasks');assert.equal(view.active('WorkspacePage').props.initialTaskContext,'open');
  view.nav('Scan');await view.active('ScanHome').props.onOperation('manual_registration');view.render();
  const boundary=nodes(view.render()).find(node=>node.type==='PhoneUIBoundary'&&node.props.children?.type==='ManualRegistration');assert.ok(boundary);assert.ok(boundary.props.workflowOwner);assert.equal(boundary.props.active,true);
  assert.equal(view.env.requests.length,0);
});

test('system and confirmed saved motion preference propagate to the actual provider and focused workflow',async t=>{
  const view=mount(t);assert.equal(view.provider().props.reducedMotion,false);
  view.nav('Me');view.active('MeScreen').props.onAppSettings();view.render();
  const settings=nodes(view.render()).find(node=>node.props.className==='phone-settings');
  const motion=nodes(settings).find(node=>node.type==='input'&&node.props.checked===false);await motion.props.onChange({target:{checked:true}});view.render();assert.equal(view.provider().props.reducedMotion,true);
  const savedSetting=nodes(view.render()).find(node=>node.props.className==='phone-settings');await nodes(savedSetting).find(node=>node.type==='input'&&node.props.checked===true).props.onChange({target:{checked:false}});view.env.systemReduced=true;view.render();assert.equal(view.provider().props.reducedMotion,true);
  view.nav('Scan');await view.active('ScanHome').props.onLookup();view.render();assert.equal(nodes(view.render()).find(node=>node.type==='FloatingWorkflow').props.reducedMotion,true);
});

async function mountActualInventory(t,view) {
  const input=await readFile(new URL('../src/features/inventory/inventory.jsx',import.meta.url),'utf8');
  const ast=ts.createSourceFile('inventory.jsx',input,ts.ScriptTarget.Latest,true,ts.ScriptKind.JSX);
  const imports=Object.fromEntries(ast.statements.filter(ts.isImportDeclaration).flatMap(statement=>[...(statement.importClause?.name?[{name:statement.importClause.name}]:[]),...(statement.importClause?.namedBindings?.elements??[])].map(binding=>[binding.name.text,binding.name.text])));
  const output=ts.transpileModule(ast.statements.filter(statement=>!ts.isImportDeclaration(statement)).map(statement=>statement.getFullText(ast)).join('\n'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX},reportDiagnostics:true});
  assert.equal(output.diagnostics.some(item=>item.category===ts.DiagnosticCategory.Error),false);
  const inventoryHooks=hooks();let activeHooks=inventoryHooks,sheetHooks=null,inventoryTree,sheetTree,props=view.active('InventoryScreen').props;
  const bind=name=>(...args)=>activeHooks[name](...args);
  const actualReact={createContext:()=>({Provider:'InventorySheetContext'}),useId:()=> 'controlled-sheet-title',useCallback:bind('useCallback')};
  const bindings={...imports,...inventoryModel,...inventoryInteraction,...inventoryQuery,...batteryLifecycle,React:actualReact,getRolePermissions,recentNewArrivals,currentSydneyDate,formatTime,...Object.fromEntries(['useState','useRef','useMemo','useEffect','useLayoutEffect'].map(name=>[name,bind(name)])),usePhoneBack(){},usePhoneContentMotion(){},usePhoneContext:()=>({active:props.active!==false}),visiblePhoneOverlays:interaction.visiblePhoneOverlays};
  const names=Object.keys(bindings),body=output.outputText.replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'');
  const actual=new Function(...names,'_jsx','_jsxs','_Fragment',body+'\nreturn {InventoryScreen,Sheet};')(...names.map(name=>bindings[name]),jsx,jsx,'Fragment');
  const node=Object.assign(new EventTarget(),{tagName:'DIALOG',isConnected:true,open:false,classList:{contains:()=>false},closest:()=>null,getAttribute:name=>name==='role'?'dialog':null,getClientRects(){return this.open?[{}]:[];},showModal(){this.open=true;if(!view.env.overlays.includes(this))view.env.overlays.push(this);view.env.observers.forEach(callback=>callback());},close(){this.open=false;view.env.observers.forEach(callback=>callback());}});
  const root={closest:()=>view.main};
  function render() {
    props=view.active('InventoryScreen')?.props??{...props,active:false};
    activeHooks=inventoryHooks;
    for(let count=0;count<10;count++) {
      inventoryHooks.reset();inventoryTree=actual.InventoryScreen(props);
      nodes(inventoryTree).find(item=>item.props.className==='mobile-inventory').props.ref.current=root;
      if(!inventoryHooks.commit())break;
    }
    const sheet=nodes(inventoryTree).find(item=>item.type===actual.Sheet);
    if(sheet) {
      sheetHooks??=hooks();activeHooks=sheetHooks;
      for(let count=0;count<10;count++) {
        sheetHooks.reset();sheetTree=actual.Sheet(sheet.props);sheetTree.props.ref(node);
        if(!sheetHooks.commit())break;
      }
    } else {sheetHooks?.unmount();sheetHooks=null;sheetTree=null;}
    view.render();return inventoryTree;
  }
  t.after(()=>{sheetHooks?.unmount();inventoryHooks.unmount();});
  const fixture={render,node,
    click(label){render();const found=nodes(sheetTree||inventoryTree).find(item=>item.type==='button'&&(item.props['aria-label']===label||text(item).trim()===label||text(item).startsWith(label)));assert.ok(found,label);assert.equal(found.props.disabled===true,false,label);found.props.onClick();render();},
    async frame(){const callbacks=view.env.frames.splice(0);for(const callback of callbacks)if(callback)callback();await settle();render();},
    select(){fixture.click('Select batteries');fixture.click('Select this page');},
  };
  render();return fixture;
}

test('actual visible Inventory Sheet hands checkout, exact-loan return, removal and private group creation to the guarded shell after close',async t=>{
  for(const [kind,label,component] of [['checkout','Prepare checkout','ScanWorkflow'],['return','Prepare return','ScanWorkflow'],['retire','Prepare removal','MobileRemoval'],['group','Save as teaching group','TeachingGroupsPanel']])await t.test(kind,async child=>{
    const view=mount(child,{loanId:kind==='return'?'exact-reviewed-loan':null});view.nav('Inventory');
    inventoryModel.rememberInventoryView(inventoryModel.inventoryViewKey('staff-a','demo',null),inventoryModel.initialInventoryView(null));
    const list=await mountActualInventory(child,view);list.select();list.click(kind==='group'?'Inventory actions':'Choose action');
    assert.equal(list.node.open,true);assert.equal(interaction.visiblePhoneOverlays(view.document).includes(list.node),true);
    assert.ok(nodes(view.render()).filter(item=>item.type==='Pressable'&&['Scan','Inventory','Workspace','Me'].includes(text(item))).every(item=>item.props.disabled));
    list.click(label);assert.equal(list.node.open,false);assert.equal(view.active(component),undefined,'A still-locked close event cannot open the destination.');
    await list.frame();const destination=view.active(component);assert.ok(destination,kind);assert.deepEqual(destination.props.initialIds,['BAT-00000042']);
    if(kind==='checkout'||kind==='return')assert.equal(destination.props.kind,kind);
    assert.deepEqual(inventoryModel.readInventoryView(inventoryModel.inventoryViewKey('staff-a','demo',null)).selectedIds,['BAT-00000042']);assert.equal(view.env.requests.length,0);
  });
});

test('closed-sheet handoff is cancelled by area changes, remaining dialogs or recorded state changes',async t=>{
  for(const change of ['inactive','foreign-dialog','loan-changed'])await t.test(change,async child=>{
    const view=mount(child);view.nav('Inventory');inventoryModel.rememberInventoryView(inventoryModel.inventoryViewKey('staff-a','demo',null),inventoryModel.initialInventoryView(null));
    const list=await mountActualInventory(child,view);list.select();list.click('Choose action');list.click('Prepare checkout');
    if(change==='inactive'){view.nav('Me');list.render();}
    if(change==='foreign-dialog')view.addOverlay({classList:{contains:()=>false},getAttribute:()=>null,closest:()=>null,getClientRects:()=>[{}]});
    if(change==='loan-changed'){view.env.loanId='later-loan';view.render();list.render();}
    await list.frame();assert.equal(view.active('ScanWorkflow'),undefined);assert.equal(view.env.requests.length,0);assert.deepEqual(inventoryModel.readInventoryView(inventoryModel.inventoryViewKey('staff-a','demo',null)).selectedIds,['BAT-00000042']);
  });
});

test('closed-sheet handoff keeps recovery interception and destination revalidation after an asynchronous persistence boundary',async t=>{
  for(const reason of ['saved-request','loan-changed-after-entry'])await t.test(reason,async child=>{
    const view=mount(child,{deferRecovery:true});view.nav('Inventory');inventoryModel.rememberInventoryView(inventoryModel.inventoryViewKey('staff-a','demo',null),inventoryModel.initialInventoryView(null));
    const list=await mountActualInventory(child,view);list.select();list.click('Choose action');list.click('Prepare checkout');await list.frame();assert.equal(view.env.clearCalls.length,1);
    if(reason==='saved-request')view.env.pendingRecovery={type:'workspace',dataset:'demo',view:'teaching-groups',initialTools:true};else{view.env.loanId='later-loan';view.render();}
    view.env.clearCalls[0].resolve();await settle();view.render();assert.equal(view.active('ScanWorkflow'),undefined);
    if(reason==='saved-request')assert.equal(view.active('WorkspacePage').props.initialTools,true);
    assert.equal(view.env.requests.length,0);assert.deepEqual(inventoryModel.readInventoryView(inventoryModel.inventoryViewKey('staff-a','demo',null)).selectedIds,['BAT-00000042']);
  });
});
