import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Battery, Check, ChevronLeft, ChevronRight, Download, Filter, ListChecks, MoreHorizontal, Plus, Search, X } from 'lucide-react';
import { batteryStatusLabel, isActiveBattery } from '../../shared/lib/battery-lifecycle.js';
import { getRolePermissions } from '../../shared/lib/permissions.js';
import { inventoryFilterSchema, inventorySortOptions, lastObservedLocations } from '../../shared/lib/inventory-query.js';
import { recentNewArrivals } from '../../shared/lib/new-arrivals.js';
import { currentSydneyDate } from '../../shared/lib/battery-age.js';
import { isSelectableRoom } from '../../shared/lib/location-catalog.js';
import { formatTime } from '../../shared/lib/client-utils.js';
import { TemporalInput } from '../../shared/components/ui/temporal-input.js';
import { initialInventoryView, inventoryBoundaryIds, inventoryExportDraft, inventoryViewKey, mobileFilterChips, newArrivalsInventoryView, queryInventory, readInventoryView, rememberInventoryView, selectedOperationState, inventoryEmptyState } from './inventory-model.mjs';
import { MappingScene } from './mapping-scene.jsx';
import { createInventoryTapGuard, inventoryScrollOwner, resultHeadingScrollTop } from './inventory-interaction.mjs';
import { usePhoneBack, usePhoneContext } from '../../app/phone-ui.jsx';
import { visiblePhoneOverlays } from '../../app/phone-interaction.mjs';
import { PhoneChoice } from '../../app/phone-choice.jsx';
import { usePhoneContentMotion } from '../../app/phone-content-motion.js';
import './inventory.css';

