"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Battery, Package, ScanLine, RotateCcw, Radio, FlaskConical, ClipboardList, Settings2, RefreshCw, X, UserRound, Users, LogOut } from "lucide-react";
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
import { registerInventoryTools } from "@/lib/browser-tools";
import type { StaffUser } from "@/lib/accounts";
import { MyAccount, AccountManagement } from "@/components/inventory/accounts-panel";
import { signOut } from "@/lib/client-session";
import { ExportDialog, type ExportDraft } from "@/components/inventory/export-dialog";
import { reloadSessionPage } from "@/lib/client-utils";
type View = "inventory" | "activity" | "manage" | "account" | "accounts";
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
    const [movement, setMovement] = useState<MovementDraft | null>(null), [editor, setEditor] = useState<EditorDraft | null>(null);
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
    useEffect(() => registerInventoryTools(() => current.current, draft => flushSync(() => setMovement(draft))), []);
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
        setRevision(r => r + 1);
        try {
            await load(dataset);
            setNotice(action === "movement" ? `${body.result.count} ${body.result.count === 1 ? "battery" : "batteries"} ${body.result.kind === "checkout" ? "checked out" : "returned"}.` : "Record saved. The audit history has been updated.");
        }
        catch {
            setError("The change was saved, but the inventory could not refresh. Refresh before starting another operation.");
            setNotice("Your change was saved successfully.");
        }
        return body.result;
    };
    const startMovement = (kind: "checkout" | "return", ids: string[] = []) => setMovement({ kind, ids, nonce: crypto.randomUUID() });
    const modalOpen = !!(movement || editor || detailId || importKind || exportDraft), ready = !!data && !loading && !error;
    useEffect(() => {
        async function sync() {
            if (modalOpen || document.visibilityState !== "visible") return;
            try { await load(dataset); } catch (error) { setError((error as Error).message); }
        }
        const interval = setInterval(sync, 10000);
        window.addEventListener("focus", sync);
        return () => { clearInterval(interval); window.removeEventListener("focus", sync); };
    }, [dataset, load, modalOpen]);
    const detailBattery = data?.batteries.find(b => b.id === detailId);
    return <SidebarProvider style={{ "--sidebar-width": "14rem" } as React.CSSProperties}>
    <Sidebar className="app-sidebar"><SidebarHeader className="brand"><span className="brand-mark"><Battery size={24}/></span><div><strong>BATTERY</strong><span>INVENTORY</span></div></SidebarHeader>
      <SidebarContent><SidebarGroup><SidebarGroupLabel>WORKSPACE</SidebarGroupLabel><SidebarMenu>
        <SidebarMenuItem><InventoryNavigationButton isActive={view === "inventory"} onClick={() => setView("inventory")}><Package /><span>Battery inventory</span></InventoryNavigationButton></SidebarMenuItem>
        <SidebarMenuItem><InventoryNavigationButton onClick={() => startMovement("checkout")} disabled={!ready}><ScanLine /><span>Check out batteries</span></InventoryNavigationButton></SidebarMenuItem>
        <SidebarMenuItem><InventoryNavigationButton isActive={view === "activity"} onClick={() => setView("activity")}><ClipboardList /><span>Activity history</span></InventoryNavigationButton></SidebarMenuItem>
        <SidebarMenuItem><InventoryNavigationButton isActive={view === "manage"} onClick={() => setView("manage")}><Settings2 /><span>Manage records</span></InventoryNavigationButton></SidebarMenuItem>
        <SidebarMenuItem><InventoryNavigationButton isActive={view === "account"} onClick={() => setView("account")}><UserRound /><span>My account</span></InventoryNavigationButton></SidebarMenuItem>
        {user.role === "admin" && <SidebarMenuItem><InventoryNavigationButton isActive={view === "accounts"} onClick={() => setView("accounts")}><Users /><span>Staff accounts</span></InventoryNavigationButton></SidebarMenuItem>}
      </SidebarMenu></SidebarGroup></SidebarContent><SidebarFooter className="sidebar-bottom"><FlaskConical size={20}/><div><strong>DESN2000</strong><span>Engineering project prototype</span></div></SidebarFooter></Sidebar>
    <SidebarInset className="app-main"><header className="topbar"><div className="flex items-center gap-3"><SidebarTrigger /><span>Faculty of Engineering <span className="breadcrumb-slash">/</span> Battery management</span></div><div className="topbar-account"><span>{user.displayName}</span><span className="role-badge">{user.role === "admin" ? "Administrator" : "Staff"}</span><Button variant="ghost" size="sm" onClick={() => signOut().catch(error => setError(error.message))}><LogOut size={16}/>Sign out</Button></div></header>
      <main className="workspace"><div className="workspace-controls"><div className="dataset-control"><label htmlFor="dataset-select">Inventory</label><Select value={dataset} onValueChange={v => changeDataset(v as Dataset)} disabled={modalOpen || loading}><SelectTrigger id="dataset-select"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="demo">Demonstration inventory</SelectItem><SelectItem value="live">Working inventory</SelectItem></SelectContent></Select></div><div className="operator-control"><span>Operator: {data?.actor ?? "Loading…"}</span><Button variant="ghost" size="sm" onClick={refresh} disabled={loading || modalOpen} aria-label="Refresh inventory"><RefreshCw size={16}/><span>Refresh</span></Button></div></div>
        <div className="page-heading"><div><p className="eyebrow">INVENTORY MANAGEMENT</p><h1>{view === "inventory" ? "Battery inventory" : view === "activity" ? "Activity history" : view === "account" ? "My account" : view === "accounts" ? "Staff accounts" : "Manage records"}</h1><p className="page-description">{view === "inventory" ? "Manage battery loans, responsibility, buildings and rooms." : view === "activity" ? "Trace confirmed actions, their operator and any corrections." : view === "account" ? "Manage your profile, preferences and password." : view === "accounts" ? "Manage staff access and account permissions." : "Shared people, buildings, rooms and battery records."}</p></div><div className="heading-actions"><Button variant="outline" onClick={() => startMovement("return")} disabled={!ready}><RotateCcw />Return batteries</Button><Button onClick={() => startMovement("checkout")} disabled={!ready}><ScanLine />Check out batteries</Button></div></div>
        {dataset === "demo" ? <div className="demo-notice"><FlaskConical size={17}/><span><strong>Demonstration inventory.</strong> Batteries, people, rooms and sample histories are fictional.</span></div> : <div className="working-notice"><Package size={17}/><span><strong>Working inventory.</strong> Start with your own records. All staff share the same working inventory. Operations are attributed to your account.</span></div>}
        {notice && <div className="success-notice" role="status"><span>{notice}</span><Button variant="ghost" size="icon" onClick={() => setNotice("")} aria-label="Dismiss notification"><X size={16}/></Button></div>}
        {error && <div className="load-error" role="alert"><span>{error}</span><Button variant="outline" onClick={refresh} disabled={loading}>Retry refresh</Button></div>}
        {loading && !data ? <div className="loading-panel" aria-label="Loading inventory"><Skeleton className="h-24 w-full"/><Skeleton className="h-72 w-full"/></div> : data && <>
          {view === "inventory" && <InventoryTable key={dataset} data={data} ready={ready} onMovement={startMovement} onEdit={setEditor} onDetail={setDetailId} onSetup={() => setView("manage")} onExport={setExportDraft}/>}
          {view === "activity" && <ActivityHistory data={data} onDetail={setDetailId}/>}
          {view === "manage" && <RecordManagement data={data} ready={ready} onEdit={setEditor} onDetail={setDetailId} onImport={setImportKind}/>}
          {view === "account" && <MyAccount user={user} onSaved={() => load(dataset)}/>}
          {view === "accounts" && user.role === "admin" && <AccountManagement currentUser={user} onSaved={() => load(dataset)}/>}
          <div className="reader-note"><Radio size={18}/><div><strong>Room detection is awaiting hardware validation.</strong><p>RFID observations will require a verified reader-to-room mapping. Loan status changes only after staff confirmation.</p></div><span className="pending-badge">NOT CONNECTED</span></div>
        </>}</main><footer className="workspace-footer"><span>DESN2000 · Battery inventory prototype</span><span>Australia / Sydney · Refreshes every 10 seconds while idle</span></footer>
    </SidebarInset>
    {data && movement && <MovementDialog key={movement.nonce} draft={movement} data={data} onClose={() => setMovement(null)} write={write}/>}
    {data && editor && <RecordEditor key={`${editor.kind}-${editor.record?.id ?? "new"}`} draft={editor} data={data} onClose={() => setEditor(null)} write={write}/>}
    {data && detailBattery && <BatteryDetails key={`${dataset}-${detailBattery.id}`} battery={detailBattery} data={data} revision={revision} onClose={() => setDetailId(null)} onExport={() => setExportDraft({ batteryId: detailBattery.id, filter: { status: "all", building: "all", room: "all", owner: "all", search: "" }, page: 0, pageSize: "25", matching: 1, pageCount: 1 })} onEdit={() => { setDetailId(null); setEditor({ kind: "battery", record: detailBattery }); }} write={write}/>}
    {exportDraft && <ExportDialog draft={exportDraft} dataset={dataset} onClose={() => setExportDraft(null)}/> }
    {importKind && <ImportDialog kind={importKind} onClose={() => setImportKind(null)} write={write}/>}
  </SidebarProvider>;
}
