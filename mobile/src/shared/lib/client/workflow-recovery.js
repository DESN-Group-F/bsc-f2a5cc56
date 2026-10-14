import { groupMaintenanceKey } from "../group-maintenance.js";
import { recoverIntakeDraft } from "../intake-draft.js";
import { intakeStorageKey } from "../intake-session.js";
import { lifecycleStorageKey } from "../lifecycle-session.js";
import { movementStorageKey, recoverMovementAttempt, } from "../movement-session.js";
import { recoverRemovalDraft, removalDraftStorageKey } from "../removal-draft.js";
import { recoverScanSession } from "../scan-session.js";
import { retiredAssetStorageKey } from "../retired-asset-actions.js";
export function emptyRecoveryState() {
    return { groups: [], removals: [], retiredActions: [], intakes: [], movements: [], scans: [] };
}
/** Read tab recovery without rewriting any captured transaction or draft. */
export function readWorkflowRecovery(storage, accountId) {
    const result = emptyRecoveryState();
    for (const dataset of ["demo", "live"]) {
        if (storage.getItem(retiredAssetStorageKey(accountId, dataset)) !== null)
            result.retiredActions.push({ dataset });
        if (storage.getItem(groupMaintenanceKey(accountId, dataset)) !== null)
            result.groups.push({ dataset });
        const removalAttempt = storage.getItem(lifecycleStorageKey(accountId, dataset));
        const removalRaw = storage.getItem(removalDraftStorageKey(accountId, dataset));
        const removal = recoverRemovalDraft(removalRaw, accountId, dataset);
        if (removalRaw !== null && !removal)
            throw new Error(`The retained ${dataset} removal draft is unreadable or has a different account context. It has not been replaced.`);
        if (removalAttempt !== null || (removalRaw !== null && (!removal || removal.items.length)))
            result.removals.push({ dataset });
        for (const kind of ["checkout", "return"]) {
            const movementRaw = storage.getItem(movementStorageKey(accountId, dataset, kind));
            const movement = recoverMovementAttempt(movementRaw, accountId, dataset, kind);
            if (movementRaw !== null && !movement)
                throw new Error(`The retained ${dataset} ${kind} request is unreadable or has a different account context. Export recovery data before starting new work.`);
            if (movement) {
                result.movements.push({ dataset, kind });
            }
            const scanRaw = storage.getItem(`battery-scan:${accountId}:${dataset}:${kind}`);
            if (scanRaw !== null && !recoverScanSession(scanRaw, kind, true))
                throw new Error(`The retained ${dataset} ${kind} scan session is unreadable. The original data is preserved; new scanning is blocked.`);
            if (recoverScanSession(scanRaw, kind)) {
                result.scans.push({ dataset, kind });
            }
        }
    }
    const intakeRaw = storage.getItem(intakeStorageKey(accountId, "demo"));
    const intake = recoverIntakeDraft(intakeRaw, accountId, "demo");
    if (intakeRaw !== null && !intake)
        throw new Error("The retained intake draft is unreadable or has a different account context. It has not been replaced.");
    if (storage.getItem(intakeStorageKey(accountId, "live")) !== null)
        throw new Error("An unsupported working-inventory intake recovery key is retained. Export its evidence before starting new work.");
    if (intake && (intake.entries.length || intake.attempt))
        result.intakes.push({ dataset: "demo" });
    return result;
}
/** All entry points use the same priority, including optional browser tools. */
export function nextPendingWorkflow(state, exclude) {
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
