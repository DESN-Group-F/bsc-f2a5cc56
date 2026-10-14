import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import * as React from 'react';
import { jsx, jsxs, Fragment } from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';
import { messageEntryScope, personalBatterySummary, workspaceEntries } from '../src/features/workspace/workspace-model.mjs';
import { inventoryEmptyState, inventoryViewKey, initialInventoryView, prepareTeachingGroupView, readInventoryView, rememberInventoryView } from '../src/features/inventory/inventory-model.mjs';
import { workspaceStateKey } from '../src/features/workspace/phone-view-state.mjs';
import { defaultInventoryFilter } from '../src/shared/lib/inventory-query.js';
import { teachingGroupStorageKey, recoverTeachingGroupAttempt } from '../src/shared/lib/teaching-groups.js';
import { readTaskRecordAction, saveTaskRecordAction, verifyTaskRecordActionReceipt, acknowledgeTaskRecordAction, taskRecordActionFinallyRejected } from '../src/shared/lib/client/task-record-action.js';
import * as taskSchedule from '../src/shared/lib/task-schedule.js';

const nodes = tree => Array.isArray(tree) ? tree.flatMap(nodes) : !tree || typeof tree !== 'object' ? [] : [tree, ...nodes(tree.props?.children)];
const text = tree => Array.isArray(tree) ? tree.map(text).join('') : tree == null || typeof tree === 'boolean' ? '' : typeof tree === 'object' ? text(tree.props?.children) : String(tree);
async function component(path, name, supplied = {}) {
  const source = await readFile(new URL(path, import.meta.url), 'utf8');
  const parsed = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.JSX);
  assert.deepEqual(parsed.parseDiagnostics, []);
  const imports = Object.fromEntries(parsed.statements.filter(ts.isImportDeclaration).flatMap(item => (item.importClause?.namedBindings?.elements ?? []).map(binding => [binding.name.text, binding.name.text])));
  const body = ts.transpileModule(parsed.statements.filter(item => !ts.isImportDeclaration(item)).map(item => item.getFullText(parsed)).join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } }).outputText.replace(/^import .*;\r?\n/gm, '').replace(/export \{[\s\S]*?\};?/g, '').replace(/^export /gm, '');
  const bindings = { ...imports, ...supplied };
  return new Function(...Object.keys(bindings), '_jsx', '_jsxs', '_Fragment', `${body}
return ${name};`)(...Object.values(bindings), jsx, jsxs, Fragment);
}
function hooks(memory = new Map()) {
  const cells = [], work = []; let cursor = 0;
  return { memory, render(run) { cursor = 0; const tree = run(); for (const effect of work.splice(0)) effect(); return tree; }, cleanup() { cells.forEach(cell => cell?.cleanup?.()); },
    useState(initial) { const index = cursor++; cells[index] ??= { value: typeof initial === 'function' ? initial() : initial }; return [cells[index].value, next => { cells[index].value = typeof next === 'function' ? next(cells[index].value) : next; }]; },
    useRef(initial) { return cells[cursor++] ??= { current: initial }; }, useCallback: callback => callback,
    useEffect(run, deps) { const index = cursor++, old = cells[index]; if (!old || deps?.some((value, i) => !Object.is(value, old.deps?.[i]))) { cells[index] = { deps, cleanup: old?.cleanup }; work.push(() => { cells[index].cleanup?.(); cells[index].cleanup = run(); }); } },
    usePhoneViewState(key, field, initial) { const id = `${key}:${field}`; if (!memory.has(id)) memory.set(id, typeof initial === 'function' ? initial() : initial); return [memory.get(id), next => memory.set(id, typeof next === 'function' ? next(memory.get(id)) : next)]; },
    useWorkflowLock() {}, usePhoneBack() {},
  };
}
function storage() { const entries = new Map(); return { getItem: key => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, value), removeItem: key => entries.delete(key), async flush() {}, entries: () => Object.fromEntries(entries) }; }

