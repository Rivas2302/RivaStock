import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e/i43-real-ocr',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  reporter: 'list',
  timeout: 90_000,
  expect: { timeout: 10_000 },
  use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:4175' },
  webServer: {
    command: 'node scripts/i43-real-ocr-test-server.mjs',
    url: 'http://127.0.0.1:4175',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
