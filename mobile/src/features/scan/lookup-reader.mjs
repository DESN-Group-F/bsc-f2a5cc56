import { createTeachingNfcBridge } from '../../business/teaching-nfc-bridge.mjs';

/** Ownership is checked at native invocation, after availability and durable-save awaits. */
export function createLookupReader({ adapter, storage, platform, current, beforeRead = () => Promise.resolve(), onReady = () => {}, onObserved, id, now }) {
  return createTeachingNfcBridge({ storage, platform, id, now, onObserved, adapter: {
    getAvailability: () => adapter.getAvailability(),
    cancel: () => adapter.cancel(),
    async read(options) {
      await beforeRead();
      if (!current()) throw Object.assign(new Error('Lookup reading was paused before native acquisition.'), { code: 'CANCELLED' });
      const pending=adapter.read(options);
      onReady();
      return pending;
    },
  } });
}

export async function prepareLookupReader(options) {
  const [{ Capacitor }, { BatteryNfc }] = await Promise.all([import('@capacitor/core'), import('@battery-inventory/nfc')]);
  if (!options.current()) throw Object.assign(new Error('Lookup reader preparation was cancelled.'), { code: 'CANCELLED' });
  return createLookupReader({ ...options, platform: Capacitor.getPlatform(), adapter: BatteryNfc });
}
