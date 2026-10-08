import { z } from "zod";
import { identifier, datasetSchema } from "./domain.js";
import { teachingGroupReferenceSchema, teachingGroupEvidenceSchema, verifyGroupEvidence } from "./teaching-context.js";
const base = { requestId: z.string().uuid(), teachingGroup: teachingGroupReferenceSchema,
    items: z.array(z.object({ batteryId: identifier, version: z.number().int().positive().max(Number.MAX_SAFE_INTEGER - 1), tagId: z.string().min(1).max(128).nullable() }).strict()).min(1).max(100) };
export const groupMaintenanceSchema = z.discriminatedUnion("kind", [
    z.object({ ...base, kind: z.literal("owner"), ownerId: identifier }).strict(),
    z.object({ ...base, kind: z.literal("storage"), homeBuildingId: z.literal("J18"), homeRoomId: identifier.nullable() }).strict(),
    z.object({ ...base, kind: z.literal("charge"), completedAt: z.string().datetime({ offset: true }), durationMinutes: z.number().finite().positive().max(525600) }).strict(),
    z.object({ ...base, kind: z.literal("observation"), roomId: identifier, observedAt: z.string().datetime({ offset: true }) }).strict(),
]).refine(value => new Set(value.items.map(item => item.batteryId)).size === value.items.length, "Review each battery once.");
const receiptSchema = z.object({ requestId: z.string().uuid(), actorAccountId: z.string(), dataset: datasetSchema, kind: z.enum(["owner", "storage", "charge", "observation"]), batteryIds: z.array(identifier), at: z.string().datetime({ offset: true }), teachingGroup: teachingGroupEvidenceSchema, replayed: z.boolean().optional() });
export function groupMaintenanceKey(accountId, dataset) { return `battery-group-maintenance:${accountId}:${dataset}`; }
export function captureGroupMaintenance(accountId, dataset, payload) {
    return { accountId, dataset: datasetSchema.parse(dataset), payload: groupMaintenanceSchema.parse(structuredClone(payload)) };
}
export function recoverGroupMaintenance(raw, accountId, dataset) {
    try {
        const value = raw ? JSON.parse(raw) : null;
        return value?.accountId === accountId && value?.dataset === dataset ? captureGroupMaintenance(accountId, dataset, value.payload) : null;
    }
    catch {
        return null;
    }
}
export function verifyGroupMaintenance(value, attempt) {
    const result = receiptSchema.parse(value), ids = attempt.payload.items.map(item => item.batteryId);
    if (result.actorAccountId !== attempt.accountId || result.dataset !== attempt.dataset || result.requestId !== attempt.payload.requestId || result.kind !== attempt.payload.kind
        || JSON.stringify([...result.batteryIds].sort()) !== JSON.stringify([...ids].sort()))
        throw new Error("The group operation receipt is incomplete or mismatched. Retry the exact request.");
    verifyGroupEvidence(result.teachingGroup, attempt.payload.teachingGroup, attempt.payload.requestId, ids, attempt.accountId);
    return result;
}
