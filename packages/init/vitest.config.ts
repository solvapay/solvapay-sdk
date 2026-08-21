import { defineConfig } from 'vitest/config'
import { sdkDir } from '../../tools/shared/paths.js'

export default defineConfig({
  resolve: {
    alias: {
      '@solvapay/server-native': sdkDir('node-native'),
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
