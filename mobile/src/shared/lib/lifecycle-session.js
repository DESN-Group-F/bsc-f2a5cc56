import { z } from "zod";
import { datasetSchema, identifier } from "./domain.js";
import { teachingGroupReferenceSchema, teachingGroupEvidenceSchema, verifyGroupEvidence } from "./teaching-context.js";
import { teachingNfcEvidenceSchema } from "./teaching-nfc.js";
const lifecyclePayloadFields = {
    requestId: z.string().uuid(), kind: z.enum(["scrapped", "permanently_removed"]),
    teachingGroup: teachingGroupReferenceSchema.optional(),
    reason: z.string().trim().max(1000).default(""),
    destination: z.string().trim().max(200).nullable().optional().transform(value => value || null),
};
const lifecycleItemFields = { batteryId: identifier, version: z.number().int().positive().max(Number.MAX_SAFE_INTEGER - 1), tagId: z.string().trim().min(1).max(128).nullable() };
export const lifecyclePayloadSchema = z.discriminatedUnion("source", [
    z.object({ ...lifecyclePayloadFields, source: z.enum(["tag_entry", "manual_selection"]), items: z.array(z.object({ ...lifecycleItemFields, nfcEvidence: z.never().optional() }).strict()).min(1).max(100) }).strict(),
    z.object({ ...lifecyclePayloadFields, source: z.literal("native_nfc"), items: z.array(z.object({ ...lifecycleItemFields, tagId: z.string().regex(/^nfc:uid:(?:[0-9A-F]{8}|[0-9A-F]{14}|[0-9A-F]{20})$/), nfcEvidence: teachingNfcEvidenceSchema }).strict()).min(1).max(100) }).strict(),
]).superRefine((value, context) => {
    if (value.source === "native_nfc" && value.items.some(item => item.tagId !== item.nfcEvidence.tagId))
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["items"], message: "Every removal binding must retain the adopted native NFC tag and full evidence." });
    if (new Set(value.items.map(item => item.batteryId)).size !== value.items.length)
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["items"], message: "Review each selected battery once." });
    const tags = value.items.flatMap(item => item.tagId === null ? [] : [item.tagId]);
    if (new Set(tags).size !== tags.length)
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["items"], message: "Selected batteries cannot share a registered tag." });
    if (value.source === "tag_entry" && value.items.some(item => item.tagId === null))
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["source"], message: "Tag entry requires an exact registered tag for every battery." });
    if (value.kind === "scrapped" && value.destination !== null)
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["destination"], message: "A destination is recorded for permanent removal." });
});
const lifecycleReceiptFields = {
    requestId: z.string().uuid(), dataset: datasetSchema, actorAccountId: z.string().min(1),
    kind: z.enum(["scrapped", "permanently_removed"]), reason: z.string().max(1000), destination: z.string().max(200).nullable(),
    at: z.string().datetime({ offset: true }), replayed: z.boolean(),
    teachingGroup: teachingGroupEvidenceSchema.optional(),
};
const lifecycleReceiptItemFields = { batteryId: identifier, version: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), status: z.enum(["scrapped", "permanently_removed"]), tagId: z.string().min(1).max(128).nullable() };
export const lifecycleReceiptSchema = z.discriminatedUnion("source", [
    z.object({ ...lifecycleReceiptFields, source: z.enum(["tag_entry", "manual_selection"]), items: z.array(z.object({ ...lifecycleReceiptItemFields, nfcEvidence: z.never().optional() }).strict()).min(1).max(100) }).strict(),
    z.object({ ...lifecycleReceiptFields, source: z.literal("native_nfc"), items: z.array(z.object({ ...lifecycleReceiptItemFields, tagId: z.string().regex(/^nfc:uid:(?:[0-9A-F]{8}|[0-9A-F]{14}|[0-9A-F]{20})$/), nfcEvidence: teachingNfcEvidenceSchema }).strict()).min(1).max(100) }).strict(),
]).superRefine((value, context) => {
    if (value.source === "native_nfc" && value.items.some(item => item.tagId !== item.nfcEvidence.tagId))
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["items"], message: "Every removed tag must retain its original native NFC evidence." });
});
export function lifecycleStorageKey(actorAccountId, dataset) { return `battery-lifecycle:${actorAccountId}:${dataset}`; }
export function captureLifecycleAttempt(actorAccountId, dataset, payload) {
    if (payload.source === "native_nfc" && dataset !== "demo")
        throw new Error("Native NFC removal is available only in Demonstration inventory.");
    return { actorAccountId, dataset: datasetSchema.parse(dataset), payload: lifecyclePayloadSchema.parse(structuredClone(payload)) };
}
export function recoverLifecycleSession(raw, actorAccountId, dataset) {
    if (!raw)
        return null;
    try {
        const stored = JSON.parse(raw);
        if (stored.actorAccountId !== actorAccountId || stored.dataset !== dataset)
            return null;
        return captureLifecycleAttempt(actorAccountId, dataset, stored.payload);
    }
    catch {
        return null;
    }
}
export function verifyLifecycleReceipt(value, attempt) {
    const parsed = lifecycleReceiptSchema.safeParse(value);
    if (!parsed.success)
        throw new Error("The removal receipt is incomplete. Retry the preserved request.");
    const receipt = parsed.data, payload = attempt.payload;
    verifyGroupEvidence(receipt.teachingGroup, payload.teachingGroup, payload.requestId, payload.items.map(item => item.batteryId), attempt.actorAccountId);
    if (receipt.requestId !== payload.requestId || receipt.dataset !== attempt.dataset || receipt.actorAccountId !== attempt.actorAccountId || receipt.kind !== payload.kind || receipt.reason !== payload.reason || receipt.destination !== payload.destination || receipt.source !== payload.source || receipt.items.length !== payload.items.length)
        throw new Error("The removal receipt does not match this reviewed request. Retry the preserved request.");
    if (receipt.items.some((item, index) => item.batteryId !== payload.items[index].batteryId || item.tagId !== payload.items[index].tagId || item.version !== payload.items[index].version + 1 || item.status !== payload.kind || JSON.stringify(item.nfcEvidence) !== JSON.stringify(payload.items[index].nfcEvidence)))
        throw new Error("The removal receipt changed a reviewed battery, tag or version. Retry the preserved request.");
    return receipt;
}
export function lifecycleFailureStatus(error) {
    const value = error;
    // Only an immutable final reservation establishes a reviewed request's failure.
    if (value?.code === "lifecycle_rejected_final" && [400, 404, 409, 422].includes(value.status ?? 0))
        return "rejected";
    return value?.status === 400 || value?.status === 422 ? "rejected" : "unknown";
}
