"use client";

import { useCallback, useSyncExternalStore } from "react";
import {
  emptyRecoveryState,
  readWorkflowRecovery,
  type RecoveryState,
  type RecoveryStorage,
} from "@/lib/client/workflow-recovery";
import { saveDownloadAttachment } from "@/lib/client-utils";
import { groupMaintenanceKey } from "@/lib/group-maintenance";
import { intakeStorageKey } from "@/lib/intake-session";
import { lifecycleStorageKey } from "@/lib/lifecycle-session";
import { movementStorageKey } from "@/lib/movement-session";
import { removalDraftStorageKey } from "@/lib/removal-draft";
import { retiredAssetStorageKey } from "@/lib/retired-asset-actions";

const events = [
  "storage",
  "focus",
  "battery-movement-recovery",
  "battery-intake-recovery",
  "battery-lifecycle-recovery",
  "battery-retired-action-recovery",
  "battery-group-maintenance-recovery",
];
function subscribe(onChange: () => void) {
  for (const event of events) window.addEventListener(event, onChange);
  return () => {
    for (const event of events) window.removeEventListener(event, onChange);
  };
}
const serverSnapshot = JSON.stringify(emptyRecoveryState());

/** Keep the raw values at this account's known workflow keys, including unreadable evidence. */
export function retainedWorkflowExport(storage: RecoveryStorage, accountId: string) {
  const records: { key: string; raw: string }[] = [];
  for (const dataset of ["demo", "live"] as const) {
    const keys = [
      groupMaintenanceKey(accountId, dataset),
      retiredAssetStorageKey(accountId, dataset),
      lifecycleStorageKey(accountId, dataset),
      removalDraftStorageKey(accountId, dataset),
      intakeStorageKey(accountId, dataset),
      ...(["checkout", "return"] as const).flatMap(kind => [
        movementStorageKey(accountId, dataset, kind),
        `battery-scan:${accountId}:${dataset}:${kind}`,
      ]),
    ];
    for (const key of keys) {
      const raw = storage.getItem(key);
      if (raw !== null) records.push({ key, raw });
    }
  }
  return { format: "battery-workflow-recovery", version: 1, accountId, exportedAt: new Date().toISOString(), records };
}

export function useWorkflowRecovery(accountId: string) {
  const read = useCallback(
    () => readWorkflowRecovery(sessionStorage, accountId),
    [accountId],
  );
  const snapshot = useCallback(() => {
    try {
      return JSON.stringify({ recovery: read(), unavailable: false, error: "" });
    } catch (error) {
      return JSON.stringify({
        recovery: emptyRecoveryState(),
        unavailable: true,
        error: error instanceof Error ? error.message : "Browser recovery data could not be read. Restore access before starting another workflow.",
      });
    }
  }, [read]);
  const serialized = useSyncExternalStore(
    subscribe,
    snapshot,
    () => `{"recovery":${serverSnapshot},"unavailable":false,"error":""}`,
  );
  const { recovery, unavailable, error } = JSON.parse(serialized) as {
    recovery: RecoveryState;
    unavailable: boolean;
    error: string;
  };
  const exportRetained = useCallback(() => {
    const evidence = retainedWorkflowExport(sessionStorage, accountId);
    saveDownloadAttachment({ blob: new Blob([JSON.stringify(evidence, null, 2)], { type: "application/json" }), filename: "battery-workflow-recovery.json" });
  }, [accountId]);
  return { recovery, unavailable, error, read, exportRetained };
}
