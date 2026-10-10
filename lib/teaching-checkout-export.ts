import type { ExportDocument } from "./exports";
import type { TeachingCheckoutListedRun } from "./teaching-checkouts";
import { actionNames } from "./client-utils";

/** Export immutable review evidence alongside the state of the exact recorded loans. */
export function createTeachingCheckoutExport(run: TeachingCheckoutListedRun, history?: { loans: Record<string, unknown>[]; events: Record<string, unknown>[] }): ExportDocument {
  return {
    metadata: { mode: "teaching_checkout", dataset: run.dataset, exported_at_utc: new Date().toISOString(), operator: null, runId: run.id, teachingGroup: run.teachingGroup, actorAccountId: run.actorAccountId, actorName: run.actorName, createdAtUtc: run.createdAt, consistency: history ? "Run, exact loan status and complete exact-loan history read in one D1 batch." : "Mapping and recorded loan status only; complete movement history was not supplied.", history_scope: "Actual loan IDs saved in this checkout, including returns and corrections. Later loans are separate and excluded. Permanently deleted asset evidence remains deleted.", note: "Temporary checkout mapping. Fixed group membership is unchanged. Storage is registered information, not a live location. Manual alternatives require the teacher's review; equivalent teaching suitability is not verified." },
    tables: {
      teaching_checkouts: [{ run_id: run.id, group_id: run.teachingGroup.id, group_version: run.teachingGroup.version, group_name: run.teachingGroup.name, group_owner_account_id: run.teachingGroup.ownerAccountId, borrower_account_id: run.actorAccountId, borrower_name: run.actorName, checked_out_at_utc: run.createdAt, requested_battery_ids: run.requestedBatteryIds, actual_battery_ids: run.teachingGroup.batteryIds, revision: run.revision ?? 1, separate_checkout_confirmed: run.separateCheckout ?? false, current_actual_battery_ids: (run.currentMappings ?? run.mappings).map(mapping => mapping.actual.batteryId), outstanding_loan_ids: run.items.filter(item => item.status === "outstanding").map(item => item.loanId) }],
      teaching_mappings: run.mappings.map(mapping => {
        const item = run.items.find(item => item.batteryId === mapping.actual.batteryId && item.loanId === mapping.loanId);
        const original = mapping.original, actual = mapping.actual;
        return { original_battery_id: original.batteryId, actual_battery_id: actual.batteryId, selection_method: mapping.method, input_source: mapping.source?.kind ?? "Deleted evidence", strict_specification_match: mapping.specificationMatch, specification_differences: mapping.differences, original_loan_id: mapping.originalLoanId, actual_loan_id: mapping.loanId, loan_origin: mapping.loanOrigin ?? "new", checked_out_at_utc: item?.checkedOutAt ?? null, exact_loan_status: item?.status ?? "deleted", returned_at_utc: item?.returnedAt ?? null, original_snapshot: original, actual_snapshot: actual, selection_evidence: mapping.source ?? null };
      }),
      teaching_evidence: [{ snapshot: run }],
      ...(run.changes?.length ? { teaching_changes: run.changes.map(change => ({ change_id: change.id, run_id: run.id, revision: change.revision, action: change.action, actor_account_id: change.actorAccountId, at_utc: change.at, outgoing: change.outgoing ?? null, mappings: change.mappings })), teaching_current_members: (run.currentMappings ?? run.mappings).map(mapping => ({ original_battery_id: mapping.original.batteryId, actual_battery_id: mapping.actual.batteryId, loan_id: mapping.loanId, loan_origin: mapping.loanOrigin ?? "new" })), teaching_loan_responsibilities: run.items.map(item => ({ original_battery_id: item.originalBatteryId ?? null, battery_id: item.batteryId, loan_id: item.loanId, status: item.status, pending_return: item.pendingReturn ?? false, checked_out_at_utc: item.checkedOutAt ?? null, returned_at_utc: item.returnedAt })) } : {}),
      ...(history ? { Loans: history.loans, Activity: history.events.map(event => ({ ...event, action_label: actionNames[String(event.action)] ?? String(event.action) })) } : {}),
    },
  };
}
