import { z } from "zod";
import { datasetSchema, identifier } from "./domain";
import { teachingGroupReferenceSchema, teachingGroupEvidenceSchema } from "./teaching-context";
import { teachingNfcEvidenceSchema } from "./teaching-nfc";

export const teachingPersonalScopeSchema = z.enum(["all", "responsible", "borrowed"]);
export const teachingBatteryBindingSchema = z.object({ batteryId: identifier, tagId: z.string().min(1).max(128).nullable(), version: z.number().int().positive().max(Number.MAX_SAFE_INTEGER) }).strict();
export const teachingSelectionSourceSchema = z.object({ kind: z.enum(["selection", "tag", "native_nfc"]), evidence: teachingNfcEvidenceSchema.optional() }).strict().superRefine((value, context) => {
  if ((value.kind === "native_nfc") !== !!value.evidence) context.addIssue({ code: z.ZodIssueCode.custom, message: "Only a native NFC selection carries the complete adopted reader evidence." });
});
export type TeachingSelectionSource = z.infer<typeof teachingSelectionSourceSchema>;
export const teachingCheckoutMappingSchema = z.object({ original: teachingBatteryBindingSchema, actual: teachingBatteryBindingSchema, originalLoanId: z.string().uuid().nullable(), existingLoanId: z.string().uuid().optional(), method: z.enum(["original", "automatic", "manual"]), source: teachingSelectionSourceSchema }).strict().superRefine((value, context) => {
  if (value.source.kind === "native_nfc" && value.source.evidence?.tagId !== value.actual.tagId) context.addIssue({ code: z.ZodIssueCode.custom, path: ["actual", "tagId"], message: "The reviewed actual tag must match the complete adopted native NFC identifier." });
});
const returnItemSchema = teachingBatteryBindingSchema.extend({ loanId: z.string().uuid(), source: teachingSelectionSourceSchema.optional() }).strict();
export const teachingCheckoutRequestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("checkout"), requestId: z.string().uuid(), teachingGroup: teachingGroupReferenceSchema, personalScope: teachingPersonalScopeSchema, mappings: z.array(teachingCheckoutMappingSchema).min(1).max(100), separateCheckout: z.boolean().optional() }).strict(),
  z.object({ action: z.literal("return"), requestId: z.string().uuid(), runId: z.string().uuid(), personalScope: teachingPersonalScopeSchema, items: z.array(returnItemSchema).min(1).max(100) }).strict(),
  z.object({ action: z.literal("continue"), requestId: z.string().uuid(), runId: z.string().uuid(), expectedRevision: z.number().int().positive(), teachingGroup: teachingGroupReferenceSchema, personalScope: teachingPersonalScopeSchema, mappings: z.array(teachingCheckoutMappingSchema).min(1).max(100) }).strict(),
  z.object({ action: z.literal("exchange"), requestId: z.string().uuid(), runId: z.string().uuid(), expectedRevision: z.number().int().positive(), personalScope: teachingPersonalScopeSchema, originalBatteryId: identifier, outgoing: returnItemSchema, actual: teachingBatteryBindingSchema, actualLoanId: z.string().uuid().nullable(), returnOutgoing: z.boolean(), source: teachingSelectionSourceSchema }).strict(),
]);
export type TeachingCheckoutRequest = z.infer<typeof teachingCheckoutRequestSchema>;
export type TeachingCheckoutMapping = z.infer<typeof teachingCheckoutMappingSchema>;
export const teachingBatterySnapshotSchema = teachingBatteryBindingSchema.extend({ name: z.string(), model: z.string(), chemistry: z.string(), capacityMah: z.number().nullable(), voltage: z.number().nullable(), homeBuildingId: z.string().nullable(), homeRoomId: z.string().nullable(), homeRoomName: z.string().nullable(), homeRoomIsPlaceholder: z.boolean().nullable() }).strict();
export type TeachingBatterySnapshot = z.infer<typeof teachingBatterySnapshotSchema>;
const storedSnapshotSchema = z.union([teachingBatterySnapshotSchema, z.object({ batteryId: identifier, deleted: z.literal(true) }).strict()]);
export const teachingMappingEvidenceSchema = z.object({ original: storedSnapshotSchema, actual: storedSnapshotSchema, originalLoanId: z.string().uuid().nullable(), method: z.enum(["original", "automatic", "manual"]), source: teachingSelectionSourceSchema.optional(), loanId: z.string().uuid().nullable(), loanOrigin: z.enum(["new", "existing"]).optional(), specificationMatch: z.boolean().nullable(), differences: z.array(z.string()) }).strict();
export type TeachingMappingEvidence = z.infer<typeof teachingMappingEvidenceSchema>;
export const teachingCheckoutRunSchema = z.object({ id: z.string().uuid(), dataset: datasetSchema, actorAccountId: z.string().min(1), actorName: z.string(), teachingGroup: teachingGroupEvidenceSchema, requestedBatteryIds: z.array(identifier).min(1).max(100), mappings: z.array(teachingMappingEvidenceSchema).min(1).max(100), createdAt: z.string().datetime({ offset: true }), separateCheckout: z.boolean().optional() }).strict();
export type TeachingCheckoutRun = z.infer<typeof teachingCheckoutRunSchema>;
export const teachingCheckoutChangeSchema = z.object({ id: z.string().uuid(), runId: z.string().uuid(), revision: z.number().int().min(2), action: z.enum(["continue", "exchange"]), actorAccountId: z.string(), actorName: z.string(), at: z.string().datetime({ offset: true }), mappings: z.array(teachingMappingEvidenceSchema).min(1).max(100), teachingGroup: teachingGroupEvidenceSchema.optional(), outgoing: z.union([z.object({ batteryId: identifier, loanId: z.string().uuid(), returned: z.boolean() }).strict(), z.object({ batteryId: identifier, deleted: z.literal(true) }).strict()]).optional() }).strict();
export type TeachingCheckoutChange = z.infer<typeof teachingCheckoutChangeSchema>;
export const teachingCheckoutRunItemSchema = z.object({ batteryId: identifier, loanId: z.string().uuid().nullable(), status: z.enum(["outstanding", "returned", "cancelled", "deleted"]), tagId: z.string().nullable(), version: z.number().int().positive().nullable(), returnedAt: z.string().datetime({ offset: true }).nullable(), checkedOutAt: z.string().datetime({ offset: true }).nullable().optional(), originalBatteryId: identifier.optional(), pendingReturn: z.boolean().optional() }).strict();
export const teachingCheckoutListedRunSchema = teachingCheckoutRunSchema.extend({ items: z.array(teachingCheckoutRunItemSchema).min(1), revision: z.number().int().positive().optional(), currentMappings: z.array(teachingMappingEvidenceSchema).optional(), changes: z.array(teachingCheckoutChangeSchema).optional() });
export type TeachingCheckoutRunItem = z.infer<typeof teachingCheckoutRunItemSchema>;
export type TeachingCheckoutListedRun = z.infer<typeof teachingCheckoutListedRunSchema>;
export const teachingCheckoutReceiptSchema = z.object({ requestId: z.string().uuid(), actorAccountId: z.string(), dataset: datasetSchema, action: z.enum(["checkout", "return", "continue", "exchange"]), run: teachingCheckoutRunSchema, change: teachingCheckoutChangeSchema.optional(), revision: z.number().int().positive().optional(), returnedItems: z.array(returnItemSchema).optional(), at: z.string().datetime({ offset: true }), replayed: z.boolean().optional() }).strict();
export type TeachingCheckoutReceipt = z.infer<typeof teachingCheckoutReceiptSchema>;

