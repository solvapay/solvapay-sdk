import { defineConfig, type Plugin } from 'vite'
import { viteSingleFile } from 'vite-plugin-singlefile'
import react from '@vitejs/plugin-react'

const input = process.env.INPUT
if (!input) {
  throw new Error('INPUT environment variable is not set')
}

// Zod's v4 core probes `new Function('return true')` to detect eval
// support — harmless in a Node server, but a hard CSP violation in
// any browser / MCP iframe that forbids `unsafe-eval` (which is every
// SolvaPay iframe). Replace the probe with an unconditional `return
// false` to keep the bundle CSP-clean.
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
// Stripe forbids bundling it. `@solvapay/react/mcp` externalises the
// script via `loadStripe`, so nothing extra is needed here.
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
