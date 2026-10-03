import { z } from "zod";
import { datasetSchema, identifier, type Dataset } from "./domain";
import { teachingGroupReferenceSchema, teachingGroupEvidenceSchema, verifyGroupEvidence } from "./teaching-context";

export const lifecyclePayloadSchema = z.object({
    requestId: z.string().uuid(), kind: z.enum(["scrapped", "permanently_removed"]),
    teachingGroup: teachingGroupReferenceSchema.optional(),
    reason: z.string().trim().max(1000).default(""),
    destination: z.string().trim().max(200).nullable().optional().transform(value => value || null),
    source: z.enum(["tag_entry", "manual_selection"]),
    items: z.array(z.object({ batteryId: identifier, version: z.number().int().positive().max(Number.MAX_SAFE_INTEGER - 1), tagId: z.string().trim().min(1).max(128).nullable() }).strict()).min(1).max(100),
}).strict().superRefine((value, context) => {
    if (new Set(value.items.map(item => item.batteryId)).size !== value.items.length) context.addIssue({ code: z.ZodIssueCode.custom, path: ["items"], message: "Review each selected battery once." });
    const tags = value.items.flatMap(item => item.tagId === null ? [] : [item.tagId]);
    if (new Set(tags).size !== tags.length) context.addIssue({ code: z.ZodIssueCode.custom, path: ["items"], message: "Selected batteries cannot share a registered tag." });
    if (value.source === "tag_entry" && value.items.some(item => item.tagId === null)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["source"], message: "Tag entry requires an exact registered tag for every battery." });
    if (value.kind === "scrapped" && value.destination !== null) context.addIssue({ code: z.ZodIssueCode.custom, path: ["destination"], message: "A destination is recorded for permanent removal." });
});
export type LifecyclePayload = z.infer<typeof lifecyclePayloadSchema>;
export type LifecycleKind = LifecyclePayload["kind"];
export type LifecycleAttempt = { actorAccountId: string; dataset: Dataset; payload: LifecyclePayload };
export const lifecycleReceiptSchema = z.object({
    requestId: z.string().uuid(), dataset: datasetSchema, actorAccountId: z.string().min(1),
    kind: z.enum(["scrapped", "permanently_removed"]), reason: z.string().max(1000), destination: z.string().max(200).nullable(), source: z.enum(["tag_entry", "manual_selection"]),
    at: z.string().datetime({ offset: true }), replayed: z.boolean(),
    teachingGroup: teachingGroupEvidenceSchema.optional(),
    items: z.array(z.object({ batteryId: identifier, version: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), status: z.enum(["scrapped", "permanently_removed"]), tagId: z.string().min(1).max(128).nullable() }).strict()).min(1).max(100),
}).strict();
export type LifecycleReceipt = z.infer<typeof lifecycleReceiptSchema>;
export function lifecycleStorageKey(actorAccountId: string, dataset: Dataset) { return `battery-lifecycle:${actorAccountId}:${dataset}`; }
export function captureLifecycleAttempt(actorAccountId: string, dataset: Dataset, payload: LifecyclePayload): LifecycleAttempt {
    return { actorAccountId, dataset: datasetSchema.parse(dataset), payload: lifecyclePayloadSchema.parse(structuredClone(payload)) };
}
export function recoverLifecycleSession(raw: string | null, actorAccountId: string, dataset: Dataset): LifecycleAttempt | null {
    if (!raw) return null;
    try {
        const stored = JSON.parse(raw) as LifecycleAttempt;
        if (stored.actorAccountId !== actorAccountId || stored.dataset !== dataset) return null;
        return captureLifecycleAttempt(actorAccountId, dataset, stored.payload);
    } catch { return null; }
}
export function verifyLifecycleReceipt(value: unknown, attempt: LifecycleAttempt): LifecycleReceipt {
    const parsed = lifecycleReceiptSchema.safeParse(value);
    if (!parsed.success) throw new Error("The removal receipt is incomplete. Retry the preserved request.");
    const receipt = parsed.data, payload = attempt.payload;
    verifyGroupEvidence(receipt.teachingGroup, payload.teachingGroup, payload.requestId, payload.items.map(item => item.batteryId), attempt.actorAccountId);
    if (receipt.requestId !== payload.requestId || receipt.dataset !== attempt.dataset || receipt.actorAccountId !== attempt.actorAccountId || receipt.kind !== payload.kind || receipt.reason !== payload.reason || receipt.destination !== payload.destination || receipt.source !== payload.source || receipt.items.length !== payload.items.length)
        throw new Error("The removal receipt does not match this reviewed request. Retry the preserved request.");
    if (receipt.items.some((item, index) => item.batteryId !== payload.items[index].batteryId || item.tagId !== payload.items[index].tagId || item.version !== payload.items[index].version + 1 || item.status !== payload.kind))
        throw new Error("The removal receipt changed a reviewed battery, tag or version. Retry the preserved request.");
    return receipt;
}
export function lifecycleFailureStatus(error: unknown): "rejected" | "unknown" {
    const value = error as { status?: number; code?: string };
    // Only an immutable final reservation establishes a reviewed request's failure.
    if (value?.code === "lifecycle_rejected_final" && [400, 404, 409, 422].includes(value.status ?? 0)) return "rejected";
    return value?.status === 400 || value?.status === 422 ? "rejected" : "unknown";
}
