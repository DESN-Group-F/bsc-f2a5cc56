"use client";
import type { ExportDraft } from "@/lib/client/inventory-contracts";
export type { ExportDraft } from "@/lib/client/inventory-contracts";
import { useRef, useState } from "react";
import { Download } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { DownloadAction } from "@/components/ui/download-action";
import { MotionDisclosure, MotionPresence } from "@/components/ui/workspace-motion";
import { useDownloadFeedback } from "@/hooks/use-download-feedback";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { exportSections, type ExportSection } from "@/lib/inventory-query";
import { downloadExportAttachment, type ExportDownloadFormat } from "@/lib/client-utils";
import type { Dataset } from "@/lib/domain";
import { dismissOverlay } from "@/lib/client/overlay-exit";

export function ExportDialog({ draft, dataset, onClose }: { draft: ExportDraft; dataset: Dataset; onClose: () => void }) {
    const surface = useRef<HTMLDivElement>(null);
    const [selectedIds] = useState(() => [...new Set(draft.selectedIds ?? [])]);
    const [mode, setMode] = useState(draft.batteryId || draft.selectedOnly ? "detail" : "summary"), [range, setRange] = useState(selectedIds.length ? "selected" : "filtered"), [format, setFormat] = useState<ExportDownloadFormat>("xlsx");
    const [sections, setSections] = useState<ExportSection[]>(exportSections.map(section => section.id));
    const input = { dataset, mode, range: draft.batteryId ? "filtered" : range, filter: draft.filter, teachingGroup: draft.teachingGroup, page: draft.page, pageSize: draft.pageSize, batteryId: draft.batteryId, batteryIds: !draft.batteryId && range === "selected" ? [...selectedIds] : undefined, sections };
    const reviewKey = JSON.stringify({ input, format });
    const { busy, error, completion, running, run } = useDownloadFeedback(reviewKey);
    const count = draft.batteryId ? 1 : range === "selected" ? selectedIds.length : range === "page" ? draft.pageCount : draft.matching;
    function close() { if (!running.current) dismissOverlay(surface.current, onClose, "dialog"); }
    async function download() {
        await run(() => downloadExportAttachment(input, format, `battery-${draft.batteryId ?? mode}-${dataset}.${format}`));
    }
    return <Dialog open onOpenChange={open => !open && close()}><DialogContent ref={surface} className="export-dialog" showCloseButton={!busy} onEscapeKeyDown={event => { if (running.current) event.preventDefault(); }} onInteractOutside={event => { if (running.current) event.preventDefault(); }}><DialogHeader><DialogTitle>Download {draft.batteryId ?? "batteries"}</DialogTitle><DialogDescription>Choose the battery range and information to include.</DialogDescription></DialogHeader><div className="form-stack">
        {!draft.batteryId && <><div className="form-field"><Label>Information depth</Label><Select value={mode} disabled={busy} onValueChange={value => { setMode(value); if (value === "detail" && format === "csv") setFormat("xlsx"); }}><SelectTrigger aria-label="Export information depth"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="summary">Inventory summary</SelectItem><SelectItem value="detail">Detailed battery records</SelectItem></SelectContent></Select></div><div className="form-field"><Label>Battery range</Label><Select value={range} disabled={busy || draft.selectedOnly} onValueChange={setRange}><SelectTrigger aria-label="Export battery range"><SelectValue /></SelectTrigger><SelectContent>{!!selectedIds.length && <SelectItem value="selected">Selected batteries ({selectedIds.length})</SelectItem>}{!draft.selectedOnly && <><SelectItem value="filtered">All filtered batteries ({draft.matching})</SelectItem><SelectItem value="page">Current page ({draft.pageCount})</SelectItem></>}</SelectContent></Select></div></>}
        <div className="export-count"><strong key={`${range}:${count}`} className="download-scope-label">{count} {count === 1 ? "battery" : "batteries"}</strong><span key={range} className="download-scope-label">{draft.batteryId ? "Single battery" : range === "selected" ? "Selected batteries" : range === "page" ? `Page ${draft.page + 1}` : "All matching the current filters"}</span></div>
        <MotionDisclosure open={!draft.batteryId && range === "selected"}><div className="field-hint"><p>{draft.selectedOnly ? "Includes the captured matching removal records only." : "Includes your selection across pages and filters."}</p><details><summary>Selected battery IDs</summary><p className="max-h-24 overflow-y-auto break-words">{selectedIds.join(", ")}</p></details></div></MotionDisclosure>
        <MotionDisclosure open={mode === "detail"}><fieldset className="export-sections" disabled={busy || mode !== "detail"}><legend>Information to download</legend><label className="export-option export-all"><Checkbox checked={sections.length === exportSections.length ? true : sections.length ? "indeterminate" : false} disabled={busy || mode !== "detail"} onCheckedChange={value => setSections(value === true ? exportSections.map(section => section.id) : [])}/><strong>Select all information</strong></label>{exportSections.map(section => <label key={section.id} className="export-option"><Checkbox checked={sections.includes(section.id)} disabled={busy || mode !== "detail"} onCheckedChange={value => setSections(old => value ? [...old, section.id] : old.filter(id => id !== section.id))}/><span><strong>{section.label}</strong><small>{section.note}</small></span></label>)}</fieldset></MotionDisclosure>
        <div className="form-field"><Label>File format</Label><Select value={format} disabled={busy} onValueChange={value => setFormat(value as ExportDownloadFormat)}><SelectTrigger aria-label="Export file format"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="xlsx">Excel report (.xlsx) — recommended</SelectItem>{mode === "summary" && <SelectItem value="csv">Readable table (.csv)</SelectItem>}<SelectItem value="json">Technical data (.json)</SelectItem></SelectContent></Select></div>
        <p className="field-hint">Excel includes a Report guide explaining the scope and every worksheet, readable records with Sydney dates, and a separate technical evidence appendix. CSV is a readable single table; JSON is intended for technical use. Selected histories include every stored record.</p><MotionPresence>{error && <p className="form-error" role="alert">{error}</p>}</MotionPresence>
    </div><DialogFooter><Button variant="outline" onClick={close} disabled={busy}><span key={completion ? "done" : "cancel"} className="download-close-label">{completion ? "Done" : "Cancel"}</span></Button><DownloadAction onClick={download} disabled={busy || !count || (mode === "detail" && !sections.length)} pending={busy} completion={completion} reviewKey={reviewKey} actionLabel="Download"><Download size={16}/>Download</DownloadAction></DialogFooter></DialogContent></Dialog>;
}