const areaMemory = new Map();
const SheetPortalContext = React.createContext(null);
function Sheet({ title, children, onClose, footer, wide = false }) {
  const dialog = useRef(null), close = useRef(onClose), titleId = React.useId(); close.current = onClose;
  const [portalContainer, setPortalContainer] = useState(null);
  const bindDialog = React.useCallback(element => { dialog.current = element; setPortalContainer(element); }, []);
  useEffect(() => {
    const element = dialog.current, trigger = document.activeElement;
    const dismiss = event => { event.preventDefault(); event.stopPropagation(); close.current(); };
    element.addEventListener('battery-mobile-dismiss', dismiss);
    if (!element.open) element.showModal();
    return () => {
      element.removeEventListener('battery-mobile-dismiss', dismiss);
      if (element.open) element.close();
      if (trigger?.isConnected && trigger.getClientRects().length && !trigger.closest?.('[inert],[hidden]')) trigger.focus?.({ preventScroll: true });
    };
  }, []);
  return <dialog ref={bindDialog} role="dialog" aria-modal="true" data-phone-overlay className={`mi-sheet ${wide ? 'mi-sheet-expanded' : ''}`} aria-labelledby={titleId} onKeyDown={event => { if (event.key === 'Escape' && !event.defaultPrevented) { event.preventDefault(); event.stopPropagation(); onClose(); } }} onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => { if (event.target === event.currentTarget) { const rect = event.currentTarget.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose(); } }}><SheetPortalContext.Provider value={portalContainer}><header><h2 id={titleId}>{title}</h2><button type="button" data-phone-overlay-close className="mi-icon-button" aria-label={`Close ${title}`} onClick={onClose}><X size={20} /></button></header><div className="mi-sheet-body">{children}</div>{footer && <footer>{footer}</footer>}</SheetPortalContext.Provider></dialog>;
}
function Choice({ label, value, options, onChange, disabled = false }) {
  return <PhoneChoice className="mi-field" label={label} value={value} disabled={disabled} onChange={onChange} options={options.map(item => ({ value: item.id, label: item.label, disabled: item.disabled }))}/>;
}
function MapRoomLabel({ room, count }) {
  return <span>{room?.label ?? 'Room views'}{!room && ` · ${count}`}</span>;
}
function Range({ name, draft, setDraft, title, lowKey, highKey, date = false, integer = false }) {
  const portalContainer = React.useContext(SheetPortalContext);
  const modeKey = `${name}Mode`, mode = draft[modeKey];
  function bound(key, value) { setDraft(old => ({ ...old, [key]: value === '' ? null : date ? value : Number(value) })); }
  return <fieldset className="mi-range"><legend>{title}</legend><Choice label="Recorded value" value={mode} options={[{ id: 'any', label: 'Any' }, { id: 'known', label: 'Recorded' }, { id: 'unknown', label: 'Not recorded' }]} onChange={value => setDraft(old => ({ ...old, [modeKey]: value, ...(value === 'unknown' ? { [lowKey]: null, [highKey]: null } : {}) }))} /><div className="mi-range-bounds">{[lowKey, highKey].map((key, index) => <label key={key} className="mi-field">{index ? 'Maximum' : 'Minimum'}{date ? <TemporalInput portalContainer={portalContainer} pickerContentProps={{ collisionBoundary: portalContainer, collisionPadding: 8, sticky: 'always', updatePositionStrategy: 'always', className: 'mi-mobile-date-picker' }} type="date" aria-label={`${title} ${index ? 'maximum' : 'minimum'}`} disabled={mode === 'unknown'} value={draft[key] ?? ''} onChange={event => bound(key, event.target.value)} /> : <input type="number" min={integer ? 0 : '0.000001'} step={integer ? 1 : 'any'} disabled={mode === 'unknown'} value={draft[key] ?? ''} onChange={event => bound(key, event.target.value)} />}</label>)}</div></fieldset>;
}
function FilterSheet({ data, scope, filter, onApply, onClose, fullRegister = false }) {
  const [draft, setDraft] = useState(filter), [error, setError] = useState('');
  const chips = mobileFilterChips(draft, data, scope, fullRegister);
  const count = category => chips.filter(item => item.category === category).length;
  const update = patch => { setError(''); setDraft(old => ({ ...old, ...patch })); };
  function apply() { const parsed = inventoryFilterSchema.safeParse(draft); if (!parsed.success) { setError(parsed.error.issues.map(item => item.message).join(' ')); return; } onApply(parsed.data); onClose(); }
  function values(key) { return [...new Set(data.batteries.map(item => item[key]).filter(value => value?.trim()))].sort((a, b) => a.localeCompare(b, 'en', { numeric: true })); }
  function savedChoice(key, title) { return <Choice label={title} value={draft[`${key}Unknown`] ? '__unknown' : draft[key] === null ? '__all' : `saved:${draft[key]}`} options={[{ id: '__all', label: 'All saved values' }, { id: '__unknown', label: 'Not recorded' }, ...values(key).map(value => ({ id: `saved:${value}`, label: value }))]} onChange={value => update({ [key]: value.startsWith('saved:') ? value.slice(6) : null, [`${key}Unknown`]: value === '__unknown' })} />; }
  const holders = [...new Map(data.batteries.filter(item => item.loanId && item.borrowerKind === 'staff' && item.borrowerAccountId).map(item => [item.borrowerAccountId, item.borrowerName ?? 'Staff account'])).entries()];
  const category = (title, key, children) => <details className="mi-filter-category"><summary>{title}{count(key) > 0 && <span>{count(key)} applied</span>}</summary><div>{children}</div></details>;
  return <Sheet title="Filter batteries" onClose={onClose} wide footer={<><button onClick={() => { setDraft(initialInventoryView(scope, fullRegister).filter); setError(''); }}>Clear filters</button><button className="mi-primary" onClick={apply}>Apply filters</button></>}>
    <label className="mi-field mi-search-field">Search<div><Search size={18} /><input value={draft.search} maxLength={200} placeholder="ID, name, model, tag, people or storage" onChange={event => update({ search: event.target.value })} /></div></label>
    {category('Battery details', 'details', <>{<Choice label="Record status" value={draft.lifecycle} options={[{ id: 'active', label: 'Active batteries' }, { id: 'all', label: 'All including removed' }, { id: 'scrapped', label: 'Scrapped' }, { id: 'permanently_removed', label: 'Permanently removed' }]} onChange={lifecycle => update({ lifecycle, status: 'all' })} />}{savedChoice('chemistry', 'Chemistry')}{savedChoice('model', 'Model')}<Range title="Capacity (mAh)" name="capacity" draft={draft} setDraft={setDraft} lowKey="capacityMinMah" highKey="capacityMaxMah" /><Range title="Voltage (V)" name="voltage" draft={draft} setDraft={setDraft} lowKey="voltageMin" highKey="voltageMax" /></>)}
    {category('Location', 'location', <><Choice label="Registered storage building" value={draft.building} options={[{ id: 'all', label: 'All buildings' }, ...(data.buildings ?? []).map(item => ({ id: item.id, label: `${item.id} · ${item.name}`, disabled: item.id !== 'J18' }))]} onChange={building => update({ building, room: 'all' })} /><Choice label="Registered storage room" value={draft.room} options={[{ id: 'all', label: 'All storage rooms' }, { id: '__unspecified', label: 'Room not specified' }, ...(data.rooms ?? []).filter(item => isSelectableRoom(item) && (draft.building === 'all' || item.buildingId === draft.building)).map(item => ({ id: item.id, label: `${item.number} · ${item.name}${item.isPlaceholder ? ' · Placeholder' : ''}` }))]} onChange={room => update({ room })} /><Choice label="Last observed location" value={draft.observedRoom} options={[{ id: 'all', label: 'All last observations' }, { id: '__not_observed', label: 'Not observed' }, { id: '__unavailable', label: 'Recorded address unavailable' }, ...lastObservedLocations(data.batteries)]} onChange={observedRoom => update({ observedRoom })} /><p className="mi-help">Registered home and dated observation are separate. Current room directory labels do not rewrite saved evidence.</p></>)}
    {category('People', 'people', <><Choice label="Responsible owner" value={draft.owner} options={[{ id: 'all', label: 'All responsible owners' }, ...(data.people ?? []).filter(item => item.role === 'staff' && item.accountId).map(item => ({ id: item.id, label: `${item.name} · ${data.staffDirectory?.find(staff => staff.id === item.accountId)?.username ?? item.accountId}` }))]} onChange={owner => update({ owner })} /><Choice label="Current staff holder" value={draft.holder} options={[{ id: 'all', label: 'All current holders' }, ...holders.map(([id, name]) => ({ id, label: `${name} · ${data.staffDirectory?.find(item => item.id === id)?.username ?? id}` }))]} onChange={holder => update({ holder })} />{scope?.kind !== 'group' && <Choice label="My teaching group" value={draft.groupId ?? '__all'} options={[{ id: '__all', label: 'All batteries' }, ...(data.teachingGroups ?? []).filter(item => item.state === 'active' && item.ownerAccountId === data.user.id).map(item => ({ id: item.id, label: `${item.name} · ${item.batteryIds.length} members` }))]} onChange={value => update({ groupId: value === '__all' ? null : value })} />}</>)}
    {category('Age & activity', 'activity', <><Range title="Age since manufacture (days)" name="age" draft={draft} setDraft={setDraft} lowKey="ageMinDays" highKey="ageMaxDays" integer /><Range title="Latest checkout date" name="checkout" draft={draft} setDraft={setDraft} lowKey="checkoutFrom" highKey="checkoutTo" date /><Range title="Latest charge date" name="charge" draft={draft} setDraft={setDraft} lowKey="chargeFrom" highKey="chargeTo" date /><p className="mi-help">Age as of {currentSydneyDate()}. Checkout and charge dates use Australia/Sydney.</p></>)}
    {category('Sort order', 'sort', <><Choice label="Sort by" value={draft.sortBy} options={inventorySortOptions} onChange={sortBy => update({ sortBy })} /><Choice label="Direction" value={draft.sortDirection} options={[{ id: 'asc', label: 'Ascending' }, { id: 'desc', label: 'Descending' }]} onChange={sortDirection => update({ sortDirection })} /><p className="mi-help">Unknown values stay last in both directions. Battery ID breaks ties.</p></>)}
    {error && <p className="mi-error" role="alert">{error}</p>}
  </Sheet>;
}

