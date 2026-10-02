"use client";

import { useEffect, useRef, useState } from "react";
import { CalendarDays, CheckCircle2, Download, Pencil, Plus, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import type { InventorySnapshot } from "@/lib/domain";
import type { TaskPlanRecord, TaskCycleRecord, TaskGenerationIssue } from "@/lib/task-plans";
import { taskPlanMatchesQuery, taskPlanSchema, taskSchedulePreview, taskTargetsByCategory, taskTemplates, type TaskPlan } from "@/lib/task-schedule";
import { currentSydneyDate } from "@/lib/battery-age";
import { downloadTaskJson, formatDateOnly, formatTime, reloadSessionPage, roomLabel, staffIdentityLabel } from "@/lib/client-utils";
import { isSelectableRoom } from "@/lib/location-catalog";
import { captureTaskCreate, recoverTaskCreate, taskCreateFailureStatus, taskCreateStorageKey, verifyTaskCreateReceipt, type TaskCreateAttempt } from "@/lib/task-create-session";

export type { TaskCycleRecord } from "@/lib/task-plans";
export type TaskPanelProps = { data: InventorySnapshot; onChanged?: () => void | Promise<void>; onDetail?: (batteryId: string) => void };
type TaskCapabilities = { schedulerAvailable: boolean; emailAvailable: boolean; messageGeneration: string; note: string };
type TaskPlansResponse = { plans: TaskPlanRecord[]; cycles: TaskCycleRecord[]; staffDirectory: InventorySnapshot["staffDirectory"]; capabilities: TaskCapabilities; generationIssues: TaskGenerationIssue[] };
type RequestError = Error & { status?: number; code?: string };

export const taskCategoryLabels: Record<TaskPlan["category"], string> = {
    storage_review: "Storage area review",
    inventory_reconciliation: "Inventory reconciliation",
    storage_maintenance: "Storage maintenance review",
};
const targetLabels: Record<TaskPlan["targetKind"], string> = { inventory: "Defined inventory", storage_area: "Storage area", model: "Battery model", group: "Defined group", batteries: "Selected batteries" };

export async function taskRequest<T>(url: string, options?: RequestInit): Promise<T> {
    const response = await fetch(url, { cache: "no-store", ...options });
    if (response.status === 401) reloadSessionPage("/signin");
    let body: T & { error?: string; code?: string };
    try { body = await response.json(); }
    catch { throw Object.assign(new Error("The response was interrupted. Your input is preserved; review the saved records before retrying."), { status: response.status }); }
    if (!response.ok) throw Object.assign(new Error(body.error || "The task operation could not be completed."), { status: response.status, code: body.code });
    return body;
}

export function useTaskEndpoint<T>(url: string, userId: string, source: unknown, paused = false) {
    const [revision, setRevision] = useState(0);
    const [saved, setSaved] = useState<{ url: string; userId: string; source: unknown; revision: number; payload: T | null; error: string } | null>(null);
    useEffect(() => {
        const abort = new AbortController();
        let active = true;
        const context = { url, userId, source, revision };
        taskRequest<T>(url, { signal: abort.signal }).then(payload => {
            if (active && !abort.signal.aborted) setSaved({ ...context, payload, error: "" });
        }).catch(error => {
            if (active && !abort.signal.aborted) setSaved({ ...context, payload: null, error: (error as Error).message });
        });
        return () => { active = false; abort.abort(); };
    }, [url, userId, source, revision]);
    const current = saved?.url === url && saved.userId === userId && saved.source === source && saved.revision === revision;
    const loading = !current;
    useEffect(() => {
        if (paused || loading) return;
        const refresh = () => { if (document.visibilityState === "visible") setRevision(value => value + 1); };
        const interval = setInterval(refresh, 15000);
        window.addEventListener("focus", refresh);
        return () => { clearInterval(interval); window.removeEventListener("focus", refresh); };
    }, [paused, loading]);
    return { payload: current ? saved.payload : null, error: current ? saved.error : "", loading, refresh: () => setRevision(value => value + 1) };
}

export function TaskDeliveryNotice() {
    return <div className="working-notice"><CalendarDays size={17}/><span><strong>Messages are generated while the system is in use.</strong> Unattended scheduling and email delivery are not connected. Email preferences are saved; no email is sent.</span></div>;
}

export function TaskGenerationWarnings({ issues }: { issues: TaskGenerationIssue[] }) {
    if (!issues.length) return null;
    return <div className="working-notice" role="alert"><CalendarDays size={17}/><div><strong>Some periodic tasks need administrator review.</strong><ul className="mt-1 list-disc pl-5">{issues.map(issue => <li key={issue.planId}>{issue.message}</li>)}</ul><p>Review these configurations before relying on their reminders; existing task and message history is retained.</p></div></div>;
}

export { downloadTaskJson } from "@/lib/client-utils";

function targetSummary(target: Pick<TaskPlan, "targetKind" | "targetRef" | "batteryIds">, data: InventorySnapshot) {
    if (target.targetKind === "batteries") return `${target.batteryIds.length} selected ${target.batteryIds.length === 1 ? "battery" : "batteries"}`;
    if (target.targetKind === "storage_area") return data.rooms.find(room => room.id === target.targetRef)?.name ?? target.targetRef ?? "Area not selected";
    return target.targetRef || targetLabels[target.targetKind];
}
function assignmentNames(ids: string[], data: InventorySnapshot) {
    return ids.map(id => { const person = data.staffDirectory.find(staff => staff.id === id); return staffIdentityLabel(person?.displayName || "Unavailable staff account", person?.username, id); }).join(", ") || "Not assigned";
}
function cycleState(cycle: TaskCycleRecord) {
    return cycle.status === "completed" ? "Completed" : cycle.dueOn < currentSydneyDate() ? "Open · overdue" : "Open";
}
function reminderLimitation(status: string) {
    return status === "ambiguous" ? "Reminder time is ambiguous during Sydney daylight saving; review the plan." : status === "nonexistent" ? "Reminder time does not exist during Sydney daylight saving; review the plan." : status === "unconfigured" ? "Reminder date or time is not configured." : null;
}

export function TaskPlansPanel({ data, onChanged, onDetail }: TaskPanelProps) {
    const [createRecovery] = useState(() => {
        try {
            const raw = sessionStorage.getItem(taskCreateStorageKey(data.user.id, data.dataset));
            const attempt = recoverTaskCreate(raw, data.user.id, data.dataset);
            return { attempt, error: raw && !attempt ? "A saved task creation request could not be recovered. New task creation is blocked. Preserve this tab and ask the administrator to investigate the saved request." : "" };
        } catch { return { attempt: null, error: "Browser storage is unavailable. New task creation is blocked until the submitted request can be preserved in this tab." }; }
    });
    const [draft, setDraft] = useState<TaskPlanRecord | TaskPlan | null>(createRecovery.attempt?.input.payload ?? null), [selectedCycle, setSelectedCycle] = useState<TaskCycleRecord | null>(null);
    const [query, setQuery] = useState(""), [notice, setNotice] = useState(""), [downloadBusy, setDownloadBusy] = useState(false);
    const resource = useTaskEndpoint<TaskPlansResponse>(`/api/task-plans?dataset=${data.dataset}`, data.user.id, data.events.map(event => event.id).join("|"), !!draft || !!selectedCycle);
    const admin = data.user.role === "admin", plans = resource.payload?.plans ?? [], cycles = resource.payload?.cycles ?? [];
    const matching = plans.filter(plan => taskPlanMatchesQuery(plan, query));
    const matchingPlanIds = new Set(matching.map(plan => plan.id)), matchingCycles = cycles.filter(cycle => matchingPlanIds.has(cycle.planId));
    async function changed() {
        resource.refresh();
        try { await onChanged?.(); }
        catch { setNotice("The task change was saved. Refresh the inventory if its shared status has not updated."); }
    }
    function create(template: typeof taskTemplates[number]) {
        if (createRecovery.error) return;
        setDraft({ ...template.plan, batteryIds: [...template.plan.batteryIds], assigneeIds: template.plan.category === "storage_maintenance" ? [] : [data.user.id], channels: [...template.plan.channels], scheduledDates: [...template.plan.scheduledDates] });
    }
    async function download() {
        setDownloadBusy(true); setNotice("");
        try { await downloadTaskJson(`/api/task-plans?${new URLSearchParams({ dataset: data.dataset, search: query, download: "json" })}`, `periodic-task-records-${data.dataset}.json`); }
        catch (error) { setNotice((error as Error).message); }
        finally { setDownloadBusy(false); }
    }
    return <><TaskDeliveryNotice/><TaskGenerationWarnings issues={resource.payload?.generationIssues ?? []}/>
        {createRecovery.error && <p className="form-error" role="alert">{createRecovery.error}</p>}
        <section className="inventory-panel"><div className="section-heading"><div><h2>Prepared periodic tasks</h2><p className="field-hint">Three supplied templates. Confirm actual applicability and dates before activating a plan.</p></div></div>
            <div className="grid gap-3 p-5 md:grid-cols-3">{taskTemplates.map(template => <div className="detail-card mb-0!" key={template.id}><h3>{template.label}</h3><p>{template.description}</p>{admin && <Button variant="outline" onClick={() => create(template)} disabled={resource.loading || !!createRecovery.error || !!draft}><Plus size={16}/>Use template</Button>}</div>)}</div>
        </section>
        <section className="inventory-panel"><div className="panel-top"><h2>Shared periodic plans</h2><div className="panel-actions"><Button variant="outline" onClick={resource.refresh} disabled={resource.loading}><RefreshCw size={16}/>Refresh tasks</Button><Button variant="outline" onClick={download} disabled={resource.loading || !!resource.error || !matching.length || downloadBusy}><Download size={16}/>{downloadBusy ? "Preparing…" : "Download filtered task records"}</Button></div></div>
            <div className="table-toolbar"><Input aria-label="Search periodic tasks" placeholder="Search task, category, target or status…" value={query} onChange={event => setQuery(event.target.value)} maxLength={200} disabled={downloadBusy}/><Button type="button" variant="outline" size="sm" onClick={() => setQuery("")} disabled={!query || resource.loading || downloadBusy}>Clear filters</Button><span>{resource.loading ? "Loading complete records…" : resource.error ? "Task records unavailable" : `${matching.length} matching ${matching.length === 1 ? "plan" : "plans"}`}</span></div>
            {notice && <p className="form-message px-5" role="status">{notice}</p>}
            {resource.error && <div className="load-error" role="alert"><span>{resource.error}</span><Button variant="outline" onClick={resource.refresh}>Retry tasks</Button></div>}
            {resource.loading ? <div className="loading-panel" role="status"><p>Loading shared plans and recorded cycles…</p><Skeleton className="h-24 w-full"/></div> : !resource.error && <>
                <Table><TableHeader><TableRow><TableHead>TASK / TARGET</TableHead><TableHead>STATUS</TableHead><TableHead>CURRENT DUE / REMINDER</TableHead><TableHead>ASSIGNMENT</TableHead><TableHead>ACTIONS</TableHead></TableRow></TableHeader><TableBody>{matching.map(plan => {
                    const open = cycles.find(cycle => cycle.planId === plan.id && cycle.status === "open");
                    const reminderOn = open ? open.reminderOn : plan.preview.nextReminderOn, reminderTime = open ? open.reminderTime : plan.preview.reminderTime;
                    return <TableRow key={plan.id}><TableCell><strong>{plan.title}</strong><span className="cell-secondary">{taskCategoryLabels[plan.category]} · {targetSummary(plan, data)}</span></TableCell><TableCell><span className={`status-badge ${plan.state === "active" ? "in" : "out"}`}>{plan.state === "active" ? "Active" : plan.state === "paused" ? "Paused" : "Draft"}</span></TableCell><TableCell><strong>{open ? formatDateOnly(open.dueOn) : plan.preview.nextDueOn ? formatDateOnly(plan.preview.nextDueOn) : "Not configured"}</strong><span className="cell-secondary">Reminder: {formatDateOnly(reminderOn)}{reminderTime ? ` at ${reminderTime} Sydney` : " · time not selected"}</span>{reminderLimitation(open?.reminderStatus ?? plan.preview.reminderStatus) && <span className="cell-secondary">{reminderLimitation(open?.reminderStatus ?? plan.preview.reminderStatus)}</span>}{open && <span className="cell-secondary">Recorded open cycle</span>}</TableCell><TableCell>{assignmentNames(plan.assigneeIds, data)}</TableCell><TableCell><div className="flex flex-wrap gap-2">{open && <Button variant="outline" size="sm" onClick={() => setSelectedCycle(open)}>Open task</Button>}{admin && <Button variant="ghost" size="sm" onClick={() => setDraft(plan)} aria-label={`Edit ${plan.title}`}><Pencil size={16}/>Edit</Button>}</div></TableCell></TableRow>;
                })}</TableBody></Table>
                {!matching.length && <div className="empty-state"><CalendarDays/><h3>{plans.length ? "No matching plans" : "No periodic plans saved"}</h3><p>{plans.length ? "Try another search." : "Use one of the supplied templates to prepare a draft."}</p></div>}
            </>}
            <div className="panel-footer">Plans and cycles are shared business records. Existing cycle deadlines and completion evidence are retained when a plan is edited.</div>
        </section>
        {!resource.loading && !resource.error && matchingCycles.length > 0 && <section className="inventory-panel mt-5"><div className="section-heading"><h2>Recorded task cycles</h2><span className="toolbar-meta">{matchingCycles.length} {matchingCycles.length === 1 ? "cycle" : "cycles"} · Sydney time</span></div><Table><TableHeader><TableRow><TableHead>TASK</TableHead><TableHead>DUE DATE</TableHead><TableHead>STATE</TableHead><TableHead>RECORDED COMPLETION</TableHead><TableHead>DETAILS</TableHead></TableRow></TableHeader><TableBody>{matchingCycles.map(cycle => <TableRow key={cycle.id}><TableCell><strong>{cycle.title}</strong><span className="cell-secondary">{taskCategoryLabels[cycle.category]}</span></TableCell><TableCell>{formatDateOnly(cycle.dueOn)}</TableCell><TableCell>{cycleState(cycle)}</TableCell><TableCell>{cycle.completedAt ? <>{formatTime(cycle.completedAt)}<span className="cell-secondary">{cycle.completedByName}</span></> : "Not completed"}</TableCell><TableCell><Button variant="outline" size="sm" onClick={() => setSelectedCycle(cycle)}>View task</Button></TableCell></TableRow>)}</TableBody></Table></section>}
        {draft && <TaskPlanEditor key={"id" in draft ? draft.id : `new-${draft.category}`} original={draft} data={data} cycles={cycles} onClose={() => setDraft(null)} onSaved={async () => { setDraft(null); await changed(); }}/>}
        {selectedCycle && <TaskCycleDialog cycle={selectedCycle} data={data} onDetail={onDetail} onClose={() => setSelectedCycle(null)} onSaved={async () => { setSelectedCycle(null); await changed(); }}/>}
    </>;
}

function TaskPlanEditor({ original, data, cycles, onClose, onSaved }: { original: TaskPlanRecord | TaskPlan; data: InventorySnapshot; cycles: TaskCycleRecord[]; onClose: () => void; onSaved: () => Promise<void> }) {
    const existing = "id" in original ? original : null;
    const storageKey = taskCreateStorageKey(data.user.id, data.dataset);
    const [recovery] = useState(() => {
        if (existing) return { attempt: null, error: "" };
        try {
            const raw = sessionStorage.getItem(storageKey), attempt = recoverTaskCreate(raw, data.user.id, data.dataset);
            return { attempt, error: raw && !attempt ? "The saved task creation request cannot be recovered. No new request will replace it; preserve this tab and ask the administrator to investigate." : "" };
        } catch { return { attempt: null, error: "Browser storage is unavailable. No task creation can be sent until its exact request can be preserved." }; }
    });
    const [draft, setDraft] = useState<TaskPlan>(() => recovery.attempt?.input.payload ?? taskPlanSchema.parse(original)), [expectedVersion, setExpectedVersion] = useState(existing?.version);
    const [busy, setBusy] = useState(false), [error, setError] = useState(recovery.error || recovery.attempt?.message || ""), [conflict, setConflict] = useState(false), [latest, setLatest] = useState<TaskPlanRecord | null>(null);
    const [creation, setCreation] = useState<TaskCreateAttempt | null>(recovery.attempt);
    const captured = useRef(creation), running = useRef(false);
    const attempt = useRef({ signature: "", requestId: "" });
    const [batterySearch, setBatterySearch] = useState(""), [datesText, setDatesText] = useState((recovery.attempt?.input.payload ?? original).scheduledDates.join("\n"));
    const [reviewedCycles, setReviewedCycles] = useState(cycles), [latestCycles, setLatestCycles] = useState<TaskCycleRecord[] | null>(null);
    const openCycle = existing ? reviewedCycles.find(cycle => cycle.planId === existing.id && cycle.status === "open") : undefined;
    const lastCycle = existing ? reviewedCycles.filter(cycle => cycle.planId === existing.id).sort((a, b) => b.dueOn.localeCompare(a.dueOn))[0] : undefined;
    const validation = taskPlanSchema.safeParse({ ...draft, scheduledDates: datesText.split(/[\s,;]+/).filter(Boolean) });
    const previewValidation = taskPlanSchema.safeParse({ ...draft, state: "draft", scheduledDates: datesText.split(/[\s,;]+/).filter(Boolean) });
    let preview: ReturnType<typeof taskSchedulePreview> | null = null, previewError = "";
    if (previewValidation.success) {
        try { preview = taskSchedulePreview(previewValidation.data, { lastDueOn: lastCycle?.dueOn, completedOn: lastCycle?.completedAt ? currentSydneyDate(new Date(lastCycle.completedAt)) : null }); }
        catch (error) { previewError = (error as Error).message; }
    }
    const rooms = data.rooms.filter(isSelectableRoom), models = [...new Set(data.batteries.map(battery => battery.model).filter(Boolean))].sort();
    const visibleBatteries = data.batteries.filter(battery => `${battery.id} ${battery.name} ${battery.model}`.toLowerCase().includes(batterySearch.toLowerCase()));
    const placeholderArea = draft.targetKind === "storage_area" && data.rooms.find(room => room.id === draft.targetRef)?.isPlaceholder;
    const activeBlockedByPlaceholder = data.dataset === "live" && draft.state === "active" && placeholderArea;
    const locked = busy || !!creation || !!recovery.error;
    useEffect(() => {
        if (!busy && creation?.status !== "uncertain") return;
        const protect = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
        window.addEventListener("beforeunload", protect);
        return () => window.removeEventListener("beforeunload", protect);
    }, [busy, creation?.status]);
    function persistCreation(next: TaskCreateAttempt | null) {
        try {
            if (next) {
                const raw = sessionStorage.getItem(storageKey);
                if (raw && !captured.current) throw new Error("An unresolved task creation is already saved in this tab. Reopen Periodic tasks to recover it before creating another plan.");
                sessionStorage.setItem(storageKey, JSON.stringify(next));
            } else sessionStorage.removeItem(storageKey);
            captured.current = next; setCreation(next);
            return true;
        } catch (error) { setError(`${(error as Error).message} Browser storage must preserve the original task request before another creation can be sent.`); return false; }
    }
    function close() {
        if (running.current || captured.current || recovery.error) return;
        onClose();
    }
    function reviewRejectedCreation() {
        if (running.current || captured.current?.status !== "rejected" || !persistCreation(null)) return;
        setError("The submitted task creation was rejected. Review its targets and assignments before submitting a new request.");
    }
    async function sendCreation(originalAttempt: TaskCreateAttempt, alreadyUncertain: boolean) {
        if (running.current || recovery.error) return;
        running.current = true; setBusy(true); setError("");
        const sending: TaskCreateAttempt = { ...originalAttempt, status: "uncertain", message: "Waiting for the server to confirm this exact task creation." };
        let saved = false;
        try {
            if (!persistCreation(sending)) return;
            const body = await taskRequest<{ ok: boolean; result: unknown }>("/api/task-plans", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(sending.input) });
            if (body.ok !== true) throw new Error("The task creation response could not be verified.");
            verifyTaskCreateReceipt(body.result, sending);
            if (!persistCreation(null)) return;
            saved = true;
            await onSaved();
        } catch (error) {
            if (saved) { setError("The task plan was saved. Refresh the task list if its shared status has not updated."); return; }
            const status = taskCreateFailureStatus(error, alreadyUncertain);
            const failed: TaskCreateAttempt = { ...sending, status, message: status === "uncertain" ? `Result uncertain. ${(error as Error).message} Retry the original request before editing or closing.` : (error as Error).message };
            if (!persistCreation(failed)) { captured.current = failed; setCreation(failed); }
            setError(failed.message);
        } finally { running.current = false; setBusy(false); }
    }
    function update(patch: Partial<TaskPlan>, reconfirm = true) { if (running.current || captured.current || recovery.error) return; setDraft(previous => ({ ...previous, ...patch, ...(reconfirm ? { applicabilityConfirmed: false } : {}) })); }
    function toggleId(key: "batteryIds" | "assigneeIds", id: string, checked: boolean) { update({ [key]: checked ? [...new Set([...draft[key], id])] : draft[key].filter(value => value !== id) }); }
    function assignOwners() {
        const targets = ["batteries", "group"].includes(draft.targetKind) ? data.batteries.filter(battery => draft.batteryIds.includes(battery.id)) : draft.targetKind === "model" ? data.batteries.filter(battery => battery.model === draft.targetRef) : draft.targetKind === "storage_area" ? data.batteries.filter(battery => battery.homeRoomId === draft.targetRef) : draft.targetKind === "inventory" ? data.batteries : [];
        update({ assigneeIds: [...new Set(targets.flatMap(battery => battery.ownerAccountId && data.staffDirectory.some(staff => staff.id === battery.ownerAccountId && staff.active) ? [battery.ownerAccountId] : []))] });
    }
    async function save(event: React.FormEvent) {
        event.preventDefault();
        if (running.current || captured.current || recovery.error) return;
        setError("");
        if (!validation.success) { setError(validation.error.issues.map(issue => issue.message).join(" ")); return; }
        if (previewError) { setError(previewError); return; }
        if (draft.state === "active" && preview && ["ambiguous", "nonexistent"].includes(preview.reminderStatus)) { setError("Choose a reminder time that is valid and unambiguous in Sydney before activation."); return; }
        if (activeBlockedByPlaceholder) { setError("Confirm the actual storage area before activating a working-inventory plan. This room is a placeholder."); return; }
        if (!existing) {
            try { await sendCreation(captureTaskCreate(validation.data, data.user.id, data.dataset, crypto.randomUUID()), false); }
            catch (error) { setError((error as Error).message); }
            return;
        }
        running.current = true; setBusy(true);
        try {
            const input = { dataset: data.dataset, action: existing ? "update" : "create", payload: { ...validation.data, ...(existing ? { id: existing.id, expectedVersion } : {}) } };
            const signature = JSON.stringify(input);
            if (attempt.current.signature !== signature) attempt.current = { signature, requestId: crypto.randomUUID() };
            await taskRequest("/api/task-plans", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...input, requestId: attempt.current.requestId }) });
            await onSaved();
        } catch (error) { setError((error as Error).message); if ((error as RequestError).status === 409) setConflict(true); }
        finally { running.current = false; setBusy(false); }
    }
    async function loadLatest() {
        if (!existing) return;
        setBusy(true);
        try {
            const body = await taskRequest<TaskPlansResponse>(`/api/task-plans?dataset=${data.dataset}`);
            const plan = body.plans.find(plan => plan.id === existing.id);
            if (!plan) throw new Error("This plan is no longer available. Your draft is preserved.");
            setLatest(plan); setLatestCycles(body.cycles);
        } catch (error) { setError((error as Error).message); }
        finally { setBusy(false); }
    }
    function acceptLatest() {
        if (!latest) return;
        setDraft(taskPlanSchema.parse(latest)); setDatesText(latest.scheduledDates.join("\n")); setExpectedVersion(latest.version); if (latestCycles) setReviewedCycles(latestCycles); setLatestCycles(null); setLatest(null); setConflict(false); setError("");
    }
    return <Dialog open onOpenChange={open => !open && close()}><DialogContent className="record-dialog" showCloseButton={!busy && !creation && !recovery.error} onEscapeKeyDown={event => { if (running.current || captured.current || recovery.error) event.preventDefault(); }} onInteractOutside={event => { if (running.current || captured.current || recovery.error) event.preventDefault(); }}><DialogHeader><DialogTitle>{existing ? "Edit periodic task" : "Prepare periodic task"}</DialogTitle><DialogDescription>{taskCategoryLabels[draft.category]}. Supplied timing is provisional until its basis and applicability are confirmed.</DialogDescription></DialogHeader>
        <form className="form-stack" onSubmit={save}>
            <div className="form-field"><Label htmlFor="task-title">Task title</Label><Input id="task-title" value={draft.title} onChange={event => update({ title: event.target.value })} maxLength={160} required disabled={locked}/></div>
            <div className="form-field"><Label htmlFor="task-description">What must be done</Label><Textarea id="task-description" value={draft.description} onChange={event => update({ description: event.target.value })} maxLength={4000} disabled={locked}/></div>
            <div className="form-field"><Label htmlFor="task-basis">Applicable instruction or management basis</Label><Textarea id="task-basis" value={draft.basis} onChange={event => update({ basis: event.target.value })} maxLength={2000} disabled={locked}/></div>
            <div className="form-field"><Label>Applies to</Label><Select value={draft.targetKind} onValueChange={value => update({ targetKind: value as TaskPlan["targetKind"], targetRef: null, batteryIds: [] })} disabled={locked}><SelectTrigger aria-label="Periodic task target"><SelectValue/></SelectTrigger><SelectContent>{taskTargetsByCategory[draft.category].map(id => <SelectItem key={id} value={id}>{targetLabels[id]}</SelectItem>)}</SelectContent></Select></div>
            {draft.targetKind === "storage_area" && <div className="form-field"><Label>Storage area</Label><Select value={draft.targetRef ?? "__unset"} onValueChange={value => update({ targetRef: value === "__unset" ? null : value })} disabled={locked}><SelectTrigger aria-label="Periodic task storage area"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="__unset">Area not selected</SelectItem>{rooms.map(room => <SelectItem key={room.id} value={room.id}>{roomLabel(room)}</SelectItem>)}</SelectContent></Select>{placeholderArea && <p className="field-hint">{data.dataset === "demo" ? "This is a demonstration placeholder, suitable only for a labelled prototype task." : "This area is a placeholder. Working-inventory activation requires a confirmed actual storage area."}</p>}</div>}
            {draft.targetKind === "model" && <div className="form-field"><Label>Registered battery model</Label><Select value={draft.targetRef ?? "__unset"} onValueChange={value => update({ targetRef: value === "__unset" ? null : value })} disabled={locked}><SelectTrigger aria-label="Periodic task model"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="__unset">Model not selected</SelectItem>{models.map(model => <SelectItem key={model} value={model}>{model}</SelectItem>)}</SelectContent></Select>{!models.length && <p className="field-hint">No models are recorded yet. Keep this plan as a draft.</p>}</div>}
            {draft.targetKind === "group" && <div className="form-field"><Label htmlFor="task-group">Defined group name</Label><Input id="task-group" value={draft.targetRef ?? ""} onChange={event => update({ targetRef: event.target.value || null })} maxLength={120} disabled={locked}/><p className="field-hint">Select the registered batteries belonging to this group below; a name alone does not define membership or applicability.</p></div>}
            {["batteries", "group"].includes(draft.targetKind) && <fieldset className="detail-card"><legend className="text-sm font-semibold">Registered batteries · {draft.batteryIds.length} selected</legend><Input aria-label="Find task batteries" placeholder="Search registered battery ID, name or model…" value={batterySearch} onChange={event => setBatterySearch(event.target.value)} disabled={locked}/><div className="my-2 flex flex-wrap gap-2"><Button type="button" variant="outline" size="sm" onClick={() => setBatterySearch("")} disabled={!batterySearch || locked}>Clear filters</Button><Button type="button" variant="outline" size="sm" onClick={() => update({ batteryIds: [...new Set([...draft.batteryIds, ...visibleBatteries.map(battery => battery.id)])] })} disabled={locked || !visibleBatteries.length || new Set([...draft.batteryIds, ...visibleBatteries.map(battery => battery.id)]).size > 100}>Select filtered batteries</Button><Button type="button" variant="ghost" size="sm" onClick={() => update({ batteryIds: [] })} disabled={locked}>Clear battery selection</Button></div><div className="max-h-44 overflow-y-auto">{visibleBatteries.map(battery => <label className="export-option" key={battery.id}><Checkbox checked={draft.batteryIds.includes(battery.id)} onCheckedChange={value => toggleId("batteryIds", battery.id, value === true)} disabled={locked || !draft.batteryIds.includes(battery.id) && draft.batteryIds.length >= 100}/><span><strong>{battery.id} · {battery.name}</strong><small>{battery.model || "Model not recorded"}</small></span></label>)}{!visibleBatteries.length && <p className="field-hint">No matching registered batteries.</p>}</div><p className="field-hint">Explicit battery and group selections support up to 100 batteries. A model-based plan can cover the applicable registered model without individually selecting its batteries.</p></fieldset>}
            <div className="form-field"><Label htmlFor="task-scope">Scope and applicability</Label><Textarea id="task-scope" value={draft.scopeNote} onChange={event => update({ scopeNote: event.target.value })} maxLength={2000} disabled={locked} placeholder="Describe the actual area, inventory or assets covered, and why this requirement applies."/></div>
            <fieldset className="detail-card"><legend className="text-sm font-semibold">Assigned staff</legend><p className="field-hint">Existing staff accounts; one actual completion closes the shared cycle for all assignees.</p><Button type="button" variant="outline" size="sm" onClick={assignOwners} disabled={locked}>Use responsible owners</Button><div className="max-h-44 overflow-y-auto">{data.staffDirectory.filter(staff => staff.active || draft.assigneeIds.includes(staff.id)).map(staff => <label className="export-option" key={staff.id}><Checkbox checked={draft.assigneeIds.includes(staff.id)} onCheckedChange={value => toggleId("assigneeIds", staff.id, value === true)} disabled={locked || !staff.active && !draft.assigneeIds.includes(staff.id)}/><span><strong>{staffIdentityLabel(staff.displayName, staff.username, staff.id)}</strong><small>{staff.active ? staff.id === data.user.id ? "Your account" : "Active staff account" : "Disabled account; remove or reassign before activation"}</small></span></label>)}</div>{draft.assigneeIds.some(id => !data.staffDirectory.some(staff => staff.id === id)) && <p className="form-error">An assigned account is unavailable. Use responsible owners or choose reviewed staff assignments to replace it.</p>}</fieldset>
            <fieldset className="detail-card"><legend className="text-sm font-semibold">Task due rule</legend><div className="form-field"><Label>Recurrence</Label><Select value={draft.recurrenceBasis} onValueChange={value => update({ recurrenceBasis: value as TaskPlan["recurrenceBasis"] })} disabled={locked}><SelectTrigger aria-label="Task recurrence basis"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="calendar">Fixed calendar interval</SelectItem><SelectItem value="completion">Interval after actual completion</SelectItem><SelectItem value="dates">Explicit due dates</SelectItem></SelectContent></Select></div>{draft.recurrenceBasis === "dates" ? <div className="form-field mt-3"><Label htmlFor="task-dates">Confirmed due dates</Label><Textarea id="task-dates" value={datesText} onChange={event => { setDatesText(event.target.value); update({}); }} placeholder="YYYY-MM-DD, one per line" disabled={locked}/><p className="field-hint">Enter actual teaching-period review dates. No university dates are inferred.</p></div> : <div className="form-grid"><div className="form-field full-width"><Label htmlFor="task-first-date">First due date / calendar anchor</Label><Input id="task-first-date" type="date" value={draft.firstDueOn ?? ""} onChange={event => update({ firstDueOn: event.target.value || null })} disabled={locked}/></div><div className="form-field"><Label htmlFor="task-interval">Repeat every</Label><Input id="task-interval" type="number" min={1} max={120} step={1} value={draft.interval} onChange={event => update({ interval: Number(event.target.value) })} disabled={locked}/></div><div className="form-field"><Label>Calendar unit</Label><Select value={draft.unit} onValueChange={value => update({ unit: value as TaskPlan["unit"] })} disabled={locked}><SelectTrigger aria-label="Task recurrence unit"><SelectValue/></SelectTrigger><SelectContent>{["days", "weeks", "months", "years"].map(unit => <SelectItem key={unit} value={unit}>{unit}</SelectItem>)}</SelectContent></Select></div></div>}<p className="field-hint">Months and years use calendar dates. Six months is not converted to 180 days.</p></fieldset>
            <fieldset className="detail-card"><legend className="text-sm font-semibold">Reminder rule · Australia/Sydney</legend><div className="form-grid"><div className="form-field"><Label htmlFor="task-reminder-advance">Calendar days before due</Label><Input id="task-reminder-advance" type="number" min={0} max={365} step={1} value={draft.reminderDaysBefore} onChange={event => update({ reminderDaysBefore: Number(event.target.value) })} disabled={locked}/></div><div className="form-field"><Label htmlFor="task-reminder-time">Reminder time</Label><Input id="task-reminder-time" type="time" value={draft.reminderTime ?? ""} onChange={event => update({ reminderTime: event.target.value || null })} disabled={locked}/></div></div><p className="field-hint">Choose the local time explicitly. Changing reminder settings does not change the task due date.</p><label className="export-option"><Checkbox checked disabled/><span><strong>Messages</strong><small>Required persistent inbox channel</small></span></label><label className="export-option"><Checkbox checked={draft.channels.includes("email")} onCheckedChange={value => update({ channels: value === true ? ["messages", "email"] : ["messages"] }, false)} disabled={locked}/><span><strong>Prefer email too</strong><small>Email delivery is unavailable; this saves a preference and does not send an email.</small></span></label></fieldset>
            <div className="detail-card"><h3>Schedule preview · Sydney</h3>{openCycle && <p><strong>Recorded open cycle:</strong> due {formatDateOnly(openCycle.dueOn)}; reminder {formatDateOnly(openCycle.reminderOn)} {openCycle.reminderTime || "time unavailable"}. Its recorded deadline remains unchanged.</p>}<div className="key-value"><span>Next due</span><strong>{preview?.nextDueOn ? formatDateOnly(preview.nextDueOn) : preview?.calculationRule === "awaiting_actual_completion" ? "After the current task is completed" : "Not configured"}</strong></div><div className="key-value"><span>Next reminder</span><strong>{preview?.nextReminderOn ? `${formatDateOnly(preview.nextReminderOn)}${preview.reminderTime ? ` at ${preview.reminderTime}` : " · choose a time"}` : "Not configured"}</strong></div>{preview && ["ambiguous", "nonexistent"].includes(preview.reminderStatus) && <p className="form-error">This reminder time is {preview.reminderStatus === "ambiguous" ? "ambiguous" : "unavailable"} during a Sydney daylight-saving transition. Choose another time before activation.</p>}{previewError && <p className="form-error">{previewError}</p>}<p>Messages are generated while the system is in use; unattended scheduling is unavailable.</p></div>
            {openCycle && <p className="field-hint">The preview estimates a future cycle. The current cycle must be completed first; its actual completion date can change the next due date.</p>}
            <div className="form-field"><Label>Plan status</Label><Select value={draft.state} onValueChange={value => update({ state: value as TaskPlan["state"] }, false)} disabled={locked}><SelectTrigger aria-label="Periodic plan status"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="draft">Draft · no reminders</SelectItem><SelectItem value="active">Active · generate Messages while in use</SelectItem><SelectItem value="paused">Paused · stop future reminder generation</SelectItem></SelectContent></Select></div>
            <label className="export-option"><Checkbox checked={draft.applicabilityConfirmed} onCheckedChange={value => update({ applicabilityConfirmed: value === true }, false)} disabled={locked}/><span><strong>Confirm the plan before activation</strong><small>I have confirmed its basis, applicability, targets, dates, reminder time and staff assignments. {data.dataset === "demo" ? "This is a labelled demonstration configuration." : "Placeholder locations do not establish actual storage areas."}</small></span></label>
            {existing && <p className="field-hint">Edits retain the current cycle&apos;s recorded content, due date and history. Assignment and plan state affect future reminder routing.</p>}
            {!validation.success && draft.state === "active" && <p className="field-hint">Activation needs: {validation.error.issues.map(issue => issue.message).join(" ")}</p>}
            {error && <div><p className="form-error" role="alert">{error}</p>{conflict && existing && <><p className="field-hint">Your draft is preserved. Load and review the latest saved task before replacing this draft.</p><Button type="button" variant="outline" onClick={loadLatest} disabled={locked}>Load latest saved task</Button></>}</div>}
            {latest && <div className="detail-card"><h3>Latest saved version {latest.version}</h3><p>{latest.title} · {latest.state} · {assignmentNames(latest.assigneeIds, data)}</p><p>First due: {formatDateOnly(latest.firstDueOn)} · Reminder time: {latest.reminderTime || "Not selected"}</p><Button type="button" variant="outline" onClick={acceptLatest} disabled={locked}>Replace draft with latest saved task</Button></div>}
            {creation && <div className="detail-card" role="status"><h3>{creation.status === "uncertain" ? "Unconfirmed task creation" : "Rejected task creation"}</h3><p>{creation.status === "uncertain" ? "The submitted plan and request identifier are preserved in this tab. Retry that exact request before editing, closing or preparing another task. Reopening Periodic tasks after a reload restores this request." : "The rejected request is preserved. Return to the draft to review its targets and assignments before creating a new request."}</p><p>Request: {creation.input.requestId}</p></div>}
            <DialogFooter><Button type="button" variant="outline" onClick={close} disabled={locked}>Cancel</Button>{creation?.status === "uncertain" ? <Button type="button" onClick={() => void sendCreation(creation, true)} disabled={busy || data.user.role !== "admin"}>{busy ? "Checking…" : "Retry original task creation"}</Button> : creation?.status === "rejected" ? <Button type="button" variant="outline" onClick={reviewRejectedCreation} disabled={busy}>Return to task draft</Button> : <Button type="submit" disabled={locked || conflict || data.user.role !== "admin"}>{busy ? "Saving…" : existing ? "Save task plan" : "Create task plan"}</Button>}</DialogFooter>
        </form>
    </DialogContent></Dialog>;
}

