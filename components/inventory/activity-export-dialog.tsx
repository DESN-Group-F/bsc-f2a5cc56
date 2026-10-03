"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { downloadExportAttachment, type ExportDownloadFormat } from "@/lib/client-utils";
import { exportSections, type ExportSection } from "@/lib/inventory-query";
import type { Dataset } from "@/lib/domain";

export function ActivityExportDialog({ dataset, scope, search, groupId, selectedIds, count, onClose }: { dataset: Dataset; scope: "all" | "mine"; search: string; groupId: string | null; selectedIds: string[]; count: number; onClose: () => void }) {
    const [selection] = useState(() => [...selectedIds]);
    const [range, setRange] = useState(selection.length ? "selected" : "filtered"), [depth, setDepth] = useState("group_summary"), [format, setFormat] = useState<ExportDownloadFormat>("xlsx");
    const [sections, setSections] = useState<ExportSection[]>(exportSections.map(section => section.id)), [busy, setBusy] = useState(false), [error, setError] = useState("");
    async function download() {
        if (busy) return; setBusy(true); setError("");
        try {
            await downloadExportAttachment({ dataset, mode: "activity", activityScope: scope, search, activityGroupId: groupId, activityDepth: depth, activityIds: range === "selected" ? selection : undefined, sections }, format, `battery-activity-${dataset}.${format}`);
            onClose();
        } catch (error) { setError((error as Error).message); } finally { setBusy(false); }
    }
    return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}><DialogContent className="export-dialog"><DialogHeader><DialogTitle>Download activity</DialogTitle><DialogDescription>Use recorded group names and operation snapshots, with optional member details and complete battery histories.</DialogDescription></DialogHeader>
        <div className="form-stack"><Label>Activity range</Label><Select value={range} onValueChange={setRange} disabled={busy}><SelectTrigger aria-label="Activity download range"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="filtered">All filtered operations ({count})</SelectItem>{!!selection.length && <SelectItem value="selected">Selected operations ({selection.length})</SelectItem>}</SelectContent></Select>
        <Label>Group information</Label><Select value={depth} onValueChange={value => { setDepth(value); if (value === "battery_details" && format === "csv") setFormat("xlsx"); }} disabled={busy}><SelectTrigger aria-label="Activity information depth"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="group_summary">Operation summaries and recorded group names</SelectItem><SelectItem value="battery_details">Include group battery details</SelectItem></SelectContent></Select>
        {depth === "battery_details" && <fieldset className="export-sections"><legend>Battery information to include</legend><label className="export-option export-all"><Checkbox checked={sections.length === exportSections.length ? true : sections.length ? "indeterminate" : false} disabled={busy} onCheckedChange={value => setSections(value === true ? exportSections.map(section => section.id) : [])}/>Select all information</label>{exportSections.map(section => <label className="export-option" key={section.id}><Checkbox checked={sections.includes(section.id)} disabled={busy} onCheckedChange={value => setSections(previous => value === true ? [...previous, section.id] : previous.filter(id => id !== section.id))}/><span><strong>{section.label}</strong><small>{section.note}</small></span></label>)}</fieldset>}
        <Label>File format</Label><Select value={format} onValueChange={value => setFormat(value as ExportDownloadFormat)} disabled={busy}><SelectTrigger aria-label="Activity file format"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="xlsx">Excel workbook (.xlsx)</SelectItem>{depth === "group_summary" && <SelectItem value="csv">CSV table (.csv)</SelectItem>}<SelectItem value="json">Structured data (.json)</SelectItem></SelectContent></Select>
        <p className="field-hint">A group operation is exported as a whole, including when a member matches your search. Member action details are historical snapshots. Battery sections show current records and complete stored histories.</p>{error && <p className="form-error" role="alert">{error}</p>}</div>
        <DialogFooter><Button variant="outline" disabled={busy} onClick={onClose}>Cancel</Button><Button onClick={download} disabled={busy || depth === "battery_details" && !sections.length}>{busy ? "Preparing…" : "Download activity"}</Button></DialogFooter>
    </DialogContent></Dialog>;
}
