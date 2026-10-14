import { isActiveBattery } from '../../shared/lib/battery-lifecycle.js';
import { getRolePermissions } from '../../shared/lib/permissions.js';

export function personalBatterySummary(data, accountId) {
  const active = (data?.batteries ?? []).filter(isActiveBattery);
  return {
    responsible: accountId ? active.filter(battery => battery.ownerAccountId === accountId).length : 0,
    borrowed: accountId ? active.filter(battery => !!battery.loanId && battery.borrowerAccountId === accountId).length : 0,
  };
}

export function ownTeachingGroups(data, accountId) {
  if (!accountId) return [];
  return (data?.teachingGroups ?? []).filter(group => group.ownerAccountId === accountId && group.state === 'active');
}

export function teachingGroupSummary(group, batteries = []) {
  const membership = new Set(group.batteryIds);
  const members = batteries.filter(battery => membership.has(battery.id));
  const active = members.filter(isActiveBattery);
  return {
    members: members.length,
    inStore: active.filter(battery => !battery.loanId).length,
    inUse: active.filter(battery => !!battery.loanId).length,
    retired: members.length - active.length,
  };
}

export function actionableMessages(messages, limit = 3) {
  if (!Array.isArray(messages)) return [];
  return messages.filter(message => !message.removedAt && message.taskStatus === 'open' && message.cycle?.canComplete && !message.cycle.planRemoved)
    .sort((first, second) => (first.dueOn ?? '9999-12-31').localeCompare(second.dueOn ?? '9999-12-31') || first.id.localeCompare(second.id))
    .slice(0, limit);
}

export function ownMessagesUrl(dataset) {
  return `/api/messages?${new URLSearchParams({ dataset, visibility: 'current', taskStatus: 'open', readState: 'all', search: '' })}`;
}

export function workspaceEntries(role) {
  const permission = getRolePermissions(role);
  if (!permission.viewSharedInventory) return [];
  return [
    { group: 'Daily work', view: 'teaching-groups', title: 'Teaching groups', description: 'Your saved members and actual checkout runs', icon: 'groups', accent: 'blue' },
    { group: 'Daily work', view: 'task-plans', title: 'Recurring tasks', description: 'Plans, deadlines and recorded completions', icon: 'tasks', accent: 'peach' },
    { group: 'Battery lifecycle', view: 'assets', title: 'Intake & removal', description: 'Register, retire or remove, and review history', icon: 'assets', accent: 'violet' },
    { group: 'Records and directories', view: 'activity', title: 'Activity history', description: 'Shared operations and their original evidence', icon: 'activity', accent: 'green' },
    { group: 'Records and directories', view: 'battery-records', title: 'Battery records', description: permission.editBatteryRecords ? 'Find, edit and download battery records' : 'Find battery records and complete histories', icon: 'records', accent: 'blue' },
    { group: 'Records and directories', view: 'directories', title: 'Directories', description: permission.manageDirectories ? 'Manage staff references, buildings and rooms' : 'Staff references, buildings and rooms', icon: 'records', accent: 'blue' },
    ...(permission.manageAccounts ? [{ group: 'Account administration', view: 'accounts', title: 'Staff accounts', description: 'Account access, roles and account history', icon: 'accounts', accent: 'peach' }] : []),
  ];
}

export function workspaceView(view) {
  return ({ tasks: 'task-plans', records: 'battery-records', manage: 'battery-records', 'my-account': 'account' })[view] ?? view;
}

export function canOpenWorkspaceView(view, role) {
  const permission = getRolePermissions(role);
  const target = workspaceView(view);
  if (!permission.viewSharedInventory) return false;
  if (target === 'accounts') return permission.manageAccounts;
  return ['teaching-groups', 'task-plans', 'assets', 'activity', 'my-activity', 'messages', 'account', 'directories', 'battery-records'].includes(target);
}

export function messageEntryScope(taskContext) {
  return taskContext === 'open'
    ? { key: 'my-tasks', visibility: 'current', taskStatus: 'open', readState: 'all', title: 'My tasks' }
    : { key: 'messages', visibility: 'current', taskStatus: 'all', readState: 'all', title: 'Messages' };
}
