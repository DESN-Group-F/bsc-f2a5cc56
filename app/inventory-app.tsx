"use client";
import { useCallback, useEffect, useState } from "react";
import { flushSync } from "react-dom";
import { Package, Radio, FlaskConical, RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
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
import { GroupMaintenanceDialog } from "@/components/inventory/group-maintenance-dialog";
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
  const [exportDraft, setExportDraft] = useState<ExportDraft | null>(null);

  const [notice, setNotice] = useState("");
  const [view, setView] = useState<View>("inventory");
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
  const [assetTab, setAssetTab] = useState<"intake" | "removal" | "history">(
    "intake",
  );
  const [removalLocked, setRemovalLocked] = useState(false);
  const {
    recovery,
    unavailable: recoveryUnavailable,
    read: readRecovery,
  } = useWorkflowRecovery(user.id);
  const {
    removals: pendingRemovals,
    intakes: pendingIntakes,
    movements: pendingMovements,
    scans: pendingScans,
  } = recovery;
  const activeAssetTab = removalLocked && !intake ? "removal" : assetTab;
  const [detailId, setDetailId] = useState<string | null>(null),
    [importKind, setImportKind] = useState<ImportKind | null>(null);
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
    teachingGroup: TeachingGroupReference;
    ids: string[];
    nonce: string;
  } | null>(null);
  function changeDataset(mode: Dataset) {
    setNotice("");
    setActiveGroupId(null);
    setActivityGroupId(null);
    selectDataset(mode);
  }
  const write: WriteAction = async (action, payload, extra = {}) => {
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
  const modalOpen = !!(
      intake ||
      scan ||
      movement ||
      editor ||
      detailId ||
      importKind ||
      exportDraft ||
      removalLocked ||
      groupsOpen ||
      groupMaintenance
    ),
    ready = !!data && !loading && !error;
  function openTeachingGroups() {
    if (modalOpen) return;
    if (view !== "teaching-groups") {
      setGroupsReturnView(view);
      setActiveGroupId(null);
    }
    setView("teaching-groups");
  }
  function returnFromTeachingGroups() {
    if (modalOpen || view !== "teaching-groups") return;
    setView(
      groupsReturnView === "accounts" && user.role !== "admin"
        ? "inventory"
        : groupsReturnView,
    );
  }
  function resumeGroupChange(pending: { dataset: Dataset }) {
    if (modalOpen) return;
    if (pending.dataset !== dataset) changeDataset(pending.dataset);
    openTeachingGroups();
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
    try {
      const pending = nextPendingWorkflow(readRecovery(), exclude);
      if (!pending) return false;
      switch (pending.type) {
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
    if (modalOpen || interceptPendingWorkflow()) return;
    setGroupRemoval(null);
    setView("assets");
    setNotice("");
  }
  function resumeRemoval(pending: { dataset: Dataset }) {
    if (modalOpen) return;
    if (dataset !== pending.dataset) changeDataset(pending.dataset);
    setView("assets");
    setAssetTab("removal");
  }
  function startIntake() {
    if (modalOpen || interceptPendingWorkflow("intake")) return;
    if (dataset !== "demo") changeDataset("demo");
    setView("assets");
    setAssetTab("intake");
    setNotice("");
    setIntake({ nonce: crypto.randomUUID() });
  }
  function resumeMovement(pending: {
    dataset: Dataset;
    kind: "checkout" | "return";
  }) {
    if (modalOpen) return;
    if (pending.dataset !== dataset) changeDataset(pending.dataset);
    setNotice("");
    setMovement({ kind: pending.kind, ids: [], nonce: crypto.randomUUID() });
  }
  function resumeScan(pending: {
    dataset: Dataset;
    kind: "checkout" | "return";
  }) {
    if (modalOpen) return;
    if (pending.dataset !== dataset) changeDataset(pending.dataset);
    setNotice("");
    setScan({ kind: pending.kind, nonce: crypto.randomUUID() });
  }
  function startMovement(
    kind: "checkout" | "return",
    ids: string[] = [],
    teachingGroup?: TeachingGroupReference,
  ) {
    if (modalOpen || interceptPendingWorkflow()) return;
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
    if (modalOpen || !ready || interceptPendingGroupChange()) return;
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
    if (modalOpen || interceptPendingWorkflow()) return;
    setNotice("");
    setScan({ kind, nonce: crypto.randomUUID() });
  }
  useEffect(
    () =>
      registerInventoryTools(
        () => current.current,
        (draft) => {
          if (modalOpen)
            throw new Error(
              "Finish or close the current workflow before preparing another movement.",
            );
          if (nextPendingWorkflow(readRecovery()))
            throw new Error(
              "Resume the unfinished workflow before preparing another movement.",
            );
          flushSync(() => setMovement(draft));
        },
      ),
    [modalOpen, readRecovery, current],
  );
  useInventoryPolling({ paused: modalOpen, dataset, load, onError: setError });
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
  return (
    <ApplicationShell
      user={user}
      data={data}
      view={navigationView}
      scan={scan?.kind ?? null}
      intake={!!intake}
      locked={!!(scan || intake || removalLocked)}
      ready={ready}
      unreadCount={unreadCount}
      onNavigate={setView}
      onTeachingGroups={openTeachingGroups}
      onAssets={openAssets}
      onScan={startScan}
      onError={setError}
    >
      <section className="workspace" id="workspace-content" tabIndex={-1} aria-label="Current workspace">
        <div className="workspace-controls">
          <div className="dataset-control">
            <label htmlFor="dataset-select">Inventory</label>
            <Select
              value={dataset}
              onValueChange={(v) => changeDataset(v as Dataset)}
              disabled={modalOpen || loading}
            >
              <SelectTrigger id="dataset-select">
                <SelectValue />
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
              disabled={loading || modalOpen}
              aria-label="Refresh inventory"
            >
              <RefreshCw size={16} />
              <span>Refresh</span>
            </Button>
          </div>
        </div>
        <WorkspaceHeading
          view={view}
          scan={scan?.kind ?? null}
          intake={!!intake}
          ready={ready}
          onScan={startScan}
        />
        {dataset === "demo" ? (
          <div className="demo-notice">
            <FlaskConical size={17} />
            <span>
              <strong>Demonstration inventory.</strong> Battery specifications
              and sample activity are fictional. J18 rooms are placeholders
              awaiting confirmation.
            </span>
          </div>
        ) : (
          <div className="working-notice">
            <Package size={17} />
            <span>
              <strong>Working inventory.</strong> Real battery records are
              awaiting input. J18 rooms are placeholders awaiting confirmation.
              All staff share this inventory.
            </span>
          </div>
        )}
        <RecoveryNotices
          recovery={recovery}
          movementOpen={!!(scan || intake || movement)}
          assetsOpen={view === "assets"}
          groupOpen={!!groupMaintenance}
          ready={ready}
          modalOpen={modalOpen}
          resumeScan={resumeScan}
          resumeMovement={resumeMovement}
          resumeRemoval={resumeRemoval}
          startIntake={startIntake}
          resumeGroupChange={resumeGroupChange}
        />
        {notice && (
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
        )}
        {recoveryUnavailable && (
          <div className="load-error" role="alert">
            Browser recovery storage is unavailable. Restore access before
            starting another workflow.
          </div>
        )}
        {error && (
          <div className="load-error" role="alert">
            <span>{error}</span>
            <Button variant="outline" onClick={refresh} disabled={loading}>
              Retry refresh
            </Button>
          </div>
        )}
        {loading && !data ? (
          <div className="loading-panel" aria-label="Loading inventory">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-72 w-full" />
          </div>
        ) : (
          data && (
            <>
              {view === "assets" && !scan && (
                <section aria-label="Intake and removal workspace">
                  <Tabs
                    value={activeAssetTab}
                    onValueChange={(value) => {
                      if (!intake && !removalLocked)
                        setAssetTab(value as typeof assetTab);
                    }}
                  >
                    <TabsList variant="line" className="lifecycle-tabs">
                      <TabsTrigger
                        value="intake"
                        disabled={!!intake || removalLocked}
                      >
                        New battery intake
                      </TabsTrigger>
                      <TabsTrigger
                        value="removal"
                        disabled={!!intake || removalLocked}
                      >
                        Retire or remove
                      </TabsTrigger>
                      <TabsTrigger
                        value="history"
                        disabled={!!intake || removalLocked}
                      >
                        Removal history
                      </TabsTrigger>
                    </TabsList>
                  </Tabs>
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
                          void refresh();
                        }}
                      />
                    ) : (
                      <div className="intake-panel">
                        <h2>First-time battery intake</h2>
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
                        onExit={() =>
                          setView(
                            groupRemoval ? "teaching-groups" : "inventory",
                          )
                        }
                        onChanged={() => load(dataset)}
                      />
                    </div>
                  )}
                  {activeAssetTab === "history" && !intake && (
                    <RemovalHistory
                      data={data}
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
                    key={`${dataset}-${inventoryPersonalScope}`}
                    personalScope={inventoryPersonalScope}
                    data={data}
                    ready={ready}
                    onMovement={startMovement}
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
              {!scan && !intake && view === "teaching-groups" && (
                <TeachingGroupsWorkspace
                  key={`${dataset}-${user.id}`}
                  data={data}
                  ready={ready}
                  activeId={activeGroupId}
                  onActiveChange={setActiveGroupId}
                  onBack={returnFromTeachingGroups}
                  returnBlocked={modalOpen}
                  onMovement={startMovement}
                  onRemoval={startGroupRemoval}
                  onMaintenance={(ids, group) => {
                    if (!modalOpen && !interceptPendingGroupChange()) {
                      if (
                        pendingIntakes.length ||
                        pendingRemovals.length ||
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
                    setActivityGroupId(group.id);
                    setView("activity");
                  }}
                />
              )}
              {!scan &&
                !intake &&
                (view === "activity" || view === "my-activity") && (
                  <ActivityHistory
                    key={`${dataset}-${activityScope}-${data.user.id}`}
                    data={data}
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
                user.role === "admin" && (
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
          onClose={() => {
            setDetailId(null);
            setDetailGroup(undefined);
          }}
          onExport={() =>
            setExportDraft({
              batteryId: detailBattery.id,
              filter: { ...defaultInventoryFilter(), personalScope },
              page: 0,
              pageSize: "25",
              matching: 1,
              pageCount: 1,
            })
          }
          onEdit={(battery) => {
            setDetailId(null);
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
