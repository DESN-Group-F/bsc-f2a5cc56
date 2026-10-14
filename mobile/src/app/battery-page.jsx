import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Download, MoreHorizontal, ArrowUpRight, ArrowDownLeft, MapPin, Clock3 } from 'lucide-react';
import { formatTime, durationLabel, storageRoomLabel, actionNames } from '../shared/lib/client-utils.js';
import { batteryStatusLabel, isActiveBattery } from '../shared/lib/battery-lifecycle.js';
import { inventoryResponse } from '../shared/lib/client/inventory-request.js';
import { Pressable, usePhoneViewState } from './phone-ui.jsx';
import { PhoneReadError } from './phone-read-error.jsx';
import { usePhoneContentMotion } from './phone-content-motion.js';
import { BatteryUsage } from './battery-usage.jsx';
import './battery-page.css';

function HistoryEvent({event,battery}) {
  const value=event.details||{},scan=value.scan||{};
  const source=({native_nfc:'Native NFC · device-reported evidence',manual:'Entered registered tag',selection:'Inventory selection',simulated:'Demonstration scan'})[scan.source]||value.source;
  const rows=[['Battery',`${battery.id} · ${battery.name}`],['Recorded by',event.actorName],['Recorded at',formatTime(event.at)],['Current holder at event',value.borrower],['Input source',source],['Reason',value.reason],['Destination',value.destination],['Return placement',value.returnPlacement?.roomName],['Observed at',value.returnPlacement?.observedAt?formatTime(value.returnPlacement.observedAt):null],['Charge duration',value.durationMinutes!=null?`${value.durationMinutes} minutes`:null]].filter(([,value])=>value!==undefined&&value!==null&&value!=='');
  return <article className="phone-history-event"><h3>{actionNames[event.action]||event.action.replaceAll('_',' ')}</h3><p>{formatTime(event.at)} · {event.actorName}</p><dl className="phone-record-values">{rows.map(([label,value])=><div key={label}><dt>{label}</dt><dd>{String(value)}</dd></div>)}</dl>{value.loanId&&<details><summary>Loan identifier</summary><code>{value.loanId}</code></details>}<details><summary>Technical evidence</summary><pre>{JSON.stringify(value,null,2)}</pre></details></article>;
}

