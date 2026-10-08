import { z } from "zod";
import { datasetSchema, identifier, type BatteryRecord, type Dataset } from "../domain";
import { inventoryFilterSchema } from "../inventory-query";
import { teachingGroupSchema } from "../teaching-groups";
import { teachingCheckoutRunSchema, teachingPersonalScopeSchema, teachingSelectionSourceSchema } from "../teaching-checkouts";
import type { TeachingSelection } from "../teaching-checkout-selection";
import { validateTeachingNfcTag } from "../teaching-nfc";
import type { TeachingCheckoutAttempt } from "./teaching-checkout-request";

const text = z.string().nullable(), time = z.string().datetime({ offset: true }).nullable();
const batterySchema = z.object({
    id: identifier, version: z.number().int().positive(), name: z.string(), model: z.string(), chemistry: z.string(),
    capacityMah: z.number().positive().nullable(), voltage: z.number().positive().nullable(), tagId: text,
    registeredAt: z.string().datetime({ offset: true }), manufacturedOn: text, firstUsedOn: text,
    lifecycleStatus: z.enum(["active", "scrapped", "permanently_removed"]), lifecycleAt: time, lifecycleReason: text, lifecycleDestination: text,
    ownerId: identifier, ownerName: z.string(), ownerAccountId: text, homeBuildingId: text, homeBuildingName: text,
    homeRoomId: text, homeRoomName: text, homeRoomNumber: text, homeRoomIsPlaceholder: z.boolean().nullable(), homeRoomSelectable: z.boolean().nullable(),
    loanId: z.string().uuid().nullable(), borrowerId: text, borrowerName: text, borrowerAccountId: text, borrowerKind: z.enum(["staff", "legacy"]).nullable(),
    checkedOutAt: time, lastCheckedOutAt: time, observedRoom: text, observedRoomId: text, observedBuilding: text,
    observationRoomSnapshot: z.enum(["recorded", "unavailable"]).nullable(), observedAt: time, observationSource: text,
    chargedAt: time, chargeDurationMinutes: z.number().nullable(),
}).passthrough() as z.ZodType<BatteryRecord>;
const selectionSchema = z.object({ originalId: identifier, original: batterySchema.nullable(), actual: batterySchema.nullable(), method: z.enum(["original", "automatic", "manual"]), source: teachingSelectionSourceSchema, issue: z.string().optional() }).strict().superRefine((slot, context) => {
    if (slot.original && slot.original.id !== slot.originalId) context.addIssue({ code: z.ZodIssueCode.custom, message: "The original member binding changed." });
    if (slot.actual && !slot.original) context.addIssue({ code: z.ZodIssueCode.custom, message: "An alternative needs its reviewed original member." });
    if (slot.actual && slot.source.kind === "native_nfc") {
        try { validateTeachingNfcTag(slot.source.evidence, slot.actual.tagId); }
        catch { context.addIssue({ code: z.ZodIssueCode.custom, message: "The actual battery tag must match the complete adopted NFC evidence." }); }
    }
});
const listedRunSchema = teachingCheckoutRunSchema.extend({ items: z.array(z.object({ batteryId: identifier, loanId: z.string().uuid().nullable(), status: z.enum(["outstanding", "returned", "cancelled", "deleted"]), tagId: text, version: z.number().int().positive().nullable(), returnedAt: time }).strict()) });
export const teachingCheckoutDraftSchema = z.object({
    actorAccountId: z.string().min(1), dataset: datasetSchema, kind: z.enum(["checkout", "return"]),
    group: teachingGroupSchema.optional(), run: listedRunSchema.optional(),
    slots: z.array(selectionSchema).max(100), personalScope: teachingPersonalScopeSchema,
    excludedIds: z.array(identifier).max(100), selectedReturnIds: z.array(identifier).max(100),
    inputSource: z.enum(["selection", "tag", "native_nfc"]), manualOriginalId: z.string(), filters: inventoryFilterSchema.innerType(),
}).strict().superRefine((draft, context) => {
    if (draft.kind === "checkout" && (!draft.group || draft.group.ownerAccountId !== draft.actorAccountId || !draft.slots.length || draft.slots.some(slot => !draft.group!.batteryIds.includes(slot.originalId)))) context.addIssue({ code: z.ZodIssueCode.custom, message: "This checkout draft lost its fixed group review." });
    if (draft.kind === "return" && (!draft.run || draft.run.actorAccountId !== draft.actorAccountId || draft.run.dataset !== draft.dataset)) context.addIssue({ code: z.ZodIssueCode.custom, message: "This return draft lost its actual checkout review." });
    if (draft.filters.personalScope !== draft.personalScope) context.addIssue({ code: z.ZodIssueCode.custom, message: "The fixed personal boundary changed." });
    if (new Set(draft.slots.map(slot => slot.originalId)).size !== draft.slots.length || new Set(draft.slots.flatMap(slot => slot.actual && !draft.excludedIds.includes(slot.originalId) ? [slot.actual.id] : [])).size !== draft.slots.filter(slot => slot.actual && !draft.excludedIds.includes(slot.originalId)).length) context.addIssue({ code: z.ZodIssueCode.custom, message: "The review contains duplicate members or actual batteries." });
    if (draft.slots.some(slot => slot.method === "manual" && slot.actual && !draft.excludedIds.includes(slot.originalId) && slot.source.kind !== draft.inputSource)) context.addIssue({ code: z.ZodIssueCode.custom, message: "Manual alternatives must retain one explicit input source." });
});
export type SavedTeachingCheckoutDraft = z.infer<typeof teachingCheckoutDraftSchema> & { slots: TeachingSelection[] };
export function teachingCheckoutDraftStorageKey(accountId: string, dataset: Dataset) { return `battery-teaching-checkout-draft:${accountId}:${dataset}`; }
export function recoverTeachingCheckoutDraft(raw: string | null, accountId: string, dataset: Dataset): SavedTeachingCheckoutDraft | null {
    if (raw === null) return null;
    const result = teachingCheckoutDraftSchema.safeParse(JSON.parse(raw));
    if (!result.success || result.data.actorAccountId !== accountId || result.data.dataset !== dataset) throw new Error("The saved teaching checkout draft cannot be recovered safely. Preserve this tab and resolve it before preparing another operation.");
    return result.data;
}
export function persistTeachingCheckoutDraft(accountId: string, dataset: Dataset, draft: SavedTeachingCheckoutDraft | null) {
    const key = teachingCheckoutDraftStorageKey(accountId, dataset), raw = draft ? JSON.stringify(teachingCheckoutDraftSchema.parse(draft)) : null;
    if (draft && (draft.actorAccountId !== accountId || draft.dataset !== dataset)) throw new Error("This draft belongs to another staff account or inventory.");
    if (raw === null) sessionStorage.removeItem(key); else sessionStorage.setItem(key, raw);
    if (sessionStorage.getItem(key) !== raw) throw new Error("The reviewed teaching draft could not be preserved. No business request was sent.");
    window.dispatchEvent(new Event("battery-teaching-checkout-recovery"));
}
export function discoverTeachingCheckoutDrafts(accountId: string): SavedTeachingCheckoutDraft[] {
    return (["demo", "live"] as const).flatMap(dataset => {
        const draft = recoverTeachingCheckoutDraft(sessionStorage.getItem(teachingCheckoutDraftStorageKey(accountId, dataset)), accountId, dataset);
        return draft ? [draft] : [];
    });
}

