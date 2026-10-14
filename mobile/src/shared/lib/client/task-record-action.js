import { acknowledgeWorkflowStorage } from "./workflow-storage.js";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function taskRecordActionStorageKey(resource, accountId, dataset) {
    return `battery-task-${resource}-action:${accountId}:${dataset}`;
}
export function readTaskRecordAction(resource, accountId, dataset, storage = window.__batteryWorkflowStorage) {
    try {
        const raw = storage.getItem(taskRecordActionStorageKey(resource, accountId, dataset));
        if (raw === null)
            return { input: null, error: "" };
        const saved = JSON.parse(raw);
        const input = saved?.input;
        if (saved?.accountId !== accountId ||
            saved?.resource !== resource ||
            !input ||
            input.dataset !== dataset ||
            !["demo", "live"].includes(dataset) ||
            !["remove", "restore"].includes(input.action) ||
            !uuid.test(input.requestId) ||
            !input.payload ||
            !uuid.test(input.payload.id) ||
            !Number.isSafeInteger(input.payload.expectedVersion) ||
            input.payload.expectedVersion < 1 ||
            JSON.stringify(input) !==
                JSON.stringify({
                    dataset,
                    action: input.action,
                    payload: {
                        id: input.payload.id,
                        expectedVersion: input.payload.expectedVersion,
                    },
                    requestId: input.requestId,
                })) {
            throw new Error("Invalid saved request");
        }
        return { input, error: "" };
    }
    catch {
        return {
            input: null,
            error: "A saved task request could not be recovered or browser storage is unavailable. Removal and restoration are blocked. Preserve this tab and ask an administrator to investigate.",
        };
    }
}
/** A verified result releases its original record only after durable acknowledgement. */
export async function acknowledgeTaskRecordAction(resource, accountId, input, storage = window.__batteryWorkflowStorage) {
    const key = taskRecordActionStorageKey(resource, accountId, input.dataset);
    const original = storage.getItem(key);
    const saved = readTaskRecordAction(resource, accountId, input.dataset, storage);
    if (saved.error)
        throw new Error(saved.error);
    if (original === null || !saved.input || JSON.stringify(saved.input) !== JSON.stringify(input))
        throw new Error("The original task request changed. Its acknowledgement is blocked; retain and retry the captured request.");
    await acknowledgeWorkflowStorage({ remove: [key], expected: { [key]: original }, storage });
}
export function saveTaskRecordAction(resource, accountId, input) {
    const previous = readTaskRecordAction(resource, accountId, input.dataset);
    if (previous.error)
        throw new Error(previous.error);
    if (previous.input &&
        JSON.stringify(previous.input) !== JSON.stringify(input)) {
        throw new Error("Resolve the saved request before starting another removal or restoration.");
    }
    const key = taskRecordActionStorageKey(resource, accountId, input.dataset);
    const raw = JSON.stringify({ resource, accountId, input });
    window.__batteryWorkflowStorage.setItem(key, raw);
    if (window.__batteryWorkflowStorage.getItem(key) !== raw)
        throw new Error("The request could not be preserved in this tab. No change was sent.");
}
export function clearTaskRecordAction(resource, accountId, input) {
    const saved = readTaskRecordAction(resource, accountId, input.dataset);
    if (saved.error)
        throw new Error(saved.error);
    if (!saved.input || saved.input.requestId !== input.requestId)
        return;
    const key = taskRecordActionStorageKey(resource, accountId, input.dataset);
    window.__batteryWorkflowStorage.removeItem(key);
    if (window.__batteryWorkflowStorage.getItem(key))
        throw new Error("The confirmed request could not be cleared from browser storage. Retry to verify its saved outcome.");
}
export function taskRecordActionFinallyRejected(error) {
    if (!error || typeof error !== "object")
        return false;
    const value = error;
    return (!!value.status &&
        value.status >= 400 &&
        value.status < 500 &&
        value.code === "task_visibility_rejected_final");
}
export function captureTaskRecordAction(dataset, action, record) {
    return {
        dataset,
        action,
        payload: { id: record.id, expectedVersion: record.version },
        requestId: crypto.randomUUID(),
    };
}
export function verifyTaskRecordActionReceipt(result, input, accountId) {
    if (!result ||
        typeof result !== "object" ||
        !("id" in result) ||
        result.id !== input.payload.id ||
        !("version" in result) ||
        result.version !== input.payload.expectedVersion + 1 ||
        !("requestId" in result) ||
        result.requestId !== input.requestId ||
        !("action" in result) ||
        result.action !== input.action ||
        !("actorAccountId" in result) ||
        result.actorAccountId !== accountId ||
        !("dataset" in result) ||
        result.dataset !== input.dataset ||
        !("removedAt" in result) ||
        (input.action === "remove"
            ? typeof result.removedAt !== "string"
            : result.removedAt !== null)) {
        throw new Error("The result is uncertain. Retry the original request to confirm whether it was saved.");
    }
}
