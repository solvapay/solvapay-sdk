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
    },
  }
})
