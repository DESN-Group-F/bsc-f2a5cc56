import { test } from "node:test";
import assert from "node:assert/strict";
import { observeWorkspaceMotion, transitionWorkspace } from "../work/qa/client/workspace-motion.mjs";

test("frequent view updates settle in the input event so typing and Clear filters cannot reorder deferred changes", () => {
  const originalWindow = globalThis.window, originalDocument = globalThis.document;
  let nativeSnapshots = 0, criteria = "", calls = 0;
  globalThis.window = { matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) };
  globalThis.document = { querySelectorAll: () => [], startViewTransition() { nativeSnapshots++; throw new Error("A controlled input must not defer its state update."); } };
  try {
    transitionWorkspace(() => { calls++; criteria = "BAT-002"; });
    assert.equal(criteria, "BAT-002");
    transitionWorkspace(() => { calls++; criteria = ""; });
    assert.equal(criteria, "");
    assert.equal(calls, 2);
    assert.equal(nativeSnapshots, 0);
  } finally {
    if (originalWindow === undefined) delete globalThis.window; else globalThis.window = originalWindow;
    if (originalDocument === undefined) delete globalThis.document; else globalThis.document = originalDocument;
  }
});

function motionEnvironment(run) {
  const names = ["window", "document", "HTMLElement", "MutationObserver"], previous = names.map(name => globalThis[name]);
  const listeners = new Map(), animations = [], observers = [], lists = [];
  let preferenceChanged;
  const preference = { matches: false, addEventListener(_event, callback) { preferenceChanged = callback; }, removeEventListener() { preferenceChanged = undefined; } };
  class Element {
    constructor(kind = "container") {
      this.kind = kind; this.children = []; this.parentElement = null; this.offsetParent = null;
      this.offsetTop = 0; this.offsetLeft = 0; this.clientWidth = 600; this.isConnected = true; this.hidden = false;
    }
    append(element) { this.children.push(element); element.parentElement = this; element.offsetParent = this; }
    matches(selector) { return this.kind === "row" ? selector.includes('[data-slot="table-row"]') : this.kind === "history" ? selector.includes(".history-entry") : false; }
    closest() { return null; }
    getClientRects() { return this.hidden || !this.isConnected ? [] : [{}]; }
    getBoundingClientRect() { throw new Error("Animated viewport coordinates must not become a layout baseline."); }
    querySelectorAll(selector) { return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]); }
    animate(frames, options) {
      const result = { element: this, frames, options, cancelled: false, finished: new Promise(() => {}), cancel() { this.cancelled = true; } };
      animations.push(result); return result;
    }
  }
  globalThis.HTMLElement = Element;
  globalThis.window = { innerHeight: 800, matchMedia: () => preference,
    addEventListener: (event, callback) => listeners.set(`window:${event}`, callback), removeEventListener: event => listeners.delete(`window:${event}`) };
  globalThis.document = { body: new Element(), querySelectorAll: selector => lists.flatMap(list => list.querySelectorAll(selector)),
    addEventListener: (event, callback) => listeners.set(event, callback), removeEventListener: event => listeners.delete(event) };
  globalThis.MutationObserver = class {
    constructor(callback) { this.callback = callback; this.disconnected = false; observers.push(this); }
    observe() {}
    disconnect() { this.disconnected = true; }
  };
  const environment = { Element, animations, listeners, lists, preference, observers,
    changed: (target, addedNodes = [], removedNodes = []) => observers[0].callback([{ type: "childList", target, addedNodes, removedNodes }]),
    preferenceChanged: () => preferenceChanged?.(),
    list(kind = "row") {
      const list = new Element(); lists.push(list);
      for (const top of [0, 40]) { const row = new Element(kind); row.offsetTop = top; list.append(row); }
      return list;
    } };
  try { run(environment); }
  finally { names.forEach((name, index) => { if (previous[index] === undefined) delete globalThis[name]; else globalThis[name] = previous[index]; }); }
}

test("sidebar expand/collapse and hover portals never replay a cached layout animation on any list", () => motionEnvironment(env => {
  const inventory = env.list(), history = env.list("history"), navigation = new env.Element();
  const cleanup = observeWorkspaceMotion();
  for (const left of [240, 64, 240]) {
    env.listeners.get("pointerdown")();
    inventory.offsetLeft = left; history.offsetLeft = left;
    // Width changes can wrap cells after the input event that captured the list.
    inventory.children[1].offsetTop += 8; history.children[1].offsetTop += 8;
    for (let index = 0; index < 4; index++) env.changed(navigation, [new env.Element("tooltip")]);
  }
  assert.equal(env.animations.length, 0);
  cleanup();
}));

