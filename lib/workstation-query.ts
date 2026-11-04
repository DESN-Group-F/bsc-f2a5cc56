import { z } from 'zod';
import type { BatteryRecord as SharedBattery, Room } from './domain';
import type { NewArrivals as SharedNewArrivals } from './new-arrivals';
import { filterBatteries, sortBatteries, inventoryFilterSchema, type InventoryFilter as WebInventoryFilter } from './inventory-query';
import { ageInDays, currentSydneyDate, isDateOnly, serviceAgeAsOfOn } from './battery-age';
import { getMappingRooms, UNKNOWN_MAPPING_ROOM } from './inventory-mapping';

export const mappingScopeSchema = z.object({ roomId: z.union([z.literal(UNKNOWN_MAPPING_ROOM), z.string().min(1).max(64).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/)]) }).strict();
export type MappingScope = z.infer<typeof mappingScopeSchema>;
export function mappingScopeError(scope: MappingScope | undefined, rooms: readonly Room[]): string | null {
  if (!scope) return null;
  if (!mappingScopeSchema.safeParse(scope).success || scope.roomId !== UNKNOWN_MAPPING_ROOM && !getMappingRooms(rooms).some(room => room.id === scope.roomId)) return 'This last-observation room is no longer available in the current map. Refresh and review its scope.';
  return null;
}

