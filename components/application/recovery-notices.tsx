import { Button } from "@/components/ui/button";
import type {
  RecoveryState,
  PendingDataset,
  PendingMovement,
} from "@/lib/client/workflow-recovery";

type Props = {
  recovery: RecoveryState;
  movementOpen: boolean;
  assetsOpen: boolean;
  groupOpen: boolean;
  ready: boolean;
  modalOpen: boolean;
  resumeScan: (pending: PendingMovement) => void;
  resumeMovement: (pending: PendingMovement) => void;
  resumeRemoval: (pending: PendingDataset) => void;
  startIntake: () => void;
  resumeGroupChange: (pending: PendingDataset) => void;
};

export function RecoveryNotices({
  recovery,
  movementOpen,
  assetsOpen,
  groupOpen,
  ready,
  modalOpen,
  resumeScan,
  resumeMovement,
  resumeRemoval,
  startIntake,
  resumeGroupChange,
}: Props) {
  const {
    scans: pendingScans,
    movements: pendingMovements,
    removals: pendingRemovals,
    intakes: pendingIntakes,
    groups: pendingGroupChanges,
  } = recovery;
  return (
    <>
      {!movementOpen && !!pendingScans.length && (
        <div className="scan-resume-notice" role="status">
          <div>
            <strong>Unfinished scanning session</strong>
            <p>
              Resume the captured queue or request before starting a new
              movement. Recovery is available in this browser tab.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {pendingScans.map((pending) => (
              <Button
                key={`${pending.dataset}-${pending.kind}`}
                variant="outline"
                onClick={() => resumeScan(pending)}
                disabled={!ready}
              >
                Resume {pending.kind === "checkout" ? "checkout" : "return"} ·{" "}
                {pending.dataset === "demo" ? "Demonstration" : "Working"}
              </Button>
            ))}
          </div>
        </div>
      )}
      {!movementOpen && !!pendingMovements.length && (
        <div className="scan-resume-notice" role="status">
          <div>
            <strong>Unfinished checkout or return</strong>
            <p>
              Resume the exact captured request before starting another
              movement. A lost response does not mean the operation failed.
              Recovery is available in this browser tab.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {pendingMovements.map((pending) => (
              <Button
                key={`${pending.dataset}-${pending.kind}`}
                variant="outline"
                onClick={() => resumeMovement(pending)}
                disabled={!ready}
              >
                Resume saved {pending.kind} ·{" "}
                {pending.dataset === "demo" ? "Demonstration" : "Working"}
              </Button>
            ))}
          </div>
        </div>
      )}
      {!movementOpen && !assetsOpen && !!pendingRemovals.length && (
        <div className="scan-resume-notice" role="status">
          <div>
            <strong>Unfinished retirement or removal</strong>
            <p>Resolve the preserved confirmation before another operation.</p>
          </div>
          {pendingRemovals.map((pending) => (
            <Button
              key={pending.dataset}
              variant="outline"
              onClick={() => resumeRemoval(pending)}
              disabled={!ready}
            >
              Resume removal ·{" "}
              {pending.dataset === "demo" ? "Demonstration" : "Working"}
            </Button>
          ))}
        </div>
      )}
      {!movementOpen && !!pendingIntakes.length && (
        <div className="scan-resume-notice" role="status">
          <div>
            <strong>Unfinished intake draft or confirmation</strong>
            <p>
              Your editable review queue or captured confirmation is preserved.
              Resume it before starting another movement.
            </p>
          </div>
          <Button variant="outline" onClick={startIntake} disabled={!ready}>
            Resume batch intake · demo
          </Button>
        </div>
      )}
      {!groupOpen && !!pendingGroupChanges.length && (
        <div className="scan-resume-notice">
          <div>
            <strong>Unfinished group update</strong>
            <p>
              Resolve the preserved operation before starting another workflow.
            </p>
          </div>
          {pendingGroupChanges.map((pending) => (
            <Button
              key={pending.dataset}
              variant="outline"
              disabled={!ready || modalOpen}
              onClick={() => resumeGroupChange(pending)}
            >
              Resume group update · {pending.dataset}
            </Button>
          ))}
        </div>
      )}
    </>
  );
}
