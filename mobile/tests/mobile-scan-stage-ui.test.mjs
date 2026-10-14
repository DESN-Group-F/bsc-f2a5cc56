import test from 'node:test';
import { phoneEntryMessage, phoneEntryTitle } from '../src/app/phone-entry-intent.mjs';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { clearPhoneFormDraft, phoneFormDraftKey, readPhoneFormDraft, savePhoneFormDraft } from '../src/app/phone-form-draft.mjs';
import { createDurableStorage } from '../src/platform/durable-storage.mjs';
import { withNfcFailureContext } from '../src/business/nfc-controller.mjs';
import { createIntakeController, intakeDefaultValues, intakeEntrySource, intakeError, intakeStringFields, reviewedIntakeCommon } from '../src/features/lifecycle/intake-controller.mjs';
import { intakePreparationFromBatch, normalizedIntakePreparation, changedIntakePreparation, applyIntakePreparationModel } from '../src/features/lifecycle/intake-preparation.mjs';
import { FEEDBACK_KEY, readFeedbackPreferences, scanFeedbackOutcome, expireScanFeedback } from '../src/features/scan/feedback.mjs';
import { scanInputMode, removalEntrySource } from '../src/features/scan/input-mode.mjs';
import { acquisitionOf } from '../src/features/scan/scan-controller.mjs';
import { emptyScanCandidates, filterScanCandidates, projectScanCandidates } from '../src/features/scan/scan-candidates.mjs';
import { acquireRemovalNative, createGuardedRemovalBridge, createRemovalController, removalEligible, removalScopeMatches } from '../src/features/lifecycle/removal-controller.mjs';
import { removalDraftStorageKey } from '../src/shared/lib/removal-draft.js';

const icons = Object.fromEntries(['ArrowDownToLine','ArrowLeft','ArrowRight','ArrowUpFromLine','BatteryPlus','ChevronDown','Expand','Nfc','Search','Settings2','Trash2','X','Pencil','CheckCircle2','FileDown'].map(name => [name, name]));
const nodes = (node, result = []) => { if (!node || typeof node !== 'object') return result; if (node.type) result.push(node); for (const child of [node.props?.children].flat(Infinity)) nodes(child, result); return result; };
const outcomeText=phone=>phone.nodes().filter(node=>node.type==="ScanOutcomeStatus").map(node=>[node.props.reader?.message,node.props.idleDetail,node.props.feedback?.message,node.props.feedback?.capsule].filter(Boolean).join(" " )).join(" " );
const text = node => node == null || typeof node === 'boolean' ? '' : typeof node !== 'object' ? String(node) : [node.props?.children].flat(Infinity).map(text).join('');

async function stageHarness(file, componentName, bindings, props, { stageScroll, stageMotion } = {}) {
  const compiled = ts.transpileModule(await readFile(new URL(file, import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } }).outputText.replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
  const retainedViews=bindings.viewState||new Map();
  const hooks = [], effects = [], listeners = new Map(), layer = { inert: false }, focus = []; let cursor = 0, dirty = true, tree;
  const effect = (run, dependencies) => { const index = cursor++, old = hooks[index]; if (!old || !dependencies || dependencies.some((value, i) => !Object.is(value, old.dependencies?.[i]))) { hooks[index] = { dependencies, cleanup: old?.cleanup }; effects.push(() => { hooks[index].cleanup?.(); hooks[index].cleanup = run(); }); } };
  const window = { addEventListener(name, listener) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(listener); }, removeEventListener(name, listener) { listeners.get(name)?.delete(listener); } };
  const document = { visibilityState: 'visible', activeElement: null, body: {}, querySelector: () => layer, addEventListener: window.addEventListener, removeEventListener: window.removeEventListener };
  const supplied = {
    Capacitor:{getPlatform:()=> 'android'},
    ...icons, intakePreparationFromBatch, withNfcFailureContext, savePhoneFormDraft, phoneEntryMessage, phoneEntryTitle, emptyScanCandidates, filterScanCandidates, projectScanCandidates, normalizedIntakePreparation, changedIntakePreparation, applyIntakePreparationModel, reviewedIntakeCommon, ...bindings, usePhoneContext:()=>({active:true}), Pressable:'button', PhoneChoice:'PhoneChoice', IntakePreparation:'IntakePreparation', IntakeBatchSummary:'IntakeBatchSummary', ScanOutcomeStatus:'ScanOutcomeStatus', useScanModeMotion:bindings.useScanModeMotion||(()=>{}), useOwnedNfcReader:bindings.useOwnedNfcReader||(()=>({reader:{state:'unavailable',message:'Native NFC unavailable in browser'},resumeReader(){},cancelReader(){return Promise.resolve(true);}})), usePhonePress:()=>({}), usePhoneViewState(key,initial){const [value,set]=supplied.useState(()=>{if(!retainedViews.has(key))retainedViews.set(key,typeof initial==='function'?initial():initial);return retainedViews.get(key);});return [value,next=>{const updated=typeof next==='function'?next(retainedViews.get(key)):next;retainedViews.set(key,updated);set(updated);}];}, usePhoneBack(handler){effect(()=>{window.addEventListener('battery-mobile-back',handler);return()=>window.removeEventListener('battery-mobile-back',handler);},[handler]);}, window, document, native: bindings.native ?? false, InkOrb: 'InkOrb', _Fragment: 'fragment', createPhoneWorkflowPortal:element=>element,usePhoneOverlayDismiss(){},
    useState(initial) { const index = cursor++; if (!hooks[index]) hooks[index] = { value: typeof initial === 'function' ? initial() : initial }; return [hooks[index].value, next => { const value = typeof next === 'function' ? next(hooks[index].value) : next; if (!Object.is(value, hooks[index].value)) { hooks[index].value = value; dirty = true; } }]; },
    useRef(value) { return hooks[cursor++] ??= { current: value }; },
    useMemo(calculate,dependencies) { const index=cursor++, old=hooks[index];if(!old||dependencies.length!==old.dependencies.length||dependencies.some((value,i)=>!Object.is(value,old.dependencies[i])))hooks[index]={dependencies,value:calculate()};return hooks[index].value; },
    useEffect: effect, useLayoutEffect: effect,
  };
  const draftCode=ts.transpileModule(await readFile(new URL('../src/app/phone-form-draft.jsx',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText.replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'');
  const draftBindings={businessStorage:()=>bindings.businessStorage(),clearPhoneFormDraft,readPhoneFormDraft,savePhoneFormDraft,useRef:supplied.useRef,useState:supplied.useState,useEffect:supplied.useEffect},draftKeys=Object.keys(draftBindings);
  supplied.usePhoneFormDraft=new Function(...draftKeys,`${draftCode}\nreturn usePhoneFormDraft;`)(...draftKeys.map(key=>draftBindings[key]));
  const feedbackCode=(await readFile(new URL('../src/features/scan/use-scan-feedback.js',import.meta.url),'utf8')).replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,''),feedbackBindings={...supplied,scanFeedbackOutcome,expireScanFeedback,playScanFeedback:bindings.playScanFeedback||(()=>{}),Date:bindings.Date||Date,setTimeout:bindings.setTimeout||setTimeout,clearTimeout:bindings.clearTimeout||clearTimeout},feedbackKeys=Object.keys(feedbackBindings);
  supplied.useScanFeedback=new Function(...feedbackKeys,`${feedbackCode}\nreturn useScanFeedback;`)(...feedbackKeys.map(key=>feedbackBindings[key]));
  if(bindings.actualModeMotion){const motionCode=(await readFile(new URL('../src/features/scan/use-scan-mode-motion.js',import.meta.url),'utf8')).replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'');supplied.useScanModeMotion=new Function('useRef','useEffect','usePhoneReducedMotion',`${motionCode}\nreturn useScanModeMotion;`)(supplied.useRef,supplied.useEffect,()=>false);}
  const names = Object.keys(supplied), jsx = (type, properties) => ({ type, props: properties });
  const Component = new Function(...names, '_jsx', '_jsxs', `${compiled}\nreturn ${componentName};`)(...names.map(name => supplied[name]), jsx, jsx);
  const phone = {
    layer, focus,
    render() { let count = 0; do { assert.ok(count++ < 20, 'Actual component effects settle'); dirty = false; cursor = 0; tree = Component(props); for (const node of nodes(tree)) if (node.props.ref && !node.props.ref.current) { const ref = node.props.ref; ref.current = { isConnected: true, scrollTop: 0, focus: () => focus.push(node.props['aria-label'] || node.props.className), querySelector: () => ({ focus() {} }), querySelectorAll: () => [], contains: () => true }; if (stageScroll && (node.props.className?.startsWith('scan-stage-content') || node.props.className?.startsWith('mi-stage-content'))) Object.defineProperty(ref.current, 'scrollTop', { get() { stageScroll.access.push(['read', stageScroll.position]); return stageScroll.position; }, set(value) { stageScroll.access.push(['write', value]); stageScroll.position = value; } }); if(stageMotion&&node.props.className?.startsWith('mi-stage-content'))ref.current.animate=(_frames,options)=>{stageMotion.push(['animate',options.duration]);return{cancel:()=>stageMotion.push(['cancel'])};}; } while (effects.length) effects.shift()(); } while (dirty); return phone; },
    nodes: () => nodes(tree), text: () => text(tree),
    button(label) { const node = nodes(tree).find(item => item.type === 'button' && (text(item) === label || item.props['aria-label'] === label)); assert.ok(node, `Actual button exists: ${label}`); return node; },
    event(name,properties={}) { for (const handler of [...listeners.get(name) || []]) handler({ preventDefault() {},...properties }); return phone.render(); },
    unmount() { for (const hook of hooks) hook?.cleanup?.(); },
  };
  return phone.render();
}

