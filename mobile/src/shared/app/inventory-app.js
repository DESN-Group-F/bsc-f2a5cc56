"use client";
import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useCallback, useEffect, useState } from "react";
import { flushSync } from "react-dom";
import { Package, Radio, FlaskConical, RefreshCw, LogOut, X } from "lucide-react";
import { Button } from "../components/ui/button.js";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem, } from "../components/ui/select.js";
import { LoadingState, RefreshStatus } from "../components/ui/loading-state.js";
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
import { MappingWorkspace } from "../components/inventory/mapping-workspace.js";
import { LocationToolsPanel } from "../components/inventory/location-tools-panel.js";
import { useLocationRecovery } from "../hooks/use-location-recovery.js";
import { GroupMaintenanceDialog } from "../components/inventory/group-maintenance-dialog.js";
import { TeachingCheckoutDialog } from "../components/inventory/teaching-checkout-dialog.js";
import { recoverTeachingCheckoutAttempt, teachingCheckoutStorageKey } from "../lib/client/teaching-checkout-request.js";
import { recoverTeachingCheckoutDraft, teachingCheckoutDraftStorageKey } from "../lib/client/teaching-checkout-draft.js";
import { downloadTeachingCheckoutReport } from "../lib/client/teaching-checkout-download.js";
import { RecoveryNotices } from "../components/application/recovery-notices.js";
import { useMessageCount } from "../hooks/use-message-count.js";
import { useNewArrivals } from "../hooks/use-new-arrivals.js";
import { ApplicationShell } from "../components/application/application-shell.js";
import { WorkspaceHeading, } from "../components/application/workspace-heading.js";
import { useInventoryData, useInventoryPolling, } from "../hooks/use-inventory-data.js";
import { useWorkflowRecovery } from "../hooks/use-workflow-recovery.js";
import { nextPendingWorkflow, } from "../lib/client/workflow-recovery.js";
import { inventoryResponse } from "../lib/client/inventory-request.js";
import { transitionWorkspace } from "../lib/client/workspace-motion.js";
import { MotionPresence } from "../components/ui/workspace-motion.js";
export default function InventoryApp({ initialUser, }) {
    const { user, dataset, data, loading, error, revision, current, setError, setRevision, load, refresh, changeDataset: selectDataset, acceptReviewedInventory, } = useInventoryData(initialUser);
    const newArrivals = useNewArrivals(data, load);
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
    const assetWorkspaceOpen = view === "assets" && !scan;
    const [assetTab, setAssetTab] = useState("intake");
    const [removalLocked, setRemovalLocked] = useState(false);
    const [retiredActionLocked, setRetiredActionLocked] = useState(false);
    const assetLocked = removalLocked || retiredActionLocked;
    const { recovery, unavailable: recoveryUnavailable, read: readRecovery, } = useWorkflowRecovery(user.id);
    const { removals: pendingRemovals, retiredActions: pendingRetiredActions, intakes: pendingIntakes, movements: pendingMovements, scans: pendingScans, } = recovery;
    const activeAssetTab = !intake && retiredActionLocked ? "history" : removalLocked && !intake ? "removal" : assetTab;
    const [detailId, setDetailId] = useState(null), [importKind, setImportKind] = useState(null);
    const [detailMappingRoom, setDetailMappingRoom] = useState(null);
    const [locationToolsOpen, setLocationToolsOpen] = useState(false);
    const { recovery: locationRecovery, read: readLocationRecovery } = useLocationRecovery(user.id);
    const [groupsOpen, setGroupsOpen] = useState(false);
    const [activeGroupId, setActiveGroupId] = useState(null), [activityGroupId, setActivityGroupId] = useState(null);
    const [groupsReturnView, setGroupsReturnView] = useState("inventory");
    const [editorGroup, setEditorGroup] = useState(), [detailGroup, setDetailGroup] = useState();
    const [groupMaintenance, setGroupMaintenance] = useState(null);
    const [groupRemoval, setGroupRemoval] = useState(null);
    const [teachingCheckout, setTeachingCheckout] = useState(null);
    const [teachingRecovery, setTeachingRecovery] = useState({ attempts: [], drafts: [], error: "" });
    const readTeachingRecovery = useCallback(() => {
        const attempts = [], drafts = [], failures = [];
        for (const mode of ["demo", "live"]) {
            let exactRequestPresent = true;
            try {
                const raw = window.__batteryWorkflowStorage.getItem(teachingCheckoutStorageKey(user.id, mode));
                exactRequestPresent = raw !== null;
                const attempt = recoverTeachingCheckoutAttempt(raw, user.id, mode);
                if (attempt)
                    attempts.push(attempt);
            }
            catch (failure) {
                failures.push(`${mode}: ${failure.message}`);
            }
            if (exactRequestPresent)
                continue;
            try {
                const draft = recoverTeachingCheckoutDraft(window.__batteryWorkflowStorage.getItem(teachingCheckoutDraftStorageKey(user.id, mode)), user.id, mode);
                if (draft)
                    drafts.push(draft);
            }
            catch (failure) {
                failures.push(`${mode}: ${failure.message}`);
            }
        }
        return { attempts, drafts, error: failures.join(" ") };
    }, [user.id]);
    const teachingPending = !!teachingRecovery.error || teachingRecovery.attempts.length > 0 || teachingRecovery.drafts.length > 0;
    useEffect(() => {
        function read() {
            try {
                setTeachingRecovery(readTeachingRecovery());
            }
            catch (failure) {
                setTeachingRecovery({ attempts: [], drafts: [], error: failure.message });
            }
        }
        read();
        window.addEventListener("battery-teaching-checkout-recovery", read);
        return () => window.removeEventListener("battery-teaching-checkout-recovery", read);
    }, [readTeachingRecovery]);
    function changeDataset(mode) {
        if (assetWorkspaceOpen)
            return;
        changeWorkflowDataset(mode);
    }
    function changeWorkflowDataset(mode) {
        if (modalOpen || interceptPendingTeachingCheckout())
            return;
        setNotice("");
        setActiveGroupId(null);
        setActivityGroupId(null);
        selectDataset(mode);
    }
    const write = async (action, payload, extra = {}) => {
        if (action !== "scan_lookup") {
            const teaching = readTeachingRecovery();
            if (teaching.attempts.length || teaching.drafts.length || teaching.error)
                throw new Error("Resume and resolve the preserved teaching checkout before saving another business operation.");
        }
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
        // Each form verifies its exact receipt before displaying success or refreshing.
        if (action === "inspection" || action === "inspection_void" || action === "retired_asset")
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
    const dialogOpen = !!(movement ||
        editor ||
        detailId ||
        importKind ||
        exportDraft ||
        groupsOpen ||
        groupMaintenance ||
        locationToolsOpen ||
        teachingCheckout);
    const modalOpen = !!(intake || scan || assetLocked || dialogOpen), navigationLocked = modalOpen || assetWorkspaceOpen, ready = !!data && !loading && !error && !teachingRecovery.error && !teachingRecovery.attempts.length && !teachingRecovery.drafts.length;
    function showWorkspace(update) {
        transitionWorkspace(update, "navigation");
        if (typeof window !== "undefined")
            window.scrollTo?.({ top: 0, behavior: "instant" });
        if (typeof document !== "undefined")
            document.getElementById?.("workspace-content")?.focus?.({ preventScroll: true });
    }
    function openTeachingGroups() {
        if (navigationLocked || interceptPendingTeachingCheckout())
            return;
        showTeachingGroups();
    }
    function showTeachingGroups() {
        if (view !== "teaching-groups") {
            setGroupsReturnView(view);
            setActiveGroupId(null);
        }
        if (view !== "teaching-groups")
            showWorkspace(() => setView("teaching-groups"));
    }
    function returnFromTeachingGroups() {
        if (modalOpen || view !== "teaching-groups")
            return;
        showWorkspace(() => setView(groupsReturnView === "accounts" && !permissions.manageAccounts
            ? "inventory"
            : groupsReturnView));
    }
    function resumeGroupChange(pending) {
        if (modalOpen || interceptPendingTeachingCheckout() || interceptPendingRetiredAction())
            return;
        if (pending.dataset !== dataset) {
            setNotice("");
            setActiveGroupId(null);
            setActivityGroupId(null);
            selectDataset(pending.dataset);
        }
        showTeachingGroups();
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
        const locations = readLocationRecovery();
        if (locations.error) {
            setError(locations.error);
            return true;
        }
        if (locations.attempts.length) {
            resumeLocationWork(locations.attempts[0]);
            return true;
        }
        if (interceptPendingTeachingCheckout())
            return true;
        try {
            const pending = nextPendingWorkflow(readRecovery(), exclude);
            if (!pending)
                return false;
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
        }
        catch {
            setError("Device recovery storage is unavailable. Restore access before starting another workflow.");
            return true;
        }
    }
    function resumeTeachingCheckout(pending) {
        if (modalOpen)
            return;
        if (pending.dataset !== dataset) {
            setNotice("");
            setActiveGroupId(null);
            setActivityGroupId(null);
            selectDataset(pending.dataset);
        }
        if (view !== "teaching-groups")
            setGroupsReturnView(view);
        setView("teaching-groups");
        setNotice("");
        setTeachingCheckout("payload" in pending ? { kind: "recover", attempt: pending } : { kind: "resume", saved: pending });
    }
    function resumeLocationWork(pending) {
        if (modalOpen)
            return;
        if (pending.dataset !== dataset)
            selectDataset(pending.dataset);
        setView("mapping");
        setLocationToolsOpen(true);
    }
    function interceptPendingTeachingCheckout() {
        try {
            const saved = readTeachingRecovery(), pending = saved.attempts[0] ?? saved.drafts[0];
            if (!pending) {
                if (saved.error) {
                    setError(`The preserved teaching workflow cannot be recovered safely. ${saved.error}`);
                    return true;
                }
                return false;
            }
            resumeTeachingCheckout(pending);
            return true;
        }
        catch (failure) {
            setError(`The preserved teaching workflow cannot be recovered safely. ${failure.message}`);
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
        if (navigationLocked || interceptPendingWorkflow())
            return;
        setGroupRemoval(null);
        if (view !== "assets")
            showWorkspace(() => setView("assets"));
        setNotice("");
    }
    function exitAssets() {
        if (dialogOpen || assetLocked || scan || intake && data)
            return;
        setIntake(null);
        setNotice("");
        showWorkspace(() => setView(groupRemoval?.returnView ?? (groupRemoval ? "teaching-groups" : "inventory")));
    }
    function resumeRemoval(pending) {
        if (modalOpen || interceptPendingTeachingCheckout() || interceptPendingRetiredAction())
            return;
        if (dataset !== pending.dataset)
            changeWorkflowDataset(pending.dataset);
        setView("assets");
        setAssetTab("removal");
    }
    function resumeRetiredAction(pending) {
        if (modalOpen || interceptPendingTeachingCheckout())
            return;
        if (dataset !== pending.dataset)
            changeWorkflowDataset(pending.dataset);
        setView("assets");
        setAssetTab("history");
    }
    function interceptPendingRetiredAction() {
        try {
            const pending = readRecovery().retiredActions[0];
            if (!pending)
                return false;
            resumeRetiredAction(pending);
            return true;
        }
        catch {
            setError("Device recovery storage is unavailable. Restore access before starting another workflow.");
            return true;
        }
    }
    function startIntake() {
        if (modalOpen || interceptPendingWorkflow("intake"))
            return;
        if (dataset !== "demo")
            changeWorkflowDataset("demo");
        setView("assets");
        setAssetTab("intake");
        setNotice("");
        setIntake({ nonce: crypto.randomUUID() });
    }
    function resumeMovement(pending) {
        if (modalOpen || interceptPendingTeachingCheckout() || interceptPendingRetiredAction())
            return;
        if (pending.dataset !== dataset)
            changeWorkflowDataset(pending.dataset);
        setNotice("");
        setMovement({ kind: pending.kind, ids: [], nonce: crypto.randomUUID() });
    }
    function resumeScan(pending) {
        if (modalOpen || interceptPendingTeachingCheckout() || interceptPendingRetiredAction())
            return;
        if (pending.dataset !== dataset)
            changeWorkflowDataset(pending.dataset);
        setNotice("");
        setScan({ kind: pending.kind, nonce: crypto.randomUUID() });
    }
    function startMovement(kind, ids = [], teachingGroup, separateCheckout = false) {
        if (navigationLocked || interceptPendingWorkflow())
            return;
        if (kind === "checkout" && teachingGroup) {
            const group = data?.teachingGroups.find(item => item.id === teachingGroup.id && item.version === teachingGroup.version);
            if (!group) {
                setError("The reviewed teaching group changed. Refresh and reopen it before checkout.");
                return;
            }
            setTeachingCheckout({ kind: "checkout", group, ids: [...ids], personalScope: inventoryPersonalScope, separateCheckout });
            setNotice("");
            return;
        }
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
        if (navigationLocked || !ready || interceptPendingGroupChange())
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
        if (navigationLocked || interceptPendingWorkflow())
            return;
        showWorkspace(() => {
            setNotice("");
            setScan({ kind, nonce: crypto.randomUUID() });
        });
    }
    useEffect(() => registerInventoryTools(() => current.current, (draft) => {
        if (navigationLocked)
            throw new Error("Finish or close the current workflow before preparing another movement.");
        if (nextPendingWorkflow(readRecovery()))
            throw new Error("Resume the unfinished workflow before preparing another movement.");
        const teaching = readTeachingRecovery();
        if (teaching.attempts.length || teaching.drafts.length || teaching.error)
            throw new Error("Resume the preserved teaching checkout before preparing another movement.");
        flushSync(() => setMovement(draft));
    }), [navigationLocked, readRecovery, readTeachingRecovery, current]);
    useInventoryPolling({ paused: navigationLocked || loading || !data, dataset, load, onError: setError });
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
    const assetExitHeader = (_jsxs("div", { className: "scan-station-header station-exit-bar", children: [_jsxs("div", { children: [_jsx("h2", { children: !data ? "Intake & removal" : activeAssetTab === "history" ? "Review removal records" : "First-time battery intake" }), _jsx("p", { children: activeAssetTab === "history" ? "Review recorded retirements and removals, download evidence or review eligible recovery actions." : "Prepare new battery records for review. Existing batteries use Scan return." }), _jsx("p", { className: "station-exit-hint", children: assetLocked ? "Resolve the current confirmation or storage issue before leaving this workspace." : dialogOpen ? "Finish or close the current review before leaving this workspace." : !data ? "You can exit while inventory data is unavailable. Saved drafts and original requests stay in this tab." : "Choose Exit workspace to finish and restore sidebar navigation. Saved drafts stay in this tab." })] }), _jsxs(Button, { type: "button", size: "lg", className: "station-exit-button", disabled: dialogOpen || assetLocked || !!scan || !!(intake && data), onClick: exitAssets, children: [_jsx(LogOut, { size: 20 }), "Exit workspace"] })] }));
    return (_jsxs(ApplicationShell, { user: user, data: data, view: navigationView, scan: scan?.kind ?? null, intake: !!intake, locked: !!(scan || intake || assetWorkspaceOpen || assetLocked || teachingCheckout || teachingPending || locationToolsOpen), ready: ready, unreadCount: unreadCount, inventoryNoticeCount: newArrivals.arrivals?.unreadCount ?? 0, onNavigate: (next) => { if (!navigationLocked && !interceptPendingTeachingCheckout() && view !== next)
            showWorkspace(() => setView(next)); }, onTeachingGroups: openTeachingGroups, onAssets: openAssets, onScan: startScan, onError: setError, scopeControls: _jsxs(_Fragment, { children: [_jsxs("div", { className: "workspace-controls", children: [_jsxs("div", { className: "dataset-control", children: [_jsx("label", { htmlFor: "dataset-select", children: "Inventory" }), _jsxs(Select, { value: dataset, onValueChange: (v) => changeDataset(v), disabled: navigationLocked || loading || teachingPending, children: [_jsx(SelectTrigger, { id: "dataset-select", children: _jsx(SelectValue, { children: dataset === "demo" ? "Demo inventory" : "Working inventory" }) }), _jsxs(SelectContent, { children: [_jsx(SelectItem, { value: "demo", children: "Demonstration inventory" }), _jsx(SelectItem, { value: "live", children: "Working inventory" })] })] })] }), _jsxs("div", { className: "operator-control", children: [_jsxs("span", { children: ["Operator: ", data?.actor ?? "Loading…"] }), _jsxs(Button, { variant: "ghost", size: "sm", onClick: refresh, disabled: loading || navigationLocked, "aria-label": "Refresh inventory", "aria-busy": loading, children: [_jsx(RefreshCw, { size: 16, className: loading ? "animate-spin" : undefined, "aria-hidden": "true" }), _jsx("span", { children: "Refresh" })] })] })] }), _jsxs("details", { className: "inventory-context", "data-dataset": dataset, children: [_jsxs("summary", { children: [dataset === "demo" ? _jsx(FlaskConical, { size: 16, "aria-hidden": "true" }) : _jsx(Package, { size: 16, "aria-hidden": "true" }), _jsx("span", { children: dataset === "demo" ? "Fictional demo data" : "Shared working data" }), _jsx("span", { className: "context-disclosure", children: "About this data" })] }), _jsx("p", { children: dataset === "demo" ? "Battery specifications and sample activity are fictional. J18 rooms are placeholders awaiting confirmation." : "All staff share this inventory. Real battery records are awaiting input. J18 rooms are placeholders awaiting confirmation." })] })] }), children: [_jsxs("section", { className: `workspace${inventoryView && !scan && !intake ? " workspace-inventory" : ""}`, id: "workspace-content", tabIndex: -1, "aria-label": "Current workspace", children: [_jsx(WorkspaceHeading, { role: user.role, view: view, scan: scan?.kind ?? null, intake: !!intake, ready: ready, onScan: startScan, compact: inventoryView && !scan && !intake, onRegister: () => { setEditorGroup(undefined); setEditor({ kind: "battery" }); } }), assetWorkspaceOpen && !data && assetExitHeader, teachingRecovery.error && _jsxs("div", { className: "load-error", role: "alert", children: ["The preserved teaching workflow cannot be recovered safely: ", teachingRecovery.error] }), locationRecovery.error && _jsxs("div", { className: "load-error", role: "alert", children: ["Saved location work needs review: ", locationRecovery.error] }), !locationToolsOpen && locationRecovery.attempts.length > 0 && _jsxs("div", { className: "load-error", role: "alert", children: [_jsx("span", { children: "A location request is retained. Resolve its original result before starting another operation." }), _jsx(Button, { variant: "outline", disabled: modalOpen || loading || !data, onClick: () => resumeLocationWork(locationRecovery.attempts[0]), children: "Resume location request" })] }), !teachingCheckout && (teachingRecovery.attempts.length > 0 || teachingRecovery.drafts.length > 0) && _jsxs("div", { className: "load-error", role: "alert", children: [_jsx("span", { children: teachingRecovery.attempts.length ? "An unfinished teaching checkout or return must be resolved with its original request." : "A reviewed teaching checkout draft is saved in this tab. Resume it before preparing another operation." }), _jsx(Button, { variant: "outline", disabled: !data || loading || !!error || modalOpen, onClick: () => resumeTeachingCheckout(teachingRecovery.attempts[0] ?? teachingRecovery.drafts[0]), children: "Resume teaching checkout" })] }), _jsx(RecoveryNotices, { recovery: recovery, movementOpen: !!(scan || intake || movement), assetsOpen: view === "assets", retiredHistoryOpen: view === "assets" && activeAssetTab === "history" && !intake, currentDataset: dataset, groupOpen: !!groupMaintenance, ready: ready, modalOpen: modalOpen, resumeScan: resumeScan, resumeMovement: resumeMovement, resumeRemoval: resumeRemoval, resumeRetiredAction: resumeRetiredAction, startIntake: startIntake, resumeGroupChange: resumeGroupChange }), _jsx(MotionPresence, { children: notice && (_jsxs("div", { className: "success-notice", role: "status", children: [_jsx("span", { children: notice }), _jsx(Button, { variant: "ghost", size: "icon", onClick: () => setNotice(""), "aria-label": "Dismiss notification", children: _jsx(X, { size: 16 }) })] })) }), _jsx(MotionPresence, { children: recoveryUnavailable && (_jsx("div", { className: "load-error", role: "alert", children: "Device recovery storage is unavailable. Restore access before starting another workflow." })) }), _jsx(MotionPresence, { children: error && (_jsxs("div", { className: "load-error", role: "alert", children: [_jsx("span", { children: error }), _jsx(Button, { variant: "outline", onClick: refresh, disabled: loading, children: "Retry refresh" })] })) }), _jsx(RefreshStatus, { active: loading && !!data }), loading && !data ? (_jsx(LoadingState, { label: "Loading your workspace", detail: "Preparing the inventory and your saved views." })) : (data && (_jsxs(_Fragment, { children: [view === "assets" && !scan && (_jsxs("section", { className: "asset-workspace", "aria-label": "Intake and removal workspace", children: [_jsx(Tabs, { value: activeAssetTab, onValueChange: (value) => {
                                            if (!intake && !assetLocked) {
                                                if (pendingRetiredActions.length && value !== "history") {
                                                    resumeRetiredAction(pendingRetiredActions[0]);
                                                    return;
                                                }
                                                setAssetTab(value);
                                            }
                                        }, children: _jsxs(TabsList, { variant: "line", className: "lifecycle-tabs", children: [_jsx(TabsTrigger, { value: "intake", disabled: !!intake || assetLocked, children: "New battery intake" }), _jsx(TabsTrigger, { value: "removal", disabled: !!intake || assetLocked, children: "Retire or remove" }), _jsx(TabsTrigger, { value: "history", disabled: !!intake || assetLocked, children: "Removal history" })] }) }), !intake && activeAssetTab !== "removal" && assetExitHeader, activeAssetTab === "intake" &&
                                        (intake ? (_jsx(IntakeStation, { data: data, write: write, onRegistered: taskChanged, onExit: () => {
                                                setIntake(null);
                                                setNotice("");
                                                showWorkspace(() => setView("inventory"));
                                                void refresh();
                                            } }, `${dataset}-${user.id}-${intake.nonce}`)) : (_jsxs("div", { className: "intake-panel", children: [_jsx("h3", { children: "Prepare new batteries" }), _jsx("p", { className: "field-hint", children: "Set common details once, scan into an editable pending list, then confirm all or selected batteries. Demonstration inputs are available only in Demonstration inventory." }), _jsx(Button, { onClick: startIntake, disabled: !ready, children: pendingIntakes.length
                                                        ? "Resume demo intake"
                                                        : "Start demo intake" })] }))), !intake && (_jsx("div", { hidden: activeAssetTab !== "removal", children: _jsx(RemovalStation, { initialIds: groupRemoval?.ids, teachingGroup: groupRemoval?.teachingGroup, data: data, write: write, onDetail: (id) => {
                                                setDetailGroup(undefined);
                                                setDetailId(id);
                                            }, onBusyChange: setRemovalLocked, onExit: exitAssets, onChanged: () => load(dataset) }, `${dataset}-${user.id}-${groupRemoval?.nonce ?? "ordinary"}`) })), activeAssetTab === "history" && !intake && (_jsx(RemovalHistory, { data: data, write: write, onChanged: () => load(dataset), onBusyChange: setRetiredActionLocked, paused: !!(editor || detailId || exportDraft) || !pendingRetiredActions.some(pending => pending.dataset === dataset) && !!(pendingRetiredActions.length || pendingRemovals.length || pendingIntakes.length || pendingScans.length || pendingMovements.length || recovery.groups.length), onDetail: (id) => {
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
                                }, onChanged: taskChanged }, `${dataset}-${user.id}-${scan.nonce}`)), !scan && !intake && retainInventory && (_jsx("div", { hidden: !inventoryView, children: _jsx(InventoryTable, { active: inventoryView, overlayOpen: modalOpen, personalScope: inventoryPersonalScope, newArrivals: newArrivals.arrivals, onViewNewArrivals: inventoryPersonalScope === "all" ? newArrivals.acknowledge : undefined, arrivalsPending: inventoryPersonalScope === "all" && newArrivals.pending, arrivalsError: inventoryPersonalScope === "all" ? newArrivals.error : "", data: data, ready: ready, onMovement: startMovement, onScan: startScan, onEdit: (draft) => {
                                        setEditorGroup(undefined);
                                        setEditor(draft);
                                    }, onDetail: (id) => {
                                        setDetailGroup(undefined);
                                        setDetailId(id);
                                    }, onOpenGroups: openTeachingGroups, onSetup: () => setView("manage"), onExport: setExportDraft, onGroupsChanged: () => load(dataset), onGroupDialogChange: setGroupsOpen }, `${dataset}-${inventoryPersonalScope}`) })), _jsx("div", { hidden: view !== "mapping" || !!scan || !!intake, children: _jsx(MappingWorkspace, { active: view === "mapping" && !scan && !intake, data: data, ready: ready, overlayOpen: modalOpen, onMovement: startMovement, onScan: startScan, onRemoval: ids => { if (!modalOpen && ready && !interceptPendingWorkflow()) {
                                        setGroupRemoval({ ids: [...ids], nonce: crypto.randomUUID(), returnView: "mapping" });
                                        setView("assets");
                                        setAssetTab("removal");
                                        setNotice("");
                                    } }, onEdit: draft => { setEditorGroup(undefined); setEditor(draft); }, onDetail: (id, roomId) => { setDetailGroup(undefined); setDetailMappingRoom(roomId ?? null); setDetailId(id); }, onSetup: () => setView("manage"), onExport: setExportDraft, onGroupsChanged: taskChanged, onGroupDialogChange: setGroupsOpen, onOpenGroups: openTeachingGroups, onLocationTools: () => { if (!modalOpen)
                                        setLocationToolsOpen(true); } }, `mapping-${dataset}-${user.id}`) }), !scan && !intake && view === "teaching-groups" && (_jsx(TeachingGroupsWorkspace, { overlayOpen: modalOpen, data: data, ready: ready, revision: revision, personalScope: inventoryPersonalScope, onReturnCheckout: (run) => {
                                    if (!modalOpen && !interceptPendingWorkflow())
                                        setTeachingCheckout({ kind: "return", run, personalScope: inventoryPersonalScope });
                                }, onContinueCheckout: (run, group, ids) => {
                                    if (ready && !modalOpen && !interceptPendingWorkflow())
                                        setTeachingCheckout({ kind: "continue", run, group, ids: [...ids], personalScope: inventoryPersonalScope });
                                }, onExchangeCheckout: (run, item) => {
                                    if (ready && !modalOpen && !interceptPendingWorkflow())
                                        setTeachingCheckout({ kind: "exchange", run, item, personalScope: inventoryPersonalScope });
                                }, onDownloadCheckout: (run, format) => downloadTeachingCheckoutReport(dataset, run.id, format), activeId: activeGroupId, onActiveChange: setActiveGroupId, onBack: returnFromTeachingGroups, returnBlocked: modalOpen || teachingPending, onMovement: startMovement, onRemoval: startGroupRemoval, onMaintenance: (ids, group) => {
                                    if (!modalOpen && !interceptPendingGroupChange()) {
                                        if (pendingIntakes.length ||
                                            pendingRemovals.length ||
                                            pendingRetiredActions.length ||
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
                                    showWorkspace(() => {
                                        setActivityGroupId(group.id);
                                        setView("activity");
                                    });
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
                }, write: write }, movement.nonce)), data && teachingCheckout && (teachingCheckout.kind !== "recover" && teachingCheckout.kind !== "resume" || (teachingCheckout.kind === "recover" ? teachingCheckout.attempt.dataset : teachingCheckout.saved.dataset) === data.dataset) && (_jsx(TeachingCheckoutDialog, { data: data, draft: teachingCheckout, onChanged: async () => {
                    setNotice("The teaching checkout or return was confirmed. Its actual loan records are saved.");
                    try {
                        await taskChanged();
                    }
                    catch (failure) {
                        setError("The teaching request was confirmed, but inventory refresh failed. Refresh before starting another operation.");
                        throw failure;
                    }
                }, onClose: (reviewedInventory) => { acceptReviewedInventory(reviewedInventory); setTeachingCheckout(null); } }, `${data.dataset}-${data.user.id}-${teachingCheckout.kind === "recover" ? teachingCheckout.attempt.payload.requestId : teachingCheckout.kind === "resume" ? "saved-draft" : teachingCheckout.kind === "return" || teachingCheckout.kind === "exchange" ? teachingCheckout.run.id : teachingCheckout.group.id}`)), data && editor && (_jsx(RecordEditor, { draft: editor, data: data, onClose: () => {
                    setEditor(null);
                    setEditorGroup(undefined);
                }, write: groupWrite(editorGroup) }, `${editor.kind}-${editor.record?.id ?? "new"}`)), data && detailBattery && (_jsx(BatteryDetails, { battery: detailBattery, data: data, revision: revision, onInspectionChanged: () => {
                    void taskChanged().catch(() => setError("The inspection change was saved, but shared activity could not refresh. Refresh before starting another operation."));
                }, onClose: () => {
                    setDetailId(null);
                    setDetailGroup(undefined);
                    setDetailMappingRoom(null);
                }, onExport: () => setExportDraft({
                    batteryId: detailBattery.id,
                    filter: { ...defaultInventoryFilter(), personalScope, mappingRoom: view === "mapping" ? detailMappingRoom : null },
                    page: 0,
                    pageSize: "25",
                    matching: 1,
                    pageCount: 1,
                }), onEdit: (battery) => {
                    setDetailId(null);
                    setDetailMappingRoom(null);
                    setEditorGroup(detailGroup);
                    setEditor({ kind: "battery", record: battery });
                }, write: groupWrite(detailGroup) }, `${dataset}-${detailBattery.id}`)), data && groupMaintenance && (_jsx(GroupMaintenanceDialog, { data: data, group: groupMaintenance.group, ids: groupMaintenance.ids, write: write, onChanged: taskChanged, onClose: () => setGroupMaintenance(null) }, `${dataset}-${user.id}`)), data && locationToolsOpen && _jsx(LocationToolsPanel, { data: data, ready: ready, onChanged: taskChanged, onClose: () => setLocationToolsOpen(false) }), exportDraft && (_jsx(ExportDialog, { draft: exportDraft, dataset: dataset, onClose: () => setExportDraft(null) })), importKind && (_jsx(ImportDialog, { kind: importKind, onClose: () => setImportKind(null), write: write }))] }));
}
