"use client";
import { useState } from "react";
import { Upload, Download } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { parseCsv, importPayload } from "@/lib/client-utils";
import type { WriteAction } from "./movement-dialog";
export function ImportDialog({ kind, onClose, write }: {
    kind: "people" | "rooms" | "batteries";
    onClose: () => void;
    write: WriteAction;
}) {
    const [rows, setRows] = useState<Record<string, string>[]>([]), [records, setRecords] = useState<unknown[]>([]), [error, setError] = useState(""), [busy, setBusy] = useState(false), [filename, setFilename] = useState("");
    async function file(file: File | undefined) { setError(""); setRows([]); setRecords([]); if (!file)
        return; setFilename(file.name); try {
        if (file.size > 250000)
            throw new Error("Use a CSV file smaller than 250 KB.");
        const r = parseCsv(await file.text()), payload = importPayload(kind, r);
        setRows(r);
        setRecords(payload);
    }
    catch (e) {
        setError((e as Error).message);
    } }
    async function submit() { setError(""); setBusy(true); try {
        await write("import", null, { kind, records });
        onClose();
    }
    catch (e) {
        setError((e as Error).message);
    }
    finally {
        setBusy(false);
    } }
    return <Dialog open onOpenChange={o => !o && !busy && onClose()}><DialogContent className="import-dialog"><DialogHeader><DialogTitle>Import {kind}</DialogTitle><DialogDescription>Review up to 200 new records before importing. Existing IDs are not overwritten. Register people and rooms before importing batteries.</DialogDescription></DialogHeader>
    <Button variant="outline" asChild><a href={`/templates/${kind}.csv`} download><Download />Download CSV template</a></Button><div className="form-field"><Label htmlFor="import-file">Choose CSV file</Label><Input id="import-file" type="file" accept=".csv,text/csv" disabled={busy} onChange={e => file(e.target.files?.[0])}/></div>
    {!!rows.length && <><p className="field-hint">{filename} · {rows.length} records · first 5 rows shown</p><div className="import-preview"><Table><TableHeader><TableRow>{Object.keys(rows[0]).map(k => <TableHead key={k}>{k}</TableHead>)}</TableRow></TableHeader><TableBody>{rows.slice(0, 5).map((r, i) => <TableRow key={i}>{Object.entries(r).map(([k, v]) => <TableCell key={k}>{v || "—"}</TableCell>)}</TableRow>)}</TableBody></Table></div></>}
    {error && <p role="alert" className="form-error">{error}</p>}<DialogFooter><Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button><Button onClick={submit} disabled={busy || !records.length}><Upload />{busy ? "Importing…" : `Confirm import (${records.length})`}</Button></DialogFooter>
  </DialogContent></Dialog>;
}
