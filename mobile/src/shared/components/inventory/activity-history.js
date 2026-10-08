"use client";
import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import { Download, ClipboardList, LogIn, LogOut } from "lucide-react";
import { Button } from "../ui/button.js";
import { Input } from "../ui/input.js";
import { Checkbox } from "../ui/checkbox.js";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem, } from "../ui/select.js";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell, } from "../ui/table.js";
import { Skeleton } from "../ui/skeleton.js";
import { actionNames, formatTime, durationLabel, reloadSessionPage, } from "../../lib/client-utils.js";
import { groupActivity, filterActivity, hasActivityBatteryCriteria } from "../../lib/group-activity.js";
import { defaultInventoryFilter } from "../../lib/inventory-query.js";
import { getFilteredBatteries } from "../../lib/battery-selection-query.js";
import { shouldToggleSelection } from "../../lib/client/row-selection.js";
import { BatteryFilterControls } from "./battery-filter-controls.js";
import { ActivityExportDialog } from "./activity-export-dialog.js";
import { batteryStatusLabel, isActiveBattery } from "../../lib/battery-lifecycle.js";
import { getRolePermissions } from "../../lib/permissions.js";
export function ActivityHistory({ data, onDetail, scope = "all", revision = 0, groupId = null, onGroupFilterChange, onDialogChange, ready = true, onMovement, }) {
    const context = `${data.dataset}-${scope}-${data.user.id}`;
    const [history, setHistory] = useState(null), [query, setQuery] = useState(""), [page, setPage] = useState(0), [retry, setRetry] = useState(0);
    const [downloadOpen, setDownloadOpen] = useState(false), [selected, setSelected] = useState([]);
    const [batteryFilter, setBatteryFilter] = useState(() => ({ ...defaultInventoryFilter(), lifecycle: "all" }));
    const batteryCriteriaActive = hasActivityBatteryCriteria(batteryFilter);
    const batteryResult = getFilteredBatteries(data, batteryFilter);
    function clearFilters() {
        setBatteryFilter({ ...defaultInventoryFilter(), lifecycle: "all" });
        setQuery("");
        onGroupFilterChange?.(null);
        setPage(0);
    }
    useEffect(() => {
        onDialogChange?.(downloadOpen);
        return () => onDialogChange?.(false);
    }, [downloadOpen, onDialogChange]);
    useEffect(() => {
        const abort = new AbortController();
        let active = true;
        const result = { context, sourceEvents: data.events, revision, retry };
        fetch(`/api/inventory?${new URLSearchParams({ dataset: data.dataset, activity: "all", activityScope: scope })}`, { signal: abort.signal, cache: "no-store" })
            .then(async (response) => {
            if (response.status === 401)
                reloadSessionPage("/signin");
            const body = (await response.json());
            if (!response.ok)
                throw new Error(body.error || "The complete activity history could not be loaded.");
            if (!Array.isArray(body.events))
                throw new Error("The activity response was incomplete. Retry the history request.");
            if (active && !abort.signal.aborted)
                setHistory({ ...result, events: body.events, error: "" });
        })
            .catch((error) => {
            if (active && !abort.signal.aborted)
                setHistory({
                    ...result,
                    events: [],
                    error: error.message ||
                        "The activity history could not be loaded.",
                });
        });
        return () => {
            active = false;
            abort.abort();
        };
    }, [context, data.dataset, data.events, revision, retry, scope]);
    const current = history?.context === context &&
        history.sourceEvents === data.events &&
        history.revision === revision &&
        history.retry === retry;
    const loading = !current, error = current ? history.error : "", events = current && !error ? history.events : [];
    const entries = groupActivity(events), matching = batteryResult.error ? [] : filterActivity(entries, query, groupId, batteryCriteriaActive ? new Set(batteryResult.batteries.map(battery => battery.id)) : null), maxPage = Math.max(0, Math.ceil(matching.length / 25) - 1), currentPage = Math.min(page, maxPage);
    const visible = matching.slice(currentPage * 25, (currentPage + 1) * 25);
    const groupChoices = [
        ...new Map(entries.flatMap((entry) => entry.teachingGroup
            ? [[entry.teachingGroup.id, entry.teachingGroup.name]]
            : [])).entries(),
    ];
    const chosen = selected.filter((id) => entries.some((entry) => entry.id === id));
    const countLabel = `${matching.length} matching ${matching.length === 1 ? "operation" : "operations"}`;
    const showBatteryActions = scope === "mine";
    const canMove = getRolePermissions(data.user.role).operateLoans && !!onMovement;
    const batteriesById = new Map(data.batteries.map((battery) => [battery.id, battery]));
    function batteryControls(batteryId) {
        const battery = batteriesById.get(batteryId);
        if (!battery || !ready)
            return _jsx("span", { className: "cell-secondary", children: "Current status unavailable" });
        const active = isActiveBattery(battery);
        return (_jsxs("div", { className: "flex flex-wrap items-center gap-2", "aria-label": `Current status and actions for ${batteryId}`, children: [_jsx("span", { className: `status-badge ${!active ? "retired" : battery.loanId ? "out" : "in"}`, children: batteryStatusLabel(battery) }), active && canMove ? (_jsxs(Button, { variant: "outline", size: "sm", disabled: loading || !!error, "aria-label": `${battery.loanId ? "Check in" : "Check out"} ${batteryId}`, onClick: () => {
                        if (ready && !loading && !error && canMove)
                            onMovement?.(battery.loanId ? "return" : "checkout", [batteryId]);
                    }, children: [battery.loanId ? _jsx(LogIn, { size: 15 }) : _jsx(LogOut, { size: 15 }), battery.loanId ? "Check in" : "Check out"] })) : !active ? (_jsx("span", { className: "cell-secondary", children: "Retired asset \u00B7 History retained" })) : null] }));
    }
    function toggle(id, checked) {
        if (!ready || loading || error)
            return;
        setSelected((previous) => checked
            ? [...new Set([...previous, id])]
            : previous.filter((value) => value !== id));
    }
    return (_jsxs("section", { className: "inventory-panel", "aria-label": scope === "mine" ? "My activity records" : "Shared activity records", "aria-busy": loading, children: [_jsxs("div", { className: "section-heading", children: [_jsxs("div", { children: [_jsx("h2", { children: scope === "mine" ? "My recorded activity" : "Recorded activity" }), _jsx("p", { className: "field-hint", children: scope === "mine"
                                    ? "Your recorded operations. Battery status shows the current register; check-in and check-out open a review before saving."
                                    : "Recorded inventory operations across all staff accounts." })] }), _jsx("span", { className: "toolbar-meta", children: loading
                            ? "Loading complete history…"
                            : error
                                ? "History unavailable"
                                : `${countLabel} · Sydney time` })] }), _jsxs("div", { className: "table-toolbar", children: [_jsx(Input, { "aria-label": "Search activity", placeholder: "Search group, battery, operator or action\u2026", value: query, onChange: (event) => {
                            setQuery(event.target.value);
                            setPage(0);
                        } }), onGroupFilterChange && (_jsxs(Select, { value: groupId ?? "__all", onValueChange: (id) => {
                            onGroupFilterChange(id === "__all" ? null : id);
                            setPage(0);
                        }, children: [_jsx(SelectTrigger, { "aria-label": "Activity teaching group", children: _jsx(SelectValue, {}) }), _jsxs(SelectContent, { children: [_jsx(SelectItem, { value: "__all", children: "All recorded operations" }), groupChoices.map(([id, name]) => (_jsx(SelectItem, { value: id, children: name }, id))), groupId && !groupChoices.some(([id]) => id === groupId) && (_jsx(SelectItem, { value: groupId, disabled: true, children: "Group has no recorded activity" }))] })] })), _jsx(Button, { variant: "ghost", onClick: clearFilters, disabled: !query && !groupId && !batteryCriteriaActive, children: "Clear filters" }), _jsxs(Button, { variant: "outline", disabled: loading || !!error || (!!batteryResult.error && !chosen.length) || (!matching.length && !chosen.length), onClick: () => setDownloadOpen(true), children: [_jsx(Download, { size: 16 }), "Download filtered history"] })] }), _jsxs("div", { className: "px-5 pb-4", children: [_jsx(BatteryFilterControls, { data: data, filters: batteryFilter, onChange: (patch) => { setBatteryFilter(previous => ({ ...previous, ...patch })); setPage(0); }, onClear: clearFilters, disabled: !ready, showSort: false, defaultLifecycle: "all", scopeNote: "Battery filters use the current register, including current status, owner, age and latest checkout. Activity search and recorded teaching group refer to historical operations. When any battery in a group matches, the whole recorded operation stays visible." }), batteryResult.error && _jsx("p", { className: "form-error", role: "alert", children: batteryResult.error })] }), (query || groupId) && (_jsxs("p", { className: "field-hint", children: ["Applied filters: ", query && `Search: ${query}`, query && groupId && " · ", groupId &&
                        `Recorded teaching group: ${groupChoices.find(([id]) => id === groupId)?.[1] ?? "Recorded group"}`] })), !!chosen.length && (_jsxs("div", { className: "selection-toolbar", children: [_jsxs("strong", { children: [chosen.length, " operations selected"] }), _jsx(Button, { variant: "outline", onClick: () => setDownloadOpen(true), children: "Download selected activity" }), _jsx(Button, { variant: "ghost", onClick: () => setSelected([]), children: "Clear selection" })] })), loading ? (_jsxs("div", { className: "loading-panel", role: "status", children: [_jsxs("p", { children: ["Loading the complete", " ", scope === "mine"
                                ? "history of your inventory operations"
                                : "inventory activity history", "\u2026"] }), _jsx(Skeleton, { className: "h-10 w-full" }), _jsx(Skeleton, { className: "h-24 w-full" })] })) : error ? (_jsxs("div", { className: "load-error", role: "alert", children: [_jsx("span", { children: error }), _jsx(Button, { variant: "outline", onClick: () => setRetry((value) => value + 1), children: "Retry history" })] })) : (_jsxs(_Fragment, { children: [_jsxs(Table, { children: [_jsx(TableHeader, { children: _jsxs(TableRow, { children: [_jsx(TableHead, { children: _jsx(Checkbox, { "aria-label": "Select activity on this page", checked: visible.length > 0 &&
                                                    visible.every((event) => chosen.includes(event.id))
                                                    ? true
                                                    : visible.some((event) => chosen.includes(event.id))
                                                        ? "indeterminate"
                                                        : false, disabled: !ready || !visible.length, onCheckedChange: (value) => {
                                                    if (!ready || loading || error)
                                                        return;
                                                    setSelected((previous) => value === true
                                                        ? [
                                                            ...new Set([
                                                                ...previous,
                                                                ...visible.map((event) => event.id),
                                                            ]),
                                                        ]
                                                        : previous.filter((id) => !visible.some((event) => event.id === id)));
                                                } }) }), _jsx(TableHead, { children: "ACTION / DETAILS" }), _jsx(TableHead, { children: "BATTERY / TEACHING GROUP" }), showBatteryActions && _jsx(TableHead, { children: "CURRENT STATUS / ACTION" }), _jsx(TableHead, { children: "OPERATOR" }), _jsx(TableHead, { children: "RECORDED AT" })] }) }), _jsx(TableBody, { children: visible.map((event) => (_jsxs(TableRow, { className: "battery-selection-row", "data-selected": chosen.includes(event.id), "data-selectable": ready, "aria-selected": chosen.includes(event.id), onClick: (click) => {
                                        if (shouldToggleSelection(click))
                                            toggle(event.id, !chosen.includes(event.id));
                                    }, children: [_jsx(TableCell, { children: _jsx(Checkbox, { "aria-label": `Select activity ${event.id}`, checked: chosen.includes(event.id), disabled: !ready, onCheckedChange: (value) => toggle(event.id, value === true) }) }), _jsxs(TableCell, { children: [_jsx("strong", { children: actionNames[event.action] ?? event.action }), event.teachingGroup ? (_jsxs("details", { className: "group-activity-details", children: [_jsxs("summary", { children: ["View ", event.members.length, " recorded battery actions"] }), _jsxs("p", { className: "field-hint", children: [event.teachingGroup.name, " \u00B7 Group version", " ", event.teachingGroup.version, " at operation time"] }), event.members.map((member) => (_jsxs("article", { className: "history-entry", children: [_jsx("button", { className: "record-link", onClick: () => onDetail(member.batteryId), children: member.batteryId }), _jsx(EventDescription, { event: member }), showBatteryActions && member.batteryId && (_jsxs("div", { className: "my-2", children: [_jsx("p", { className: "field-hint mb-1", children: "Current battery status" }), batteryControls(member.batteryId)] })), _jsxs("p", { className: "field-hint", children: [member.actorName, " \u00B7 ", formatTime(member.at)] }), _jsxs("details", { children: [_jsx("summary", { children: "Recorded evidence" }), _jsx("pre", { className: "group-evidence", children: JSON.stringify(member.details, null, 2) })] })] }, member.id)))] })) : (_jsx(EventDescription, { event: event }))] }), _jsx(TableCell, { children: event.teachingGroup ? (_jsxs(_Fragment, { children: [_jsx("strong", { children: event.teachingGroup.name }), _jsxs("span", { className: "cell-secondary", children: [event.members.length, " batteries in this operation"] })] })) : event.batteryId ? (_jsx("button", { className: "record-link", onClick: () => onDetail(event.batteryId), children: event.batteryId })) : ("—") }), showBatteryActions && (_jsx(TableCell, { children: event.teachingGroup ? (_jsx("span", { className: "cell-secondary", children: "Expand recorded battery actions to view each battery's current status and check in or out." })) : event.batteryId ? batteryControls(event.batteryId) : "—" })), _jsx(TableCell, { children: event.actorName }), _jsx(TableCell, { children: formatTime(event.at) })] }, event.id))) })] }), !matching.length && (_jsxs("div", { className: "empty-state", children: [_jsx(ClipboardList, {}), _jsx("h3", { children: events.length
                                    ? "No matching activity"
                                    : scope === "mine"
                                        ? "You have no recorded activity yet"
                                        : "No recorded activity" }), _jsx("p", { children: events.length
                                    ? "Try another search or clear filters."
                                    : "Confirmed inventory operations will appear here." })] })), _jsxs("div", { className: "pagination-bar", children: [_jsx("span", { children: countLabel }), _jsxs("div", { children: [_jsx(Button, { variant: "outline", size: "sm", disabled: !currentPage, onClick: () => setPage(currentPage - 1), children: "Previous" }), _jsxs("span", { children: ["Page ", currentPage + 1, " of ", maxPage + 1] }), _jsx(Button, { variant: "outline", size: "sm", disabled: currentPage >= maxPage, onClick: () => setPage(currentPage + 1), children: "Next" })] })] })] })), downloadOpen && (_jsx(ActivityExportDialog, { dataset: data.dataset, scope: scope, search: query, groupId: groupId, batteryFilter: batteryFilter, selectedIds: chosen, count: matching.length, onClose: () => setDownloadOpen(false) })), _jsxs("div", { className: "panel-footer", children: ["Search and download include the complete stored", " ", scope === "mine"
                        ? "history of your recorded inventory operations"
                        : "inventory activity history", ". Corrections retain the original action.", showBatteryActions && " Current status is separate from the recorded event. Check out is to your own account; check in can return another staff member's loan."] })] }));
}
function EventDescription({ event }) {
    const d = event.details, after = d.after;
    const text = typeof d.reason === "string"
        ? `Reason: ${d.reason}`
        : typeof d.borrower === "string"
            ? `Borrower: ${d.borrower}`
            : event.action === "records_imported"
                ? `${d.count} ${d.kind} imported`
                : typeof d.room === "string"
                    ? `${d.room} · ${d.source}`
                    : event.action === "charge_recorded"
                        ? `Completed ${formatTime(String(d.completedAt))} · ${durationLabel(typeof d.durationMinutes === "number" ? d.durationMinutes : null)}`
                        : after?.name
                            ? `${after.name} · ${after.id}`
                            : typeof d.note === "string"
                                ? d.note
                                : "";
    return text ? _jsx("span", { className: "cell-secondary", children: text }) : null;
}
