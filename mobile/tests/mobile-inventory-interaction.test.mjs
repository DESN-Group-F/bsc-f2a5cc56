import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import * as model from '../src/features/inventory/inventory-model.mjs';
import * as interaction from '../src/features/inventory/inventory-interaction.mjs';
import * as query from '../src/shared/lib/inventory-query.js';
import * as lifecycle from '../src/shared/lib/battery-lifecycle.js';
import * as locations from '../src/shared/lib/location-catalog.js';
import * as mapping from '../src/shared/lib/inventory-mapping.js';
import { getRolePermissions } from '../src/shared/lib/permissions.js';
import { recentNewArrivals } from '../src/shared/lib/new-arrivals.js';
import { currentSydneyDate } from '../src/shared/lib/battery-age.js';
import { formatTime } from '../src/shared/lib/client-utils.js';
import { defaultMappingCamera, schematicRoomModules } from '../src/features/inventory/mapping-geometry.mjs';
import { visiblePhoneOverlays } from '../src/app/phone-interaction.mjs';

function fixture(count = 125) {
  const user = { id: crypto.randomUUID(), role: 'staff' };
  return { dataset: 'demo', user, rooms: [{ id: 'R1', name: 'Long room '.repeat(20), number: '001', buildingId: 'J18', selectable: true }], people: [], buildings: [], teachingGroups: [], staffDirectory: [],
    batteries: Array.from({ length: count }, (_, index) => ({ id: `BAT-${String(index).padStart(4, '0')}`, name: `Long laboratory battery ${index} ` + 'name '.repeat(30), model: '', chemistry: '', capacityMah: null, voltage: null, tagId: null, version: 1, ownerAccountId: user.id, ownerName: 'Long owner '.repeat(20), ownerId: 'owner', homeBuildingId: 'J18', homeRoomId: 'R1', loanId: null, borrowerKind: null, borrowerAccountId: null, manufacturedOn: null, firstUsedOn: null, chargedAt: null, observedAt: '2026-10-12T04:00:00.000Z', observedRoomId: 'R1', observedRoom: 'Saved room label', observationRoomSnapshot: 'recorded', observationSource: 'simulated', lifecycleStatus: 'active' })) };
}

const nodes = tree => !tree || typeof tree !== 'object' ? [] : [tree, ...[tree.props?.children].flat(Infinity).flatMap(nodes)];
const text = tree => tree == null || tree === false ? '' : typeof tree !== 'object' ? String(tree) : [tree.props?.children].flat(Infinity).map(text).join('');
const button = (tree, label) => nodes(tree).find(node => node.type === 'button' && (node.props['aria-label'] === label || text(node) === label));