function scanFixture() {
  const calls = [], options = [], session = { queue: [], completed: [], issues: [], attempt: null, mobileScope: null, teachingGroup: null, room: null };
  const battery = { id: 'BAT-001', name: 'Teaching battery', tagId: 'TAG-001', version: 1, loanId: null };
  const controller = { canExit: () => true, needsExitConfirmation: () => false, exit: async () => { calls.push('exit'); return true; }, getSnapshot: () => ({ session }), addSelections: async ids => { calls.push(['stage', ids]); session.queue = ids.map(() => ({ battery, source: 'selection' })); return session.queue; }, confirmQueue: async () => { calls.push('confirm'); }, addTag: async () => ({ type: 'accepted' }) };
  const wf = { session, controller, blocked: false, busy: false, storageError: '', foreground: true, reader: { state: 'unavailable', message: 'Browser preview · Native NFC unavailable.' }, feedback: {}, preferences: { haptics: true, sounds: false, strength: 'light' }, action: work => work(), changePreferences() {}, resumeReader() {} };
  const data = { dataset: 'demo', user: { id: 'STAFF-A', displayName: 'Staff A' }, batteries: [battery], rooms: [] };
  return { calls, options, session, data, wf, bindings: { scanInputMode, isActiveBattery: () => true, isSelectableRoom: () => true, scanScopeMatches: () => true, acquisitionOf, scanSourceLabel: read => read.source, useScanWorkflow: config => { options.push(config); return wf; } } };
}

test('actual Scan home gives read-only lookup and four business operations distinct explicit callbacks', async () => {
  const calls = [], phone = await stageHarness('../src/features/scan/scan.jsx', 'ScanHome', {}, { onOperation: kind => calls.push(kind), onLookup: () => calls.push('lookup') });
  const composition = phone.nodes().find(node => node.props.className === 'scan-home-composition');
  assert.ok(composition);
  assert.deepEqual([composition.props.children].flat().map(node => node.props.className), ['scan-lookup-entry', 'scan-operation-group']);
  assert.equal(nodes(composition).filter(node => node.type === 'InkOrb').length, 1);
  const actions = nodes(composition).filter(node => node.type === 'button');
  assert.equal(actions.length, 5);
  assert.equal(text(actions[0]), 'Start scan'); assert.equal(actions[0].props.disabled, false);
  assert.match(actions[0].props['aria-label'], /view battery details; no stock changes/);
  const hero = nodes(composition).find(node => node.props.className === 'scan-lookup-entry');
  assert.equal(hero.props.onClick, undefined, 'Only the visible CTA starts read-only lookup');
  assert.equal(text(nodes(hero).find(node => node.type === 'small')), 'No stock changes');
  assert.deepEqual(actions.slice(1).map(text), ['Check out', 'Return', 'Intake', 'Removal']);
  assert.deepEqual(actions.slice(1).map(node => node.props['data-priority']), ['primary', 'primary', 'secondary', 'secondary']);
  for (const action of actions.slice(1)) {
    assert.ok(action.props['aria-label'].startsWith(text(action)), 'The accessible name includes its visible label');
    assert.equal(nodes(action).some(node => node.type === 'small'), false);
  }
  assert.equal(phone.nodes().some(node => node.type === 'h2'), false);
  assert.equal(phone.text().includes('Record an operation'), false);
  for (const action of actions) action.props.onClick();
  assert.deepEqual(calls, ['lookup', 'checkout', 'return', 'intake', 'removal']);
  assert.equal(phone.nodes().find(node => node.type === 'h1').props.className, 'scan-screen-reader-title');
  phone.unmount();
});

test('Scan home entry preparation names the requested task and offers independent Cancel and failed-read Retry controls',async()=>{
  for(const [kind,title] of [['lookup','Scan to view'],['checkout','Check out'],['return','Return'],['intake','Intake'],['removal','Removal']])for(const phase of ['waiting','opening','failed']){
    const calls=[],phone=await stageHarness('../src/features/scan/scan.jsx','ScanHome',{}, {entryPending:{kind,phase},onOperation(){},onLookup(){},onCancelOpening:()=>calls.push('cancel'),onRetryOpening:()=>calls.push('retry')});
    const hero=phone.nodes().find(node=>node.props.className==='scan-lookup-entry'),copy=nodes(hero).find(node=>node.props.className==='scan-lookup-copy');assert.equal(text(nodes(copy).find(node=>node.type==='strong')),title);
    assert.equal(nodes(hero).find(node=>node.type==='InkOrb').props.active,phase==='failed');assert.equal(hero.props['aria-busy'],phase!=='failed');assert.match(text(nodes(copy).find(node=>node.type==='small')),phase==='failed'?/^Could not prepare/:/^Preparing/);
    const buttons=phone.nodes().filter(node=>node.type==='button'),cancel=buttons.find(node=>node.props['aria-label']==='Cancel opening'),retry=buttons.find(node=>text(node)==='Retry');assert.ok(cancel);assert.equal(!!retry,phase==='failed');assert.ok(buttons.filter(node=>['scan-lookup-target','scan-action-tile'].includes(node.props.className)).every(node=>node.props.disabled));
    assert.equal(buttons.find(node=>node.props.className==='scan-lookup-target').props.hidden,true,'The original focus-return target stays mounted while pending controls replace it visually');
    for(const button of buttons)assert.equal(nodes(button.props.children).some(node=>node.type==='button'),false,'Actions must never nest inside the hero lookup target');cancel.props.onClick();retry?.props.onClick();assert.deepEqual(calls,phase==='failed'?['cancel','retry']:['cancel']);phone.unmount();
  }
});

test('actual Scan JSX keeps mutually exclusive sources, restores source scroll, and pauses NFC for controls', async () => {
  const env = scanFixture(), phone = await stageHarness('../src/features/scan/scan.jsx', 'ScanWorkflow', env.bindings, { kind: 'checkout', data: env.data });
  assert.equal(phone.nodes().some(node => node.type === 'InkOrb'), true);
  assert.equal(phone.button('NFC').props['aria-pressed'], true);
  phone.button('Select').props.onClick(); phone.render();
  const scroller = phone.nodes().find(node => node.props.className?.startsWith('scan-stage-content')).props.ref.current;
  scroller.scrollTop = 137;
  phone.button('NFC').props.onClick(); phone.render(); assert.equal(phone.nodes().filter(node => node.type === 'InkOrb').length, 1);
  assert.equal(phone.nodes().some(node => node.props.className?.includes('scan-manual-panel')), false);
  phone.button('Scan feedback preferences').props.onClick(); phone.render(); assert.equal(env.options.at(-1).reviewOpen, true); assert.equal(phone.nodes().some(node => node.type === 'InkOrb'), false);
  phone.event('battery-mobile-back'); assert.equal(env.options.at(-1).reviewOpen, false); assert.equal(env.calls.length, 0);
  phone.button('More input').props.onClick(); phone.render(); assert.equal(env.options.at(-1).reviewOpen, true);
  phone.button('Demo previewLocal simulated tag input').props.onClick(); phone.render(); assert.match(phone.text(), /Local demonstration tag simulation/); assert.equal(phone.nodes().some(node => node.type === 'InkOrb'), false);
  phone.button('Select').props.onClick(); phone.render(); assert.equal(scroller.scrollTop, 137);
  phone.unmount();
});

test('new Scan content never reads or writes scrollTop during its first settled entry', async () => {
  for (const initialIds of [[], ['BAT-001']]) {
    const env = scanFixture(), stageScroll = { position: 0, access: [] };
    const phone = await stageHarness('../src/features/scan/scan.jsx', 'ScanWorkflow', env.bindings, { kind: 'checkout', data: env.data, initialIds }, { stageScroll });
    assert.deepEqual(stageScroll.access, [], 'The browser already starts a new content container at zero.');
    phone.render(); assert.deepEqual(stageScroll.access, [], 'An unchanged rerender also leaves the content container untouched.');
    stageScroll.position = 67; phone.unmount();
    assert.deepEqual(stageScroll.access, [['read', 67]], 'Cleanup still captures the position without writing to the outgoing container.');
  }
});

test('Scan mode changes reset new modes and restore both nonzero and zero positions in layout effects', async () => {
  const env = scanFixture(), stageScroll = { position: 0, access: [] };
  const phone = await stageHarness('../src/features/scan/scan.jsx', 'ScanWorkflow', env.bindings, { kind: 'checkout', data: env.data }, { stageScroll });
  const change = (label, before, after) => {
    stageScroll.position = before; stageScroll.access.length = 0;
    phone.button(label).props.onClick(); phone.render();
    assert.deepEqual(stageScroll.access, [['read', before], ['write', after]], `${label}: capture the outgoing mode and restore before paint.`);
    assert.equal(stageScroll.position, after);
  };
  change('Select', 31, 0);
  change('NFC', 137, 31);
  change('Select', 0, 137);
  change('NFC', 0, 0);
  change('Scan feedback preferences', 29, 0);
  change('Session details', 56, 0);
  change('Close scan details', 81, 29);
  change('Scan feedback preferences', 0, 56);
  change('Session details', 0, 81);
  phone.unmount();
});

