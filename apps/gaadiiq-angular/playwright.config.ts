import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:4200',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'mobile-390',
      use: {
        ...devices['iPhone 14'],
        viewport: { width: 390, height: 844 },
      },
    },
    {
      name: 'mobile-360',
      use: {
        ...devices['Pixel 5'],
        viewport: { width: 360, height: 800 },
      },
    },
    {
      name: 'mobile-412',
      use: {
        ...devices['Pixel 7'],
        viewport: { width: 412, height: 915 },
      },
    },
  ],
});
