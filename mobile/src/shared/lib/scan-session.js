import { isActiveBattery } from "./battery-lifecycle.js";
import { teachingGroupReferenceSchema } from "./teaching-context.js";
import { validateTeachingNfcTag } from "./teaching-nfc.js";
import { scanContextSchema } from "./domain.js";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/** A verified exact tag lookup resolves only its earlier unregistered-tag issues. */
export function resolveRegisteredTagIssues(issues, tagId, battery) {
    if (battery.tagId !== tagId)
        return issues;
    return issues.map(issue => issue.category === "unknown" && issue.tagId === tagId
        ? { ...issue, acknowledged: true, resolvedBatteryId: battery.id } : issue);
}
export function scanCompletedReadMatches(kind, battery, completed) {
    return completed.some(saved => saved.battery.id === battery.id && (kind === "return"
        ? !battery.loanId || saved.battery.loanId === battery.loanId : !!battery.loanId));
}
export function scanReadProblem(kind, battery, tagId) {
    if (!isActiveBattery(battery))
        return "This battery has been retired or permanently removed. No movement was saved.";
    if (battery.tagId !== tagId)
        return "The registered tag changed. Read and review the current tag before proceeding.";
    if (kind === "checkout" && battery.loanId)
        return `Already in use${battery.borrowerName ? ` to ${battery.borrowerName}` : ""}. No checkout was saved.`;
    if (kind === "return" && !battery.loanId)
        return "No active loan to return. No return was saved.";
    return null;
}
/** Capture exact tag/version/loan bindings once; retries must retain this payload. */
export function scanMovementPayload(kind, reads, sessionId, room, requestId, teachingGroup) {
    if (!uuid.test(sessionId) || !uuid.test(requestId))
        throw new Error("Use valid scan-session and request identifiers.");
    if (!reads.length || reads.length > 100)
        throw new Error("Confirm between 1 and 100 batteries at a time.");
    const ids = reads.map(read => read.battery.id);
    if (new Set(ids).size !== ids.length)
        throw new Error("A battery can occur only once in a scan movement.");
    if (reads.some(read => read.source !== reads[0].source))
        throw new Error("Different input sources need separate batches. Confirm or clear the current batch first.");
    if (reads.some(read => read.source !== "selection" && read.tagId === null))
        throw new Error("Tag reads require registered tags; select the battery manually when it has no tag.");
    for (const read of reads) {
        const problem = scanReadProblem(kind, read.battery, read.tagId);
        if (problem)
            throw new Error(`${read.battery.id}: ${problem}`);
    }
    return {
        requestId, kind, batteryIds: ids,
        ...(kind === "return" ? { expectedLoans: reads.map(read => ({ batteryId: read.battery.id, loanId: read.battery.loanId })) } : {}),
        scan: scanContextSchema.parse({ sessionId, source: reads[0].source, bindings: reads.map(read => ({ batteryId: read.battery.id, tagId: read.tagId, version: read.battery.version, ...(read.source === "native_nfc" ? { nfcEvidence: validateTeachingNfcTag(read.nfcEvidence, read.tagId) } : read.nfcEvidence !== undefined ? { nfcEvidence: read.nfcEvidence } : {}) })) }),
        ...(kind === "return" && room ? { returnRoom: { roomId: room.id, version: room.version } } : {}),
        ...(teachingGroup ? { teachingGroup: teachingGroupReferenceSchema.parse(teachingGroup) } : {}),
    };
}
export function scanFailureStatus(error, alreadyUncertain = false) {
    const status = error && typeof error === "object" && "status" in error ? Number(error.status) : 0;
    const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
    if (!Number.isInteger(status) || status < 400 || status >= 500 || alreadyUncertain && code !== "movement_rejected_final")
        return "uncertain";
    return "rejected";
}
function isRead(value) {
    if (!value || typeof value !== "object")
        return false;
    const read = value, battery = read.battery;
    if (read.source === "native_nfc") {
        try {
            validateTeachingNfcTag(read.nfcEvidence, read.tagId ?? null);
        }
        catch {
            return false;
        }
    }
    else if (read.nfcEvidence !== undefined)
        return false;
    return (read.source === "manual" || read.source === "simulated" || read.source === "selection" || read.source === "native_nfc") && (typeof read.tagId === "string" || read.source === "selection" && read.tagId === null) && typeof read.readAt === "string" && !!battery
        && typeof battery.id === "string" && !!battery.id && typeof battery.name === "string" && typeof battery.ownerName === "string" && Number.isInteger(battery.version) && battery.version > 0
        && (typeof battery.loanId === "string" || battery.loanId === null) && battery.tagId === read.tagId;
}
/** Recover only unfinished local work, without assuming that an uncertain write failed. */
export function recoverScanSession(raw, kind, includeFinished = false) {
    if (!raw)
        return null;
    try {
        const saved = JSON.parse(raw);
        if (saved?.teachingGroup !== undefined && !teachingGroupReferenceSchema.safeParse(saved.teachingGroup).success)
            return null;
        if (!saved || !uuid.test(saved.sessionId) || !["continuous", "batch"].includes(saved.mode) || !Array.isArray(saved.queue) || saved.queue.length > 100 || !saved.queue.every(isRead)
            || !Array.isArray(saved.completed) || !saved.completed.every(read => isRead(read) && read.receipt?.kind === kind && typeof read.receipt.at === "string" && Number.isFinite(Date.parse(read.receipt.at)) && uuid.test(read.receipt.requestId) && Array.isArray(read.receipt.batteryIds) && read.receipt.batteryIds.includes(read.battery.id))
            || !Array.isArray(saved.issues) || !saved.issues.every(issue => issue && typeof issue.id === "string" && uuid.test(issue.id) && ["unknown", "state", "duplicate", "lookup", "source", "limit"].includes(issue.category) && typeof issue.tagId === "string" && typeof issue.message === "string" && typeof issue.acknowledged === "boolean"
            && (issue.resolvedBatteryId === undefined || issue.category === "unknown" && issue.acknowledged && typeof issue.resolvedBatteryId === "string" && !!issue.resolvedBatteryId.trim())))
            return null;
        const queuedIds = saved.queue.map(read => read.battery.id), completedActions = saved.completed.map(read => JSON.stringify([read.battery.id, read.receipt.requestId]));
        if (new Set(queuedIds).size !== queuedIds.length || new Set(completedActions).size !== completedActions.length
            || saved.queue.some(read => read.source !== saved.queue[0].source || scanCompletedReadMatches(kind, read.battery, saved.completed)))
            return null;
        if (saved.room && (typeof saved.room.id !== "string" || !saved.room.id || typeof saved.room.name !== "string" || typeof saved.room.isPlaceholder !== "boolean" || !Number.isInteger(saved.room.version) || saved.room.version < 1))
            return null;
        if (saved.roomConfirmationRequired !== undefined && typeof saved.roomConfirmationRequired !== "boolean"
            || saved.roomConfirmationRequired && (kind !== "return" || saved.room !== null || saved.attempt))
            return null;
        if (saved.attempt) {
            if (!["uncertain", "rejected"].includes(saved.attempt.status) || saved.attempt.payload?.kind !== kind || saved.attempt.payload.scan?.sessionId !== saved.sessionId
                || !Array.isArray(saved.attempt.reads) || !saved.attempt.reads.every(isRead) || typeof saved.attempt.message !== "string" || saved.attempt.reads.some(read => !saved.queue.some(queued => JSON.stringify(read) === JSON.stringify(queued))))
                return null;
            const expected = scanMovementPayload(kind, saved.attempt.reads, saved.sessionId, saved.room, saved.attempt.payload.requestId, saved.teachingGroup);
            if (JSON.stringify(expected) !== JSON.stringify(saved.attempt.payload))
                return null;
        }
        // Older sessions may contain an unfinished immediate-processing request.
        // Keep its exact payload; only future queue submissions use review and confirmation.
        return includeFinished || saved.attempt || saved.queue.length || saved.roomConfirmationRequired || saved.issues.some(issue => !issue.acknowledged) ? { ...saved, mode: "batch" } : null;
    }
    catch {
        return null;
    }
}
/** A successful setItem alone does not establish that exact recovery data was saved. */
export function saveScanSession(storage, key, session) {
    const captured = JSON.stringify(session);
    storage.setItem(key, captured);
    if (storage.getItem(key) !== captured)
        throw new Error("The captured scan request could not be read back from recovery storage.");
    return captured;
}
/** Mobile storage acknowledgement must complete before a movement can be sent. */
export async function verifySavedScanSession(storage, key, captured) {
    await storage.flush?.();
    if (storage.getItem(key) !== captured)
        throw new Error("The original scan request is not confirmed in recovery storage. No movement was sent.");
}
