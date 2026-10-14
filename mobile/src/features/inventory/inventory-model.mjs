import { defaultInventoryFilter, filterBatteries, inventoryFilterSchema, inventorySortOptions, lastObservedLocations } from '../../shared/lib/inventory-query.js';
import { currentSydneyDate } from '../../shared/lib/battery-age.js';
import { getMappingRooms, mappingBucket, UNKNOWN_MAPPING_ROOM } from '../../shared/lib/inventory-mapping.js';
import { isActiveBattery } from '../../shared/lib/battery-lifecycle.js';

// Presentation memory only; authoritative records and workflow recovery live elsewhere.
const viewMemory = new Map();
export function inventoryViewKey(userId, dataset, scope) {
  return JSON.stringify([userId, dataset, scope?.kind ?? 'shared', scope?.id ?? '']);
}
export function initialInventoryView(scope, fullRegister = false) {
  return { filter: { ...defaultInventoryFilter(), ...(scope?.kind === 'group' || fullRegister ? { lifecycle: 'all' } : {}) }, selectedIds: [], selecting: false, page: 0, pageSize: 25, scrollTop: 0 };
}
export function readInventoryView(key, scope, fullRegister = false) { return viewMemory.get(key) ?? initialInventoryView(scope, fullRegister); }
export function rememberInventoryView(key, view) { viewMemory.set(key, view); }
export function prepareTeachingGroupView(data, accountId, dataset, group, { select = false } = {}) {
  if (!accountId || data?.user?.id !== accountId || data?.dataset !== dataset || !group || group.ownerAccountId !== accountId || group.state !== 'active') return null;
  const current = data.teachingGroups?.find(item => item.id === group.id && item.ownerAccountId === accountId && item.state === 'active');
  if (!current || !Number.isInteger(group.version) || group.version < 1 || current.version !== group.version || JSON.stringify(current.batteryIds) !== JSON.stringify(group.batteryIds)) return null;
  const scope = { kind: 'group', id: current.id, label: current.name, version: current.version };
  const key = inventoryViewKey(accountId, dataset, scope), previous = readInventoryView(key, scope);
  rememberInventoryView(key, { ...previous, filter: { ...initialInventoryView(scope).filter, groupId: current.id }, page: 0, scrollTop: 0,
    ...(select ? { selectedIds: [...current.batteryIds], selecting: true } : {}) });
  return scope;
}
export function newArrivalsInventoryView(view) { return { ...view, filter: { ...defaultInventoryFilter(), newArrivalsOnly: true, sortBy: 'registered', sortDirection: 'desc' }, page: 0, scrollTop: 0 }; }

