"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import Link from "next/link";
import { Activity, AlertTriangle, BatteryFull, Bell, CalendarClock, ExternalLink, LayoutDashboard, LogOut, RefreshCw, Search, Settings2, Table2, X } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { StaffUser } from "@/lib/accounts";
import type { BatteryRecord, Dataset } from "@/lib/domain";
import type { TaskCycleRecord } from "@/lib/task-plans";
import type { EditorDraft, ExportDraft, ImportKind, WriteAction } from "@/lib/client/inventory-contracts";
import { getRolePermissions } from "@/lib/permissions";
import { signOut } from "@/lib/client-session";
import { defaultInventoryFilter } from "@/lib/inventory-query";
import { inventoryResponse } from "@/lib/client/inventory-request";
import { summarizeOverview } from "@/lib/console/overview";
import { statusLabel } from "@/lib/console/battery-columns";
import type { ConsoleViewId } from "@/lib/console/views";
import { useInventoryData, useInventoryPolling } from "@/hooks/use-inventory-data";
import { useMessageCount } from "@/hooks/use-message-count";
import { useNewArrivals } from "@/hooks/use-new-arrivals";
import { BatteryDetails } from "@/components/inventory/battery-detail";
import { ExportDialog } from "@/components/inventory/export-dialog";
import { RecordEditor } from "@/components/inventory/record-editor";
import { ImportDialog } from "@/components/inventory/import-dialog";
import { ActivityHistory } from "@/components/inventory/activity-history";
import { RecordManagement } from "@/components/inventory/record-management";
import { AccountManagement, MyAccount } from "@/components/inventory/accounts-panel";
import { TaskCycleDialog } from "@/components/inventory/tasks/task-cycle-dialog";
import { useTaskRecords } from "./use-task-records";
import { OverviewView } from "./overview-view";
import { BatteriesView, type BatteriesIntent } from "./batteries-view";
import { TasksView, type TasksTab } from "./tasks-view";
import styles from "./console.module.css";

type Area = "overview" | "batteries" | "tasks" | "activity" | "admin";
const areas: Area[] = ["overview", "batteries", "tasks", "activity", "admin"];

function readArea(): Area {
  if (typeof window === "undefined") return "overview";
  const value = new URLSearchParams(window.location.search).get("area");
  return areas.includes(value as Area) ? (value as Area) : "overview";
}
function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]!.toUpperCase()).join("") || "?";
}
function ago(ms: number) {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 10) return "just now";
  if (seconds < 60) return `${seconds} s ago`;
  const minutes = Math.round(seconds / 60);
  return minutes < 60 ? `${minutes} min ago` : `${Math.round(minutes / 60)} h ago`;
}

