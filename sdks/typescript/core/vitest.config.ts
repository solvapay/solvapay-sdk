import { defineConfig } from 'vitest/config'
import { resolve } from 'path'
import { sdkDir, tsPackageDir } from '../../../tools/shared/paths.js'

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@solvapay\/core\/browser-wasm$/,
        replacement: resolve(__dirname, './src/browser-wasm.ts'),
      },
      { find: /^@solvapay\/core$/, replacement: resolve(__dirname, './src') },
      // Allow vitest.setup to load the Node native dispatcher without a
      // published dependency edge from core → server (that cycle breaks turbo).
      {
        find: /^@solvapay\/server\/edge$/,
        replacement: resolve(tsPackageDir('server'), 'src', 'edge.ts'),
      },
      {
        find: /^@solvapay\/server$/,
        replacement: resolve(tsPackageDir('server'), 'src', 'index.ts'),
      },
      {
        find: '@solvapay/mcp-core',
        replacement: resolve(tsPackageDir('mcp-core'), 'src', 'index.ts'),
      },
      { find: '@solvapay/server-native', replacement: sdkDir('node-native') },
      {
        find: '@solvapay/react/credit-estimation',
        replacement: resolve(tsPackageDir('react'), 'src', 'utils', 'credit-estimation.ts'),
      },
    ],
  },
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    include: ['__tests__/**/*.test.ts', 'src/**/*.test.ts', 'src/**/*.spec.ts'],
  },
})
