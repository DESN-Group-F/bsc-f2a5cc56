import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Ellipsis, RefreshCw, Search, SlidersHorizontal, X } from 'lucide-react';
import { Pressable, usePhoneBack as useShellBack, usePhoneViewState as useShellViewState } from '../../app/phone-ui.jsx';
import { usePhoneContentMotion } from '../../app/phone-content-motion.js';

export function usePhoneViewState(key, field, initial) {
  if (/password|secret|token/i.test(field)) throw new Error('Credentials cannot be retained as workspace view state.');
  return useShellViewState(`${key}:${field}`, initial);
}

export function usePhoneBack(active, close, priority = 300) {
  useShellBack(() => { close?.(); return true; }, { enabled: active, priority });
}

export function PhoneSearch({ value, onChange, label, disabled = false, onClear, clearDisabled = !value }) {
  return <div className="mobile-phone-search"><label><Search size={18} aria-hidden="true" /><input aria-label={label} type="search" value={value} maxLength={200} placeholder={label} onChange={event => onChange(event.target.value)} disabled={disabled} /></label>{!clearDisabled && <Pressable type="button" className="mobile-phone-search-clear" aria-label="Clear search and filters" onClick={onClear} disabled={disabled}><X size={18} aria-hidden="true" /></Pressable>}</div>;
}

export function PhoneTabs({ value, onChange, items, label, disabled = false }) {
  const root = useRef(null);
  usePhoneContentMotion(root, value, { within: '.mobile-phone-records,.mobile-teaching-detail', select: '[data-phone-results],.mobile-group-members' });
  return <div ref={root} className="mobile-phone-tabs" role="group" aria-label={label}>{items.map(([key, text]) => <Pressable type="button" key={key} aria-pressed={value === key} disabled={disabled} onClick={() => { if (value !== key) onChange(key); }}>{text}</Pressable>)}</div>;
}

export function PhonePagination({ page, count, pageSize = 25, onPage }) {
  const root = useRef(null);
  usePhoneContentMotion(root, page, { within: '.mobile-phone-records,.mobile-teaching-detail', select: '[data-phone-results]' });
  const maxPage = Math.max(0, Math.ceil(count / pageSize) - 1);
  const current = Math.min(page, maxPage);
  if (!maxPage) return null;
  function change(event, next) {
    const owner = event.currentTarget.closest('.mobile-phone-records, .mobile-teaching-detail');
    const results = [...owner?.querySelectorAll('[data-phone-results]') ?? []].find(node => node.getClientRects().length);
    onPage(next);
    requestAnimationFrame(() => results?.scrollIntoView({ block: 'start', behavior: 'instant' }));
  }
  return <div ref={root} className="mobile-phone-pagination"><span>{current * pageSize + 1}–{Math.min((current + 1) * pageSize, count)} of {count}</span><div><Pressable type="button" aria-label="Previous page" onClick={event => change(event, current - 1)} disabled={!current}><ArrowLeft size={18} aria-hidden="true" /></Pressable><span>{current + 1} / {maxPage + 1}</span><Pressable type="button" aria-label="Next page" onClick={event => change(event, current + 1)} disabled={current >= maxPage}><ArrowRight size={18} aria-hidden="true" /></Pressable></div></div>;
}

export function PhoneTools({ onTools, onRefresh, disabled = false, label = 'All tools & downloads', actions = [], children }) {
  const menu = useRef(null);
  const [menuOpen, setMenuOpen] = useState(false);
  function closeMenu(focus = false) { if (menu.current) menu.current.open = false; if (focus) menu.current?.querySelector('summary')?.focus({ preventScroll: true }); }
  useShellBack(() => { if (!menu.current?.open || !menu.current.getClientRects().length) return false; closeMenu(true); return true; }, { enabled: menuOpen, priority: 500 });
  useEffect(() => {
    if (!menuOpen) return;
    const outside = event => { if (!menu.current?.contains(event.target)) closeMenu(); };
    const escape = event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeMenu(true); } };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', escape, true);
    return () => { document.removeEventListener('pointerdown', outside, true); document.removeEventListener('keydown', escape, true); };
  }, [menuOpen]);
  useEffect(() => { if (disabled) closeMenu(); }, [disabled]);
  function run(action) { if (menu.current) menu.current.open = false; action?.(); }
  return <div className="mobile-phone-tools">{children}<details ref={menu} className="mobile-phone-more" onToggle={event => setMenuOpen(event.currentTarget.open)}><summary aria-label="More page actions"><Ellipsis size={21} aria-hidden="true" /><span>More</span></summary><div className="mobile-phone-more-actions">{actions.map(({ label: actionLabel, onClick, disabled: actionDisabled, icon: Icon }) => <Pressable type="button" key={actionLabel} disabled={disabled || actionDisabled} onClick={() => run(onClick)}>{Icon && <Icon size={18} aria-hidden="true" />}{actionLabel}</Pressable>)}{onRefresh && <Pressable type="button" onClick={() => run(onRefresh)} disabled={disabled}><RefreshCw size={18} aria-hidden="true" />Refresh records</Pressable>}{onTools && <Pressable type="button" onClick={() => run(onTools)} disabled={disabled}><SlidersHorizontal size={18} aria-hidden="true" />{label}</Pressable>}</div></details></div>;
}

export function PhoneResourceState({ loading, error, onRetry, empty, retained = false, emptyText = 'No matching records.' }) {
  if (retained) return <><div className="mobile-phone-resource-status" data-resource-state={loading ? 'refreshing' : error ? 'stale' : 'ready'} role={error && !loading ? 'alert' : 'status'}><span>{loading ? 'Updating…' : error ? "Couldn't refresh these records." : ''}</span>{error && <><Pressable type="button" disabled={loading} onClick={onRetry}>Retry</Pressable><details><summary>Error details</summary><div><p>{error}</p></div></details></>}</div>{empty && <p className="mobile-work-empty">{emptyText}</p>}</>;
  if (error) return <div className="mobile-work-load-error" role="alert"><p>{retained ? "Couldn't refresh these records." : "Couldn't load these records."}</p><Pressable type="button" onClick={onRetry}>Retry</Pressable><details><summary>Error details</summary><p>{error}</p></details></div>;
  if (loading) return <p className={retained ? 'mobile-phone-updating' : 'mobile-work-empty'} role="status">{retained ? 'Updating…' : 'Loading records…'}</p>;
  if (empty) return <p className="mobile-work-empty">{emptyText}</p>;
  return null;
}
