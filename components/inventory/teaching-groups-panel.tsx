"use client";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import type { InventorySnapshot } from "@/lib/domain";
import { batteryStatusLabel } from "@/lib/battery-lifecycle";
import { captureTeachingGroupAttempt, recoverTeachingGroupAttempt, teachingGroupStorageKey, teachingGroupFailureStatus, verifyTeachingGroupReceipt, type TeachingGroup, type TeachingGroupAttempt } from "@/lib/teaching-groups";

type Form = { id: string; name: string; notes: string; batteryIds: string[]; expectedVersion?: number };
export function TeachingGroupsPanel({ data, initialIds = [], initialGroup, addToExisting = false, onClose, onChanged, onSaved, onFilter, onSelect }: { data: InventorySnapshot; initialIds?: string[]; initialGroup?: TeachingGroup; addToExisting?: boolean; onClose: () => void; onChanged?: () => Promise<void>; onSaved?: (group: TeachingGroup) => void; onFilter: (group: TeachingGroup) => void; onSelect: (group: TeachingGroup) => void }) {
    const [context] = useState(() => ({ accountId: data.user.id, dataset: data.dataset }));
    const storageKey = teachingGroupStorageKey(context.accountId, context.dataset);
    const [recovery] = useState(() => {
        try {
            const raw = sessionStorage.getItem(storageKey), attempt = recoverTeachingGroupAttempt(raw, context.accountId, context.dataset);
            return { attempt, blocked: !!raw && !attempt };
        } catch { return { attempt: null, blocked: true }; }
    });
    const [attempt, setAttempt] = useState<TeachingGroupAttempt | null>(recovery.attempt), pending = useRef(attempt), running = useRef(false), live = useRef(true);
    const [busy, setBusy] = useState(false), [storageError, setStorageError] = useState(""), [error, setError] = useState(recovery.blocked ? "This tab could not recover its group request. Restore storage access and reopen with the same account and inventory before saving." : "");
    const [mode, setMode] = useState<"list" | "edit" | "remove">(attempt ? attempt.payload.action === "remove" ? "remove" : "edit" : initialGroup || initialIds.length && !addToExisting ? "edit" : "list");
    const [form, setForm] = useState<Form>(() => attempt ? attempt.payload.action === "remove" ? { id: attempt.payload.id, name: "Saved group", notes: "", batteryIds: [], expectedVersion: attempt.payload.expectedVersion } : { ...attempt.payload, expectedVersion: attempt.payload.action === "update" ? attempt.payload.expectedVersion : undefined } : initialGroup ? { ...initialGroup, batteryIds: [...initialGroup.batteryIds], expectedVersion: initialGroup.version } : { id: crypto.randomUUID(), name: "", notes: "", batteryIds: [...new Set(initialIds)] });
    const [query, setQuery] = useState(""), [batteryQuery, setBatteryQuery] = useState("");
    const contextChanged = context.accountId !== data.user.id || context.dataset !== data.dataset;
    useEffect(() => { live.current = !contextChanged; return () => { live.current = false; }; }, [contextChanged]);
    const locked = busy || !!attempt || !!storageError || recovery.blocked || contextChanged;
    const groups = data.teachingGroups ?? [], matching = groups.filter(group => `${group.name} ${group.notes}`.toLowerCase().includes(query.trim().toLowerCase()));
    const choices = data.batteries.filter(battery => `${battery.id} ${battery.name} ${battery.model} ${battery.ownerName}`.toLowerCase().includes(batteryQuery.trim().toLowerCase()));
    function edit(group?: TeachingGroup, remove = false) {
        if (locked || running.current) return;
        setForm(group ? { id: group.id, name: group.name, notes: group.notes, batteryIds: [...group.batteryIds], expectedVersion: group.version } : { id: crypto.randomUUID(), name: "", notes: "", batteryIds: [...new Set(initialIds)] });
        setMode(remove ? "remove" : "edit"); setBatteryQuery(""); setError("");
    }
    function update(patch: Partial<Form>) { if (!locked && !running.current) setForm(previous => ({ ...previous, ...patch })); }
    function preserve(value: TeachingGroupAttempt | null) {
        try {
            if (value) sessionStorage.setItem(storageKey, JSON.stringify(value)); else sessionStorage.removeItem(storageKey);
            pending.current = value; setAttempt(value); setStorageError(""); return true;
        } catch {
            pending.current = value || pending.current; setAttempt(pending.current);
            setStorageError("This tab could not preserve or clear its exact group request. Restore storage access, then retry the preserved request."); return false;
        }
    }
    async function save(retry = false) {
        if (busy || running.current || recovery.blocked || contextChanged || (!retry && locked) || (retry && !pending.current)) return;
        running.current = true; setBusy(true); setError("");
        let captured = pending.current;
        try {
            if (!captured) captured = captureTeachingGroupAttempt(context.accountId, context.dataset, mode === "remove" ? { action: "remove", requestId: crypto.randomUUID(), id: form.id, expectedVersion: form.expectedVersion } : { action: form.expectedVersion ? "update" : "create", requestId: crypto.randomUUID(), id: form.id, name: form.name, notes: form.notes, batteryIds: form.batteryIds, ...(form.expectedVersion ? { expectedVersion: form.expectedVersion } : {}) });
            if (!preserve(captured)) return;
            const response = await fetch("/api/teaching-groups", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dataset: context.dataset, payload: captured.payload }) });
            const body = await response.json() as { result?: unknown; error?: string; code?: string };
            if (!response.ok) throw Object.assign(new Error(body.error || "The group could not be saved."), { status: response.status, code: body.code });
            const receipt = verifyTeachingGroupReceipt(body.result, captured);
            if (!live.current) {
                try { const stored = recoverTeachingGroupAttempt(sessionStorage.getItem(storageKey), context.accountId, context.dataset); if (stored?.payload.requestId === captured.payload.requestId) sessionStorage.removeItem(storageKey); } catch { /* Preserve the exact request for replay if cleanup is unavailable. */ }
                return;
            }
            if (!preserve(null)) return;
            setMode("list"); setQuery(""); setBatteryQuery("");
            try { await onChanged?.(); }
            catch { setError("Your group change was saved, but the display could not refresh. Reopen your groups after refreshing the inventory."); return; }
            if (live.current && receipt.group.state === "active") onSaved?.(receipt.group);
        } catch (error) {
            if (!live.current) return;
            const message = (error as { issues?: { message: string }[] }).issues?.[0]?.message || (error as Error).message;
            if (captured && teachingGroupFailureStatus(error) === "rejected") preserve(null);
            setError(captured && teachingGroupFailureStatus(error) === "unknown" ? `${message} The outcome is unconfirmed. Retry the exact request.` : message);
        } finally { running.current = false; if (live.current) setBusy(false); }
    }
    return <Dialog open onOpenChange={open => { if (!open && !busy && !storageError) onClose(); }}><DialogContent className="teaching-groups-dialog"><DialogHeader><DialogTitle>My teaching groups</DialogTitle><DialogDescription>Save fixed battery selections for teaching. Groups are private to your account and this inventory; stock, responsibility and current use remain shared.</DialogDescription></DialogHeader>
        {contextChanged && <p className="form-error" role="alert">Reopen with the original account and inventory to resolve this group request.</p>}
        {mode === "list" ? <><div className="teaching-group-toolbar"><Input aria-label="Search my teaching groups" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search group name or notes…"/><Button variant="outline" onClick={() => setQuery("")} disabled={!query}>Clear filters</Button><Button onClick={() => edit()} disabled={locked}>New group</Button></div>{addToExisting && <p className="group-context-banner">{initialIds.length} selected batteries. Choose an existing group to review their addition, or create a new group.</p>}{query && <p className="field-hint">Applied filters: Search: {query}</p>}<p className="field-hint">{matching.length} matching groups</p><div className="teaching-group-list">{matching.map(group => <article key={group.id} className="teaching-group-card"><strong>{group.name}</strong>{group.notes && <p>{group.notes}</p>}<p className="field-hint">{group.batteryIds.length} batteries · {group.batteryIds.filter(id => data.batteries.find(battery => battery.id === id)?.loanId).length} in use · {group.batteryIds.filter(id => data.batteries.find(battery => battery.id === id)?.lifecycleStatus !== "active").length} retired</p><div className="teaching-group-actions">{addToExisting && <Button size="sm" disabled={locked || new Set([...group.batteryIds, ...initialIds]).size > 100} onClick={() => { if (!locked) { edit(group); setForm(previous => ({ ...previous, batteryIds: [...new Set([...group.batteryIds, ...initialIds])] })); } }}>Add selected batteries</Button>}<Button variant="outline" size="sm" onClick={() => { onFilter(group); onClose(); }} disabled={busy}>Filter group</Button><Button size="sm" onClick={() => { onSelect(group); onClose(); }} disabled={busy}>Select group batteries</Button><Button variant="ghost" size="sm" onClick={() => edit(group)} disabled={locked}>Edit</Button><Button variant="ghost" size="sm" onClick={() => edit(group, true)} disabled={locked}>Remove group</Button></div></article>)}{!matching.length && <p className="empty-hint">{groups.length ? "No matching groups. Clear filters to see your saved groups." : "Select batteries in the inventory and choose Save as teaching group, or create a group here."}</p>}</div></>
        : mode === "remove" ? <div className="detail-card"><h3>Remove {form.name}</h3><p>Remove this shortcut from your saved groups. Battery records and their history remain in the shared inventory.</p></div>
        : <div className="form-stack"><div className="form-field"><Label htmlFor="teaching-group-name">Group name</Label><Input id="teaching-group-name" value={form.name} onChange={event => update({ name: event.target.value })} maxLength={80} disabled={locked} placeholder="e.g. Week 3 teaching set"/></div><div className="form-field"><Label htmlFor="teaching-group-notes">Notes — optional</Label><Textarea id="teaching-group-notes" value={form.notes} onChange={event => update({ notes: event.target.value })} maxLength={500} disabled={locked}/></div><div className="teaching-group-toolbar"><Input aria-label="Find teaching group batteries" value={batteryQuery} onChange={event => setBatteryQuery(event.target.value)} disabled={locked} placeholder="Search battery, model or owner…"/><Button variant="outline" onClick={() => setBatteryQuery("")} disabled={locked || !batteryQuery}>Clear filters</Button></div>{batteryQuery && <p className="field-hint">Applied filters: Search: {batteryQuery}</p>}<div className="teaching-group-actions"><strong>{form.batteryIds.length}/100 selected</strong><Button variant="ghost" size="sm" onClick={() => update({ batteryIds: [] })} disabled={locked || !form.batteryIds.length}>Clear selection</Button>{form.expectedVersion && <Button variant="outline" size="sm" onClick={() => { const latest = groups.find(group => group.id === form.id); if (latest) edit(latest); else setError("This group is no longer available. Your draft remains here for review."); }} disabled={locked}>Load latest group</Button>}</div><div className="teaching-group-batteries">{choices.map(battery => <label key={battery.id} className="export-option"><Checkbox checked={form.batteryIds.includes(battery.id)} disabled={locked || !form.batteryIds.includes(battery.id) && form.batteryIds.length >= 100} onCheckedChange={checked => update({ batteryIds: checked === true ? [...new Set([...form.batteryIds, battery.id])] : form.batteryIds.filter(id => id !== battery.id) })}/><span><strong>{battery.id} · {battery.name}</strong><small>{battery.model || "Model not recorded"} · {batteryStatusLabel(battery)}</small></span></label>)}{!choices.length && <p className="empty-hint">No matching batteries. Clear filters to review the inventory.</p>}</div><p className="field-hint">Save up to 100 batteries. Retired members remain recorded in the group and must be reviewed before a movement.</p></div>}
        {error && <p className="form-error" role="alert">{error}</p>}{storageError && <p className="form-error" role="alert">{storageError}</p>}{attempt && <div className="detail-card"><p>The original group request is preserved. Reopening with the same account and inventory restores it without automatically sending.</p><Button variant="outline" onClick={() => save(true)} disabled={busy || recovery.blocked || contextChanged}>Retry exact group request</Button></div>}
        <DialogFooter><Button variant="outline" onClick={mode === "list" ? onClose : () => { if (!locked) { setMode("list"); setError(""); } }} disabled={busy || !!storageError || mode !== "list" && locked}>{mode === "list" ? "Close" : "Back to groups"}</Button>{mode !== "list" && <Button onClick={() => save()} disabled={locked || mode === "edit" && (!form.name.trim() || !form.batteryIds.length || form.batteryIds.length > 100)}>{busy ? "Saving…" : mode === "remove" ? "Remove saved group" : form.expectedVersion ? "Save changes" : "Save new group"}</Button>}</DialogFooter>
    </DialogContent></Dialog>;
}
