import { z } from "zod";
export const teachingGroupReferenceSchema = z.object({ id: z.string().uuid(), version: z.number().int().positive().max(Number.MAX_SAFE_INTEGER - 1) }).strict();
export const teachingGroupEvidenceSchema = teachingGroupReferenceSchema.extend({ name: z.string().min(1).max(80), ownerAccountId: z.string().min(1), operationId: z.string().uuid(), batteryIds: z.array(z.string().min(1).max(64)).min(1).max(100) }).strict();
export function verifyGroupEvidence(evidence, reference, operationId, batteryIds, accountId) {
    if (!reference) {
        if (evidence !== undefined)
            throw new Error("Unexpected teaching group in this receipt.");
        return;
    }
    const value = teachingGroupEvidenceSchema.parse(evidence);
    if (value.id !== reference.id || value.version !== reference.version || value.ownerAccountId !== accountId || value.operationId !== operationId
        || JSON.stringify([...value.batteryIds].sort()) !== JSON.stringify([...batteryIds].sort()))
        throw new Error("The teaching group receipt does not match the reviewed operation. Retry the exact request.");
}
