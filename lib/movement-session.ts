import type { BatteryRecord, Dataset } from "./domain";
import { teachingGroupReferenceSchema, verifyGroupEvidence, type TeachingGroupReference, type TeachingGroupEvidence } from "./teaching-context";

export type MovementKind = "checkout" | "return";
export type MovementPayload = { requestId: string; kind: MovementKind; batteryIds: string[]; expectedLoans?: { batteryId: string; loanId: string }[]; teachingGroup?: TeachingGroupReference };
export type MovementReceipt = { requestId: string; kind: MovementKind; batteryIds: string[]; count: number; at: string; borrower?: string; borrowerAccountId?: string; replayed?: boolean; teachingGroup?: TeachingGroupEvidence };
export type MovementAttempt = { accountId: string; dataset: Dataset; payload: MovementPayload; reviewed: BatteryRecord[]; status: "uncertain" | "rejected"; message: string; statusCode?: number };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const identifier = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const isTime = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d\d-\d\dT/.test(value) && Number.isFinite(Date.parse(value));

export function movementStorageKey(accountId: string, dataset: Dataset, kind: MovementKind) {
    return `battery-movement:${accountId}:${dataset}:${kind}`;
}

/** Capture reviewed rows and loan identities once, independently of later inventory refreshes. */
export function captureMovementAttempt(kind: MovementKind, batteries: readonly BatteryRecord[], accountId: string, dataset: Dataset, requestId: string, teachingGroup?: TeachingGroupReference): MovementAttempt {
    if (!uuid.test(requestId) || !accountId || !["demo", "live"].includes(dataset) || !["checkout", "return"].includes(kind)) throw new Error("Use a valid request, staff account and inventory.");
    if (!batteries.length || batteries.length > 100 || new Set(batteries.map(battery => battery.id)).size !== batteries.length) throw new Error("Review between 1 and 100 different batteries.");
    const reviewed = structuredClone(batteries) as BatteryRecord[];
    for (const battery of reviewed) {
        if (!isReviewedBattery(battery)) throw new Error("A reviewed battery record is invalid. Reload and review its saved details.");
        if (kind === "checkout" && battery.loanId) throw new Error(`${battery.id} is already in use. Review current records before preparing a checkout.`);
        if (kind === "return" && (!battery.loanId || !uuid.test(battery.loanId))) throw new Error(`${battery.id} has no valid reviewed loan to return.`);
    }
    return { accountId, dataset, payload: { requestId, kind, batteryIds: reviewed.map(battery => battery.id), ...(kind === "return" ? { expectedLoans: reviewed.map(battery => ({ batteryId: battery.id, loanId: battery.loanId! })) } : {}), ...(teachingGroup ? { teachingGroup: teachingGroupReferenceSchema.parse(teachingGroup) } : {}) }, reviewed, status: "uncertain", message: "Waiting for the server to confirm this exact request." };
}

/** Only a terminal server reservation can reject a write whose earlier response was lost. */
export function movementFailureStatus(error: unknown, alreadyUncertain = false): MovementAttempt["status"] {
    const status = error && typeof error === "object" && "status" in error ? Number(error.status) : 0;
    const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
    return !Number.isInteger(status) || status < 400 || status >= 500 || alreadyUncertain && code !== "movement_rejected_final" ? "uncertain" : "rejected";
}

/** Only a matching saved receipt establishes success; current loan state does not. */
export function verifyMovementReceipt(value: unknown, payload: Pick<MovementPayload, "requestId" | "kind" | "batteryIds" | "teachingGroup">, accountId: string): MovementReceipt {
    const receipt = value as Partial<MovementReceipt> | null;
    if (!receipt || receipt.requestId !== payload.requestId || receipt.kind !== payload.kind || !Array.isArray(receipt.batteryIds)
        || receipt.count !== payload.batteryIds.length || receipt.batteryIds.length !== payload.batteryIds.length || new Set(receipt.batteryIds).size !== receipt.batteryIds.length
        || payload.batteryIds.some(id => !receipt.batteryIds!.includes(id)) || !isTime(receipt.at)
        || payload.kind === "checkout" && (receipt.borrowerAccountId !== accountId || typeof receipt.borrower !== "string" || !receipt.borrower.trim())) {
        throw new Error("The saved movement receipt could not be verified. The result is uncertain; retry the same captured request.");
    }
    verifyGroupEvidence(receipt.teachingGroup, payload.teachingGroup, payload.requestId, payload.batteryIds, accountId);
    return receipt as MovementReceipt;
}

function isReviewedBattery(value: unknown): value is BatteryRecord {
    if (!value || typeof value !== "object") return false;
    const battery = value as Partial<BatteryRecord>;
    return typeof battery.id === "string" && identifier.test(battery.id) && typeof battery.name === "string" && typeof battery.ownerName === "string"
        && Number.isSafeInteger(battery.version) && battery.version! > 0 && (battery.loanId === null || typeof battery.loanId === "string" && uuid.test(battery.loanId))
        && (battery.borrowerName === null || typeof battery.borrowerName === "string") && (battery.checkedOutAt === null || isTime(battery.checkedOutAt));
}

/** Recovery is account-, dataset- and movement-kind-specific, with no substituted current loan. */
export function recoverMovementAttempt(raw: string | null, accountId: string, dataset: Dataset, kind: MovementKind): MovementAttempt | null {
    if (!raw) return null;
    try {
        const saved = JSON.parse(raw) as MovementAttempt;
        if (!saved || saved.accountId !== accountId || saved.dataset !== dataset || saved.payload?.kind !== kind || !["uncertain", "rejected"].includes(saved.status)
            || typeof saved.message !== "string" || saved.statusCode !== undefined && (!Number.isInteger(saved.statusCode) || saved.statusCode < 400 || saved.statusCode > 599)
            || !Array.isArray(saved.reviewed) || !saved.reviewed.every(isReviewedBattery)) return null;
        const captured = captureMovementAttempt(kind, saved.reviewed, accountId, dataset, saved.payload.requestId, saved.payload.teachingGroup);
        if (JSON.stringify(captured.payload) !== JSON.stringify(saved.payload)) return null;
        return { ...captured, status: saved.status, message: saved.message, ...(saved.statusCode !== undefined ? { statusCode: saved.statusCode } : {}) };
    } catch { return null; }
}
