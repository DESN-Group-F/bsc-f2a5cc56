"use client";

import { useEffect, useState } from "react";
import { ChevronDown, RefreshCw, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { MotionDisclosure } from "@/components/ui/workspace-motion";
import { formatTime } from "@/lib/client-utils";
import { inventoryResponse } from "@/lib/client/inventory-request";
import type { InventorySnapshot } from "@/lib/domain";
import type { TeachingCheckoutListedRun } from "@/lib/teaching-checkouts";

export function TeachingCheckoutRuns({ data, ready, revision = 0, groupId, onReturn, onDownload }: {
    data: InventorySnapshot; ready: boolean; revision?: number; groupId?: string;
    onReturn: (run: TeachingCheckoutListedRun) => void;
    onDownload: (run: TeachingCheckoutListedRun, format: "xlsx" | "json") => Promise<void>;
}) {
    const [runs, setRuns] = useState<TeachingCheckoutListedRun[]>([]), [loading, setLoading] = useState(true), [error, setError] = useState("");
    const [query, setQuery] = useState(""), [outstandingOnly, setOutstandingOnly] = useState(true), [reload, setReload] = useState(0);
    const [downloading, setDownloading] = useState<string | null>(null), [downloadMessage, setDownloadMessage] = useState("");
    const [expandedRunIds, setExpandedRunIds] = useState<string[]>([]);
    useEffect(() => {
        let current = true;
        async function load() {
            try {
                const result = await inventoryResponse<{ runs: TeachingCheckoutListedRun[] }>(await fetch(`/api/teaching-checkouts?dataset=${data.dataset}`, { cache: "no-store" }));
                if (current) setRuns(result.runs);
            } catch (failure) { if (current) setError((failure as Error).message); }
            finally { if (current) setLoading(false); }
        }
        queueMicrotask(() => { if (current) { setLoading(true); setError(""); void load(); } });
        return () => { current = false; };
    }, [data.dataset, data.user.id, revision, reload]);
    const matching = runs.filter(run => (!groupId || run.teachingGroup.id === groupId) && (!outstandingOnly || run.items.some(item => item.status === "outstanding")) && `${run.teachingGroup.name} ${run.id} ${run.requestedBatteryIds.join(" ")} ${run.items.map(item => item.batteryId).join(" ")}`.toLowerCase().includes(query.trim().toLowerCase()));
    async function download(run: TeachingCheckoutListedRun, format: "xlsx" | "json") {
        if (downloading) return;
        setDownloading(run.id); setDownloadMessage("");
        try { await onDownload(run, format); setDownloadMessage("The checkout report has been downloaded."); }
        catch (failure) { setDownloadMessage((failure as Error).message); }
        finally { setDownloading(null); }
    }
    return <section className="teaching-checkout-runs detail-card" id="teaching-checkout-runs" aria-label="Actual teaching group checkouts">
        <div className="section-heading"><div><h2>Actual group checkouts</h2><p className="field-hint">Return the actual batteries from a saved checkout. Changes to fixed group members do not change these recorded loan IDs.</p></div><Button variant="outline" size="sm" disabled={loading} onClick={() => setReload(value => value + 1)}><RefreshCw size={16}/>Refresh checkouts</Button></div>
        <div className="table-toolbar"><Input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search group, checkout or battery ID…" aria-label="Search actual group checkouts"/><label className="flex items-center gap-2 whitespace-nowrap text-sm"><Checkbox checked={outstandingOnly} onCheckedChange={value => setOutstandingOnly(value === true)}/>Outstanding only</label><Button variant="outline" onClick={() => { setQuery(""); setOutstandingOnly(false); }} disabled={!query && !outstandingOnly}>Clear filters</Button></div>
        {(query || outstandingOnly) && <p className="field-hint">Applied filters: {outstandingOnly ? "Outstanding checkouts" : ""}{query ? `${outstandingOnly ? " · " : ""}Search: ${query}` : ""}</p>}
        {loading ? <p role="status">Loading your actual checkouts…</p> : error ? <p className="form-error" role="alert">{error}</p> : <>
            <p className="field-hint">{matching.length} matching checkouts · Saved to your account in this inventory</p>
            {!matching.length && <p>No matching checkouts. Clear filters to review completed records.</p>}
            {matching.map(run => {
                const outstanding = run.items.filter(item => item.status === "outstanding"), replacements = run.mappings.filter(mapping => mapping.method !== "original");
                const expanded = expandedRunIds.includes(run.id), evidenceId = `teaching-checkout-evidence-${data.dataset}-${run.id}`;
                return <article className="teaching-checkout-run" key={run.id}>
                    <div className="section-heading"><div><h3>{run.teachingGroup.name}</h3><p>{formatTime(run.createdAt)} · {outstanding.length} outstanding / {run.items.length} recorded batteries</p></div><div className="teaching-group-actions"><Button disabled={!ready || !outstanding.length || !!downloading} onClick={() => onReturn(run)}><RotateCcw size={16}/>Return this checkout</Button><Button variant="outline" disabled={!!downloading} onClick={() => void download(run, "xlsx")}>Download checkout</Button><Button variant="ghost" size="sm" disabled={!!downloading} onClick={() => void download(run, "json")}>JSON</Button></div></div>
                    <button type="button" className="teaching-checkout-evidence-trigger" aria-expanded={expanded} aria-controls={evidenceId} onClick={() => setExpandedRunIds(previous => previous.includes(run.id) ? previous.filter(id => id !== run.id) : [...previous, run.id])}><span>{replacements.length} {replacements.length === 1 ? "alternative" : "alternatives"} · View actual batteries and saved evidence</span><ChevronDown size={16} aria-hidden="true"/></button>
                    <MotionDisclosure open={expanded} id={evidenceId} className="teaching-checkout-evidence"><p className="field-hint">Group version {run.teachingGroup.version} · Checkout {run.id} · Recorded by {run.actorName}</p>{run.mappings.map(mapping => {
                        const item = run.items.find(entry => entry.loanId === mapping.loanId && entry.batteryId === mapping.actual.batteryId);
                        return <div className="history-entry" key={mapping.original.batteryId}><strong>{mapping.original.batteryId} → {mapping.actual.batteryId}</strong><p>{mapping.method === "manual" ? "Manual alternative" : mapping.method === "automatic" ? "Same recorded model and specifications" : "Fixed member"} · {item?.status ?? "Record unavailable"}{item?.returnedAt ? ` · Returned ${formatTime(item.returnedAt)}` : ""}</p>{mapping.method === "manual" && <p>{mapping.specificationMatch === null ? "Deleted specification evidence." : mapping.differences.length ? mapping.differences.join(" · ") : "Recorded specifications match; manually selected."} Teacher-selected alternative; teaching suitability is not verified by the system.</p>}<p className="field-hint">Selection source: {!mapping.source ? "Deleted evidence" : mapping.source.kind === "native_nfc" ? "Adopted native NFC reading" : mapping.source.kind === "tag" ? "Entered registered tag" : "Inventory selection"}</p></div>;
                    })}</MotionDisclosure>
                </article>;
            })}
        </>}
        {downloadMessage && <p role="status" className="form-message">{downloadMessage}</p>}
    </section>;
}
