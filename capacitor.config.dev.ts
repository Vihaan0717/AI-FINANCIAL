import type { CapacitorConfig } from '@capacitor/cli';
import baseConfig from './capacitor.config';

/**
 * Development-Only Capacitor Configuration for Android Live Reload.
 *
 * Usage:
 *   npx cap sync android --config capacitor.config.dev.ts
 *
 * Note:
 *   - Used strictly for local Wi-Fi / ADB port forwarding development.
 *   - Never bundled in standalone production APK releases.
 */
const devConfig: CapacitorConfig = {
  ...baseConfig,
  server: {
    // Development-only: loads the live Vite server over local Wi-Fi or ADB reverse
    url: process.env.CAPACITOR_DEV_URL || 'http://localhost:5173',
    cleartext: true,
  },
  android: {
    ...baseConfig.android,
    webContentsDebuggingEnabled: true, // Enables Chrome remote inspection (chrome://inspect)
  },
};

export default devConfig;
