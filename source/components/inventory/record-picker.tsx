"use client";
import { useRef, useState } from "react";
import { Combobox, ComboboxInput, ComboboxContent, ComboboxList, ComboboxItem, ComboboxEmpty } from "@/components/ui/combobox";
import { Button } from "@/components/ui/button";
export type PickerOption = {
    id: string;
    label: string;
    disabled?: boolean;
};
export function RecordPicker({ options, value, onChange, id, placeholder, disabled = false, resetKey = 0, showClearFilters = true, onFilterChange }: {
    options: PickerOption[];
    value: string;
    onChange: (id: string) => void;
    id: string;
    placeholder: string;
    disabled?: boolean;
    resetKey?: number;
    showClearFilters?: boolean;
    onFilterChange?: (active: boolean) => void;
}) {
    const container = useRef<HTMLDivElement>(null);
    const [search, setSearch] = useState({ value, resetKey, active: false }), [resetCount, setResetCount] = useState(0);
    const selected = options.find(o => o.id === value) ?? null;
    const filtering = search.value === value && search.resetKey === resetKey && search.active;
    function clearFilters() { setSearch({ value, resetKey, active: false }); setResetCount(previous => previous + 1); onFilterChange?.(false); }
    return <div ref={container}><Combobox key={`${value}-${resetKey}-${resetCount}`} items={options} value={selected} onValueChange={(o: PickerOption | null) => { if (!o?.disabled) onChange(o?.id ?? ""); }} onInputValueChange={(query, details) => { const active = details.reason === "input-change" && !!query; setSearch({ value, resetKey, active }); onFilterChange?.(active); }} itemToStringLabel={(o: PickerOption) => o.label} disabled={disabled}>
    <ComboboxInput id={id} placeholder={placeholder} className="record-picker"/>
    <ComboboxContent portalContainer={container}><div className="border-b p-1"><Button type="button" variant="ghost" size="sm" onClick={clearFilters} disabled={disabled || !filtering}>Clear filters</Button></div><ComboboxEmpty>No matching records.</ComboboxEmpty><ComboboxList>{(option: PickerOption) => <ComboboxItem key={option.id} value={option} disabled={option.disabled}>{option.label}</ComboboxItem>}</ComboboxList></ComboboxContent>
  </Combobox>{showClearFilters && <Button type="button" variant="ghost" size="sm" className="mt-1" onClick={clearFilters} disabled={disabled || !filtering}>Clear filters</Button>}</div>;
}