test('personal entry names and counts preserve account responsibility versus borrowing', async () => {
  const data = { user: { id: 'native-account', displayName: 'Teacher', username: 'teacher', role: 'staff' }, batteries: [{ ownerAccountId: 'native-account', borrowerAccountId: 'other', loanId: 'a' }, { ownerAccountId: 'other', borrowerAccountId: 'native-account', loanId: 'b' }] };
  const h = hooks(), calls = [];
  const Component = await component('../src/features/workspace/workspace.jsx', 'MeScreen', { ...h, personalBatterySummary });
  const tree = h.render(() => Component({ data, user: data.user, dataset: 'demo', onOpen: (...args) => calls.push(args), onPersonal: (...args) => calls.push(args) }));
  const buttons = nodes(tree).filter(node => node.type === 'Pressable');
  buttons.find(node => text(node).includes('Checked out to me')).props.onClick();
  buttons.find(node => text(node).includes('Under my responsibility')).props.onClick();
  assert.deepEqual(calls, [['holder'], ['owner']]);
  assert.match(text(tree), /Active loans to your account/); assert.match(text(tree), /Active records assigned to you/); h.cleanup();
});

test('My tasks entry resets its own previous filters without modifying ordinary inbox memory or acknowledging messages', async () => {
  const accountId = 'native-account', data = { user: { id: accountId }, dataset: 'demo', events: [] }, memory = new Map();
  const inbox = workspaceStateKey(accountId, 'demo', 'messages'), taskKey = workspaceStateKey(accountId, 'demo', 'my-tasks');
  for (const key of [inbox, taskKey]) { memory.set(`${key}:visibility`, 'removed'); memory.set(`${key}:taskStatus`, 'completed'); memory.set(`${key}:search`, 'old query'); }
  const h = hooks(memory); let writes = 0;
  const Component = await component('../src/features/workspace/mobile-messages.jsx', 'MobileMessages', { ...h, workspaceStateKey, messageEntryScope, readTaskRecordAction: () => ({ input: null, error: '' }), taskCompletionRecovery: () => ({ attempt: null }), useTaskEndpoint: () => ({ payload: { messages: [], unreadCount: 0 }, loading: false, error: '', refresh() {} }), taskRequest: async () => { writes++; } });
  const props = { data, initialTaskContext: 'open' };
  h.render(() => Component(props)); h.render(() => Component(props));
  assert.equal(memory.get(`${taskKey}:taskStatus`), 'open'); assert.equal(memory.get(`${taskKey}:visibility`), 'current'); assert.equal(memory.get(`${taskKey}:search`), '');
  assert.equal(memory.get(`${inbox}:taskStatus`), 'completed'); assert.equal(memory.get(`${inbox}:visibility`), 'removed'); assert.equal(memory.get(`${inbox}:search`), 'old query'); assert.equal(writes, 0); h.cleanup();
});

test('empty register, empty personal scope, retired-only register and filter failure have truthful distinct actions', () => {
  const base = { activeCount: 0, recordCount: 0, filtered: false, dataset: 'live' };
  assert.equal(inventoryEmptyState(base).action, 'Register batteries');
  assert.equal(inventoryEmptyState({ ...base, recordCount: 2 }).action, 'View retired records');
  assert.equal(inventoryEmptyState({ ...base, scope: { kind: 'holder' } }).action, null);
  assert.equal(inventoryEmptyState({ ...base, scope: { kind: 'owner' } }).action, null);
  assert.equal(inventoryEmptyState({ ...base, filtered: true }).action, 'Clear filters');
  assert.ok(workspaceEntries('staff').some(entry => entry.view === 'battery-records'));
  assert.equal(workspaceEntries('staff').some(entry => entry.view === 'accounts'), false);
});

for (const resourceState of [{ loading: true, error: '' }, { loading: false, error: 'Controlled refresh failure' }]) test(`retained message opens without acknowledging stale data during ${resourceState.loading ? 'refresh' : 'read failure'}`, async () => {
  const data = { user: { id: 'native-account' }, dataset: 'demo', events: [] }, h = hooks();
  const message = { id: 'message-retained', title: 'Retained task message', body: 'Review the original requirement.', dueOn: '2026-10-13', createdAt: '2026-10-12T00:00:00Z', readAt: null, taskStatus: 'open', cycle: { id: 'cycle-retained', canComplete: true, planRemoved: false } };
  let writes = 0;
  const Component = await component('../src/features/workspace/mobile-messages.jsx', 'MobileMessages', { ...h, workspaceStateKey, messageEntryScope, readTaskRecordAction: () => ({ input: null, error: '' }), taskCompletionRecovery: () => ({ attempt: null }), useTaskEndpoint: () => ({ payload: { messages: [message], unreadCount: 1 }, ...resourceState, refresh() {} }), taskRequest: async () => { writes++; throw Error('No write may be sent from retained data.'); }, currentSydneyDate: () => '2026-10-13', formatDateOnly: value => value, formatTime: value => value || 'Not recorded' });
  let tree = h.render(() => Component({ data }));
  const row = nodes(tree).find(node => node.props?.className === 'mobile-message-row unread');
  assert.equal(row.props.disabled, false); row.props.onClick();
  tree = h.render(() => Component({ data }));
  const detail = nodes(tree).find(node => node.props?.className === 'mobile-message-detail');
  assert.ok(detail); assert.match(text(detail), /Retained task message/); assert.equal(writes, 0);
  const actions = nodes(detail).filter(node => node.type === 'Pressable' && !text(node).includes('Back to messages'));
  assert.ok(actions.length >= 2); assert.ok(actions.every(node => node.props.disabled));
  nodes(detail).find(node => node.type === 'Pressable' && text(node).includes('Back to messages')).props.onClick();
  assert.ok(nodes(h.render(() => Component({ data }))).some(node => node.props?.className === 'mobile-message-row unread'));
  assert.equal(writes, 0); h.cleanup();
});

