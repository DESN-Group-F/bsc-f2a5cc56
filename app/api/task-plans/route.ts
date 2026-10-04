import { z } from "zod";
import { apiError, apiJson, requestJson, requestUser } from "@/lib/api";
import { getD1Database } from "@/db";
import { datasetSchema } from "@/lib/domain";
import { sharedInventoryScope } from "@/lib/shared-inventory";
import { TaskPlanStore } from "@/lib/task-plans";
import { taskPlanMatchesQuery } from "@/lib/task-schedule";
import { excelBuffer } from "@/lib/downloads";
import { createTaskReportDocument } from "@/lib/task-export-report";

export const dynamic = "force-dynamic";
async function context(request: Request, dataset: unknown) {
    const actor = await requestUser(request), mode = datasetSchema.parse(dataset ?? "demo"), db = getD1Database();
    return { actor, mode, db, store: new TaskPlanStore(db, await sharedInventoryScope(db, mode), mode, actor) };
}
export async function GET(request: Request) {
    try {
        const url = new URL(request.url), download = z.enum(["json", "xlsx"]).optional().parse(url.searchParams.get("download") ?? undefined), search = z.string().max(200).parse(url.searchParams.get("search") ?? "");
        const visibility = z.enum(["current", "removed", "all"]).parse(url.searchParams.get("visibility") ?? "current");
        const { store, actor, mode, db } = await context(request, url.searchParams.get("dataset"));
        const result = await store.list({ visibility });
        if (!download) return apiJson(result);
        const plans = result.plans.filter(plan => taskPlanMatchesQuery(plan, search)), planIds = new Set(plans.map(plan => plan.id)), cycles = result.cycles.filter(cycle => planIds.has(cycle.planId));
        const source = { ...result, plans, cycles, generationIssues: result.generationIssues.filter(issue => planIds.has(issue.planId)), metadata: { dataset: mode, scope: "shared_task_records", visibility, search: search.trim(), totalPlans: result.plans.length, exportedPlans: plans.length, exportedCycles: cycles.length, generatedAt: new Date().toISOString() } };
        if (download === "xlsx") {
            const areaIds = [...new Set(plans.filter(plan => plan.targetKind === "storage_area" && plan.targetRef).map(plan => plan.targetRef))];
            const areas = await db.prepare("SELECT r.id,r.name,r.number,r.is_placeholder AS isPlaceholder,b.id AS buildingId,b.name AS buildingName FROM rooms r JOIN buildings b ON b.key=r.building_key WHERE r.scope=? AND r.id IN (SELECT value FROM json_each(?))").bind(store.scope, JSON.stringify(areaIds)).all<{ id: string; name: string; number: string | null; isPlaceholder: number; buildingId: string; buildingName: string }>();
            const storageAreas = areas.results.map(area => ({ ...area, isPlaceholder: area.isPlaceholder === 1 }));
            const { document, report } = createTaskReportDocument(source, { dataset: mode, operator: actor, staffDirectory: result.staffDirectory, storageAreas });
            return new Response(Uint8Array.from(await excelBuffer(document, report)).buffer, { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="task-report-${mode}.xlsx"`, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
        }
        return apiJson(source, 200, { "Content-Disposition": `attachment; filename="task-records-${mode}.json"` });
    } catch (error) { return apiError(error); }
}
export async function POST(request: Request) {
    try {
        const body = z.object({ dataset: datasetSchema.default("demo"), action: z.enum(["create", "update", "complete", "remove", "restore"]), payload: z.unknown(), requestId: z.string().uuid().optional() }).strict().parse(await requestJson(request));
        const { store } = await context(request, body.dataset);
        const result = body.action === "complete" ? await store.completeCycle(body.payload, body.requestId) : body.action === "remove" || body.action === "restore" ? await store.changePlanVisibility(body.payload, body.action, z.string().uuid().parse(body.requestId)) : await store.savePlan(body.payload, body.action === "update", body.requestId);
        return apiJson({ ok: true, result });
    } catch (error) { return apiError(error); }
}
