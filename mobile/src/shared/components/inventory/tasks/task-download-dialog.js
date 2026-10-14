"use client";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from "react";
import { Button } from "../../ui/button.js";
import { DownloadAction } from "../../ui/download-action.js";
import { MotionPresence } from "../../ui/workspace-motion.js";
import { useDownloadFeedback } from "../../../hooks/use-download-feedback.js";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../../ui/dialog.js";
import { downloadTaskReport } from "../../../lib/client-utils.js";
export function TaskDownloadDialog({ request, onClose, onBusyChange }) {
    const [format, setFormat] = useState("xlsx");
    const reviewKey = JSON.stringify({ request, format });
    const { busy, error, completion, running, run } = useDownloadFeedback(reviewKey);
    async function download() {
        await run(() => downloadTaskReport(`${request.url}&download=${format}`, format, `${request.filename}.${format}`), onBusyChange);
    }
    return _jsx(Dialog, { open: true, onOpenChange: open => { if (!open && !running.current)
            onClose(); }, children: _jsxs(DialogContent, { showCloseButton: !busy, onEscapeKeyDown: event => { if (running.current)
                event.preventDefault(); }, onInteractOutside: event => { if (running.current)
                event.preventDefault(); }, children: [_jsxs(DialogHeader, { children: [_jsx(DialogTitle, { children: request.title }), _jsxs(DialogDescription, { children: [request.scope, " The current filters are captured for this download."] })] }), _jsxs("fieldset", { className: "space-y-3", disabled: busy, children: [_jsx("legend", { className: "mb-2 text-sm font-semibold", children: "File format" }), _jsxs("label", { className: "export-option", children: [_jsx("input", { type: "radio", name: "task-download-format", value: "xlsx", checked: format === "xlsx", onChange: () => !running.current && setFormat("xlsx") }), _jsxs("span", { children: [_jsx("strong", { children: "Excel report \u00B7 Recommended" }), _jsx("small", { children: "A reading guide, clearly named columns, staff names and local dates. Technical evidence is kept in separate labelled worksheets." })] })] }), _jsxs("label", { className: "export-option", children: [_jsx("input", { type: "radio", name: "task-download-format", value: "json", checked: format === "json", onChange: () => !running.current && setFormat("json") }), _jsxs("span", { children: [_jsx("strong", { children: "JSON \u00B7 Technical data" }), _jsx("small", { children: "Original structured fields and internal identifiers for analysis, reconciliation or system integration." })] })] })] }), _jsx(MotionPresence, { children: error && _jsx("p", { className: "form-error", role: "alert", children: error }) }), _jsxs(DialogFooter, { children: [_jsx(Button, { variant: "outline", onClick: onClose, disabled: busy, children: _jsx("span", { className: "download-close-label", children: completion ? "Done" : "Cancel" }, completion ? "done" : "cancel") }), _jsx(DownloadAction, { onClick: () => void download(), disabled: busy, pending: busy, completion: completion, reviewKey: reviewKey, actionLabel: format === "xlsx" ? "Download Excel report" : "Download JSON data", children: format === "xlsx" ? "Download Excel report" : "Download JSON data" })] })] }) });
}
