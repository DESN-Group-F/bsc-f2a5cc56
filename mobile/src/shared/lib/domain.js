import { z } from "zod";
import { currentSydneyDate, isDateOnly } from "./battery-age.js";
import { teachingGroupReferenceSchema } from "./teaching-context.js";
export const datasetSchema = z.enum(["demo", "live"]);
export const lifecycleStatusSchema = z.enum(["active", "scrapped", "permanently_removed"]);
export const identifier = z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, "Use letters, numbers, dots, underscores or hyphens.");
const expectedVersion = z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional();
const batteryDate = z.string().refine(isDateOnly, "Use a real calendar date in YYYY-MM-DD format.").nullable().default(null);
export const personSchema = z.object({ id: identifier, name: z.string().trim().min(2).max(120), reference: z.string().trim().max(80).default(""), role: z.enum(["staff", "borrower"]), expectedVersion });
export const buildingSchema = z.object({ id: identifier, name: z.string().trim().min(2).max(120), expectedVersion });
export const roomSchema = z.object({ id: identifier, name: z.string().trim().min(2).max(120), buildingId: identifier, number: z.string().trim().min(1).max(40), isPlaceholder: z.boolean().optional(), expectedVersion });
export const batterySchema = z.object({
    id: identifier, name: z.string().trim().min(2).max(120), chemistry: z.string().trim().max(40).default(""), model: z.string().trim().max(120).default(""),
    capacityMah: z.number().finite().positive().max(1000000).nullable().default(null), voltage: z.number().finite().positive().max(1000).nullable().default(null),
    tagId: z.string().trim().min(1).max(128).nullable().default(null), ownerId: identifier, homeBuildingId: identifier.nullable().default(null), homeRoomId: identifier.nullable().default(null), expectedVersion,
    manufacturedOn: batteryDate, firstUsedOn: batteryDate, teachingGroup: teachingGroupReferenceSchema.optional(),
});
const recordVersion = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const tagIdentifier = z.string().trim().min(1).max(128);
export const scanSourceSchema = z.enum(["simulated", "manual", "selection"]);
export const scanLookupSchema = z.object({ tagIds: z.array(tagIdentifier).min(1).max(100), source: z.enum(["simulated", "manual"]) }).strict();
export const scanContextSchema = z.object({ sessionId: z.string().uuid(), source: scanSourceSchema, bindings: z.array(z.object({ batteryId: identifier, tagId: tagIdentifier.nullable(), version: recordVersion }).strict()).min(1).max(100) }).strict()
    .refine(value => value.source === "selection" || value.bindings.every(binding => binding.tagId !== null), "Tag reads require registered tags; only manual battery selection can include an untagged battery.");
const movementFields = { requestId: z.string().uuid(), batteryIds: z.array(identifier).min(1).max(100), scan: scanContextSchema.optional(), teachingGroup: teachingGroupReferenceSchema.optional() };
export const movementSchema = z.discriminatedUnion("kind", [
    z.object({ ...movementFields, kind: z.literal("checkout") }).strict(),
    z.object({ ...movementFields, kind: z.literal("return"), expectedLoans: z.array(z.object({ batteryId: identifier, loanId: z.string().uuid() }).strict()).min(1).max(100), returnRoom: z.object({ roomId: identifier, version: recordVersion }).strict().optional() }).strict(),
]);
export const chargeSchema = z.object({ requestId: z.string().uuid(), batteryId: identifier, completedAt: z.string().datetime({ offset: true }), durationMinutes: z.number().finite().positive().max(525600), teachingGroup: teachingGroupReferenceSchema.optional() }).strict();
export const observationSchema = z.object({ requestId: z.string().uuid(), batteryId: identifier, roomId: identifier, observedAt: z.string().datetime({ offset: true }), teachingGroup: teachingGroupReferenceSchema.optional() });
export const correctionSchema = z.object({ requestId: z.string().uuid(), loanId: z.string().uuid(), action: z.enum(["checkout_voided", "return_reopened"]), expectedReturnedAt: z.string().datetime({ offset: true }).nullable(), reason: z.string().trim().min(5).max(500), teachingGroup: teachingGroupReferenceSchema.optional() }).strict();
export class DomainError extends Error {
    status;
    code;
    constructor(status, message, code) {
        super(message);
        this.status = status;
        this.code = code;
        this.name = "DomainError";
    }
}
export function uniqueIds(ids) { return [...new Set(ids)].sort(); }
export function recordKey(scope, id) { return `${scope}/${id}`; }
export function validatePastTime(value, now) {
    const parsed = Date.parse(value);
    if (!Number.isFinite(parsed) || parsed > now.getTime() + 60000)
        throw new DomainError(400, "Record a valid time that is not in the future.");
    return new Date(parsed).toISOString();
}
export function validateBatteryDates(battery, now) {
    const today = currentSydneyDate(now);
    if (battery.manufacturedOn && battery.manufacturedOn > today)
        throw new DomainError(400, "The manufacture date cannot be in the future (Sydney date).");
    if (battery.firstUsedOn && battery.firstUsedOn > today)
        throw new DomainError(400, "The first-use date cannot be in the future (Sydney date).");
    if (battery.manufacturedOn && battery.firstUsedOn && battery.firstUsedOn < battery.manufacturedOn)
        throw new DomainError(400, "The first-use date cannot be earlier than the manufacture date.");
}
