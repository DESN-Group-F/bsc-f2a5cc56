import test from 'node:test';
import assert from 'node:assert/strict';
import { actionableMessages, canOpenWorkspaceView, ownMessagesUrl, ownTeachingGroups, personalBatterySummary, teachingGroupSummary, workspaceEntries, workspaceView } from '../src/features/workspace/workspace-model.mjs';

test('Me distinguishes responsible account from active borrower identity and excludes retired assets', () => {
  const data = { batteries: [
    { id: 'A', lifecycleStatus: 'active', ownerAccountId: 'me', borrowerAccountId: 'other', loanId: 'loan-a' },
    { id: 'B', lifecycleStatus: 'active', ownerAccountId: 'other', borrowerAccountId: 'me', loanId: 'loan-b' },
    { id: 'C', lifecycleStatus: 'active', ownerAccountId: 'me', borrowerAccountId: null, loanId: null },
    { id: 'D', lifecycleStatus: 'scrapped', ownerAccountId: 'me', borrowerAccountId: 'me', loanId: null },
    { id: 'E', lifecycleStatus: 'active', ownerAccountId: 'other', borrowerAccountId: 'me', loanId: null, ownerName: 'me' },
    { id: 'F', lifecycleStatus: 'active', ownerAccountId: null, borrowerAccountId: null, loanId: 'historical', borrowerName: 'me' },
  ] };
  assert.deepEqual(personalBatterySummary(data, 'me'), { responsible: 2, borrowed: 1 });
  assert.deepEqual(personalBatterySummary(data, null), { responsible: 0, borrowed: 0 });
});

test('Workspace role entries retain full staff access while restricting account and record administration', () => {
  assert.deepEqual(workspaceEntries('staff').map(item => item.view), ['teaching-groups', 'task-plans', 'assets', 'activity', 'battery-records', 'directories']);
  assert.deepEqual(workspaceEntries('admin').map(item => item.view), ['teaching-groups', 'task-plans', 'assets', 'activity', 'battery-records', 'directories', 'accounts']);
  assert.deepEqual(workspaceEntries('unknown'), []);
  assert.equal(canOpenWorkspaceView('accounts', 'staff'), false);
  assert.equal(canOpenWorkspaceView('battery-records', 'staff'), true);
  assert.equal(canOpenWorkspaceView('manage', 'staff'), true, 'Legacy entry now resolves to a shared read-only register; permitted record actions still use role guards');
  assert.equal(canOpenWorkspaceView('directories', 'staff'), true);
  assert.equal(canOpenWorkspaceView('records', 'admin'), true);
  assert.equal(canOpenWorkspaceView('account', 'staff'), true);
  assert.equal(canOpenWorkspaceView('unknown', 'admin'), false);
  assert.equal(workspaceView('tasks'), 'task-plans');
});

test('Teaching summaries keep private default members distinct from current recorded loan states', () => {
  const group = { id: 'group', ownerAccountId: 'me', state: 'active', batteryIds: ['A', 'B', 'C', 'missing', 'A'] };
  const others = [{ ...group, id: 'other', ownerAccountId: 'other' }, { ...group, id: 'archived', state: 'archived' }];
  assert.deepEqual(ownTeachingGroups({ teachingGroups: [group, ...others] }, 'me'), [group]);
  assert.deepEqual(teachingGroupSummary(group, [
    { id: 'A', lifecycleStatus: 'active', loanId: null },
    { id: 'B', lifecycleStatus: 'active', loanId: 'current-loan' },
    { id: 'C', lifecycleStatus: 'scrapped', loanId: null },
    { id: 'alternative', lifecycleStatus: 'active', loanId: 'actual-alternative' },
  ]), { members: 3, inStore: 1, inUse: 1, retired: 1 });
});

test('To do uses actual eligible message cycles, preserves read status and ranks recorded deadlines', () => {
  const eligible = (id, dueOn, additions = {}) => ({ id, dueOn, title: id, taskStatus: 'open', readAt: null, cycle: { canComplete: true, planRemoved: false }, ...additions });
  const messages = [
    eligible('later', '2026-10-14'), eligible('first', '2026-10-10', { readAt: '2026-10-12T00:00:00.000Z' }),
    eligible('completed', '2026-10-01', { taskStatus: 'completed' }), eligible('removed', '2026-10-01', { removedAt: '2026-10-12T00:00:00.000Z' }),
    eligible('unassigned', '2026-10-01', { cycle: { canComplete: false } }), eligible('removed-plan', '2026-10-01', { cycle: { canComplete: true, planRemoved: true } }),
    eligible('second', '2026-10-12'), eligible('unknown-deadline', null),
  ];
  const before = structuredClone(messages);
  assert.deepEqual(actionableMessages(messages).map(message => message.id), ['first', 'second', 'later']);
  assert.deepEqual(messages, before);
  assert.deepEqual(actionableMessages(undefined), []);
  const url = new URL(ownMessagesUrl('live'), 'http://local.test');
  assert.equal(url.pathname, '/api/messages');
  assert.equal(url.searchParams.get('dataset'), 'live');
  assert.equal(url.searchParams.get('taskStatus'), 'open');
  assert.equal(url.searchParams.get('readState'), 'all');
  assert.equal(url.searchParams.has('recipientId'), false);
});
