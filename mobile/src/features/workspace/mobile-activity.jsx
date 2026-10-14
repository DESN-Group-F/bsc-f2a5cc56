import { PhoneChoice } from '../../app/phone-choice.jsx';
import { Pressable } from '../../app/phone-ui.jsx';
import { useState } from 'react';
import { Check, ChevronDown, Download, History } from 'lucide-react';
import { useTaskEndpoint } from '../../shared/hooks/use-task-endpoint.js';
import { actionNames, durationLabel, formatTime } from '../../shared/lib/client-utils.js';
import { filterActivity, groupActivity, teachingReplacementDescription } from '../../shared/lib/group-activity.js';
import { defaultInventoryFilter } from '../../shared/lib/inventory-query.js';
import { isActiveBattery, batteryStatusLabel } from '../../shared/lib/battery-lifecycle.js';
import { ActivityExportDialog } from '../../shared/components/inventory/activity-export-dialog.js';
import { useWorkflowLock } from '../../business/workflow-boundary.jsx';
import { PhonePagination, PhoneResourceState, PhoneSearch, PhoneTools, usePhoneViewState } from './phone-controls.jsx';
import { workspaceStateKey } from './phone-view-state.mjs';

export function eventDescription(event) {
  const details = event.details ?? {};
  if (typeof details.reason === 'string') return `Reason: ${details.reason}`;
  if (typeof details.borrower === 'string') return `Borrower: ${details.borrower}`;
  if (event.action === 'records_imported') return `${typeof details.count === 'number' ? details.count : 'Count not recorded'} ${typeof details.kind === 'string' ? details.kind : 'records'} imported`;
  if (typeof details.room === 'string') return `${details.room} · ${typeof details.source === 'string' ? details.source : 'Source not recorded'}`;
  if (event.action === 'charge_recorded') return `Completed ${formatTime(details.completedAt)} · ${durationLabel(typeof details.durationMinutes === 'number' ? details.durationMinutes : null)}`;
  if (details.after?.name) return `${details.after.name} · ${details.after.id}`;
  return typeof details.note === 'string' ? details.note : '';
}

function EventEvidence({ event, data, personal, ready, onDetail, onOperation }) {
  const battery = data.batteries.find(item => item.id === event.batteryId);
  const description = eventDescription(event);
  const replacement = teachingReplacementDescription(event);
  return <div className="mobile-event-evidence">{event.batteryId && <Pressable type="button" className="mobile-phone-text-button" onClick={() => onDetail(event.batteryId)}>{event.batteryId}</Pressable>}{description && <p>{description}</p>}{replacement && <p>{replacement}</p>}<p className="mobile-phone-caption">{event.actorName} · {formatTime(event.at)}</p>{personal && event.batteryId && <div className="mobile-event-current"><span>Current state: {battery ? batteryStatusLabel(battery) : 'Unavailable'}</span>{battery && isActiveBattery(battery) && onOperation && <Pressable type="button" disabled={!ready} onClick={() => onOperation(battery.loanId ? 'return' : 'checkout', [battery.id])}>{battery.loanId ? 'Prepare return' : 'Prepare checkout'}</Pressable>}</div>}<details><summary>Recorded evidence</summary><pre>{JSON.stringify(event.details, null, 2)}</pre></details></div>;
}

