import { z } from "zod";
import { apiError, apiJson, requestJson, requestUser } from "@/lib/api";
import { getD1Database } from "@/db";
import { datasetSchema } from "@/lib/domain";
import { sharedInventoryScope } from "@/lib/shared-inventory";
import { TaskPlanStore } from "@/lib/task-plans";
import { taskPlanMatchesQuery } from "@/lib/task-schedule";

export const dynamic = "force-dynamic";
async function context(request: Request, dataset: unknown) {
    const actor = await requestUser(request), mode = datasetSchema.parse(dataset ?? "demo"), db = getD1Database();
    return new TaskPlanStore(db, await sharedInventoryScope(db, mode), mode, actor);
}
export async function GET(request: Request) {
    try {
        const url = new URL(request.url), download = z.enum(["json"]).optional().parse(url.searchParams.get("download") ?? undefined), search = z.string().max(200).parse(url.searchParams.get("search") ?? "");
        const visibility = z.enum(["current", "removed", "all"]).parse(url.searchParams.get("visibility") ?? "current");
        const result = await (await context(request, url.searchParams.get("dataset"))).list({ visibility });
        if (!download) return apiJson(result);
        const plans = result.plans.filter(plan => taskPlanMatchesQuery(plan, search)), planIds = new Set(plans.map(plan => plan.id)), cycles = result.cycles.filter(cycle => planIds.has(cycle.planId));
        return apiJson({ ...result, plans, cycles, generationIssues: result.generationIssues.filter(issue => planIds.has(issue.planId)), metadata: { dataset: datasetSchema.parse(url.searchParams.get("dataset") ?? "demo"), scope: "shared_task_records", visibility, search: search.trim(), totalPlans: result.plans.length, exportedPlans: plans.length, exportedCycles: cycles.length, generatedAt: new Date().toISOString() } }, 200, { "Content-Disposition": `attachment; filename="task-records-${datasetSchema.parse(url.searchParams.get("dataset") ?? "demo")}.json"` });
    } catch (error) { return apiError(error); }
}
export async function POST(request: Request) {
    try {
        const body = z.object({ dataset: datasetSchema.default("demo"), action: z.enum(["create", "update", "complete", "remove", "restore"]), payload: z.unknown(), requestId: z.string().uuid().optional() }).strict().parse(await requestJson(request));
        const store = await context(request, body.dataset);
        const result = body.action === "complete" ? await store.completeCycle(body.payload, body.requestId) : body.action === "remove" || body.action === "restore" ? await store.changePlanVisibility(body.payload, body.action, z.string().uuid().parse(body.requestId)) : await store.savePlan(body.payload, body.action === "update", body.requestId);
        return apiJson({ ok: true, result });
    } catch (error) { return apiError(error); }
}
