import { z } from "zod";
import { getD1Database } from "@/db";
import { AccountStore } from "@/lib/accounts";
import { apiError, apiJson, requestJson, requestUser } from "@/lib/api";
import { DomainError } from "@/lib/domain";
import { summaryCsv } from "@/lib/downloads";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
    try {
        const actor = await requestUser(request), store = new AccountStore(getD1Database());
        const url = new URL(request.url);
        if (url.searchParams.get("download") === "csv") {
            const search = z.string().max(200).parse(url.searchParams.get("search") ?? "");
            const result = await store.list(actor);
            const accounts = result.accounts.filter(account => `${account.username} ${account.displayName} ${account.email} ${account.role} ${account.active ? "active" : "disabled"}`.toLowerCase().includes(search.toLowerCase())).map(account => Object.fromEntries(Object.entries(account).filter(([field]) => field !== "authVersion")));
            return new Response(summaryCsv({ metadata: { exported_at_utc: new Date().toISOString(), operator: actor.displayName, search }, tables: { Accounts: accounts } }), { headers: { "Content-Type": "text/csv;charset=utf-8", "Content-Disposition": "attachment; filename=staff-accounts.csv", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
        }
        return apiJson(new URL(request.url).searchParams.get("scope") === "self" ? { user: actor } : await store.list(actor));
    } catch (error) { return apiError(error); }
}
export async function POST(request: Request) {
    try {
        const actor = await requestUser(request), body = z.object({ action: z.enum(["create", "update", "profile", "password"]), payload: z.unknown() }).parse(await requestJson(request, 10000));
        const store = new AccountStore(getD1Database());
        if (["create", "update"].includes(body.action) && actor.role !== "admin") throw new DomainError(403, "Only administrators can manage accounts.");
        const result = body.action === "create" ? await store.create(body.payload, actor) : body.action === "password" ? await store.changePassword(body.payload, actor) : await store.update(body.payload, actor, body.action === "profile");
        return apiJson({ ok: true, result });
    } catch (error) { return apiError(error); }
}
