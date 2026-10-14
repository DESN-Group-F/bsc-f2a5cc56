import React from 'react';
import { Battery, RefreshCw, Download } from 'lucide-react';
import { startupPresentation } from './startup-state.mjs';
import { Pressable } from './phone-ui.jsx';
import { PhoneReadError } from './phone-read-error.jsx';

export function StartupSurface({ state, onRetry, onExport, busy = false, children }) {
  const content = startupPresentation(state);
  return <section className="phone-startup" aria-busy={busy || !content.failed} data-startup-phase={state.phase}>
    <div className="phone-startup-identity" aria-hidden="true"><Battery size={32}/></div>
    <p className="phone-eyebrow">Battery Inventory</p>
    <div className="phone-startup-status" role={content.failed ? 'alert' : 'status'} aria-live="polite">
      <h1>{content.title}</h1><p>{content.detail}</p>
      {!content.failed && <span className="phone-startup-progress" aria-hidden="true"><i/></span>}
    </div>
    {content.failed && <div className="phone-startup-actions"><Pressable className="phone-primary" busy={busy} onClick={onRetry}><RefreshCw size={18}/>{busy ? 'Retrying…' : content.action}</Pressable>{state.failedStage === 'local' && onExport && <Pressable className="phone-secondary" disabled={busy} onClick={onExport}><Download size={18}/>Export retained data</Pressable>}<details><summary>Technical details</summary><p>{state.saveError || state.error}</p></details></div>}
    {children}
  </section>;
}

export function InitialContentSurface({ title, error, loading, onRetry }) {
  return <section className="phone-loading" data-phone-initial-state={error && !loading ? 'failed' : 'loading'} aria-busy={loading}>
    <h2>{error && !loading ? 'Inventory unavailable' : title === 'Restoring saved work' ? title : 'Loading ' + title.toLowerCase()}</h2>
    {error && !loading ? <PhoneReadError error={error} onRetry={onRetry}/> : <><p role="status">{title === 'Restoring saved work' ? 'Your original work is retained. Nothing is submitted automatically.' : 'Opening the current inventory.'}</p><div className="phone-loading-skeleton" aria-hidden="true"><span/><span/><span/></div></>}
  </section>;
}
