import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultInventoryFilter } from '../src/shared/lib/inventory-query.js';
import { UNKNOWN_MAPPING_ROOM } from '../src/shared/lib/inventory-mapping.js';
import { initialInventoryView, inventoryBoundaryIds, inventoryExportDraft, inventoryViewKey, mappingSummaries, mobileFilterChips, newArrivalsInventoryView, queryInventory, readInventoryView, rememberInventoryView, selectedOperationState } from '../src/features/inventory/inventory-model.mjs';

const groupId = 'c9a35088-2d5a-46d8-9114-70d9bb1b5c47';
const rooms = [{ id: 'ROOM-A', name: 'Current room A', number: 'A', buildingId: 'J18', selectable: true, isPlaceholder: false }, { id: 'ROOM-B', name: 'Demo room B', number: 'B', buildingId: 'J18', selectable: true, isPlaceholder: true }];
function battery(id, patch = {}) { return { id, name: id, model: '', chemistry: '', capacityMah: null, voltage: null, ownerId: 'staff-person', ownerName: 'Staff', ownerAccountId: 'staff', loanId: null, borrowerAccountId: null, borrowerKind: null, homeBuildingId: 'J18', homeRoomId: 'ROOM-A', observedAt: null, observedRoomId: null, observationRoomSnapshot: 'recorded', observedRoom: null, observedBuilding: null, manufacturedOn: null, firstUsedOn: null, lastCheckedOutAt: null, chargedAt: null, lifecycleStatus: 'active', ...patch }; }
function snapshot() { return { dataset: 'demo', user: { id: 'staff', role: 'staff' }, rooms, people: [], staffDirectory: [], buildings: [], teachingGroups: [{ id: groupId, name: 'Own group', ownerAccountId: 'staff', state: 'active', version: 7, batteryIds: ['B1', 'B3'] }], newArrivals: { serverNow: '2026-10-12T06:00:00.000Z', items: [{ batteryId: 'B2', registeredAt: '2026-10-12T05:00:00.000Z', isUnread: true }] }, batteries: [battery('B1', { loanId: 'loan1', borrowerAccountId: 'other', borrowerKind: 'staff', observedAt: '2026-10-12T04:00:00.000Z', observedRoomId: 'ROOM-B', observedRoom: 'Saved room B', observedBuilding: 'Saved J18', model: 'Cell' }), battery('B2', { ownerAccountId: 'other', ownerId: 'other-person', loanId: 'loan2', borrowerAccountId: 'staff', borrowerKind: 'staff', observedAt: '2026-10-12T03:00:00.000Z', observedRoomId: 'ROOM-A', observedRoom: 'Saved room A' }), battery('B3', { observedAt: 'invalid-time', observedRoomId: 'ROOM-A' }), battery('B4', { ownerAccountId: 'other', lifecycleStatus: 'scrapped' })] }; }