/** Execute the real transpiled JSX and handlers with controlled hooks/DOM, not a duplicate UI implementation. */
async function componentHarness(file, names, extra = {}) {
  const source = await readFile(new URL(file, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } }).outputText.replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
  const hooks = [], pending = [], frames = new Map(), draws = [], captures = new Set(), elements = new Map(); let cursor = 0, frame = 0;
  const owner = new EventTarget(); owner.scrollTop = 0; owner.dataset = {}; owner.getBoundingClientRect = () => ({ top: 0 });
  const trigger = { isConnected: true, getClientRects: () => [{}], closest: () => null, focus() { document.activeElement = trigger; } };
  const document = { activeElement: trigger, scrollingElement: owner, visibilityState: 'visible',querySelectorAll:()=>[], addEventListener: owner.addEventListener.bind(owner), removeEventListener: owner.removeEventListener.bind(owner) };
  const makeElement = className => {
    if (elements.has(className)) return elements.get(className);
    const element = new EventTarget();
    Object.assign(element, { open: false, dataset: {}, isConnected: true, closest: () => owner, getClientRects: () => [{}], getBoundingClientRect: () => ({ top: className === 'mi-list-caption' ? 180 - owner.scrollTop : 0, left: 0, right: 390, bottom: 844, width: 390, height: 340 }), focus() { document.activeElement = element; }, showModal() { element.open = true; document.activeElement = element; }, close() { element.open = false; }, setPointerCapture: id => captures.add(id), hasPointerCapture: id => captures.has(id), releasePointerCapture: id => captures.delete(id) });
    elements.set(className, element); return element;
  };
  const effect = (run, deps) => {
    const index = cursor++, prior = hooks[index];
    if (!prior || !deps || deps.some((value, i) => !Object.is(value, prior.deps?.[i]))) { hooks[index] = { deps, cleanup: prior?.cleanup }; pending.push(() => { hooks[index].cleanup?.(); hooks[index].cleanup = run(); }); }
  };
  const bindings = {
    ...model, ...interaction, ...query, ...lifecycle, ...locations, ...mapping, getRolePermissions, recentNewArrivals, currentSydneyDate, formatTime, defaultMappingCamera, schematicRoomModules,visiblePhoneOverlays, iosPresentation:false,
    PhoneTaskDialog: 'phone-task-dialog', React: { Fragment: 'fragment', useId: () => 'test-title', useCallback: callback => callback, createContext(value) { const context = { value }; context.Provider = { context }; return context; }, useContext: context => context.value }, MappingScene: 'mapping-scene', TemporalInput: 'temporal-input',
    inventoryScrollOwner: element => interaction.inventoryScrollOwner(element, document),
    window: { getSelection: () => null, matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) }, document,
    useState(initial) { const index = cursor++; hooks[index] ??= { value: typeof initial === 'function' ? initial() : initial }; return [hooks[index].value, next => { hooks[index].value = typeof next === 'function' ? next(hooks[index].value) : next; }]; },
    useRef(initial) { return hooks[cursor++] ??= { current: initial }; }, useMemo: run => run(), useEffect: effect, useLayoutEffect: effect, usePhoneBack() {}, usePhoneContentMotion() {}, usePhoneReducedMotion: () => false, usePhoneContext: () => null,
    requestAnimationFrame: run => { frames.set(++frame, run); return frame; }, cancelAnimationFrame: id => frames.delete(id),
    ResizeObserver: class { observe() {} disconnect() {} },
    createMappingRenderer: () => ({ draw: camera => draws.push(structuredClone(camera)), pick: () => 'R1', dispose() {} }),
    ...Object.fromEntries(['Battery', 'Check', 'ChevronLeft', 'ChevronRight', 'Download', 'Filter', 'ListChecks', 'MoreHorizontal', 'Plus', 'Search', 'X', 'Building2', 'ChevronDown', 'Minus', 'RotateCcw', 'MapPin', 'List', 'SlidersHorizontal'].map(name => [name, `icon-${name}`])),
    ...extra,
  };
  const jsx = (type, props) => ({ type, props }), keys = Object.keys(bindings);
  const components = new Function(...keys, '_jsx', '_jsxs', '_Fragment', `${compiled}\nreturn {${names.join(',')}};`)(...keys.map(key => bindings[key]), jsx, jsx, 'fragment');
  return { owner, document, trigger, draws, captures, elements, render(name, props) {
    cursor = 0; const tree = components[name](props);
    for (const node of nodes(tree)) {
      if (node.type?.context) node.type.context.value = node.props.value;
      if (typeof node.props.ref === 'function') node.props.ref(makeElement(node.props.className));
      else if (node.props.ref && !node.props.ref.current) node.props.ref.current = makeElement(node.props.className);
    }
    for (const run of pending.splice(0)) run(); return tree;
  }, step() { for (const [id, run] of [...frames]) { frames.delete(id); run(performance.now()); } }, close() { for (const hook of hooks) hook?.cleanup?.(); } };
}