export const UNKNOWN = '__unknown__';
export const NO_OBSERVATION = '__no_observation__';
export const UNAVAILABLE_LABEL = '__unavailable_label__';
export type InventoryStatus = 'all' | 'store' | 'use';
export type PersonalScope = 'all' | 'responsible' | 'borrowed';
export type Availability = 'any' | 'known' | 'unknown';
export const sortKeys = ['id', 'name', 'model', 'capacity', 'voltage', 'owner', 'borrower', 'registered', 'manufactured', 'service', 'observed', 'checkout', 'age', 'service_age', 'charge', 'charge_duration'] as const;
export type SortKey = typeof sortKeys[number];
export interface InventoryFilter {
  search: string; model: string; chemistry: string; owner: string; borrower: string;
  ownerReference: 'directory' | 'account';
  building: string; room: string; observedRoom: string;
  lifecycle: 'active' | 'all' | 'scrapped' | 'permanently_removed';
  ageKind: 'service' | 'manufacture'; ageKnown: '' | 'known' | 'unknown'; minAgeDays: string; maxAgeDays: string;
  capacityMode: Availability; capacityMinMah: string; capacityMaxMah: string;
  voltageMode: Availability; voltageMin: string; voltageMax: string;
  checkoutMode: Availability; checkoutFrom: string; checkoutTo: string;
  chargeMode: Availability; chargeFrom: string; chargeTo: string;
}
export interface InventoryQuery {
  filter: InventoryFilter; status: InventoryStatus; sort: SortKey; direction: 'asc' | 'desc'; page: number; pageSize: 10 | 25 | 50 | 100;
  personalScope: PersonalScope; newArrivalsOnly: boolean;
}
/** Values come from the authenticated snapshot/session, never from a saved view or form. */
export interface InventoryQueryContext { accountId: string | null; newArrivals?: SharedNewArrivals; mappingScope?: MappingScope; rooms?: readonly Room[] }
export const emptyFilter: InventoryFilter = { search: '', model: '', chemistry: '', owner: '', borrower: '', ownerReference: 'directory', building: '', room: '', observedRoom: '', lifecycle: 'active', ageKind: 'manufacture', ageKnown: '', minAgeDays: '', maxAgeDays: '', capacityMode: 'any', capacityMinMah: '', capacityMaxMah: '', voltageMode: 'any', voltageMin: '', voltageMax: '', checkoutMode: 'any', checkoutFrom: '', checkoutTo: '', chargeMode: 'any', chargeFrom: '', chargeTo: '' };
export const initialQuery: InventoryQuery = { filter: emptyFilter, status: 'all', sort: 'id', direction: 'asc', page: 0, pageSize: 25, personalScope: 'all', newArrivalsOnly: false };
export const sortLabels: Record<SortKey, string> = { id: 'Battery ID', name: 'Battery name', model: 'Model', capacity: 'Capacity (mAh)', voltage: 'Voltage (V)', owner: 'Responsible owner', borrower: 'Current borrower', registered: 'Registration time', manufactured: 'Manufacture date', service: 'First use date', observed: 'Latest observation time', checkout: 'Latest checkout time', age: 'Age since manufacture', service_age: 'Time in service', charge: 'Latest charge time', charge_duration: 'Latest charging duration' };
const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
export function sydneyDate(value: string): string | null { return Number.isFinite(Date.parse(value)) ? currentSydneyDate(new Date(value)) : null; }
export function ageDays(asset: SharedBattery, kind: InventoryFilter['ageKind'], asOf: string): number | null {
  const date = sydneyDate(asOf);
  return date ? ageInDays(kind === 'service' ? asset.firstUsedOn : asset.manufacturedOn, kind === 'service' ? serviceAgeAsOfOn(asset, date) ?? '' : date) : null;
}
export function storageLabel(asset: SharedBattery): string {
  return [asset.homeBuildingName ?? asset.homeBuildingId, asset.homeRoomNumber, asset.homeRoomName].filter(Boolean).join(' · ') || 'Storage not recorded';
}
export function statusLabel(asset: SharedBattery): string {
  return asset.lifecycleStatus === 'scrapped' ? 'Scrapped' : asset.lifecycleStatus === 'permanently_removed' ? 'Permanently removed' : asset.loanId ? 'In use' : 'In store';
}
const numeric = (value: string): number | null => value.trim() === '' ? null : Number(value);
const availability = (value: InventoryFilter['ageKnown']): Availability => value || 'any';
export function filterError(filter: InventoryFilter): string | null {
  const ranges = [
    ['Capacity', filter.capacityMode, filter.capacityMinMah, filter.capacityMaxMah, false],
    ['Voltage', filter.voltageMode, filter.voltageMin, filter.voltageMax, false],
    ['Age', availability(filter.ageKnown), filter.minAgeDays, filter.maxAgeDays, true],
  ] as const;
  for (const [label, mode, from, to, whole] of ranges) {
    const values = [from, to].filter(value => value.trim() !== '');
    if (values.some(value => !Number.isFinite(Number(value)) || (whole ? !/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) > 3652058 : Number(value) <= 0))) return whole ? 'Age limits must be whole days, zero or greater, within the supported calendar.' : label + ' limits must be finite numbers greater than zero.';
    if (mode === 'unknown' && values.length) return label + ': clear the range before selecting Not recorded.';
    if (from.trim() !== '' && to.trim() !== '' && Number(from) > Number(to)) return whole ? 'Maximum age must be at least the minimum age.' : label + ': the maximum must be at least the minimum.';
  }
  for (const [label, mode, from, to] of [['Latest checkout date', filter.checkoutMode, filter.checkoutFrom, filter.checkoutTo], ['Latest charge date', filter.chargeMode, filter.chargeFrom, filter.chargeTo]] as const) {
    if ([from, to].some(value => value !== '' && !isDateOnly(value))) return label + ': use a real date in YYYY-MM-DD format.';
    if (mode === 'unknown' && (from || to)) return label + ': clear dates before selecting Not recorded.';
    if (from && to && from > to) return label + ': the end must be on or after the start.';
  }
  if (filter.search.length > 200) return 'Search must contain at most 200 characters.';
  try { webFilter(filter, 'all', false); }
  catch (error) {
    const issues = (error as { issues?: { message?: string }[] }).issues;
    return issues?.[0]?.message ?? 'The inventory criteria have an unsupported value.';
  }
  return null;
}
/** Retained entry point for existing callers; all criteria now share one validation result. */
export const ageFilterError = filterError;
function webFilter(filter: InventoryFilter, personalScope: PersonalScope, newArrivalsOnly: boolean): WebInventoryFilter {
  return inventoryFilterSchema.parse({
    search: filter.search, lifecycle: filter.lifecycle, personalScope, newArrivalsOnly,
    model: filter.model && filter.model !== UNKNOWN ? filter.model : null, modelUnknown: filter.model === UNKNOWN,
    chemistry: filter.chemistry && filter.chemistry !== UNKNOWN ? filter.chemistry : null, chemistryUnknown: filter.chemistry === UNKNOWN,
    owner: filter.ownerReference === 'directory' && filter.owner && filter.owner !== UNKNOWN ? filter.owner : 'all',
    holder: filter.borrower && filter.borrower !== UNKNOWN ? filter.borrower : 'all',
    building: filter.building && filter.building !== UNKNOWN ? filter.building : 'all',
    room: filter.room === UNKNOWN ? '__unspecified' : filter.room || 'all',
    observedRoom: filter.observedRoom === NO_OBSERVATION ? '__not_observed' : filter.observedRoom === UNAVAILABLE_LABEL ? '__unavailable' : filter.observedRoom === UNKNOWN ? 'all' : filter.observedRoom || 'all',
    capacityMode: filter.capacityMode, capacityMinMah: numeric(filter.capacityMinMah), capacityMaxMah: numeric(filter.capacityMaxMah),
    voltageMode: filter.voltageMode, voltageMin: numeric(filter.voltageMin), voltageMax: numeric(filter.voltageMax),
    ageMode: filter.ageKind === 'manufacture' ? availability(filter.ageKnown) : 'any',
    ageMinDays: filter.ageKind === 'manufacture' ? numeric(filter.minAgeDays) : null, ageMaxDays: filter.ageKind === 'manufacture' ? numeric(filter.maxAgeDays) : null,
    checkoutMode: filter.checkoutMode, checkoutFrom: filter.checkoutFrom || null, checkoutTo: filter.checkoutTo || null,
    chargeMode: filter.chargeMode, chargeFrom: filter.chargeFrom || null, chargeTo: filter.chargeTo || null,
  });
}
function filteredAssets(assets: readonly SharedBattery[], filter: InventoryFilter, asOf: string, scope: PersonalScope, arrivalsOnly: boolean, context?: InventoryQueryContext): SharedBattery[] {
  const date = sydneyDate(asOf);
  if (!date || filterError(filter)) return [];
  // Fixed personal boundaries cannot be narrowed by a shared-only arrival criterion.
  const criteria = webFilter(filter, scope, scope === 'all' && !context?.mappingScope && arrivalsOnly);
  const result = filterBatteries([...assets], { ...criteria, mappingRoom: context?.mappingScope?.roomId ?? null }, date, context?.accountId ?? null, [], context?.newArrivals, [...(context?.rooms ?? [])]) as SharedBattery[];
  return result.filter(asset => {
    if (filter.ownerReference === 'account' && filter.owner && (filter.owner === UNKNOWN ? !!asset.ownerAccountId : asset.ownerAccountId !== filter.owner)) return false;
    if (filter.ownerReference === 'directory' && filter.owner === UNKNOWN && asset.ownerId) return false;
    if (filter.borrower === UNKNOWN && asset.borrowerAccountId) return false;
    if (filter.building === UNKNOWN && asset.homeBuildingId) return false;
    if (filter.observedRoom === UNKNOWN && (!asset.observedAt || asset.observedRoomId)) return false;
    if (filter.ageKind === 'service') {
      const age = ageDays(asset, 'service', asOf);
      if (filter.ageKnown === 'known' && age === null || filter.ageKnown === 'unknown' && age !== null) return false;
      if (filter.minAgeDays !== '' && (age === null || age < Number(filter.minAgeDays))) return false;
      if (filter.maxAgeDays !== '' && (age === null || age > Number(filter.maxAgeDays))) return false;
    }
    return true;
  });
}
export function matchesFilter(asset: SharedBattery, filter: InventoryFilter, asOf: string): boolean {
  return filteredAssets([asset], filter, asOf, 'all', false).length === 1;
}
function sortRows(assets: SharedBattery[], query: InventoryQuery, date: string): SharedBattery[] {
  if (!['model', 'owner', 'borrower', 'service'].includes(query.sort)) return sortBatteries(assets, { sortBy: query.sort as WebInventoryFilter['sortBy'], sortDirection: query.direction }, date) as SharedBattery[];
  const value = (asset: SharedBattery): string | number | null => {
    const text = query.sort === 'model' ? asset.model : query.sort === 'owner' ? asset.ownerName : query.sort === 'borrower' ? asset.borrowerName : asset.firstUsedOn;
    if (!text?.trim()) return null;
    return query.sort === 'service' ? isDateOnly(text) ? Date.parse(text + 'T00:00:00Z') : null : text;
  };
  return [...assets].sort((a, b) => {
    const av = value(a), bv = value(b);
    if (av === null && bv !== null) return 1;
    if (bv === null && av !== null) return -1;
    const primary = av === null || bv === null ? 0 : typeof av === 'number' && typeof bv === 'number' ? av - bv : collator.compare(String(av), String(bv));
    return primary ? primary * (query.direction === 'asc' ? 1 : -1) : collator.compare(a.id, b.id) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  });
}
export function queryInventory(assets: readonly SharedBattery[], query: InventoryQuery, asOf: string, context?: InventoryQueryContext) {
  const error = filterError(query.filter) ?? mappingScopeError(context?.mappingScope, context?.rooms ?? []);
  const matching = error ? [] : filteredAssets(assets, query.filter, asOf, query.personalScope ?? 'all', query.newArrivalsOnly ?? false, context);
  const counts = { all: matching.length, store: matching.filter(asset => asset.lifecycleStatus === 'active' && !asset.loanId).length, use: matching.filter(asset => asset.lifecycleStatus === 'active' && !!asset.loanId).length };
  const selectedStatus = matching.filter(asset => query.status === 'all' || asset.lifecycleStatus === 'active' && (query.status === 'use' ? !!asset.loanId : !asset.loanId));
  const sorted = sortRows(selectedStatus, query, sydneyDate(asOf) ?? '');
  const pages = Math.max(1, Math.ceil(sorted.length / query.pageSize));
  const page = Math.min(Math.max(0, query.page), pages - 1);
  return { counts, sorted, page, pages, pageRows: sorted.slice(page * query.pageSize, (page + 1) * query.pageSize), error };
}
export interface FilterOption { value: string; label: string }
export function optionsFor(assets: readonly SharedBattery[], valueOf: (asset: SharedBattery) => string | null, labelOf: (asset: SharedBattery) => string | null): FilterOption[] {
  const options = new Map<string, string>();
  for (const asset of assets) { const value = valueOf(asset); if (value) options.set(value, labelOf(asset) || value); }
  return [...options].map(([value, label]) => ({ value, label })).sort((a, b) => collator.compare(a.label, b.label) || collator.compare(a.value, b.value));
}

