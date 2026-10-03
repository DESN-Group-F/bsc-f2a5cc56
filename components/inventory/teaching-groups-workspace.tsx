"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowLeft } from "lucide-react";
import type { InventorySnapshot } from "@/lib/domain";
import type { TeachingGroup } from "@/lib/teaching-groups";
import type { TeachingGroupReference } from "@/lib/teaching-context";
import type { EditorDraft, ExportDraft } from "@/lib/client/inventory-contracts";
import { InventoryTable } from "./inventory-table";
import { TeachingGroupsPanel } from "./teaching-groups-panel";

export function TeachingGroupsWorkspace({ data, ready, activeId, onActiveChange, onBack, returnBlocked = false, onMovement, onRemoval, onMaintenance, onEdit, onDetail, onExport, onChanged, onDialogChange, onActivity }: {
    data: InventorySnapshot; ready: boolean; activeId: string | null; onActiveChange: (id: string | null) => void;
    onBack: () => void; returnBlocked?: boolean;
    onMovement: (kind: "checkout" | "return", ids: string[], group: TeachingGroupReference) => void;
    onRemoval: (ids: string[], group: TeachingGroupReference) => void;
    onMaintenance: (ids: string[], group: TeachingGroup) => void;
    onEdit: (draft: EditorDraft, group?: TeachingGroupReference) => void; onDetail: (id: string, group?: TeachingGroupReference) => void;
    onExport: (draft: ExportDraft) => void; onChanged: () => Promise<void>; onDialogChange: (open: boolean) => void;
    onActivity: (group: TeachingGroupReference) => void;
}) {
    const [query, setQuery] = useState(""), [manager, setManager] = useState<{ group?: TeachingGroup } | null>(null);
    useEffect(() => { onDialogChange(!!manager); return () => onDialogChange(false); }, [manager, onDialogChange]);
    const groups = data.teachingGroups ?? [], active = groups.find(group => group.id === activeId);
    const matching = groups.filter(group => `${group.name} ${group.notes}`.toLowerCase().includes(query.trim().toLowerCase()));
    const reference = active ? { id: active.id, version: active.version } : undefined;
    return <section className="teaching-groups-workspace" aria-label="Teaching groups workspace">
        <div className="group-workspace-return"><Button type="button" variant="outline" className="station-exit-button" onClick={onBack} disabled={returnBlocked || !!manager}><ArrowLeft size={20}/>Back to previous page</Button></div>
        {!activeId ? <><div className="table-toolbar"><Input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search group name or notes…" aria-label="Search teaching groups"/><Button variant="outline" disabled={!query} onClick={() => setQuery("")}>Clear filters</Button><Button disabled={!ready} onClick={() => setManager({})}>Create teaching group</Button></div>{query && <p className="field-hint">Applied filters: Search: {query}</p>}<p className="field-hint">{matching.length} matching groups · Saved to your account in this inventory</p><div className="group-workspace-cards">{matching.map(group => {
            const members = data.batteries.filter(b => group.batteryIds.includes(b.id)), retired = members.filter(b => b.lifecycleStatus !== "active").length, used = members.filter(b => b.lifecycleStatus === "active" && b.loanId).length;
            return <article className="detail-card" key={group.id}><h2>{group.name}</h2>{group.notes && <p>{group.notes}</p>}<p>{members.length} batteries · {members.length - retired - used} in store · {used} in use{retired ? ` · ${retired} retired` : ""}</p><div className="teaching-group-actions"><Button onClick={() => onActiveChange(group.id)} disabled={!ready}>Open group</Button><Button variant="outline" onClick={() => setManager({ group })} disabled={!ready}>Edit group</Button></div></article>;
        })}</div>{!matching.length && <div className="empty-state"><h3>{groups.length ? "No matching groups" : "No teaching groups yet"}</h3><p>{groups.length ? "Clear filters to see your saved groups." : "Create a group here, or add selected batteries from inventory and scanning."}</p></div>}</> : active && reference ? <>
            <div className="section-heading group-workspace-heading"><div><h2>{active.name}</h2><p>{active.notes || "Your saved teaching battery group"}</p><p className="field-hint">Members stay in this group across checkouts, returns and retirement. Recorded operations retain the name and members used at the time.</p></div><div className="teaching-group-actions"><Button variant="outline" onClick={() => onActiveChange(null)}>All teaching groups</Button><Button variant="outline" onClick={() => setManager({ group: active })} disabled={!ready}>Edit group</Button><Button variant="outline" onClick={() => onActivity(reference)}>Group activity</Button></div></div>
            <InventoryTable key={active.id} data={data} ready={ready} group={active} onMovement={(kind, ids) => onMovement(kind, ids, reference)} onRemoval={ids => onRemoval(ids, reference)} onGroupMaintenance={ids => onMaintenance(ids, active)} onEdit={draft => onEdit(draft, draft.record ? reference : undefined)} onDetail={id => onDetail(id, reference)} onSetup={() => setManager({ group: active })} onExport={onExport} onGroupsChanged={onChanged} onGroupDialogChange={onDialogChange}/>
        </> : <div className="load-error" role="alert"><span>This group was removed or is no longer available. Its recorded operations remain in Activity history.</span><Button variant="outline" onClick={() => onActiveChange(null)}>Back to teaching groups</Button></div>}
        {manager && <TeachingGroupsPanel key={manager.group?.id ?? "new"} data={data} initialGroup={manager.group} onClose={() => setManager(null)} onChanged={onChanged} onSaved={group => { onActiveChange(group.id); setManager(null); }} onFilter={group => onActiveChange(group.id)} onSelect={group => onActiveChange(group.id)}/>}
    </section>;
}
