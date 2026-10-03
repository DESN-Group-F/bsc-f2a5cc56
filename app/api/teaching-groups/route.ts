import { z } from "zod";
import { getD1Database } from "@/db";
import { apiError, apiJson, requestJson, requestUser } from "@/lib/api";
import { datasetSchema } from "@/lib/domain";
import { sharedInventoryScope } from "@/lib/shared-inventory";
import { TeachingGroupStore } from "@/lib/teaching-group-store";
export const dynamic = "force-dynamic";
async function context(request: Request, dataset: unknown) {
    const user = await requestUser(request), mode = datasetSchema.parse(dataset ?? "demo"), db = getD1Database();
    return new TeachingGroupStore(db, await sharedInventoryScope(db, mode), mode, { id: user.id, name: user.displayName, role: user.role, authVersion: user.authVersion });
}
export async function GET(request: Request) {
    try { return apiJson({ groups: await (await context(request, new URL(request.url).searchParams.get("dataset"))).list() }); }
    catch (error) { return apiError(error); }
}
export async function POST(request: Request) {
    try {
        const body = z.object({ dataset: datasetSchema, payload: z.unknown() }).strict().parse(await requestJson(request));
        return apiJson({ ok: true, result: await (await context(request, body.dataset)).save(body.payload) });
    } catch (error) { return apiError(error); }
}
