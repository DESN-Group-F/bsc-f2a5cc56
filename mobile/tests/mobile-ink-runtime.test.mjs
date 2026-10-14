import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import ts from 'typescript';

const source = await readFile(new URL('../src/features/scan/ink-orb.jsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX },
}).outputText.replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
const { edgeContour, ORIGINAL_CONTOUR } = new Function(`${compiled}\nreturn { edgeContour, ORIGINAL_CONTOUR };`)();

// Captured from the accepted CD443DA4 source before the calculation change.
// These fixtures do not reproduce the optimized harmonic implementation.
const contours = [
  [0, 'a79c9ed3f9b7738c018c084bd7f8a55a715e2aff4634ce2a02c3f62059d6bde6', 'fbb48836225219015eb7ba745d9fb8c10a9ec19d25e5de7c2d85a8433a21133e'],
  [1 / 60, '0077c170775f6659a9eacbf1fca0e8ddcd9c60f09b257aedf9fc13ca22804324', '3d1e27992bc3f9a7e46c06fe2bb6246a2165e1e980a4c2f345ff19fcc719cc76'],
  [.35, 'c7bcad7348931d9635a7e283b8c4758b754c366615d1746344b4feb18d8ef6fe', 'd7b0789fc331ba39d86d1d333d7dda470ee5ae7ba5306555f3d31b036dc90b0c'],
  [1.75, '600629583d4705f0ce6e36f435587faa50326f508d7fe985ee0283a584a8a707', '1ee17766d4734d60c93cdfa4c95b6ba84151f3894568f8e350995f401df36ccf'],
  [5.165, '12ae9c1482c9312b30a66fae37e761abcd9870acb410f277ce88f5043b34651c', '31361b74e4c599b0ad282e96a63e5beab4c5568c45ac286b1f065946180a5db5'],
  [13.37, '75e7ca457652b2b1b2f46564833fe240c2788f132ec1bf8f1368899042c3f88f', 'ab2aac41dbddf0ddbb7b45c0c11c86be9f90dda73158f5814c0dec24f0241b77'],
  [100, '5b0c2016cd8a50fc00b3d439a8449bfd7c51abfd0288d3d8f80db38af1421664', 'abee1d66b57a2053ff9e1f8107600b9fa4670419356a2f13214fdf5e1fbc105e'],
  [600, 'a6acc4b98707851e43ff2288a1ce48c0411d9b5c8b3c5eeea29b12335c670cae', '57be3cee79c4667698ecfd1c3a5389428260d506150320eb67876989aadfd0a0'],
];

test('the flowing 48-segment contour matches accepted normal and compact output across phases', () => {
  const points = new Float64Array(96);
  for (const [time, full, compact] of contours) for (const [strength, expected] of [[1, full], [.4, compact]]) {
    const path = edgeContour(time, strength, points);
    assert.equal((path.match(/ C /g) || []).length, 48);
    assert.equal(createHash('sha256').update(path).digest('hex'), expected, `Accepted contour at ${time}, strength ${strength}`);
  }
});

