import { defineConfig } from 'tsup'

export default defineConfig([
  {
    // `native` is a separate entry so client.ts's runtime
    // `import(['./', 'native.js'].join(''))` resolves to dist/native.js.
    // (A non-literal specifier is intentional — keeps edge bundlers from
    // statically pulling the Node-only graph — so tsup will not emit a
    // hashed chunk for it unless it is an explicit entry.)
    entry: {
      index: 'src/index.ts',
      native: 'src/native.ts',
    },
    format: ['esm', 'cjs'],
    dts: true,
    tsconfig: 'tsconfig.build.json',
    clean: true,
    // Shim import.meta.url in the CJS bundle so createRequire(import.meta.url)
    // in webhook-native resolves correctly under require().
    shims: true,
    // Native binding stays external so the Node bundle does not embed it;
    // `node:module` is needed for the sync createRequire loader in native.ts.
    // `@solvapay/server-wasm` stays external too: client.ts dynamic-imports
    // `./wasm` (edge adapter) which dynamic-imports the WASM package — keeping
    // it external prevents the Node bundle from embedding the `.wasm` glue.
    external: [
      '@solvapay/core',
      '@solvapay/auth',
      '@solvapay/server-native',
      '@solvapay/server-wasm',
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
    // `.wasm` asset; Node napi / `node:module` / `./native` must never
    // enter this graph (client.ts may dynamic-import native on Node only).
    external: [
      '@solvapay/core',
      '@solvapay/auth',
      '@solvapay/server-wasm',
      '@solvapay/server-native',
      './native',
      './webhook-native',
      'node:module',
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
