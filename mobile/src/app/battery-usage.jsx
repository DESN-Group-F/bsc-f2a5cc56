import React from 'react';
import { ArrowDownLeft, ArrowUpRight, Clock3, RefreshCw } from 'lucide-react';
import { formatBatteryAge, formatDateOnly, formatTime } from '../shared/lib/client-utils.js';
import { currentSydneyDate, serviceAgeAsOfOn } from '../shared/lib/battery-age.js';
import { isActiveBattery } from '../shared/lib/battery-lifecycle.js';
import { buildBatteryMovementSummary, formatMovementDuration } from '../shared/lib/battery-movement-summary.js';
import { Pressable } from './phone-ui.jsx';

/** Totals come from the complete server-side loan history, never the capped
 * recent events list. The reporting instant stays explicit during refresh. */
export function BatteryUsage({ battery, detail, loading, error, onRefresh }) {
  const usage = detail?.usageSummary;
  const asOf = currentSydneyDate(), serviceAsOf = serviceAgeAsOfOn(battery, asOf);
  const movement = detail?.movementSummary && usage?.asOf ? buildBatteryMovementSummary(detail, new Date(usage.asOf)) : null;
  return <div className="phone-usage">
    <section className="phone-usage-summary" aria-label="Recorded usage" aria-busy={loading}>
      <header><div><p className="phone-eyebrow">Recorded borrowing</p><h2>Usage</h2></div><Pressable type="button" className="phone-usage-refresh" onClick={onRefresh} disabled={loading} aria-label="Refresh usage"><RefreshCw size={19}/><span>Refresh</span></Pressable></header>
      {error && detail && <p className="phone-muted" role="status">Showing the last loaded usage. Refresh to check for newer records.</p>}
      {usage ? <>
        <dl className="phone-usage-metrics"><div><dt>Total checkouts</dt><dd>{usage.totalCheckouts.toLocaleString()}</dd></div><div><dt>Total checked-out time</dt><dd>{usage.totalCheckedOutSeconds == null ? 'Not available' : usage.totalCheckedOutSeconds === 0 ? '0h' : formatMovementDuration(usage.totalCheckedOutSeconds * 1000)}</dd></div></dl>
        <div className="phone-usage-breakdown" aria-label={`${usage.completedCheckouts} completed checkouts and ${usage.activeCheckouts} current checkouts`}>
          <div className="phone-usage-track" aria-hidden="true">{usage.totalCheckouts > 0 && <><span data-usage-kind="completed" style={{ flexGrow:usage.completedCheckouts }}/><span data-usage-kind="current" style={{ flexGrow:usage.activeCheckouts }}/></>}</div>
          <div className="phone-usage-legend"><span><i data-usage-kind="completed" aria-hidden="true"/>{usage.completedCheckouts.toLocaleString()} completed</span><span><i data-usage-kind="current" aria-hidden="true"/>{usage.activeCheckouts.toLocaleString()} current</span></div>
        </div>
        {usage.totalCheckouts === 0 && <p className="phone-muted">No recorded checkouts.</p>}
        <p className="phone-muted">All valid checkout records · As of <time dateTime={usage.asOf}>{formatTime(usage.asOf)}</time>.</p>
        {usage.activeCheckouts > 0 && <p className="phone-muted">Includes the current checkout up to that time. Refresh to update the total.</p>}
        {usage.invalidDurationCount > 0 && <p className="phone-usage-notice" role="status">Checked-out time is unavailable because {usage.invalidDurationCount.toLocaleString()} checkout {usage.invalidDurationCount === 1 ? 'record has' : 'records have'} missing or invalid times.</p>}
      </> : <p className="phone-muted" role="status">{loading ? 'Loading borrowing totals…' : 'Usage totals are unavailable. Refresh to try again.'}</p>}
      <p className="phone-usage-evidence">Borrowing records do not measure charge cycles, powered use or battery health. Earlier use outside this system is unknown. Checkouts entered in error are excluded.</p>
    </section>
    {movement && <section className="phone-usage-movement" aria-label="Check-in and check-out"><header><Clock3 size={19} aria-hidden="true"/><h2>Check-in / check-out</h2></header><div className="phone-usage-current"><span>{movement.durationLabel}</span><strong>{movement.duration}</strong><p>{movement.personLabel} · {movement.personName}</p><small>{movement.timestampLabel} · {movement.startedAt ? formatTime(movement.startedAt) : 'Time unavailable'}</small></div>
      <h3>Recent movements</h3>{movement.timeline.length ? <ol className="phone-usage-timeline" aria-label="Recent recorded movements">{movement.timeline.map(event => <li key={event.id} data-movement={event.kind}><span className="phone-usage-event-icon" aria-hidden="true">{event.kind === 'checkout' ? <ArrowUpRight size={17}/> : event.kind === 'return' ? <ArrowDownLeft size={17}/> : <Clock3 size={17}/>}</span><div><strong>{event.kind === 'checkout' ? 'Checked out' : event.kind === 'return' ? 'Checked in' : 'Registered'}</strong><p>{event.at ? <time dateTime={event.at}>{formatTime(event.at)}</time> : 'Time unavailable'}</p>{event.kind === 'checkout' && <p>Borrowed by {event.borrowerName || 'Not recorded'}</p>}<p>Recorded by {event.actorName || 'Not recorded'}</p>{event.currentLoan ? <small>Current loan</small> : event.loanDuration && <small>Loan duration · {event.loanDuration}</small>}</div></li>)}</ol> : <p className="phone-muted">No recorded movements.</p>}
      <p className="phone-muted">Recorded movements, not live location. Corrections remain in Loans and Audit history. Times use Australia/Sydney.</p>
    </section>}
    <section className="phone-usage-age" aria-label="Age and registration"><h2>Age &amp; registration</h2><dl className="phone-record-values">{[['Date added',formatTime(battery.registeredAt)],['Manufactured on',formatDateOnly(battery.manufacturedOn)],['First used on',formatDateOnly(battery.firstUsedOn)],['Age since manufacture',formatBatteryAge(battery.manufacturedOn,asOf)],['Time in service',serviceAsOf ? formatBatteryAge(battery.firstUsedOn,serviceAsOf) : 'Not available']].map(([label,value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl><p className="phone-muted">Date added is registration in this system, not the manufacture date. Unknown dates remain unrecorded.</p><p className="phone-muted">{isActiveBattery(battery) ? `Ages calculated as of ${formatDateOnly(asOf)} (Sydney).` : serviceAsOf ? `Time in service ends at retirement / permanent removal on ${formatDateOnly(serviceAsOf)} (Sydney).` : 'Time in service is unavailable because the retirement / removal date is missing or invalid.'}</p></section>
  </div>;
}
