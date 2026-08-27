import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import { tsPackageDir } from '../../../tools/shared/paths.js'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      {
        find: /^@solvapay\/core\/browser-wasm$/,
        replacement: resolve(__dirname, './vitest.browser-wasm-stub.ts'),
      },
    ],
  },
  test: {
    globals: true,
    environment: 'jsdom',
    testTimeout: 15_000,
    include: ['src/**/*.no-binding.test.{ts,tsx}'],
  },
})
