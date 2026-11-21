import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/ui',
  fullyParallel: true,
  projects: [
    { name: 'chromium' },
    {
      name: 'webkit',
      testMatch: 'login-layout.spec.ts',
      use: { browserName: 'webkit', channel: undefined },
    },
  ],
  use: {
    baseURL: 'http://127.0.0.1:5173',
    browserName: 'chromium',
    channel: process.env.PW_CHANNEL,
  },
  webServer: { command: 'npm run dev', url: 'http://127.0.0.1:5173', reuseExistingServer: true },
});
