import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { createPortal } from 'react-dom';
import { restorePhoneFocus } from '../src/app/phone-interaction.mjs';

// Execute the current JSX, hook updates, effect cleanup and timers. Controlled
// DOM nodes establish lifecycle behavior, not browser geometry or physical IME.
const compiled = ts.transpileModule(await readFile(new URL('../src/app/floating-workflow.jsx', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX },
}).outputText.replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
const focusDurations = new Function(`${compiled}\nreturn { entry: PHONE_FOCUS_ENTRY_MS, exit: PHONE_FOCUS_EXIT_MS };`)();

function mount(options = {}) {
  const hooks = [], effects = [], listeners = new Map(), controls = [], focusCalls = [], measurements = [], portals = [], timers = new Map();
  const body = { nodeType: 1, style: { overflow: options.bodyOverflow ?? 'auto' } };
  let cursor = 0, dirty = false, tree = null, now = 0, timerId = 0, unmounted = false;
  const document = {
    body, activeElement: null,
    addEventListener(type, callback) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(callback);
    },
    removeEventListener(type, callback) { listeners.get(type)?.delete(callback); },
  };
  function node(id, { visible = true, connected = true, editable = false, disabled = false, blocked = false, dialog = null, tabbable = true } = {}) {
    const result = {
      id, disabled, tabbable, isConnected: connected,
      getClientRects: () => { measurements.push(id); return visible ? [{}] : []; },
      matches: () => editable,
      closest(selector) { return selector === '[hidden],[inert]' ? blocked ? {} : null : dialog ?? surface; },
      focus(settings) {
        focusCalls.push({ id, settings });
        if (visible && connected && !blocked && (!controls.includes(result) || !surface.inert)) document.activeElement = result;
      },
    };
    return result;
  }
  const surface = {
    id: 'station-surface', inert: false,
    contains: element => element === surface || controls.includes(element),
    querySelectorAll: () => controls.filter(control => !control.disabled && control.tabbable),
    closest: () => surface,
    focus(settings) { focusCalls.push({ id: surface.id, settings }); if (!surface.inert) document.activeElement = surface; },
  };
  const source = node('source-trigger', options.source);
  document.activeElement = source;
  const bindings = {
    document, restorePhoneFocus, PhoneUIBoundary: 'PhoneUIBoundary',
    useRef(initial) { const index = cursor++; return hooks[index] ??= { current: initial }; },
    useState(initial) {
      const index = cursor++;
      hooks[index] ??= { value: typeof initial === 'function' ? initial() : initial };
      return [hooks[index].value, next => {
        const value = typeof next === 'function' ? next(hooks[index].value) : next;
        if (!Object.is(value, hooks[index].value)) { hooks[index].value = value; dirty = true; }
      }];
    },
    useEffect(run, dependencies) {
      const index = cursor++, old = hooks[index];
      if (!old || !dependencies || dependencies.length !== old.dependencies?.length || dependencies.some((value, i) => !Object.is(value, old.dependencies[i]))) {
        hooks[index] = { dependencies, cleanup: old?.cleanup };
        effects.push(() => { hooks[index].cleanup?.(); hooks[index].cleanup = run(); });
      }
    },
    createPortal(element, target) { const portal = { element, target, actual: options.realPortalObject ? createPortal(element, target) : undefined }; portals.push(portal); return portal; },
    setTimeout(run, delay) { const id = ++timerId; timers.set(id, { run, at: now + delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    _jsx: (type, props) => ({ type, props }),
  };
  const keys = Object.keys(bindings);
  const Component = new Function(...keys, `${compiled}\nreturn FloatingWorkflow;`)(...keys.map(key => bindings[key]));
  const props = { open: true, label: 'Check out · Demonstration', inactive: false, reducedMotion: false, children: { station: 'first' }, ...options.props };
  function render() {
    assert.equal(unmounted, false, 'A removed component cannot render again.');
    cursor = 0; dirty = false; tree = Component(props);
    if (tree?.element) { tree.element.props.ref.current = surface; surface.inert = tree.element.props.inert === true; }
    else if (hooks[0]) hooks[0].current = null;
    return tree;
  }
  function commit() {
    let passes = 0;
    do {
      while (effects.length) effects.shift()();
      if (!dirty) break;
      assert.ok(++passes < 10, 'Effect updates must settle.'); render();
    } while (true);
    return tree;
  }
  return {
    document, body, surface, source, focusCalls, measurements, portals, listeners, timers,
    get tree() { return tree; },
    control(id, settings) { const result = node(id, settings); controls.push(result); return result; },
    update(patch = {}) { Object.assign(props, patch); render(); return commit(); },
    advance(milliseconds) {
      const until = now + milliseconds;
      for (let next; (next = [...timers].sort((a, b) => a[1].at - b[1].at)[0]) && next[1].at <= until;) {
        now = next[1].at; timers.delete(next[0]); next[1].run(); if (dirty) render(); commit();
      }
      now = until; return tree;
    },
    tab(target, shiftKey = false) {
      const event = { key: 'Tab', target, shiftKey, prevented: false, preventDefault() { this.prevented = true; } };
      for (const callback of listeners.get('keydown') ?? []) callback(event);
      return event;
    },
    unmount() { for (const hook of hooks) hook.cleanup?.(); hooks[0].current = null; unmounted = true; tree = null; },
  };
}

const boundary = env => env.tree?.element?.props.children;
const keydownCount = env => env.listeners.get('keydown')?.size ?? 0;
function assertEmptyPortal(env) {
  assert.equal(env.tree.target, env.body); assert.equal(env.tree.element, null);
  assert.equal(boundary(env), undefined);
}

test('focus duration contract keeps the visible entry and retained exit bounded', () => {
  assert.deepEqual(focusDurations, { entry: 420, exit: 240 });
});

test('initially closed station prepares only an empty body portal without station DOM, focus, timer or scroll mutation', () => {
  const env = mount({ props: { open: false } });
  env.update(); assertEmptyPortal(env);
  assert.equal(env.portals.length, 1); assert.equal(env.focusCalls.length, 0);
  assert.equal(keydownCount(env), 0); assert.equal(env.timers.size, 0);
  assert.equal(env.body.style.overflow, 'auto'); assert.equal(env.document.activeElement, env.source);
  env.update({ label: 'A later destination', children: 'Pending' });
  assert.equal(env.portals.length, 2); assert.ok(env.portals.every(portal => portal.element === null && portal.target === env.body));
  env.unmount(); assert.equal(env.focusCalls.length, 0);
});

test('closed preparation returns an actual React portal object with the body container and null children', () => {
  const env = mount({ realPortalObject: true, props: { open: false, children: { station: 'must not mount while closed' } } });
  env.update(); const portal = env.tree.actual;
  assert.equal(portal.$$typeof, Symbol.for('react.portal')); assert.equal(portal.containerInfo, env.body);
  assert.equal(portal.children, null); assert.equal(portal.key, null);
  assert.equal(env.focusCalls.length, 0); assert.equal(keydownCount(env), 0); assert.equal(env.timers.size, 0);
  env.update({ label: 'A different closed destination' });
  assert.equal(env.tree.actual.children, null); assert.equal(env.tree.actual.containerInfo, portal.containerInfo);
  assert.equal(env.tree.actual.key, portal.key); env.unmount();
});

test('opening an initially closed station acquires one live focus boundary', () => {
  const env = mount({ props: { open: false } }); env.update();
  const first = env.control('visible-exit'); env.update({ open: true });
  assert.equal(env.tree.target, env.body); assert.equal(env.tree.element.props.role, 'dialog');
  assert.equal(env.tree.element.props['aria-modal'], true); assert.equal(env.tree.element.props['aria-hidden'], undefined);
  assert.equal(env.tree.element.props.inert, undefined); assert.equal(boundary(env).props.active, true);
  assert.equal(env.document.activeElement, first); assert.equal(keydownCount(env), 1);
  env.update({ children: 'Updated station' }); assert.equal(keydownCount(env), 1);
  assert.equal(env.focusCalls.filter(call => call.id === first.id).length, 1);
  env.unmount(); assert.equal(keydownCount(env), 0); assert.equal(env.document.activeElement, env.source);
});

test('opening respects a child heading focus without measuring or focusing an input', () => {
  const env = mount(), heading = env.control('child-heading', { tabbable: false });
  env.control('battery-name', { editable: true });
  env.document.activeElement = heading;
  env.update();
  assert.equal(env.document.activeElement, heading);
  assert.deepEqual(env.focusCalls, []); assert.deepEqual(env.measurements, []);
  assert.equal(keydownCount(env), 1, 'The live workflow still owns keyboard containment.');
  env.unmount();
});

test('heading and surface focus enter the live Tab order in both directions without escaping', () => {
  for(const start of ['heading','surface']) {
    const env=mount(),heading=env.control('child-heading',{tabbable:false});
    const first=env.control('exit'),middle=env.control('battery-name',{editable:true}),last=env.control('continue');
    const initial=start==='heading'?heading:env.surface;env.document.activeElement=initial;env.update();
    assert.equal(env.document.activeElement,initial,'Opening keeps the existing child or surface focus.');
    assert.equal(env.tab(initial).prevented,true);assert.equal(env.document.activeElement,first,'Tab enters at the first visible control.');
    env.document.activeElement=initial;assert.equal(env.tab(initial,true).prevented,true);assert.equal(env.document.activeElement,last,'Shift+Tab enters at the last visible control.');
    middle.focus();const focusCount=env.focusCalls.length;
    assert.equal(env.tab(middle).prevented,false);assert.equal(env.tab(middle,true).prevented,false);
    assert.equal(env.focusCalls.length,focusCount,'Interior controls keep their natural browser order.');
    last.focus();assert.equal(env.tab(last).prevented,true);assert.equal(env.document.activeElement,first);
    assert.equal(env.tab(first,true).prevented,true);assert.equal(env.document.activeElement,last);env.unmount();
  }
});

test('opening measures only through the first visible control and leaves later inputs alone', () => {
  const env = mount(); env.control('hidden-preparation', { visible: false });
  const exit = env.control('visible-exit'); env.control('battery-name', { editable: true });
  env.update();
  assert.deepEqual(env.measurements, ['hidden-preparation', 'visible-exit']);
  assert.equal(env.document.activeElement, exit);
  assert.deepEqual(env.focusCalls, [{ id: exit.id, settings: { preventScroll: true } }]);
  env.unmount();
});

test('closing immediately deactivates retained children and removes focus ownership before its 240ms exit', () => {
  const child = { station: 'retained' }, env = mount({ props: { children: child } });
  env.control('exit'); env.update(); env.update({ open: false, label: 'Replacement label', children: 'Replacement child' });
  assert.equal(env.tree.element.props['data-state'], 'closed'); assert.equal(env.tree.element.props.inert, true);
  assert.equal(env.tree.element.props['aria-hidden'], true); assert.equal(env.tree.element.props['aria-modal'], undefined);
  assert.equal(env.tree.element.props['aria-label'], 'Check out · Demonstration');
  assert.equal(boundary(env).type, 'PhoneUIBoundary'); assert.equal(boundary(env).props.active, false);
  assert.equal(boundary(env).props.children, child); assert.equal(keydownCount(env), 0);
  assert.equal(env.document.activeElement, env.source); assert.equal(env.timers.size, 1);
  env.advance(239); assert.ok(env.tree); assert.equal(boundary(env).props.active, false);
  env.advance(1); assertEmptyPortal(env); assert.equal(env.timers.size, 0);
  env.unmount();
});

test('reduced motion closes without an exit timer and can interrupt an existing fade', () => {
  for (const startsReduced of [true, false]) {
    const env = mount({ props: { reducedMotion: startsReduced } }); env.update(); env.update({ open: false });
    if (!startsReduced) { assert.ok(env.tree); assert.equal(env.timers.size, 1); env.update({ reducedMotion: true }); }
    assertEmptyPortal(env); assert.equal(env.timers.size, 0); assert.equal(keydownCount(env), 0);
    env.advance(240); assertEmptyPortal(env); env.unmount();
  }
});

test('reopening interrupts the outgoing timer and adopts the latest destination immediately', () => {
  const env = mount(); env.control('exit'); env.update(); env.update({ open: false }); env.advance(230);
  const latest = { station: 'latest' }; env.update({ open: true, label: 'Check in · Working', children: latest });
  assert.equal(env.tree.element.props['data-state'], 'open'); assert.equal(env.tree.element.props.inert, undefined);
  assert.equal(env.tree.element.props['aria-hidden'], undefined); assert.equal(env.tree.element.props['aria-label'], 'Check in · Working');
  assert.equal(boundary(env).props.active, true); assert.equal(boundary(env).props.children, latest);
  assert.equal(env.timers.size, 0); assert.equal(keydownCount(env), 1);
  env.advance(240); assert.ok(env.tree); assert.equal(boundary(env).props.children, latest);
  env.update({ open: false }); assert.equal(env.timers.size, 1); env.advance(240); assertEmptyPortal(env); env.unmount();
});

test('unmounting during an exit cancels its pending timer and never reacquires focus', () => {
  const env = mount(); env.control('exit'); env.update(); env.update({ open: false });
  const focusCount = env.focusCalls.length; env.unmount();
  assert.equal(env.timers.size, 0); assert.equal(keydownCount(env), 0);
  env.advance(500); assert.equal(env.focusCalls.length, focusCount); assert.equal(env.tree, null);
});

test('cleanup restores only connected visible noneditable source triggers', () => {
  for (const [name, source, shouldRestore] of [
    ['button', {}, true], ['editable input', { editable: true }, false],
    ['editable textarea', { editable: true }, false], ['contenteditable', { editable: true }, false],
    ['disconnected trigger', { connected: false }, false], ['hidden trigger', { visible: false }, false],
    ['inert ancestor', { blocked: true }, false],
  ]) {
    const env = mount({ source }); env.control('exit'); env.update(); env.update({ open: false });
    const calls = env.focusCalls.filter(call => call.id === env.source.id);
    assert.equal(calls.length, Number(shouldRestore), name);
    if (shouldRestore) assert.deepEqual(calls[0].settings, { preventScroll: true });
    env.unmount();
  }
});

test('focus selects visible enabled controls and Tab wraps within only the live station', () => {
  const env = mount(); env.control('hidden-preparation', { visible: false }); env.control('disabled', { disabled: true });
  const first = env.control('first'), last = env.control('last'); env.update();
  assert.equal(env.document.activeElement, first); last.focus();
  assert.equal(env.tab(last).prevented, true); assert.equal(env.document.activeElement, first);
  assert.equal(env.tab(first, true).prevented, true); assert.equal(env.document.activeElement, last);
  env.update({ open: false }); assert.equal(env.tab(last).prevented, false);
  assert.equal(env.document.activeElement, env.source); env.unmount();
});

test('empty station traps Tab on its surface and yields to nested dialog boundaries', () => {
  const empty = mount(); empty.update();
  assert.equal(empty.document.activeElement, empty.surface);
  assert.equal(empty.tab(empty.surface).prevented, true); empty.unmount();
  const env = mount(), first = env.control('first'), last = env.control('last'); env.update();
  for (const role of ['dialog', 'alertdialog']) {
    const nested = { role }, target = { closest: () => nested }; last.focus();
    assert.equal(env.tab(target).prevented, false, `${role} owns its own keyboard boundary.`);
    assert.equal(env.document.activeElement, last);
  }
  env.update({ inactive: true }); first.focus(); assert.equal(env.tab(last).prevented, false); env.unmount();
});

test('station lifecycle leaves the app frame scroll lock under its original owner', () => {
  for (const bodyOverflow of ['auto', 'hidden']) {
    const env = mount({ bodyOverflow }); env.update(); assert.equal(env.body.style.overflow, bodyOverflow);
    env.update({ open: false }); assert.equal(env.body.style.overflow, bodyOverflow);
    env.advance(240); env.unmount(); assert.equal(env.body.style.overflow, bodyOverflow);
  }
});

test('an external modal immediately disables the still-open station context and restores it on return', () => {
  const env = mount(); env.control('exit'); env.update(); const child = boundary(env).props.children;
  const focusCount = env.focusCalls.length;
  env.update({ inactive: true });
  assert.equal(env.tree.element.props['data-state'], 'open'); assert.equal(env.tree.element.props.inert, true);
  assert.equal(boundary(env).props.active, false); assert.equal(boundary(env).props.children, child);
  assert.equal(env.timers.size, 0); assert.equal(env.focusCalls.length, focusCount);
  env.advance(240); assert.equal(boundary(env).props.active, false);
  env.update({ inactive: false });
  assert.equal(env.tree.element.props.inert, undefined); assert.equal(boundary(env).props.active, true);
  assert.equal(env.focusCalls.length, focusCount); env.unmount();
});

test('reopening beneath an external modal cancels the exit without reactivating station work', () => {
  const env = mount(); env.control('exit'); env.update(); env.update({ open: false }); env.advance(230);
  const latest = { station: 'latest inactive destination' };
  env.update({ open: true, inactive: true, label: 'Return · Demonstration', children: latest });
  assert.equal(env.timers.size, 0); assert.equal(env.tree.element.props['data-state'], 'open');
  assert.equal(env.tree.element.props.inert, true); assert.equal(boundary(env).props.active, false);
  assert.equal(boundary(env).props.children, latest);
  env.advance(240); assert.ok(env.tree); assert.equal(boundary(env).props.active, false);
  env.update({ inactive: false }); assert.equal(boundary(env).props.active, true);
  env.update({ open: false }); assert.equal(boundary(env).props.active, false);
  env.advance(239); assert.ok(env.tree); env.advance(1); assertEmptyPortal(env); env.unmount();
});