test('a newly mounted Scan workflow does not inherit scroll positions from a cleaned-up workflow', async () => {
  const env = scanFixture(), previousScroll = { position: 0, access: [] };
  const first = await stageHarness('../src/features/scan/scan.jsx', 'ScanWorkflow', env.bindings, { kind: 'checkout', data: env.data }, { stageScroll: previousScroll });
  first.button('Select').props.onClick(); first.render();
  previousScroll.position = 205; previousScroll.access.length = 0; first.unmount();
  assert.deepEqual(previousScroll.access, [['read', 205]]);
  const freshScroll = { position: 0, access: [] };
  const next = await stageHarness('../src/features/scan/scan.jsx', 'ScanWorkflow', env.bindings, { kind: 'checkout', data: env.data }, { stageScroll: freshScroll });
  assert.deepEqual(freshScroll.access, []);
  next.button('Select').props.onClick(); next.render();
  assert.equal(freshScroll.position, 0, 'The new workflow has no saved Select position.');
  assert.deepEqual(freshScroll.access, [['read', 0], ['write', 0]]);
  next.unmount(); assert.deepEqual(freshScroll.access.at(-1), ['read', 0]);
});

test('actual Scan staging never confirms outside Review and source lock guards event handlers', async () => {
  const env = scanFixture(), phone = await stageHarness('../src/features/scan/scan.jsx', 'ScanWorkflow', env.bindings, { kind: 'checkout', data: env.data });
  phone.button('Select').props.onClick(); phone.render();
  phone.nodes().find(node => node.type === 'input' && node.props.type === 'checkbox').props.onChange({ target: { checked: true } }); phone.render();
  await phone.button('Add to review (1)').props.onClick(); phone.render(); assert.deepEqual(env.calls, [['stage', ['BAT-001']]]);
  assert.equal(phone.button('NFC').props.disabled, true); phone.button('NFC').props.onClick(); phone.render(); assert.equal(phone.nodes().some(node => node.type === 'InkOrb'), false);
  phone.button('Review queue, 1 battery').props.onClick(); phone.render(); assert.equal(phone.layer.inert, true);
  const confirmation = phone.button('Check out (1)'); assert.ok(phone.nodes().find(node => node.props.className?.startsWith('scan-review-sheet')));
  await confirmation.props.onClick(); assert.equal(env.calls.at(-1), 'confirm');
  phone.button('Close review and retain queue').props.onClick(); phone.render(); assert.equal(phone.layer.inert, false); assert.equal(env.session.queue.length, 1);
  phone.unmount();
});

test('Scan Review uses the actual singular or plural queue and latest confirmed receipt count',async()=>{
  for(const count of [1,2]){
    const env=scanFixture(),noun=count===1?'battery':'batteries';env.session.queue=Array.from({length:count},(_,i)=>({battery:{...env.data.batteries[0],id:`BAT-${i}`},source:'selection'}));env.session.completed=[{battery:env.data.batteries[0],receipt:{requestId:'previous',at:'2026-10-12T00:00:00Z'}},...Array.from({length:count},(_,i)=>({battery:{...env.data.batteries[0],id:`SAVED-${i}`},receipt:{requestId:'latest',at:'2026-10-13T00:00:00Z'}}))];
    const phone=await stageHarness('../src/features/scan/scan.jsx','ScanWorkflow',env.bindings,{kind:'checkout',data:env.data});phone.button(`Review queue, ${count} ${noun}`).props.onClick();phone.render();const receipt=phone.nodes().find(node=>node.props.className==='scan-saved-summary');assert.ok(receipt);assert.ok(text(receipt).includes(`${count} ${noun} confirmed`),'summary counts only the newest exact receipt');phone.unmount();
  }
});

test('actual Select keeps staging reachable outside a 65-row scroll body and preserves explicit Review', async () => {
  const env = scanFixture();
  env.data.batteries = Array.from({ length: 65 }, (_, index) => ({ ...env.data.batteries[0], id: `BAT-${String(index + 1).padStart(3, '0')}`, name: `Teaching battery ${index + 1}`, tagId: `TAG-${index + 1}` }));
  env.wf.controller.addSelections = async ids => {
    env.calls.push(['stage', [...ids]]);
    env.session.queue = ids.map(id => ({ battery: env.data.batteries.find(battery => battery.id === id), source: 'selection' }));
    return env.session.queue;
  };
  const phone = await stageHarness('../src/features/scan/scan.jsx', 'ScanWorkflow', { ...env.bindings, native: true }, { kind: 'checkout', data: env.data });
  phone.button('Select').props.onClick(); phone.render();
  const rows = phone.nodes().filter(node => node.type === 'input' && node.props.type === 'checkbox');
  assert.equal(rows.length, 65);
  assert.equal(phone.button('Add to review (0)').props.disabled, true);
  rows[0].props.onChange({ target: { checked: true } });
  rows[64].props.onChange({ target: { checked: true } }); phone.render();
  assert.deepEqual(env.calls, []); assert.equal(env.session.queue.length, 0);
  const body = phone.nodes().find(node => node.props.className?.startsWith('scan-stage-content'));
  body.props.ref.current.scrollTop = 140;
  const footer = phone.nodes().find(node => node.props.className === 'scan-stage-footer');
  const stage = phone.button('Add to review (2)');
  assert.equal(nodes(body).includes(stage), false, 'Staging does not follow the long list inside its scroller');
  assert.equal(nodes(footer).includes(stage), true, 'Staging shares the reserved stationary footer with Review');
  assert.equal(stage.props.disabled, false);
  phone.nodes().find(node => node.props['aria-label'] === 'Search manual selection').props.onChange({ target: { value: 'battery 30' } }); phone.render();
  assert.equal(phone.nodes().filter(node => node.type === 'input' && node.props.type === 'checkbox').length, 1);
  assert.equal(phone.button('Add to review (2)').props.disabled, false, 'Filtered-out selections remain explicit and reachable');
  env.wf.blocked = true; phone.render();
  assert.equal(phone.button('Add to review (2)').props.disabled, true);
  assert.equal(phone.button('Clear selection').props.disabled, true);
  env.wf.blocked = false; phone.render();
  await phone.button('Add to review (2)').props.onClick(); phone.render();
  assert.deepEqual(env.calls, [['stage', ['BAT-001', 'BAT-065']]]);
  assert.equal(env.session.queue.length, 2); assert.equal(phone.button('Add to review (0)').props.disabled, true);
  assert.equal(phone.button('Review queue, 2 batteries').props.className, 'scan-review-entry');
  assert.equal(env.calls.includes('confirm'), false);
  phone.unmount();
});

test('short Select editing tracks empty, selected and staged states; Clear and keyboard Done never submit',async()=>{
  const env=scanFixture(),phone=await stageHarness('../src/features/scan/scan.jsx','ScanWorkflow',env.bindings,{kind:'checkout',data:env.data});
  phone.button('Select').props.onClick();phone.render();
  const station=()=>phone.nodes().find(node=>node.props.className==='mobile-scan-station'),search=()=>phone.nodes().find(node=>node.props['aria-label']==='Search manual selection');
  assert.equal(station().props['data-content'],'selection');assert.equal(station().props['data-selection-count'],0);assert.equal(station().props['data-queue-count'],0);
  assert.equal(phone.nodes().some(node=>node.props.className?.startsWith('scan-editing-clear')),false);
  let prevented=0,blurred=0;assert.equal(search().props.enterKeyHint,'done');search().props.onKeyDown({key:'Enter',preventDefault(){prevented++;},currentTarget:{blur(){blurred++;}}});
  assert.equal(prevented,1);assert.equal(blurred,1);assert.deepEqual(env.calls,[]);
  phone.nodes().find(node=>node.type==='input'&&node.props.type==='checkbox').props.onChange({target:{checked:true}});phone.render();
  assert.equal(station().props['data-selection-count'],1);search().props.onChange({target:{value:'missing'}});phone.render();
  assert.equal(station().props['data-selection-count'],1,'Filtering must retain the reviewed selection');assert.equal(phone.button('Add to review (1)').props.disabled,false);
  env.wf.blocked=true;phone.render();assert.equal(phone.button('Clear selected batteries while editing').props.disabled,true);env.wf.blocked=false;phone.render();
  phone.button('Clear selected batteries while editing').props.onClick();phone.render();assert.equal(station().props['data-selection-count'],0);assert.equal(search().props.value,'missing');assert.deepEqual(env.calls,[]);
  phone.button('Clear filters').props.onClick();phone.render();phone.nodes().find(node=>node.type==='input'&&node.props.type==='checkbox').props.onChange({target:{checked:true}});phone.render();
  await phone.button('Add to review (1)').props.onClick();phone.render();assert.equal(station().props['data-selection-count'],0);assert.equal(station().props['data-queue-count'],1);assert.deepEqual(env.calls,[['stage',['BAT-001']]]);assert.equal(phone.button('Review queue, 1 battery').props.disabled,undefined);assert.equal(env.calls.includes('confirm'),false);
  const body=phone.nodes().find(node=>node.props.className?.startsWith('scan-stage-content')),header=phone.nodes().find(node=>node.props.className?.includes('scan-focused-header'));
  assert.equal(nodes(body).some(node=>node.props.className?.startsWith('scan-editing-clear')),false);assert.ok(header);phone.unmount();
});

