import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// The same page runs against either backend: only BACKEND_URL changes.
export default defineConfig(({ command, mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env }
  const backend = env.BACKEND_URL
  if (command === 'serve' && !backend) {
    throw new Error(
      'Set BACKEND_URL to the backend to proxy to: http://127.0.0.1:4010 (Python) or http://127.0.0.1:4020 (Go).',
    )
  }
  // Same origin as the page, so the backend sees the page's host and no CORS is involved.
  const proxy = backend ? { '/api': backend, '/auth': backend } : undefined
  return {
    plugins: [react()],
    server: { port: 5173, strictPort: true, proxy },
    resolve: { dedupe: ['react', 'react-dom', '@stripe/react-stripe-js'] },
  }
})
