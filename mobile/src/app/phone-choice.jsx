import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Search, X } from 'lucide-react';
import { createPhoneWorkflowPortal, Pressable, usePhoneBack, usePhoneContext, usePhoneOverlayDismiss } from './phone-ui.jsx';
import './phone-choice.css';

/** Exact controlled values; selection is delivered after the owned dialog closes. */
export function PhoneChoice({ label, name, value, options, onChange, disabled = false, searchable = options.length >= 8, placeholder = 'Choose…', variant = 'field', description, className = '', ...props }) {
  const context = usePhoneContext(), id = useId(), trigger = useRef(null), dialog = useRef(null), search = useRef(null);
  const [open, setOpen] = useState(false), [query, setQuery] = useState('');
  const pending = useRef(null), live = useRef(null), mounted = useRef(false), openedContext = useRef(null), wasOpen = useRef(false);
  live.current = { context, disabled, options, value, onChange };
  const selected = options.find(option => option.value === value), unavailable = value !== '' && !selected;
  function close() { pending.current = null; dialog.current?.close?.(); setOpen(false); }
  function choose(option) {
    const current = live.current;
    if (current.disabled || current.context?.active === false || option.disabled) return;
    pending.current = { value: option.value, previous: current.value, namespace: current.context?.namespace, owner: current.context?.workflowOwner };
    dialog.current?.close?.(); setOpen(false);
  }
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; pending.current = null; }; }, []);
  useLayoutEffect(() => {
    if (!open) return;
    const node = dialog.current;
    node?.showModal?.();
    const initial = node?.querySelector('[role="option"][aria-selected="true"]:not(:disabled)') || node?.querySelector('[role="option"]:not(:disabled)') || node?.querySelector('[data-choice-close]');
    initial?.focus({ preventScroll: true });
    return () => { if (node?.open) node.close(); };
  }, [open, searchable]);
  useEffect(() => { if (open && (disabled || context?.active === false || openedContext.current?.namespace !== context?.namespace || openedContext.current?.owner !== context?.workflowOwner)) close(); }, [open, disabled, context?.active, context?.namespace, context?.workflowOwner]);
  useLayoutEffect(() => {
    if (open) { wasOpen.current = true; return; }
    if (!wasOpen.current) return;
    wasOpen.current = false;
    const captured = pending.current;
    if (!captured) { if (!disabled && context?.active !== false) trigger.current?.focus({ preventScroll: true }); return; }
    const schedule = globalThis.requestAnimationFrame || (callback => setTimeout(callback, 0));
    const cancel = globalThis.cancelAnimationFrame || clearTimeout;
    const handle = schedule(() => {
      if (pending.current !== captured) return;
      pending.current = null;
      const current = live.current, option = current.options.find(item => item.value === captured.value);
      if (!mounted.current || current.disabled || current.context?.active === false || current.context?.namespace !== captured.namespace || current.context?.workflowOwner !== captured.owner || current.value !== captured.previous || !option || option.disabled || !trigger.current?.isConnected) return;
      trigger.current?.focus({ preventScroll: true });
      current.onChange?.(captured.value);
    });
    return () => cancel(handle);
  }, [open]);
  usePhoneBack(() => { close(); return true; }, { enabled: open, priority: 650 });
  usePhoneOverlayDismiss(dialog, close, { enabled: open });
  const normalized = query.trim().toLocaleLowerCase(), results = options.filter(option => !normalized || `${option.label} ${option.description || ''}`.toLocaleLowerCase().includes(normalized));
  return <div className={`phone-choice phone-choice-${variant} ${className}`}>
    {variant === 'field' && <label id={`${id}-label`} htmlFor={`${id}-trigger`}>{label}</label>}
    <Pressable {...props} ref={trigger} id={`${id}-trigger`} name={name} type="button" className="phone-choice-trigger" disabled={disabled || context?.active === false} aria-label={props['aria-label'] || (variant === 'compact' ? `${label}: ${selected?.label || placeholder}` : undefined)} aria-labelledby={variant === 'field' && !props['aria-label'] ? `${id}-label ${id}-value` : undefined} aria-haspopup="dialog" aria-expanded={open} data-unavailable={unavailable || undefined} onClick={() => { if (!live.current.disabled && live.current.context?.active !== false) { pending.current = null; openedContext.current = { namespace: live.current.context?.namespace, owner: live.current.context?.workflowOwner }; setQuery(''); setOpen(true); } }}>
      <span id={`${id}-value`}>{selected?.label || (unavailable ? 'Selection unavailable' : placeholder)}</span><ChevronDown size={18} aria-hidden="true" />
    </Pressable>
    {description && <p className="phone-choice-description">{description}</p>}
    {open && createPhoneWorkflowPortal(<div className="phone-choice-portal"><dialog ref={dialog} className="phone-choice-dialog" data-reduced-motion={context?.reducedMotion || undefined} aria-labelledby={`${id}-title`} onCancel={event => { event.preventDefault(); close(); }} onClick={event => { if (event.target === event.currentTarget) close(); }}>
      <div className="phone-choice-frame" data-phone-dialog-frame>
        <header data-phone-dialog-header><h2 id={`${id}-title`}>{label}</h2><Pressable data-choice-close type="button" aria-label={`Close ${label}`} onClick={close}><X size={20} /></Pressable></header>
        {searchable && <div className="phone-choice-search"><Search size={18} aria-hidden="true" /><input ref={search} type="search" aria-label={`Search ${label}`} placeholder="Search options" autoComplete="off" value={query} onChange={event => setQuery(event.target.value)} /></div>}
        <div className="phone-choice-options" data-phone-sheet-scroll role="listbox" aria-label={label} onKeyDown={event => { if (!['ArrowDown','ArrowUp','Home','End'].includes(event.key)) return; const controls = [...event.currentTarget.querySelectorAll('[role="option"]:not(:disabled)')]; if (!controls.length) return; const index = controls.indexOf(document.activeElement), next = event.key === 'Home' ? 0 : event.key === 'End' ? controls.length - 1 : event.key === 'ArrowDown' ? (index + 1) % controls.length : (index - 1 + controls.length) % controls.length; event.preventDefault(); controls[next]?.focus(); }}>
          {results.map(option => <Pressable type="button" role="option" key={option.value} aria-selected={option.value === value} disabled={option.disabled || disabled} onClick={() => choose(option)}><span><strong>{option.label}</strong>{option.description && <small>{option.description}</small>}</span>{option.value === value && <Check size={20} aria-hidden="true" />}</Pressable>)}
          {!results.length && <p className="phone-choice-empty">No matching options.{query && <Pressable type="button" onClick={() => { setQuery(''); search.current?.focus(); }}>Clear search</Pressable>}</p>}
        </div>
        <footer data-phone-dialog-footer><Pressable type="button" onClick={close}>Cancel</Pressable></footer>
      </div>
    </dialog></div>, document.body)}
  </div>;
}
