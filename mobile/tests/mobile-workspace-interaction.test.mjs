import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { jsx, jsxs, Fragment } from 'react/jsx-runtime';
import { workspaceStateKey } from '../src/features/workspace/phone-view-state.mjs';

async function sourceComponent(file, component, supplied = {}, sourceUrl = new URL(`../src/features/workspace/${file}`, import.meta.url)) {
  const source = await readFile(sourceUrl, 'utf8');
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.JSX);
  assert.deepEqual(parsed.parseDiagnostics, [], `${file} must parse`);
  const imports = {};
  for (const item of parsed.statements.filter(ts.isImportDeclaration)) for (const binding of item.importClause?.namedBindings?.elements ?? []) imports[binding.name.text] = binding.name.text;
  const code = ts.transpileModule(parsed.statements.filter(item => !ts.isImportDeclaration(item)).map(item => item.getFullText(parsed)).join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } }).outputText.replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
  const bindings = { ...imports, workspaceStateKey, useRef: value => ({current:value}), usePhoneContentMotion() {}, ...supplied };
  return new Function(...Object.keys(bindings), '_jsx', '_jsxs', '_Fragment', `${code}\nreturn ${component};`)(...Object.values(bindings), jsx, jsxs, Fragment);
}
function all(tree, predicate) {
  if (Array.isArray(tree)) return tree.flatMap(node => all(node, predicate));
  if (!tree || typeof tree !== 'object') return [];
  return [...(predicate(tree) ? [tree] : []), ...all(tree.props?.children, predicate)];
}
function text(tree) {
  if (Array.isArray(tree)) return tree.map(text).join('');
  if (tree === null || tree === undefined || typeof tree === 'boolean') return '';
  return typeof tree === 'object' ? text(tree.props?.children) : String(tree);
}
function hooks(memory = new Map()) {
  const values = []; let pointer = 0;
  return { memory, reset() { pointer = 0; }, useState(initial) { const key = pointer++; if (!(key in values)) values[key] = typeof initial === 'function' ? initial() : initial; return [values[key], next => { values[key] = typeof next === 'function' ? next(values[key]) : next; }]; }, useRef(value) { const key = pointer++; if (!(key in values)) values[key] = { current: value }; return values[key]; }, useCallback: callback => callback, useEffect() {}, useWorkflowLock() {}, usePhoneBack() {}, usePhoneViewState(key, field, initial) { const id = `${key}:${field}`; if (!memory.has(id)) memory.set(id, typeof initial === 'function' ? initial() : initial); return [memory.get(id), next => memory.set(id, typeof next === 'function' ? next(memory.get(id)) : next)]; }, usePhoneFormDraft({ accountId, dataset, kind, recordId, initial }) { const key = `form:${workspaceStateKey(accountId, dataset, `${kind}:${recordId}`)}`; if (!memory.has(key)) memory.set(key, typeof initial === 'function' ? initial() : initial); return { value: memory.get(key), error: '', pending: false, clearing: false, restored: false, setValue(next) { memory.set(key, typeof next === 'function' ? next(memory.get(key)) : next); }, async save() {}, async clear(next) { if (next !== undefined) memory.set(key, next); }, async retry() {} }; } };
}

test('workspace account drafts retain nonsecret edits and original version across return, never passwords', async () => {
  const memory = new Map();
  const user = { id: 'native-staff', username: 'staff', displayName: 'Original name', email: '', defaultDataset: 'demo', role: 'staff', active: true, version: 4 };
  async function mount(account = user, dataset = 'demo') {
    const state = hooks(memory);
    const Form = await sourceComponent('mobile-account.jsx', 'AccountForm', state);
    return { render() { state.reset(); return Form({ account, currentUser: user, inventoryDataset: dataset, own: true }); } };
  }
  const first = await mount();
  let tree = first.render();
  const name = all(tree, node => node.type === 'input' && node.props.autoComplete === 'name')[0];
  name.props.onChange({ target: { value: 'Edited name' } });
  all(tree, node => node.type === 'input' && node.props.autoComplete === 'current-password')[0].props.onChange({ target: { value: 'Private secret value' } });
  tree = (await mount({ ...user, displayName: 'Concurrent saved name', version: 5 })).render();
  assert.equal(all(tree, node => node.type === 'input' && node.props.autoComplete === 'name')[0].props.value, 'Edited name');
  assert.equal(all(tree, node => node.type === 'input' && node.props.autoComplete === 'current-password')[0].props.value, '');
  assert.equal(memory.get(`${workspaceStateKey(user.id, 'demo', `account-form:profile:${user.id}`)}:expectedVersion`), 4);
  assert.equal(memory.get(`form:${workspaceStateKey(user.id, 'demo', `profile:${user.id}`)}`).expectedVersion, 4);
  assert.equal([...memory.values()].some(value => JSON.stringify(value)?.includes('Private secret value')), false);
  assert.equal(all((await mount(user, 'live')).render(), node => node.type === 'input' && node.props.autoComplete === 'name')[0].props.value, 'Original name');
});

