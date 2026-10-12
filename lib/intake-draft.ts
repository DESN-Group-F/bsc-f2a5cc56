import { z } from "zod";
import { intakeCommonSchema, intakePayloadSchema, intakeReceiptSchema, captureIntakeAttempt, recoverIntakeSession, type IntakeAttempt } from "./intake-session";
import { datasetSchema, type Dataset } from "./domain";
import { teachingNfcEvidenceSchema } from "./teaching-nfc";

const firstUseMode = z.enum(["at_registration", "date", "unknown"]);
const intakeQueueEntryFields = {
    id: z.string().uuid(),
    scannedAt: z.string().datetime({ offset: true }).nullable(),
    common: intakeCommonSchema, firstUseMode, sessionId: z.string().uuid(),
    selected: z.boolean(), error: z.string().max(4000),
};
const intakeQueueEntrySchema = z.discriminatedUnion("source", [
    z.object({ ...intakeQueueEntryFields, source: z.literal("simulated_intake").optional(), nfcEvidence: z.never().optional(), tagId: z.string().trim().max(128).regex(/^DEMO-INTAKE-[A-Za-z0-9._-]+$/) }).strict(),
    z.object({ ...intakeQueueEntryFields, source: z.literal("native_nfc"), nfcEvidence: teachingNfcEvidenceSchema, tagId: z.string().regex(/^nfc:uid:(?:[0-9A-F]{8}|[0-9A-F]{14}|[0-9A-F]{20})$/) }).strict(),
]);
const attemptSchema = z.object({ actorAccountId: z.string().min(1), dataset: datasetSchema, payload: intakePayloadSchema }).strict();
const draftSchema = z.object({
    actorAccountId: z.string().min(1), dataset: z.literal("demo"),
    batch: z.object({ sessionId: z.string().uuid(), common: intakeCommonSchema, firstUseMode, source: z.enum(["simulated_intake", "native_nfc"]).optional() }).strict().nullable(),
    entries: z.array(intakeQueueEntrySchema).max(200),
    attempt: attemptSchema.nullable(), attemptEntryId: z.string().uuid().nullable(), completed: z.array(intakeReceiptSchema),
}).strict().superRefine((value, context) => {
    if (new Set(value.entries.map(entry => entry.id)).size !== value.entries.length || new Set(value.entries.map(entry => entry.tagId)).size !== value.entries.length)
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["entries"], message: "Each pending entry requires a distinct identity and tag." });
    if (new Set(value.entries.map(entry => entry.source ?? "simulated_intake")).size > 1 || value.batch?.source && value.entries.some(entry => (entry.source ?? "simulated_intake") !== value.batch?.source))
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["entries"], message: "Keep one reviewed input source per intake queue." });
    if (value.entries.some(entry => entry.source === "native_nfc" && entry.tagId !== entry.nfcEvidence.tagId))
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["entries"], message: "Every intake entry must retain its adopted native NFC tag and evidence." });
    if (value.attempt) {
        const entry = value.entries.find(entry => entry.id === value.attemptEntryId);
        if (value.attempt.actorAccountId !== value.actorAccountId || value.attempt.dataset !== value.dataset || !entry)
            context.addIssue({ code: z.ZodIssueCode.custom, path: ["attempt"], message: "The captured request must belong to this account, inventory and pending entry." });
        else {
            const payload = value.attempt.payload;
            if (payload.tagId !== entry.tagId || payload.sessionId !== entry.sessionId || payload.firstUseMode !== entry.firstUseMode || JSON.stringify(payload.common) !== JSON.stringify(entry.common) || payload.scannedAt !== (entry.scannedAt ?? undefined) || payload.source !== entry.source || JSON.stringify(payload.nfcEvidence) !== JSON.stringify(entry.nfcEvidence))
                context.addIssue({ code: z.ZodIssueCode.custom, path: ["attempt"], message: "The pending entry must retain its exact captured request." });
        }
    } else if (value.attemptEntryId !== null) context.addIssue({ code: z.ZodIssueCode.custom, path: ["attemptEntryId"], message: "No request is linked to this entry." });
});
export type IntakeQueueEntry = z.infer<typeof intakeQueueEntrySchema>;
export type IntakeDraftSession = z.infer<typeof draftSchema>;
export function captureIntakeDraft(input: IntakeDraftSession): IntakeDraftSession { return draftSchema.parse(structuredClone(input)); }
export function recoverIntakeDraft(raw: string | null, actorAccountId: string, dataset: Dataset): IntakeDraftSession | null {
    if (!raw || dataset !== "demo") return null;
    try {
        const value = JSON.parse(raw);
        if (value?.entries) {
            const draft = captureIntakeDraft(value);
            return draft.actorAccountId === actorAccountId && draft.dataset === dataset ? draft : null;
        }
        const prior = recoverIntakeSession(raw, actorAccountId, dataset);
        if (!prior) return null;
        const attempt: IntakeAttempt = captureIntakeAttempt(actorAccountId, dataset, prior.payload);
        const payload = attempt.payload, id = payload.requestId;
        const native = payload.source === "native_nfc" ? { source: payload.source, nfcEvidence: payload.nfcEvidence } : payload.source ? { source: payload.source } : {};
        return captureIntakeDraft({ actorAccountId, dataset, batch: { sessionId: payload.sessionId, common: payload.common, firstUseMode: payload.firstUseMode, ...(payload.source ? { source: payload.source } : {}) }, entries: [{ id, tagId: payload.tagId, scannedAt: payload.scannedAt ?? null, common: payload.common, firstUseMode: payload.firstUseMode, sessionId: payload.sessionId, selected: true, error: "", ...native }], attempt, attemptEntryId: id, completed: [] });
    } catch { return null; }
}
