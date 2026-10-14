import { useEffect, useRef, useId } from 'react';
import { X } from 'lucide-react';
import { Pressable } from '../../app/phone-ui.jsx';

export function PhoneTaskDialog({ title, description, children, actions, onClose, locked = false }) {
  const dialog = useRef(null), titleId = useId(), close = useRef(onClose), protectedState = useRef(locked);
  close.current = onClose; protectedState.current = locked;
  useEffect(() => {
    const element = dialog.current, trigger = document.activeElement;
    const dismiss = event => { event.preventDefault(); event.stopPropagation(); if (!protectedState.current) close.current(); };
    element.addEventListener('battery-mobile-dismiss', dismiss); element.showModal();
    return () => { element.removeEventListener('battery-mobile-dismiss', dismiss); element.close(); if (trigger?.isConnected && !trigger.closest('[inert],[hidden]')) trigger.focus?.({ preventScroll: true }); };
  }, []);
  return <dialog ref={dialog} className="mobile-task-dialog" data-phone-overlay aria-labelledby={titleId} onCancel={event => { event.preventDefault(); if (!locked) onClose(); }}>
    <header><div><h2 id={titleId}>{title}</h2>{description && <p>{description}</p>}</div><Pressable type="button" data-phone-overlay-close disabled={locked} aria-label={`Close ${title}`} onClick={onClose}><X size={22} aria-hidden="true" /></Pressable></header>
    <div className="mobile-task-dialog-body" data-phone-sheet-scroll>{children}</div>
    {actions && <footer>{actions}</footer>}
  </dialog>;
}
