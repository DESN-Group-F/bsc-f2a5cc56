import { z } from "zod";
import { datasetSchema, identifier } from "./domain.js";
import { teachingGroupReferenceSchema } from "./teaching-context.js";
import { teachingNfcEvidenceSchema } from "./teaching-nfc.js";
const removalDraftFields = {
    actorAccountId: z.string().min(1), dataset: datasetSchema, teachingGroup: teachingGroupReferenceSchema.optional(),
    kind: z.enum(["scrapped", "permanently_removed"]),
    reason: z.string().max(1000), destination: z.string().max(200),
    selectedIds: z.array(identifier).max(100),
};
const removalDraftItemFields = { batteryId: identifier, version: z.number().int().positive().max(Number.MAX_SAFE_INTEGER - 1), tagId: z.string().min(1).max(128).nullable(), name: z.string().max(120) };
export const removalDraftSchema = z.discriminatedUnion("source", [
    z.object({ ...removalDraftFields, source: z.enum(["tag_entry", "manual_selection"]), items: z.array(z.object({ ...removalDraftItemFields, nfcEvidence: z.never().optional() }).strict()).max(100) }).strict(),
    z.object({ ...removalDraftFields, dataset: z.literal("demo"), source: z.literal("native_nfc"), items: z.array(z.object({ ...removalDraftItemFields, tagId: z.string().regex(/^nfc:uid:(?:[0-9A-F]{8}|[0-9A-F]{14}|[0-9A-F]{20})$/), nfcEvidence: teachingNfcEvidenceSchema }).strict()).max(100) }).strict(),
]).superRefine((value, context) => {
    if (value.source === "native_nfc" && value.items.some(item => item.tagId !== item.nfcEvidence.tagId))
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["items"], message: "Keep the exact adopted tag and full native NFC evidence in each removal draft entry." });
    const ids = new Set(value.items.map(item => item.batteryId));
    if (ids.size !== value.items.length || new Set(value.selectedIds).size !== value.selectedIds.length || value.selectedIds.some(id => !ids.has(id)))
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["items"], message: "Keep unique reviewed batteries and selections within this removal draft." });
});
export function removalDraftStorageKey(actorAccountId, dataset) { return `battery-removal-draft:${actorAccountId}:${dataset}`; }
export function captureRemovalDraft(input) { return removalDraftSchema.parse(structuredClone(input)); }
export function recoverRemovalDraft(raw, actorAccountId, dataset) {
    if (!raw)
        return null;
    try {
        const draft = captureRemovalDraft(JSON.parse(raw));
        return draft.actorAccountId === actorAccountId && draft.dataset === dataset ? draft : null;
    }
    catch {
        return null;
    }
}