test('actual Scan recovery precedes every long queue row and discloses the original error without a duplicate status', async () => {
  const env = scanFixture(), diagnostic = 'Controlled USB reply drop: the original request must be recovered';
  env.session.queue = Array.from({ length: 20 }, (_, index) => ({ battery: { ...env.data.batteries[0], id: `BAT-${index}`, name: 'Long teaching battery identity '.repeat(8) }, source: 'selection' }));
  env.session.attempt = { status: 'uncertain', message: diagnostic, payload: { requestId: 'original-request' }, reads: [env.session.queue[0]] };
  const original = structuredClone(env.session.attempt);
  env.wf.blocked = true; env.wf.feedback.message = diagnostic;
  env.wf.controller.retry = async () => env.calls.push(['retry', env.session.attempt.payload.requestId]);
  const phone = await stageHarness('../src/features/scan/scan.jsx', 'ScanWorkflow', env.bindings, { kind: 'checkout', data: env.data });
  phone.button('Review queue, 20 batteries').props.onClick(); phone.render();
  const reviewBody = () => phone.nodes().find(node => node.props.className === 'scan-review-scroll');
  let body = reviewBody(), order = nodes(body), retry = phone.button('Check original request');
  assert.ok(order.indexOf(retry) < order.findIndex(node => node.props.className === 'scan-review-row'));
  const details = order.find(node => node.type === 'details' && text(node).startsWith('Request details'));
  assert.match(text(details), /Controlled USB reply drop/);
  assert.equal(order.some(node => node.props.role === 'status' && text(node) === diagnostic), false);
  assert.equal(text(body).split(diagnostic).length - 1, 1);
  await retry.props.onClick(); assert.deepEqual(env.calls, [['retry', 'original-request']]);
  assert.deepEqual(env.session.attempt, original); assert.equal(env.session.queue.length, 20);
  body.props.ref.current.scrollTop = 180;
  env.wf.storageError = 'Controlled device-save failure'; phone.render(); body = reviewBody(); order = nodes(body);
  assert.equal(body.props.ref.current.scrollTop, 0, 'New protected recovery is revealed after a scrolled Review');
  assert.ok(order.indexOf(phone.button('Retry device save')) < order.findIndex(node => node.props.className === 'scan-review-row'));
  assert.equal(phone.button('Check original request').props.disabled, true);
  phone.unmount();
});

test('actual native and typed stages do not traverse manual inventory on reader or feedback renders',async()=>{
  const env=scanFixture(), batteries=env.data.batteries;let reads=0,projections=0;
  Object.defineProperty(env.data,'batteries',{get(){reads++;return batteries;}});
  const phone=await stageHarness('../src/features/scan/scan.jsx','ScanWorkflow',{...env.bindings,native:true,projectScanCandidates:context=>{projections++;return projectScanCandidates(context);}},{kind:'checkout',data:env.data});
  env.wf.reader={state:'ready',message:'Ready to scan'};env.wf.feedback={tone:'success',message:'Reader feedback'};phone.render();phone.render();
  assert.equal(reads,0);assert.equal(projections,0);assert.equal(phone.button('NFC').props['aria-pressed'],true);
  phone.button('More input').props.onClick();phone.render();phone.button('Tag inputEnter an exact registered tag').props.onClick();phone.render();
  assert.equal(reads,0);assert.equal(projections,0);assert.ok(phone.nodes().find(node=>node.type==='form'&&node.props.className==='scan-tag-panel scan-stage-panel'));
  phone.button('Select').props.onClick();phone.render();assert.equal(projections,1);assert.equal(reads,1);assert.equal(phone.nodes().filter(node=>node.props.className==='scan-selection-row').length,1);
  env.wf.reader={state:'paused',message:'Manual input selected'};phone.render();assert.equal(projections,1);assert.equal(reads,1);assert.deepEqual(env.calls,[]);phone.unmount();
});

test('actual manual projection refreshes for queue and completed binding changes while retaining a filtered selection',async()=>{
  const env=scanFixture(), first=env.data.batteries[0], second={...first,id:'BAT-002',name:'Second teaching battery',tagId:'TAG-002'};env.data.batteries=[first,second];
  let projections=0,searches=0;const props={kind:'checkout',data:env.data,initialIds:['BAT-001']};
  const phone=await stageHarness('../src/features/scan/scan.jsx','ScanWorkflow',{...env.bindings,native:true,projectScanCandidates:context=>{projections++;return projectScanCandidates(context);},filterScanCandidates:(values,query)=>{searches++;return filterScanCandidates(values,query);}},props);
  const rows=()=>phone.nodes().filter(node=>node.props.className==='scan-selection-row');
  assert.equal(rows().length,2);assert.equal(phone.button('Add to review (1)').props.disabled,false);assert.equal(projections,1);
  phone.nodes().find(node=>node.props['aria-label']==='Search manual selection').props.onChange({target:{value:'Second'}});phone.render();assert.equal(rows().length,1);assert.match(text(rows()[0]),/BAT-002/);assert.equal(projections,1);assert.equal(searches,2);assert.equal(phone.button('Add to review (1)').props.disabled,false);
  phone.button('Clear filters').props.onClick();phone.render();env.session.queue=[{battery:second,source:'selection'}];phone.render();assert.equal(rows().length,1);assert.match(text(rows()[0]),/BAT-001/);assert.equal(projections,2);
  env.session.completed=[{battery:first}];phone.render();assert.equal(rows().length,0);assert.equal(projections,3);assert.equal(phone.button('Add to review (1)').props.disabled,false);
  props.data={...env.data,batteries:[{...first,version:2},second]};phone.render();assert.equal(rows().length,1);assert.equal(projections,4);assert.equal(nodes(rows()[0]).find(node=>node.type==='input').props.checked,true);
  props.kind='return';props.data={...props.data,batteries:[{...first,version:2,loanId:'loan-new'},second]};phone.render();assert.equal(rows().length,1);
  env.session.completed=[{battery:{...first,version:2,loanId:'loan-old'}}];phone.render();assert.equal(rows().length,1);
  env.session.completed=[{battery:{...first,version:2,loanId:'loan-new'}}];phone.render();assert.equal(rows().length,0);
  env.wf.blocked=true;phone.render();assert.equal(phone.button('Add to review (1)').props.disabled,true);assert.deepEqual(env.calls,[]);phone.unmount();
});

test('actual preselected group entry invalidates the list for captured group and personal authority changes',async()=>{
  const env=scanFixture(), first={...env.data.batteries[0],ownerAccountId:'STAFF-A'};env.data.batteries=[first];env.data.teachingGroups=[{id:'GROUP-A',version:1,name:'Group A',batteryIds:[first.id]}];
  env.session.teachingGroup={id:'GROUP-A',version:1};env.session.mobileScope={kind:'owner',id:'STAFF-A'};
  const props={kind:'checkout',data:env.data,user:env.data.user,initialIds:[first.id],teachingGroup:env.data.teachingGroups[0]};
  const phone=await stageHarness('../src/features/scan/scan.jsx','ScanWorkflow',{...env.bindings,native:true},props),rows=()=>phone.nodes().filter(node=>node.props.className==='scan-selection-row');
  assert.equal(phone.button('Select').props['aria-pressed'],true);assert.equal(rows().length,1);assert.equal(nodes(rows()[0]).find(node=>node.type==='input').props.checked,true);
  props.data={...env.data,teachingGroups:[{...env.data.teachingGroups[0],version:2}]};phone.render();assert.equal(rows().length,0);assert.equal(phone.button('Add to review (1)').props.disabled,false);
  env.session.teachingGroup={id:'GROUP-A',version:2};phone.render();assert.equal(rows().length,1);
  env.session.mobileScope={kind:'ids',batteryIds:['BAT-OTHER']};phone.render();assert.equal(rows().length,0);
  env.session.mobileScope={kind:'owner',id:'STAFF-A'};props.user={...env.data.user,id:'STAFF-B'};phone.render();assert.equal(rows().length,0);
  props.user=env.data.user;phone.render();assert.equal(rows().length,1);assert.equal(nodes(rows()[0]).find(node=>node.type==='input').props.checked,true);assert.deepEqual(env.calls,[]);phone.unmount();
});