export function InventoryScreen({ data, user, dataset, scope = null, onDetail, onOperation, onExport, onEdit, onGroup, active = true, arrivals = data?.newArrivals, onViewNewArrivals, arrivalsPending = false, arrivalsError = '', onRegister, management = false, onImport }) {
  const phoneContext = usePhoneContext();
  const accountId = user?.id ?? data?.user?.id ?? '', contextKey = `${accountId}:${dataset}`;
  const savedArea = areaMemory.get(contextKey);
  const [area, setArea] = useState(savedArea?.area ?? 'batteries'), [openRooms, setOpenRooms] = useState(savedArea?.openRooms ?? []), [roomScope, setRoomScope] = useState(savedArea?.roomScope ?? null);
  const [sheet, setSheet] = useState(null);
  const [handoff, setHandoff] = useState(null), [handoffError, setHandoffError] = useState('');
  const latestHandoff = useRef(null);
  const currentScope = scope ?? (area === 'mapping' ? roomScope : null), key = inventoryViewKey(accountId, dataset, currentScope) + (management ? ':directory' : '');
  const [record, setRecord] = useState(() => ({ key, view: readInventoryView(key, currentScope, management) }));
  const view = record.key === key ? record.view : readInventoryView(key, currentScope, management);
  const root = useRef(null), resultHeading = useRef(null), current = useRef({ key, view }), lastScroll = useRef(-Infinity), pageChanged = useRef(false);
  const overview = area === 'mapping' && !scope && !roomScope;
  usePhoneContentMotion(root, `${area}:${roomScope?.id || ''}:${view.filter.status}:${view.page}`, { active, select: '.mi-mapping,.mi-record-list' });
  usePhoneBack(() => { if (sheet) return false; if (roomScope) setRoomScope(null); else setArea('batteries'); return true; }, { enabled: active && !scope && area === 'mapping', priority: 20 });
  current.current = { key, view };
  const [tapGuard] = useState(() => createInventoryTapGuard({ lastScrollAt: () => lastScroll.current }));
  useEffect(() => { setSheet(null); const saved = areaMemory.get(contextKey); setArea(saved?.area ?? 'batteries'); setOpenRooms(saved?.openRooms ?? []); setRoomScope(saved?.roomScope ?? null); }, [contextKey]);
  useEffect(() => { areaMemory.set(contextKey, { ...areaMemory.get(contextKey), area, openRooms, roomScope }); }, [contextKey, area, openRooms, roomScope]);
  useLayoutEffect(() => {
    if (!active) return;
    const owner = inventoryScrollOwner(root.current); if (!owner) return;
    const top = pageChanged.current ? resultHeadingScrollTop(resultHeading.current, owner) : overview ? areaMemory.get(contextKey)?.overviewScroll ?? 0 : readInventoryView(key, currentScope, management).scrollTop;
    pageChanged.current = false; owner.scrollTop = top;
    if (!overview) rememberInventoryView(key, { ...readInventoryView(key, currentScope, management), scrollTop: top });
  }, [key, area, active, view.page, view.pageSize, view.filter, overview]);
  useEffect(() => {
    if (!active) return;
    const owner = inventoryScrollOwner(root.current); if (!owner) return;
    const source = owner === document.scrollingElement ? document : owner;
    const save = () => {
      lastScroll.current = performance.now();
      if (overview) areaMemory.set(contextKey, { ...areaMemory.get(contextKey), overviewScroll: owner.scrollTop });
      else if (current.current.key === key) { const next = { ...current.current.view, scrollTop: owner.scrollTop }; rememberInventoryView(key, next); current.current.view = next; }
    };
    source.addEventListener('scroll', save, { passive: true });
    return () => source.removeEventListener('scroll', save);
  }, [active, key, contextKey, overview]);
  function updateView(patch) { const next = { ...view, scrollTop: readInventoryView(key, currentScope, management).scrollTop, ...patch }; rememberInventoryView(key, next); setRecord({ key, view: next }); }
  function changeFilter(patch) { updateView({ filter: { ...view.filter, ...patch }, page: 0, scrollTop: 0 }); }
  function clearFilters() { updateView({ filter: initialInventoryView(currentScope, management).filter, page: 0, scrollTop: 0 }); }
  function changePage(next) { pageChanged.current = true; updateView({ page: next, scrollTop: 0 }); }
  const queryData = useMemo(() => data ? { ...data, newArrivals: arrivals } : null, [data, arrivals]);
  const query = useMemo(() => {
    if (!data || data.dataset !== dataset || data.user.id !== accountId) return { matching: [], boundary: new Set(), statusCounts: { all: 0, in: 0, out: 0 }, baseActiveCount: 0, error: 'Waiting for this account and inventory snapshot.' };
    try {
      const matching = queryInventory(queryData, accountId, currentScope, view.filter), base = queryInventory(queryData, accountId, currentScope, { ...view.filter, status: 'all' });
      return { matching, boundary: inventoryBoundaryIds(queryData, accountId, currentScope), baseActiveCount: queryInventory(queryData, accountId, currentScope, initialInventoryView(currentScope).filter).filter(isActiveBattery).length,
        statusCounts: { all: base.length, in: base.filter(item => isActiveBattery(item) && !item.loanId).length, out: base.filter(item => isActiveBattery(item) && item.loanId).length }, error: '' };
    } catch (error) { return { matching: [], boundary: new Set(), statusCounts: { all: 0, in: 0, out: 0 }, baseActiveCount: 0, error: error.message }; }
  }, [queryData, dataset, accountId, currentScope?.kind, currentScope?.id, view.filter]);
  const permissions = getRolePermissions(user?.role ?? data?.user?.role);
  const selectedIds = [...new Set(view.selectedIds)].filter(id => query.boundary.has(id));
  const outsideScopeCount = view.selectedIds.length - selectedIds.length;
  const eligibility = selectedOperationState(data?.batteries ?? [], selectedIds);
  const chips = data ? mobileFilterChips(view.filter, data, currentScope, management) : [];
  const maxPage = Math.max(0, Math.ceil(query.matching.length / view.pageSize) - 1), page = Math.min(view.page, maxPage);
  const visible = query.matching.slice(page * view.pageSize, (page + 1) * view.pageSize);
  const matchingIds = new Set(query.matching.map(item => item.id)), batteryById = new Map((data?.batteries ?? []).map(item => [item.id, item]));
  const hiddenSelectedCount = selectedIds.filter(id => !matchingIds.has(id)).length;
  const selectedBatteries = selectedIds.map(id => batteryById.get(id));
  const selectedLoans = selectedBatteries.filter(item => isActiveBattery(item) && !!item.loanId).length;
  const selectedInStore = selectedBatteries.filter(item => isActiveBattery(item) && !item.loanId).length;
  const selectedRetired = selectedBatteries.length - selectedLoans - selectedInStore;
  const emptyState = inventoryEmptyState({ scope: currentScope, activeCount: query.baseActiveCount, recordCount: query.boundary.size, filtered: chips.length > 0, dataset });
  const arrivalItems = recentNewArrivals(arrivals);
  const arrivalByBattery = new Map(arrivalItems.map(item => [item.batteryId, item]));
  latestHandoff.current = { key,contextKey,scope:currentScope,active:active && phoneContext?.active !== false,sheet,data,permissions,query,selectedIds,onOperation,onGroup };
  useEffect(() => {
    if (!handoff) return;
    if (!active || phoneContext?.active === false || sheet || key !== handoff.key || contextKey !== handoff.contextKey) { setHandoff(null); return; }
    const frame = requestAnimationFrame(() => {
      const latest = latestHandoff.current;
      setHandoff(null);
      if (!latest.active || latest.sheet || latest.key !== handoff.key || latest.contextKey !== handoff.contextKey) return;
      if (visiblePhoneOverlays(document).length) { setHandoffError('Close the current dialog before preparing another task. Your selection is retained.'); return; }
      if (latest.query.error || handoff.ids.some(id => !latest.query.boundary.has(id)) || JSON.stringify(latest.selectedIds) !== JSON.stringify(handoff.ids)) { setHandoffError('The selected records or view changed. Review the retained selection before continuing.'); return; }
      if (handoff.kind === 'group') {
        if (!latest.permissions.manageOwnGroups || handoff.ids.length > 100) return;
        latest.onGroup?.([...handoff.ids],handoff.scope);
      } else {
        const permitted = handoff.kind === 'retire' ? latest.permissions.retireBatteries : latest.permissions.operateLoans;
        if (!permitted || !selectedOperationState(latest.data.batteries,handoff.ids)[handoff.kind]) { setHandoffError('The recorded loan state changed. Review the retained selection before preparing this task.'); return; }
        latest.onOperation?.(handoff.kind,[...handoff.ids],handoff.scope);
      }
    });
    return () => cancelAnimationFrame(frame);
  },[handoff,active,phoneContext?.active,sheet,key,contextKey]);
  function handoffAfterClose(kind) {
    setHandoffError('');
    setHandoff({ kind,ids:[...selectedIds],scope:currentScope ? {...currentScope} : null,key,contextKey });
    setSheet(null);
  }
  function toggle(id) { if (!query.boundary.has(id)) return; updateView({ selectedIds: view.selectedIds.includes(id) ? view.selectedIds.filter(item => item !== id) : [...view.selectedIds, id] }); }
  function detail(id) { onDetail?.(id, currentScope); }
  function rowTap(id) { if (window.getSelection()?.toString()) return; if (view.selecting) toggle(id); else detail(id); }
  function exportView(selectedOnly = false) { if (!query.error && !outsideScopeCount) { onExport?.(inventoryExportDraft(queryData, accountId, currentScope, { ...view, page, selectedIds }, selectedOnly)); setSheet(null); } }
  function viewNewArrivals() { if (currentScope || arrivalsPending) return; updateView(newArrivalsInventoryView(view)); setSheet(null); onViewNewArrivals?.(data.newArrivals?.throughSequence ?? 0); }
  function operation(kind) { if (eligibility[kind] && !outsideScopeCount) handoffAfterClose(kind); }
  function openRoom(next) { setOpenRooms(old => old.some(item => item.id === next.id) ? old : [...old, next]); setRoomScope(next); setArea('mapping'); }
  function closeRoom(id) { setOpenRooms(old => old.filter(item => item.id !== id)); if (roomScope?.id === id) setRoomScope(null); }
  if (!data || data.dataset !== dataset || data.user.id !== accountId) return <section className="mobile-inventory mi-loading" aria-busy="true"><Battery size={28} /><h2>Loading inventory</h2><p>Waiting for shared battery records.</p></section>;
  return <section ref={root} className="mobile-inventory" aria-label={currentScope?.label ?? 'Battery inventory'}>
    {!phoneContext && <header className="mi-heading"><h1>{scope?.label ?? 'Inventory'}</h1></header>}
    {handoffError && <p className="mi-error" role="alert">{handoffError}</p>}
    {!scope && <div className="mi-area-tabs" role="tablist" aria-label="Inventory views"><button role="tab" aria-selected={area === 'batteries'} onClick={() => { setArea('batteries'); setSheet(null); }}>Batteries</button><button role="tab" aria-selected={area === 'mapping'} onClick={() => { setArea('mapping'); setSheet(null); }}>Mapping</button></div>}
    {area === 'mapping' && !scope && openRooms.length > 0 && <div className="mi-room-switcher" aria-label="Open room views"><button className={!roomScope ? 'is-active' : ''} onClick={() => setRoomScope(null)}>Overview</button>{openRooms.length > 0 && <button aria-label="Choose an open room view" onClick={() => setSheet('rooms')}><MapRoomLabel room={roomScope} count={openRooms.length} /><ChevronRight size={18} /></button>}</div>}
    {overview ? <MappingScene data={data} memoryKey={contextKey} active={active && area === 'mapping'} onRoom={openRoom} /> : <>
      {currentScope && <section className="mi-fixed-scope" aria-label="Fixed inventory scope"><strong>{currentScope.label}</strong><p>{currentScope.kind === 'room' ? 'Latest observation boundary. These records do not confirm present location.' : currentScope.kind === 'owner' ? 'Your responsible ownership, separate from borrowing.' : currentScope.kind === 'holder' ? 'Batteries currently checked out to your account.' : 'Saved group members, separate from actual teaching loans.'} Filters and downloads stay within this view.</p></section>}
      <label className="mi-inventory-search"><Search size={18} aria-hidden="true" /><input type="search" aria-label="Search batteries, model, holder or storage" placeholder="Find a battery or holder" value={view.filter.search} maxLength={200} onChange={event => changeFilter({ search: event.target.value })} /></label>
      <p className="mi-loan-definition">Recorded loan state · In use means checked out. In store means no active checkout.</p>
      <div className="mi-status-tabs" role="tablist" aria-label="Recorded loan state">{[['all', 'All batteries'], ['in', 'In store'], ['out', 'In use']].map(([id, label]) => <button key={id} role="tab" aria-selected={view.filter.status === id} onClick={() => changeFilter({ status: id })}>{label}<b>{query.error ? '—' : query.statusCounts[id]}</b></button>)}</div>
      <div className="mi-toolbar"><button onClick={() => setSheet('filter')}><Filter size={17} />Filter{chips.length > 0 && <b>{chips.length}</b>}</button><button aria-pressed={view.selecting} onClick={() => updateView({ selecting: !view.selecting })}><ListChecks size={17} />{view.selecting ? 'Finish selecting' : 'Select batteries'}</button><button aria-label="Inventory actions" onClick={() => setSheet('actions')}><MoreHorizontal size={19} />More{!currentScope && arrivals?.unreadCount > 0 && <i className="mi-arrival-unread" role="img" aria-label={`${arrivals.unreadCount} unread new arrivals`} />}</button></div>
      {management && <div className="mi-management-actions">{onRegister && permissions.registerBatteries && <button className="mi-primary" onClick={onRegister}><Plus size={18} />Register batteries</button>}{onImport && permissions.registerBatteries && <button onClick={() => onImport('batteries')}>Import batteries</button>}</div>}
      {!currentScope && (arrivalItems.length > 0 || arrivals?.unreadCount > 0) && <div className="mi-arrivals-entry"><button className={view.filter.newArrivalsOnly ? 'is-active' : ''} aria-pressed={view.filter.newArrivalsOnly} disabled={arrivalsPending} onClick={viewNewArrivals}><Plus size={17} />{arrivalsPending ? 'Opening arrivals…' : `New arrivals · ${arrivalItems.length}`}{arrivals?.unreadCount > 0 && <i className="mi-arrival-unread" role="img" aria-label={`${arrivals.unreadCount} unread new arrivals`} />}</button></div>}
      {!currentScope && arrivalsError && <p className="mi-error" role="alert">{arrivalsError}</p>}
      {chips.length > 0 && <section className="mi-applied" aria-label="Applied filters"><div className="mi-filter-caption"><strong>{chips.length} applied {chips.length === 1 ? 'filter' : 'filters'}</strong><button className="mi-text-button" onClick={clearFilters}>Clear filters</button></div><div className="mi-chips">{chips.map(chip => <button key={chip.key} aria-label={`Remove ${chip.label}`} onClick={() => changeFilter(chip.reset)}><span>{chip.label}</span><X size={16} /></button>)}</div></section>}
      <div ref={resultHeading} className="mi-list-caption" tabIndex={-1}><span>{query.error ? 'Records unavailable' : `${query.matching.length} ${query.matching.length === 1 ? 'battery' : 'batteries'}${maxPage > 0 ? ` · ${page * view.pageSize + 1}–${Math.min((page + 1) * view.pageSize, query.matching.length)}` : ''}`}</span>{view.selecting && <button className="mi-text-button" disabled={!visible.length} onClick={() => updateView({ selectedIds: [...new Set([...view.selectedIds, ...visible.map(item => item.id)])] })}>Select this page</button>}</div>
      <div className="mi-record-list">
        {query.error && <p className="mi-error" role="alert">{query.error}</p>}
        {!query.error && !visible.length && <div className="mi-empty"><Battery size={32} /><h3>{emptyState.title}</h3><p>{emptyState.detail}</p>{emptyState.action === 'Clear filters' && <button onClick={clearFilters}>Clear filters</button>}{emptyState.action === 'View retired records' && <button onClick={() => changeFilter({ lifecycle: 'all' })}>View retired records</button>}{emptyState.action === 'Register batteries' && onRegister && permissions.registerBatteries && <button className="mi-primary" onClick={onRegister}>Register batteries</button>}</div>}
        <div className="mi-asset-board" aria-label="Battery cards">{visible.map(battery => <article className={`mi-record ${selectedIds.includes(battery.id) ? 'is-selected' : ''} ${view.selecting ? 'is-selecting' : ''}`} data-status={isActiveBattery(battery) ? battery.loanId ? 'out' : 'in' : 'retired'} key={battery.id} onPointerDown={tapGuard.down} onPointerMove={tapGuard.move} onPointerCancel={tapGuard.cancel} onClickCapture={tapGuard.click}>
          {view.selecting && <label className="mi-record-checkbox"><input type="checkbox" aria-label={`Select ${battery.id}`} checked={selectedIds.includes(battery.id)} onChange={() => toggle(battery.id)} /><span aria-hidden="true">{selectedIds.includes(battery.id) ? <Check size={16} /> : <Battery size={16} />}</span></label>}
          <button className="mi-record-main" onClick={() => rowTap(battery.id)} aria-pressed={view.selecting ? selectedIds.includes(battery.id) : undefined} aria-label={`${view.selecting ? 'Toggle selection for' : 'View details for'} ${battery.id}, ${battery.name || battery.id}, ${batteryStatusLabel(battery)}, ${battery.loanId ? `Holder: ${battery.borrowerName || 'Account name unavailable'}` : `Responsible: ${battery.ownerName || 'Name unavailable'}`}`}>
            <span className="mi-record-copy"><span className="mi-record-top"><strong className="mi-asset-name">{battery.name || battery.id}</strong><span className="mi-battery-status" data-status={isActiveBattery(battery) ? battery.loanId ? 'out' : 'in' : 'retired'}>{batteryStatusLabel(battery)}</span></span><span className="mi-record-identity"><b>{battery.id}</b>{battery.model && <span>{battery.model}</span>}{isActiveBattery(battery) && arrivalByBattery.has(battery.id) && <span className="mi-new-badge" title={`First registered ${formatTime(arrivalByBattery.get(battery.id).registeredAt)}`}>New{arrivalByBattery.get(battery.id).isUnread && <i className="mi-arrival-unread" role="img" aria-label="Unread new arrival" />}</span>}</span><span className="mi-asset-person"><span>Responsible: {battery.ownerName || 'Account name unavailable'}</span>{battery.loanId && <span>Holder: {battery.borrowerName || 'Account name unavailable'}</span>}</span>{currentScope?.kind === 'room' && <small className="mi-row-observation">{battery.observedAt ? `${Number.isFinite(Date.parse(battery.observedAt)) ? `Last observed ${formatTime(battery.observedAt)}` : 'Observation time unavailable'} · ${battery.observationSource || 'Source unavailable'}` : 'No observation recorded'}</small>}</span>
          </button>
          <button className="mi-row-detail" aria-label={`Open ${battery.id} details`} onClick={() => detail(battery.id)}><ChevronRight size={20} /></button>
        </article>)}</div>
      </div>
      {maxPage > 0 && <nav className="mi-pagination" aria-label="Inventory pages"><button disabled={!page} onClick={() => changePage(page - 1)}><ChevronLeft size={18} />Previous</button><span>{page + 1} / {maxPage + 1}</span><button disabled={page >= maxPage} onClick={() => changePage(page + 1)}>Next<ChevronRight size={18} /></button></nav>}
      {view.selectedIds.length > 0 && <div className="mi-selection-bar"><span><strong>{view.selectedIds.length}</strong> selected{hiddenSelectedCount > 0 && <small>{hiddenSelectedCount} outside current filters</small>}</span><button onClick={() => updateView({ selectedIds: [] })}>Clear</button><button className="mi-primary" disabled={!selectedIds.length || !!query.error || !!outsideScopeCount} onClick={() => setSheet('review')}>Choose action</button></div>}
      {outsideScopeCount > 0 && <p className="mi-error" role="alert">{outsideScopeCount} selected {outsideScopeCount === 1 ? 'record has' : 'records have'} left this view. Clear the selection before an operation or export.</p>}
    </>}
    {active && sheet === 'filter' && <FilterSheet data={data} scope={currentScope} fullRegister={management} filter={view.filter} onApply={filter => changeFilter(filter)} onClose={() => setSheet(null)} />}
    {active && sheet === 'actions' && <Sheet title="Inventory actions" onClose={() => setSheet(null)}><div className="mi-action-list">{!currentScope && <button disabled={arrivalsPending} onClick={viewNewArrivals}><Plus size={20} /><span><strong>{arrivalsPending ? 'Opening arrivals…' : 'New arrivals'} · {arrivalItems.length}</strong><small>{arrivals?.unreadCount ?? 0} unread · registered in the last 48 hours</small></span></button>}<button disabled={!!query.error || !!outsideScopeCount || !onExport} onClick={() => exportView()}><Download size={20} /><span><strong>Download batteries</strong><small>All filtered pages, current page or selected full histories</small></span></button>{onGroup && permissions.manageOwnGroups && selectedIds.length > 0 && <button disabled={selectedIds.length > 100 || !!outsideScopeCount} onClick={() => handoffAfterClose('group')}><ListChecks size={20} /><span><strong>Save as teaching group</strong><small>{selectedIds.length} selected · up to 100 members</small></span></button>}{onEdit && permissions.editBatteryRecords && selectedIds.length === 1 && <button disabled={!!outsideScopeCount || !isActiveBattery(batteryById.get(selectedIds[0]))} onClick={() => { setSheet(null); onEdit(batteryById.get(selectedIds[0])); }}><Filter size={20} /><span><strong>Edit selected record</strong><small>{selectedIds[0]}</small></span></button>}</div></Sheet>}
    {active && sheet === 'rooms' && <Sheet title="Open room views" onClose={() => setSheet(null)}><div className="mi-action-list"><button onClick={() => { setRoomScope(null); setSheet(null); }}>Overview</button></div><ul className="mi-review-list">{openRooms.map(room => <li key={room.id}><button aria-current={roomScope?.id === room.id ? 'page' : undefined} onClick={() => { setRoomScope(room); setSheet(null); }}><strong>{room.label}</strong></button><button aria-label={`Close ${room.label} view`} onClick={() => closeRoom(room.id)}><X size={20} /></button></li>)}</ul></Sheet>}
    {active && sheet === 'review' && <Sheet title={`Actions for ${selectedIds.length} batteries`} onClose={() => setSheet(null)} wide footer={<button disabled={!selectedIds.length || !onExport || !!outsideScopeCount} onClick={() => exportView(true)}><Download size={18} />Download selected details</button>}><p className="mi-help">Selection stays across filters and pages. Choose a task to prepare its queue. Review and confirmation happen in that workflow; nothing is saved here.</p><ul className="mi-review-list">{selectedIds.map(id => { const battery = batteryById.get(id); return <li key={id}><button onClick={() => { setSheet(null); detail(id); }}><span><strong>{battery.name || id}</strong><small>{id} · {batteryStatusLabel(battery)}</small></span></button><button aria-label={`Remove ${id} from selection`} onClick={() => toggle(id)}><X size={20} /></button></li>; })}</ul>{selectedIds.length > 100 && <p className="mi-error">Operations accept at most 100 batteries. Reduce the selection before an operation; downloads retain the complete selection.</p>}{selectedRetired > 0 && <p className="mi-error">{selectedRetired} retired {selectedRetired === 1 ? 'battery cannot' : 'batteries cannot'} enter a movement or removal queue.</p>}{selectedLoans > 0 && selectedInStore > 0 && <p className="mi-help">{selectedLoans} in use and {selectedInStore} in store. Review one recorded loan state at a time.</p>}<div className="mi-review-actions">{permissions.operateLoans && <><button className="mi-primary" disabled={!eligibility.checkout || !onOperation} onClick={() => operation('checkout')}>Prepare checkout</button><button className="mi-return-action" disabled={!eligibility.return || !onOperation} onClick={() => operation('return')}>Prepare return</button></>}{permissions.retireBatteries && <button disabled={!eligibility.retire || !onOperation} onClick={() => operation('retire')}>Prepare removal</button>}</div>{selectedLoans > 0 && <p className="mi-help">Return {selectedLoans === 1 ? 'the active loan' : `the ${selectedLoans} active loans`} before checkout or removal.</p>}</Sheet>}
  </section>;
}