test("only the structurally changed list moves, using relative unanimated positions", () => motionEnvironment(env => {
  const inventory = env.list(), history = env.list("history");
  inventory.offsetLeft = 240; history.offsetLeft = 240;
  const cleanup = observeWorkspaceMotion();
  const [first, second] = inventory.children;
  inventory.offsetLeft = 64;
  inventory.children = [second, first]; second.offsetTop = 0; first.offsetTop = 40;
  history.children[1].offsetTop = 70;
  env.changed(inventory, [second], [second]);
  assert.equal(env.animations.length, 2);
  assert.ok(env.animations.every(animation => animation.element.parentElement === inventory));
  assert.deepEqual(env.animations.map(animation => animation.frames[0].translate).sort(), ["0px -40px", "0px 40px"]);
  assert.ok(env.animations.every(animation => !("opacity" in animation.frames[0])), "An existing reordered item does not re-enter.");
  cleanup();
}));

test("interrupted list reordering replaces each active translation and cleans up observers and input listeners", () => motionEnvironment(env => {
  const inventory = env.list(), [first, second] = inventory.children;
  const cleanup = observeWorkspaceMotion();
  inventory.children = [second, first]; second.offsetTop = 0; first.offsetTop = 40;
  env.changed(inventory, [second], [second]);
  const previousAnimations = [...env.animations];
  inventory.children = [first, second]; first.offsetTop = 0; second.offsetTop = 40;
  env.changed(inventory, [first], [first]);
  assert.equal(env.animations.length, 4);
  assert.ok(previousAnimations.every(animation => animation.cancelled));
  assert.ok(env.animations.slice(2).every(animation => !animation.cancelled));
  cleanup();
  assert.ok(env.animations.every(animation => animation.cancelled));
  assert.equal(env.listeners.size, 0);
  assert.equal(env.observers[0].disconnected, true);
}));

test("new rows still enter, but width reflow is not mistaken for a list reorder", () => motionEnvironment(env => {
  const inventory = env.list();
  const cleanup = observeWorkspaceMotion();
  inventory.clientWidth = 400; inventory.children[1].offsetTop = 60;
  const added = new env.Element("row"); added.offsetTop = 120; inventory.append(added);
  env.changed(inventory, [added]);
  assert.equal(env.animations.length, 1);
  assert.equal(env.animations[0].element, added);
  assert.equal(env.animations[0].frames[0].opacity, .15);
  cleanup();
}));

test("reduced motion skips new row transitions and immediately cancels running animations when enabled", () => motionEnvironment(env => {
  const inventory = env.list(); env.preference.matches = true;
  const cleanup = observeWorkspaceMotion();
  const added = new env.Element("row"); added.offsetTop = 80; inventory.append(added);
  env.changed(inventory, [added]);
  assert.equal(env.animations.length, 0);
  env.preference.matches = false; env.preferenceChanged();
  const next = new env.Element("row"); next.offsetTop = 120; inventory.append(next);
  env.changed(inventory, [next]);
  assert.equal(env.animations.length, 1);
  env.preference.matches = true; env.preferenceChanged();
  assert.equal(env.animations[0].cancelled, true);
  cleanup();
}));

test("record transitions animate the current identities after the update without cloning an old clickable list", () => {
  const originalWindow = globalThis.window, originalDocument = globalThis.document;
  let displayedId = "BAT-001", animatedId = "", cloneCalls = 0;
  const table = {
    getClientRects: () => [{}],
    cloneNode() { cloneCalls++; throw new Error("An old battery identity must not cover the updated row."); },
    animate() { animatedId = displayedId; return { finished: Promise.resolve(), cancel() {} }; },
  };
  globalThis.window = { matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) };
  globalThis.document = { querySelectorAll: () => [table] };
  try {
    transitionWorkspace(() => { displayedId = "BAT-002"; });
    assert.equal(displayedId, "BAT-002");
    assert.equal(animatedId, "BAT-002");
    assert.equal(cloneCalls, 0);
  } finally {
    if (originalWindow === undefined) delete globalThis.window; else globalThis.window = originalWindow;
    if (originalDocument === undefined) delete globalThis.document; else globalThis.document = originalDocument;
  }
});
