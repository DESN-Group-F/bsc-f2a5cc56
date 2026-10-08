"use client";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from "react";
import { Button } from "../ui/button.js";
import { Checkbox } from "../ui/checkbox.js";
import { Label } from "../ui/label.js";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "../ui/select.js";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "../ui/dialog.js";
import { downloadExportAttachment } from "../../lib/client-utils.js";
import { exportSections } from "../../lib/inventory-query.js";
export function ActivityExportDialog({ dataset, scope, search, groupId, selectedIds, count, batteryFilter, onClose }) {
    const [context] = useState(() => ({ dataset, scope, search, groupId, batteryFilter: batteryFilter ? { ...batteryFilter } : undefined, count }));
    const [selection] = useState(() => [...selectedIds]);
    const [range, setRange] = useState(selection.length ? "selected" : "filtered"), [depth, setDepth] = useState("group_summary"), [format, setFormat] = useState("xlsx");
    const [sections, setSections] = useState(exportSections.map(section => section.id)), [busy, setBusy] = useState(false), [error, setError] = useState("");
    async function download() {
        if (busy)
            return;
        setBusy(true);
        setError("");
        try {
            await downloadExportAttachment({ dataset: context.dataset, mode: "activity", activityScope: context.scope, search: context.search, activityGroupId: context.groupId, activityBatteryFilter: context.batteryFilter, activityDepth: depth, activityIds: range === "selected" ? selection : undefined, sections }, format, `battery-activity-${context.dataset}.${format}`);
            onClose();
        }
        catch (error) {
            setError(error.message);
        }
        finally {
            setBusy(false);
        }
    }
    return _jsx(Dialog, { open: true, onOpenChange: open => { if (!open && !busy)
            onClose(); }, children: _jsxs(DialogContent, { className: "export-dialog", children: [_jsxs(DialogHeader, { children: [_jsx(DialogTitle, { children: "Download activity" }), _jsx(DialogDescription, { children: "Use recorded group names and operation snapshots, with optional member details and complete battery histories." })] }), _jsxs("div", { className: "form-stack", children: [_jsx(Label, { children: "Activity range" }), _jsxs(Select, { value: range, onValueChange: setRange, disabled: busy, children: [_jsx(SelectTrigger, { "aria-label": "Activity download range", children: _jsx(SelectValue, {}) }), _jsxs(SelectContent, { children: [_jsxs(SelectItem, { value: "filtered", children: ["All filtered operations (", context.count, ")"] }), !!selection.length && _jsxs(SelectItem, { value: "selected", children: ["Selected operations (", selection.length, ")"] })] })] }), _jsx(Label, { children: "Group information" }), _jsxs(Select, { value: depth, onValueChange: value => { setDepth(value); if (value === "battery_details" && format === "csv")
                                setFormat("xlsx"); }, disabled: busy, children: [_jsx(SelectTrigger, { "aria-label": "Activity information depth", children: _jsx(SelectValue, {}) }), _jsxs(SelectContent, { children: [_jsx(SelectItem, { value: "group_summary", children: "Operation summaries and recorded group names" }), _jsx(SelectItem, { value: "battery_details", children: "Include group battery details" })] })] }), depth === "battery_details" && _jsxs("fieldset", { className: "export-sections", children: [_jsx("legend", { children: "Battery information to include" }), _jsxs("label", { className: "export-option export-all", children: [_jsx(Checkbox, { checked: sections.length === exportSections.length ? true : sections.length ? "indeterminate" : false, disabled: busy, onCheckedChange: value => setSections(value === true ? exportSections.map(section => section.id) : []) }), "Select all information"] }), exportSections.map(section => _jsxs("label", { className: "export-option", children: [_jsx(Checkbox, { checked: sections.includes(section.id), disabled: busy, onCheckedChange: value => setSections(previous => value === true ? [...previous, section.id] : previous.filter(id => id !== section.id)) }), _jsxs("span", { children: [_jsx("strong", { children: section.label }), _jsx("small", { children: section.note })] })] }, section.id))] }), _jsx(Label, { children: "File format" }), _jsxs(Select, { value: format, onValueChange: value => setFormat(value), disabled: busy, children: [_jsx(SelectTrigger, { "aria-label": "Activity file format", children: _jsx(SelectValue, {}) }), _jsxs(SelectContent, { children: [_jsx(SelectItem, { value: "xlsx", children: "Excel report (.xlsx) \u2014 recommended" }), depth === "group_summary" && _jsx(SelectItem, { value: "csv", children: "Readable table (.csv)" }), _jsx(SelectItem, { value: "json", children: "Technical data (.json)" })] })] }), _jsx("p", { className: "field-hint", children: "Excel includes a Report guide, readable activity and a separate technical evidence appendix. A group operation stays whole even when one member matches your search or battery filters. Battery filters use the current register; selected operations remain included even if they no longer match those filters. Activity records are historical; battery sections describe the current register and complete selected histories." }), error && _jsx("p", { className: "form-error", role: "alert", children: error })] }), _jsxs(DialogFooter, { children: [_jsx(Button, { variant: "outline", disabled: busy, onClick: onClose, children: "Cancel" }), _jsx(Button, { onClick: download, disabled: busy || depth === "battery_details" && !sections.length, children: busy ? "Preparing…" : "Download activity" })] })] }) });
}
