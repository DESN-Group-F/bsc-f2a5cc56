import { z } from "zod";
import { datasetSchema, identifier } from "./domain.js";
const memberIds = z.array(identifier).min(1).max(100).refine(ids => new Set(ids).size === ids.length, "Choose each battery once.");
const fields = { id: z.string().uuid(), name: z.string().trim().min(1).max(80), notes: z.string().trim().max(500).default(""), batteryIds: memberIds };
const version = z.number().int().positive().max(Number.MAX_SAFE_INTEGER - 1);
export const teachingGroupRequestSchema = z.discriminatedUnion("action", [
    z.object({ action: z.literal("create"), requestId: z.string().uuid(), ...fields }).strict(),
    z.object({ action: z.literal("update"), requestId: z.string().uuid(), ...fields, expectedVersion: version }).strict(),
    z.object({ action: z.literal("remove"), requestId: z.string().uuid(), id: z.string().uuid(), expectedVersion: version }).strict(),
]);
export const teachingGroupSchema = z.object({ ...fields, version: z.number().int().positive(), ownerAccountId: z.string().min(1), state: z.enum(["active", "archived"]), createdAt: z.string().datetime({ offset: true }), updatedAt: z.string().datetime({ offset: true }) }).strict();
/** Replace one reviewed default member without adopting an entire checkout's selection. */
export function buildTeachingGroupReplacement(group, originalBatteryId, replacementBatteryId, requestId) {
    if (group.state !== "active")
        throw new Error("This group is archived. Open an active group before changing its default members.");
    if (!group.batteryIds.includes(originalBatteryId))
        throw new Error("The original battery is no longer a default member. Refresh the group and review its latest members.");
    if (originalBatteryId === replacementBatteryId)
        throw new Error("Choose a different replacement battery.");
    if (group.batteryIds.includes(replacementBatteryId))
        throw new Error("The replacement is already a default member. Review the group to avoid duplicate members.");
    return teachingGroupRequestSchema.parse({ action: "update", requestId, id: group.id, expectedVersion: group.version, name: group.name, notes: group.notes, batteryIds: group.batteryIds.map(id => id === originalBatteryId ? replacementBatteryId : id) });
}
export const teachingGroupReceiptSchema = z.object({ requestId: z.string().uuid(), actorAccountId: z.string().min(1), dataset: datasetSchema, action: z.enum(["create", "update", "remove"]), group: teachingGroupSchema, replayed: z.boolean() }).strict();
export function captureTeachingGroupAttempt(actorAccountId, dataset, payload) {
    return { actorAccountId, dataset: datasetSchema.parse(dataset), payload: teachingGroupRequestSchema.parse(structuredClone(payload)) };
}
export function teachingGroupStorageKey(accountId, dataset) { return `battery-teaching-group:${accountId}:${dataset}`; }
export function recoverTeachingGroupAttempt(raw, accountId, dataset) {
    if (!raw)
        return null;
    try {
        const saved = JSON.parse(raw);
        return saved.actorAccountId === accountId && saved.dataset === dataset ? captureTeachingGroupAttempt(accountId, dataset, saved.payload) : null;
    }
    catch {
        return null;
    }
}
export function verifyTeachingGroupReceipt(value, attempt) {
    const receipt = teachingGroupReceiptSchema.parse(value), payload = attempt.payload, group = receipt.group;
    const expectedVersion = payload.action === "create" ? 1 : payload.expectedVersion + 1;
    if (receipt.actorAccountId !== attempt.actorAccountId || receipt.dataset !== attempt.dataset || receipt.action !== payload.action || receipt.requestId !== payload.requestId || group.ownerAccountId !== attempt.actorAccountId || group.id !== payload.id || group.version !== expectedVersion || group.state !== (payload.action === "remove" ? "archived" : "active") || (payload.action !== "remove" && (group.name !== payload.name || group.notes !== payload.notes || JSON.stringify(group.batteryIds) !== JSON.stringify(payload.batteryIds))))
        throw new Error("The saved group result does not match this request. Retry the preserved request.");
    return receipt;
}
export function teachingGroupFailureStatus(error) {
    const value = error;
    return value?.code === "teaching_group_rejected_final" || value?.status === 400 || value?.status === 422 ? "rejected" : "unknown";
}
