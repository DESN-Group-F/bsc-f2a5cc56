import { z } from "zod";
import { apiError, apiJson, requestJson, requestUser } from "@/lib/api";
import { getD1Database } from "@/db";
import { datasetSchema } from "@/lib/domain";
import { sharedInventoryScope } from "@/lib/shared-inventory";
import { TaskPlanStore } from "@/lib/task-plans";
import { excelBuffer } from "@/lib/downloads";
import { createMessageReportDocument } from "@/lib/task-export-report";

export const dynamic = "force-dynamic";
async function context(request: Request, dataset: unknown) {
    const actor = await requestUser(request), mode = datasetSchema.parse(dataset ?? "demo"), db = getD1Database();
    return { actor, db, mode, store: new TaskPlanStore(db, await sharedInventoryScope(db, mode), mode, actor) };
}
export async function GET(request: Request) {
    try {
        const url = new URL(request.url), allUnread = z.enum(["true", "false"]).parse(url.searchParams.get("allUnread") ?? "false") === "true";
        const readState = z.enum(["all", "unread", "read"]).parse(url.searchParams.get("readState") ?? (allUnread ? "unread" : "all")), taskStatus = z.enum(["all", "open", "completed"]).parse(url.searchParams.get("taskStatus") ?? "all");
        const search = z.string().max(200).parse(url.searchParams.get("search") ?? ""), download = z.enum(["json", "xlsx"]).optional().parse(url.searchParams.get("download") ?? undefined), countOnly = z.enum(["true", "false"]).parse(url.searchParams.get("countOnly") ?? "false") === "true";
        const { store, actor, db, mode } = await context(request, url.searchParams.get("dataset"));
        if (countOnly && !download) return apiJson(await store.messageCounts());
        const visibility = z.enum(["current", "removed", "all"]).parse(url.searchParams.get("visibility") ?? "current");
        const result = await store.messages({ visibility, readState, taskStatus, search });
        if (!download) return apiJson(result);
        const source = { ...result, metadata: { dataset: mode, scope: "personal_messages", recipientId: actor.id, filters: { visibility, allUnread: readState === "unread", readState, taskStatus, search: search.trim() }, exportedMessages: result.messages.length, generatedAt: new Date().toISOString() } };
        if (download === "xlsx") {
            const ids = [...new Set(result.messages.flatMap(message => [...message.cycle.assigneeIds, ...message.cycle.currentAssigneeIds]))];
            const accounts = await db.prepare("SELECT id,display_name AS displayName,username,active FROM staff_accounts WHERE id IN (SELECT value FROM json_each(?)) ORDER BY display_name,username").bind(JSON.stringify(ids)).all<{ id: string; displayName: string; username: string; active: number }>();
            const staffDirectory = accounts.results.map(account => ({ ...account, active: account.active === 1 }));
            const { document, report } = createMessageReportDocument(source, { dataset: mode, operator: actor, staffDirectory });
            return new Response(Uint8Array.from(await excelBuffer(document, report)).buffer, { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="messages-report-${mode}.xlsx"`, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
        }
        return apiJson(source, 200, { "Content-Disposition": `attachment; filename="messages-${mode}.json"` });
    } catch (error) { return apiError(error); }
}
export async function POST(request: Request) {
    try {
        const body = z.object({ dataset: datasetSchema.default("demo"), action: z.enum(["read", "remove", "restore"]), payload: z.unknown(), requestId: z.string().uuid().optional() }).strict().parse(await requestJson(request));
        const { store } = await context(request, body.dataset), result = body.action === "read" ? await store.markRead(body.payload) : await store.changeMessageVisibility(body.payload, body.action, z.string().uuid().parse(body.requestId));
        return apiJson({ ok: true, result });
    } catch (error) { return apiError(error); }
}