export function reviewedTeachingCheckoutAttempt(attempt: TeachingCheckoutAttempt): SavedTeachingCheckoutDraft {
    const draft = teachingCheckoutDraftSchema.parse(attempt.reviewed), payload = attempt.payload;
    const fail = () => { throw new Error("The preserved request and its displayed review do not match. Preserve this tab and resolve the original request."); };
    if (draft.actorAccountId !== attempt.actorAccountId || draft.dataset !== attempt.dataset || draft.personalScope !== payload.personalScope || draft.kind !== payload.action) return fail();
    if (payload.action === "checkout") {
        const included = draft.slots.filter(slot => !draft.excludedIds.includes(slot.originalId));
        if (draft.group?.id !== payload.teachingGroup.id || draft.group.version !== payload.teachingGroup.version || included.length !== payload.mappings.length) return fail();
        for (let index = 0; index < included.length; index++) {
            const slot = included[index], expected = payload.mappings[index];
            if (!slot.original || !slot.actual || slot.originalId !== expected.original.batteryId || slot.actual.id !== expected.actual.batteryId || slot.original.version !== expected.original.version || slot.actual.version !== expected.actual.version || slot.original.tagId !== expected.original.tagId || slot.actual.tagId !== expected.actual.tagId || slot.original.loanId !== expected.originalLoanId || slot.method !== expected.method || JSON.stringify(slot.source) !== JSON.stringify(expected.source)) return fail();
        }
    } else {
        if (draft.run?.id !== payload.runId || draft.selectedReturnIds.length !== payload.items.length || payload.items.some(item => !draft.selectedReturnIds.includes(item.batteryId) || !draft.run!.items.some(record => record.batteryId === item.batteryId && record.loanId === item.loanId && record.tagId === item.tagId && record.version === item.version && record.status === "outstanding"))) return fail();
    }
    return draft;
}
