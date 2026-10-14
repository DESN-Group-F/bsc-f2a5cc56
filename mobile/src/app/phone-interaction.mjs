export function createPhoneBackRegistry() {
  const handlers = new Map(); let order = 0;
  return {
    register(handler, priority = 20) { const key = Symbol('phone-back'); handlers.set(key, { handler, priority, order: ++order }); return () => handlers.delete(key); },
    handle(event) { for (const entry of [...handlers.values()].sort((a,b) => b.priority - a.priority || b.order - a.order)) if (entry.handler(event) === true) return true; return false; },
  };
}

export function createPhonePressIntent(threshold = 9) {
  let start = null, cancelled = false;
  return {
    begin(x, y, scrolling = false) { start = { x, y }; cancelled = scrolling; },
    move(x,y) { if (start && Math.hypot(x - start.x, y - start.y) >= threshold) cancelled = true; return !cancelled; },
    cancel() { cancelled = true; start = null; },
    finish() { start = null; },
    activate(keyboard = false) { const allowed = keyboard || !cancelled; cancelled = false; return allowed; },
  };
}

export function phoneEditable(element) { return !!element?.matches?.('input:not([type="checkbox"]):not([type="radio"]),textarea,[contenteditable="true"]'); }
export function restorePhoneFocus(element) {
  if (!element?.isConnected || phoneEditable(element) || element.closest?.('[hidden],[inert]') || !element.getClientRects?.().length) return false;
  element.focus?.({ preventScroll: true }); return true;
}

export function visiblePhoneOverlays(document) {
  return [...document.querySelectorAll('dialog[open],[role="dialog"],[role="alertdialog"],[data-phone-overlay]')].filter(node => !node.classList.contains('phone-workflow-layer') && node.getAttribute('data-state') !== 'closed' && !node.closest('[hidden],[inert]') && node.getClientRects().length > 0);
}

export function topPhoneOverlay(document, getStyle = node => globalThis.getComputedStyle(node)) {
  return visiblePhoneOverlays(document).map((node,index) => {
    let layer = 0, depth = 0;
    for (let parent = node; parent; parent = parent.parentElement) { layer = Math.max(layer, Number.parseInt(getStyle(parent).zIndex,10) || 0); depth++; }
    return { node, layer, depth, index };
  }).sort((a,b) => b.layer - a.layer || b.depth - a.depth || b.index - a.index)[0]?.node || null;
}

/** Portals belong to their exact owner or an expanded trigger inside that owner. */
export function phoneWorkflowOwnsOverlay(node, activeOwner) {
  if (!activeOwner) return false;
  const markedOwner = node.closest?.('[data-phone-workflow-owner]');
  if (markedOwner) return markedOwner.getAttribute('data-phone-workflow-owner') === activeOwner;
  if (!node.id || !node.ownerDocument) return false;
  return [...node.ownerDocument.querySelectorAll('[aria-controls][aria-expanded="true"]')].some(trigger =>
    trigger.ownerDocument === node.ownerDocument && trigger.isConnected && !trigger.disabled &&
    trigger.getAttribute('aria-expanded') === 'true' &&
    trigger.getAttribute('aria-controls')?.split(/\s+/).includes(node.id) &&
    trigger.closest('[data-phone-workflow-owner]')?.getAttribute('data-phone-workflow-owner') === activeOwner &&
    !trigger.closest('[hidden],[inert]') && trigger.getClientRects().length > 0 &&
    !['hidden','collapse'].includes(node.ownerDocument.defaultView?.getComputedStyle?.(trigger)?.visibility));
}

export function trackPhoneInputModality(document) {
  const body=document.body, previous=body.getAttribute('data-phone-input');
  const pointer=()=>{body.dataset.phoneInput='pointer';};
  const keyboard=event=>{if(!['Shift','Control','Alt','Meta'].includes(event.key))body.dataset.phoneInput='keyboard';};
  pointer();document.addEventListener('pointerdown',pointer,true);document.addEventListener('keydown',keyboard,true);
  return()=>{document.removeEventListener('pointerdown',pointer,true);document.removeEventListener('keydown',keyboard,true);if(previous===null)body.removeAttribute('data-phone-input');else body.setAttribute('data-phone-input',previous);};
}

/** A layer closes through its own cancellable handler; protected work is never force-closed. */
export function dismissPhoneOverlay(node, { Event = globalThis.Event, KeyboardEvent = globalThis.KeyboardEvent } = {}) {
  const dismiss = new Event('battery-mobile-dismiss', { cancelable: true }); node.dispatchEvent(dismiss);
  if (dismiss.defaultPrevented || node.hasAttribute('data-phone-overlay-close')) return;
  if (node.tagName === 'DIALOG') {
    if (typeof node.requestClose === 'function') node.requestClose();
    else { const cancel = new Event('cancel', { cancelable: true }); if (node.dispatchEvent(cancel) && !cancel.defaultPrevented) node.close(); }
    return;
  }
  node.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }));
}

export function createPhoneEntryGate() {
  let generation = 0;
  return {
    invalidate() { generation++; },
    begin(context) { const token = ++generation, namespace = context.namespace, routeKey = context.routeKey; return { current(latest) { return token === generation && namespace === latest.namespace && routeKey === latest.routeKey && !latest.locked; } }; },
  };
}
