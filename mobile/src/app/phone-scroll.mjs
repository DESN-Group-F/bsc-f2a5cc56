/** Track user scrolling separately from route restoration and other programmatic movement. */
export function createPhoneScrollIntent(now = () => performance.now()) {
  const owners = new WeakMap(); let pointer = null;
  const state = owner => { if (!owners.has(owner)) owners.set(owner,{ user:false, at:0 }); return owners.get(owner); };
  return {
    begin(owner,x,y) { pointer = owner ? { owner,x,y,moved:false,arrest:this.scrolling(owner) } : null; },
    move(x,y) { if (pointer && Math.hypot(x-pointer.x,y-pointer.y) >= 9) { pointer.moved = true; state(pointer.owner).user = true; } },
    end() { if (pointer?.arrest && !pointer.moved) this.settle(pointer.owner); pointer = null; },
    wheel(owner) { if (owner) { const value = state(owner); value.user = true; value.at = now(); } },
    scroll(owner) { if (!owner) return; const value = state(owner); if (value.user && (pointer?.owner === owner && pointer.moved || now()-value.at < 110)) value.at = now(); else this.settle(owner); },
    scrolling(owner) { if (!owner) return false; const value = state(owner); return value.user && value.at > 0 && now()-value.at < 110; },
    settle(owner) { if (owner) { const value = state(owner); value.user = false; value.at = 0; } },
  };
}

export const phoneScrollIntent = createPhoneScrollIntent();

export function phoneScrollOwner(target, getStyle = node => globalThis.getComputedStyle(node)) {
  for (let node = target?.nodeType === 1 ? target : target?.parentElement; node; node = node.parentElement) {
    if (node.scrollHeight > node.clientHeight && /^(auto|scroll)$/.test(getStyle(node).overflowY)) return node;
  }
  return null;
}

export function trackPhoneScroll(document, intent = phoneScrollIntent) {
  const down = event => { if (event.isPrimary !== false) intent.begin(phoneScrollOwner(event.target),event.clientX,event.clientY); };
  const move = event => { if (event.isPrimary !== false) intent.move(event.clientX,event.clientY); };
  const end = () => intent.end(), wheel = event => intent.wheel(phoneScrollOwner(event.target));
  const scroll = event => intent.scroll(event.target), settle = event => intent.settle(event.target);
  const listeners = [['pointerdown',down],['pointermove',move],['pointerup',end],['pointercancel',end],['wheel',wheel],['scroll',scroll],['scrollend',settle]];
  listeners.forEach(([name,handler]) => document.addEventListener(name,handler,{ capture:true,passive:true }));
  return () => { listeners.forEach(([name,handler]) => document.removeEventListener(name,handler,{ capture:true })); intent.end(); };
}
