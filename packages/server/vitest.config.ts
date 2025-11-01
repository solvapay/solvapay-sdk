import { defineConfig } from 'vitest/config'
import { config } from 'dotenv'
import { resolve } from 'path'

// Load environment variables from .env file
// override: true means .env file takes precedence over existing env vars
config({ path: resolve(__dirname, '.env'), override: true })

/**
 * Logging Control Environment Variables:
 * 
 * - SOLVAPAY_DEBUG=true       - Enable detailed SDK API client logging
 * - VERBOSE_TEST_LOGS=true    - Enable verbose test helper logging
 * 
 * By default, both are disabled for clean test output.
 * Enable them when debugging test failures or SDK behavior.
 * 
 * Usage:
 *   SOLVAPAY_DEBUG=true pnpm test:integration
 *   VERBOSE_TEST_LOGS=true pnpm test:integration
 *   SOLVAPAY_DEBUG=true VERBOSE_TEST_LOGS=true pnpm test:integration
 */

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['__tests__/**/*.test.ts', 'src/**/*.test.ts'],
    // Increase timeout for integration tests (default is 5000ms)
    // Integration tests make multiple slow API calls to real backend
    testTimeout: 30000, // 30 seconds
    hookTimeout: 30000, // 30 seconds for setup/teardown hooks
    env: {
      // Make .env variables available in tests
      ...process.env,
    },
  },
})
