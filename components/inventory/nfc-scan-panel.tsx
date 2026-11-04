"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Radio, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Dataset } from "@/lib/domain";
import { nativeNfcCapability } from "@/lib/native-nfc-capability";
import { teachingNfcBridge, validateTeachingNfcTag, type TeachingNfcBridge, type TeachingNfcEvidence, type TeachingNfcProposal } from "@/lib/teaching-nfc";
import { isEmbeddedPage, WebNfcError } from "@/lib/web-nfc";

export type NfcScanPanelProps = {
    dataset: Dataset;
    /** Stops a running scan and prevents a new one (for example while a request is unresolved). */
    disabled?: boolean;
    title?: string;
    /** What a read does in this workspace, shown before scanning starts. */
    hint: string;
    /** Called once per adopted read, in order; the next read waits until it settles. */
    onRead: (tagId: string, evidence: TeachingNfcEvidence) => void | Promise<void>;
    onListeningChange?: (listening: boolean) => void;
};
type Support = "checking" | "available" | "unsupported" | "embedded";

const subscribe = () => () => {};
function clientSupport(): Support {
    if (isEmbeddedPage()) return "embedded";
    return teachingNfcBridge() ? "available" : "unsupported";
}
const notEmbedded = () => !isEmbeddedPage();
/**
 * Whether this page offers NFC scanning at all: a demonstration feature, so only where NFC is
 * enabled for the inventory (Demonstration) and never inside an embedded page (the Teams tab).
 * A device that cannot scan still gets the offer, so the panel can say it is not supported.
 */
export function useNfcScanOffered(dataset: Dataset) {
    const topLevel = useSyncExternalStore(subscribe, notEmbedded, () => false);
    return topLevel && nativeNfcCapability(dataset).enabled;
}
function failureOf(reason: unknown): WebNfcError {
    if (reason instanceof WebNfcError) return reason;
    if (reason && typeof reason === "object" && "name" in reason && reason.name === "AbortError") return new WebNfcError("NFC scanning stopped.", "cancelled");
    return new WebNfcError(reason instanceof Error ? reason.message : "NFC scanning failed. Use manual entry, or try again.", "unavailable");
}
const pause = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds));
type Flag = { current: boolean };
/** Stops scanning without a synchronous state update, so effects and cleanups may call it. */
function haltScan(running: Flag, mounted: Flag, stopListening: { current: (() => void) | null }, listeningHandler: { current: ((listening: boolean) => void) | undefined }, setListening: (listening: boolean) => void) {
    if (!running.current) return;
    running.current = false;
    const stopper = stopListening.current;
    stopListening.current = null;
    if (!stopper) { void teachingNfcBridge()?.cancel().catch(() => {}); return; }
    // A pending read() settles and reports the end itself; a continuous session has nothing pending.
    stopper();
    setTimeout(() => { if (mounted.current) setListening(false); listeningHandler.current?.(false); });
}
/** A tag held against the phone may be reported again; a repeat within this window is ignored. */
const REPEAT_WINDOW_MS = 2000;
/** Reads waiting while the workspace handles an earlier one (continuous listening only). */
const MAX_WAITING_READS = 10;

/**
 * NFC scanning for a workspace: continuous reads while listening, each handed to the
 * workspace's own review list in order. Like Mapping, this is a demonstration feature: it
 * appears only where `useNfcScanOffered` allows it, never in Working inventory (manual entry
 * only) and never inside an embedded page (the Teams tab).
 */
