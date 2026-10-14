import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { currentSydneyDate } from '../src/shared/lib/battery-age.js';
import { createDurableStorage } from '../src/platform/durable-storage.mjs';
import { acknowledgeOperatorRegistration, captureOperatorRegistrationAttempt, defaultRegistrationValues, discardOperatorRegistrationDraft, operatorRegistrationDraftKey, operatorRegistrationDraftSchema, operatorRegistrationStorageKey, persistOperatorRegistrationAttempt, recoverOperatorRegistrationAttempt, recoverOperatorRegistrationDraft, registrationFailureStatus, registrationValuesFromAttempt, verifyRegistrationResult } from '../src/features/lifecycle/manual-registration-model.mjs';
import * as registrationModel from '../src/features/lifecycle/manual-registration-model.mjs';
import { getRolePermissions } from '../src/shared/lib/permissions.js';
import { isSelectableRoom } from '../src/shared/lib/location-catalog.js';
import { modelCreateStorageKey } from '../src/shared/components/inventory/battery-model-picker.js';
import { newBatteryModelSchema } from '../src/shared/lib/battery-models.js';

const actor = '11111111-1111-4111-8111-111111111111', other = '22222222-2222-4222-8222-222222222222', sessionId = '33333333-3333-4333-8333-333333333333', requestId = '44444444-4444-4444-8444-444444444444';
const user = { id: actor, role: 'staff', displayName: 'Staff' }, at = '2026-10-11T13:30:00.000Z';
function data(dataset = 'live') { return { dataset, user, capabilities: { operatorRegistration: 1 }, people: [{ id: 'staff-person', accountId: actor, name: 'Staff', role: 'staff', version: 7 }], staffDirectory: [{ id: actor, username: 'staff', active: true }], buildings: [{ id: 'J18', name: 'Willis Annexe', version: 3 }], rooms: [{ id: 'J18-DEMO', number: 'DEMO', name: 'Demo room', buildingId: 'J18', selectable: true, isPlaceholder: true, version: 4 }, { id: 'J18-CLOSED', number: 'CLOSED', name: 'Unavailable room', buildingId: 'J18', selectable: false, version: 2 }] }; }
function draft(snapshot = data(), patch = {}) { return { actorAccountId: actor, dataset: snapshot.dataset, sessionId, values: { ...defaultRegistrationValues(snapshot, actor), name: 'Reviewed new battery', ...patch }, firstUseMode: 'at_registration', modelSelection: null }; }
function captured(snapshot = data(), form = draft(snapshot)) { return captureOperatorRegistrationAttempt(snapshot, user, snapshot.dataset, form, requestId); }
function receipt(attempt) { const common = attempt.payload.common; return { requestId: attempt.payload.requestId, sessionId: attempt.payload.sessionId, dataset: attempt.dataset, actorAccountId: attempt.actorAccountId, batteryId: 'BAT-00000042', tagId: attempt.payload.tagId, registeredAt: at, source: 'operator-entered-registration', replayed: false, name: common.name, model: common.model, chemistry: common.chemistry, capacityMah: common.capacityMah, voltage: common.voltage, ownerId: common.ownerId, homeBuildingId: common.homeBuildingId, homeRoomId: common.homeRoomId, manufacturedOn: common.manufacturedOn, firstUsedOn: attempt.payload.firstUseMode === 'at_registration' ? currentSydneyDate(new Date(at)) : attempt.payload.firstUseMode === 'date' ? common.firstUsedOn : null }; }

