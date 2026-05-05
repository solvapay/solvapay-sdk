import path from 'node:path'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { solvapayApiPlugin } from './src/server/vitePlugin'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  // Forward server-side env to process.env so @solvapay/server picks up
  // SOLVAPAY_SECRET_KEY without us having to thread it through manually.
  if (env.SOLVAPAY_SECRET_KEY) {
    process.env.SOLVAPAY_SECRET_KEY = env.SOLVAPAY_SECRET_KEY
  }
  if (env.SOLVAPAY_API_BASE_URL) {
    process.env.SOLVAPAY_API_BASE_URL = env.SOLVAPAY_API_BASE_URL
  }

  return {
    server: {
      port: 3011,
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
