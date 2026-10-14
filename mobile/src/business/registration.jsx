import React, { useEffect, useRef, useState } from 'react';
import { businessStorage, saveFile } from '../platform/runtime.mjs';
import { NfcReadButton } from './nfc-read.jsx';
import { captureMobileRegistrationAttempt, recoverMobileRegistrationAttempt, verifyMobileRegistrationReceipt, mobileRegistrationFailureStatus, mobileRegistrationStorageKey } from '../shared/lib/mobile-registration-session.js';
import { modelApplication, modelFieldValue } from '../shared/lib/battery-models.js';
import { BatteryModelPicker } from '../shared/components/inventory/battery-model-picker.js';
import { Input } from '../shared/components/ui/input.js';
import { currentSydneyDate } from '../shared/lib/battery-age.js';
import { z } from 'zod';
import { modelSelectionSchema } from '../shared/lib/battery-models.js';
import { WorkflowBoundary } from './workflow-boundary.jsx';
import { Dialog as DialogPrimitive } from 'radix-ui';

const draftSchema = z.object({ sessionId: z.string().uuid(), values: z.object(Object.fromEntries(['name','model','chemistry','capacityMah','voltage','tagId','ownerId','homeBuildingId','homeRoomId','manufacturedOn','firstUsedOn'].map(key=>[key,z.string().max(1000)]))).strict(), firstUseMode:z.enum(['at_registration','date','unknown']), modelSelection:modelSelectionSchema.nullable() }).strict();

