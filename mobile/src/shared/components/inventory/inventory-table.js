"use client";
import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { isActiveBattery, batteryStatusLabel } from "../../lib/battery-lifecycle.js";
import { useEffect, useState } from "react";
import { shouldToggleSelection } from "../../lib/client/row-selection.js";
import { Battery, Package, Plus, Download, Settings2 } from "lucide-react";
import { Button } from "../ui/button.js";
import { Checkbox } from "../ui/checkbox.js";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem, } from "../ui/select.js";
import { Tabs, TabsList, TabsTrigger } from "../ui/tabs.js";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell, } from "../ui/table.js";
import { formatTime, formatBatteryAge, buildingLabel, storageRoomLabel, } from "../../lib/client-utils.js";
import { filterBatteries, defaultInventoryFilter, inventoryFilterSchema, } from "../../lib/inventory-query.js";
import { currentSydneyDate } from "../../lib/battery-age.js";
import { AppliedFilters, appliedFilterChips, InventoryFilterPanel, } from "./inventory-filter-panel.js";
import { TeachingGroupsPanel } from "./teaching-groups-panel.js";
import { getRolePermissions } from "../../lib/permissions.js";
export function InventoryTable({ data, ready, onMovement, onEdit, onDetail, onSetup, onExport, onGroupsChanged, onGroupDialogChange, onOpenGroups, group, onRemoval, onGroupMaintenance, personalScope = "all", }) {
    const permissions = getRolePermissions(data.user.role);
    const [savedFilters, setFilters] = useState(() => ({
        ...defaultInventoryFilter(),
        personalScope,
        ...(group ? { groupId: group.id, lifecycle: "all" } : {}),
    })), [filterOpen, setFilterOpen] = useState(false);
    const filters = {
        ...savedFilters,
        personalScope,
        ...(group ? { groupId: group.id } : {}),
    };
    const [selectedIds, setSelected] = useState([]);
    const [page, setPage] = useState(0), [pageSize, setPageSize] = useState("25");
    const [groupEditor, setGroupEditor] = useState(null), [groupNotice, setGroupNotice] = useState("");
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
        ...(group ? { groupId: group.id } : {}),
    }, currentSydneyDate(), data.user.id, data.teachingGroups ?? []);
    const onLoan = baseBatteries.filter((b) => b.loanId).length;
    const knownIds = new Set(batteries.map((battery) => battery.id));
    const selected = [...new Set(selectedIds)].filter((id) => knownIds.has(id));
    const baseIds = new Set(filterBatteries(batteries, { personalScope, lifecycle: "all" }, currentSydneyDate(), data.user.id).map((battery) => battery.id));
    const outsidePersonalScope = group
        ? selected.filter((id) => !group.batteryIds.includes(id))
        : personalScope === "all"
            ? []
            : selected.filter((id) => !baseIds.has(id));
    const selectionScopeChanged = outsidePersonalScope.length > 0;
    const validation = inventoryFilterSchema.safeParse(filters), asOfOn = currentSydneyDate();
    const groupMissing = !!filters.groupId &&
        !data.teachingGroups?.some((group) => group.id === filters.groupId &&
            group.ownerAccountId === data.user.id &&
            group.state === "active");
    const matching = validation.success && !groupMissing
        ? filterBatteries(batteries, validation.data, asOfOn, data.user.id, data.teachingGroups ?? [])
        : [];
    const allStatuses = validation.success && !groupMissing
        ? filterBatteries(batteries, { ...validation.data, status: "all" }, asOfOn, data.user.id, data.teachingGroups ?? [])
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
        setFilters((previous) => ({ ...previous, ...patch }));
        setPage(0);
    }
    function clearFilters() {
        setFilters({
            ...defaultInventoryFilter(),
            personalScope,
            ...(group ? { groupId: group.id, lifecycle: "all" } : {}),
        });
        setPage(0);
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
                filter: validation.data,
                page: currentPage,
                pageSize,
                matching: matching.length,
                pageCount: visible.length,
            });
    }
    return (_jsxs(_Fragment, { children: [personalScope !== "all" && (_jsxs("div", { className: "personal-inventory-scope", children: [_jsx("strong", { children: personalScope === "responsible"
                            ? "My batteries"
                            : "My batteries in use" }), _jsxs("span", { children: [personalScope === "responsible"
                                ? "Batteries assigned to your account as responsible owner, including those in use by other staff."
                                : "Batteries currently checked out to your account.", " ", "Filters and downloads apply within this view."] })] })), _jsx("div", { className: "summary-grid", children: [
                    [
                        personalScope === "responsible"
                            ? "My responsible batteries"
                            : personalScope === "borrowed"
                                ? "My batteries in use"
                                : "Registered batteries",
                        baseBatteries.length,
                        personalScope === "all"
                            ? "Across registered storage locations"
                            : "In this personal view",
                    ],
                    [
                        "In store",
                        baseBatteries.length - onLoan,
                        "No active loan recorded",
                    ],
                    ["In use", onLoan, "Linked to a current staff holder"],
                ].map(([label, count, note]) => (_jsxs("div", { className: "summary-card", children: [_jsx("span", { children: label }), _jsx("strong", { children: count }), _jsx("p", { children: note })] }, label))) }), _jsxs("section", { className: "inventory-panel", "aria-label": "Battery inventory records", children: [group && (_jsxs("div", { className: "group-bulk-actions", children: [_jsx("strong", { children: "Group operations" }), _jsx(Button, { variant: "outline", onClick: () => onMovement("checkout", group.batteryIds), disabled: !ready, children: "Check out group" }), _jsx(Button, { variant: "outline", onClick: () => onMovement("return", group.batteryIds), disabled: !ready, children: "Return group" }), _jsx(Button, { variant: "outline", onClick: () => {
                                    setSelected([...group.batteryIds]);
                                    setGroupNotice("All group members selected, including retired members. Review their current state before an operation.");
                                }, disabled: !ready, children: "Select all group members" }), _jsx(Button, { variant: "outline", onClick: () => setSelected(matching.map((b) => b.id)), disabled: !ready || !matching.length, children: "Select filtered group members" })] })), _jsxs("div", { className: "panel-top", children: [_jsxs("div", { className: "inventory-category-navigation", children: [_jsx(Tabs, { value: filters.status, onValueChange: (value) => updateFilters({ status: value }), children: _jsxs(TabsList, { variant: "line", children: [_jsxs(TabsTrigger, { value: "all", children: ["All batteries", " ", _jsx("span", { className: "tab-count", children: allStatuses.length })] }), _jsxs(TabsTrigger, { value: "in", children: ["In store ", _jsx("span", { className: "tab-count", children: matchingInStore })] }), _jsxs(TabsTrigger, { value: "out", children: ["In use ", _jsx("span", { className: "tab-count", children: matchingOnLoan })] })] }) }), !group && (_jsx(Button, { variant: "ghost", className: "inventory-teaching-groups-link", onClick: () => onOpenGroups ? onOpenGroups() : setGroupEditor({ ids: [] }), disabled: !ready, children: "Teaching groups" }))] }), _jsxs(Button, { variant: "outline", onClick: () => onEdit({ kind: "battery" }), disabled: !ready, children: [_jsx(Plus, {}), "Register battery"] })] }), _jsxs("div", { className: "table-toolbar inventory-filter-toolbar", children: [_jsxs(Button, { variant: "outline", onClick: () => setFilterOpen((open) => !open), "aria-expanded": filterOpen, "aria-controls": "inventory-filter-panel", children: [_jsx(Settings2, { size: 16 }), "Filter", chips.length ? ` (${chips.length})` : ""] }), _jsxs("span", { className: "toolbar-meta", children: [matching.length, " matching", " ", matching.length === 1 ? "battery" : "batteries"] }), _jsxs(Button, { variant: "ghost", onClick: exportInventory, disabled: !validation.success ||
                                    selectionScopeChanged ||
                                    (!matching.length && !selected.length), "aria-label": "Download inventory", children: [_jsx(Download, { size: 16 }), _jsx("span", { children: "Download" })] })] }), filterOpen && (_jsx(InventoryFilterPanel, { fixedGroup: !!group, data: data, filters: filters, asOfOn: asOfOn, onChange: updateFilters })), _jsx(AppliedFilters, { chips: chips, onRemove: updateFilters, onClear: clearFilters }), groupMissing && (_jsx("p", { className: "form-error", role: "alert", children: "This teaching group is no longer available. Clear the group filter or choose a current group. Your selected batteries are retained for review." })), groupNotice && (_jsx("p", { role: "status", className: "field-hint", children: groupNotice })), !!selected.length && (_jsxs("div", { className: "teaching-group-actions", children: [group && (_jsxs(_Fragment, { children: [onRemoval && (_jsx(Button, { variant: "outline", size: "sm", onClick: () => onRemoval(selected), disabled: !ready ||
                                            selected.some((id) => {
                                                const b = batteries.find((b) => b.id === id);
                                                return !isActiveBattery(b) || !!b.loanId;
                                            }), children: "Retire or remove selected" })), onGroupMaintenance && permissions.editBatteryRecords && (_jsx(Button, { variant: "outline", size: "sm", onClick: () => onGroupMaintenance(selected), disabled: !ready ||
                                            selected.some((id) => !isActiveBattery(batteries.find((b) => b.id === id))), children: "Update selected members" }))] })), _jsx(Button, { variant: "outline", size: "sm", onClick: () => setGroupEditor({ ids: [...selected] }), disabled: !ready || selected.length > 100 || selectionScopeChanged, children: "Save as teaching group" }), selected.length > 100 && (_jsx("span", { className: "field-hint", children: "Teaching groups support up to 100 batteries. Reduce the selection to save a group." }))] })), groupEditor && (_jsx(TeachingGroupsPanel, { data: data, initialIds: groupEditor.ids, addToExisting: !!groupEditor.ids.length, onClose: () => setGroupEditor(null), onChanged: onGroupsChanged, onFilter: (group) => {
                            updateFilters({ groupId: group.id });
                            setGroupNotice("");
                        }, onSelect: selectGroup })), !validation.success && (_jsx("p", { className: "form-error filter-error", role: "alert", children: validation.error.issues.map((issue) => issue.message).join(" ") })), !!selected.length && (_jsxs("div", { className: "selection-toolbar", children: [_jsxs("strong", { children: [selected.length, " selected", selected.some((id) => !matching.some((b) => b.id === id))
                                        ? ` · ${selected.filter((id) => !matching.some((b) => b.id === id)).length} outside current filters`
                                        : ""] }), _jsxs(Button, { variant: "outline", size: "sm", onClick: exportInventory, disabled: !validation.success || selectionScopeChanged, children: [_jsx(Download, { size: 16 }), "Download selected"] }), _jsx(Button, { variant: "outline", size: "sm", onClick: () => onMovement("checkout", selected), disabled: !ready ||
                                    selectionScopeChanged ||
                                    selected.length > 100 ||
                                    selected.some((id) => batteries.find((b) => b.id === id)?.loanId ||
                                        !isActiveBattery(batteries.find((b) => b.id === id))), children: "Check out selected" }), _jsx(Button, { variant: "outline", size: "sm", onClick: () => onMovement("return", selected), disabled: !ready ||
                                    selectionScopeChanged ||
                                    selected.length > 100 ||
                                    selected.some((id) => !batteries.find((b) => b.id === id)?.loanId ||
                                        !isActiveBattery(batteries.find((b) => b.id === id))), children: "Return selected" }), _jsx(Button, { variant: "ghost", size: "sm", onClick: () => setSelected([]), children: "Clear selection" })] })), selectionScopeChanged && (_jsxs("div", { className: "selection-scope-warning", role: "alert", children: [_jsx("strong", { children: "Your selected batteries have changed scope." }), _jsxs("p", { children: ["These batteries no longer belong to", " ", group
                                        ? "this teaching group"
                                        : personalScope === "responsible"
                                            ? "My batteries"
                                            : "My batteries in use", ":", " ", outsidePersonalScope.map((id, index) => (_jsxs("span", { children: [index > 0 ? ", " : "", _jsx("button", { className: "record-link", onClick: () => onDetail(id), children: id })] }, id))), ". Review their current details, then remove them from your selection before downloading or starting an operation."] }), _jsx(Button, { variant: "outline", size: "sm", onClick: () => setSelected(selected.filter((id) => !outsidePersonalScope.includes(id))), children: "Remove batteries outside this view" })] })), selected.length > 100 && (_jsx("p", { className: "field-hint", children: "Checkouts and returns support up to 100 batteries per batch. Reduce your selection before starting a movement. You can still download all selected batteries together." })), _jsxs(Table, { children: [_jsx(TableHeader, { children: _jsxs(TableRow, { children: [_jsx(TableHead, { className: "checkbox-cell", children: _jsx(Checkbox, { "aria-label": "Select all batteries on this page", checked: visible.length > 0 &&
                                                    visible.every((b) => selected.includes(b.id))
                                                    ? true
                                                    : visible.some((b) => selected.includes(b.id))
                                                        ? "indeterminate"
                                                        : false, disabled: !visible.length || !ready, onCheckedChange: (v) => selectAll(v === true) }) }), _jsx(TableHead, { children: "BATTERY" }), _jsx(TableHead, { children: "STATUS" }), _jsx(TableHead, { children: "RESPONSIBLE OWNER" }), _jsx(TableHead, { children: "CURRENT HOLDER" }), _jsx(TableHead, { children: "STORAGE LOCATION" }), _jsx(TableHead, { children: "LAST OBSERVED" }), group && permissions.editBatteryRecords && (_jsx(TableHead, { children: "ACTIONS" }))] }) }), _jsx(TableBody, { children: visible.map((b) => (_jsxs(TableRow, { className: "battery-selection-row", "data-selected": selected.includes(b.id), "data-selectable": ready, "aria-selected": selected.includes(b.id), onClick: (event) => selectBatteryRow(b.id, event), children: [_jsx(TableCell, { className: "checkbox-cell", children: _jsx(Checkbox, { "aria-label": `Select ${b.id}`, checked: selected.includes(b.id), disabled: !ready, onCheckedChange: (v) => changeBatterySelection(b.id, v === true) }) }), _jsx(TableCell, { children: _jsxs("div", { className: "battery-cell", children: [_jsx("span", { className: "battery-icon", children: _jsx(Battery, { size: 19 }) }), _jsxs("div", { children: [_jsx("button", { className: "record-link", onClick: () => onDetail(b.id), "aria-label": `View ${b.id}`, children: b.id }), _jsx("span", { children: b.name }), _jsxs("small", { children: [b.chemistry || "Chemistry not recorded", b.capacityMah != null
                                                                        ? ` · ${b.capacityMah.toLocaleString()} mAh`
                                                                        : "", b.voltage != null ? ` · ${b.voltage} V` : ""] }), _jsxs("small", { children: ["Age since manufacture:", " ", formatBatteryAge(b.manufacturedOn)] })] })] }) }), _jsx(TableCell, { children: _jsx("span", { className: `status-badge ${!isActiveBattery(b) ? "retired" : b.loanId ? "out" : "in"}`, children: batteryStatusLabel(b) }) }), _jsx(TableCell, { children: b.ownerName }), _jsx(TableCell, { children: b.borrowerName || _jsx("span", { className: "muted", children: "\u2014" }) }), _jsxs(TableCell, { children: [_jsx("strong", { children: b.homeBuildingId
                                                        ? buildingLabel({
                                                            id: b.homeBuildingId,
                                                            name: b.homeBuildingName,
                                                        })
                                                        : "Building not assigned" }), _jsx("span", { className: "cell-secondary", children: storageRoomLabel(b) })] }), _jsx(TableCell, { children: b.observedAt ? (_jsxs(_Fragment, { children: [_jsx("strong", { children: b.observedRoom }), b.observedBuilding && (_jsx("span", { className: "cell-secondary", children: b.observedBuilding })), _jsx("span", { className: "cell-secondary", children: formatTime(b.observedAt) }), _jsx("span", { className: "cell-secondary", children: b.observationSource })] })) : (_jsx("span", { className: "muted", children: "Not yet observed" })) }), group && permissions.editBatteryRecords && (_jsx(TableCell, { children: _jsx(Button, { variant: "ghost", size: "sm", onClick: () => onEdit({ kind: "battery", record: b }), disabled: !ready || !isActiveBattery(b), children: "Edit battery" }) }))] }, b.id))) })] }), !matching.length && (_jsxs("div", { className: "empty-state", children: [_jsx(Package, {}), _jsx("h3", { children: !validation.success
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
                                            setPageSize(value);
                                            setPage(0);
                                        }, children: [_jsx(SelectTrigger, { "aria-label": "Batteries per page", children: _jsx(SelectValue, {}) }), _jsx(SelectContent, { children: ["10", "25", "50", "100"].map((size) => (_jsxs(SelectItem, { value: size, children: [size, " per page"] }, size))) })] }), _jsx(Button, { variant: "outline", size: "sm", onClick: () => setPage(currentPage - 1), disabled: !currentPage, children: "Previous" }), _jsxs("span", { children: ["Page ", currentPage + 1, " of ", pageCount] }), _jsx(Button, { variant: "outline", size: "sm", onClick: () => setPage(currentPage + 1), disabled: currentPage >= pageCount - 1, children: "Next" })] })] }), _jsxs("div", { className: "panel-footer", children: [_jsx("span", { children: "Storage building and room are the registered home. Last observed location is separate, dated evidence." }), _jsxs("span", { children: [baseBatteries.length, " ", baseBatteries.length === 1 ? "battery" : "batteries", " in this view"] })] })] })] }));
}
