import { createTeachingNfcBridge } from '../../business/teaching-nfc-bridge.mjs';

/** Ownership is checked at native invocation, after availability and durable-save awaits. */
export function createLookupReader({ adapter, storage, platform, current, beforeRead = () => Promise.resolve(), onReady = () => {}, onObserved, id, now, continuation }) {
  const batch = platform === 'ios' ? continuation : null;
  const bridge = createTeachingNfcBridge({ storage, platform, id, now, onObserved, adapter: {
    getAvailability: () => adapter.getAvailability(),
    cancel: () => batch ? batch.cancel(adapter) : adapter.cancel(),
    async read(options) {
      await beforeRead();
      if (!current()) throw Object.assign(new Error('Lookup reading was paused before native acquisition.'), { code: 'CANCELLED' });
      const pending=batch ? batch.read(adapter,options) : adapter.read(options);
      onReady();
      return pending;
    },
  } });
  return { ...bridge, keepsSessionAlive: !!batch };
}

export async function prepareLookupReader(options) {
  const [{ Capacitor }, { BatteryNfc }] = await Promise.all([import('@capacitor/core'), import('@battery-inventory/nfc')]);
  if (!options.current()) throw Object.assign(new Error('Lookup reader preparation was cancelled.'), { code: 'CANCELLED' });
  return createLookupReader({ ...options, platform: Capacitor.getPlatform(), adapter: BatteryNfc });
}
