import { WebPlugin } from '@capacitor/core';

export class BatteryNfcWeb extends WebPlugin {
  async getAvailability() {
    return {
      available: false,
      enabled: false,
      platform: 'web',
      reason: 'NFC diagnostics require the installed native application on a compatible device.',
    };
  }

  async read() {
    throw this.unavailable('NFC diagnostics are unavailable in the browser. No hardware read was made.');
  }

  async cancel() {}
}