export function scopedInventoryFilter(input, scope, userId) {
  if ((scope?.kind === 'owner' || scope?.kind === 'holder') && scope.id !== userId)
    throw new Error('This personal view belongs to a different account.');
  return inventoryFilterSchema.parse({ ...input, personalScope: scope?.kind === 'owner' ? 'responsible' : scope?.kind === 'holder' ? 'borrowed' : 'all',
    mappingRoom: scope?.kind === 'room' ? scope.id : null,
    ...(scope?.kind === 'group' ? { groupId: scope.id } : {}),
    ...(scope ? { newArrivalsOnly: false } : {}) });
}
export function queryInventory(data, userId, scope, input, asOfOn = currentSydneyDate()) {
  const filter = scopedInventoryFilter(input, scope, userId);
  return filterBatteries(data.batteries, filter, asOfOn, userId, data.teachingGroups ?? [], data.newArrivals, data.rooms ?? []);
}
export function inventoryBoundaryIds(data, userId, scope) {
  return new Set(queryInventory(data, userId, scope, { ...defaultInventoryFilter(), lifecycle: 'all' }).map(item => item.id));
}
export function inventoryExportDraft(data, userId, scope, view, selectedOnly = false) {
  const filter = scopedInventoryFilter(view.filter, scope, userId);
  const matching = queryInventory(data, userId, scope, filter);
  const boundary = inventoryBoundaryIds(data, userId, scope);
  const selectedIds = [...new Set(view.selectedIds)].filter(id => boundary.has(id));
  const page = Math.min(Math.max(0, view.page), Math.max(0, Math.ceil(matching.length / view.pageSize) - 1));
  const group = scope?.kind === 'group' ? data.teachingGroups?.find(item => item.id === scope.id && item.ownerAccountId === userId && item.state === 'active') : null;
  return { filter, page, pageSize: String(view.pageSize), matching: matching.length, pageCount: matching.slice(page * view.pageSize, (page + 1) * view.pageSize).length,
    selectedIds, selectedOnly, ...(group ? { teachingGroup: { id: group.id, version: group.version } } : {}) };
}
export function selectedOperationState(batteries, selectedIds) {
  const ids = new Set(selectedIds), selected = batteries.filter(item => ids.has(item.id));
  const validSize = selected.length > 0 && selected.length <= 100 && selected.length === ids.size;
  return { checkout: validSize && selected.every(item => isActiveBattery(item) && !item.loanId),
    return: validSize && selected.every(item => isActiveBattery(item) && !!item.loanId),
    retire: validSize && selected.every(item => isActiveBattery(item) && !item.loanId) };
}
export function inventoryEmptyState({ scope, activeCount, recordCount, filtered, dataset }) {
  if (filtered) return { title: 'No results for these filters', detail: 'Clear ordinary filters to see records in this view.', action: 'Clear filters' };
  if (scope?.kind === 'holder') return { title: 'No batteries checked out to you', detail: 'This view contains active loans to your account.', action: null };
  if (scope?.kind === 'owner') return { title: 'No active batteries under your responsibility', detail: 'Responsibility is separate from borrowing.', action: null };
  if (scope?.kind === 'room') return { title: 'No active records in this room view', detail: 'Room views use the latest recorded observation, not physical presence.', action: null };
  if (scope?.kind === 'group') return { title: 'No saved members in this group', detail: 'Group membership is separate from actual checkout runs.', action: null };
  if (recordCount > 0 && activeCount === 0) return { title: 'No active batteries', detail: 'Retired records remain available through Record status in Filter.', action: 'View retired records' };
  return { title: 'No batteries registered', detail: dataset === 'live' ? 'Register a battery with its responsible staff account and storage home.' : 'Prepare common details, then acquire and review new batteries.', action: 'Register batteries' };
}
export function mappingSummaries(data) {
  const rooms = getMappingRooms(data.rooms ?? []);
  const entries = [...rooms.map(room => ({ id: room.id, label: room.name, number: room.number, placeholder: !!room.isPlaceholder })),
    { id: UNKNOWN_MAPPING_ROOM, label: 'Unknown / outside this map', number: '', placeholder: false }];
  const buckets = new Map(entries.map(entry => [entry.id, []]));
  for (const battery of data.batteries) if (isActiveBattery(battery)) buckets.get(mappingBucket(battery, data.rooms ?? [])).push(battery);
  return entries.map(entry => {
    const batteries = buckets.get(entry.id);
    return { ...entry, batteries, total: batteries.length, inUse: batteries.filter(item => item.loanId).length,
      inStore: batteries.filter(item => !item.loanId).length };
  });
}
export function mobileFilterChips(filter, data, scope, fullRegister = false) {
  const defaults = initialInventoryView(scope, fullRegister).filter, chips = [];
  const push = (key, label, reset, category) => chips.push({ key, label, reset, category });
  if (filter.search.trim()) push('search', `Search: ${filter.search.trim()}`, { search: '' }, 'search');
  if (filter.status !== 'all') push('status', filter.status === 'in' ? 'In store' : 'In use', { status: 'all' }, 'status');
  if (filter.newArrivalsOnly) push('arrivals', 'New arrivals · last 48 hours', { newArrivalsOnly: false }, 'activity');
  if (filter.lifecycle !== defaults.lifecycle) push('lifecycle', `Record status: ${filter.lifecycle === 'all' ? 'All including removed' : filter.lifecycle.replaceAll('_', ' ')}`, { lifecycle: defaults.lifecycle }, 'details');
  for (const key of ['model', 'chemistry']) if (filter[key] !== null || filter[`${key}Unknown`])
    push(key, `${key === 'model' ? 'Model' : 'Chemistry'}: ${filter[`${key}Unknown`] ? 'Not recorded' : filter[key]}`, { [key]: null, [`${key}Unknown`]: false }, 'details');
  if (filter.building !== 'all') push('building', `Storage building: ${filter.building}`, { building: 'all', room: 'all' }, 'location');
  if (filter.room !== 'all') push('room', `Storage room: ${filter.room === '__unspecified' ? 'Not specified' : data.rooms?.find(item => item.id === filter.room)?.name ?? filter.room}`, { room: 'all' }, 'location');
  if (filter.observedRoom !== 'all') push('observedRoom', `Last observed: ${filter.observedRoom === '__not_observed' ? 'Not observed' : filter.observedRoom === '__unavailable' ? 'Recorded address unavailable' : lastObservedLocations(data.batteries).find(item => item.id === filter.observedRoom)?.label ?? filter.observedRoom}`, { observedRoom: 'all' }, 'location');
  if (filter.owner !== 'all') push('owner', `Responsible: ${data.people?.find(item => item.id === filter.owner)?.name ?? filter.owner}`, { owner: 'all' }, 'people');
  if (filter.holder !== 'all') push('holder', `Holder: ${data.staffDirectory?.find(item => item.id === filter.holder)?.displayName ?? filter.holder}`, { holder: 'all' }, 'people');
  if (filter.groupId && scope?.kind !== 'group') push('group', `Group: ${data.teachingGroups?.find(item => item.id === filter.groupId)?.name ?? 'Unavailable group'}`, { groupId: null }, 'people');
  for (const [key, label, lowKey, highKey, category, unit] of [
    ['capacity', 'Capacity', 'capacityMinMah', 'capacityMaxMah', 'details', ' mAh'], ['voltage', 'Voltage', 'voltageMin', 'voltageMax', 'details', ' V'],
    ['age', 'Age', 'ageMinDays', 'ageMaxDays', 'activity', ' days'], ['checkout', 'Checkout', 'checkoutFrom', 'checkoutTo', 'activity', ''], ['charge', 'Charge', 'chargeFrom', 'chargeTo', 'activity', '']]) {
    const modeKey = `${key}Mode`, low = filter[lowKey], high = filter[highKey];
    if (filter[modeKey] !== 'any' || low !== null || high !== null) push(key, `${label}: ${filter[modeKey] === 'unknown' ? 'Not recorded' : [filter[modeKey] === 'known' ? 'Recorded' : '', low !== null ? `from ${low}${unit}` : '', high !== null ? `to ${high}${unit}` : ''].filter(Boolean).join(' · ')}`, { [modeKey]: 'any', [lowKey]: null, [highKey]: null }, category);
  }
  if (filter.sortBy !== 'id' || filter.sortDirection !== 'asc') push('sort', `${inventorySortOptions.find(item => item.id === filter.sortBy)?.label} · ${filter.sortDirection === 'asc' ? 'Ascending' : 'Descending'}`, { sortBy: 'id', sortDirection: 'asc' }, 'sort');
  return chips;
}
