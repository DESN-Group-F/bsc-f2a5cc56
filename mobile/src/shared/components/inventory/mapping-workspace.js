"use client";
import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useId, useLayoutEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Building2, Check, ChevronDown, DoorOpen, Info, Layers2, Map as MapIcon, Maximize, Settings2, SlidersHorizontal, X } from "lucide-react";
import { Button } from "../ui/button.js";
import { MotionDisclosure } from "../ui/workspace-motion.js";
import { isActiveBattery } from "../../lib/battery-lifecycle.js";
import { formatTime } from "../../lib/client-utils.js";
import { REFERENCE_BUILDINGS, SUPPORTED_BUILDING_ID } from "../../lib/location-catalog.js";
import { getMappingRooms, mappingBucket, UNKNOWN_MAPPING_ROOM } from "../../lib/inventory-mapping.js";
import { InventoryTable } from "./inventory-table.js";
import { MappingRoomDrawing } from "./mapping-room-drawing.js";
import styles from "./mapping-workspace.module.css";
const OVERVIEW = "__overview";
function recordedTime(battery) {
    const time = battery.observedAt ? Date.parse(battery.observedAt) : NaN;
    return Number.isFinite(time) ? time : -Infinity;
}
export function MappingWorkspace({ data, ready, active = true, overlayOpen = false, onMovement, onScan, onEdit, onDetail, onSetup, onExport, onGroupsChanged, onGroupDialogChange, onOpenGroups, onRemoval, onLocationTools, }) {
    const prefix = useId();
    const [filterOpen, setFilterOpen] = useState(false);
    const [selectedId, setSelectedId] = useState(null);
    const [openRooms, setOpenRooms] = useState([]);
    const [activeTab, setActiveTab] = useState(OVERVIEW);
    const tabs = useRef(new Map());
    const roomButtons = useRef(new Map());
    const focusTab = useRef(null);
    const filterButton = useRef(null);
    const rooms = getMappingRooms(data.rooms);
    const activeBatteries = data.batteries.filter(isActiveBattery);
    const buckets = new Map(rooms.map(room => [room.id, []]));
    buckets.set(UNKNOWN_MAPPING_ROOM, []);
    for (const battery of activeBatteries)
        (buckets.get(mappingBucket(battery, data.rooms)) ?? buckets.get(UNKNOWN_MAPPING_ROOM)).push(battery);
    const summaries = [
        ...rooms.map(room => ({ id: room.id, label: room.name, placeholder: room.isPlaceholder, unknown: false, batteries: buckets.get(room.id) ?? [] })),
        { id: UNKNOWN_MAPPING_ROOM, label: "Unknown", placeholder: false, unknown: true, batteries: buckets.get(UNKNOWN_MAPPING_ROOM) ?? [] },
    ];
    const selected = summaries.find(room => room.id === selectedId);
    const selectedPreview = selected ? [...selected.batteries].sort((left, right) => recordedTime(right) - recordedTime(left) || left.id.localeCompare(right.id, "en", { numeric: true })).slice(0, 3) : [];
    const selectedInUse = selected?.batteries.filter(battery => battery.loanId).length ?? 0;
    const filterId = `${prefix}-building-filter`;
    const tabId = (id) => `${prefix}-tab-${encodeURIComponent(id)}`;
    const panelId = (id) => `${prefix}-panel-${encodeURIComponent(id)}`;
    useLayoutEffect(() => {
        if (focusTab.current) {
            tabs.current.get(focusTab.current)?.focus({ preventScroll: true });
            focusTab.current = null;
        }
    }, [activeTab, openRooms]);
    function activateTab(id) {
        if (overlayOpen)
            return;
        focusTab.current = id;
        setActiveTab(id);
        // Re-selecting the active tab does not produce another render.
        if (activeTab === id) {
            tabs.current.get(id)?.focus({ preventScroll: true });
            focusTab.current = null;
        }
    }
    function openDetails() {
        if (!selected || overlayOpen)
            return;
        if (!openRooms.some(room => room.id === selected.id)) {
            setOpenRooms(previous => [...previous, { id: selected.id, label: selected.label }]);
        }
        activateTab(selected.id);
    }
    function closeRoom(id) {
        if (overlayOpen)
            return;
        const index = openRooms.findIndex(room => room.id === id);
        if (index < 0)
            return;
        const remaining = openRooms.filter(room => room.id !== id);
        const next = activeTab === id ? remaining[index - 1]?.id ?? remaining[index]?.id ?? OVERVIEW : activeTab;
        focusTab.current = next;
        setOpenRooms(remaining);
        setActiveTab(next);
    }
    function resetSelection() {
        if (overlayOpen)
            return;
        const previous = selectedId;
        setSelectedId(null);
        if (previous)
            roomButtons.current.get(previous)?.focus({ preventScroll: true });
    }
    function navigateTabs(event, id) {
        if (overlayOpen)
            return;
        if (event.key === "Delete" && id !== OVERVIEW) {
            event.preventDefault();
            closeRoom(id);
            return;
        }
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
            return;
        event.preventDefault();
        const ids = [OVERVIEW, ...openRooms.map(room => room.id)];
        const index = ids.indexOf(id);
        activateTab(event.key === "Home" ? ids[0] : event.key === "End" ? ids[ids.length - 1] : ids[(index + (event.key === "ArrowRight" ? 1 : -1) + ids.length) % ids.length]);
    }
    return (_jsxs("section", { className: styles.workspace, "aria-label": "Mapping workspace", children: [_jsxs("div", { className: styles.subbar, role: "tablist", "aria-label": "Mapping workbench views", children: [_jsxs("button", { type: "button", role: "tab", className: styles.tab, id: tabId(OVERVIEW), "aria-controls": panelId(OVERVIEW), "aria-selected": activeTab === OVERVIEW, tabIndex: activeTab === OVERVIEW ? 0 : -1, disabled: overlayOpen, ref: element => { if (element)
                            tabs.current.set(OVERVIEW, element);
                        else
                            tabs.current.delete(OVERVIEW); }, onClick: () => activateTab(OVERVIEW), onKeyDown: event => navigateTabs(event, OVERVIEW), children: [_jsx(MapIcon, { "aria-hidden": "true" }), "Overview"] }), openRooms.map(room => {
                        const label = summaries.find(item => item.id === room.id)?.label ?? room.label;
                        return _jsxs("div", { className: styles.roomTab, "data-active": activeTab === room.id, role: "presentation", children: [_jsxs("button", { type: "button", role: "tab", className: styles.tab, id: tabId(room.id), "aria-controls": panelId(room.id), "aria-selected": activeTab === room.id, tabIndex: activeTab === room.id ? 0 : -1, disabled: overlayOpen, ref: element => { if (element)
                                        tabs.current.set(room.id, element);
                                    else
                                        tabs.current.delete(room.id); }, onClick: () => activateTab(room.id), onKeyDown: event => navigateTabs(event, room.id), children: [_jsx(DoorOpen, { "aria-hidden": "true" }), _jsx("span", { children: label })] }), _jsx("button", { type: "button", className: styles.closeTab, onClick: () => closeRoom(room.id), disabled: overlayOpen, "aria-label": `Close ${label} tab`, children: _jsx(X, { "aria-hidden": "true" }) })] }, room.id);
                    }), _jsx("span", { className: styles.subnote, children: "Last observed locations" })] }), _jsxs("div", { role: "tabpanel", id: panelId(OVERVIEW), "aria-labelledby": tabId(OVERVIEW), hidden: activeTab !== OVERVIEW, children: [_jsxs("div", { className: styles.toolbar, children: [_jsxs(Button, { ref: filterButton, variant: "outline", className: filterOpen ? styles.filterActive : undefined, disabled: overlayOpen, "aria-expanded": filterOpen, "aria-controls": filterId, onClick: () => setFilterOpen(value => !value), children: [_jsx(SlidersHorizontal, { size: 15, "aria-hidden": "true" }), "Filter", _jsx(ChevronDown, { size: 14, "aria-hidden": "true" })] }), _jsxs("span", { className: styles.buildingChip, children: [_jsx(Building2, { "aria-hidden": "true" }), "J18 \u00B7 Willis Annexe"] }), _jsxs("span", { className: styles.total, children: [rooms.length, " ", rooms.length === 1 ? "room" : "rooms", " \u00B7 ", activeBatteries.length, " active batteries"] }), onLocationTools && _jsxs(Button, { variant: "ghost", disabled: overlayOpen, onClick: onLocationTools, children: [_jsx(Settings2, { size: 15, "aria-hidden": "true" }), "Location setup"] })] }), _jsx(MotionDisclosure, { open: filterOpen, id: filterId, children: _jsxs("div", { className: styles.filters, children: [_jsx("span", { className: styles.filterLabel, children: "Building" }), REFERENCE_BUILDINGS.map(building => _jsxs("button", { type: "button", className: styles.building, "aria-pressed": building.id === SUPPORTED_BUILDING_ID, disabled: building.id !== SUPPORTED_BUILDING_ID || overlayOpen, onClick: () => filterButton.current?.focus({ preventScroll: true }), children: [_jsx(Building2, { "aria-hidden": "true" }), _jsxs("span", { children: [building.id, _jsxs("small", { children: [building.name, building.id !== SUPPORTED_BUILDING_ID && " · unavailable"] })] }), building.id === SUPPORTED_BUILDING_ID && _jsx(Check, { "aria-hidden": "true" })] }, building.id)), _jsx(Button, { variant: "ghost", className: styles.clearFilters, disabled: overlayOpen, onClick: () => { setFilterOpen(false); filterButton.current?.focus({ preventScroll: true }); }, children: "Clear filters" })] }) }), _jsxs("div", { className: styles.mapLayout, "data-selected": !!selected, children: [_jsxs("div", { className: styles.canvas, "aria-label": "Schematic last observed room locations", children: [_jsxs("div", { className: styles.canvasLabel, children: [_jsx(Layers2, { "aria-hidden": "true" }), _jsx("span", { children: "J18 / LAST OBSERVED LOCATIONS" })] }), selected && _jsxs(Button, { variant: "ghost", size: "sm", className: styles.reset, onClick: resetSelection, disabled: overlayOpen, children: [_jsx(Maximize, { size: 14, "aria-hidden": "true" }), "Reset view"] }), _jsx("div", { className: styles.ground, "aria-hidden": "true" }), _jsx("div", { className: summaries.length > 4 ? styles.roomGrid : styles.roomLayer, children: summaries.map((room, index) => _jsxs("button", { type: "button", className: styles.room, "data-position": index, "data-unknown": room.unknown, "aria-pressed": selectedId === room.id, "aria-label": `${room.label}${room.placeholder ? ", placeholder" : ""}, ${room.batteries.length} ${room.unknown ? "without a mapped last observation" : "last observed here"}`, disabled: overlayOpen, ref: element => { if (element)
                                                roomButtons.current.set(room.id, element);
                                            else
                                                roomButtons.current.delete(room.id); }, onClick: () => setSelectedId(previous => previous === room.id ? null : room.id), children: [_jsx("div", { className: styles.roomVisual, children: _jsx(MappingRoomDrawing, { unknown: room.unknown }) }), _jsxs("span", { className: styles.roomLabel, children: [_jsx("strong", { children: room.label }), _jsxs("small", { children: [room.placeholder ? "Placeholder · " : "", room.batteries.length, " ", room.unknown ? "without a mapped observation" : "last observed here"] })] })] }, room.id)) }), _jsx("p", { className: styles.canvasFoot, children: "Schematic arrangement \u00B7 Recorded observations do not confirm current battery locations." })] }), _jsx("aside", { className: styles.inspector, "aria-label": "Selected room summary", inert: !selected, "aria-hidden": !selected, children: _jsx("div", { className: styles.inspectorContent, children: selected && _jsxs(_Fragment, { children: [_jsxs("div", { className: styles.inspectorHeading, children: [_jsxs("div", { children: [_jsx("span", { className: styles.eyebrow, children: selected.unknown ? "No mapped last observation" : "J18 · Last observed location" }), _jsx("h2", { children: selected.label }), selected.placeholder && _jsx("p", { className: styles.caption, children: "Placeholder room \u00B7 not a verified physical location" })] }), _jsx(Button, { variant: "ghost", size: "icon-sm", disabled: overlayOpen, onClick: resetSelection, "aria-label": "Close room summary", children: _jsx(X, { size: 16, "aria-hidden": "true" }) })] }), _jsxs("div", { className: styles.count, children: [_jsx("strong", { children: selected.batteries.length }), _jsx("span", { children: selected.unknown ? "without a mapped observation" : "last observed here" })] }), _jsxs("div", { children: [_jsxs("dl", { className: styles.stats, children: [_jsxs("div", { children: [_jsx("dt", { children: "In store" }), _jsx("dd", { children: selected.batteries.length - selectedInUse })] }), _jsxs("div", { children: [_jsx("dt", { children: "In use" }), _jsx("dd", { children: selectedInUse })] })] }), _jsx("p", { className: styles.caption, children: "Loan status, not physical presence." })] }), _jsxs("div", { children: [_jsx("span", { className: styles.eyebrow, children: selected.unknown ? "Records to review" : "Latest recorded evidence" }), selectedPreview.map(battery => _jsxs("div", { className: styles.previewRow, children: [_jsx("button", { type: "button", className: styles.previewLink, disabled: overlayOpen, onClick: () => onDetail(battery.id, selected.id), children: battery.id }), _jsx("span", { className: styles.status, "data-in-use": !!battery.loanId, children: battery.loanId ? "In use" : "In store" }), _jsx("span", { className: styles.evidence, children: battery.observedAt ? _jsxs(_Fragment, { children: [battery.observedRoom || "Original room label unavailable", _jsx("br", {}), Number.isFinite(recordedTime(battery)) ? formatTime(battery.observedAt) : "Observation time unavailable", " \u00B7 ", battery.observationSource || "Source not recorded"] }) : "No location observation recorded" })] }, battery.id)), !selected.batteries.length && _jsx("p", { className: styles.caption, children: selected.unknown ? "Every active battery has a usable mapped last observation." : "No active battery has its latest recorded observation assigned to this room." })] }), selected.unknown && _jsx("p", { className: styles.caption, children: "Includes missing observations and rooms outside this map. Known observations outside this map remain in history. Registered home is never used to infer a location." }), _jsxs(Button, { className: styles.viewDetails, disabled: overlayOpen, onClick: openDetails, children: ["View details", _jsx(ArrowRight, { size: 16, "aria-hidden": "true" })] })] }) }) })] })] }), openRooms.map(room => {
                const summary = summaries.find(item => item.id === room.id);
                const label = summary?.label ?? room.label;
                const visible = active && activeTab === room.id;
                return _jsxs("div", { className: styles.detail, role: "tabpanel", id: panelId(room.id), "aria-labelledby": tabId(room.id), hidden: activeTab !== room.id, children: [_jsxs("div", { className: styles.detailHeader, children: [_jsxs("div", { children: [_jsx("h2", { children: label }), _jsxs("p", { children: [room.id === UNKNOWN_MAPPING_ROOM ? "Batteries without a usable mapped last observation." : "J18 · Latest recorded observations", summary?.placeholder && " · Placeholder room"] })] }), _jsxs(Button, { variant: "ghost", disabled: overlayOpen, onClick: () => activateTab(OVERVIEW), children: [_jsx(ArrowLeft, { size: 16, "aria-hidden": "true" }), "Back to mapping"] })] }), !summary && _jsx("p", { className: "form-error", role: "alert", children: "This room is no longer available in the J18 map. Its original evidence remains in battery history." }), _jsx(InventoryTable, { data: data, ready: ready && !!summary, mappingRoom: room.id, active: visible, overlayOpen: overlayOpen, onMovement: onMovement, onScan: onScan, onEdit: onEdit, onDetail: id => onDetail(id, room.id), onSetup: onSetup, onExport: onExport, onGroupsChanged: onGroupsChanged, onGroupDialogChange: onGroupDialogChange, onOpenGroups: onOpenGroups, onRemoval: onRemoval })] }, room.id);
            }), _jsxs("div", { className: styles.footer, children: [_jsx(Info, { "aria-hidden": "true" }), _jsxs("p", { children: ["Latest saved observations only; no live location feed. Room shapes are schematic. ", data.dataset === "demo" ? "Demonstration evidence retains its recorded source." : "Unknown locations remain unknown."] })] })] }));
}
