import type { Dataset } from "../domain";
import { groupMaintenanceKey } from "../group-maintenance";
import { recoverIntakeDraft } from "../intake-draft";
import { intakeStorageKey } from "../intake-session";
import { lifecycleStorageKey } from "../lifecycle-session";
import {
  movementStorageKey,
  recoverMovementAttempt,
} from "../movement-session";
import { recoverRemovalDraft, removalDraftStorageKey } from "../removal-draft";
import { recoverScanSession } from "../scan-session";

export type PendingDataset = { dataset: Dataset };
export type PendingMovement = PendingDataset & { kind: "checkout" | "return" };
export type RecoveryState = {
  groups: PendingDataset[];
  removals: PendingDataset[];
  intakes: PendingDataset[];
  movements: PendingMovement[];
  scans: PendingMovement[];
};
export type PendingWorkflow =
  | { type: "group" | "removal" | "intake"; pending: PendingDataset }
  | { type: "movement" | "scan"; pending: PendingMovement };
export type RecoveryStorage = Pick<Storage, "getItem">;

export function emptyRecoveryState(): RecoveryState {
  return { groups: [], removals: [], intakes: [], movements: [], scans: [] };
}

/** Read tab recovery without rewriting any captured transaction or draft. */
export function readWorkflowRecovery(
  storage: RecoveryStorage,
  accountId: string,
): RecoveryState {
  const result = emptyRecoveryState();
  for (const dataset of ["demo", "live"] as const) {
    if (storage.getItem(groupMaintenanceKey(accountId, dataset)))
      result.groups.push({ dataset });
    const removalAttempt = storage.getItem(
      lifecycleStorageKey(accountId, dataset),
    );
    const removalRaw = storage.getItem(
      removalDraftStorageKey(accountId, dataset),
    );
    const removal = recoverRemovalDraft(removalRaw, accountId, dataset);
    if (removalAttempt || (removalRaw && (!removal || removal.items.length)))
      result.removals.push({ dataset });
    for (const kind of ["checkout", "return"] as const) {
      if (
        recoverMovementAttempt(
          storage.getItem(movementStorageKey(accountId, dataset, kind)),
          accountId,
          dataset,
          kind,
        )
      ) {
        result.movements.push({ dataset, kind });
      }
      if (
        recoverScanSession(
          storage.getItem(`battery-scan:${accountId}:${dataset}:${kind}`),
          kind,
        )
      ) {
        result.scans.push({ dataset, kind });
      }
    }
  }
  const intake = recoverIntakeDraft(
    storage.getItem(intakeStorageKey(accountId, "demo")),
    accountId,
    "demo",
  );
  if (intake && (intake.entries.length || intake.attempt))
    result.intakes.push({ dataset: "demo" });
  return result;
}

/** All entry points use the same priority, including optional browser tools. */
export function nextPendingWorkflow(
  state: RecoveryState,
  exclude?: PendingWorkflow["type"],
): PendingWorkflow | null {
  if (exclude !== "group" && state.groups[0])
    return { type: "group", pending: state.groups[0] };
  if (exclude !== "removal" && state.removals[0])
    return { type: "removal", pending: state.removals[0] };
  if (exclude !== "intake" && state.intakes[0])
    return { type: "intake", pending: state.intakes[0] };
  if (exclude !== "movement" && state.movements[0])
    return { type: "movement", pending: state.movements[0] };
  if (exclude !== "scan" && state.scans[0])
    return { type: "scan", pending: state.scans[0] };
  return null;
}
