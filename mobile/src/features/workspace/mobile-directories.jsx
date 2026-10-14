import { Pressable } from '../../app/phone-ui.jsx';
import { useState } from 'react';
import { BookOpen, Building2, Copy, DoorOpen, Pencil, Plus, UsersRound } from 'lucide-react';
import { downloadExportAttachment, roomLabel } from '../../shared/lib/client-utils.js';
import { isSelectableRoom, isSupportedBuilding } from '../../shared/lib/location-catalog.js';
import { getRolePermissions } from '../../shared/lib/permissions.js';
import { useWorkflowLock } from '../../business/workflow-boundary.jsx';
import { ownTeachingGroups, teachingGroupSummary } from './workspace-model.mjs';
import { PhonePagination, PhoneResourceState, PhoneSearch, PhoneTabs, PhoneTools, usePhoneViewState } from './phone-controls.jsx';
import { workspaceStateKey } from './phone-view-state.mjs';

export function MobileTeachingGroups({ data, ready, onOpenGroup, onTools }) {
  const viewKey = workspaceStateKey(data.user.id, data.dataset, 'teaching-groups-list');
  const [search, setSearch] = usePhoneViewState(viewKey, 'search', '');
  const [page, setPage] = usePhoneViewState(viewKey, 'page', 0);
  const groups = ownTeachingGroups(data, data.user.id).filter(group => `${group.name} ${group.notes}`.toLowerCase().includes(search.trim().toLowerCase()));
  const currentPage = Math.min(page, Math.max(0, Math.ceil(groups.length / 25) - 1));
  return <div className="mobile-phone-records"><p className="mobile-phone-purpose">Your saved teaching sets. Saved members are separate from actual checkout runs.</p><div className="mobile-phone-actions mobile-main-actions"><Pressable type="button" className="primary" disabled={!ready} onClick={onTools}><Plus size={18} aria-hidden="true" />Create teaching group</Pressable></div><PhoneTools><span className="mobile-phone-caption">{groups.length} groups</span></PhoneTools><PhoneSearch value={search} onChange={value => { setSearch(value); setPage(0); }} label="Search group name or notes" onClear={() => setSearch('')} /><PhoneResourceState empty={!groups.length} emptyText="No teaching groups match this search. Create a teaching group or clear the search." /><div className="mobile-teaching-list" data-phone-results tabIndex={-1}>{groups.slice(currentPage * 25, (currentPage + 1) * 25).map(group => {
    const summary = teachingGroupSummary(group, data.batteries);
    return <article className="mobile-teaching-card" key={group.id}><span className="mobile-teaching-symbol"><BookOpen size={24} aria-hidden="true" /></span><h2>{group.name}</h2>{group.notes && <details className="mobile-phone-context"><summary>Notes</summary><p>{group.notes}</p></details>}<dl className="mobile-teaching-counts"><div><dt>Saved members</dt><dd>{summary.members}</dd></div><div><dt>In store</dt><dd>{summary.inStore}</dd></div><div><dt>In use</dt><dd>{summary.inUse}</dd></div></dl>{summary.retired > 0 && <p className="mobile-phone-caption">{summary.retired} retired saved members</p>}<Pressable type="button" className="mobile-phone-primary" disabled={!ready} onClick={() => onOpenGroup(group.id)}>Members & checkout runs</Pressable></article>;
  })}</div><PhonePagination page={page} count={groups.length} onPage={setPage} /></div>;
}