const shortText = z.string().max(256);
export const workstationQuerySchema = z.object({
  status: z.enum(['all', 'store', 'use']), sort: z.enum(sortKeys),
  personalScope: z.enum(['all', 'responsible', 'borrowed']).default('all'), newArrivalsOnly: z.boolean().default(false),
  direction: z.enum(['asc', 'desc']), page: z.number().int().min(0).max(1_000_000), pageSize: z.union([z.literal(10), z.literal(25), z.literal(50), z.literal(100)]),
  filter: z.object({ search: shortText, model: shortText, chemistry: shortText, owner: shortText, borrower: shortText, building: shortText, room: shortText, observedRoom: shortText,
    lifecycle: z.enum(['active', 'all', 'scrapped', 'permanently_removed']), ageKind: z.enum(['service', 'manufacture']), ageKnown: z.enum(['', 'known', 'unknown']), minAgeDays: z.string().max(32), maxAgeDays: z.string().max(32),
    // Version 1 views stored owner account IDs. New views explicitly select directory IDs.
    ownerReference: z.enum(['directory', 'account']).default('account'),
    capacityMode: z.enum(['any', 'known', 'unknown']).default('any'), capacityMinMah: z.string().max(32).default(''), capacityMaxMah: z.string().max(32).default(''),
    voltageMode: z.enum(['any', 'known', 'unknown']).default('any'), voltageMin: z.string().max(32).default(''), voltageMax: z.string().max(32).default(''),
    checkoutMode: z.enum(['any', 'known', 'unknown']).default('any'), checkoutFrom: z.string().max(32).default(''), checkoutTo: z.string().max(32).default(''),
    chargeMode: z.enum(['any', 'known', 'unknown']).default('any'), chargeFrom: z.string().max(32).default(''), chargeTo: z.string().max(32).default(''),
  }).strict(),
}).strict().superRefine((query, context) => { const error = filterError(query.filter); if (error) context.addIssue({code:'custom',message:error}); });
