import { defineConfig, devices } from '@playwright/test'
import { DEMOS, demoBaseUrl, demoDir, demoEnv } from './support/demos'
import { resolveMerchantEnv } from './support/env'

/**
 * Playwright starts the example apps; it never starts the platform.
 *
 * The demos talk to an already-running local platform stack through the
 * provider-app proxy (`SOLVAPAY_API_BASE_URL`), and `global-setup.ts` fails the
 * whole run if that stack or the merchant env is missing. Reading the merchant
 * env here too means a missing credential fails before Playwright spends two
 * minutes booting five dev servers.
 */
const merchantEnv = resolveMerchantEnv()

/** Next/Vite dev servers compile on first request; the first paint is the slow one. */
const DEV_SERVER_TIMEOUT_MS = 240_000

export default defineConfig({
  testDir: './specs',
  // Every project shares one platform stack, one merchant and one product, so
  // parallel runs would race each other's purchase state.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 180_000,
  expect: { timeout: 20_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  globalSetup: './global-setup.ts',
  use: {
    ...devices['Desktop Chrome'],
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: DEMOS.map(demo => ({
    name: demo.id,
    testMatch: `${demo.id}.spec.ts`,
    use: { baseURL: demoBaseUrl(demo) },
  })),
  webServer: DEMOS.map(demo => ({
    command: demo.command,
    cwd: demoDir(demo),
    url: demoBaseUrl(demo),
    env: demoEnv(demo, merchantEnv),
    reuseExistingServer: !process.env.CI,
    timeout: DEV_SERVER_TIMEOUT_MS,
    stdout: 'pipe',
    stderr: 'pipe',
  })),
})
