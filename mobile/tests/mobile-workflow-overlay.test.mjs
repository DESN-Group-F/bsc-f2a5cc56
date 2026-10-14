import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import * as interaction from '../src/app/phone-interaction.mjs';
import { acquisitionOf } from '../src/features/scan/scan-controller.mjs';
import { scanInputMode } from '../src/features/scan/input-mode.mjs';
import { FEEDBACK_KEY, readFeedbackPreferences, scanFeedbackOutcome, expireScanFeedback } from '../src/features/scan/feedback.mjs';
import { intakeDefaultValues, intakeEntrySource, intakeError, intakeStringFields, reviewedIntakeCommon } from '../src/features/lifecycle/intake-controller.mjs';
import { normalizedIntakePreparation, changedIntakePreparation, applyIntakePreparationModel } from '../src/features/lifecycle/intake-preparation.mjs';
import { removalEntrySource } from '../src/features/scan/input-mode.mjs';
import { removalDraftStorageKey } from '../src/shared/lib/removal-draft.js';
import { acquireRemovalNative, createGuardedRemovalBridge, removalEligible, removalScopeMatches } from '../src/features/lifecycle/removal-controller.mjs';
import { temporalFormats, temporalInputMessage, toCalendarDate } from '../src/shared/lib/temporal-input.js';
import { emptyScanCandidates, projectScanCandidates, filterScanCandidates } from '../src/features/scan/scan-candidates.mjs';
import { prioritizeInventoryHandoff } from '../src/features/inventory/selection-focus.mjs';

// Run the current Scan JSX, its real action hook, the FloatingWorkflow boundary
// and the shell's current dialog classification callback. DOM, React commits
// and controller transport are controlled; this is not native NFC acceptance.
const jsx = (type, props) => typeof type === 'function' && type.name === 'PhoneWorkflowPortal' ? type(props) : ({ type, props: props || {} });
const flatten = (node, result = []) => {
  if (Array.isArray(node)) node.forEach(child => flatten(child, result));
  else if (node && typeof node === 'object') { result.push(node); flatten(node.props?.children, result); }
  return result;
};
const words = node => node == null || typeof node === 'boolean' ? '' : typeof node !== 'object' ? String(node) : Array.isArray(node) ? node.map(words).join('') : words(node.props?.children);
class KeyboardEventStub extends Event { constructor(type, options = {}) { super(type, options); this.key = options.key; } }

async function compile(file, name, bindings) {
  const source = await readFile(new URL(file, import.meta.url), 'utf8');
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.JSX);
  const resolved = { ...bindings }, names = new Set(Object.keys(bindings));
  for (const item of parsed.statements.filter(ts.isImportDeclaration)) {
    if (item.importClause?.name) names.add(item.importClause.name.text);
    for (const value of item.importClause?.namedBindings?.elements || []) {
      names.add(value.name.text);
      if (value.propertyName && bindings[value.propertyName.text]) resolved[value.name.text] = bindings[value.propertyName.text];
    }
  }
  const code = ts.transpileModule(parsed.statements.filter(item => !ts.isImportDeclaration(item)).map(item => item.getFullText(parsed)).join('\n'), { fileName: file, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } }).outputText.replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
  const keys = [...names];
  return new Function(...keys, '_jsx', '_jsxs', '_Fragment', `${code}\nreturn ${name};`)(...keys.map(key => resolved[key] ?? key), jsx, jsx, 'fragment');
}

function hooks() {
  const cells = [], pending = []; let cursor = 0, dirty = false;
  const effect = (callback, deps) => {
    const index = cursor++, old = cells[index];
    if (!old || !deps || deps.length !== old.deps?.length || deps.some((value, i) => !Object.is(value, old.deps[i]))) {
      cells[index] = { deps, cleanup: old?.cleanup };
      pending.push(() => { cells[index].cleanup?.(); cells[index].cleanup = callback(); });
    }
  };
  return {
    useState(initial) { const index = cursor++; cells[index] ??= { value: typeof initial === 'function' ? initial() : initial }; return [cells[index].value, next => { const value = typeof next === 'function' ? next(cells[index].value) : next; if (!Object.is(value, cells[index].value)) { cells[index].value = value; dirty = true; } }]; },
    useRef(initial) { return cells[cursor++] ??= { current: initial }; },
    useMemo(factory, deps) { const index = cursor++; if (!cells[index] || !deps || deps.length !== cells[index].deps?.length || deps.some((value, i) => !Object.is(value, cells[index].deps[i]))) cells[index] = { deps, value: factory() }; return cells[index].value; },
    useEffect: effect, useLayoutEffect: effect,
    reset() { cursor = 0; dirty = false; },
    commit() { while (pending.length) pending.shift()(); return dirty; },
    unmount() { cells.forEach(cell => cell?.cleanup?.()); },
  };
}

