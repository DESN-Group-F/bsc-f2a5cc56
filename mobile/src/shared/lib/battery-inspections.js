import { z } from "zod";
import { datasetSchema, identifier } from "./domain.js";
export const inspectionKindSchema = z.enum(["visual_check", "functional_check", "capacity_measurement", "other"]);
export const inspectionOutcomeSchema = z.enum(["no_concern_observed", "concern_observed", "inconclusive"]);
export const inspectionSchema = z.object({
    requestId: z.string().uuid(),
    batteryId: identifier,
    expectedBatteryVersion: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    kind: inspectionKindSchema,
    outcome: inspectionOutcomeSchema,
    performedAt: z.string().datetime({ offset: true }),
    method: z.string().trim().max(1000).default(""),
    notes: z.string().trim().max(2000).default(""),
    reference: z.string().trim().max(1000).default(""),
    capacityMah: z.number().finite().positive().max(1000000).nullable().default(null),
}).strict().superRefine((value, context) => {
    if ((value.outcome === "concern_observed" || value.kind === "other") && !value.notes)
        context.addIssue({ code: "custom", path: ["notes"], message: "Describe the observed concern or other check." });
    if (value.kind === "capacity_measurement") {
        if (value.capacityMah === null)
            context.addIssue({ code: "custom", path: ["capacityMah"], message: "Record the measured capacity in mAh." });
        if (!value.method)
            context.addIssue({ code: "custom", path: ["method"], message: "Describe the capacity measurement method and conditions." });
    }
    else if (value.capacityMah !== null) {
        context.addIssue({ code: "custom", path: ["capacityMah"], message: "Capacity belongs only to a capacity measurement." });
    }
});
export const inspectionVoidSchema = z.object({
    requestId: z.string().uuid(), batteryId: identifier, inspectionId: z.string().uuid(),
    reason: z.string().trim().min(5).max(1000),
}).strict();
export const inspectionReceiptSchema = z.object({
    requestId: z.string().uuid(), dataset: datasetSchema, actorAccountId: z.string().min(1),
    batteryId: identifier, inspectionId: z.string().uuid(), action: z.enum(["inspection", "inspection_void"]),
    at: z.string().datetime({ offset: true }), replayed: z.boolean(),
});
