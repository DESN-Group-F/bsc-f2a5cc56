import { z } from "zod";
import { batterySchema, datasetSchema, identifier, type Dataset } from "./domain";
import { canonicalModelJson } from "./battery-models";
import { SUPPORTED_BUILDING_IDS } from "./location-catalog";

const version = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const operatorImportRecordSchema = z.object({
  id: identifier, name: batterySchema.shape.name,
  model: batterySchema.shape.model.removeDefault(), chemistry: batterySchema.shape.chemistry.removeDefault(),
  capacityMah: batterySchema.shape.capacityMah.removeDefault(), voltage: batterySchema.shape.voltage.removeDefault(),
  tagId: batterySchema.shape.tagId.removeDefault(), ownerId: identifier,
  homeBuildingId: z.enum(SUPPORTED_BUILDING_IDS), homeRoomId: identifier.nullable(),
  manufacturedOn: batterySchema.shape.manufacturedOn.removeDefault(), firstUsedOn: batterySchema.shape.firstUsedOn.removeDefault(),
}).strict();
export const operatorImportBindingsSchema = z.object({
  owners: z.array(z.object({ ownerId: identifier, accountId: z.string().uuid(), version }).strict()).min(1).max(200),
  buildingVersion: version,
  rooms: z.array(z.object({ roomId: identifier, version }).strict()).max(200),
}).strict();
export const operatorImportPayloadSchema = z.object({
  requestId: z.string().uuid(), source: z.literal("reviewed-csv-import"),
  records: z.array(operatorImportRecordSchema).min(1).max(200),
  directoryBindings: operatorImportBindingsSchema,
}).strict();
export const operatorImportReceiptSchema = z.object({
  kind: z.literal("csv_import"), requestId: z.string().uuid(), dataset: datasetSchema,
  actorAccountId: z.string().uuid(), at: z.string().datetime({ offset: true }), replayed: z.boolean(),
  count: z.number().int().min(1).max(200), batteryIds: z.array(identifier).min(1).max(200),
  records: z.array(operatorImportRecordSchema).min(1).max(200), directoryBindings: operatorImportBindingsSchema,
}).strict();
const identity = { requestId: z.string().uuid(), dataset: datasetSchema, actorAccountId: z.string().uuid() };
const fingerprint = z.string().regex(/^sha256:[a-f0-9]{64}$/);
export const operatorImportOutcomeSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("missing"), ...identity }).strict(),
  z.object({ state: z.literal("confirmed"), receipt: operatorImportReceiptSchema }).strict(),
  z.object({ state: z.literal("rejected"), ...identity, at: z.string().datetime({ offset: true }), code: z.literal("csv_import_rejected_final"), status: z.union([z.literal(400), z.literal(404), z.literal(409)]), error: z.string(), fingerprint }).strict(),
  z.object({ state: z.literal("purged"), ...identity, purgedBatteryIds: z.array(identifier).min(1).max(200), fingerprint }).strict(),
]);
export type OperatorImportRecord = z.infer<typeof operatorImportRecordSchema>;
export type OperatorImportBindings = z.infer<typeof operatorImportBindingsSchema>;
export type OperatorImportPayload = z.infer<typeof operatorImportPayloadSchema>;
export type OperatorImportReceipt = z.infer<typeof operatorImportReceiptSchema>;
export type OperatorImportOutcome = z.infer<typeof operatorImportOutcomeSchema>;

export async function operatorImportFingerprint(payload: OperatorImportPayload, actorAccountId: string, dataset: Dataset): Promise<string> {
  const source = canonicalModelJson({ kind: "csv_import", actorAccountId, dataset, payload: operatorImportPayloadSchema.parse(payload) });
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(source)));
  return `sha256:${Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("")}`;
}
export function verifyOperatorImportReceipt(value: unknown, payload: OperatorImportPayload, actorAccountId: string, dataset: Dataset): OperatorImportReceipt {
  const receipt = operatorImportReceiptSchema.parse(value);
  if (receipt.requestId !== payload.requestId || receipt.dataset !== dataset || receipt.actorAccountId !== actorAccountId || receipt.count !== payload.records.length || canonicalModelJson(receipt.batteryIds) !== canonicalModelJson(payload.records.map(record => record.id)) || canonicalModelJson(receipt.records) !== canonicalModelJson(payload.records) || canonicalModelJson(receipt.directoryBindings) !== canonicalModelJson(payload.directoryBindings))
    throw new Error("The CSV import receipt differs from the original reviewed batch. Resolve the preserved request.");
  return receipt;
}
export async function verifyOperatorImportOutcome(value: unknown, payload: OperatorImportPayload, actorAccountId: string, dataset: Dataset): Promise<OperatorImportOutcome> {
  const outcome = operatorImportOutcomeSchema.parse(value);
  if (outcome.state === "confirmed") return { state: "confirmed", receipt: verifyOperatorImportReceipt(outcome.receipt, payload, actorAccountId, dataset) };
  if (outcome.requestId !== payload.requestId || outcome.dataset !== dataset || outcome.actorAccountId !== actorAccountId || (outcome.state !== "missing" && outcome.fingerprint !== await operatorImportFingerprint(payload, actorAccountId, dataset)) || (outcome.state === "purged" && (new Set(outcome.purgedBatteryIds).size !== outcome.purgedBatteryIds.length || outcome.purgedBatteryIds.some(id => !payload.records.some(record => record.id === id)))))
    throw new Error("The CSV import outcome belongs to a different request, account or inventory. Resolve the preserved request.");
  return outcome;
}
