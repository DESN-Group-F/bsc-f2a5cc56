"use client";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ArrowLeft } from "lucide-react";
import type { InventorySnapshot } from "@/lib/domain";
import type { TeachingGroup } from "@/lib/teaching-groups";
import type { TeachingGroupReference } from "@/lib/teaching-context";
import type { EditorDraft, ExportDraft } from "@/lib/client/inventory-contracts";
import { InventoryTable } from "./inventory-table";
import { TeachingGroupsPanel } from "./teaching-groups-panel";
import { TeachingCheckoutRuns } from "./teaching-checkout-runs";
import type { TeachingCheckoutListedRun, TeachingCheckoutRunItem } from "@/lib/teaching-checkouts";
import type { InventoryFilter } from "@/lib/inventory-query";

export function TeachingGroupsWorkspace({ data, ready, activeId, onActiveChange, onBack, returnBlocked = false, overlayOpen = false, onMovement, onRemoval, onMaintenance, onEdit, onDetail, onExport, onChanged, onDialogChange, onActivity, personalScope = "all", revision = 0, onReturnCheckout, onContinueCheckout, onExchangeCheckout, onDownloadCheckout }: {
    data: InventorySnapshot; ready: boolean; activeId: string | null; onActiveChange: (id: string | null) => void;
    onBack: () => void; returnBlocked?: boolean; overlayOpen?: boolean;
    onMovement: (kind: "checkout" | "return", ids: string[], group: TeachingGroupReference, separateCheckout?: boolean) => void;
    onRemoval: (ids: string[], group: TeachingGroupReference) => void;
    onMaintenance: (ids: string[], group: TeachingGroup) => void;
    onEdit: (draft: EditorDraft, group?: TeachingGroupReference) => void; onDetail: (id: string, group?: TeachingGroupReference) => void;
    onExport: (draft: ExportDraft) => void; onChanged: () => Promise<void>; onDialogChange: (open: boolean) => void;
    onActivity: (group: TeachingGroupReference) => void;
    personalScope?: InventoryFilter["personalScope"]; revision?: number;
    onReturnCheckout: (run: TeachingCheckoutListedRun) => void;
    onContinueCheckout: (run: TeachingCheckoutListedRun, group: TeachingGroup, ids: string[]) => void;
    onExchangeCheckout: (run: TeachingCheckoutListedRun, item: TeachingCheckoutRunItem) => void;
    onDownloadCheckout: (run: TeachingCheckoutListedRun, format: "xlsx" | "json") => Promise<void>;
}) {
    const [query, setQuery] = useState(""), [manager, setManager] = useState<{ group?: TeachingGroup; replacement?: { originalBatteryId: string; replacementBatteryId: string } } | null>(null);
    const [runs, setRuns] = useState<TeachingCheckoutListedRun[] | null>(null), [focusRunId, setFocusRunId] = useState<string>();
    const [newCheckout, setNewCheckout] = useState<{ ids: string[]; group: TeachingGroupReference } | null>(null);
    const [queuedCheckout, setQueuedCheckout] = useState<{ ids: string[]; group: TeachingGroupReference } | null>(null), launched = useRef<typeof queuedCheckout>(null);
    useEffect(() => { onDialogChange(!!manager || !!newCheckout); return () => onDialogChange(false); }, [manager, newCheckout, onDialogChange]);
    useEffect(() => {
        if (!queuedCheckout || launched.current === queuedCheckout || overlayOpen || newCheckout || manager || returnBlocked || !ready) return;
        launched.current = queuedCheckout; setQueuedCheckout(null);
        onMovement("checkout", queuedCheckout.ids, queuedCheckout.group, true);
    }, [queuedCheckout, overlayOpen, newCheckout, manager, returnBlocked, ready, onMovement]);
    const groups = data.teachingGroups ?? [], active = groups.find(group => group.id === activeId);
    const matching = groups.filter(group => `${group.name} ${group.notes}`.toLowerCase().includes(query.trim().toLowerCase()));
    const reference = active ? { id: active.id, version: active.version } : undefined;
    const ongoing = (runs ?? []).filter(run => run.teachingGroup.id === activeId && run.items.some(item => item.status === "outstanding"));
    function movement(kind: "checkout" | "return", ids: string[]) {
        if (!reference || !ready || returnBlocked || runs === null) return;
        if (kind === "checkout" && ongoing.length) setNewCheckout({ ids, group: reference });
        else onMovement(kind, ids, reference);
    }
    function focusCheckout(run: TeachingCheckoutListedRun) {
        setNewCheckout(null); setFocusRunId(run.id);
        document.getElementById("teaching-checkout-runs")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    return <section className="teaching-groups-workspace" aria-label="Teaching groups workspace">
        <div className="group-workspace-return"><Button type="button" variant="outline" onClick={onBack} disabled={returnBlocked || !!manager}><ArrowLeft size={16}/>Back to previous page</Button></div>
        <TeachingCheckoutRuns data={data} ready={ready && !returnBlocked && !manager && !newCheckout} revision={revision} groupId={active?.id} focusRunId={focusRunId} onRunsChanged={setRuns} onReturn={onReturnCheckout} onExchange={onExchangeCheckout} onContinue={onContinueCheckout} onPermanent={(group, originalBatteryId, replacementBatteryId) => setManager({ group, replacement: { originalBatteryId, replacementBatteryId } })} onDownload={onDownloadCheckout}/>
        {!activeId ? <><div className="table-toolbar"><Input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search group name or notes…" aria-label="Search teaching groups"/><Button variant="outline" disabled={!query} onClick={() => setQuery("")}>Clear filters</Button><Button disabled={!ready} onClick={() => setManager({})}>Create teaching group</Button></div>{query && <p className="field-hint">Applied filters: Search: {query}</p>}<p className="field-hint">{matching.length} matching groups · Saved to your account in this inventory</p><div className="group-workspace-cards">{matching.map(group => {
            const members = data.batteries.filter(b => group.batteryIds.includes(b.id)), retired = members.filter(b => b.lifecycleStatus !== "active").length, used = members.filter(b => b.lifecycleStatus === "active" && b.loanId).length;
            return <article className="detail-card" key={group.id}><h2>{group.name}</h2>{group.notes && <p>{group.notes}</p>}<p>{members.length} batteries · {members.length - retired - used} in store · {used} in use{retired ? ` · ${retired} retired` : ""}</p><div className="teaching-group-actions"><Button onClick={() => onActiveChange(group.id)} disabled={!ready}>Open group</Button><Button variant="outline" onClick={() => setManager({ group })} disabled={!ready}>Edit group</Button></div></article>;
        })}</div>{!matching.length && <div className="empty-state"><h3>{groups.length ? "No matching groups" : "No teaching groups yet"}</h3><p>{groups.length ? "Clear filters to see your saved groups." : "Create a group here, or add selected batteries from inventory and scanning."}</p></div>}</> : active && reference ? <>
            <div className="section-heading group-workspace-heading"><div><h2>{active.name}</h2><p>{active.notes || "Your saved teaching battery group"}</p><p className="field-hint">Members stay in this group across checkouts, returns and retirement. Recorded operations retain the name and members used at the time.</p></div><div className="teaching-group-actions"><Button variant="outline" onClick={() => onActiveChange(null)}>All teaching groups</Button><Button variant="outline" onClick={() => setManager({ group: active })} disabled={!ready}>Edit group</Button><Button variant="outline" onClick={() => onActivity(reference)}>Group activity</Button></div></div>
            <p className="group-context-banner"><strong>Default group members</strong> · This list is used when preparing future checkouts. Continue or return actual batteries in the checkout section above.</p>
            <InventoryTable overlayOpen={overlayOpen || !!manager || !!newCheckout} key={active.id} data={data} ready={ready && runs !== null} group={active} personalScope={personalScope} onMovement={movement} onGroupCheckouts={() => document.getElementById("teaching-checkout-runs")?.scrollIntoView({ behavior: "smooth", block: "start" })} onRemoval={ids => onRemoval(ids, reference)} onGroupMaintenance={ids => onMaintenance(ids, active)} onEdit={draft => onEdit(draft, draft.record ? reference : undefined)} onDetail={id => onDetail(id, reference)} onSetup={() => setManager({ group: active })} onExport={onExport} onGroupsChanged={onChanged} onGroupDialogChange={onDialogChange}/>
        </> : <div className="load-error" role="alert"><span>This group was removed or is no longer available. Its recorded operations remain in Activity history.</span><Button variant="outline" onClick={() => onActiveChange(null)}>Back to teaching groups</Button></div>}
        {manager && <TeachingGroupsPanel key={manager.group?.id ?? "new"} data={data} initialGroup={manager.group} initialReplacement={manager.replacement} onClose={() => setManager(null)} onChanged={onChanged} onSaved={group => { onActiveChange(group.id); setManager(null); }} onFilter={group => onActiveChange(group.id)} onSelect={group => onActiveChange(group.id)}/>}
        {newCheckout && <Dialog open onOpenChange={open => { if (!open) setNewCheckout(null); }}><DialogContent><DialogHeader><DialogTitle>Continue an existing checkout?</DialogTitle><DialogDescription>This group already has outstanding actual batteries. An original member becoming available does not mean its temporary alternative has been returned.</DialogDescription></DialogHeader>{ongoing.map(run => <div className="detail-card" key={run.id}><h3>{run.teachingGroup.name}</h3>{(run.currentMappings ?? run.mappings).filter(mapping => run.items.some(item => item.loanId === mapping.loanId && item.status === "outstanding")).map(mapping => <p key={mapping.original.batteryId}>{mapping.original.batteryId === mapping.actual.batteryId ? `${mapping.actual.batteryId} is already in this checkout.` : `${mapping.original.batteryId} is currently covered by ${mapping.actual.batteryId}.`}</p>)}<Button onClick={() => focusCheckout(run)}>Continue existing checkout</Button></div>)}<p className="field-hint">Start a separate checkout only when you intend to record another teaching session. Existing loans will remain outstanding.</p><DialogFooter><Button variant="ghost" onClick={() => setNewCheckout(null)}>Cancel</Button><Button variant="outline" disabled={!ready || runs === null} onClick={() => { setQueuedCheckout(newCheckout); setNewCheckout(null); }}>Start separate new checkout</Button></DialogFooter></DialogContent></Dialog>}
    </section>;
}
