export function captureDetailBoundary(data, accountId, id, context) {
  const scope = context?.kind ? structuredClone(context) : undefined;
  const groupId = context?.kind === 'group' ? context.id : context?.version ? context.id : null;
  if (!groupId) return { id, scope };
  const group = data.teachingGroups?.find(item => item.id === groupId && item.ownerAccountId === accountId && item.state === 'active');
  if (!group || context?.version && context.version !== group.version || !group.batteryIds.includes(id)) throw new Error('The reviewed teaching group or its membership changed. Reopen its current members before viewing this record.');
  return { id, scope, group: { id: group.id, version: group.version } };
}

export function verifyDetailBoundary(detail, data, accountId) {
  if (!detail?.group) return null;
  const group = data.teachingGroups?.find(item => item.id === detail.group.id && item.ownerAccountId === accountId && item.state === 'active');
  if (!group || group.version !== detail.group.version || !group.batteryIds.includes(detail.id)) throw new Error('The teaching group, version or membership changed. Operations and downloads from this detail are blocked. Return to the group and review its current members.');
  return detail.group;
}
