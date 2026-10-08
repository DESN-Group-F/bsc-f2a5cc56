import { z } from "zod";
import { getD1Database } from "@/db";
import { apiError, apiJson, requestJson, requestUser } from "@/lib/api";
import { datasetSchema, DomainError } from "@/lib/domain";
import { createTeachingCheckoutExport } from "@/lib/teaching-checkout-export";
import { excelBuffer } from "@/lib/downloads";
import { sharedInventoryScope } from "@/lib/shared-inventory";
import { TeachingCheckoutStore } from "@/lib/server/inventory/teaching-checkouts";
export const dynamic = "force-dynamic";
async function context(request: Request, dataset: unknown) {
  const user = await requestUser(request), mode = datasetSchema.parse(dataset ?? "demo"), db = getD1Database();
  return new TeachingCheckoutStore(db, await sharedInventoryScope(db, mode), mode, { id: user.id, name: user.displayName, role: user.role, authVersion: user.authVersion });
}
export async function GET(request: Request) {
  try {
    const url = new URL(request.url), runId = url.searchParams.get("runId");
    const store = await context(request, url.searchParams.get("dataset"));
    const checkedRunId = runId ? z.string().uuid().parse(runId) : undefined;
    if (!url.searchParams.has("format")) return apiJson({ runs: await store.list(checkedRunId) });
    const format = z.enum(["json", "xlsx"]).parse(url.searchParams.get("format"));
    if (!runId) throw new DomainError(400, "Select a specific teaching checkout before downloading its actual loan evidence.");
    const { run, loans, events, operator } = await store.export(checkedRunId!);
    const document = createTeachingCheckoutExport(run, { loans, events });
    Object.assign(document.metadata, { operator: operator.name, operatorAccountId: operator.accountId });
    const body = format === "xlsx" ? Uint8Array.from(await excelBuffer(document)).buffer : JSON.stringify(document, null, 2);
    return new Response(body, { headers: { "Content-Type": format === "xlsx" ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "application/json", "Content-Disposition": `attachment; filename="teaching-checkout-${run.id}.${format}"`, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
  } catch (error) { return apiError(error); }
}
export async function POST(request: Request) {
  try {
    const body = z.object({ dataset: datasetSchema, payload: z.unknown() }).strict().parse(await requestJson(request));
    return apiJson({ ok: true, result: await (await context(request, body.dataset)).save(body.payload) });
  } catch (error) { return apiError(error); }
}
