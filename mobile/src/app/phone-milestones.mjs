/** Neutral, once-per-document diagnostics. Marks never gate UI or business readiness. */
export function markPhoneMilestone(name, target = globalThis.performance) {
  const key = 'phone:' + name;
  if (!target?.mark || target.getEntriesByName?.(key).length) return;
  target.mark(key);
}
