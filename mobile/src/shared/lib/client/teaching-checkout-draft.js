import { z } from "zod";
import { datasetSchema, identifier } from "../domain.js";
import { inventoryFilterSchema } from "../inventory-query.js";
import { teachingGroupSchema } from "../teaching-groups.js";
import { teachingCheckoutListedRunSchema, teachingCheckoutRunItemSchema, teachingPersonalScopeSchema, teachingSelectionSourceSchema } from "../teaching-checkouts.js";
import { validateTeachingNfcTag } from "../teaching-nfc.js";
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
}).passthrough();
const selectionSchema = z.object({ originalId: identifier, original: batterySchema.nullable(), actual: batterySchema.nullable(), method: z.enum(["original", "automatic", "manual"]), source: teachingSelectionSourceSchema, existingLoanId: z.string().uuid().optional(), issue: z.string().optional() }).strict().superRefine((slot, context) => {
    if (slot.original && slot.original.id !== slot.originalId)
        context.addIssue({ code: z.ZodIssueCode.custom, message: "The original member binding changed." });
    if (slot.actual && !slot.original)
        context.addIssue({ code: z.ZodIssueCode.custom, message: "An alternative needs its reviewed original member." });
    if (slot.existingLoanId && (!slot.actual || slot.actual.loanId !== slot.existingLoanId))
        context.addIssue({ code: z.ZodIssueCode.custom, message: "The reviewed existing loan changed." });
    if (slot.actual && slot.source.kind === "native_nfc") {
        try {
            validateTeachingNfcTag(slot.source.evidence, slot.actual.tagId);
        }
        catch {
            context.addIssue({ code: z.ZodIssueCode.custom, message: "The actual battery tag must match the complete adopted NFC evidence." });
        }
    }
});
export const teachingCheckoutDraftSchema = z.object({
    actorAccountId: z.string().min(1), dataset: datasetSchema, kind: z.enum(["checkout", "return", "continue", "exchange"]),
    group: teachingGroupSchema.optional(), run: teachingCheckoutListedRunSchema.optional(),
    separateCheckout: z.boolean().optional(),
    exchange: z.object({ originalBatteryId: identifier, outgoing: teachingCheckoutRunItemSchema, actual: batterySchema.nullable(), returnOutgoing: z.boolean() }).strict().optional(),
    slots: z.array(selectionSchema).max(100), personalScope: teachingPersonalScopeSchema,
    excludedIds: z.array(identifier).max(100), selectedReturnIds: z.array(identifier).max(100),
    inputSource: z.enum(["selection", "tag", "native_nfc"]), manualOriginalId: z.string(), filters: inventoryFilterSchema.innerType(),
}).strict().superRefine((draft, context) => {
    if ((draft.kind === "checkout" || draft.kind === "continue") && (!draft.group || draft.group.ownerAccountId !== draft.actorAccountId || !draft.slots.length || draft.slots.some(slot => !draft.group.batteryIds.includes(slot.originalId))))
        context.addIssue({ code: z.ZodIssueCode.custom, message: "This checkout draft lost its fixed group review." });
    if (draft.kind !== "checkout" && (!draft.run || draft.run.actorAccountId !== draft.actorAccountId || draft.run.dataset !== draft.dataset))
        context.addIssue({ code: z.ZodIssueCode.custom, message: "This review lost its actual checkout record." });
    if (draft.kind === "exchange" && (!draft.exchange || !draft.run?.items.some(item => item.batteryId === draft.exchange.outgoing.batteryId && item.loanId === draft.exchange.outgoing.loanId && item.status === "outstanding" && !item.pendingReturn)))
        context.addIssue({ code: z.ZodIssueCode.custom, message: "This exchange lost its reviewed outstanding battery." });
    if (draft.filters.personalScope !== draft.personalScope)
        context.addIssue({ code: z.ZodIssueCode.custom, message: "The fixed personal boundary changed." });
    if (new Set(draft.slots.map(slot => slot.originalId)).size !== draft.slots.length || new Set(draft.slots.flatMap(slot => slot.actual && !draft.excludedIds.includes(slot.originalId) ? [slot.actual.id] : [])).size !== draft.slots.filter(slot => slot.actual && !draft.excludedIds.includes(slot.originalId)).length)
        context.addIssue({ code: z.ZodIssueCode.custom, message: "The review contains duplicate members or actual batteries." });
    if (draft.slots.some(slot => slot.method === "manual" && slot.actual && !draft.excludedIds.includes(slot.originalId) && slot.source.kind !== draft.inputSource))
        context.addIssue({ code: z.ZodIssueCode.custom, message: "Manual alternatives must retain one explicit input source." });
});
export function teachingCheckoutDraftStorageKey(accountId, dataset) { return `battery-teaching-checkout-draft:${accountId}:${dataset}`; }
export function recoverTeachingCheckoutDraft(raw, accountId, dataset) {
    if (raw === null)
        return null;
    const result = teachingCheckoutDraftSchema.safeParse(JSON.parse(raw));
    if (!result.success || result.data.actorAccountId !== accountId || result.data.dataset !== dataset)
        throw new Error("The saved teaching checkout draft cannot be recovered safely. Preserve this tab and resolve it before preparing another operation.");
    return result.data;
}
export function persistTeachingCheckoutDraft(accountId, dataset, draft) {
    const key = teachingCheckoutDraftStorageKey(accountId, dataset), raw = draft ? JSON.stringify(teachingCheckoutDraftSchema.parse(draft)) : null;
    if (draft && (draft.actorAccountId !== accountId || draft.dataset !== dataset))
        throw new Error("This draft belongs to another staff account or inventory.");
    if (raw === null)
        window.__batteryWorkflowStorage.removeItem(key);
    else
        window.__batteryWorkflowStorage.setItem(key, raw);
    if (window.__batteryWorkflowStorage.getItem(key) !== raw)
        throw new Error("The reviewed teaching draft could not be preserved. No business request was sent.");
    window.dispatchEvent(new Event("battery-teaching-checkout-recovery"));
}
export function discoverTeachingCheckoutDrafts(accountId) {
    return ["demo", "live"].flatMap(dataset => {
        const draft = recoverTeachingCheckoutDraft(window.__batteryWorkflowStorage.getItem(teachingCheckoutDraftStorageKey(accountId, dataset)), accountId, dataset);
        return draft ? [draft] : [];
    });
}
export function reviewedTeachingCheckoutAttempt(attempt) {
    const draft = teachingCheckoutDraftSchema.parse(attempt.reviewed), payload = attempt.payload;
    const fail = () => { throw new Error("The preserved request and its displayed review do not match. Preserve this tab and resolve the original request."); };
    if (draft.actorAccountId !== attempt.actorAccountId || draft.dataset !== attempt.dataset || draft.personalScope !== payload.personalScope || draft.kind !== payload.action)
        return fail();
    if (payload.action === "checkout" || payload.action === "continue") {
        if (payload.action === "checkout" && !!draft.separateCheckout !== !!payload.separateCheckout)
            return fail();
        if (payload.action === "continue" && (draft.run?.id !== payload.runId || (draft.run.revision ?? 1) !== payload.expectedRevision))
            return fail();
        const included = draft.slots.filter(slot => !draft.excludedIds.includes(slot.originalId));
        if (draft.group?.id !== payload.teachingGroup.id || draft.group.version !== payload.teachingGroup.version || included.length !== payload.mappings.length)
            return fail();
        for (let index = 0; index < included.length; index++) {
            const slot = included[index], expected = payload.mappings[index];
            if (!slot.original || !slot.actual || slot.originalId !== expected.original.batteryId || slot.actual.id !== expected.actual.batteryId || slot.original.version !== expected.original.version || slot.actual.version !== expected.actual.version || slot.original.tagId !== expected.original.tagId || slot.actual.tagId !== expected.actual.tagId || slot.original.loanId !== expected.originalLoanId || slot.existingLoanId !== expected.existingLoanId || slot.method !== expected.method || JSON.stringify(slot.source) !== JSON.stringify(expected.source))
                return fail();
        }
    }
    else if (payload.action === "exchange") {
        const exchange = draft.exchange;
        if (draft.run?.id !== payload.runId || (draft.run.revision ?? 1) !== payload.expectedRevision || !exchange?.actual || exchange.originalBatteryId !== payload.originalBatteryId || exchange.returnOutgoing !== payload.returnOutgoing || exchange.outgoing.batteryId !== payload.outgoing.batteryId || exchange.outgoing.loanId !== payload.outgoing.loanId || exchange.outgoing.tagId !== payload.outgoing.tagId || exchange.outgoing.version !== payload.outgoing.version || exchange.actual.id !== payload.actual.batteryId || exchange.actual.tagId !== payload.actual.tagId || exchange.actual.version !== payload.actual.version || exchange.actual.loanId !== payload.actualLoanId || payload.source.kind !== "selection")
            return fail();
    }
    else {
        if (draft.run?.id !== payload.runId || draft.selectedReturnIds.length !== payload.items.length || payload.items.some(item => !draft.selectedReturnIds.includes(item.batteryId) || !draft.run.items.some(record => record.batteryId === item.batteryId && record.loanId === item.loanId && record.tagId === item.tagId && record.version === item.version && record.status === "outstanding")))
            return fail();
    }
    return draft;
}
