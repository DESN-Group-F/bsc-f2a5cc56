import { z } from 'zod';
import { operatorRegistrationPayloadSchema, verifyOperatorRegistrationReceipt } from '../../shared/lib/operator-registration-session.js';
import { modelSelectionSchema } from '../../shared/lib/battery-models.js';
import { currentSydneyDate } from '../../shared/lib/battery-age.js';
import { isSelectableRoom } from '../../shared/lib/location-catalog.js';
import { mobileRegistrationFailureStatus } from '../../shared/lib/mobile-registration-session.js';

const accountIdSchema = z.string().uuid(), datasetSchema = z.enum(['demo', 'live']);
const valueKeys = ['name', 'model', 'chemistry', 'capacityMah', 'voltage', 'tagId', 'ownerId', 'homeRoomId', 'manufacturedOn', 'firstUsedOn'];
const valuesSchema = z.object(Object.fromEntries(valueKeys.map(key => [key, z.string().max(1000)]))).strict();
export const operatorRegistrationDraftSchema = z.object({ actorAccountId: accountIdSchema, dataset: datasetSchema, sessionId: z.string().uuid(), values: valuesSchema, firstUseMode: z.enum(['at_registration', 'date', 'unknown']), modelSelection: modelSelectionSchema.nullable() }).strict();
const attemptSchema = z.object({ actorAccountId: accountIdSchema, dataset: datasetSchema, payload: operatorRegistrationPayloadSchema, status: z.enum(['uncertain', 'rejected']), message: z.string().max(8000) }).strict();
export function operatorRegistrationStorageKey(accountId, dataset) { return `battery-operator-registration:${accountId}:${dataset}`; }
export function operatorRegistrationDraftKey(accountId, dataset) { return `${operatorRegistrationStorageKey(accountId, dataset)}:draft`; }
export function defaultRegistrationValues(data, userId) {
  const owner = (data.people ?? []).find(item => item.role === 'staff' && item.accountId === userId && data.staffDirectory?.some(account => account.id === item.accountId && account.active));
  return { name: '', model: '', chemistry: '', capacityMah: '', voltage: '', tagId: '', ownerId: owner?.id ?? '', homeRoomId: '', manufacturedOn: '', firstUsedOn: '' };
}
export function registrationValuesFromAttempt(attempt) {
  const common = attempt.payload.common;
  return Object.fromEntries(valueKeys.map(key => [key, String((key === 'tagId' ? attempt.payload.tagId : common[key]) ?? '')]));
}
export function recoverOperatorRegistrationAttempt(raw, actorAccountId, dataset) {
  if (!raw) return null;
  try { const value = attemptSchema.parse(JSON.parse(raw)); return value.actorAccountId === actorAccountId && value.dataset === dataset ? value : null; } catch { return null; }
}
export function recoverOperatorRegistrationDraft(raw, actorAccountId, dataset) {
  if (!raw) return null;
  try { const value = operatorRegistrationDraftSchema.parse(JSON.parse(raw)); return value.actorAccountId === actorAccountId && value.dataset === dataset ? value : null; } catch { return null; }
}
export function captureOperatorRegistrationAttempt(data, user, dataset, draft, requestId) {
  if (data?.dataset !== dataset || data?.user?.id !== user?.id) throw new Error('Wait for the matching account and inventory snapshot before reviewing registration.');
  if (data.capabilities?.operatorRegistration !== 1) throw new Error('This service has not confirmed manual registration support. No registration was sent.');
  accountIdSchema.parse(user.id); datasetSchema.parse(dataset);
  const owner = data.people?.find(item => item.id === draft.values.ownerId && item.role === 'staff' && item.accountId && data.staffDirectory?.some(account => account.id === item.accountId && account.active));
  const building = data.buildings?.find(item => item.id === 'J18');
  const room = draft.values.homeRoomId ? data.rooms?.find(item => item.id === draft.values.homeRoomId && isSelectableRoom(item)) : null;
  if (!owner || !building || draft.values.homeRoomId && !room) throw new Error('Choose an active staff owner and an available J18 room, or leave the room unspecified.');
  const number = key => draft.values[key].trim() ? Number(draft.values[key]) : null;
  const payload = operatorRegistrationPayloadSchema.parse({ requestId, sessionId: draft.sessionId, source: 'operator-entered-registration', tagId: draft.values.tagId.trim() || null,
    directoryBindings: { ownerVersion: owner.version, ownerAccountId: owner.accountId, buildingVersion: building.version, roomVersion: room?.version ?? null },
    common: { name: draft.values.name.trim(), model: draft.values.model.trim(), chemistry: draft.values.chemistry.trim(), capacityMah: number('capacityMah'), voltage: number('voltage'), ownerId: owner.id, homeBuildingId: 'J18', homeRoomId: room?.id ?? null,
      manufacturedOn: draft.values.manufacturedOn || null, firstUsedOn: draft.firstUseMode === 'date' ? draft.values.firstUsedOn || null : null, ...(draft.modelSelection ? { modelSelection: draft.modelSelection } : {}) }, firstUseMode: draft.firstUseMode });
  const today = currentSydneyDate();
  if (payload.common.manufacturedOn && payload.common.manufacturedOn > today || payload.common.firstUsedOn && payload.common.firstUsedOn > today) throw new Error('Manufacture and first-use dates cannot be in the future.');
  if (payload.common.manufacturedOn && payload.common.firstUsedOn && payload.common.manufacturedOn > payload.common.firstUsedOn) throw new Error('First use cannot precede manufacture.');
  return attemptSchema.parse({ actorAccountId: user.id, dataset, payload, status: 'uncertain', message: 'Waiting for the service to confirm this exact reviewed registration.' });
}

