import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

class TestElement {
  constructor(parent = null, attributes = {}, classes = []) { this.parentElement = parent; this.attributes = { ...attributes }; this.classes = classes; this.dataset = {}; this.isConnected = true; }
  matches(selector) {
    const exclusions = [...selector.matchAll(/:not\(([^)]+)\)/g)].map(match => match[1]);
    if (exclusions.some(value => this.matches(value))) return false;
    selector = selector.replace(/:not\([^)]+\)/g, '');
    const classes = [...selector.matchAll(/\.([\w-]+)/g)].map(match => match[1]);
    const attributes = [...selector.matchAll(/\[([\w-]+)(?:=["']?([^\]"']+)["']?)?\]/g)];
    return classes.every(value => this.classes.includes(value)) && attributes.every(([,name,value]) => name in this.attributes && (value === undefined || this.attributes[name] === value));
  }
  closest(selector) { for (let element = this; element; element = element.parentElement) if (selector.split(',').some(value => element.matches(value.trim()))) return element; return null; }
  contains(target) { for (let element = target; element; element = element.parentElement) if (element === this) return true; return false; }
  getClientRects() { return [{}]; }
  getBoundingClientRect() { return { left: 100, top: 200, width: 200, height: 200 }; }
  setAttribute(name, value) { this.attributes[name] = value; }
}

async function mount({ active = true, applicationReduced=false, systemReduced=false, surfaceActive=true, feedback='' } = {}) {
  const source = await readFile(new URL('../src/features/scan/ink-orb.jsx', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } }).outputText.replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
  const hooks = [], effects = [], listeners = new Map(), frames = new Map(); let cursor = 0, frameId = 0;
  const documentRoot = new TestElement(), workflow = new TestElement(documentRoot, { role: 'dialog' }, ['phone-workflow-layer']), scope = new TestElement(workflow, { 'data-ink-gaze-scope': '' }), tapTarget = new TestElement(scope);
  const window = { matchMedia: () => ({ matches: systemReduced, addEventListener() {}, removeEventListener() {} }), getComputedStyle: () => ({ visibility: 'visible' }), addEventListener: (name, callback) => { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(callback); }, removeEventListener: (name, callback) => listeners.get(name)?.delete(callback), requestAnimationFrame: run => { frames.set(++frameId, run); return frameId; }, cancelAnimationFrame: id => frames.delete(id) };
  const document = { visibilityState: 'visible', documentElement: documentRoot, addEventListener: window.addEventListener, removeEventListener: window.removeEventListener };
  const bindings = { window, document, Element: TestElement, usePhoneContext:()=>({active:surfaceActive}), usePhoneReducedMotion:()=>applicationReduced, React: { Fragment: 'fragment' }, useRef: initial => hooks[cursor++] ??= { current: initial }, useState: initial => { const index = cursor++; hooks[index] ??= { value: typeof initial === 'function' ? initial() : initial }; return [hooks[index].value, value => { hooks[index].value = value; }]; }, useEffect: run => effects.push(run), ResizeObserver: undefined, MutationObserver: undefined };
  const jsx = (type, props) => ({ type, props }), names = Object.keys(bindings);
  const Component = new Function(...names, '_jsx', '_jsxs', `${compiled}\nreturn InkOrb;`)(...names.map(name => bindings[name]), jsx, jsx);
  const tree = Component({ active, feedback }), elements = new Map();
  function attach(node, parent) { if (!node || typeof node !== 'object') return; const element = new TestElement(parent, {}, String(node.props.className || '').split(' ')); if (node.props.ref) node.props.ref.current = element; if (node.props.className) elements.set(node.props.className, element); for (const child of [node.props.children].flat(Infinity)) attach(child, element); }
  attach(tree, scope); const cleanups = effects.map(run => run());
  return { workflow, scope, tapTarget, document, tree, frameCount:()=>frames.size, face: elements.get('ink-orb__gaze'), tap(target = tapTarget) { for (const listener of listeners.get('pointerdown') || []) listener({ target, clientX: 350, clientY: 300 }); }, step(time) { const batch = [...frames.values()]; frames.clear(); for (const run of batch) run(time); }, close() { for (const cleanup of cleanups) cleanup?.(); } };
}

const x = view => Number(/translate\(([-\d.]+)/.exec(view.face.attributes.transform || 'translate(0 0)')[1]);

test('actual orb observes scanner taps inside the workflow dialog and naturally returns', async () => {
  const view = await mount(); view.step(1000); assert.equal(x(view), 0);
  view.tap(); view.step(1016); const observed = x(view); assert.ok(observed > 0, 'The real observe handler accepts the scanner containing dialog');
  for (let frame = 2; frame <= 122; frame++) view.step(1000 + frame * 16);
  assert.ok(Math.abs(x(view)) < observed, 'Eyes return after their brief observation'); view.close();
});

test('review dialogs and backdrops remain excluded even within the gaze scope', async () => {
  for (const [role, classes] of [['dialog',[]],['alertdialog',[]],[null,['scan-review-backdrop']],[null,['scan-confirm-backdrop']]]) {
    const view = await mount(), overlay = new TestElement(view.scope, role ? { role } : {}, classes), target = new TestElement(overlay);
    view.step(1000); view.tap(target); view.step(1016); assert.equal(x(view), 0); view.close();
  }
});

test('background and inert scanners do not react to taps', async () => {
  for (const state of ['hidden','inert']) {
    const view = await mount(); view.step(1000);
    if (state === 'hidden') view.document.visibilityState = 'hidden'; else view.scope.attributes.inert = '';
    view.tap(); view.step(1016); assert.equal(x(view), 0); view.close();
  }
});

test('either app or system reduced motion stops decorative frames while success remains a visible state',async()=>{
  for(const settings of [{applicationReduced:true,systemReduced:false},{applicationReduced:false,systemReduced:true}]){
    const view=await mount({...settings,feedback:'success'});
    assert.equal(view.tree.props['data-reduced-motion'],true);
    assert.match(view.tree.props.className,/ink-success/);
    assert.equal(view.frameCount(),0);
    view.tap();view.step(1000);assert.equal(x(view),0);assert.equal(view.frameCount(),0);view.close();
  }
});

test('a retained inactive phone surface stops ink frames and gaze even when the local active prop is true',async()=>{
  const view=await mount({surfaceActive:false});assert.equal(view.tree.props['data-active'],false);assert.equal(view.frameCount(),0);view.tap();view.step(1000);assert.equal(x(view),0);view.close();
});
