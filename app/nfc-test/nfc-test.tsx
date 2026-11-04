"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Battery, Search, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  checkNfcHandoffSession, lookupDemoNfcTag, nfcHandoffSignInPath,
  NfcHandoffError, type NfcHandoff, type NfcLookup,
} from "@/lib/nfc-handoff";
import styles from "./nfc-test.module.css";

export default function NfcTest({ initialHandoff: handoff }: { initialHandoff: NfcHandoff }) {
  const [tagId, setTagId] = useState(handoff.tagId);
  const [session, setSession] = useState<{ displayName: string } | null>(null);
  const [checkingAccess, setCheckingAccess] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(handoff.error);
  const [result, setResult] = useState<NfcLookup | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    checkNfcHandoffSession(fetch, controller.signal)
      .then(setSession)
      .catch(cause => { if (!controller.signal.aborted && !handoff.blocked) setError(cause instanceof Error ? cause.message : "Staff access could not be checked. Try again."); })
      .finally(() => { if (!controller.signal.aborted) setCheckingAccess(false); });
    return () => controller.abort();
  }, [handoff.blocked]);

  async function lookup(event: React.FormEvent) {
    event.preventDefault();
    if (handoff.blocked || busy) return;
    setBusy(true); setError(""); setResult(null);
    try {
      setResult(await lookupDemoNfcTag(tagId));
    } catch (cause) {
      if (cause instanceof NfcHandoffError && cause.kind === "authentication") setSession(null);
      setError(cause instanceof Error ? cause.message : "The lookup failed. Try again.");
    } finally { setBusy(false); }
  }

  return (
    <main className={styles.page}>
      <section className={styles.card} aria-labelledby="nfc-test-title">
        <div className={styles.brand}><span className="brand-mark"><Battery size={26} aria-hidden="true" /></span><div><strong>Battery</strong><span>NFC test station</span></div></div>
        <span className={styles.badge}>Demonstration inventory · Read only</span>
        <h1 id="nfc-test-title">Check an identifier</h1>
        <p className={styles.intro}>Look up one identifier before connecting NFC reads to battery operations.</p>
        <div className={styles.notice}>
          <ShieldCheck size={19} aria-hidden="true" />
          <p>{handoff.suppliedByLink ? "Device read supplied by link; physical read not verified by server." : "An entered identifier does not prove that a physical tag was read."} A lookup does not register a battery, confirm its location or change a loan.</p>
        </div>
        <div className={styles.access} aria-live="polite">
          {checkingAccess ? <p>Checking staff access…</p> : session ? <p>Signed in as <strong>{session.displayName}</strong>.</p> : <p>Staff sign-in is required for inventory results. <Link href={nfcHandoffSignInPath(tagId)} prefetch={false}>Sign in</Link></p>}
        </div>
        {handoff.blocked ? <Link className={styles.cleanLink} href="/nfc-test" prefetch={false}>Open a clean test page</Link> : (
          <form className={styles.form} onSubmit={lookup} aria-busy={busy}>
            <Label htmlFor="nfc-test-tag">Tag identifier</Label>
            <Input id="nfc-test-tag" value={tagId} onChange={event => { setTagId(event.target.value); setResult(null); setError(""); }} maxLength={128} autoComplete="off" autoCapitalize="none" spellCheck={false} placeholder="nfc:uid:04AABBCCDDEEFF" disabled={busy} aria-describedby="nfc-test-tag-help" />
            <p id="nfc-test-tag-help" className={styles.hint}>A device UID uses the nfc:uid: prefix. You may also enter an existing demonstration tag identifier manually.</p>
            <Button type="submit" disabled={busy || checkingAccess || !tagId.trim()}><Search size={17} aria-hidden="true" />{busy ? "Looking up…" : "Look up identifier"}</Button>
          </form>
        )}
        {error && <p className={styles.error} role="alert">{error}</p>}
        {result && <section className={styles.result} aria-live="polite" aria-labelledby="nfc-test-result-title">
          <h2 id="nfc-test-result-title">{result.battery ? "Identifier matched" : "Identifier not registered"}</h2>
          <p className={styles.identifier}>{result.tagId}</p>
          {result.battery ? <dl><div><dt>Battery ID</dt><dd>{result.battery.id}</dd></div><div><dt>Name</dt><dd>{result.battery.name}</dd></div><div><dt>Recorded status</dt><dd>{result.battery.status}</dd></div></dl> : <p>No battery has this identifier in the demonstration inventory. Nothing was registered automatically.</p>}
          <p className={styles.hint}>This result confirms an identifier lookup only. Physical read reliability and compatibility still require device testing.</p>
        </section>}
        <footer className={styles.footer}><Link href="/" prefetch={false}>Open inventory workspace</Link><span>No checkout or return controls are enabled here.</span></footer>
      </section>
    </main>
  );
}
