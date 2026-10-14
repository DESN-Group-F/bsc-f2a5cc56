/** Keep an explicit inventory handoff in view without changing eligibility or
 * moving rows whenever a checkbox changes. Search still owns which rows exist. */
export function prioritizeInventoryHandoff(candidates, initialIds = []) {
  if (!initialIds.length || !candidates.length) return candidates;
  const initial = new Set(initialIds);
  const focused = [], remaining = [];
  for (const battery of candidates) (initial.has(battery.id) ? focused : remaining).push(battery);
  return focused.length ? [...focused, ...remaining] : candidates;
}
