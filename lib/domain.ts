import { z } from "zod";
import type { StaffUser } from "./accounts";
import { currentSydneyDate, isDateOnly } from "./battery-age";
export const datasetSchema = z.enum(["demo", "live"]);
export type Dataset = z.infer<typeof datasetSchema>;
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
    manufacturedOn: batteryDate, firstUsedOn: batteryDate,
});
const movementFields = { requestId: z.string().uuid(), batteryIds: z.array(identifier).min(1).max(100) };
export const movementSchema = z.discriminatedUnion("kind", [
    z.object({ ...movementFields, kind: z.literal("checkout") }).strict(),
    z.object({ ...movementFields, kind: z.literal("return"), expectedLoans: z.array(z.object({ batteryId: identifier, loanId: z.string().uuid() }).strict()).min(1).max(100) }).strict(),
]);
export const chargeSchema = z.object({ requestId: z.string().uuid(), batteryId: identifier, completedAt: z.string().datetime({ offset: true }), durationMinutes: z.number().finite().positive().max(525600) }).strict();
export const observationSchema = z.object({ requestId: z.string().uuid(), batteryId: identifier, roomId: identifier, observedAt: z.string().datetime({ offset: true }) });
export const correctionSchema = z.object({ requestId: z.string().uuid(), loanId: z.string().uuid(), action: z.enum(["checkout_voided", "return_reopened"]), expectedReturnedAt: z.string().datetime({ offset: true }).nullable(), reason: z.string().trim().min(5).max(500) }).strict();
export class DomainError extends Error {
    constructor(public status: number, message: string, public code?: string) { super(message); this.name = "DomainError"; }
}
export function uniqueIds(ids: string[]) { return [...new Set(ids)].sort(); }
export function recordKey(scope: string, id: string) { return `${scope}/${id}`; }
export function validatePastTime(value: string, now: Date) {
    const parsed = Date.parse(value);
    if (!Number.isFinite(parsed) || parsed > now.getTime() + 60000)
        throw new DomainError(400, "Record a valid time that is not in the future.");
    return new Date(parsed).toISOString();
}
export function validateBatteryDates(battery: { manufacturedOn: string | null; firstUsedOn: string | null }, now: Date) {
    const today = currentSydneyDate(now);
    if (battery.manufacturedOn && battery.manufacturedOn > today)
        throw new DomainError(400, "The manufacture date cannot be in the future (Sydney date).");
    if (battery.firstUsedOn && battery.firstUsedOn > today)
        throw new DomainError(400, "The first-use date cannot be in the future (Sydney date).");
    if (battery.manufacturedOn && battery.firstUsedOn && battery.firstUsedOn < battery.manufacturedOn)
        throw new DomainError(400, "The first-use date cannot be earlier than the manufacture date.");
}
export type Person = {
    accountId: string | null;
    version: number;
    id: string;
    name: string;
    reference: string;
    role: string;
};
export type Room = {
    isPlaceholder: boolean;
    selectable: boolean;
    version: number;
    id: string;
    name: string;
    building: string;
    buildingId: string | null;
    number: string | null;
};
export type Building = { version: number; id: string; name: string };
export type BatteryRecord = {
    version: number;
    id: string;
    name: string;
    chemistry: string;
    model: string;
    capacityMah: number | null;
    voltage: number | null;
    tagId: string | null;
    manufacturedOn: string | null;
    firstUsedOn: string | null;
    ownerId: string;
    ownerName: string;
    ownerAccountId: string | null;
    homeBuildingId: string | null;
    homeBuildingName: string | null;
    homeRoomId: string | null;
    homeRoomName: string | null;
    homeRoomNumber: string | null;
    homeRoomIsPlaceholder: boolean | null;
    homeRoomSelectable: boolean | null;
    loanId: string | null;
    borrowerId: string | null;
    borrowerName: string | null;
    borrowerAccountId: string | null;
    borrowerKind: "staff" | "legacy" | null;
    checkedOutAt: string | null;
    lastCheckedOutAt: string | null;
    observedRoom: string | null;
    observedBuilding: string | null;
    observationRoomSnapshot: "recorded" | "unavailable" | null;
    observedAt: string | null;
    observationSource: string | null;
    chargedAt: string | null;
    chargeDurationMinutes: number | null;
};
export type InventorySnapshot = {
    user: StaffUser;
    dataset: Dataset;
    batteries: BatteryRecord[];
    people: Person[];
    rooms: Room[];
    buildings: Building[];
    staffDirectory: { id: string; displayName: string; username: string; active: boolean }[];
    events: AuditEvent[];
    actor: string;
    hardwareConnected: false;
};
export type AuditEvent = {
    id: string;
    action: string;
    batteryId: string | null;
    actorName: string;
    at: string;
    details: Record<string, unknown>;
};
export type LoanRecord = {
    id: string;
    borrowerName: string;
    borrowerAccountId: string | null;
    borrowerKind: "staff" | "legacy";
    checkedOutAt: string;
    returnedAt: string | null;
    cancelledAt: string | null;
    checkoutActorName: string;
    returnActorName: string | null;
    correctionReason: string | null;
};
export type BatteryDetail = {
    loans: LoanRecord[];
    charges: {
        id: string;
        completedAt: string;
        percentage: number | null;
        durationMinutes: number | null;
        actorName: string;
        recordedAt: string;
    }[];
    observations: {
        id: string;
        roomName: string;
        roomBuilding: string | null;
        roomSnapshot: "recorded" | "unavailable";
        observedAt: string;
        receivedAt: string;
        source: string;
    }[];
    events: AuditEvent[];
};
