import test from 'node:test';
import assert from 'node:assert/strict';
import { removalEntrySource, scanInputMode } from '../src/features/scan/input-mode.mjs';
import { createDurableStorage } from '../src/platform/durable-storage.mjs';
import { createRemovalController } from '../src/features/lifecycle/removal-controller.mjs';
import { removalDraftStorageKey } from '../src/shared/lib/removal-draft.js';

test('a fresh empty Working removal opens NFC evidence without changing captured business source', async () => {
  const storage = createDurableStorage({ load: async () => JSON.stringify({ schemaVersion: 1, entries: {} }), save: async () => {} }); await storage.initialize();
  const accountId = '11111111-1111-4111-8111-111111111111', data = { dataset: 'live', user: { id: accountId }, batteries: [] };
  const controller = createRemovalController({ storage, accountId, dataset: 'live', inventory: data, defaultSource: 'native_nfc', write: () => assert.fail('Fresh UI must not submit') });
  assert.equal(storage.getItem(removalDraftStorageKey(accountId, 'live')), null);
  assert.equal(removalEntrySource(controller.snapshot().draft, [], false), 'native_nfc');
  assert.equal(controller.snapshot().draft.source, 'manual_selection');
});

test('empty persisted removal drafts restore the real source instead of starting an incompatible NFC reader', async () => {
  for (const source of ['manual_selection','tag_entry','native_nfc']) {
    let raw = JSON.stringify({ schemaVersion: 1, entries: {} });
    const storage = createDurableStorage({ load: async () => raw, save: async value => { raw = value; } }); await storage.initialize();
    const accountId = '11111111-1111-4111-8111-111111111111', battery = { id: 'BAT-1', name: 'Battery one', version: 7, tagId: 'tag-BAT-1', lifecycleStatus: 'active', loanId: null }, data = { dataset: 'demo', user: { id: accountId }, batteries: [battery] }, requests = [];
    const settings = { storage, accountId, dataset: 'demo', inventory: data, defaultSource: 'native_nfc', write: async (action, payload) => { requests.push({ action, payload }); assert.equal(action, 'scan_lookup', 'Input must never submit a removal'); return { source: payload.source, results: [{ tagId: 'tag-BAT-1', battery }] }; } };
    const original = createRemovalController(settings); await original.initialize(); await original.change({ source });
    const restoredStorage = createDurableStorage({ load: async () => raw, save: async value => { raw = value; } }); await restoredStorage.initialize();
    const restored = createRemovalController({ ...settings, storage: restoredStorage });
    const visibleSource = removalEntrySource(restored.snapshot().draft, [], !!restoredStorage.getItem(removalDraftStorageKey(accountId, 'demo')));
    assert.equal(visibleSource, source); assert.equal(restored.snapshot().draft.source, source); assert.equal(restored.snapshot().blocked, false);
    assert.deepEqual(restored.snapshot().draft.items, []);
    assert.deepEqual(requests, []);
    if (source !== 'native_nfc') {
      const acquire = current => source === 'manual_selection' ? current.add(battery.id) : current.addTag(battery.tagId);
      assert.equal((await acquire(restored)).kind, 'accepted');
      assert.equal(restored.snapshot().draft.source, source);
      await restored.change({ items: [], selectedIds: [] });
      const clearedStorage = createDurableStorage({ load: async () => raw, save: async value => { raw = value; } }); await clearedStorage.initialize();
      const cleared = createRemovalController({ ...settings, storage: clearedStorage });
      assert.equal(removalEntrySource(cleared.snapshot().draft, [], !!clearedStorage.getItem(removalDraftStorageKey(accountId, 'demo'))), source);
      assert.equal((await acquire(cleared)).kind, 'accepted', 'The next real acquisition after clearing and restarting keeps its original source');
      assert.equal(cleared.snapshot().draft.items.length, 1);
      if (source === 'tag_entry') assert.deepEqual(requests.map(request => request.payload), [{ source: 'manual', tagIds: [battery.tagId] }, { source: 'manual', tagIds: [battery.tagId] }]);
      else assert.deepEqual(requests, []);
    }
  }
});

test('fresh Scan prefers NFC while contextual selections and captured sources remain explicit', () => {
  assert.equal(scanInputMode({ queue: [] }), 'native');
  assert.equal(scanInputMode({ queue: [] }, ['BAT-1']), 'selection');
  for (const [source, mode] of [['native_nfc','native'],['selection','selection'],['manual','tag'],['simulated','simulated']]) assert.equal(scanInputMode({ queue: [{ source }] }, ['BAT-1']), mode);
});