export function TaskCycleDialog({ cycle, data, onClose, onSaved, onDetail }: { cycle: TaskCycleRecord; data: InventorySnapshot; onClose: () => void; onSaved: () => Promise<void>; onDetail?: (batteryId: string) => void }) {
    const [reviewed, setReviewed] = useState(cycle), [notes, setNotes] = useState(""), [confirmed, setConfirmed] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(""), [conflict, setConflict] = useState(false), [latest, setLatest] = useState<TaskCycleRecord | null>(null);
    const attempt = useRef({ signature: "", requestId: "" });
    const snapshotBatteries = Array.isArray(reviewed.targetSnapshot.batteries) ? reviewed.targetSnapshot.batteries.flatMap(item => item && typeof item === "object" && "id" in item && typeof item.id === "string" ? [{ id: item.id, name: "name" in item && typeof item.name === "string" ? item.name : "" }] : []) : reviewed.batteryIds.map(id => ({ id, name: "" }));
    const room = reviewed.targetSnapshot.room;
    const recordedTarget = room && typeof room === "object" && "name" in room && typeof room.name === "string" ? room.name : targetSummary(reviewed, data);
    async function complete() {
        setBusy(true); setError("");
        try {
            const input = { dataset: data.dataset, action: "complete", payload: { cycleId: reviewed.id, expectedVersion: reviewed.version, notes } };
            const signature = JSON.stringify(input);
            if (attempt.current.signature !== signature) attempt.current = { signature, requestId: crypto.randomUUID() };
            await taskRequest("/api/task-plans", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...input, requestId: attempt.current.requestId }) }); await onSaved();
        }
        catch (error) { setError((error as Error).message); if ((error as RequestError).status === 409) setConflict(true); }
        finally { setBusy(false); }
    }
    async function reload() {
        setBusy(true);
        try { const body = await taskRequest<TaskPlansResponse>(`/api/task-plans?dataset=${data.dataset}`); const found = body.cycles.find(item => item.id === reviewed.id); if (!found) throw new Error("This recorded task is unavailable. Your notes are preserved."); setLatest(found); }
        catch (error) { setError((error as Error).message); }
        finally { setBusy(false); }
    }
    return <Dialog open onOpenChange={open => !open && !busy && onClose()}><DialogContent className="record-dialog"><DialogHeader><DialogTitle>{reviewed.title}</DialogTitle><DialogDescription>{taskCategoryLabels[reviewed.category]} · {cycleState(reviewed)}</DialogDescription></DialogHeader>
        <div className="detail-card"><h3>Recorded task requirements</h3><p className="whitespace-pre-wrap">{reviewed.description}</p><p><strong>Basis:</strong> {reviewed.basis}</p><p><strong>Recorded target:</strong> {recordedTarget}</p><p><strong>Scope:</strong> {reviewed.scopeNote || recordedTarget}</p><p><strong>Assigned staff:</strong> {assignmentNames(reviewed.currentAssigneeIds, data)}</p><p><strong>Due:</strong> {formatDateOnly(reviewed.dueOn)} · <strong>Reminder:</strong> {formatDateOnly(reviewed.reminderOn)} {reviewed.reminderTime || "time unavailable"} Sydney</p>{reminderLimitation(reviewed.reminderStatus) && <p className="form-error">{reminderLimitation(reviewed.reminderStatus)}</p>}{snapshotBatteries.length > 0 && <><p>Registered assets recorded when this cycle was created:</p><div className="mt-3 flex max-h-44 flex-wrap gap-2 overflow-y-auto">{snapshotBatteries.map(({ id, name }) => onDetail ? <Button key={id} variant="outline" size="sm" onClick={() => onDetail(id)} title={name}>{id}</Button> : <span key={id}>{id}{name ? ` · ${name}` : ""}</span>)}</div></>}</div>
        {reviewed.status === "completed" ? <div className="detail-card"><h3><CheckCircle2 size={17}/>Recorded completion</h3><p>{formatTime(reviewed.completedAt)} · {reviewed.completedByName}</p><p className="whitespace-pre-wrap">{reviewed.completionNotes || "No completion notes."}</p></div> : reviewed.canComplete ? <div className="form-stack"><div className="form-field"><Label htmlFor="task-completion-notes">Completion notes (optional)</Label><Textarea id="task-completion-notes" aria-describedby="task-completion-notes-hint" value={notes} onChange={event => { setNotes(event.target.value); setConfirmed(false); }} maxLength={2000} disabled={busy} placeholder="Add findings or follow-up actions, if needed."/><p id="task-completion-notes-hint" className="field-hint">You can leave this blank. Maximum 2,000 characters.</p></div><label className="export-option"><Checkbox checked={confirmed} onCheckedChange={value => setConfirmed(value === true)} disabled={busy}/><span><strong>I have completed this task.</strong><small>Completion records the actual task review; it is not a battery safety certification.</small></span></label>{!busy && !conflict && <p className="field-hint" role="status">{!confirmed ? "Tick the confirmation above to enable Record completion. Editing notes clears this confirmation." : "Ready to record completion."}</p>}</div> : <p className="field-hint">Only a currently assigned staff member or an administrator can record this task&apos;s completion.</p>}
        {error && <div><p className="form-error" role="alert">{error}</p>{conflict && <><p className="field-hint">Your notes are preserved. Review the latest task state before completing this cycle.</p><Button variant="outline" onClick={reload} disabled={busy}>Load latest task state</Button></>}</div>}
        {latest && <div className="detail-card"><h3>Latest recorded task state</h3><p>{latest.title} · {cycleState(latest)} · due {formatDateOnly(latest.dueOn)}</p><p>Assigned staff: {assignmentNames(latest.currentAssigneeIds, data)}</p><Button variant="outline" onClick={() => { setReviewed(latest); setLatest(null); setConflict(false); setConfirmed(false); setError(""); }} disabled={busy}>Accept reviewed task state</Button></div>}
        <p className="field-hint">Marking a message as read does not complete this task. Recorded deadlines and prior completion evidence remain available.</p>
        <DialogFooter><Button variant="outline" onClick={onClose} disabled={busy}>Close</Button>{reviewed.status !== "completed" && reviewed.canComplete && <Button onClick={complete} disabled={busy || conflict || !confirmed}>{busy ? "Saving…" : "Record completion"}</Button>}</DialogFooter>
    </DialogContent></Dialog>;
}
