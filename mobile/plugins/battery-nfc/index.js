import { registerPlugin } from '@capacitor/core';

export const BatteryNfc = registerPlugin('BatteryNfc', {
  web: () => import('./web.js').then(({ BatteryNfcWeb }) => new BatteryNfcWeb()),
});
