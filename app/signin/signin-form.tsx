"use client";

import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { ArrowRight, Battery, Check, LoaderCircle, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { reloadSessionPage } from "@/lib/client-utils";
import { safeReturnPath } from "@/lib/return-path";

type Phase = "checking" | "ready" | "submitting" | "opening" | "unavailable" | "unconfirmed";
type Field = "key" | "name" | "username" | "password";
type FieldErrors = Partial<Record<Field, string>>;
const requestTimeout = 30_000;

class SignInError extends Error {
  constructor(message: string, readonly checkAccess = false) { super(message); }
}

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
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [slow, setSlow] = useState(false);
  const submitting = useRef(false);
  const mounted = useRef(true);
  const submitController = useRef<AbortController | null>(null);
  const usernameInput = useRef<HTMLInputElement>(null);
  const passwordInput = useRef<HTMLInputElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const keyInput = useRef<HTMLInputElement>(null);
  const busy = phase === "submitting" || phase === "opening";
  const loaded = phase === "ready" || busy;

  function openWorkspace() {
    // Only a server-confirmed session enters this state. Navigate immediately.
    flushSync(() => { setSlow(false); setPhase("opening"); });
    reloadSessionPage(safeReturnPath(new URLSearchParams(window.location.search).get("return_to")));
  }

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; submitController.current?.abort(); };
  }, []);

  useEffect(() => {
    if (phase !== "checking" && phase !== "submitting" && phase !== "opening") return;
    const timer = setTimeout(() => setSlow(true), 8_000);
    return () => clearTimeout(timer);
  }, [phase, checkVersion]);

  useEffect(() => {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, requestTimeout);
    fetch("/api/session", { cache: "no-store", signal: controller.signal }).then(async response => {
      const body = await response.json() as { error?: string; user?: object; setupRequired: boolean };
      if (!response.ok) throw new Error(body.error || "Unable to check staff access. Try again.");
      if (controller.signal.aborted) throw new Error("The access check was interrupted.");
      if (body.user) { openWorkspace(); return; }
      if (typeof body.setupRequired !== "boolean") throw new Error("The server could not confirm staff access. Try again.");
      setSetup(body.setupRequired);
      setSlow(false);
      setPhase("ready");
    }).catch(failure => {
      if (controller.signal.aborted && !timedOut) return;
      if (!mounted.current) return;
      setError(timedOut ? "The access check timed out. Check your connection and try again." : failure instanceof TypeError || failure instanceof SyntaxError ? "Unable to reach staff access. Check your connection and try again." : failure instanceof Error ? failure.message : "Unable to check staff access. Try again.");
      setSlow(false);
      setPhase("unavailable");
    }).finally(() => clearTimeout(timer));
    return () => { clearTimeout(timer); controller.abort(); };
  }, [checkVersion]);

  function clearFieldError(field: Field) {
    setFieldErrors(previous => ({ ...previous, [field]: undefined }));
  }

  function checkAccess() {
    setError(""); setSlow(false); setFieldErrors({}); setPhase("checking"); setCheckVersion(value => value + 1);
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current || phase !== "ready") return;
    const form = new FormData(event.currentTarget);
    const values = {
      key: String(form.get("setupKey") ?? key), name: String(form.get("displayName") ?? name),
      username: String(form.get("username") ?? username).trim(), password: String(form.get("password") ?? password),
    };
    const invalid: FieldErrors = {};
    if (setup && !values.key.trim()) invalid.key = "Enter the installation setup key.";
    if (setup && values.name.trim().length < 2) invalid.name = "Enter a display name with at least 2 characters.";
    if (setup && values.name.trim().length > 120) invalid.name = "Use no more than 120 characters for the display name.";
    if (!values.username) invalid.username = "Enter your username.";
    else if (values.username.length < 2 || values.username.length > 64 || !/^[a-z0-9][a-z0-9._-]+$/i.test(values.username)) invalid.username = "Use 2–64 letters, numbers, dots, underscores or hyphens, starting with a letter or number.";
    if (!values.password) invalid.password = "Enter your password.";
    else if (setup && values.password.length < 12) invalid.password = "Use a password with at least 12 characters.";
    else if (values.password.length > 128) invalid.password = "Use no more than 128 characters for the password.";
    setFieldErrors(invalid);
    setError(""); setNotice("");
    setUsername(values.username); setPassword(values.password); setName(values.name); setKey(values.key);
    if (Object.keys(invalid).length) {
      const first = (["key", "name", "username", "password"] as const).find(field => invalid[field]);
      if (first) ({ key: keyInput, name: nameInput, username: usernameInput, password: passwordInput })[first].current?.focus();
      return;
    }
    submitting.current = true;
    const controller = new AbortController();
    submitController.current = controller;
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, requestTimeout);
    setSlow(false);
    setPhase("submitting");
    try {
      const response = await fetch("/api/session", {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
        body: JSON.stringify({ action: setup ? "setup" : "signin", ...(setup ? { setupKey: values.key } : {}), payload: { username: values.username, password: values.password, ...(setup ? { displayName: values.name, email: "", role: "admin" } : {}) } }),
      });
      const body = await response.json() as { error?: string; user?: object };
      if (!mounted.current) return;
      if (controller.signal.aborted) throw new SignInError("The request was interrupted before access could be confirmed. Check access before trying again.", true);
      if (!response.ok) throw new SignInError(body.error || "Sign-in failed. Try again.", response.status >= 500);
      if (setup) {
        setSetup(false); setKey("");
        setNotice("Administrator created. Sign in with your new account.");
        setSlow(false); setPhase("ready"); return;
      }
      if (!body.user) throw new SignInError("Staff access could not be confirmed. Check access before trying again.", true);
      openWorkspace();
    } catch (failure) {
      if (!mounted.current) return;
      const uncertain = !(failure instanceof SignInError) || failure.checkAccess;
      setError(timedOut ? "The request timed out before access could be confirmed. Check access before trying again." : failure instanceof SignInError ? failure.message : "The connection was interrupted before access could be confirmed. Check access before trying again.");
      setSlow(false); setPhase(uncertain ? "unconfirmed" : "ready");
      if (!uncertain) requestAnimationFrame(() => passwordInput.current?.focus());
    } finally { clearTimeout(timer); submitting.current = false; submitController.current = null; }
  }

  const status = phase === "checking" ? "Checking staff access…"
    : phase === "submitting" ? setup ? "Creating administrator…" : "Signing in…"
    : phase === "opening" ? "Signed in. Opening your workspace…" : "";
  const slowMessage = phase === "opening" ? "Your account is confirmed. The workspace is still opening."
    : phase === "checking" ? "The server is taking a little longer to respond. Your access check is still running."
    : "The server is still responding. Keep this page open; your request will not be sent twice.";
  const describe = (field: Field) => [fieldErrors[field] ? `signin-${field}-error` : "", error ? "signin-error" : "", field === "password" && setup ? "signin-password-hint" : ""].filter(Boolean).join(" ") || undefined;

  return (
    <main className="signin-page" data-phase={phase} lang="en">
      <aside className="signin-identity" aria-label="Battery workspace">
        <header className="signin-masthead">
          <span className="brand-mark" aria-hidden="true"><Battery size={26} strokeWidth={1.7} /></span>
          <div><span className="signin-wordmark">Battery</span><p className="signin-institution">Faculty of Engineering</p></div>
        </header>
        <div className="signin-context">
          <p className="signin-context-label">Staff workspace</p>
          <p className="signin-context-title">Battery inventory</p>
          <div className="signin-workspace-preview" aria-hidden="true">
            <div className="signin-preview-ground" />
            <div className="signin-preview-cell signin-preview-cell-back"><Battery strokeWidth={1.2} /></div>
            <div className="signin-preview-cell signin-preview-cell-middle"><Battery strokeWidth={1.2} /></div>
            <div className="signin-preview-cell signin-preview-cell-front"><Battery strokeWidth={1.2} /></div>
          </div>
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
          <form onSubmit={submit} className="form-stack" noValidate aria-busy={busy || phase === "checking"}>
            {setup && <>
              <div className="form-field"><Label htmlFor="setup-key">Installation setup key</Label><Input ref={keyInput} id="setup-key" name="setupKey" type="password" autoComplete="off" value={key} onChange={event => { setKey(event.target.value); clearFieldError("key"); }} required readOnly={busy} disabled={!loaded} aria-invalid={!!fieldErrors.key} aria-describedby={describe("key")} />{fieldErrors.key && <p className="signin-field-error" id="signin-key-error" role="alert">{fieldErrors.key}</p>}</div>
              <div className="form-field"><Label htmlFor="setup-name">Display name</Label><Input ref={nameInput} id="setup-name" name="displayName" autoComplete="name" value={name} onChange={event => { setName(event.target.value); clearFieldError("name"); }} required minLength={2} maxLength={120} readOnly={busy} disabled={!loaded} aria-invalid={!!fieldErrors.name} aria-describedby={describe("name")} />{fieldErrors.name && <p className="signin-field-error" id="signin-name-error" role="alert">{fieldErrors.name}</p>}</div>
            </>}
            <div className="form-field">
              <Label htmlFor="signin-username">Username</Label>
              <Input ref={usernameInput} id="signin-username" name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} value={username} onChange={event => { setUsername(event.target.value); clearFieldError("username"); }} required maxLength={64} readOnly={busy} disabled={!loaded} aria-invalid={!!fieldErrors.username} aria-describedby={describe("username")} />
              {fieldErrors.username && <p className="signin-field-error" id="signin-username-error" role="alert">{fieldErrors.username}</p>}
            </div>
            <div className="form-field">
              <Label htmlFor="signin-password">Password</Label>
              <Input ref={passwordInput} id="signin-password" name="password" type="password" autoComplete={setup ? "new-password" : "current-password"} value={password} onChange={event => { setPassword(event.target.value); clearFieldError("password"); }} required minLength={setup ? 12 : undefined} maxLength={128} readOnly={busy} disabled={!loaded} aria-invalid={!!fieldErrors.password} aria-describedby={describe("password")} />
              {setup && <p className="signin-field-hint" id="signin-password-hint">Use at least 12 characters.</p>}
              {fieldErrors.password && <p className="signin-field-error" id="signin-password-error" role="alert">{fieldErrors.password}</p>}
            </div>
            {notice && <p className="signin-notice" role="status"><Check size={18} aria-hidden="true" />{notice}</p>}
            {error && <div className="signin-error" id="signin-error" role="alert"><p>{error}</p>{(phase === "unavailable" || phase === "unconfirmed") && <Button type="button" variant="outline" onClick={checkAccess}>{phase === "unconfirmed" ? "Check access" : "Try again"}</Button>}</div>}
            <Button className="signin-submit" type="submit" disabled={busy || !loaded}>
              <span>{phase === "opening" ? "Opening workspace" : phase === "submitting" ? setup ? "Creating administrator" : "Signing in" : phase === "checking" ? "Checking access" : setup ? "Create administrator" : "Sign in"}</span>
              {phase === "opening" ? <Check aria-hidden="true" /> : busy || phase === "checking" ? <LoaderCircle className="signin-spinner" aria-hidden="true" /> : <ArrowRight aria-hidden="true" />}
            </Button>
          </form>
          <div className="signin-status" role="status" aria-live="polite" aria-atomic="true" data-active={!!status}>
            <p>{status || "Ready when you are."}</p>
            {slow && status && <p className="signin-slow-message">{slowMessage}</p>}
          </div>
          <div className="signin-note"><ShieldCheck size={17} aria-hidden="true" /><span>Staff access only. Use the account provided by your administrator.</span></div>
        </section>
      </div>
      <footer className="signin-footer"><span>DESN2000</span><span>Battery inventory prototype</span></footer>
    </main>
  );
}
