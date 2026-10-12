import { z } from "zod";
import { batterySchema, datasetSchema, type Dataset } from "./domain";
import { modelSelectionSchema } from "./battery-models";
import { currentSydneyDate } from "./battery-age";
import { teachingNfcEvidenceSchema } from "./teaching-nfc";

export const intakeCommonSchema = batterySchema.omit({ id: true, tagId: true, expectedVersion: true })
    .extend({ modelSelection: modelSelectionSchema.optional() }).strict();
const intakePayloadFields = {
    requestId: z.string().uuid(), sessionId: z.string().uuid(),
    scannedAt: z.string().datetime({ offset: true }).optional(),
    common: intakeCommonSchema,
    firstUseMode: z.enum(["at_registration", "date", "unknown"]).default("at_registration"),
};
export const intakePayloadSchema = z.discriminatedUnion("source", [
    z.object({ ...intakePayloadFields, source: z.literal("simulated_intake").optional(), nfcEvidence: z.never().optional(), tagId: z.string().trim().max(128).regex(/^DEMO-INTAKE-[A-Za-z0-9._-]+$/, "Use a demonstration intake tag beginning DEMO-INTAKE-.") }).strict(),
    z.object({ ...intakePayloadFields, source: z.literal("native_nfc"), nfcEvidence: teachingNfcEvidenceSchema, tagId: z.string().regex(/^nfc:uid:(?:[0-9A-F]{8}|[0-9A-F]{14}|[0-9A-F]{20})$/) }).strict(),
]).superRefine((value, context) => {
    if (value.source === "native_nfc" && value.tagId !== value.nfcEvidence.tagId) context.addIssue({ code: z.ZodIssueCode.custom, path: ["tagId"], message: "The intake tag must match the complete adopted native NFC evidence." });
    if (value.firstUseMode === "date" && !value.common.firstUsedOn) context.addIssue({ code: z.ZodIssueCode.custom, path: ["common", "firstUsedOn"], message: "Record the actual first-use date, or choose registration time / unknown." });
    if (value.firstUseMode !== "date" && value.common.firstUsedOn !== null) context.addIssue({ code: z.ZodIssueCode.custom, path: ["common", "firstUsedOn"], message: "A custom first-use date requires the date option." });
});
export type IntakeCommon = z.infer<typeof intakeCommonSchema>;
export type IntakePayload = z.infer<typeof intakePayloadSchema>;
export type FirstUseMode = IntakePayload["firstUseMode"];
export type IntakeAttempt = { actorAccountId: string; dataset: Dataset; payload: IntakePayload };
const nullableDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable();
const intakeReceiptFields = {
    requestId: z.string().uuid(), sessionId: z.string().uuid(), dataset: datasetSchema,
    actorAccountId: z.string().min(1), batteryId: z.string().max(64).regex(/^BAT-\d{8,}$/), tagId: z.string(),
    registeredAt: z.string().datetime({ offset: true }), replayed: z.boolean(),
    scannedAt: z.string().datetime({ offset: true }).optional(),
    name: z.string(), model: z.string(), chemistry: z.string(), capacityMah: z.number().finite().positive().nullable(), voltage: z.number().finite().positive().nullable(),
    ownerId: z.string(), homeBuildingId: z.string().nullable(), homeRoomId: z.string().nullable(), manufacturedOn: nullableDate, firstUsedOn: nullableDate,
};
export const intakeReceiptSchema = z.discriminatedUnion("source", [
    z.object({ ...intakeReceiptFields, source: z.literal("simulated_intake"), nfcEvidence: z.never().optional() }).strict(),
    z.object({ ...intakeReceiptFields, source: z.literal("native_nfc"), nfcEvidence: teachingNfcEvidenceSchema }).strict(),
]).superRefine((value, context) => {
    if (value.source === "native_nfc" && value.tagId !== value.nfcEvidence.tagId) context.addIssue({ code: z.ZodIssueCode.custom, path: ["tagId"], message: "The registered tag must retain the original native NFC evidence." });
});
export type IntakeReceipt = z.infer<typeof intakeReceiptSchema>;

export function intakeStorageKey(actorAccountId: string, dataset: Dataset) { return `battery-intake:${actorAccountId}:${dataset}`; }
export function captureIntakeAttempt(actorAccountId: string, dataset: Dataset, payload: IntakePayload): IntakeAttempt {
    if (dataset !== "demo") throw new Error("Batch intake is available only in Demonstration inventory.");
    return { actorAccountId, dataset, payload: intakePayloadSchema.parse(structuredClone(payload)) };
}
export function recoverIntakeSession(raw: string | null, actorAccountId: string, dataset: Dataset): IntakeAttempt | null {
    if (!raw) return null;
    try {
        const value = JSON.parse(raw);
        const stored = (value?.attempt ?? value) as IntakeAttempt;
        if (stored.actorAccountId !== actorAccountId || stored.dataset !== dataset) return null;
        return captureIntakeAttempt(actorAccountId, dataset, stored.payload);
    } catch { return null; }
}
export function verifyIntakeReceipt(value: unknown, attempt: IntakeAttempt): IntakeReceipt {
    const parsed = intakeReceiptSchema.safeParse(value);
    if (!parsed.success) throw new Error("The registration receipt is incomplete. Retry the preserved scan request.");
    const receipt = parsed.data, requested = attempt.payload;
    if (receipt.source !== (requested.source === "native_nfc" ? "native_nfc" : "simulated_intake") || requested.source === "native_nfc" && (receipt.source !== "native_nfc" || JSON.stringify(receipt.nfcEvidence) !== JSON.stringify(requested.nfcEvidence)))
        throw new Error("The registration receipt changed the reviewed input source or native NFC evidence. Retry the preserved request.");
    if (receipt.dataset !== attempt.dataset || receipt.actorAccountId !== attempt.actorAccountId || receipt.requestId !== requested.requestId || receipt.sessionId !== requested.sessionId || receipt.tagId !== requested.tagId)
        throw new Error("The registration receipt belongs to a different scan or inventory. Retry the preserved request.");
    if (receipt.scannedAt !== requested.scannedAt) throw new Error("The registration receipt differs from the captured device scan time. Retry the preserved request.");
    const common = requested.common;
    for (const field of ["name", "model", "chemistry", "capacityMah", "voltage", "ownerId", "homeBuildingId", "homeRoomId", "manufacturedOn"] as const) {
        if (receipt[field] !== common[field]) throw new Error("The registered battery differs from the reviewed batch details. Retry the preserved request.");
    }
    const firstUsedOn = requested.firstUseMode === "at_registration" ? currentSydneyDate(new Date(receipt.registeredAt)) : requested.firstUseMode === "date" ? common.firstUsedOn : null;
    if (receipt.firstUsedOn !== firstUsedOn) throw new Error("The recorded service-start date differs from the reviewed batch. Retry the preserved request.");
    return receipt;
}
export function intakeFailureStatus(error: unknown): "rejected" | "unknown" {
    const value = error as { status?: number; code?: string };
    // Authentication failure on retry cannot establish the prior request's outcome.
    if (value?.status === 409) return value.code === "intake_rejected_final" ? "rejected" : "unknown";
    return [400, 404, 422, 501].includes(value?.status ?? 0) ? "rejected" : "unknown";
}
