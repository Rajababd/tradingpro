import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.tradingpro.app',
  appName: 'TradingPro',
  webDir: 'dist',
  android: {
    allowMixedContent: false,
  },
};

export default config;
