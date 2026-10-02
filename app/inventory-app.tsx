"use client";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { flushSync } from "react-dom";
import { Battery, Package, ScanLine, RotateCcw, Radio, FlaskConical, ClipboardList, Settings2, RefreshCw, X, UserRound, Users, LogOut, CalendarDays, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { SidebarProvider, Sidebar, SidebarHeader, SidebarContent, SidebarGroup, SidebarGroupLabel, SidebarMenu, SidebarMenuItem, SidebarMenuButton, SidebarFooter, SidebarInset, SidebarTrigger, useSidebar } from "@/components/ui/sidebar";
import { MovementDialog, type MovementDraft, type WriteAction } from "@/components/inventory/movement-dialog";
import { RecordEditor, type EditorDraft } from "@/components/inventory/record-editor";
import { BatteryDetails } from "@/components/inventory/battery-detail";
import { ImportDialog } from "@/components/inventory/import-dialog";
import { InventoryTable, RecordManagement, ActivityHistory, type ImportKind } from "@/components/inventory/views";
import type { Dataset, InventorySnapshot } from "@/lib/domain";
import { defaultInventoryFilter } from "@/lib/inventory-query";
import { registerInventoryTools } from "@/lib/browser-tools";
import type { StaffUser } from "@/lib/accounts";
import { MyAccount, AccountManagement } from "@/components/inventory/accounts-panel";
import { signOut } from "@/lib/client-session";
import { ExportDialog, type ExportDraft } from "@/components/inventory/export-dialog";
import { reloadSessionPage } from "@/lib/client-utils";
import { TaskPlansPanel } from "@/components/inventory/task-plans-panel";
import { MessagesPanel } from "@/components/inventory/messages-panel";
import { ScanStation } from "@/components/inventory/scan-station";
import { recoverScanSession } from "@/lib/scan-session";
import { movementStorageKey, recoverMovementAttempt, verifyMovementReceipt, type MovementPayload } from "@/lib/movement-session";
type View = "inventory" | "my-batteries" | "my-loans" | "my-activity" | "messages" | "task-plans" | "activity" | "manage" | "account" | "accounts";
function subscribeScanRecovery(onChange: () => void) {
    window.addEventListener("storage", onChange);
    window.addEventListener("focus", onChange);
    window.addEventListener("battery-movement-recovery", onChange);
    return () => { window.removeEventListener("storage", onChange); window.removeEventListener("focus", onChange); window.removeEventListener("battery-movement-recovery", onChange); };
}
async function responseBody<T = unknown>(response: Response): Promise<T> {
    let body: T & {
        error?: string;
        code?: string;
    };
    try {
        body = await response.json() as T & {
            error?: string;
        };
    }
    catch {
        throw new Error("The server response was interrupted. Retry with your existing input.");
    }
    if (response.status === 401) reloadSessionPage("/signin");
    if (!response.ok)
        throw Object.assign(new Error(body.error || "The inventory could not complete this operation."), { status: response.status, code: body.code });
    return body;
}
function InventoryNavigationButton({ onClick, ...props }: React.ComponentProps<typeof SidebarMenuButton>) {
    const { isMobile, setOpenMobile } = useSidebar();
    return <SidebarMenuButton {...props} onClick={event => {
        if (isMobile) setOpenMobile(false);
        onClick?.(event);
    }}/>;
}
export default function InventoryApp({ initialUser }: { initialUser: StaffUser }) {
    const [user, setUser] = useState(initialUser);
    const [exportDraft, setExportDraft] = useState<ExportDraft | null>(null);
    const [dataset, setDataset] = useState<Dataset>(initialUser.defaultDataset), [data, setData] = useState<InventorySnapshot | null>(null);
    const [loading, setLoading] = useState(true), [error, setError] = useState(""), [notice, setNotice] = useState("");
    const [revision, setRevision] = useState(0), [view, setView] = useState<View>("inventory");
    const [messageCounts, setMessageCounts] = useState<Record<string, number | null>>({});
    const messageContext = `${dataset}-${user.id}`;
    const acceptUnreadCount = useCallback((count: number) => setMessageCounts(previous => previous[messageContext] === count ? previous : { ...previous, [messageContext]: count }), [messageContext]);
    const [movement, setMovement] = useState<MovementDraft | null>(null), [editor, setEditor] = useState<EditorDraft | null>(null);
    const [scan, setScan] = useState<{ kind: "checkout" | "return"; nonce: string } | null>(null);
    const readPendingScans = useCallback(() => {
        const pending: { dataset: Dataset; kind: "checkout" | "return" }[] = [];
        try {
            for (const mode of ["demo", "live"] as const) for (const kind of ["checkout", "return"] as const) {
                if (recoverScanSession(sessionStorage.getItem(`battery-scan:${user.id}:${mode}:${kind}`), kind)) pending.push({ dataset: mode, kind });
            }
        } catch { /* The station reports any browser-storage limitation when opened. */ }
        return JSON.stringify(pending);
    }, [user.id]);
    const pendingScans = JSON.parse(useSyncExternalStore(subscribeScanRecovery, readPendingScans, () => "[]")) as { dataset: Dataset; kind: "checkout" | "return" }[];
    const readPendingMovements = useCallback(() => {
        const pending: { dataset: Dataset; kind: "checkout" | "return" }[] = [];
        try {
            for (const mode of ["demo", "live"] as const) for (const kind of ["checkout", "return"] as const) {
                if (recoverMovementAttempt(sessionStorage.getItem(movementStorageKey(user.id, mode, kind)), user.id, mode, kind)) pending.push({ dataset: mode, kind });
            }
        } catch { /* A movement cannot be submitted unless its recovery data can be saved. */ }
        return JSON.stringify(pending);
    }, [user.id]);
    const pendingMovements = JSON.parse(useSyncExternalStore(subscribeScanRecovery, readPendingMovements, () => "[]")) as { dataset: Dataset; kind: "checkout" | "return" }[];
    const [detailId, setDetailId] = useState<string | null>(null), [importKind, setImportKind] = useState<ImportKind | null>(null);
    const current = useRef<InventorySnapshot | null>(null);
    const loadSequence = useRef(0);
    useEffect(() => { current.current = data; }, [data]);
    const load = useCallback(async (mode: Dataset, signal?: AbortSignal, initialize = false) => {
        const sequence = ++loadSequence.current;
        if (initialize && mode === "demo")
            await responseBody(await fetch("/api/inventory", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dataset: mode, action: "initialize_demo" }), signal }));
        const snapshot = await responseBody<InventorySnapshot>(await fetch(`/api/inventory?dataset=${mode}`, { signal, cache: "no-store" }));
        if (signal?.aborted || sequence !== loadSequence.current)
            return;
        if (JSON.stringify(snapshot) !== JSON.stringify(current.current)) {
            current.current = snapshot; setData(snapshot); setRevision(r => r + 1);
        }
        setUser(snapshot.user); setError("");
    }, []);
    useEffect(() => {
        const abort = new AbortController();
        load(dataset, abort.signal, true).catch(e => { if (e.name !== "AbortError")
            setError(e.message); }).finally(() => { if (!abort.signal.aborted)
            setLoading(false); });
        return () => abort.abort();
    }, [dataset, load]);
    function changeDataset(mode: Dataset) { loadSequence.current++; setLoading(true); setData(null); setError(""); setNotice(""); current.current = null; setDataset(mode); }
    async function refresh() { setLoading(true); try {
        await load(dataset, undefined, !data);
    }
    catch (e) {
        setError((e as Error).message);
    }
    finally {
        setLoading(false);
    } }
    const write: WriteAction = async (action, payload, extra = {}) => {
        const body = await responseBody<{
            result: Record<string, unknown>;
        }>(await fetch("/api/inventory", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dataset, action, payload, ...extra }) }));
        if (action === "scan_lookup") return body.result;
        if (action === "movement") verifyMovementReceipt(body.result, payload as MovementPayload, user.id);
        setRevision(r => r + 1);
        try {
            await load(dataset);
            if (!scan) setNotice(action === "movement" ? `${body.result.count} ${body.result.count === 1 ? "battery" : "batteries"} ${body.result.kind === "checkout" ? "checked out" : "returned"}.` : "Record saved. The audit history has been updated.");
        }
        catch {
            setError("The change was saved, but the inventory could not refresh. Refresh before starting another operation.");
            if (!scan) setNotice("Your change was saved successfully.");
        }
        return body.result;
    };
    const modalOpen = !!(scan || movement || editor || detailId || importKind || exportDraft), ready = !!data && !loading && !error;
    function resumeMovement(pending: { dataset: Dataset; kind: "checkout" | "return" }) {
        if (modalOpen) return;
        if (pending.dataset !== dataset) changeDataset(pending.dataset);
        setNotice(""); setMovement({ kind: pending.kind, ids: [], nonce: crypto.randomUUID() });
    }
    function resumeScan(pending: { dataset: Dataset; kind: "checkout" | "return" }) {
        if (modalOpen) return;
        if (pending.dataset !== dataset) changeDataset(pending.dataset);
        setNotice(""); setScan({ kind: pending.kind, nonce: crypto.randomUUID() });
    }
    function startMovement(kind: "checkout" | "return", ids: string[] = []) {
        if (modalOpen) return;
        const savedMovement = JSON.parse(readPendingMovements())[0];
        if (savedMovement) { resumeMovement(savedMovement); return; }
        const savedScan = JSON.parse(readPendingScans())[0];
        if (savedScan) { resumeScan(savedScan); return; }
        setNotice(""); setMovement({ kind, ids, nonce: crypto.randomUUID() });
    }
    function startScan(kind: "checkout" | "return") {
        if (modalOpen) return;
        const savedMovement = JSON.parse(readPendingMovements())[0];
        if (savedMovement) { resumeMovement(savedMovement); return; }
        const savedScan = JSON.parse(readPendingScans())[0];
        if (savedScan) { resumeScan(savedScan); return; }
        setNotice(""); setScan({ kind, nonce: crypto.randomUUID() });
    }
    useEffect(() => registerInventoryTools(() => current.current, draft => {
        if (modalOpen) throw new Error("Finish or close the current workflow before preparing another movement.");
        if (JSON.parse(readPendingMovements()).length || JSON.parse(readPendingScans()).length)
            throw new Error("Resume the unfinished checkout, return or scanning session before preparing another movement.");
        flushSync(() => setMovement(draft));
    }), [modalOpen, readPendingMovements, readPendingScans]);
    useEffect(() => {
        async function sync() {
            if (modalOpen || document.visibilityState !== "visible") return;
            try { await load(dataset); } catch (error) { setError((error as Error).message); }
        }
        const interval = setInterval(sync, 10000);
        window.addEventListener("focus", sync);
        return () => { clearInterval(interval); window.removeEventListener("focus", sync); };
    }, [dataset, load, modalOpen]);
    useEffect(() => {
        if (view === "messages") return;
        const abort = new AbortController();
        let active = true;
        async function syncMessages() {
            if (document.visibilityState !== "visible") return;
            try {
                const body = await responseBody<{ unreadCount: number }>(await fetch(`/api/messages?dataset=${dataset}&countOnly=true`, { signal: abort.signal, cache: "no-store" }));
                if (active && !abort.signal.aborted) acceptUnreadCount(body.unreadCount);
            } catch (error) {
                if (active && !abort.signal.aborted && (error as Error).name !== "AbortError") setMessageCounts(previous => previous[messageContext] === null ? previous : { ...previous, [messageContext]: null });
            }
        }
        void syncMessages();
        const interval = setInterval(syncMessages, 10000);
        window.addEventListener("focus", syncMessages);
        return () => { active = false; abort.abort(); clearInterval(interval); window.removeEventListener("focus", syncMessages); };
    }, [dataset, messageContext, acceptUnreadCount, view, revision]);
    const taskChanged = useCallback(async () => { setRevision(value => value + 1); await load(dataset); }, [dataset, load]);
    const detailBattery = data?.batteries.find(b => b.id === detailId);
    const personalScope = view === "my-batteries" ? "responsible" : view === "my-loans" ? "borrowed" : "all";
    const inventoryView = view === "inventory" || view === "my-batteries" || view === "my-loans";
    const activityScope = view === "my-activity" ? "mine" : "all";
    const owned = data?.batteries.filter(battery => battery.ownerAccountId === user.id) ?? [];
    const ownedOnLoan = owned.filter(battery => battery.loanId).length;
    const borrowed = data?.batteries.filter(battery => battery.loanId && battery.borrowerAccountId === user.id) ?? [];
    return <SidebarProvider style={{ "--sidebar-width": "14rem" } as React.CSSProperties}>
    <Sidebar className="app-sidebar"><SidebarHeader className="brand"><span className="brand-mark"><Battery size={24}/></span><div><strong>BATTERY</strong><span>INVENTORY</span></div></SidebarHeader>
      <SidebarContent><SidebarGroup><SidebarGroupLabel>WORKSPACE</SidebarGroupLabel><SidebarMenu>
        <SidebarMenuItem><InventoryNavigationButton disabled={!!scan} isActive={view === "inventory"} onClick={() => setView("inventory")}><Package /><span>Battery inventory</span></InventoryNavigationButton></SidebarMenuItem>
        <SidebarMenuItem><InventoryNavigationButton onClick={() => startScan("checkout")} disabled={!ready || !!scan}><ScanLine /><span>Scan checkout</span></InventoryNavigationButton></SidebarMenuItem>
        <SidebarMenuItem><InventoryNavigationButton onClick={() => startScan("return")} disabled={!ready || !!scan}><RotateCcw /><span>Scan return</span></InventoryNavigationButton></SidebarMenuItem>
        <SidebarMenuItem><InventoryNavigationButton disabled={!!scan} isActive={view === "activity"} onClick={() => setView("activity")}><ClipboardList /><span>Activity history</span></InventoryNavigationButton></SidebarMenuItem>
        <SidebarMenuItem><InventoryNavigationButton disabled={!!scan} isActive={view === "manage"} onClick={() => setView("manage")}><Settings2 /><span>Manage records</span></InventoryNavigationButton></SidebarMenuItem>
        <SidebarMenuItem><InventoryNavigationButton disabled={!!scan} isActive={view === "task-plans"} onClick={() => setView("task-plans")}><CalendarDays /><span>Recurring tasks</span></InventoryNavigationButton></SidebarMenuItem>
        <SidebarMenuItem><InventoryNavigationButton disabled={!!scan} isActive={view === "account"} onClick={() => setView("account")}><UserRound /><span>My account</span></InventoryNavigationButton></SidebarMenuItem>
        {user.role === "admin" && <SidebarMenuItem><InventoryNavigationButton disabled={!!scan} isActive={view === "accounts"} onClick={() => setView("accounts")}><Users /><span>Staff accounts</span></InventoryNavigationButton></SidebarMenuItem>}
      </SidebarMenu></SidebarGroup><SidebarGroup><SidebarGroupLabel>MY WORK</SidebarGroupLabel><SidebarMenu>
        <SidebarMenuItem><InventoryNavigationButton disabled={!!scan} className="h-auto min-h-10 items-start py-2" isActive={view === "my-batteries"} onClick={() => setView("my-batteries")}><Battery /><span className="min-w-0 flex-1"><span className="flex items-center justify-between gap-2"><span>My batteries</span><strong>{data ? owned.length : "—"}</strong></span><span className="mt-1 block text-xs opacity-70">{data ? `${owned.length - ownedOnLoan} in store · ${ownedOnLoan} on loan` : "Loading status…"}</span></span></InventoryNavigationButton></SidebarMenuItem>
        <SidebarMenuItem><InventoryNavigationButton disabled={!!scan} className="h-auto min-h-10 items-start py-2" isActive={view === "my-loans"} onClick={() => setView("my-loans")}><UserRound /><span className="min-w-0 flex-1"><span className="flex items-center justify-between gap-2"><span>My loans</span><strong>{data ? borrowed.length : "—"}</strong></span><span className="mt-1 block text-xs opacity-70">{data ? `${borrowed.length} awaiting return` : "Loading status…"}</span></span></InventoryNavigationButton></SidebarMenuItem>
        <SidebarMenuItem><InventoryNavigationButton disabled={!!scan} isActive={view === "my-activity"} onClick={() => setView("my-activity")}><ClipboardList /><span>My activity</span></InventoryNavigationButton></SidebarMenuItem>
        <SidebarMenuItem><InventoryNavigationButton disabled={!!scan} isActive={view === "messages"} onClick={() => setView("messages")}><Mail /><span className="flex flex-1 items-center justify-between gap-2"><span>Messages</span><span className="message-notifications">{(messageCounts[messageContext] ?? 0) > 0 && <span className="unread-dot" aria-hidden="true"/>}<strong aria-label={messageCounts[messageContext] == null ? "Unread count unavailable" : `${messageCounts[messageContext]} unread messages`}>{messageCounts[messageContext] ?? "—"}</strong></span></span></InventoryNavigationButton></SidebarMenuItem>
      </SidebarMenu></SidebarGroup></SidebarContent><SidebarFooter className="sidebar-bottom"><FlaskConical size={20}/><div><strong>DESN2000</strong><span>Engineering project prototype</span></div></SidebarFooter></Sidebar>
    <SidebarInset className="app-main"><header className="topbar"><div className="flex items-center gap-3"><SidebarTrigger /><span>Faculty of Engineering <span className="breadcrumb-slash">/</span> Battery management</span></div><div className="topbar-account"><span>{user.displayName}</span><span className="role-badge">{user.role === "admin" ? "Administrator" : "Staff"}</span><Button variant="ghost" size="sm" disabled={!!scan} onClick={() => signOut().catch(error => setError(error.message))}><LogOut size={16}/>Sign out</Button></div></header>
      <main className="workspace"><div className="workspace-controls"><div className="dataset-control"><label htmlFor="dataset-select">Inventory</label><Select value={dataset} onValueChange={v => changeDataset(v as Dataset)} disabled={modalOpen || loading}><SelectTrigger id="dataset-select"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="demo">Demonstration inventory</SelectItem><SelectItem value="live">Working inventory</SelectItem></SelectContent></Select></div><div className="operator-control"><span>Operator: {data?.actor ?? "Loading…"}</span><Button variant="ghost" size="sm" onClick={refresh} disabled={loading || modalOpen} aria-label="Refresh inventory"><RefreshCw size={16}/><span>Refresh</span></Button></div></div>
        <div className="page-heading"><div><p className="eyebrow">INVENTORY MANAGEMENT</p><h1>{scan ? (scan.kind === "checkout" ? "Scan checkout" : "Scan return") : view === "inventory" ? "Battery inventory" : view === "my-batteries" ? "My batteries" : view === "my-loans" ? "My loans" : view === "my-activity" ? "My activity" : view === "messages" ? "Messages" : view === "task-plans" ? "Recurring tasks" : view === "activity" ? "Activity history" : view === "account" ? "My account" : view === "accounts" ? "Staff accounts" : "Manage records"}</h1><p className="page-description">{scan ? "Keep scanning until you choose Exit scanning. Process each battery or confirm a batch." : view === "inventory" ? "Manage battery loans, responsibility, buildings and rooms." : view === "my-batteries" ? "Batteries assigned to your staff account as the responsible owner." : view === "my-loans" ? "Your current checkouts, status and checkout times." : view === "my-activity" ? "Inventory operations recorded by your staff account." : view === "messages" ? "Your task reminders, read state and recorded completion." : view === "task-plans" ? "Prepare task content, schedules and staff assignments from three supplied templates." : view === "activity" ? "Trace confirmed actions, their operator and any corrections." : view === "account" ? "Manage your profile, preferences and password." : view === "accounts" ? "Manage staff access and account permissions." : "Shared staff, buildings, rooms and battery records."}</p></div>{!scan && view !== "messages" && view !== "task-plans" && <div className="heading-actions"><Button variant="outline" onClick={() => startScan("return")} disabled={!ready}><RotateCcw />Scan return</Button><Button onClick={() => startScan("checkout")} disabled={!ready}><ScanLine />Scan checkout</Button></div>}</div>
        {dataset === "demo" ? <div className="demo-notice"><FlaskConical size={17}/><span><strong>Demonstration inventory.</strong> Battery specifications and sample activity are fictional. J18 rooms are placeholders awaiting confirmation.</span></div> : <div className="working-notice"><Package size={17}/><span><strong>Working inventory.</strong> Real battery records are awaiting input. J18 rooms are placeholders awaiting confirmation. All staff share this inventory.</span></div>}
        {!scan && !movement && !!pendingScans.length && <div className="scan-resume-notice" role="status"><div><strong>Unfinished scanning session</strong><p>Resume the captured queue or request before starting a new movement. Recovery is available in this browser tab.</p></div><div className="flex flex-wrap gap-2">{pendingScans.map(pending => <Button key={`${pending.dataset}-${pending.kind}`} variant="outline" onClick={() => resumeScan(pending)} disabled={!ready}>Resume {pending.kind === "checkout" ? "checkout" : "return"} · {pending.dataset === "demo" ? "Demonstration" : "Working"}</Button>)}</div></div>}
        {!scan && !movement && !!pendingMovements.length && <div className="scan-resume-notice" role="status"><div><strong>Unfinished checkout or return</strong><p>Resume the exact captured request before starting another movement. A lost response does not mean the operation failed. Recovery is available in this browser tab.</p></div><div className="flex flex-wrap gap-2">{pendingMovements.map(pending => <Button key={`${pending.dataset}-${pending.kind}`} variant="outline" onClick={() => resumeMovement(pending)} disabled={!ready}>Resume saved {pending.kind} · {pending.dataset === "demo" ? "Demonstration" : "Working"}</Button>)}</div></div>}
        {notice && <div className="success-notice" role="status"><span>{notice}</span><Button variant="ghost" size="icon" onClick={() => setNotice("")} aria-label="Dismiss notification"><X size={16}/></Button></div>}
        {error && <div className="load-error" role="alert"><span>{error}</span><Button variant="outline" onClick={refresh} disabled={loading}>Retry refresh</Button></div>}
        {loading && !data ? <div className="loading-panel" aria-label="Loading inventory"><Skeleton className="h-24 w-full"/><Skeleton className="h-72 w-full"/></div> : data && <>
          {scan && <ScanStation key={`${dataset}-${user.id}-${scan.nonce}`} data={data} kind={scan.kind} write={write} paused={!!editor} onExit={() => { setScan(null); setNotice(""); }} onRegister={tagId => setEditor({ kind: "battery", initialTagId: tagId })} onChanged={taskChanged}/>}
          {!scan && inventoryView && <InventoryTable key={`${dataset}-${personalScope}`} personalScope={personalScope} data={data} ready={ready} onMovement={startMovement} onEdit={setEditor} onDetail={setDetailId} onSetup={() => setView("manage")} onExport={setExportDraft}/>}
          {!scan && (view === "activity" || view === "my-activity") && <ActivityHistory key={`${dataset}-${activityScope}-${data.user.id}`} data={data} scope={activityScope} revision={revision} onDetail={setDetailId}/>}
          {!scan && view === "manage" && <RecordManagement data={data} ready={ready} onEdit={setEditor} onDetail={setDetailId} onImport={setImportKind}/>}
          {!scan && view === "account" && <MyAccount user={user} onSaved={() => load(dataset)}/>}
          {!scan && view === "accounts" && user.role === "admin" && <AccountManagement currentUser={user} onSaved={() => load(dataset)}/>}
          {!scan && view === "task-plans" && <TaskPlansPanel key={`${dataset}-${user.id}`} data={data} onChanged={taskChanged} onDetail={setDetailId}/>}
          {!scan && view === "messages" && <MessagesPanel key={`${dataset}-${user.id}`} data={data} onChanged={taskChanged} onDetail={setDetailId} onUnreadCount={acceptUnreadCount}/>}
          <div className="reader-note"><Radio size={18}/><div><strong>Room detection is awaiting hardware validation.</strong><p>RFID observations will require a verified reader-to-room mapping. Loan changes require a staff-operated checkout or return.</p></div><span className="pending-badge">NOT CONNECTED</span></div>
        </>}</main><footer className="workspace-footer"><span>DESN2000 · Battery inventory prototype</span><span>Australia / Sydney · Refreshes every 10 seconds while idle</span></footer>
    </SidebarInset>
    {data && movement && <MovementDialog key={movement.nonce} draft={movement} data={data} onClose={reviewedInventory => {
        if (reviewedInventory?.dataset === dataset && reviewedInventory.user.id === user.id) {
            loadSequence.current++; current.current = reviewedInventory; setData(reviewedInventory); setUser(reviewedInventory.user); setRevision(value => value + 1);
        }
        setMovement(null);
    }} write={write}/>}
    {data && editor && <RecordEditor key={`${editor.kind}-${editor.record?.id ?? "new"}`} draft={editor} data={data} onClose={() => setEditor(null)} write={write}/>}
    {data && detailBattery && <BatteryDetails key={`${dataset}-${detailBattery.id}`} battery={detailBattery} data={data} revision={revision} onClose={() => setDetailId(null)} onExport={() => setExportDraft({ batteryId: detailBattery.id, filter: { ...defaultInventoryFilter(), personalScope }, page: 0, pageSize: "25", matching: 1, pageCount: 1 })} onEdit={battery => { setDetailId(null); setEditor({ kind: "battery", record: battery }); }} write={write}/>}
    {exportDraft && <ExportDialog draft={exportDraft} dataset={dataset} onClose={() => setExportDraft(null)}/> }
    {importKind && <ImportDialog kind={importKind} onClose={() => setImportKind(null)} write={write}/>}
  </SidebarProvider>;
}
