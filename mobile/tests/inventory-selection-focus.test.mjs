import test from 'node:test';
import assert from 'node:assert/strict';
import { prioritizeInventoryHandoff } from '../src/features/inventory/selection-focus.mjs';

test('inventory handoff reveals late selected records while preserving the order of both groups', () => {
  const candidates = Array.from({ length: 125 }, (_, index) => ({ id: `BAT-${index}`, version: 7 }));
  const result = prioritizeInventoryHandoff(candidates, ['BAT-124', 'BAT-100', 'BAT-124']);
  assert.deepEqual(result.slice(0, 3).map(item => item.id), ['BAT-100', 'BAT-124', 'BAT-0']);
  assert.deepEqual(result.slice(2), candidates.filter(item => !['BAT-100', 'BAT-124'].includes(item.id)));
  assert.equal(new Set(result).size, 125);
  assert.equal(candidates[0].id, 'BAT-0');
  assert.equal(result[1], candidates[124], 'The reviewed record identity and version are preserved');
});

test('focus never adds unavailable or filtered-out handoff records or changes the unseeded list', () => {
  const candidates = [{ id: 'BAT-2' }, { id: 'BAT-3' }];
  assert.equal(prioritizeInventoryHandoff(candidates, []), candidates);
  assert.equal(prioritizeInventoryHandoff(candidates, ['BAT-1']), candidates);
  assert.deepEqual(prioritizeInventoryHandoff(candidates, ['BAT-1', 'BAT-3']), [candidates[1], candidates[0]]);
  assert.deepEqual(prioritizeInventoryHandoff([], ['BAT-1']), []);
});
