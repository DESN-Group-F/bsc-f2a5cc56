import { Pressable } from '../../app/phone-ui.jsx';
import { useEffect, useRef, useState } from 'react';
import { ArrowRightLeft, ChevronDown, Download, RotateCcw } from 'lucide-react';
import { useTaskEndpoint } from '../../shared/hooks/use-task-endpoint.js';
import { formatTime, teachingSpecificationDifferenceLabel } from '../../shared/lib/client-utils.js';
import { downloadTeachingCheckoutReport } from '../../shared/lib/client/teaching-checkout-download.js';
import { getRolePermissions } from '../../shared/lib/permissions.js';
import { isActiveBattery } from '../../shared/lib/battery-lifecycle.js';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '../../shared/components/ui/dialog.js';
import { Button } from '../../shared/components/ui/button.js';
import { TeachingGroupsPanel } from '../../shared/components/inventory/teaching-groups-panel.js';
import { InventoryScreen } from '../inventory/inventory.jsx';
import { inventoryViewKey, readInventoryView } from '../inventory/inventory-model.mjs';
import { useWorkflowLock } from '../../business/workflow-boundary.jsx';
import { PhonePagination, PhoneResourceState, PhoneSearch, PhoneTabs, PhoneTools, usePhoneViewState } from './phone-controls.jsx';
import { PhoneBusinessSurface } from './phone-business-surface.jsx';
import { parseOwnTeachingRuns, teachingRunMatches, teachingRunPresentation } from './teaching-run-model.mjs';

function inputLabel(source) {
  return source?.kind === 'native_nfc' ? 'Adopted native NFC reading' : source?.kind === 'tag' ? 'Entered registered tag' : source?.kind === 'selection' ? 'Inventory selection' : 'Source evidence unavailable';
}

function ActualLoan({ presentation, data, group, locked, run, onExchange, onDetail, onPermanent }) {
  const { item, mapping, originalId, current, alternative, permanent, canExchange } = presentation;
  const original = data.batteries.find(battery => battery.id === originalId);
  const actual = data.batteries.find(battery => battery.id === item.batteryId);
  const canPermanent = group && current && alternative && group.batteryIds.includes(originalId) && !group.batteryIds.includes(item.batteryId) && actual?.lifecycleStatus === 'active';
  return <article className={`mobile-actual-loan${item.pendingReturn && item.status === 'outstanding' ? ' pending' : ''}`}>
    <span className="mobile-phone-kicker">{item.pendingReturn && item.status === 'outstanding' ? 'Previous battery pending return' : item.status === 'outstanding' ? 'In use by you' : item.status === 'returned' ? 'Returned' : item.status === 'cancelled' ? 'Loan corrected' : 'Deleted record'}</span>
    <Pressable type="button" className="mobile-actual-identity" disabled={locked || item.status === 'deleted'} onClick={() => onDetail(item.batteryId)}><strong>{item.batteryId}</strong><span>{mapping?.actual?.name ?? actual?.name ?? 'Historic battery record'}</span></Pressable>
    <p className="mobile-phone-caption">{alternative ? `Default slot ${originalId} · ${permanent ? 'Default membership updated' : item.status === 'outstanding' ? 'Temporary alternative' : 'Temporary use ended'}` : 'Default member'}{mapping?.loanOrigin === 'existing' ? ' · Existing loan continued' : ''}</p>
    <details className="mobile-phone-context"><summary>Loan & input evidence</summary><dl className="mobile-actual-facts"><dt>Recorded loan</dt><dd><code>{item.loanId ?? 'Deleted evidence'}</code></dd><dt>Checked out</dt><dd>{formatTime(item.checkedOutAt)}</dd>{item.returnedAt && <><dt>Returned</dt><dd>{formatTime(item.returnedAt)}</dd></>}<dt>Input</dt><dd>{inputLabel(mapping?.source)}</dd></dl></details>
    {current && alternative && item.status === 'outstanding' && original?.lifecycleStatus === 'active' && !original.loanId && <p className="mobile-phone-caption">{originalId} is now available to borrow. Keep using {item.batteryId}; no automatic swap or extra checkout is required.</p>}
    {mapping?.method === 'manual' && <p className="mobile-phone-caption">{mapping.specificationMatch === null ? 'Deleted specification evidence.' : mapping.differences.length ? mapping.differences.map(teachingSpecificationDifferenceLabel).join(' · ') : 'Recorded specifications match; manually selected.'} Teaching suitability is not verified by the system.</p>}
    <div className="mobile-phone-actions">{canExchange && <Pressable type="button" disabled={locked} onClick={() => onExchange(run, item)}><ArrowRightLeft size={17} aria-hidden="true" />Review exchange</Pressable>}{canPermanent && <Pressable type="button" disabled={locked} onClick={() => onPermanent(group, originalId, item.batteryId)}>Review permanent replacement</Pressable>}</div>
  </article>;
}

