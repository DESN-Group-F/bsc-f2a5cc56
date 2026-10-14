"use client";
import { useCallback, useSyncExternalStore } from "react";
import { discoverLocationAttempts } from "../lib/client/location-request.js";
const empty = JSON.stringify({ attempts: [], error: "" });
function subscribe(changed) {
    for (const event of ["storage", "focus", "battery-location-recovery"])
        window.addEventListener(event, changed);
    return () => { for (const event of ["storage", "focus", "battery-location-recovery"])
        window.removeEventListener(event, changed); };
}
export function useLocationRecovery(accountId) {
    const read = useCallback(() => {
        try {
            return { attempts: discoverLocationAttempts(accountId), error: "" };
        }
        catch (failure) {
            return { attempts: [], error: failure.message };
        }
    }, [accountId]);
    const snapshot = useCallback(() => JSON.stringify(read()), [read]);
    const serialized = useSyncExternalStore(subscribe, snapshot, () => empty);
    return { recovery: JSON.parse(serialized), read };
}