/** Compare recorded fields only; unknown values never establish equivalence. */
export function teachingSpecificationsMatch(original: Pick<TeachingBatterySnapshot, "model" | "chemistry" | "capacityMah" | "voltage">, actual: Pick<TeachingBatterySnapshot, "model" | "chemistry" | "capacityMah" | "voltage">) {
  return !!original.model.trim() && !!actual.model.trim() && !!original.chemistry.trim() && !!actual.chemistry.trim() && original.capacityMah !== null && actual.capacityMah !== null && original.voltage !== null && actual.voltage !== null && Number.isFinite(original.capacityMah) && Number.isFinite(actual.capacityMah) && Number.isFinite(original.voltage) && Number.isFinite(actual.voltage) && original.capacityMah > 0 && actual.capacityMah > 0 && original.voltage > 0 && actual.voltage > 0 && original.model === actual.model && original.chemistry === actual.chemistry && original.capacityMah === actual.capacityMah && original.voltage === actual.voltage;
}
export function teachingSpecificationDifferences(original: Pick<TeachingBatterySnapshot, "model" | "chemistry" | "capacityMah" | "voltage">, actual: Pick<TeachingBatterySnapshot, "model" | "chemistry" | "capacityMah" | "voltage">) {
  const unknown = (value: string | number | null) => value === null || typeof value === "string" && !value.trim() || typeof value === "number" && (!Number.isFinite(value) || value <= 0);
  return (["model", "chemistry", "capacityMah", "voltage"] as const).flatMap(field => unknown(original[field]) || unknown(actual[field]) ? [`${field}: unknown information`] : original[field] !== actual[field] ? [`${field}: differs`] : []);
}
