import { defineConfig, type Plugin } from 'vite'
import { viteSingleFile } from 'vite-plugin-singlefile'
import react from '@vitejs/plugin-react'

const input = process.env.INPUT
if (!input) {
  throw new Error('INPUT environment variable is not set')
}

function stripZodEvalCheck(): Plugin {
  return {
    name: 'strip-zod-eval-check',
    enforce: 'pre',
    transform(code, id) {
      if (!id.includes('/zod/') || !id.endsWith('/v4/core/util.js')) {
        return null
      }

      const nextCode = code.replace(/new F\(""\);\s*return true;/, 'return false;')
      if (nextCode === code) {
        return null
      }

      return {
        code: nextCode,
        map: null,
      }
    },
  }
}

// Stripe.js MUST be loaded from https://js.stripe.com/v3 at runtime.
// Stripe forbids bundling it. We externalize it so the bundle pulls it from
// the CDN via a `<script>` tag injected by `loadStripe`.
export default defineConfig({
  plugins: [stripZodEvalCheck(), react(), viteSingleFile()],
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'production'),
  },
  build: {
    rollupOptions: {
      input,
    },
    outDir: 'dist',
    emptyOutDir: false,
  },
})
