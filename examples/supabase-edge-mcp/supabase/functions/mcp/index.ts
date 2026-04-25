/**
 * SolvaPay MCP server — Supabase Edge Function entrypoint.
 *
 * End-to-end Deno target for the turnkey Web-standards handler
 * (`createSolvaPayMcpFetchHandler`). Contrast with
 * `examples/mcp-checkout-app/src/index.ts`, which wires the same toolbox
 * into Express + `createMcpOAuthBridge` + `StreamableHTTPServerTransport`
 * — the two files are shape-for-shape parallel, and the only runtime
 * difference is the HTTP layer (Express vs. `Deno.serve`).
 *
 * What this gives you vs. the plain `examples/supabase-edge/`:
 *
 * - `/.well-known/oauth-*` + `/oauth/{register,authorize,token,revoke}`
 *   bridge routes — proxied to the SolvaPay API with native-scheme CORS.
 * - `POST /mcp` / `GET /mcp` / `DELETE /mcp` — the JSON-RPC MCP transport
 *   with per-request Bearer auth.
 * - The Goldberg paywalled Oracle toolbox (`predict_price_chart` +
 *   `predict_direction`) — trimmed from the full `mcp-checkout-app`
 *   example down to the two stock-predictor tools for the Goldberg
 *   MCP launch.
 * - The iframe HTML read from the function's own filesystem — the Deno
 *   runtime never falls back to `node:fs/promises`. The HTML file is
 *   shipped with the function via `static_files` in `supabase/config.toml`.
 *
 * Supabase's edge gateway strips `/functions/v1` on the way in, so the
 * function sees `/<fn-name>/…`. For this function the name is `mcp`,
 * so we drop the leading `/mcp` segment and serve the MCP transport at
 * the root path (`mcpPath: '/'`) with OAuth bridge routes at
 * `/.well-known/*` + `/oauth/*`. This keeps the handler's routing
 * runtime-neutral — the fetch handler stays the same across Deno,
 * Cloudflare Workers, Bun, Next edge, etc.
 *
 * To deploy:
 *
 *   pnpm build              # bundle mcp-app.html + copy into ./mcp/
 *   pnpm deploy             # supabase functions deploy mcp
 *
 * Type-check locally (the required CI gate) with:
 *
 *   pnpm validate
 */

import 'jsr:@supabase/functions-js/edge-runtime.d.ts'

import { createSolvaPay } from '@solvapay/server'
import { createSolvaPayMcpServer } from '@solvapay/mcp'
import { createSolvaPayMcpFetchHandler } from '@solvapay/mcp-fetch'
import { demoToolsEnabled, registerDemoTools } from './demo-tools.ts'

function requireEnv(name: string): string {
  const value = Deno.env.get(name)
  if (!value) {
    throw new Error(`${name} is not set — copy .env.example to Supabase secrets`)
  }
  return value
}

// Supabase strips `/functions/v1` before the request reaches the
// function, so incoming paths look like `/<fn-name>/…`. We drop the
// `/mcp` prefix so the fetch handler can match `/.well-known/*`,
// `/oauth/*`, and the root MCP transport without knowing anything
// about its hosting environment.
const FUNCTION_MOUNT_PREFIX = '/mcp'

function rewriteRequestPath(req: Request): Request {
  const url = new URL(req.url)
  if (!url.pathname.startsWith(FUNCTION_MOUNT_PREFIX)) return req
  url.pathname = url.pathname.slice(FUNCTION_MOUNT_PREFIX.length) || '/'
  return new Request(url, req)
}

const solvaPay = createSolvaPay({
  apiKey: requireEnv('SOLVAPAY_SECRET_KEY'),
  apiBaseUrl: Deno.env.get('SOLVAPAY_API_BASE_URL'),
})
const productRef = requireEnv('SOLVAPAY_PRODUCT_REF')
const publicBaseUrl = requireEnv('MCP_PUBLIC_BASE_URL')
const apiBaseUrl = Deno.env.get('SOLVAPAY_API_BASE_URL') ?? 'https://api.solvapay.com'

// Read the bundled iframe HTML off the function's filesystem once, at
// cold start — avoids re-reading on every MCP `initialize` and keeps
// the readHtml branch runtime-neutral (no dynamic `node:fs/promises`).
// Requires `static_files = ["./functions/mcp/mcp-app.html"]` in
// `supabase/config.toml` so the file ships alongside the function bundle.
const htmlUrl = new URL('./mcp-app.html', import.meta.url)
const html = await Deno.readTextFile(htmlUrl)

const server = createSolvaPayMcpServer({
  solvaPay,
  productRef,
  resourceUri: 'ui://supabase-edge-mcp/mcp-app.html',
  readHtml: async () => html,
  publicBaseUrl,
  additionalTools: demoToolsEnabled() ? registerDemoTools : undefined,
})

const handler = createSolvaPayMcpFetchHandler({
  server,
  publicBaseUrl,
  apiBaseUrl,
  productRef,
  // The Supabase edge gateway mounts this function at
  // `/functions/v1/mcp` and strips the `/mcp` segment above, so the
  // transport lives at the root from the handler's perspective.
  mcpPath: '/',
})

Deno.serve(req => handler(rewriteRequestPath(req)))
