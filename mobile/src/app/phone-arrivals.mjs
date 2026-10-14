/** Ephemeral arrival presentation only; the shared hook owns time and requests. */
export function createPhoneArrivalStore(initial) {
  let snapshot = initial;
  const listeners = new Set();
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    publish(next) {
      if (Object.is(snapshot, next)) return;
      snapshot = next;
      listeners.forEach(listener => listener());
    },
  };
}
