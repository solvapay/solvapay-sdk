import { defineConfig } from 'vitest/config'
import { resolve } from 'path'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    // Run tests sequentially to avoid race conditions with shared API client
    fileParallelism: false,
    env: {
      SKIP_BACKEND_JWT_TESTS: process.env.SKIP_BACKEND_JWT_TESTS || '1',
    },
    poolOptions: {
      threads: {
        singleThread: true,
      },
    },
    // Test files are organized in ui and backend folders
    include: [
      'src/__tests__/ui/**/*.test.{ts,tsx}',
      'src/__tests__/backend/**/*.test.{ts,tsx}'
    ],
    // Use different environments for UI and backend tests
    environmentMatchGlobs: [
      ['src/__tests__/ui/**', 'jsdom'],
      ['src/__tests__/backend/**', 'node']
    ],
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
})
