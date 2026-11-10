import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/public-catalog.spec.ts',
  fullyParallel: true,
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:4173', trace: 'retain-on-failure' },
  projects: [
    { name: 'android-pixel-7-chromium', use: { ...devices['Pixel 7'], viewport: { width: 375, height: 812 } } },
    { name: 'iphone-11-webkit', use: { ...devices['iPhone 11'] } },
    { name: 'iphone-13-webkit', use: { ...devices['iPhone 13'] } },
    { name: 'iphone-15-webkit', use: { ...devices['iPhone 15'] } },
  ],
  webServer: {
    command: 'npm.cmd run build -- --mode e2e && npm.cmd run preview -- --host 127.0.0.1 --port 4173 --strictPort',
    env: {
      VITE_SUPABASE_URL: 'https://rivastock-test.invalid',
      VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test-fixture',
    },
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
