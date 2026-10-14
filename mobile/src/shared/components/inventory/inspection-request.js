import { inspectionSchema, inspectionVoidSchema, inspectionReceiptSchema } from "../../lib/battery-inspections.js";
import { acknowledgeWorkflowStorage } from "../../lib/client/workflow-storage.js";
export function inspectionStorageKey(accountId, dataset, batteryId) {
    return `battery-inspection-request:${encodeURIComponent(accountId)}:${dataset}:${encodeURIComponent(batteryId)}`;
}
export function readInspectionAttempt(accountId, dataset, batteryId, storage = window.__batteryWorkflowStorage) {
    try {
        const raw = storage.getItem(inspectionStorageKey(accountId, dataset, batteryId));
        if (raw === null)
            return { input: null, error: "" };
        const saved = JSON.parse(raw);
        if (!saved || saved.accountId !== accountId || saved.dataset !== dataset || saved.batteryId !== batteryId || !["inspection", "inspection_void"].includes(saved.action))
            throw new Error("Invalid request identity");
        const parsed = (saved.action === "inspection" ? inspectionSchema : inspectionVoidSchema).safeParse(saved.payload);
        if (!parsed.success || parsed.data.batteryId !== batteryId || JSON.stringify(parsed.data) !== JSON.stringify(saved.payload))
            throw new Error("Invalid saved inspection");
        return { input: saved, error: "" };
    }
    catch {
        return { input: null, error: "A saved inspection request could not be recovered, or browser storage is unavailable. New inspection changes are blocked. Preserve this tab and ask an administrator to investigate." };
    }
}
export function saveInspectionAttempt(input) {
    const previous = readInspectionAttempt(input.accountId, input.dataset, input.batteryId);
    if (previous.error)
        throw new Error(previous.error);
    if (previous.input && JSON.stringify(previous.input) !== JSON.stringify(input))
        throw new Error("Resolve the saved inspection request before starting another change.");
    const key = inspectionStorageKey(input.accountId, input.dataset, input.batteryId), raw = JSON.stringify(input);
    window.__batteryWorkflowStorage.setItem(key, raw);
    if (window.__batteryWorkflowStorage.getItem(key) !== raw)
        throw new Error("The inspection request could not be preserved. No change was sent.");
}
export function clearInspectionAttempt(input) {
    const saved = readInspectionAttempt(input.accountId, input.dataset, input.batteryId);
    if (saved.error)
        throw new Error(saved.error);
    if (!saved.input)
        return;
    if (JSON.stringify(saved.input) !== JSON.stringify(input))
        throw new Error("A different inspection request remains unresolved. Preserve this tab.");
    const key = inspectionStorageKey(input.accountId, input.dataset, input.batteryId);
    window.__batteryWorkflowStorage.removeItem(key);
    if (window.__batteryWorkflowStorage.getItem(key))
        throw new Error("The confirmed request could not be cleared. Retry the original request to verify its outcome.");
}
export async function acknowledgeInspectionAttempt(input) {
    const saved = readInspectionAttempt(input.accountId, input.dataset, input.batteryId);
    if (saved.error || !saved.input || JSON.stringify(saved.input) !== JSON.stringify(input))
        throw new Error(saved.error || "The original inspection request changed. It remains unresolved.");
    const key = inspectionStorageKey(input.accountId, input.dataset, input.batteryId);
    await acknowledgeWorkflowStorage({ remove: [key], expected: { [key]: JSON.stringify(saved.input) } });
}
export function inspectionFinallyRejected(error) {
    const value = error;
    return !!value?.status && value.status >= 400 && value.status < 500 && value.code === "inspection_rejected_final";
}
export function verifyInspectionReceipt(result, input) {
    const parsed = inspectionReceiptSchema.safeParse(result), value = parsed.success ? parsed.data : null;
    if (!value || value.requestId !== input.payload.requestId || value.dataset !== input.dataset || value.actorAccountId !== input.accountId || value.batteryId !== input.batteryId || value.action !== input.action || (input.action === "inspection_void" && value.inspectionId !== input.payload.inspectionId)) {
        throw new Error("The result is uncertain. Retry the original inspection request to verify whether it was saved.");
    }
}
