"use client";
import { useCallback, useEffect, useState } from "react";
import { flushSync } from "react-dom";
import { Package, Radio, FlaskConical, RefreshCw, LogOut, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { LoadingState, RefreshStatus } from "@/components/ui/loading-state";
import { MovementDialog } from "@/components/inventory/movement-dialog";
import { RecordEditor } from "@/components/inventory/record-editor";
import { BatteryDetails } from "@/components/inventory/battery-detail";
import { ImportDialog } from "@/components/inventory/import-dialog";
import {
  InventoryTable,
  RecordManagement,
  ActivityHistory,
} from "@/components/inventory/views";
import type { Dataset } from "@/lib/domain";
import { defaultInventoryFilter } from "@/lib/inventory-query";
import { registerInventoryTools } from "@/lib/browser-tools";
import type { StaffUser } from "@/lib/accounts";
import { getRolePermissions } from "@/lib/permissions";
import {
  MyAccount,
  AccountManagement,
} from "@/components/inventory/accounts-panel";
import { ExportDialog } from "@/components/inventory/export-dialog";
import { TaskPlansPanel } from "@/components/inventory/task-plans-panel";
import { MessagesPanel } from "@/components/inventory/messages-panel";
import { ScanStation } from "@/components/inventory/scan-station";
import { IntakeStation } from "@/components/inventory/intake-station";
import {
  RemovalStation,
  RemovalHistory,
} from "@/components/inventory/removal-station";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { isActiveBattery } from "@/lib/battery-lifecycle";
import {
  captureLifecycleAttempt,
  verifyLifecycleReceipt,
  type LifecyclePayload,
} from "@/lib/lifecycle-session";
import {
  captureIntakeAttempt,
  verifyIntakeReceipt,
  type IntakePayload,
} from "@/lib/intake-session";
import {
  verifyMovementReceipt,
  type MovementPayload,
} from "@/lib/movement-session";
import { TeachingGroupsWorkspace } from "@/components/inventory/teaching-groups-workspace";
import { MappingWorkspace } from "@/components/inventory/mapping-workspace";
import { LocationToolsPanel } from "@/components/inventory/location-tools-panel";
import type { LocationAttempt } from "@/lib/client/location-request";
import { useLocationRecovery } from "@/hooks/use-location-recovery";
import { GroupMaintenanceDialog } from "@/components/inventory/group-maintenance-dialog";
import { TeachingCheckoutDialog, type TeachingCheckoutDraft } from "@/components/inventory/teaching-checkout-dialog";
import { recoverTeachingCheckoutAttempt, teachingCheckoutStorageKey, type TeachingCheckoutAttempt } from "@/lib/client/teaching-checkout-request";
import { recoverTeachingCheckoutDraft, teachingCheckoutDraftStorageKey, type SavedTeachingCheckoutDraft } from "@/lib/client/teaching-checkout-draft";
import type { TeachingCheckoutListedRun } from "@/lib/teaching-checkouts";
import { downloadTeachingCheckoutReport } from "@/lib/client/teaching-checkout-download";
import type { TeachingGroupReference } from "@/lib/teaching-context";
import type { TeachingGroup } from "@/lib/teaching-groups";
import type {
  MovementDraft,
  WriteAction,
  EditorDraft,
  ExportDraft,
  ImportKind,
} from "@/lib/client/inventory-contracts";
import { RecoveryNotices } from "@/components/application/recovery-notices";
import { useMessageCount } from "@/hooks/use-message-count";
import { useNewArrivals } from "@/hooks/use-new-arrivals";
import { ApplicationShell } from "@/components/application/application-shell";
import {
  WorkspaceHeading,
  type ApplicationView as View,
} from "@/components/application/workspace-heading";
import {
  useInventoryData,
  useInventoryPolling,
} from "@/hooks/use-inventory-data";
import { useWorkflowRecovery } from "@/hooks/use-workflow-recovery";
import {
  nextPendingWorkflow,
  type PendingWorkflow,
} from "@/lib/client/workflow-recovery";
import { inventoryResponse } from "@/lib/client/inventory-request";
import { transitionWorkspace } from "@/lib/client/workspace-motion";
import { MotionPresence } from "@/components/ui/workspace-motion";

export default function InventoryApp({
  initialUser,
}: {
  initialUser: StaffUser;
}) {
  const {
    user,
    dataset,
    data,
    loading,
    error,
    revision,
    current,
    setError,
    setRevision,
    load,
    refresh,
    changeDataset: selectDataset,
    acceptReviewedInventory,
  } = useInventoryData(initialUser);
  const newArrivals = useNewArrivals(data, load);
  const [exportDraft, setExportDraft] = useState<ExportDraft | null>(null);

  const permissions = getRolePermissions(user.role);
  const [notice, setNotice] = useState("");
  const [requestedView, setView] = useState<View>("inventory");
  const view =
    requestedView === "accounts" && !permissions.manageAccounts
      ? "inventory"
      : requestedView;
  const { unreadCount, acceptUnreadCount } = useMessageCount(
    dataset,
    user.id,
    view === "messages",
    revision,
  );
  const [movement, setMovement] = useState<MovementDraft | null>(null),
    [editor, setEditor] = useState<EditorDraft | null>(null);
  const [scan, setScan] = useState<{
    kind: "checkout" | "return";
    nonce: string;
  } | null>(null);
  const [intake, setIntake] = useState<{ nonce: string } | null>(null);
  const assetWorkspaceOpen = view === "assets" && !scan;
  const [assetTab, setAssetTab] = useState<"intake" | "removal" | "history">(
    "intake",
  );
  const [removalLocked, setRemovalLocked] = useState(false);
  const [retiredActionLocked, setRetiredActionLocked] = useState(false);
  const assetLocked = removalLocked || retiredActionLocked;
  const {
    recovery,
    unavailable: recoveryUnavailable,
    read: readRecovery,
  } = useWorkflowRecovery(user.id);
  const {
    removals: pendingRemovals,
    retiredActions: pendingRetiredActions,
    intakes: pendingIntakes,
    movements: pendingMovements,
    scans: pendingScans,
  } = recovery;
  const activeAssetTab = !intake && retiredActionLocked ? "history" : removalLocked && !intake ? "removal" : assetTab;
  const [detailId, setDetailId] = useState<string | null>(null),
    [importKind, setImportKind] = useState<ImportKind | null>(null);
  const [detailMappingRoom, setDetailMappingRoom] = useState<string | null>(null);
  const [locationToolsOpen, setLocationToolsOpen] = useState(false);
  const { recovery: locationRecovery, read: readLocationRecovery } = useLocationRecovery(user.id);
  const [groupsOpen, setGroupsOpen] = useState(false);
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null),
    [activityGroupId, setActivityGroupId] = useState<string | null>(null);
  const [groupsReturnView, setGroupsReturnView] =
    useState<Exclude<View, "teaching-groups">>("inventory");
  const [editorGroup, setEditorGroup] = useState<
      TeachingGroupReference | undefined
    >(),
    [detailGroup, setDetailGroup] = useState<
      TeachingGroupReference | undefined
    >();
  const [groupMaintenance, setGroupMaintenance] = useState<{
    group?: TeachingGroup;
    ids: string[];
  } | null>(null);
  const [groupRemoval, setGroupRemoval] = useState<{
    teachingGroup?: TeachingGroupReference;
    ids: string[];
    nonce: string;
    returnView?: View;
  } | null>(null);
  const [teachingCheckout, setTeachingCheckout] = useState<TeachingCheckoutDraft | null>(null);
  const [teachingRecovery, setTeachingRecovery] = useState<{ attempts: TeachingCheckoutAttempt[]; drafts: SavedTeachingCheckoutDraft[]; error: string }>({ attempts: [], drafts: [], error: "" });
  const readTeachingRecovery = useCallback(() => {
    const attempts: TeachingCheckoutAttempt[] = [], drafts: SavedTeachingCheckoutDraft[] = [], failures: string[] = [];
    for (const mode of ["demo", "live"] as const) {
      let exactRequestPresent = true;
      try {
        const raw = sessionStorage.getItem(teachingCheckoutStorageKey(user.id, mode));
        exactRequestPresent = raw !== null;
        const attempt = recoverTeachingCheckoutAttempt(raw, user.id, mode);
        if (attempt) attempts.push(attempt);
      } catch (failure) { failures.push(`${mode}: ${(failure as Error).message}`); }
      if (exactRequestPresent) continue;
      try {
        const draft = recoverTeachingCheckoutDraft(sessionStorage.getItem(teachingCheckoutDraftStorageKey(user.id, mode)), user.id, mode);
        if (draft) drafts.push(draft);
      } catch (failure) { failures.push(`${mode}: ${(failure as Error).message}`); }
    }
    return { attempts, drafts, error: failures.join(" ") };
  }, [user.id]);
  const teachingPending = !!teachingRecovery.error || teachingRecovery.attempts.length > 0 || teachingRecovery.drafts.length > 0;
  useEffect(() => {
    function read() {
      try { setTeachingRecovery(readTeachingRecovery()); }
      catch (failure) { setTeachingRecovery({ attempts: [], drafts: [], error: (failure as Error).message }); }
    }
    read(); window.addEventListener("battery-teaching-checkout-recovery", read);
    return () => window.removeEventListener("battery-teaching-checkout-recovery", read);
  }, [readTeachingRecovery]);
  function changeDataset(mode: Dataset) {
    if (assetWorkspaceOpen) return;
    changeWorkflowDataset(mode);
  }
  function changeWorkflowDataset(mode: Dataset) {
    if (modalOpen || interceptPendingTeachingCheckout()) return;
    setNotice("");
    setActiveGroupId(null);
    setActivityGroupId(null);
    selectDataset(mode);
  }
  const write: WriteAction = async (action, payload, extra = {}) => {
    if (action !== "scan_lookup") {
      const teaching = readTeachingRecovery();
      if (teaching.attempts.length || teaching.drafts.length || teaching.error) throw new Error("Resume and resolve the preserved teaching checkout before saving another business operation.");
    }
    const intakeAttempt =
      action === "intake"
        ? captureIntakeAttempt(user.id, dataset, payload as IntakePayload)
        : null;
    const lifecycleAttempt =
      action === "lifecycle"
        ? captureLifecycleAttempt(user.id, dataset, payload as LifecyclePayload)
        : null;
    const body = await inventoryResponse<{
      result: Record<string, unknown>;
    }>(
      await fetch("/api/inventory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dataset, action, payload, ...extra }),
      }),
    );
    if (action === "scan_lookup") return body.result;
    // Each form verifies its exact receipt before displaying success or refreshing.
    if (action === "inspection" || action === "inspection_void" || action === "retired_asset") return body.result;
    if (intakeAttempt) {
      verifyIntakeReceipt(body.result, intakeAttempt);
      return body.result;
    }
    if (lifecycleAttempt) {
      verifyLifecycleReceipt(body.result, lifecycleAttempt);
      return body.result;
    }
    if (action === "movement")
      verifyMovementReceipt(body.result, payload as MovementPayload, user.id);
    setRevision((r) => r + 1);
    try {
      await load(dataset);
      if (!scan)
        setNotice(
          action === "movement"
            ? `${body.result.count} ${body.result.count === 1 ? "battery" : "batteries"} ${body.result.kind === "checkout" ? "checked out" : "returned"}.`
            : "Record saved. The audit history has been updated.",
        );
    } catch {
      setError(
        "The change was saved, but the inventory could not refresh. Refresh before starting another operation.",
      );
      if (!scan) setNotice("Your change was saved successfully.");
    }
    return body.result;
  };
  const dialogOpen = !!(
      movement ||
      editor ||
      detailId ||
      importKind ||
      exportDraft ||
      groupsOpen ||
      groupMaintenance ||
      locationToolsOpen ||
      teachingCheckout
    );
  const modalOpen = !!(intake || scan || assetLocked || dialogOpen),
    navigationLocked = modalOpen || assetWorkspaceOpen,
    ready = !!data && !loading && !error && !teachingRecovery.error && !teachingRecovery.attempts.length && !teachingRecovery.drafts.length;
  function showWorkspace(update: () => void) {
    transitionWorkspace(update, "navigation");
    if (typeof window !== "undefined") window.scrollTo?.({ top: 0, behavior: "instant" });
    if (typeof document !== "undefined") document.getElementById?.("workspace-content")?.focus?.({ preventScroll: true });
  }
  function openTeachingGroups() {
    if (navigationLocked || interceptPendingTeachingCheckout()) return;
    showTeachingGroups();
  }
  function showTeachingGroups() {
    if (view !== "teaching-groups") {
      setGroupsReturnView(view);
      setActiveGroupId(null);
    }
    if (view !== "teaching-groups") showWorkspace(() => setView("teaching-groups"));
  }
  function returnFromTeachingGroups() {
    if (modalOpen || view !== "teaching-groups") return;
    showWorkspace(() => setView(
      groupsReturnView === "accounts" && !permissions.manageAccounts
        ? "inventory"
        : groupsReturnView,
    ));
  }
  function resumeGroupChange(pending: { dataset: Dataset }) {
    if (modalOpen || interceptPendingTeachingCheckout() || interceptPendingRetiredAction()) return;
    if (pending.dataset !== dataset) { setNotice(""); setActiveGroupId(null); setActivityGroupId(null); selectDataset(pending.dataset); }
    showTeachingGroups();
    setGroupMaintenance({ ids: [] });
  }
  function interceptPendingGroupChange() {
    try {
      const saved = readRecovery().groups[0];
      if (!saved) return false;
      resumeGroupChange(saved);
      return true;
    } catch {
      setError(
        "Browser recovery storage is unavailable. Restore access before starting another workflow.",
      );
      return true;
    }
  }
  function interceptPendingWorkflow(exclude?: PendingWorkflow["type"]) {
    const locations = readLocationRecovery();
    if (locations.error) { setError(locations.error); return true; }
    if (locations.attempts.length) { resumeLocationWork(locations.attempts[0]); return true; }
    if (interceptPendingTeachingCheckout()) return true;
    try {
      const pending = nextPendingWorkflow(readRecovery(), exclude);
      if (!pending) return false;
      switch (pending.type) {
        case "retired":
          resumeRetiredAction(pending.pending);
          break;
        case "group":
          resumeGroupChange(pending.pending);
          break;
        case "removal":
          resumeRemoval(pending.pending);
          break;
        case "intake":
          startIntake();
          break;
        case "movement":
          resumeMovement(pending.pending);
          break;
        case "scan":
          resumeScan(pending.pending);
          break;
      }
      return true;
    } catch {
      setError(
        "Browser recovery storage is unavailable. Restore access before starting another workflow.",
      );
      return true;
    }
  }
  function resumeTeachingCheckout(pending: TeachingCheckoutAttempt | SavedTeachingCheckoutDraft) {
    if (modalOpen) return;
    if (pending.dataset !== dataset) { setNotice(""); setActiveGroupId(null); setActivityGroupId(null); selectDataset(pending.dataset); }
    if (view !== "teaching-groups") setGroupsReturnView(view);
    setView("teaching-groups"); setNotice("");
    setTeachingCheckout("payload" in pending ? { kind: "recover", attempt: pending } : { kind: "resume", saved: pending });
  }
  function resumeLocationWork(pending: LocationAttempt) {
    if (modalOpen) return;
    if (pending.dataset !== dataset) selectDataset(pending.dataset);
    setView("mapping");
    setLocationToolsOpen(true);
  }
  function interceptPendingTeachingCheckout() {
    try {
      const saved = readTeachingRecovery(), pending = saved.attempts[0] ?? saved.drafts[0];
      if (!pending) {
        if (saved.error) { setError(`The preserved teaching workflow cannot be recovered safely. ${saved.error}`); return true; }
        return false;
      }
      resumeTeachingCheckout(pending); return true;
    } catch (failure) {
      setError(`The preserved teaching workflow cannot be recovered safely. ${(failure as Error).message}`); return true;
    }
  }
  function groupWrite(reference?: TeachingGroupReference): WriteAction {
    return (action, payload, extra) =>
      write(
        action,
        reference &&
          ["battery", "charge", "observation", "correction"].includes(action)
          ? {
              ...(payload as Record<string, unknown>),
              teachingGroup: reference,
            }
          : payload,
        extra,
      );
  }
  const navigationView = scan || intake ? null : view;
  function openAssets() {
    if (navigationLocked || interceptPendingWorkflow()) return;
    setGroupRemoval(null);
    if (view !== "assets") showWorkspace(() => setView("assets"));
    setNotice("");
  }
  function exitAssets() {
    if (dialogOpen || assetLocked || scan || intake && data) return;
    setIntake(null);
    setNotice("");
    showWorkspace(() => setView(groupRemoval?.returnView ?? (groupRemoval ? "teaching-groups" : "inventory")));
  }
  function resumeRemoval(pending: { dataset: Dataset }) {
    if (modalOpen || interceptPendingTeachingCheckout() || interceptPendingRetiredAction()) return;
    if (dataset !== pending.dataset) changeWorkflowDataset(pending.dataset);
    setView("assets");
    setAssetTab("removal");
  }
  function resumeRetiredAction(pending: { dataset: Dataset }) {
    if (modalOpen || interceptPendingTeachingCheckout()) return;
    if (dataset !== pending.dataset) changeWorkflowDataset(pending.dataset);
    setView("assets");
    setAssetTab("history");
  }
  function interceptPendingRetiredAction() {
    try {
      const pending = readRecovery().retiredActions[0];
      if (!pending) return false;
      resumeRetiredAction(pending);
      return true;
    } catch {
      setError(
        "Browser recovery storage is unavailable. Restore access before starting another workflow.",
      );
      return true;
    }
  }
  function startIntake() {
    if (modalOpen || interceptPendingWorkflow("intake")) return;
    if (dataset !== "demo") changeWorkflowDataset("demo");
    setView("assets");
    setAssetTab("intake");
    setNotice("");
    setIntake({ nonce: crypto.randomUUID() });
  }
  function resumeMovement(pending: {
    dataset: Dataset;
    kind: "checkout" | "return";
  }) {
    if (modalOpen || interceptPendingTeachingCheckout() || interceptPendingRetiredAction()) return;
    if (pending.dataset !== dataset) changeWorkflowDataset(pending.dataset);
    setNotice("");
    setMovement({ kind: pending.kind, ids: [], nonce: crypto.randomUUID() });
  }
  function resumeScan(pending: {
    dataset: Dataset;
    kind: "checkout" | "return";
  }) {
    if (modalOpen || interceptPendingTeachingCheckout() || interceptPendingRetiredAction()) return;
    if (pending.dataset !== dataset) changeWorkflowDataset(pending.dataset);
    setNotice("");
    setScan({ kind: pending.kind, nonce: crypto.randomUUID() });
  }
  function startMovement(
    kind: "checkout" | "return",
    ids: string[] = [],
    teachingGroup?: TeachingGroupReference,
    separateCheckout = false,
  ) {
    if (navigationLocked || interceptPendingWorkflow()) return;
    if (kind === "checkout" && teachingGroup) {
      const group = data?.teachingGroups.find(item => item.id === teachingGroup.id && item.version === teachingGroup.version);
      if (!group) { setError("The reviewed teaching group changed. Refresh and reopen it before checkout."); return; }
      setTeachingCheckout({ kind: "checkout", group, ids: [...ids], personalScope: inventoryPersonalScope, separateCheckout }); setNotice(""); return;
    }
    const reviewed = teachingGroup
      ? (data?.batteries.filter(
          (b) =>
            ids.includes(b.id) &&
            isActiveBattery(b) &&
            (kind === "checkout" ? !b.loanId : !!b.loanId),
        ) ?? [])
      : [];
    const chosen = teachingGroup ? reviewed.map((b) => b.id) : ids;
    setNotice("");
    setMovement({
      kind,
      ids: chosen,
      nonce: crypto.randomUUID(),
      ...(teachingGroup
        ? {
            teachingGroup,
            excludedIds: ids.filter((id) => !chosen.includes(id)),
          }
        : {}),
    });
  }
  function startGroupRemoval(
    ids: string[],
    teachingGroup: TeachingGroupReference,
  ) {
    if (navigationLocked || !ready || interceptPendingGroupChange()) return;
    if (nextPendingWorkflow(readRecovery())) {
      setNotice(
        "Resume the unfinished workflow before starting a group removal.",
      );
      return;
    }
    setGroupRemoval({
      ids: [...ids],
      teachingGroup,
      nonce: crypto.randomUUID(),
    });
    setView("assets");
    setAssetTab("removal");
  }
  function startScan(kind: "checkout" | "return") {
    if (navigationLocked || interceptPendingWorkflow()) return;
    showWorkspace(() => {
      setNotice("");
      setScan({ kind, nonce: crypto.randomUUID() });
    });
  }
  useEffect(
    () =>
      registerInventoryTools(
        () => current.current,
        (draft) => {
          if (navigationLocked)
            throw new Error(
              "Finish or close the current workflow before preparing another movement.",
            );
          if (nextPendingWorkflow(readRecovery()))
            throw new Error(
              "Resume the unfinished workflow before preparing another movement.",
            );
          const teaching = readTeachingRecovery();
          if (teaching.attempts.length || teaching.drafts.length || teaching.error) throw new Error("Resume the preserved teaching checkout before preparing another movement.");
          flushSync(() => setMovement(draft));
        },
      ),
    [navigationLocked, readRecovery, readTeachingRecovery, current],
  );
  useInventoryPolling({ paused: navigationLocked || loading || !data, dataset, load, onError: setError });
  const taskChanged = useCallback(async () => {
    setRevision((value) => value + 1);
    await load(dataset);
  }, [dataset, load, setRevision]);
  const detailBattery = data?.batteries.find((b) => b.id === detailId);
  const personalScope =
    view === "my-batteries"
      ? "responsible"
      : view === "my-loans"
        ? "borrowed"
        : "all";
  const inventoryView =
    view === "inventory" || view === "my-batteries" || view === "my-loans";
  const inventorySourceView =
    view === "teaching-groups" ? groupsReturnView : view;
  const retainInventory =
    inventorySourceView === "inventory" ||
    inventorySourceView === "my-batteries" ||
    inventorySourceView === "my-loans";
  const inventoryPersonalScope =
    inventorySourceView === "my-batteries"
      ? "responsible"
      : inventorySourceView === "my-loans"
        ? "borrowed"
        : "all";
  const activityScope = view === "my-activity" ? "mine" : "all";
  const assetExitHeader = (
    <div className="scan-station-header station-exit-bar">
      <div>
        <h2>{!data ? "Intake & removal" : activeAssetTab === "history" ? "Review removal records" : "First-time battery intake"}</h2>
        <p>{activeAssetTab === "history" ? "Review recorded retirements and removals, download evidence or review eligible recovery actions." : "Prepare new battery records for review. Existing batteries use Scan return."}</p>
        <p className="station-exit-hint">{assetLocked ? "Resolve the current confirmation or storage issue before leaving this workspace." : dialogOpen ? "Finish or close the current review before leaving this workspace." : !data ? "You can exit while inventory data is unavailable. Saved drafts and original requests stay in this tab." : "Choose Exit workspace to finish and restore sidebar navigation. Saved drafts stay in this tab."}</p>
      </div>
      <Button type="button" size="lg" className="station-exit-button" disabled={dialogOpen || assetLocked || !!scan || !!(intake && data)} onClick={exitAssets}>
        <LogOut size={20}/>Exit workspace
      </Button>
    </div>
  );
  return (
    <ApplicationShell
      user={user}
      data={data}
      view={navigationView}
      scan={scan?.kind ?? null}
      intake={!!intake}
      locked={!!(scan || intake || assetWorkspaceOpen || assetLocked || teachingCheckout || teachingPending || locationToolsOpen)}
      ready={ready}
      unreadCount={unreadCount}
      inventoryNoticeCount={newArrivals.arrivals?.unreadCount ?? 0}
      onNavigate={(next) => { if (!navigationLocked && !interceptPendingTeachingCheckout() && view !== next) showWorkspace(() => setView(next)); }}
      onTeachingGroups={openTeachingGroups}
      onAssets={openAssets}
      onScan={startScan}
      onError={setError}
      scopeControls={<>
        <div className="workspace-controls">
          <div className="dataset-control">
            <label htmlFor="dataset-select">Inventory</label>
            <Select
              value={dataset}
              onValueChange={(v) => changeDataset(v as Dataset)}
              disabled={navigationLocked || loading || teachingPending}
            >
              <SelectTrigger id="dataset-select">
                <SelectValue>{dataset === "demo" ? "Demo inventory" : "Working inventory"}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="demo">Demonstration inventory</SelectItem>
                <SelectItem value="live">Working inventory</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="operator-control">
            <span>Operator: {data?.actor ?? "Loading…"}</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={refresh}
              disabled={loading || navigationLocked}
              aria-label="Refresh inventory"
              aria-busy={loading}
            >
              <RefreshCw size={16} className={loading ? "animate-spin" : undefined} aria-hidden="true" />
              <span>Refresh</span>
            </Button>
          </div>
        </div>
        <details className="inventory-context" data-dataset={dataset}>
          <summary>
            {dataset === "demo" ? <FlaskConical size={16} aria-hidden="true" /> : <Package size={16} aria-hidden="true" />}
            <span>{dataset === "demo" ? "Fictional demo data" : "Shared working data"}</span>
            <span className="context-disclosure">About this data</span>
          </summary>
          <p>{dataset === "demo" ? "Battery specifications and sample activity are fictional. J18 rooms are placeholders awaiting confirmation." : "All staff share this inventory. Real battery records are awaiting input. J18 rooms are placeholders awaiting confirmation."}</p>
        </details>
      </>}
    >
      <section className={`workspace${inventoryView && !scan && !intake ? " workspace-inventory" : ""}`} id="workspace-content" tabIndex={-1} aria-label="Current workspace">
        <WorkspaceHeading
          role={user.role}
          view={view}
          scan={scan?.kind ?? null}
          intake={!!intake}
          ready={ready}
          onScan={startScan}
          compact={inventoryView && !scan && !intake}
          onRegister={() => { setEditorGroup(undefined); setEditor({ kind: "battery" }); }}
        />
        {assetWorkspaceOpen && !data && assetExitHeader}
        {teachingRecovery.error && <div className="load-error" role="alert">The preserved teaching workflow cannot be recovered safely: {teachingRecovery.error}</div>}
        {locationRecovery.error && <div className="load-error" role="alert">Saved location work needs review: {locationRecovery.error}</div>}
        {!locationToolsOpen && locationRecovery.attempts.length > 0 && <div className="load-error" role="alert"><span>A location request is retained. Resolve its original result before starting another operation.</span><Button variant="outline" disabled={modalOpen || loading || !data} onClick={() => resumeLocationWork(locationRecovery.attempts[0])}>Resume location request</Button></div>}
        {!teachingCheckout && (teachingRecovery.attempts.length > 0 || teachingRecovery.drafts.length > 0) && <div className="load-error" role="alert"><span>{teachingRecovery.attempts.length ? "An unfinished teaching checkout or return must be resolved with its original request." : "A reviewed teaching checkout draft is saved in this tab. Resume it before preparing another operation."}</span><Button variant="outline" disabled={!data || loading || !!error || modalOpen} onClick={() => resumeTeachingCheckout(teachingRecovery.attempts[0] ?? teachingRecovery.drafts[0])}>Resume teaching checkout</Button></div>}
        <RecoveryNotices
          recovery={recovery}
          movementOpen={!!(scan || intake || movement)}
          assetsOpen={view === "assets"}
          retiredHistoryOpen={view === "assets" && activeAssetTab === "history" && !intake}
          currentDataset={dataset}
          groupOpen={!!groupMaintenance}
          ready={ready}
          modalOpen={modalOpen}
          resumeScan={resumeScan}
          resumeMovement={resumeMovement}
          resumeRemoval={resumeRemoval}
          resumeRetiredAction={resumeRetiredAction}
          startIntake={startIntake}
          resumeGroupChange={resumeGroupChange}
        />
        <MotionPresence>{notice && (
          <div className="success-notice" role="status">
            <span>{notice}</span>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setNotice("")}
              aria-label="Dismiss notification"
            >
              <X size={16} />
            </Button>
          </div>
        )}</MotionPresence>
        <MotionPresence>{recoveryUnavailable && (
          <div className="load-error" role="alert">
            Browser recovery storage is unavailable. Restore access before
            starting another workflow.
          </div>
        )}</MotionPresence>
        <MotionPresence>{error && (
          <div className="load-error" role="alert">
            <span>{error}</span>
            <Button variant="outline" onClick={refresh} disabled={loading}>
              Retry refresh
            </Button>
          </div>
        )}</MotionPresence>
        <RefreshStatus active={loading && !!data} />
        {loading && !data ? (
          <LoadingState label="Loading your workspace" detail="Preparing the inventory and your saved views." />
        ) : (
          data && (
            <>
              {view === "assets" && !scan && (
                <section className="asset-workspace" aria-label="Intake and removal workspace">
                  <Tabs
                    value={activeAssetTab}
                    onValueChange={(value) => {
                      if (!intake && !assetLocked) {
                        if (pendingRetiredActions.length && value !== "history") {
                          resumeRetiredAction(pendingRetiredActions[0]);
                          return;
                        }
                        setAssetTab(value as typeof assetTab);
                      }
                    }}
                  >
                    <TabsList variant="line" className="lifecycle-tabs">
                      <TabsTrigger
                        value="intake"
                        disabled={!!intake || assetLocked}
                      >
                        New battery intake
                      </TabsTrigger>
                      <TabsTrigger
                        value="removal"
                        disabled={!!intake || assetLocked}
                      >
                        Retire or remove
                      </TabsTrigger>
                      <TabsTrigger
                        value="history"
                        disabled={!!intake || assetLocked}
                      >
                        Removal history
                      </TabsTrigger>
                    </TabsList>
                  </Tabs>
                  {!intake && activeAssetTab !== "removal" && assetExitHeader}
                  {activeAssetTab === "intake" &&
                    (intake ? (
                      <IntakeStation
                        key={`${dataset}-${user.id}-${intake.nonce}`}
                        data={data}
                        write={write}
                        onRegistered={taskChanged}
                        onExit={() => {
                          setIntake(null);
                          setNotice("");
                          showWorkspace(() => setView("inventory"));
                          void refresh();
                        }}
                      />
                    ) : (
                      <div className="intake-panel">
                        <h3>Prepare new batteries</h3>
                        <p className="field-hint">
                          Set common details once, scan into an editable pending
                          list, then confirm all or selected batteries.
                          Demonstration inputs are available only in
                          Demonstration inventory.
                        </p>
                        <Button onClick={startIntake} disabled={!ready}>
                          {pendingIntakes.length
                            ? "Resume demo intake"
                            : "Start demo intake"}
                        </Button>
                      </div>
                    ))}
                  {!intake && (
                    <div hidden={activeAssetTab !== "removal"}>
                      <RemovalStation
                        key={`${dataset}-${user.id}-${groupRemoval?.nonce ?? "ordinary"}`}
                        initialIds={groupRemoval?.ids}
                        teachingGroup={groupRemoval?.teachingGroup}
                        data={data}
                        write={write}
                        onDetail={(id) => {
                          setDetailGroup(undefined);
                          setDetailId(id);
                        }}
                        onBusyChange={setRemovalLocked}
                        onExit={exitAssets}
                        onChanged={() => load(dataset)}
                      />
                    </div>
                  )}
                  {activeAssetTab === "history" && !intake && (
                    <RemovalHistory
                      data={data}
                      write={write}
                      onChanged={() => load(dataset)}
                      onBusyChange={setRetiredActionLocked}
                      paused={!!(editor || detailId || exportDraft) || !pendingRetiredActions.some(pending => pending.dataset === dataset) && !!(pendingRetiredActions.length || pendingRemovals.length || pendingIntakes.length || pendingScans.length || pendingMovements.length || recovery.groups.length)}
                      onDetail={(id) => {
                        setDetailGroup(undefined);
                        setDetailId(id);
                      }}
                      onDownload={(ids) =>
                        setExportDraft({
                          filter: {
                            ...defaultInventoryFilter(),
                            lifecycle: "all",
                          },
                          page: 0,
                          pageSize: "25",
                          matching: ids.length,
                          pageCount: ids.length,
                          selectedIds: ids,
                          selectedOnly: true,
                        })
                      }
                    />
                  )}
                </section>
              )}
              {scan && (
                <ScanStation
                  key={`${dataset}-${user.id}-${scan.nonce}`}
                  data={data}
                  kind={scan.kind}
                  write={write}
                  paused={!!editor}
                  onExit={() => {
                    setScan(null);
                    setNotice("");
                  }}
                  onRegister={(tagId) => {
                    setEditorGroup(undefined);
                    setEditor({ kind: "battery", initialTagId: tagId });
                  }}
                  onChanged={taskChanged}
                />
              )}
              {!scan && !intake && retainInventory && (
                <div hidden={!inventoryView}>
                  <InventoryTable
                    active={inventoryView}
                    overlayOpen={modalOpen}
                    key={`${dataset}-${inventoryPersonalScope}`}
                    personalScope={inventoryPersonalScope}
                    newArrivals={newArrivals.arrivals}
                    onViewNewArrivals={inventoryPersonalScope === "all" ? newArrivals.acknowledge : undefined}
                    arrivalsPending={inventoryPersonalScope === "all" && newArrivals.pending}
                    arrivalsError={inventoryPersonalScope === "all" ? newArrivals.error : ""}
                    data={data}
                    ready={ready}
                    onMovement={startMovement}
                    onScan={startScan}
                    onEdit={(draft) => {
                      setEditorGroup(undefined);
                      setEditor(draft);
                    }}
                    onDetail={(id) => {
                      setDetailGroup(undefined);
                      setDetailId(id);
                    }}
                    onOpenGroups={openTeachingGroups}
                    onSetup={() => setView("manage")}
                    onExport={setExportDraft}
                    onGroupsChanged={() => load(dataset)}
                    onGroupDialogChange={setGroupsOpen}
                  />
                </div>
              )}
                <div hidden={view !== "mapping" || !!scan || !!intake}>
                  <MappingWorkspace
                    key={`mapping-${dataset}-${user.id}`}
                    active={view === "mapping" && !scan && !intake}
                    data={data}
                    ready={ready}
                    overlayOpen={modalOpen}
                    onMovement={startMovement}
                    onScan={startScan}
                    onRemoval={ids => { if (!modalOpen && ready && !interceptPendingWorkflow()) { setGroupRemoval({ ids: [...ids], nonce: crypto.randomUUID(), returnView: "mapping" }); setView("assets"); setAssetTab("removal"); setNotice(""); } }}
                    onEdit={draft => { setEditorGroup(undefined); setEditor(draft); }}
                    onDetail={(id, roomId) => { setDetailGroup(undefined); setDetailMappingRoom(roomId ?? null); setDetailId(id); }}
                    onSetup={() => setView("manage")}
                    onExport={setExportDraft}
                    onGroupsChanged={taskChanged}
                    onGroupDialogChange={setGroupsOpen}
                    onOpenGroups={openTeachingGroups}
                    onLocationTools={() => { if (!modalOpen) setLocationToolsOpen(true); }}
                  />
                </div>
              {!scan && !intake && view === "teaching-groups" && (
                <TeachingGroupsWorkspace
                  overlayOpen={modalOpen}
                  key={`${dataset}-${user.id}`}
                  data={data}
                  ready={ready}
                  revision={revision}
                  personalScope={inventoryPersonalScope}
                  onReturnCheckout={(run: TeachingCheckoutListedRun) => {
                    if (!modalOpen && !interceptPendingWorkflow()) setTeachingCheckout({ kind: "return", run, personalScope: inventoryPersonalScope });
                  }}
                  onContinueCheckout={(run, group, ids) => {
                    if (ready && !modalOpen && !interceptPendingWorkflow()) setTeachingCheckout({ kind: "continue", run, group, ids: [...ids], personalScope: inventoryPersonalScope });
                  }}
                  onExchangeCheckout={(run, item) => {
                    if (ready && !modalOpen && !interceptPendingWorkflow()) setTeachingCheckout({ kind: "exchange", run, item, personalScope: inventoryPersonalScope });
                  }}
                  onDownloadCheckout={(run, format) => downloadTeachingCheckoutReport(dataset, run.id, format)}
                  activeId={activeGroupId}
                  onActiveChange={setActiveGroupId}
                  onBack={returnFromTeachingGroups}
                  returnBlocked={modalOpen || teachingPending}
                  onMovement={startMovement}
                  onRemoval={startGroupRemoval}
                  onMaintenance={(ids, group) => {
                    if (!modalOpen && !interceptPendingGroupChange()) {
                      if (
                        pendingIntakes.length ||
                        pendingRemovals.length ||
                        pendingRetiredActions.length ||
                        pendingScans.length ||
                        pendingMovements.length
                      ) {
                        setNotice(
                          "Resume the unfinished workflow before updating group members.",
                        );
                        return;
                      }
                      setGroupMaintenance({ ids, group });
                    }
                  }}
                  onEdit={(draft, group) => {
                    setEditorGroup(group);
                    setEditor(draft);
                  }}
                  onDetail={(id, group) => {
                    setDetailGroup(group);
                    setDetailId(id);
                  }}
                  onExport={setExportDraft}
                  onChanged={taskChanged}
                  onDialogChange={setGroupsOpen}
                  onActivity={(group) => {
                    showWorkspace(() => {
                      setActivityGroupId(group.id);
                      setView("activity");
                    });
                  }}
                />
              )}
              {!scan &&
                !intake &&
                (view === "activity" || view === "my-activity") && (
                  <ActivityHistory
                    key={`${dataset}-${activityScope}-${data.user.id}`}
                    data={data}
                    ready={ready}
                    onMovement={view === "my-activity" ? startMovement : undefined}
                    scope={activityScope}
                    revision={revision}
                    groupId={activityGroupId}
                    onGroupFilterChange={setActivityGroupId}
                    onDialogChange={setGroupsOpen}
                    onDetail={(id) => {
                      setDetailGroup(undefined);
                      setDetailId(id);
                    }}
                  />
                )}
              {!scan && !intake && view === "manage" && (
                <RecordManagement
                  data={data}
                  ready={ready}
                  onEdit={(draft) => {
                    setEditorGroup(undefined);
                    setEditor(draft);
                  }}
                  onDetail={(id) => {
                    setDetailGroup(undefined);
                    setDetailId(id);
                  }}
                  onImport={setImportKind}
                />
              )}
              {!scan && !intake && view === "account" && (
                <MyAccount user={user} onSaved={() => load(dataset)} />
              )}
              {!scan &&
                !intake &&
                view === "accounts" &&
                permissions.manageAccounts && (
                  <AccountManagement
                    currentUser={user}
                    onSaved={() => load(dataset)}
                  />
                )}
              {!scan && !intake && view === "task-plans" && (
                <TaskPlansPanel
                  key={`${dataset}-${user.id}`}
                  data={data}
                  onChanged={taskChanged}
                  onDetail={(id) => {
                    setDetailGroup(undefined);
                    setDetailId(id);
                  }}
                />
              )}
              {!scan && !intake && view === "messages" && (
                <MessagesPanel
                  key={`${dataset}-${user.id}`}
                  data={data}
                  onChanged={taskChanged}
                  onDetail={(id) => {
                    setDetailGroup(undefined);
                    setDetailId(id);
                  }}
                  onUnreadCount={acceptUnreadCount}
                />
              )}
              <div className="reader-note">
                <Radio size={18} />
                <div>
                  <strong>
                    Room detection is awaiting hardware validation.
                  </strong>
                  <p>
                    RFID observations will require a verified reader-to-room
                    mapping. Loan changes require a staff-operated checkout or
                    return.
                  </p>
                </div>
                <span className="pending-badge">NOT CONNECTED</span>
              </div>
            </>
          )
        )}
      </section>
      {data && movement && (
        <MovementDialog
          key={movement.nonce}
          draft={movement}
          data={data}
          onClose={(reviewedInventory) => {
            acceptReviewedInventory(reviewedInventory);
            setMovement(null);
          }}
          write={write}
        />
      )}
      {data && teachingCheckout && (teachingCheckout.kind !== "recover" && teachingCheckout.kind !== "resume" || (teachingCheckout.kind === "recover" ? teachingCheckout.attempt.dataset : teachingCheckout.saved.dataset) === data.dataset) && (
        <TeachingCheckoutDialog
          key={`${data.dataset}-${data.user.id}-${teachingCheckout.kind === "recover" ? teachingCheckout.attempt.payload.requestId : teachingCheckout.kind === "resume" ? "saved-draft" : teachingCheckout.kind === "return" || teachingCheckout.kind === "exchange" ? teachingCheckout.run.id : teachingCheckout.group.id}`}
          data={data}
          draft={teachingCheckout}
          onChanged={async () => {
            setNotice("The teaching checkout or return was confirmed. Its actual loan records are saved.");
            try { await taskChanged(); }
            catch (failure) { setError("The teaching request was confirmed, but inventory refresh failed. Refresh before starting another operation."); throw failure; }
          }}
          onClose={(reviewedInventory) => { acceptReviewedInventory(reviewedInventory); setTeachingCheckout(null); }}
        />
      )}
      {data && editor && (
        <RecordEditor
          key={`${editor.kind}-${editor.record?.id ?? "new"}`}
          draft={editor}
          data={data}
          onClose={() => {
            setEditor(null);
            setEditorGroup(undefined);
          }}
          write={groupWrite(editorGroup)}
        />
      )}
      {data && detailBattery && (
        <BatteryDetails
          key={`${dataset}-${detailBattery.id}`}
          battery={detailBattery}
          data={data}
          revision={revision}
          onInspectionChanged={() => {
            void taskChanged().catch(() => setError("The inspection change was saved, but shared activity could not refresh. Refresh before starting another operation."));
          }}
          onClose={() => {
            setDetailId(null);
            setDetailGroup(undefined);
            setDetailMappingRoom(null);
          }}
          onExport={() =>
            setExportDraft({
              batteryId: detailBattery.id,
              filter: { ...defaultInventoryFilter(), personalScope, mappingRoom: view === "mapping" ? detailMappingRoom : null },
              page: 0,
              pageSize: "25",
              matching: 1,
              pageCount: 1,
            })
          }
          onEdit={(battery) => {
            setDetailId(null);
            setDetailMappingRoom(null);
            setEditorGroup(detailGroup);
            setEditor({ kind: "battery", record: battery });
          }}
          write={groupWrite(detailGroup)}
        />
      )}
      {data && groupMaintenance && (
        <GroupMaintenanceDialog
          key={`${dataset}-${user.id}`}
          data={data}
          group={groupMaintenance.group}
          ids={groupMaintenance.ids}
          write={write}
          onChanged={taskChanged}
          onClose={() => setGroupMaintenance(null)}
        />
      )}
      {data && locationToolsOpen && <LocationToolsPanel data={data} ready={ready} onChanged={taskChanged} onClose={() => setLocationToolsOpen(false)} />}
      {exportDraft && (
        <ExportDialog
          draft={exportDraft}
          dataset={dataset}
          onClose={() => setExportDraft(null)}
        />
      )}
      {importKind && (
        <ImportDialog
          kind={importKind}
          onClose={() => setImportKind(null)}
          write={write}
        />
      )}
    </ApplicationShell>
  );
}
