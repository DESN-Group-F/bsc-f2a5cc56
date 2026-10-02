import { z } from "zod";
import { getD1Database } from "@/db";
import { AccountStore } from "./accounts";
import { sessionToken } from "./credentials";
import { DomainError } from "./domain";
export function apiJson(value: unknown, status = 200, extra: Record<string, string> = {}) {
    return Response.json(value, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...extra } });
}
export function apiError(error: unknown) {
    if (error instanceof DomainError) return apiJson({ error: error.message, ...(error.code ? { code: error.code } : {}) }, error.status);
    if (error instanceof z.ZodError) return apiJson({ error: error.issues.map(issue => `${issue.path.join(".")}: ${issue.message}`).join("; ") }, 400);
    console.error("Application request failed", error);
    return apiJson({ error: "The service is unavailable. Your input has been preserved; please try again." }, 503);
}
export async function requestJson(request: Request, max = 250_000) {
    const origin = request.headers.get("origin");
    if (origin && origin !== new URL(request.url).origin) throw new DomainError(403, "Cross-origin changes are not allowed.");
    if (!request.headers.get("content-type")?.startsWith("application/json")) throw new DomainError(415, "Send changes as JSON.");
    const text = await request.text();
    if (text.length > max) throw new DomainError(413, "This request is too large.");
    try { return JSON.parse(text) as unknown; }
    catch { throw new DomainError(400, "The request is not valid JSON."); }
}
export async function requestUser(request: Request) {
    const user = await new AccountStore(getD1Database()).authenticate(sessionToken(request.headers.get("cookie")));
    if (!user) throw new DomainError(401, "Sign in with an active staff account.");
    return user;
}
