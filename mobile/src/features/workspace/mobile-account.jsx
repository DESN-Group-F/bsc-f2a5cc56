import { PhoneChoice } from '../../app/phone-choice.jsx';
import { Pressable } from '../../app/phone-ui.jsx';
import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Download, Plus, ShieldCheck, UserRound } from 'lucide-react';
import { formatTime, readDownloadAttachment, reloadSessionPage } from '../../shared/lib/client-utils.js';
import { useTaskEndpoint } from '../../shared/hooks/use-task-endpoint.js';
import { saveFile } from '../../platform/runtime.mjs';
import { useWorkflowLock } from '../../business/workflow-boundary.jsx';
import { PhonePagination, PhoneResourceState, PhoneSearch, PhoneTools, usePhoneBack, usePhoneViewState } from './phone-controls.jsx';
import { workspaceStateKey } from './phone-view-state.mjs';
import { PhoneFormDraftStatus, usePhoneFormDraft } from '../../app/phone-form-draft.jsx';

function useAccountField(viewKey, field, initial, own, draft) {
  const session = usePhoneViewState(viewKey, field, initial);
  return own ? [draft.value[field], next => draft.setValue(previous => ({ ...previous, [field]: typeof next === 'function' ? next(previous[field]) : next }))] : session;
}

function profileFields(account) {
  const baseline = { displayName: account.displayName ?? '', email: account.email ?? '', defaultDataset: account.defaultDataset, role: account.role, active: account.active ?? true, version: account.version };
  return { expectedVersion: account.version, baseline, displayName: baseline.displayName, email: baseline.email, defaultDataset: baseline.defaultDataset };
}

