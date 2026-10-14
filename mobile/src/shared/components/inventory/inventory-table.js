"use client";
import { jsxs as _jsxs, jsx as _jsx, Fragment as _Fragment } from "react/jsx-runtime";
import { isActiveBattery, batteryStatusLabel } from "../../lib/battery-lifecycle.js";
import { useEffect, useRef, useState } from "react";
import { shouldToggleSelection } from "../../lib/client/row-selection.js";
import { Battery, Package, Plus, Download, Settings2, ChevronDown, AlertTriangle, Clock3 } from "lucide-react";
import { Button } from "../ui/button.js";
import { MotionDisclosure } from "../ui/workspace-motion.js";
import { transitionWorkspace } from "../../lib/client/workspace-motion.js";
import { ReviewQueueSurface } from "./review-queue-surface.js";
import { Checkbox } from "../ui/checkbox.js";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem, } from "../ui/select.js";
import { Tabs, TabsList, TabsTrigger } from "../ui/tabs.js";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell, } from "../ui/table.js";
import { formatTime, formatBatteryAge, formatDateOnly, buildingLabel, storageRoomLabel, } from "../../lib/client-utils.js";
import { filterBatteries, defaultInventoryFilter, inventoryFilterSchema, } from "../../lib/inventory-query.js";
import { currentSydneyDate } from "../../lib/battery-age.js";
import { AppliedFilters, appliedFilterChips, InventoryFilterPanel, } from "./inventory-filter-panel.js";
import { TeachingGroupsPanel } from "./teaching-groups-panel.js";
import { getRolePermissions } from "../../lib/permissions.js";
import styles from "./inventory-table.module.css";
import { recentNewArrivals } from "../../lib/new-arrivals.js";
import { mappingScopeLabel } from "../../lib/inventory-mapping.js";
export function InventoryTable({ data, ready, onMovement, onScan, onEdit, onDetail, onSetup, onExport, onGroupsChanged, onGroupDialogChange, onOpenGroups, group, mappingRoom = null, onRemoval, onGroupMaintenance, onGroupCheckouts, personalScope = "all", newArrivals = data.newArrivals, onViewNewArrivals, arrivalsPending = false, arrivalsError = "", active = true, overlayOpen = false, }) {
    const permissions = getRolePermissions(data.user.role);
    const instancePrefix = `inventory-${data.dataset}-${personalScope}-${mappingRoom ? `mapping-${encodeURIComponent(mappingRoom)}` : group ? `group-${encodeURIComponent(group.id)}` : "shared"}`;
    const filterDisclosureId = `${instancePrefix}-filter-disclosure`;
    const [savedFilters, setFilters] = useState(() => ({
        ...defaultInventoryFilter(),
        personalScope,
        mappingRoom,
        ...(group ? { groupId: group.id, lifecycle: "all" } : {}),
    })), [filterOpen, setFilterOpen] = useState(false);
    const filters = {
        ...savedFilters,
        personalScope,
        mappingRoom,
        ...(group ? { groupId: group.id } : {}),
    };
    const [selectedIds, setSelected] = useState([]);
    const [expandedIds, setExpanded] = useState([]);
    const [page, setPage] = useState(0), [pageSize, setPageSize] = useState("25");
    const [groupEditor, setGroupEditor] = useState(null), [groupNotice, setGroupNotice] = useState("");
    const [queueOpen, setQueueOpen] = useState(false);
    const [totalsOpen, setTotalsOpen] = useState(false);
    const workbenchRef = useRef(null);
    useEffect(() => {
        onGroupDialogChange?.(!!groupEditor);
        return () => {
            onGroupDialogChange?.(false);
        };
    }, [groupEditor, onGroupDialogChange]);
    const batteries = data.batteries;
    const baseBatteries = filterBatteries(batteries, {
        ...defaultInventoryFilter(),
        personalScope,
        mappingRoom,
        ...(group ? { groupId: group.id } : {}),
    }, currentSydneyDate(), data.user.id, data.teachingGroups ?? [], newArrivals, data.rooms);
    const onLoan = baseBatteries.filter((b) => b.loanId).length;
    const arrivalItems = recentNewArrivals(newArrivals);
    const activeScopeIds = new Set(baseBatteries.map(battery => battery.id));
    const recentIds = new Set(arrivalItems.map(item => item.batteryId));
    const scopeArrivals = arrivalItems.filter(item => activeScopeIds.has(item.batteryId));
    const unreadArrivals = scopeArrivals.filter(item => item.isUnread);
    const unreadInStore = unreadArrivals.filter(item => !batteries.find(battery => battery.id === item.batteryId)?.loanId).length;
    const unreadInUse = unreadArrivals.length - unreadInStore;
    const knownIds = new Set(batteries.map((battery) => battery.id));
    const selected = [...new Set(selectedIds)].filter((id) => knownIds.has(id));
    const baseIds = new Set(filterBatteries(batteries, { personalScope, lifecycle: "all", mappingRoom }, currentSydneyDate(), data.user.id, data.teachingGroups ?? [], newArrivals, data.rooms).map((battery) => battery.id));
    const outsidePersonalScope = group
        ? selected.filter((id) => !group.batteryIds.includes(id))
        : personalScope === "all" && !mappingRoom
            ? []
            : selected.filter((id) => !baseIds.has(id));
    const selectionScopeChanged = outsidePersonalScope.length > 0;
    const validation = inventoryFilterSchema.safeParse(filters), asOfOn = currentSydneyDate();
    const groupMissing = !!filters.groupId &&
        !data.teachingGroups?.some((group) => group.id === filters.groupId &&
            group.ownerAccountId === data.user.id &&
            group.state === "active");
    const matching = validation.success && !groupMissing
        ? filterBatteries(batteries, validation.data, asOfOn, data.user.id, data.teachingGroups ?? [], newArrivals, data.rooms)
        : [];
    const allStatuses = validation.success && !groupMissing
        ? filterBatteries(batteries, { ...validation.data, status: "all" }, asOfOn, data.user.id, data.teachingGroups ?? [], newArrivals, data.rooms)
        : [];
    const matchingOnLoan = allStatuses.filter((b) => isActiveBattery(b) && b.loanId).length;
    const matchingInStore = allStatuses.filter((b) => isActiveBattery(b) && !b.loanId).length;
    const chips = appliedFilterChips(filters, data).filter((chip) => !group || chip.key !== "group");
    const pageCount = Math.max(1, Math.ceil(matching.length / Number(pageSize))), currentPage = Math.min(page, pageCount - 1);
    const visible = matching.slice(currentPage * Number(pageSize), (currentPage + 1) * Number(pageSize));
    function selectAll(checked) {
        setSelected(checked
            ? [...new Set([...selected, ...visible.map((b) => b.id)])]
            : selected.filter((id) => !visible.some((b) => b.id === id)));
    }
    function changeBatterySelection(id, checked) {
        if (!ready)
            return;
        setSelected((previous) => {
            const select = checked ?? !previous.includes(id);
            return select
                ? previous.includes(id)
                    ? previous
                    : [...previous, id]
                : previous.filter((value) => value !== id);
        });
    }
    function selectBatteryRow(id, event) {
        if (!ready || !shouldToggleSelection(event))
            return;
        changeBatterySelection(id);
    }
    function updateFilters(patch) {
        transitionWorkspace(() => {
            setFilters((previous) => ({ ...previous, ...patch }));
            setPage(0);
        });
    }
    function focusFilterToggle() {
        if (typeof document !== "undefined")
            document.getElementById(`${instancePrefix}-filter-toggle`)?.focus({ preventScroll: true });
    }
    function clearFilters() {
        transitionWorkspace(() => {
            setFilters({
                ...defaultInventoryFilter(),
                personalScope,
                mappingRoom,
                ...(group ? { groupId: group.id, lifecycle: "all" } : {}),
            });
            setPage(0);
        });
    }
    function selectGroup(group) {
        const allowed = group.batteryIds.filter((id) => knownIds.has(id) && baseIds.has(id));
        const excluded = group.batteryIds.length - allowed.length;
        setSelected(allowed);
        updateFilters({ groupId: group.id, status: "all", lifecycle: "all" });
        setGroupNotice(`${group.name}: ${allowed.length} ${allowed.length === 1 ? "battery" : "batteries"} selected.${excluded ? ` ${excluded} ${excluded === 1 ? "member is" : "members are"} outside this personal view and ${excluded === 1 ? "was" : "were"} not selected.` : ""} Review current use and retired states before an operation.`);
    }
    function exportInventory() {
        if (validation.success && !selectionScopeChanged)
            onExport({
                selectedIds: [...selected],
                teachingGroup: group ? { id: group.id, version: group.version } : undefined,
                filter: validation.data,
                page: currentPage,
                pageSize,
                matching: matching.length,
                pageCount: visible.length,
            });
    }
    return (_jsxs(_Fragment, { children: [mappingRoom && _jsxs("p", { className: "personal-inventory-scope", children: [_jsxs("strong", { children: ["Last observation scope: ", mappingScopeLabel(mappingRoom, data.rooms)] }), _jsx("span", { children: "Ordinary filters and downloads stay within this tab. These records do not confirm the batteries' present locations." })] }), personalScope !== "all" && (_jsxs("div", { className: "personal-inventory-scope", children: [_jsx("strong", { children: personalScope === "responsible"
                            ? "My batteries"
                            : "My batteries in use" }), _jsxs("span", { children: [personalScope === "responsible"
                                ? "Batteries assigned to your account as responsible owner, including those in use by other staff."
                                : "Batteries currently checked out to your account.", " ", "Filters and downloads apply within this view."] })] })), _jsxs("div", { ref: workbenchRef, className: styles.workbench, "data-queue-expanded": queueOpen, children: [_jsxs(ReviewQueueSurface, { id: `${instancePrefix}-review-queue`, open: queueOpen, onOpenChange: setQueueOpen, active: active, overlayOpen: overlayOpen || !!groupEditor, count: selected.length, outsideCount: selected.filter(id => !matching.some(battery => battery.id === id)).length, scopeChanged: selectionScopeChanged, workbenchRef: workbenchRef, children: [!selected.length && _jsxs("div", { className: styles.queueEmpty, children: [_jsx("span", { className: styles.queueIllustration, "aria-hidden": "true", children: _jsx(Battery, { size: 32, strokeWidth: 1.5 }) }), _jsx("h3", { children: "Choose batteries to begin" }), _jsx("p", { children: "Select batteries to prepare a checkout, return or download." })] }), !!selected.length && _jsxs(_Fragment, { children: [_jsx("p", { className: styles.queueHint, children: "Selection is kept when you change filters or pages. Nothing is saved until you confirm." }), _jsx("ul", { className: styles.queueItems, "aria-label": "Selected batteries", children: selected.map(id => {
                                            const battery = batteries.find(item => item.id === id);
                                            return _jsxs("li", { children: [_jsxs("button", { className: styles.queueRecord, onClick: () => onDetail(id), "aria-label": `Open selected ${id}`, children: [_jsx("strong", { children: id }), _jsx("span", { children: batteryStatusLabel(battery) })] }), _jsx(Button, { size: "icon-sm", variant: "ghost", "data-queue-remove": true, "aria-label": `Remove ${id} from selection`, onClick: (event) => {
                                                            const item = event.currentTarget.closest("li");
                                                            const next = item?.nextElementSibling?.querySelector("[data-queue-remove]") ?? item?.previousElementSibling?.querySelector("[data-queue-remove]") ?? event.currentTarget.closest("[data-review-queue]")?.querySelector("h2");
                                                            next?.focus({ preventScroll: true });
                                                            setSelected(previous => previous.filter(value => value !== id));
                                                        }, children: _jsx("span", { "aria-hidden": "true", children: "\u00D7" }) })] }, id);
                                        }) })] }), _jsx(MotionDisclosure, { open: !!selected.length, children: _jsxs("div", { className: "selection-toolbar", children: [_jsxs("strong", { children: [selected.length, " selected", selected.some((id) => !matching.some((b) => b.id === id))
                                                    ? ` · ${selected.filter((id) => !matching.some((b) => b.id === id)).length} outside current filters`
                                                    : ""] }), _jsxs(Button, { variant: "outline", size: "sm", onClick: exportInventory, disabled: !selected.length || !validation.success || selectionScopeChanged, children: [_jsx(Download, { size: 16 }), "Download selected"] }), _jsx(Button, { variant: "outline", size: "sm", onClick: () => onMovement("checkout", selected), disabled: !ready ||
                                                selectionScopeChanged ||
                                                !selected.length ||
                                                selected.length > 100 ||
                                                selected.some((id) => (!group && batteries.find((b) => b.id === id)?.loanId) ||
                                                    !isActiveBattery(batteries.find((b) => b.id === id))), children: "Check out selected" }), _jsx(Button, { variant: "outline", size: "sm", onClick: () => onMovement("return", selected), disabled: !ready ||
                                                selectionScopeChanged ||
                                                !selected.length ||
                                                selected.length > 100 ||
                                                selected.some((id) => !batteries.find((b) => b.id === id)?.loanId ||
                                                    !isActiveBattery(batteries.find((b) => b.id === id))), children: "Return selected" }), _jsx(Button, { variant: "ghost", size: "sm", disabled: !selected.length, onClick: () => setSelected([]), children: "Clear selection" })] }) }), selectionScopeChanged && (_jsxs("div", { className: "selection-scope-warning", role: "alert", children: [_jsx("strong", { children: "Your selected batteries have changed scope." }), _jsxs("p", { children: ["These batteries no longer belong to", " ", group
                                                ? "this teaching group"
                                                : mappingRoom
                                                    ? "this last-observation room scope"
                                                    : personalScope === "responsible"
                                                        ? "My batteries"
                                                        : "My batteries in use", ":", " ", outsidePersonalScope.map((id, index) => (_jsxs("span", { children: [index > 0 ? ", " : "", _jsx("button", { className: "record-link", onClick: () => onDetail(id), children: id })] }, id))), ". Review their current details, then remove them from your selection before downloading or starting an operation."] }), _jsx(Button, { variant: "outline", size: "sm", onClick: () => setSelected(selected.filter((id) => !outsidePersonalScope.includes(id))), children: "Remove batteries outside this view" })] })), selected.length > 100 && (_jsx("p", { className: "field-hint", children: "Checkouts and returns support up to 100 batteries per batch. Reduce your selection before starting a movement. You can still download all selected batteries together." })), _jsx(MotionDisclosure, { open: !!selected.length, children: _jsxs("div", { className: "teaching-group-actions", children: [(group || mappingRoom) && (_jsxs(_Fragment, { children: [onRemoval && (_jsx(Button, { variant: "outline", size: "sm", onClick: () => onRemoval(selected), disabled: !ready ||
                                                        selectionScopeChanged || !selected.length || selected.length > 100 ||
                                                        selected.some((id) => {
                                                            const b = batteries.find((b) => b.id === id);
                                                            return !isActiveBattery(b) || !!b.loanId;
                                                        }), children: "Retire or remove selected" })), onGroupMaintenance && permissions.editBatteryRecords && (_jsx(Button, { variant: "outline", size: "sm", onClick: () => onGroupMaintenance(selected), disabled: !ready ||
                                                        selected.some((id) => !isActiveBattery(batteries.find((b) => b.id === id))), children: "Update selected members" }))] })), _jsx(Button, { variant: "outline", size: "sm", onClick: () => setGroupEditor({ ids: [...selected] }), disabled: !ready || selected.length > 100 || selectionScopeChanged
                                                || !selected.length, children: "Save as teaching group" }), selected.length > 100 && (_jsx("span", { className: "field-hint", children: "Teaching groups support up to 100 batteries. Reduce the selection to save a group." }))] }) }), onScan && _jsxs("div", { className: styles.queueStations, children: [_jsx("h3", { children: "Using tags or manual entry?" }), _jsx("p", { children: "Open a station to build and review a batch." }), _jsx(Button, { variant: "outline", disabled: !ready, onClick: () => onScan("checkout"), children: "Scan checkout" }), _jsx(Button, { variant: "outline", disabled: !ready, onClick: () => onScan("return"), children: "Scan return" })] }), _jsxs("details", { className: styles.summaryDisclosure, open: totalsOpen, onToggle: event => setTotalsOpen(event.currentTarget.open), children: [_jsxs("summary", { children: [_jsx("span", { children: "Active scope totals" }), _jsxs("span", { children: [_jsx("strong", { children: baseBatteries.length }), " batteries \u00B7 ", _jsx("strong", { children: baseBatteries.length - onLoan }), " in store \u00B7 ", _jsx("strong", { children: onLoan }), " in use"] }), _jsx(ChevronDown, { size: 16, "aria-hidden": "true" })] }), _jsx("div", { className: styles.summaryStrip, "aria-label": "Inventory totals", children: [
                                            [
                                                "Active batteries",
                                                baseBatteries.length,
                                                group
                                                    ? "In this teaching group"
                                                    : mappingRoom
                                                        ? "Last observed in this room scope"
                                                        : personalScope === "all"
                                                            ? "Across registered storage locations"
                                                            : "In this personal view",
                                            ],
                                            [
                                                "In store",
                                                baseBatteries.length - onLoan,
                                                "No active loan recorded",
                                            ],
                                            ["In use", onLoan, "Linked to a current staff holder"],
                                        ].map(([label, count, note]) => (_jsxs("div", { className: styles.summaryItem, children: [_jsx("strong", { children: count }), _jsxs("div", { children: [_jsx("span", { children: label }), _jsx("small", { children: note })] })] }, label))) })] })] }), _jsxs("section", { className: "inventory-panel", "aria-label": "Battery inventory records", children: [group && (_jsxs("div", { className: "group-bulk-actions", children: [_jsx("strong", { children: "Group operations" }), _jsx(Button, { variant: "outline", onClick: () => onMovement("checkout", group.batteryIds), disabled: !ready, children: "Check out group" }), _jsx(Button, { variant: "outline", onClick: () => onGroupCheckouts ? onGroupCheckouts() : onMovement("return", group.batteryIds), disabled: !ready, children: onGroupCheckouts ? "Actual group checkouts" : "Return group" }), _jsx(Button, { variant: "outline", onClick: () => {
                                            setSelected([...group.batteryIds]);
                                            setGroupNotice("All group members selected, including retired members. Review their current state before an operation.");
                                        }, disabled: !ready, children: "Select all group members" }), _jsx(Button, { variant: "outline", onClick: () => setSelected(matching.map((b) => b.id)), disabled: !ready || !matching.length, children: "Select filtered group members" })] })), _jsxs("div", { className: "panel-top", children: [_jsxs("div", { className: "inventory-category-navigation", children: [_jsx(Tabs, { value: filters.status, onValueChange: (value) => updateFilters({ status: value }), children: _jsxs(TabsList, { variant: "line", children: [_jsxs(TabsTrigger, { value: "all", children: ["All batteries", " ", _jsx("span", { className: "tab-count", children: allStatuses.length }), _jsx("span", { className: styles.arrivalDot, "data-visible": !!unreadArrivals.length, "aria-hidden": "true" }), !!unreadArrivals.length && _jsxs("span", { className: "sr-only", children: [unreadArrivals.length, " unread new registrations"] })] }), _jsxs(TabsTrigger, { value: "in", children: ["In store ", _jsx("span", { className: "tab-count", children: matchingInStore }), _jsx("span", { className: styles.arrivalDot, "data-visible": !!unreadInStore, "aria-hidden": "true" }), !!unreadInStore && _jsxs("span", { className: "sr-only", children: [unreadInStore, " unread new registrations"] })] }), _jsxs(TabsTrigger, { value: "out", children: ["In use ", _jsx("span", { className: "tab-count", children: matchingOnLoan }), _jsx("span", { className: styles.arrivalDot, "data-visible": !!unreadInUse, "aria-hidden": "true" }), !!unreadInUse && _jsxs("span", { className: "sr-only", children: [unreadInUse, " unread new registrations"] })] })] }) }), !group && !onOpenGroups && (_jsx(Button, { variant: "ghost", className: "inventory-teaching-groups-link", onClick: () => setGroupEditor({ ids: [] }), disabled: !ready, children: "Teaching groups" }))] }), !onScan && _jsxs(Button, { variant: "outline", onClick: () => onEdit({ kind: "battery" }), disabled: !ready, children: [_jsx(Plus, {}), "Register battery"] })] }), _jsx(MotionDisclosure, { open: filters.newArrivalsOnly || !!arrivalsError, children: _jsxs("div", { className: styles.arrivalsNote, children: [arrivalsError ? _jsx("p", { className: "form-error", role: "alert", children: arrivalsError }) : _jsx("p", { children: "Registered in the last 48 hours, newest first. Opening New arrivals marks the displayed registration notices as read for your account. Later notices remain unread; the 48-hour labels and selected batteries are retained." }), arrivalsPending && _jsx("span", { role: "status", children: "Updating your reminder\u2026" })] }) }), _jsxs("div", { className: "table-toolbar inventory-filter-toolbar", children: [_jsxs(Button, { id: `${instancePrefix}-filter-toggle`, variant: "outline", onClick: () => setFilterOpen((open) => !open), "aria-expanded": filterOpen, "aria-controls": filterDisclosureId, children: [_jsx(Settings2, { size: 16 }), "Filter", chips.length ? ` (${chips.length})` : ""] }), !group && onViewNewArrivals && _jsxs(Button, { variant: "ghost", className: styles.arrivalsButton, "aria-pressed": filters.newArrivalsOnly, "aria-busy": arrivalsPending, disabled: !ready || arrivalsPending, onClick: () => {
                                            updateFilters({ ...defaultInventoryFilter(), personalScope, newArrivalsOnly: true, sortBy: "registered", sortDirection: "desc" });
                                            void onViewNewArrivals(newArrivals?.throughSequence ?? 0);
                                        }, title: "View batteries first registered within the last 48 hours and acknowledge this inventory's new registrations for your account.", children: [_jsxs("span", { className: styles.arrivalsIcon, "aria-hidden": "true", children: [_jsx(Clock3, { size: 15 }), _jsx("span", { className: styles.arrivalsUnreadDot, "data-visible": !!unreadArrivals.length })] }), _jsx("span", { children: "New arrivals" }), _jsx("span", { className: styles.arrivalsCount, children: scopeArrivals.length }), !!unreadArrivals.length && _jsxs("span", { className: "sr-only", children: [unreadArrivals.length, " unread new registrations"] })] }), _jsx(AppliedFilters, { chips: chips, onRemove: (patch) => { focusFilterToggle(); updateFilters(patch); }, onClear: () => { focusFilterToggle(); clearFilters(); } }), _jsxs("span", { className: "toolbar-meta", children: [matching.length, " matching", " ", matching.length === 1 ? "battery" : "batteries"] }), _jsxs(Button, { variant: "ghost", onClick: exportInventory, disabled: !validation.success ||
                                            selectionScopeChanged ||
                                            (!matching.length && !selected.length), "aria-label": "Download inventory", children: [_jsx(Download, { size: 16 }), _jsx("span", { children: "Download" })] })] }), _jsx(MotionDisclosure, { open: filterOpen, id: filterDisclosureId, children: _jsx(InventoryFilterPanel, { id: `${instancePrefix}-filter-panel`, fixedGroup: !!group, data: data, filters: filters, asOfOn: asOfOn, onChange: updateFilters }) }), groupMissing && (_jsx("p", { className: "form-error", role: "alert", children: "This teaching group is no longer available. Clear the group filter or choose a current group. Your selected batteries are retained for review." })), groupNotice && (_jsx("p", { role: "status", className: "field-hint", children: groupNotice })), groupEditor && (_jsx(TeachingGroupsPanel, { data: data, initialIds: groupEditor.ids, addToExisting: !!groupEditor.ids.length, onClose: () => setGroupEditor(null), onChanged: onGroupsChanged, onFilter: (group) => {
                                    updateFilters({ groupId: group.id });
                                    setGroupNotice("");
                                }, onSelect: selectGroup })), !validation.success && (_jsx("p", { className: "form-error filter-error", role: "alert", children: validation.error.issues.map((issue) => issue.message).join(" ") })), _jsxs(Table, { className: styles.table, role: "table", "aria-label": "Battery records", children: [_jsx(TableHeader, { role: "rowgroup", children: _jsxs(TableRow, { role: "row", children: [_jsxs(TableHead, { scope: "col", role: "columnheader", className: "checkbox-cell", children: [_jsx(Checkbox, { "aria-label": "Select all batteries on this page", checked: visible.length > 0 &&
                                                                visible.every((b) => selected.includes(b.id))
                                                                ? true
                                                                : visible.some((b) => selected.includes(b.id))
                                                                    ? "indeterminate"
                                                                    : false, disabled: !visible.length || !ready, onCheckedChange: (v) => selectAll(v === true) }), _jsx("span", { className: styles.selectPageLabel, "aria-hidden": "true", children: "Select this page" })] }), _jsx(TableHead, { scope: "col", role: "columnheader", className: styles.expansionColumn, children: _jsx("span", { className: "sr-only", children: "Additional battery information" }) }), _jsx(TableHead, { scope: "col", role: "columnheader", className: styles.assetColumn, children: "Battery" }), _jsx(TableHead, { scope: "col", role: "columnheader", className: styles.statusColumn, children: "Status" }), _jsx(TableHead, { scope: "col", role: "columnheader", className: styles.holderColumn, children: "Current holder" }), _jsx(TableHead, { scope: "col", role: "columnheader", className: styles.storageColumn, children: "Registered home" }), _jsx(TableHead, { scope: "col", role: "columnheader", className: styles.ownerColumn, children: "Responsible owner" }), group && permissions.editBatteryRecords && (_jsx(TableHead, { scope: "col", role: "columnheader", children: "ACTIONS" }))] }) }), _jsx(TableBody, { role: "rowgroup", children: visible.map((b) => [
                                            _jsxs(TableRow, { role: "row", className: "battery-selection-row", "data-selected": selected.includes(b.id), "data-expanded": expandedIds.includes(b.id), "data-selectable": ready, "aria-selected": selected.includes(b.id), onClick: (event) => selectBatteryRow(b.id, event), children: [_jsx(TableCell, { role: "cell", className: "checkbox-cell", children: _jsx(Checkbox, { "aria-label": `Select ${b.id}`, checked: selected.includes(b.id), disabled: !ready, onCheckedChange: (v) => changeBatterySelection(b.id, v === true) }) }), _jsx(TableCell, { role: "cell", className: styles.expansionColumn, children: _jsx(Button, { variant: "ghost", size: "icon-sm", className: styles.expandButton, "aria-label": `${expandedIds.includes(b.id) ? "Hide" : "Show"} additional information for ${b.id}`, "aria-expanded": expandedIds.includes(b.id), "aria-controls": `${instancePrefix}-battery-evidence-${encodeURIComponent(b.id)}`, onClick: () => setExpanded(previous => previous.includes(b.id) ? previous.filter(id => id !== b.id) : [...previous, b.id]), children: _jsx(ChevronDown, { size: 16 }) }) }), _jsx(TableCell, { role: "cell", className: styles.assetColumn, children: _jsxs("div", { className: `battery-cell ${styles.identity}`, children: [_jsx("span", { className: `battery-icon ${styles.assetIcon}`, children: _jsx(Battery, { size: 19 }) }), _jsxs("div", { children: [_jsxs("div", { className: styles.assetHeading, children: [_jsx("button", { className: `record-link ${styles.identifier}`, onClick: () => onDetail(b.id), "aria-label": `View ${b.id}`, children: b.id }), _jsxs("span", { className: styles.newArrivalBadge, "data-visible": isActiveBattery(b) && recentIds.has(b.id), "aria-hidden": !isActiveBattery(b) || !recentIds.has(b.id), title: `First registered ${formatTime(b.registeredAt)}. This label lasts 48 hours from registration.`, children: [_jsx("span", { "aria-hidden": "true", children: "New" }), _jsx("span", { className: "sr-only", children: "Newly registered" })] })] }), _jsx("span", { className: styles.assetName, children: b.name }), _jsxs("small", { children: [b.chemistry || "Chemistry not recorded", b.voltage != null ? ` · ${b.voltage} V` : " · Voltage not recorded"] }), !!b.inspectionPreview?.concernRecords && _jsxs("button", { type: "button", className: styles.concernLink, "aria-label": `View recorded concern evidence for ${b.id}`, onClick: () => onDetail(b.id), title: `${b.inspectionPreview.concernRecords} retained inspection ${b.inspectionPreview.concernRecords === 1 ? "record reports" : "records report"} a concern. Historical findings do not establish a current unresolved condition or an availability decision.`, children: [_jsx(AlertTriangle, { size: 13 }), b.inspectionPreview.latest?.outcome === "concern_observed" ? "Latest inspection: concern" : "Concern in history", _jsx("span", { className: styles.concernCount, children: b.inspectionPreview.concernRecords })] })] })] }) }), _jsx(TableCell, { role: "cell", className: styles.statusColumn, children: _jsx("span", { className: `status-badge ${styles.statusBadge} ${!isActiveBattery(b) ? "retired" : b.loanId ? "out" : "in"}`, children: batteryStatusLabel(b) }) }), _jsxs(TableCell, { role: "cell", className: styles.holderColumn, children: [_jsx("span", { className: styles.mobileLabel, "aria-hidden": "true", children: "Current holder" }), b.borrowerName ? _jsx("span", { className: styles.holderName, children: b.borrowerName }) : _jsx("span", { className: "muted", children: "\u2014" })] }), _jsxs(TableCell, { role: "cell", className: styles.storageColumn, children: [_jsx("span", { className: styles.mobileLabel, "aria-hidden": "true", children: "Registered home" }), _jsxs("div", { children: [_jsx("strong", { children: b.homeBuildingId
                                                                            ? buildingLabel({
                                                                                id: b.homeBuildingId,
                                                                                name: b.homeBuildingName,
                                                                            })
                                                                            : "Building not assigned" }), _jsx("span", { className: "cell-secondary", children: storageRoomLabel(b) })] })] }), _jsxs(TableCell, { role: "cell", className: styles.ownerColumn, children: [_jsx("span", { className: styles.mobileLabel, "aria-hidden": "true", children: "Responsible owner" }), _jsx("span", { children: b.ownerName })] }), group && permissions.editBatteryRecords && (_jsx(TableCell, { role: "cell", children: _jsx(Button, { variant: "ghost", size: "sm", onClick: () => onEdit({ kind: "battery", record: b }), disabled: !ready || !isActiveBattery(b), children: "Edit battery" }) }))] }, b.id),
                                            _jsx(TableRow, { role: "row", className: styles.evidenceRow, "data-expanded": expandedIds.includes(b.id), children: _jsx(TableCell, { role: "cell", colSpan: group && permissions.editBatteryRecords ? 8 : 7, children: _jsx(MotionDisclosure, { open: expandedIds.includes(b.id), id: `${instancePrefix}-battery-evidence-${encodeURIComponent(b.id)}`, children: _jsxs("div", { className: styles.evidenceGrid, children: [_jsxs("section", { "aria-label": `Specifications for ${b.id}`, children: [_jsx("h3", { children: "Specifications" }), _jsxs("dl", { children: [_jsxs("div", { children: [_jsx("dt", { children: "Registered model" }), _jsx("dd", { children: b.model || "Not recorded" })] }), _jsxs("div", { children: [_jsx("dt", { children: "Chemistry" }), _jsx("dd", { children: b.chemistry || "Not recorded" })] }), _jsxs("div", { children: [_jsx("dt", { children: "Registered capacity" }), _jsx("dd", { children: b.capacityMah != null ? `${b.capacityMah.toLocaleString()} mAh` : "Not recorded" })] }), _jsxs("div", { children: [_jsx("dt", { children: "Nominal voltage" }), _jsx("dd", { children: b.voltage != null ? `${b.voltage} V` : "Not recorded" })] }), _jsxs("div", { children: [_jsx("dt", { children: "RFID tag" }), _jsx("dd", { children: b.tagId || "No tag registered" })] })] })] }), _jsxs("section", { "aria-label": `Age and activity for ${b.id}`, children: [_jsx("h3", { children: "Age & activity" }), _jsxs("dl", { children: [_jsxs("div", { children: [_jsx("dt", { children: "Manufactured on" }), _jsx("dd", { children: formatDateOnly(b.manufacturedOn) })] }), _jsxs("div", { children: [_jsx("dt", { children: "Age since manufacture" }), _jsx("dd", { children: formatBatteryAge(b.manufacturedOn) })] }), _jsxs("div", { children: [_jsx("dt", { children: "Registered at" }), _jsx("dd", { children: formatTime(b.registeredAt) })] }), _jsxs("div", { children: [_jsx("dt", { children: "First used on" }), _jsx("dd", { children: formatDateOnly(b.firstUsedOn) })] }), _jsxs("div", { children: [_jsx("dt", { children: "Latest checkout" }), _jsx("dd", { children: formatTime(b.lastCheckedOutAt) })] }), _jsxs("div", { children: [_jsx("dt", { children: "Latest charge" }), _jsxs("dd", { children: [formatTime(b.chargedAt), b.chargedAt && ` · ${b.chargeDurationMinutes != null ? `${b.chargeDurationMinutes} min` : "Duration not recorded"}`] })] })] })] }), _jsxs("section", { "aria-label": `Last observed location for ${b.id}`, children: [_jsx("h3", { children: "Last observed location" }), b.observedAt ? _jsxs(_Fragment, { children: [_jsxs("dl", { children: [_jsxs("div", { children: [_jsx("dt", { children: "Room" }), _jsx("dd", { children: b.observedRoom || "Recorded address unavailable" })] }), _jsxs("div", { children: [_jsx("dt", { children: "Building" }), _jsx("dd", { children: b.observedBuilding || "Recorded address unavailable" })] }), _jsxs("div", { children: [_jsx("dt", { children: "Observed at" }), _jsx("dd", { children: formatTime(b.observedAt) })] }), _jsxs("div", { children: [_jsx("dt", { children: "Source" }), _jsx("dd", { children: b.observationSource || "Not recorded" })] })] }), b.observationRoomSnapshot === "unavailable" && _jsx("p", { children: "Historical address labels were not recorded." })] }) : _jsx("p", { children: "Not yet observed" }), _jsx("p", { children: "Separate, dated evidence. The registered home is shown in the main row." })] }), !!b.inspectionPreview?.concernRecords && _jsxs("section", { className: styles.concernEvidence, "aria-label": `Recorded inspection concern evidence for ${b.id}`, children: [_jsxs("div", { children: [_jsx("strong", { children: b.inspectionPreview.latest?.outcome === "concern_observed" ? "Latest inspection: concern" : "Concern in history" }), _jsxs("p", { children: [b.inspectionPreview.concernRecords, " retained inspection ", b.inspectionPreview.concernRecords === 1 ? "record" : "records", b.inspectionPreview.latestConcern && ` · Latest ${formatTime(b.inspectionPreview.latestConcern.performedAt)}`] })] }), _jsx("p", { children: "Recorded findings do not establish a current unresolved condition." }), _jsx("button", { type: "button", className: "record-link", onClick: () => onDetail(b.id), children: "View inspection evidence" })] })] }) }) }) }, `${b.id}-evidence`)
                                        ]) })] }), !matching.length && (_jsxs("div", { className: "empty-state", children: [_jsx(Package, {}), _jsx("h3", { children: !validation.success
                                            ? "Review the filter range"
                                            : !baseBatteries.length && personalScope === "responsible"
                                                ? "No batteries assigned to you"
                                                : !baseBatteries.length && personalScope === "borrowed"
                                                    ? "No current loans"
                                                    : batteries.length
                                                        ? "No matching batteries"
                                                        : "No batteries registered" }), _jsx("p", { children: !validation.success
                                            ? "Correct the filter conditions to view or download matching records."
                                            : !baseBatteries.length && personalScope === "responsible"
                                                ? "Your account has no batteries assigned as responsible owner. Shared records remain available in Battery inventory."
                                                : !baseBatteries.length && personalScope === "borrowed"
                                                    ? "You have no batteries currently checked out. Shared records remain available in Battery inventory."
                                                    : batteries.length
                                                        ? "Adjust or clear your filters."
                                                        : "Register a battery in J18 and choose its responsible staff account. Its room can stay unspecified." }), !batteries.length && personalScope === "all" && (_jsx(Button, { variant: "outline", onClick: onSetup, children: "Set up records" }))] })), _jsxs("div", { className: "pagination-bar", children: [_jsxs("span", { children: [matching.length ? currentPage * Number(pageSize) + 1 : 0, "\u2013", Math.min((currentPage + 1) * Number(pageSize), matching.length), " of", " ", matching.length, " matching", " ", matching.length === 1 ? "battery" : "batteries"] }), _jsxs("div", { children: [_jsxs(Select, { value: pageSize, onValueChange: (value) => {
                                                    transitionWorkspace(() => { setPageSize(value); setPage(0); });
                                                }, children: [_jsx(SelectTrigger, { "aria-label": "Batteries per page", children: _jsx(SelectValue, {}) }), _jsx(SelectContent, { children: ["10", "25", "50", "100"].map((size) => (_jsxs(SelectItem, { value: size, children: [size, " per page"] }, size))) })] }), _jsx(Button, { variant: "outline", size: "sm", onClick: () => transitionWorkspace(() => setPage(currentPage - 1)), disabled: !currentPage, children: "Previous" }), _jsxs("span", { children: ["Page ", currentPage + 1, " of ", pageCount] }), _jsx(Button, { variant: "outline", size: "sm", onClick: () => transitionWorkspace(() => setPage(currentPage + 1)), disabled: currentPage >= pageCount - 1, children: "Next" })] })] }), _jsxs("div", { className: "panel-footer", children: [_jsx("span", { children: "Storage building and room are the registered home. Last observed location is separate, dated evidence." }), _jsxs("span", { children: [baseBatteries.length, " ", "active ", baseBatteries.length === 1 ? "battery" : "batteries", " in this scope"] })] })] })] })] }));
}
