"use client";
import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { isActiveBattery } from "../../lib/battery-lifecycle.js";
import { useState } from "react";
import { Plus, Download, Upload, Pencil, Settings2, Copy } from "lucide-react";
import { Button } from "../ui/button.js";
import { Input } from "../ui/input.js";
import { Tabs, TabsList, TabsTrigger } from "../ui/tabs.js";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell, } from "../ui/table.js";
import { formatBatteryAge, roomLabel, storageRoomLabel, downloadExportAttachment, } from "../../lib/client-utils.js";
import { isSupportedBuilding, isSelectableRoom } from "../../lib/location-catalog.js";
import { getRolePermissions } from "../../lib/permissions.js";
import { defaultInventoryFilter } from "../../lib/inventory-query.js";
import { getFilteredBatteries } from "../../lib/battery-selection-query.js";
import { BatteryFilterControls } from "./battery-filter-controls.js";
async function downloadRecordList(dataset, search, kind, filter) {
    await downloadExportAttachment({ dataset, mode: "records", search, kind, ...(kind === "batteries" ? { filter } : {}) }, "xlsx", `battery-${kind}-${dataset}.xlsx`);
}
export function RecordManagement({ data, ready, onEdit, onDetail, onImport, }) {
    const [kind, setKind] = useState("people");
    const [query, setQuery] = useState(""), [downloadError, setDownloadError] = useState("");
    const [batteryFilters, setBatteryFilters] = useState(() => ({ ...defaultInventoryFilter(), lifecycle: "all" }));
    const filteredBatteries = getFilteredBatteries(data, batteryFilters);
    const [copyingOwnerId, setCopyingOwnerId] = useState(""), [copiedOwnerId, setCopiedOwnerId] = useState(""), [copyError, setCopyError] = useState("");
    const permissions = getRolePermissions(data.user.role);
    const canRegister = kind === "batteries"
        ? permissions.registerBatteries
        : kind !== "people" && permissions.manageDirectories;
    const records = kind === "batteries" ? filteredBatteries.batteries : (kind === "people"
        ? data.people.filter((person) => person.role === "staff" && person.accountId)
        : kind === "buildings"
            ? data.buildings
            : kind === "rooms"
                ? data.rooms
                : data.batteries).filter((record) => Object.values(record).join(" ").toLowerCase().includes(query.toLowerCase()));
    const people = data.people.filter((person) => records.some((record) => record.id === person.id));
    const buildings = data.buildings.filter((building) => records.some((record) => record.id === building.id));
    const rooms = data.rooms.filter((room) => records.some((record) => record.id === room.id));
    const batteries = filteredBatteries.batteries;
    const editorKind = kind === "people"
        ? "person"
        : kind === "buildings"
            ? "building"
            : kind === "rooms"
                ? "room"
                : "battery";
    async function copyOwnerId(id) {
        setCopyError("");
        setCopiedOwnerId("");
        const person = data.people.find((record) => record.id === id), account = data.staffDirectory.find((record) => record.id === person?.accountId);
        if (!account?.active) {
            setCopyError("This owner ID is unavailable for new batteries because its account is inactive or unavailable.");
            return;
        }
        setCopyingOwnerId(id);
        try {
            if (!navigator.clipboard?.writeText)
                throw new Error("Clipboard unavailable");
            await navigator.clipboard.writeText(id);
            setCopiedOwnerId(id);
        }
        catch {
            setCopyError("Could not copy this owner ID. Select the ID below and copy it manually.");
        }
        finally {
            setCopyingOwnerId("");
        }
    }
    return (_jsxs("section", { className: "inventory-panel", children: [_jsxs("div", { className: "panel-top", children: [_jsx(Tabs, { value: kind, onValueChange: (v) => setKind(v), children: _jsxs(TabsList, { variant: "line", children: [_jsx(TabsTrigger, { value: "people", children: "Staff directory" }), _jsx(TabsTrigger, { value: "buildings", children: "Buildings" }), _jsx(TabsTrigger, { value: "rooms", children: "Rooms" }), _jsx(TabsTrigger, { value: "batteries", children: "Batteries" })] }) }), _jsx("div", { className: "panel-actions", children: canRegister && (_jsxs(_Fragment, { children: [_jsxs(Button, { variant: "outline", onClick: () => onImport(kind), disabled: !ready, children: [_jsx(Upload, {}), "Import CSV"] }), _jsxs(Button, { onClick: () => onEdit({ kind: editorKind }), disabled: !ready, children: [_jsx(Plus, {}), "Register ", editorKind] })] })) })] }), _jsx("p", { className: "field-hint px-5 pb-3", children: kind === "people"
                    ? "Browse the shared staff directory and copy owner IDs for battery imports. An administrator manages account access in Staff accounts."
                    : kind === "batteries"
                        ? permissions.editBatteryRecords
                            ? "Register batteries, review shared records and edit active battery details."
                            : "View and download the shared register, or register new batteries. An administrator manages saved battery details."
                        : permissions.manageDirectories
                            ? "Maintain the shared building and room directory used for registered storage."
                            : "View and download shared locations. An administrator manages building and room records." }), kind === "batteries" && _jsx(BatteryFilterControls, { data: data, filters: batteryFilters, onChange: patch => setBatteryFilters(previous => ({ ...previous, ...patch })), onClear: () => setBatteryFilters({ ...defaultInventoryFilter(), lifecycle: "all" }), defaultLifecycle: "all", scopeNote: "Filter the complete battery directory, including retired records. Downloads use the same filters and sort order." }), kind === "batteries" && filteredBatteries.error && _jsx("p", { className: "form-error", role: "alert", children: filteredBatteries.error }), _jsxs("div", { className: "table-toolbar", children: [kind !== "batteries" && _jsxs(_Fragment, { children: [_jsx(Input, { "aria-label": "Search directory records", placeholder: "Search these records\u2026", value: query, onChange: (event) => setQuery(event.target.value) }), _jsx(Button, { variant: "ghost", onClick: () => setQuery(""), disabled: !query, children: "Clear filters" })] }), _jsxs(Button, { variant: "outline", disabled: !records.length, onClick: () => downloadRecordList(data.dataset, kind === "batteries" ? "" : query, kind, batteryFilters).catch((error) => setDownloadError(error.message)), children: [_jsx(Download, { size: 16 }), "Download filtered list"] }), _jsxs("span", { children: [records.length, " records"] })] }), downloadError && (_jsx("p", { className: "form-error", role: "alert", children: downloadError })), kind === "people" && (_jsxs(_Fragment, { children: [copyError && (_jsx("p", { className: "form-error", role: "alert", children: copyError })), copiedOwnerId && (_jsxs("p", { className: "field-hint", role: "status", children: ["Owner ID copied: ", copiedOwnerId] }))] })), kind === "people" ? (_jsxs(Table, { children: [_jsx(TableHeader, { children: _jsxs(TableRow, { children: [_jsx(TableHead, { children: "STAFF MEMBER" }), _jsx(TableHead, { children: "REFERENCE" }), _jsx(TableHead, { children: "OWNER ID (CSV)" }), _jsx(TableHead, { children: "ACCOUNT" })] }) }), _jsx(TableBody, { children: people.map((person) => {
                            const account = data.staffDirectory.find((record) => record.id === person.accountId);
                            return (_jsxs(TableRow, { children: [_jsx(TableCell, { children: _jsx("strong", { children: person.name }) }), _jsx(TableCell, { children: person.reference || "Not recorded" }), _jsxs(TableCell, { children: [_jsx("code", { className: "select-all break-all text-xs" +
                                                    (account?.active ? "" : " muted"), children: person.id }), _jsx("div", { children: _jsxs(Button, { variant: "ghost", size: "sm", onClick: () => copyOwnerId(person.id), disabled: !account?.active || !!copyingOwnerId, "aria-label": "Copy owner ID for " +
                                                        (account?.username ?? person.name), children: [_jsx(Copy, { size: 14 }), copyingOwnerId === person.id
                                                            ? "Copying…"
                                                            : "Copy owner ID"] }) }), !account?.active && (_jsx("span", { className: "cell-secondary", children: "Unavailable for new batteries" }))] }), _jsxs(TableCell, { children: [_jsx("strong", { children: account?.username || "Account unavailable" }), _jsx("span", { className: "cell-secondary", children: account
                                                    ? account.active
                                                        ? "Active"
                                                        : "Inactive"
                                                    : "Account unavailable" }), person.accountId === data.user.id && (_jsx("span", { className: "cell-secondary", children: "Your account" }))] })] }, person.id));
                        }) })] })) : kind === "buildings" ? (_jsxs(Table, { children: [_jsx(TableHeader, { children: _jsxs(TableRow, { children: [_jsx(TableHead, { children: "BUILDING CODE" }), _jsx(TableHead, { children: "NAME" }), _jsx(TableHead, { children: "ROOM INFORMATION" }), permissions.manageDirectories && _jsx(TableHead, { children: "ACTIONS" })] }) }), _jsx(TableBody, { children: buildings.map((building) => (_jsxs(TableRow, { className: !isSupportedBuilding(building.id)
                                ? "unsupported-location-row"
                                : undefined, children: [_jsx(TableCell, { children: _jsx("strong", { children: building.id }) }), _jsxs(TableCell, { children: [building.name, _jsx("span", { className: "cell-secondary", children: isSupportedBuilding(building.id)
                                                ? "Currently supported"
                                                : "Not available for selection" })] }), _jsx(TableCell, { children: isSupportedBuilding(building.id)
                                        ? "Placeholder rooms awaiting confirmation"
                                        : "Not available" }), permissions.manageDirectories && (_jsx(TableCell, { children: _jsxs(Button, { variant: "ghost", size: "sm", onClick: () => onEdit({ kind: "building", record: building }), disabled: !ready || !isSupportedBuilding(building.id), "aria-label": `Edit ${building.id}`, children: [_jsx(Pencil, {}), "Edit"] }) }))] }, building.id))) })] })) : kind === "rooms" ? (_jsxs(Table, { children: [_jsx(TableHeader, { children: _jsxs(TableRow, { children: [_jsx(TableHead, { children: "ROOM" }), _jsx(TableHead, { children: "BUILDING" }), _jsx(TableHead, { children: "STATUS" }), permissions.manageDirectories && _jsx(TableHead, { children: "ACTIONS" })] }) }), _jsx(TableBody, { children: rooms.map((room) => (_jsxs(TableRow, { className: !isSelectableRoom(room)
                                ? "unsupported-location-row"
                                : undefined, children: [_jsx(TableCell, { children: _jsx("strong", { children: isSupportedBuilding(room.buildingId)
                                            ? roomLabel(room)
                                            : "Not available" }) }), _jsx(TableCell, { children: room.buildingId ? room.building : "Building not assigned" }), _jsx(TableCell, { children: !isSelectableRoom(room)
                                        ? "Not available for selection"
                                        : room.isPlaceholder
                                            ? "Placeholder · awaiting confirmation"
                                            : "Confirmed room" }), permissions.manageDirectories && (_jsx(TableCell, { children: _jsxs(Button, { variant: "ghost", size: "sm", onClick: () => onEdit({ kind: "room", record: room }), disabled: !ready || !isSelectableRoom(room), "aria-label": `Edit ${room.name}`, children: [_jsx(Pencil, {}), "Edit"] }) }))] }, room.id))) })] })) : (_jsxs(Table, { children: [_jsx(TableHeader, { children: _jsxs(TableRow, { children: [_jsx(TableHead, { children: "BATTERY" }), _jsx(TableHead, { children: "RFID IDENTIFIER" }), _jsx(TableHead, { children: "OWNER / STORAGE LOCATION" }), permissions.editBatteryRecords && _jsx(TableHead, { children: "ACTIONS" })] }) }), _jsx(TableBody, { children: batteries.map((b) => (_jsxs(TableRow, { children: [_jsxs(TableCell, { children: [_jsx("button", { className: "record-link", onClick: () => onDetail(b.id), children: b.id }), _jsx("span", { className: "cell-secondary", children: b.name }), _jsxs("span", { className: "cell-secondary", children: ["Age since manufacture: ", formatBatteryAge(b.manufacturedOn)] })] }), _jsx(TableCell, { children: b.tagId || "Not assigned" }), _jsxs(TableCell, { children: [b.ownerName, _jsxs("span", { className: "cell-secondary", children: [b.homeBuildingId || "Building not assigned", " /", " ", storageRoomLabel(b)] })] }), permissions.editBatteryRecords && (_jsx(TableCell, { children: _jsxs(Button, { variant: "ghost", size: "sm", onClick: () => onEdit({ kind: "battery", record: b }), disabled: !ready || !isActiveBattery(b), "aria-label": `Edit ${b.id}`, children: [_jsx(Pencil, {}), "Edit"] }) }))] }, b.id))) })] })), !records.length && (_jsxs("div", { className: "empty-state", children: [_jsx(Settings2, {}), _jsxs("h3", { children: ["No matching ", kind === "people" ? "staff members" : kind] }), _jsx("p", { children: kind === "people"
                            ? "Staff directory entries come from staff accounts. An administrator manages these through Staff accounts."
                            : canRegister
                                ? "Use the registration form or review a CSV import."
                                : "Ask an administrator to register these records." })] })), _jsx("div", { className: "panel-footer", children: _jsx("span", { children: kind === "buildings" || kind === "rooms"
                        ? "J18 is currently supported. Placeholder rooms await confirmation; a battery's room can remain unspecified."
                        : kind === "people"
                            ? "Use an active Owner ID (CSV) as owner_id when importing batteries. In the Excel staff directory, use the Owner ID for imports column; Evidence people retains the original id field. Administrators manage staff identities through Staff accounts."
                            : "Responsible owners and current holders are distinct staff accounts." }) })] }));
}