export function MobileTeachingGroupDetail({ data, user, dataset, group, ready, groupDefinitionReady = ready, revision = 0, overlayOpen = false, returnBlocked = false, active = true, onBackGroups, onTools, onDetail, onOperation, onEdit, onExport, onChanged, onActivity, onMaintenance, onReturn, onContinue, onExchange }) {
  const viewKey = `${user.id}:${dataset}:${group.id}`;
  const [tab, setTab] = usePhoneViewState(viewKey, 'tab', 'members');
  const [search, setSearch] = usePhoneViewState(viewKey, 'search', '');
  const [outstandingOnly, setOutstandingOnly] = usePhoneViewState(viewKey, 'outstandingOnly', true);
  const [expanded, setExpanded] = usePhoneViewState(viewKey, 'expanded', []);
  const [collapsed, setCollapsed] = usePhoneViewState(viewKey, 'collapsed', []);
  const [page, setPage] = usePhoneViewState(viewKey, 'page', 0);
  const [focusRun, setFocusRun] = useState(null);
  const [choice, setChoice] = useState(null);
  const [queuedCheckout, setQueuedCheckout] = useState(null);
  const launched = useRef(null);
  const [manager, setManager] = useState(null);
  const [downloading, setDownloading] = useState(null);
  const [notice, setNotice] = useState('');
  const resource = useTaskEndpoint(`/api/teaching-checkouts?dataset=${dataset}`, user.id, `${revision}|${data.events.map(event => event.id).join('|')}`, !active || overlayOpen || !!choice || !!manager || !!downloading);
  let runs = [], evidenceError = '';
  if (resource.payload) {
    try { runs = parseOwnTeachingRuns(resource.payload, user.id, dataset); }
    catch (failure) { evidenceError = failure.message; }
  }
  const ownRuns = runs.filter(run => run.teachingGroup.id === group.id);
  const ongoing = ownRuns.filter(run => run.items.some(item => item.status === 'outstanding'));
  const matching = runs.filter(run => teachingRunMatches(run, group.id, search, outstandingOnly));
  const currentPage = Math.min(page, Math.max(0, Math.ceil(matching.length / 10) - 1));
  const locked = !ready || overlayOpen || resource.loading || !!resource.error || !!evidenceError || !!downloading;
  useWorkflowLock(active && (!!choice || !!manager || !!downloading));
  const scope = { kind: 'group', id: group.id, label: group.name };
  const reference = { id: group.id, version: group.version };
  const permissions = getRolePermissions(user.role);
  useEffect(() => {
    if (!active || !queuedCheckout || launched.current === queuedCheckout || returnBlocked || overlayOpen || choice || manager || locked) return;
    launched.current = queuedCheckout;
    setQueuedCheckout(null);
    onOperation('checkout', queuedCheckout.ids, { kind: 'group', id: group.id, label: group.name }, true);
  }, [active, queuedCheckout, returnBlocked, overlayOpen, choice, manager, locked, onOperation, group.id, group.name]);
  function operation(kind, ids) {
    if (locked) { setNotice('Refresh actual checkout evidence before preparing another group operation.'); return; }
    if (kind === 'checkout' && ongoing.length) setChoice({ ids: [...ids] });
    else onOperation(kind, ids, scope);
  }
  function toggleRecords(runId, shown) {
    setFocusRun(null);
    setCollapsed(previous => shown ? [...new Set([...previous, runId])] : previous.filter(id => id !== runId));
    setExpanded(previous => shown ? previous.filter(id => id !== runId) : [...new Set([...previous, runId])]);
  }
  function focusExisting(run) {
    setChoice(null); setTab('actual'); setSearch(''); setOutstandingOnly(true); setPage(Math.max(0, Math.floor(ongoing.findIndex(item => item.id === run.id) / 10))); setFocusRun(run.id); setCollapsed(previous => previous.filter(id => id !== run.id));
    requestAnimationFrame(() => document.getElementById(`mobile-actual-run-${run.id}`)?.scrollIntoView({ block: 'start', behavior: 'instant' }));
  }
  function updateSelectedMembers() {
    if (locked || !permissions.editBatteryRecords) return;
    const ids = readInventoryView(inventoryViewKey(user.id, dataset, scope), scope).selectedIds;
    if (!ids.length || ids.length > 100 || ids.some(id => !group.batteryIds.includes(id) || !isActiveBattery(data.batteries.find(battery => battery.id === id)))) {
      setNotice('Select 1–100 active members in this group before reviewing a shared record update.');
      return;
    }
    onMaintenance(ids, group);
  }
  async function download(run, format) {
    if (downloading) return;
    setDownloading(run.id); setNotice('');
    try { await downloadTeachingCheckoutReport(dataset, run.id, format); setNotice('Complete checkout evidence was downloaded.'); }
    catch (failure) { setNotice(failure.message); }
    finally { setDownloading(null); }
  }
  return <section className="mobile-teaching-detail" aria-label={`${group.name} teaching group`}>
    <p className="mobile-phone-purpose">{group.name} · saved membership and actual loans are separate.</p><div className="mobile-phone-actions"><Pressable type="button" disabled={!groupDefinitionReady || overlayOpen || !!choice || !!manager || !!downloading} onClick={onTools}>Edit group definition</Pressable><Pressable type="button" onClick={onBackGroups}>All teaching groups</Pressable></div>
    {group.notes && <details className="mobile-phone-context"><summary>Group notes</summary><p>{group.notes}</p></details>}
    <PhoneTools onRefresh={resource.refresh} label="Group definition & all tools" disabled={overlayOpen || !!choice || !!manager || !!downloading} actions={[{ label: 'Group activity', disabled: !ready || overlayOpen, onClick: () => onActivity(reference) }, ...(permissions.editBatteryRecords && onMaintenance ? [{ label: 'Update selected members', disabled: locked, onClick: updateSelectedMembers }] : [])]}><span className="mobile-phone-caption">{group.batteryIds.length} saved members</span></PhoneTools>
    <div className="mobile-phone-actions">{tab === 'members' && <Pressable type="button" className="primary" disabled={locked} onClick={() => operation('checkout', group.batteryIds)}>Review group checkout</Pressable>}</div>
    <PhoneTabs value={tab} onChange={setTab} items={[[ 'members', 'Members' ], [ 'actual', 'Actual checkouts' ]]} label="Teaching group views" disabled={overlayOpen || !!choice || !!manager || !!downloading} />
    {notice && <p className="mobile-phone-notice" role="status">{notice}</p>}
    <div hidden={tab !== 'members'}><div className="mobile-group-members"><InventoryScreen data={data} user={user} dataset={dataset} scope={scope} active={active && tab === 'members' && !overlayOpen && !choice && !manager} onDetail={onDetail} onOperation={operation} onExport={onExport} onEdit={battery => onEdit({ kind: 'battery', record: battery }, reference)} onGroup={ids => setManager({ initialIds: ids })} /></div></div>
    <div hidden={tab !== 'actual'}><PhoneSearch value={search} onChange={value => { setSearch(value); setPage(0); }} label="Search checkout or actual battery ID" onClear={() => { setSearch(''); setOutstandingOnly(false); setPage(0); }} clearDisabled={!search && !outstandingOnly} /><label className="mobile-actual-filter"><input type="checkbox" checked={outstandingOnly} onChange={event => { setOutstandingOnly(event.target.checked); setPage(0); }} />Outstanding checkouts only</label><PhoneResourceState loading={resource.loading} retained={!!resource.payload} error={resource.error || evidenceError} onRetry={resource.refresh} empty={!matching.length} emptyText="No matching actual checkouts. Clear filters to include completed records." />{resource.payload && !evidenceError && <div className="mobile-actual-runs" data-phone-results tabIndex={-1}>{matching.slice(currentPage * 10, (currentPage + 1) * 10).map(run => {
      const presentation = teachingRunPresentation(run, group);
      const showRecords = !collapsed.includes(run.id) && (focusRun === run.id || expanded.includes(run.id));
      return <article className="mobile-actual-run" key={run.id} id={`mobile-actual-run-${run.id}`}><header><span className="mobile-phone-kicker">Recorded {formatTime(run.createdAt)}</span><h3>{presentation.outstanding.length} outstanding · {run.items.length} recorded loans</h3><p>{run.actorName} · Recorded group {run.teachingGroup.name}</p></header>{presentation.pending.length > 0 && <p className="mobile-actual-pending" role="status">Previous batteries pending return: {presentation.pending.map(item => item.batteryId).join(', ')}</p>}<PhoneTools disabled={!!downloading} actions={[{ label: 'Download checkout', icon: Download, onClick: () => download(run, 'xlsx') }, { label: 'Download JSON evidence', onClick: () => download(run, 'json') }]}>{presentation.outstanding.length > 0 && <Pressable type="button" className="mobile-phone-primary" disabled={locked} onClick={() => onReturn(run)}><RotateCcw size={17} aria-hidden="true" />Review returns</Pressable>}</PhoneTools>{presentation.blockedIds.length > 0 && <p className="mobile-actual-pending">Default members awaiting a previous battery return: {presentation.blockedIds.join(', ')}. Return those previous loans before adding these members again.</p>}{presentation.missingIds.length > 0 && presentation.outstanding.length > 0 && <div className="mobile-actual-continue"><p>{presentation.missingIds.length} current default members are not covered by this checkout.</p><Pressable type="button" className="mobile-phone-primary" disabled={locked} onClick={() => onContinue(run, group, presentation.missingIds)}>Add batteries to this checkout</Pressable></div>}<Pressable type="button" className="mobile-actual-records-toggle" aria-expanded={showRecords} onClick={() => toggleRecords(run.id, showRecords)}>Actual batteries & evidence<ChevronDown size={18} aria-hidden="true" /></Pressable>{showRecords && <><div className="mobile-actual-loans">{presentation.items.map(item => <ActualLoan key={item.item.loanId ?? `${item.item.batteryId}:${item.originalId}`} presentation={item} data={data} group={group} run={run} locked={locked} onExchange={onExchange} onDetail={onDetail} onPermanent={(savedGroup, originalBatteryId, replacementBatteryId) => setManager({ group: savedGroup, replacement: { originalBatteryId, replacementBatteryId } })} />)}</div>{run.changes?.length > 0 && <section className="mobile-actual-changes"><h4>Changes during this checkout</h4>{run.changes.map(change => <article key={change.id}><strong>{change.action === 'exchange' ? 'Battery exchange' : 'Batteries added'}</strong><p>{formatTime(change.at)} · {change.actorName}</p><p>{change.mappings.map(mapping => `${mapping.original.batteryId} → ${mapping.actual.batteryId}`).join(', ')}{change.outgoing && 'returned' in change.outgoing ? ` · ${change.outgoing.batteryId} ${change.outgoing.returned ? 'returned during exchange' : 'kept outstanding at exchange'}` : ''}</p></article>)}</section>}<details className="mobile-actual-snapshot"><summary>Complete saved evidence</summary><pre>{JSON.stringify(run, null, 2)}</pre></details></>}</article>;
    })}</div>}<PhonePagination page={page} count={matching.length} pageSize={10} onPage={setPage} /></div>
    {choice && <Dialog open={active} onOpenChange={open => { if (!open) setChoice(null); }}><DialogContent className="mobile-teaching-choice-dialog"><DialogHeader><DialogTitle>Continue an existing checkout?</DialogTitle><DialogDescription>This group has outstanding actual loans. An available default member does not mean its alternative or previous battery was returned.</DialogDescription></DialogHeader><div className="mobile-teaching-choice-body">{ongoing.map(run => <article key={run.id}><h3>{formatTime(run.createdAt)}</h3><p>{teachingRunPresentation(run, group).outstanding.map(item => item.batteryId).join(', ')} remain outstanding.</p><Button onClick={() => focusExisting(run)}>Continue existing checkout</Button></article>)}<p className="mobile-phone-caption">A separate session deliberately creates another checkout. Existing loans remain outstanding and cannot cover two active runs.</p></div><DialogFooter><Button variant="outline" onClick={() => setChoice(null)}>Cancel</Button><Button variant="outline" disabled={locked} onClick={() => { setQueuedCheckout(choice); setChoice(null); }}>Start separate new checkout</Button></DialogFooter></DialogContent></Dialog>}
    {active && manager && <PhoneBusinessSurface task="group-definition"><TeachingGroupsPanel data={data} initialIds={manager.initialIds} initialGroup={manager.group} initialReplacement={manager.replacement} onClose={() => setManager(null)} onChanged={onChanged} onSaved={() => { setManager(null); }} onFilter={() => setManager(null)} onSelect={() => setManager(null)} /></PhoneBusinessSurface>}
  </section>;
}
