import { defineConfig } from 'vitest/config'
import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(__dirname, '.env'), override: true })

export default defineConfig({
  resolve: {
    alias: {
      '@solvapay/core': resolve(__dirname, '../core/src'),
      '@solvapay/mcp-core': resolve(__dirname, '../mcp-core/src'),
    },
  },
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    include: ['__tests__/**/*.integration.test.ts'],
    testTimeout: 120000,
    hookTimeout: 30000,
    env: {
      ...process.env,
    },
  },
})