export function MobileDirectories({ data, ready, onEdit, onImport, onTools }) {
  const viewKey = workspaceStateKey(data.user.id, data.dataset, 'directories');
  const [kind, setKind] = usePhoneViewState(viewKey, 'kind', 'people');
  const [search, setSearch] = usePhoneViewState(viewKey, 'search', '');
  const [page, setPage] = usePhoneViewState(viewKey, 'page', 0);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const permission = getRolePermissions(data.user.role);
  const records = (kind === 'people' ? data.people.filter(person => person.role === 'staff' && person.accountId) : kind === 'buildings' ? data.buildings : data.rooms).filter(record => Object.values(record).join(' ').toLowerCase().includes(search.toLowerCase()));
  const currentPage = Math.min(page, Math.max(0, Math.ceil(records.length / 25) - 1));
  useWorkflowLock(busy);
  async function copyOwner(person) {
    const account = data.staffDirectory.find(item => item.id === person.accountId);
    if (!account?.active) return;
    setNotice('');
    try { if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable'); await navigator.clipboard.writeText(person.id); setNotice(`Owner ID copied: ${person.id}`); }
    catch { setNotice('Could not copy this owner ID. Select the displayed ID and copy it manually.'); }
  }
  async function download() {
    setBusy(true); setNotice('');
    try { await downloadExportAttachment({ dataset: data.dataset, mode: 'records', search, kind }, 'xlsx', `battery-${kind}-${data.dataset}.xlsx`); setNotice('Filtered directory download completed.'); }
    catch (error) { setNotice(error.message); }
    finally { setBusy(false); }
  }
  return <div className="mobile-phone-records"><p className="mobile-phone-purpose">Staff import references and registered storage directories. Room labels do not establish location evidence.</p>{permission.manageDirectories && kind !== 'people' && <div className="mobile-phone-actions mobile-main-actions"><Pressable type="button" className="primary" disabled={!ready || busy} onClick={() => onEdit({ kind: kind === 'buildings' ? 'building' : 'room' })}><Plus size={18} aria-hidden="true" />Register {kind === 'buildings' ? 'building' : 'room'}</Pressable></div>}<PhoneTools onTools={onTools} label="Directory tools" disabled={busy} actions={[{ label: 'Download filtered list', onClick: download, disabled: !records.length }, ...(permission.manageDirectories && kind !== 'people' ? [{ label: 'Import CSV', onClick: () => onImport(kind), disabled: !ready }] : [])]}><span className="mobile-phone-caption">{records.length} records</span></PhoneTools><PhoneTabs value={kind} onChange={value => { setKind(value); setPage(0); setNotice(''); }} items={[[ 'people', 'Staff' ], [ 'buildings', 'Buildings' ], [ 'rooms', 'Rooms' ]]} label="Directory kind" disabled={busy} /><PhoneSearch value={search} onChange={value => { setSearch(value); setPage(0); }} label="Search directory records" onClear={() => setSearch('')} disabled={busy} />{notice && <p className="mobile-phone-notice" role="status">{notice}</p>}<PhoneResourceState empty={!records.length} emptyText="No matching directory records." /><div className="mobile-directory-list" data-phone-results tabIndex={-1}>{records.slice(currentPage * 25, (currentPage + 1) * 25).map(record => {
    const account = kind === 'people' ? data.staffDirectory.find(item => item.id === record.accountId) : null;
    const available = kind === 'rooms' ? isSelectableRoom(record) : kind === 'buildings' ? isSupportedBuilding(record.id) : account?.active;
    return <article key={record.id} className="mobile-directory-card"><div className="mobile-directory-heading"><span className="mobile-work-icon mobile-work-icon-blue">{kind === 'people' ? <UsersRound size={20} aria-hidden="true" /> : kind === 'rooms' ? <DoorOpen size={20} aria-hidden="true" /> : <Building2 size={20} aria-hidden="true" />}</span><div><h2>{kind === 'rooms' ? roomLabel(record) : record.name}</h2><p>{kind === 'people' ? `${account?.username ?? 'Account unavailable'}${record.accountId === data.user.id ? ' · Your account' : ''}` : kind === 'rooms' ? `${record.buildingId ?? 'Building not assigned'} · ${record.building ?? ''}` : record.id}</p></div></div>{kind === 'people' ? <><p className="mobile-phone-caption">{account ? account.active ? 'Active staff account' : 'Inactive staff account' : 'Account unavailable'} · Reference: {record.reference || 'Not recorded'}</p><details className="mobile-phone-context"><summary>Import reference</summary><label className="mobile-directory-owner">Owner ID for imports<code>{record.id}</code></label><Pressable type="button" className="mobile-phone-text-button" disabled={!available} onClick={() => copyOwner(record)}><Copy size={17} aria-hidden="true" />Copy owner ID</Pressable></details>{!available && <p className="mobile-phone-caption">Unavailable for new batteries.</p>}</> : <><span className="mobile-phone-kicker">{!available ? 'Not available for selection' : kind === 'rooms' ? record.isPlaceholder ? 'Placeholder · awaiting confirmation' : 'Confirmed room' : 'Currently supported'}</span>{permission.manageDirectories && <Pressable type="button" className="mobile-phone-text-button" disabled={!ready || !available} onClick={() => onEdit({ kind: kind === 'rooms' ? 'room' : 'building', record })}><Pencil size={17} aria-hidden="true" />Edit {kind === 'rooms' ? 'room' : 'building'}</Pressable>}</>}</article>;
  })}</div><PhonePagination page={page} count={records.length} onPage={setPage} /></div>;
}
