import React, { createContext, useCallback, useContext, useLayoutEffect, useMemo, useSyncExternalStore } from 'react';
import { useNewArrivals } from '../shared/hooks/use-new-arrivals.js';
import { createPhoneArrivalStore } from './phone-arrivals.mjs';

const ArrivalContext = createContext(null);
const EMPTY = createPhoneArrivalStore({ arrivals: undefined, acknowledge: undefined, pending: false, error: '' });
const subscribeInactive = () => () => {};

export function PhoneArrivalsProvider({ namespace, data, load, children }) {
  const arrivals = useNewArrivals(data, load);
  const presentation = data && namespace === `${data.user.id}:${data.dataset}` ? arrivals : EMPTY.getSnapshot();
  const store = useMemo(() => createPhoneArrivalStore(presentation), [namespace]);
  useLayoutEffect(() => { store.publish(presentation); }, [store, presentation]);
  // Clock ticks retain both the context identity and the parent's child elements.
  return <ArrivalContext.Provider value={store}>{children}</ArrivalContext.Provider>;
}

export function usePhoneArrivals(active = true) {
  const store = useContext(ArrivalContext) || EMPTY;
  const retained = useMemo(() => ({ value: store.getSnapshot() }), [store]);
  const getSnapshot = useCallback(() => active ? store.getSnapshot() : retained.value, [active, store, retained]);
  const value = useSyncExternalStore(active ? store.subscribe : subscribeInactive, getSnapshot, getSnapshot);
  if (active) retained.value = value;
  return value;
}
