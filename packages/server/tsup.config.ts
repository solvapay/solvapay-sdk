import { defineConfig } from 'tsup'

export default defineConfig([
  {
    entry: ['src/index.ts'],
    format: ['esm', 'cjs'],
    dts: true,
    tsconfig: 'tsconfig.build.json',
    clean: true,
    external: ['@solvapay/core', '@solvapay/auth', 'zod', 'jose'],
  },
  {
    entry: ['src/edge.ts'],
    format: ['esm'],
    dts: true,
    tsconfig: 'tsconfig.build.json',
    clean: false,
    external: ['@solvapay/core', '@solvapay/auth', 'zod', 'jose'],
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
    external: ['@solvapay/core', '@solvapay/auth', 'zod', 'jose'],
  },
])
