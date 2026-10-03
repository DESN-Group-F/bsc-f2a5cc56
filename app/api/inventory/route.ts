import { requestUser, requestJson, apiJson as json, apiError } from "@/lib/api";
import { sharedInventoryScope } from "@/lib/shared-inventory";
import { getD1Database } from "@/db";
import { InventoryStore } from "@/lib/store";
import { IntakeStore } from "@/lib/intake-store";
import { datasetSchema, identifier, DomainError } from "@/lib/domain";
import { z } from "zod";
export const dynamic = "force-dynamic";
async function context(request: Request, dataset: unknown) {
  const actor = await requestUser(request);
  const mode = datasetSchema.parse(dataset ?? "demo");
  const db = getD1Database();
  const scope = await sharedInventoryScope(db, mode);
  return {
    actor,
    store: new InventoryStore(db, scope, mode, {
      id: actor.id,
      name: actor.displayName,
      role: actor.role,
      authVersion: actor.authVersion,
    }),
    intake: new IntakeStore(db, scope, mode, actor),
  };
}
function fail(error: unknown) {
  return apiError(error, {
    logMessage: "Inventory operation failed",
    message:
      "The inventory could not complete this operation. Your input has been preserved; please try again.",
  });
}
export async function GET(request: Request) {
  try {
    const url = new URL(request.url),
      { store, actor } = await context(
        request,
        url.searchParams.get("dataset"),
      );
    const activityScope = z
      .enum(["all", "mine"])
      .parse(url.searchParams.get("activityScope") ?? "all");
    const id = url.searchParams.get("batteryId");
    if (url.searchParams.get("activity") === "all")
      return json({
        events: await store.fullActivity(activityScope),
        activityScope,
      });
    return json(
      id
        ? await store.detail(identifier.parse(id))
        : { ...(await store.snapshot()), user: actor },
    );
  } catch (e) {
    return fail(e);
  }
}
export async function POST(request: Request) {
  try {
    const raw = await requestJson(
      request,
      250_000,
      "This upload is too large. Import at most 200 rows.",
    );
    const body = z
      .object({
        dataset: datasetSchema.default("demo"),
        action: z.string(),
        payload: z.unknown().optional(),
        update: z.boolean().optional(),
        kind: z.string().optional(),
        records: z.array(z.unknown()).optional(),
      })
      .parse(raw);
    const { store, intake } = await context(request, body.dataset),
      payload = body.payload;
    let result;
    switch (body.action) {
      case "initialize_demo":
        result = await store.initializeDemo();
        break;
      case "movement":
        result = await store.movement(payload);
        break;
      case "scan_lookup":
        result = await store.scanLookup(payload);
        break;
      case "intake":
        result = await intake.register(payload);
        break;
      case "lifecycle":
        result = await store.lifecycle(payload);
        break;
      case "group_maintenance":
        result = await store.groupMaintenance(payload);
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
      default:
        throw new DomainError(400, "Unknown inventory operation.");
    }
    return json({ ok: true, result });
  } catch (e) {
    return fail(e);
  }
}