function domNode(props = {}, parentElement = null) {
  const classes = new Set(String(props.className || '').split(/\s+/));
  const events = new EventTarget();
  const node = {
    props, parentElement, tagName: props.tagName || 'DIV', children: [], inert: props.inert === true, isConnected: true, scrollTop: 0,
    ownerDocument: parentElement?.ownerDocument || null, disabled: props.disabled === true,
    get id() { return node.props.id || ''; },
    classList: { contains: value => classes.has(value) },
    getAttribute: key => key === 'class' ? node.props.className || '' : node.props[key] == null ? null : String(node.props[key]),
    hasAttribute: key => node.props[key] != null,
    addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events), dispatchEvent: events.dispatchEvent.bind(events),
    getClientRects: () => [{}],
    closest(selector) {
      for (let current = node; current; current = current.parentElement) {
        if (selector === '[hidden],[inert]' && (current.props.hidden || current.inert)) return current;
        if (selector.startsWith('.') && current.classList.contains(selector.slice(1))) return current;
        if (selector.startsWith('[') && selector.endsWith(']') && current.hasAttribute(selector.slice(1, -1))) return current;
      }
      return null;
    },
    matches: () => false, focus() {}, querySelector: () => ({ focus() {} }), querySelectorAll: () => [], contains: () => true,
  };
  parentElement?.children.push(node); return node;
}

