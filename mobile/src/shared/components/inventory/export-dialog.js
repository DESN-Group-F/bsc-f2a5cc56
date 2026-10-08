"use client";
import { jsxs as _jsxs, jsx as _jsx, Fragment as _Fragment } from "react/jsx-runtime";
import { useState } from "react";
import { Download } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "../ui/dialog.js";
import { Button } from "../ui/button.js";
import { Label } from "../ui/label.js";
import { Checkbox } from "../ui/checkbox.js";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "../ui/select.js";
import { exportSections } from "../../lib/inventory-query.js";
import { downloadExportAttachment } from "../../lib/client-utils.js";
export function ExportDialog({ draft, dataset, onClose }) {
    const [selectedIds] = useState(() => [...new Set(draft.selectedIds ?? [])]);
    const [mode, setMode] = useState(draft.batteryId || draft.selectedOnly ? "detail" : "summary"), [range, setRange] = useState(selectedIds.length ? "selected" : "filtered"), [format, setFormat] = useState("xlsx");
    const [sections, setSections] = useState(exportSections.map(section => section.id)), [busy, setBusy] = useState(false), [error, setError] = useState("");
    const count = draft.batteryId ? 1 : range === "selected" ? selectedIds.length : range === "page" ? draft.pageCount : draft.matching;
    async function download() {
        setBusy(true);
        setError("");
        try {
            const input = { dataset, mode, range: draft.batteryId ? "filtered" : range, filter: draft.filter, page: draft.page, pageSize: draft.pageSize, batteryId: draft.batteryId, batteryIds: !draft.batteryId && range === "selected" ? [...selectedIds] : undefined, sections };
            await downloadExportAttachment(input, format, `battery-${draft.batteryId ?? mode}-${dataset}.${format}`);
            onClose();
        }
        catch (error) {
            setError(error.message);
        }
        finally {
            setBusy(false);
        }
    }
    return _jsx(Dialog, { open: true, onOpenChange: open => !open && !busy && onClose(), children: _jsxs(DialogContent, { className: "export-dialog", children: [_jsxs(DialogHeader, { children: [_jsxs(DialogTitle, { children: ["Download ", draft.batteryId ?? "batteries"] }), _jsx(DialogDescription, { children: "Choose the battery range and information to include." })] }), _jsxs("div", { className: "form-stack", children: [!draft.batteryId && _jsxs(_Fragment, { children: [_jsxs("div", { className: "form-field", children: [_jsx(Label, { children: "Information depth" }), _jsxs(Select, { value: mode, disabled: busy, onValueChange: value => { setMode(value); if (value === "detail" && format === "csv")
                                                setFormat("xlsx"); }, children: [_jsx(SelectTrigger, { "aria-label": "Export information depth", children: _jsx(SelectValue, {}) }), _jsxs(SelectContent, { children: [_jsx(SelectItem, { value: "summary", children: "Inventory summary" }), _jsx(SelectItem, { value: "detail", children: "Detailed battery records" })] })] })] }), _jsxs("div", { className: "form-field", children: [_jsx(Label, { children: "Battery range" }), _jsxs(Select, { value: range, disabled: busy || draft.selectedOnly, onValueChange: setRange, children: [_jsx(SelectTrigger, { "aria-label": "Export battery range", children: _jsx(SelectValue, {}) }), _jsxs(SelectContent, { children: [!!selectedIds.length && _jsxs(SelectItem, { value: "selected", children: ["Selected batteries (", selectedIds.length, ")"] }), !draft.selectedOnly && _jsxs(_Fragment, { children: [_jsxs(SelectItem, { value: "filtered", children: ["All filtered batteries (", draft.matching, ")"] }), _jsxs(SelectItem, { value: "page", children: ["Current page (", draft.pageCount, ")"] })] })] })] })] })] }), _jsxs("div", { className: "export-count", children: [_jsxs("strong", { children: [count, " ", count === 1 ? "battery" : "batteries"] }), _jsx("span", { children: draft.batteryId ? "Single battery" : range === "selected" ? "Selected batteries" : range === "page" ? `Page ${draft.page + 1}` : "All matching the current filters" })] }), !draft.batteryId && range === "selected" && _jsxs("div", { className: "field-hint", children: [_jsx("p", { children: draft.selectedOnly ? "Includes the captured matching removal records only." : "Includes your selection across pages and filters." }), _jsxs("details", { children: [_jsx("summary", { children: "Selected battery IDs" }), _jsx("p", { className: "max-h-24 overflow-y-auto break-words", children: selectedIds.join(", ") })] })] }), mode === "detail" && _jsxs("fieldset", { className: "export-sections", children: [_jsx("legend", { children: "Information to download" }), _jsxs("label", { className: "export-option export-all", children: [_jsx(Checkbox, { checked: sections.length === exportSections.length ? true : sections.length ? "indeterminate" : false, disabled: busy, onCheckedChange: value => setSections(value === true ? exportSections.map(section => section.id) : []) }), _jsx("strong", { children: "Select all information" })] }), exportSections.map(section => _jsxs("label", { className: "export-option", children: [_jsx(Checkbox, { checked: sections.includes(section.id), disabled: busy, onCheckedChange: value => setSections(old => value ? [...old, section.id] : old.filter(id => id !== section.id)) }), _jsxs("span", { children: [_jsx("strong", { children: section.label }), _jsx("small", { children: section.note })] })] }, section.id))] }), _jsxs("div", { className: "form-field", children: [_jsx(Label, { children: "File format" }), _jsxs(Select, { value: format, disabled: busy, onValueChange: value => setFormat(value), children: [_jsx(SelectTrigger, { "aria-label": "Export file format", children: _jsx(SelectValue, {}) }), _jsxs(SelectContent, { children: [_jsx(SelectItem, { value: "xlsx", children: "Excel report (.xlsx) \u2014 recommended" }), mode === "summary" && _jsx(SelectItem, { value: "csv", children: "Readable table (.csv)" }), _jsx(SelectItem, { value: "json", children: "Technical data (.json)" })] })] })] }), _jsx("p", { className: "field-hint", children: "Excel includes a Report guide explaining the scope and every worksheet, readable records with Sydney dates, and a separate technical evidence appendix. CSV is a readable single table; JSON is intended for technical use. Selected histories include every stored record." }), error && _jsx("p", { className: "form-error", role: "alert", children: error })] }), _jsxs(DialogFooter, { children: [_jsx(Button, { variant: "outline", onClick: onClose, disabled: busy, children: "Cancel" }), _jsxs(Button, { onClick: download, disabled: busy || !count || (mode === "detail" && !sections.length), children: [_jsx(Download, { size: 16 }), busy ? "Preparing download…" : "Download"] })] })] }) });
}