test('manual registration preserves the selected shared inventory, server-assigned identity and explicit unknown specifications', () => {
  for (const dataset of ['live', 'demo']) {
    const snapshot = data(dataset), attempt = captured(snapshot);
    assert.equal(attempt.dataset, dataset); assert.equal(attempt.payload.source, 'operator-entered-registration');
    assert.equal('id' in attempt.payload.common, false); assert.equal('batteryId' in attempt.payload, false);
    assert.equal(attempt.payload.common.capacityMah, null); assert.equal(attempt.payload.common.voltage, null);
    assert.equal(attempt.payload.tagId, null); assert.equal(attempt.payload.common.homeBuildingId, 'J18'); assert.equal(attempt.payload.common.homeRoomId, null);
    assert.equal(verifyRegistrationResult(receipt(attempt), attempt).batteryId, 'BAT-00000042');
  }
});
test('review freezes native owner identity and actual directory versions; typed tag never supplies reader evidence', () => {
  const snapshot = data(), form = draft(snapshot, { homeRoomId: 'J18-DEMO', tagId: ' nfc:uid:0004AB00 ' }), attempt = captured(snapshot, form);
  assert.deepEqual(attempt.payload.directoryBindings, { ownerVersion: 7, ownerAccountId: actor, buildingVersion: 3, roomVersion: 4 });
  assert.equal(attempt.payload.tagId, 'nfc:uid:0004AB00'); assert.equal('nfcEvidence' in attempt.payload, false); assert.equal('observedAt' in attempt.payload, false);
  snapshot.people[0].version = 8; snapshot.rooms[0].version = 5; form.values.name = 'Later edited name';
  assert.equal(attempt.payload.common.name, 'Reviewed new battery'); assert.equal(attempt.payload.directoryBindings.ownerVersion, 7); assert.equal(attempt.payload.directoryBindings.roomVersion, 4);
});
test('unsupported service, wrong context, inactive owner, unavailable room and invalid specifications cannot enter review', () => {
  const snapshot = data(); snapshot.capabilities.operatorRegistration = 0; assert.throws(() => captured(snapshot), /has not confirmed/);
  assert.throws(() => captureOperatorRegistrationAttempt(data(), user, 'demo', draft(), requestId), /matching account/);
  const inactive = data(); inactive.staffDirectory[0].active = false; assert.throws(() => captured(inactive), /active staff owner/);
  assert.throws(() => captured(data(), draft(data(), { homeRoomId: 'J18-CLOSED' })), /available J18 room/);
  for (const value of ['0', '-1', 'not a number']) assert.throws(() => captured(data(), draft(data(), { capacityMah: value })));
  assert.throws(() => captured(data(), draft(data(), { manufacturedOn: '9999-12-31' })), /future/);
});
test('service start is explicitly registration date, known date or unknown; no omitted date is guessed', () => {
  const snapshot = data();
  for (const mode of ['at_registration', 'date', 'unknown']) {
    const form = draft(snapshot, { manufacturedOn: '2019-01-01', firstUsedOn: mode === 'date' ? '2020-02-03' : '' }); form.firstUseMode = mode;
    const attempt = captured(snapshot, form), confirmed = verifyRegistrationResult(receipt(attempt), attempt);
    assert.equal(confirmed.firstUsedOn, mode === 'at_registration' ? '2026-10-12' : mode === 'date' ? '2020-02-03' : null);
    assert.equal(attempt.payload.common.firstUsedOn, mode === 'date' ? '2020-02-03' : null);
  }
  const blank = draft(snapshot); blank.firstUseMode = 'date'; assert.throws(() => captured(snapshot, blank), /actual first-use/);
  const reversed = draft(snapshot, { manufacturedOn: '2020-02-04', firstUsedOn: '2020-02-03' }); reversed.firstUseMode = 'date'; assert.throws(() => captured(snapshot, reversed), /precede manufacture/);
});
test('applied model evidence retains exact source hash and selected fields without copying asset identity', () => {
  const snapshot = data(), form = draft(snapshot, { model: 'Reviewed model', capacityMah: '3200' });
  form.modelSelection = { origin: 'saved', id: '55555555-5555-4555-8555-555555555555', contentHash: 'a'.repeat(64), confirmed: true, appliedFields: ['model', 'capacityMah'] };
  const attempt = captured(snapshot, form); assert.deepEqual(attempt.payload.common.modelSelection, form.modelSelection); assert.equal(attempt.payload.common.capacityMah, 3200);
  form.modelSelection.contentHash = 'b'.repeat(64); assert.equal(attempt.payload.common.modelSelection.contentHash, 'a'.repeat(64));
});
test('durable original request save and readback must complete before any submission; another retained request cannot be replaced', async () => {
  const attempt = captured(), events = []; let raw = null, fail = false;
  const storage = createDurableStorage({ load: async () => null, save: async value => { events.push('save'); if (fail) throw new Error('Controlled durable save denial'); raw = value; } }); await storage.initialize();
  await persistOperatorRegistrationAttempt(storage, attempt); events.push('network permitted');
  assert.ok(events.indexOf('save') < events.indexOf('network permitted'));
  assert.deepEqual(recoverOperatorRegistrationAttempt(JSON.parse(raw).entries[operatorRegistrationStorageKey(actor, 'live')], actor, 'live'), attempt);
  const different = structuredClone(attempt); different.payload.requestId = sessionId;
  await assert.rejects(persistOperatorRegistrationAttempt(storage, different), /has not been replaced/);
  fail = true; await assert.rejects(persistOperatorRegistrationAttempt(storage, attempt), /durable save denial/);
});
test('receipt mismatch or failed atomic acknowledgement retains original request and draft for exact replay', async () => {
  const attempt = captured(), key = operatorRegistrationStorageKey(actor, 'live'), draftKey = operatorRegistrationDraftKey(actor, 'live'); let denyAck = false;
  const storage = createDurableStorage({ load: async () => null, save: async value => { if (denyAck && !JSON.parse(value).entries[key]) throw new Error('Controlled receipt acknowledgement denial'); } }); await storage.initialize();
  storage.setItem(draftKey, JSON.stringify(draft())); await persistOperatorRegistrationAttempt(storage, attempt);
  for (const change of [{ actorAccountId: other }, { dataset: 'demo' }, { batteryId: 'MANUAL-ID' }, { capacityMah: 100 }, { firstUsedOn: null }, { tagId: 'other-tag' }]) assert.throws(() => verifyRegistrationResult({ ...receipt(attempt), ...change }, attempt));
  denyAck = true; await assert.rejects(acknowledgeOperatorRegistration(storage, attempt, receipt(attempt)), /acknowledgement denial/);
  const retained = JSON.parse(storage.exportRaw()).current.entries; assert.ok(retained[key]); assert.ok(retained[draftKey]); assert.equal(retained[`preference:operator-registration-receipt:${requestId}`], undefined);
  denyAck = false; await storage.retryPersistence();
  const confirmed = await acknowledgeOperatorRegistration(storage, attempt, { ...receipt(attempt), replayed: true });
  assert.equal(confirmed.replayed, true); assert.equal(storage.getItem(key), null); assert.equal(storage.getItem(draftKey), null); assert.ok(storage.getItem(`preference:operator-registration-receipt:${requestId}`));
});
test('uncertain outcomes require exact original retry; terminal rejection remains explicit and account/dataset draft recovery stays isolated', () => {
  assert.equal(registrationFailureStatus(new Error('Connection lost'), false), 'uncertain'); assert.equal(registrationFailureStatus({ status: 503 }, true), 'uncertain');
  assert.equal(registrationFailureStatus({ status: 400 }, true), 'uncertain'); assert.equal(registrationFailureStatus({ status: 401 }, true), 'uncertain');
  assert.equal(registrationFailureStatus({ status: 409, code: 'registration_rejected_final' }, true), 'rejected');
  const attempt = captured(), raw = JSON.stringify(attempt); assert.deepEqual(recoverOperatorRegistrationAttempt(raw, actor, 'live'), attempt);
  assert.equal(recoverOperatorRegistrationAttempt(raw, other, 'live'), null); assert.equal(recoverOperatorRegistrationAttempt(raw, actor, 'demo'), null); assert.equal(recoverOperatorRegistrationAttempt('not JSON', actor, 'live'), null);
  const form = operatorRegistrationDraftSchema.parse(draft()), draftRaw = JSON.stringify(form); assert.deepEqual(recoverOperatorRegistrationDraft(draftRaw, actor, 'live'), form);
  assert.equal(recoverOperatorRegistrationDraft(draftRaw, other, 'live'), null); assert.equal(recoverOperatorRegistrationDraft(draftRaw, actor, 'demo'), null); assert.equal(recoverOperatorRegistrationDraft('not JSON', actor, 'live'), null);
  const rejected = { ...attempt, status: 'rejected', message: 'Terminal server reservation.' }; assert.deepEqual(recoverOperatorRegistrationAttempt(JSON.stringify(rejected), actor, 'live'), rejected);
  const retainedValues = registrationValuesFromAttempt(rejected); assert.equal(retainedValues.name, rejected.payload.common.name); assert.equal(retainedValues.capacityMah, ''); assert.equal(retainedValues.tagId, '');
});
test('empty retained attempt or draft keys block the actual phone form and exit without replacing original bytes', async () => {
  const source = ts.transpileModule(await readFile(new URL('../src/features/lifecycle/manual-registration.jsx', import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } }).outputText.replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
  const jsx = (type, props) => ({ type, props });
  function flatten(node, result = []) { if (!node || typeof node !== 'object') return result; if (node.type) result.push(node); for (const child of [node.props?.children].flat(Infinity)) flatten(child, result); return result; }
  for (const retainedKey of [operatorRegistrationStorageKey(actor, 'live'), operatorRegistrationDraftKey(actor, 'live')]) {
    const entries = { [retainedKey]: '' }, writes = [];
    const storage = { getItem: key => Object.hasOwn(entries, key) ? entries[key] : null, setItem: (key, value) => { writes.push([key, value]); entries[key] = value; } };
    const bindings = { ...registrationModel, modelCreateStorageKey, getRolePermissions, isSelectableRoom, currentSydneyDate, businessStorage: () => storage, useWorkflowLock() {}, usePhoneBack() {}, useState: initial => [typeof initial === 'function' ? initial() : initial, () => {}], useRef: value => ({ current: value }), useEffect() {}, BatteryModelPicker: 'ModelPicker', TemporalInput: 'DateInput', ArrowLeft: 'Icon', Battery: 'Icon', Check: 'Icon', FileDown: 'Icon', LockKeyhole: 'Icon', RefreshCw: 'Icon', formatTime: value => value, modelApplication: () => {}, saveFile: () => {} };
    const names = Object.keys(bindings), Component = new Function(...names, '_jsx', '_jsxs', `${source}\nreturn ManualRegistration;`)(...names.map(name => bindings[name]), jsx, jsx);
    const nodes = flatten(Component({ data: data(), user, dataset: 'live' }));
    const exit = nodes.find(node => node.type === 'button' && node.props['aria-label'] === 'Exit manual registration'); assert.equal(exit.props.disabled, true);
    assert.equal(nodes.some(node => node.type === 'button' && node.props.type === 'submit'), false, 'Unreadable empty recovery cannot prepare a new registration');
    assert.equal(entries[retainedKey], ''); assert.deepEqual(writes, []);
  }
  const retainedKey = operatorRegistrationStorageKey(actor, 'live'), entries = { [retainedKey]: '' }, storage = { getItem: key => entries[key] ?? null, setItem: (key, value) => { entries[key] = value; }, flush: async () => {} };
  await assert.rejects(persistOperatorRegistrationAttempt(storage, captured()), /has not been replaced/); assert.equal(entries[retainedKey], '');
});

