import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Browser WASM is stubbed; napi is installed in vitest.setup.ts.
      '@solvapay/core/browser-wasm': resolve(__dirname, './vitest.browser-wasm-stub.ts'),
      '@solvapay/server-native': resolve(__dirname, '../../../rust/bindings/node'),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    include: ['app/**/*.test.{ts,tsx}'],
  },
})
