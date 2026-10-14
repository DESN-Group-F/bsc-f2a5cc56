export function isActiveBattery(battery) {
    return !!battery && (!battery.lifecycleStatus || battery.lifecycleStatus === "active");
}
export function batteryStatusLabel(battery) {
    return battery.lifecycleStatus === "scrapped" ? "Scrapped" : battery.lifecycleStatus === "permanently_removed" ? "Permanently removed" : battery.loanId ? "In use" : "In store";
}