test('fixed personal scopes distinguish responsible owner from active holder, including export boundaries', () => {
  const data = snapshot(), owner = { kind: 'owner', id: 'staff' }, holder = { kind: 'holder', id: 'staff' };
  assert.deepEqual(queryInventory(data, 'staff', owner, {}).map(item => item.id), ['B1', 'B3']);
  assert.deepEqual(queryInventory(data, 'staff', holder, {}).map(item => item.id), ['B2']);
  const draft = inventoryExportDraft(data, 'staff', holder, { ...initialInventoryView(holder), selectedIds: ['B1', 'B2', 'B4'] });
  assert.equal(draft.filter.personalScope, 'borrowed'); assert.deepEqual(draft.selectedIds, ['B2']); assert.equal(draft.matching, 1);
  assert.throws(() => queryInventory(data, 'staff', { kind: 'owner', id: 'other' }, {}), /different account/);
});
test('Mapping uses latest observation room and Unknown, never registered home; removed records are excluded from overview', () => {
  const data = snapshot(), summaries = mappingSummaries(data);
  assert.deepEqual(summaries.find(item => item.id === 'ROOM-B').batteries.map(item => item.id), ['B1']);
  assert.deepEqual(summaries.find(item => item.id === 'ROOM-A').batteries.map(item => item.id), ['B2']);
  assert.deepEqual(summaries.find(item => item.id === UNKNOWN_MAPPING_ROOM).batteries.map(item => item.id), ['B3']);
  assert.equal(summaries.reduce((sum, item) => sum + item.total, 0), 3);
  data.batteries[0].observedRoomId = 'ARCHIVED-ROOM';
  assert.deepEqual(queryInventory(data, 'staff', { kind: 'room', id: UNKNOWN_MAPPING_ROOM }, {}).map(item => item.id), ['B1', 'B3']);
  const exportDraft = inventoryExportDraft(data, 'staff', { kind: 'room', id: 'ROOM-A' }, initialInventoryView({ kind: 'room', id: 'ROOM-A' }));
  assert.equal(exportDraft.filter.mappingRoom, 'ROOM-A'); assert.equal(exportDraft.matching, 1);
});
test('group filters and complete downloads retain own versioned membership and reject missing or foreign groups', () => {
  const data = snapshot(), scope = { kind: 'group', id: groupId }, view = initialInventoryView(scope);
  view.filter.search = 'B1'; view.selectedIds = ['B1', 'B3', 'B2'];
  const draft = inventoryExportDraft(data, 'staff', scope, view);
  assert.equal(draft.matching, 1); assert.deepEqual(draft.selectedIds, ['B1', 'B3']); assert.deepEqual(draft.teachingGroup, { id: groupId, version: 7 });
  assert.equal(inventoryBoundaryIds(data, 'staff', scope).size, 2);
  data.teachingGroups[0].ownerAccountId = 'other'; assert.throws(() => queryInventory(data, 'staff', scope, {}), /no longer available/);
});
test('counts, page ordering and export use the same query across all pages without truncation', () => {
  const data = snapshot(); data.batteries = Array.from({ length: 73 }, (_, i) => battery(`B${String(i).padStart(3, '0')}`, { capacityMah: i === 72 ? null : i + 1 }));
  const view = { ...initialInventoryView(null), page: 2, pageSize: 25, filter: { ...defaultInventoryFilter(), sortBy: 'capacity', sortDirection: 'desc' }, selectedIds: ['B000', 'B072'] };
  const rows = queryInventory(data, 'staff', null, view.filter), draft = inventoryExportDraft(data, 'staff', null, view);
  assert.equal(rows.length, 73); assert.equal(draft.matching, 73); assert.equal(draft.pageCount, 23); assert.equal(draft.page, 2); assert.equal(draft.pageSize, '25');
  assert.equal(rows.at(-1).id, 'B072'); assert.deepEqual(draft.selectedIds, ['B000', 'B072']);
  view.filter.search = 'B001'; view.page = 2; assert.equal(inventoryExportDraft(data, 'staff', null, view).page, 0);
});
test('New arrivals is removable only within shared list; clearing criteria preserves independently cached selections and scope', () => {
  const data = snapshot(), filter = { ...defaultInventoryFilter(), newArrivalsOnly: true };
  assert.deepEqual(queryInventory(data, 'staff', null, filter).map(item => item.id), ['B2']);
  assert.deepEqual(queryInventory(data, 'staff', { kind: 'owner', id: 'staff' }, filter).map(item => item.id), ['B1', 'B3']);
  const chip = mobileFilterChips(filter, data, null).find(item => item.key === 'arrivals'); assert.deepEqual(chip.reset, { newArrivalsOnly: false });
  const ownerKey = inventoryViewKey('staff', 'demo', { kind: 'owner', id: 'staff' }), roomKey = inventoryViewKey('staff', 'demo', { kind: 'room', id: 'ROOM-A' });
  rememberInventoryView(ownerKey, { ...initialInventoryView(null), selectedIds: ['B1'], scrollTop: 420, page: 1 });
  assert.equal(readInventoryView(ownerKey, null).scrollTop, 420); assert.deepEqual(readInventoryView(ownerKey, null).selectedIds, ['B1']); assert.deepEqual(readInventoryView(roomKey, null).selectedIds, []);
  assert.notEqual(ownerKey, inventoryViewKey('staff', 'live', { kind: 'owner', id: 'staff' }));
});
test('review actions reject mixed loans, retired assets, missing selections and more than 100 assets', () => {
  const data = snapshot(); assert.deepEqual(selectedOperationState(data.batteries, ['B3']), { checkout: true, return: false, retire: true });
  assert.deepEqual(selectedOperationState(data.batteries, ['B1', 'B2']), { checkout: false, return: true, retire: false });
  for (const ids of [['B1', 'B3'], ['B4'], ['missing'], []]) assert.deepEqual(selectedOperationState(data.batteries, ids), { checkout: false, return: false, retire: false });
  const large = Array.from({ length: 101 }, (_, index) => battery(`large${index}`)); assert.equal(selectedOperationState(large, large.map(item => item.id)).checkout, false);
});
test('opening New arrivals clears ordinary criteria, shows all active states newest first, and retains selected records', () => {
  const before = { ...initialInventoryView(null), selectedIds: ['B1', 'B3'], selecting: true, page: 3, scrollTop: 470, filter: { ...defaultInventoryFilter(), status: 'out', search: 'unrelated', capacityMode: 'known', groupId, sortBy: 'capacity', sortDirection: 'asc', lifecycle: 'scrapped' } };
  const after = newArrivalsInventoryView(before);
  assert.deepEqual(after.selectedIds, ['B1', 'B3']); assert.equal(after.selecting, true); assert.equal(after.page, 0); assert.equal(after.scrollTop, 0);
  assert.deepEqual(after.filter, { ...defaultInventoryFilter(), newArrivalsOnly: true, sortBy: 'registered', sortDirection: 'desc' });
  assert.equal(before.filter.search, 'unrelated', 'Opening the view does not mutate the captured prior criteria');
});