/** Preserve the original request and prove durable readback before network submission. */
export async function persistOperatorRegistrationAttempt(storage, attempt) {
  const captured = attemptSchema.parse(structuredClone(attempt)), key = operatorRegistrationStorageKey(captured.actorAccountId, captured.dataset);
  await storage.retryPersistence?.();
  const existingRaw = storage.getItem(key);
  if (existingRaw !== null) {
    const existing = recoverOperatorRegistrationAttempt(existingRaw, captured.actorAccountId, captured.dataset);
    if (!existing || JSON.stringify(existing.payload) !== JSON.stringify(captured.payload)) throw new Error('A different original registration request is retained. It has not been replaced.');
  } else storage.setItem(key, JSON.stringify(captured));
  await storage.flush();
  const confirmed = recoverOperatorRegistrationAttempt(storage.getItem(key), captured.actorAccountId, captured.dataset);
  if (!confirmed || JSON.stringify(confirmed.payload) !== JSON.stringify(captured.payload)) throw new Error('The original registration request could not be verified in device storage. No registration was sent.');
  return captured;
}
export function registrationFailureStatus(error, alreadyUncertain) { return mobileRegistrationFailureStatus(error, alreadyUncertain); }
export function verifyRegistrationResult(result, attempt) { return verifyOperatorRegistrationReceipt(result, attempt.payload, attempt.actorAccountId, attempt.dataset); }
/** Discard only the exact reviewed local draft, after proving no request needs recovery. */
export async function discardOperatorRegistrationDraft(storage, { actorAccountId, dataset, expectedDraftRaw, modelRequestKey }, isCurrent) {
  accountIdSchema.parse(actorAccountId); datasetSchema.parse(dataset);
  if (!recoverOperatorRegistrationDraft(expectedDraftRaw, actorAccountId, dataset) || typeof modelRequestKey !== 'string' || !modelRequestKey || typeof isCurrent !== 'function') throw new Error('The unsubmitted draft cannot be verified. Original recovery data is preserved.');
  const key = operatorRegistrationStorageKey(actorAccountId, dataset), draftKey = operatorRegistrationDraftKey(actorAccountId, dataset);
  const guard = entries => {
    if (!isCurrent()) throw new Error('The account or inventory changed. The original draft is preserved.');
    if (Object.hasOwn(entries, key)) throw new Error('Resolve the original registration request before discarding a draft.');
    if (Object.hasOwn(entries, modelRequestKey)) throw new Error('Resolve the saved model request before discarding registration.');
    if (entries[draftKey] !== expectedDraftRaw || !recoverOperatorRegistrationDraft(entries[draftKey], actorAccountId, dataset)) throw new Error('The retained draft changed or needs recovery. It has not been discarded.');
  };
  if (!isCurrent()) throw new Error('The account or inventory changed. The original draft is preserved.');
  await storage.retryPersistence?.();
  await storage.flush();
  guard({ [draftKey]: storage.getItem(draftKey), ...(storage.getItem(key) !== null ? { [key]: storage.getItem(key) } : {}), ...(storage.getItem(modelRequestKey) !== null ? { [modelRequestKey]: storage.getItem(modelRequestKey) } : {}) });
  await storage.transact(entries => { guard(entries); delete entries[draftKey]; });
}
export async function acknowledgeOperatorRegistration(storage, attempt, receipt) {
  const confirmed = verifyRegistrationResult(receipt, attempt), key = operatorRegistrationStorageKey(attempt.actorAccountId, attempt.dataset);
  await storage.transact(entries => {
    const retained = recoverOperatorRegistrationAttempt(entries[key], attempt.actorAccountId, attempt.dataset);
    if (!retained || JSON.stringify(retained.payload) !== JSON.stringify(attempt.payload)) throw new Error('The retained request changed before receipt acknowledgement. Original recovery must be resolved.');
    entries[`preference:operator-registration-receipt:${confirmed.requestId}`] = JSON.stringify(confirmed);
    delete entries[key]; delete entries[operatorRegistrationDraftKey(attempt.actorAccountId, attempt.dataset)];
  });
  return confirmed;
}
