import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { normalizedIntakePreparation, changedIntakePreparation, applyIntakePreparationModel, intakeModelInput } from '../src/features/lifecycle/intake-preparation.mjs';
import { readPhoneFormDraft, savePhoneFormDraft } from '../src/app/phone-form-draft.mjs';
import { createDurableStorage } from '../src/platform/durable-storage.mjs';
import { reviewedIntakeCommon } from '../src/features/lifecycle/intake-controller.mjs';

const nodes = tree => !tree || typeof tree !== 'object' ? [] : [tree, ...[tree.props?.children].flat(Infinity).flatMap(nodes)];
const text = tree => tree == null || typeof tree === 'boolean' ? '' : typeof tree !== 'object' ? String(tree) : [tree.props?.children].flat(Infinity).map(text).join('');
async function mount(file, name, props, extra = {}) {
  const source = await readFile(new URL(file, import.meta.url), 'utf8'), parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
  assert.deepEqual(parsed.parseDiagnostics, []);
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } }).outputText.replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
  const hooks = [], effects = [], frames = [], calls = []; let cursor = 0, tree, dirty = false, context = { namespace: 'account:demo', workflowOwner: 'intake', active: true };
  const effect = (run, deps) => { const index = cursor++, old = hooks[index]; if (!old || deps.some((value, i) => !Object.is(value, old.deps[i]))) { hooks[index] = { deps, cleanup: old?.cleanup }; effects.push(() => { hooks[index].cleanup?.(); hooks[index].cleanup = run(); }); } };
  const document = { body: {}, activeElement: null }, back = { handler: null };
  const bindings = { _Fragment: 'fragment', Check: 'Check', ChevronDown: 'ChevronDown', Search: 'Search', X: 'X', Pencil: 'Pencil', Pressable: 'button', PhoneChoice: 'PhoneChoice', PhoneModelPicker: 'PhoneModelPicker', TemporalInput: 'TemporalInput', currentSydneyDate: () => '2026-10-13', isSelectableRoom: room => room.selectable !== false, getRolePermissions: () => ({ editModels: false }), intakeModelInput,
    document, globalThis: { requestAnimationFrame: callback => { frames.push(callback); return callback; }, cancelAnimationFrame: callback => { const index = frames.indexOf(callback); if (index >= 0) frames.splice(index, 1); } },
    useId: () => 'choice', usePhoneContext: () => context, usePhoneReducedMotion: () => false, createPhoneWorkflowPortal: element => element, usePhoneOverlayDismiss() {}, usePhoneBack(handler, options) { back.handler = options.enabled ? handler : null; },
    useRef(initial) { return hooks[cursor++] ??= { current: initial }; }, useState(initial) { const index = cursor++; if (!hooks[index]) hooks[index] = { value: typeof initial === 'function' ? initial() : initial }; return [hooks[index].value, next => { hooks[index].value = typeof next === 'function' ? next(hooks[index].value) : next; dirty = true; }]; }, useEffect: effect, useLayoutEffect: effect, ...extra };
  const names = Object.keys(bindings), jsx = (type, properties) => ({ type, props: properties });
  const Component = new Function(...names, '_jsx', '_jsxs', `${code}\nreturn ${name};`)(...names.map(key => bindings[key]), jsx, jsx);
  const app = { props, calls, back, context(next) { context = next; }, render() { let count = 0; do { assert.ok(count++ < 20); cursor = 0; dirty = false; tree = Component(props); for (const node of nodes(tree)) if (node.props?.ref && !node.props.ref.current) { const ref = node.props.ref; ref.current = { isConnected: true, open: false, scrollTop: 0, focus() { document.activeElement = this; calls.push('focus'); }, querySelector: selector => { const matching = nodes(tree).find(item => selector.includes("data-choice-close") ? item.props?.["data-choice-close"] : item.props?.role === "option" && !item.props.disabled && (!selector.includes("aria-selected") || item.props["aria-selected"])); return matching ? { focus() { calls.push(`focus:${text(matching)}`); } } : null; }, showModal() { this.open = true; calls.push('showModal'); }, close() { this.open = false; calls.push('close'); }, animate() { calls.push('animate'); return { cancel() { calls.push('cancelAnimation'); } }; } }; } while (effects.length) effects.shift()(); } while (dirty); return app; }, nodes: () => nodes(tree), text: () => text(tree), frame() { while (frames.length) frames.shift()(); }, unmount() { hooks.forEach(hook => hook.cleanup?.()); }, button(label) { const result = nodes(tree).find(node => node.type === 'button' && (text(node) === label || node.props['aria-label'] === label)); assert.ok(result, label); return result; } };
  return app.render();
}

