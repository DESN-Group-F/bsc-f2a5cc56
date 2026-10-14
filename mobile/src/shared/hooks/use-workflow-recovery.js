"use client";
import { useCallback, useSyncExternalStore } from "react";
import { emptyRecoveryState, readWorkflowRecovery, } from "../lib/client/workflow-recovery.js";
const events = [
    "storage",
    "focus",
    "battery-movement-recovery",
    "battery-intake-recovery",
    "battery-lifecycle-recovery",
    "battery-retired-action-recovery",
    "battery-group-maintenance-recovery",
];
function subscribe(onChange) {
    for (const event of events)
        window.addEventListener(event, onChange);
    return () => {
        for (const event of events)
            window.removeEventListener(event, onChange);
    };
}
const serverSnapshot = JSON.stringify(emptyRecoveryState());
export function useWorkflowRecovery(accountId) {
    const read = useCallback(() => readWorkflowRecovery(window.__batteryWorkflowStorage, accountId), [accountId]);
    const snapshot = useCallback(() => {
        try {
            return JSON.stringify({ recovery: read(), unavailable: false });
        }
        catch {
            return JSON.stringify({
                recovery: emptyRecoveryState(),
                unavailable: true,
            });
        }
    }, [read]);
    const serialized = useSyncExternalStore(subscribe, snapshot, () => `{"recovery":${serverSnapshot},"unavailable":false}`);
    const { recovery, unavailable } = JSON.parse(serialized);
    return { recovery, unavailable, read };
}
