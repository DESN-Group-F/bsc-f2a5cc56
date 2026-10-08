"use client";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useId, useState } from "react";
import { Settings2 } from "lucide-react";
import { Button } from "../ui/button.js";
import { Tabs, TabsList, TabsTrigger } from "../ui/tabs.js";
import { currentSydneyDate } from "../../lib/battery-age.js";
import { AppliedFilters, appliedFilterChips, InventoryFilterPanel } from "./inventory-filter-panel.js";
export function BatteryFilterControls({ data, filters, onChange, onClear, disabled = false, fixedGroup = false, showLifecycle = true, showSort = true, scopeNote, defaultLifecycle = "active" }) {
    const [open, setOpen] = useState(false);
    const panelId = `battery-filters-${useId()}`;
    const chips = appliedFilterChips(filters, data, defaultLifecycle).filter(chip => (!fixedGroup || chip.key !== "group") && (showLifecycle || chip.key !== "lifecycle") && (showSort || chip.key !== "sort"));
    const change = (patch) => { if (!disabled)
        onChange(patch); };
    return _jsxs("fieldset", { disabled: disabled, className: "min-w-0 space-y-2 border-0 p-0", "aria-label": "Battery filters", children: [_jsxs("div", { className: "flex flex-wrap items-center justify-between gap-2", children: [_jsx(Tabs, { value: filters.status, onValueChange: status => change({ status: status }), children: _jsxs(TabsList, { "aria-label": "Current battery status", children: [_jsx(TabsTrigger, { value: "all", disabled: disabled, children: "All batteries" }), _jsx(TabsTrigger, { value: "in", disabled: disabled, children: "In store" }), _jsx(TabsTrigger, { value: "out", disabled: disabled, children: "In use" })] }) }), _jsxs(Button, { type: "button", variant: open ? "secondary" : "outline", disabled: disabled, "aria-expanded": open, "aria-controls": panelId, onClick: () => setOpen(value => !value), children: [_jsx(Settings2, { size: 16 }), "Filter", chips.length ? ` (${chips.length})` : ""] })] }), scopeNote && _jsx("p", { className: "field-hint", children: scopeNote }), open && _jsx(InventoryFilterPanel, { id: panelId, data: data, filters: filters, asOfOn: currentSydneyDate(), onChange: change, fixedGroup: fixedGroup, showLifecycle: showLifecycle, showSort: showSort, defaultLifecycle: defaultLifecycle }), _jsx(AppliedFilters, { chips: chips, onRemove: change, onClear: () => { if (!disabled)
                    onClear(); } })] });
}
