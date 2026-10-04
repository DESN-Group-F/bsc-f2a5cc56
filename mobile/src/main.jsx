import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Capacitor } from '@capacitor/core';
import { BatteryNfc } from '@battery-inventory/nfc';
import { APP_VERSION, STORAGE_KEY, SURFACES, loadState, emptyState, normalizeUid, canonicalTagId, decodeRecord, summarizeTrials, inventoryLookupUrl, createExport, validateReadResult } from './diagnostics.mjs';
import './styles.css';

const platform = Capacitor.getPlatform();
const native = Capacitor.isNativePlatform();
const labels = { paper: 'Paper / card', plastic: 'Plastic', metal: 'Directly on metal', 'anti-metal': 'Anti-metal backing on metal' };
const outcomeLabels = { pending: 'Reading', read: 'UID read', failed: 'Failed', cancelled: 'Cancelled', interrupted: 'Interrupted' };

function initialState() {
  try { return loadState(localStorage.getItem(STORAGE_KEY)); }
  catch { return { state: emptyState(), recovered: false, error: 'Local storage is unavailable. Reading is blocked because a test report cannot be saved.' }; }
}

async function exportText(contents, filename) {
  if (native) {
    const [{ Filesystem, Directory, Encoding }, { Share }] = await Promise.all([import('@capacitor/filesystem'), import('@capacitor/share')]);
    const saved = await Filesystem.writeFile({ path: filename, data: contents, directory: Directory.Cache, encoding: Encoding.UTF8 });
    await Share.share({ title: 'NFC test report', files: [saved.uri], dialogTitle: 'Export NFC test report' });
    return;
  }
  const url = URL.createObjectURL(new Blob([contents], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url; link.download = filename;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

function Clock({ value }) {
  if (!value || !Number.isFinite(Date.parse(value))) return <span>Unavailable</span>;
  return <time dateTime={value}>{new Intl.DateTimeFormat('en-AU', { dateStyle: 'medium', timeStyle: 'medium', hour12: false }).format(new Date(value))}</time>;
}

function RecordView({ record, index }) {
  const decoded = decodeRecord(record);
  return <div className="record">
    <div className="row"><strong>Record {index + 1}</strong><span className="small muted">{decoded.kind}</span></div>
    {decoded.value !== null && <p className="decoded">{decoded.value || '(Empty text)'}</p>}
    {decoded.encoding && <p className="small muted">{decoded.encoding.toUpperCase()} · Language: {decoded.language || 'not supplied'}</p>}
    {decoded.warning && <p className="notice small">Could not decode: {decoded.warning}. Raw data is preserved below.</p>}
    <details><summary>Raw NDEF bytes</summary><dl className="raw-data"><dt>TNF</dt><dd>{record.tnf}</dd><dt>Type</dt><dd>{record.typeHex || '(empty)'}</dd><dt>ID</dt><dd>{record.idHex || '(empty)'}</dd><dt>Payload</dt><dd>{record.payloadHex || '(empty)'}</dd></dl></details>
  </div>;
}

function ResultView({ report, onLookup, canLookup }) {
  const result = report.result;
  return <>
    <div className="uid-block"><span className="eyebrow">Tag UID · native byte order</span><strong className="uid">{result.uidHex}</strong><code>{canonicalTagId(result.uidHex)}</code></div>
    <dl className="facts"><div><dt>Technology reported</dt><dd>{result.technology || 'Unknown'}</dd></div><div><dt>NDEF access</dt><dd>{{ readWrite: 'Read / write', readOnly: 'Read only', notSupported: 'Not supported', unknown: 'Unknown' }[result.ndefStatus] || 'Unknown'}</dd></div><div><dt>NDEF capacity</dt><dd>{Number.isFinite(result.capacityBytes) ? `${result.capacityBytes} bytes` : 'Unknown'}</dd></div><div><dt>Device observation time</dt><dd><Clock value={result.observedAt} /></dd></div></dl>
    {result.ndefError && <p className="notice">The UID was read, but NDEF could not be read: {result.ndefError}</p>}
    <h3>NDEF records <span className="muted">({result.records.length})</span></h3>
    {result.records.length ? result.records.map((record, index) => <RecordView key={index} record={record} index={index} />) : <p className="muted small">No NDEF records were returned. This alone does not mean the tag is faulty.</p>}
    <p className="small muted">Record links are shown as text. They are never opened automatically. Chip identity is not verified by this read.</p>
    {onLookup && <><button type="button" className="button secondary full" onClick={() => onLookup(result.uidHex)} disabled={!canLookup}>Open inventory lookup <span aria-hidden="true">↗</span></button><p className="small muted">Opens the configured inventory website in demonstration mode. No battery is registered and no loan or location is changed here.</p></>}
  </>;
}

function App() {
  const [initial] = useState(initialState);
  const [state, setState] = useState(initial.state);
  const stateRef = useRef(initial.state);
  const [storageError, setStorageError] = useState(initial.error);
  const [availability, setAvailability] = useState(null);
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState('');
  const [reading, setReading] = useState(false);
  const [cancelRequested, setCancelRequested] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [resetPrompt, setResetPrompt] = useState(false);
  const active = useRef(null);
  const stats = summarizeTrials(state.reports, state.settings);
  const latest = state.reports.at(-1);
  const canRead = native && availability?.available && availability?.enabled && !reading && !storageError;
  let lookupError = '';
  if (state.settings.inventoryOrigin) { try { inventoryLookupUrl(state.settings.inventoryOrigin, '00000000'); } catch (error) { lookupError = error.message; } }

  function persist(next, keepInMemory = true) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      stateRef.current = next; setState(next); return true;
    } catch {
      // Preserve the result in memory, and block further reads until it is exported.
      if (keepInMemory) { stateRef.current = next; setState(next); }
      setStorageError('This change could not be saved to device storage. Export the current report now; it may be lost if the app closes. Further reads are blocked.');
      return false;
    }
  }

  async function checkAvailability() {
    setChecking(true);
    try {
      const next = await BatteryNfc.getAvailability();
      setAvailability(native ? next : { available: false, enabled: false, platform: 'web', reason: 'Browser preview cannot use the native NFC reader. Install a signed app on a supported phone to read a physical tag.' });
    } catch (error) { setAvailability({ available: false, enabled: false, platform, reason: error.message || 'NFC availability could not be checked.' }); }
    finally { setChecking(false); }
  }

  useEffect(() => {
    if (initial.recovered && !initial.error) persist(initial.state);
    checkAvailability();
    // A single initialization retains interrupted attempts instead of replaying them.
  }, []);

  function updateSetting(key, value) {
    if (reading || storageError) return;
    persist({ ...stateRef.current, settings: { ...stateRef.current.settings, [key]: value } });
  }

  function finish(id, fields) {
    if (active.current?.id !== id) return;
    active.current = null;
    persist({ ...stateRef.current, reports: stateRef.current.reports.map((report) => report.id === id ? { ...report, ...fields, endedAt: new Date().toISOString() } : report) });
    setReading(false); setCancelRequested(false);
  }

  async function startRead() {
    if (!canRead || active.current) return;
    if (!stateRef.current.settings.tagLabel.trim()) { setMessage('Give this physical tag a label before starting a test.'); return; }
    const id = typeof crypto.randomUUID === 'function' ? crypto.randomUUID()
      : Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, '0')).join('');
    const report = { id, startedAt: new Date().toISOString(), endedAt: null, outcome: 'pending', platform,
      setup: { ...stateRef.current.settings, inventoryOrigin: undefined }, source: 'native-nfc-reader', result: null, error: null };
    if (!persist({ ...stateRef.current, reports: [...stateRef.current.reports, report] }, false)) return;
    active.current = { id }; setReading(true); setCancelRequested(false); setMessage('');
    try {
      const result = await BatteryNfc.read({ timeoutMs: 20000 });
      result.uidHex = normalizeUid(result.uidHex);
      if (!validateReadResult(result)) throw new Error('The reader returned incomplete or malformed tag data.');
      finish(id, { outcome: 'read', result });
    } catch (error) {
      const code = typeof error.code === 'string' ? error.code : 'READ_FAILED';
      const cancelled = /cancel/i.test(code);
      finish(id, { outcome: cancelled ? 'cancelled' : 'failed', error: { code, message: error.message || 'The NFC read did not complete.' } });
    }
  }

  async function cancelRead() {
    if (!active.current || cancelRequested) return;
    setCancelRequested(true);
    try { await BatteryNfc.cancel(); }
    catch (error) { setMessage(`Could not stop the reader: ${error.message || 'unknown error'}. Wait for the session to finish.`); setCancelRequested(false); }
  }

  async function exportReport(raw = false) {
    setExporting(true); setMessage('');
    try {
      const contents = raw ? localStorage.getItem(STORAGE_KEY) ?? 'null' : JSON.stringify(createExport(stateRef.current, platform), null, 2);
      await exportText(contents, `nfc-${raw ? 'saved-raw' : 'report'}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
      setMessage(native ? 'Report sharing completed. Check the destination app for your exported copy.' : 'Report download requested. Check your browser downloads.');
    } catch (error) { setMessage(`Export did not complete: ${error.message || 'unknown error'}. Your local reports have not been removed.`); }
    finally { setExporting(false); }
  }

  async function openLookup(uid) {
    try {
      const url = inventoryLookupUrl(stateRef.current.settings.inventoryOrigin, uid);
      if (native) { const { Browser } = await import('@capacitor/browser'); await Browser.open({ url }); }
      else window.open(url, '_blank', 'noopener,noreferrer');
    } catch (error) { setMessage(error.message || 'The inventory website could not be opened.'); }
  }

  function resetDamagedData() {
    try {
      const next = emptyState(); localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      stateRef.current = next; setState(next); setStorageError(null); setResetPrompt(false); setMessage('Local test storage was reset.');
    } catch { setMessage('Local storage is still unavailable. No reset was completed.'); }
  }

  return <div className="app-shell">
    <header className="brand"><div className="brand-icon" aria-hidden="true"><span /></div><div><strong>Battery Inventory</strong><span>NFC FIELD TEST</span></div><span className="version">Test {APP_VERSION}</span></header>
    <main>
      <section className="intro"><span className="eyebrow">Hardware feasibility · local diagnostics</span><h1>One tag.<br />A real read.</h1><p>Check a physical NFC tag and keep the evidence from every attempt.</p></section>
      {!native && <div className="preview-banner"><strong>Browser preview</strong><span>Physical NFC reads are disabled. This page does not simulate a successful scan.</span></div>}
      {storageError && <section className="error-box" role="alert"><strong>Local report storage needs attention</strong><p>{storageError}</p><div className="actions"><button className="button secondary" onClick={() => exportReport(false)} disabled={exporting}>Export current report</button><button className="button secondary" onClick={() => exportReport(true)} disabled={exporting}>Export saved raw data</button></div><button className="text-button" onClick={() => setResetPrompt(!resetPrompt)}>Reset local test storage…</button>{resetPrompt && <div><p>This permanently removes local test reports and settings. Export them first. Inventory records are not affected.</p><button className="button danger" onClick={resetDamagedData}>Delete local test data and reset</button></div>}</section>}
      <section className="panel reader-panel"><div className="section-heading"><div><span className="eyebrow">01 / Reader</span><h2>Ready to scan?</h2></div><span className={`status-dot ${canRead ? 'available' : ''}`} aria-hidden="true" /></div>
        <div className="availability"><strong>{checking ? 'Checking reader…' : availability?.available ? availability.enabled ? 'NFC available' : 'NFC is turned off' : 'NFC unavailable'}</strong><span>{native ? `${platform === 'ios' ? 'iOS' : 'Android'} native app` : 'Web browser'} · {availability?.reason || 'Availability does not verify app signing or tag compatibility.'}</span></div>
        <div className={`scan-target ${reading ? 'scanning' : ''}`} aria-hidden="true"><div className="scan-rings"><span /><span /><span /><b>NFC</b></div></div>
        <p className="scan-guide">{reading ? 'Hold the tag still near the phone antenna. This session lasts up to 20 seconds.' : platform === 'ios' ? 'Start a read, then hold the top edge of your iPhone close to the tag.' : 'Start a read, then hold the phone’s NFC antenna close to one tag.'}</p>
        {reading ? <button className="button primary full" onClick={cancelRead} disabled={cancelRequested}>{cancelRequested ? 'Stopping reader…' : 'Cancel this read'}</button> : <button className="button primary full" onClick={startRead} disabled={!canRead}>Start NFC read <span aria-hidden="true">→</span></button>}
        <button className="text-button full" onClick={checkAvailability} disabled={checking || reading}>Check NFC availability</button>
      </section>
      <section className="panel"><div className="section-heading"><div><span className="eyebrow">02 / Test setup</span><h2>Label your evidence</h2></div></div><p className="small muted">Device and chip names below are entered by you. The app does not verify the phone model or exact chip model.</p>
        <fieldset disabled={reading || Boolean(storageError)}><div className="field-grid"><label>Physical tag label<input value={state.settings.tagLabel} maxLength={80} onChange={(event) => updateSetting('tagLabel', event.target.value)} placeholder="Test tag 01" /></label><label>Device model · user declared<input value={state.settings.deviceModel} maxLength={80} onChange={(event) => updateSetting('deviceModel', event.target.value)} /></label><label>Chip on packaging · user declared<input value={state.settings.chipLabel} maxLength={80} onChange={(event) => updateSetting('chipLabel', event.target.value)} /></label><label>Mounting condition<select value={state.settings.surface} onChange={(event) => updateSetting('surface', event.target.value)}>{SURFACES.map((surface) => <option key={surface} value={surface}>{labels[surface]}</option>)}</select></label></div></fieldset>
        <p className="small muted">Use one physical tag per label. “Anti-metal” describes your test setup, not a verified tag capability.</p>
      </section>
      <section className="panel stats-panel"><div className="section-heading"><div><span className="eyebrow">03 / Repeatability</span><h2>{stats.total} of 10 attempts</h2></div><span className="pill">Latest 10</span></div><p className="small muted">Matches the current tag label, declared device, chip and mounting condition. Start each read yourself.</p><div className="stats-grid"><div><strong>{stats.reads}</strong><span>UID reads</span></div><div><strong>{stats.failed}</strong><span>Failed</span></div><div><strong>{stats.cancelled + stats.interrupted}</strong><span>Stopped</span></div></div><div className="progress-track" aria-label={`${stats.total} of 10 completed attempts`}><span style={{ width: `${stats.total * 10}%` }} /></div><p className="small muted">{stats.distinctUids.length} distinct UID{stats.distinctUids.length === 1 ? '' : 's'} · {stats.ndefIssues} NDEF issue{stats.ndefIssues === 1 ? '' : 's'} · {stats.cancelled} cancelled · {stats.interrupted} interrupted</p></section>
      <section className="panel" aria-live="polite"><div className="section-heading"><div><span className="eyebrow">04 / Latest result</span><h2>{latest ? outcomeLabels[latest.outcome] : 'Waiting for evidence'}</h2></div>{latest && <span className={`pill outcome-${latest.outcome}`}>{outcomeLabels[latest.outcome]}</span>}</div>
        {!latest ? <div className="empty"><span aria-hidden="true">◇</span><p>No physical reads recorded yet.</p><p className="small muted">A successful read will show the UID, NDEF records and the device observation time.</p></div> : <><p className="small muted">{latest.setup.tagLabel} · {labels[latest.setup.surface]}<br /><Clock value={latest.startedAt} /></p>{latest.outcome === 'read' && <ResultView report={latest} onLookup={openLookup} canLookup={Boolean(state.settings.inventoryOrigin) && !lookupError} />}{latest.error && <div className="notice"><strong>{latest.error.code}</strong><p>{latest.error.message}</p></div>}{latest.outcome === 'pending' && <p className="notice">Waiting for the physical reader. No result has been recorded.</p>}</>}
      </section>
      <section className="panel"><div className="section-heading"><div><span className="eyebrow">05 / Optional handoff</span><h2>Inventory website</h2></div><span className="pill">Demo only</span></div><label>Trusted HTTPS website origin<input type="url" inputMode="url" autoCapitalize="none" spellCheck="false" value={state.settings.inventoryOrigin} placeholder="https://inventory.example.edu" disabled={reading || Boolean(storageError)} onChange={(event) => updateSetting('inventoryOrigin', event.target.value)} aria-describedby="origin-help" /></label><p id="origin-help" className={`small ${lookupError ? 'error-text' : 'muted'}`}>{lookupError || 'Configure your inventory website to enable lookup after a read. This app sends the tag UID in a demonstration lookup URL only when you tap Open inventory lookup.'}</p></section>
      <section className="panel history"><div className="section-heading"><div><span className="eyebrow">06 / Saved on this device</span><h2>Test history <span className="muted">({state.reports.length})</span></h2></div></div><p className="small muted">Device clock timestamps are evidence from this phone, not server registration times. Export before uninstalling or clearing app data.</p><button className="button secondary full" onClick={() => exportReport(false)} disabled={exporting || reading}>{exporting ? 'Preparing report…' : 'Export all reports as JSON'} <span aria-hidden="true">↓</span></button>
        {state.reports.length === 0 && <p className="small muted">Availability checks and browser previews are not counted as read attempts.</p>}
        {[...state.reports].reverse().map((report) => <details className="history-entry" key={report.id}><summary><span><strong>{report.setup.tagLabel}</strong><small><Clock value={report.startedAt} /></small></span><span className={`pill outcome-${report.outcome}`}>{outcomeLabels[report.outcome]}</span></summary><p className="small muted">{report.setup.deviceModel} · {report.setup.chipLabel} · {labels[report.setup.surface]} · {report.platform}<br />Device and chip names are user declared.</p>{report.outcome === 'read' && <ResultView report={report} />}{report.error && <p className="notice">{report.error.code}: {report.error.message}</p>}{report.outcome === 'pending' && <p className="muted">Reader session in progress.</p>}</details>)}
      </section>
      {message && <div className="feedback" role="status"><span>{message}</span><button aria-label="Dismiss message" onClick={() => setMessage('')}>×</button></div>}
      <footer>Functional testing only · Excluded from official releases.<br />Read diagnostics only. No registration, borrowing, return or location tracking.</footer>
    </main>
  </div>;
}

createRoot(document.getElementById('root')).render(<App />);
