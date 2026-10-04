import { csvCell } from "./client-utils";
import { DomainError } from "./domain";
import type { ExportDocument } from "./exports";
import { createHumanReport } from "./export-report";

type Row = Record<string, unknown>;
export type HumanReport = ReturnType<typeof createHumanReport>;
const cell = (value: unknown): string | number | boolean | Date => value == null ? "" : value instanceof Date ? value : typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? value : JSON.stringify(value);
const displayDate = (value: Date, time = false) => new Intl.DateTimeFormat("en-AU", { timeZone: "UTC", day: "2-digit", month: "short", year: "numeric", ...(time ? { hour: "2-digit", minute: "2-digit", hourCycle: "h23" as const } : {}) }).format(value);

export function summaryCsv(document: ExportDocument) {
    const report = createHumanReport(document), sheet = report.sheets[0];
    const records = sheet?.rows ?? [];
    const facts = Object.fromEntries(report.facts.map(fact => [fact.label, fact.value]));
    const rows = records.map(row => ({ ...row, "Report inventory": facts.Inventory ?? document.metadata.dataset, "Report created (Sydney)": facts["Report created (Sydney)"] ?? "Not recorded", "Report scope": facts["Download scope"] ?? "Not recorded", "Report filters": facts.Filters ?? "No additional filters", "Records in this file": records.length }));
    const fields = [...new Set(rows.flatMap(row => Object.keys(row)))];
    if (!fields.length) fields.push(...(sheet?.columns ?? ["No matching records"]));
    return "\uFEFF" + [fields, ...rows.map(row => fields.map(field => {
        const value = cell((row as Row)[field]);
        return value instanceof Date ? displayDate(value, /\(Sydney\)/.test(field)) : value;
    }))].map(row => row.map(csvCell).join(",")).join("\r\n");
}

