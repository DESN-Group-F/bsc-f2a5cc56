"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Battery, Package, ScanLine, RotateCcw, Radio, FlaskConical, ClipboardList, Settings2, RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { SidebarProvider, Sidebar, SidebarHeader, SidebarContent, SidebarGroup, SidebarGroupLabel, SidebarMenu, SidebarMenuItem, SidebarMenuButton, SidebarFooter, SidebarInset, SidebarTrigger } from "@/components/ui/sidebar";
import { MovementDialog, type MovementDraft, type WriteAction } from "@/components/inventory/movement-dialog";
import { RecordEditor, type EditorDraft } from "@/components/inventory/record-editor";
import { BatteryDetails } from "@/components/inventory/battery-detail";
import { ImportDialog } from "@/components/inventory/import-dialog";
import { InventoryTable, RecordManagement, ActivityHistory, type ImportKind } from "@/components/inventory/views";
import type { Dataset, InventorySnapshot } from "@/lib/domain";
import { registerInventoryTools } from "@/lib/browser-tools";
type View = "inventory" | "activity" | "manage";
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
    if (!response.ok)
        throw Object.assign(new Error(body.error || "The inventory could not complete this operation."), { status: response.status, code: body.code });
    return body;
}
export default function InventoryApp() {
    const [dataset, setDataset] = useState<Dataset>("demo"), [data, setData] = useState<InventorySnapshot | null>(null);
    const [loading, setLoading] = useState(true), [error, setError] = useState(""), [notice, setNotice] = useState("");
    const [revision, setRevision] = useState(0), [view, setView] = useState<View>("inventory");
    const [movement, setMovement] = useState<MovementDraft | null>(null), [editor, setEditor] = useState<EditorDraft | null>(null);
    const [detailId, setDetailId] = useState<string | null>(null), [importKind, setImportKind] = useState<ImportKind | null>(null);
    const current = useRef<InventorySnapshot | null>(null);
    useEffect(() => { current.current = data; }, [data]);
    const load = useCallback(async (mode: Dataset, signal?: AbortSignal, initialize = false) => {
        if (initialize && mode === "demo")
            await responseBody(await fetch("/api/inventory", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dataset: mode, action: "initialize_demo" }), signal }));
        const snapshot = await responseBody<InventorySnapshot>(await fetch(`/api/inventory?dataset=${mode}`, { signal, cache: "no-store" }));
        if (signal?.aborted)
            return;
        setData(snapshot);
        setError("");
        setRevision(r => r + 1);
    }, []);
    useEffect(() => {
        const abort = new AbortController();
        // eslint-disable-next-line react-hooks/set-state-in-effect -- load sets state only after awaited network responses.
        load(dataset, abort.signal, true).catch(e => { if (e.name !== "AbortError")
            setError(e.message); }).finally(() => { if (!abort.signal.aborted)
            setLoading(false); });
        return () => abort.abort();
    }, [dataset, load]);
    function changeDataset(mode: Dataset) { setLoading(true); setData(null); setError(""); setNotice(""); current.current = null; setDataset(mode); }
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
    const modalOpen = !!(movement || editor || detailId || importKind), ready = !!data && !loading && !error;
    const detailBattery = data?.batteries.find(b => b.id === detailId);
    return <SidebarProvider style={{ "--sidebar-width": "14rem" } as React.CSSProperties}>
    <Sidebar className="app-sidebar"><SidebarHeader className="brand"><span className="brand-mark"><Battery size={24}/></span><div><strong>BATTERY</strong><span>INVENTORY</span></div></SidebarHeader>
      <SidebarContent><SidebarGroup><SidebarGroupLabel>WORKSPACE</SidebarGroupLabel><SidebarMenu>
        <SidebarMenuItem><SidebarMenuButton isActive={view === "inventory"} onClick={() => setView("inventory")}><Package /><span>Battery inventory</span></SidebarMenuButton></SidebarMenuItem>
        <SidebarMenuItem><SidebarMenuButton onClick={() => startMovement("checkout")} disabled={!ready}><ScanLine /><span>Check out batteries</span></SidebarMenuButton></SidebarMenuItem>
        <SidebarMenuItem><SidebarMenuButton isActive={view === "activity"} onClick={() => setView("activity")}><ClipboardList /><span>Activity history</span></SidebarMenuButton></SidebarMenuItem>
        <SidebarMenuItem><SidebarMenuButton isActive={view === "manage"} onClick={() => setView("manage")}><Settings2 /><span>Manage records</span></SidebarMenuButton></SidebarMenuItem>
      </SidebarMenu></SidebarGroup></SidebarContent><SidebarFooter className="sidebar-bottom"><FlaskConical size={20}/><div><strong>DESN2000</strong><span>Engineering project prototype</span></div></SidebarFooter></Sidebar>
    <SidebarInset className="app-main"><header className="topbar"><div className="flex items-center gap-3"><SidebarTrigger /><span>Faculty of Engineering <span className="breadcrumb-slash">/</span> Battery management</span></div><span className="prototype-badge">PROJECT PROTOTYPE</span></header>
      <main className="workspace"><div className="workspace-controls"><div className="dataset-control"><label htmlFor="dataset-select">Inventory</label><Select value={dataset} onValueChange={v => changeDataset(v as Dataset)} disabled={modalOpen || loading}><SelectTrigger id="dataset-select"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="demo">Demonstration inventory</SelectItem><SelectItem value="live">Working inventory</SelectItem></SelectContent></Select></div><div className="operator-control"><span>Operator: {data?.actor ?? "Loading…"}</span><Button variant="ghost" size="sm" onClick={refresh} disabled={loading || modalOpen} aria-label="Refresh inventory"><RefreshCw size={16}/><span>Refresh</span></Button></div></div>
        <div className="page-heading"><div><p className="eyebrow">INVENTORY MANAGEMENT</p><h1>{view === "inventory" ? "Battery inventory" : view === "activity" ? "Activity history" : "Manage records"}</h1><p className="page-description">{view === "inventory" ? "Manage battery loans, responsibility and room records." : view === "activity" ? "Trace confirmed actions, their operator and any corrections." : "Register people and rooms, then add the batteries they support."}</p></div><div className="heading-actions"><Button variant="outline" onClick={() => startMovement("return")} disabled={!ready}><RotateCcw />Return batteries</Button><Button onClick={() => startMovement("checkout")} disabled={!ready}><ScanLine />Check out batteries</Button></div></div>
        {dataset === "demo" ? <div className="demo-notice"><FlaskConical size={17}/><span><strong>Demonstration inventory.</strong> Batteries, people, rooms and sample histories are fictional.</span></div> : <div className="working-notice"><Package size={17}/><span><strong>Working inventory.</strong> Start with your own records. This private prototype stores a separate inventory for each signed-in operator.</span></div>}
        {notice && <div className="success-notice" role="status"><span>{notice}</span><Button variant="ghost" size="icon" onClick={() => setNotice("")} aria-label="Dismiss notification"><X size={16}/></Button></div>}
        {error && <div className="load-error" role="alert"><span>{error}</span><Button variant="outline" onClick={refresh} disabled={loading}>Retry refresh</Button></div>}
        {loading && !data ? <div className="loading-panel" aria-label="Loading inventory"><Skeleton className="h-24 w-full"/><Skeleton className="h-72 w-full"/></div> : data && <>
          {view === "inventory" && <InventoryTable key={dataset} data={data} ready={ready} onMovement={startMovement} onEdit={setEditor} onDetail={setDetailId} onSetup={() => setView("manage")} revision={revision}/>}
          {view === "activity" && <ActivityHistory data={data} onDetail={setDetailId}/>}
          {view === "manage" && <RecordManagement data={data} ready={ready} onEdit={setEditor} onDetail={setDetailId} onImport={setImportKind}/>}
          <div className="reader-note"><Radio size={18}/><div><strong>Room detection is awaiting hardware validation.</strong><p>RFID observations will require a verified reader-to-room mapping. Loan status changes only after teacher confirmation.</p></div><span className="pending-badge">NOT CONNECTED</span></div>
        </>}</main><footer className="workspace-footer"><span>DESN2000 · Battery inventory prototype</span><span>Australia / Sydney</span></footer>
    </SidebarInset>
    {data && movement && <MovementDialog key={movement.nonce} draft={movement} data={data} onClose={() => setMovement(null)} write={write}/>}
    {data && editor && <RecordEditor key={`${editor.kind}-${editor.record?.id ?? "new"}`} draft={editor} data={data} onClose={() => setEditor(null)} write={write}/>}
    {data && detailBattery && <BatteryDetails key={`${dataset}-${detailBattery.id}`} battery={detailBattery} data={data} revision={revision} onClose={() => setDetailId(null)} onEdit={() => { setDetailId(null); setEditor({ kind: "battery", record: detailBattery }); }} write={write}/>}
    {importKind && <ImportDialog kind={importKind} onClose={() => setImportKind(null)} write={write}/>}
  </SidebarProvider>;
}
