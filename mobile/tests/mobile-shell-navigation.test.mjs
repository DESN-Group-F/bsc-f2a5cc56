import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPhoneNavigation } from '../src/app/phone-navigation.mjs';
import { createPhoneBackRegistry, createPhoneEntryGate, createPhonePressIntent, topPhoneOverlay, dismissPhoneOverlay } from '../src/app/phone-interaction.mjs';

// Pure navigation/interaction behavior. These checks do not establish rendered
// scroll geometry, native keyboard dismissal or device touch acceptance.
const namespace = 'staff-a:demo';
const context = (patch = {}) => ({ namespace, routeKey: `${namespace}:inventory:2`, locked: false, ...patch });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

test('bottom areas remember independent page, detail, scope and scroll contexts', () => {
  const navigation = createPhoneNavigation(namespace);
  const inventory = navigation.push('inventory', { scope: { kind: 'owner', id: 'staff-a' } });
  navigation.rememberScroll(inventory.key, 438);
  const detail = navigation.push('inventory', { detail: { id: 'BAT-00000042', group: { id: 'private-group', version: 7 } }, scope: inventory.scope });
  navigation.rememberScroll(detail.key, 117);
  const group = navigation.push('workspace', { page: 'teaching-groups', pageContext: { activeGroupId: 'private-group' } });
  navigation.rememberScroll(group.key, 269);
  const messages = navigation.push('me', { page: 'messages', pageContext: { messageId: 'message-a', taskId: 'cycle-a' } });
  navigation.rememberScroll(messages.key, 83);
  for (const [area, route, scroll] of [['inventory', detail, 117], ['workspace', group, 269], ['me', messages, 83]]) {
    assert.equal(navigation.activate(area), true);
    assert.deepEqual(navigation.getSnapshot().current, route);
    assert.equal(navigation.getSnapshot().current.scroll, scroll);
  }
  assert.deepEqual(navigation.routesFor('inventory').map(route => route.scope).filter(Boolean), [inventory.scope, inventory.scope]);
});

test('tapping the selected area is a true no-op for route, selection scope, position and subscribers', () => {
  const navigation = createPhoneNavigation(namespace), route = navigation.push('inventory', { scope: { kind: 'ids', batteryIds: ['BAT-00000042'] }, pageContext: { search: 'Teaching', selectedIds: ['BAT-00000042'] } });
  navigation.rememberScroll(route.key, 361);
  const snapshot = navigation.getSnapshot(); let notifications = 0;
  const stop = navigation.subscribe(() => { notifications++; });
  assert.equal(navigation.activate('inventory'), false);
  assert.equal(navigation.getSnapshot(), snapshot); assert.equal(notifications, 0);
  assert.deepEqual(navigation.getSnapshot().current.pageContext, { search: 'Teaching', selectedIds: ['BAT-00000042'] });
  assert.equal(navigation.getSnapshot().current.scroll, 361); stop();
});

test('explicit Back returns through the active area stack and leaves other remembered areas intact', () => {
  const navigation = createPhoneNavigation(namespace), inventory = navigation.push('inventory', { pageContext: { search: 'Pack' } });
  navigation.rememberScroll(inventory.key, 512);
  navigation.push('inventory', { detail: { id: 'BAT-00000042' } });
  const task = navigation.push('workspace', { page: 'task-plans', pageContext: { taskId: 'cycle-a' } });
  navigation.activate('inventory'); assert.equal(navigation.back(), true);
  assert.equal(navigation.getSnapshot().current.key, inventory.key); assert.equal(navigation.getSnapshot().current.scroll, 512);
  assert.equal(navigation.back(), true); assert.equal(navigation.getSnapshot().current.detail, null);
  assert.equal(navigation.back(), true); assert.equal(navigation.getSnapshot().area, 'scan'); assert.equal(navigation.back(), false);
  navigation.activate('workspace'); assert.equal(navigation.getSnapshot().current.key, task.key);
});

