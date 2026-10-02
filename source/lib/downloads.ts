import { csvCell } from "./client-utils";
import { DomainError } from "./domain";
import type { ExportDocument } from "./exports";
type Row = Record<string, unknown>;
const cell = (value: unknown): string | number | boolean => value == null ? "" : typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? value : JSON.stringify(value);
export function summaryCsv(document: ExportDocument) {
    const records = Object.values(document.tables)[0] ?? [];
    const rows = records.map(row => ({ ...row, exported_at_utc: document.metadata.exported_at_utc, export_record_count: records.length, filters_json: JSON.stringify(document.metadata.filters ?? {}), ...(document.metadata.search !== undefined ? { search_query: document.metadata.search } : {}), ...(document.metadata.activity_scope !== undefined ? { activity_scope: document.metadata.activity_scope } : {}) }));
    const fields = [...new Set(rows.flatMap(row => Object.keys(row)))];
    return "\uFEFF" + [fields, ...rows.map(row => fields.map(field => cell((row as Row)[field])))].map(row => row.map(csvCell).join(",")).join("\r\n");
}
export async function excelBuffer(document: ExportDocument) {
    // The published browser writer encodes complete XML strings before ZIP chunking, preserving surrogate pairs without global patches.
    // @ts-expect-error ExcelJS supplies types only for its root entry; the bare bundle implements the same Workbook API used here.
    const ExcelJS = (await import("exceljs/dist/exceljs.bare.js")).default as typeof import("exceljs");
    const workbook = new ExcelJS.Workbook();
    workbook.creator = String(document.metadata.operator ?? "admin"); workbook.created = new Date(String(document.metadata.exported_at_utc));
    const longValues: Row[] = [];
    function addTable(name: string, rows: Row[]) {
        if (rows.length > 1_048_575) throw new DomainError(400, "This section exceeds the Excel worksheet row limit. Download JSON to retain all records.");
        const worksheet = workbook.addWorksheet(name.slice(0, 31));
        const fields = [...new Set(rows.flatMap(row => Object.keys(row)))];
        if (!fields.length) { worksheet.addRow(["No records in this section"]); return; }
        worksheet.columns = fields.map(key => ({ header: key, key, width: Math.min(36, Math.max(18, key.length + 3)) }));
        rows.forEach((row, rowIndex) => {
            const values = Object.fromEntries(fields.map(field => {
                const value = cell(row[field]);
                if (typeof value !== "string" || value.length <= 32000) return [field, value];
                let offset = 0, part = 0;
                while (offset < value.length) {
                    let end = Math.min(offset + 32000, value.length);
                    if (end < value.length && /[\uD800-\uDBFF]/.test(value[end - 1])) end--;
                    longValues.push({ worksheet: name, record_number: rowIndex + 1, field, part: ++part, value: value.slice(offset, end) }); offset = end;
                }
                return [field, "See Complete text worksheet; all parts are preserved."];
            }));
            worksheet.addRow(values);
        });
        worksheet.views = [{ state: "frozen", ySplit: 1 }]; worksheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: fields.length } };
        worksheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } }; worksheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF234A69" } };
    }
    addTable("Export information", Object.entries(document.metadata).map(([field, value]) => ({ field, value: cell(value) })));
    for (const [name, rows] of Object.entries(document.tables)) addTable(name, rows);
    if (longValues.length) addTable("Complete text", longValues);
    return new Uint8Array(await workbook.xlsx.writeBuffer());
}
