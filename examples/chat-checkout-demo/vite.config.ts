import path from 'node:path'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { solvapayApiPlugin } from './src/server/vitePlugin'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  // Forward server-side env to process.env so the API middleware picks
  // them up without us having to thread them through manually. Both
  // SOLVAPAY_SECRET_KEY (for `@solvapay/server`) and GEMINI_API_KEY
  // (for the `/api/chat` Gemini proxy) stay server-side — never exposed
  // to the browser.
  if (env.SOLVAPAY_SECRET_KEY) {
    process.env.SOLVAPAY_SECRET_KEY = env.SOLVAPAY_SECRET_KEY
  }
  if (env.SOLVAPAY_API_BASE_URL) {
    process.env.SOLVAPAY_API_BASE_URL = env.SOLVAPAY_API_BASE_URL
  }
  if (env.GEMINI_API_KEY) {
    process.env.GEMINI_API_KEY = env.GEMINI_API_KEY
  }

  return {
    server: {
      port: 3011,
      // Fail fast if 3011 is already in use instead of silently falling
      // back to 3012/3013 — a second `pnpm dev` would otherwise leave
      // the browser pointed at a stale instance with cached env vars.
      strictPort: true,
      host: '0.0.0.0',
    },
    plugins: [react(), solvapayApiPlugin() as Plugin],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
      dedupe: ['react', 'react-dom', '@stripe/react-stripe-js'],
    },
    // Forward SOLVAPAY_PRODUCT_REF as a fallback for each scenario's
    // VITE_*_PRODUCT_REF so a minimal .env (as written by `solvapay init`)
    // works out of the box. Explicit VITE_*_PRODUCT_REF values in .env
    // always take precedence.
    define: {
      'import.meta.env.VITE_SUBSCRIPTION_PRODUCT_REF': JSON.stringify(
        env.VITE_SUBSCRIPTION_PRODUCT_REF || env.SOLVAPAY_PRODUCT_REF || '',
      ),
      'import.meta.env.VITE_LIFETIME_PRODUCT_REF': JSON.stringify(
        env.VITE_LIFETIME_PRODUCT_REF || env.SOLVAPAY_PRODUCT_REF || '',
      ),
      'import.meta.env.VITE_TOPUP_PRODUCT_REF': JSON.stringify(
        env.VITE_TOPUP_PRODUCT_REF || env.SOLVAPAY_PRODUCT_REF || '',
      ),
    },
  }
})
