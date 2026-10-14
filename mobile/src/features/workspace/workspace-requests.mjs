import { clearTaskRecordAction, readTaskRecordAction, taskRecordActionStorageKey, verifyTaskRecordActionReceipt } from '../../shared/lib/client/task-record-action.js';

export async function acknowledgeMessageAction(storage, accountId, input, result) {
  verifyTaskRecordActionReceipt(result, input, accountId);
  const saved = readTaskRecordAction('messages', accountId, input.dataset);
  if (saved.error) throw new Error(saved.error);
  if (!saved.input || JSON.stringify(saved.input) !== JSON.stringify(input)) throw new Error('The retained message request changed. Preserve recovery data and resolve the original result.');
  if (typeof storage.transact === 'function') {
    await storage.transact(entries => { delete entries[taskRecordActionStorageKey('messages', accountId, input.dataset)]; });
  } else {
    clearTaskRecordAction('messages', accountId, input);
    await storage.flush?.();
  }
}

export function verifyMessageRead(result, messageId) {
  if (result?.id !== messageId || typeof result.readAt !== 'string' || !Number.isFinite(Date.parse(result.readAt))) {
    throw new Error('The message read result was incomplete. Retry opening this message to verify its recorded read state.');
  }
  return result.readAt;
}
