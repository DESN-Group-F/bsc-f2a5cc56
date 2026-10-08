const staffPermissions = Object.freeze({
    viewSharedInventory: true,
    registerBatteries: true,
    operateLoans: true,
    retireBatteries: true,
    createModels: true,
    manageOwnGroups: true,
    manageOwnMessages: true,
    editOwnAccount: true,
    manageAccounts: false,
    editBatteryRecords: false,
    manageDirectories: false,
    editModels: false,
    recordCharges: false,
    recordDemoObservations: false,
    correctLoans: false,
    manageTaskPlans: false,
    completeAnyTask: false,
});
const adminPermissions = Object.freeze({
    ...staffPermissions,
    manageAccounts: true,
    editBatteryRecords: true,
    manageDirectories: true,
    editModels: true,
    recordCharges: true,
    recordDemoObservations: true,
    correctLoans: true,
    manageTaskPlans: true,
    completeAnyTask: true,
});
const noPermissions = Object.freeze(Object.fromEntries(Object.keys(staffPermissions).map((key) => [key, false])));
// Controls presentation only. Server authorization, account identity, dataset,
// assignment and record-state checks remain authoritative for every request.
export function getRolePermissions(role) {
    if (role === "admin")
        return adminPermissions;
    if (role === "staff")
        return staffPermissions;
    return noPermissions;
}
