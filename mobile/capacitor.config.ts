import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.batteryinventory.mobile',
  appName: 'Battery Inventory',
  webDir: 'dist',
  // Keep framework bridge payloads out of native logs; business evidence uses app storage.
  android: { loggingBehavior: 'none', backgroundColor: '#f5f6f8' },
  ios: { loggingBehavior: 'none', backgroundColor: '#10141b' },
};

export default config;