const phoneSource = ts.transpileModule(await readFile(new URL('../src/features/lifecycle/manual-registration.jsx', import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } }).outputText.replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
function phoneNodes(node, result = []) {
  if (!node || typeof node !== 'object') return result;
  if (node.type) result.push(node);
  for (const child of [node.props?.children].flat(Infinity)) phoneNodes(child, result);
  return result;
}
function phoneText(node) { return node === null || node === undefined || typeof node === 'boolean' ? '' : typeof node !== 'object' ? String(node) : [node.props?.children].flat(Infinity).map(phoneText).join(''); }
/** Exercise the actual JSX component's hooks and event handlers without a browser or model network. */
function phoneHarness(storage, options = {}) {
  const hooks = [], effects = [], exits = [], locks = [], network = []; let cursor = 0, dirty = true, tree, props;
  const jsx = (type, properties) => ({ type, props: properties });
  const bindings = {
    ...registrationModel, modelCreateStorageKey, getRolePermissions, isSelectableRoom, currentSydneyDate, PhoneChoice: 'PhoneChoice', businessStorage: () => storage, useWorkflowLock() {}, usePhoneBack() {},
    useState(initial) { const index = cursor++; if (!hooks[index]) hooks[index] = { value: typeof initial === 'function' ? initial() : initial }; return [hooks[index].value, next => { const value = typeof next === 'function' ? next(hooks[index].value) : next; if (!Object.is(value, hooks[index].value)) { hooks[index].value = value; dirty = true; } }]; },
    useRef(value) { const index = cursor++; return hooks[index] ??= { current: value }; },
    useEffect(effect, dependencies) { const index = cursor++, old = hooks[index]; if (!old || !dependencies || dependencies.some((value, i) => !Object.is(value, old.dependencies?.[i]))) { hooks[index] = { dependencies, cleanup: old?.cleanup }; effects.push(() => { hooks[index].cleanup?.(); hooks[index].cleanup = effect(); }); } },
    BatteryModelPicker: 'ModelPicker', TemporalInput: 'DateInput', ArrowLeft: 'Icon', Battery: 'Icon', Check: 'Icon', FileDown: 'Icon', LockKeyhole: 'Icon', RefreshCw: 'Icon', formatTime: value => value, modelApplication: old => old, saveFile: async () => {}, fetch: async (...args) => { network.push(args); throw new Error('Unexpected registration submission'); },
  };
  const names = Object.keys(bindings), Component = new Function(...names, '_jsx', '_jsxs', `${phoneSource}\nreturn ManualRegistration;`)(...names.map(name => bindings[name]), jsx, jsx);
  props = { data: data(), user, dataset: 'live', onExit: () => exits.push('exit'), onLockedChange: value => locks.push(value), ...options };
  const harness = {
    exits, locks, network,
    render(nextProps) { if (nextProps) props = { ...props, ...nextProps }; let renders = 0; do { assert.ok(renders++ < 15, 'Component effects settle'); dirty = false; cursor = 0; tree = Component(props); for (const node of phoneNodes(tree)) if (node.props.ref && typeof node.props.ref === 'object') node.props.ref.current = { focus() {}, scrollIntoView() {} }; while (effects.length) effects.shift()(); } while (dirty); return harness; },
    nodes: () => phoneNodes(tree),
    button(label) { const node = phoneNodes(tree).find(item => item.type === 'button' && phoneText(item) === label); assert.ok(node, `Button exists: ${label}`); return node; },
    text: () => phoneText(tree),
    unmount() { for (const hook of hooks) hook?.cleanup?.(); },
  };
  return harness.render();
}
async function registrationDevice(entries, save = async () => {}) {
  const storage = createDurableStorage({ load: async () => JSON.stringify({ schemaVersion: 1, entries }), save }); await storage.initialize(); return storage;
}
const draftKey = operatorRegistrationDraftKey(actor, 'live'), attemptKey = operatorRegistrationStorageKey(actor, 'live'), modelKey = modelCreateStorageKey(actor, 'live');
const modelAttempt = { actorAccountId: actor, dataset: 'live', payload: newBatteryModelSchema.parse({ id: sessionId, model: 'Unresolved template', name: 'Unresolved battery model' }) };
function currentEntries(storage) { return JSON.parse(storage.exportRaw()).current.entries; }
function nextTurn() { return new Promise(resolve => setImmediate(resolve)); }

