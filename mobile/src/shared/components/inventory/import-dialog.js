"use client";
import { jsxs as _jsxs, jsx as _jsx, Fragment as _Fragment } from "react/jsx-runtime";
import { useState } from "react";
import { Upload, Download } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "../ui/dialog.js";
import { Button } from "../ui/button.js";
import { Input } from "../ui/input.js";
import { Label } from "../ui/label.js";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "../ui/table.js";
import { parseCsv, importPayload } from "../../lib/client-utils.js";
export function ImportDialog({ kind, onClose, write }) {
    const [rows, setRows] = useState([]), [records, setRecords] = useState([]), [error, setError] = useState(""), [busy, setBusy] = useState(false), [filename, setFilename] = useState("");
    async function file(file) {
        setError("");
        setRows([]);
        setRecords([]);
        if (!file)
            return;
        setFilename(file.name);
        try {
            if (file.size > 250000)
                throw new Error("Use a CSV file smaller than 250 KB.");
            const r = parseCsv(await file.text()), payload = importPayload(kind, r);
            setRows(r);
            setRecords(payload);
        }
        catch (e) {
            setError(e.message);
        }
    }
    async function submit() {
        setError("");
        setBusy(true);
        try {
            await write("import", null, { kind, records });
            onClose();
        }
        catch (e) {
            setError(e.message);
        }
        finally {
            setBusy(false);
        }
    }
    return _jsx(Dialog, { open: true, onOpenChange: o => !o && !busy && onClose(), children: _jsxs(DialogContent, { className: "import-dialog", children: [_jsxs(DialogHeader, { children: [_jsxs(DialogTitle, { children: ["Import ", kind] }), _jsx(DialogDescription, { children: "Review up to 200 new records before importing. Existing IDs are not overwritten. Battery owners must be staff account profiles; storage rooms may stay blank. Only J18 is currently supported for new locations." })] }), _jsx(Button, { variant: "outline", asChild: true, children: _jsxs("a", { href: `/templates/${kind}.csv`, download: true, children: [_jsx(Download, {}), "Download CSV template"] }) }), kind === "batteries" && _jsx("p", { className: "field-hint", children: "For owner_id, copy an active Owner ID (CSV) from Manage records \u2192 Staff directory. You can also download that directory and use its id column. Account IDs (account_id) and usernames are not owner IDs. Replace REPLACE_WITH_OWNER_ID in the template before importing. Optional manufactured_on and first_used_on columns use YYYY-MM-DD dates. Leave unknown dates blank; first use must be on or after manufacture." }), kind === "rooms" && _jsx("p", { className: "field-hint", children: "Imported rooms are marked as placeholders. Confirm their details in Manage records before marking them as verified." }), _jsxs("div", { className: "form-field", children: [_jsx(Label, { htmlFor: "import-file", children: "Choose CSV file" }), _jsx(Input, { id: "import-file", type: "file", accept: ".csv,text/csv", disabled: busy, onChange: e => file(e.target.files?.[0]) })] }), !!rows.length && _jsxs(_Fragment, { children: [_jsxs("p", { className: "field-hint", children: [filename, " \u00B7 ", rows.length, " records \u00B7 first 5 rows shown"] }), _jsx("div", { className: "import-preview", children: _jsxs(Table, { children: [_jsx(TableHeader, { children: _jsx(TableRow, { children: Object.keys(rows[0]).map(k => _jsx(TableHead, { children: k }, k)) }) }), _jsx(TableBody, { children: rows.slice(0, 5).map((r, i) => _jsx(TableRow, { children: Object.entries(r).map(([k, v]) => _jsx(TableCell, { children: v || "—" }, k)) }, i)) })] }) })] }), error && _jsx("p", { role: "alert", className: "form-error", children: error }), _jsxs(DialogFooter, { children: [_jsx(Button, { variant: "outline", onClick: onClose, disabled: busy, children: "Cancel" }), _jsxs(Button, { onClick: submit, disabled: busy || !records.length, children: [_jsx(Upload, {}), busy ? "Importing…" : `Confirm import (${records.length})`] })] })] }) });
}