// Execute current JSX/effect cleanup with controlled DOM observers and RAF.
// CSS visibility models the retained body-level focus layer; this is not a
// browser paint, device geometry or frame-rate measurement.
function mount({ sourcePage = false, ...initial } = {}) {
  const hooks = [], effects = [], frames = new Map(), listeners = new Map(), observers = [];
  const counts = { geometry: 0, style: 0, bounds: 0 }, animations = [];
  const state = { active: true, surfaceActive: true, applicationReduced: false, systemReduced: false, feedback: '', sequence: 0, event: '', ...initial };
  let cursor = 0, dirty = false, frameId = 0, disposed = false, tree, elements;

  function notify(record) {
    for (const observer of observers) for (const [target, options] of observer.targets) {
      if (target !== record.target && !(options.subtree && target.contains(record.target))) continue;
      if (record.type === 'childList' && options.childList || record.type === 'attributes' && options.attributes && (!options.attributeFilter || options.attributeFilter.includes(record.attributeName))) {
        observer.records.push(record); break;
      }
    }
  }
  class Element {
    constructor(parent = null, attributes = {}) {
      this.parentElement = parent; this.attributes = { ...attributes }; this.children = [];
      this.dataset = {}; this.isConnected = true; this.rectVisible = true; this.visibility = 'visible'; this.writes = [];
      parent?.children.push(this);
    }
    matches(selector) {
      const classes = [...selector.matchAll(/\.([\w-]+)/g)].map(match => match[1]);
      const attributes = [...selector.matchAll(/\[([\w-]+)(?:=["']?([^\]"']+)["']?)?\]/g)];
      return classes.every(value => String(this.attributes.class || '').split(' ').includes(value)) && attributes.every(([, name, value]) => name in this.attributes && (value === undefined || String(this.attributes[name]) === value));
    }
    closest(selector) { for (let node = this; node; node = node.parentElement) if (selector.split(',').some(value => node.matches(value.trim()))) return node; return null; }
    contains(target) { for (let node = target; node; node = node.parentElement) if (node === this) return true; return false; }
    getClientRects() { counts.geometry++; return this.rectVisible ? [{}] : []; }
    getBoundingClientRect() { counts.bounds++; return { left: 100, top: 200, width: 200, height: 200 }; }
    setAttribute(name, value) { this.attributes[name] = value; this.writes.push({ name, value }); notify({ type: 'attributes', target: this, attributeName: name }); }
    removeAttribute(name) { delete this.attributes[name]; notify({ type: 'attributes', target: this, attributeName: name }); }
    animate(keyframes, options) { const animation = { keyframes, options, cancelled: false, cancel() { this.cancelled = true; } }; animations.push(animation); return animation; }
  }
  class MutationObserver {
    constructor(callback) { this.callback = callback; this.targets = new Map(); this.records = []; observers.push(this); }
    observe(target, options) { this.targets.set(target, options); }
    disconnect() { this.targets.clear(); this.records = []; }
  }
  class ResizeObserver {
    constructor(callback) { this.callback = callback; }
    observe() {} disconnect() {}
  }
  function addEventListener(name, callback) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(callback); }
  function removeEventListener(name, callback) { listeners.get(name)?.delete(callback); }
  const documentRoot = new Element(), body = new Element(documentRoot);
  const scope = new Element(body, { 'data-ink-gaze-scope': '', ...(sourcePage ? {} : { role: 'dialog' }) }), tapTarget = new Element(scope);
  const media = { get matches() { return state.systemReduced; }, addEventListener, removeEventListener };
  const window = {
    matchMedia: () => media, addEventListener, removeEventListener,
    requestAnimationFrame(callback) { frames.set(++frameId, callback); return frameId; }, cancelAnimationFrame(id) { frames.delete(id); },
    getComputedStyle(element) { counts.style++; return { visibility: sourcePage && body.children.some(child => child.matches('.phone-workflow-layer')) ? 'hidden' : element.visibility }; },
  };
  const document = { body, documentElement: documentRoot, visibilityState: 'visible', addEventListener, removeEventListener };
  const bindings = {
    window, document, Element, ResizeObserver, MutationObserver, React: { Fragment: 'fragment' },
    usePhoneContext: () => ({ active: state.surfaceActive }), usePhoneReducedMotion: () => state.applicationReduced,
    useRef(initial) { const index = cursor++; return hooks[index] ??= { current: initial }; },
    useState(initial) {
      const index = cursor++; hooks[index] ??= { value: typeof initial === 'function' ? initial() : initial };
      return [hooks[index].value, next => { const value = typeof next === 'function' ? next(hooks[index].value) : next; if (!Object.is(value, hooks[index].value)) { hooks[index].value = value; dirty = true; } }];
    },
    useEffect(run, dependencies) {
      const index = cursor++, previous = hooks[index];
      if (!previous || dependencies.some((value, i) => !Object.is(value, previous.dependencies[i]))) {
        hooks[index] = { dependencies, cleanup: previous?.cleanup }; effects.push(() => { hooks[index].cleanup?.(); hooks[index].cleanup = run(); });
      }
    },
  };
  const jsx = (type, props) => ({ type, props }), names = Object.keys(bindings);
  const Component = new Function(...names, '_jsx', '_jsxs', `${compiled}\nreturn InkOrb;`)(...names.map(name => bindings[name]), jsx, jsx);
  function attach(node, parent) {
    if (!node || typeof node !== 'object') return;
    const attrs = Object.fromEntries(Object.entries(node.props).filter(([name]) => name === 'className' || name.startsWith('data-') || ['d', 'ry', 'rx'].includes(name)).map(([name, value]) => [name === 'className' ? 'class' : name, value]));
    const element = new Element(parent, attrs);
    if (node.props.ref) node.props.ref.current = element;
    if (node.props.ref && node.props.className) elements.set(node.props.className, element);
    for (const child of [node.props.children].flat(Infinity)) attach(child, element);
  }
  function render() {
    assert.equal(disposed, false); cursor = 0; dirty = false; tree = Component(state);
    if (!elements) { elements = new Map(); attach(tree, scope); }
    let passes = 0;
    while (effects.length || dirty) {
      while (effects.length) effects.shift()();
      if (dirty) { assert.ok(++passes < 10); cursor = 0; dirty = false; tree = Component(state); }
    }
    return tree;
  }
  function flushObservers() {
    for (let pass = 0; pass < 10; pass++) {
      const ready = observers.filter(observer => observer.records.length);
      if (!ready.length) return;
      for (const observer of ready) observer.callback(observer.records.splice(0));
    }
    assert.fail('Observer callbacks must settle without a write loop.');
  }
  render();
  const orb = elements.get('ink-orb'), art = elements.get('ink-orb__body'), face = elements.get('ink-orb__gaze');
  return {
    counts, animations, observers, document, body, scope, orb, art, face,
    get tree() { return tree; },
    eyes: [elements.get('ink-orb__eye ink-orb__eye--left'), elements.get('ink-orb__eye')],
    update(patch) { Object.assign(state, patch); return render(); },
    step(time) { const pending = [...frames.values()]; frames.clear(); for (const callback of pending) callback(time); },
    pendingFrame: () => [...frames.values()][0], frameCount: () => frames.size,
    emit(name) { for (const callback of listeners.get(name) || []) callback({ type: name }); if (dirty) render(); },
    tap(foreign = false) { const target = foreign ? new Element(new Element(scope, { role: 'alertdialog' })) : tapTarget; for (const callback of listeners.get('pointerdown') || []) callback({ target, clientX: 350, clientY: 300 }); },
    flushObservers,
    addLayer() { const layer = new Element(body, { class: 'phone-workflow-layer', 'data-state': 'open' }); notify({ type: 'childList', target: body, addedNodes: [layer], removedNodes: [] }); return layer; },
    removeLayer(layer) { body.children.splice(body.children.indexOf(layer), 1); layer.parentElement = null; notify({ type: 'childList', target: body, addedNodes: [], removedNodes: [layer] }); },
    close() { for (const hook of hooks) hook.cleanup?.(); disposed = true; },
  };
}

