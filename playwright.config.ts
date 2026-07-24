import { defineConfig, devices } from '@playwright/test';

const externalServer = process.env.PLAYWRIGHT_EXTERNAL_SERVER === '1';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  expect: { timeout: 5000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'retain-on-failure'
  },
  projects: [
    { name: 'chromium-desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'chromium-mobile', use: { ...devices['Pixel 7'] } },
    {
      name: 'chromium-tablet',
      use: { ...devices['iPad Pro 11'], browserName: 'chromium' }
    },
    {
      name: 'chromium-mobile-landscape',
      use: {
        ...devices['Pixel 7'],
        viewport: { width: 915, height: 412 }
      }
    }
  ],
  webServer: externalServer ? undefined : [
    {
      command: 'E2E_DISABLE_RATE_LIMIT=1 npm run dev:server',
      url: 'http://127.0.0.1:3001/health/live',
      reuseExistingServer: true,
      timeout: 30_000
    },
    {
      command: 'npm run dev:client',
      url: 'http://127.0.0.1:5173',
      reuseExistingServer: true,
      timeout: 30_000
    }
  ]
});
