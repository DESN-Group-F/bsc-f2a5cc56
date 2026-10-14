import { z } from 'zod';
import { isDateOnly } from '../../shared/lib/battery-age.js';

const cycleSchema = z.object({
  id: z.string().uuid(), version: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), title: z.string(), category: z.string(),
  status: z.enum(['open', 'completed']), canComplete: z.boolean(), planRemoved: z.boolean(),
  dueOn: z.string(), description: z.string(), basis: z.string(), scopeNote: z.string(),
  targetKind: z.string(), targetRef: z.string().nullable(), targetSnapshot: z.record(z.string(), z.unknown()),
  batteryIds: z.array(z.string()), assigneeIds: z.array(z.string()), currentAssigneeIds: z.array(z.string()),
}).passthrough();
const attemptSchema = z.object({
  schemaVersion: z.literal(1), actorAccountId: z.string().min(1), dataset: z.enum(['demo', 'live']),
  input: z.object({ dataset: z.enum(['demo', 'live']), action: z.literal('complete'), requestId: z.string().uuid(), payload: z.object({ cycleId: z.string().uuid(), expectedVersion: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), notes: z.string().max(2000) }).strict() }).strict(),
  reviewedCycle: cycleSchema,
}).strict().superRefine((value, context) => {
  if (value.input.dataset !== value.dataset || value.input.payload.cycleId !== value.reviewedCycle.id || value.input.payload.expectedVersion !== value.reviewedCycle.version || value.reviewedCycle.status !== 'open' || value.reviewedCycle.planRemoved || !value.reviewedCycle.canComplete) {
    context.addIssue({ code: 'custom', message: 'The task completion lost its original reviewed cycle binding.' });
  }
});

export function taskCompletionStorageKey(accountId, dataset) { return `battery-mobile-task-completion:${accountId}:${dataset}`; }

export function readTaskCompletion(storage, accountId, dataset) {
  const raw = storage.getItem(taskCompletionStorageKey(accountId, dataset));
  if (raw === null) return null;
  let value;
  try { value = attemptSchema.parse(JSON.parse(raw)); }
  catch { throw new Error('A retained task completion is unreadable. Export recovery data; it has not been replaced.'); }
  if (value.actorAccountId !== accountId || value.dataset !== dataset) throw new Error('A retained task completion belongs to another account or inventory. It has not been replaced.');
  return value;
}

export function captureTaskCompletion(accountId, dataset, reviewedCycle, notes) {
  return attemptSchema.parse({ schemaVersion: 1, actorAccountId: accountId, dataset, input: { dataset, action: 'complete', requestId: crypto.randomUUID(), payload: { cycleId: reviewedCycle.id, expectedVersion: reviewedCycle.version, notes } }, reviewedCycle: structuredClone(reviewedCycle) });
}

export async function saveTaskCompletion(storage, attempt) {
  const value = attemptSchema.parse(attempt);
  const previous = readTaskCompletion(storage, value.actorAccountId, value.dataset);
  if (previous && JSON.stringify(previous) !== JSON.stringify(value)) throw new Error('Resolve the original task completion before preparing another request.');
  const key = taskCompletionStorageKey(value.actorAccountId, value.dataset);
  const raw = JSON.stringify(value);
  if (typeof storage.transact === 'function') await storage.transact(entries => { entries[key] = raw; });
  else { storage.setItem(key, raw); await storage.flush?.(); }
  if (storage.getItem(key) !== raw) throw new Error('The reviewed task request was not saved. No completion can be sent.');
  return value;
}

export function verifyTaskCompletionResult(result, attempt) {
  if (result?.id !== attempt.input.payload.cycleId || result.version !== attempt.input.payload.expectedVersion + 1 || result.status !== 'completed' || !Number.isSafeInteger(result.skippedPeriods) || result.skippedPeriods < 0 || typeof result.calculationRule !== 'string' || !(result.nextDueOn === null || typeof result.nextDueOn === 'string' && isDateOnly(result.nextDueOn))) {
    throw new Error('The task completion result is uncertain. Retry its original request to confirm the saved outcome.');
  }
  return result;
}

export async function acknowledgeTaskCompletion(storage, attempt, result) {
  verifyTaskCompletionResult(result, attempt);
  const saved = readTaskCompletion(storage, attempt.actorAccountId, attempt.dataset);
  if (!saved || JSON.stringify(saved) !== JSON.stringify(attempt)) throw new Error('The retained task request changed. Preserve recovery data and resolve the original result.');
  const key = taskCompletionStorageKey(attempt.actorAccountId, attempt.dataset);
  if (typeof storage.transact === 'function') await storage.transact(entries => { delete entries[key]; });
  else { storage.removeItem(key); await storage.flush?.(); }
}
