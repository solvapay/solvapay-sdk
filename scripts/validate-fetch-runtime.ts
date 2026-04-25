/**
 * Pre-publish gate for the Web-standards runtime packages.
 *
 * Imports `@solvapay/fetch` + `@solvapay/mcp-fetch` from their freshly
 * built `dist/index.js` ESM entries in a bare Node process with:
 *
 * - No `express`, `node:http`, or `connect`-family body parser available.
 * - No Supabase client (`@supabase/*`) available.
 * - Only globals that exist on every Web-standards runtime
 *   (Deno / Supabase Edge / Cloudflare Workers / Bun / Next edge /
 *   Vercel Functions): `Request`, `Response`, `Headers`, `URL`,
 *   `fetch`, `crypto`, `globalThis`, `setTimeout`, `clearTimeout`.
 *
 * If either import crashes, the process exits non-zero. CI wires this
 * into [`.github/workflows/publish-preview.yml`] so we can't ship a
 * `@solvapay/fetch` or `@solvapay/mcp-fetch` preview that silently
 * leaks a Node-only builtin into a fetch-first runtime.
 *
 * Run via `pnpm validate:fetch-runtime`.
 */

import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'

const require = createRequire(import.meta.url)
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

interface TargetPackage {
  name: string
  distEsm: string
  expectedExports: string[]
}

const TARGETS: TargetPackage[] = [
  {
    name: '@solvapay/fetch',
    distEsm: path.join(REPO_ROOT, 'packages/fetch/dist/index.js'),
    expectedExports: ['checkPurchase', 'createPaymentIntent'],
  },
  {
    name: '@solvapay/mcp-fetch',
    distEsm: path.join(REPO_ROOT, 'packages/mcp-fetch/dist/index.js'),
    expectedExports: [
      'createSolvaPayMcpFetchHandler',
      'createOAuthFetchRouter',
      'createProtectedResourceHandler',
      'createAuthorizationServerHandler',
      'applyNativeCors',
      'corsPreflight',
      'authChallenge',
      'buildAuthInfoFromBearer',
      'getOAuthAuthorizationServerResponse',
      'getOAuthProtectedResourceResponse',
    ],
  },
]

const FORBIDDEN_MODULES = new Set([
  'express',
  'connect',
  'body-parser',
  'serve-static',
  'cookie-parser',
  '@supabase/supabase-js',
  '@supabase/ssr',
  '@supabase/postgrest-js',
])

function assertBuilt(target: TargetPackage): void {
  if (!existsSync(target.distEsm)) {
    throw new Error(
      `[validate-fetch-runtime] ${target.name} has not been built (${path.relative(REPO_ROOT, target.distEsm)} missing). Run \`pnpm --filter=${target.name} build\` first.`,
    )
  }
}

function monkeypatchForbiddenModules(): void {
  // Intercept `require` so any Node-only module we consider unsafe on
  // a Web-standards runtime throws loudly instead of silently pulling
  // in polyfills. ESM dynamic import is also routed through require,
  // so this catches both import styles.
  const originalResolve = require.resolve
  require.resolve = ((request: string, ...rest: unknown[]) => {
    if (FORBIDDEN_MODULES.has(request)) {
      throw new Error(
        `[validate-fetch-runtime] forbidden import detected: ${request}. Web-standards packages may not depend on Node-only libraries.`,
      )
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (originalResolve as any).call(require, request, ...rest)
  }) as typeof require.resolve
}

function assertGlobals(): void {
  const required = ['Request', 'Response', 'Headers', 'URL', 'fetch', 'crypto', 'globalThis']
  for (const key of required) {
    if (!(key in globalThis)) {
      throw new Error(`[validate-fetch-runtime] missing Web-standard global: ${key}`)
    }
  }
}

async function validate(target: TargetPackage): Promise<void> {
  assertBuilt(target)
  const mod = (await import(pathToFileURL(target.distEsm).href)) as Record<string, unknown>
  for (const exportName of target.expectedExports) {
    if (!(exportName in mod)) {
      throw new Error(
        `[validate-fetch-runtime] ${target.name} is missing expected export \`${exportName}\`.`,
      )
    }
  }
}

async function main(): Promise<void> {
  assertGlobals()
  monkeypatchForbiddenModules()
  for (const target of TARGETS) {
    await validate(target)
    process.stdout.write(
      `[validate-fetch-runtime] OK  ${target.name.padEnd(22)} (${target.expectedExports.length} expected exports)\n`,
    )
  }
  process.stdout.write('[validate-fetch-runtime] all Web-standards packages clean\n')
}

main()
  .then(() => {
    // Some transport dependencies (e.g. `@modelcontextprotocol/sdk`)
    // initialise lazy timers that keep the event loop alive past the
    // smoke. Force-exit so the pre-publish gate finishes in CI.
    process.exit(0)
  })
  .catch(err => {
    const message = err instanceof Error ? err.message : String(err)
    process.stderr.write(`${message}\n`)
    process.exit(1)
  })
