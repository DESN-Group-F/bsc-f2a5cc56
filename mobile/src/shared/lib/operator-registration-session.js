import { z } from "zod";
import { batterySchema, datasetSchema } from "./domain.js";
import { currentSydneyDate } from "./battery-age.js";
import { intakeCommonSchema } from "./intake-session.js";
export const OPERATOR_REGISTRATION_SOURCE = "operator-entered-registration";
/** Typed identifiers are operator evidence, never a hardware observation. */
export const operatorRegistrationPayloadSchema = z.object({
    requestId: z.string().uuid(), sessionId: z.string().uuid(),
    source: z.literal(OPERATOR_REGISTRATION_SOURCE), tagId: batterySchema.shape.tagId,
    directoryBindings: z.object({ ownerVersion: z.number().int().positive(), ownerAccountId: z.string().uuid(), buildingVersion: z.number().int().positive(), roomVersion: z.number().int().positive().nullable() }).strict(),
    common: intakeCommonSchema.omit({ teachingGroup: true }),
    firstUseMode: z.enum(["at_registration", "date", "unknown"]).default("at_registration"),
}).strict().superRefine((value, context) => {
    if (value.firstUseMode === "date" && !value.common.firstUsedOn)
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["common", "firstUsedOn"], message: "Record the actual first-use date, or choose registration time / unknown." });
    if (value.firstUseMode !== "date" && value.common.firstUsedOn !== null)
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["common", "firstUsedOn"], message: "A custom first-use date requires the date option." });
});
const nullableDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable();
export const operatorRegistrationReceiptSchema = z.object({
    requestId: z.string().uuid(), sessionId: z.string().uuid(), dataset: datasetSchema,
    actorAccountId: z.string().uuid(), batteryId: z.string().regex(/^BAT-\d{8}$/), tagId: batterySchema.shape.tagId,
    registeredAt: z.string().datetime({ offset: true }), source: z.literal(OPERATOR_REGISTRATION_SOURCE), replayed: z.boolean(),
    name: z.string(), model: z.string(), chemistry: z.string(), capacityMah: z.number().finite().positive().nullable(), voltage: z.number().finite().positive().nullable(),
    ownerId: z.string(), homeBuildingId: z.string().nullable(), homeRoomId: z.string().nullable(), manufacturedOn: nullableDate, firstUsedOn: nullableDate,
}).strict();
export function verifyOperatorRegistrationReceipt(value, payload, actorAccountId, dataset) {
    const receipt = operatorRegistrationReceiptSchema.parse(value);
    if (receipt.dataset !== dataset || receipt.actorAccountId !== actorAccountId || receipt.requestId !== payload.requestId || receipt.sessionId !== payload.sessionId || receipt.tagId !== payload.tagId)
        throw new Error("The registration receipt belongs to a different request, account or inventory. Resolve the preserved request.");
    for (const field of ["name", "model", "chemistry", "capacityMah", "voltage", "ownerId", "homeBuildingId", "homeRoomId", "manufacturedOn"]) {
        if (receipt[field] !== payload.common[field])
            throw new Error("The registered battery differs from the reviewed details. Resolve the preserved request.");
    }
    const firstUsedOn = payload.firstUseMode === "at_registration" ? currentSydneyDate(new Date(receipt.registeredAt)) : payload.firstUseMode === "date" ? payload.common.firstUsedOn : null;
    if (receipt.firstUsedOn !== firstUsedOn)
        throw new Error("The registration service-start date differs from the reviewed details. Resolve the preserved request.");
    return receipt;
}