test('actual inventory handles 125 long-name assets in exact 25-record pages and keeps selection across filters', async () => {
  const harness = await componentHarness('../src/features/inventory/inventory.jsx', ['InventoryScreen']), data = fixture(); let exported;
  const props = { data, user: data.user, dataset: data.dataset, onExport: value => { exported = value; } };
  let tree = harness.render('InventoryScreen', props);
  assert.equal(nodes(tree).filter(node => node.props.className?.includes('mi-record-main')).length, 25);
  assert.equal(nodes(tree).some(node => node.type === 'select' && node.props['aria-label'] === 'Rows per inventory page'), false);
  button(tree, 'Next').props.onClick(); tree = harness.render('InventoryScreen', props);
  assert.equal(harness.owner.scrollTop, 180, 'Deliberate page change returns to the result heading in the outer owner');
  button(tree, 'Select batteries').props.onClick(); tree = harness.render('InventoryScreen', props);
  button(tree, 'Select this page').props.onClick(); tree = harness.render('InventoryScreen', props);
  const key = model.inventoryViewKey(data.user.id, 'demo', null);
  assert.equal(model.readInventoryView(key, null).selectedIds.length, 25);
  const search = nodes(tree).find(node => node.type === 'input' && node.props.type === 'search');
  search.props.onChange({ target: { value: 'does not exist' } }); tree = harness.render('InventoryScreen', props);
  assert.ok(text(tree).includes('25 outside current filters'));
  assert.equal(model.readInventoryView(key, null).selectedIds.length, 25);
  button(tree, 'Inventory actions').props.onClick(); tree = harness.render('InventoryScreen', props);
  nodes(tree).find(node => node.type === 'button' && text(node).startsWith('Download batteries')).props.onClick();
  assert.equal(exported.pageSize, '25'); assert.equal(exported.matching, 0); assert.equal(exported.selectedIds.length, 25);
  assert.equal(exported.selectedIds[0], 'BAT-0025'); harness.close();
});

test('actual inventory remembers its outer scroll only while active, and empty scopes expose no useless selection bar', async () => {
  const harness = await componentHarness('../src/features/inventory/inventory.jsx', ['InventoryScreen']), data = fixture(0), scope = { kind: 'owner', id: data.user.id, label: 'My batteries' };
  const props = { data, user: data.user, dataset: 'demo', scope };
  let tree = harness.render('InventoryScreen', props); const key = model.inventoryViewKey(data.user.id, 'demo', scope);
  assert.ok(text(tree).includes('No active batteries under your responsibility')); assert.equal(nodes(tree).some(node => node.props.className === 'mi-selection-bar'), false);
  harness.owner.scrollTop = 360; harness.owner.dispatchEvent(new Event('scroll'));
  harness.render('InventoryScreen', { ...props, active: false }); harness.owner.scrollTop = 700; harness.owner.dispatchEvent(new Event('scroll'));
  assert.equal(model.readInventoryView(key, scope).scrollTop, 360);
  harness.render('InventoryScreen', props); assert.equal(harness.owner.scrollTop, 360); harness.close();
});

test('actual filter Clear stays pending until Apply and does not auto-focus a text input', async () => {
  const harness = await componentHarness('../src/features/inventory/inventory.jsx', ['FilterSheet']), data = fixture(0); let applied;
  const filter = { ...query.defaultInventoryFilter(), search: 'kept search', status: 'out' }, props = { data, scope: null, filter, onApply: value => { applied = value; }, onClose() {} };
  let tree = harness.render('FilterSheet', props);
  assert.equal(nodes(tree).some(node => node.type === 'input' && node.props.autoFocus), false);
  button(tree.props.footer, 'Clear filters').props.onClick(); tree = harness.render('FilterSheet', props);
  assert.equal(applied, undefined); assert.equal(filter.search, 'kept search');
  button(tree.props.footer, 'Apply filters').props.onClick(); assert.equal(applied.search, ''); assert.equal(applied.status, 'all'); harness.close();
});

test('actual inventory sheet supports shell dismissal, native cancel and focus return without submitting', async () => {
  const harness = await componentHarness('../src/features/inventory/inventory.jsx', ['Sheet']); let closed = 0;
  const tree = harness.render('Sheet', { title: 'Filter batteries', onClose: () => { closed++; } });
  assert.equal(tree.type, 'dialog'); assert.equal(tree.props.role, 'dialog'); assert.equal(tree.props['aria-modal'], 'true');
  harness.document.activeElement.dispatchEvent(new Event('battery-mobile-dismiss', { cancelable: true })); assert.equal(closed, 1);
  tree.props.onCancel({ preventDefault() {} }); assert.equal(closed, 2);
  harness.close(); assert.equal(harness.document.activeElement, harness.trigger);
});