export function Registration({ user, initialData = null, initialTagId = '', onExit }) {
  const storage = businessStorage(), key = mobileRegistrationStorageKey(user.id, 'demo'), draftKey = key + ':draft';
  const [saved] = useState(() => {
    const pendingRaw = storage.getItem(key), rawDraft = storage.getItem(draftKey);
    const pending = recoverMobileRegistrationAttempt(pendingRaw, user.id, 'demo');
    let draft = null, invalid = pendingRaw !== null && !pending;
    try { draft = rawDraft !== null ? draftSchema.parse(JSON.parse(rawDraft)) : null; } catch { invalid = true; draft = null; }
    return { pending, draft, invalid };
  });
  const [data, setData] = useState(initialData), [values, setValues] = useState(saved.draft?.values || { name: '', model: '', chemistry: '', capacityMah: '', voltage: '', tagId: initialTagId, ownerId: '', homeBuildingId: 'J18', homeRoomId: '', manufacturedOn: '', firstUsedOn: '' });
  const [sessionId, setSessionId] = useState(saved.draft?.sessionId || saved.pending?.payload.sessionId || crypto.randomUUID());
  const [firstUseMode, setFirstUseMode] = useState(saved.draft?.firstUseMode || 'at_registration'), [modelSelection, setModelSelection] = useState(saved.draft?.modelSelection || null), [choice, setChoice] = useState(null);
  const [attempt, setAttempt] = useState(saved.pending), [busy, setBusy] = useState(false), [modelBusy, setModelBusy] = useState(false), [error, setError] = useState(saved.invalid ? 'Saved registration data is unreadable. Export recovery data; it has not been replaced.' : ''), [receipt, setReceipt] = useState(null), [reviewing, setReviewing] = useState(false);
  const sending = useRef(false);
  const locked = busy || modelBusy || !!attempt || saved.invalid;
  useEffect(() => {
    if (initialData?.dataset === 'demo') return;
    const abort = new AbortController();
    fetch('/api/inventory?dataset=demo', { signal: abort.signal }).then(async (response) => {
      const value = await response.json(); if (!response.ok) throw new Error(value.error);
      setData(value);
    }).catch((error) => { if (!abort.signal.aborted) setError(error.message); });
    return () => abort.abort();
  }, []);
  useEffect(() => {
    if (!data || saved.draft || values.ownerId) return;
    const owner = data.people.find((person) => person.role === 'staff' && person.accountId === user.id);
    if (owner) setValues((previous) => ({ ...previous, ownerId: owner.id }));
  }, [data]);
  useEffect(() => {
    if (saved.invalid || receipt || attempt) return;
    try { storage.setItem(draftKey, JSON.stringify({ sessionId, values, firstUseMode, modelSelection })); }
    catch (error) { setError(error.message); }
  }, [sessionId, values, firstUseMode, modelSelection, receipt, attempt]);
  function change(field, value) {
    if (locked || reviewing) return;
    setValues((previous) => ({ ...previous, [field]: value }));
    if (choice && modelSelection?.appliedFields.includes(field) && value !== modelFieldValue(choice, field)) setModelSelection((previous) => ({ ...previous, appliedFields: previous.appliedFields.filter((name) => name !== field) }));
  }
  function capture() {
    const number = (field) => values[field].trim() ? Number(values[field]) : null;
    return captureMobileRegistrationAttempt(user.id, 'demo', { requestId: crypto.randomUUID(), sessionId, source: 'operator-entered-registration', tagId: values.tagId.trim() || null, firstUseMode, common: {
      name: values.name.trim(), model: values.model.trim(), chemistry: values.chemistry.trim(), capacityMah: number('capacityMah'), voltage: number('voltage'), ownerId: values.ownerId, homeBuildingId: 'J18', homeRoomId: values.homeRoomId || null, manufacturedOn: values.manufacturedOn || null, firstUsedOn: firstUseMode === 'date' ? values.firstUsedOn || null : null, ...(modelSelection ? { modelSelection } : {}),
    } });
  }
  function review(event) { event.preventDefault(); if (locked || !data) return; try { capture(); setReviewing(true); setError(''); } catch (error) { setError(error.issues?.[0]?.message || error.message); } }
  async function send(existing = null) {
    if (sending.current || modelBusy || saved.invalid) return;
    sending.current = true; setBusy(true); setError('');
    let captured;
    try {
      captured = existing || capture();
      if (!existing) { storage.setItem(key, JSON.stringify(captured)); await storage.flush(); setAttempt(captured); }
      const response = await fetch('/api/inventory', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dataset: 'demo', action: 'mobile_register', payload: captured.payload }) });
      const body = await response.json();
      if (!response.ok) throw Object.assign(new Error(body.error || 'Registration failed.'), { status: response.status, code: body.code });
      const confirmed = verifyMobileRegistrationReceipt(body.result, captured);
      await storage.transact((entries) => { entries['preference:registration-receipt:' + confirmed.requestId] = JSON.stringify(confirmed); delete entries[key]; delete entries[draftKey]; });
      setReceipt(confirmed); setAttempt(null); setReviewing(false);
      window.dispatchEvent(new Event('battery-mobile-inventory-refresh'));
    } catch (error) {
      if (!captured) setError(error.message);
      else if (mobileRegistrationFailureStatus(error, !!existing) === 'rejected') {
        try { await storage.transact((entries) => { delete entries[key]; }); setAttempt(null); setSessionId(crypto.randomUUID()); setReviewing(false); setError(error.message); }
        catch (saveError) { setAttempt(captured); setError(saveError.message + ' The original request is retained.'); }
      } else { setAttempt(captured); setError(error.message); }
    } finally { sending.current = false; setBusy(false); }
  }
  async function exit() { if (attempt || busy || saved.invalid) return; try { await storage.transact((entries) => { delete entries[draftKey]; }); onExit(); } catch (error) { setError(error.message); } }
  async function exportRecovery() { try { await saveFile({filename:'registration-recovery.json',blob:new Blob([storage.exportRaw()],{type:'application/json'})}); } catch(error) { setError(error.message); } }
  return <section className="mobile-page"><div className="mobile-station-heading"><div><span className="eyebrow">Explicit registration · Demo only</span><h1>Register a battery</h1></div><button type="button" onClick={exit} disabled={busy || !!attempt || saved.invalid}>Exit registration</button></div>
    <p>A permanent battery ID is allocated by the server. A tag is optional and remains separate from battery identity. NFC proposals require your confirmation.</p>
    {error && <p className="mobile-error" role="alert">{error}</p>}
    {saved.invalid && <div className="mobile-recovery"><h2>Retained registration needs review</h2><p>Unreadable saved details are preserved. New registration and normal exit are blocked.</p><button type="button" onClick={exportRecovery}>Export retained registration data</button></div>}
    {attempt && <div className="mobile-recovery"><h2>Registration result needs confirmation</h2><p>The original request and reviewed details are retained. New registration and normal exit are blocked.</p><code>{attempt.payload.requestId}</code><details><summary>Original reviewed request</summary><pre>{JSON.stringify(attempt.payload, null, 2)}</pre></details><button type="button" onClick={() => send(attempt)} disabled={busy}>Retry same registration request</button></div>}
    {receipt ? <div className="mobile-success"><h2>Battery registered</h2><strong>{receipt.batteryId} · {receipt.name}</strong><p>Confirmed server registration time: {receipt.registeredAt}</p><p>{receipt.tagId || 'No tag bound'}</p><button type="button" onClick={onExit}>Return to inventory</button></div> : <form onSubmit={review}>
      <fieldset disabled={locked || reviewing || !data}>
        <BatteryModelPicker dataset="demo" actorAccountId={user.id} canEditModels={user.role === 'admin'} values={values} selection={modelSelection} disabled={locked || reviewing} onApply={(model, fields) => { setValues((previous) => modelApplication(previous, model, fields)); setChoice(model); setModelSelection({ origin: model.origin, id: model.id, contentHash: model.contentHash, confirmed: true, appliedFields: fields }); }} onManual={() => setModelSelection(null)} onBusyChange={setModelBusy}/>
        <div className="mobile-form-grid">{[['name','Battery name'],['model','Model'],['chemistry','Chemistry'],['capacityMah','Capacity (mAh)'],['voltage','Nominal voltage (V)'],['tagId','Operator-confirmed NFC identifier']].map(([field, label]) => <label key={field}>{label}<Input value={values[field]} onChange={(event) => change(field,event.target.value)} required={field === 'name'} type={['capacityMah','voltage'].includes(field) ? 'number' : 'text'} min="0" step="any"/></label>)}</div>
        <NfcReadButton disabled={locked || reviewing} onIdentity={(tagId) => change('tagId', tagId)}/>
        <label>Responsible staff owner<select value={values.ownerId} onChange={(event) => change('ownerId',event.target.value)} required><option value="">Choose staff owner</option>{data?.people.filter((person) => person.role === 'staff' && person.accountId && data.staffDirectory.some(account=>account.id===person.accountId && account.active)).map((person) => <option key={person.id} value={person.id}>{person.name} · {data.staffDirectory.find(account=>account.id===person.accountId).username}</option>)}</select></label>
        <label>Storage building<Input value="J18 — Willis Annexe" readOnly/></label><label>Storage room (optional)<select value={values.homeRoomId} onChange={(event) => change('homeRoomId',event.target.value)}><option value="">Room unspecified</option>{data?.rooms.filter((room) => room.buildingId === 'J18').map((room) => <option key={room.id} value={room.id}>{room.name}{room.isPlaceholder ? ' — Placeholder' : ''}</option>)}</select></label>
        <label>Manufacture date (optional)<Input type="date" value={values.manufacturedOn} max={currentSydneyDate()} onChange={(event) => change('manufacturedOn',event.target.value)}/></label>
        <label>Time in service<select value={firstUseMode} onChange={(event) => setFirstUseMode(event.target.value)}><option value="at_registration">Starts on registration date</option><option value="date">Known earlier first-use date</option><option value="unknown">Unknown</option></select></label>{firstUseMode === 'date' && <label>First used on<Input type="date" value={values.firstUsedOn} max={currentSydneyDate()} min={values.manufacturedOn || undefined} onChange={(event) => change('firstUsedOn',event.target.value)}/></label>}
      </fieldset>
      {!reviewing && !attempt && <button type="submit" disabled={locked || !data}>Review registration</button>}
      {reviewing && !attempt && <div className="mobile-review"><h2>Confirm reviewed battery</h2><p>{values.name} · {values.tagId || 'Untagged'}</p><p>Owner: {data.people.find((person) => person.id === values.ownerId)?.name} · J18 · {data.rooms.find((room) => room.id === values.homeRoomId)?.name || 'Room unspecified'}</p><p>Unknown specifications remain unrecorded. This creates a demonstration record only.</p><button type="button" onClick={() => send()} disabled={busy}>Confirm registration</button><button type="button" onClick={() => setReviewing(false)} disabled={busy}>Back to details</button></div>}
    </form>}
  </section>;
}
export function MobileRegistrationDialog({ data, initialTagId, onClose }) {
  const [host, setHost] = useState(null);
  return <WorkflowBoundary><div ref={setHost}/><DialogPrimitive.Root open onOpenChange={()=>{}}>{host && <DialogPrimitive.Portal container={host}><DialogPrimitive.Overlay className="mobile-registration-overlay"/><DialogPrimitive.Content className="mobile-registration-modal" aria-describedby={undefined} onEscapeKeyDown={event=>event.preventDefault()} onInteractOutside={event=>event.preventDefault()}><DialogPrimitive.Title className="sr-only">Register battery</DialogPrimitive.Title><Registration user={data.user} initialData={data.dataset === 'demo' ? data : null} initialTagId={initialTagId} onExit={onClose}/></DialogPrimitive.Content></DialogPrimitive.Portal>}</DialogPrimitive.Root></WorkflowBoundary>;
}
