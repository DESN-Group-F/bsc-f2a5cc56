"use client";

import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { ArrowRight, Battery, Check, LoaderCircle, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { reloadSessionPage } from "@/lib/client-utils";
import { safeReturnPath } from "@/lib/return-path";

type Phase = "checking" | "ready" | "submitting" | "opening" | "unavailable";

export default function SignInForm() {
  const [setup, setSetup] = useState(false);
  const [phase, setPhase] = useState<Phase>("checking");
  const [checkVersion, setCheckVersion] = useState(0);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const submitting = useRef(false);
  const passwordInput = useRef<HTMLInputElement>(null);
  const busy = phase === "submitting" || phase === "opening";
  const loaded = phase === "ready" || busy;

  function openWorkspace() {
    // Only a server-confirmed session enters this state. Navigate immediately.
    flushSync(() => setPhase("opening"));
    reloadSessionPage(safeReturnPath(new URLSearchParams(window.location.search).get("return_to")));
  }

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/session", { cache: "no-store", signal: controller.signal }).then(async response => {
      const body = await response.json() as { error?: string; user?: object; setupRequired: boolean };
      if (!response.ok) throw new Error(body.error || "Unable to check staff access. Try again.");
      if (controller.signal.aborted) return;
      if (body.user) { openWorkspace(); return; }
      setSetup(body.setupRequired);
      setPhase("ready");
    }).catch(failure => {
      if (controller.signal.aborted) return;
      setError(failure instanceof Error ? failure.message : "Unable to check staff access. Try again.");
      setPhase("unavailable");
    });
    return () => controller.abort();
  }, [checkVersion]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting.current || phase !== "ready") return;
    submitting.current = true;
    setPhase("submitting");
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/session", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: setup ? "setup" : "signin", ...(setup ? { setupKey: key } : {}), payload: { username, password, ...(setup ? { displayName: name, email: "", role: "admin" } : {}) } }),
      });
      const body = await response.json() as { error?: string; user?: object };
      if (!response.ok) throw new Error(body.error || "Sign-in failed. Try again.");
      if (setup) {
        setSetup(false); setKey("");
        setNotice("Administrator created. Sign in with your new account.");
        setPhase("ready"); return;
      }
      if (!body.user) throw new Error("Staff access could not be confirmed. Try signing in again.");
      openWorkspace();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Sign-in failed. Try again.");
      setPhase("ready");
      requestAnimationFrame(() => passwordInput.current?.focus());
    } finally { submitting.current = false; }
  }

  const status = phase === "checking" ? "Checking staff access…"
    : phase === "submitting" ? setup ? "Creating administrator…" : "Signing in…"
    : phase === "opening" ? "Signed in. Opening your workspace…" : "";

  return (
    <main className="signin-page" data-phase={phase}>
      <aside className="signin-identity" aria-label="Battery workspace">
        <header className="signin-masthead">
          <span className="brand-mark" aria-hidden="true"><Battery size={26} strokeWidth={1.7} /></span>
          <div><span className="signin-wordmark">Battery</span><p className="signin-institution">Faculty of Engineering</p></div>
        </header>
        <div className="signin-context">
          <p className="signin-context-label">Staff workspace</p>
          <p className="signin-context-title">Battery inventory</p>
          <ol className="signin-workflow" aria-label="Battery workflow">
            <li>Register</li>
            <li>Check out</li>
            <li>Return</li>
            <li>Trace</li>
          </ol>
        </div>
      </aside>
      <div className="signin-access">
        <section className="signin-form-region" aria-labelledby="signin-title">
          <header className="signin-heading">
            <h1 id="signin-title">{setup ? "Set up your workspace" : "Sign in"}</h1>
            <p className="signin-description">{setup ? "Create the first administrator with your installation setup key." : "Use your staff account to open the shared inventory."}</p>
          </header>
          <form onSubmit={submit} className="form-stack" aria-busy={busy || phase === "checking"}>
            {setup && <>
              <div className="form-field"><Label htmlFor="setup-key">Installation setup key</Label><Input id="setup-key" type="password" autoComplete="off" value={key} onChange={event => setKey(event.target.value)} required disabled={busy} /></div>
              <div className="form-field"><Label htmlFor="setup-name">Display name</Label><Input id="setup-name" autoComplete="name" value={name} onChange={event => setName(event.target.value)} required minLength={2} disabled={busy} /></div>
            </>}
            <div className="form-field">
              <Label htmlFor="signin-username">Username</Label>
              <Input id="signin-username" autoComplete="username" autoCapitalize="none" spellCheck={false} value={username} onChange={event => setUsername(event.target.value)} required disabled={busy || !loaded} aria-describedby={error ? "signin-error" : undefined} />
            </div>
            <div className="form-field">
              <Label htmlFor="signin-password">Password</Label>
              <Input ref={passwordInput} id="signin-password" type="password" autoComplete={setup ? "new-password" : "current-password"} value={password} onChange={event => setPassword(event.target.value)} required minLength={setup ? 12 : undefined} disabled={busy || !loaded} aria-describedby={error ? "signin-error" : undefined} />
            </div>
            {notice && <p className="signin-notice" role="status"><Check size={18} aria-hidden="true" />{notice}</p>}
            {error && <div className="signin-error" id="signin-error" role="alert"><p>{error}</p>{phase === "unavailable" && <Button type="button" variant="outline" onClick={() => { setError(""); setPhase("checking"); setCheckVersion(value => value + 1); }}>Try again</Button>}</div>}
            <Button className="signin-submit" type="submit" disabled={busy || !loaded}>
              <span>{phase === "opening" ? "Opening workspace" : phase === "submitting" ? setup ? "Creating administrator" : "Signing in" : phase === "checking" ? "Checking access" : setup ? "Create administrator" : "Sign in"}</span>
              {phase === "opening" ? <Check aria-hidden="true" /> : busy || phase === "checking" ? <LoaderCircle className="signin-spinner" aria-hidden="true" /> : <ArrowRight aria-hidden="true" />}
            </Button>
            <span className="sr-only" role="status" aria-live="polite">{status}</span>
          </form>
          <div className="signin-note"><ShieldCheck size={17} aria-hidden="true" /><span>Staff access only. Use the account provided by your administrator.</span></div>
        </section>
      </div>
      <footer className="signin-footer"><span>DESN2000</span><span>Battery inventory prototype</span></footer>
    </main>
  );
}
