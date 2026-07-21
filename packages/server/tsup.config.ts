import { defineConfig } from 'tsup'

export default defineConfig([
  {
    entry: ['src/index.ts'],
    format: ['esm', 'cjs'],
    dts: true,
    tsconfig: 'tsconfig.build.json',
    clean: true,
    // Shim import.meta.url in the CJS bundle so createRequire(import.meta.url)
    // in webhook-native resolves correctly under require().
    shims: true,
    // Native binding stays external so the Node bundle does not embed it;
    // `node:module` is needed for the sync createRequire loader in webhook-native.
    external: [
      '@solvapay/core',
      '@solvapay/auth',
      '@solvapay/server-native',
      'node:module',
      'zod',
      'jose',
    ],
  },
  {
    entry: ['src/edge.ts'],
    format: ['esm'],
    dts: true,
    tsconfig: 'tsconfig.build.json',
    clean: false,
    // WASM package stays external so the edge bundle does not embed the
    // `.wasm` asset; Node napi / `node:module` must never enter this graph.
    external: [
      '@solvapay/core',
      '@solvapay/auth',
      '@solvapay/server-wasm',
      'zod',
      'jose',
    ],
  },
  {
    // `./fetch` subpath — Web-standards `(req: Request) => Promise<Response>`
    // handlers (formerly `@solvapay/fetch`). Emits ESM + CJS to
    // `dist/fetch/`. The `./fetch` entry internally imports
    // `../edge` for the async `verifyWebhook` + `../helpers` for the
    // `*Core` route helpers; both stay external from THIS bundle's
    // POV so they deduplicate to the root/edge artefacts at publish.
    entry: ['src/fetch/index.ts'],
    format: ['esm', 'cjs'],
    dts: true,
    tsconfig: 'tsconfig.build.json',
    clean: false,
    outDir: 'dist/fetch',
    external: [
      '@solvapay/core',
      '@solvapay/auth',
      '@solvapay/server-wasm',
      'zod',
      'jose',
    ],
  },
])
