import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  resolve: {
    alias: {
      '@solvapay/mcp-core': resolve(__dirname, '../mcp-core/src'),
      '@solvapay/mcp': resolve(__dirname, '../mcp/src'),
      '@solvapay/server': resolve(__dirname, '../server/src'),
      '@solvapay/core': resolve(__dirname, '../core/src'),
    },
  },
  test: {
    environment: 'node',
    globals: true,
    include: ['__tests__/**/*.test.ts', '__tests__/**/*.spec.ts', 'src/**/*.test.ts', 'src/**/*.spec.ts'],
    testTimeout: 30000,
  },
})
