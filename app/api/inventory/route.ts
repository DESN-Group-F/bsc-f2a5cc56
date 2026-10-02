import { getAuthenticatedUser } from "@/lib/auth";
import { getD1Database } from "@/db";
import { InventoryStore } from "@/lib/store";
import { datasetSchema, identifier, DomainError } from "@/lib/domain";
import { z } from "zod";
export const dynamic = "force-dynamic";
function json(value: unknown, status = 200) { return Response.json(value, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } }); }
async function context(dataset: unknown) {
    const actor = await getAuthenticatedUser();
    if (!actor)
        throw new DomainError(401, "Sign in to access the inventory.");
    const mode = datasetSchema.parse(dataset ?? "demo");
    return new InventoryStore(getD1Database(), `${actor.userId}:${mode}`, mode, { id: actor.userId, name: actor.displayName });
}
function fail(error: unknown) {
    if (error instanceof DomainError)
        return json({ error: error.message, ...(error.code ? { code: error.code } : {}) }, error.status);
    if (error instanceof z.ZodError)
        return json({ error: error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; ") }, 400);
    console.error("Inventory operation failed", error);
    return json({ error: "The inventory could not complete this operation. Your input has been preserved; please try again." }, 503);
}
export async function GET(request: Request) {
    try {
        const url = new URL(request.url), store = await context(url.searchParams.get("dataset"));
        const id = url.searchParams.get("batteryId");
        return json(id ? await store.detail(identifier.parse(id)) : await store.snapshot());
    }
    catch (e) {
        return fail(e);
    }
}
export async function POST(request: Request) {
    try {
        const origin = request.headers.get("origin");
        if (origin && origin !== new URL(request.url).origin)
            throw new DomainError(403, "Cross-origin changes are not allowed.");
        if (!request.headers.get("content-type")?.startsWith("application/json"))
            throw new DomainError(415, "Send changes as JSON.");
        const text = await request.text();
        if (text.length > 250000)
            throw new DomainError(413, "This upload is too large. Import at most 200 rows.");
        let raw: unknown;
        try {
            raw = JSON.parse(text);
        }
        catch {
            throw new DomainError(400, "The request is not valid JSON.");
        }
        const body = z.object({ dataset: datasetSchema.default("demo"), action: z.string(), payload: z.unknown().optional(), update: z.boolean().optional(), kind: z.string().optional(), records: z.array(z.unknown()).optional() }).parse(raw);
        const store = await context(body.dataset), payload = body.payload;
        let result;
        switch (body.action) {
            case "initialize_demo":
                result = await store.initializeDemo();
                break;
            case "movement":
                result = await store.movement(payload);
                break;
            case "person":
                result = await store.savePerson(payload, body.update === true);
                break;
            case "room":
                result = await store.saveRoom(payload, body.update === true);
                break;
            case "building":
                result = await store.saveBuilding(payload, body.update === true);
                break;
            case "battery":
                result = await store.saveBattery(payload, body.update === true);
                break;
            case "charge":
                result = await store.charge(payload);
                break;
            case "observation":
                result = await store.observation(payload);
                break;
            case "correction":
                result = await store.correctLoan(payload);
                break;
            case "import":
                result = await store.importRecords(body.kind ?? "", body.records ?? []);
                break;
            default: throw new DomainError(400, "Unknown inventory operation.");
        }
        return json({ ok: true, result });
    }
    catch (e) {
        return fail(e);
    }
}
