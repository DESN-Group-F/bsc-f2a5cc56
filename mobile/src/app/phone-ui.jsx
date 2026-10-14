import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createPhoneBackRegistry, createPhonePressIntent } from './phone-interaction.mjs';
import { phoneScrollIntent, phoneScrollOwner } from './phone-scroll.mjs';
import { createPortal as reactPortal } from 'react-dom';

const PhoneContext = createContext(null), sessions = new Map();
function uiSession(namespace, realm = sessions) {
  if (!realm.has(namespace)) {
    const values = new Map(), listeners = new Set();
    realm.set(namespace, { values, subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); }, set(key,value) { if (Object.is(values.get(key),value)) return; values.set(key,value); listeners.forEach(listener => listener()); } });
  }
  return realm.get(namespace);
}

export function PhoneUIProvider({ namespace, scrollRef, reducedMotion = false, backRegistry, children }) {
  const realm = useRef(new Map());
  const session = useMemo(() => uiSession(namespace,realm.current), [namespace]), ownBack = useMemo(() => createPhoneBackRegistry(), [namespace]), back = backRegistry || ownBack;
  const value = useMemo(() => ({ namespace, session, back, scrollRef, active: true, reducedMotion }), [namespace,session,back,scrollRef,reducedMotion]);
  return <PhoneContext.Provider value={value}>{children}</PhoneContext.Provider>;
}
export function PhoneUIBoundary({ active = true, workflowOwner, children }) {
  const parent = useContext(PhoneContext), value = useMemo(() => parent && { ...parent, active: parent.active && active, workflowOwner:workflowOwner ?? parent.workflowOwner }, [parent,active,workflowOwner]);
  return <PhoneContext.Provider value={value}>{children}</PhoneContext.Provider>;
}
function PhoneWorkflowPortal({ children }) {
  const context = useContext(PhoneContext);
  if (!context?.workflowOwner) return children;
  return React.cloneElement(children,{'data-phone-workflow-owner':context.workflowOwner,inert:!context.active ? true : children.props.inert,'aria-hidden':!context.active ? true : children.props['aria-hidden']});
}
/** Owned station portals inherit an exact boundary identity even outside its DOM subtree. */
export function createPhoneWorkflowPortal(children,container,key) { return reactPortal(<PhoneWorkflowPortal>{children}</PhoneWorkflowPortal>,container,key); }
export function usePhoneContext() { return useContext(PhoneContext); }
export function usePhoneReducedMotion() { return useContext(PhoneContext)?.reducedMotion || false; }

/** Session UI only: queries, selection, expansion, position. Never store credentials or business requests. */
export function usePhoneViewState(key, initialValue) {
  const context = useContext(PhoneContext), fallback = useMemo(() => uiSession('standalone'), []), session = context?.session || fallback;
  if (/(?:password|credential|session-token|secret)/i.test(key)) throw new Error('Sensitive values cannot be retained as phone view state.');
  if (!session.values.has(key)) session.values.set(key, typeof initialValue === 'function' ? initialValue() : initialValue);
  const value = useSyncExternalStore(session.subscribe, () => session.values.get(key));
  const setValue = useCallback(next => session.set(key, typeof next === 'function' ? next(session.values.get(key)) : next), [session,key]);
  return [value,setValue];
}

/** Return true after handling Back. Higher priority runs first; inactive area boundaries do not register. */
export function usePhoneBack(handler, { enabled = true, priority = 20 } = {}) {
  const context = useContext(PhoneContext), latest = useRef(handler); latest.current = handler;
  useEffect(() => { if (context?.active && enabled) return context.back.register(event => latest.current(event),priority); }, [context?.back,context?.active,enabled,priority]);
}

/** System Back closes a visible layer through its guarded handler, independently of IME focus. */
export function usePhoneOverlayDismiss(ref, handler, { enabled = true } = {}) {
  const context=useContext(PhoneContext), latest=useRef(handler);latest.current=handler;
  useEffect(() => {
    const node=ref.current;if (!enabled || context?.active === false || !node) return;
    const dismiss=event => {event.preventDefault();latest.current?.(event);};
    node.addEventListener('battery-mobile-dismiss',dismiss);return()=>node.removeEventListener('battery-mobile-dismiss',dismiss);
  },[ref,enabled,context?.active]);
}

export function usePhonePress(onClick) {
  const intent = useRef(createPhonePressIntent()), [pressed,setPressed] = useState(false), latest = useRef(onClick); latest.current = onClick;
  return {
    'data-pressed': pressed || undefined,
    onPointerDown(event) {
      if (event.button !== 0 || event.isPrimary === false) return;
      const scrolling = phoneScrollIntent.scrolling(phoneScrollOwner(event.currentTarget));
      intent.current.begin(event.clientX,event.clientY,scrolling); setPressed(!scrolling);
    },
    onPointerMove(event) { if (!intent.current.move(event.clientX,event.clientY)) setPressed(false); },
    onPointerUp() { intent.current.finish(); setPressed(false); },
    onPointerCancel() { intent.current.cancel(); setPressed(false); },
    onClick(event) {
      const selection = globalThis.getSelection?.();
      if (!intent.current.activate(event.detail === 0) || selection?.toString() && event.currentTarget.contains(selection.anchorNode)) { event.preventDefault(); event.stopPropagation(); return; }
      latest.current?.(event);
    },
  };
}
export function Pressable({ onClick, className = '', children, busy = false, disabled = false, ...props }) {
  const press = usePhonePress(event => { if (!disabled && !busy) onClick?.(event); });
  return <button type="button" {...props} {...press} disabled={disabled || busy} aria-busy={busy || props['aria-busy']} data-phone-control="action" className={`phone-pressable ${className}`}>{children}</button>;
}

/** Layout slots describe the active surface; business components retain their own guards. */
export function PhoneDialogFrame({ children, className = '', ...props }) { return <div {...props} data-phone-dialog-frame className={className}>{children}</div>; }
export function PhoneDialogHeader({ children, ...props }) { return <header {...props} data-phone-dialog-header>{children}</header>; }
export function PhoneDialogBody({ children, ...props }) { return <div {...props} data-phone-dialog-body data-phone-sheet-scroll>{children}</div>; }
export function PhoneDialogActions({ children, ...props }) { return <footer {...props} data-phone-dialog-footer>{children}</footer>; }
