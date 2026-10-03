import { z } from "zod";
import { intakeCommonSchema, intakePayloadSchema, intakeReceiptSchema, captureIntakeAttempt, recoverIntakeSession, type IntakeAttempt } from "./intake-session";
import { datasetSchema, type Dataset } from "./domain";

const firstUseMode = z.enum(["at_registration", "date", "unknown"]);
const intakeQueueEntrySchema = z.object({
    id: z.string().uuid(), tagId: z.string().trim().max(128).regex(/^DEMO-INTAKE-[A-Za-z0-9._-]+$/),
    scannedAt: z.string().datetime({ offset: true }).nullable(),
    common: intakeCommonSchema, firstUseMode, sessionId: z.string().uuid(),
    selected: z.boolean(), error: z.string().max(4000),
}).strict();
const attemptSchema = z.object({ actorAccountId: z.string().min(1), dataset: datasetSchema, payload: intakePayloadSchema }).strict();
const draftSchema = z.object({
    actorAccountId: z.string().min(1), dataset: z.literal("demo"),
    batch: z.object({ sessionId: z.string().uuid(), common: intakeCommonSchema, firstUseMode }).strict().nullable(),
    entries: z.array(intakeQueueEntrySchema).max(200),
    attempt: attemptSchema.nullable(), attemptEntryId: z.string().uuid().nullable(), completed: z.array(intakeReceiptSchema),
}).strict().superRefine((value, context) => {
    if (new Set(value.entries.map(entry => entry.id)).size !== value.entries.length || new Set(value.entries.map(entry => entry.tagId)).size !== value.entries.length)
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["entries"], message: "Each pending entry requires a distinct identity and tag." });
    if (value.attempt) {
        const entry = value.entries.find(entry => entry.id === value.attemptEntryId);
        if (value.attempt.actorAccountId !== value.actorAccountId || value.attempt.dataset !== value.dataset || !entry)
            context.addIssue({ code: z.ZodIssueCode.custom, path: ["attempt"], message: "The captured request must belong to this account, inventory and pending entry." });
        else {
            const payload = value.attempt.payload;
            if (payload.tagId !== entry.tagId || payload.sessionId !== entry.sessionId || payload.firstUseMode !== entry.firstUseMode || JSON.stringify(payload.common) !== JSON.stringify(entry.common) || payload.scannedAt !== (entry.scannedAt ?? undefined))
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
        return captureIntakeDraft({ actorAccountId, dataset, batch: { sessionId: payload.sessionId, common: payload.common, firstUseMode: payload.firstUseMode }, entries: [{ id, tagId: payload.tagId, scannedAt: payload.scannedAt ?? null, common: payload.common, firstUseMode: payload.firstUseMode, sessionId: payload.sessionId, selected: true, error: "" }], attempt, attemptEntryId: id, completed: [] });
    } catch { return null; }
}