test('route replacement updates view facts without losing route identity or saved source scroll', () => {
  const navigation = createPhoneNavigation(namespace), route = navigation.push('inventory', { scope: { kind: 'room', id: 'room-a' }, pageContext: { search: 'Pack' } });
  navigation.rememberScroll(route.key, 231);
  navigation.replace({ pageContext: { search: 'Model A', selectedIds: ['BAT-00000042'] } });
  const current = navigation.getSnapshot().current;
  assert.equal(current.key, route.key); assert.equal(current.area, 'inventory'); assert.equal(current.scroll, 231);
  assert.deepEqual(current.scope, route.scope); assert.deepEqual(current.pageContext, { search: 'Model A', selectedIds: ['BAT-00000042'] });
});

test('account and inventory namespaces cannot reuse remembered routes, selections or group details', () => {
  const demo = createPhoneNavigation('staff-a:demo'), live = createPhoneNavigation('staff-a:live'), other = createPhoneNavigation('staff-b:demo');
  const original = demo.push('inventory', { detail: { id: 'BAT-00000042', group: { id: 'same-group', version: 7 } }, scope: { kind: 'owner', id: 'staff-a' }, pageContext: { selectedIds: ['BAT-00000042'] } });
  demo.rememberScroll(original.key, 420);
  for (const navigation of [live, other]) {
    navigation.activate('inventory'); const current = navigation.getSnapshot().current;
    assert.equal(current.detail, null); assert.equal(current.scope, null); assert.deepEqual(current.pageContext, {}); assert.equal(current.scroll, 0);
    assert.notEqual(current.key, original.key); navigation.rememberScroll(original.key, 900);
    assert.equal(navigation.getSnapshot().current.scroll, 0);
  }
  assert.equal(demo.getSnapshot().current.scroll, 420);
});

test('resetting an area deliberately starts its root while preserving other area stacks', () => {
  const navigation = createPhoneNavigation(namespace), inventory = navigation.push('inventory', { scope: { kind: 'owner', id: 'staff-a' } });
  navigation.rememberScroll(inventory.key, 275);
  navigation.push('workspace', { page: 'activity', pageContext: { groupId: 'group-a' } }); navigation.resetArea('workspace');
  const reset = navigation.getSnapshot(); assert.equal(reset.area, 'workspace'); assert.equal(reset.stacks.workspace.length, 1);
  assert.equal(reset.current.page, null); assert.equal(reset.current.detail, null); assert.equal(reset.current.scroll, 0);
  navigation.activate('inventory'); assert.equal(navigation.getSnapshot().current.key, inventory.key); assert.equal(navigation.getSnapshot().current.scroll, 275);
});

test('one hundred detail visits leave no popped routes or hidden records accumulated behind the source', () => {
  const navigation = createPhoneNavigation(namespace), source = navigation.push('inventory', { scope: { kind: 'owner', id: 'staff-a' }, pageContext: { search: 'Teaching pack' } });
  navigation.rememberScroll(source.key, 482);
  for (let index = 0; index < 100; index++) {
    const detail = navigation.push('inventory', { detail: { id: `BAT-${String(index + 1).padStart(8, '0')}` } });
    assert.equal(navigation.getSnapshot().routes.length, 6);
    assert.equal(navigation.back(), true);
    const snapshot = navigation.getSnapshot();
    assert.equal(snapshot.routes.length, 5); assert.equal(navigation.routesFor('inventory').length, 2);
    assert.equal(snapshot.current.key, source.key); assert.equal(snapshot.current.scroll, 482);
    assert.equal(snapshot.routes.some(route => route.key === detail.key), false);
    navigation.rememberScroll(detail.key, 900);
    assert.equal(navigation.getSnapshot().current.scroll, 482);
    assert.deepEqual(new Set(snapshot.routes.map(route => route.key)), new Set(Object.values(snapshot.stacks).flat()));
  }
});