test('direct teaching-group creation changes only initial local mode and preserves the ordinary default', async t => {
  const priorStorage = globalThis.sessionStorage, priorFetch = globalThis.fetch, device = storage(); let writes = 0;
  globalThis.sessionStorage = device; globalThis.fetch = async () => { writes++; throw new Error('No request expected'); };
  t.after(() => { globalThis.sessionStorage = priorStorage; globalThis.fetch = priorFetch; });
  async function mount(initialCreate) {
    const h = hooks(), Component = await component('../../components/inventory/teaching-groups-panel.tsx', 'TeachingGroupsPanel', { ...h, defaultInventoryFilter, teachingGroupStorageKey, recoverTeachingGroupAttempt, getFilteredBatteries: () => ({ batteries: [], error: '' }) });
    const tree = h.render(() => Component({ data: { user: { id: 'native-account' }, dataset: 'demo', teachingGroups: [], batteries: [] }, initialCreate, onClose() {}, onFilter() {}, onSelect() {} }));
    return { h, open: nodes(tree).filter(node => node.type === 'MotionDisclosure').map(node => node.props.open) };
  }
  const ordinary = await mount(false), create = await mount(true);
  assert.deepEqual(ordinary.open, [true, false, false, false]); assert.deepEqual(create.open, [false, false, false, true]); assert.equal(writes, 0);
  ordinary.h.cleanup(); create.h.cleanup();
});

test('group view actions seed a private exact current scope and leave stale or foreign memory untouched', () => {
  const accountId = crypto.randomUUID(), group = { id: crypto.randomUUID(), ownerAccountId: accountId, version: 3, state: 'active', name: 'Teaching set', batteryIds: ['BAT-0001', 'BAT-0002'] };
  const data = { user: { id: accountId }, dataset: 'demo', teachingGroups: [group] }, scope = { kind: 'group', id: group.id }, key = inventoryViewKey(accountId, 'demo', scope);
  const previous = { ...initialInventoryView(scope), filter: { ...defaultInventoryFilter(), search: 'retained search' }, selectedIds: ['BAT-0001'], selecting: true, page: 4, scrollTop: 490 };
  rememberInventoryView(key, previous);
  for (const invalid of [{ ...group, version: 2 }, { ...group, ownerAccountId: 'other' }, { ...group, batteryIds: ['BAT-0002'] }, { ...group, state: 'archived' }]) {
    assert.equal(prepareTeachingGroupView(data, accountId, 'demo', invalid, { select: true }), null); assert.equal(readInventoryView(key, scope), previous);
  }
  assert.equal(prepareTeachingGroupView({ ...data, dataset: 'live' }, accountId, 'demo', group), null); assert.equal(readInventoryView(key, scope), previous);
  const fixed = prepareTeachingGroupView(data, accountId, 'demo', group);
  assert.deepEqual(fixed, { kind: 'group', id: group.id, label: group.name, version: 3 });
  assert.deepEqual(readInventoryView(key, scope).selectedIds, ['BAT-0001']); assert.equal(readInventoryView(key, scope).filter.search, ''); assert.equal(readInventoryView(key, scope).filter.groupId, group.id); assert.equal(readInventoryView(key, scope).page, 0);
  prepareTeachingGroupView(data, accountId, 'demo', group, { select: true });
  assert.deepEqual(readInventoryView(key, scope).selectedIds, group.batteryIds); assert.notEqual(readInventoryView(key, scope).selectedIds, group.batteryIds); assert.equal(readInventoryView(key, scope).selecting, true);
  const before = readInventoryView(key, scope); assert.equal(prepareTeachingGroupView({ ...data, teachingGroups: [] }, accountId, 'demo', group), null); assert.equal(readInventoryView(key, scope), before);
});

