"use client";

import { useId, useState } from "react";
import { Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { InventorySnapshot } from "@/lib/domain";
import type { InventoryFilter } from "@/lib/inventory-query";
import { currentSydneyDate } from "@/lib/battery-age";
import { AppliedFilters, appliedFilterChips, InventoryFilterPanel } from "./inventory-filter-panel";

export function BatteryFilterControls({ data, filters, onChange, onClear, disabled = false, fixedGroup = false, showLifecycle = true, showSort = true, scopeNote, defaultLifecycle = "active" }: {
    data: InventorySnapshot;
    filters: InventoryFilter;
    onChange: (patch: Partial<InventoryFilter>) => void;
    onClear: () => void;
    disabled?: boolean;
    fixedGroup?: boolean;
    showLifecycle?: boolean;
    showSort?: boolean;
    scopeNote?: string;
    defaultLifecycle?: InventoryFilter["lifecycle"];
}) {
    const [open, setOpen] = useState(false);
    const panelId = `battery-filters-${useId()}`;
    const chips = appliedFilterChips(filters, data, defaultLifecycle).filter(chip => (!fixedGroup || chip.key !== "group") && (showLifecycle || chip.key !== "lifecycle") && (showSort || chip.key !== "sort"));
    const change = (patch: Partial<InventoryFilter>) => { if (!disabled) onChange(patch); };
    return <fieldset disabled={disabled} className="min-w-0 space-y-2 border-0 p-0" aria-label="Battery filters">
        <div className="flex flex-wrap items-center justify-between gap-2">
            <Tabs value={filters.status} onValueChange={status => change({ status: status as InventoryFilter["status"] })}>
                <TabsList aria-label="Current battery status">
                    <TabsTrigger value="all" disabled={disabled}>All batteries</TabsTrigger>
                    <TabsTrigger value="in" disabled={disabled}>In store</TabsTrigger>
                    <TabsTrigger value="out" disabled={disabled}>In use</TabsTrigger>
                </TabsList>
            </Tabs>
            <Button type="button" variant={open ? "secondary" : "outline"} disabled={disabled} aria-expanded={open} aria-controls={panelId} onClick={() => setOpen(value => !value)}><Settings2 size={16}/>Filter{chips.length ? ` (${chips.length})` : ""}</Button>
        </div>
        {scopeNote && <p className="field-hint">{scopeNote}</p>}
        {open && <InventoryFilterPanel id={panelId} data={data} filters={filters} asOfOn={currentSydneyDate()} onChange={change} fixedGroup={fixedGroup} showLifecycle={showLifecycle} showSort={showSort} defaultLifecycle={defaultLifecycle}/>}
        <AppliedFilters chips={chips} onRemove={change} onClear={() => { if (!disabled) onClear(); }}/>
    </fieldset>;
}