async function intakeFixture({prepared=true,driverSave=async()=>{}}={}) {
  const storage = createDurableStorage({ load: async () => JSON.stringify({ schemaVersion: 1, entries: {} }), save: driverSave }); await storage.initialize();
  const user = { id: 'STAFF-A', role: 'staff', displayName: 'Staff A' }, data = { dataset: 'demo', user, batteries: [], people: [{ id: 'OWNER-A', accountId: user.id, role: 'staff', name: 'Staff A' }], staffDirectory: [{ id: user.id, active: true }], rooms: [], buildings: [{ id: 'J18' }] }, calls = [];
  let queueAccepted=()=>{};
  const controller = createIntakeController({ storage, data, accountId: user.id, dataset: 'demo', onQueueAccepted:result=>queueAccepted(result), write: async () => { calls.push('register'); throw new Error('Unexpected confirmation outside Review'); } });
  if(prepared)await controller.prepare({ ...intakeDefaultValues(data, user.id), name: 'Prepared teaching battery' });
  const viewState=new Map();
  return { controller, calls, data, storage, viewState, bindings:{viewState, businessStorage: () => storage, useWorkflowLock() {}, modelCreateStorageKey: () => 'model:none', readFeedbackPreferences, FEEDBACK_KEY, scanFeedbackOutcome, expireScanFeedback, playScanFeedback() {}, createIntakeController: options => {queueAccepted=options.onQueueAccepted;return controller;}, intakeDefaultValues, intakeEntrySource, intakeError, intakeStringFields, teachingNfcBridge: () => null, CommonFields: 'CommonFields', inventoryResponse() {}, currentSydneyDate: () => '2026-10-12', isSelectableRoom: () => true, modelApplication: old => old, getRolePermissions: () => ({}), BatteryModelPicker: 'ModelPicker', TemporalInput: 'DateInput' } };
}

async function continueIntake(phone){await phone.button('Continue with these details').props.onClick();phone.render();}

test('new Intake setup and acquisition leave the initial scroll position untouched', async () => {
  for(const prepared of [false,true]) {
    const env=await intakeFixture({prepared}),stageScroll={position:0,access:[]};
    const phone=await stageHarness('../src/features/lifecycle/intake.jsx','MobileIntake',env.bindings,{data:env.data},{stageScroll});
    assert.deepEqual(stageScroll.access,[],'A new container already starts at zero.');
    phone.render();assert.deepEqual(stageScroll.access,[],'An unchanged render does not reset it.');
    stageScroll.position=73;phone.unmount();assert.deepEqual(stageScroll.access,[['read',73]],'Cleanup retains the outgoing position.');
    assert.deepEqual(env.calls,[]);
  }
});

test('Intake panel changes keep restoring the captured source position', async () => {
  const env=await intakeFixture(),stageScroll={position:0,access:[]};
  const phone=await stageHarness('../src/features/lifecycle/intake.jsx','MobileIntake',env.bindings,{data:env.data},{stageScroll});
  stageScroll.position=83;phone.button('Intake feedback preferences').props.onClick();phone.render();
  assert.deepEqual(stageScroll.access,[['read',83],['write',0]]);
  stageScroll.position=12;phone.event('battery-mobile-back');
  assert.deepEqual(stageScroll.access,[['read',83],['write',0],['read',12],['write',83]]);
  assert.deepEqual(env.calls,[]);phone.unmount();
});

test('actual Intake recovery leads Review and retries only the captured registration with its details retained', async () => {
  const env = await intakeFixture();
  for (const tag of ['DEMO-INTAKE-LAYOUT-001', 'DEMO-INTAKE-LAYOUT-002', 'DEMO-INTAKE-LAYOUT-003']) await env.controller.addTag(tag);
  const first = env.controller.getSnapshot().draft.entries[0].id;
  await env.controller.confirm([first]);
  const original = structuredClone(env.controller.getSnapshot().draft.attempt);
  assert.ok(original);
  const phone = await stageHarness('../src/features/lifecycle/intake.jsx', 'MobileIntake', env.bindings, { data: env.data });
  const body = phone.nodes().find(node => node.props.className === 'mi-review-scroll'), order = nodes(body), retry = phone.button('Check original request');
  assert.ok(order.indexOf(retry) < order.findIndex(node => node.props.className === 'mi-review-row'));
  const details = order.find(node => node.type === 'details' && text(node).startsWith('Request details'));
  assert.match(text(details), /Unexpected confirmation outside Review/);
  assert.equal(order.some(node => node.type === 'em' && /Unexpected confirmation/.test(text(node))), false);
  await retry.props.onClick(); phone.render();
  assert.deepEqual(env.controller.getSnapshot().draft.attempt, original);
  assert.equal(env.controller.getSnapshot().draft.entries.length, 3);
  assert.deepEqual(env.calls, ['register', 'register']);
  phone.unmount();
});

test('actual Intake JSX hides common fields during scanning, keeps demo in More input, and Back closes inner panels', async () => {
  const env = await intakeFixture(), phone = await stageHarness('../src/features/lifecycle/intake.jsx', 'MobileIntake', env.bindings, { data: env.data });
  await continueIntake(phone);
  assert.equal(phone.nodes().some(node => node.type === 'IntakeBatchSummary'), false); assert.equal(phone.nodes().some(node => node.props.className === 'mi-setup'), false);
  assert.equal(phone.nodes().some(node => node.props.role === 'menu'), false);
  phone.button('NFC').props.onClick(); phone.render(); assert.equal(phone.nodes().filter(node => node.type === 'InkOrb').length, 1); assert.match(outcomeText(phone), /Native NFC unavailable in browser/); assert.equal(phone.nodes().some(node => node.props.className?.includes('mi-simulation')), false);
  phone.button('Intake feedback preferences').props.onClick();phone.render();phone.button('Session details').props.onClick(); phone.render(); assert.ok(phone.nodes().some(node => node.type === 'IntakeBatchSummary')); assert.equal(phone.nodes().some(node => node.type === 'InkOrb'), false);
  phone.event('battery-mobile-back'); assert.equal(phone.nodes().filter(node => node.type === 'InkOrb').length, 1);
  phone.button('Intake feedback preferences').props.onClick(); phone.render(); phone.event('battery-mobile-back'); assert.equal(phone.nodes().filter(node => node.type === 'InkOrb').length, 1);
  phone.button('More input').props.onClick(); phone.render(); phone.button('Demo simulationExplicit simulated intake tags').props.onClick(); phone.render();
  assert.match(phone.text(), /Explicit demonstration inputs/); assert.deepEqual(env.calls, []); assert.equal(phone.nodes().some(node => node.props.className === 'mi-register-button'), false);
  phone.button('Review queue, 0 intake drafts').props.onClick(); phone.render(); assert.equal(phone.layer.inert, true); assert.equal(phone.button('Register selected (0)').props.disabled, true);
  phone.button('Close intake review and retain drafts').props.onClick(); phone.render(); assert.equal(phone.layer.inert, false);
  phone.unmount();
});

test('fresh browser and native Scan entries select NFC without acquiring or submitting', async () => {
  for (const native of [false, true]) {
    const env = scanFixture(), phone = await stageHarness('../src/features/scan/scan.jsx', 'ScanWorkflow', { ...env.bindings, native }, { kind: 'checkout', data: env.data });
    assert.equal(phone.button('NFC').props['aria-pressed'], true);
    assert.equal(phone.nodes().filter(node => node.type === 'InkOrb').length, 1);
    if (!native) assert.match(outcomeText(phone), /Browser preview.*NFC unavailable/);
    assert.deepEqual(env.calls, []);
    phone.unmount();
  }
});

test('actual recovered Scan input shows its captured source before any user acquisition', async () => {
  for (const [source, mode] of [['native_nfc','native'],['selection','selection'],['manual','tag'],['simulated','simulated']]) {
    const env = scanFixture();
    const before = { battery: env.data.batteries[0], source, acquisition: source === 'native_nfc' ? 'native-nfc-reader' : source === 'manual' ? 'tag' : source };
    env.session.queue.push(before);
    const phone = await stageHarness('../src/features/scan/scan.jsx', 'ScanWorkflow', env.bindings, { kind: 'checkout', data: env.data });
    assert.equal(env.options.at(-1).input, mode);
    assert.equal(phone.nodes().some(node => node.type === 'InkOrb'), mode === 'native');
    assert.equal(phone.button(mode === 'selection' ? 'NFC' : 'Select').props.disabled, true);
    assert.deepEqual(env.session.queue, [before]);
    assert.deepEqual(env.calls, []);
    phone.unmount();
  }
});

test('fresh prepared Intake remains NFC-first in browser and performs no implicit simulation', async () => {
  const env = await intakeFixture(), phone = await stageHarness('../src/features/lifecycle/intake.jsx', 'MobileIntake', env.bindings, { data: env.data });
  await continueIntake(phone);
  assert.equal(phone.button('NFC').props['aria-pressed'], true);
  assert.equal(phone.nodes().filter(node => node.type === 'InkOrb').length, 1);
  assert.match(outcomeText(phone), /NFC unavailable in browser/);
  assert.deepEqual(env.calls, []); assert.equal(env.controller.getSnapshot().draft.entries.length, 0);
  phone.unmount();
});