export function MobileActivity({ active = true, data, personal = false, revision = 0, initialGroupId = null, ready, onDetail, onOperation, onTools, onGroupChange }) {
  const viewKey = workspaceStateKey(data.user.id, data.dataset, personal ? 'my-activity' : 'activity');
  const [search, setSearch] = usePhoneViewState(viewKey, 'search', '');
  const [groupId, setGroupId] = usePhoneViewState(viewKey, 'groupId', initialGroupId);
  const [page, setPage] = usePhoneViewState(viewKey, 'page', 0);
  const [expanded, setExpanded] = usePhoneViewState(viewKey, 'expanded', []);
  const [selecting, setSelecting] = usePhoneViewState(viewKey, 'selecting', false);
  const [selected, setSelected] = usePhoneViewState(viewKey, 'selected', []);
  const [download, setDownload] = useState(false);
  const scope = personal ? 'mine' : 'all';
  const resource = useTaskEndpoint(`/api/inventory?${new URLSearchParams({ dataset: data.dataset, activity: 'all', activityScope: scope })}`, data.user.id, `${revision}|${data.events.map(event => event.id).join('|')}`, !active || download);
  const events = Array.isArray(resource.payload?.events) ? resource.payload.events : [];
  const entries = groupActivity(events);
  const matching = filterActivity(entries, search, groupId).sort((a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id));
  const currentPage = Math.min(page, Math.max(0, Math.ceil(matching.length / 25) - 1));
  const groups = [...new Map(entries.flatMap(entry => entry.teachingGroup ? [[entry.teachingGroup.id, entry.teachingGroup.name]] : [])).entries()];
  const retained = selected.filter(id => entries.some(entry => entry.id === id));
  useWorkflowLock(active && download);
  const incomplete = !resource.loading && !resource.error && resource.payload && !Array.isArray(resource.payload.events) ? 'The complete history response was incomplete. Retry loading.' : '';
  function clearFilters() { setSearch(''); setGroupId(null); onGroupChange?.(null); setPage(0); }
  return <div className="mobile-phone-records">
    <PhoneTools onTools={onTools} onRefresh={resource.refresh} disabled={download} actions={[{ label: retained.length ? `Download ${retained.length} selected` : 'Download filtered history', icon: Download, disabled: resource.loading || !!resource.error || !!incomplete || (!matching.length && !retained.length), onClick: () => setDownload(true) }]}><span className="mobile-phone-caption">{matching.length} operations · Sydney time</span></PhoneTools>
    <PhoneSearch value={search} onChange={value => { setSearch(value); setPage(0); }} label="Search group, battery, actor or action" onClear={clearFilters} clearDisabled={!search && !groupId} />
    <details className="mobile-phone-filters"><summary>Filter{groupId ? ' · Applied' : ''}</summary><div className="mobile-phone-filter-row"><PhoneChoice label="Recorded group" value={groupId ?? ""} onChange={next => { const value = next || null; setGroupId(value); onGroupChange?.(value); setPage(0); }} options={[{value:"",label:"All recorded operations"}, ...groups.map(([id,name]) => ({value:id,label:name})), ...(groupId && !groups.some(([id]) => id === groupId) ? [{value:groupId,label:"Group has no recorded activity"}] : [])]}/></div></details>
    <div className="mobile-phone-actions"><Pressable type="button" onClick={() => setSelecting(value => !value)} disabled={!ready || resource.loading || !!resource.error}>{selecting ? 'Done selecting' : 'Select operations'}</Pressable>{retained.length > 0 && <><span className="mobile-phone-caption">{retained.length} selected</span><Pressable type="button" onClick={() => setDownload(true)} disabled={resource.loading || !!resource.error || !!incomplete}><Download size={17} aria-hidden="true" />Download selected</Pressable></>}{retained.length > 0 && <Pressable type="button" onClick={() => setSelected([])}>Clear selection</Pressable>}</div>
    <PhoneResourceState loading={resource.loading} retained={!!resource.payload} error={resource.error || incomplete} onRetry={resource.refresh} empty={!matching.length} emptyText="No matching recorded operations." />
    {resource.payload && !incomplete && <div className="mobile-event-list" data-phone-results tabIndex={-1}>{matching.slice(currentPage * 25, (currentPage + 1) * 25).map(entry => {
      const isExpanded = expanded.includes(entry.id);
      const chosen = retained.includes(entry.id);
      return <article key={entry.id} className={`mobile-event-card${chosen ? ' selected' : ''}`}><Pressable type="button" className="mobile-event-main" aria-expanded={selecting ? undefined : isExpanded} role={selecting ? 'checkbox' : undefined} aria-checked={selecting ? chosen : undefined} onClick={() => selecting ? setSelected(previous => previous.includes(entry.id) ? previous.filter(id => id !== entry.id) : [...previous, entry.id]) : setExpanded(previous => previous.includes(entry.id) ? previous.filter(id => id !== entry.id) : [...previous, entry.id])}><span className={`mobile-event-symbol${selecting ? ' selection-mode' : ''}`}>{selecting ? chosen ? <Check size={18} aria-hidden="true" /> : null : <History size={18} aria-hidden="true" />}</span><span><small>{formatTime(entry.at)}</small><strong>{actionNames[entry.action] ?? entry.action}</strong><em>{entry.teachingGroup ? `${entry.teachingGroup.name} · ${entry.members.length} batteries` : entry.batteryId ?? 'Inventory record'} · {entry.actorName}</em></span>{!selecting && <ChevronDown size={18} aria-hidden="true" className={isExpanded ? 'expanded' : ''} />}</Pressable>{isExpanded && <div className="mobile-event-expanded">{entry.teachingGroup && <p className="mobile-phone-caption">Saved group version {entry.teachingGroup.version} at operation time. Current group membership does not change this evidence.</p>}{(entry.members ?? [entry]).map(event => <EventEvidence key={event.id} event={event} data={data} personal={personal} ready={ready} onDetail={onDetail} onOperation={onOperation} />)}</div>}</article>;
    })}</div>}
    <PhonePagination page={page} count={matching.length} onPage={setPage} />
    {active && download && <ActivityExportDialog dataset={data.dataset} scope={scope} search={search} groupId={groupId} batteryFilter={{ ...defaultInventoryFilter(), lifecycle: 'all' }} selectedIds={retained} count={matching.length} onClose={() => setDownload(false)} />}
  </div>;
}