test('actual phone cancellation requires local confirmation, can keep review, and discards only the unsubmitted draft', async () => {
  const original = JSON.stringify(draft()), unrelated = { 'preference:retained': 'keep', 'unrelated-queue': 'keep' };
  const storage = await registrationDevice({ [draftKey]: original, ...unrelated }), phone = phoneHarness(storage);
  await storage.flush();
  phone.nodes().find(node => node.type === 'form').props.onSubmit({ preventDefault() {} }); phone.render();
  assert.match(phone.text(), /Staff · staff/); assert.ok(!phoneText(phone.nodes().find(node => node.props['aria-label'] === 'Reviewed registration')).includes(actor), 'Primary owner label omits the internal account ID');
  const confirmRegistration = phone.button('Confirm registration');
  phone.button('Cancel registration').props.onClick(); phone.render();
  assert.equal(storage.getItem(draftKey), original); assert.deepEqual(phone.exits, []); assert.equal(phone.locks.at(-1), true);
  await confirmRegistration.props.onClick(); assert.deepEqual(phone.network, [], 'A stale confirm handler cannot submit while cancellation is open');
  phone.button('Keep draft').props.onClick(); phone.render();
  assert.ok(phone.button('Confirm registration')); assert.equal(storage.getItem(draftKey), original); assert.deepEqual(phone.exits, []);
  phone.button('Cancel registration').props.onClick(); phone.render();
  const pending = phone.button('Discard draft and exit').props.onClick(); phone.render(); await pending; phone.render();
  assert.deepEqual(phone.exits, ['exit']); assert.equal(phone.locks.at(-1), false); assert.equal(storage.getItem(draftKey), null); assert.deepEqual(currentEntries(storage), unrelated);
  phone.render(); await storage.flush(); assert.equal(storage.getItem(draftKey), null, 'A mounted component never recreates a discarded draft'); assert.deepEqual(phone.network, []);
});