test('area reset prunes every route in that stack without removing another area context', () => {
  const navigation = createPhoneNavigation(namespace);
  const inventory = navigation.push('inventory', { scope: { kind: 'room', id: 'room-a' }, pageContext: { search: 'Model A' } }); navigation.rememberScroll(inventory.key, 214);
  navigation.push('inventory', { detail: { id: 'BAT-00000042' } });
  navigation.push('workspace', { page: 'teaching-groups', pageContext: { activeGroupId: 'private-group' } });
  navigation.push('workspace', { page: 'activity', pageContext: { groupId: 'private-group' } });
  navigation.push('me', { page: 'messages', pageContext: { messageId: 'message-a' } });
  const originalInventory = structuredClone(navigation.routesFor('inventory')), originalMe = structuredClone(navigation.routesFor('me'));
  const removedKeys = navigation.routesFor('workspace').map(route => route.key);
  navigation.resetArea('workspace');
  assert.equal(navigation.routesFor('workspace').length, 1);
  assert.equal(navigation.getSnapshot().routes.some(route => removedKeys.includes(route.key)), false);
  assert.deepEqual(navigation.routesFor('inventory'), originalInventory); assert.deepEqual(navigation.routesFor('me'), originalMe);
  assert.deepEqual(new Set(navigation.getSnapshot().routes.map(route => route.key)), new Set(Object.values(navigation.getSnapshot().stacks).flat()));
});

test('detail ancestors remain reachable across area switching and disappear only when explicitly popped', () => {
  const navigation = createPhoneNavigation(namespace), rootKey = navigation.getSnapshot().stacks.inventory[0];
  const source = navigation.push('inventory', { scope: { kind: 'group', id: 'private-group' }, pageContext: { groupVersion: 7, selectedIds: ['BAT-00000042'] } });
  navigation.rememberScroll(source.key, 367);
  const detail = navigation.push('inventory', { detail: { id: 'BAT-00000042', group: { id: 'private-group', version: 7 } } });
  navigation.activate('me');
  assert.deepEqual(navigation.routesFor('inventory').map(route => route.key), [rootKey, source.key, detail.key]);
  navigation.activate('inventory'); assert.equal(navigation.getSnapshot().current.key, detail.key);
  navigation.back(); assert.deepEqual(navigation.routesFor('inventory').map(route => route.key), [rootKey, source.key]);
  assert.equal(navigation.getSnapshot().current.scroll, 367); assert.equal(navigation.getSnapshot().current.pageContext.groupVersion, 7);
  navigation.back(); assert.deepEqual(navigation.routesFor('inventory').map(route => route.key), [rootKey]);
});

test('contextual cross-area entry returns to its source while ordinary two-argument pushes keep their own area stack', () => {
  const navigation = createPhoneNavigation(namespace); navigation.activate('me');
  const me = navigation.getSnapshot().current; navigation.rememberScroll(me.key, 226);
  const personal = navigation.push('inventory', { scope: { kind: 'holder', id: 'staff-a' } }, { returnToOrigin: true });
  navigation.rememberScroll(personal.key, 438); navigation.push('inventory', { detail: { id: 'BAT-00000042' } });
  navigation.back(); assert.equal(navigation.getSnapshot().current.key, personal.key); assert.equal(navigation.getSnapshot().current.scroll, 438);
  navigation.back(); assert.equal(navigation.getSnapshot().area, 'me'); assert.equal(navigation.getSnapshot().current.key, me.key); assert.equal(navigation.getSnapshot().current.scroll, 226);
  navigation.push('inventory', { scope: { kind: 'owner', id: 'staff-a' } }); navigation.back();
  assert.equal(navigation.getSnapshot().area, 'inventory'); assert.equal(navigation.getSnapshot().current.scope, null);
});

test('an older asynchronous entry cannot replace the latest entry when recovery resolves out of order', async () => {
  const gate = createPhoneEntryGate(), older = deferred(), newer = deferred(), opened = [], latest = context();
  async function enter(kind, wait) { const token = gate.begin(context()); await wait.promise; if (token.current(latest)) opened.push(kind); }
  const first = enter('checkout', older), second = enter('return', newer);
  newer.resolve(); await second; older.resolve(); await first;
  assert.deepEqual(opened, ['return']);
});

test('entry tokens reject changed routes, accounts, inventories, new locks and explicit invalidation', () => {
  for (const latest of [context({ routeKey: `${namespace}:workspace:9` }), context({ namespace: 'staff-a:live' }), context({ namespace: 'staff-b:demo' }), context({ locked: true })]) {
    const gate = createPhoneEntryGate(), token = gate.begin(context());
    assert.equal(token.current(context()), true); assert.equal(token.current(latest), false);
  }
  const gate = createPhoneEntryGate(), token = gate.begin(context()); gate.invalidate(); assert.equal(token.current(context()), false);
});

