import React, { useEffect, useState } from 'react';
import { BatteryNfc } from '@battery-inventory/nfc';
import { businessStorage, native, saveFile } from '../platform/runtime.mjs';
import { NFC_PREFIX, readNfcProposal } from './nfc-controller.mjs';
import { useWorkflowLock } from './workflow-boundary.jsx';
import { MOBILE_BUILD } from '../app/build-info.mjs';
export function NfcReadButton({ onIdentity, disabled = false }) {
  const [available, setAvailable] = useState(false), [reading, setReading] = useState(false), [proposal, setProposal] = useState(null), [error, setError] = useState('');
  useWorkflowLock(reading);
  useEffect(() => { let mounted = true; if (native) BatteryNfc.getAvailability().then((value) => { if (mounted) setAvailable(value.available && value.enabled); }).catch((error) => { if (mounted) setError(error.message); }); return () => { mounted = false; }; }, []);
  async function start() {
    if (!native || !available || reading || disabled) return;
    setReading(true); setError(''); setProposal(null);
    try { setProposal(await readNfcProposal({ adapter: BatteryNfc, storage: businessStorage(), id: crypto.randomUUID() })); }
    catch (error) { setError(error.message); }
    finally { setReading(false); }
  }
  return <div className="mobile-nfc-control"><button type="button" onClick={start} disabled={disabled || !available || reading}>{reading ? 'Reading NFC…' : 'Read NFC tag'}</button>{reading && <button type="button" onClick={() => BatteryNfc.cancel().catch((error) => setError(error.message))}>Cancel NFC read</button>}{!native && <small>Native NFC unavailable in browser preview.</small>}{proposal && <div><strong>{proposal.tagId}</strong><p>Device read evidence is saved locally. This identifier is a proposal; inventory changes still require review.</p>{onIdentity && <button type="button" disabled={disabled} onClick={() => { onIdentity(proposal.tagId); setProposal(null); }}>Use identifier as operator input</button>}</div>}{error && <p role="alert">{error}</p>}</div>;
}
export function NfcDiagnostics() {
  const [reports, setReports] = useState([]), [error, setError] = useState('');
  function refresh() { try { setReports(Object.entries(businessStorage().entries()).filter(([key]) => key.startsWith(NFC_PREFIX)).map(([, raw]) => JSON.parse(raw))); } catch(error) { setError(error.message); } }
  useEffect(() => { refresh(); return businessStorage().subscribe(refresh); }, []);
  async function exportReports() { try { await saveFile({ filename: 'nfc-app-evidence.json', blob: new Blob([JSON.stringify({ schemaVersion: 1, testVersion: MOBILE_BUILD, source: 'native-nfc-reader', reports }, null, 2)], { type: 'application/json' }) }); } catch (error) { setError(error.message); } }
  return <section className="mobile-page"><span className="eyebrow">Device evidence</span><h1>NFC diagnostics</h1><p>Reads preserve raw UID and NDEF. Availability and web preview are not physical successes. No tag is written or locked.</p><NfcReadButton/><button type="button" onClick={exportReports}>Export app NFC evidence</button>{error && <p role="alert">{error}</p>}<h2>Saved attempts ({reports.length})</h2>{!reports.length && <p>No physical app reads recorded.</p>}{[...reports].reverse().map((report) => <details key={report.id}><summary>{report.outcome} · {report.result?.uidHex || 'No confirmed UID'}</summary><pre>{JSON.stringify(report, null, 2)}</pre></details>)}</section>;
}
