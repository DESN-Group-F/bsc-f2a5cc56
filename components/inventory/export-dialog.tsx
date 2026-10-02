"use client";
import { useState } from "react";
import { Download } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { exportSections, type ExportSection, type InventoryFilter } from "@/lib/inventory-query";
import type { ExportDocument } from "@/lib/exports";
import type { Dataset } from "@/lib/domain";
export type ExportDraft = { batteryId?: string; selectedIds?: string[]; filter: InventoryFilter; page: number; pageSize: "10" | "25" | "50" | "100"; matching: number; pageCount: number };
export function ExportDialog({ draft, dataset, onClose }: { draft: ExportDraft; dataset: Dataset; onClose: () => void }) {
    const [selectedIds] = useState(() => [...new Set(draft.selectedIds ?? [])]);
    const [mode, setMode] = useState(draft.batteryId ? "detail" : "summary"), [range, setRange] = useState(selectedIds.length ? "selected" : "filtered"), [format, setFormat] = useState("xlsx");
    const [sections, setSections] = useState<ExportSection[]>(exportSections.map(section => section.id)), [busy, setBusy] = useState(false), [error, setError] = useState("");
    const count = draft.batteryId ? 1 : range === "selected" ? selectedIds.length : range === "page" ? draft.pageCount : draft.matching;
    async function download() {
        setBusy(true); setError("");
        try {
            const input = { dataset, mode, range: draft.batteryId ? "filtered" : range, filter: draft.filter, page: draft.page, pageSize: draft.pageSize, batteryId: draft.batteryId, batteryIds: !draft.batteryId && range === "selected" ? [...selectedIds] : undefined, sections };
            const request = JSON.stringify(input);
            if (new TextEncoder().encode(request).length > 15000) throw new Error("This download request is too large. Select fewer batteries, or choose all filtered batteries or the current page.");
            const response = await fetch("/api/export", { method: "POST", headers: { "Content-Type": "application/json" }, body: request });
            const document = await response.json() as ExportDocument & { error?: string };
            if (!response.ok) throw new Error(document.error || "The export could not be prepared.");
            const link = window.document.createElement("a");
            link.href = `/api/export?${new URLSearchParams({ request, format })}`;
            window.document.body.appendChild(link); link.click(); link.remove();
            onClose();
        } catch (error) { setError((error as Error).message); }
        finally { setBusy(false); }
    }
    return <Dialog open onOpenChange={open => !open && !busy && onClose()}><DialogContent className="export-dialog"><DialogHeader><DialogTitle>Download {draft.batteryId ?? "batteries"}</DialogTitle><DialogDescription>Choose the battery range and information to include.</DialogDescription></DialogHeader><div className="form-stack">
        {!draft.batteryId && <><div className="form-field"><Label>Information depth</Label><Select value={mode} disabled={busy} onValueChange={value => { setMode(value); if (value === "detail" && format === "csv") setFormat("xlsx"); }}><SelectTrigger aria-label="Export information depth"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="summary">Inventory summary</SelectItem><SelectItem value="detail">Detailed battery records</SelectItem></SelectContent></Select></div><div className="form-field"><Label>Battery range</Label><Select value={range} disabled={busy} onValueChange={setRange}><SelectTrigger aria-label="Export battery range"><SelectValue /></SelectTrigger><SelectContent>{!!selectedIds.length && <SelectItem value="selected">Selected batteries ({selectedIds.length})</SelectItem>}<SelectItem value="filtered">All filtered batteries ({draft.matching})</SelectItem><SelectItem value="page">Current page ({draft.pageCount})</SelectItem></SelectContent></Select></div></>}
        <div className="export-count"><strong>{count} {count === 1 ? "battery" : "batteries"}</strong><span>{draft.batteryId ? "Single battery" : range === "selected" ? "Selected batteries" : range === "page" ? `Page ${draft.page + 1}` : "All matching the current filters"}</span></div>
        {!draft.batteryId && range === "selected" && <div className="field-hint"><p>Includes your selection across pages and filters.</p><details><summary>Selected battery IDs</summary><p className="max-h-24 overflow-y-auto break-words">{selectedIds.join(", ")}</p></details></div>}
        {mode === "detail" && <fieldset className="export-sections"><legend>Information to download</legend><label className="export-option export-all"><Checkbox checked={sections.length === exportSections.length ? true : sections.length ? "indeterminate" : false} disabled={busy} onCheckedChange={value => setSections(value === true ? exportSections.map(section => section.id) : [])}/><strong>Select all information</strong></label>{exportSections.map(section => <label key={section.id} className="export-option"><Checkbox checked={sections.includes(section.id)} disabled={busy} onCheckedChange={value => setSections(old => value ? [...old, section.id] : old.filter(id => id !== section.id))}/><span><strong>{section.label}</strong><small>{section.note}</small></span></label>)}</fieldset>}
        <div className="form-field"><Label>File format</Label><Select value={format} disabled={busy} onValueChange={setFormat}><SelectTrigger aria-label="Export file format"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="xlsx">Excel workbook (.xlsx)</SelectItem>{mode === "summary" && <SelectItem value="csv">CSV table (.csv)</SelectItem>}<SelectItem value="json">Complete structured data (.json)</SelectItem></SelectContent></Select></div>
        <p className="field-hint">Exports include filter information and UTC timestamps. Selected histories include every stored record, including records beyond the displayed history.</p>{error && <p className="form-error" role="alert">{error}</p>}
    </div><DialogFooter><Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button><Button onClick={download} disabled={busy || !count || (mode === "detail" && !sections.length)}><Download size={16}/>{busy ? "Preparing download…" : "Download"}</Button></DialogFooter></DialogContent></Dialog>;
}
