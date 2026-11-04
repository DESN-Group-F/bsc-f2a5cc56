import { test } from 'node:test';
import assert from 'node:assert/strict';
import { operatorEditPayloadSchema, operatorEditFingerprint, verifyOperatorEditReceipt, verifyOperatorEditOutcome } from '../work/qa/operator-edit.mjs';

const actor = crypto.randomUUID(), owner = crypto.randomUUID();
const fields = { name: 'Reviewed battery', model: '', chemistry: '', capacityMah: null, voltage: null, tagId: null, ownerId: `staff-${owner}`, homeBuildingId: 'J18', homeRoomId: null, manufacturedOn: null, firstUsedOn: null };
const payload = { requestId: crypto.randomUUID(), batteryId: 'BAT-001', before: { ...fields, version: 3, registeredAt: '2026-10-01T00:00:00.000Z' }, fields: { ...fields, name: 'Edited battery' }, directoryBindings: { ownerVersion: 2, ownerAccountId: owner, buildingVersion: 1, roomVersion: null } };
const receipt = { kind: 'metadata_edit', requestId: payload.requestId, dataset: 'live', actorAccountId: actor, batteryId: payload.batteryId, at: '2026-10-11T01:00:00.000Z', replayed: false, before: payload.before, after: { ...payload.fields, version: 4, registeredAt: payload.before.registeredAt }, directoryBindings: payload.directoryBindings };

test('edit contract keeps unknown specifications null and model/chemistry as strings', () => {
  assert.deepEqual(operatorEditPayloadSchema.parse(payload), payload);
  for (const field of ['model', 'chemistry']) assert.equal(operatorEditPayloadSchema.safeParse({ ...payload, fields: { ...payload.fields, [field]: null } }).success, false);
  assert.equal(operatorEditPayloadSchema.safeParse({ ...payload, fields: { ...payload.fields, capacityMah: 0 } }).success, false);
  assert.equal(operatorEditPayloadSchema.safeParse({ ...payload, fields: { ...payload.fields, manufacturedOn: '2026-02-30' } }).success, false);
  assert.equal(operatorEditPayloadSchema.safeParse({ ...payload, fields: { ...payload.fields, registeredAt: receipt.at } }).success, false);
  assert.equal(operatorEditPayloadSchema.safeParse({ ...payload, fields: { ...payload.fields, homeBuildingId: null } }).success, false);
  assert.equal(operatorEditPayloadSchema.safeParse({ ...payload, before: { ...payload.before, homeBuildingId: null } }).success, true);
});
test('edit fingerprint is canonical and bound to original fields, directory review, actor and inventory', async () => {
  const fingerprint = await operatorEditFingerprint(payload, actor, 'live');
  assert.match(fingerprint, /^sha256:[a-f0-9]{64}$/);
  assert.equal(await operatorEditFingerprint({ ...payload, fields: Object.fromEntries(Object.entries(payload.fields).reverse()) }, actor, 'live'), fingerprint);
  for (const changed of [{ ...payload, fields: { ...payload.fields, name: 'Other name' } }, { ...payload, directoryBindings: { ...payload.directoryBindings, ownerVersion: 3 } }, { ...payload, before: { ...payload.before, version: 4 } }])
    assert.notEqual(await operatorEditFingerprint(changed, actor, 'live'), fingerprint);
  assert.notEqual(await operatorEditFingerprint(payload, crypto.randomUUID(), 'live'), fingerprint);
  assert.notEqual(await operatorEditFingerprint(payload, actor, 'demo'), fingerprint);
});
test('confirmed edit verifies every before/after field, registration time and reviewed directory bindings', () => {
  assert.deepEqual(verifyOperatorEditReceipt(receipt, payload, actor, 'live'), receipt);
  for (const changed of [
    { ...receipt, actorAccountId: crypto.randomUUID() }, { ...receipt, dataset: 'demo' }, { ...receipt, requestId: crypto.randomUUID() },
    { ...receipt, batteryId: 'BAT-002' }, { ...receipt, after: { ...receipt.after, version: 5 } },
    { ...receipt, after: { ...receipt.after, registeredAt: receipt.at } }, { ...receipt, before: { ...receipt.before, name: 'Different original' } },
    { ...receipt, after: { ...receipt.after, capacityMah: 2000 } },
    { ...receipt, directoryBindings: { ...receipt.directoryBindings, ownerVersion: 3 } },
  ]) assert.throws(() => verifyOperatorEditReceipt(changed, payload, actor, 'live'));
});
test('final rejection and purged outcomes verify their hashed immutable original request', async () => {
  const identity = { requestId: payload.requestId, dataset: 'live', actorAccountId: actor };
  const rejected = { state: 'rejected', ...identity, batteryId: payload.batteryId, at: receipt.at, code: 'metadata_edit_rejected_final', error: 'The reviewed record changed.', fingerprint: await operatorEditFingerprint(payload, actor, 'live') };
  assert.deepEqual(await verifyOperatorEditOutcome(rejected, payload, actor, 'live'), rejected);
  const purged = { state: 'purged', ...identity, batteryId: payload.batteryId, fingerprint: rejected.fingerprint };
  assert.deepEqual(await verifyOperatorEditOutcome(purged, payload, actor, 'live'), purged);
  assert.deepEqual(await verifyOperatorEditOutcome({ state: 'missing', ...identity }, payload, actor, 'live'), { state: 'missing', ...identity });
  for (const outcome of [rejected, purged]) {
    await assert.rejects(verifyOperatorEditOutcome(outcome, { ...payload, fields: { ...payload.fields, name: 'Changed later' } }, actor, 'live'));
    await assert.rejects(verifyOperatorEditOutcome({ ...outcome, fingerprint: `sha256:${'0'.repeat(64)}` }, payload, actor, 'live'));
  }
  await assert.rejects(verifyOperatorEditOutcome({ state: 'missing', ...identity, actorAccountId: owner }, payload, actor, 'live'));
});
