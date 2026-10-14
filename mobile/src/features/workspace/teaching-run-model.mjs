import { teachingCheckoutListedRunSchema } from '../../shared/lib/teaching-checkouts.js';

export function parseOwnTeachingRuns(payload, accountId, dataset) {
  if (!Array.isArray(payload?.runs)) throw new Error('The actual checkout response was incomplete. Refresh before preparing an operation.');
  return payload.runs.map(value => {
    const parsed = teachingCheckoutListedRunSchema.safeParse(value);
    if (!parsed.success || parsed.data.actorAccountId !== accountId || parsed.data.dataset !== dataset) throw new Error('Actual checkout evidence could not be validated for this account and inventory. Refresh before preparing an operation.');
    return parsed.data;
  });
}

export function teachingRunPresentation(run, group) {
  const currentMappings = run.currentMappings ?? run.mappings;
  const allMappings = [...run.mappings, ...(run.changes ?? []).flatMap(change => change.mappings)];
  const outstanding = run.items.filter(item => item.status === 'outstanding');
  const activeMappings = currentMappings.filter(mapping => outstanding.some(item => item.loanId === mapping.loanId && item.batteryId === mapping.actual.batteryId && !item.pendingReturn));
  const covered = new Set(activeMappings.flatMap(mapping => [mapping.original.batteryId, mapping.actual.batteryId]));
  const pendingMembers = new Set(outstanding.filter(item => item.pendingReturn).flatMap(item => {
    const originalId = item.originalBatteryId ?? allMappings.find(mapping => mapping.loanId === item.loanId && mapping.actual.batteryId === item.batteryId)?.original.batteryId;
    const current = currentMappings.find(mapping => mapping.original.batteryId === originalId);
    return [item.batteryId, ...(originalId ? [originalId] : []), ...(current ? [current.actual.batteryId] : [])];
  }));
  return {
    outstanding,
    pending: outstanding.filter(item => item.pendingReturn),
    missingIds: group?.batteryIds.filter(id => !covered.has(id) && !pendingMembers.has(id)) ?? [],
    blockedIds: group?.batteryIds.filter(id => !covered.has(id) && pendingMembers.has(id)) ?? [],
    items: run.items.map(item => {
      const mapping = allMappings.find(entry => entry.loanId === item.loanId && entry.actual.batteryId === item.batteryId);
      const originalId = item.originalBatteryId ?? mapping?.original.batteryId ?? item.batteryId;
      const current = currentMappings.some(entry => entry.loanId === item.loanId && entry.actual.batteryId === item.batteryId);
      const alternative = originalId !== item.batteryId;
      return { item, mapping, originalId, current, alternative, permanent: !!group?.batteryIds.includes(item.batteryId) && !group?.batteryIds.includes(originalId), canExchange: current && item.status === 'outstanding' && !item.pendingReturn };
    }),
  };
}

export function teachingRunMatches(run, groupId, search, outstandingOnly) {
  return run.teachingGroup.id === groupId && (!outstandingOnly || run.items.some(item => item.status === 'outstanding')) && `${run.teachingGroup.name} ${run.id} ${run.requestedBatteryIds.join(' ')} ${run.items.map(item => item.batteryId).join(' ')}`.toLowerCase().includes(search.trim().toLowerCase());
}
