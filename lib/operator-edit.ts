import { z } from "zod";
import { batterySchema, datasetSchema, identifier } from "./domain";
import { canonicalModelJson } from "./battery-models";
import { SUPPORTED_BUILDING_IDS } from "./location-catalog";

const metadataFields = {
  name: batterySchema.shape.name,
  model: batterySchema.shape.model.removeDefault(), chemistry: batterySchema.shape.chemistry.removeDefault(),
  capacityMah: batterySchema.shape.capacityMah.removeDefault(), voltage: batterySchema.shape.voltage.removeDefault(),
  tagId: batterySchema.shape.tagId.removeDefault(), ownerId: identifier,
  homeBuildingId: identifier.nullable(), homeRoomId: identifier.nullable(),
  manufacturedOn: batterySchema.shape.manufacturedOn.removeDefault(), firstUsedOn: batterySchema.shape.firstUsedOn.removeDefault(),
};
const version = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const operatorEditFieldsSchema = z.object({ ...metadataFields, homeBuildingId: z.enum(SUPPORTED_BUILDING_IDS) }).strict();
export const operatorEditSnapshotSchema = z.object({ ...metadataFields, version, registeredAt: z.string().datetime({ offset: true }) }).strict();
export const operatorEditPayloadSchema = z.object({
  requestId: z.string().uuid(), batteryId: identifier,
  before: operatorEditSnapshotSchema.extend({ version: version.max(Number.MAX_SAFE_INTEGER - 1) }), fields: operatorEditFieldsSchema,
  directoryBindings: z.object({ ownerVersion: version, ownerAccountId: z.string().uuid(), buildingVersion: version, roomVersion: version.nullable() }).strict(),
}).strict();
export const operatorEditReceiptSchema = z.object({
  kind: z.literal("metadata_edit"), requestId: z.string().uuid(), dataset: datasetSchema,
  actorAccountId: z.string().uuid(), batteryId: identifier, at: z.string().datetime({ offset: true }), replayed: z.boolean(),
  before: operatorEditSnapshotSchema, after: operatorEditSnapshotSchema,
  directoryBindings: operatorEditPayloadSchema.shape.directoryBindings,
}).strict();
const outcomeIdentity = { requestId: z.string().uuid(), dataset: datasetSchema, actorAccountId: z.string().uuid() };
const fingerprintSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
export const operatorEditOutcomeSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("missing"), ...outcomeIdentity }).strict(),
  z.object({ state: z.literal("confirmed"), receipt: operatorEditReceiptSchema }).strict(),
  z.object({ state: z.literal("rejected"), ...outcomeIdentity, batteryId: identifier, at: z.string().datetime({ offset: true }), code: z.literal("metadata_edit_rejected_final"), error: z.string(), fingerprint: fingerprintSchema }).strict(),
  z.object({ state: z.literal("purged"), ...outcomeIdentity, batteryId: identifier, fingerprint: fingerprintSchema }).strict(),
]);
export type OperatorEditFields = z.infer<typeof operatorEditFieldsSchema>;
export type OperatorEditSnapshot = z.infer<typeof operatorEditSnapshotSchema>;
export type OperatorEditPayload = z.infer<typeof operatorEditPayloadSchema>;
export type OperatorEditReceipt = z.infer<typeof operatorEditReceiptSchema>;
export type OperatorEditOutcome = z.infer<typeof operatorEditOutcomeSchema>;

/** Stable original-request identity, independent of desktop service URL and current role. */
export async function operatorEditFingerprint(payload: OperatorEditPayload, actorAccountId: string, dataset: z.infer<typeof datasetSchema>): Promise<string> {
  const source = canonicalModelJson({ kind: "metadata_edit", actorAccountId, dataset, payload: operatorEditPayloadSchema.parse(payload) });
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(source)));
  return `sha256:${Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("")}`;
}
export function verifyOperatorEditReceipt(value: unknown, payload: OperatorEditPayload, actorAccountId: string, dataset: z.infer<typeof datasetSchema>): OperatorEditReceipt {
  const receipt = operatorEditReceiptSchema.parse(value);
  const after = { ...payload.fields, version: payload.before.version + 1, registeredAt: payload.before.registeredAt };
  if (receipt.requestId !== payload.requestId || receipt.actorAccountId !== actorAccountId || receipt.dataset !== dataset || receipt.batteryId !== payload.batteryId || canonicalModelJson(receipt.before) !== canonicalModelJson(payload.before) || canonicalModelJson(receipt.after) !== canonicalModelJson(after) || canonicalModelJson(receipt.directoryBindings) !== canonicalModelJson(payload.directoryBindings)) {
    throw new Error("The metadata receipt differs from the original reviewed request. Resolve the preserved request.");
  }
  return receipt;
}
export async function verifyOperatorEditOutcome(value: unknown, payload: OperatorEditPayload, actorAccountId: string, dataset: z.infer<typeof datasetSchema>): Promise<OperatorEditOutcome> {
  const outcome = operatorEditOutcomeSchema.parse(value);
  if (outcome.state === "confirmed") return { state: "confirmed", receipt: verifyOperatorEditReceipt(outcome.receipt, payload, actorAccountId, dataset) };
  if (outcome.requestId !== payload.requestId || outcome.actorAccountId !== actorAccountId || outcome.dataset !== dataset || (outcome.state !== "missing" && (outcome.batteryId !== payload.batteryId || outcome.fingerprint !== await operatorEditFingerprint(payload, actorAccountId, dataset)))) {
    throw new Error("The metadata outcome belongs to a different request, account or inventory. Resolve the preserved request.");
  }
  return outcome;
}