test('actual Inventory Range receives the mounted sheet dialog as its calendar portal container', async () => {
  const harness = await componentHarness('../src/features/inventory/inventory.jsx', ['Sheet', 'Range']), props = { title: 'Filter batteries', onClose() {} };
  harness.render('Sheet', props); const dialog = harness.document.activeElement;
  harness.render('Sheet', props);
  const range = harness.render('Range', { name: 'checkout', title: 'Latest checkout date', draft: { checkoutMode: 'any', checkoutFrom: null, checkoutTo: null }, setDraft() {}, lowKey: 'checkoutFrom', highKey: 'checkoutTo', date: true });
  const fields = nodes(range).filter(node => node.type === 'temporal-input');
  assert.equal(fields.length, 2); assert.ok(fields.every(node => node.props.portalContainer === dialog));
  assert.ok(fields.every(node => node.props.pickerContentProps.collisionBoundary === dialog && node.props.pickerContentProps.collisionPadding === 8));
  assert.ok(fields.every(node => node.props.pickerContentProps.sticky === 'always' && node.props.pickerContentProps.className === 'mi-mobile-date-picker'));
  harness.close();
});

test('actual Inventory uses the shell title while retaining scope disclosure and standalone heading', async () => {
  const data = fixture(0), scope = { kind: 'owner', id: data.user.id, label: 'My batteries' };
  const shell = await componentHarness('../src/features/inventory/inventory.jsx', ['InventoryScreen'], { usePhoneContext: () => ({ namespace: 'test' }) });
  const props = { data, user: data.user, dataset: 'demo', scope };
  const tree = shell.render('InventoryScreen', props);
  assert.equal(nodes(tree).some(node => node.type === 'h1'), false);
  assert.equal(nodes(tree).find(node => node.props.className === 'mi-fixed-scope').props.children[0].props.children, 'My batteries');
  shell.close();
  const standalone = await componentHarness('../src/features/inventory/inventory.jsx', ['InventoryScreen']);
  assert.equal(nodes(standalone.render('InventoryScreen', props)).find(node => node.type === 'h1').props.children, 'My batteries'); standalone.close();
});

test('actual Mapping preserves page drags until deliberate interaction and disables picking after a drag or multi-touch', async () => {
  const harness = await componentHarness('../src/features/inventory/mapping-scene.jsx', ['MappingScene']), props = { data: fixture(1), memoryKey: crypto.randomUUID(), onRoom() {} };
  let tree = harness.render('MappingScene', props); harness.step();
  let canvas = nodes(tree).find(node => node.type === 'canvas'); const target = canvas.props.ref.current;
  const event = (id, x, y, type = 'pointermove') => ({ type, currentTarget: target, pointerId: id, clientX: x, clientY: y, stopPropagation() {} });
  const initial = harness.draws.at(-1);
  assert.ok(initial, 'The controlled Mapping renderer must initialize and draw before gesture assertions');
  canvas.props.onPointerDown(event(1, 50, 50, 'pointerdown')); canvas.props.onPointerMove(event(1, 70, 100)); canvas.props.onPointerUp(event(1, 70, 100, 'pointerup'));
  harness.step(); assert.deepEqual(harness.draws.at(-1), initial); assert.equal(harness.captures.size, 0);
  tree = harness.render('MappingScene', props); assert.equal(nodes(tree).some(node => node.props.className === 'mi-room-summary'), false);
  button(tree, 'Explore 3D').props.onClick(); tree = harness.render('MappingScene', props); canvas = nodes(tree).find(node => node.type === 'canvas');
  assert.ok(canvas.props.className.includes('is-interacting'));
  canvas.props.onPointerDown(event(2, 50, 50, 'pointerdown')); canvas.props.onPointerMove(event(2, 70, 100)); canvas.props.onPointerUp(event(2, 70, 100, 'pointerup')); harness.step();
  assert.notEqual(harness.draws.at(-1).yaw, initial.yaw);
  canvas.props.onPointerDown(event(3, 50, 50, 'pointerdown')); canvas.props.onPointerDown(event(4, 80, 50, 'pointerdown')); canvas.props.onPointerUp(event(4, 80, 50, 'pointerup')); canvas.props.onPointerUp(event(3, 50, 50, 'pointerup'));
  tree = harness.render('MappingScene', props); assert.equal(nodes(tree).some(node => node.props.className === 'mi-room-summary'), false);
  button(tree, 'Finish exploring').props.onClick(); tree = harness.render('MappingScene', props); assert.equal(nodes(tree).find(node => node.type === 'canvas').props.className, 'mi-scene'); harness.close();
});