test('owned Choice uses native top layer, closes before callback, keeps exact value and returns focus', async () => {
  const delivered = [], props = { label: 'Room', value: '', options: [{ value: '', label: 'Room unspecified' }, { value: 'room-1', label: 'Room 1' }], onChange: value => { assert.equal(app.nodes().some(node => node.type === 'dialog'), false); delivered.push(value); } };
  const app = await mount('../src/app/phone-choice.jsx', 'PhoneChoice', props);
  app.button('Room unspecified').props.onClick(); app.render();
  assert.ok(app.calls.includes('showModal'));
  app.nodes().find(node => node.props?.role === 'option' && text(node) === 'Room 1').props.onClick();
  assert.deepEqual(delivered, []); app.render(); assert.deepEqual(delivered, []); app.frame();
  assert.deepEqual(delivered, ['room-1']); assert.ok(app.calls.includes('close')); assert.equal(app.calls.at(-1), 'focus'); app.unmount();
});

test('Choice cancellation, disabled and stale owner/value cannot hand off a selection', async () => {
  for (const change of ['cancel', 'disabled', 'namespace', 'value', 'unmount']) {
    const delivered = [], props = { label: 'Owner', value: 'one', options: [{ value: 'one', label: 'One' }, { value: 'two', label: 'Two' }], onChange: value => delivered.push(value) };
    const app = await mount('../src/app/phone-choice.jsx', 'PhoneChoice', props); app.button('One').props.onClick(); app.render();
    if (change === 'cancel') { app.nodes().find(node => node.type === 'dialog').props.onCancel({ preventDefault() {} }); app.render(); }
    else { app.nodes().find(node => node.props?.role === 'option' && text(node) === 'Two').props.onClick(); app.render(); if (change === 'disabled') props.disabled = true; if (change === 'namespace') app.context({ namespace: 'other', workflowOwner: 'intake', active: true }); if (change === 'value') props.value = 'two'; if (change === 'unmount') app.unmount(); else app.render(); }
    app.frame(); assert.deepEqual(delivered, [], change); if (change !== 'unmount') app.unmount();
  }
});

test('Choice searches long options, shows stale selection and supports Arrow/Home/End navigation', async () => {
  const props = { label: 'Staff', value: 'missing', options: Array.from({ length: 9 }, (_, i) => ({ value: `staff-${i}`, label: `Staff ${i}`, description: i === 7 ? 'Unique account' : '' })), onChange() {} };
  const app = await mount('../src/app/phone-choice.jsx', 'PhoneChoice', props); app.button('Selection unavailable').props.onClick(); app.render();
  app.nodes().find(node => node.type === 'input').props.onChange({ target: { value: 'unique' } }); app.render();
  assert.equal(app.nodes().filter(node => node.props?.role === 'option').length, 1);
  const focus = [], controls = Array.from({ length: 3 }, (_, i) => ({ focus: () => focus.push(i) })), list = app.nodes().find(node => node.props?.role === 'listbox');
  for (const key of ['Home', 'End', 'ArrowDown', 'ArrowUp']) list.props.onKeyDown({ key, preventDefault() {}, currentTarget: { querySelectorAll: () => controls } });
  assert.deepEqual(focus, [0, 2, 0, 1]); app.unmount();
});

test('searchable Choice focuses an enabled option without opening the keyboard, with Close fallback', async () => {
  for (const empty of [false, true]) {
    const props = { label: 'Owner', value: 'two', searchable: true, options: empty ? [] : [{ value: 'one', label: 'One', disabled: true }, { value: 'two', label: 'Two' }], onChange() {} }, app = await mount('../src/app/phone-choice.jsx', 'PhoneChoice', props);
    app.button(empty ? 'Selection unavailable' : 'Two').props.onClick(); app.render();
    assert.equal(app.calls.at(-1), empty ? 'focus:' : 'focus:Two'); assert.equal(app.calls.filter(value => value === 'focus').length, 0);
    app.nodes().find(node => node.type === 'dialog').props.onCancel({ preventDefault() {} }); app.render(); assert.equal(app.calls.at(-1), 'focus'); app.unmount();
  }
});

