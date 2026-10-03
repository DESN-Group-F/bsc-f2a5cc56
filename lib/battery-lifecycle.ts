import type { BatteryRecord } from "./domain";

export function isActiveBattery(battery: Pick<BatteryRecord, "lifecycleStatus"> | null | undefined) {
    return !!battery && (!battery.lifecycleStatus || battery.lifecycleStatus === "active");
}
export function batteryStatusLabel(battery: Pick<BatteryRecord, "lifecycleStatus" | "loanId">) {
    return battery.lifecycleStatus === "scrapped" ? "Scrapped" : battery.lifecycleStatus === "permanently_removed" ? "Permanently removed" : battery.loanId ? "In use" : "In store";
}
