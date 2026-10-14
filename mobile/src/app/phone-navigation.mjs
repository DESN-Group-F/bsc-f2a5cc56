export const PHONE_AREAS = Object.freeze(['scan','inventory','workspace','me']);
export function createPhoneNavigation(namespace) {
  let sequence = 0, revision = 0;
  const listeners = new Set(), records = new Map(), stacks = Object.fromEntries(PHONE_AREAS.map(area => [area, []]));
  let area = 'scan', snapshot;
  function record(target, values = {}) { const value = { key: `${namespace}:${target}:${++sequence}`, area: target, page: null, pageContext: {}, scope: null, detail: null, scroll: 0, trigger: null, ...values }; records.set(value.key,value); return value; }
  for (const target of PHONE_AREAS) stacks[target].push(record(target).key);
  function publish() { const current = records.get(stacks[area].at(-1)); snapshot = { namespace, area, current, revision: ++revision, routes: [...records.values()], stacks: Object.fromEntries(PHONE_AREAS.map(target => [target,[...stacks[target]]])) }; listeners.forEach(listener => listener()); }
  publish();
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    activate(target) { if (!PHONE_AREAS.includes(target) || target === area) return false; area = target; publish(); return true; },
    push(target, values, { returnToOrigin = false } = {}) { if (!PHONE_AREAS.includes(target)) throw new Error('Phone area unavailable.'); const origin = returnToOrigin && target !== area ? { area,key:stacks[area].at(-1) } : null, next = record(target,{ ...values,origin }); stacks[target].push(next.key); area = target; publish(); return next; },
    replace(values) { const current = records.get(stacks[area].at(-1)); records.set(current.key,{ ...current,...values }); publish(); },
    rememberScroll(key, position) { const route = records.get(key); if (route && Number.isFinite(position)) { route.scroll = Math.max(0,position); } },
    back() {
      if (stacks[area].length > 1) {
        const departing = records.get(stacks[area].pop()); records.delete(departing.key);
        if (departing.origin && records.has(departing.origin.key) && stacks[departing.origin.area].includes(departing.origin.key)) {
          const origin = stacks[departing.origin.area]; while (origin.at(-1) !== departing.origin.key) records.delete(origin.pop()); area = departing.origin.area;
        }
        publish(); return true;
      }
      if (area !== 'scan') { area = 'scan'; publish(); return true; } return false;
    },
    resetArea(target) { for (const key of stacks[target]) records.delete(key); stacks[target] = [record(target).key]; area = target; publish(); },
    routesFor(target) { return [...records.values()].filter(route => route.area === target); },
  };
}
