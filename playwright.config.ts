import { defineConfig, devices } from '@playwright/test';

const androidCatalogSmoke = /public catalog mobile flow reaches checkout|catalog announcement stays in the safe-area header flow|catalog without an announcement has no reserved ribbon space|opening a listed product is immediate and does not reload the anonymous catalog RPC|cart add feedback and removal confirmation work in Store and Reseller modes|product detail is a catalog modal with browser history|mobile product sheet closes with a downward swipe|reseller direct product details require the reseller session|reseller catalog hides categories and keeps search above imported products|reseller product detail is a themed 90 percent bottom sheet|retail checkout saves a fixture order code|anonymous reseller checkout without an active round|new invited business configures catalog and receives anonymous WhatsApp orders/;

export default defineConfig({
  testDir: './e2e',
  testIgnore: '**/i43-real-ocr/**',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: [
    [process.env.CI ? 'github' : 'list'],
    ['json', { outputFile: 'test-results/results.json' }],
  ],
  use: { baseURL: 'http://127.0.0.1:4173', trace: 'retain-on-failure' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    {
      name: 'android-mobile-ai',
      testMatch: /(ai|stock|product-upload|sales(?:-adjustment)?|number-fields|cashflow|quick-price|reports|quotes|customers|suppliers|intake|settings|navigation)-mobile\.spec\.ts/,
      use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 } },
    },
    {
      name: 'iphone-mobile-ai',
      testMatch: /(ai|stock|sales(?:-adjustment)?|number-fields|cashflow|quick-price|reports|quotes|customers|suppliers|intake|settings|navigation)-mobile\.spec\.ts/,
      use: { ...devices['iPhone 13'], viewport: { width: 390, height: 844 } },
    },
    { name: 'catalog-iphone-11', testMatch: /(public-catalog|pwa-install|new-customer-journey)\.spec\.ts/, use: { ...devices['iPhone 11'] } },
    { name: 'catalog-iphone-13', testMatch: /(public-catalog|pwa-install|new-customer-journey)\.spec\.ts/, use: { ...devices['iPhone 13'] } },
    { name: 'catalog-iphone-15', testMatch: /(public-catalog|pwa-install|new-customer-journey)\.spec\.ts/, use: { ...devices['iPhone 15'] } },
    { name: 'catalog-android', testMatch: /(public-catalog|new-customer-journey)\.spec\.ts/, grep: androidCatalogSmoke, use: { ...devices['Pixel 7'], viewport: { width: 375, height: 812 } } },
  ],
  webServer: {
    command: 'npm.cmd run build -- --mode e2e && npm.cmd run preview -- --host 127.0.0.1 --port 4173 --strictPort',
    env: {
      // All requests in fixture tests are intercepted; never connect to a live tenant.
      VITE_SUPABASE_URL: 'https://rivastock-test.invalid',
      VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test-fixture',
    },
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