test('entry tokens retain the original captured context when a caller later mutates its context object', () => {
  const gate = createPhoneEntryGate(), original = context(), token = gate.begin(original);
  original.namespace = 'staff-b:live'; original.routeKey = 'staff-b:live:inventory:2';
  assert.equal(token.current({ ...original, locked: false }), false);
  assert.equal(token.current(context()), true);
});

test('protected and child Back handlers stop lower-priority navigation without releasing protected state', () => {
  const registry = createPhoneBackRegistry(), calls = []; let protectedRequest = true;
  registry.register(() => { calls.push('route'); protectedRequest = false; return true; }, 10);
  const removeChild = registry.register(() => { calls.push('child'); return true; }, 50);
  const removeProtection = registry.register(() => { calls.push('protected'); return true; }, 100);
  assert.equal(registry.handle({ type: 'back' }), true); assert.deepEqual(calls, ['protected']); assert.equal(protectedRequest, true);
  removeProtection(); calls.splice(0); assert.equal(registry.handle({ type: 'back' }), true); assert.deepEqual(calls, ['child']); assert.equal(protectedRequest, true);
  removeChild(); calls.splice(0); assert.equal(registry.handle({ type: 'back' }), true); assert.deepEqual(calls, ['route']); assert.equal(protectedRequest, false);
});

test('Back uses the newest handler at equal priority and falls through only after an explicit false result', () => {
  const registry = createPhoneBackRegistry(), calls = [], event = { reason: 'native-back' };
  registry.register(value => { assert.equal(value, event); calls.push('older'); return true; }, 40);
  const removeNewest = registry.register(value => { assert.equal(value, event); calls.push('newer'); return false; }, 40);
  assert.equal(registry.handle(event), true); assert.deepEqual(calls, ['newer', 'older']);
  removeNewest(); calls.splice(0); registry.handle(event); assert.deepEqual(calls, ['older']);
  assert.equal(createPhoneBackRegistry().handle(event), false);
});

test('a child can claim Back synchronously while its asynchronous protected operation is still pending', async () => {
  const registry = createPhoneBackRegistry(), pending = deferred(); let finished = false, navigated = false;
  registry.register(() => { navigated = true; return true; }, 10);
  registry.register(() => { void pending.promise.then(() => { finished = true; }); return true; }, 100);
  assert.equal(registry.handle({}), true); assert.equal(finished, false); assert.equal(navigated, false);
  pending.resolve(); await pending.promise; assert.equal(finished, true); assert.equal(navigated, false);
});

test('drag travel cancels activation even after moving back, while minor movement allows one deliberate click', () => {
  const intent = createPhonePressIntent(); intent.begin(10, 10); assert.equal(intent.move(14, 12), true); intent.finish(); assert.equal(intent.activate(), true);
  intent.begin(10, 10); assert.equal(intent.move(20, 10), false); assert.equal(intent.move(10, 10), false); intent.finish(); assert.equal(intent.activate(), false);
  intent.begin(10, 10); intent.cancel(); intent.finish(); assert.equal(intent.activate(), false);
});

test('a tap that arrests momentum cannot activate a card, but the next deliberate tap needs no cooldown', () => {
  const intent = createPhonePressIntent(); intent.begin(20, 30, true); intent.finish(); assert.equal(intent.activate(), false);
  intent.begin(20, 30, false); intent.finish(); assert.equal(intent.activate(), true);
  intent.begin(20, 30, false); intent.finish(); assert.equal(intent.activate(), true);
});

test('keyboard activation remains available after cancelled pointer input and the next deliberate pointer tap', () => {
  const intent = createPhonePressIntent();
  intent.begin(0, 0, true); intent.finish(); assert.equal(intent.activate(true), true);
  intent.begin(0, 0); intent.finish(); assert.equal(intent.activate(), true);
});

