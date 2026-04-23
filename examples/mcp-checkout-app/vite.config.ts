import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'
import { viteSingleFile } from 'vite-plugin-singlefile'
import react from '@vitejs/plugin-react'

const packagesDir = fileURLToPath(new URL('../../packages', import.meta.url))

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
  // Resolve workspace packages from TypeScript source so dev doesn't depend on
  // their built `dist/` output. This removes the need for parallel `tsup --watch`
  // processes and the resulting file-write storms that cascade into server
  // restarts.
  resolve: {
    alias: [
      { find: /^@solvapay\/core$/, replacement: `${packagesDir}/core/src/index.ts` },
      { find: /^@solvapay\/server$/, replacement: `${packagesDir}/server/src/index.ts` },
      { find: /^@solvapay\/mcp$/, replacement: `${packagesDir}/mcp/src/index.ts` },
      { find: /^@solvapay\/mcp-sdk$/, replacement: `${packagesDir}/mcp-sdk/src/index.ts` },
      { find: /^@solvapay\/react$/, replacement: `${packagesDir}/react/src/index.tsx` },
      { find: /^@solvapay\/react\/mcp$/, replacement: `${packagesDir}/react/src/mcp/index.ts` },
      { find: /^@solvapay\/react\/primitives$/, replacement: `${packagesDir}/react/src/primitives/index.ts` },
      { find: /^@solvapay\/react\/adapters\/auth$/, replacement: `${packagesDir}/react/src/adapters/auth.ts` },
      { find: /^@solvapay\/react\/mcp\/styles\.css$/, replacement: `${packagesDir}/react/src/mcp/styles.css` },
      { find: /^@solvapay\/react\/styles\.css$/, replacement: `${packagesDir}/react/src/styles.css` },
    ],
  },
  build: {
    rollupOptions: {
      input,
    },
    outDir: 'dist',
    emptyOutDir: false,
  },
})