test('task editor keeps the web default and phone title first with complete collapsed help and compact actions', async t => {
  const priorStorage = globalThis.sessionStorage, device = storage(); globalThis.sessionStorage = device; t.after(() => { globalThis.sessionStorage = priorStorage; });
  async function mount(phonePresentation, recovered = null) {
    const h = hooks(), Component = await component('../../components/inventory/tasks/task-plan-editor.tsx', 'TaskPlanEditor', { ...h, ...taskSchedule,
      styles: new Proxy({}, { get: (_, key) => String(key) }), window: new EventTarget(), getRolePermissions: () => ({ manageTaskPlans: true }), currentSydneyDate: () => '2026-10-13', defaultInventoryFilter,
      recoverTaskCreate: () => recovered, taskCreateStorageKey: () => 'create-key', getFilteredBatteries: () => ({ batteries: [], error: '' }), isSelectableRoom: () => false,
      taskCategoryLabels: { custom: 'Custom task' }, targetSummary: () => '', assignmentNames: () => '', targetLabels: {}, staffIdentityLabel: () => '', roomLabel: () => '', formatDateOnly: value => value || 'Not selected' });
    const props = { phonePresentation, original: taskSchedule.createCustomTaskPlan(), data: { user: { id: 'native-account', role: 'admin' }, dataset: 'demo', batteries: [], rooms: [], staffDirectory: [], purgedBatteries: [] }, cycles: [], onClose() {}, async onSaved() {} };
    return { h, Component, props, tree: h.render(() => Component(props)) };
  }
  const ordinary = await mount(undefined), phone = await mount(true);
  assert.equal(nodes(ordinary.tree).find(node => node.type === 'DialogContent').props['data-phone-plan-presentation'], undefined);
  const ordinaryBody = nodes(ordinary.tree).find(node => node.props.className === 'body'); assert.equal(nodes(ordinaryBody).find(node => node.type === 'p').props.className, 'formGuide');
  const body = nodes(phone.tree).find(node => node.props.className === 'body'), help = nodes(body).find(node => node.props['data-phone-plan-help']);
  assert.equal(nodes(body).filter(node => node.type === 'Input' && node.props.id === 'task-title').length, 1);
  assert.ok(nodes(body).findIndex(node => node.props.id === 'task-title') < nodes(body).findIndex(node => node.type === 'Select'), 'Phone title precedes task-type instructions');
  assert.equal(help.props.open, undefined); assert.match(text(help), /assigned staff accounts must be active before any save/); assert.match(text(help), /previously selected deleted Battery IDs/); assert.match(text(help), /without generating reminders/);
  const footer = nodes(phone.tree).find(node => node.props.className === 'footer'); assert.equal(nodes(footer).some(node => node.type === 'p'), false); assert.ok(text(footer).includes('Review plan')); assert.ok(text(footer).includes('Create draft'));
  nodes(body).find(node => node.props.id === 'task-title').props.onChange({ target: { value: 'Phone draft title' } });
  phone.tree = phone.h.render(() => phone.Component(phone.props)); assert.equal(nodes(phone.tree).find(node => node.props.id === 'task-title').props.value, 'Phone draft title');
  const recovered = { status: 'uncertain', message: 'Retry this retained request.', input: { requestId: crypto.randomUUID(), payload: { ...taskSchedule.createCustomTaskPlan(), title: 'Retained task' } } }, retained = await mount(true, recovered);
  assert.equal(nodes(retained.tree).find(node => node.props.id === 'task-title').props.disabled, true); assert.ok(text(retained.tree).includes(recovered.input.requestId)); assert.match(text(retained.tree), /Retry original task creation/);
  const cancel = nodes(retained.tree).find(node => node.type === 'Button' && text(node) === 'Cancel'); assert.equal(cancel.props.disabled, true);
  assert.ok(nodes(retained.tree).find(node => node.props.role === 'alert')); ordinary.h.cleanup(); phone.h.cleanup(); retained.h.cleanup();
});

