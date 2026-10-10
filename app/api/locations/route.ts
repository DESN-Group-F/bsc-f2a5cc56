import { z } from "zod";
import { getD1Database } from "@/db";
import { apiError, apiJson, requestJson, requestUser } from "@/lib/api";
import { datasetSchema } from "@/lib/domain";
import { LocationStore } from "@/lib/server/inventory/location";
import { sharedInventoryScope } from "@/lib/shared-inventory";

export const dynamic = "force-dynamic";

async function context(request: Request, dataset: unknown) {
  const actor = await requestUser(request), mode = datasetSchema.parse(dataset ?? "demo"), db = getD1Database();
  return new LocationStore(db, await sharedInventoryScope(db, mode), mode, { id: actor.id, name: actor.displayName, role: actor.role, authVersion: actor.authVersion });
}

export async function GET(request: Request) {
  try { return apiJson(await (await context(request, new URL(request.url).searchParams.get("dataset"))).list()); }
  catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  try {
    const body = z.object({ dataset: datasetSchema, action: z.enum(["create", "update"]), payload: z.record(z.unknown()) }).strict().parse(await requestJson(request, 20_000));
    if ("action" in body.payload) return apiJson({ error: "Specify the beacon action once, outside the payload." }, 400);
    return apiJson({ ok: true, result: await (await context(request, body.dataset)).saveBeacon({ ...body.payload, action: body.action }) });
  } catch (error) { return apiError(error); }
}