const data = { people: [{ id: 'owner', name: 'Staff member', role: 'staff', accountId: 'account' }], staffDirectory: [{ id: 'account', username: 'staff', active: true }], rooms: [{ id: 'room', name: 'Teaching room', buildingId: 'J18', selectable: true }] };
const value = () => ({ values: { name: '', model: '', chemistry: '', capacityMah: '', voltage: '', ownerId: 'owner', homeBuildingId: 'J18', homeRoomId: '', manufacturedOn: '', firstUsedOn: '' }, firstUseMode: 'at_registration', modelSelection: null });
test('durable naming intent distinguishes old drafts, explicit Battery and model application after restart', async () => {
  let raw = null; const driver = { load: async () => raw, save: async next => { raw = next; } }, storage = createDurableStorage(driver); await storage.initialize();
  const scope = { accountId: 'account', dataset: 'demo', kind: 'intake-common', recordId: 'common' };
  const fresh = normalizedIntakePreparation(value()); assert.equal(fresh.values.name, 'Battery'); assert.equal(fresh.nameSource, 'default'); assert.equal(intakeModelInput(fresh.values, fresh.nameSource).name, '');
  const old = { ...value(), values: { ...value().values, name: 'Battery' } }; await savePhoneFormDraft(storage, scope, old);
  assert.equal(normalizedIntakePreparation(readPhoneFormDraft(storage, scope).data).nameSource, 'custom');
  const whitespace = normalizedIntakePreparation({ ...value(), values: { ...value().values, name: '   ' } }); assert.equal(whitespace.nameSource, 'custom'); assert.equal(whitespace.values.name, '   ');
  const custom = changedIntakePreparation(fresh, 'name', 'Battery'); await savePhoneFormDraft(storage, scope, custom); const restarted = createDurableStorage(driver); await restarted.initialize(); const restored = readPhoneFormDraft(restarted, scope).data;
  assert.equal(restored.nameSource, 'custom'); assert.equal(intakeModelInput(restored.values, restored.nameSource).name, 'Battery');
  const choice = { origin: 'saved', id: 'known-model', contentHash: 'a'.repeat(64), name: 'Model display name', model: 'Model A' }, applied = applyIntakePreparationModel(fresh, choice, ['name', 'model']);
  await savePhoneFormDraft(restarted, scope, applied); const third = createDurableStorage(driver); await third.initialize(); assert.equal(readPhoneFormDraft(third, scope).data.nameSource, 'model');
  const common = reviewedIntakeCommon(data, applied.values, applied.firstUseMode, applied.modelSelection, '2026-10-13'); assert.equal(common.name, 'Model display name'); assert.equal(Object.hasOwn(common, 'nameSource'), false);
  const manual = changedIntakePreparation(applied, 'model', 'Manual model'); assert.deepEqual(manual.modelSelection.appliedFields, ['name']); assert.equal(manual.nameSource, 'model');
});

test('actual preparation JSX advances only local saves, restores Back position and starts only after Review', async () => {
  let saves = 0, prepares = 0; const scrollRef = { current: { scrollTop: 0 } }, fields = { ...normalizedIntakePreparation(value()), data, user: { id: 'account', role: 'staff' }, values: normalizedIntakePreparation(value()).values, mode: 'at_registration' };
  const props = { fields, scrollRef, draft: {}, onSave: async () => { saves++; }, onValidate: () => reviewedIntakeCommon(data, fields.values, fields.mode, null, '2026-10-13'), onPrepare: async () => { prepares++; return true; }, onReset() {}, onError(error) { throw error; } };
  const app = await mount('../src/features/lifecycle/intake-preparation.jsx', 'IntakePreparation', props);
  assert.equal(app.nodes()[0].props['data-preparation-step'], 1); scrollRef.current.scrollTop = 90;
  await app.nodes()[0].props.onSubmit({ preventDefault() {} }); app.render(); assert.equal(prepares, 0); assert.equal(scrollRef.current.scrollTop, 0);
  app.back.handler(); app.render(); assert.equal(scrollRef.current.scrollTop, 90);
  await app.nodes()[0].props.onSubmit({ preventDefault() {} }); app.render(); await app.nodes()[0].props.onSubmit({ preventDefault() {} }); app.render();
  assert.equal(app.nodes()[0].props['data-preparation-step'], 3); assert.match(app.text(), /Unique BAT IDs/); assert.equal(prepares, 0);
  await app.nodes()[0].props.onSubmit({ preventDefault() {} }); app.render(); assert.equal(prepares, 1); assert.equal(saves, 4); app.unmount();
});

