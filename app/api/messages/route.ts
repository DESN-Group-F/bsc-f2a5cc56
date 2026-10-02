import { z } from "zod";
import { apiError, apiJson, requestJson, requestUser } from "@/lib/api";
import { getD1Database } from "@/db";
import { datasetSchema } from "@/lib/domain";
import { sharedInventoryScope } from "@/lib/shared-inventory";
import { TaskPlanStore } from "@/lib/task-plans";

export const dynamic = "force-dynamic";
async function context(request: Request, dataset: unknown) {
    const actor = await requestUser(request), mode = datasetSchema.parse(dataset ?? "demo"), db = getD1Database();
    return { actor, store: new TaskPlanStore(db, await sharedInventoryScope(db, mode), mode, actor) };
}
export async function GET(request: Request) {
    try {
        const url = new URL(request.url), allUnread = z.enum(["true", "false"]).parse(url.searchParams.get("allUnread") ?? "false") === "true";
        const readState = z.enum(["all", "unread", "read"]).parse(url.searchParams.get("readState") ?? (allUnread ? "unread" : "all")), taskStatus = z.enum(["all", "open", "completed"]).parse(url.searchParams.get("taskStatus") ?? "all");
        const search = z.string().max(200).parse(url.searchParams.get("search") ?? ""), download = z.enum(["json"]).optional().parse(url.searchParams.get("download") ?? undefined), countOnly = z.enum(["true", "false"]).parse(url.searchParams.get("countOnly") ?? "false") === "true";
        const { store, actor } = await context(request, url.searchParams.get("dataset"));
        if (countOnly && !download) return apiJson(await store.messageCounts());
        const result = await store.messages({ readState, taskStatus, search });
        if (!download) return apiJson(result);
        return apiJson({ ...result, metadata: { dataset: datasetSchema.parse(url.searchParams.get("dataset") ?? "demo"), scope: "personal_messages", recipientId: actor.id, filters: { allUnread: readState === "unread", readState, taskStatus, search: search.trim() }, exportedMessages: result.messages.length, generatedAt: new Date().toISOString() } }, 200, { "Content-Disposition": `attachment; filename="messages-${datasetSchema.parse(url.searchParams.get("dataset") ?? "demo")}.json"` });
    } catch (error) { return apiError(error); }
}
export async function POST(request: Request) {
    try {
        const body = z.object({ dataset: datasetSchema.default("demo"), action: z.literal("read"), payload: z.unknown() }).strict().parse(await requestJson(request));
        const { store } = await context(request, body.dataset), result = await store.markRead(body.payload);
        return apiJson({ ok: true, result });
    } catch (error) { return apiError(error); }
}
