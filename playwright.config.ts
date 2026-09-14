import { defineConfig, devices } from '@playwright/test'

const PORT = Number(process.env.E2E_PORT ?? 8791)

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  expect: { timeout: 20_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } }, testIgnore: /mobile\.spec\.ts/ },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, testMatch: /mobile\.spec\.ts/ },
  ],
  // Serves the production build through Cloudflare's Pages runtime, so clean routes and _headers
  // (including the Content Security Policy) are exercised exactly as deployed.
  webServer: {
    command: `pnpm exec wrangler pages dev dist --port ${PORT} --ip 127.0.0.1 --log-level warn`,
    url: `http://localhost:${PORT}/holdem`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
