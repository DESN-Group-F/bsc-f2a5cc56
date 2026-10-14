import React, { useEffect, useRef, useState } from 'react';
import { Search, X, ArrowUpRight, ArrowRight, ArrowUpFromLine, ArrowDownToLine, Plus, Trash2, ScanLine, Package, LayoutGrid, UserRound } from 'lucide-react';
import { IosInkCharacter } from './ios-ink-character.jsx';
import { Pressable, usePhoneBack, usePhoneReducedMotion } from './phone-ui.jsx';
import { IOS_MAIN_AREAS, IOS_SCAN_ACTIONS } from './ios-presentation.mjs';
import { createIosDockMotion, iosDockPointer } from './ios-dock-motion.mjs';
import { phoneEntryMessage, phoneEntryTitle } from './phone-entry-intent.mjs';
import './ios-presentation.css';

export function IosScanHome({ active, entryPending, onLookup, onOperation, onCancelOpening, onRetryOpening }) {
  const primary=useRef(null);
  const preparing = !!entryPending && entryPending.phase !== 'failed';
  const actions = ['checkout','return','removal'].map(kind=>IOS_SCAN_ACTIONS.find(action=>action.kind===kind));
  const icons = { checkout:ArrowUpFromLine, return:ArrowDownToLine, removal:Trash2 };
  return <section className="mobile-scan-home ios-scan-home" data-ink-gaze-scope>
    <div className="ios-scan-focus"><p className="ios-scan-purpose">SCAN TO VIEW · NO STOCK CHANGES</p>
      <Pressable className="ios-scan-primary" disabled={!!entryPending || !onLookup} onClick={()=>{primary.current?.burst({departing:true});onLookup?.();}} aria-label="Start scan to view battery details; no stock changes"><IosInkCharacter ref={primary} color="blue" active={active && !preparing}/><span className="ios-orb-shadow" aria-hidden="true"/></Pressable>
      <h2>A little tap.<br/>A clearer picture.</h2><p className="ios-scan-description">Read a tag to see its battery record.</p>
    </div>
    <Pressable className="ios-intake-entry" disabled={!!entryPending || !onOperation} onClick={()=>onOperation?.('intake')} aria-label="Intake: Register new stock"><span className="ios-intake-symbol"><Plus size={23} aria-hidden="true"/></span><span><strong>Add a batch</strong><small>Prepare once. Review before registering.</small></span><ArrowRight size={20} aria-hidden="true"/></Pressable>
    <div className="ios-operation-grid" aria-label="Scan and battery operations">
      {actions.map(action => { const Icon=icons[action.kind];return <Pressable key={action.kind} className="ios-operation" disabled={!!entryPending || !onOperation} onClick={()=>onOperation?.(action.kind)} aria-label={`${action.label}: ${action.detail}`}><Icon size={22} aria-hidden="true"/><span>{action.label}</span></Pressable>; })}
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

const dockIcons = { scan:ScanLine, inventory:Package, workspace:LayoutGrid, me:UserRound };
const dockLabels = { scan:'Scan', inventory:'Inventory', workspace:'Workspace', me:'Me' };

export function IosDock({ area, hidden, disabled, unreadCount, onNavigate, inventoryIndicator }) {
  const reduced = usePhoneReducedMotion(), [dragging, setDragging] = useState(false);
  const dock = useRef(null), gesture = useRef(null), suppressClick = useRef(false), lens = useRef(null), optics = useRef(null), dockMotion = useRef(null), activeArea = useRef(area);
  activeArea.current=area;
  function cancelGesture() {
    const current=gesture.current;gesture.current=null;setDragging(false);
    if(current){suppressClick.current=true;if(dock.current?.hasPointerCapture(current.id))dock.current.releasePointerCapture(current.id);}
    dockMotion.current?.cancel();
    if(dock.current)delete dock.current.dataset.dropAllowed;
  }
  useEffect(() => {
    const control=createIosDockMotion({bar:dock.current,lens:lens.current,optics:optics.current,initial:Math.max(0,IOS_MAIN_AREAS.indexOf(activeArea.current)),reduced,hidden});
    dockMotion.current=control;
    return () => { control.dispose(); if(dockMotion.current===control)dockMotion.current=null; };
  }, [reduced,hidden]);
  useEffect(() => {
    cancelGesture();
    dockMotion.current?.select(Math.max(0,IOS_MAIN_AREAS.indexOf(area)));
  }, [area]);
  useEffect(() => { cancelGesture(); }, [hidden, disabled, reduced]);
  useEffect(() => {
    const hiddenPage = () => { if (document.visibilityState === 'hidden') cancelGesture(); };
    document.addEventListener('visibilitychange', hiddenPage);
    return () => { document.removeEventListener('visibilitychange', hiddenPage); const current=gesture.current;gesture.current=null;if(current&&dock.current?.hasPointerCapture(current.id))dock.current.releasePointerCapture(current.id); };
  }, []);
  function release(event, cancelled) {
    const current=gesture.current;if(!current||current.id!==event.pointerId)return;
    const point=iosDockPointer(dock.current,event.clientX,event.clientY);
    cancelGesture();
    if(!cancelled&&!disabled&&!hidden&&point?.target>=0)onNavigate(IOS_MAIN_AREAS[point.target]);
  }
  return <div className="ios-navigation" hidden={hidden}>
    <nav ref={dock} className="ios-dock" aria-label="Primary mobile navigation" data-dragging={dragging} style={{ '--ios-dock-position':Math.max(0,IOS_MAIN_AREAS.indexOf(area)),touchAction:'none' }}
      onPointerDown={event => { if(disabled||hidden||gesture.current||event.button!==0||event.isPrimary===false)return;const point=iosDockPointer(dock.current,event.clientX,event.clientY);if(!point)return;suppressClick.current=false;gesture.current={id:event.pointerId};event.currentTarget.setPointerCapture(event.pointerId);setDragging(true);dock.current.dataset.dropAllowed=String(point.target>=0);dockMotion.current?.press(point.position,point.y); }}
      onPointerMove={event => { if(gesture.current?.id!==event.pointerId||disabled||hidden)return;const point=iosDockPointer(dock.current,event.clientX,event.clientY);if(!point)return;dock.current.dataset.dropAllowed=String(point.target>=0);dockMotion.current?.drag(point.position,event.timeStamp,point.y); }}
      onPointerUp={event => release(event,false)} onPointerCancel={event => release(event,true)} onLostPointerCapture={event => {if(gesture.current?.id===event.pointerId)cancelGesture();}} onContextMenu={event=>event.preventDefault()} onClickCapture={event => { if (suppressClick.current && event.detail !== 0) { suppressClick.current=false; event.preventDefault(); event.stopPropagation(); } }}>
      <span ref={lens} className="ios-dock-selection" aria-hidden="true"><span className="ios-optic-window"><span ref={optics} className="ios-optics">{IOS_MAIN_AREAS.map(id => { const Icon=dockIcons[id]; return <span className="ios-optic-item" key={id}><Icon size={21}/><span>{dockLabels[id]}</span></span>; })}</span></span></span>{IOS_MAIN_AREAS.map(id => { const Icon=dockIcons[id]; return <button type="button" className="phone-pressable" data-phone-control="action" key={id} aria-label={id==='me'&&unreadCount>0?`Me, ${unreadCount} unread messages`:dockLabels[id]} aria-current={area === id ? 'page' : undefined} disabled={disabled} style={{touchAction:'none'}} onClick={() => {if(!disabled&&!hidden)onNavigate(id);}}><span className="ios-dock-icon"><Icon size={21}/>{id === 'inventory' && inventoryIndicator}{id==='me'&&unreadCount>0&&<i aria-hidden="true"/>}</span><span>{dockLabels[id]}</span></button>; })}
    </nav>
  </div>;
}
