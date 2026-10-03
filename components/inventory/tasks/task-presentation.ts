import type { InventorySnapshot } from "@/lib/domain";
import type { TaskCycleRecord } from "@/lib/task-plans";
import { type TaskPlan } from "@/lib/task-schedule";
import { currentSydneyDate } from "@/lib/battery-age";
import { staffIdentityLabel } from "@/lib/client-utils";

export const taskCategoryLabels: Record<TaskPlan["category"], string> = {
  storage_review: "Storage area review",
  inventory_reconciliation: "Inventory reconciliation",
  storage_maintenance: "Storage maintenance review",
};

export const targetLabels: Record<TaskPlan["targetKind"], string> = {
  inventory: "Defined inventory",
  storage_area: "Storage area",
  model: "Battery model",
  group: "Defined group",
  batteries: "Selected batteries",
};

export function targetSummary(
  target: Pick<TaskPlan, "targetKind" | "targetRef" | "batteryIds">,
  data: InventorySnapshot,
) {
  if (target.targetKind === "batteries")
    return `${target.batteryIds.length} selected ${target.batteryIds.length === 1 ? "battery" : "batteries"}`;
  if (target.targetKind === "storage_area")
    return (
      data.rooms.find((room) => room.id === target.targetRef)?.name ??
      target.targetRef ??
      "Area not selected"
    );
  return target.targetRef || targetLabels[target.targetKind];
}

export function assignmentNames(ids: string[], data: InventorySnapshot) {
  return (
    ids
      .map((id) => {
        const person = data.staffDirectory.find((staff) => staff.id === id);
        return staffIdentityLabel(
          person?.displayName || "Unavailable staff account",
          person?.username,
          id,
        );
      })
      .join(", ") || "Not assigned"
  );
}

export function cycleState(cycle: TaskCycleRecord) {
  return cycle.status === "completed"
    ? "Completed"
    : cycle.dueOn < currentSydneyDate()
      ? "Open · overdue"
      : "Open";
}

export function reminderLimitation(status: string) {
  return status === "ambiguous"
    ? "Reminder time is ambiguous during Sydney daylight saving; review the plan."
    : status === "nonexistent"
      ? "Reminder time does not exist during Sydney daylight saving; review the plan."
      : status === "unconfigured"
        ? "Reminder date or time is not configured."
        : null;
}
