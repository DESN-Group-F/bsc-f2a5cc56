import { acknowledgeInspectionAttempt, inspectionFinallyRejected, readInspectionAttempt, verifyInspectionReceipt } from '../shared/components/inventory/inspection-request.js';

/** Resolve only the retained request. Missing assets never create replacement records or new inputs. */
export async function resolveMissingInspection({ accountId,dataset,batteryId,storage,expectedInput,write,acknowledge = acknowledgeInspectionAttempt }) {
  const saved = readInspectionAttempt(accountId,dataset,batteryId,storage);
  if (saved.error || !saved.input || JSON.stringify(saved.input) !== JSON.stringify(expectedInput)) throw new Error(saved.error || 'The original inspection request changed. Export the retained evidence and retry recovery.');
  await storage.flush?.();
  const durable = readInspectionAttempt(accountId,dataset,batteryId,storage);
  if (durable.error || JSON.stringify(durable.input) !== JSON.stringify(saved.input)) throw new Error(durable.error || 'The original inspection request changed before retry. Nothing was sent.');
  let result;
  try { result = await write(saved.input.action,saved.input.payload); }
  catch (failure) {
    if (!inspectionFinallyRejected(failure)) throw failure;
    await acknowledge(saved.input);
    return { outcome:'rejected',message:failure.message,input:saved.input };
  }
  verifyInspectionReceipt(result,saved.input);
  await acknowledge(saved.input);
  return { outcome:'confirmed',result,input:saved.input };
}
