"use client";

import { useRef, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import type { InventorySnapshot } from "@/lib/domain";
import type { TaskCycleRecord } from "@/lib/task-plans";
import { formatDateOnly, formatTime } from "@/lib/client-utils";
import {
  taskRequest,
  type TaskPlansResponse,
  type RequestError,
} from "@/lib/client/task-api";
import {
  assignmentNames,
  taskCategoryLabels,
  targetSummary,
  cycleState,
  reminderLimitation,
} from "./task-presentation";

export function TaskCycleDialog({
  cycle,
  data,
  onClose,
  onSaved,
  onDetail,
}: {
  cycle: TaskCycleRecord;
  data: InventorySnapshot;
  onClose: () => void;
  onSaved: () => Promise<void>;
  onDetail?: (batteryId: string) => void;
}) {
  const [reviewed, setReviewed] = useState(cycle),
    [notes, setNotes] = useState(""),
    [confirmed, setConfirmed] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [conflict, setConflict] = useState(false),
    [uncertain, setUncertain] = useState(false),
    [latest, setLatest] = useState<TaskCycleRecord | null>(null);
  const attempt = useRef({ signature: "", requestId: "" });
  const snapshotBatteries = Array.isArray(reviewed.targetSnapshot.batteries)
    ? reviewed.targetSnapshot.batteries.flatMap((item) =>
        item &&
        typeof item === "object" &&
        "id" in item &&
        typeof item.id === "string"
          ? [
              {
                id: item.id,
                name:
                  "name" in item && typeof item.name === "string"
                    ? item.name
                    : "",
              },
            ]
          : [],
      )
    : reviewed.batteryIds.map((id) => ({ id, name: "" }));
  const room = reviewed.targetSnapshot.room;
  const recordedTarget =
    room &&
    typeof room === "object" &&
    "name" in room &&
    typeof room.name === "string"
      ? room.name
      : targetSummary(reviewed, data);
  async function complete() {
    if (
      busy ||
      conflict ||
      !confirmed ||
      !reviewed.canComplete ||
      reviewed.planRemoved
    )
      return;
    setBusy(true);
    setError("");
    try {
      const input = {
        dataset: data.dataset,
        action: "complete",
        payload: {
          cycleId: reviewed.id,
          expectedVersion: reviewed.version,
          notes,
        },
      };
      const signature = JSON.stringify(input);
      if (attempt.current.signature !== signature)
        attempt.current = { signature, requestId: crypto.randomUUID() };
      await taskRequest("/api/task-plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...input,
          requestId: attempt.current.requestId,
        }),
      });
      await onSaved();
    } catch (error) {
      setError((error as Error).message);
      const status = (error as RequestError).status;
      setUncertain(!status || status >= 500 || status < 400);
      if (status === 409) setConflict(true);
    } finally {
      setBusy(false);
    }
  }
  async function reload() {
    setBusy(true);
    try {
      const body = await taskRequest<TaskPlansResponse>(
        `/api/task-plans?dataset=${data.dataset}&visibility=all`,
      );
      const found = body.cycles.find((item) => item.id === reviewed.id);
      if (!found)
        throw new Error(
          "This recorded task is unavailable. Your notes are preserved.",
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
      onOpenChange={(open) => !open && !busy && !uncertain && onClose()}
    >
      <DialogContent
        className="record-dialog task-cycle-dialog"
        showCloseButton={!busy && !uncertain}
        onEscapeKeyDown={(event) => {
          if (busy || uncertain) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (busy || uncertain) event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>{reviewed.title}</DialogTitle>
          <DialogDescription>
            {taskCategoryLabels[reviewed.category]} ·{" "}
            {reviewed.status === "completed"
              ? "Completed"
              : reviewed.planRemoved
                ? "Plan removed"
                : cycleState(reviewed)}
          </DialogDescription>
        </DialogHeader>
        <div className="task-cycle-body">
          <div className="task-cycle-summary">
            <p>
              <strong>Due:</strong> {formatDateOnly(reviewed.dueOn)} ·{" "}
              <strong>Target:</strong> {recordedTarget}
            </p>
            <p>
              <strong>Assigned staff:</strong>{" "}
              {assignmentNames(reviewed.currentAssigneeIds, data)}
            </p>
          </div>
          {reviewed.status === "completed" ? (
            <div className="detail-card">
              <h3>
                <CheckCircle2 size={17} />
                Recorded completion
              </h3>
              <p>
                {formatTime(reviewed.completedAt)} · {reviewed.completedByName}
              </p>
              <p className="whitespace-pre-wrap">
                {reviewed.completionNotes || "No completion notes."}
              </p>
            </div>
          ) : reviewed.planRemoved ? (
            <p className="field-hint" role="status">
              This plan has been removed. Completion is unavailable until an
              administrator restores the plan. Existing task requirements and
              history are retained.
            </p>
          ) : reviewed.canComplete ? (
            <div className="form-stack">
              <div className="form-field">
                <Label htmlFor="task-completion-notes">
                  Completion notes (optional)
                </Label>
                <Textarea
                  id="task-completion-notes"
                  aria-describedby="task-completion-notes-hint"
                  value={notes}
                  onChange={(event) => {
                    if (busy || uncertain) return;
                    setNotes(event.target.value);
                    setConfirmed(false);
                  }}
                  maxLength={2000}
                  disabled={busy || uncertain}
                  placeholder="Add findings or follow-up actions, if needed."
                />
                <p id="task-completion-notes-hint" className="field-hint">
                  You can leave this blank. Maximum 2,000 characters.
                </p>
              </div>
              <label className="export-option">
                <Checkbox
                  checked={confirmed}
                  onCheckedChange={(value) => {
                    if (!busy && !uncertain) setConfirmed(value === true);
                  }}
                  disabled={busy || uncertain}
                />
                <span>
                  <strong>I have completed this task.</strong>
                  <small>
                    Completion records the actual task review; it is not a
                    battery safety certification.
                  </small>
                </span>
              </label>
              {!busy && !conflict && (
                <p className="field-hint" role="status">
                  {!confirmed
                    ? "Tick the confirmation above to enable Record completion. Editing notes clears this confirmation."
                    : "Ready to record completion."}
                </p>
              )}
            </div>
          ) : (
            <p className="field-hint">
              Only a currently assigned staff member or an administrator can
              record this task&apos;s completion.
            </p>
          )}
          <details className="detail-card task-requirements">
            <summary>Recorded task requirements and assets</summary>
            <p className="whitespace-pre-wrap">{reviewed.description}</p>
            <p>
              <strong>Basis:</strong> {reviewed.basis}
            </p>
            <p>
              <strong>Recorded target:</strong> {recordedTarget}
            </p>
            <p>
              <strong>Scope:</strong> {reviewed.scopeNote || recordedTarget}
            </p>
            <p>
              <strong>Assigned staff:</strong>{" "}
              {assignmentNames(reviewed.currentAssigneeIds, data)}
            </p>
            <p>
              <strong>Due:</strong> {formatDateOnly(reviewed.dueOn)} ·{" "}
              <strong>Reminder:</strong> {formatDateOnly(reviewed.reminderOn)}{" "}
              {reviewed.reminderTime || "time unavailable"} Sydney
            </p>
            {reminderLimitation(reviewed.reminderStatus) && (
              <p className="form-error">
                {reminderLimitation(reviewed.reminderStatus)}
              </p>
            )}
            {snapshotBatteries.length > 0 && (
              <>
                <p>Registered assets recorded when this cycle was created:</p>
                <div className="mt-3 flex max-h-44 flex-wrap gap-2 overflow-y-auto">
                  {snapshotBatteries.map(({ id, name }) =>
                    onDetail ? (
                      <Button
                        key={id}
                        variant="outline"
                        size="sm"
                        onClick={() => onDetail(id)}
                        disabled={busy || uncertain}
                        title={name}
                      >
                        {id}
                      </Button>
                    ) : (
                      <span key={id}>
                        {id}
                        {name ? ` · ${name}` : ""}
                      </span>
                    ),
                  )}
                </div>
              </>
            )}
          </details>
          {error && (
            <div>
              <p className="form-error" role="alert">
                {error}
              </p>
              {uncertain && (
                <p className="field-hint">
                  The result has not been confirmed. Your notes and original
                  request are locked; retry to confirm the recorded outcome.
                </p>
              )}
              {conflict && (
                <>
                  <p className="field-hint">
                    Your notes are preserved. Review the latest task state
                    before completing this cycle.
                  </p>
                  <Button
                    variant="outline"
                    onClick={reload}
                    disabled={busy || uncertain}
                  >
                    Load latest task state
                  </Button>
                </>
              )}
            </div>
          )}
          {latest && (
            <div className="detail-card">
              <h3>Latest recorded task state</h3>
              <p>
                {latest.title} · {cycleState(latest)} · due{" "}
                {formatDateOnly(latest.dueOn)}
              </p>
              <p>
                Assigned staff:{" "}
                {assignmentNames(latest.currentAssigneeIds, data)}
              </p>
              <Button
                variant="outline"
                onClick={() => {
                  setReviewed(latest);
                  setLatest(null);
                  setConflict(false);
                  setUncertain(false);
                  setConfirmed(false);
                  setError("");
                }}
                disabled={busy || uncertain}
              >
                Accept reviewed task state
              </Button>
            </div>
          )}
          <p className="field-hint">
            Marking a message as read does not complete this task. Recorded
            deadlines and prior completion evidence remain available.
          </p>
        </div>
        <DialogFooter className="task-cycle-footer">
          <Button
            variant="outline"
            onClick={onClose}
            disabled={busy || uncertain}
          >
            Close
          </Button>
          {reviewed.status !== "completed" &&
            !reviewed.planRemoved &&
            reviewed.canComplete && (
              <Button
                onClick={complete}
                disabled={busy || conflict || !confirmed}
              >
                {busy
                  ? "Saving…"
                  : uncertain
                    ? "Retry original completion"
                    : "Record completion"}
              </Button>
            )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
