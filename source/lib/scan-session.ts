import type { BatteryRecord, Room } from "./domain";

export type ScanSource = "manual" | "simulated";
export type ScanMode = "continuous" | "batch";
export type ScanRead = { battery: BatteryRecord; tagId: string; source: ScanSource; readAt: string };
export type ScanRoom = Pick<Room, "id" | "version" | "name" | "isPlaceholder" | "buildingId">;
export type ScanMovement = {
    requestId: string;
    kind: "checkout" | "return";
    batteryIds: string[];
    expectedLoans?: { batteryId: string; loanId: string }[];
    scan: { sessionId: string; source: ScanSource; bindings: { batteryId: string; tagId: string; version: number }[] };
    returnRoom?: { roomId: string; version: number };
};
export type ScanReceipt = { kind: "checkout" | "return"; batteryIds: string[]; count: number; at: string; requestId: string; borrower?: string; borrowerAccountId?: string; replayed?: boolean; returnPlacement?: { roomId: string; roomName: string; isPlaceholder: boolean; source: string; observedAt: string } };
export type ScanCompleted = ScanRead & { receipt: ScanReceipt };
export type ScanIssue = { id: string; tagId: string; category: "unknown" | "state" | "duplicate" | "lookup" | "source" | "limit"; message: string; acknowledged: boolean; resolvedBatteryId?: string };
export type ScanAttempt = { payload: ScanMovement; reads: ScanRead[]; status: "uncertain" | "rejected"; message: string; statusCode?: number };
export type ScanSession = { sessionId: string; mode: ScanMode; room: ScanRoom | null; roomConfirmationRequired?: boolean; queue: ScanRead[]; completed: ScanCompleted[]; issues: ScanIssue[]; attempt: ScanAttempt | null };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** A verified exact tag lookup resolves only its earlier unregistered-tag issues. */
export function resolveRegisteredTagIssues(issues: ScanIssue[], tagId: string, battery: Pick<BatteryRecord, "id" | "tagId">): ScanIssue[] {
    if (battery.tagId !== tagId) return issues;
    return issues.map(issue => issue.category === "unknown" && issue.tagId === tagId
        ? { ...issue, acknowledged: true, resolvedBatteryId: battery.id } : issue);
}

export function scanCompletedReadMatches(kind: ScanMovement["kind"], battery: Pick<BatteryRecord, "id" | "loanId">, completed: readonly ScanCompleted[]) {
    return completed.some(saved => saved.battery.id === battery.id && (kind === "return"
        ? !battery.loanId || saved.battery.loanId === battery.loanId : !!battery.loanId));
}

export function scanReadProblem(kind: ScanMovement["kind"], battery: BatteryRecord, tagId: string) {
    if (battery.tagId !== tagId) return "The registered tag changed. Read and review the current tag before proceeding.";
    if (kind === "checkout" && battery.loanId) return `Already on loan${battery.borrowerName ? ` to ${battery.borrowerName}` : ""}. No checkout was saved.`;
    if (kind === "return" && !battery.loanId) return "No active loan to return. No return was saved.";
    return null;
}

/** Capture exact tag/version/loan bindings once; retries must retain this payload. */
export function scanMovementPayload(kind: ScanMovement["kind"], reads: readonly ScanRead[], sessionId: string, room: ScanRoom | null, requestId: string): ScanMovement {
    if (!uuid.test(sessionId) || !uuid.test(requestId)) throw new Error("Use valid scan-session and request identifiers.");
    if (!reads.length || reads.length > 100) throw new Error("Confirm between 1 and 100 batteries at a time.");
    const ids = reads.map(read => read.battery.id);
    if (new Set(ids).size !== ids.length) throw new Error("A battery can occur only once in a scan movement.");
    if (reads.some(read => read.source !== reads[0].source)) throw new Error("Manual and simulated reads need separate batches. Confirm or clear the current batch first.");
    for (const read of reads) { const problem = scanReadProblem(kind, read.battery, read.tagId); if (problem) throw new Error(`${read.battery.id}: ${problem}`); }
    return {
        requestId, kind, batteryIds: ids,
        ...(kind === "return" ? { expectedLoans: reads.map(read => ({ batteryId: read.battery.id, loanId: read.battery.loanId! })) } : {}),
        scan: { sessionId, source: reads[0].source, bindings: reads.map(read => ({ batteryId: read.battery.id, tagId: read.tagId, version: read.battery.version })) },
        ...(kind === "return" && room ? { returnRoom: { roomId: room.id, version: room.version } } : {}),
    };
}

