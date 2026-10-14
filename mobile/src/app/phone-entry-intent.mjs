const entryNames = { lookup:'lookup',checkout:'check out',return:'return',intake:'intake',manual_registration:'intake',registration:'intake',removal:'removal',retire:'removal' };
export function phoneEntryTitle(intent) { return intent.destination?.label||({lookup:'Scan to view',checkout:'Check out',return:'Return',intake:'Intake',manual_registration:'Intake',registration:'Intake',removal:'Removal',retire:'Removal'})[intent.kind] || 'Task'; }

/** Retain the clicked request, never a replacement inventory or transaction. */
export function capturePhoneEntryIntent({ kind,ids,context,separateCheckout,token,routeKey,trigger,readEpoch,requiresRead = false }) {
  return { kind,ids:structuredClone(ids),context:structuredClone(context),separateCheckout,token,routeKey,trigger,readEpoch,requiresRead,phase:'waiting',retrying:false };
}

export function phoneEntryMessage(intent) {
  const name = entryNames[intent.kind] || 'task';
  if(intent.destination)return `Opening ${intent.destination.label}…${intent.waitReason?' '+intent.waitReason:''}`;
  return intent.phase === 'failed' ? `Could not prepare ${name}. Retry or cancel.` : `Preparing ${name}…${intent.waitReason?' '+intent.waitReason:''}`;
}
