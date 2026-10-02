import type { Dataset } from "./domain";
import { taskPlanSchema, type TaskPlan } from "./task-schedule";

export type TaskCreatePayload = { dataset: Dataset; action: "create"; payload: TaskPlan; requestId: string };
export type TaskCreateAttempt = { accountId: string; input: TaskCreatePayload; status: "uncertain" | "rejected"; message: string };
export type TaskCreateReceipt = { id: string; version: number; requestId: string; action: "create"; actorAccountId: string; dataset: Dataset };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function taskCreateStorageKey(accountId: string, dataset: Dataset) {
    return `battery-task-create:${accountId}:${dataset}`;
}

/** Capture only the submitted, validated plan; later edits cannot replace an unresolved request. */
export function captureTaskCreate(plan: TaskPlan, accountId: string, dataset: Dataset, requestId: string): TaskCreateAttempt {
    if (!accountId || !["demo", "live"].includes(dataset) || !uuid.test(requestId)) throw new Error("Use a valid staff account, inventory and request identifier.");
    return { accountId, input: { dataset, action: "create", payload: taskPlanSchema.parse(structuredClone(plan)), requestId }, status: "uncertain", message: "Waiting for the server to confirm this exact task creation." };
}

/** A same-tab recovery belongs to one authenticated account and inventory. */
export function recoverTaskCreate(raw: string | null, accountId: string, dataset: Dataset): TaskCreateAttempt | null {
    if (!raw) return null;
    try {
        const saved = JSON.parse(raw) as TaskCreateAttempt;
        if (!saved || saved.accountId !== accountId || saved.input?.dataset !== dataset || saved.input.action !== "create" || !["uncertain", "rejected"].includes(saved.status) || typeof saved.message !== "string") return null;
        const captured = captureTaskCreate(saved.input.payload, accountId, dataset, saved.input.requestId);
        if (JSON.stringify(captured.input) !== JSON.stringify(saved.input)) return null;
        return { ...captured, status: saved.status, message: saved.message };
    } catch { return null; }
}

/** Ordinary errors cannot establish that a previously in-flight creation will never commit. */
export function taskCreateFailureStatus(error: unknown, alreadyUncertain = false): TaskCreateAttempt["status"] {
    const status = error && typeof error === "object" && "status" in error ? Number(error.status) : 0;
    const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
    return !Number.isInteger(status) || status < 400 || status >= 500 || alreadyUncertain && code !== "task_create_rejected_final" ? "uncertain" : "rejected";
}

/** Verify the saved request identity instead of inferring success from a similar plan in the list. */
export function verifyTaskCreateReceipt(value: unknown, attempt: TaskCreateAttempt): TaskCreateReceipt {
    const receipt = value as Partial<TaskCreateReceipt> | null;
    if (!receipt || typeof receipt.id !== "string" || !uuid.test(receipt.id) || receipt.version !== 1 || receipt.requestId !== attempt.input.requestId || receipt.action !== "create" || receipt.actorAccountId !== attempt.accountId || receipt.dataset !== attempt.input.dataset) {
        throw new Error("The task creation receipt could not be verified. The result is uncertain; retry the original request.");
    }
    return receipt as TaskCreateReceipt;
}