test('actual phone holds its lock and draft until a delayed atomic discard is durably acknowledged', async () => {
  let release, savingRemoval; const removalStarted = new Promise(resolve => { savingRemoval = resolve; });
  const storage = await registrationDevice({ [draftKey]: JSON.stringify(draft()) }, async raw => { if (!Object.hasOwn(JSON.parse(raw).entries, draftKey)) { savingRemoval(); await new Promise(resolve => { release = resolve; }); } });
  const phone = phoneHarness(storage); await storage.flush(); phone.button('Cancel registration').props.onClick(); phone.render();
  const finish = phone.button('Discard draft and exit').props.onClick(); phone.render(); await removalStarted;
  assert.ok(currentEntries(storage)[draftKey]); assert.deepEqual(phone.exits, []); assert.equal(phone.locks.at(-1), true);
  assert.equal(phone.button('Saving cancellation…').props.disabled, true); assert.equal(phone.button('Keep draft').props.disabled, true);
  assert.equal(phone.nodes().find(node => node.props['aria-label'] === 'Exit manual registration').props.disabled, true);
  release(); await finish; phone.render(); assert.equal(storage.getItem(draftKey), null); assert.deepEqual(phone.exits, ['exit']); assert.equal(phone.locks.at(-1), false);
});

test('actual phone failed discard acknowledgement retains exact bytes and lock, then permits only acknowledged retry', async () => {
  let deny = true; const original = JSON.stringify(draft());
  const storage = await registrationDevice({ [draftKey]: original }, async raw => { if (deny && !Object.hasOwn(JSON.parse(raw).entries, draftKey)) throw new Error('Controlled cancellation acknowledgement denial'); });
  const phone = phoneHarness(storage); await storage.flush(); phone.button('Cancel registration').props.onClick(); phone.render();
  await phone.button('Discard draft and exit').props.onClick(); phone.render();
  assert.equal(currentEntries(storage)[draftKey], original); assert.deepEqual(phone.exits, []); assert.equal(phone.locks.at(-1), true); assert.match(phone.text(), /draft is retained/);
  assert.equal(phone.button('Keep draft').props.disabled, true); assert.ok(phone.button('Export recovery data'));
  deny = false; await phone.button('Retry discard and exit').props.onClick(); phone.render();
  assert.equal(storage.getItem(draftKey), null); assert.deepEqual(phone.exits, ['exit']); assert.equal(phone.locks.at(-1), false);
});

