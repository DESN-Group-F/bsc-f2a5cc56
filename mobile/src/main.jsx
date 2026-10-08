import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { initializeRuntime, native, configureOrigin, businessStorage, saveFile, clearNativeSession } from './platform/runtime.mjs';
import { recoverNfcEvidence } from './business/nfc-controller.mjs';
import InventoryApp from './shared/app/inventory-app.js';
import { Registration } from './business/registration.jsx';
import { NfcDiagnostics } from './business/nfc-read.jsx';
import './shared/app/globals.css';
import './app.css';

function App() {
  const [workflowActive, setWorkflowActive] = useState(false);
  const [ready, setReady] = useState(false), [user, setUser] = useState(null), [view, setView] = useState('workspace'), [origin, setOrigin] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false), [username,setUsername] = useState(''), [password,setPassword] = useState(''), [saving,setSaving] = useState(false), [storageError,setStorageError] = useState(null), [,setStorageChanged] = useState(0);
  async function session() { const response = await fetch('/api/session', { cache: 'no-store' }); const body = await response.json(); if (!response.ok) throw new Error(body.error); setUser(body.user); }
  useEffect(() => {
    let stop;
    initializeRuntime().then(async (runtime) => {
      setOrigin(runtime.origin); stop = runtime.storage.subscribe(({ pending, error }) => { setSaving(pending > 0); setStorageError(error); setStorageChanged((value)=>value+1); });
      recoverNfcEvidence(runtime.storage); await runtime.storage.flush(); setReady(true);
      if (!native || runtime.origin !== 'unconfigured') await session();
    }).catch((error)=>setError(error.message));
    const reset = () => { setUser(null); setPassword(''); setView('workspace'); }, notice = (event) => setError(event.detail), workflow = (event) => setWorkflowActive(event.detail);
    window.addEventListener('battery-mobile-session', reset); window.addEventListener('battery-mobile-error',notice);
    window.addEventListener('battery-mobile-workflow-active',workflow);
    return ()=>{ stop?.(); window.removeEventListener('battery-mobile-session',reset); window.removeEventListener('battery-mobile-error',notice); window.removeEventListener('battery-mobile-workflow-active',workflow); };
  }, []);
  async function login(event) {
    event.preventDefault(); setBusy(true); setError('');
    try { const response=await fetch('/api/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'signin',payload:{username,password}})}); const body=await response.json(); if(!response.ok)throw new Error(body.error || 'Sign-in failed.'); setPassword(''); setUser(body.user); }
    catch(error){setError(error.message);}finally{setBusy(false);}
  }
  async function exportRecovery() { try { await saveFile({filename:'mobile-recovery-data.json',blob:new Blob([businessStorage().exportRaw()],{type:'application/json'})}); }catch(error){setError(error.message);} }
  const pending = workflowActive || !!storageError || ready && user && Object.keys(businessStorage().entries()).some(key=>!key.startsWith('preference:') && key.includes(user.id));
  useEffect(()=>{ if (ready && !storageError && user && (businessStorage().getItem(`battery-mobile-registration:${user.id}:demo`) !== null || businessStorage().getItem(`battery-mobile-registration:${user.id}:demo:draft`) !== null)) setView('registration'); },[user]);
  return <div className="mobile-app-root">
    <header className="mobile-app-bar"><strong>Battery Inventory <small>Test 0.2.0</small></strong>{user && <nav aria-label="App navigation"><button onClick={()=>setView('workspace')} disabled={pending && view!=='workspace'}>Workspace</button><button onClick={()=>setView('registration')} disabled={pending && view!=='registration'}>Register</button><button onClick={()=>setView('diagnostics')} disabled={pending}>NFC evidence</button><button onClick={()=>setView('settings')} disabled={pending}>Connection</button></nav>}</header>
    {!native && <div className="mobile-preview-note">Browser functional test · Native NFC unavailable · Local test service only</div>}
    {error && <div className="mobile-error" role="alert">{error}<button aria-label="Dismiss message" onClick={()=>setError('')}>×</button>{native && !user && <div><button disabled={busy} onClick={()=>clearNativeSession().catch(error=>setError(error.message))}>Reset local sign-in credential</button><p>This preserves business recovery and does not revoke the server session. Sign in again after resetting.</p></div>}</div>}
    {storageError && <section className="mobile-recovery" role="alert"><h2>Device recovery storage needs attention</h2><p>{storageError} New operations are blocked. Captured requests have not been replaced.</p><button disabled={saving} onClick={exportRecovery}>Export retained recovery data</button><button disabled={saving} onClick={()=>businessStorage().retryPersistence().catch(error=>setError(error.message))}>Retry saving recovery data</button></section>}
    {!ready ? <section className="mobile-page"><h1>Preparing device storage</h1><p>{error || 'Loading saved work before opening the application…'}</p>{error && <button onClick={exportRecovery}>Export available recovery data</button>}</section> : <div inert={storageError || saving ? true : undefined}>
      {!user ? <section className="mobile-page mobile-signin"><span className="eyebrow">Staff access</span><h1>Sign in to your workspace</h1><p>Use the account provided by your administrator. Passwords are used for this sign-in only.</p>{native && <form onSubmit={async(event)=>{event.preventDefault();setError('');try{await configureOrigin(origin);}catch(error){setError(error.message);}}}><label>Trusted HTTPS inventory service<input type="url" value={origin === 'unconfigured' ? '' : origin} onChange={event=>setOrigin(event.target.value)} placeholder="https://inventory.example.edu" required/></label><button type="submit" disabled={busy || pending}>Save service connection</button></form>}<form onSubmit={login}><label>Username<input value={username} onChange={event=>setUsername(event.target.value)} autoComplete="username" required disabled={busy}/></label><label>Password<input type="password" value={password} onChange={event=>setPassword(event.target.value)} autoComplete="current-password" required disabled={busy}/></label><button type="submit" disabled={busy || native && origin==='unconfigured'}>{busy?'Signing in…':'Sign in'}</button></form>{!native && <p>Local test accounts are available on the computer's <a href="/mobile-preview" target="_blank" rel="noreferrer">test setup page</a>.</p>}</section> : view==='workspace' ? <InventoryApp key={user.id} initialUser={user}/> : view==='registration' ? <Registration key={user.id} user={user} onExit={()=>setView('workspace')}/> : view==='diagnostics' ? <NfcDiagnostics/> : <section className="mobile-page"><h1>Service and recovery</h1><p>{native ? origin : 'Same-origin local preview service'}</p><p>Signed in as {user.displayName} · {user.username} · {user.role}</p><p>Native credentials stay in Keychain or encrypted Android storage. Business recovery stays on this device. Offline changes are not silently queued or reported as successful.</p><button onClick={exportRecovery}>Export device recovery data</button><button onClick={()=>setView('workspace')}>Return to workspace</button></section>}
    </div>}
    {saving && <div className="mobile-saving" role="status">Saving reviewed work on this device…</div>}
  </div>;
}
createRoot(document.getElementById('root')).render(<App/>);
