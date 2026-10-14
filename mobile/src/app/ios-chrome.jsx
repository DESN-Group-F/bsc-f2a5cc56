import React, { useEffect, useRef, useState } from 'react';
import { Search, X, ArrowUpRight, ScanLine, Package, LayoutGrid } from 'lucide-react';
import { InkOrb } from '../features/scan/ink-orb.jsx';
import { Pressable, usePhoneBack, usePhoneReducedMotion } from './phone-ui.jsx';
import { IOS_MAIN_AREAS, IOS_SCAN_ACTIONS, iosDockPosition } from './ios-presentation.mjs';
import { createIosDockMotion } from './ios-dock-motion.mjs';
import { phoneEntryMessage, phoneEntryTitle } from './phone-entry-intent.mjs';
import './ios-presentation.css';

export function IosScanHome({ active, entryPending, onLookup, onOperation, onCancelOpening, onRetryOpening }) {
  const preparing = !!entryPending && entryPending.phase !== 'failed';
  return <section className="mobile-scan-home ios-scan-home" data-ink-gaze-scope>
    <Pressable className="ios-scan-primary" disabled={!!entryPending || !onLookup} onClick={onLookup} aria-label="Start scan to view battery details; no stock changes"><InkOrb color="blue" active={active && !preparing}/><span>Scan<small>View a battery</small></span></Pressable>
    <div className="ios-operation-grid" aria-label="Scan and battery operations">
      {IOS_SCAN_ACTIONS.map(action => <Pressable key={action.kind} className="ios-operation" data-color={action.color} disabled={!!entryPending || !onOperation} onClick={() => onOperation(action.kind)} aria-label={`${action.label}: ${action.detail}`}>
        <span className="ios-operation-orb" aria-hidden="true"><InkOrb compact color={action.color} active={active && !preparing}/></span>
        <span className="ios-operation-copy"><strong>{action.label}</strong><small>{action.detail}</small></span><ArrowUpRight size={20} aria-hidden="true"/>
      </Pressable>)}
    </div>
    {entryPending && <div className="ios-entry-status" aria-live="polite" aria-busy={preparing}><div><strong>{phoneEntryTitle(entryPending)}</strong><p>{phoneEntryMessage(entryPending)}</p></div>{entryPending.phase === 'failed' && <Pressable onClick={onRetryOpening}>Retry</Pressable>}<Pressable className="scan-entry-cancel" onClick={onCancelOpening}>Cancel</Pressable></div>}
  </section>;
}

export function IosSearch({ disabled, routeKey, onSearch }) {
  const [open, setOpen] = useState(false), [text, setText] = useState('');
  const host = useRef(null), field = useRef(null), trigger = useRef(null);
  const close = () => { setOpen(false); trigger.current?.focus({ preventScroll:true }); };
  usePhoneBack(() => { close(); return true; }, { enabled:open, priority:650 });
  useEffect(() => { setOpen(false); }, [routeKey, disabled]);
  useEffect(() => {
    if (!open) return;
    field.current?.focus({ preventScroll:true });
    const outside = event => { if (!host.current?.contains(event.target)) setOpen(false); };
    const escape = event => { if (event.key === 'Escape') { event.preventDefault(); close(); } };
    document.addEventListener('pointerdown',outside); document.addEventListener('keydown',escape);
    return () => { document.removeEventListener('pointerdown',outside); document.removeEventListener('keydown',escape); };
  }, [open]);
  return <div ref={host} className="ios-search" data-open={open}>
    <button ref={trigger} className="ios-search-trigger" disabled={disabled} aria-label="Search inventory" aria-expanded={open} onClick={() => setOpen(value => !value)}><Search size={21}/></button>
    {open && <form className="ios-search-panel" role="search" aria-label="Inventory search" onSubmit={event => { event.preventDefault(); if (!disabled) { setOpen(false); onSearch(text); } }}><label htmlFor="ios-inventory-search">Search inventory</label><div><Search size={19} aria-hidden="true"/><input ref={field} id="ios-inventory-search" type="search" value={text} maxLength={200} placeholder="Battery, tag, model or holder" enterKeyHint="search" onChange={event => setText(event.target.value)}/><Pressable aria-label="Close inventory search" onClick={close} type="button"><X size={20}/></Pressable></div><footer><Pressable type="button" onClick={() => { setText(''); field.current?.focus(); }}>Clear search</Pressable><Pressable type="submit">Search<ArrowUpRight size={17}/></Pressable></footer></form>}
  </div>;
}

const dockIcons = { scan:ScanLine, inventory:Package, workspace:LayoutGrid };
const dockLabels = { scan:'Scan', inventory:'Inventory', workspace:'Workspace' };