export function scanFailureStatus(error: unknown, alreadyUncertain = false): ScanAttempt["status"] {
    const status = error && typeof error === "object" && "status" in error ? Number(error.status) : 0;
    const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
    if (!Number.isInteger(status) || status < 400 || status >= 500 || alreadyUncertain && code !== "movement_rejected_final") return "uncertain";
    return "rejected";
}

function isRead(value: unknown): value is ScanRead {
    if (!value || typeof value !== "object") return false;
    const read = value as Partial<ScanRead>, battery = read.battery;
    return (read.source === "manual" || read.source === "simulated") && typeof read.tagId === "string" && typeof read.readAt === "string" && !!battery
        && typeof battery.id === "string" && !!battery.id && typeof battery.name === "string" && typeof battery.ownerName === "string" && Number.isInteger(battery.version) && battery.version > 0
        && (typeof battery.loanId === "string" || battery.loanId === null) && battery.tagId === read.tagId;
}

/** Recover only unfinished local work, without assuming that an uncertain write failed. */
export function recoverScanSession(raw: string | null, kind: ScanMovement["kind"]): ScanSession | null {
    if (!raw) return null;
    try {
        const saved = JSON.parse(raw) as ScanSession;
        if (!saved || !uuid.test(saved.sessionId) || !["continuous", "batch"].includes(saved.mode) || !Array.isArray(saved.queue) || saved.queue.length > 100 || !saved.queue.every(isRead)
            || !Array.isArray(saved.completed) || !saved.completed.every(read => isRead(read) && read.receipt?.kind === kind && typeof read.receipt.at === "string" && Number.isFinite(Date.parse(read.receipt.at)) && uuid.test(read.receipt.requestId) && Array.isArray(read.receipt.batteryIds) && read.receipt.batteryIds.includes(read.battery.id))
            || !Array.isArray(saved.issues) || !saved.issues.every(issue => issue && typeof issue.id === "string" && uuid.test(issue.id) && ["unknown", "state", "duplicate", "lookup", "source", "limit"].includes(issue.category) && typeof issue.tagId === "string" && typeof issue.message === "string" && typeof issue.acknowledged === "boolean"
                && (issue.resolvedBatteryId === undefined || issue.category === "unknown" && issue.acknowledged && typeof issue.resolvedBatteryId === "string" && !!issue.resolvedBatteryId.trim()))) return null;
        const queuedIds = saved.queue.map(read => read.battery.id), completedActions = saved.completed.map(read => JSON.stringify([read.battery.id, read.receipt.requestId]));
        if (new Set(queuedIds).size !== queuedIds.length || new Set(completedActions).size !== completedActions.length
            || saved.queue.some(read => read.source !== saved.queue[0].source || scanCompletedReadMatches(kind, read.battery, saved.completed))) return null;
        if (saved.room && (typeof saved.room.id !== "string" || !saved.room.id || typeof saved.room.name !== "string" || typeof saved.room.isPlaceholder !== "boolean" || !Number.isInteger(saved.room.version) || saved.room.version < 1)) return null;
        if (saved.roomConfirmationRequired !== undefined && typeof saved.roomConfirmationRequired !== "boolean"
            || saved.roomConfirmationRequired && (kind !== "return" || saved.room !== null || saved.attempt)) return null;
        if (saved.attempt) {
            if (!["uncertain", "rejected"].includes(saved.attempt.status) || saved.attempt.payload?.kind !== kind || saved.attempt.payload.scan?.sessionId !== saved.sessionId
                || !Array.isArray(saved.attempt.reads) || !saved.attempt.reads.every(isRead) || typeof saved.attempt.message !== "string" || saved.attempt.reads.some(read => !saved.queue.some(queued => JSON.stringify(read) === JSON.stringify(queued)))) return null;
            const expected = scanMovementPayload(kind, saved.attempt.reads, saved.sessionId, saved.room, saved.attempt.payload.requestId);
            if (JSON.stringify(expected) !== JSON.stringify(saved.attempt.payload)) return null;
        }
        return saved.attempt || saved.queue.length || saved.roomConfirmationRequired || saved.issues.some(issue => !issue.acknowledged) ? saved : null;
    } catch { return null; }
}
