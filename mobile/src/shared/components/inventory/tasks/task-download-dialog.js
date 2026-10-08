"use client";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useRef, useState } from "react";
import { Button } from "../../ui/button.js";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../../ui/dialog.js";
import { downloadTaskReport } from "../../../lib/client-utils.js";
export function TaskDownloadDialog({ request, onClose, onBusyChange }) {
    const [format, setFormat] = useState("xlsx");
    const [busy, setBusy] = useState(false), [error, setError] = useState("");
    const running = useRef(false);
    async function download() {
        if (running.current)
            return;
        running.current = true;
        setBusy(true);
        onBusyChange(true);
        setError("");
        try {
            await downloadTaskReport(`${request.url}&download=${format}`, format, `${request.filename}.${format}`);
            onClose();
        }
        catch (failure) {
            setError(failure.message);
        }
        finally {
            running.current = false;
            setBusy(false);
            onBusyChange(false);
        }
    }
    return _jsx(Dialog, { open: true, onOpenChange: open => { if (!open && !running.current)
            onClose(); }, children: _jsxs(DialogContent, { showCloseButton: !busy, onEscapeKeyDown: event => { if (running.current)
                event.preventDefault(); }, onInteractOutside: event => { if (running.current)
                event.preventDefault(); }, children: [_jsxs(DialogHeader, { children: [_jsx(DialogTitle, { children: request.title }), _jsxs(DialogDescription, { children: [request.scope, " The current filters are captured for this download."] })] }), _jsxs("fieldset", { className: "space-y-3", disabled: busy, children: [_jsx("legend", { className: "mb-2 text-sm font-semibold", children: "File format" }), _jsxs("label", { className: "export-option", children: [_jsx("input", { type: "radio", name: "task-download-format", value: "xlsx", checked: format === "xlsx", onChange: () => !running.current && setFormat("xlsx") }), _jsxs("span", { children: [_jsx("strong", { children: "Excel report \u00B7 Recommended" }), _jsx("small", { children: "A reading guide, clearly named columns, staff names and local dates. Technical evidence is kept in separate labelled worksheets." })] })] }), _jsxs("label", { className: "export-option", children: [_jsx("input", { type: "radio", name: "task-download-format", value: "json", checked: format === "json", onChange: () => !running.current && setFormat("json") }), _jsxs("span", { children: [_jsx("strong", { children: "JSON \u00B7 Technical data" }), _jsx("small", { children: "Original structured fields and internal identifiers for analysis, reconciliation or system integration." })] })] })] }), error && _jsx("p", { className: "form-error", role: "alert", children: error }), _jsxs(DialogFooter, { children: [_jsx(Button, { variant: "outline", onClick: onClose, disabled: busy, children: "Cancel" }), _jsx(Button, { onClick: () => void download(), disabled: busy, children: busy ? "Preparing…" : format === "xlsx" ? "Download Excel report" : "Download JSON data" })] })] }) });
}