export function IosDock({ area, hidden, disabled, unreadCount, onNavigate, inventoryIndicator }) {
  const reduced = usePhoneReducedMotion(), [drag, setDrag] = useState(null);
  const dock = useRef(null), gesture = useRef(null), suppressClick = useRef(false), me = useRef(null), motions = useRef([]), lens = useRef(null), optics = useRef(null), dockMotion = useRef(null), activeArea = useRef(area);
  activeArea.current=area;
  useEffect(() => {
    const control=createIosDockMotion({bar:dock.current,lens:lens.current,optics:optics.current,initial:Math.max(0,IOS_MAIN_AREAS.indexOf(activeArea.current)),reduced,hidden});
    dockMotion.current=control;
    return () => { control.dispose(); if(dockMotion.current===control)dockMotion.current=null; };
  }, [reduced,hidden]);
  const stopMotion = () => { motions.current.forEach(animation => animation.cancel()); motions.current = []; };
  useEffect(() => {
    setDrag(null); gesture.current = null;
    dockMotion.current?.select(Math.max(0,IOS_MAIN_AREAS.indexOf(area)));
  }, [area]);
  useEffect(() => { setDrag(null); gesture.current=null; stopMotion(); dockMotion.current?.cancel(); }, [hidden, disabled, reduced]);
  useEffect(() => {
    const hiddenPage = () => { if (document.visibilityState === 'hidden') { gesture.current = null; setDrag(null); stopMotion(); dockMotion.current?.cancel(); } };
    document.addEventListener('visibilitychange', hiddenPage);
    return () => { document.removeEventListener('visibilitychange', hiddenPage); stopMotion(); };
  }, []);
  function navigateMe() {
    if (disabled) return;
    stopMotion();
    if (!reduced) motions.current = [...me.current.querySelectorAll('.ios-me-drop')].map((drop,index) => {
      const angle = index / 6 * Math.PI * 2;
      return drop.animate([{ transform:'translate(0,0) scale(.4)', opacity:0 }, { opacity:.75, offset:.25 }, { transform:`translate(${Math.cos(angle)*36}px,${Math.sin(angle)*36}px) scale(.15)`, opacity:0 }], { duration:460, easing:'cubic-bezier(.18,.7,.25,1)' });
    });
    onNavigate('me');
  }
  function release(event, cancelled) {
    const current = gesture.current; gesture.current = null; setDrag(null);
    dockMotion.current?.cancel();
    if (!current || current.id !== event.pointerId || !current.moved) return;
    suppressClick.current = true;
    if (!cancelled && !disabled) {
      const bounds = dock.current.getBoundingClientRect(), index = iosDockPosition(event.clientX,bounds.left,bounds.width);
      if (index !== null) onNavigate(IOS_MAIN_AREAS[Math.round(index)]);
    }
  }
  const index = drag ?? IOS_MAIN_AREAS.indexOf(area);
  return <div className="ios-navigation" hidden={hidden}>
    <nav ref={dock} className="ios-dock" aria-label="Primary mobile navigation" data-dragging={drag !== null} data-me-active={area === 'me' && drag === null} style={{ '--ios-dock-position':Math.max(0,index) }}
      onPointerDown={event => { suppressClick.current = false; if (!disabled && event.button === 0 && event.isPrimary !== false) { gesture.current = { id:event.pointerId, x:event.clientX, y:event.clientY, moved:false }; const bounds=dock.current.getBoundingClientRect(); dockMotion.current?.press(iosDockPosition(event.clientX,bounds.left,bounds.width)); } }}
      onPointerMove={event => { const current = gesture.current; if (!current || current.id !== event.pointerId || disabled) return; const dx=event.clientX-current.x,dy=event.clientY-current.y; if (!current.moved && Math.abs(dy)>12 && Math.abs(dy)>Math.abs(dx)) { gesture.current=null; dockMotion.current?.cancel(); return; } if (Math.abs(dx)>8) current.moved=true; if (current.moved) { event.currentTarget.setPointerCapture(event.pointerId); const bounds=dock.current.getBoundingClientRect(),position=iosDockPosition(event.clientX,bounds.left,bounds.width); setDrag(position); dockMotion.current?.drag(position,event.timeStamp); } }}
      onPointerUp={event => release(event,false)} onPointerCancel={event => release(event,true)} onLostPointerCapture={() => { gesture.current=null; setDrag(null); dockMotion.current?.cancel(); }} onClickCapture={event => { if (suppressClick.current && event.detail !== 0) { suppressClick.current=false; event.preventDefault(); event.stopPropagation(); } }}>
      <span ref={lens} className="ios-dock-selection" aria-hidden="true"><span className="ios-optic-window"><span ref={optics} className="ios-optics">{IOS_MAIN_AREAS.map(id => { const Icon=dockIcons[id]; return <span className="ios-optic-item" key={id}><Icon size={21}/><span>{dockLabels[id]}</span></span>; })}</span></span></span>{IOS_MAIN_AREAS.map(id => { const Icon=dockIcons[id]; return <Pressable key={id} aria-current={area === id ? 'page' : undefined} disabled={disabled} onClick={() => onNavigate(id)}><span className="ios-dock-icon"><Icon size={21}/>{id === 'inventory' && inventoryIndicator}</span><span>{dockLabels[id]}</span></Pressable>; })}
    </nav>
    <div className="ios-me-host" ref={me}><span className="ios-me-splash" aria-hidden="true">{Array.from({ length:6 },(_,index) => <i className="ios-me-drop" key={index}/>)}</span><Pressable className="ios-me-control" aria-label={unreadCount > 0 ? `Me, ${unreadCount} unread messages` : 'Me'} aria-current={area === 'me' ? 'page' : undefined} disabled={disabled} onClick={navigateMe}><InkOrb compact color="purple" active={!hidden}/>{unreadCount > 0 && <i className="ios-unread" aria-hidden="true"/>}<span>Me</span></Pressable></div>
  </div>;
}