async function accountRequest(action, payload) {
  const response = await fetch('/api/accounts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, payload }) });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || 'The account could not be saved.');
  return body.result;
}

function AccountForm({ account, currentUser, inventoryDataset, own = false, visible = true, onSaved, onClose }) {
  const viewKey = workspaceStateKey(currentUser.id, inventoryDataset, `account-form:${own ? 'profile' : 'staff'}:${account?.id ?? 'new'}`);
  const profileDraft = usePhoneFormDraft({ accountId: currentUser.id, dataset: inventoryDataset, kind: 'profile', recordId: currentUser.id, initial: () => profileFields(own ? account : currentUser), enabled: own });
  const snapshot = value => value ? { displayName: value.displayName, email: value.email, role: value.role, active: value.active, defaultDataset: value.defaultDataset, version: value.version } : null;
  const [baseline, setBaseline] = useAccountField(viewKey, 'baseline', snapshot(account), own, profileDraft);
  const [expectedVersion, setExpectedVersion] = useAccountField(viewKey, 'expectedVersion', account?.version, own, profileDraft);
  const [username, setUsername] = usePhoneViewState(viewKey, 'username', account?.username ?? '');
  const [displayName, setDisplayName] = useAccountField(viewKey, 'displayName', account?.displayName ?? '', own, profileDraft);
  const [email, setEmail] = useAccountField(viewKey, 'email', account?.email ?? '', own, profileDraft);
  const [role, setRole] = usePhoneViewState(viewKey, 'role', account?.role ?? 'staff');
  const [active, setActive] = usePhoneViewState(viewKey, 'active', account?.active ?? true);
  const [dataset, setDataset] = useAccountField(viewKey, 'defaultDataset', account?.defaultDataset ?? 'demo', own, profileDraft);
  const [password, setPassword] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const errorTarget = useRef(null);
  useEffect(() => { if (error) { errorTarget.current?.scrollIntoView({ block: 'nearest', behavior: 'instant' }); errorTarget.current?.focus({ preventScroll: true }); } }, [error]);
  useWorkflowLock(busy);
  usePhoneBack(visible && !!onClose && !busy, onClose);
  const dirty = displayName !== (baseline?.displayName ?? '') || email !== (baseline?.email ?? '') || dataset !== (baseline?.defaultDataset ?? 'demo') || !own && (role !== (baseline?.role ?? 'staff') || active !== (baseline?.active ?? true)) || !account && !!username;
  async function discard() {
    if (own) { setBusy(true); try { await profileDraft.clear(profileFields(account)); setPassword(''); setCurrentPassword(''); setConfirmPassword(''); setError(''); setNotice('Unsubmitted edits discarded.'); } catch (failure) { setError(failure.message); } finally { setBusy(false); } return; }
    setUsername(account?.username ?? ''); setDisplayName(account?.displayName ?? ''); setEmail(account?.email ?? ''); setRole(account?.role ?? 'staff'); setActive(account?.active ?? true); setDataset(account?.defaultDataset ?? 'demo'); setBaseline(snapshot(account)); setExpectedVersion(account?.version); setPassword(''); setCurrentPassword(''); setConfirmPassword(''); setError(''); setNotice('Unsubmitted edits discarded.');
  }
  async function save(event) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      if (own) await profileDraft.save();
      const saved = await accountRequest(own ? 'profile' : account ? 'update' : 'create', { ...(account ? { id: account.id, expectedVersion } : { username }), displayName, email, defaultDataset: own ? dataset : baseline?.defaultDataset ?? 'demo', ...(!own ? { role, ...(account ? { active } : {}), ...(password ? { password } : {}) } : {}) });
      if (own) {
        setNotice('Your profile and inventory preference were saved.');
        try { await profileDraft.clear(profileFields(saved)); } catch { setError('Your profile was saved. Retry clearing its local draft before another profile change.'); }
        try { await onSaved?.(); } catch { setError('Your profile was saved. Refresh the account before another change.'); }
        return;
      }
      setExpectedVersion(saved.version); setBaseline(snapshot(saved)); setDisplayName(saved.displayName); setEmail(saved.email ?? ''); if (!own) setPassword(''); setNotice(own ? 'Your profile and inventory preference were saved.' : 'Staff account saved.');
      if (!account) { setUsername(''); setDisplayName(''); setEmail(''); setRole('staff'); setActive(true); setBaseline(null); setExpectedVersion(undefined); }
      try { await onSaved?.(); } catch { setError('The account was saved, but shared inventory could not refresh. Refresh before another change.'); }
      if (!own) onClose?.();
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }
  async function reload() {
    setBusy(true); setError('');
    try {
      const response = await fetch(own ? '/api/accounts?scope=self' : '/api/accounts', { cache: 'no-store' });
      const body = await response.json(); if (!response.ok) throw new Error(body.error || 'The latest account could not be loaded.');
      const latest = own ? body.user : body.accounts.find(item => item.id === account.id);
      if (!latest) throw new Error('Account not found.');
      if (own) {
        profileDraft.setValue({ expectedVersion: latest.version, baseline: profileFields(latest).baseline, displayName: displayName === baseline.displayName ? latest.displayName : displayName, email: email === baseline.email ? latest.email ?? '' : email, defaultDataset: dataset === baseline.defaultDataset ? latest.defaultDataset : dataset });
        setNotice('Latest account loaded. Edited fields were kept; review before saving.'); return;
      }
      if (displayName === baseline.displayName) setDisplayName(latest.displayName);
      if (email === baseline.email) setEmail(latest.email);
      if (role === baseline.role) setRole(latest.role);
      if (active === baseline.active) setActive(latest.active);
      if (dataset === baseline.defaultDataset) setDataset(latest.defaultDataset);
      setBaseline(snapshot(latest)); setExpectedVersion(latest.version); setNotice('Latest account loaded. Edited fields were kept; review before saving.');
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }
  async function changePassword(event) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try { if (password !== confirmPassword) throw new Error('The new passwords do not match.'); await accountRequest('password', { currentPassword, newPassword: password }); setCurrentPassword(''); setPassword(''); setConfirmPassword(''); reloadSessionPage('/signin'); }
    catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }
  return <div className="mobile-account-form-page">{onClose && <Pressable type="button" className="mobile-phone-text-button" disabled={busy} onClick={onClose}><ChevronLeft size={18} aria-hidden="true" />Back to staff accounts</Pressable>}<div className="mobile-account-identity"><span className="mobile-work-icon mobile-work-icon-blue">{(account?.role ?? role) === 'admin' ? <ShieldCheck size={22} aria-hidden="true" /> : <UserRound size={22} aria-hidden="true" />}</span><div><h2>{own ? currentUser.displayName : account?.displayName || 'New staff account'}</h2><p>{account?.username ?? 'Choose a new username'} · {(account?.role ?? role) === 'admin' ? 'Administrator' : 'Staff'}</p></div></div>{own && <PhoneFormDraftStatus draft={profileDraft} />}{own && profileDraft.restored && expectedVersion !== account.version && <div className="mobile-work-load-error" role="alert"><p>This draft uses an older reviewed profile. Load the latest account before saving.</p><Pressable disabled={busy || profileDraft.clearing} onClick={reload}>Review latest account</Pressable></div>}{notice && <p className="mobile-phone-notice" role="status">{notice}</p>}{error && <div ref={errorTarget} tabIndex={-1} className="mobile-work-load-error" role="alert"><p>{error}</p>{account && <Pressable type="button" disabled={busy} onClick={reload}>Review latest account</Pressable>}</div>}
    <form className="mobile-phone-form" onSubmit={save} aria-busy={busy || own && profileDraft.pending} onInvalidCapture={event => { const disclosure = event.target.closest('details'); if (disclosure) disclosure.open = true; }}><h2>{own ? 'Profile & preferences' : account ? 'Account access' : 'Create staff account'}</h2>{!account && <label>Username<input value={username} onChange={event => setUsername(event.target.value)} required minLength={2} maxLength={64} disabled={busy} autoComplete="off" /></label>}<label>Display name<input value={displayName} onChange={event => setDisplayName(event.target.value)} required minLength={2} maxLength={120} disabled={busy} autoComplete="name" /></label><details className="mobile-phone-form-disclosure"><summary>Contact details · optional</summary><label>Email<input type="email" value={email} onChange={event => setEmail(event.target.value)} maxLength={254} disabled={busy} autoComplete="email" /></label></details>{own ? <PhoneChoice label="Default inventory" value={dataset} onChange={setDataset} disabled={busy} options={[{value:"live",label:"Working inventory"},{value:"demo",label:"Demonstration inventory"}]}/> : <><PhoneChoice label="Role" value={role} onChange={setRole} disabled={busy} options={[{value:"staff",label:"Staff"},{value:"admin",label:"Administrator"}]}/>{account && <PhoneChoice label="Access" value={active ? "active" : "disabled"} onChange={value => setActive(value === "active")} disabled={busy} options={[{value:"active",label:"Active"},{value:"disabled",label:"Disabled"}]}/>}<label>{account ? 'Reset password · optional' : 'Initial password'}<input type="password" value={password} onChange={event => setPassword(event.target.value)} minLength={12} maxLength={128} autoComplete="new-password" required={!account} disabled={busy} /></label><p className="mobile-phone-caption">Use at least 12 characters.{account ? ' Leave blank to retain the current password. Access and password changes sign out existing sessions.' : 'Provide these credentials directly to the staff member. Public sign-up is unavailable.'}</p></>}<Pressable type="submit" className="mobile-phone-primary" disabled={busy || own && (!!profileDraft.error || profileDraft.clearing)}>{busy ? 'Saving…' : own ? 'Save my profile' : account ? 'Save account' : 'Create account'}</Pressable>{dirty && <Pressable type="button" disabled={busy} onClick={discard}>Discard edits</Pressable>}</form>
    {own && <details className="mobile-phone-form-disclosure mobile-account-password"><summary>Change password</summary><form className="mobile-phone-form" onSubmit={changePassword}><label>Current password<input type="password" value={currentPassword} onChange={event => setCurrentPassword(event.target.value)} autoComplete="current-password" required disabled={busy} /></label><label>New password<input type="password" value={password} onChange={event => setPassword(event.target.value)} autoComplete="new-password" minLength={12} maxLength={128} required disabled={busy} /></label><label>Confirm new password<input type="password" value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} autoComplete="new-password" required disabled={busy} /></label><p className="mobile-phone-caption">Use at least 12 characters. Changing your password signs out all sessions, including this one.</p><Pressable type="submit" disabled={busy}>Change password</Pressable></form></details>}
  </div>;
}