async function mount(t, kind = 'scan') {
  const stageHooks = hooks(), floatingHooks = hooks(), listeners = new Map(), timers = new Set(), calls = [], configurations = [];
  const readerControl = { pause: async () => true };
  const owner = 'controlled-workflow-1', workflow = { kind: kind === 'scan' ? 'checkout' : kind, nonce: owner }, context = { active: true, workflowOwner: owner };
  const user = { id: 'STAFF-A', role: 'staff', displayName: 'Staff A' }, battery = { id: 'BAT-001', name: 'Teaching battery', version: 4, tagId: null, loanId: null, lifecycleStatus: 'active' };
  const data = { dataset: 'demo', user, batteries: [battery], rooms: [], people: [{ id: 'OWNER-A', accountId: user.id, role: 'staff', name: 'Staff A' }], staffDirectory: [{ id: user.id, active: true }], buildings: [{ id: 'J18' }] }, session = { queue: [], completed: [], issues: [], attempt: null, room: null };
  const intakeCommon = { ...intakeDefaultValues(data, user.id), name: 'Prepared teaching battery', capacityMah: null, voltage: null };
  const draft = kind === 'intake' ? { actorAccountId: user.id, dataset: 'demo', batch: { common: intakeCommon, firstUseMode: 'at_registration', source: 'simulated' }, entries: [{ id: 'INTAKE-1', tagId: 'CONTROLLED-TAG', common: intakeCommon, selected: true, firstUseMode: 'at_registration', source: 'simulated' }], attempt: null, completed: [] } : { actorAccountId: user.id, dataset: 'demo', items: [{ batteryId: battery.id, name: battery.name, version: battery.version, tagId: null }], selectedIds: [battery.id], source: 'manual_selection', kind: 'scrapped', reason: '', attempt: null };
  const state = { session, draft, attempt: null, completed: [], staleIds: [], blocked: false, busy: false, storageError: '' }, subscribers = new Set();
  const storage = { getItem: () => null, setItem() {}, flush: async () => {}, exportRaw: () => JSON.stringify({ originalAttempt: session.attempt || draft.attempt || state.attempt }), subscribe: () => () => {} };
  const notify = () => subscribers.forEach(callback => callback({ ...state }));
  const controller = {
    getSnapshot: () => ({ ...state }), updateInventory() {}, subscribe(callback) { subscribers.add(callback); return () => subscribers.delete(callback); },
    canExit: () => !session.attempt, needsExitConfirmation: () => session.queue.length > 0 || session.issues.some(issue => !issue.acknowledged),
    async exit() { calls.push({action:'exit'}); return true; },
    async addSelections(ids) { calls.push({ action: 'stage', ids }); session.queue = ids.map(id => ({ battery, source: 'selection', acquisition: 'selection', tagId: null })); notify(); return session.queue; },
    async confirmQueue() { calls.push({ action: 'confirm' }); return { type: 'confirmed' }; },
    async clearQueue() { calls.push({ action: 'clear' }); session.queue = []; notify(); return true; },
    async retry() { calls.push({ action: 'retry', payload: structuredClone(session.attempt.payload) }); return null; },
    async retryStorage() { calls.push({ action: 'storage' }); return true; },
  };
  if (kind !== 'scan') Object.assign(controller, {
    snapshot: controller.getSnapshot, initialize: async () => {}, setInventory() {}, pause() {},
    async confirm(ids) { calls.push({ action: 'confirm', ids }); return []; },
    async submit(ids) { calls.push({ action: 'confirm', ids }); return null; },
    async retry() { calls.push({ action: 'retry', payload: structuredClone((draft.attempt || state.attempt).payload) }); return null; },
  });
  const body = domNode(), layer = domNode({ className: 'phone-app phone-workflow-layer' }, body);
  let portalNodes = [], domNodes = [], foreign = [], linkedTriggers = [], externalLocked = false, portalLocked = false, stageTree, floatingTree;
  const listen = (type, callback) => { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(callback); };
  const unlisten = (type, callback) => listeners.get(type)?.delete(callback);
  const document = { body, visibilityState: 'visible', activeElement: null, defaultView: { getComputedStyle: node => ({ visibility: node.props.visibility || 'visible' }) }, addEventListener: listen, removeEventListener: unlisten, querySelector: () => layer,
    querySelectorAll(selector) {
      if (selector.includes('aria-controls')) return [...domNodes, ...linkedTriggers].filter(node => node.getAttribute('aria-controls') !== null && node.getAttribute('aria-expanded') === 'true');
      return [...portalNodes, ...foreign].filter(node => node.props.role === 'dialog' || node.props.role === 'alertdialog');
    },
  };
  body.ownerDocument = document; layer.ownerDocument = document;
  const window = { addEventListener: listen, removeEventListener: unlisten };
  const timing = { setTimeout(callback, delay) { const timer = { callback, delay }; timers.add(timer); return timer; }, clearTimeout(timer) { timers.delete(timer); } };
  const rawPortal = (element, target) => ({ type: 'portal', props: { children: element, target } });
  const common = { document, window, ...timing, React: { Fragment: 'fragment', cloneElement: (element, props) => ({ ...element, props: { ...element.props, ...props } }) }, native: false, businessStorage: () => storage, usePhoneContext: () => context, usePhoneBack() {}, usePhonePress: () => ({}), useWorkflowLock() {}, createPortal: rawPortal, reactPortal: rawPortal, Pressable: 'button', InkOrb: 'InkOrb', FEEDBACK_KEY, acquisitionOf, scanInputMode, emptyScanCandidates, projectScanCandidates, filterScanCandidates, readFeedbackPreferences, scanFeedbackOutcome, expireScanFeedback, playScanFeedback() {}, teachingNfcBridge: () => null, scanSourceLabel: () => 'Manual selection', isActiveBattery: () => true, scanScopeMatches: () => true, isSelectableRoom: () => true, createScanController: () => controller,
    createIntakeController: () => controller, intakeDefaultValues, intakeEntrySource, intakeError, intakeStringFields, reviewedIntakeCommon, normalizedIntakePreparation, changedIntakePreparation, applyIntakePreparationModel, prioritizeInventoryHandoff, CommonFields:'CommonFields', IntakePreparation:'IntakePreparation', PhoneChoice:'PhoneChoice', ScanOutcomeStatus:'ScanOutcomeStatus', NfcScanControl:'NfcScanControl', useScanModeMotion(){}, useOwnedNfcReader:()=>({reader:{state:'unavailable',message:'Native NFC unavailable in browser'},resumeReader(){},cancelReader(...args){return readerControl.pause(...args);}}), modelCreateStorageKey: () => 'model:none', currentSydneyDate: () => '2026-10-12', modelApplication: old => old, getRolePermissions: () => ({ retireBatteries: true }),
    createRemovalController: () => controller, removalEntrySource, removalDraftStorageKey, acquireRemovalNative, createGuardedRemovalBridge, removalEligible, removalScopeMatches, formatTime: value => value, async saveFile(file) { calls.push({ action: 'export', filename: file.filename, content: await file.blob.text() }); },
    usePhoneFormDraft({ initial }) { const [value, setValue] = stageHooks.useState(initial); return { value, setValue, pending: false, clearing: false, error: '', save: async () => value, clear: async () => {}, retry: async () => {} }; },
  };
  const ownedPortal = await compile('../src/app/phone-ui.jsx', 'createPhoneWorkflowPortal', { ...common, createContext: () => ({}), useContext: () => context });
  common.createPhoneWorkflowPortal = ownedPortal;
  common.usePhoneOverlayDismiss = await compile('../src/app/phone-ui.jsx', 'usePhoneOverlayDismiss', { ...common, ...stageHooks, createContext: () => ({}), useContext: () => context });
  common.useScanFeedback = await compile('../src/features/scan/use-scan-feedback.js', 'useScanFeedback', { ...common, ...stageHooks });
  const actualHook = await compile('../src/features/scan/use-scan-workflow.js', 'useScanWorkflow', { ...common, ...stageHooks });
  const files = { scan: ['../src/features/scan/scan.jsx', 'ScanWorkflow'], intake: ['../src/features/lifecycle/intake.jsx', 'MobileIntake'], removal: ['../src/features/lifecycle/removal.jsx', 'MobileRemoval'] };
  const [file, name] = files[kind], Component = await compile(file, name, { ...common, ...stageHooks, useScanWorkflow(config) { configurations.push(config); return actualHook(config); } });
  const FloatingWorkflow = await compile('../src/app/floating-workflow.jsx', 'FloatingWorkflow', { ...common, ...floatingHooks, PhoneUIBoundary: 'PhoneUIBoundary', restorePhoneFocus: interaction.restorePhoneFocus });

  // Obtain and execute the callback used by the production MutationObserver.
  const shellSource = await readFile(new URL('../src/app/phone-app.jsx', import.meta.url), 'utf8');
  const shellAST = ts.createSourceFile('phone-app.jsx', shellSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
  let initializer;
  const visit = node => { if (ts.isVariableDeclaration(node) && node.name.getText(shellAST) === 'readDialogs') initializer = node.initializer.getText(shellAST); ts.forEachChild(node, visit); }; visit(shellAST);
  assert.ok(initializer, 'The production shell owns its dialog observer callback.');
  const policy = { ...interaction, document, workflow, owner, workflowOwner: owner, datasetPickerOwner:'dataset-picker:controlled', setDatasetOtherPortalLocked(){}, floating: true, live: { current: { workflow } }, setPortalLocked: value => { portalLocked = value; }, setExternalPortalLocked: value => { externalLocked = value; } };
  const keys = Object.keys(policy), readDialogs = new Function(...keys, `return (${initializer});`)(...keys.map(key => policy[key]));

  function composeDOM(tree, parent = layer) {
    if (Array.isArray(tree)) { tree.forEach(child => composeDOM(child, parent)); return; }
    if (!tree || typeof tree !== 'object') return;
    if (tree.type === 'portal') { composeDOM(tree.props.children, body); return; }
    const fresh = domNode({ ...tree.props, tagName: String(tree.type).toUpperCase() }, parent);
    const element = tree.props.ref?.current ? Object.assign(tree.props.ref.current, { props: fresh.props, parentElement: parent, inert: fresh.inert }) : fresh;
    domNodes.push(element);
    if (parent === body || parent !== layer && portalNodes.includes(parent)) portalNodes.push(element);
    if (tree.props.ref) tree.props.ref.current = element;
    composeDOM(tree.props.children, element);
  }
  function render() {
    for (let pass = 0; pass < 20; pass++) {
      const before = context.active;
      stageHooks.reset(); stageTree = Component({ kind: 'checkout', data, user, dataset: 'demo', onExit: () => calls.push({action:'closed'}) });
      portalNodes = []; domNodes = []; composeDOM(stageTree); const stageDirty = stageHooks.commit(); readDialogs();
      floatingHooks.reset(); floatingTree = FloatingWorkflow({ open: true, label: 'Check out', owner, workflowOwner: owner, inactive: externalLocked, reducedMotion: false, children: stageTree });
      floatingTree.props.children.props.ref.current = layer;
      layer.props['data-phone-workflow-owner'] = floatingTree.props.children.props['data-phone-workflow-owner'];
      const boundary = flatten(floatingTree).find(node => node.type === 'PhoneUIBoundary');
      context.active = boundary.props.active; context.workflowOwner = boundary.props.workflowOwner;
      const floatingDirty = floatingHooks.commit();
      if (!stageDirty && !floatingDirty && context.active === before) return;
    }
    assert.fail('The actual station and ownership boundary must settle.');
  }
  const view = {
    calls, session, draft, configurations, context, controller, state, render, readerControl,
    get externalLocked() { return externalLocked; }, get portalLocked() { return portalLocked; },
    portals: () => portalNodes,
    button(label) { const button = flatten(stageTree).find(node => node.type === 'button' && (node.props['aria-label'] === label || words(node) === label)); assert.ok(button, `Actual rendered button: ${label}`); return button; },
    async click(label) { const button = view.button(label); assert.notEqual(button.props.disabled, true, `${label} is enabled.`); await button.props.onClick(); render(); },
    async review() { const trigger = flatten(stageTree).find(node => node.type === 'button' && (node.props['aria-label']?.startsWith('Review queue,') || node.props.className?.includes('removal-review-entry'))); assert.ok(trigger); await trigger.props.onClick(); render(); },
    hasReview: () => flatten(stageTree).some(node => node.props.role === 'dialog'),
    hasEditor: () => flatten(stageTree).some(node => node.props.className === 'mi-editor'),
    async stage() { await view.click('Select'); const checkbox = flatten(stageTree).find(node => node.type === 'input' && node.props.type === 'checkbox'); checkbox.props.onChange({ target: { checked: true } }); render(); await view.click('Add to review (1)'); },
    setForeign(props = { role: 'dialog', className: 'foreign-dialog' }) { foreign = [domNode(props, body)]; render(); },
    clearForeign() { foreign = []; render(); },
    linkedCalendar(open) {
      const id = 'radix:controlled-calendar';
      linkedTriggers = open ? [domNode({ tagName: 'BUTTON', 'aria-expanded': 'true', 'aria-controls': id }, layer)] : [];
      foreign = open ? [domNode({ role: 'dialog', id }, body)] : []; render();
    },
    dismiss() { document.activeElement = body; const top = interaction.topPhoneOverlay(document, () => ({ zIndex: '0' })); assert.ok(top); interaction.dismissPhoneOverlay(top, { KeyboardEvent: KeyboardEventStub }); render(); },
    storageFailure() { state.storageError = 'Controlled durable save failure'; notify(); render(); },
    setBusy(value) { state.busy = value; notify(); render(); },
    protect(payload) { const attempt = { status: 'uncertain', payload, reads: [...session.queue], message: 'Controlled unknown result' }; session.attempt = attempt; if (kind === 'intake') draft.attempt = attempt; else if (kind === 'removal') state.attempt = attempt; state.blocked = true; notify(); render(); },
  };
  t.after(() => { stageHooks.unmount(); floatingHooks.unmount(); }); render(); return view;
}

test('leaving a rejected tag keeps acquisition paused through cancellation and durable exit', async t => {
  const view = await mount(t);
  view.session.issues.push({id:'retired-tag',acknowledged:false,message:'This battery is retired.'});
  await view.click('Exit scanning');
  assert.equal(view.configurations.at(-1).reviewOpen,true);
  let releaseCancel, releaseSave;
  view.readerControl.pause = () => new Promise(resolve => { releaseCancel = resolve; });
  view.controller.exit = async () => { view.calls.push({action:'exit'}); await new Promise(resolve => { releaseSave = resolve; }); return true; };
  const confirm = view.portals().find(node => node.tagName === 'BUTTON' && words({props:node.props}) === 'Exit scanning');
  const closing = confirm.props.onClick(); view.render();
  assert.equal(view.configurations.at(-1).reviewOpen,true,'Closing the confirmation must not re-admit the NFC reader.');
  assert.equal(view.button('Keep working').props.disabled,true);
  releaseCancel(true); await new Promise(resolve => setImmediate(resolve)); view.render();
  assert.equal(view.configurations.at(-1).reviewOpen,true,'Durable cleanup must finish before releasing the station.');
  assert.equal(view.calls.filter(call => call.action === 'closed').length,0);
  releaseSave(); await closing; view.render();
  assert.equal(view.calls.filter(call => call.action === 'exit').length,1);
  assert.equal(view.calls.filter(call => call.action === 'closed').length,1);
  assert.equal(view.configurations.at(-1).reviewOpen,true,'The retained exit-animation subtree cannot start another read.');
});

test('a failed scan departure retains its confirmation and allows an explicit retry without rearming', async t => {
  const view=await mount(t);view.session.issues.push({id:'retired-tag',acknowledged:false});await view.click('Exit scanning');
  view.readerControl.pause=async()=>false;
  const confirm=()=>view.portals().find(node=>node.tagName==='BUTTON'&&words({props:node.props})==='Exit scanning');
  await confirm().props.onClick();view.render();
  assert.equal(view.configurations.at(-1).reviewOpen,true);
  assert.equal(view.button('Keep working').props.disabled,false);
  assert.equal(view.calls.filter(call=>call.action==='closed').length,0);
  view.readerControl.pause=async()=>true;await confirm().props.onClick();view.render();
  assert.equal(view.calls.filter(call=>call.action==='closed').length,1);
});

test('actual own Scan Review remains actionable through its floating context while acquisition is paused', async t => {
  const view = await mount(t); await view.stage(); await view.click('Review queue, 1 battery');
  assert.equal(view.portalLocked, true); assert.equal(view.externalLocked, false); assert.equal(view.context.active, true);
  assert.equal(view.configurations.at(-1).reviewOpen, true);
  await view.click('Check out (1)'); assert.equal(view.calls.filter(call => call.action === 'confirm').length, 1);
  assert.equal(view.session.queue.length, 1);
});

test('actual own confirmation can clear only the unsubmitted queue through the inherited action context', async t => {
  const view = await mount(t); await view.stage(); await view.click('Review queue, 1 battery'); await view.click('Clear queue');
  assert.equal(view.externalLocked, false); assert.equal(view.context.active, true);
  const confirm = view.portals().find(node => node.props.role === 'alertdialog'); assert.ok(confirm);
  const actualButtons = view.portals().filter(node => node.tagName === 'BUTTON' && !node.closest('[hidden],[inert]') && words({ props: node.props }) === 'Clear queue');
  assert.equal(actualButtons.length, 1); await actualButtons[0].props.onClick(); view.render();
  assert.equal(view.calls.filter(call => call.action === 'clear').length, 1); assert.equal(view.session.queue.length, 0);
  assert.equal(view.calls.filter(call => call.action === 'confirm').length, 0);
});

test('foreign modal suppresses a stale Review action, then original-request recovery resumes without a replacement write', async t => {
  const view = await mount(t); await view.stage(); await view.click('Review queue, 1 battery');
  const original = { requestId: 'controlled-original-request', kind: 'checkout', actorAccountId: 'STAFF-A', items: [{ batteryId: 'BAT-001', expectedBatteryVersion: 4, expectedTagId: null }] };
  view.protect(original); const retry = view.button('Check original request');
  view.setForeign(); assert.equal(view.externalLocked, true); assert.equal(view.context.active, false);
  await retry.props.onClick(); assert.equal(view.calls.filter(call => call.action === 'retry').length, 0); assert.deepEqual(view.session.attempt.payload, original);
  view.clearForeign(); assert.equal(view.context.active, true); await view.click('Check original request');
  assert.deepEqual(view.calls.filter(call => call.action === 'retry'), [{ action: 'retry', payload: original }]);
  view.storageFailure(); await view.click('Export preserved data');
  assert.ok(view.calls.find(call => call.action === 'export').content.includes(original.requestId));
  assert.equal(view.calls.filter(call => call.action === 'confirm').length, 0); assert.deepEqual(view.session.attempt.payload, original);
});

for (const kind of ['intake', 'removal']) {
  test(`${kind}: actual owned Review confirms once and remains usable for exact original retry and export`, async t => {
    const view = await mount(t, kind); await view.review();
    assert.equal(view.externalLocked, false); assert.equal(view.context.active, true);
    const confirmLabel = kind === 'intake' ? 'Register selected (1)' : 'Confirm selected (1)';
    await view.click(confirmLabel);
    assert.deepEqual(view.calls.filter(call => call.action === 'confirm'), [{ action: 'confirm', ids: [kind === 'intake' ? 'INTAKE-1' : 'BAT-001'] }]);
    const original = { requestId: `${kind}-original-request`, actorAccountId: 'STAFF-A', items: [{ batteryId: 'BAT-001', version: 4, tagId: null }] };
    view.protect(original); const retry = view.button('Check original request');
    view.setForeign({ role: 'dialog', className: 'scan-portal-root', 'data-phone-workflow-owner': 'older-workflow' });
    assert.equal(view.externalLocked, true); assert.equal(view.context.active, false);
    await retry.props.onClick(); assert.equal(view.calls.filter(call => call.action === 'retry').length, 0);
    view.clearForeign(); assert.equal(view.context.active, true); await view.click('Check original request');
    assert.deepEqual(view.calls.filter(call => call.action === 'retry'), [{ action: 'retry', payload: original }]);
    if (kind === 'intake') view.storageFailure();
    await view.click(kind === 'intake' ? 'Export preserved data' : 'Export recovery data');
    const exported = view.calls.find(call => call.action === 'export'); assert.ok(exported); assert.ok(exported.content.includes(original.requestId));
    assert.equal(view.calls.filter(call => call.action === 'confirm').length, 1);
    assert.deepEqual((kind === 'intake' ? view.draft.attempt : view.state.attempt).payload, original);
  });
}

for (const kind of ['scan', 'intake', 'removal']) {
  test(`${kind}: body-focused system dismissal honors busy and retained-request guards before closing idle Review`, async t => {
    const view = await mount(t, kind); if (kind === 'scan') await view.stage(); await view.review();
    assert.equal(view.hasReview(), true); view.setBusy(true); view.dismiss(); assert.equal(view.hasReview(), true);
    view.setBusy(false); view.dismiss(); assert.equal(view.hasReview(), false);
    await view.review(); view.protect({ requestId: `${kind}-protected`, items: [{ batteryId: 'BAT-001' }] });
    view.dismiss(); assert.equal(view.hasReview(), true); assert.equal(view.calls.filter(call => call.action === 'confirm' || call.action === 'retry').length, 0);
  });
}

test('Intake body-focused dismissal first closes its draft editor and retains its Review queue', async t => {
  const view = await mount(t, 'intake'); await view.review(); await view.click('Edit CONTROLLED-TAG');
  assert.equal(view.hasEditor(), true); view.dismiss(); assert.equal(view.hasEditor(), false); assert.equal(view.hasReview(), true);
  assert.equal(view.draft.entries.length, 1); assert.equal(view.calls.filter(call => call.action === 'confirm').length, 0);
  view.dismiss(); assert.equal(view.hasReview(), false);
});

test('overlay ownership is tied to the exact current station and never inferred from visual classes', () => {
  const body = domNode(), ownedRoot = domNode({ className: 'phone-app scan-portal-root', 'data-phone-workflow-owner': 'station-current' }, body);
  const ownReview = domNode({ role: 'dialog' }, ownedRoot), foreign = domNode({ role: 'dialog', className: 'scan-portal-root' }, body);
  const staleRoot = domNode({ className: 'phone-app scan-portal-root', 'data-phone-workflow-owner': 'station-old' }, body), stale = domNode({ role: 'alertdialog' }, staleRoot);
  assert.equal(interaction.phoneWorkflowOwnsOverlay(ownReview, 'station-current'), true);
  assert.equal(interaction.phoneWorkflowOwnsOverlay(foreign, 'station-current'), false);
  assert.equal(interaction.phoneWorkflowOwnsOverlay(stale, 'station-current'), false);
  assert.equal(interaction.phoneWorkflowOwnsOverlay(ownReview, undefined), false);
});

test('shared dismissal hook receives node Back after body focus and unregisters on inactive ownership', async () => {
  const runtime = hooks(), context = { active: true }, node = domNode({ role: 'dialog' }), ref = { current: node };
  const guards = { busy: true, attempt: false, editing: true }, decisions = [];
  const close = () => { if (guards.busy || guards.attempt) decisions.push('protected'); else if (guards.editing) { guards.editing = false; decisions.push('editor'); } else decisions.push('close'); };
  const actualHook = await compile('../src/app/phone-ui.jsx', 'usePhoneOverlayDismiss', { ...runtime, React: {}, createContext: () => ({}), useContext: () => context });
  const render = () => { runtime.reset(); actualHook(ref, close, { enabled: true }); runtime.commit(); };
  let fallbackKeys = 0; node.addEventListener('keydown', () => fallbackKeys++);
  try {
    render(); interaction.dismissPhoneOverlay(node, { KeyboardEvent: KeyboardEventStub }); assert.deepEqual(decisions, ['protected']); assert.equal(fallbackKeys, 0);
    guards.busy = false; interaction.dismissPhoneOverlay(node, { KeyboardEvent: KeyboardEventStub }); assert.deepEqual(decisions, ['protected', 'editor']);
    interaction.dismissPhoneOverlay(node, { KeyboardEvent: KeyboardEventStub }); assert.deepEqual(decisions, ['protected', 'editor', 'close']);
    context.active = false; render(); const hiddenDismiss = new Event('battery-mobile-dismiss', { cancelable: true }); node.dispatchEvent(hiddenDismiss);
    assert.equal(hiddenDismiss.defaultPrevented, false); assert.deepEqual(decisions, ['protected', 'editor', 'close']);
    context.active = true; guards.attempt = true; render(); interaction.dismissPhoneOverlay(node, { KeyboardEvent: KeyboardEventStub });
    assert.deepEqual(decisions, ['protected', 'editor', 'close', 'protected']); assert.equal(fallbackKeys, 0);
  } finally { runtime.unmount(); }
});

function controlledPopup() {
  const id = 'radix:calendar-content', triggers = [], document = {
    defaultView: { getComputedStyle: node => ({ visibility: node.props.visibility || 'visible' }) },
    querySelectorAll: () => triggers.filter(node => node.getAttribute('aria-controls') !== null && node.getAttribute('aria-expanded') === 'true'),
  };
  const body = domNode(); body.ownerDocument = document;
  const owner = domNode({ 'data-phone-workflow-owner': 'station-current' }, body);
  const trigger = domNode({ tagName: 'BUTTON', 'aria-expanded': 'true', 'aria-controls': `other-id\t${id}\nanother-id` }, owner); triggers.push(trigger);
  const popup = domNode({ role: 'dialog', id }, body);
  return { id, triggers, document, body, owner, trigger, popup };
}

test('unmarked controlled popup ownership follows only its exact live expanded trigger and explicit markers take precedence', () => {
  const view = controlledPopup();
  assert.equal(interaction.phoneWorkflowOwnsOverlay(view.popup, 'station-current'), true);
  for (const marker of ['station-other', 'station-old', '']) {
    view.popup.props['data-phone-workflow-owner'] = marker;
    assert.equal(interaction.phoneWorkflowOwnsOverlay(view.popup, 'station-current'), false, `Explicit ${marker || 'empty'} ownership cannot be overridden by a trigger.`);
  }
  delete view.popup.props['data-phone-workflow-owner'];
  for (const [reason, invalidate] of [
    ['collapsed trigger', v => { v.trigger.props['aria-expanded'] = 'false'; }],
    ['hidden trigger', v => { v.trigger.props.hidden = true; }],
    ['inert trigger', v => { v.trigger.inert = true; }],
    ['disabled trigger', v => { v.trigger.disabled = true; }],
    ['disconnected trigger', v => { v.trigger.isConnected = false; }],
    ['zero geometry', v => { v.trigger.getClientRects = () => []; }],
    ['CSS hidden', v => { v.trigger.props.visibility = 'hidden'; }],
    ['CSS collapse', v => { v.trigger.props.visibility = 'collapse'; }],
    ['different document', v => { v.trigger.ownerDocument = {}; }],
    ['partial ID match', v => { v.trigger.props['aria-controls'] = `${v.id}-other`; }],
    ['old source owner', v => { v.owner.props['data-phone-workflow-owner'] = 'station-old'; }],
    ['hidden source owner', v => { v.owner.props.hidden = true; }],
    ['inert source owner', v => { v.owner.inert = true; }],
  ]) {
    const changed = controlledPopup(); invalidate(changed);
    assert.equal(interaction.phoneWorkflowOwnsOverlay(changed.popup, 'station-current'), false, reason);
  }
});

test('overlapping stale and current IDREF triggers cannot transfer popup ownership to a different station', () => {
  const view = controlledPopup(), staleOwner = domNode({ 'data-phone-workflow-owner': 'station-old' }, view.body);
  const staleTrigger = domNode({ 'aria-controls': view.id, 'aria-expanded': 'true' }, staleOwner); view.triggers.unshift(staleTrigger);
  assert.equal(interaction.phoneWorkflowOwnsOverlay(view.popup, 'station-current'), true);
  view.trigger.props['aria-expanded'] = 'false';
  assert.equal(interaction.phoneWorkflowOwnsOverlay(view.popup, 'station-current'), false);
  assert.equal(interaction.phoneWorkflowOwnsOverlay(view.popup, 'station-old'), true);
  view.popup.props['data-phone-workflow-owner'] = 'station-old'; view.trigger.props['aria-expanded'] = 'true';
  assert.equal(interaction.phoneWorkflowOwnsOverlay(view.popup, 'station-current'), false);
});

test('cheaply rejected popup associations perform no geometry or computed-style reads', () => {
  for (const [reason, invalidate] of [
    ['irrelevant ID', v => { v.trigger.props['aria-controls'] = 'radix:another-popup'; }],
    ['partial ID', v => { v.trigger.props['aria-controls'] = `${v.id}-suffix`; }],
    ['old owner', v => { v.owner.props['data-phone-workflow-owner'] = 'station-old'; }],
    ['explicit stale popup owner', v => { v.popup.props['data-phone-workflow-owner'] = 'station-old'; }],
    ['explicit empty popup owner', v => { v.popup.props['data-phone-workflow-owner'] = ''; }],
    ['collapsed trigger', v => { v.trigger.props['aria-expanded'] = 'false'; }],
    ['disconnected trigger', v => { v.trigger.isConnected = false; }],
    ['disabled trigger', v => { v.trigger.disabled = true; }],
    ['hidden trigger', v => { v.trigger.props.hidden = true; }],
    ['inert trigger', v => { v.trigger.inert = true; }],
    ['different document', v => { v.trigger.ownerDocument = {}; }],
  ]) {
    const view = controlledPopup(), reads = { geometry: 0, style: 0 };
    view.trigger.getClientRects = () => { reads.geometry++; return [{}]; };
    view.document.defaultView.getComputedStyle = () => { reads.style++; return { visibility: 'visible' }; };
    invalidate(view);
    assert.equal(interaction.phoneWorkflowOwnsOverlay(view.popup, 'station-current'), false, reason);
    assert.deepEqual(reads, { geometry: 0, style: 0 }, reason);
  }
});

test('only an exactly associated current live trigger is measured among unrelated expanded controls', () => {
  const view = controlledPopup(), oldOwner = domNode({ 'data-phone-workflow-owner': 'station-old' }, view.body);
  const irrelevant = domNode({ 'aria-expanded': 'true', 'aria-controls': 'another-id' }, view.owner);
  const stale = domNode({ 'aria-expanded': 'true', 'aria-controls': view.id }, oldOwner);
  view.triggers.unshift(irrelevant, stale);
  const reads = new Map([irrelevant, stale, view.trigger].map(node => [node, { geometry: 0, style: 0 }]));
  for (const node of reads.keys()) node.getClientRects = () => { reads.get(node).geometry++; return [{}]; };
  view.document.defaultView.getComputedStyle = node => { reads.get(node).style++; return { visibility: 'visible' }; };
  assert.equal(interaction.phoneWorkflowOwnsOverlay(view.popup, 'station-current'), true);
  assert.deepEqual(reads.get(irrelevant), { geometry: 0, style: 0 });
  assert.deepEqual(reads.get(stale), { geometry: 0, style: 0 });
  assert.deepEqual(reads.get(view.trigger), { geometry: 1, style: 1 });
});

test('actual Intake context, shell observer and TemporalInput keep an unmarked linked calendar open without a self-inactivation cycle', async t => {
  const view = await mount(t, 'intake'), calendarHooks = hooks();
  const React = { ...calendarHooks };
  const TemporalInput = await compile('../../components/ui/temporal-input.tsx', 'TemporalInput', {
    React, Button: 'button', Popover: 'Popover', PopoverTrigger: 'PopoverTrigger', PopoverContent: 'PopoverContent', Calendar: 'Calendar',
    temporalFormats, temporalInputMessage, toCalendarDate, currentSydneyDate: () => '2026-10-13',
  });
  let tree;
  const renderCalendar = () => {
    calendarHooks.reset(); tree = TemporalInput({ type: 'date', value: '', disabled: !view.context.active, 'aria-label': 'Intake manufacture date' }); calendarHooks.commit();
    const popup = flatten(tree).find(node => node.type === 'Popover'); assert.ok(popup);
    // Model the installed Radix DOM contract: an expanded live Trigger IDREF
    // controls its body-portal Content ID. TemporalInput state is actual JSX.
    view.linkedCalendar(popup.props.open); return popup;
  };
  try {
    const closed = renderCalendar(); assert.equal(closed.props.open, false);
    closed.props.onOpenChange(true);
    for (let frame = 0; frame < 6; frame++) {
      const popup = renderCalendar(); assert.equal(popup.props.open, true); assert.equal(view.externalLocked, false); assert.equal(view.context.active, true);
      assert.equal(flatten(tree).find(node => node.type === 'input').props.disabled, false);
    }
    flatten(tree).find(node => node.type === 'button' && words(node) === 'Close').props.onClick();
    assert.equal(renderCalendar().props.open, false); assert.equal(view.context.active, true);
    assert.deepEqual(view.calls, []); assert.equal(view.draft.entries.length, 1);
  } finally { calendarHooks.unmount(); }
});
