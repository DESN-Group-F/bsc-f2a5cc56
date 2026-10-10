import { z } from "zod";
import { getD1Database } from "@/db";
import { apiError, apiJson, requestJson, requestUser } from "@/lib/api";
import { datasetSchema } from "@/lib/domain";
import { LocationStore } from "@/lib/server/inventory/location";
import { sharedInventoryScope } from "@/lib/shared-inventory";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const actor = await requestUser(request);
    const body = z.object({ dataset: datasetSchema, payload: z.unknown() }).strict().parse(await requestJson(request, 20_000));
    const db = getD1Database();
    const store = new LocationStore(db, await sharedInventoryScope(db, body.dataset), body.dataset, { id: actor.id, name: actor.displayName, role: actor.role, authVersion: actor.authVersion });
    return apiJson({ ok: true, result: await store.record(body.payload) });
  } catch (error) { return apiError(error); }
}
