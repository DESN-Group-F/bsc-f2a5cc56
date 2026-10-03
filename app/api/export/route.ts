import { getD1Database } from "@/db";
import { requestUser, requestJson, apiJson, apiError } from "@/lib/api";
import { DomainError, datasetSchema, type Dataset } from "@/lib/domain";
import { sharedInventoryScope } from "@/lib/shared-inventory";
import { InventoryStore } from "@/lib/store";
import { createExport, type ExportDocument } from "@/lib/exports";
import { excelBuffer, summaryCsv } from "@/lib/downloads";
import { z } from "zod";
export const dynamic = "force-dynamic";
const formatSchema = z.enum(["xlsx", "csv", "json"]);
async function attachmentResponse(document: ExportDocument, input: unknown, dataset: Dataset, format: z.infer<typeof formatSchema>) {
    const requested = input as { batteryId?: string; mode: string; kind?: string; activityDepth?: string };
    if (format === "csv" && (requested.mode === "detail" || requested.mode === "activity" && requested.activityDepth === "battery_details")) throw new DomainError(400, "Detailed exports contain multiple tables. Choose Excel or JSON to retain all selected information.");
    const date = new Date().toISOString().replace(/[:.]/g, "-"), label = `${requested.batteryId ?? requested.kind ?? requested.mode}`.replace(/[^A-Za-z0-9._-]/g, "_");
    const type = format === "xlsx" ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : format === "csv" ? "text/csv;charset=utf-8" : "application/json";
    const body = format === "xlsx" ? Uint8Array.from(await excelBuffer(document)).buffer : format === "csv" ? summaryCsv(document) : JSON.stringify(document, null, 2);
    return new Response(body, { headers: { "Content-Type": type, "Content-Disposition": `attachment; filename="battery-${label}-${dataset}-${date}.${format}"`, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}
export async function GET(request: Request) {
    try {
        const actor = await requestUser(request), url = new URL(request.url);
        const encoded = z.string().min(1).max(15000).parse(url.searchParams.get("request"));
        let input: unknown;
        try { input = JSON.parse(encoded); } catch { return apiJson({ error: "Invalid export request." }, 400); }
        const format = formatSchema.parse(url.searchParams.get("format")), dataset = datasetSchema.parse((input as { dataset?: unknown })?.dataset), db = getD1Database();
        const store = new InventoryStore(db, await sharedInventoryScope(db, dataset), dataset, { id: actor.id, name: actor.displayName, role: actor.role, authVersion: actor.authVersion });
        return await attachmentResponse(await createExport(store, input), input, dataset, format);
    } catch (error) { return apiError(error); }
}
export async function POST(request: Request) {
    try {
        const actor = await requestUser(request), formatValue = new URL(request.url).searchParams.get("format"), format = formatValue === null ? null : formatSchema.parse(formatValue);
        const input = await requestJson(request, 15000), dataset = datasetSchema.parse((input as { dataset?: unknown })?.dataset), db = getD1Database();
        const store = new InventoryStore(db, await sharedInventoryScope(db, dataset), dataset, { id: actor.id, name: actor.displayName, role: actor.role, authVersion: actor.authVersion });
        const document = await createExport(store, input);
        return format === null ? apiJson(document) : await attachmentResponse(document, input, dataset, format);
    } catch (error) { return apiError(error); }
}
