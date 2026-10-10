"use client";

import { useCallback, useSyncExternalStore } from "react";
import { discoverLocationAttempts, type LocationAttempt } from "@/lib/client/location-request";

type Recovery = { attempts: LocationAttempt[]; error: string };
const empty = JSON.stringify({ attempts: [], error: "" });
function subscribe(changed: () => void) {
  for (const event of ["storage", "focus", "battery-location-recovery"]) window.addEventListener(event, changed);
  return () => { for (const event of ["storage", "focus", "battery-location-recovery"]) window.removeEventListener(event, changed); };
}

export function useLocationRecovery(accountId: string) {
  const read = useCallback((): Recovery => {
    try { return { attempts: discoverLocationAttempts(accountId), error: "" }; }
    catch (failure) { return { attempts: [], error: (failure as Error).message }; }
  }, [accountId]);
  const snapshot = useCallback(() => JSON.stringify(read()), [read]);
  const serialized = useSyncExternalStore(subscribe, snapshot, () => empty);
  return { recovery: JSON.parse(serialized) as Recovery, read };
}
