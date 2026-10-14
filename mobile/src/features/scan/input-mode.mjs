/** Fresh entry selects NFC; captured queues keep their original acquisition source. */
export function scanInputMode(session, initialIds = []) {
  const first = session?.queue?.[0];
  if (!first) return initialIds.length ? 'selection' : 'native';
  const acquisition = first.acquisition || ({ native_nfc: 'native-nfc-reader', selection: 'selection', simulated: 'simulated' })[first.source] || 'tag';
  return ({ 'native-nfc-reader': 'native', selection: 'selection', simulated: 'simulated', tag: 'tag' })[acquisition] || 'native';
}

export function removalEntrySource(draft, initialIds = [], restored = false) {
  return restored || draft.items.length || initialIds.length ? draft.source : 'native_nfc';
}
