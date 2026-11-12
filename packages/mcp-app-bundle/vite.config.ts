import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'
import { viteSingleFile } from 'vite-plugin-singlefile'
import react from '@vitejs/plugin-react'

const packagesDir = fileURLToPath(new URL('..', import.meta.url))

// Zod's v4 core probes `new Function('return true')` to detect eval support.
// That is a CSP violation in every MCP iframe (none allows `unsafe-eval`), so
// the probe is replaced with `return false`.
function stripZodEvalCheck(): Plugin {
  return {
    name: 'strip-zod-eval-check',
    enforce: 'pre',
    transform(code, id) {
      if (!id.includes('/zod/') || !id.endsWith('/v4/core/util.js')) return null
      const nextCode = code.replace(/new F\(""\);\s*return true;/, 'return false;')
      return nextCode === code ? null : { code: nextCode, map: null }
    },
  }
}

// Same build as examples/mcp-checkout-app and examples/cloudflare-workers-mcp:
// workspace packages resolve from source, and Stripe.js loads from
// js.stripe.com at runtime (Stripe forbids bundling it). Every workspace
// package the widget reaches is aliased, so the output never depends on
// whether a package's dist/ is built: python/scripts/sync_widget.py --check
// compares it byte for byte.
export default defineConfig({
  plugins: [stripZodEvalCheck(), react(), viteSingleFile()],
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  resolve: {
    alias: [
      { find: /^@solvapay\/auth$/, replacement: `${packagesDir}auth/src/index.ts` },
      { find: /^@solvapay\/core$/, replacement: `${packagesDir}core/src/index.ts` },
      { find: /^@solvapay\/server$/, replacement: `${packagesDir}server/src/index.ts` },
      { find: /^@solvapay\/mcp-core$/, replacement: `${packagesDir}mcp-core/src/index.ts` },
      { find: /^@solvapay\/react$/, replacement: `${packagesDir}react/src/index.tsx` },
      { find: /^@solvapay\/react\/mcp$/, replacement: `${packagesDir}react/src/mcp/index.ts` },
      {
        find: /^@solvapay\/react\/primitives$/,
        replacement: `${packagesDir}react/src/primitives/index.ts`,
      },
      {
        find: /^@solvapay\/react\/adapters\/auth$/,
        replacement: `${packagesDir}react/src/adapters/auth.ts`,
      },
      {
        find: /^@solvapay\/react\/mcp\/styles\.css$/,
        replacement: `${packagesDir}react/src/mcp/styles.css`,
      },
      {
        find: /^@solvapay\/react\/styles\.css$/,
        replacement: `${packagesDir}react/src/styles.css`,
      },
    ],
  },
  build: {
    rollupOptions: { input: 'mcp-app.html' },
    outDir: 'dist',
    emptyOutDir: true,
  },
})
