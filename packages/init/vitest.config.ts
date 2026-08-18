import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  resolve: {
    alias: {
      '@solvapay/server-native': resolve(__dirname, '../../rust/bindings/node'),
    },
  },
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.test.ts', 'src/**/*.spec.ts'],
    testTimeout: 30000,
  },
})
