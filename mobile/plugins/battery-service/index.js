import { registerPlugin } from '@capacitor/core';

export const BatteryService = registerPlugin('BatteryService', {
  web: () => import('./web.js').then(({ BatteryServiceWeb }) => new BatteryServiceWeb()),
});
