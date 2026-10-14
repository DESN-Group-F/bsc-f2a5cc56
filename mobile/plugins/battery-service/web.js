import { WebPlugin } from '@capacitor/core';

export class BatteryServiceWeb extends WebPlugin {
  async getConfiguration() { return { origin: null }; }
  async configure() { throw this.unavailable('Secure native service transport requires the installed application. Browser preview uses its own same-origin API.'); }
  async clearSession() { throw this.unavailable('Native credential storage is unavailable in the browser.'); }
  async loadBusinessData() { throw this.unavailable('Native business recovery storage is unavailable in the browser.'); }
  async saveBusinessData() { throw this.unavailable('Native business recovery storage is unavailable in the browser.'); }
  async request() { throw this.unavailable('Native service transport is unavailable in the browser. No native session request was sent.'); }
}
