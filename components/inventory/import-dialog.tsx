"use client";
import { useState } from "react";
import { Upload, Download } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { parseCsv, importPayload } from "@/lib/client-utils";
import type { WriteAction } from "@/lib/client/inventory-contracts";
export function ImportDialog({ kind, onClose, write }: {
    kind: "people" | "buildings" | "rooms" | "batteries";
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
    return <Dialog open onOpenChange={o => !o && !busy && onClose()}><DialogContent className="import-dialog"><DialogHeader><DialogTitle>Import {kind}</DialogTitle><DialogDescription>Review up to 200 new records before importing. Existing IDs are not overwritten. Battery owners must be staff account profiles; storage rooms may stay blank. Only J18 is currently supported for new locations.</DialogDescription></DialogHeader>
    <Button variant="outline" asChild><a href={`/templates/${kind}.csv`} download><Download />Download CSV template</a></Button>{kind === "batteries" && <p className="field-hint">For owner_id, copy an active Owner ID (CSV) from Manage records → Staff directory. You can also download that directory and use its id column. Account IDs (account_id) and usernames are not owner IDs. Replace REPLACE_WITH_OWNER_ID in the template before importing. Optional manufactured_on and first_used_on columns use YYYY-MM-DD dates. Leave unknown dates blank; first use must be on or after manufacture.</p>}{kind === "rooms" && <p className="field-hint">Imported rooms are marked as placeholders. Confirm their details in Manage records before marking them as verified.</p>}<div className="form-field"><Label htmlFor="import-file">Choose CSV file</Label><Input id="import-file" type="file" accept=".csv,text/csv" disabled={busy} onChange={e => file(e.target.files?.[0])}/></div>
    {!!rows.length && <><p className="field-hint">{filename} · {rows.length} records · first 5 rows shown</p><div className="import-preview"><Table><TableHeader><TableRow>{Object.keys(rows[0]).map(k => <TableHead key={k}>{k}</TableHead>)}</TableRow></TableHeader><TableBody>{rows.slice(0, 5).map((r, i) => <TableRow key={i}>{Object.entries(r).map(([k, v]) => <TableCell key={k}>{v || "—"}</TableCell>)}</TableRow>)}</TableBody></Table></div></>}
    {error && <p role="alert" className="form-error">{error}</p>}<DialogFooter><Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button><Button onClick={submit} disabled={busy || !records.length}><Upload />{busy ? "Importing…" : `Confirm import (${records.length})`}</Button></DialogFooter>
  </DialogContent></Dialog>;
}