/** Quick find in the top bar: jumps to a battery's summary from anywhere in the console. */
function QuickFind({ batteries, onPick }: { batteries: readonly BatteryRecord[]; onPick: (battery: BatteryRecord) => void }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.key === "/" && !event.ctrlKey && !event.metaKey && !target?.closest("input, textarea, select, [contenteditable=true]") && !document.querySelector("[role=dialog]")) { event.preventDefault(); input.current?.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  const results = useMemo(() => {
    const text = query.trim().toLowerCase();
    if (!text) return [];
    const scored = batteries.flatMap((battery) => {
      const id = battery.id.toLowerCase(), name = battery.name.toLowerCase(), tag = battery.tagId?.toLowerCase() ?? "";
      const score = id === text || tag === text ? 0 : id.startsWith(text) ? 1 : id.includes(text) ? 2 : name.includes(text) ? 3 : tag.includes(text) || battery.model.toLowerCase().includes(text) ? 4 : -1;
      return score < 0 ? [] : [{ battery, score }];
    });
    return scored.sort((a, b) => a.score - b.score || a.battery.id.localeCompare(b.battery.id, "en", { numeric: true })).slice(0, 8).map((item) => item.battery);
  }, [batteries, query]);
  function pick(battery: BatteryRecord) { onPick(battery); setQuery(""); setOpen(false); input.current?.blur(); }
  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") { event.preventDefault(); setActive((value) => Math.min(results.length - 1, value + 1)); }
    else if (event.key === "ArrowUp") { event.preventDefault(); setActive((value) => Math.max(0, value - 1)); }
    else if (event.key === "Enter" && results[active]) { event.preventDefault(); pick(results[active]); }
    else if (event.key === "Escape") { setQuery(""); setOpen(false); input.current?.blur(); }
  }
  return <div className={styles.search}>
    <Search size={15} className={styles.searchIcon} aria-hidden="true" />
    <input ref={input} className={styles.searchInput} value={query} placeholder="Find a battery by ID, name or tag" aria-label="Find a battery" role="combobox" aria-expanded={open && !!query} aria-controls="console-quick-find"
      onChange={(event) => { setQuery(event.target.value); setActive(0); setOpen(true); }} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)} onKeyDown={onKeyDown} />
    {!query && <span className={styles.searchHint}>/</span>}
    {open && query.trim() && <div className={styles.searchResults} id="console-quick-find" role="listbox">
      {results.length ? results.map((battery, index) => <button key={battery.id} type="button" role="option" aria-selected={index === active} className={styles.searchResult} onMouseDown={(event) => event.preventDefault()} onClick={() => pick(battery)}>
        <span className={styles.idCell}>{battery.id}</span><span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{battery.name}</span><span className={styles.muted} style={{ fontSize: 12 }}>{statusLabel(battery)}</span>
      </button>) : <div className={styles.searchEmpty}>No battery matches “{query.trim()}”.</div>}
    </div>}
  </div>;
}