test('actual intake setup displays a rejected whitespace name while NFC remains the default source', async () => {
  const env=await intakeFixture({prepared:false}), phone=await stageHarness('../src/features/lifecycle/intake.jsx','MobileIntake',env.bindings,{data:env.data});
  const common=({props:phone.nodes().find(node=>node.type==='IntakePreparation').props.fields});
  assert.ok(common);common.props.onChange('name','   ');phone.render();
  const form={props:{onSubmit:event=>phone.nodes().find(node=>node.type==='IntakePreparation').props.onPrepare(event.currentTarget)}};
  await form.props.onSubmit({preventDefault(){},currentTarget:{querySelector(){return null;}}});phone.render();
  assert.equal(phone.nodes().find(node=>node.type==='IntakePreparation').props.error,'Enter a battery name.');
  assert.equal(env.controller.getSnapshot().draft.batch,null);
  assert.equal(env.controller.getSnapshot().draft.entries.length,0);assert.deepEqual(env.calls,[]);
  assert.equal(phone.nodes().find(node=>node.type==='IntakePreparation').props.fields.nameSource,'custom');
  phone.unmount();
});

test('Working NFC readiness states the device-only boundary before a read and Select still stages without committing', async()=>{
  const env=scanFixture();env.data.dataset='live';env.wf.reader={state:'ready',message:'Ready to scan · Device evidence only'};
  const phone=await stageHarness('../src/features/scan/scan.jsx','ScanWorkflow',{...env.bindings,native:true},{kind:'checkout',data:env.data});
  assert.match(outcomeText(phone),/Device evidence only/);assert.match(outcomeText(phone),/Use Select for Working transactions/);
  assert.equal(phone.button('NFC').props['aria-pressed'],true);assert.deepEqual(env.calls,[]);
  phone.button('Use Select').props.onClick();phone.render();assert.equal(phone.button('Select').props['aria-pressed'],true);
  assert.deepEqual(env.calls,[]);phone.unmount();
});

test('unprepared intake common values survive exit and reopen through its durable preparation draft and explicit reset changes no business draft',async()=>{
  const env=await intakeFixture({prepared:false});let exited=0;
  const phone=await stageHarness('../src/features/lifecycle/intake.jsx','MobileIntake',env.bindings,{data:env.data,onExit:()=>exited++});
  const fields=()=>({props:phone.nodes().find(node=>node.type==='IntakePreparation').props.fields});
  fields().props.onChange('name','Next intake batch');fields().props.onChange('model','Manually entered model');fields().props.onMode('unknown');phone.render();
  await phone.button('Exit intake').props.onClick();phone.render();assert.equal(exited,1);assert.equal(env.storage.getItem(env.controller.key),null);assert.equal(readPhoneFormDraft(env.storage,{accountId:env.data.user.id,dataset:'demo',kind:'intake-common',recordId:'common'}).data.values.name,'Next intake batch');phone.unmount();
  const reopenedController=createIntakeController({storage:env.storage,data:env.data,accountId:env.data.user.id,dataset:'demo',write:async()=>assert.fail('Presentation retention does not submit a registration.')});
  const reopened=await stageHarness('../src/features/lifecycle/intake.jsx','MobileIntake',{...env.bindings,createIntakeController:()=>reopenedController},{data:env.data});
  let common=({props:reopened.nodes().find(node=>node.type==='IntakePreparation').props.fields});assert.equal(common.props.values.name,'Next intake batch');assert.equal(common.props.values.model,'Manually entered model');assert.equal(common.props.mode,'unknown');
  assert.equal(reopenedController.getSnapshot().draft.batch,null);assert.equal(reopenedController.getSnapshot().draft.entries.length,0);
  reopened.nodes().find(node=>node.type==='IntakePreparation').props.onReset();reopened.render();common=({props:reopened.nodes().find(node=>node.type==='IntakePreparation').props.fields});assert.equal(common.props.values.name,'Battery');assert.equal(common.props.nameSource,'default');assert.equal(common.props.mode,'at_registration');assert.deepEqual(env.calls,[]);reopened.unmount();
});

test('a failed durable common-details save is visible, prevents preparing reads, and retries without registering or replacing a request',async()=>{
  let denied=true;const env=await intakeFixture({prepared:false,driverSave:async()=>{if(denied)throw new Error('Controlled draft save failure');}});
  const phone=await stageHarness('../src/features/lifecycle/intake.jsx','MobileIntake',env.bindings,{data:env.data});
  ({props:phone.nodes().find(node=>node.type==='IntakePreparation').props.fields}).props.onChange('name','Retained common name');phone.render();await new Promise(setImmediate);phone.render();
  assert.match(phone.text(),/Common details need a device save/);assert.equal((phone.nodes().find(node=>node.type==='IntakePreparation').props.disabled||phone.nodes().find(node=>node.type==='IntakePreparation').props.draft.pending||!!phone.nodes().find(node=>node.type==='IntakePreparation').props.draft.error),true);assert.equal(env.controller.getSnapshot().draft.batch,null);assert.deepEqual(env.calls,[]);
  denied=false;await phone.button('Retry common save').props.onClick();phone.render();assert.equal((phone.nodes().find(node=>node.type==='IntakePreparation').props.disabled||phone.nodes().find(node=>node.type==='IntakePreparation').props.draft.pending||!!phone.nodes().find(node=>node.type==='IntakePreparation').props.draft.error),false);
  const form={props:{onSubmit:event=>phone.nodes().find(node=>node.type==='IntakePreparation').props.onPrepare(event.currentTarget)}};await form.props.onSubmit({preventDefault(){},currentTarget:{querySelector(){return null;}}});phone.render();
  assert.equal(env.controller.getSnapshot().draft.batch.common.name,'Retained common name');assert.equal(env.controller.getSnapshot().draft.entries.length,0);assert.deepEqual(env.calls,[]);
  assert.equal(env.storage.getItem(phoneFormDraftKey({accountId:env.data.user.id,dataset:'demo',kind:'intake-common',recordId:'common'})),null);phone.unmount();
});

test('a preparation field outside the durable limits stays editable so staff can correct it without clearing staged work',async()=>{
  const env=await intakeFixture({prepared:false}),phone=await stageHarness('../src/features/lifecycle/intake.jsx','MobileIntake',env.bindings,{data:env.data});
  const fields=()=>({props:phone.nodes().find(node=>node.type==='IntakePreparation').props.fields});
  fields().props.onChange('capacityMah','1'.repeat(81));phone.render();await new Promise(setImmediate);phone.render();
  assert.equal(fields().props.disabled,false);assert.equal((phone.nodes().find(node=>node.type==='IntakePreparation').props.disabled||phone.nodes().find(node=>node.type==='IntakePreparation').props.draft.pending||!!phone.nodes().find(node=>node.type==='IntakePreparation').props.draft.error),true);assert.match(phone.text(),/Common details need a device save/);
  fields().props.onChange('capacityMah','3200');phone.render();await new Promise(setImmediate);phone.render();
  assert.equal(fields().props.values.capacityMah,'3200');assert.equal((phone.nodes().find(node=>node.type==='IntakePreparation').props.disabled||phone.nodes().find(node=>node.type==='IntakePreparation').props.draft.pending||!!phone.nodes().find(node=>node.type==='IntakePreparation').props.draft.error),false);assert.equal(env.controller.getSnapshot().draft.entries.length,0);assert.deepEqual(env.calls,[]);phone.unmount();
});

test('failed clearing after common preparation keeps the reviewed batch and resolves only its original presentation cleanup',async()=>{
  let denyClear=true;const pref=phoneFormDraftKey({accountId:'STAFF-A',dataset:'demo',kind:'intake-common',recordId:'common'});
  const env=await intakeFixture({prepared:false,driverSave:async raw=>{const entries=JSON.parse(raw).entries;if(denyClear&&Object.keys(entries).some(key=>key.startsWith('battery-intake:'))&&!Object.hasOwn(entries,pref))throw new Error('Controlled common draft clear failure');}});
  const phone=await stageHarness('../src/features/lifecycle/intake.jsx','MobileIntake',env.bindings,{data:env.data});
  ({props:phone.nodes().find(node=>node.type==='IntakePreparation').props.fields}).props.onChange('name','Reviewed retained defaults');phone.render();await new Promise(setImmediate);phone.render();
  const form={props:{onSubmit:event=>phone.nodes().find(node=>node.type==='IntakePreparation').props.onPrepare(event.currentTarget)}};await form.props.onSubmit({preventDefault(){},currentTarget:{querySelector(){return null;}}});phone.render();
  assert.equal(env.controller.getSnapshot().draft.batch.common.name,'Reviewed retained defaults');assert.match(phone.text(),/Common preparation needs recovery/);assert.deepEqual(env.calls,[]);
  denyClear=false;await phone.button('Retry common save').props.onClick();phone.render();assert.equal(env.storage.getItem(pref),null);assert.equal(env.controller.getSnapshot().draft.batch.common.name,'Reviewed retained defaults');assert.equal(env.controller.getSnapshot().draft.entries.length,0);assert.deepEqual(env.calls,[]);phone.unmount();
});

