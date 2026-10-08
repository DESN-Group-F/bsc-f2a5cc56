"use client";
import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useCallback, useEffect, useState } from "react";
import { flushSync } from "react-dom";
import { Package, Radio, FlaskConical, RefreshCw, X } from "lucide-react";
import { Button } from "../components/ui/button.js";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem, } from "../components/ui/select.js";
import { Skeleton } from "../components/ui/skeleton.js";
import { MovementDialog } from "../components/inventory/movement-dialog.js";
import { RecordEditor } from "../components/inventory/record-editor.js";
import { BatteryDetails } from "../components/inventory/battery-detail.js";
import { ImportDialog } from "../components/inventory/import-dialog.js";
import { InventoryTable, RecordManagement, ActivityHistory, } from "../components/inventory/views.js";
import { defaultInventoryFilter } from "../lib/inventory-query.js";
import { registerInventoryTools } from "../lib/browser-tools.js";
import { getRolePermissions } from "../lib/permissions.js";
import { MyAccount, AccountManagement, } from "../components/inventory/accounts-panel.js";
import { ExportDialog } from "../components/inventory/export-dialog.js";
import { TaskPlansPanel } from "../components/inventory/task-plans-panel.js";
import { MessagesPanel } from "../components/inventory/messages-panel.js";
import { ScanStation } from "../components/inventory/scan-station.js";
import { IntakeStation } from "../components/inventory/intake-station.js";
import { RemovalStation, RemovalHistory, } from "../components/inventory/removal-station.js";
import { Tabs, TabsList, TabsTrigger } from "../components/ui/tabs.js";
import { isActiveBattery } from "../lib/battery-lifecycle.js";
import { captureLifecycleAttempt, verifyLifecycleReceipt, } from "../lib/lifecycle-session.js";
import { captureIntakeAttempt, verifyIntakeReceipt, } from "../lib/intake-session.js";
import { verifyMovementReceipt, } from "../lib/movement-session.js";
import { TeachingGroupsWorkspace } from "../components/inventory/teaching-groups-workspace.js";
import { GroupMaintenanceDialog } from "../components/inventory/group-maintenance-dialog.js";
import { RecoveryNotices } from "../components/application/recovery-notices.js";
import { useMessageCount } from "../hooks/use-message-count.js";
import { ApplicationShell } from "../components/application/application-shell.js";
import { WorkspaceHeading, } from "../components/application/workspace-heading.js";
import { useInventoryData, useInventoryPolling, } from "../hooks/use-inventory-data.js";
import { useWorkflowRecovery } from "../hooks/use-workflow-recovery.js";
import { nextPendingWorkflow, } from "../lib/client/workflow-recovery.js";
import { inventoryResponse } from "../lib/client/inventory-request.js";
export default function InventoryApp({ initialUser, }) {
    const { user, dataset, data, loading, error, revision, current, setError, setRevision, load, refresh, changeDataset: selectDataset, acceptReviewedInventory, } = useInventoryData(initialUser);
    useEffect(() => { const refresh = () => { void load(dataset).catch(error => setError(error.message)); }; window.addEventListener('battery-mobile-inventory-refresh', refresh); return () => window.removeEventListener('battery-mobile-inventory-refresh', refresh); }, [dataset, load, setError]);
    const [exportDraft, setExportDraft] = useState(null);
    const permissions = getRolePermissions(user.role);
    const [notice, setNotice] = useState("");
    const [requestedView, setView] = useState("inventory");
    const view = requestedView === "accounts" && !permissions.manageAccounts
        ? "inventory"
        : requestedView;
    const { unreadCount, acceptUnreadCount } = useMessageCount(dataset, user.id, view === "messages", revision);
    const [movement, setMovement] = useState(null), [editor, setEditor] = useState(null);
    const [scan, setScan] = useState(null);
    const [intake, setIntake] = useState(null);
    const [assetTab, setAssetTab] = useState("intake");
    const [removalLocked, setRemovalLocked] = useState(false);
    const { recovery, unavailable: recoveryUnavailable, read: readRecovery, } = useWorkflowRecovery(user.id);
    const { removals: pendingRemovals, intakes: pendingIntakes, movements: pendingMovements, scans: pendingScans, } = recovery;
    const activeAssetTab = removalLocked && !intake ? "removal" : assetTab;
    const [detailId, setDetailId] = useState(null), [importKind, setImportKind] = useState(null);
    const [groupsOpen, setGroupsOpen] = useState(false);
    const [activeGroupId, setActiveGroupId] = useState(null), [activityGroupId, setActivityGroupId] = useState(null);
    const [groupsReturnView, setGroupsReturnView] = useState("inventory");
    const [editorGroup, setEditorGroup] = useState(), [detailGroup, setDetailGroup] = useState();
    const [groupMaintenance, setGroupMaintenance] = useState(null);
    const [groupRemoval, setGroupRemoval] = useState(null);
    function changeDataset(mode) {
        setNotice("");
        setActiveGroupId(null);
        setActivityGroupId(null);
        selectDataset(mode);
    }
    const write = async (action, payload, extra = {}) => {
        const intakeAttempt = action === "intake"
            ? captureIntakeAttempt(user.id, dataset, payload)
            : null;
        const lifecycleAttempt = action === "lifecycle"
            ? captureLifecycleAttempt(user.id, dataset, payload)
            : null;
        const body = await inventoryResponse(await fetch("/api/inventory", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ dataset, action, payload, ...extra }),
        }));
        if (action === "scan_lookup")
            return body.result;
        if (intakeAttempt) {
            verifyIntakeReceipt(body.result, intakeAttempt);
            return body.result;
        }
        if (lifecycleAttempt) {
            verifyLifecycleReceipt(body.result, lifecycleAttempt);
            return body.result;
        }
        if (action === "movement")
            verifyMovementReceipt(body.result, payload, user.id);
        setRevision((r) => r + 1);
        try {
            await load(dataset);
            if (!scan)
                setNotice(action === "movement"
                    ? `${body.result.count} ${body.result.count === 1 ? "battery" : "batteries"} ${body.result.kind === "checkout" ? "checked out" : "returned"}.`
                    : "Record saved. The audit history has been updated.");
        }
        catch {
            setError("The change was saved, but the inventory could not refresh. Refresh before starting another operation.");
            if (!scan)
                setNotice("Your change was saved successfully.");
        }
        return body.result;
    };
    const modalOpen = !!(intake ||
        scan ||
        movement ||
        editor ||
        detailId ||
        importKind ||
        exportDraft ||
        removalLocked ||
        groupsOpen ||
        groupMaintenance), ready = !!data && !loading && !error;
    function openTeachingGroups() {
        if (modalOpen)
            return;
        if (view !== "teaching-groups") {
            setGroupsReturnView(view);
            setActiveGroupId(null);
        }
        setView("teaching-groups");
    }
    function returnFromTeachingGroups() {
        if (modalOpen || view !== "teaching-groups")
            return;
        setView(groupsReturnView === "accounts" && !permissions.manageAccounts
            ? "inventory"
            : groupsReturnView);
    }
    function resumeGroupChange(pending) {
        if (modalOpen)
            return;
        if (pending.dataset !== dataset)
            changeDataset(pending.dataset);
        openTeachingGroups();
        setGroupMaintenance({ ids: [] });
    }
    function interceptPendingGroupChange() {
        try {
            const saved = readRecovery().groups[0];
            if (!saved)
                return false;
            resumeGroupChange(saved);
            return true;
        }
        catch {
            setError("Device recovery storage is unavailable. Restore access before starting another workflow.");
            return true;
        }
    }
    function interceptPendingWorkflow(exclude) {
        try {
            const pending = nextPendingWorkflow(readRecovery(), exclude);
            if (!pending)
                return false;
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
        }
        catch {
            setError("Device recovery storage is unavailable. Restore access before starting another workflow.");
            return true;
        }
    }
    function groupWrite(reference) {
        return (action, payload, extra) => write(action, reference &&
            ["battery", "charge", "observation", "correction"].includes(action)
            ? {
                ...payload,
                teachingGroup: reference,
            }
            : payload, extra);
    }
    const navigationView = scan || intake ? null : view;
    function openAssets() {
        if (modalOpen || interceptPendingWorkflow())
            return;
        setGroupRemoval(null);
        setView("assets");
        setNotice("");
    }
    function resumeRemoval(pending) {
        if (modalOpen)
            return;
        if (dataset !== pending.dataset)
            changeDataset(pending.dataset);
        setView("assets");
        setAssetTab("removal");
    }
    function startIntake() {
        if (modalOpen || interceptPendingWorkflow("intake"))
            return;
        if (dataset !== "demo")
            changeDataset("demo");
        setView("assets");
        setAssetTab("intake");
        setNotice("");
        setIntake({ nonce: crypto.randomUUID() });
    }
    function resumeMovement(pending) {
        if (modalOpen)
            return;
        if (pending.dataset !== dataset)
            changeDataset(pending.dataset);
        setNotice("");
        setMovement({ kind: pending.kind, ids: [], nonce: crypto.randomUUID() });
    }
    function resumeScan(pending) {
        if (modalOpen)
            return;
        if (pending.dataset !== dataset)
            changeDataset(pending.dataset);
        setNotice("");
        setScan({ kind: pending.kind, nonce: crypto.randomUUID() });
    }
    function startMovement(kind, ids = [], teachingGroup) {
        if (modalOpen || interceptPendingWorkflow())
            return;
        const reviewed = teachingGroup
            ? (data?.batteries.filter((b) => ids.includes(b.id) &&
                isActiveBattery(b) &&
                (kind === "checkout" ? !b.loanId : !!b.loanId)) ?? [])
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
    function startGroupRemoval(ids, teachingGroup) {
        if (modalOpen || !ready || interceptPendingGroupChange())
            return;
        if (nextPendingWorkflow(readRecovery())) {
            setNotice("Resume the unfinished workflow before starting a group removal.");
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
    function startScan(kind) {
        if (modalOpen || interceptPendingWorkflow())
            return;
        setNotice("");
        setScan({ kind, nonce: crypto.randomUUID() });
    }
    useEffect(() => registerInventoryTools(() => current.current, (draft) => {
        if (modalOpen)
            throw new Error("Finish or close the current workflow before preparing another movement.");
        if (nextPendingWorkflow(readRecovery()))
            throw new Error("Resume the unfinished workflow before preparing another movement.");
        flushSync(() => setMovement(draft));
    }), [modalOpen, readRecovery, current]);
    useInventoryPolling({ paused: modalOpen, dataset, load, onError: setError });
    const taskChanged = useCallback(async () => {
        setRevision((value) => value + 1);
        await load(dataset);
    }, [dataset, load, setRevision]);
    const detailBattery = data?.batteries.find((b) => b.id === detailId);
    const personalScope = view === "my-batteries"
        ? "responsible"
        : view === "my-loans"
            ? "borrowed"
            : "all";
    const inventoryView = view === "inventory" || view === "my-batteries" || view === "my-loans";
    const inventorySourceView = view === "teaching-groups" ? groupsReturnView : view;
    const retainInventory = inventorySourceView === "inventory" ||
        inventorySourceView === "my-batteries" ||
        inventorySourceView === "my-loans";
    const inventoryPersonalScope = inventorySourceView === "my-batteries"
        ? "responsible"
        : inventorySourceView === "my-loans"
            ? "borrowed"
            : "all";
    const activityScope = view === "my-activity" ? "mine" : "all";
    return (_jsxs(ApplicationShell, { user: user, data: data, view: navigationView, scan: scan?.kind ?? null, intake: !!intake, locked: !!(scan || intake || removalLocked), ready: ready, unreadCount: unreadCount, onNavigate: setView, onTeachingGroups: openTeachingGroups, onAssets: openAssets, onScan: startScan, onError: setError, children: [_jsxs("section", { className: "workspace", id: "workspace-content", tabIndex: -1, "aria-label": "Current workspace", children: [_jsxs("div", { className: "workspace-controls", children: [_jsxs("div", { className: "dataset-control", children: [_jsx("label", { htmlFor: "dataset-select", children: "Inventory" }), _jsxs(Select, { value: dataset, onValueChange: (v) => changeDataset(v), disabled: modalOpen || loading, children: [_jsx(SelectTrigger, { id: "dataset-select", children: _jsx(SelectValue, {}) }), _jsxs(SelectContent, { children: [_jsx(SelectItem, { value: "demo", children: "Demonstration inventory" }), _jsx(SelectItem, { value: "live", children: "Working inventory" })] })] })] }), _jsxs("div", { className: "operator-control", children: [_jsxs("span", { children: ["Operator: ", data?.actor ?? "Loading…"] }), _jsxs(Button, { variant: "ghost", size: "sm", onClick: refresh, disabled: loading || modalOpen, "aria-label": "Refresh inventory", children: [_jsx(RefreshCw, { size: 16 }), _jsx("span", { children: "Refresh" })] })] })] }), _jsx(WorkspaceHeading, { role: user.role, view: view, scan: scan?.kind ?? null, intake: !!intake, ready: ready, onScan: startScan }), dataset === "demo" ? (_jsxs("div", { className: "demo-notice", children: [_jsx(FlaskConical, { size: 17 }), _jsxs("span", { children: [_jsx("strong", { children: "Demonstration inventory." }), " Battery specifications and sample activity are fictional. J18 rooms are placeholders awaiting confirmation."] })] })) : (_jsxs("div", { className: "working-notice", children: [_jsx(Package, { size: 17 }), _jsxs("span", { children: [_jsx("strong", { children: "Working inventory." }), " Real battery records are awaiting input. J18 rooms are placeholders awaiting confirmation. All staff share this inventory."] })] })), _jsx(RecoveryNotices, { recovery: recovery, movementOpen: !!(scan || intake || movement), assetsOpen: view === "assets", groupOpen: !!groupMaintenance, ready: ready, modalOpen: modalOpen, resumeScan: resumeScan, resumeMovement: resumeMovement, resumeRemoval: resumeRemoval, startIntake: startIntake, resumeGroupChange: resumeGroupChange }), notice && (_jsxs("div", { className: "success-notice", role: "status", children: [_jsx("span", { children: notice }), _jsx(Button, { variant: "ghost", size: "icon", onClick: () => setNotice(""), "aria-label": "Dismiss notification", children: _jsx(X, { size: 16 }) })] })), recoveryUnavailable && (_jsx("div", { className: "load-error", role: "alert", children: "Device recovery storage is unavailable. Restore access before starting another workflow." })), error && (_jsxs("div", { className: "load-error", role: "alert", children: [_jsx("span", { children: error }), _jsx(Button, { variant: "outline", onClick: refresh, disabled: loading, children: "Retry refresh" })] })), loading && !data ? (_jsxs("div", { className: "loading-panel", "aria-label": "Loading inventory", children: [_jsx(Skeleton, { className: "h-24 w-full" }), _jsx(Skeleton, { className: "h-72 w-full" })] })) : (data && (_jsxs(_Fragment, { children: [view === "assets" && !scan && (_jsxs("section", { "aria-label": "Intake and removal workspace", children: [_jsx(Tabs, { value: activeAssetTab, onValueChange: (value) => {
                                            if (!intake && !removalLocked)
                                                setAssetTab(value);
                                        }, children: _jsxs(TabsList, { variant: "line", className: "lifecycle-tabs", children: [_jsx(TabsTrigger, { value: "intake", disabled: !!intake || removalLocked, children: "New battery intake" }), _jsx(TabsTrigger, { value: "removal", disabled: !!intake || removalLocked, children: "Retire or remove" }), _jsx(TabsTrigger, { value: "history", disabled: !!intake || removalLocked, children: "Removal history" })] }) }), activeAssetTab === "intake" &&
                                        (intake ? (_jsx(IntakeStation, { data: data, write: write, onRegistered: taskChanged, onExit: () => {
                                                setIntake(null);
                                                setNotice("");
                                                void refresh();
                                            } }, `${dataset}-${user.id}-${intake.nonce}`)) : (_jsxs("div", { className: "intake-panel", children: [_jsx("h2", { children: "First-time battery intake" }), _jsx("p", { className: "field-hint", children: "Set common details once, scan into an editable pending list, then confirm all or selected batteries. Demonstration inputs are available only in Demonstration inventory." }), _jsx(Button, { onClick: startIntake, disabled: !ready, children: pendingIntakes.length
                                                        ? "Resume demo intake"
                                                        : "Start demo intake" })] }))), !intake && (_jsx("div", { hidden: activeAssetTab !== "removal", children: _jsx(RemovalStation, { initialIds: groupRemoval?.ids, teachingGroup: groupRemoval?.teachingGroup, data: data, write: write, onDetail: (id) => {
                                                setDetailGroup(undefined);
                                                setDetailId(id);
                                            }, onBusyChange: setRemovalLocked, onExit: () => setView(groupRemoval ? "teaching-groups" : "inventory"), onChanged: () => load(dataset) }, `${dataset}-${user.id}-${groupRemoval?.nonce ?? "ordinary"}`) })), activeAssetTab === "history" && !intake && (_jsx(RemovalHistory, { data: data, onDetail: (id) => {
                                            setDetailGroup(undefined);
                                            setDetailId(id);
                                        }, onDownload: (ids) => setExportDraft({
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
                                        }) }))] })), scan && (_jsx(ScanStation, { data: data, kind: scan.kind, write: write, paused: !!editor, onExit: () => {
                                    setScan(null);
                                    setNotice("");
                                }, onRegister: (tagId) => {
                                    setEditorGroup(undefined);
                                    setEditor({ kind: "battery", initialTagId: tagId });
                                }, onChanged: taskChanged }, `${dataset}-${user.id}-${scan.nonce}`)), !scan && !intake && retainInventory && (_jsx("div", { hidden: !inventoryView, children: _jsx(InventoryTable, { personalScope: inventoryPersonalScope, data: data, ready: ready, onMovement: startMovement, onEdit: (draft) => {
                                        setEditorGroup(undefined);
                                        setEditor(draft);
                                    }, onDetail: (id) => {
                                        setDetailGroup(undefined);
                                        setDetailId(id);
                                    }, onOpenGroups: openTeachingGroups, onSetup: () => setView("manage"), onExport: setExportDraft, onGroupsChanged: () => load(dataset), onGroupDialogChange: setGroupsOpen }, `${dataset}-${inventoryPersonalScope}`) })), !scan && !intake && view === "teaching-groups" && (_jsx(TeachingGroupsWorkspace, { data: data, ready: ready, activeId: activeGroupId, onActiveChange: setActiveGroupId, onBack: returnFromTeachingGroups, returnBlocked: modalOpen, onMovement: startMovement, onRemoval: startGroupRemoval, onMaintenance: (ids, group) => {
                                    if (!modalOpen && !interceptPendingGroupChange()) {
                                        if (pendingIntakes.length ||
                                            pendingRemovals.length ||
                                            pendingScans.length ||
                                            pendingMovements.length) {
                                            setNotice("Resume the unfinished workflow before updating group members.");
                                            return;
                                        }
                                        setGroupMaintenance({ ids, group });
                                    }
                                }, onEdit: (draft, group) => {
                                    setEditorGroup(group);
                                    setEditor(draft);
                                }, onDetail: (id, group) => {
                                    setDetailGroup(group);
                                    setDetailId(id);
                                }, onExport: setExportDraft, onChanged: taskChanged, onDialogChange: setGroupsOpen, onActivity: (group) => {
                                    setActivityGroupId(group.id);
                                    setView("activity");
                                } }, `${dataset}-${user.id}`)), !scan &&
                                !intake &&
                                (view === "activity" || view === "my-activity") && (_jsx(ActivityHistory, { data: data, ready: ready, onMovement: view === "my-activity" ? startMovement : undefined, scope: activityScope, revision: revision, groupId: activityGroupId, onGroupFilterChange: setActivityGroupId, onDialogChange: setGroupsOpen, onDetail: (id) => {
                                    setDetailGroup(undefined);
                                    setDetailId(id);
                                } }, `${dataset}-${activityScope}-${data.user.id}`)), !scan && !intake && view === "manage" && (_jsx(RecordManagement, { data: data, ready: ready, onEdit: (draft) => {
                                    setEditorGroup(undefined);
                                    setEditor(draft);
                                }, onDetail: (id) => {
                                    setDetailGroup(undefined);
                                    setDetailId(id);
                                }, onImport: setImportKind })), !scan && !intake && view === "account" && (_jsx(MyAccount, { user: user, onSaved: () => load(dataset) })), !scan &&
                                !intake &&
                                view === "accounts" &&
                                permissions.manageAccounts && (_jsx(AccountManagement, { currentUser: user, onSaved: () => load(dataset) })), !scan && !intake && view === "task-plans" && (_jsx(TaskPlansPanel, { data: data, onChanged: taskChanged, onDetail: (id) => {
                                    setDetailGroup(undefined);
                                    setDetailId(id);
                                } }, `${dataset}-${user.id}`)), !scan && !intake && view === "messages" && (_jsx(MessagesPanel, { data: data, onChanged: taskChanged, onDetail: (id) => {
                                    setDetailGroup(undefined);
                                    setDetailId(id);
                                }, onUnreadCount: acceptUnreadCount }, `${dataset}-${user.id}`)), _jsxs("div", { className: "reader-note", children: [_jsx(Radio, { size: 18 }), _jsxs("div", { children: [_jsx("strong", { children: "Room detection is awaiting hardware validation." }), _jsx("p", { children: "RFID observations will require a verified reader-to-room mapping. Loan changes require a staff-operated checkout or return." })] }), _jsx("span", { className: "pending-badge", children: "NOT CONNECTED" })] })] })))] }), data && movement && (_jsx(MovementDialog, { draft: movement, data: data, onClose: (reviewedInventory) => {
                    acceptReviewedInventory(reviewedInventory);
                    setMovement(null);
                }, write: write }, movement.nonce)), data && editor && (_jsx(RecordEditor, { draft: editor, data: data, onClose: () => {
                    setEditor(null);
                    setEditorGroup(undefined);
                }, write: groupWrite(editorGroup) }, `${editor.kind}-${editor.record?.id ?? "new"}`)), data && detailBattery && (_jsx(BatteryDetails, { battery: detailBattery, data: data, revision: revision, onClose: () => {
                    setDetailId(null);
                    setDetailGroup(undefined);
                }, onExport: () => setExportDraft({
                    batteryId: detailBattery.id,
                    filter: { ...defaultInventoryFilter(), personalScope },
                    page: 0,
                    pageSize: "25",
                    matching: 1,
                    pageCount: 1,
                }), onEdit: (battery) => {
                    setDetailId(null);
                    setEditorGroup(detailGroup);
                    setEditor({ kind: "battery", record: battery });
                }, write: groupWrite(detailGroup) }, `${dataset}-${detailBattery.id}`)), data && groupMaintenance && (_jsx(GroupMaintenanceDialog, { data: data, group: groupMaintenance.group, ids: groupMaintenance.ids, write: write, onChanged: taskChanged, onClose: () => setGroupMaintenance(null) }, `${dataset}-${user.id}`)), exportDraft && (_jsx(ExportDialog, { draft: exportDraft, dataset: dataset, onClose: () => setExportDraft(null) })), importKind && (_jsx(ImportDialog, { kind: importKind, onClose: () => setImportKind(null), write: write }))] }));
}
