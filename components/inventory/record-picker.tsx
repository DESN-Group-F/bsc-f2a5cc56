"use client";
import { useRef } from "react";
import { Combobox, ComboboxInput, ComboboxContent, ComboboxList, ComboboxItem, ComboboxEmpty } from "@/components/ui/combobox";
export type PickerOption = {
    id: string;
    label: string;
    disabled?: boolean;
};
export function RecordPicker({ options, value, onChange, id, placeholder, disabled = false }: {
    options: PickerOption[];
    value: string;
    onChange: (id: string) => void;
    id: string;
    placeholder: string;
    disabled?: boolean;
}) {
    const container = useRef<HTMLDivElement>(null);
    return <div ref={container}><Combobox items={options} value={options.find(o => o.id === value) ?? null} onValueChange={(o: PickerOption | null) => { if (!o?.disabled) onChange(o?.id ?? ""); }} itemToStringLabel={(o: PickerOption) => o.label} disabled={disabled}>
    <ComboboxInput id={id} placeholder={placeholder} className="record-picker"/>
    <ComboboxContent portalContainer={container}><ComboboxEmpty>No matching records.</ComboboxEmpty><ComboboxList>{(option: PickerOption) => <ComboboxItem key={option.id} value={option} disabled={option.disabled}>{option.label}</ComboboxItem>}</ComboboxList></ComboboxContent>
  </Combobox></div>;
}