test('validation returns to the relevant step and storage failure retains Review', async () => {
  let failure = null; const fields = { ...normalizedIntakePreparation(value()), data, user: { id: 'account' }, values: normalizedIntakePreparation(value()).values, mode: 'at_registration' }, props = { fields, draft: {}, onSave: async () => {}, onValidate() { if (failure) throw failure; }, onPrepare: async () => new Error('Controlled device save failure'), onReset() {}, onError() {} };
  const app = await mount('../src/features/lifecycle/intake-preparation.jsx', 'IntakePreparation', props);
  await app.nodes()[0].props.onSubmit({ preventDefault() {} }); app.render(); failure = { issues: [{ path: ['capacityMah'] }] }; await app.nodes()[0].props.onSubmit({ preventDefault() {} }); app.render(); assert.equal(app.nodes()[0].props['data-preparation-step'], 1);
  failure = null; await app.nodes()[0].props.onSubmit({ preventDefault() {} }); app.render(); await app.nodes()[0].props.onSubmit({ preventDefault() {} }); app.render(); await app.nodes()[0].props.onSubmit({ preventDefault() {} }); app.render(); assert.equal(app.nodes()[0].props['data-preparation-step'], 3);
  props.disabled = true; app.render(); assert.equal(app.back.handler(), true); app.render(); assert.equal(app.nodes()[0].props['data-preparation-step'], 3); app.unmount();
});

test('actual Intake fields expose model assistance and exact active owners without defaulting stale room IDs', async () => {
  const current = { ...data, people: [...data.people, { id: 'inactive-owner', name: 'Inactive staff', role: 'staff', accountId: 'inactive-account' }], staffDirectory: [...data.staffDirectory, { id: 'inactive-account', active: false }] };
  const values = { ...normalizedIntakePreparation(value()).values, homeRoomId: 'deleted-room' }, props = { data: current, user: { id: 'account', role: 'staff' }, values, mode: 'at_registration', nameSource: 'default', onChange() {}, onMode() {}, onApply() {}, onManual() {}, onModelBusy() {} };
  const app = await mount('../src/features/lifecycle/intake-preparation.jsx', 'CommonFields', props);
  const choices = app.nodes().filter(node => node.type === 'PhoneChoice'), owner = choices.find(node => node.props.name === 'ownerId'), room = choices.find(node => node.props.name === 'homeRoomId');
  assert.equal(owner.props.options.some(option => option.value === 'inactive-owner'), false); assert.equal(owner.props.options.find(option => option.value === 'owner').description, 'You · staff');
  assert.equal(room.props.value, 'deleted-room'); assert.equal(room.props.options[0].value, ''); assert.equal(app.nodes().some(node => node.type === 'select'), false);
  const model = app.nodes().find(node => node.type === 'PhoneModelPicker'); assert.equal(model.props.values.name, ''); assert.equal(app.nodes().find(node => node.type === 'input' && node.props.name === 'name').props.value, 'Battery');
  assert.throws(() => reviewedIntakeCommon(current, values, 'at_registration', null, '2026-10-13'), /selectable/); app.unmount();
});

test('delayed wizard save uses current same-context validation and cancels account or owner changes before preparation', async () => {
  for (const invalidation of ['account', 'namespace', 'inactive', 'unmount']) {
    const events = []; let release;
    const fields = { data: { ...data, dataset: 'demo', user: { id: 'account' } }, user: { id: 'account' }, values: normalizedIntakePreparation(value()).values, mode: 'at_registration' }, props = { fields, draft: {}, onSave: async () => {}, onValidate: () => events.push('old validation'), onPrepare: async () => { events.push('prepare'); return true; }, onReset() {}, onError: failure => events.push(failure.message), onBusyChange: busy => events.push(busy ? 'busy' : 'idle') };
    const app = await mount('../src/features/lifecycle/intake-preparation.jsx', 'IntakePreparation', props);
    await app.nodes()[0].props.onSubmit({ preventDefault() {} }); app.render();
    props.onSave = () => new Promise(resolve => { release = resolve; }); app.render();
    const next = app.nodes()[0].props.onSubmit({ preventDefault() {} }); app.render(); assert.equal(events.at(-1), 'busy');
    props.onValidate = () => events.push('current validation'); app.render(); release(); await next; app.render();
    assert.equal(events.includes('old validation'), false); assert.equal(events.includes('current validation'), true); assert.equal(app.nodes()[0].props['data-preparation-step'], 3);
    const final = app.nodes()[0].props.onSubmit({ preventDefault() {} }); app.render();
    if (invalidation === 'account') props.fields = { ...fields, user: { id: 'other-account' } };
    if (invalidation === 'namespace') app.context({ namespace: 'new-account:demo', workflowOwner: 'intake', active: true });
    if (invalidation === 'inactive') app.context({ namespace: 'account:demo', workflowOwner: 'intake', active: false });
    if (invalidation === 'unmount') app.unmount(); else app.render();
    release(); await final; assert.equal(events.includes('prepare'), false, invalidation); assert.equal(events.at(-1), 'idle');
    if (invalidation !== 'unmount') { assert.ok(events.some(event => event.includes('account or inventory changed'))); app.unmount(); }
  }
});
