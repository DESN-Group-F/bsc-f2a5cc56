"use client";

import { useEffect, useRef, useState } from "react";
import { Radio, ScanLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { teachingNfcBridge, validateTeachingNfcTag, type TeachingNfcProposal, type TeachingTagSource } from "@/lib/teaching-nfc";

export type TeachingNfcInputProps = {
    disabled?: boolean;
    onChooseTag: (tagId: string, source: TeachingTagSource) => void | Promise<void>;
    onBusyChange?: (busy: boolean) => void;
};

/** Acquisition only: the parent chooses an original slot and reviews the registered asset. */
export function TeachingNfcInput({ disabled = false, onChooseTag, onBusyChange }: TeachingNfcInputProps) {
    const [tag, setTag] = useState(""), [reading, setReading] = useState(false), [busy, setBusy] = useState(false);
    const [proposal, setProposal] = useState<TeachingNfcProposal | null>(null), [error, setError] = useState("");
    const [availability, setAvailability] = useState<{ available: boolean; enabled: boolean; reason?: string } | null>(null);
    const running = useRef(false), mounted = useRef(true), bridge = teachingNfcBridge();
    useEffect(() => {
        mounted.current = true;
        if (bridge) void bridge.getAvailability().then(value => { if (mounted.current) setAvailability(value); }).catch(reason => { if (mounted.current) setError(reason instanceof Error ? reason.message : "NFC availability could not be checked."); });
        return () => { mounted.current = false; if (running.current && bridge) void bridge.cancel().catch(() => {}); };
    }, [bridge]);
    useEffect(() => { onBusyChange?.(reading || busy); return () => onBusyChange?.(false); }, [reading, busy, onBusyChange]);
    async function read() {
        if (disabled || running.current || !bridge || !availability?.available || !availability.enabled) return;
        running.current = true; onBusyChange?.(true); setReading(true); setProposal(null); setError("");
        try { const result = await bridge.read(); if (mounted.current) setProposal(result); }
        catch (reason) { if (mounted.current) setError(reason instanceof Error ? reason.message : "The NFC read failed. No alternative was selected."); }
        finally { running.current = false; if (mounted.current) setReading(false); onBusyChange?.(false); }
    }
    async function choose(native: boolean) {
        if (disabled || busy || reading) return;
        onBusyChange?.(true); setBusy(true); setError("");
        try {
            if (native) {
                if (!bridge || !proposal) throw new Error("Read and explicitly adopt an NFC identifier first.");
                const evidence = validateTeachingNfcTag(await bridge.adopt(proposal), proposal.tagId);
                await onChooseTag(evidence.tagId, { kind: "native_nfc", evidence });
                setProposal(null);
            } else {
                if (!tag || tag.trim() !== tag || tag.length > 128) throw new Error("Enter the exact registered tag, without surrounding spaces, using at most 128 characters.");
                await onChooseTag(tag, { kind: "tag" }); setTag("");
            }
        } catch (reason) { setError(reason instanceof Error ? reason.message : "The registered tag could not be selected."); }
        finally { setBusy(false); onBusyChange?.(false); }
    }
    const locked = disabled || busy || reading;
    return <section className="detail-card teaching-nfc-input" aria-label="Registered tag alternative input" aria-busy={busy || reading}>
        <Label htmlFor="teaching-alternative-tag">Registered tag identifier</Label>
        <div className="inline-input"><Input id="teaching-alternative-tag" value={tag} onChange={event => setTag(event.target.value)} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); void choose(false); } }} maxLength={128} disabled={locked} placeholder="Enter the exact registered tag"/><Button type="button" onClick={() => choose(false)} disabled={locked || !tag}><ScanLine size={16}/>Find registered tag</Button></div>
        <p className="field-hint">Tag input only locates an existing battery. Choose the original group member to replace, review differences, then confirm the checkout. It is recorded as manual tag input.</p>
        <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" onClick={read} disabled={locked || !availability?.available || !availability.enabled}><Radio size={16}/>{reading ? "Reading NFC…" : "Read NFC tag"}</Button>{reading && bridge && <Button type="button" variant="outline" onClick={() => bridge.cancel().catch(reason => setError(reason instanceof Error ? reason.message : "NFC cancellation failed."))}>Cancel NFC read</Button>}</div>
        {!bridge ? <p className="field-hint">Native NFC is unavailable in this browser. Use the filtered inventory or exact registered tag input.</p> : availability && (!availability.available || !availability.enabled) && <p className="field-hint">{availability.reason || "Native NFC is unavailable or disabled on this device."}</p>}
        {proposal && <div className="history-entry"><strong>{proposal.tagId}</strong><p className="field-hint">Device read: {proposal.platform} · {proposal.result.technology} · {proposal.result.observedAt}. Raw UID and NDEF evidence are saved separately. This read has not selected or borrowed a battery.</p><details><summary>Device read evidence</summary><pre className="max-w-full whitespace-pre-wrap break-all text-xs">{JSON.stringify(proposal, null, 2)}</pre></details><div className="flex flex-wrap gap-2"><Button type="button" disabled={locked} onClick={() => choose(true)}>Use identifier as manual alternative input</Button><Button type="button" variant="outline" disabled={locked} onClick={() => setProposal(null)}>Discard identifier proposal</Button></div></div>}
        <p className="field-hint">One input source per review list. A source change must be explicit and must retain any already reviewed alternatives or require a separate list.</p>
        {error && <p role="alert" className="form-error">{error}</p>}
    </section>;
}
