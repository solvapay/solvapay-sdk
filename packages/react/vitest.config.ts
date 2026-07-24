import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Browser WASM is stubbed in tests; napi is installed in vitest.setup.ts.
      '@solvapay/core/browser-wasm': resolve(__dirname, './vitest.browser-wasm-stub.ts'),
      '@solvapay/server-native': resolve(__dirname, '../../rust/bindings/node'),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    testTimeout: 15_000,
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.test.{ts,tsx}', '__tests__/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/hooks/usePurchase.ts'],
      exclude: ['node_modules', 'dist', '**/*.test.{ts,tsx}', '**/*.config.*'],
    },
  },
})