export async function excelBuffer(document: ExportDocument, report: HumanReport = createHumanReport(document)) {
    // The bare writer preserves surrogate pairs across ZIP chunks without process-wide patches.
    // @ts-expect-error ExcelJS supplies types only for its root entry; the bare bundle implements the same Workbook API.
    const ExcelJS = (await import("exceljs/dist/exceljs.bare.js")).default as typeof import("exceljs");
    const workbook = new ExcelJS.Workbook();
    workbook.creator = String(document.metadata.operator ?? "admin");
    workbook.created = new Date(String(document.metadata.exported_at_utc));
    const longValues: Row[] = [], usedNames = new Set<string>();
    function sheetName(requested: string) {
        const base = requested.replace(/[\\/*?:\[\]]/g, " ").slice(0, 31);
        let name = base, suffix = 1;
        while (usedNames.has(name.toLowerCase())) name = `${base.slice(0, 26)} ${++suffix}`;
        usedNames.add(name.toLowerCase());
        return name;
    }
    function addTable(requestedName: string, description: string, rows: Row[], technical = false, columns?: string[]) {
        if (rows.length > 1_048_572) throw new DomainError(400, "This section exceeds the Excel worksheet row limit. Download JSON to retain all records.");
        const name = sheetName(requestedName), worksheet = workbook.addWorksheet(name);
        const fields = [...new Set([...(columns ?? []), ...rows.flatMap(row => Object.keys(row))])];
        if (!fields.length) fields.push("Records");
        worksheet.properties.defaultRowHeight = 21;
        worksheet.properties.tabColor = { argb: technical ? "FF9B9B93" : "FFFFDF00" };
        if (technical) worksheet.state = "hidden";
        worksheet.columns = fields.map(key => ({ key, width: technical ? (/json|value/.test(key) ? 65 : 24) : /description|instructions|findings|notes|meaning|summary|purpose|details|basis|what happened|what must be done|message text/i.test(key) ? 58 : /email/i.test(key) ? 34 : /Sydney|date|time|reminder/i.test(key) ? 25 : /name|owner|holder|staff|target|title/i.test(key) ? 30 : Math.min(28, Math.max(18, key.length + 2)) }));
        const span = Math.min(8, Math.max(2, fields.length));
        worksheet.mergeCells(1, 1, 1, span);
        worksheet.getCell(1, 1).value = requestedName;
        worksheet.getRow(1).height = 34;
        worksheet.getCell(1, 1).font = { name: "Calibri", size: 16, bold: true, color: { argb: "FF161616" } };
        worksheet.getCell(1, 1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: technical ? "FFE8E8E3" : "FFFFDF00" } };
        worksheet.mergeCells(2, 1, 2, span);
        worksheet.getCell(2, 1).value = description;
        worksheet.getCell(2, 1).font = { name: "Calibri", size: 11, color: { argb: "FF40403B" } };
        worksheet.getCell(2, 1).alignment = { vertical: "middle", wrapText: true };
        worksheet.getRow(2).height = 42;
        const header = worksheet.getRow(4); header.values = fields; header.height = 36;
        header.eachCell(value => {
            value.font = { name: "Calibri", size: 11, bold: true, color: { argb: "FFFFFFFF" } };
            value.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF242421" } };
            value.alignment = { vertical: "middle", wrapText: true };
        });
        rows.forEach((row, rowIndex) => {
            const values = fields.map(field => {
                const value = cell(row[field]);
                if (typeof value !== "string" || value.length <= 32000) return value;
                let offset = 0, part = 0;
                while (offset < value.length) {
                    let end = Math.min(offset + 32000, value.length);
                    if (end < value.length && /[\uD800-\uDBFF]/.test(value[end - 1])) end--;
                    longValues.push({ worksheet: name, record_number: rowIndex + 1, field, part: ++part, value: value.slice(offset, end) }); offset = end;
                }
                return "See Complete text worksheet; all parts are preserved.";
            });
            const saved = worksheet.addRow(values);
            let lines = 1;
            saved.eachCell({ includeEmpty: true }, (value, index) => {
                value.font = { name: "Calibri", size: 11, color: { argb: "FF242421" } };
                value.alignment = { vertical: "top", horizontal: typeof value.value === "number" ? "right" : "left", indent: 1, wrapText: true };
                value.fill = { type: "pattern", pattern: "solid", fgColor: { argb: rowIndex % 2 ? "FFF5F5F0" : "FFFFFFFF" } };
                value.border = { bottom: { style: "hair", color: { argb: "FFE2E2DC" } } };
                if (value.value instanceof Date) value.numFmt = /\(Sydney\)/.test(fields[index - 1]) ? "dd mmm yyyy hh:mm" : "dd mmm yyyy";
                else if (typeof value.value === "number") value.numFmt = Number.isInteger(value.value) ? "#,##0" : "0.##########";
                else value.numFmt = "@";
                const text = String(value.value ?? "");
                const usableWidth = Math.max(12, ((worksheet.getColumn(index).width ?? 24) - 2) * 0.85);
                lines = Math.max(lines, text.split("\n").reduce((total, line) => total + Math.max(1, Math.ceil(line.length / usableWidth)), 0));
            });
            saved.height = Math.min(360, Math.max(26, lines * 15 + 10));
        });
        if (!rows.length) worksheet.addRow(["No records match the selected scope."]);
        worksheet.views = [{ state: "frozen", ySplit: 4, xSplit: fields.length > 3 ? 1 : 0, showGridLines: false }];
        worksheet.autoFilter = { from: { row: 4, column: 1 }, to: { row: Math.max(4, rows.length + 4), column: fields.length } };
        worksheet.pageSetup = { orientation: "landscape", paperSize: 9, fitToPage: false, printTitlesRow: "1:4" };
        worksheet.headerFooter.oddFooter = "&LBattery inventory report&RPage &P of &N";
        return worksheet;
    }
    const guideRows: Row[] = [
        ...report.facts.map(fact => ({ Topic: fact.label, Explanation: fact.value })),
        { Topic: "How to use this report", Explanation: "Read the yellow business worksheets first. Each has a purpose statement, readable column names and filters. This is a saved snapshot; changes in the website do not update this file." },
        ...report.sheets.map(sheet => ({ Topic: sheet.name, Explanation: `${sheet.description} ${sheet.rows.length} record(s).` })),
        { Topic: "Technical evidence appendix", Explanation: "Evidence worksheets retain original fields, internal links and exact recorded JSON. These and Complete text (when needed for long values) are hidden initially. In Excel, right-click a worksheet tab and choose Unhide to inspect them. They are not forms to fill in. JSON provides the same technical data without spreadsheet formatting." },
        { Topic: "Internal IDs and keys", Explanation: "These link records inside the system. They are not battery names, people, error codes or fields you need to complete. Battery IDs such as BAT-001 remain the normal reference for staff." },
        ...report.glossary.map(item => ({ Topic: item.term, Explanation: item.meaning })),
    ];
    const guide = addTable("Report guide", `${report.title}. ${report.description}`, guideRows, false, ["Topic", "Explanation"]);
    guide.getColumn(1).width = 32; guide.getColumn(2).width = 110;
    guide.eachRow((row, index) => { if (index > 4) row.height = Math.max(32, Math.min(150, Math.ceil(String(row.getCell(2).value ?? "").length / 100) * 17 + 12)); });
    for (const sheet of report.sheets) addTable(sheet.name, sheet.description, sheet.rows, false, sheet.columns);
    addTable("Evidence export", "Technical appendix: original export scope, filters and timestamps. See Report guide for the readable explanation.", Object.entries(document.metadata).map(([field, value]) => ({ field, value: cell(value) })), true);
    for (const [name, rows] of Object.entries(document.tables)) addTable(`Evidence ${name}`, `Technical appendix: original ${name} records in source order. Business worksheets provide the readable view. Blank values mean not recorded.`, rows, true);
    if (longValues.length) addTable("Complete text", "Long source text split into ordered parts to meet Excel cell limits. Join value by worksheet, record_number and field, in ascending part order. Nothing is omitted.", longValues, true);
    return new Uint8Array(await workbook.xlsx.writeBuffer());
}