function overlay({ id, tagName = 'DIV', zIndex = 'auto', parentElement = null, visible = true, hidden = false, inert = false, state = 'open', floating = false, ownClose = false } = {}) {
  const node = Object.assign(new EventTarget(), { id, tagName, zIndex, parentElement, open: true, closes: 0, events: [],
    classList: { contains: name => floating && name === 'phone-workflow-layer' },
    getAttribute: name => name === 'data-state' ? state : null,
    hasAttribute: name => ownClose && name === 'data-phone-overlay-close',
    getClientRects: () => visible && (tagName !== 'DIALOG' || node.open) ? [{}] : [],
    closest: () => hidden || inert ? node : null,
    close() { this.closes++; this.open = false; },
  });
  const dispatch = node.dispatchEvent.bind(node);
  node.dispatchEvent = event => { node.events.push(event); return dispatch(event); };
  return node;
}
class KeyboardEventStub extends Event { constructor(type, options = {}) { super(type, options); this.key = options.key; this.code = options.code; } }
const overlayEvents = { Event, KeyboardEvent: KeyboardEventStub };

test('top overlay discovery includes HTML sheets, uses parent layer and excludes hidden or inert pages', () => {
  const background = overlay({ id: 'source', zIndex: '10' }), parent = overlay({ id: 'review-parent', zIndex: '800' });
  const htmlSheet = overlay({ id: 'html-sheet', tagName: 'DIALOG', zIndex: 'auto', parentElement: parent });
  const peer = overlay({ id: 'same-layer-peer', zIndex: '800' });
  const excluded = [overlay({ id: 'hidden-route', zIndex: '9999', hidden: true }), overlay({ id: 'inert-route', zIndex: '9999', inert: true }), overlay({ id: 'closed-sheet', zIndex: '9999', state: 'closed' }), overlay({ id: 'floating-station', zIndex: '9999', floating: true }), overlay({ id: 'no-layout', zIndex: '9999', visible: false })];
  const document = { querySelectorAll: () => [background, htmlSheet, peer, ...excluded] }, style = node => ({ zIndex: node.zIndex });
  assert.equal(topPhoneOverlay(document, style), htmlSheet);
  const newest = overlay({ id: 'newest-peer', zIndex: '800', parentElement: parent });
  assert.equal(topPhoneOverlay({ querySelectorAll: () => [htmlSheet, newest] }, style), newest);
  assert.equal(topPhoneOverlay({ querySelectorAll: () => excluded }, style), null);
});

test('HTML dialog cancellation is respected before fallback close and native requestClose stays authoritative', () => {
  const dialog = overlay({ id: 'protected-html', tagName: 'DIALOG' }); let protectedRequest = true;
  dialog.addEventListener('cancel', event => { if (protectedRequest) event.preventDefault(); });
  dismissPhoneOverlay(dialog, overlayEvents);
  assert.deepEqual(dialog.events.map(event => event.type), ['battery-mobile-dismiss', 'cancel']);
  assert.equal(dialog.events[1].cancelable, true); assert.equal(dialog.events[1].defaultPrevented, true);
  assert.equal(dialog.open, true); assert.equal(dialog.closes, 0); assert.equal(protectedRequest, true);
  protectedRequest = false; dismissPhoneOverlay(dialog, overlayEvents); assert.equal(dialog.closes, 1);
  const native = overlay({ id: 'native-html', tagName: 'DIALOG' }); let requests = 0;
  native.requestClose = () => { requests++; };
  dismissPhoneOverlay(native, overlayEvents); assert.equal(requests, 1); assert.equal(native.closes, 0);
});

test('custom dismissal cannot bypass a protected owner with Escape or direct HTML close', () => {
  const protectedHtml = overlay({ id: 'protected-owner', tagName: 'DIALOG' });
  protectedHtml.addEventListener('battery-mobile-dismiss', event => event.preventDefault());
  dismissPhoneOverlay(protectedHtml, overlayEvents);
  assert.deepEqual(protectedHtml.events.map(event => event.type), ['battery-mobile-dismiss']); assert.equal(protectedHtml.closes, 0);
  const owned = overlay({ id: 'owned-review', ownClose: true }); let protectedRequest = true;
  owned.addEventListener('battery-mobile-dismiss', () => { if (!protectedRequest) owned.close(); });
  dismissPhoneOverlay(owned, overlayEvents); assert.equal(owned.closes, 0); assert.equal(protectedRequest, true);
  assert.deepEqual(owned.events.map(event => event.type), ['battery-mobile-dismiss']);
  protectedRequest = false; dismissPhoneOverlay(owned, overlayEvents); assert.equal(owned.closes, 1);
  assert.deepEqual(owned.events.map(event => event.type), ['battery-mobile-dismiss', 'battery-mobile-dismiss']);
});
