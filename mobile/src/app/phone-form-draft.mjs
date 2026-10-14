import { z } from 'zod';
import { modelSelectionSchema } from '../shared/lib/battery-models.js';

const queues = new WeakMap();
const text = max => z.string().max(max);
const datasetSchema = z.enum(['demo', 'live']);
const profileSchema = z.object({
  expectedVersion: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  baseline: z.object({ displayName: text(120), email: text(254), defaultDataset: datasetSchema, role: z.enum(['staff', 'admin']), active: z.boolean(), version: z.number().int().positive().max(Number.MAX_SAFE_INTEGER) }).strict(),
  displayName: text(120), email: text(254), defaultDataset: datasetSchema,
}).strict().refine(value => value.expectedVersion === value.baseline.version, 'The profile draft lost its reviewed version.');
const taskSchema = z.object({ cycleId: z.string().uuid(), expectedVersion: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), notes: text(2000) }).strict();
const intakeSchema = z.object({
  values: z.object({ name: text(120), model: text(120), chemistry: text(40), capacityMah: text(80), voltage: text(80), ownerId: text(128), homeBuildingId: text(64), homeRoomId: text(128), manufacturedOn: text(10), firstUsedOn: text(10) }).strict(),
  firstUseMode: z.enum(['at_registration', 'date', 'unknown']), modelSelection: modelSelectionSchema.nullable(), nameSource: z.enum(['default', 'model', 'custom']).optional(),
}).strict();
const scopeSchema = z.object({ accountId: z.string().min(1).max(128), dataset: datasetSchema, kind: z.enum(['profile', 'task-notes', 'intake-common']), recordId: z.string().min(1).max(128) }).strict();
const envelopeSchema = scopeSchema.extend({ schemaVersion: z.literal(1), savedAt: z.string().datetime(), data: z.unknown() }).strict();

function scopeOf(input) { return scopeSchema.parse({ accountId: input.accountId, dataset: input.dataset, kind: input.kind, recordId: input.recordId }); }
function checkedData(scope, input) {
  const data = ({ profile: profileSchema, 'task-notes': taskSchema, 'intake-common': intakeSchema })[scope.kind].parse(input);
  if (scope.kind === 'profile' && scope.recordId !== scope.accountId || scope.kind === 'task-notes' && data.cycleId !== scope.recordId || scope.kind === 'intake-common' && scope.recordId !== 'common') throw new Error('The form draft does not match its original record context.');
  return data;
}
function bounded(raw) { if (new TextEncoder().encode(raw).byteLength > 24576) throw new Error('The form draft exceeds the device storage limit.'); return raw; }

/** Presentation drafts carry no transaction, credentials or authority and never block sign-out. */
export function phoneFormDraftKey(input) {
  const scope = scopeOf(input);
  return `preference:mobile-form-draft:${encodeURIComponent(scope.accountId)}:${scope.dataset}:${scope.kind}:${encodeURIComponent(scope.recordId)}`;
}
export function readPhoneFormDraft(storage, input) {
  const scope = scopeOf(input), raw = storage.getItem(phoneFormDraftKey(scope));
  if (raw === null) return null;
  try {
    const saved = envelopeSchema.parse(JSON.parse(bounded(raw)));
    if (Object.keys(scope).some(key => saved[key] !== scope[key])) throw new Error('Different form context');
    return { ...saved, data: checkedData(scope, saved.data) };
  } catch { throw new Error('The saved form draft is unreadable. It has been preserved; export device recovery data before replacing it.'); }
}
function enqueue(storage, key, operation) {
  let queue = queues.get(storage);
  if (!queue) { queue = new Map(); queues.set(storage, queue); }
  const next = (queue.get(key) ?? Promise.resolve()).catch(() => {}).then(operation);
  queue.set(key, next);
  void next.finally(() => { if (queue.get(key) === next) queue.delete(key); }).catch(() => {});
  return next;
}
export function savePhoneFormDraft(storage, input, data, now = () => new Date().toISOString()) {
  const scope = scopeOf(input), parsed = checkedData(scope, data), key = phoneFormDraftKey(scope);
  const raw = bounded(JSON.stringify(envelopeSchema.parse({ ...scope, schemaVersion: 1, savedAt: now(), data: parsed })));
  return enqueue(storage, key, async () => {
    await storage.flush();
    readPhoneFormDraft(storage, scope);
    storage.setItem(key, raw);
    await storage.flush();
    if (storage.getItem(key) !== raw) throw new Error('The form draft save could not be confirmed. Keep this page open and retry.');
    return parsed;
  });
}
export function clearPhoneFormDraft(storage, input, expectedData) {
  const scope = scopeOf(input), key = phoneFormDraftKey(scope), expected = expectedData === undefined ? undefined : checkedData(scope, expectedData);
  return enqueue(storage, key, async () => {
    await storage.flush();
    const saved = readPhoneFormDraft(storage, scope);
    if (saved && expected && JSON.stringify(saved.data) !== JSON.stringify(expected)) throw new Error('A newer form draft is retained. It has not been cleared.');
    if (!saved) return;
    const raw = storage.getItem(key);
    if (storage.transact) await storage.transact(entries => { if (entries[key] !== raw) throw new Error('The form draft changed before clearing.'); delete entries[key]; });
    else { storage.removeItem(key); await storage.flush(); }
    if (storage.getItem(key) !== null) throw new Error('Clearing the form draft was not confirmed. It remains available for recovery.');
  });
}
