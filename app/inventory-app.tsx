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
import { IntakeStation } from "@/components/inventory/intake-station";
import { RemovalStation, RemovalHistory } from "@/components/inventory/removal-station";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { isActiveBattery } from "@/lib/battery-lifecycle";
import { recoverIntakeDraft } from "@/lib/intake-draft";
import { recoverRemovalDraft, removalDraftStorageKey } from "@/lib/removal-draft";
import { lifecycleStorageKey, captureLifecycleAttempt, verifyLifecycleReceipt, type LifecyclePayload } from "@/lib/lifecycle-session";
import { captureIntakeAttempt, intakeStorageKey, verifyIntakeReceipt, type IntakePayload } from "@/lib/intake-session";
import { recoverScanSession } from "@/lib/scan-session";
import { movementStorageKey, recoverMovementAttempt, verifyMovementReceipt, type MovementPayload } from "@/lib/movement-session";
import { TeachingGroupsWorkspace } from "@/components/inventory/teaching-groups-workspace";
import { GroupMaintenanceDialog } from "@/components/inventory/group-maintenance-dialog";
import { groupMaintenanceKey } from "@/lib/group-maintenance";
import type { TeachingGroupReference } from "@/lib/teaching-context";
import type { TeachingGroup } from "@/lib/teaching-groups";
type View = "inventory" | "teaching-groups" | "assets" | "my-batteries" | "my-loans" | "my-activity" | "messages" | "task-plans" | "activity" | "manage" | "account" | "accounts";
function subscribeScanRecovery(onChange: () => void) {
    window.addEventListener("storage", onChange);
    window.addEventListener("focus", onChange);
    window.addEventListener("battery-movement-recovery", onChange);
    window.addEventListener("battery-intake-recovery", onChange);
    window.addEventListener("battery-lifecycle-recovery", onChange);
    window.addEventListener("battery-group-maintenance-recovery", onChange);
    return () => { window.removeEventListener("storage", onChange); window.removeEventListener("focus", onChange); window.removeEventListener("battery-movement-recovery", onChange); window.removeEventListener("battery-intake-recovery", onChange); window.removeEventListener("battery-lifecycle-recovery", onChange); window.removeEventListener("battery-group-maintenance-recovery", onChange); };
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
    const [intake, setIntake] = useState<{ nonce: string } | null>(null);
    const [assetTab, setAssetTab] = useState<"intake" | "removal" | "history">("intake");
    const [removalLocked, setRemovalLocked] = useState(false);
    const readPendingRemovals = useCallback(() => {
        try { return JSON.stringify((["demo", "live"] as const).filter(mode => {
            const rawAttempt = sessionStorage.getItem(lifecycleStorageKey(user.id, mode)), rawDraft = sessionStorage.getItem(removalDraftStorageKey(user.id, mode));
            const draft = recoverRemovalDraft(rawDraft, user.id, mode);
            return !!rawAttempt || !!rawDraft && (!draft || draft.items.length > 0);
        }).map(dataset => ({ dataset }))); }
        catch { return "[]"; }
    }, [user.id]);
    const pendingRemovals = JSON.parse(useSyncExternalStore(subscribeScanRecovery, readPendingRemovals, () => "[]")) as { dataset: Dataset }[];
    const readPendingIntakes = useCallback(() => {
        try { const draft = recoverIntakeDraft(sessionStorage.getItem(intakeStorageKey(user.id, "demo")), user.id, "demo"); return draft && (draft.entries.length || draft.attempt) ? '[{"dataset":"demo"}]' : "[]"; }
        catch { return "[]"; }
    }, [user.id]);
    const pendingIntakes = JSON.parse(useSyncExternalStore(subscribeScanRecovery, readPendingIntakes, () => "[]")) as { dataset: Dataset }[];
    const activeAssetTab = removalLocked && !intake ? "removal" : assetTab;
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
    const [groupsOpen, setGroupsOpen] = useState(false);
    const [activeGroupId, setActiveGroupId] = useState<string | null>(null), [activityGroupId, setActivityGroupId] = useState<string | null>(null);
    const [groupsReturnView, setGroupsReturnView] = useState<Exclude<View, "teaching-groups">>("inventory");
    const [editorGroup, setEditorGroup] = useState<TeachingGroupReference | undefined>(), [detailGroup, setDetailGroup] = useState<TeachingGroupReference | undefined>();
    const [groupMaintenance, setGroupMaintenance] = useState<{ group?: TeachingGroup; ids: string[] } | null>(null);
    const [groupRemoval, setGroupRemoval] = useState<{ teachingGroup: TeachingGroupReference; ids: string[]; nonce: string } | null>(null);
    const readPendingGroupChanges = useCallback(() => {
        try { return JSON.stringify((["demo", "live"] as const).filter(mode => !!sessionStorage.getItem(groupMaintenanceKey(user.id, mode))).map(dataset => ({ dataset }))); }
        catch { return "[]"; }
    }, [user.id]);
    const pendingGroupChanges = JSON.parse(useSyncExternalStore(subscribeScanRecovery, readPendingGroupChanges, () => "[]")) as { dataset: Dataset }[];
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
    function changeDataset(mode: Dataset) { loadSequence.current++; setLoading(true); setData(null); setError(""); setNotice(""); setActiveGroupId(null); setActivityGroupId(null); current.current = null; setDataset(mode); }
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
        const intakeAttempt = action === "intake" ? captureIntakeAttempt(user.id, dataset, payload as IntakePayload) : null;
        const lifecycleAttempt = action === "lifecycle" ? captureLifecycleAttempt(user.id, dataset, payload as LifecyclePayload) : null;
        const body = await responseBody<{
            result: Record<string, unknown>;
        }>(await fetch("/api/inventory", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dataset, action, payload, ...extra }) }));
        if (action === "scan_lookup") return body.result;
        if (intakeAttempt) { verifyIntakeReceipt(body.result, intakeAttempt); return body.result; }
        if (lifecycleAttempt) { verifyLifecycleReceipt(body.result, lifecycleAttempt); return body.result; }
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
    const modalOpen = !!(intake || scan || movement || editor || detailId || importKind || exportDraft || removalLocked || groupsOpen || groupMaintenance), ready = !!data && !loading && !error;
    function openTeachingGroups() {
        if (modalOpen) return;
        if (view !== "teaching-groups") { setGroupsReturnView(view); setActiveGroupId(null); }
        setView("teaching-groups");
    }
    function returnFromTeachingGroups() {
        if (modalOpen || view !== "teaching-groups") return;
        setView(groupsReturnView === "accounts" && user.role !== "admin" ? "inventory" : groupsReturnView);
    }
    function resumeGroupChange(pending: { dataset: Dataset }) { if (modalOpen) return; if (pending.dataset !== dataset) changeDataset(pending.dataset); openTeachingGroups(); setGroupMaintenance({ ids: [] }); }
    function interceptPendingGroupChange() { const saved = JSON.parse(readPendingGroupChanges())[0]; if (!saved) return false; resumeGroupChange(saved); return true; }
    function groupWrite(reference?: TeachingGroupReference): WriteAction { return (action, payload, extra) => write(action, reference && ["battery", "charge", "observation", "correction"].includes(action) ? { ...payload as Record<string, unknown>, teachingGroup: reference } : payload, extra); }
    const navigationView = scan || intake ? null : view;
    function openAssets() {
        if (modalOpen) return;
        if (interceptPendingGroupChange()) return;
        setGroupRemoval(null);
        const savedRemoval = JSON.parse(readPendingRemovals())[0]; if (savedRemoval) { resumeRemoval(savedRemoval); return; }
        if (JSON.parse(readPendingIntakes()).length) { startIntake(); return; }
        const savedMovement = JSON.parse(readPendingMovements())[0]; if (savedMovement) { resumeMovement(savedMovement); return; }
        const savedScan = JSON.parse(readPendingScans())[0]; if (savedScan) { resumeScan(savedScan); return; }
        setView("assets"); setNotice("");
    }
    function resumeRemoval(pending: { dataset: Dataset }) { if (modalOpen) return; if (dataset !== pending.dataset) changeDataset(pending.dataset); setView("assets"); setAssetTab("removal"); }
    function startIntake() {
        if (modalOpen) return;
        if (interceptPendingGroupChange()) return;
        const savedRemoval = JSON.parse(readPendingRemovals())[0];
        if (savedRemoval) { resumeRemoval(savedRemoval); return; }
        const savedMovement = JSON.parse(readPendingMovements())[0];
        if (savedMovement) { resumeMovement(savedMovement); return; }
        const savedScan = JSON.parse(readPendingScans())[0];
        if (savedScan) { resumeScan(savedScan); return; }
        if (dataset !== "demo") changeDataset("demo");
        setView("assets"); setAssetTab("intake"); setNotice(""); setIntake({ nonce: crypto.randomUUID() });
    }
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
    function startMovement(kind: "checkout" | "return", ids: string[] = [], teachingGroup?: TeachingGroupReference) {
        if (modalOpen) return;
        if (interceptPendingGroupChange()) return;
        const savedRemoval = JSON.parse(readPendingRemovals())[0]; if (savedRemoval) { resumeRemoval(savedRemoval); return; }
        if (JSON.parse(readPendingIntakes()).length) { startIntake(); return; }
        const savedMovement = JSON.parse(readPendingMovements())[0];
        if (savedMovement) { resumeMovement(savedMovement); return; }
        const savedScan = JSON.parse(readPendingScans())[0];
        if (savedScan) { resumeScan(savedScan); return; }
        const reviewed = teachingGroup ? data?.batteries.filter(b => ids.includes(b.id) && isActiveBattery(b) && (kind === "checkout" ? !b.loanId : !!b.loanId)) ?? [] : [];
        const chosen = teachingGroup ? reviewed.map(b => b.id) : ids;
        setNotice(""); setMovement({ kind, ids: chosen, nonce: crypto.randomUUID(), ...(teachingGroup ? { teachingGroup, excludedIds: ids.filter(id => !chosen.includes(id)) } : {}) });
    }
    function startGroupRemoval(ids: string[], teachingGroup: TeachingGroupReference) {
        if (modalOpen || !ready || interceptPendingGroupChange()) return;
        if (JSON.parse(readPendingRemovals()).length || JSON.parse(readPendingMovements()).length || JSON.parse(readPendingScans()).length || JSON.parse(readPendingIntakes()).length) { setNotice("Resume the unfinished workflow before starting a group removal."); return; }
        setGroupRemoval({ ids: [...ids], teachingGroup, nonce: crypto.randomUUID() }); setView("assets"); setAssetTab("removal");
    }
    function startScan(kind: "checkout" | "return") {
        if (modalOpen) return;
        if (interceptPendingGroupChange()) return;
        const savedRemoval = JSON.parse(readPendingRemovals())[0]; if (savedRemoval) { resumeRemoval(savedRemoval); return; }
        if (JSON.parse(readPendingIntakes()).length) { startIntake(); return; }
        const savedMovement = JSON.parse(readPendingMovements())[0];
        if (savedMovement) { resumeMovement(savedMovement); return; }
        const savedScan = JSON.parse(readPendingScans())[0];
        if (savedScan) { resumeScan(savedScan); return; }
        setNotice(""); setScan({ kind, nonce: crypto.randomUUID() });
    }
    useEffect(() => registerInventoryTools(() => current.current, draft => {
        if (modalOpen) throw new Error("Finish or close the current workflow before preparing another movement.");
        if (JSON.parse(readPendingMovements()).length || JSON.parse(readPendingScans()).length || JSON.parse(readPendingIntakes()).length || JSON.parse(readPendingRemovals()).length)
            throw new Error("Resume the unfinished intake, removal, checkout or return session before preparing another movement.");
        flushSync(() => setMovement(draft));
    }), [modalOpen, readPendingMovements, readPendingScans, readPendingIntakes, readPendingRemovals]);
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
    const inventorySourceView = view === "teaching-groups" ? groupsReturnView : view;
    const retainInventory = inventorySourceView === "inventory" || inventorySourceView === "my-batteries" || inventorySourceView === "my-loans";
    const inventoryPersonalScope = inventorySourceView === "my-batteries" ? "responsible" : inventorySourceView === "my-loans" ? "borrowed" : "all";
    const activityScope = view === "my-activity" ? "mine" : "all";
    const owned = data?.batteries.filter(battery => isActiveBattery(battery) && battery.ownerAccountId === user.id) ?? [];
    const ownedOnLoan = owned.filter(battery => battery.loanId).length;
    const borrowed = data?.batteries.filter(battery => isActiveBattery(battery) && battery.loanId && battery.borrowerAccountId === user.id) ?? [];
    return <SidebarProvider style={{ "--sidebar-width": "14rem" } as React.CSSProperties}>
    <Sidebar className="app-sidebar"><SidebarHeader className="brand"><span className="brand-mark"><Battery size={24}/></span><div><strong>BATTERY</strong><span>INVENTORY</span></div></SidebarHeader>
      <SidebarContent><SidebarGroup><SidebarGroupLabel>WORKSPACE</SidebarGroupLabel><SidebarMenu>
        <SidebarMenuItem><InventoryNavigationButton disabled={!!(scan || intake || removalLocked)} isActive={navigationView === "inventory"} onClick={() => setView("inventory")}><Package /><span>Battery inventory</span></InventoryNavigationButton></SidebarMenuItem>
        <SidebarMenuItem><InventoryNavigationButton disabled={!!(scan || intake || removalLocked)} isActive={navigationView === "teaching-groups"} onClick={openTeachingGroups}><Users /><span>Teaching groups</span></InventoryNavigationButton></SidebarMenuItem>
        <SidebarMenuItem><InventoryNavigationButton onClick={openAssets} disabled={!ready || !!(scan || intake || removalLocked)} isActive={!!intake || navigationView === "assets"}><Package /><span>Intake &amp; removal</span></InventoryNavigationButton></SidebarMenuItem>
        <SidebarMenuItem><InventoryNavigationButton onClick={() => startScan("checkout")} disabled={!ready || !!(scan || intake || removalLocked)} isActive={scan?.kind === "checkout"}><ScanLine /><span>Scan checkout</span></InventoryNavigationButton></SidebarMenuItem>
        <SidebarMenuItem><InventoryNavigationButton onClick={() => startScan("return")} disabled={!ready || !!(scan || intake || removalLocked)} isActive={scan?.kind === "return"}><RotateCcw /><span>Scan return</span></InventoryNavigationButton></SidebarMenuItem>
        <SidebarMenuItem><InventoryNavigationButton disabled={!!(scan || intake || removalLocked)} isActive={navigationView === "activity"} onClick={() => setView("activity")}><ClipboardList /><span>Activity history</span></InventoryNavigationButton></SidebarMenuItem>
        <SidebarMenuItem><InventoryNavigationButton disabled={!!(scan || intake || removalLocked)} isActive={navigationView === "manage"} onClick={() => setView("manage")}><Settings2 /><span>Manage records</span></InventoryNavigationButton></SidebarMenuItem>
        <SidebarMenuItem><InventoryNavigationButton disabled={!!(scan || intake || removalLocked)} isActive={navigationView === "task-plans"} onClick={() => setView("task-plans")}><CalendarDays /><span>Recurring tasks</span></InventoryNavigationButton></SidebarMenuItem>
        <SidebarMenuItem><InventoryNavigationButton disabled={!!(scan || intake || removalLocked)} isActive={navigationView === "account"} onClick={() => setView("account")}><UserRound /><span>My account</span></InventoryNavigationButton></SidebarMenuItem>
        {user.role === "admin" && <SidebarMenuItem><InventoryNavigationButton disabled={!!(scan || intake || removalLocked)} isActive={navigationView === "accounts"} onClick={() => setView("accounts")}><Users /><span>Staff accounts</span></InventoryNavigationButton></SidebarMenuItem>}
      </SidebarMenu></SidebarGroup><SidebarGroup><SidebarGroupLabel>MY WORK</SidebarGroupLabel><SidebarMenu>
        <SidebarMenuItem><InventoryNavigationButton disabled={!!(scan || intake || removalLocked)} className="h-auto min-h-10 items-start py-2" isActive={navigationView === "my-batteries"} onClick={() => setView("my-batteries")}><Battery /><span className="min-w-0 flex-1"><span className="flex items-center justify-between gap-2"><span>My batteries</span><strong>{data ? owned.length : "—"}</strong></span><span className="mt-1 block text-xs opacity-70">{data ? `${owned.length - ownedOnLoan} in store · ${ownedOnLoan} in use` : "Loading status…"}</span></span></InventoryNavigationButton></SidebarMenuItem>
        <SidebarMenuItem><InventoryNavigationButton disabled={!!(scan || intake || removalLocked)} className="h-auto min-h-10 items-start py-2" isActive={navigationView === "my-loans"} onClick={() => setView("my-loans")}><UserRound /><span className="min-w-0 flex-1"><span className="flex items-center justify-between gap-2"><span>My batteries in use</span><strong>{data ? borrowed.length : "—"}</strong></span><span className="mt-1 block text-xs opacity-70">{data ? `${borrowed.length} awaiting return` : "Loading status…"}</span></span></InventoryNavigationButton></SidebarMenuItem>
        <SidebarMenuItem><InventoryNavigationButton disabled={!!(scan || intake || removalLocked)} isActive={navigationView === "my-activity"} onClick={() => setView("my-activity")}><ClipboardList /><span>My activity</span></InventoryNavigationButton></SidebarMenuItem>
        <SidebarMenuItem><InventoryNavigationButton disabled={!!(scan || intake || removalLocked)} isActive={navigationView === "messages"} onClick={() => setView("messages")}><Mail /><span className="flex flex-1 items-center justify-between gap-2"><span>Messages</span><span className="message-notifications">{(messageCounts[messageContext] ?? 0) > 0 && <span className="unread-dot" aria-hidden="true"/>}<strong aria-label={messageCounts[messageContext] == null ? "Unread count unavailable" : `${messageCounts[messageContext]} unread messages`}>{messageCounts[messageContext] ?? "—"}</strong></span></span></InventoryNavigationButton></SidebarMenuItem>
      </SidebarMenu></SidebarGroup></SidebarContent><SidebarFooter className="sidebar-bottom"><FlaskConical size={20}/><div><strong>DESN2000</strong><span>Engineering project prototype</span></div></SidebarFooter></Sidebar>
    <SidebarInset className="app-main"><header className="topbar"><div className="flex items-center gap-3"><SidebarTrigger /><span>Faculty of Engineering <span className="breadcrumb-slash">/</span> Battery management</span></div><div className="topbar-account"><span>{user.displayName}</span><span className="role-badge">{user.role === "admin" ? "Administrator" : "Staff"}</span><Button variant="ghost" size="sm" disabled={!!(scan || intake || removalLocked)} onClick={() => signOut().catch(error => setError(error.message))}><LogOut size={16}/>Sign out</Button></div></header>
      <main className="workspace"><div className="workspace-controls"><div className="dataset-control"><label htmlFor="dataset-select">Inventory</label><Select value={dataset} onValueChange={v => changeDataset(v as Dataset)} disabled={modalOpen || loading}><SelectTrigger id="dataset-select"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="demo">Demonstration inventory</SelectItem><SelectItem value="live">Working inventory</SelectItem></SelectContent></Select></div><div className="operator-control"><span>Operator: {data?.actor ?? "Loading…"}</span><Button variant="ghost" size="sm" onClick={refresh} disabled={loading || modalOpen} aria-label="Refresh inventory"><RefreshCw size={16}/><span>Refresh</span></Button></div></div>
        <div className="page-heading"><div><p className="eyebrow">INVENTORY MANAGEMENT</p><h1>{intake ? "Batch intake" : scan ? (scan.kind === "checkout" ? "Scan checkout" : "Scan return") : view === "assets" ? "Intake & removal" : view === "teaching-groups" ? "Teaching groups" : view === "inventory" ? "Battery inventory" : view === "my-batteries" ? "My batteries" : view === "my-loans" ? "My batteries in use" : view === "my-activity" ? "My activity" : view === "messages" ? "Messages" : view === "task-plans" ? "Recurring tasks" : view === "activity" ? "Activity history" : view === "account" ? "My account" : view === "accounts" ? "Staff accounts" : "Manage records"}</h1><p className="page-description">{intake ? "Scan into an editable review queue, then confirm all or selected new batteries. Numbering is automatic after confirmation." : scan ? "Keep scanning until you choose Exit scanning. Process each battery or confirm a batch." : view === "assets" ? "Register new batteries or record retirement and permanent removal, with review before saving." : view === "teaching-groups" ? "Manage your teaching battery groups, their members and recorded operations." : view === "inventory" ? "Manage battery loans, responsibility, buildings and rooms." : view === "my-batteries" ? "Batteries assigned to your staff account as the responsible owner." : view === "my-loans" ? "Your current checkouts, status and checkout times." : view === "my-activity" ? "Inventory operations recorded by your staff account." : view === "messages" ? "Your task reminders, read state and recorded completion." : view === "task-plans" ? "Prepare task content, schedules and staff assignments from three supplied templates." : view === "activity" ? "Trace confirmed actions, their operator and any corrections." : view === "account" ? "Manage your profile, preferences and password." : view === "accounts" ? "Manage staff access and account permissions." : "Shared staff, buildings, rooms and battery records."}</p></div>{!scan && !intake && view !== "assets" && view !== "messages" && view !== "task-plans" && <div className="heading-actions"><Button variant="outline" onClick={() => startScan("return")} disabled={!ready}><RotateCcw />Scan return</Button><Button onClick={() => startScan("checkout")} disabled={!ready}><ScanLine />Scan checkout</Button></div>}</div>
        {dataset === "demo" ? <div className="demo-notice"><FlaskConical size={17}/><span><strong>Demonstration inventory.</strong> Battery specifications and sample activity are fictional. J18 rooms are placeholders awaiting confirmation.</span></div> : <div className="working-notice"><Package size={17}/><span><strong>Working inventory.</strong> Real battery records are awaiting input. J18 rooms are placeholders awaiting confirmation. All staff share this inventory.</span></div>}
        {!scan && !intake && !movement && !!pendingScans.length && <div className="scan-resume-notice" role="status"><div><strong>Unfinished scanning session</strong><p>Resume the captured queue or request before starting a new movement. Recovery is available in this browser tab.</p></div><div className="flex flex-wrap gap-2">{pendingScans.map(pending => <Button key={`${pending.dataset}-${pending.kind}`} variant="outline" onClick={() => resumeScan(pending)} disabled={!ready}>Resume {pending.kind === "checkout" ? "checkout" : "return"} · {pending.dataset === "demo" ? "Demonstration" : "Working"}</Button>)}</div></div>}
        {!scan && !intake && !movement && !!pendingMovements.length && <div className="scan-resume-notice" role="status"><div><strong>Unfinished checkout or return</strong><p>Resume the exact captured request before starting another movement. A lost response does not mean the operation failed. Recovery is available in this browser tab.</p></div><div className="flex flex-wrap gap-2">{pendingMovements.map(pending => <Button key={`${pending.dataset}-${pending.kind}`} variant="outline" onClick={() => resumeMovement(pending)} disabled={!ready}>Resume saved {pending.kind} · {pending.dataset === "demo" ? "Demonstration" : "Working"}</Button>)}</div></div>}
        {!scan && !intake && !movement && view !== "assets" && !!pendingRemovals.length && <div className="scan-resume-notice" role="status"><div><strong>Unfinished retirement or removal</strong><p>Resolve the preserved confirmation before another operation.</p></div>{pendingRemovals.map(pending => <Button key={pending.dataset} variant="outline" onClick={() => resumeRemoval(pending)} disabled={!ready}>Resume removal · {pending.dataset === "demo" ? "Demonstration" : "Working"}</Button>)}</div>}
        {!scan && !intake && !movement && !!pendingIntakes.length && <div className="scan-resume-notice" role="status"><div><strong>Unfinished intake draft or confirmation</strong><p>Your editable review queue or captured confirmation is preserved. Resume it before starting another movement.</p></div><Button variant="outline" onClick={startIntake} disabled={!ready}>Resume batch intake · demo</Button></div>}
        {!groupMaintenance && !!pendingGroupChanges.length && <div className="scan-resume-notice"><div><strong>Unfinished group update</strong><p>Resolve the preserved operation before starting another workflow.</p></div>{pendingGroupChanges.map(pending => <Button key={pending.dataset} variant="outline" disabled={!ready || modalOpen} onClick={() => resumeGroupChange(pending)}>Resume group update · {pending.dataset}</Button>)}</div>}
        {notice && <div className="success-notice" role="status"><span>{notice}</span><Button variant="ghost" size="icon" onClick={() => setNotice("")} aria-label="Dismiss notification"><X size={16}/></Button></div>}
        {error && <div className="load-error" role="alert"><span>{error}</span><Button variant="outline" onClick={refresh} disabled={loading}>Retry refresh</Button></div>}
        {loading && !data ? <div className="loading-panel" aria-label="Loading inventory"><Skeleton className="h-24 w-full"/><Skeleton className="h-72 w-full"/></div> : data && <>
          {view === "assets" && !scan && <section aria-label="Intake and removal workspace"><Tabs value={activeAssetTab} onValueChange={value => { if (!intake && !removalLocked) setAssetTab(value as typeof assetTab); }}><TabsList variant="line"><TabsTrigger value="intake" disabled={!!intake || removalLocked}>New battery intake</TabsTrigger><TabsTrigger value="removal" disabled={!!intake || removalLocked}>Retire or remove</TabsTrigger><TabsTrigger value="history" disabled={!!intake || removalLocked}>Removal history</TabsTrigger></TabsList></Tabs>
            {activeAssetTab === "intake" && (intake ? <IntakeStation key={`${dataset}-${user.id}-${intake.nonce}`} data={data} write={write} onRegistered={taskChanged} onExit={() => { setIntake(null); setNotice(""); void refresh(); }}/> : <div className="intake-panel"><h2>First-time battery intake</h2><p className="field-hint">Set common details once, scan into an editable pending list, then confirm all or selected batteries. Demonstration inputs are available only in Demonstration inventory.</p><Button onClick={startIntake} disabled={!ready}>{pendingIntakes.length ? "Resume demo intake" : "Start demo intake"}</Button></div>)}
            {!intake && <div hidden={activeAssetTab !== "removal"}><RemovalStation key={`${dataset}-${user.id}-${groupRemoval?.nonce ?? "ordinary"}`} initialIds={groupRemoval?.ids} teachingGroup={groupRemoval?.teachingGroup} data={data} write={write} onDetail={id => { setDetailGroup(undefined); setDetailId(id); }} onBusyChange={setRemovalLocked} onExit={() => setView(groupRemoval ? "teaching-groups" : "inventory")} onChanged={() => load(dataset)}/></div>}
            {activeAssetTab === "history" && !intake && <RemovalHistory data={data} onDetail={id => { setDetailGroup(undefined); setDetailId(id); }} onDownload={ids => setExportDraft({ filter: { ...defaultInventoryFilter(), lifecycle: "all" }, page: 0, pageSize: "25", matching: ids.length, pageCount: ids.length, selectedIds: ids, selectedOnly: true })}/>}</section>}
          {scan && <ScanStation key={`${dataset}-${user.id}-${scan.nonce}`} data={data} kind={scan.kind} write={write} paused={!!editor} onExit={() => { setScan(null); setNotice(""); }} onRegister={tagId => { setEditorGroup(undefined); setEditor({ kind: "battery", initialTagId: tagId }); }} onChanged={taskChanged}/>}
          {!scan && !intake && retainInventory && <div hidden={!inventoryView}><InventoryTable key={`${dataset}-${inventoryPersonalScope}`} personalScope={inventoryPersonalScope} data={data} ready={ready} onMovement={startMovement} onEdit={draft => { setEditorGroup(undefined); setEditor(draft); }} onDetail={id => { setDetailGroup(undefined); setDetailId(id); }} onOpenGroups={openTeachingGroups} onSetup={() => setView("manage")} onExport={setExportDraft} onGroupsChanged={() => load(dataset)} onGroupDialogChange={setGroupsOpen}/></div>}
          {!scan && !intake && view === "teaching-groups" && <TeachingGroupsWorkspace key={`${dataset}-${user.id}`} data={data} ready={ready} activeId={activeGroupId} onActiveChange={setActiveGroupId} onBack={returnFromTeachingGroups} returnBlocked={modalOpen} onMovement={startMovement} onRemoval={startGroupRemoval} onMaintenance={(ids, group) => { if (!modalOpen && !interceptPendingGroupChange()) { if (pendingIntakes.length || pendingRemovals.length || pendingScans.length || pendingMovements.length) { setNotice("Resume the unfinished workflow before updating group members."); return; } setGroupMaintenance({ ids, group }); } }} onEdit={(draft, group) => { setEditorGroup(group); setEditor(draft); }} onDetail={(id, group) => { setDetailGroup(group); setDetailId(id); }} onExport={setExportDraft} onChanged={taskChanged} onDialogChange={setGroupsOpen} onActivity={group => { setActivityGroupId(group.id); setView("activity"); }}/>}
          {!scan && !intake && (view === "activity" || view === "my-activity") && <ActivityHistory key={`${dataset}-${activityScope}-${data.user.id}`} data={data} scope={activityScope} revision={revision} groupId={activityGroupId} onGroupFilterChange={setActivityGroupId} onDialogChange={setGroupsOpen} onDetail={id => { setDetailGroup(undefined); setDetailId(id); }}/>}
          {!scan && !intake && view === "manage" && <RecordManagement data={data} ready={ready} onEdit={draft => { setEditorGroup(undefined); setEditor(draft); }} onDetail={id => { setDetailGroup(undefined); setDetailId(id); }} onImport={setImportKind}/>}
          {!scan && !intake && view === "account" && <MyAccount user={user} onSaved={() => load(dataset)}/>}
          {!scan && !intake && view === "accounts" && user.role === "admin" && <AccountManagement currentUser={user} onSaved={() => load(dataset)}/>}
          {!scan && !intake && view === "task-plans" && <TaskPlansPanel key={`${dataset}-${user.id}`} data={data} onChanged={taskChanged} onDetail={id => { setDetailGroup(undefined); setDetailId(id); }}/>}
          {!scan && !intake && view === "messages" && <MessagesPanel key={`${dataset}-${user.id}`} data={data} onChanged={taskChanged} onDetail={id => { setDetailGroup(undefined); setDetailId(id); }} onUnreadCount={acceptUnreadCount}/>}
          <div className="reader-note"><Radio size={18}/><div><strong>Room detection is awaiting hardware validation.</strong><p>RFID observations will require a verified reader-to-room mapping. Loan changes require a staff-operated checkout or return.</p></div><span className="pending-badge">NOT CONNECTED</span></div>
        </>}</main><footer className="workspace-footer"><span>DESN2000 · Battery inventory prototype</span><span>Australia / Sydney · Refreshes every 10 seconds while idle</span></footer>
    </SidebarInset>
    {data && movement && <MovementDialog key={movement.nonce} draft={movement} data={data} onClose={reviewedInventory => {
        if (reviewedInventory?.dataset === dataset && reviewedInventory.user.id === user.id) {
            loadSequence.current++; current.current = reviewedInventory; setData(reviewedInventory); setUser(reviewedInventory.user); setRevision(value => value + 1);
        }
        setMovement(null);
    }} write={write}/>}
    {data && editor && <RecordEditor key={`${editor.kind}-${editor.record?.id ?? "new"}`} draft={editor} data={data} onClose={() => { setEditor(null); setEditorGroup(undefined); }} write={groupWrite(editorGroup)}/>}
    {data && detailBattery && <BatteryDetails key={`${dataset}-${detailBattery.id}`} battery={detailBattery} data={data} revision={revision} onClose={() => { setDetailId(null); setDetailGroup(undefined); }} onExport={() => setExportDraft({ batteryId: detailBattery.id, filter: { ...defaultInventoryFilter(), personalScope }, page: 0, pageSize: "25", matching: 1, pageCount: 1 })} onEdit={battery => { setDetailId(null); setEditorGroup(detailGroup); setEditor({ kind: "battery", record: battery }); }} write={groupWrite(detailGroup)}/>}
    {data && groupMaintenance && <GroupMaintenanceDialog key={`${dataset}-${user.id}`} data={data} group={groupMaintenance.group} ids={groupMaintenance.ids} write={write} onChanged={taskChanged} onClose={() => setGroupMaintenance(null)}/>}
    {exportDraft && <ExportDialog draft={exportDraft} dataset={dataset} onClose={() => setExportDraft(null)}/> }
    {importKind && <ImportDialog kind={importKind} onClose={() => setImportKind(null)} write={write}/>}
  </SidebarProvider>;
}
