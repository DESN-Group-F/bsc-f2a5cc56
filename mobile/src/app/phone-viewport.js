import { useEffect, useState } from 'react';
import { phoneEditable } from './phone-interaction.mjs';
import { phoneScrollOwner, phoneScrollIntent } from './phone-scroll.mjs';
import { phoneViewportLayout, phoneFocusScrollAdjustment } from './phone-layout.mjs';

const stores = new WeakMap();
export function createPhoneViewportStore(win) {
  if (stores.has(win)) return stores.get(win);
  const document = win.document, root = document.documentElement, listeners = new Set(), baselines = new Map();
  const media = win.matchMedia?.('(prefers-reduced-motion: reduce)');
  let cleanup = null, frame = null, snapshot;
  function read() {
    const width = win.visualViewport?.width || win.innerWidth, height = win.visualViewport?.height || win.innerHeight;
    const editable = phoneEditable(document.activeElement), key = Math.round(width / 40) * 40;
    const baselineHeight = baselines.get(key) || Math.max(win.innerHeight,height);
    const layout = phoneViewportLayout({width,height,baselineHeight,editable,keyboardHeld:snapshot?.keyboardOpen === true,scale:win.visualViewport?.scale || 1});
    if (!editable && !layout.keyboardOpen) baselines.set(key,Math.max(win.innerHeight,height));
    return { ...layout, systemReduced:!!media?.matches };
  }
  snapshot = read();
  function applyGeometry() {
    root.style.setProperty('--phone-viewport-height',snapshot.height + 'px');
    root.style.setProperty('--phone-viewport-width',snapshot.width + 'px');
    for (const node of [root,document.body]) {
      node.dataset.phoneLayout = snapshot.layout;
      node.dataset.phoneKeyboard = String(snapshot.keyboardOpen);
    }
  }
  function reveal() {
    frame = null;
    const field = document.activeElement;
    if (!phoneEditable(field) || field.closest?.('[hidden],[inert]')) return;
    const owner = phoneScrollOwner(field);
    if (!owner || owner.clientHeight < 24) return;
    const fieldRect = field.getBoundingClientRect(), ownerRect = owner.getBoundingClientRect();
    const delta = phoneFocusScrollAdjustment({fieldTop:fieldRect.top,fieldBottom:fieldRect.bottom,ownerTop:ownerRect.top,ownerBottom:ownerRect.bottom,viewportBottom:snapshot.height});
    if (delta) { phoneScrollIntent.settle(owner); owner.scrollTop += delta; }
  }
  function update() {
    const next = read();
    if (Object.keys(next).some(key => next[key] !== snapshot[key])) {
      snapshot = next;
      applyGeometry();
      listeners.forEach(listener => listener(snapshot));
    }
    if (frame !== null) win.cancelAnimationFrame(frame);
    frame = win.requestAnimationFrame(reveal);
  }
  function attach() {
    const previous = ['--phone-viewport-height','--phone-viewport-width'].map(name => [name,root.style.getPropertyValue(name)]);
    const attributes = [root,document.body].flatMap(node => ['data-phone-layout','data-phone-keyboard'].map(name => [node,name,node.getAttribute(name)]));
    const targets = [[win,'resize'],[win,'orientationchange'],[win.visualViewport,'resize'],[win.visualViewport,'scroll'],[document,'focusin'],[document,'focusout'],[media,'change']].filter(([target]) => target);
    targets.forEach(([target,event]) => target.addEventListener(event,update));
    applyGeometry();
    update();
    return () => {
      targets.forEach(([target,event]) => target.removeEventListener(event,update));
      if (frame !== null) win.cancelAnimationFrame(frame);
      frame = null;
      previous.forEach(([name,value]) => value ? root.style.setProperty(name,value) : root.style.removeProperty(name));
      attributes.forEach(([node,name,value]) => value === null ? node.removeAttribute(name) : node.setAttribute(name,value));
    };
  }
  const store = { getSnapshot:() => snapshot, subscribe(listener) { listeners.add(listener); if (!cleanup) cleanup = attach(); else listener(snapshot); return () => { listeners.delete(listener); if (!listeners.size) { cleanup?.(); cleanup = null; } }; } };
  stores.set(win,store);
  return store;
}
export function usePhoneViewport() {
  const store = createPhoneViewportStore(window), [snapshot,setSnapshot] = useState(store.getSnapshot);
  useEffect(() => store.subscribe(setSnapshot),[store]);
  return snapshot;
}