export function NfcScanPanel({ dataset, disabled = false, title = "NFC scan (demonstration)", hint, onRead, onListeningChange }: NfcScanPanelProps) {
    const support = useSyncExternalStore(subscribe, clientSupport, () => "checking" as Support);
    const enabled = nativeNfcCapability(dataset).enabled;
    const [listening, setListening] = useState(false), [error, setError] = useState(""), [lastTag, setLastTag] = useState("");
    const running = useRef(false), mounted = useRef(true), disabledRef = useRef(disabled), handler = useRef(onRead), listeningHandler = useRef(onListeningChange);
    const recent = useRef<{ tagId: string; at: number } | null>(null), stopListening = useRef<(() => void) | null>(null);
    useEffect(() => { handler.current = onRead; listeningHandler.current = onListeningChange; disabledRef.current = disabled; });
    useEffect(() => {
        mounted.current = true;
        return () => { mounted.current = false; haltScan(running, mounted, stopListening, listeningHandler, setListening); };
    }, []);
    useEffect(() => { if (disabled) haltScan(running, mounted, stopListening, listeningHandler, setListening); }, [disabled]);
    function stillWanted() { return running.current && mounted.current && !disabledRef.current; }
    /** Adopts one proposal and hands it to the workspace. Returns false when scanning should end. */
    async function deliver(bridge: TeachingNfcBridge, proposal: TeachingNfcProposal) {
        let evidence: TeachingNfcEvidence;
        try { evidence = validateTeachingNfcTag(await bridge.adopt(proposal), proposal.tagId); }
        catch { if (mounted.current) setError("The tag read could not be confirmed. Hold the tag still and try again."); return true; }
        if (!stillWanted()) return false;
        const now = Date.now(), previous = recent.current;
        recent.current = { tagId: evidence.tagId, at: now };
        if (previous?.tagId === evidence.tagId && now - previous.at < REPEAT_WINDOW_MS) return true;
        if (mounted.current) { setError(""); setLastTag(evidence.tagId); }
        try { await handler.current(evidence.tagId, evidence); }
        catch (reason) { recent.current = null; if (mounted.current) setError(reason instanceof Error ? reason.message : "The read could not be added. Try again."); }
        return true;
    }
    function begin() {
        running.current = true; recent.current = null;
        setListening(true); setError(""); listeningHandler.current?.(true);
    }
    function end() {
        running.current = false; stopListening.current = null;
        if (mounted.current) setListening(false);
        listeningHandler.current?.(false);
    }
    async function start() {
        const bridge = teachingNfcBridge();
        if (!bridge || running.current || disabled || !enabled) return;
        begin();
        if (bridge.listen) { listen(bridge, bridge.listen.bind(bridge)); return; }
        try {
            while (stillWanted()) {
                let proposal: TeachingNfcProposal;
                try { proposal = await bridge.read(); }
                catch (reason) {
                    const failure = failureOf(reason);
                    if (!stillWanted() || failure.kind === "cancelled") break;
                    if (mounted.current) setError(failure.message);
                    if (failure.kind !== "unreadable" && failure.kind !== "identifier") break;
                    recent.current = null; await pause(300); continue;
                }
                if (!stillWanted() || !await deliver(bridge, proposal)) break;
                await pause(300);
            }
        } finally { end(); }
    }
    function listen(bridge: TeachingNfcBridge, session: NonNullable<TeachingNfcBridge["listen"]>) {
        const waiting: TeachingNfcProposal[] = [];
        let draining = false;
        const drain = async () => {
            if (draining) return;
            draining = true;
            try {
                while (waiting.length && stillWanted()) {
                    if (!await deliver(bridge, waiting.shift()!)) break;
                }
            } finally { draining = false; }
        };
        stopListening.current = session(proposal => {
            if (!stillWanted() || waiting.length >= MAX_WAITING_READS) return;
            waiting.push(proposal); void drain();
        }, reason => {
            const failure = failureOf(reason);
            if (!running.current || failure.kind === "cancelled") return;
            if (mounted.current) setError(failure.message);
            if (failure.kind === "unreadable" || failure.kind === "identifier") { recent.current = null; return; }
            end();
        });
    }
    function stop() { haltScan(running, mounted, stopListening, listeningHandler, setListening); }

    if (support === "embedded" || !enabled) return null;
    return <section className="nfc-scan-panel inventory-panel" aria-label={title} aria-busy={listening}>
        <div className="section-heading"><h2><Radio size={18} aria-hidden="true"/>{title}</h2>{listening && <span role="status">Listening…</span>}</div>
        <div className="form-stack p-5">
            {support === "checking" ? <p className="field-hint">Checking whether this device can scan NFC…</p>
                : support === "unsupported" ? <p className="field-hint"><strong>NFC scanning isn&apos;t supported on this device or browser.</strong> It works in Chrome on Android phones with NFC switched on. Use manual entry instead.</p>
                : <>
                    <div className="flex flex-wrap gap-2">{listening
                        ? <Button type="button" variant="outline" onClick={stop}><Square size={16} aria-hidden="true"/>Stop scanning</Button>
                        : <Button type="button" onClick={() => void start()} disabled={disabled}><Radio size={16} aria-hidden="true"/>Start NFC scanning</Button>}</div>
                    <p className="field-hint">{listening ? "Hold a battery tag flat against the back of the phone. Scanning stops when you leave this page." : hint}</p>
                    {lastTag && <p className="field-hint">Last tag read: <span className="font-mono">{lastTag}</span></p>}
                </>}
            {error && <p role="alert" className="form-error">{error}</p>}
        </div>
    </section>;
}
