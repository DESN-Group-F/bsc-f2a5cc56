"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import type { InventorySnapshot } from "@/lib/domain";
import type { TaskPlanRecord } from "@/lib/task-plans";
import {
  taskRequest,
  type RequestError,
  type TaskPlansResponse,
} from "@/lib/client/task-api";
import {
  captureTaskRecordAction,
  saveTaskRecordAction,
  clearTaskRecordAction,
  taskRecordActionFinallyRejected,
  verifyTaskRecordActionReceipt,
  type TaskRecordAction,
} from "@/lib/client/task-record-action";

export function TaskPlanRemovalDialog({
  original,
  data,
  onClose,
  onSaved,
}: {
  original: TaskPlanRecord;
  data: InventorySnapshot;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [reviewed, setReviewed] = useState(original);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [latest, setLatest] = useState<TaskPlanRecord | null>(null);
  const attempt = useRef<TaskRecordAction | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const action = original.removedAt ? "restore" : "remove";
  const restoring = action === "restore";
  const applicable = restoring ? !!reviewed.removedAt : !reviewed.removedAt;
  const locked = busy || uncertain;

  async function save() {
    if (busy || conflict || !applicable || data.user.role !== "admin") return;
    attempt.current ??= captureTaskRecordAction(data.dataset, action, reviewed);
    const input = attempt.current;
    try {
      saveTaskRecordAction("plans", data.user.id, input);
    } catch (error) {
      setError(
        `The request could not be preserved. No change was sent. ${(error as Error).message}`,
      );
      return;
    }
    setBusy(true);
    setError("");
    try {
      const body = await taskRequest<{ result: unknown }>("/api/task-plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      verifyTaskRecordActionReceipt(body.result, input, data.user.id);
      clearTaskRecordAction("plans", data.user.id, input);
      setUncertain(false);
      if (mounted.current) await onSaved();
    } catch (error) {
      const status = (error as RequestError).status;
      setError((error as Error).message);
      const rejected = taskRecordActionFinallyRejected(error);
      setUncertain(!rejected);
      setConflict(rejected && status === 409);
      if (rejected) {
        try {
          clearTaskRecordAction("plans", data.user.id, input);
        } catch (storageFailure) {
          setUncertain(true);
          setConflict(false);
          setError((storageFailure as Error).message);
        }
      }
    } finally {
      setBusy(false);
    }
  }

  async function loadLatest() {
    setBusy(true);
    try {
      const response = await taskRequest<TaskPlansResponse>(
        `/api/task-plans?dataset=${data.dataset}&visibility=all`,
      );
      const found = response.plans.find((plan) => plan.id === reviewed.id);
      if (!found)
        throw new Error(
          "This plan is unavailable. Close this review and refresh task records.",
        );
      setLatest(found);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !locked) onClose();
      }}
    >
      <DialogContent
        className="record-dialog"
        showCloseButton={!locked}
        onEscapeKeyDown={(event) => {
          if (locked) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (locked) event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>
            {restoring ? "Restore recurring plan" : "Remove recurring plan"}
          </DialogTitle>
          <DialogDescription>{reviewed.title}</DialogDescription>
        </DialogHeader>
        <div className="detail-card">
          <p>
            {restoring
              ? `Restore this plan with its previous ${reviewed.state} status. Its original pending tasks become available again.`
              : "Move this shared plan to Removed. It will stop generating tasks and reminders, and its pending tasks cannot be completed while the plan is removed."}
          </p>
          <p>
            {restoring
              ? "An active plan can generate due tasks and reminders when the system is next used. Paused and draft plans retain those states."
              : "An administrator can restore the plan later. This affects all staff assigned to it."}
          </p>
          <p>
            Existing messages, deadlines and completion history are retained. No
            task is recorded as completed by this action.
          </p>
        </div>
        {!applicable && (
          <p className="field-hint" role="status">
            This plan is already {restoring ? "current" : "removed"}. Close this
            review and refresh task records.
          </p>
        )}
        {error && (
          <div role="alert">
            <p className="form-error">{error}</p>
            {uncertain && (
              <p className="field-hint">
                The result has not been confirmed. Keep this review open and
                retry the original request.
              </p>
            )}
            {conflict && (
              <Button variant="outline" onClick={loadLatest} disabled={busy}>
                Load latest plan state
              </Button>
            )}
          </div>
        )}
        {latest && (
          <div className="detail-card">
            <p>
              {latest.title} · {latest.removedAt ? "Removed" : latest.state}
            </p>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                setReviewed(latest);
                setLatest(null);
                setConflict(false);
                setUncertain(false);
                setError("");
                attempt.current = null;
              }}
            >
              Accept reviewed plan state
            </Button>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" disabled={locked} onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant={restoring ? "default" : "destructive"}
            onClick={save}
            disabled={
              busy || conflict || !applicable || data.user.role !== "admin"
            }
          >
            {busy
              ? "Saving…"
              : uncertain
                ? `Retry original ${restoring ? "restoration" : "removal"}`
                : restoring
                  ? "Restore plan"
                  : "Remove plan"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
