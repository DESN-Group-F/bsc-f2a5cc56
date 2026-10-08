"use client";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useRef, useState } from "react";
import { Combobox, ComboboxInput, ComboboxContent, ComboboxList, ComboboxItem, ComboboxEmpty } from "../ui/combobox.js";
import { Button } from "../ui/button.js";
export function RecordPicker({ options, value, onChange, id, placeholder, disabled = false, resetKey = 0, showClearFilters = true, onFilterChange }) {
    const container = useRef(null);
    const [search, setSearch] = useState({ value, resetKey, active: false }), [resetCount, setResetCount] = useState(0);
    const selected = options.find(o => o.id === value) ?? null;
    const filtering = search.value === value && search.resetKey === resetKey && search.active;
    function clearFilters() { setSearch({ value, resetKey, active: false }); setResetCount(previous => previous + 1); onFilterChange?.(false); }
    return _jsxs("div", { ref: container, children: [_jsxs(Combobox, { items: options, value: selected, onValueChange: (o) => { if (!o?.disabled)
                    onChange(o?.id ?? ""); }, onInputValueChange: (query, details) => { const active = details.reason === "input-change" && !!query; setSearch({ value, resetKey, active }); onFilterChange?.(active); }, itemToStringLabel: (o) => o.label, disabled: disabled, children: [_jsx(ComboboxInput, { id: id, placeholder: placeholder, className: "record-picker" }), _jsxs(ComboboxContent, { portalContainer: container, children: [_jsx("div", { className: "border-b p-1", children: _jsx(Button, { type: "button", variant: "ghost", size: "sm", onClick: clearFilters, disabled: disabled || !filtering, children: "Clear filters" }) }), _jsx(ComboboxEmpty, { children: "No matching records." }), _jsx(ComboboxList, { children: (option) => _jsx(ComboboxItem, { value: option, disabled: option.disabled, children: option.label }, option.id) })] })] }, `${value}-${resetKey}-${resetCount}`), showClearFilters && _jsx(Button, { type: "button", variant: "ghost", size: "sm", className: "mt-1", onClick: clearFilters, disabled: disabled || !filtering, children: "Clear filters" })] });
}