test('Dialog and Sheet presentation use their nearest React context without assigning sibling tasks', async () => {
  const primitive = tag => function Primitive({ children, ...props }) { return React.createElement(tag, props, children); };
  const primitives = { Root: primitive('div'), Trigger: primitive('button'), Portal: primitive('section'), Close: primitive('button'), Overlay: primitive('div'), Content: primitive('article'), Title: primitive('h2'), Description: primitive('p') };
  const dialog = await component('../../components/ui/dialog.tsx', '{ DialogContent, DialogPresentationProvider, useDialogPresentationTask }', { React, DialogPrimitive: primitives, cn: (...values) => values.filter(Boolean).join(' '), useOverlayFocus: () => ({}) });
  const sheet = await component('../../components/ui/sheet.tsx', 'SheetContent', { React, SheetPrimitive: primitives, cn: (...values) => values.filter(Boolean).join(' '), useOverlayFocus: () => ({}), useDialogPresentationTask: dialog.useDialogPresentationTask });
  const Default = React.createElement(dialog.DialogContent, { showCloseButton: false }, 'Ordinary web content');
  assert.equal(renderToStaticMarkup(Default).includes('data-phone-task'), false);
  const tree = React.createElement(React.Fragment, null,
    React.createElement(dialog.DialogPresentationProvider, { value: 'plan-editor' }, React.createElement(dialog.DialogContent, { showCloseButton: false }, 'Plan'), React.createElement(dialog.DialogPresentationProvider, { value: 'export' }, React.createElement(sheet, { showCloseButton: false }, 'Nested export'))),
    React.createElement(dialog.DialogPresentationProvider, { value: 'group-definition' }, React.createElement(dialog.DialogContent, { showCloseButton: false }, 'Group')), Default);
  const markup = renderToStaticMarkup(tree);
  assert.equal((markup.match(/data-phone-task="plan-editor"/g) ?? []).length, 1); assert.equal((markup.match(/data-phone-task="export"/g) ?? []).length, 1); assert.equal((markup.match(/data-phone-task="group-definition"/g) ?? []).length, 1);
  assert.equal(renderToStaticMarkup(React.createElement(sheet, { showCloseButton: false }, 'Ordinary web sheet')).includes('data-phone-task'), false);
});

test('native plan recovery retries only the captured request after a lost response and clears only a verified receipt', async t => {
  const priorWindow = globalThis.window, device = storage(), accountId = 'native-account';
  globalThis.window = { __batteryWorkflowStorage: device }; t.after(() => { globalThis.window = priorWindow; });
  const input = { dataset: 'demo', action: 'remove', payload: { id: crypto.randomUUID(), expectedVersion: 3 }, requestId: crypto.randomUUID() };
  saveTaskRecordAction('plans', accountId, input); const raw = JSON.stringify(device.entries()), sent = []; let fail = true;
  const h = hooks(), data = { user: { id: accountId, role: 'admin' }, dataset: 'demo', events: [] };
  const Component = await component('../src/features/workspace/mobile-tasks.jsx', 'MobileTasks', { ...h, workspaceStateKey, readTaskRecordAction, saveTaskRecordAction, verifyTaskRecordActionReceipt, acknowledgeTaskRecordAction, taskRecordActionFinallyRejected, businessStorage: () => device, taskCreateStorageKey: () => 'creation:none', recoverTaskCreate: () => null, taskCompletionRecovery: () => ({ attempt: null, error: '' }), getRolePermissions: () => ({ manageTaskPlans: true }), useTaskEndpoint: () => ({ payload: { plans: [], cycles: [] }, loading: false, error: '', refresh() {} }), taskRequest: async (_path, options) => { sent.push(options.body); if (fail) throw new Error('Controlled lost response'); return { result: { id: input.payload.id, version: 4, requestId: input.requestId, action: 'remove', actorAccountId: accountId, dataset: 'demo', removedAt: '2026-10-13T00:00:00.000Z' } }; } });
  let tree = h.render(() => Component({ data }));
  const retry = nodes(tree).find(node => node.type === 'Pressable' && text(node) === 'Check original plan request').props.onClick;
  await Promise.all([retry(), retry()]); assert.equal(sent.length, 1, 'Rapid presses before a React render share the original retry flight');
  assert.equal(JSON.stringify(device.entries()), raw); fail = false;
  tree = h.render(() => Component({ data }));
  await nodes(tree).find(node => node.type === 'Pressable' && text(node) === 'Check original plan request').props.onClick();
  assert.deepEqual(sent, [JSON.stringify(input), JSON.stringify(input)]); assert.equal(readTaskRecordAction('plans', accountId, 'demo').input, null); h.cleanup();
});
