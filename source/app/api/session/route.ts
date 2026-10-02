import { env } from "cloudflare:workers";
import { z } from "zod";
import { getD1Database } from "@/db";
import { AccountStore } from "@/lib/accounts";
import { apiError, apiJson, requestJson } from "@/lib/api";
import { constantEqual, sessionCookie, sessionToken } from "@/lib/credentials";
import { DomainError } from "@/lib/domain";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
    try {
        const store = new AccountStore(getD1Database());
        return apiJson({ user: await store.authenticate(sessionToken(request.headers.get("cookie"))), setupRequired: await store.needsSetup() });
    } catch (error) { return apiError(error); }
}
export async function POST(request: Request) {
    try {
        const body = z.object({ action: z.enum(["signin", "signout", "setup"]), payload: z.unknown().optional(), setupKey: z.string().optional() }).parse(await requestJson(request, 5000));
        const store = new AccountStore(getD1Database()), secure = new URL(request.url).protocol === "https:";
        if (body.action === "signout") {
            await store.signOut(sessionToken(request.headers.get("cookie")));
            return apiJson({ ok: true }, 200, { "Set-Cookie": sessionCookie("", secure, true) });
        }
        if (body.action === "setup") {
            if (!env.INVENTORY_SETUP_KEY || !body.setupKey || !constantEqual(env.INVENTORY_SETUP_KEY, body.setupKey)) throw new DomainError(403, "Enter the administrator setup key configured for this installation.");
            const user = await store.create(body.payload);
            return apiJson({ ok: true, user });
        }
        const result = await store.signIn(body.payload);
        return apiJson({ user: result.user }, 200, { "Set-Cookie": sessionCookie(result.token, secure) });
    } catch (error) { return apiError(error); }
}
