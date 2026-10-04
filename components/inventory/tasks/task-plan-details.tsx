"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { InventorySnapshot } from "@/lib/domain";
import type { TaskPlanRecord } from "@/lib/task-plans";
import { formatDateOnly, formatTime } from "@/lib/client-utils";
import {
  assignmentNames,
  taskCategoryLabels,
  targetSummary,
} from "./task-presentation";

export function TaskPlanDetails({
  plan,
  data,
  onClose,
  onDetail,
}: {
  plan: TaskPlanRecord;
  data: InventorySnapshot;
  onClose: () => void;
  onDetail?: (batteryId: string) => void;
}) {
  const target = targetSummary(plan, data);
  const interval = `${plan.interval} ${plan.interval === 1 ? plan.unit.slice(0, -1) : plan.unit}`;
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="record-dialog task-cycle-dialog">
        <DialogHeader>
          <DialogTitle>{plan.title}</DialogTitle>
          <DialogDescription>
            Shared plan details · {taskCategoryLabels[plan.category]}
          </DialogDescription>
        </DialogHeader>
        <div className="task-cycle-body">
          <div className="task-cycle-summary">
            <p><strong>Status:</strong> {plan.removedAt ? "Removed" : plan.state === "active" ? "Active" : plan.state === "paused" ? "Paused" : "Draft"}</p>
            <p><strong>Target:</strong> {target}</p>
            <p><strong>Assigned staff:</strong> {assignmentNames(plan.assigneeIds, data)}</p>
          </div>
          <section className="detail-card">
            <h3>Requirements and scope</h3>
            <p className="whitespace-pre-wrap">{plan.description || "Task requirements have not been recorded."}</p>
            <p className="whitespace-pre-wrap"><strong>Scope:</strong> {plan.scopeNote || target}</p>
            <p className="whitespace-pre-wrap"><strong>Basis:</strong> {plan.basis || "Not recorded"}</p>
            <p><strong>Applicability:</strong> {plan.applicabilityConfirmed ? "Confirmed for this plan" : "Not yet confirmed"}</p>
          </section>
          <section className="detail-card">
            <h3>Schedule</h3>
            {plan.recurrenceBasis === "dates" ? (
              <p><strong>Selected dates:</strong> {plan.scheduledDates.length ? plan.scheduledDates.map(formatDateOnly).join("; ") : "Not configured"}</p>
            ) : (
              <>
                <p><strong>Repeat:</strong> {plan.recurrenceBasis === "completion" ? `${interval} after recorded completion` : `Every ${interval} from the first due date`}</p>
                <p><strong>First due:</strong> {formatDateOnly(plan.firstDueOn)}</p>
              </>
            )}
            <p><strong>Reminder:</strong> {plan.reminderDaysBefore === 0 ? "On the due date" : `${plan.reminderDaysBefore} days before the due date`} · {plan.reminderTime ? `${plan.reminderTime} Sydney` : "Time not selected"}</p>
            <p className="field-hint">
              {plan.removedAt
                ? "An administrator must restore this plan before its pending tasks can be completed. No new tasks or reminders are generated while removed."
                : plan.state === "paused"
                  ? "This plan is paused. Existing open tasks can still be completed by their assigned staff or an administrator; new tasks and reminders are paused."
                  : plan.state === "draft"
                    ? "This draft does not generate tasks or reminders until an administrator activates it."
                    : "Recorded cycles show the actual due dates and completion history. An administrator manages this schedule."}
            </p>
          </section>
          {plan.batteryIds.length > 0 && (
            <section className="detail-card">
              <h3>Selected batteries</h3>
              <div className="mt-3 flex max-h-44 flex-wrap gap-2 overflow-y-auto">
                {plan.batteryIds.map((id) => onDetail ? (
                  <Button key={id} variant="outline" size="sm" onClick={() => onDetail(id)}>{id}</Button>
                ) : <span key={id}>{id}</span>)}
              </div>
            </section>
          )}
          <p className="field-hint">Last updated {formatTime(plan.updatedAt)}. Completing a task records shared completion evidence; it is not a battery safety certification.</p>
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Close</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