test('actual phone cannot discard any retained attempt, corrupt registration bytes or unresolved model request', async () => {
  const original = JSON.stringify(draft());
  for (const entries of [
    { [draftKey]: original, [attemptKey]: JSON.stringify(captured()) },
    { [draftKey]: original, [attemptKey]: JSON.stringify({ ...captured(), status: 'rejected', message: 'Rejected' }) },
    { [draftKey]: original, [attemptKey]: '' }, { [draftKey]: original, [attemptKey]: '{bad' },
    { [draftKey]: '' }, { [draftKey]: '{bad' },
    ...['', '{bad', JSON.stringify(modelAttempt)].map(raw => ({ [draftKey]: original, [modelKey]: raw })),
  ]) {
    const storage = await registrationDevice(entries), phone = phoneHarness(storage); await storage.flush();
    const cancel = phone.nodes().find(node => node.type === 'button' && phoneText(node) === 'Cancel registration');
    if (cancel) { assert.equal(cancel.props.disabled, true); cancel.props.onClick(); phone.render(); }
    assert.equal(phone.nodes().some(node => node.props.role === 'dialog'), false); assert.deepEqual(phone.exits, []); assert.deepEqual(phone.network, []);
    for (const [key, raw] of Object.entries(entries)) assert.equal(currentEntries(storage)[key], raw, 'Original protected bytes remain unchanged');
  }
});

