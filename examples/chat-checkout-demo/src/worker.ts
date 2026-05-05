/**
 * Cloudflare Workers entrypoint for the chat-checkout demo.
 *
 * - `/api/*` is dispatched through the runtime-agnostic
 *   `handleApiRequest` from `src/server/handlers.ts` — the same
 *   dispatcher the Vite dev plugin uses, just running on V8.
 * - Every other path is forwarded to the Workers Assets binding,
 *   which serves the Vite `dist/` output with SPA fallback (see
 *   `not_found_handling: "single-page-application"` in
 *   `wrangler.jsonc`).
 *
 * Secrets (`SOLVAPAY_SECRET_KEY`, `GEMINI_API_KEY`) are uploaded once
 * via `wrangler secret put` and persist across deploys. Public-safe
 * placeholder values for `SOLVAPAY_API_BASE_URL` live in
 * `wrangler.jsonc`; real overrides are passed at deploy time by
 * `scripts/deploy.mjs` reading `.env` / `.env.prod`.
 */

import { createSolvaPay } from '@solvapay/server'
import { handleApiRequest, type ApiDeps } from './server/handlers'

interface Env {
  ASSETS: Fetcher
  SOLVAPAY_SECRET_KEY: string
  GEMINI_API_KEY: string
  SOLVAPAY_API_BASE_URL?: string
}

function requireEnv(env: Env, name: keyof Env): string {
  const value = env[name]
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(
      `${name} is not set — check wrangler.jsonc \`vars\` block or run \`wrangler secret put ${name}\``,
    )
  }
  return value
}

// Cache `deps` at isolate scope so the SolvaPay client (and its
// internal HTTP keepalive pool) only builds once per Workers isolate,
// not once per request. Secret rotations trigger a new worker version
// and a fresh isolate — invalidation is free.
let cachedDeps: ApiDeps | undefined

function getDeps(env: Env): ApiDeps {
  if (cachedDeps) return cachedDeps
  cachedDeps = {
    solvaPay: createSolvaPay({
      apiKey: requireEnv(env, 'SOLVAPAY_SECRET_KEY'),
      apiBaseUrl: env.SOLVAPAY_API_BASE_URL ?? 'https://api.solvapay.com',
    }),
    geminiApiKey: requireEnv(env, 'GEMINI_API_KEY'),
  }
  return cachedDeps
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url)
    if (url.pathname.startsWith('/api/')) {
      return handleApiRequest(req, getDeps(env))
    }
    return env.ASSETS.fetch(req)
  },
} satisfies ExportedHandler<Env>
