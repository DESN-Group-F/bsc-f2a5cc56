import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { Radio, ArrowRight, Battery, LogIn, Settings2 } from 'lucide-react';
import { initializeRuntime, native, configureOrigin, businessStorage, saveFile, clearNativeSession } from './platform/runtime.mjs';
import { recoverNfcEvidence } from './business/nfc-controller.mjs';
import DiagnosticApp from './diagnostics-app.jsx';
import { MobileShell } from './app/phone-app.jsx';
import { createStartupCoordinator } from './app/startup-state.mjs';
import { StartupSurface } from './app/startup-surface.jsx';
import { usePhoneViewport } from './app/phone-viewport.js';
import { Pressable } from './app/phone-ui.jsx';
import { markPhoneMilestone } from './app/phone-milestones.mjs';
import './shared/app/globals.css';
import './app.css';
import './app/phone.css';

export function MobileApp() {
  const [origin,setOrigin] = useState(''), [error,setError] = useState('');
  const [storageError,setStorageError] = useState(''), [saving,setSaving] = useState(false);
  const [busy,setBusy] = useState(false), [fieldTest,setFieldTest] = useState(false);
  const [username,setUsername] = useState(''), [password,setPassword] = useState('');
  const [savedMotion,setSavedMotion] = useState(false), [connectionOpen,setConnectionOpen] = useState(false);
  const alive = useRef(true), localRuntime = useRef(null), stopStorage = useRef(null), coordinator = useRef(null);
  const viewport = usePhoneViewport();
  if (!coordinator.current) coordinator.current = createStartupCoordinator({
    prepare: async report => {
      const runtime = localRuntime.current || await initializeRuntime();
      localRuntime.current = runtime;
      if (!alive.current) throw new Error('Opening interrupted.');
      setOrigin(runtime.origin);
      stopStorage.current?.();
      stopStorage.current = runtime.storage.subscribe(({pending,error:failure}) => {
        if (alive.current) {
          setSaving(pending > 0); setStorageError(failure || '');
          if (!pending && !failure) {
            try { setSavedMotion(runtime.storage.getItem('preference:mobile-motion') === 'reduce'); } catch { /* Keep the last confirmed preference when storage is unavailable. */ }
          }
        }
      });
      const entries = runtime.storage.entries();
      if (Object.keys(entries).some(key => !key.startsWith('preference:'))) report('restoring');
      setSavedMotion(runtime.storage.getItem('preference:mobile-motion') === 'reduce');
      recoverNfcEvidence(runtime.storage);
      await runtime.storage.flush();
      markPhoneMilestone('local-ready');
      return runtime;
    },
    checkSession: async () => {
      const response = await fetch('/api/session',{cache:'no-store'}), body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Session could not be checked.');
      markPhoneMilestone('session-resolved');
      return body.user || null;
    },
  });
  const startup = useSyncExternalStore(coordinator.current.subscribe,coordinator.current.getSnapshot);
  const user = startup.user, reducedMotion = viewport.systemReduced || savedMotion;
  useEffect(() => { if (['signed-out','configuration'].includes(startup.phase)) markPhoneMilestone('first-interactive'); },[startup.phase]);
  useEffect(() => {
    alive.current = true;
    void coordinator.current.start();
    const reset = () => { coordinator.current.signedOut(); setPassword(''); setError('Sign in again to continue. Saved work is retained.'); };
    const notice = event => setError(String(event.detail));
    window.addEventListener('battery-mobile-session',reset);
    window.addEventListener('battery-mobile-error',notice);
    return () => { alive.current = false; coordinator.current.dispose(); stopStorage.current?.(); window.removeEventListener('battery-mobile-session',reset); window.removeEventListener('battery-mobile-error',notice); };
  },[]);
  async function login(event) {
    event.preventDefault(); if (busy || storageError) return; setBusy(true); setError('');
    try {
      const response = await fetch('/api/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'signin',payload:{username,password}})}), body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Sign-in failed.');
      setPassword(''); coordinator.current.signedIn(body.user);
    } catch (failure) { setError(failure.message); } finally { setBusy(false); }
  }
  async function exportRecovery() {
    try { await saveFile({filename:'mobile-recovery-data.json',blob:new Blob([businessStorage().exportRaw()],{type:'application/json'})}); }
    catch (failure) { setError(failure.message); }
  }
  async function connect(event) {
    event.preventDefault(); if (busy) return; setBusy(true); setError('');
    try { await configureOrigin(origin); } catch (failure) { setError(failure.message); } finally { setBusy(false); }
  }
  async function retryOpening() {
    if (busy) return;
    setBusy(true); setError('');
    try {
      if (storageError && localRuntime.current) await localRuntime.current.storage.retryPersistence();
      await coordinator.current.start();
    } catch (failure) { setError(failure.message); }
    finally { if (alive.current) setBusy(false); }
  }
  useEffect(() => {
    if (!fieldTest) return;
    const back = () => { const exit = document.querySelector('.field-test-exit button'); if (exit && !exit.disabled) exit.click(); };
    window.addEventListener('battery-mobile-back',back); return () => window.removeEventListener('battery-mobile-back',back);
  },[fieldTest]);
  if (fieldTest) return <DiagnosticApp onExit={() => setFieldTest(false)}/>;
  const resolved = ['authenticated','signed-out','configuration'].includes(startup.phase);
  const configuration = startup.phase === 'configuration';
  const failedConnection = startup.phase === 'failed' && startup.failedStage === 'session';
  const connectionSettings = native && <details className="phone-signin-connection" open={configuration || connectionOpen} onToggle={event => { if (!configuration) setConnectionOpen(event.currentTarget.open); }}><summary><Settings2 size={18}/>{configuration ? 'Service connection' : 'Connection settings'}</summary><form className="phone-connection-form" onSubmit={connect} aria-busy={busy}><label>Trusted HTTPS service<input type="url" value={origin === 'unconfigured' ? '' : origin} onChange={event => setOrigin(event.target.value)} required disabled={busy} placeholder="https://inventory.example.edu"/></label><Pressable type="submit" className="phone-secondary" disabled={busy}>Save service connection</Pressable></form></details>;
  return <div className="phone-app" data-phone-layout={viewport.layout} data-phone-keyboard={String(viewport.keyboardOpen)} data-phone-reduced-motion={String(reducedMotion)}>
    {error && <div className="phone-alert global" role="alert"><span>{error}</span><Pressable className="phone-icon-button" aria-label="Dismiss notice" onClick={() => setError('')}>×</Pressable></div>}
    {storageError && resolved && <div className="phone-recovery" role="alert"><h2>Device save needs attention</h2><p>Captured requests are retained. Retry the device save before continuing.</p><Pressable className="phone-secondary" onClick={exportRecovery}>Export retained data</Pressable><Pressable className="phone-primary" disabled={saving} onClick={() => businessStorage().retryPersistence().catch(failure => setError(failure.message))}>Retry durable save</Pressable><details><summary>Technical details</summary><p>{storageError}</p></details></div>}
    {!resolved ? <StartupSurface state={{...startup,saveError:storageError}} onRetry={retryOpening} onExport={exportRecovery} busy={busy}>{failedConnection && connectionSettings}</StartupSurface> : user ? <MobileShell key={user.id} initialUser={user} origin={origin} storageError={storageError} saving={saving} onSignedOut={() => coordinator.current.signedOut()} onFieldTest={() => setFieldTest(true)} onExportRecovery={exportRecovery}/> : <section className="phone-signin" aria-label={configuration ? 'Connect the application' : 'Staff sign-in'}>
      <header className="phone-signin-heading"><div className="phone-brand-symbol"><Battery size={28}/></div><div><p className="phone-eyebrow">Battery Inventory</p><h1>{configuration ? 'Connect your workspace' : 'Sign in'}</h1><p>{configuration ? 'Enter the trusted service address provided for this project.' : 'Use your assigned staff account.'}</p></div></header>
      {!native && <p className="phone-preview-context">Isolated browser preview · Native NFC unavailable</p>}
      {connectionSettings}
      {!configuration && <form onSubmit={login} className="phone-signin-form" aria-busy={busy}><label>Username<input value={username} onChange={event => setUsername(event.target.value)} autoComplete="username" required disabled={busy}/></label><label>Password<input type="password" value={password} onChange={event => setPassword(event.target.value)} autoComplete="current-password" required disabled={busy}/></label><Pressable type="submit" className="phone-primary" disabled={busy || !!storageError}>{busy ? 'Signing in…' : 'Sign in'}<LogIn size={19}/></Pressable></form>}
      <details className="phone-signin-tools"><summary>Device diagnostics</summary><Pressable className="phone-secondary" disabled={busy || saving || !!storageError} onClick={() => setFieldTest(true)}><Radio size={18}/>NFC field test</Pressable><p className="phone-muted">Diagnostic attempts stay on this device. No account is required.</p>{native && <Pressable className="phone-text-action" disabled={busy} onClick={() => clearNativeSession().catch(failure => setError(failure.message))}>Reset local sign-in credential</Pressable>}</details>
      {!native && <a href="/mobile-preview" target="_blank" rel="noreferrer">Open local test account setup<ArrowRight size={16}/></a>}
    </section>}
  </div>;
}
createRoot(document.getElementById('root')).render(<MobileApp/>);
