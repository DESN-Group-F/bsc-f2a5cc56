import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOwnTeachingRuns, teachingRunMatches, teachingRunPresentation } from '../src/features/workspace/teaching-run-model.mjs';
import { queryInventory } from '../src/features/inventory/inventory-model.mjs';
import { defaultInventoryFilter } from '../src/shared/lib/inventory-query.js';

function fixture() {
  const group = { id: crypto.randomUUID(), version: 1, name: 'Recorded teaching selection', notes: '', state: 'active', ownerAccountId: 'teacher', batteryIds: ['BAT003', 'BAT004'] };
  const runId = crypto.randomUUID();
  const snapshot = batteryId => ({ batteryId, tagId: null, version: 1, name: batteryId, model: 'Known model', chemistry: 'Recorded chemistry', capacityMah: 2000, voltage: 3.7, homeBuildingId: 'J18', homeRoomId: null, homeRoomName: null, homeRoomIsPlaceholder: null });
  const loan3 = crypto.randomUUID(), loan4 = crypto.randomUUID(), loan5 = crypto.randomUUID();
  const mapping = (original, actual, loanId) => ({ original: snapshot(original), actual: snapshot(actual), originalLoanId: null, method: original === actual ? 'original' : 'manual', source: { kind: 'selection' }, loanId, specificationMatch: true, differences: [] });
  const originalMappings = [mapping('BAT003', 'BAT003', loan3), mapping('BAT004', 'BAT004', loan4)];
  const replacement = mapping('BAT003', 'BAT005', loan5);
  const at = '2026-10-12T03:00:00.000Z';
  const item = (batteryId, loanId, additions = {}) => ({ batteryId, loanId, status: 'outstanding', tagId: null, version: 2, returnedAt: null, checkedOutAt: at, ...additions });
  const run = { id: runId, dataset: 'demo', actorAccountId: 'teacher', actorName: 'Recorded teacher', teachingGroup: { id: group.id, version: 1, name: group.name, ownerAccountId: 'teacher', operationId: runId, batteryIds: group.batteryIds }, requestedBatteryIds: group.batteryIds, mappings: originalMappings, createdAt: at, revision: 2, currentMappings: [replacement, originalMappings[1]], changes: [{ id: crypto.randomUUID(), runId, revision: 2, action: 'exchange', actorAccountId: 'teacher', actorName: 'Recorded teacher', at, mappings: [replacement], outgoing: { batteryId: 'BAT003', loanId: loan3, returned: false } }], items: [item('BAT003', loan3, { pendingReturn: true, originalBatteryId: 'BAT003' }), item('BAT004', loan4), item('BAT005', loan5, { originalBatteryId: 'BAT003' })] };
  return { group, run, loan3, loan4, loan5 };
}

test('phone actual checkout projection retains all liabilities after exchange without hand-back', () => {
  const { group, run, loan3, loan5 } = fixture();
  const before = structuredClone(run);
  const presentation = teachingRunPresentation(run, group);
  assert.equal(presentation.outstanding.length, 3);
  assert.deepEqual(presentation.pending.map(item => [item.batteryId, item.loanId]), [['BAT003', loan3]]);
  assert.equal(presentation.items.find(item => item.item.batteryId === 'BAT003').canExchange, false);
  assert.equal(presentation.items.find(item => item.item.loanId === loan5).canExchange, true);
  assert.deepEqual(presentation.missingIds, []);
  assert.deepEqual(run, before);
  assert.deepEqual(group.batteryIds, ['BAT003', 'BAT004']);
});

test('phone group members remain the saved group while actual alternatives are shown only in checkout runs', () => {
  const { group, run } = fixture();
  const data = { user: { id: 'teacher' }, teachingGroups: [group], batteries: ['BAT003', 'BAT004', 'BAT005'].map(id => ({ id, name: id, lifecycleStatus: 'active', loanId: `loan-${id}` })), rooms: [] };
  const members = queryInventory(data, 'teacher', { kind: 'group', id: group.id, label: group.name }, { ...defaultInventoryFilter(), lifecycle: 'all' });
  assert.deepEqual(members.map(item => item.id), ['BAT003', 'BAT004']);
  assert.ok(teachingRunPresentation(run, group).items.some(item => item.item.batteryId === 'BAT005'));
});

test('continued session distinguishes missing default members from pending-return blockers with exact loans', () => {
  const { group, run } = fixture();
  const changedDefaults = { ...group, batteryIds: ['BAT003', 'BAT004', 'BAT006'] };
  const presentation = teachingRunPresentation(run, changedDefaults);
  assert.deepEqual(presentation.missingIds, ['BAT006']);
  const pendingOnly = { ...run, currentMappings: [run.mappings[1]], items: run.items.filter(item => item.batteryId !== 'BAT005') };
  assert.deepEqual(teachingRunPresentation(pendingOnly, group).blockedIds, ['BAT003']);
  assert.equal(teachingRunMatches(run, group.id, 'BAT005', true), true);
  assert.equal(teachingRunMatches(run, 'other-group', 'BAT005', false), false);
});

test('actual teaching records require complete existing service schema and own account/dataset before actions', () => {
  const { run } = fixture();
  assert.deepEqual(parseOwnTeachingRuns({ runs: [run] }, 'teacher', 'demo'), [run]);
  assert.throws(() => parseOwnTeachingRuns({ runs: [run] }, 'other-teacher', 'demo'), /validated/);
  assert.throws(() => parseOwnTeachingRuns({ runs: [run] }, 'teacher', 'live'), /validated/);
  assert.throws(() => parseOwnTeachingRuns({ runs: [{ ...run, items: [{ batteryId: 'BAT003', status: 'outstanding' }] }] }, 'teacher', 'demo'), /validated/);
  assert.throws(() => parseOwnTeachingRuns({}, 'teacher', 'demo'), /incomplete/);
});
