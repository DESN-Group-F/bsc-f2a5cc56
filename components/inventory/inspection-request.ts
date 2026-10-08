import { inspectionSchema, inspectionVoidSchema, inspectionReceiptSchema, type InspectionInput, type InspectionVoidInput } from "@/lib/battery-inspections";
import type { Dataset } from "@/lib/domain";

export type InspectionAttempt = {
    accountId: string;
    dataset: Dataset;
    batteryId: string;
} & ({ action: "inspection"; payload: InspectionInput } | { action: "inspection_void"; payload: InspectionVoidInput });

export function inspectionStorageKey(accountId: string, dataset: Dataset, batteryId: string) {
    return `battery-inspection-request:${encodeURIComponent(accountId)}:${dataset}:${encodeURIComponent(batteryId)}`;
}

export function readInspectionAttempt(accountId: string, dataset: Dataset, batteryId: string): { input: InspectionAttempt | null; error: string } {
    try {
        const raw = sessionStorage.getItem(inspectionStorageKey(accountId, dataset, batteryId));
        if (!raw) return { input: null, error: "" };
        const saved = JSON.parse(raw) as InspectionAttempt;
        if (!saved || saved.accountId !== accountId || saved.dataset !== dataset || saved.batteryId !== batteryId || !["inspection", "inspection_void"].includes(saved.action)) throw new Error("Invalid request identity");
        const parsed = (saved.action === "inspection" ? inspectionSchema : inspectionVoidSchema).safeParse(saved.payload);
        if (!parsed.success || parsed.data.batteryId !== batteryId || JSON.stringify(parsed.data) !== JSON.stringify(saved.payload)) throw new Error("Invalid saved inspection");
        return { input: saved, error: "" };
    } catch {
        return { input: null, error: "A saved inspection request could not be recovered, or browser storage is unavailable. New inspection changes are blocked. Preserve this tab and ask an administrator to investigate." };
    }
}

export function saveInspectionAttempt(input: InspectionAttempt) {
    const previous = readInspectionAttempt(input.accountId, input.dataset, input.batteryId);
    if (previous.error) throw new Error(previous.error);
    if (previous.input && JSON.stringify(previous.input) !== JSON.stringify(input)) throw new Error("Resolve the saved inspection request before starting another change.");
    const key = inspectionStorageKey(input.accountId, input.dataset, input.batteryId), raw = JSON.stringify(input);
    sessionStorage.setItem(key, raw);
    if (sessionStorage.getItem(key) !== raw) throw new Error("The inspection request could not be preserved. No change was sent.");
}

export function clearInspectionAttempt(input: InspectionAttempt) {
    const saved = readInspectionAttempt(input.accountId, input.dataset, input.batteryId);
    if (saved.error) throw new Error(saved.error);
    if (!saved.input) return;
    if (JSON.stringify(saved.input) !== JSON.stringify(input)) throw new Error("A different inspection request remains unresolved. Preserve this tab.");
    const key = inspectionStorageKey(input.accountId, input.dataset, input.batteryId);
    sessionStorage.removeItem(key);
    if (sessionStorage.getItem(key)) throw new Error("The confirmed request could not be cleared. Retry the original request to verify its outcome.");
}

export function inspectionFinallyRejected(error: unknown) {
    const value = error as { status?: number; code?: string } | null;
    return !!value?.status && value.status >= 400 && value.status < 500 && value.code === "inspection_rejected_final";
}

export function verifyInspectionReceipt(result: unknown, input: InspectionAttempt) {
    const parsed = inspectionReceiptSchema.safeParse(result), value = parsed.success ? parsed.data : null;
    if (!value || value.requestId !== input.payload.requestId || value.dataset !== input.dataset || value.actorAccountId !== input.accountId || value.batteryId !== input.batteryId || value.action !== input.action || (input.action === "inspection_void" && value.inspectionId !== input.payload.inspectionId)) {
        throw new Error("The result is uncertain. Retry the original inspection request to verify whether it was saved.");
    }
}
