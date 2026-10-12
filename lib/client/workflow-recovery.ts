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
import { retiredAssetStorageKey } from "../retired-asset-actions";

export type PendingDataset = { dataset: Dataset };
export type PendingMovement = PendingDataset & { kind: "checkout" | "return" };
export type RecoveryState = {
  groups: PendingDataset[];
  removals: PendingDataset[];
  retiredActions: PendingDataset[];
  intakes: PendingDataset[];
  movements: PendingMovement[];
  scans: PendingMovement[];
};
export type PendingWorkflow =
  | { type: "group" | "removal" | "retired" | "intake"; pending: PendingDataset }
  | { type: "movement" | "scan"; pending: PendingMovement };
export type RecoveryStorage = Pick<Storage, "getItem">;

export function emptyRecoveryState(): RecoveryState {
  return { groups: [], removals: [], retiredActions: [], intakes: [], movements: [], scans: [] };
}

/** Read tab recovery without rewriting any captured transaction or draft. */
export function readWorkflowRecovery(
  storage: RecoveryStorage,
  accountId: string,
): RecoveryState {
  const result = emptyRecoveryState();
  for (const dataset of ["demo", "live"] as const) {
    if (storage.getItem(retiredAssetStorageKey(accountId, dataset)))
      result.retiredActions.push({ dataset });
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
      const movementRaw = storage.getItem(movementStorageKey(accountId, dataset, kind));
      const movement = recoverMovementAttempt(
          movementRaw,
          accountId,
          dataset,
          kind,
        );
      if (movementRaw !== null && !movement) throw new Error(`The retained ${dataset} ${kind} request is unreadable or has a different account context. Export recovery data before starting new work.`);
      if (movement) {
        result.movements.push({ dataset, kind });
      }
      const scanRaw = storage.getItem(`battery-scan:${accountId}:${dataset}:${kind}`);
      if (scanRaw !== null && !recoverScanSession(scanRaw, kind, true)) throw new Error(`The retained ${dataset} ${kind} scan session is unreadable. The original data is preserved; new scanning is blocked.`);
      if (recoverScanSession(scanRaw, kind)) {
        result.scans.push({ dataset, kind });
      }
    }
  }
  const intakeRaw = storage.getItem(intakeStorageKey(accountId, "demo"));
  const intake = recoverIntakeDraft(
    intakeRaw,
    accountId,
    "demo",
  );
  if (intakeRaw !== null && !intake) throw new Error("The retained intake draft is unreadable or has a different account context. It has not been replaced.");
  if (storage.getItem(intakeStorageKey(accountId, "live")) !== null) throw new Error("An unsupported working-inventory intake recovery key is retained. Export its evidence before starting new work.");
  if (intake && (intake.entries.length || intake.attempt))
    result.intakes.push({ dataset: "demo" });
  return result;
}

/** All entry points use the same priority, including optional browser tools. */
export function nextPendingWorkflow(
  state: RecoveryState,
  exclude?: PendingWorkflow["type"],
): PendingWorkflow | null {
  if (exclude !== "retired" && state.retiredActions?.[0])
    return { type: "retired", pending: state.retiredActions[0] };
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