const gazeX = view => Number(/translate\(([-\d.]+)/.exec(view.face.attributes.transform || 'translate(0 0)')[1]);

test('every eligible RAF keeps the contour flowing without repeated geometry or unchanged face writes', () => {
  const view = mount(); view.step(1000);
  const reads = { ...view.counts }, faceWrites = view.face.writes.length, eyeWrites = view.eyes.map(eye => eye.writes.length), artWrites = view.art.writes.length;
  for (let frame = 1; frame <= 30; frame++) view.step(1000 + frame * 16);
  assert.equal(view.frameCount(), 1); assert.equal(view.art.writes.length, artWrites + 30);
  assert.deepEqual(view.counts, reads); assert.equal(view.face.writes.length, faceWrites);
  assert.deepEqual(view.eyes.map(eye => eye.writes.length), eyeWrites);
  assert.equal(view.observers.some(observer => observer.records.length), false, 'SVG animation writes do not feed the eligibility observer.');
  view.close();
});

test('tap gaze still follows the tapped scanner while foreign modal taps remain excluded', () => {
  const view = mount(); view.step(1000); view.tap(true); view.step(1016); assert.equal(gazeX(view), 0);
  view.tap(); view.step(1032); const observed = gazeX(view); assert.ok(observed > 0); assert.equal(view.counts.bounds, 1);
  for (let frame = 3; frame <= 125; frame++) view.step(1000 + frame * 16);
  assert.ok(Math.abs(gazeX(view)) < observed); view.close();
});

test('source ink resumes after the retained body-level layer is removed without an ancestor attribute change', () => {
  const view = mount({ sourcePage: true }); view.step(1000);
  const layer = view.addLayer(); view.flushObservers(); assert.equal(view.frameCount(), 0);
  const writes = view.art.writes.length; layer.setAttribute('data-state', 'closed'); view.flushObservers();
  assert.equal(view.frameCount(), 0); assert.equal(view.art.writes.length, writes);
  view.removeLayer(layer); view.flushObservers(); assert.equal(view.frameCount(), 1);
  view.step(1250); assert.ok(view.art.writes.length > writes); view.close();
});

test('a removed focus layer cannot resume a foreign inactive phone boundary', () => {
  const view = mount({ sourcePage: true }), layer = view.addLayer(); view.flushObservers();
  view.update({ surfaceActive: false }); view.removeLayer(layer); view.flushObservers(); assert.equal(view.frameCount(), 0);
  view.tap(); assert.equal(gazeX(view), 0);
  view.update({ surfaceActive: true }); assert.equal(view.frameCount(), 1); view.close();
});

test('hidden and inert changes stop the next RAF before mutation delivery and resume through their observer', () => {
  for (const attribute of ['hidden', 'inert']) {
    const view = mount(); view.step(1000); const stale = view.pendingFrame(), writes = view.art.writes.length;
    view.scope.setAttribute(attribute, ''); view.step(1016); assert.equal(view.frameCount(), 0); stale(1032);
    assert.equal(view.art.writes.length, writes); assert.equal(gazeX(view), 0);
    view.scope.removeAttribute(attribute); view.flushObservers(); assert.equal(view.frameCount(), 1); view.close();
  }
});

test('app and system reduced motion preserve static success and can resume the current eligible surface', () => {
  for (const setting of ['applicationReduced', 'systemReduced']) {
    const view = mount({ feedback: 'success' }); view.step(1000); const stale = view.pendingFrame();
    view.update({ [setting]: true }); if (setting === 'systemReduced') view.emit('change');
    assert.equal(view.frameCount(), 0); assert.equal(view.art.attributes.d, ORIGINAL_CONTOUR);
    assert.match(view.tree.props.className, /ink-success/); assert.equal(view.tree.props['data-reduced-motion'], true);
    const writes = view.art.writes.length; stale(1016); assert.equal(view.art.writes.length, writes);
    view.update({ [setting]: false }); if (setting === 'systemReduced') view.emit('change');
    assert.equal(view.frameCount(), 1); view.step(1032); assert.notEqual(view.art.attributes.d, ORIGINAL_CONTOUR); view.close();
  }
});

test('background, disconnection and disposal do not leave eligible stale callbacks', () => {
  const view = mount(); view.step(1000); const stale = view.pendingFrame();
  view.document.visibilityState = 'hidden'; view.step(1016); assert.equal(view.frameCount(), 0);
  view.document.visibilityState = 'visible'; view.emit('visibilitychange'); assert.equal(view.frameCount(), 1);
  const beforePageHide = view.pendingFrame(); view.emit('pagehide'); beforePageHide(1020); assert.equal(view.frameCount(), 0);
  view.emit('pageshow'); assert.equal(view.frameCount(), 1);
  view.orb.isConnected = false; view.step(1032); assert.equal(view.frameCount(), 0);
  view.orb.isConnected = true; view.emit('pageshow'); assert.equal(view.frameCount(), 1);
  view.close(); const writes = view.art.writes.length; stale(1048); view.emit('resize'); view.flushObservers();
  assert.equal(view.frameCount(), 0); assert.equal(view.art.writes.length, writes);
  assert.ok(view.observers.every(observer => observer.targets.size === 0));
});

test('cached CSS visibility is refreshed on resize while an inactive acquisition cancels its activation', () => {
  const view = mount(); view.orb.visibility = 'hidden'; view.emit('resize'); assert.equal(view.frameCount(), 0);
  view.orb.visibility = 'visible'; view.emit('resize'); assert.equal(view.frameCount(), 1);
  view.update({ sequence: 1, event: 'accepted' }); assert.equal(view.animations.length, 1); assert.equal(view.animations[0].options.duration, 430);
  view.update({ surfaceActive: false }); assert.equal(view.frameCount(), 0); assert.equal(view.animations[0].cancelled, true);
  view.update({ sequence: 2, event: 'duplicate' }); assert.equal(view.animations.length, 1); view.close();
});

test('blink writes still occur when the eyes change rather than freezing their white-eye geometry', () => {
  const view = mount(); view.step(1000);
  for (let frame = 1; frame <= 118; frame++) view.step(1000 + frame * 50);
  for (const eye of view.eyes) {
    assert.ok(eye.writes.some(write => write.name === 'ry' && Number(write.value) < 12));
    assert.equal(Number(eye.attributes.ry), 12);
  }
  view.close();
});