test('actual Intake reader gates preparation and overlays while its own transient save does not cancel acquisition',async()=>{
  let release, hold=false, latest;const env=await intakeFixture({prepared:false,driverSave:async()=>{if(hold)await new Promise(resolve=>{release=resolve;});}});
  const props={data:env.data},phone=await stageHarness('../src/features/lifecycle/intake.jsx','MobileIntake',{...env.bindings,native:true,useOwnedNfcReader:options=>{latest=options;return{reader:{state:'ready'},resumeReader(){},cancelReader(){}};}},props);
  assert.equal(latest.enabled,false);assert.equal(phone.nodes().find(node=>node.type==='IntakePreparation').props.fields.values.name,'Battery');
  await phone.nodes().find(node=>node.type==='IntakePreparation').props.onPrepare(null);phone.render();assert.equal(latest.enabled,true);
  phone.button('Intake feedback preferences').props.onClick();phone.render();assert.equal(latest.enabled,false);phone.event('battery-mobile-back');assert.equal(latest.enabled,true);
  phone.nodes().find(node=>node.type==='ScanOutcomeStatus').props.onOpenChange(true);phone.render();assert.equal(latest.enabled,false);phone.nodes().find(node=>node.type==='ScanOutcomeStatus').props.onOpenChange(false);phone.render();assert.equal(latest.enabled,true);
  hold=true;const pending=env.controller.select([],true);await new Promise(setImmediate);phone.render();assert.equal(env.controller.getSnapshot().busy,true);assert.equal(latest.enabled,true);release();await pending;hold=false;phone.render();
  props.user={...env.data.user,id:'OTHER'};phone.render();assert.equal(latest.enabled,false);assert.deepEqual(env.calls,[]);phone.unmount();
});

test('actual Intake adoption and staged persistence finish without replaying feedback after acquisition loses ownership',async()=>{
  const env=await intakeFixture();let latest,release,allowed=true,adoptions=0,staged=0;
  env.controller.addTag=async()=>{staged++;return new Promise(resolve=>{release=resolve;});};
  const phone=await stageHarness('../src/features/lifecycle/intake.jsx','MobileIntake',{...env.bindings,native:true,useOwnedNfcReader:options=>{latest=options;return{reader:{state:'ready'},resumeReader(){},cancelReader(){}};}},{data:env.data});
  await continueIntake(phone);
  const proposal={tagId:'nfc:uid:049F7962A62090',attemptId:crypto.randomUUID()},bridge={adopt:async()=>{adoptions++;return{tagId:proposal.tagId};}};
  const pending=latest.onRead({proposal,bridge,current:()=>allowed});await new Promise(setImmediate);assert.equal(staged,1);allowed=false;release({type:'accepted',id:proposal.tagId,name:'Staged battery'});await pending;phone.render();
  assert.equal(adoptions,1);assert.equal(phone.nodes().find(node=>node.type==='ScanOutcomeStatus').props.feedback.latest,null);
  await latest.onRead({proposal,bridge,current:()=>false});assert.equal(adoptions,1);assert.equal(staged,1);assert.deepEqual(env.calls,[]);phone.unmount();
});

test('actual simulated Intake retains one top outcome lane through accepted duplicate and failure without a growing duplicate notice',async()=>{
  const env=await intakeFixture(),phone=await stageHarness('../src/features/lifecycle/intake.jsx','MobileIntake',env.bindings,{data:env.data});
  await continueIntake(phone);
  phone.button('More input').props.onClick();phone.render();phone.button('Demo simulationExplicit simulated intake tags').props.onClick();phone.render();
  const lane=()=>phone.nodes().find(node=>node.type==='ScanOutcomeStatus'&&node.props.className==='mi-top-outcome');
  assert.ok(lane());assert.equal(phone.nodes().filter(node=>node.type==='ScanOutcomeStatus').length,1);
  async function simulate(value){phone.nodes().find(node=>node.type==='input'&&node.props.placeholder==='DEMO-INTAKE-…').props.onChange({target:{value}});phone.render();await phone.nodes().find(node=>node.type==='form').props.onSubmit({preventDefault(){}});phone.render();}
  await simulate('DEMO-INTAKE-OUTCOME-ONE');assert.equal(lane().props.feedback.outcomeType,'accepted');assert.equal(env.controller.getSnapshot().draft.entries.length,1);assert.ok(phone.button('Review queue, 1 intake draft'));
  await simulate('DEMO-INTAKE-OUTCOME-ONE');assert.equal(lane().props.feedback.outcomeType,'duplicate');assert.equal(env.controller.getSnapshot().draft.entries.length,1);
  await simulate('INVALID-TYPED-TAG');assert.equal(lane().props.feedback.outcomeType,'failure');assert.equal(lane().props.feedback.capsule,'');assert.match(lane().props.feedback.message,/demonstration intake tag/i);
  assert.equal(phone.nodes().some(node=>node.type==='p'&&['mi-notice','mi-error'].includes(node.props.className)),false);
  const top=phone.nodes().find(node=>node.props.className==='mi-stage-tools'),footer=phone.nodes().find(node=>node.props.className==='mi-stage-footer');assert.equal(nodes(top).filter(node=>node.type==='ScanOutcomeStatus').length,1);assert.equal(nodes(footer).filter(node=>node.type==='ScanOutcomeStatus').length,0);assert.deepEqual(env.calls,[]);phone.unmount();
});

test('actual Intake mode motion runs only for content changes and never replays on draft saves or reader feedback renders',async()=>{
  const env=await intakeFixture({prepared:false}),motion=[],phone=await stageHarness('../src/features/lifecycle/intake.jsx','MobileIntake',{...env.bindings,actualModeMotion:true},{data:env.data},{stageMotion:motion});
  const animated=()=>motion.filter(event=>event[0]==='animate').length;
  assert.equal(animated(),0);phone.nodes().find(node=>node.type==='IntakePreparation').props.fields.onChange('name','Controlled motion batch');phone.render();await new Promise(setImmediate);phone.render();assert.equal(animated(),0);
  await phone.nodes().find(node=>node.type==='IntakePreparation').props.onPrepare(null);phone.render();assert.equal(animated(),1);
  phone.button('More input').props.onClick();phone.render();phone.button('Demo simulationExplicit simulated intake tags').props.onClick();phone.render();assert.equal(animated(),2);
  await phone.button('Simulate next new battery').props.onClick();phone.render();assert.equal(animated(),2);phone.render();assert.equal(animated(),2);
  phone.button('Intake feedback preferences').props.onClick();phone.render();assert.equal(animated(),3);phone.button('Session details').props.onClick();phone.render();assert.equal(animated(),4);phone.event('battery-mobile-back');assert.equal(animated(),5);
  assert.ok(motion.some(event=>event[0]==='cancel'));assert.ok(motion.filter(event=>event[0]==='animate').every(event=>event[1]===180));assert.deepEqual(env.calls,[]);phone.unmount();
});

test('actual Removal feedback retains duplicate capsules through echoes and does not pulse on a saved receipt', async () => {
  const accountId = '11111111-1111-4111-8111-111111111111', requestId = '22222222-2222-4222-8222-222222222222';
  const storage = createDurableStorage({ load: async () => JSON.stringify({ schemaVersion: 1, entries: {} }), save: async () => {} }); await storage.initialize();
  const data = { dataset: 'demo', user: { id: accountId, role: 'admin' }, rooms: [], batteries: [{ id: 'BAT-001', name: 'Battery one', version: 7, tagId: null, loanId: null, lifecycleStatus: 'active', ownerAccountId: accountId }] };
  const sent = [], haptics = [], timers = [];
  let now = 1000;
  const controller = createRemovalController({ storage, accountId, dataset: 'demo', inventory: data, defaultSource: 'native_nfc', id: () => requestId, write: async (action,payload) => {
    sent.push({ action, payload });
    return { ...payload, requestId, actorAccountId: accountId, dataset: 'demo', at: '2026-10-12T05:00:00.000Z', replayed: false, items: payload.items.map(item => ({ ...item, version: item.version + 1, status: payload.kind })) };
  } });
  await controller.initialize();
  const bindings = { businessStorage: () => storage, useWorkflowLock() {}, createRemovalController: () => controller, removalEntrySource, removalDraftStorageKey, removalEligible, removalScopeMatches, acquireRemovalNative, createGuardedRemovalBridge, teachingNfcBridge: () => null, getRolePermissions: () => ({ retireBatteries: true }), formatTime: at => at, saveFile() {}, FEEDBACK_KEY, readFeedbackPreferences, scanFeedbackOutcome, expireScanFeedback, playScanFeedback: outcome => { if (['accepted','failure','duplicate'].includes(outcome.type)) haptics.push(outcome.type); }, Date: class extends Date { static now() { return now; } }, setTimeout: (run, delay) => { const timer = { run, delay, active: true }; timers.push(timer); return timer; }, clearTimeout: timer => { if (timer) timer.active = false; } };
  const phone = await stageHarness('../src/features/lifecycle/removal.jsx', 'MobileRemoval', bindings, { data });
  assert.equal(phone.button('NFC').props['aria-pressed'], true); assert.match(outcomeText(phone), /NFC unavailable in browser/); assert.equal(sent.length, 0);
  phone.button('Select').props.onClick(); await new Promise(setImmediate); phone.render();
  await phone.button('Add Battery one (BAT-001) to review').props.onClick(); phone.render();
  assert.deepEqual(haptics, ['accepted']);
  const entry = () => phone.nodes().find(node => node.props.className?.includes('removal-review-entry'));
  assert.equal(entry().props['data-feedback'], 'success');
  now = 3000; for (const timer of [...timers]) if (timer.active && timer.delay > 1000) { timer.active = false; timer.run(); } phone.render();
  assert.equal(entry().props['data-feedback'], '');
  await controller.add('BAT-001'); phone.render(); assert.match(outcomeText(phone), /already/i);
  const count = haptics.length;
  controller.setInventory(structuredClone(data)); phone.render(); assert.equal(haptics.length, count); assert.match(outcomeText(phone), /already/i);
  phone.button('Removal settings and details').props.onClick(); phone.render(); phone.event('battery-mobile-back');
  assert.match(outcomeText(phone), /already/i);
  const receipt = await controller.submit(['BAT-001']); phone.render();
  assert.ok(receipt); assert.equal(sent.length, 1); assert.equal(controller.snapshot().completed.length, 1);
  assert.equal(entry().props['data-feedback'], ''); assert.equal(haptics.length, count);
  controller.setInventory(structuredClone(data)); phone.render(); assert.equal(haptics.length, count);
  phone.unmount();
});