export function MobileMyAccount({ user, dataset, onChanged }) { return <AccountForm account={user} currentUser={user} inventoryDataset={dataset} own onSaved={onChanged} />; }

export function MobileAccounts({ active = true, user, dataset, onChanged, onTools }) {
  const viewKey = workspaceStateKey(user.id, dataset, 'accounts');
  const [search, setSearch] = usePhoneViewState(viewKey, 'search', '');
  const [page, setPage] = usePhoneViewState(viewKey, 'page', 0);
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const resource = useTaskEndpoint('/api/accounts', user.id, user.version, !active || !!editing || busy);
  const all = resource.payload?.accounts ?? [];
  const events = resource.payload?.events ?? [];
  const matching = all.filter(account => `${account.username} ${account.displayName} ${account.email} ${account.role} ${account.active ? 'active' : 'disabled'}`.toLowerCase().includes(search.toLowerCase()));
  const currentPage = Math.min(page, Math.max(0, Math.ceil(matching.length / 25) - 1));
  useWorkflowLock(active && (busy || !!editing));
  async function download() {
    setBusy(true); setNotice('');
    try { const response = await fetch(`/api/accounts?${new URLSearchParams({ download: 'xlsx', search })}`, { cache: 'no-store' }); const attachment = await readDownloadAttachment(response, 'xlsx', 'staff-accounts-report.xlsx'); await saveFile(attachment); setNotice('Staff account report saved.'); }
    catch (failure) { setNotice(failure.message); }
    finally { setBusy(false); }
  }
  if (editing) return <AccountForm key={editing === 'new' ? 'new' : `${editing.id}:${editing.version}`} account={editing === 'new' ? null : editing} currentUser={user} inventoryDataset={dataset} visible={active} onClose={() => setEditing(null)} onSaved={async () => { resource.refresh(); await onChanged?.(); }} />;
  return <div className="mobile-phone-records"><PhoneTools onTools={onTools} onRefresh={resource.refresh} label="Account history & all tools" disabled={busy} actions={[{ label: 'Download report', icon: Download, disabled: resource.loading || !!resource.error || !matching.length, onClick: download }]}><span className="mobile-phone-caption">{matching.length} accounts</span></PhoneTools><PhoneSearch value={search} onChange={value => { setSearch(value); setPage(0); }} label="Search staff name, username or role" onClear={() => { setSearch(''); setPage(0); }} disabled={busy} /><div className="mobile-phone-actions"><Pressable type="button" className="primary" disabled={resource.loading || !!resource.error || busy} onClick={() => setEditing('new')}><Plus size={17} aria-hidden="true" />Create account</Pressable></div>{notice && <p className="mobile-phone-notice" role="status">{notice}</p>}<PhoneResourceState loading={resource.loading} retained={!!resource.payload} error={resource.error} onRetry={resource.refresh} empty={!matching.length} emptyText="No matching staff accounts." />{resource.payload && <div className="mobile-phone-list" data-phone-results tabIndex={-1}>{matching.slice(currentPage * 25, (currentPage + 1) * 25).map(account => <Pressable type="button" className="mobile-account-row" key={account.id} onClick={() => setEditing(account)} disabled={busy}><span className="mobile-work-icon mobile-work-icon-blue">{account.role === 'admin' ? <ShieldCheck size={20} aria-hidden="true" /> : <UserRound size={20} aria-hidden="true" />}</span><span><strong>{account.displayName}</strong><small>{account.username}{account.id === user.id ? ' · You' : ''}</small><em>{account.role === 'admin' ? 'Administrator' : 'Staff'} · {account.active ? 'Active' : 'Disabled'}</em><small>{account.email || 'Email not recorded'}</small></span><ChevronRight size={18} aria-hidden="true" /></Pressable>)}</div>}<PhonePagination page={page} count={matching.length} onPage={setPage} /><details className="mobile-account-history"><summary>Latest account activity ({events.length})</summary>{events.map(event => <article key={event.id}><strong>{event.action.replaceAll('_', ' ')}</strong><p>{all.find(account => account.id === event.targetId)?.username ?? event.targetId} · {event.actorName}</p><small>{formatTime(event.at)}</small></article>)}</details></div>;
}
