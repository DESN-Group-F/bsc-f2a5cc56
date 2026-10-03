import { test } from "node:test";
import assert from "node:assert/strict";
import {
  readWorkflowRecovery,
  nextPendingWorkflow,
} from "../work/qa/client/workflow-recovery.mjs";
import {
  captureMovementAttempt,
  movementStorageKey,
} from "../work/qa/movement-session.mjs";
import { removalDraftStorageKey } from "../work/qa/removal-draft.mjs";
import { groupMaintenanceKey } from "../work/qa/group-maintenance.mjs";

const actor = "recovery-staff";
const storage = (entries) => {
  const values = new Map(entries);
  return { values, getItem: (key) => values.get(key) ?? null };
};

test("a saved group operation takes priority over a movement at every entry point without changing either request", () => {
  const movement = captureMovementAttempt(
    "return",
    [
      {
        id: "BAT-001",
        version: 3,
        loanId: "33333333-3333-4333-8333-333333333333",
        name: "Reviewed battery",
        ownerName: "Responsible staff",
        borrowerName: "Current holder",
        checkedOutAt: "2026-10-03T05:00:00.000Z",
      },
    ],
    actor,
    "demo",
    "22222222-2222-4222-8222-222222222222",
  );
  const saved = storage([
    [movementStorageKey(actor, "demo", "return"), JSON.stringify(movement)],
    [
      groupMaintenanceKey(actor, "live"),
      JSON.stringify({
        status: "uncertain",
        requestId: "original-group-request",
      }),
    ],
  ]);
  const before = [...saved.values];
  const pending = readWorkflowRecovery(saved, actor);
  assert.deepEqual(nextPendingWorkflow(pending), {
    type: "group",
    pending: { dataset: "live" },
  });
  assert.deepEqual(pending.movements, [{ dataset: "demo", kind: "return" }]);
  assert.deepEqual([...saved.values], before);
  assert.equal(
    nextPendingWorkflow(readWorkflowRecovery(saved, "another-staff")),
    null,
  );
  saved.values.delete(groupMaintenanceKey(actor, "live"));
  assert.deepEqual(nextPendingWorkflow(readWorkflowRecovery(saved, actor)), {
    type: "movement",
    pending: { dataset: "demo", kind: "return" },
  });
  assert.equal(
    JSON.parse(saved.values.get(movementStorageKey(actor, "demo", "return")))
      .payload.expectedLoans[0].loanId,
    "33333333-3333-4333-8333-333333333333",
  );
});

test("a damaged removal draft still blocks a new workflow while a valid empty queue does not", () => {
  const key = removalDraftStorageKey(actor, "demo");
  const saved = storage([[key, "incomplete JSON"]]);
  assert.deepEqual(nextPendingWorkflow(readWorkflowRecovery(saved, actor)), {
    type: "removal",
    pending: { dataset: "demo" },
  });
  saved.values.set(
    key,
    JSON.stringify({
      actorAccountId: actor,
      dataset: "demo",
      source: "manual_selection",
      kind: "scrapped",
      reason: "",
      destination: "",
      items: [],
      selectedIds: [],
    }),
  );
  assert.equal(nextPendingWorkflow(readWorkflowRecovery(saved, actor)), null);
});

test("resuming intake checks other captured workflows without recursively resuming itself", () => {
  const pending = {
    groups: [],
    removals: [],
    intakes: [{ dataset: "demo" }],
    movements: [{ dataset: "live", kind: "checkout" }],
    scans: [],
  };
  assert.equal(nextPendingWorkflow(pending).type, "intake");
  assert.deepEqual(nextPendingWorkflow(pending, "intake"), {
    type: "movement",
    pending: pending.movements[0],
  });
  pending.movements = [];
  assert.equal(nextPendingWorkflow(pending, "intake"), null);
});

test("unavailable browser storage cannot be mistaken for an empty recovery state", () => {
  const unavailable = {
    getItem() {
      throw new Error("Storage denied");
    },
  };
  assert.throws(
    () => readWorkflowRecovery(unavailable, actor),
    /Storage denied/,
  );
});
