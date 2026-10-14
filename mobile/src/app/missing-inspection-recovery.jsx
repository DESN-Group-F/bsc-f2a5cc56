import React, { useEffect, useRef, useState } from 'react';
import { readInspectionAttempt } from '../shared/components/inventory/inspection-request.js';
import { getRolePermissions } from '../shared/lib/permissions.js';
import { businessStorage } from '../platform/runtime.mjs';
import { Pressable } from './phone-ui.jsx';
import { resolveMissingInspection } from './missing-inspection-recovery.mjs';

export function MissingInspectionRecovery({ active = true,data,batteryId,write,onExit,onExportRecovery,onLockedChange }) {
  const [saved,setSaved] = useState(() => readInspectionAttempt(data.user.id,data.dataset,batteryId,businessStorage()));
  const [busy,setBusy] = useState(false), [error,setError] = useState(''), [outcome,setOutcome] = useState(null), inFlight=useRef(false);
  const locked=busy || !!saved.input || !!saved.error, permissions=getRolePermissions(data.user.role);
  const permitted=saved.input?.action === 'inspection_void' ? permissions.correctInspections : permissions.recordInspections;
  useEffect(() => { onLockedChange?.(active && locked); return () => onLockedChange?.(false); },[active,locked,onLockedChange]);
  async function retry() {
    if (!active || inFlight.current || !saved.input || saved.error || !permitted) return;
    inFlight.current=true;setBusy(true);setError('');
    try { const resolved=await resolveMissingInspection({accountId:data.user.id,dataset:data.dataset,batteryId,storage:businessStorage(),expectedInput:saved.input,write});setSaved({input:null,error:''});setOutcome(resolved); }
    catch (failure) { setError(failure.message); }
    finally { inFlight.current=false;setBusy(false); }
  }
  return <section className="phone-recovery"><h2>Inspection request recovery</h2><p>{batteryId} is unavailable in the current register.</p>{saved.input && <><strong>Result not confirmed</strong><p>The original request may have been saved. Check that request before leaving; its account, inventory, ID and payload stay unchanged.</p><details><summary>Original request evidence</summary><pre>{JSON.stringify(saved.input,null,2)}</pre></details></>}{saved.error && <p role="alert">{saved.error}</p>}{error && <p role="alert">{error} The original request remains retained.</p>}{outcome && <p role="status">{outcome.outcome === 'confirmed' ? 'The server confirmed the original inspection request.' : `${outcome.message} Original request resolved; the asset evidence is unavailable or was permanently deleted. No replacement request was created.`} Its local acknowledgement is durable.</p>}{!saved.input && !saved.error && !outcome && <p>No unresolved inspection request remains for this battery.</p>}{!permitted && saved.input && <p role="alert">This account cannot retry this inspection action. The original evidence remains preserved.</p>}<div className="phone-detail-actions"><Pressable className="phone-primary" disabled={!active || busy || !saved.input || !!saved.error || !permitted} onClick={retry}>{busy ? 'Checking original request…' : 'Check original request'}</Pressable><Pressable className="phone-secondary" disabled={busy} onClick={onExportRecovery}>Export preserved recovery</Pressable>{saved.error && <Pressable className="phone-secondary" disabled={busy} onClick={() => {setSaved(readInspectionAttempt(data.user.id,data.dataset,batteryId,businessStorage()));setError('');}}>Retry saved recovery</Pressable>}<Pressable className="phone-secondary" disabled={locked} onClick={onExit}>Exit recovery</Pressable></div></section>;
}
