"use client";
import { useEffect, useState } from "react";
import { Battery, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { reloadSessionPage } from "@/lib/client-utils";
import { safeReturnPath } from "@/lib/return-path";

export default function SignInForm() {
    const [setup, setSetup] = useState(false), [loaded, setLoaded] = useState(false), [username, setUsername] = useState(""), [password, setPassword] = useState("");
    const [name, setName] = useState(""), [key, setKey] = useState(""), [error, setError] = useState(""), [notice, setNotice] = useState(""), [busy, setBusy] = useState(false);
    useEffect(() => {
        fetch("/api/session", { cache: "no-store" }).then(async response => {
            const body = await response.json() as { error?: string; user?: object; setupRequired: boolean };
            if (!response.ok) throw new Error(body.error);
            if (body.user) { reloadSessionPage("/"); return; }
            setSetup(body.setupRequired); setLoaded(true);
        }).catch(error => { setError(error.message); });
    }, []);
    async function submit(event: React.FormEvent) {
        event.preventDefault(); setBusy(true); setError("");
        try {
            const response = await fetch("/api/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: setup ? "setup" : "signin", ...(setup ? { setupKey: key } : {}), payload: { username, password, ...(setup ? { displayName: name, email: "", role: "admin" } : {}) } }) });
            const body = await response.json() as { error?: string; user?: object; setupRequired: boolean };
            if (!response.ok) throw new Error(body.error || "Sign-in failed.");
            if (setup) { setSetup(false); setKey(""); setNotice("Administrator created. Sign in with your new account."); return; }
            const returnTo = new URLSearchParams(window.location.search).get("return_to");
            reloadSessionPage(safeReturnPath(returnTo));
        } catch (error) { setError((error as Error).message); }
        finally { setBusy(false); }
    }
    return <main className="signin-page"><section className="signin-card"><div className="signin-brand"><span className="brand-mark"><Battery size={28}/></span><div><strong>Battery Inventory</strong><span>Staff workspace</span></div></div><h1>{setup ? "Set up the administrator" : "Staff sign in"}</h1><p>{setup ? "Use the installation setup key to create the first administrator." : "Use the account provided by your administrator."}</p><form onSubmit={submit} className="form-stack">
        {setup && <><div className="form-field"><Label htmlFor="setup-key">Installation setup key</Label><Input id="setup-key" type="password" autoComplete="off" value={key} onChange={event => setKey(event.target.value)} required disabled={busy}/></div><div className="form-field"><Label htmlFor="setup-name">Display name</Label><Input id="setup-name" value={name} onChange={event => setName(event.target.value)} required minLength={2} disabled={busy}/></div></>}
        <div className="form-field"><Label htmlFor="signin-username">Username</Label><Input id="signin-username" autoComplete="username" value={username} onChange={event => setUsername(event.target.value)} required disabled={busy || !loaded}/></div>
        <div className="form-field"><Label htmlFor="signin-password">Password</Label><Input id="signin-password" type="password" autoComplete={setup ? "new-password" : "current-password"} value={password} onChange={event => setPassword(event.target.value)} required minLength={setup ? 12 : undefined} disabled={busy || !loaded}/></div>
        {notice && <p className="field-hint" role="status">{notice}</p>}{error && <p className="form-error" role="alert">{error}</p>}<Button type="submit" disabled={busy || !loaded}>{busy ? "Please wait…" : setup ? "Create administrator" : "Sign in"}</Button>
    </form><div className="signin-note"><ShieldCheck size={16}/><span>Staff access only. Accounts are created and managed by administrators.</span></div></section></main>;
}
