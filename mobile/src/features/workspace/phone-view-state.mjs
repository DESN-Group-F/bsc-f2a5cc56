export function workspaceStateKey(accountId, dataset, view) {
  if (!accountId || !['demo', 'live'].includes(dataset) || !view) throw new Error('A workspace view needs its account and inventory context.');
  return JSON.stringify([accountId, dataset, view]);
}
