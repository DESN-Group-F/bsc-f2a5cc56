import { z } from "zod";
import { getD1Database } from "@/db";
import { apiError, apiJson, requestJson, requestUser } from "@/lib/api";
import { datasetSchema } from "@/lib/domain";
import { sharedInventoryScope } from "@/lib/shared-inventory";
import { BatteryModelStore } from "@/lib/battery-model-store";
import { listReferenceModels } from "@/lib/battery-reference-catalog";

export const dynamic = "force-dynamic";
async function context(request: Request, dataset: unknown) {
    const actor = await requestUser(request), mode = datasetSchema.parse(dataset ?? "demo"), db = getD1Database();
    return new BatteryModelStore(db, await sharedInventoryScope(db, mode), mode, actor);
}
export async function GET(request: Request) {
    try {
        const url = new URL(request.url), result = await (await context(request, url.searchParams.get("dataset"))).list();
        return apiJson({ ...result, models: [...result.models, ...await listReferenceModels()] });
    } catch (error) { return apiError(error); }
}
export async function POST(request: Request) {
    try {
        const body = z.object({ dataset: datasetSchema.default("demo"), payload: z.unknown(), update: z.boolean().optional() }).strict().parse(await requestJson(request));
        const store = await context(request, body.dataset), result = body.update ? await store.update(body.payload) : await store.create(body.payload);
        return apiJson({ ok: true, result });
    } catch (error) { return apiError(error); }
}