test('workspace read failure keeps concise feedback and original technical cause available', async () => {
  const State = await sourceComponent('phone-controls.jsx', 'PhoneResourceState');
  const cause = 'Controlled native transport exception 503';
  const tree = State({ error: cause, retained: true, onRetry() {} });
  const status=all(tree,node=>node.props.className==='mobile-phone-resource-status')[0];
  assert.equal(status.props.role, 'alert');
  assert.match(text(status.props.children[0]), /Couldn't refresh/);
  assert.ok(all(tree, node => node.type === 'details').some(node => text(node).includes(cause)));
  assert.equal(text(State({ loading: true, retained: true })), 'Updating…');
  const emptyText='No tasks to complete.';
  for(const status of [{loading:true},{error:cause},{loading:false}]){
    const retained=State({...status,retained:true,empty:true,emptyText,onRetry(){}});
    assert.ok(text(retained).includes(emptyText),'The retained empty result survives both refresh and stale feedback');
    assert.ok(all(retained,node=>node.props.className==='mobile-phone-resource-status').length);
  }
  assert.equal(text(State({loading:true,empty:true,emptyText})).includes(emptyText),false);
  assert.equal(text(State({error:cause,empty:true,emptyText,onRetry(){}})).includes(emptyText),false);
});

test('unsent completion notes survive dialog return while captured request notes remain authoritative', async () => {
  const memory = new Map(), previousWindow = globalThis.window;
  globalThis.window = { __batteryWorkflowStorage: {} };
  const cycle = { id: crypto.randomUUID(), version: 2, title: 'Recorded review', category: 'custom', status: 'open', canComplete: true, planRemoved: false, dueOn: '2026-10-12', description: 'Check the recorded equipment condition.', targetSnapshot: {}, batteryIds: [], currentAssigneeIds: [], basis: 'Recorded requirement', scopeNote: 'Inventory', reminderStatus: 'pending' };
  const data = { user: { id: 'native-staff' }, dataset: 'demo' };
  async function mount(attempt = null) {
    const state = hooks(memory);
    const Component = await sourceComponent('mobile-task-cycle.jsx', 'MobileTaskCycleDialog', { ...state, readTaskCompletion: () => attempt, targetSummary: () => 'Inventory', assignmentNames: () => 'Assigned staff', taskCategoryLabels: { custom: 'Custom task' }, cycleState: () => 'Open', formatDateOnly: value => value, reminderLimitation: () => '' });
    return { render() { state.reset(); return Component({ cycle, data, onClose() {}, onSaved() {} }); } };
  }
  try {
    const first = await mount();
    let tree = first.render();
    const input = all(tree, node => node.type === 'textarea')[0];
    input.props.onChange({ target: { value: 'Unsubmitted findings' } });
    tree = (await mount()).render();
    assert.equal(all(tree, node => node.type === 'textarea')[0].props.value, 'Unsubmitted findings');
    assert.ok(text(tree).indexOf(cycle.description) < text(tree).indexOf('Completion notes'));
    const attempt = { reviewedCycle: cycle, input: { payload: { notes: 'Captured original findings' } } };
    tree = (await mount(attempt)).render();
    const retained = all(tree, node => node.type === 'textarea')[0];
    assert.equal(retained.props.value, 'Captured original findings');
    assert.equal(retained.props.disabled, true);
    assert.equal(attempt.input.payload.notes, 'Captured original findings');
    const title = all(tree, node => node.type === 'DialogTitle')[0];
    let focused = false, prevented = false;
    title.props.ref.current = { focus: options => { focused = options.preventScroll; } };
    all(tree, node => node.type === 'DialogContent')[0].props.onOpenAutoFocus({ preventDefault: () => { prevented = true; } });
    assert.equal(prevented, true); assert.equal(focused, true);
    memory.set(`form:${workspaceStateKey(data.user.id, data.dataset, `task-notes:${cycle.id}`)}`, { cycleId: cycle.id, expectedVersion: 1, notes: 'Earlier reviewed findings' });
    const stale = await mount();
    tree = stale.render();
    all(tree, node => node.type === 'input' && node.props.type === 'checkbox')[0].props.onChange({ target: { checked: true } });
    tree = stale.render();
    assert.match(text(tree), /older task review/);
    assert.equal(all(tree, node => node.type === 'Button' && text(node) === 'Record completion')[0].props.disabled, true);
  } finally { globalThis.window = previousWindow; }
});

test('routine task loading or read failure cannot invent a retained write recovery alert', async () => {
  for (const resource of [{ loading: true, error: '', payload: null }, { loading: false, error: 'Read failed', payload: { plans: [], cycles: [] } }]) {
    const state = hooks(), Component = await sourceComponent('mobile-tasks.jsx', 'MobileTasks', { ...state, useTaskEndpoint: () => ({ ...resource, refresh() {} }), taskCompletionRecovery: () => ({ attempt: null, error: '' }), readTaskRecordAction: () => ({ input: null, error: '' }), getRolePermissions: () => ({ manageTaskPlans: false }) });
    state.reset();
    const tree = Component({ data: { user: { id: 'native-staff', role: 'staff' }, dataset: 'demo', events: [] } });
    assert.doesNotMatch(text(tree), /original result resolved|Open task recovery/);
  }
});

test('completion review restores expanded requirements and scroll into replacement dialog content after an asset visit', async () => {
  const previousWindow = globalThis.window;
  globalThis.window = { __batteryWorkflowStorage: {} };
  const cycle = { id: crypto.randomUUID(), version: 2, title: 'Recorded review', category: 'custom', status: 'open', canComplete: true, planRemoved: false, dueOn: '2026-10-12', description: 'Check the recorded equipment condition.', targetSnapshot: { batteries: [{ id: 'BAT001', name: 'Reviewed battery' }] }, batteryIds: ['BAT001'], currentAssigneeIds: [], basis: 'Recorded requirement', scopeNote: 'Inventory', reminderStatus: 'pending' };
  const state = hooks(), visited = [];
  const Component = await sourceComponent('mobile-task-cycle.jsx', 'MobileTaskCycleDialog', { ...state, readTaskCompletion: () => null, targetSummary: () => 'Inventory', assignmentNames: () => 'Assigned staff', taskCategoryLabels: { custom: 'Custom task' }, cycleState: () => 'Open', formatDateOnly: value => value, reminderLimitation: () => '' });
  const props = { cycle, data: { user: { id: 'native-staff' }, dataset: 'demo' }, onClose() { assert.fail('Child navigation must retain the review.'); }, onSaved() { assert.fail('An asset visit must not complete the task.'); }, onDetail: id => visited.push(id) };
  function render(active) { state.reset(); return Component({ ...props, active }); }
  const body = tree => all(tree, node => node.props?.className === 'mobile-task-cycle-body')[0];
  const requirements = tree => all(tree, node => node.type === 'details' && node.props.className === 'mobile-task-requirements')[0];
  try {
    let tree = render(true);
    const originalBody = { scrollTop: 0 }, originalSurface = { scrollTop: 0 }, originalDisclosure = { open: false };
    body(tree).props.ref(originalBody);
    all(tree, node => node.type === 'DialogContent')[0].props.ref(originalSurface);
    requirements(tree).props.ref.current = originalDisclosure;
    all(tree, node => node.type === 'textarea')[0].props.onChange({ target: { value: 'Keep this unsubmitted observation.' } });
    originalDisclosure.open = true;
    requirements(tree).props.onToggle({ currentTarget: originalDisclosure });
    tree = render(true);
    assert.equal(requirements(tree).props.open, true);
    originalBody.scrollTop = 310;
    body(tree).props.onScroll({ currentTarget: originalBody });
    // Capture the final scroll position even before its asynchronous scroll event.
    originalBody.scrollTop = 344;
    originalSurface.scrollTop = 76;
    all(tree, node => node.type === 'Pressable' && text(node) === 'BAT001')[0].props.onClick();
    assert.deepEqual(visited, ['BAT001']);
    tree = render(false);
    assert.equal(tree.props.open, false);
    body(tree).props.onScroll({ currentTarget: { scrollTop: 0 } });
    body(tree).props.ref(null);
    all(tree, node => node.type === 'DialogContent')[0].props.ref(null);
    requirements(tree).props.ref.current = null;
    // Radix recreates the dialog DOM, while the review component remains mounted.
    tree = render(true);
    const replacementBody = { scrollTop: 0 };
    const replacementSurface = { scrollTop: 0 };
    body(tree).props.ref(replacementBody);
    all(tree, node => node.type === 'DialogContent')[0].props.ref(replacementSurface);
    assert.equal(replacementBody.scrollTop, 344);
    assert.equal(replacementSurface.scrollTop, 76);
    assert.equal(requirements(tree).props.open, true);
    assert.equal(all(tree, node => node.type === 'textarea')[0].props.value, 'Keep this unsubmitted observation.');
    assert.equal(all(tree, node => node.type === 'input' && node.props.type === 'checkbox')[0].props.checked, false);
    let prevented = false, focusOptions;
    all(tree, node => node.type === 'DialogTitle')[0].props.ref.current = { focus: options => { focusOptions = options; } };
    all(tree, node => node.type === 'DialogContent')[0].props.onOpenAutoFocus({ preventDefault: () => { prevented = true; } });
    assert.equal(prevented, true);
    assert.deepEqual(focusOptions, { preventScroll: true });
    assert.equal(replacementBody.scrollTop, 344);
    assert.equal(replacementSurface.scrollTop, 76);
  } finally { globalThis.window = previousWindow; }
});

test('canonical and mobile plan details retain body and dialog scroll while default web opening remains unchanged', async () => {
  const versions = [
    ['task-plan-details.tsx', new URL('../../components/inventory/tasks/task-plan-details.tsx', import.meta.url)],
    ['task-plan-details.js', new URL('../src/shared/components/inventory/tasks/task-plan-details.js', import.meta.url)],
  ];
  const plan = { id: crypto.randomUUID(), title: 'Recorded shared plan', category: 'custom', interval: 1, unit: 'weeks', state: 'active', recurrenceBasis: 'dates', scheduledDates: ['2026-10-12'], batteryIds: ['BAT001'], description: 'Review stored batteries.', applicabilityConfirmed: true, reminderDaysBefore: 0, reminderTime: '09:00', updatedAt: '2026-10-12T00:00:00Z' };
  for (const [file, sourceUrl] of versions) {
    const state = hooks(), visited = [];
    const Component = await sourceComponent(file, 'TaskPlanDetails', { ...state, targetSummary: () => 'Inventory', assignmentNames: () => 'Assigned staff', taskCategoryLabels: { custom: 'Custom task' }, formatDateOnly: value => value, formatTime: value => value }, sourceUrl);
    const props = { plan, data: {}, onClose() { assert.fail('Child navigation must retain plan details.'); }, onDetail: id => visited.push(id) };
    function render(active) { state.reset(); return Component({ ...props, ...(active === undefined ? {} : { active }) }); }
    const body = tree => all(tree, node => node.props?.className === 'task-cycle-body')[0];
    const surface = tree => all(tree, node => node.type === 'DialogContent')[0];
    let tree = render();
    assert.equal(tree.props.open, true, `${file}: existing web callers open normally without active`);
    let defaultPrevented = false;
    surface(tree).props.onOpenAutoFocus({ preventDefault: () => { defaultPrevented = true; } });
    assert.equal(defaultPrevented, false, `${file}: default web opening keeps its established focus policy`);
    const originalBody = { scrollTop: 280 }, originalSurface = { scrollTop: 48 };
    body(tree).props.ref(originalBody); surface(tree).props.ref(originalSurface);
    originalBody.scrollTop = 280; originalSurface.scrollTop = 48;
    all(tree, node => node.type === 'Button' && text(node) === 'BAT001')[0].props.onClick();
    assert.deepEqual(visited, ['BAT001']);
    tree = render(false);
    assert.equal(tree.props.open, false);
    body(tree).props.onScroll({ currentTarget: { scrollTop: 0 } });
    surface(tree).props.onScroll({ currentTarget: { scrollTop: 0 } });
    body(tree).props.ref(null); surface(tree).props.ref(null);
    tree = render(true);
    let focusOptions;
    const replacementBody = { scrollTop: 0 }, replacementSurface = { scrollTop: 0, focus: options => { focusOptions = options; } };
    body(tree).props.ref(replacementBody); surface(tree).props.ref(replacementSurface);
    surface(tree).props.onOpenAutoFocus({ preventDefault: () => { defaultPrevented = true; } });
    assert.equal(defaultPrevented, true);
    assert.deepEqual(focusOptions, { preventScroll: true });
    assert.equal(replacementBody.scrollTop, 280, `${file}: replacement body restores the reading position`);
    assert.equal(replacementSurface.scrollTop, 48, `${file}: responsive outer scroller restores its position`);
    assert.match(text(tree), /Review stored batteries\./);
  }
});

test('the mobile task list keeps plan details mounted but closed during a child asset visit', async () => {
  const state = hooks(), plan = { id: crypto.randomUUID(), title: 'Retained plan', category: 'custom', state: 'active', preview: { nextDueOn: '2026-10-12' }, assigneeIds: [] };
  const Component = await sourceComponent('mobile-tasks.jsx', 'MobileTasks', { ...state, useTaskEndpoint: () => ({ loading: false, error: '', payload: { plans: [plan], cycles: [] }, refresh() {} }), taskCompletionRecovery: () => ({ attempt: null, error: '' }), readTaskRecordAction: () => ({ input: null, error: '' }), getRolePermissions: () => ({ manageTaskPlans: false }), taskPlanMatchesQuery: () => true, targetSummary: () => 'Inventory', assignmentNames: () => 'Assigned staff', taskCategoryLabels: { custom: 'Custom task' }, formatDateOnly: value => value });
  function render(active) { state.reset(); return Component({ active, data: { user: { id: 'native-staff', role: 'staff' }, dataset: 'demo', events: [] } }); }
  let tree = render(true);
  all(tree, node => node.props?.className === 'mobile-task-main')[0].props.onClick();
  tree = render(false);
  const retained = all(tree, node => node.type === 'TaskPlanDetails')[0];
  assert.ok(retained);
  assert.equal(retained.props.active, false);
  assert.equal(retained.props.plan, plan);
  tree = render(true);
  assert.equal(all(tree, node => node.type === 'TaskPlanDetails')[0].props.active, true);
});

test('teaching group name remains visible in Members and Actual checkouts', async () => {
  const state = hooks(), Component = await sourceComponent('mobile-teaching-group.jsx', 'MobileTeachingGroupDetail', { ...state, useTaskEndpoint: () => ({ loading: false, error: '', payload: { runs: [] }, refresh() {} }), parseOwnTeachingRuns: () => [], getRolePermissions: () => ({ editBatteryRecords: false }) });
  const group = { id: crypto.randomUUID(), name: 'Reviewed workshop group', batteryIds: [], version: 1 }, user = { id: 'native-staff' };
  function render() { state.reset(); return Component({ group, user, dataset: 'demo', data: { events: [], batteries: [] }, ready: true }); }
  let tree = render();
  assert.ok(all(tree, node => node.props?.className === 'mobile-phone-purpose').some(node => text(node).includes(group.name)), 'Current teaching group remains explicit in the purpose line');
  all(tree, node => node.type === 'PhoneTabs')[0].props.onChange('actual');
  tree = render();
  assert.ok(all(tree, node => node.props?.className === 'mobile-phone-purpose').some(node => text(node).includes(group.name)), 'Current teaching group remains explicit in the purpose line');
});

test('workspace chunk controls only appear when needed and deliberately return to results', async () => {
  const Pagination = await sourceComponent('phone-controls.jsx', 'PhonePagination');
  assert.equal(Pagination({ page: 0, count: 0, onPage() {} }), null);
  assert.equal(Pagination({ page: 0, count: 25, onPage() {} }), null);
  const calls = [], result = { getClientRects: () => [1], scrollIntoView: options => calls.push(options) };
  const previousFrame = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = callback => callback();
  try {
    const tree = Pagination({ page: 0, count: 60, onPage: page => calls.push(page) });
    const next = all(tree, node => node.props?.['aria-label'] === 'Next page')[0];
    next.props.onClick({ currentTarget: { closest: () => ({ querySelectorAll: () => [result] }) } });
    assert.equal(calls[0], 1);
    assert.deepEqual(calls[1], { block: 'start', behavior: 'instant' });
    assert.match(text(tree), /1–25 of 60/);
  } finally { globalThis.requestAnimationFrame = previousFrame; }
});
