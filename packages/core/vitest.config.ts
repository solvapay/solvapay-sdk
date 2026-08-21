import { defineConfig } from 'vitest/config'
import { resolve } from 'path'
import { sdkDir } from '../../tools/shared/paths.js'

export default defineConfig({
  resolve: {
    alias: {
      '@solvapay/core': resolve(__dirname, './src'),
      // Allow vitest.setup to load the Node native dispatcher without a
      // published dependency edge from core → server.
      '@solvapay/server-native': sdkDir('node-native'),
    },
  },
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    include: ['__tests__/**/*.test.ts', 'src/**/*.test.ts', 'src/**/*.spec.ts'],
  },
})