export function ManagementConsole({ initialUser }: { initialUser: StaffUser }) {
  const { user, dataset, data, loading, error, revision, setError, setRevision, load, refresh, changeDataset } = useInventoryData(initialUser);
  const permissions = getRolePermissions(user.role);
  const [area, setAreaState] = useState<Area>("overview");
  const [visited, setVisited] = useState<Set<Area>>(() => new Set(["overview"]));
  const [tasksTab, setTasksTab] = useState<TasksTab>("due");
  const [intent, setIntent] = useState<BatteriesIntent | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [exportDraft, setExportDraft] = useState<ExportDraft | null>(null);
  const [cycle, setCycle] = useState<TaskCycleRecord | null>(null);
  const [editor, setEditor] = useState<EditorDraft | null>(null);
  const [importKind, setImportKind] = useState<ImportKind | null>(null);
  const [accountOpen, setAccountOpen] = useState(false);
  const [adminTab, setAdminTab] = useState<"accounts" | "records">("records");
  const [lastLoaded, setLastLoaded] = useState<number | null>(null);
  const [clock, setClock] = useState(0);
  const [embedded, setEmbedded] = useState(false);
  const nonce = useRef(0);
  const [unsavedEdits, setUnsavedEdits] = useState(0);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState("");

  useEffect(() => {
    const initial = readArea();
    queueMicrotask(() => { setAreaState(initial); setVisited((current) => new Set([...current, initial])); });
    let framed = true;
    try { framed = window.self !== window.top; } catch { /* a cross-origin parent means the console is embedded */ }
    queueMicrotask(() => setEmbedded(framed));
    queueMicrotask(() => setClock(Date.now()));
    const tick = setInterval(() => setClock(Date.now()), 5000);
    return () => clearInterval(tick);
  }, []);
  useEffect(() => { if (data) queueMicrotask(() => { const at = Date.now(); setLastLoaded(at); setClock(at); }); }, [data]);

  const setArea = useCallback((next: Area) => {
    setAreaState(next);
    setVisited((current) => (current.has(next) ? current : new Set([...current, next])));
    try {
      const url = new URL(window.location.href);
      if (next === "overview") url.searchParams.delete("area"); else url.searchParams.set("area", next);
      window.history.replaceState(null, "", url);
    } catch { /* address bar update is a convenience */ }
  }, []);

  const dialogOpen = !!(detailId || exportDraft || cycle || editor || importKind || accountOpen);
  useInventoryPolling({ paused: dialogOpen || loading, dataset, load, onError: setError });
  const tasks = useTaskRecords(dataset, user.id, revision, dialogOpen);
  const newArrivals = useNewArrivals(data, load);
  const { unreadCount, acceptUnreadCount } = useMessageCount(dataset, user.id, area === "tasks" && tasksTab === "messages", revision);
  const summary = useMemo(() => data ? summarizeOverview({ snapshot: data, cycles: tasks.data?.cycles ?? [], newArrivals: newArrivals.arrivals, now: clock || undefined }) : null, [data, tasks.data, newArrivals.arrivals, clock]);

  const openBatteries = useCallback((view?: ConsoleViewId, inspect?: string) => {
    nonce.current += 1;
    setIntent({ nonce: nonce.current, view, inspect });
    setArea("batteries");
  }, [setArea]);

  const changed = useCallback(async () => {
    setRevision((value) => value + 1);
    await load(dataset);
  }, [dataset, load, setRevision]);

  const write: WriteAction = async (action, payload, extra = {}) => {
    const body = await inventoryResponse<{ result: Record<string, unknown> }>(await fetch("/api/inventory", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dataset, action, payload, ...extra }),
    }));
    // Inspection and retired-asset forms verify their own receipts before reporting success.
    if (action === "inspection" || action === "inspection_void" || action === "retired_asset" || action === "scan_lookup") return body.result;
    try { await changed(); } catch { setError("The change was saved, but the inventory could not refresh. Refresh before starting another change."); }
    return body.result;
  };

  const detailBattery = detailId && data ? data.batteries.find((battery) => battery.id === detailId) : undefined;
  const switchDataset = (mode: Dataset) => { if (mode !== dataset && !dialogOpen && !unsavedEdits) { setDetailId(null); changeDataset(mode); } };
  const switchBlocked = unsavedEdits ? `Save or discard ${unsavedEdits === 1 ? "the unsaved battery edit" : `${unsavedEdits} unsaved battery edits`} before switching inventory.` : undefined;
  const loadedAgo = lastLoaded ? ago(clock - lastLoaded) : null;

  const nav: { id: Area; label: string; icon: typeof LayoutDashboard; count?: number | null }[] = [
    { id: "overview", label: "Overview", icon: LayoutDashboard },
    { id: "batteries", label: "Batteries", icon: Table2 },
    { id: "tasks", label: "Tasks", icon: CalendarClock, count: summary ? summary.tasks.overdue + summary.tasks.dueToday || null : null },
    { id: "activity", label: "Activity", icon: Activity },
    ...(permissions.manageAccounts || permissions.manageDirectories ? [{ id: "admin" as const, label: "Admin", icon: Settings2 }] : []),
  ];

  return <div className={styles.root}>
    <header className={styles.bar}>
      <div className={styles.brand}><span className={styles.brandMark}><BatteryFull size={18} aria-hidden="true" /></span></div>
      <span className={styles.brandName}>Battery management<small>DESN2000 · management console</small></span>
      <div className={styles.segmented} role="group" aria-label="Inventory">
        <button type="button" aria-pressed={dataset === "live"} disabled={dialogOpen || (!!unsavedEdits && dataset !== "live")} title={switchBlocked} onClick={() => switchDataset("live")}>Working</button>
        <button type="button" aria-pressed={dataset === "demo"} disabled={dialogOpen || (!!unsavedEdits && dataset !== "demo")} title={switchBlocked} onClick={() => switchDataset("demo")}>Demonstration</button>
      </div>
      {data ? <QuickFind batteries={data.batteries} onPick={(battery) => openBatteries(undefined, battery.id)} /> : <span className={styles.barSpacer} />}
      <span className={styles.barSpacer} />
      <span className={styles.barStatus} data-tone={error ? "error" : undefined} role="status">
        <span className={styles.dot} data-tone={error ? "error" : loading ? "busy" : undefined} />
        {error ? "Not up to date" : loading && !data ? "Loading…" : loadedAgo ? `Updated ${loadedAgo}` : ""}
      </span>
      <button type="button" className={styles.iconButton} onClick={() => void refresh()} aria-label="Refresh" title="Refresh"><RefreshCw size={17} /></button>
      <button type="button" className={styles.iconButton} onClick={() => { setTasksTab("messages"); setArea("tasks"); }} aria-label={`Messages${unreadCount ? `, ${unreadCount} unread` : ""}`} title="Messages">
        <Bell size={17} />{unreadCount ? <span className={styles.badge}>{unreadCount > 99 ? "99+" : unreadCount}</span> : null}
      </button>
      <Link className={styles.iconButton} href="/" target={embedded ? "_blank" : undefined} rel="noreferrer" aria-label="Open the full application" title={embedded ? "Open the full application in a new browser tab" : "Open the full application"}><ExternalLink size={17} /></Link>
      <button type="button" className={styles.account} onClick={() => setAccountOpen(true)} aria-label={`My account: ${user.displayName}, ${user.role === "admin" ? "Administrator" : "Staff"}`}>
        <span className={styles.avatar}>{initials(user.displayName)}</span>
        <span className={styles.accountName}>{user.displayName}<br /><span className={styles.role}>{user.role === "admin" ? "Administrator" : "Staff"}</span></span>
      </button>
    </header>

    <nav className={styles.rail} aria-label="Console areas">
      {nav.map((item) => <button key={item.id} type="button" className={styles.railItem} aria-current={area === item.id ? "page" : undefined} onClick={() => setArea(item.id)}>
        <item.icon size={20} aria-hidden="true" />{item.label}{item.count ? <span className={styles.railCount}>{item.count}</span> : null}
      </button>)}
    </nav>

    <main className={styles.main}>
      {error && <div className={styles.notice} data-tone="danger" style={{ margin: "12px 24px 0" }}><AlertTriangle size={16} /><div className={styles.noticeBody}><p>{error}</p></div><button type="button" className={styles.btn} onClick={() => void refresh()}>Retry</button></div>}
      {embedded && <div className={styles.notice} style={{ margin: "12px 24px 0" }}>
        <p>Signed in inside Teams with your battery inventory account (not your UNSW account). Sign out here from My account; the browser has its own sign-in. Edits not yet confirmed stay with this tab, so finish them here. If a download does not start, <Link className={styles.link} href="/console" target="_blank" rel="noreferrer">open the console in your browser</Link>.</p>
      </div>}
      {!data ? <div className={styles.page}><div className={styles.empty} style={{ paddingTop: 80 }}><strong>{error ? "The inventory could not be loaded" : "Loading the inventory…"}</strong>{error ? "Check the connection, then retry." : "This uses the same records as the full application."}</div></div> : <>
        {area === "overview" && summary && <OverviewView snapshot={data} summary={summary} tasks={tasks.data} tasksError={tasks.error} tasksLoading={tasks.loading}
          onOpenBatteries={(view) => openBatteries(view)} onOpenTasks={() => { setTasksTab("due"); setArea("tasks"); }} onCompleteCycle={setCycle} onInspect={(id) => openBatteries(undefined, id)} />}
        {visited.has("batteries") && <div className={area === "batteries" ? styles.workspace : styles.hidden}>
          <BatteriesView key={`${dataset}:${user.id}`} snapshot={data} revision={revision} now={clock} intent={intent} canEdit={permissions.editBatteryRecords} newArrivals={newArrivals.arrivals}
            onArrivalsOpened={() => { if (newArrivals.arrivals) void newArrivals.acknowledge(newArrivals.arrivals.throughSequence); }}
            onOpenRecord={(battery) => setDetailId(battery.id)} onExport={setExportDraft} onChanged={() => void changed().catch(() => setError("Saved changes could not be refreshed. Refresh before editing again."))} onDraftCountChange={setUnsavedEdits} />
        </div>}
        {area === "tasks" && <TasksView snapshot={data} today={summary?.today ?? ""} tasks={tasks.data} error={tasks.error} loading={tasks.loading} tab={tasksTab} onTab={setTasksTab} onReload={() => void tasks.reload()}
          onComplete={setCycle} onChanged={changed} onDetail={(id) => openBatteries(undefined, id)} onUnreadCount={acceptUnreadCount} unreadCount={unreadCount} />}
        {area === "activity" && <div className={styles.page}>
          <div className={styles.pageHead}><div><h1 className={styles.pageTitle}>Activity</h1><p className={styles.pageSub}>Every recorded operation in this inventory, with exports.</p></div></div>
          <div className={styles.embeddedFull}><ActivityHistory key={`${dataset}-${user.id}`} data={data} ready={!loading} scope="all" revision={revision} onDetail={(id) => openBatteries(undefined, id)} /></div>
        </div>}
        {area === "admin" && <div className={styles.page}>
          <div className={styles.pageHead}><div><h1 className={styles.pageTitle}>Administration</h1><p className={styles.pageSub}>Directories, saved records and staff accounts. Only administrators can change them.</p></div></div>
          <div className={styles.tabs} role="tablist">
            <button type="button" role="tab" className={styles.tab} aria-selected={adminTab === "records"} onClick={() => setAdminTab("records")}>Records and directories</button>
            {permissions.manageAccounts && <button type="button" role="tab" className={styles.tab} aria-selected={adminTab === "accounts"} onClick={() => setAdminTab("accounts")}>Staff accounts</button>}
          </div>
          <div className={styles.embeddedFull}>
            {adminTab === "records" && <RecordManagement data={data} ready={!loading} onEdit={setEditor} onDetail={setDetailId} onImport={setImportKind} />}
            {adminTab === "accounts" && permissions.manageAccounts && <AccountManagement currentUser={user} onSaved={() => load(dataset)} />}
          </div>
        </div>}
      </>}
    </main>

    {data && detailBattery && <BatteryDetails key={`${dataset}-${detailBattery.id}`} battery={detailBattery} data={data} revision={revision}
      onInspectionChanged={() => { void changed().catch(() => setError("The inspection was saved, but the inventory could not refresh.")); }}
      onClose={() => setDetailId(null)}
      onExport={() => setExportDraft({ batteryId: detailBattery.id, filter: defaultInventoryFilter(), page: 0, pageSize: "25", matching: 1, pageCount: 1 })}
      onEdit={(battery) => { setDetailId(null); setEditor({ kind: "battery", record: battery }); }}
      write={write} />}
    {data && editor && <RecordEditor key={`${editor.kind}-${editor.record?.id ?? "new"}`} draft={editor} data={data} onClose={() => setEditor(null)} write={write} />}
    {importKind && <ImportDialog kind={importKind} onClose={() => setImportKind(null)} write={write} />}
    {exportDraft && <ExportDialog draft={exportDraft} dataset={dataset} onClose={() => setExportDraft(null)} />}
    {data && cycle && <TaskCycleDialog cycle={cycle} data={data} onClose={() => setCycle(null)} onSaved={async () => { setCycle(null); await tasks.reload(); await changed(); }} onDetail={(id) => { setCycle(null); openBatteries(undefined, id); }} />}
    {accountOpen && <Dialog open onOpenChange={(open) => { if (!open) setAccountOpen(false); }}>
      <DialogContent className={`${styles.portal} max-w-[720px] sm:max-w-[720px]`}>
        <DialogHeader><DialogTitle>My account</DialogTitle><DialogDescription>Your profile, password and starting inventory.{embedded ? " Signing out here ends the session of this Teams tab; the browser signs in separately." : ""}</DialogDescription></DialogHeader>
        <div style={{ maxHeight: "70vh", overflow: "auto" }}><MyAccount user={user} onSaved={() => load(dataset)} /></div>
        {signOutError && <div className={styles.notice} data-tone="danger" role="alert"><AlertTriangle size={16} /><div className={styles.noticeBody}><p>{signOutError}</p></div></div>}
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
          <button type="button" className={styles.btn} disabled={signingOut || !!unsavedEdits} title={unsavedEdits ? "Save or discard the unsaved battery edits before signing out." : undefined}
            onClick={() => { setSigningOut(true); setSignOutError(""); void signOut().catch((failure: unknown) => { setSignOutError(failure instanceof Error ? failure.message : "Sign-out could not complete. Try again."); setSigningOut(false); }); }}>
            <LogOut size={15} />{signingOut ? "Signing out…" : "Sign out"}</button>
          <button type="button" className={styles.btn} onClick={() => setAccountOpen(false)}><X size={15} />Close</button>
        </div>
      </DialogContent>
    </Dialog>}
  </div>;
}
