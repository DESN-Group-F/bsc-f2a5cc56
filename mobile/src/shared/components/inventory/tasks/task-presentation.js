import { currentSydneyDate } from "../../../lib/battery-age.js";
import { staffIdentityLabel } from "../../../lib/client-utils.js";
export const taskCategoryLabels = {
    custom: "Custom task",
    storage_review: "Storage area review",
    inventory_reconciliation: "Inventory reconciliation",
    storage_maintenance: "Storage maintenance review",
};
export const targetLabels = {
    inventory: "Defined inventory",
    storage_area: "Storage area",
    model: "Battery model",
    group: "Defined group",
    batteries: "Selected batteries",
};
export function targetSummary(target, data) {
    if (target.targetKind === "batteries")
        return `${target.batteryIds.length} selected ${target.batteryIds.length === 1 ? "battery" : "batteries"}`;
    if (target.targetKind === "storage_area")
        return (data.rooms.find((room) => room.id === target.targetRef)?.name ??
            target.targetRef ??
            "Area not selected");
    return target.targetRef || targetLabels[target.targetKind];
}
export function assignmentNames(ids, data) {
    return (ids
        .map((id) => {
        const person = data.staffDirectory.find((staff) => staff.id === id);
        return staffIdentityLabel(person?.displayName || "Unavailable staff account", person?.username, id);
    })
        .join(", ") || "Not assigned");
}
export function cycleState(cycle) {
    return cycle.status === "completed"
        ? "Completed"
        : cycle.dueOn < currentSydneyDate()
            ? "Open · overdue"
            : "Open";
}
export function reminderLimitation(status) {
    return status === "ambiguous"
        ? "Reminder time is ambiguous during Sydney daylight saving; review the plan."
        : status === "nonexistent"
            ? "Reminder time does not exist during Sydney daylight saving; review the plan."
            : status === "unconfigured"
                ? "Reminder date or time is not configured."
                : null;
}
