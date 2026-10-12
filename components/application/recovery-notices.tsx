import { Button } from "@/components/ui/button";
import { DownloadAction } from "@/components/ui/download-action";
import { useDownloadFeedback } from "@/hooks/use-download-feedback";
import type { Dataset } from "@/lib/domain";
import type {
  RecoveryState,
  PendingDataset,
  PendingMovement,
} from "@/lib/client/workflow-recovery";

export function RecoveryStorageNotice({ message, onExport }: { message: string; onExport: () => void }) {
  const feedback = useDownloadFeedback(message);
  return <div className="load-error" role="alert">
    <div><strong>Retained workflow data could not be read</strong><p>{message}</p><p>New workflows are blocked until recovery is readable. Export keeps the original data unchanged.</p></div>
    <DownloadAction pending={feedback.busy} completion={feedback.completion} reviewKey={message} actionLabel="Export retained workflow data" onClick={() => feedback.run(async () => { onExport(); })}>Export retained workflow data</DownloadAction>
    {feedback.error && <p className="form-error">{feedback.error}</p>}
  </div>;
}

type Props = {
  recovery: RecoveryState;
  movementOpen: boolean;
  assetsOpen: boolean;
  retiredHistoryOpen: boolean;
  currentDataset: Dataset;
  groupOpen: boolean;
  ready: boolean;
  modalOpen: boolean;
  resumeScan: (pending: PendingMovement) => void;
  resumeMovement: (pending: PendingMovement) => void;
  resumeRemoval: (pending: PendingDataset) => void;
  resumeRetiredAction: (pending: PendingDataset) => void;
  startIntake: () => void;
  resumeGroupChange: (pending: PendingDataset) => void;
};

export function RecoveryNotices({
  recovery,
  movementOpen,
  assetsOpen,
  retiredHistoryOpen,
  currentDataset,
  groupOpen,
  ready,
  modalOpen,
  resumeScan,
  resumeMovement,
  resumeRemoval,
  resumeRetiredAction,
  startIntake,
  resumeGroupChange,
}: Props) {
  const {
    scans: pendingScans,
    movements: pendingMovements,
    removals: pendingRemovals,
    retiredActions: pendingRetiredActions,
    intakes: pendingIntakes,
    groups: pendingGroupChanges,
  } = recovery;
  const visibleRetiredActions = pendingRetiredActions?.filter(pending => !retiredHistoryOpen || pending.dataset !== currentDataset) ?? [];
  return (
    <>
      {!!visibleRetiredActions.length && (
        <div className="scan-resume-notice" role="status">
          <div><strong>Unfinished recovery or permanent deletion</strong><p>Resolve the original retired battery request before starting another workflow.</p></div>
          {visibleRetiredActions.map(pending => <Button key={pending.dataset} variant="outline" onClick={() => resumeRetiredAction(pending)} disabled={!ready || modalOpen}>Resume retired battery action · {pending.dataset === "demo" ? "Demonstration" : "Working"}</Button>)}
        </div>
      )}
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
