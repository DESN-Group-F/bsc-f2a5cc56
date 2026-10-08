import type { StaffRole } from "./accounts";

const staffPermissions = Object.freeze({
  viewSharedInventory: true,
  registerBatteries: true,
  operateLoans: true,
  retireBatteries: true,
  recoverRetiredBatteries: true,
  purgeRetiredBatteries: false,
  recordInspections: true,
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
  correctInspections: false,
  manageTaskPlans: false,
  completeAnyTask: false,
});

export type RolePermissions = Readonly<{
  [Capability in keyof typeof staffPermissions]: boolean;
}>;

const adminPermissions: RolePermissions = Object.freeze({
  ...staffPermissions,
  purgeRetiredBatteries: true,
  manageAccounts: true,
  editBatteryRecords: true,
  manageDirectories: true,
  editModels: true,
  recordCharges: true,
  recordDemoObservations: true,
  correctLoans: true,
  correctInspections: true,
  manageTaskPlans: true,
  completeAnyTask: true,
});

const noPermissions: RolePermissions = Object.freeze(
  Object.fromEntries(Object.keys(staffPermissions).map((key) => [key, false])),
) as RolePermissions;

// Controls presentation only. Server authorization, account identity, dataset,
// assignment and record-state checks remain authoritative for every request.
export function getRolePermissions(role: StaffRole): RolePermissions {
  if (role === "admin") return adminPermissions;
  if (role === "staff") return staffPermissions;
  return noPermissions;
}
