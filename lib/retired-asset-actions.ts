import { z } from "zod";
import { datasetSchema, identifier, type Dataset } from "./domain";

export const retiredAssetPayloadSchema = z.object({
    requestId: z.string().uuid(),
    kind: z.enum(["recover", "purge"]),
    items: z.array(z.object({
        batteryId: identifier,
        version: z.number().int().positive().max(Number.MAX_SAFE_INTEGER - 1),
        tagId: z.string().trim().min(1).max(128).nullable(),
    }).strict()).min(1).max(100),
}).strict().superRefine((value, context) => {
    if (new Set(value.items.map(item => item.batteryId)).size !== value.items.length)
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["items"], message: "Review each selected battery once." });
    const tags = value.items.flatMap(item => item.tagId === null ? [] : [item.tagId]);
    if (new Set(tags).size !== tags.length)
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["items"], message: "Selected batteries cannot share a registered tag." });
});

export type RetiredAssetPayload = z.infer<typeof retiredAssetPayloadSchema>;
export type RetiredAssetAttempt = { actorAccountId: string; dataset: Dataset; payload: RetiredAssetPayload };

export const retiredAssetReceiptSchema = z.object({
    requestId: z.string().uuid(), dataset: datasetSchema, actorAccountId: z.string().min(1),
    kind: z.enum(["recover", "purge"]), at: z.string().datetime({ offset: true }), replayed: z.boolean(),
    items: z.array(z.object({
        batteryId: identifier, version: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
        status: z.enum(["active", "deleted"]),
    }).strict()).min(1).max(100),
}).strict();
export type RetiredAssetReceipt = z.infer<typeof retiredAssetReceiptSchema>;

export function retiredAssetStorageKey(actorAccountId: string, dataset: Dataset) {
    return `battery-retired-action:${actorAccountId}:${dataset}`;
}
export function captureRetiredAssetAttempt(actorAccountId: string, dataset: Dataset, payload: RetiredAssetPayload): RetiredAssetAttempt {
    if (!actorAccountId) throw new Error("The native account is required for this request.");
    return { actorAccountId, dataset: datasetSchema.parse(dataset), payload: retiredAssetPayloadSchema.parse(structuredClone(payload)) };
}
export function recoverRetiredAssetAttempt(raw: string | null, actorAccountId: string, dataset: Dataset): RetiredAssetAttempt | null {
    if (!raw) return null;
    try {
        const stored = JSON.parse(raw) as RetiredAssetAttempt;
        if (stored.actorAccountId !== actorAccountId || stored.dataset !== dataset) return null;
        return captureRetiredAssetAttempt(actorAccountId, dataset, stored.payload);
    } catch { return null; }
}
export function verifyRetiredAssetReceipt(value: unknown, attempt: RetiredAssetAttempt): RetiredAssetReceipt {
    const parsed = retiredAssetReceiptSchema.safeParse(value);
    if (!parsed.success) throw new Error("The retired battery action receipt is incomplete. Retry the preserved request.");
    const receipt = parsed.data, payload = attempt.payload;
    if (receipt.requestId !== payload.requestId || receipt.dataset !== attempt.dataset || receipt.actorAccountId !== attempt.actorAccountId || receipt.kind !== payload.kind || receipt.items.length !== payload.items.length)
        throw new Error("The retired battery action receipt does not match this reviewed request. Retry the preserved request.");
    const status = payload.kind === "recover" ? "active" : "deleted";
    if (receipt.items.some((item, index) => item.batteryId !== payload.items[index].batteryId || item.version !== payload.items[index].version + 1 || item.status !== status))
        throw new Error("The retired battery action receipt changed a reviewed battery, version or outcome. Retry the preserved request.");
    return receipt;
}
export function retiredAssetFailureStatus(error: unknown): "rejected" | "unknown" {
    const value = error as { status?: number; code?: string };
    if (value?.code === "retired_asset_rejected_final" && [400, 404, 409, 422].includes(value.status ?? 0)) return "rejected";
    return value?.status === 400 || value?.status === 422 ? "rejected" : "unknown";
}