test('actual phone rechecks request and model keys inserted after cancellation review before deleting anything', async () => {
  for (const [key, value] of [[attemptKey, ''], [modelKey, ''], [modelKey, '{bad']]) {
    const original = JSON.stringify(draft()), storage = await registrationDevice({ [draftKey]: original }), phone = phoneHarness(storage);
    await storage.flush(); phone.button('Cancel registration').props.onClick(); phone.render();
    storage.setItem(key, value); await storage.flush();
    await phone.button('Discard draft and exit').props.onClick(); phone.render();
    assert.equal(currentEntries(storage)[draftKey], original); assert.equal(currentEntries(storage)[key], value); assert.deepEqual(phone.exits, []); assert.equal(phone.locks.at(-1), true);
  }
});

test('cancellation waiting for storage never removes a changed draft or exits a changed account or inventory', async () => {
  const original = JSON.stringify(draft());
  for (const change of ['draft', 'dataset', 'account', 'unmount']) {
    const storage = await registrationDevice({ [draftKey]: original }), phone = phoneHarness(storage); await storage.flush();
    phone.button('Cancel registration').props.onClick(); phone.render();
    if (change === 'draft') { const altered = draft(data(), { name: 'Changed retained draft' }); storage.setItem(draftKey, JSON.stringify(altered)); await storage.flush(); }
    let resume; const realFlush = storage.flush; storage.flush = async () => { await new Promise(resolve => { resume = resolve; }); await realFlush(); };
    const finish = phone.button('Discard draft and exit').props.onClick(); phone.render(); await nextTurn(); assert.ok(resume);
    if (change === 'dataset') phone.render({ data: data('demo'), dataset: 'demo' });
    if (change === 'account') { const changedUser = { ...user, id: other }; phone.render({ data: { ...data(), user: changedUser }, user: changedUser }); }
    if (change === 'unmount') phone.unmount();
    resume(); await finish; if (change !== 'unmount') phone.render();
    assert.ok(currentEntries(storage)[draftKey]); assert.deepEqual(phone.exits, []);
  }
});

test('atomic discard repeats its guards inside the transaction against a model request race', async () => {
  const original = JSON.stringify(draft()), storage = await registrationDevice({ [draftKey]: original }), realTransact = storage.transact;
  storage.transact = async update => { storage.setItem(modelKey, ''); await storage.flush(); return realTransact(update); };
  await assert.rejects(discardOperatorRegistrationDraft(storage, { actorAccountId: actor, dataset: 'live', expectedDraftRaw: original, modelRequestKey: modelKey }, () => true), /saved model request/);
  assert.equal(currentEntries(storage)[draftKey], original); assert.equal(currentEntries(storage)[modelKey], '');
});

test('actual phone does not enter cancellation while a model request is being saved', async () => {
  const original = JSON.stringify(draft()), storage = await registrationDevice({ [draftKey]: original }), phone = phoneHarness(storage); await storage.flush();
  const picker = phone.nodes().find(node => node.type === 'ModelPicker'); picker.props.onBusyChange(true); phone.render();
  assert.equal(phone.button('Cancel registration').props.disabled, true); phone.button('Cancel registration').props.onClick(); phone.render();
  assert.equal(phone.nodes().some(node => node.props.role === 'dialog'), false); assert.equal(storage.getItem(draftKey), original); assert.deepEqual(phone.exits, []);
});

test('an exit callback failure after acknowledged cancellation reports the discarded state truthfully and cannot recreate the draft', async () => {
  const storage = await registrationDevice({ [draftKey]: JSON.stringify(draft()) }); let denyExit = true, exits = 0;
  const phone = phoneHarness(storage, { onExit: () => { if (denyExit) throw new Error('Controlled exit callback failure'); exits++; } }); await storage.flush();
  phone.button('Cancel registration').props.onClick(); phone.render(); await phone.button('Discard draft and exit').props.onClick(); phone.render();
  assert.equal(storage.getItem(draftKey), null); assert.match(phone.text(), /draft was discarded on this device/); assert.ok(!phone.text().includes('The draft is retained')); assert.equal(phone.locks.at(-1), false);
  denyExit = false; phone.button('Exit registration').props.onClick(); phone.render(); await storage.flush(); assert.equal(exits, 1); assert.equal(storage.getItem(draftKey), null);
});
