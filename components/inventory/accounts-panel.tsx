"use client";
import { useEffect, useState } from "react";
import { Download, Plus, Pencil, Shield, UserRound, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import type { StaffUser } from "@/lib/accounts";

import { formatTime, reloadSessionPage } from "@/lib/client-utils";

async function accountRequest(action: string, payload: unknown) {
    const response = await fetch("/api/accounts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, payload }) });
    const body = await response.json() as { error?: string; result: StaffUser | { signInRequired: boolean } };
    if (!response.ok) throw new Error(body.error || "The account could not be saved.");
    return body.result;
}
export function MyAccount({ user, onSaved }: { user: StaffUser; onSaved: () => Promise<void> }) {
    const [expectedVersion, setExpectedVersion] = useState(user.version), [baseline, setBaseline] = useState(user);
    const [name, setName] = useState(user.displayName), [email, setEmail] = useState(user.email), [dataset, setDataset] = useState(user.defaultDataset);
    const [currentPassword, setCurrentPassword] = useState(""), [newPassword, setNewPassword] = useState(""), [confirm, setConfirm] = useState("");
    const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
    async function save(event: React.FormEvent, password = false) {
        event.preventDefault(); setBusy(true); setError(""); setNotice("");
        try {
            if (password) {
                if (newPassword !== confirm) throw new Error("The new passwords do not match.");
                await accountRequest("password", { currentPassword, newPassword });
                reloadSessionPage("/signin");
            } else {
                const saved = await accountRequest("profile", { id: user.id, expectedVersion, displayName: name, email, defaultDataset: dataset }) as StaffUser;
                setExpectedVersion(saved.version); setBaseline(saved);
                setNotice("Your account preferences have been saved.");
                await onSaved().catch(() => setError("Your profile was saved, but the inventory could not refresh. Refresh before making another change."));
            }
        } catch (error) { setError((error as Error).message); }
        finally { setBusy(false); }
    }
    async function reloadProfile() {
        setBusy(true);
        try {
            const response = await fetch("/api/accounts?scope=self", { cache: "no-store" });
            const body = await response.json() as { user: StaffUser; error?: string };
            if (!response.ok) throw new Error(body.error);
            if (name === baseline.displayName) setName(body.user.displayName);
            if (email === baseline.email) setEmail(body.user.email);
            if (dataset === baseline.defaultDataset) setDataset(body.user.defaultDataset);
            setExpectedVersion(body.user.version); setBaseline(body.user); setError("");
            setNotice("Latest profile loaded. Your edited fields were kept; review them before saving.");
            await onSaved();
        } catch (error) { setError((error as Error).message); }
        finally { setBusy(false); }
    }
    return <div className="account-grid"><section className="inventory-panel account-card"><h2><UserRound size={20}/>My account</h2><div className="account-identity"><strong>{user.username}</strong><span className="role-badge">{user.role === "admin" ? "Administrator" : "Staff"}</span></div><form onSubmit={save} className="form-stack"><div className="form-field"><Label htmlFor="profile-name">Display name</Label><Input id="profile-name" value={name} onChange={event => setName(event.target.value)} required minLength={2} maxLength={120} disabled={busy}/></div><div className="form-field"><Label htmlFor="profile-email">Email — optional</Label><Input id="profile-email" type="email" value={email} onChange={event => setEmail(event.target.value)} maxLength={254} disabled={busy}/></div><div className="form-field"><Label>Default inventory</Label><Select value={dataset} onValueChange={value => setDataset(value as "demo" | "live")} disabled={busy}><SelectTrigger aria-label="Default inventory"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="demo">Demonstration inventory</SelectItem><SelectItem value="live">Working inventory</SelectItem></SelectContent></Select></div><p className="field-hint">All staff share the inventory. Your preferences belong to your account.</p><Button type="submit" disabled={busy}>Save my profile</Button></form></section>
        <section className="inventory-panel account-card"><h2><Shield size={20}/>Change password</h2><form onSubmit={event => save(event, true)} className="form-stack"><div className="form-field"><Label htmlFor="current-password">Current password</Label><Input id="current-password" type="password" autoComplete="current-password" value={currentPassword} onChange={event => setCurrentPassword(event.target.value)} required disabled={busy}/></div><div className="form-field"><Label htmlFor="new-password">New password</Label><Input id="new-password" type="password" autoComplete="new-password" value={newPassword} onChange={event => setNewPassword(event.target.value)} required minLength={12} maxLength={128} disabled={busy}/><p className="field-hint">Use at least 12 characters.</p></div><div className="form-field"><Label htmlFor="confirm-password">Confirm new password</Label><Input id="confirm-password" type="password" autoComplete="new-password" value={confirm} onChange={event => setConfirm(event.target.value)} required disabled={busy}/></div><p className="field-hint">Changing your password signs out all sessions, including this one.</p><Button type="submit" variant="outline" disabled={busy}>Change password</Button></form></section>
        {notice && <p className="success-notice" role="status">{notice}</p>}{error && <div><p className="form-error" role="alert">{error}</p><Button variant="outline" onClick={reloadProfile} disabled={busy}>Review latest profile</Button></div>}
    </div>;
}
type AccountEvent = { id: string; action: string; actorName: string; targetId: string; at: string };
export function AccountManagement({ currentUser, onSaved }: { currentUser: StaffUser; onSaved: () => Promise<void> }) {
    const [accounts, setAccounts] = useState<StaffUser[]>([]), [events, setEvents] = useState<AccountEvent[]>([]), [search, setSearch] = useState(""), [error, setError] = useState(""), [loading, setLoading] = useState(true);
    const [draft, setDraft] = useState<StaffUser | "new" | null>(null), [revision, setRevision] = useState(0);
    useEffect(() => {
        const abort = new AbortController();
        fetch("/api/accounts", { cache: "no-store", signal: abort.signal }).then(async response => { const body = await response.json() as { error?: string; accounts: StaffUser[]; events: AccountEvent[] }; if (!response.ok) throw new Error(body.error); setAccounts(body.accounts); setEvents(body.events); setError(""); }).catch(error => { if (error.name !== "AbortError") setError(error.message); }).finally(() => { if (!abort.signal.aborted) setLoading(false); });
        return () => abort.abort();
    }, [revision]);
    const matching = accounts.filter(account => `${account.username} ${account.displayName} ${account.email} ${account.role} ${account.active ? "active" : "disabled"}`.toLowerCase().includes(search.toLowerCase()));
    return <><section className="inventory-panel"><div className="panel-top"><h2>Staff accounts</h2><div className="panel-actions"><Button variant="outline" onClick={() => { setLoading(true); setRevision(old => old + 1); }} disabled={loading}><RefreshCw size={16}/>Refresh accounts</Button><Button onClick={() => setDraft("new")} disabled={loading}><Plus size={16}/>Create account</Button></div></div><div className="table-toolbar"><Input aria-label="Search staff accounts" placeholder="Search name, username or role…" value={search} onChange={event => setSearch(event.target.value)}/><Button variant="outline" disabled={!matching.length} onClick={() => { const link = document.createElement("a"); link.href = `/api/accounts?${new URLSearchParams({ download: "csv", search })}`; document.body.appendChild(link); link.click(); link.remove(); }}><Download size={16}/>Download list</Button><span>{matching.length} accounts</span></div>{error && <p className="form-error" role="alert">{error}</p>}<Table><TableHeader><TableRow><TableHead>ACCOUNT</TableHead><TableHead>ROLE</TableHead><TableHead>STATUS</TableHead><TableHead>EMAIL</TableHead><TableHead>ACTIONS</TableHead></TableRow></TableHeader><TableBody>{matching.map(account => <TableRow key={account.id}><TableCell><strong>{account.displayName}</strong><span className="cell-secondary">{account.username}{account.id === currentUser.id ? " · You" : ""}</span></TableCell><TableCell>{account.role === "admin" ? "Administrator" : "Staff"}</TableCell><TableCell>{account.active ? "Active" : "Disabled"}</TableCell><TableCell>{account.email || "Not recorded"}</TableCell><TableCell><Button variant="ghost" size="sm" onClick={() => setDraft(account)} aria-label={`Manage ${account.username}`}><Pencil size={16}/>Manage</Button></TableCell></TableRow>)}</TableBody></Table><div className="panel-footer">Disabled accounts lose access immediately. Their historical actions remain traceable.</div></section><section className="inventory-panel account-audit"><div className="section-heading"><h2>Account activity</h2><span>Latest {events.length} events</span></div><Table><TableHeader><TableRow><TableHead>ACTION</TableHead><TableHead>ACCOUNT</TableHead><TableHead>ADMINISTRATOR / STAFF</TableHead><TableHead>RECORDED AT</TableHead></TableRow></TableHeader><TableBody>{events.map(event => <TableRow key={event.id}><TableCell>{event.action.replaceAll("_", " ")}</TableCell><TableCell>{accounts.find(account => account.id === event.targetId)?.username ?? event.targetId}</TableCell><TableCell>{event.actorName}</TableCell><TableCell>{formatTime(event.at)}</TableCell></TableRow>)}</TableBody></Table></section>
        {draft && <AccountEditor key={draft === "new" ? "new" : `${draft.id}-${draft.version}`} account={draft === "new" ? null : draft} onClose={() => setDraft(null)} onSaved={async () => { setRevision(old => old + 1); await onSaved().catch(() => setError("The account was saved, but the inventory could not refresh. Refresh before making another change.")); }}/>}</>;
}
function AccountEditor({ account, onClose, onSaved }: { account: StaffUser | null; onClose: () => void; onSaved: () => Promise<void> }) {
    const [baseline, setBaseline] = useState(account), [expectedVersion, setExpectedVersion] = useState(account?.version);
    const [notice, setNotice] = useState("");
    const [username, setUsername] = useState(account?.username ?? ""), [name, setName] = useState(account?.displayName ?? ""), [email, setEmail] = useState(account?.email ?? ""), [role, setRole] = useState(account?.role ?? "staff"), [active, setActive] = useState(account?.active ?? true), [password, setPassword] = useState("");
    const [busy, setBusy] = useState(false), [error, setError] = useState("");
    async function save(event: React.FormEvent) {
        event.preventDefault(); setBusy(true); setError(""); setNotice("");
        try {
            await accountRequest(account ? "update" : "create", { ...(account ? { id: account.id, expectedVersion, active } : { username }), displayName: name, email, role, defaultDataset: baseline?.defaultDataset ?? "demo", ...(password ? { password } : {}) });
            await onSaved(); onClose();
        } catch (error) { setError((error as Error).message); }
        finally { setBusy(false); }
    }
    async function reloadAccount() {
        if (!account || !baseline) return;
        setBusy(true);
        try {
            const response = await fetch("/api/accounts", { cache: "no-store" });
            const body = await response.json() as { accounts: StaffUser[]; error?: string };
            if (!response.ok) throw new Error(body.error);
            const latest = body.accounts.find(item => item.id === account.id);
            if (!latest) throw new Error("Account not found.");
            if (name === baseline.displayName) setName(latest.displayName);
            if (email === baseline.email) setEmail(latest.email);
            if (role === baseline.role) setRole(latest.role);
            if (active === baseline.active) setActive(latest.active);
            setBaseline(latest); setExpectedVersion(latest.version); setError("");
            setNotice("Latest account loaded. Your edited fields were kept; review them before saving.");
        } catch (error) { setError((error as Error).message); }
        finally { setBusy(false); }
    }
    return <Dialog open onOpenChange={open => !open && !busy && onClose()}><DialogContent><DialogHeader><DialogTitle>{account ? `Manage ${account.username}` : "Create staff account"}</DialogTitle><DialogDescription>{account ? "Changes to access or passwords sign out this account's existing sessions." : "Provide these credentials directly to the staff member. There is no student sign-up."}</DialogDescription></DialogHeader><form className="form-stack" onSubmit={save}>{!account && <div className="form-field"><Label htmlFor="account-username">Username</Label><Input id="account-username" value={username} onChange={event => setUsername(event.target.value)} minLength={2} maxLength={64} required disabled={busy}/></div>}<div className="form-field"><Label htmlFor="account-name">Display name</Label><Input id="account-name" value={name} onChange={event => setName(event.target.value)} minLength={2} maxLength={120} required disabled={busy}/></div><div className="form-field"><Label htmlFor="account-email">Email — optional</Label><Input id="account-email" type="email" value={email} onChange={event => setEmail(event.target.value)} disabled={busy}/></div><div className="form-field"><Label>Role</Label><Select value={role} onValueChange={value => setRole(value as "admin" | "staff")} disabled={busy}><SelectTrigger aria-label="Staff account role"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="staff">Staff</SelectItem><SelectItem value="admin">Administrator</SelectItem></SelectContent></Select></div>{account && <div className="form-field"><Label>Access</Label><Select value={active ? "active" : "disabled"} onValueChange={value => setActive(value === "active")} disabled={busy}><SelectTrigger aria-label="Staff account access"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="active">Active</SelectItem><SelectItem value="disabled">Disabled</SelectItem></SelectContent></Select></div>}<div className="form-field"><Label htmlFor="account-password">{account ? "Reset password — optional" : "Initial password"}</Label><Input id="account-password" type="password" autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} minLength={12} maxLength={128} required={!account} disabled={busy}/><p className="field-hint">At least 12 characters.{account ? " Leave blank to keep the existing password." : ""}</p></div>{notice && <div><p className="field-hint" role="status">{notice}</p><p className="field-hint">Latest saved account: {baseline?.displayName} · {baseline?.email || "No email"} · {baseline?.role === "admin" ? "Administrator" : "Staff"} · {baseline?.active ? "Active" : "Disabled"}</p></div>}{error && <div><p className="form-error" role="alert">{error}</p>{account && <Button type="button" variant="outline" onClick={reloadAccount} disabled={busy}>Review latest account</Button>}</div>}<DialogFooter><Button type="button" variant="outline" onClick={onClose} disabled={busy}>Cancel</Button><Button type="submit" disabled={busy}>{busy ? "Saving…" : account ? "Save account" : "Create account"}</Button></DialogFooter></form></DialogContent></Dialog>;
}
