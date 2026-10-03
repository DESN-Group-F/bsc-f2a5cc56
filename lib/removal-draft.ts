import { z } from "zod";
import { datasetSchema, identifier, type Dataset } from "./domain";

import { teachingGroupReferenceSchema } from "./teaching-context";

export const removalDraftSchema = z.object({
    actorAccountId: z.string().min(1), dataset: datasetSchema, teachingGroup: teachingGroupReferenceSchema.optional(),
    source: z.enum(["tag_entry", "manual_selection"]), kind: z.enum(["scrapped", "permanently_removed"]),
    reason: z.string().max(1000), destination: z.string().max(200),
    items: z.array(z.object({ batteryId: identifier, version: z.number().int().positive().max(Number.MAX_SAFE_INTEGER - 1), tagId: z.string().min(1).max(128).nullable(), name: z.string().max(120) }).strict()).max(100),
    selectedIds: z.array(identifier).max(100),
}).strict().superRefine((value, context) => {
    const ids = new Set(value.items.map(item => item.batteryId));
    if (ids.size !== value.items.length || new Set(value.selectedIds).size !== value.selectedIds.length || value.selectedIds.some(id => !ids.has(id)))
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["items"], message: "Keep unique reviewed batteries and selections within this removal draft." });
});
export type RemovalDraft = z.infer<typeof removalDraftSchema>;
export function removalDraftStorageKey(actorAccountId: string, dataset: Dataset) { return `battery-removal-draft:${actorAccountId}:${dataset}`; }
export function captureRemovalDraft(input: RemovalDraft): RemovalDraft { return removalDraftSchema.parse(structuredClone(input)); }
export function recoverRemovalDraft(raw: string | null, actorAccountId: string, dataset: Dataset): RemovalDraft | null {
    if (!raw) return null;
    try {
        const draft = captureRemovalDraft(JSON.parse(raw));
        return draft.actorAccountId === actorAccountId && draft.dataset === dataset ? draft : null;
    } catch { return null; }
}
