"use client";

import { useCallback, useSyncExternalStore } from "react";
import {
  emptyRecoveryState,
  readWorkflowRecovery,
  type RecoveryState,
} from "@/lib/client/workflow-recovery";

const events = [
  "storage",
  "focus",
  "battery-movement-recovery",
  "battery-intake-recovery",
  "battery-lifecycle-recovery",
  "battery-group-maintenance-recovery",
];
function subscribe(onChange: () => void) {
  for (const event of events) window.addEventListener(event, onChange);
  return () => {
    for (const event of events) window.removeEventListener(event, onChange);
  };
}
const serverSnapshot = JSON.stringify(emptyRecoveryState());

export function useWorkflowRecovery(accountId: string) {
  const read = useCallback(
    () => readWorkflowRecovery(sessionStorage, accountId),
    [accountId],
  );
  const snapshot = useCallback(() => {
    try {
      return JSON.stringify({ recovery: read(), unavailable: false });
    } catch {
      return JSON.stringify({
        recovery: emptyRecoveryState(),
        unavailable: true,
      });
    }
  }, [read]);
  const serialized = useSyncExternalStore(
    subscribe,
    snapshot,
    () => `{"recovery":${serverSnapshot},"unavailable":false}`,
  );
  const { recovery, unavailable } = JSON.parse(serialized) as {
    recovery: RecoveryState;
    unavailable: boolean;
  };
  return { recovery, unavailable, read };
}
