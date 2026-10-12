import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: [
    [process.env.CI ? 'github' : 'list'],
    ['json', { outputFile: 'test-results/results.json' }],
  ],
  use: { baseURL: 'http://127.0.0.1:4173', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm.cmd run build -- --mode e2e && npm.cmd run preview -- --host 127.0.0.1 --port 4173 --strictPort',
    env: {
      // All requests in fixture tests are intercepted; never connect to a live tenant.
      VITE_SUPABASE_URL: 'https://rivastock-test.invalid',
      VITE_SUPABASE_ANON_KEY: 'test-anon-key',
    },
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