export function BatteryPage({ battery, data, active = true, readOnly = false, revision, onBack, onExport, onFullRecord, onOperation, boundaryError = "", iosPresentation = false }) {
  const [snapshot, setSnapshot] = useState(null), [tab, setTab] = usePhoneViewState(`battery:${battery.id}:tab`, 'overview'), [specifications, setSpecifications] = usePhoneViewState(`battery:${battery.id}:specifications`, false);
  const [error, setError] = useState(''), [loading, setLoading] = useState(true), [retry, setRetry] = useState(0);
  const section = useRef(null);
  usePhoneContentMotion(section, tab, { active:active && iosPresentation, select:'[data-record-section]' });
  const recordKey = `${data.dataset}:${battery.id}`, result = snapshot?.key === recordKey ? snapshot.detail : null;
  useEffect(() => {
    if (!active) { setLoading(false); return; }
    const abort = new AbortController(); setLoading(true); setError('');
    fetch(`/api/inventory?dataset=${data.dataset}&batteryId=${encodeURIComponent(battery.id)}`, { cache: 'no-store', signal: abort.signal })
      .then(inventoryResponse).then(detail => { if (!abort.signal.aborted) { if (detail.battery?.id !== battery.id || !Array.isArray(detail.events)) throw new Error('This record response is incomplete. Refresh before using it.'); setSnapshot({ key:recordKey,revision,retry,detail }); } })
      .catch(failure => { if (!abort.signal.aborted) setError(failure); })
      .finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, [active, data.dataset, battery.id, revision, retry]);
  const current = result?.battery || battery;
  const unavailable = !active || loading || !result || snapshot.revision !== revision || snapshot.retry !== retry || !!error || !!boundaryError;
  const values = [['Model', current.model || 'Unknown'], ['Chemistry', current.chemistry || 'Unknown'], ['Capacity', current.capacityMah == null ? 'Unknown' : `${current.capacityMah} mAh`], ['Nominal voltage', current.voltage == null ? 'Unknown' : `${current.voltage} V`], ['Registered tag', current.tagId || 'Not assigned'], ['Responsible owner', current.ownerName], ['Current holder', current.borrowerName || 'No active holder'], ['Manufactured', current.manufacturedOn || 'Unknown'], ['First use', current.firstUsedOn || 'Unknown']];
  return <section className="phone-detail" ref={section}>
    <div className="phone-detail-identity"><div><p className="phone-eyebrow">{current.id}</p><h1>{current.name}</h1><span className="phone-status" data-status={isActiveBattery(current) ? current.loanId ? 'out' : 'in' : 'retired'}>{batteryStatusLabel(current)}</span><p className="phone-detail-custody">{current.loanId ? `Held by ${current.borrowerName || 'Account label unavailable'}` : 'No active checkout'}</p><p className="phone-muted">Recorded loan state; physical presence is not confirmed.</p></div></div>
    <div className="phone-detail-actions">{readOnly ? <><p className="phone-muted">Return to the retained task review to continue.</p><Pressable className="phone-secondary" onClick={onExport} disabled={unavailable}><Download size={18}/>Download complete battery details</Pressable></> : <>{isActiveBattery(current) && <Pressable className="phone-primary" disabled={unavailable} onClick={() => onOperation(current.loanId ? 'return' : 'checkout', [current.id])}>{current.loanId ? <ArrowDownLeft size={19}/> : <ArrowUpRight size={19}/>}{current.loanId ? 'Prepare return' : 'Prepare checkout'}</Pressable>}<Pressable className="phone-secondary" onClick={onFullRecord} disabled={unavailable}><MoreHorizontal size={20}/>Loans, inspections & actions</Pressable><Pressable className="phone-secondary" onClick={onExport} disabled={unavailable}><Download size={18}/>Download record</Pressable></>}</div>
    <div className="phone-tabs" role="tablist" aria-label="Record sections">{['overview','usage','location','history'].map(value => <Pressable role="tab" aria-selected={tab === value} key={value} onClick={() => setTab(value)}>{value[0].toUpperCase() + value.slice(1)}</Pressable>)}</div>
    {loading && <p className="phone-muted" role="status">{result ? 'Updating record…' : 'Loading recorded evidence…'}</p>}
    {error && <PhoneReadError error={error} stale={!!result} onRetry={() => setRetry(value => value + 1)}/>}
    <div data-record-section={tab}>
    {tab === 'usage' && <BatteryUsage battery={current} detail={result} loading={loading} error={error} onRefresh={() => setRetry(value => value + 1)}/>}
    {tab === 'overview' && <><div className="phone-detail-facts"><article><span>Responsible owner</span><strong>{current.ownerName || 'Account label unavailable'}</strong><small>Responsibility is separate from borrowing.</small></article><article><span>Registered home</span><strong>{current.homeBuildingId ? `${current.homeBuildingId} · ${current.homeBuildingName || 'Building label unavailable'}` : 'Building unassigned'}</strong><small>{storageRoomLabel(current)}</small></article><article><span>Last observed</span><strong>{current.observedRoom || (current.observedAt ? 'Historical label unavailable' : 'Unknown')}</strong><small>{current.observedAt ? `${formatTime(current.observedAt)} · ${current.observationSource || 'Source unavailable'}` : 'No observation recorded'}</small></article></div><details className="phone-detail-specifications" open={specifications} onToggle={event => setSpecifications(event.currentTarget.open)}><summary>Specifications & identifiers</summary><dl className="phone-record-values">{values.map(([label,value]) => <div key={label}><dt>{label}</dt><dd>{value || 'Unknown'}</dd></div>)}</dl></details><div className="phone-evidence-note"><Clock3 size={18}/><div><strong>Last recorded charge</strong><p>{current.chargedAt ? `${formatTime(current.chargedAt)} · ${durationLabel(current.chargeDurationMinutes)}` : 'No charge record'}</p></div></div></>}
    {tab === 'location' && <><article className="phone-location-card"><MapPin size={22}/><p className="phone-eyebrow">Registered storage home</p><h2>{current.homeBuildingId ? `${current.homeBuildingId} · ${current.homeBuildingName || 'Building label unavailable'}` : 'Building unassigned'}</h2><p>{storageRoomLabel(current)}</p></article><article className="phone-location-card observed"><Clock3 size={22}/><p className="phone-eyebrow">Last observed</p><h2>{current.observedRoom || (current.observedAt ? 'Historical room label unavailable' : 'Unknown')}</h2><p>{current.observedBuilding || 'No saved building label'}</p><p>{current.observedAt ? formatTime(current.observedAt) : 'No observation recorded'}</p><p>{current.observationSource || 'No source recorded'}</p></article><p className="phone-muted">A dated observation does not establish the battery’s present location. Registered home and borrowing remain separate records.</p></>}
    {tab === 'history' && result && <div className="phone-history"><p className="phone-muted">Recent history shows up to 200 latest events per category. Download complete battery details for the full history.</p>{historyDays(result.events).map(([day,events]) => <section key={day} aria-label={day}><h2 className="phone-history-day">{day}</h2>{events.map(event => <HistoryEvent event={event} battery={current} key={event.id}/>)}</section>)}{!result.events.length && <p>No events recorded.</p>}<Pressable className="phone-secondary" onClick={onExport} disabled={unavailable}><Download size={18}/>Download complete history</Pressable>{!readOnly && <Pressable className="phone-secondary" onClick={onFullRecord} disabled={unavailable}>Open full recorded evidence</Pressable>}</div>}
    </div>
    {boundaryError && <p className="phone-alert" role="alert">{boundaryError}</p>}
  </section>;
}

function historyDays(events) {
  const days = new Map();
  for (const event of [...events].sort((a,b) => b.at.localeCompare(a.at))) {
    const day = new Date(event.at).toLocaleDateString('en-AU', { timeZone: 'Australia/Sydney', dateStyle: 'full' });
    if (!days.has(day)) days.set(day, []);
    days.get(day).push(event);
  }
  return [...days];
}
