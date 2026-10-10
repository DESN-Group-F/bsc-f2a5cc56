"use client";

import { useEffect, useState } from "react";
import { ArrowRightLeft, ChevronDown, RefreshCw, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { LoadingState } from "@/components/ui/loading-state";
import { MotionDisclosure } from "@/components/ui/workspace-motion";
import { formatTime, teachingSpecificationDifferenceLabel } from "@/lib/client-utils";
import { inventoryResponse } from "@/lib/client/inventory-request";
import type { InventorySnapshot } from "@/lib/domain";
import type { TeachingGroup } from "@/lib/teaching-groups";
import type { TeachingCheckoutListedRun, TeachingCheckoutRunItem } from "@/lib/teaching-checkouts";
import styles from "./teaching-checkout.module.css";

export function TeachingCheckoutRuns({ data, ready, revision = 0, groupId, focusRunId, onReturn, onExchange, onContinue, onPermanent, onRunsChanged, onDownload }: {
    data: InventorySnapshot; ready: boolean; revision?: number; groupId?: string; focusRunId?: string;
    onReturn: (run: TeachingCheckoutListedRun) => void;
    onExchange: (run: TeachingCheckoutListedRun, item: TeachingCheckoutRunItem) => void;
    onContinue: (run: TeachingCheckoutListedRun, group: TeachingGroup, ids: string[]) => void;
    onPermanent: (group: TeachingGroup, originalBatteryId: string, replacementBatteryId: string) => void;
    onRunsChanged?: (runs: TeachingCheckoutListedRun[] | null) => void;
    onDownload: (run: TeachingCheckoutListedRun, format: "xlsx" | "json") => Promise<void>;
}) {
    const [runs, setRuns] = useState<TeachingCheckoutListedRun[]>([]), [loading, setLoading] = useState(true), [error, setError] = useState("");
    const [query, setQuery] = useState(""), [outstandingOnly, setOutstandingOnly] = useState(true), [reload, setReload] = useState(0);
    const [downloading, setDownloading] = useState<string | null>(null), [downloadMessage, setDownloadMessage] = useState("");
    const [expandedRunIds, setExpandedRunIds] = useState<string[]>([]), [collapsedRunIds, setCollapsedRunIds] = useState<string[]>([]);
    useEffect(() => {
        let current = true;
        async function load() {
            try {
                const result = await inventoryResponse<{ runs: TeachingCheckoutListedRun[] }>(await fetch(`/api/teaching-checkouts?dataset=${data.dataset}`, { cache: "no-store" }));
                if (current) { setRuns(result.runs); onRunsChanged?.(result.runs); }
            } catch (failure) { if (current) { setError((failure as Error).message); onRunsChanged?.(null); } }
            finally { if (current) setLoading(false); }
        }
        queueMicrotask(() => { if (current) { setLoading(true); setError(""); onRunsChanged?.(null); void load(); } });
        return () => { current = false; };
    }, [data.dataset, data.user.id, revision, reload, onRunsChanged]);
    const matching = runs.filter(run => (!groupId || run.teachingGroup.id === groupId) && (!outstandingOnly || run.items.some(item => item.status === "outstanding")) && `${run.teachingGroup.name} ${run.id} ${run.requestedBatteryIds.join(" ")} ${run.items.map(item => item.batteryId).join(" ")}`.toLowerCase().includes(query.trim().toLowerCase()));
    async function download(run: TeachingCheckoutListedRun, format: "xlsx" | "json") {
        if (downloading) return;
        setDownloading(run.id); setDownloadMessage("");
        try { await onDownload(run, format); setDownloadMessage("The checkout report has been downloaded."); }
        catch (failure) { setDownloadMessage((failure as Error).message); }
        finally { setDownloading(null); }
    }
    function expand(run: TeachingCheckoutListedRun, value: boolean) {
        setExpandedRunIds(previous => value ? [...new Set([...previous, run.id])] : previous.filter(id => id !== run.id));
        setCollapsedRunIds(previous => value ? previous.filter(id => id !== run.id) : [...new Set([...previous, run.id])]);
    }
    return <section className="teaching-checkout-runs detail-card" id="teaching-checkout-runs" aria-label="Actual teaching group checkouts" aria-busy={loading}>
        <div className="section-heading"><div><h2>Actual group checkouts</h2><p className="field-hint">Continue using or return the batteries recorded here. Default group edits apply to future use. Returning a temporary alternative ends its use without a separate restore step.</p></div><Button variant="outline" size="sm" disabled={loading} onClick={() => setReload(value => value + 1)}><RefreshCw size={16}/>Refresh checkouts</Button></div>
        <div className="table-toolbar"><Input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search group, checkout or battery ID…" aria-label="Search actual group checkouts"/><label className="flex items-center gap-2 whitespace-nowrap text-sm"><Checkbox checked={outstandingOnly} onCheckedChange={value => setOutstandingOnly(value === true)}/>Outstanding only</label><Button variant="outline" onClick={() => { setQuery(""); setOutstandingOnly(false); }} disabled={!query && !outstandingOnly}>Clear filters</Button></div>
        {(query || outstandingOnly) && <p className="field-hint">Applied filters: {outstandingOnly ? "Outstanding checkouts" : ""}{query ? `${outstandingOnly ? " · " : ""}Search: ${query}` : ""}</p>}
        {loading && <LoadingState label={runs.length ? "Refreshing actual checkouts…" : "Loading your actual checkouts…"} compact={!!runs.length}/>}
        {error && <p className="form-error" role="alert">{error} Refresh checkouts before preparing another operation.</p>}
        {(!loading || !!runs.length) && <>
            <p className="field-hint">{matching.length} matching checkouts · Saved to your account in this inventory</p>
            {!matching.length && !error && <p>No matching checkouts. Clear filters to review completed records.</p>}
            {matching.map(run => {
                const currentMappings = run.currentMappings ?? run.mappings;
                const outstanding = run.items.filter(item => item.status === "outstanding"), replacements = currentMappings.filter(mapping => mapping.original.batteryId !== mapping.actual.batteryId);
                const expanded = focusRunId === run.id && !collapsedRunIds.includes(run.id) || expandedRunIds.includes(run.id) || !!groupId && !!outstanding.length && !collapsedRunIds.includes(run.id), evidenceId = `teaching-checkout-evidence-${data.dataset}-${run.id}`;
                const group = data.teachingGroups?.find(item => item.id === run.teachingGroup.id);
                const activeMappings = currentMappings.filter(mapping => outstanding.some(item => item.loanId === mapping.loanId && item.batteryId === mapping.actual.batteryId && !item.pendingReturn));
                const covered = new Set(activeMappings.flatMap(mapping => [mapping.original.batteryId, mapping.actual.batteryId]));
                const allMappings = [...run.mappings, ...(run.changes ?? []).flatMap(change => change.mappings)];
                const pendingMembers = new Set(outstanding.filter(item => item.pendingReturn).flatMap(item => {
                    const originalId = item.originalBatteryId ?? allMappings.find(mapping => mapping.loanId === item.loanId && mapping.actual.batteryId === item.batteryId)?.original.batteryId;
                    const current = currentMappings.find(mapping => mapping.original.batteryId === originalId);
                    return [item.batteryId, ...(originalId ? [originalId] : []), ...(current ? [current.actual.batteryId] : [])];
                }));
                const blockedIds = group?.batteryIds.filter(id => !covered.has(id) && pendingMembers.has(id)) ?? [];
                const missingIds = group?.batteryIds.filter(id => !covered.has(id) && !pendingMembers.has(id)) ?? [];
                const locked = !ready || loading || !!error || !!downloading;
                return <article className="teaching-checkout-run" key={run.id} id={`teaching-checkout-${run.id}`}>
                    <div className="section-heading"><div><h3>{run.teachingGroup.name}</h3><p>{formatTime(run.createdAt)} · {outstanding.length} outstanding / {run.items.length} recorded loans</p>{outstanding.some(item => item.pendingReturn) && <p className={styles.pendingNotice}>Previous batteries pending return: {outstanding.filter(item => item.pendingReturn).map(item => item.batteryId).join(", ")}</p>}</div><div className="teaching-group-actions"><Button disabled={locked || !outstanding.length} onClick={() => onReturn(run)}><RotateCcw size={16}/>Return this checkout</Button>{outstanding.length > 0 && <Button variant="outline" disabled={locked} onClick={() => expand(run, true)}>Continue existing checkout</Button>}<Button variant="outline" disabled={!!downloading} onClick={() => void download(run, "xlsx")}>Download checkout</Button><Button variant="ghost" size="sm" disabled={!!downloading} onClick={() => void download(run, "json")}>JSON</Button></div></div>
                    <button type="button" className="teaching-checkout-evidence-trigger" aria-expanded={expanded} aria-controls={evidenceId} onClick={() => expand(run, !expanded)}><span>{replacements.length} {replacements.length === 1 ? "alternative" : "alternatives"} · View actual batteries and saved evidence</span><ChevronDown size={16} aria-hidden="true"/></button>
                    <MotionDisclosure open={expanded} id={evidenceId} className="teaching-checkout-evidence">
                        <p className="field-hint">Original group version {run.teachingGroup.version} · Checkout {run.id} · Recorded by {run.actorName}</p>
                        {!!blockedIds.length && <p className={styles.pendingNotice}>Default members awaiting a previous battery return: {blockedIds.join(", ")}. Return the outstanding previous batteries before adding these members again.</p>}
                        {group && missingIds.length > 0 && outstanding.length > 0 && <div className={styles.continueNotice}><p>{missingIds.length} current default {missingIds.length === 1 ? "member is" : "members are"} not covered by an outstanding loan in this checkout.</p><Button variant="outline" size="sm" disabled={locked} onClick={() => onContinue(run, group, missingIds)}>Add batteries to this checkout</Button></div>}
                        {run.items.map(item => {
                            const mapping = [...run.mappings, ...(run.changes ?? []).flatMap(change => change.mappings)].find(entry => entry.loanId === item.loanId && entry.actual.batteryId === item.batteryId);
                            const originalId = item.originalBatteryId ?? mapping?.original.batteryId ?? item.batteryId;
                            const isCurrent = currentMappings.some(entry => entry.loanId === item.loanId && entry.actual.batteryId === item.batteryId);
                            const original = data.batteries.find(battery => battery.id === originalId), actual = data.batteries.find(battery => battery.id === item.batteryId);
                            const isAlternative = originalId !== item.batteryId, permanent = !!group?.batteryIds.includes(item.batteryId) && !group?.batteryIds.includes(originalId);
                            const canPermanent = group && isCurrent && isAlternative && group.batteryIds.includes(originalId) && !group.batteryIds.includes(item.batteryId) && actual?.lifecycleStatus === "active";
                            return <div className={styles.actualRow} key={item.loanId ?? `${item.batteryId}-${originalId}`} data-pending={!!item.pendingReturn && item.status === "outstanding"}>
                                <div><strong>{isAlternative ? `${originalId} → ${item.batteryId}` : item.batteryId}</strong><p>{item.pendingReturn && item.status === "outstanding" ? "Previous battery pending return" : item.status === "outstanding" ? "In use by you" : item.status === "returned" ? "Returned" : item.status === "cancelled" ? "Loan corrected" : "Deleted record"}{isAlternative ? permanent ? " · Default membership updated" : item.status === "outstanding" ? " · Temporary alternative" : " · Temporary use ended" : " · Default member"}</p>
                                {item.returnedAt && <p className="field-hint">Returned {formatTime(item.returnedAt)}</p>}{item.checkedOutAt && <p className="field-hint">Checked out {formatTime(item.checkedOutAt)}{mapping?.loanOrigin === "existing" ? " · Existing loan continued" : ""}</p>}
                                {isCurrent && isAlternative && item.status === "outstanding" && original?.lifecycleStatus === "active" && !original.loanId && <p className={styles.availabilityNote}>{originalId} is now available to borrow. Keep using {item.batteryId}; no automatic swap or extra checkout is required.</p>}
                                {mapping?.method === "manual" && <p className="field-hint">{mapping.specificationMatch === null ? "Deleted specification evidence." : mapping.differences.length ? mapping.differences.map(teachingSpecificationDifferenceLabel).join(" · ") : "Recorded specifications match; manually selected."} Teaching suitability is not verified by the system.</p>}
                                <p className="field-hint">Recorded loan: {item.loanId ?? "Deleted evidence"} · {mapping?.source?.kind === "native_nfc" ? "Adopted native NFC reading" : mapping?.source?.kind === "tag" ? "Entered registered tag" : mapping?.source ? "Inventory selection" : "Deleted evidence"}</p></div>
                                <div className="teaching-group-actions">{isCurrent && item.status === "outstanding" && !item.pendingReturn && <Button variant="outline" size="sm" disabled={locked} onClick={() => onExchange(run, item)}><ArrowRightLeft size={15}/>Exchange battery</Button>}{canPermanent && <Button variant="ghost" size="sm" disabled={locked} onClick={() => onPermanent(group, originalId, item.batteryId)}>Make replacement permanent</Button>}</div>
                            </div>;
                        })}
                        {!!run.changes?.length && <div className={styles.changeHistory}><h4>Changes during this checkout</h4>{run.changes.map(change => <p key={change.id}><strong>{change.action === "exchange" ? "Battery exchange" : "Batteries added"}</strong> · {formatTime(change.at)} · {change.actorName} · {change.mappings.map(mapping => `${mapping.original.batteryId} → ${mapping.actual.batteryId}`).join(", ")}{change.outgoing && "returned" in change.outgoing ? ` · ${change.outgoing.batteryId} ${change.outgoing.returned ? "returned during exchange" : "kept outstanding at exchange"}` : ""}</p>)}</div>}
                    </MotionDisclosure>
                </article>;
            })}
        </>}
        {downloadMessage && <p role="status" className="form-message">{downloadMessage}</p>}
    </section>;
}