test('record tap guard blocks scroll-arrest, drag and cancellation but accepts deliberate taps and keyboard detail activation', () => {
  let time = 1000, scroll = 950, prevented = 0;
  const guard = interaction.createInventoryTapGuard({ now: () => time, lastScrollAt: () => scroll }), event = detail => ({ detail, preventDefault() { prevented++; }, stopPropagation() {} });
  guard.down({ pointerId: 1, pointerType: 'touch', clientX: 10, clientY: 10 }); assert.equal(guard.click(event(1)), false);
  time = 1200; guard.down({ pointerId: 2, pointerType: 'touch', clientX: 10, clientY: 10 }); guard.move({ pointerId: 2, clientX: 10, clientY: 30 }); assert.equal(guard.click(event(1)), false);
  guard.down({ pointerId: 3, pointerType: 'touch', clientX: 10, clientY: 10 }); guard.cancel(); assert.equal(guard.click(event(1)), false);
  guard.down({ pointerId: 4, pointerType: 'touch', clientX: 10, clientY: 10 }); assert.equal(guard.click(event(1)), true);
  guard.cancel(); assert.equal(guard.click(event(0)), true); assert.equal(prevented, 3);
});

test('large scoped export retains full selected histories and invalidates records leaving the room boundary', () => {
  const data = fixture(), scope = { kind: 'room', id: 'R1' }, view = { ...model.initialInventoryView(scope), page: 4, selectedIds: ['BAT-0000', 'BAT-0124'] };
  const draft = model.inventoryExportDraft(data, data.user.id, scope, view, true);
  assert.equal(draft.matching, 125); assert.equal(draft.pageCount, 25); assert.equal(draft.page, 4); assert.equal(draft.filter.mappingRoom, 'R1'); assert.deepEqual(draft.selectedIds, view.selectedIds);
  data.batteries[0].observedRoomId = 'outside-map';
  assert.equal(model.inventoryBoundaryIds(data, data.user.id, scope).has('BAT-0000'), false);
  const summaries = model.mappingSummaries(data); assert.equal(summaries.find(room => room.id === mapping.UNKNOWN_MAPPING_ROOM).total, 1); assert.equal(summaries.find(room => room.id === 'R1').total, 124);
});


test('selection actions are preparation only and Finish selecting keeps an explicit retained selection', async () => {
  const harness = await componentHarness('../src/features/inventory/inventory.jsx', ['InventoryScreen', 'Sheet']), data = fixture(2), operations = [];
  const props = { data, user: data.user, dataset: 'demo', onOperation: (...args) => operations.push(args), onExport() {} };
  let tree = harness.render('InventoryScreen', props);
  button(tree, 'Select batteries').props.onClick(); tree = harness.render('InventoryScreen', props);
  button(tree, 'Select this page').props.onClick(); tree = harness.render('InventoryScreen', props);
  button(tree, 'Finish selecting').props.onClick(); tree = harness.render('InventoryScreen', props);
  assert.equal(model.readInventoryView(model.inventoryViewKey(data.user.id, 'demo', null)).selecting, false);
  assert.equal(model.readInventoryView(model.inventoryViewKey(data.user.id, 'demo', null)).selectedIds.length, 2);
  button(tree, 'Choose action').props.onClick(); tree = harness.render('InventoryScreen', props);
  const choice = nodes(tree).find(node => typeof node.type === 'function' && node.props.title === 'Actions for 2 batteries');
  assert.ok(choice); assert.equal(operations.length, 0);
  button({ props: { children: choice.props.children } }, 'Prepare checkout').props.onClick();
  assert.equal(operations.length,0,'A Sheet callback cannot enter the station before its close commit.');
  harness.render('InventoryScreen',props);harness.step();
  assert.equal(operations.length, 1); assert.equal(operations[0][0], 'checkout'); assert.deepEqual(operations[0][1], ['BAT-0000', 'BAT-0001']);
  harness.close();
});

