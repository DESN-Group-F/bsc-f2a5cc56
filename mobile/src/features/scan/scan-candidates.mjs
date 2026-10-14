import { isActiveBattery } from '../../shared/lib/battery-lifecycle.js';
import { scanScopeMatches } from './scan-controller.mjs';

export const emptyScanCandidates = Object.freeze([]);

/** A manual list projection only; staging still validates current controller authority. */
export function projectScanCandidates({ kind, data, accountId, scope, teachingGroup, queue, completed }) {
  const group = teachingGroup && data.teachingGroups?.find(value => value.id === teachingGroup.id && value.version === teachingGroup.version);
  if (teachingGroup && !group) return emptyScanCandidates;
  const members = group ? new Set(group.batteryIds) : null;
  const queued = new Set(queue.map(read => read.battery.id));
  const completedLoans = new Map();
  for (const { battery } of completed) {
    if (!completedLoans.has(battery.id)) completedLoans.set(battery.id, new Map());
    const versions = completedLoans.get(battery.id);
    if (!versions.has(battery.version)) versions.set(battery.version, new Set());
    versions.get(battery.version).add(battery.loanId);
  }
  return data.batteries.filter(battery => isActiveBattery(battery)
    && scanScopeMatches(scope, battery, data, accountId)
    && (kind === 'checkout' ? !battery.loanId : !!battery.loanId)
    && (!members || members.has(battery.id))
    && !queued.has(battery.id)
    && !completedLoans.get(battery.id)?.get(battery.version)?.has(battery.loanId));
}

export function filterScanCandidates(candidates, search) {
  if (!candidates.length) return candidates;
  const query = search.toLowerCase();
  return candidates.filter(battery => `${battery.id} ${battery.name} ${battery.tagId || ''} ${battery.borrowerName || ''}`.toLowerCase().includes(query));
}
