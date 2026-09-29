import { configDefaults, defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    testTimeout: 15_000,
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.test.{ts,tsx}', '__tests__/**/*.test.{ts,tsx}'],
    // Emptied test files (`// Removed: ...`) awaiting deletion; they hold no suites.
    exclude: [
      ...configDefaults.exclude,
      'src/components/StripePaymentFormWrapper.test.tsx',
      'src/mcp/__tests__/useStripeProbe.test.ts',
      'src/primitives/PaymentForm.return.test.tsx',
      'src/primitives/TopupForm.return.test.tsx',
      'src/primitives/buildStripeAppearance.test.ts',
      'src/primitives/paymentElementDefaults.test.ts',
      'src/utils/confirmPayment.test.ts',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/hooks/usePurchase.ts'],
      exclude: ['node_modules', 'dist', '**/*.test.{ts,tsx}', '**/*.config.*'],
    },
  },
})