test('portrait Mapping room-list choice opens a summary before its explicit room-record navigation', async () => {
  const harness = await componentHarness('../src/features/inventory/mapping-scene.jsx', ['MappingScene']), data = fixture(1), opened = [];
  const props = { data, memoryKey: crypto.randomUUID(), onRoom: value => opened.push(value) };
  let tree = harness.render('MappingScene', props); harness.step();
  const list = nodes(tree).find(node => node.props?.className === 'mi-room-list');
  nodes(list).find(node => node.type === 'button' && node.props['aria-pressed'] === false).props.onClick();
  tree = harness.render('MappingScene', props);
  const summary = nodes(tree).find(node => node.type === 'phone-task-dialog');
  assert.ok(summary); assert.equal(summary.props.title, 'Room summary'); assert.equal(opened.length, 0);
  assert.match(text(summary.props.children), /present location is not confirmed/);
  summary.props.actions.props.onClick();
  assert.deepEqual(opened, [{ kind: 'room', id: 'R1', label: data.rooms[0].name }]); harness.close();
});

test('wide Mapping keeps selected summary adjacent and renders missing observation once per record', async () => {
  const queries = new Map(), mappingQuery = '(min-width:620px) and (max-height:550px)';
  const window = { getSelection: () => null, matchMedia(query) { if (!queries.has(query)) queries.set(query, { matches: query === mappingQuery, listener: null, addEventListener(type, listener) { this.listener = listener; }, removeEventListener() {} }); return queries.get(query); } };
  const harness = await componentHarness('../src/features/inventory/mapping-scene.jsx', ['MappingScene'], { window }), data = fixture(2), opened = [];
  data.batteries.forEach(item => { item.observedAt = null; item.observedRoomId = null; item.observationSource = null; });
  const props = { data, memoryKey: crypto.randomUUID(), onRoom: value => opened.push(value) }; let tree = harness.render('MappingScene', props);
  const list = nodes(tree).find(node => node.props.className === 'mi-room-list');
  nodes(list).find(node => node.type === 'button' && text(node).includes('Unknown / outside this map')).props.onClick(); tree = harness.render('MappingScene', props);
  assert.equal(nodes(tree).some(node => node.type === 'phone-task-dialog'), false);
  const summary = nodes(tree).find(node => node.props.className === 'mi-room-summary'); assert.ok(summary); assert.equal((text(summary).match(/No observation recorded/g) ?? []).length, 2); assert.equal(opened.length, 0);
  queries.get(mappingQuery).matches = false; queries.get(mappingQuery).listener(); tree = harness.render('MappingScene', props);
  assert.ok(nodes(tree).some(node => node.type === 'phone-task-dialog'), 'Rotation reuses the selected room and narrow summary surface'); harness.close();
});

test('unavailable fixed group and foreign personal scopes retain filters and selection without crashing or permitting operations', async () => {
  for (const kind of ['deleted-group', 'archived-group', 'foreign-group', 'foreign-owner']) {
    const harness = await componentHarness('../src/features/inventory/inventory.jsx', ['InventoryScreen']), data = fixture(2), groupId = crypto.randomUUID();
    const group = { id: groupId, name: 'Retained teaching group', ownerAccountId: kind === 'foreign-group' ? 'other' : data.user.id, version: 2, state: kind === 'archived-group' ? 'archived' : 'active', batteryIds: data.batteries.map(item => item.id) };
    data.teachingGroups = kind === 'deleted-group' ? [] : [group];
    const scope = kind === 'foreign-owner' ? { kind: 'owner', id: 'other', label: 'Unavailable personal view' } : { kind: 'group', id: groupId, label: group.name };
    const key = model.inventoryViewKey(data.user.id, 'demo', scope), retained = { ...model.initialInventoryView(scope), filter: { ...model.initialInventoryView(scope).filter, search: 'retained filter' }, selectedIds: [data.batteries[0].id], selecting: true };
    model.rememberInventoryView(key, retained); let operations = 0;
    const tree = harness.render('InventoryScreen', { data, user: data.user, dataset: 'demo', scope, onOperation: () => { operations++; } });
    assert.ok(nodes(tree).some(node => node.props.role === 'alert')); assert.match(text(tree), /Records unavailable/); assert.equal(nodes(tree).some(node => node.props.className === 'mi-empty'), false);
    assert.equal(button(tree, 'Choose action').props.disabled, true); assert.equal(model.readInventoryView(key, scope).filter.search, 'retained filter'); assert.deepEqual(model.readInventoryView(key, scope).selectedIds, retained.selectedIds); assert.equal(operations, 0);
    const tabs = nodes(tree).find(node => node.props.className === 'mi-status-tabs'); assert.equal((text(tabs).match(/—/g) ?? []).length, 3); harness.close();
  }
});