test('Removal manual reader recovery depends on explicit states while preserving original error words',async()=>{
  for(const readerState of ['fault','unavailable','paused','ready']){
    const storage=createDurableStorage({load:async()=>JSON.stringify({schemaVersion:1,entries:{}}),save:async()=>{}});await storage.initialize();const accountId='11111111-1111-4111-8111-111111111111',data={dataset:'demo',user:{id:accountId,role:'admin'},batteries:[],rooms:[]},controller=createRemovalController({storage,accountId,dataset:'demo',inventory:data,defaultSource:'native_nfc',write:async()=>assert.fail('Reader retry must not submit a business request')});await controller.initialize();let retries=0;
    const message='Original device diagnostic without legacy prefixes',bindings={businessStorage:()=>storage,native:true,useWorkflowLock(){},createRemovalController:()=>controller,removalEntrySource,removalDraftStorageKey,removalEligible,removalScopeMatches,getRolePermissions:()=>({retireBatteries:true}),formatTime:value=>value,saveFile(){},FEEDBACK_KEY,readFeedbackPreferences,useOwnedNfcReader:()=>({reader:{state:readerState,message,code:'TAG_LOST'},resumeReader(){retries++;},cancelReader:async()=>true})};
    const phone=await stageHarness('../src/features/lifecycle/removal.jsx','MobileRemoval',bindings,{data}),retry=phone.nodes().find(node=>node.type==='button'&&text(node)==='Check reader again');assert.equal(!!retry,readerState!=='ready');assert.equal(phone.nodes().find(node=>node.type==='ScanOutcomeStatus').props.reader.message,message);if(retry){assert.equal(retry.props.disabled,false);retry.props.onClick();assert.equal(retries,1);}phone.unmount();
  }
});

for(const overlay of ['message','Review','settings','More input'])test(`Removal ${overlay} suppresses late native persistence feedback and does not replay it on close`,async()=>{
  let releaseSave,enteredSave,hold=false,current=true,readerOptions;const entered=new Promise(resolve=>{enteredSave=resolve;}),gate=new Promise(resolve=>{releaseSave=resolve;}),haptics=[];
  const storage=createDurableStorage({load:async()=>JSON.stringify({schemaVersion:1,entries:{}}),save:async()=>{if(hold){enteredSave();await gate;}}});await storage.initialize();
  const accountId='11111111-1111-4111-8111-111111111111',tagId='nfc:uid:00010203',battery={id:'BAT-001',name:'Battery one',version:4,tagId,loanId:null,lifecycleStatus:'active',ownerAccountId:accountId},data={dataset:'demo',user:{id:accountId,role:'admin'},batteries:[battery],rooms:[]};
  const controller=createRemovalController({storage,accountId,dataset:'demo',inventory:data,defaultSource:'native_nfc',write:async(action,payload)=>{assert.equal(action,'scan_lookup');assert.equal(payload.source,'native_nfc');return{source:'native_nfc',results:[{tagId,battery}]};}});await controller.initialize();
  const bindings={businessStorage:()=>storage,native:true,useWorkflowLock(){},createRemovalController:()=>controller,removalEntrySource,removalDraftStorageKey,removalEligible,removalScopeMatches,getRolePermissions:()=>({retireBatteries:true}),formatTime:value=>value,saveFile(){},FEEDBACK_KEY,readFeedbackPreferences,playScanFeedback:outcome=>haptics.push(outcome.type),useOwnedNfcReader:options=>{readerOptions=options;return{reader:{state:'ready',message:'Ready to scan'},resumeReader(){current=true;},cancelReader(){current=false;return Promise.resolve(true);}};}};
  const phone=await stageHarness('../src/features/lifecycle/removal.jsx','MobileRemoval',bindings,{data});await new Promise(setImmediate);phone.render();hold=true;
  const proposal={attemptId:'00000000-0000-4000-8000-000000000001',source:'native-nfc-reader',platform:'android',startedAt:'2026-10-13T00:00:00.000Z',endedAt:'2026-10-13T00:00:01.000Z',adoptedAt:'2026-10-13T00:00:02.000Z',tagId,result:{uidHex:'00010203',technology:'NfcA',ndefStatus:'notSupported',capacityBytes:null,records:[],observedAt:'2026-10-13T00:00:01.000Z'}};
  const processing=readerOptions.onRead({proposal,bridge:{adopt:async()=>proposal},current:()=>current});await entered;phone.render();
  if(overlay==='message')phone.nodes().find(node=>node.type==='ScanOutcomeStatus').props.onOpenChange(true);else if(overlay==='Review')phone.nodes().find(node=>node.props.className?.includes('removal-review-entry')).props.onClick();else if(overlay==='settings')phone.button('Removal settings and details').props.onClick();else phone.button('More input').props.onClick();phone.render();assert.equal(readerOptions.enabled,false);
  releaseSave();await processing;phone.render();assert.equal(controller.snapshot().draft.items.length,1,'the original local persistence may finish');assert.deepEqual(haptics,[]);
  if(overlay==='message')phone.nodes().find(node=>node.type==='ScanOutcomeStatus').props.onOpenChange(false);else if(overlay==='Review')phone.button('Close removal review and retain queue').props.onClick();else if(overlay==='settings')phone.button('Done').props.onClick();else phone.button('More input').props.onClick();phone.render();assert.deepEqual(haptics,[],'closing never replays the consumed sequence');assert.equal(controller.snapshot().draft.source,'native_nfc');phone.unmount();
});

test('actual Removal recovery precedes fields and all rows while retry preserves the exact captured subset', async () => {
  const accountId = '11111111-1111-4111-8111-111111111111', requestId = '22222222-2222-4222-8222-222222222222';
  const storage = createDurableStorage({ load: async () => JSON.stringify({ schemaVersion: 1, entries: {} }), save: async () => {} }); await storage.initialize();
  const data = { dataset: 'demo', user: { id: accountId, role: 'admin' }, rooms: [], batteries: Array.from({ length: 6 }, (_, index) => ({ id: `BAT-${index + 1}`, name: 'Long reviewed removal identity '.repeat(3), version: 7, tagId: null, loanId: null, lifecycleStatus: 'active', ownerAccountId: accountId })) };
  const sent = [], diagnostic = 'Controlled USB reply drop for original removal';
  const controller = createRemovalController({ storage, accountId, dataset: 'demo', inventory: data, initialIds: data.batteries.map(battery => battery.id), id: () => requestId, write: async (action, payload) => { sent.push(structuredClone(payload)); throw new Error(diagnostic); } });
  await controller.initialize(); await controller.submit(['BAT-1']);
  const original = structuredClone(controller.snapshot().attempt); assert.ok(original);
  const bindings = { businessStorage: () => storage, useWorkflowLock() {}, createRemovalController: () => controller, removalEntrySource, removalDraftStorageKey, removalEligible, removalScopeMatches, acquireRemovalNative, createGuardedRemovalBridge, teachingNfcBridge: () => null, getRolePermissions: () => ({ retireBatteries: true }), formatTime: at => at, saveFile() {}, FEEDBACK_KEY, readFeedbackPreferences, scanFeedbackOutcome, expireScanFeedback, playScanFeedback() {} };
  const phone = await stageHarness('../src/features/lifecycle/removal.jsx', 'MobileRemoval', bindings, { data });
  phone.nodes().find(node => node.props.className?.includes('removal-review-entry')).props.onClick(); phone.render();
  const body = phone.nodes().find(node => node.props.className === 'scan-review-scroll'), order = nodes(body), retry = phone.button('Check original request');
  assert.ok(order.indexOf(retry) < order.findIndex(node => node.props.className === 'removal-review-fields'));
  assert.ok(order.indexOf(retry) < order.findIndex(node => node.props.className === 'scan-review-row'));
  const details = order.find(node => node.type === 'details' && text(node).startsWith('Request details'));
  assert.match(text(details), /Controlled USB reply drop/);
  assert.equal(order.some(node => node.props.className === 'removal-error'), false);
  await retry.props.onClick(); phone.render();
  assert.equal(sent.length, 2); assert.deepEqual(sent[0], sent[1]);
  assert.deepEqual(controller.snapshot().attempt, original); assert.equal(controller.snapshot().draft.items.length, 6);
  phone.unmount();
});
