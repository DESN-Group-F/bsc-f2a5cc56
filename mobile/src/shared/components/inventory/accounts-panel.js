"use client";
import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import { Download, Plus, Pencil, Shield, UserRound, RefreshCw } from "lucide-react";
import { Button } from "../ui/button.js";
import { DownloadAction } from "../ui/download-action.js";
import { MotionPresence } from "../ui/workspace-motion.js";
import { LoadingState } from "../ui/loading-state.js";
import { useDownloadFeedback } from "../../hooks/use-download-feedback.js";
import { Input } from "../ui/input.js";
import { Label } from "../ui/label.js";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "../ui/dialog.js";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "../ui/select.js";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "../ui/table.js";
import { getRolePermissions } from "../../lib/permissions.js";
import { formatTime, readDownloadAttachment, reloadSessionPage } from "../../lib/client-utils.js";
async function accountRequest(action, payload) {
    const response = await fetch("/api/accounts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, payload }) });
    const body = await response.json();
    if (!response.ok)
        throw new Error(body.error || "The account could not be saved.");
    return body.result;
}
export function MyAccount({ user, onSaved }) {
    const [expectedVersion, setExpectedVersion] = useState(user.version), [baseline, setBaseline] = useState(user);
    const [name, setName] = useState(user.displayName), [email, setEmail] = useState(user.email), [dataset, setDataset] = useState(user.defaultDataset);
    const [currentPassword, setCurrentPassword] = useState(""), [newPassword, setNewPassword] = useState(""), [confirm, setConfirm] = useState("");
    const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
    async function save(event, password = false) {
        event.preventDefault();
        setBusy(true);
        setError("");
        setNotice("");
        try {
            if (password) {
                if (newPassword !== confirm)
                    throw new Error("The new passwords do not match.");
                await accountRequest("password", { currentPassword, newPassword });
                reloadSessionPage("/signin");
            }
            else {
                const saved = await accountRequest("profile", { id: user.id, expectedVersion, displayName: name, email, defaultDataset: dataset });
                setExpectedVersion(saved.version);
                setBaseline(saved);
                setNotice("Your account preferences have been saved.");
                await onSaved().catch(() => setError("Your profile was saved, but the inventory could not refresh. Refresh before making another change."));
            }
        }
        catch (error) {
            setError(error.message);
        }
        finally {
            setBusy(false);
        }
    }
    async function reloadProfile() {
        setBusy(true);
        try {
            const response = await fetch("/api/accounts?scope=self", { cache: "no-store" });
            const body = await response.json();
            if (!response.ok)
                throw new Error(body.error);
            if (name === baseline.displayName)
                setName(body.user.displayName);
            if (email === baseline.email)
                setEmail(body.user.email);
            if (dataset === baseline.defaultDataset)
                setDataset(body.user.defaultDataset);
            setExpectedVersion(body.user.version);
            setBaseline(body.user);
            setError("");
            setNotice("Latest profile loaded. Your edited fields were kept; review them before saving.");
            await onSaved();
        }
        catch (error) {
            setError(error.message);
        }
        finally {
            setBusy(false);
        }
    }
    return _jsxs("div", { className: "account-grid", children: [_jsxs("section", { className: "inventory-panel account-card", children: [_jsxs("h2", { children: [_jsx(UserRound, { size: 20 }), "My account"] }), _jsxs("div", { className: "account-identity", children: [_jsx("strong", { children: user.username }), _jsx("span", { className: "role-badge", children: user.role === "admin" ? "Administrator" : "Staff" })] }), _jsxs("form", { onSubmit: save, className: "form-stack", children: [_jsxs("div", { className: "form-field", children: [_jsx(Label, { htmlFor: "profile-name", children: "Display name" }), _jsx(Input, { id: "profile-name", value: name, onChange: event => setName(event.target.value), required: true, minLength: 2, maxLength: 120, disabled: busy })] }), _jsxs("div", { className: "form-field", children: [_jsx(Label, { htmlFor: "profile-email", children: "Email \u2014 optional" }), _jsx(Input, { id: "profile-email", type: "email", value: email, onChange: event => setEmail(event.target.value), maxLength: 254, disabled: busy })] }), _jsxs("div", { className: "form-field", children: [_jsx(Label, { children: "Default inventory" }), _jsxs(Select, { value: dataset, onValueChange: value => setDataset(value), disabled: busy, children: [_jsx(SelectTrigger, { "aria-label": "Default inventory", children: _jsx(SelectValue, {}) }), _jsxs(SelectContent, { children: [_jsx(SelectItem, { value: "demo", children: "Demonstration inventory" }), _jsx(SelectItem, { value: "live", children: "Working inventory" })] })] })] }), _jsx("p", { className: "field-hint", children: "All staff share the inventory. Your preferences belong to your account." }), _jsx(Button, { type: "submit", disabled: busy, children: "Save my profile" })] })] }), _jsxs("section", { className: "inventory-panel account-card", children: [_jsxs("h2", { children: [_jsx(Shield, { size: 20 }), "Change password"] }), _jsxs("form", { onSubmit: event => save(event, true), className: "form-stack", children: [_jsxs("div", { className: "form-field", children: [_jsx(Label, { htmlFor: "current-password", children: "Current password" }), _jsx(Input, { id: "current-password", type: "password", autoComplete: "current-password", value: currentPassword, onChange: event => setCurrentPassword(event.target.value), required: true, disabled: busy })] }), _jsxs("div", { className: "form-field", children: [_jsx(Label, { htmlFor: "new-password", children: "New password" }), _jsx(Input, { id: "new-password", type: "password", autoComplete: "new-password", value: newPassword, onChange: event => setNewPassword(event.target.value), required: true, minLength: 12, maxLength: 128, disabled: busy }), _jsx("p", { className: "field-hint", children: "Use at least 12 characters." })] }), _jsxs("div", { className: "form-field", children: [_jsx(Label, { htmlFor: "confirm-password", children: "Confirm new password" }), _jsx(Input, { id: "confirm-password", type: "password", autoComplete: "new-password", value: confirm, onChange: event => setConfirm(event.target.value), required: true, disabled: busy })] }), _jsx("p", { className: "field-hint", children: "Changing your password signs out all sessions, including this one." }), _jsx(Button, { type: "submit", variant: "outline", disabled: busy, children: "Change password" })] })] }), notice && _jsx("p", { className: "success-notice", role: "status", children: notice }), error && _jsxs("div", { children: [_jsx("p", { className: "form-error", role: "alert", children: error }), _jsx(Button, { variant: "outline", onClick: reloadProfile, disabled: busy, children: "Review latest profile" })] })] });
}
export function AccountManagement({ currentUser, onSaved }) {
    if (!getRolePermissions(currentUser.role).manageAccounts) {
        return _jsxs("section", { className: "inventory-panel account-card", children: [_jsx("h2", { children: "Account administration" }), _jsx("p", { children: "Only administrators can manage staff accounts. Open My account to update your own profile or password." })] });
    }
    return _jsx(AccountManagementContent, { currentUser: currentUser, onSaved: onSaved }, currentUser.id);
}
function AccountManagementContent({ currentUser, onSaved }) {
    const [accounts, setAccounts] = useState([]), [events, setEvents] = useState([]), [search, setSearch] = useState(""), [error, setError] = useState(""), [loading, setLoading] = useState(true);
    const [draft, setDraft] = useState(null), [revision, setRevision] = useState(0);
    const [received, setReceived] = useState(false);
    const downloadReviewKey = JSON.stringify({ actor: currentUser.id, search });
    const download = useDownloadFeedback(downloadReviewKey);
    useEffect(() => {
        const abort = new AbortController();
        let active = true, timedOut = false;
        const timer = window.setTimeout(() => { timedOut = true; abort.abort(); }, 30_000);
        fetch("/api/accounts", { cache: "no-store", signal: abort.signal }).then(async (response) => {
            if (response.status === 401)
                reloadSessionPage("/signin");
            const body = await response.json();
            if (!response.ok)
                throw new Error(body.error || "Staff accounts could not be loaded. Refresh accounts to try again.");
            if (!Array.isArray(body.accounts) || !Array.isArray(body.events))
                throw new Error("The staff account response was incomplete. Refresh accounts to try again.");
            if (abort.signal.aborted)
                throw new Error("The staff account request was interrupted.");
            if (!active)
                return;
            setAccounts(body.accounts);
            setEvents(body.events);
            setReceived(true);
            setError("");
        }).catch(failure => {
            if (!active || abort.signal.aborted && !timedOut)
                return;
            setError(timedOut ? "Staff accounts are taking too long to respond. Check your connection, then refresh accounts." : failure instanceof TypeError || failure instanceof SyntaxError ? "Staff accounts could not be reached. Check your connection, then refresh accounts." : failure instanceof Error ? failure.message : "Staff accounts could not be loaded. Refresh accounts to try again.");
        }).finally(() => { window.clearTimeout(timer); if (active)
            setLoading(false); });
        return () => { active = false; window.clearTimeout(timer); abort.abort(); };
    }, [revision, currentUser.id]);
    function refreshAccounts() { setLoading(true); setError(""); setRevision(old => old + 1); }
    async function downloadReport() {
        await download.run(async () => {
            const response = await fetch(`/api/accounts?${new URLSearchParams({ download: "xlsx", search })}`, { cache: "no-store" });
            const attachment = await readDownloadAttachment(response, "xlsx", "staff-accounts-report.xlsx");
            const url = URL.createObjectURL(attachment.blob), link = document.createElement("a");
            try {
                link.href = url;
                link.download = attachment.filename;
                document.body.appendChild(link);
                link.click();
            }
            catch (error) {
                URL.revokeObjectURL(url);
                throw error;
            }
            finally {
                link.remove();
            }
            setTimeout(() => URL.revokeObjectURL(url), 60000);
        });
    }
    const matching = accounts.filter(account => `${account.username} ${account.displayName} ${account.email} ${account.role} ${account.active ? "active" : "disabled"}`.toLowerCase().includes(search.toLowerCase()));
    return _jsxs(_Fragment, { children: [_jsxs("section", { className: "inventory-panel", "aria-busy": loading, children: [_jsxs("div", { className: "panel-top", children: [_jsx("h2", { children: "Staff accounts" }), _jsxs("div", { className: "panel-actions", children: [_jsxs(Button, { variant: "outline", onClick: refreshAccounts, disabled: loading, children: [_jsx(RefreshCw, { size: 16 }), "Refresh accounts"] }), _jsxs(Button, { onClick: () => { if (!loading && !error)
                                            setDraft("new"); }, disabled: loading || !!error, children: [_jsx(Plus, { size: 16 }), "Create account"] })] })] }), _jsxs("div", { className: "table-toolbar", children: [_jsx(Input, { "aria-label": "Search staff accounts", placeholder: "Search name, username or role\u2026", value: search, onChange: event => setSearch(event.target.value) }), _jsx(Button, { variant: "ghost", onClick: () => setSearch(""), disabled: !search, children: "Clear filters" }), _jsxs(DownloadAction, { variant: "outline", disabled: loading || !!error || download.busy || !matching.length, onClick: downloadReport, pending: download.busy, completion: download.completion, reviewKey: downloadReviewKey, actionLabel: "Download Excel report", children: [_jsx(Download, { size: 16 }), "Download Excel report"] }), _jsx("span", { children: loading ? received ? "Refreshing accounts…" : "Loading accounts…" : error ? "Accounts unavailable" : `${matching.length} accounts` })] }), _jsx(MotionPresence, { children: download.error && _jsx("p", { className: "form-error", role: "alert", children: download.error }) }), error && _jsx("p", { className: "form-error", role: "alert", children: error }), loading && _jsx(LoadingState, { compact: true, label: received ? "Refreshing staff accounts" : "Loading staff accounts", detail: received ? "Your last received account list remains visible while it updates." : "Retrieving staff access and account activity." }), received && _jsxs(Table, { children: [_jsx(TableHeader, { children: _jsxs(TableRow, { children: [_jsx(TableHead, { children: "ACCOUNT" }), _jsx(TableHead, { children: "ROLE" }), _jsx(TableHead, { children: "STATUS" }), _jsx(TableHead, { children: "EMAIL" }), _jsx(TableHead, { children: "ACTIONS" })] }) }), _jsx(TableBody, { children: matching.map(account => _jsxs(TableRow, { children: [_jsxs(TableCell, { children: [_jsx("strong", { children: account.displayName }), _jsxs("span", { className: "cell-secondary", children: [account.username, account.id === currentUser.id ? " · You" : ""] })] }), _jsx(TableCell, { children: account.role === "admin" ? "Administrator" : "Staff" }), _jsx(TableCell, { children: account.active ? "Active" : "Disabled" }), _jsx(TableCell, { children: account.email || "Not recorded" }), _jsx(TableCell, { children: _jsxs(Button, { variant: "ghost", size: "sm", onClick: () => { if (!loading && !error)
                                                    setDraft(account); }, disabled: loading || !!error, "aria-label": `Manage ${account.username}`, children: [_jsx(Pencil, { size: 16 }), "Manage"] }) })] }, account.id)) })] }), _jsx("div", { className: "panel-footer", children: "Disabled accounts lose access immediately. Their historical actions remain traceable." })] }), received && _jsxs("section", { className: "inventory-panel account-audit", children: [_jsxs("div", { className: "section-heading", children: [_jsx("h2", { children: "Account activity" }), _jsxs("span", { children: ["Latest ", events.length, " events"] })] }), _jsxs(Table, { children: [_jsx(TableHeader, { children: _jsxs(TableRow, { children: [_jsx(TableHead, { children: "ACTION" }), _jsx(TableHead, { children: "ACCOUNT" }), _jsx(TableHead, { children: "ADMINISTRATOR / STAFF" }), _jsx(TableHead, { children: "RECORDED AT" })] }) }), _jsx(TableBody, { children: events.map(event => _jsxs(TableRow, { children: [_jsx(TableCell, { children: event.action.replaceAll("_", " ") }), _jsx(TableCell, { children: accounts.find(account => account.id === event.targetId)?.username ?? event.targetId }), _jsx(TableCell, { children: event.actorName }), _jsx(TableCell, { children: formatTime(event.at) })] }, event.id)) })] })] }), draft && _jsx(AccountEditor, { account: draft === "new" ? null : draft, onClose: () => setDraft(null), onSaved: async () => { refreshAccounts(); await onSaved().catch(() => setError("The account was saved, but the inventory could not refresh. Refresh before making another change.")); } }, draft === "new" ? "new" : `${draft.id}-${draft.version}`)] });
}
function AccountEditor({ account, onClose, onSaved }) {
    const [baseline, setBaseline] = useState(account), [expectedVersion, setExpectedVersion] = useState(account?.version);
    const [notice, setNotice] = useState("");
    const [username, setUsername] = useState(account?.username ?? ""), [name, setName] = useState(account?.displayName ?? ""), [email, setEmail] = useState(account?.email ?? ""), [role, setRole] = useState(account?.role ?? "staff"), [active, setActive] = useState(account?.active ?? true), [password, setPassword] = useState("");
    const [busy, setBusy] = useState(false), [error, setError] = useState("");
    async function save(event) {
        event.preventDefault();
        setBusy(true);
        setError("");
        setNotice("");
        try {
            await accountRequest(account ? "update" : "create", { ...(account ? { id: account.id, expectedVersion, active } : { username }), displayName: name, email, role, defaultDataset: baseline?.defaultDataset ?? "demo", ...(password ? { password } : {}) });
            await onSaved();
            onClose();
        }
        catch (error) {
            setError(error.message);
        }
        finally {
            setBusy(false);
        }
    }
    async function reloadAccount() {
        if (!account || !baseline)
            return;
        setBusy(true);
        try {
            const response = await fetch("/api/accounts", { cache: "no-store" });
            const body = await response.json();
            if (!response.ok)
                throw new Error(body.error);
            const latest = body.accounts.find(item => item.id === account.id);
            if (!latest)
                throw new Error("Account not found.");
            if (name === baseline.displayName)
                setName(latest.displayName);
            if (email === baseline.email)
                setEmail(latest.email);
            if (role === baseline.role)
                setRole(latest.role);
            if (active === baseline.active)
                setActive(latest.active);
            setBaseline(latest);
            setExpectedVersion(latest.version);
            setError("");
            setNotice("Latest account loaded. Your edited fields were kept; review them before saving.");
        }
        catch (error) {
            setError(error.message);
        }
        finally {
            setBusy(false);
        }
    }
    return _jsx(Dialog, { open: true, onOpenChange: open => !open && !busy && onClose(), children: _jsxs(DialogContent, { children: [_jsxs(DialogHeader, { children: [_jsx(DialogTitle, { children: account ? `Manage ${account.username}` : "Create staff account" }), _jsx(DialogDescription, { children: account ? "Changes to access or passwords sign out this account's existing sessions." : "Provide these credentials directly to the staff member. There is no student sign-up." })] }), _jsxs("form", { className: "form-stack", onSubmit: save, children: [!account && _jsxs("div", { className: "form-field", children: [_jsx(Label, { htmlFor: "account-username", children: "Username" }), _jsx(Input, { id: "account-username", value: username, onChange: event => setUsername(event.target.value), minLength: 2, maxLength: 64, required: true, disabled: busy })] }), _jsxs("div", { className: "form-field", children: [_jsx(Label, { htmlFor: "account-name", children: "Display name" }), _jsx(Input, { id: "account-name", value: name, onChange: event => setName(event.target.value), minLength: 2, maxLength: 120, required: true, disabled: busy })] }), _jsxs("div", { className: "form-field", children: [_jsx(Label, { htmlFor: "account-email", children: "Email \u2014 optional" }), _jsx(Input, { id: "account-email", type: "email", value: email, onChange: event => setEmail(event.target.value), disabled: busy })] }), _jsxs("div", { className: "form-field", children: [_jsx(Label, { children: "Role" }), _jsxs(Select, { value: role, onValueChange: value => setRole(value), disabled: busy, children: [_jsx(SelectTrigger, { "aria-label": "Staff account role", children: _jsx(SelectValue, {}) }), _jsxs(SelectContent, { children: [_jsx(SelectItem, { value: "staff", children: "Staff" }), _jsx(SelectItem, { value: "admin", children: "Administrator" })] })] })] }), account && _jsxs("div", { className: "form-field", children: [_jsx(Label, { children: "Access" }), _jsxs(Select, { value: active ? "active" : "disabled", onValueChange: value => setActive(value === "active"), disabled: busy, children: [_jsx(SelectTrigger, { "aria-label": "Staff account access", children: _jsx(SelectValue, {}) }), _jsxs(SelectContent, { children: [_jsx(SelectItem, { value: "active", children: "Active" }), _jsx(SelectItem, { value: "disabled", children: "Disabled" })] })] })] }), _jsxs("div", { className: "form-field", children: [_jsx(Label, { htmlFor: "account-password", children: account ? "Reset password — optional" : "Initial password" }), _jsx(Input, { id: "account-password", type: "password", autoComplete: "new-password", value: password, onChange: event => setPassword(event.target.value), minLength: 12, maxLength: 128, required: !account, disabled: busy }), _jsxs("p", { className: "field-hint", children: ["At least 12 characters.", account ? " Leave blank to keep the existing password." : ""] })] }), notice && _jsxs("div", { children: [_jsx("p", { className: "field-hint", role: "status", children: notice }), _jsxs("p", { className: "field-hint", children: ["Latest saved account: ", baseline?.displayName, " \u00B7 ", baseline?.email || "No email", " \u00B7 ", baseline?.role === "admin" ? "Administrator" : "Staff", " \u00B7 ", baseline?.active ? "Active" : "Disabled"] })] }), error && _jsxs("div", { children: [_jsx("p", { className: "form-error", role: "alert", children: error }), account && _jsx(Button, { type: "button", variant: "outline", onClick: reloadAccount, disabled: busy, children: "Review latest account" })] }), _jsxs(DialogFooter, { children: [_jsx(Button, { type: "button", variant: "outline", onClick: onClose, disabled: busy, children: "Cancel" }), _jsx(Button, { type: "submit", disabled: busy, children: busy ? "Saving…" : account ? "Save account" : "Create account" })] })] })] }) });
}
