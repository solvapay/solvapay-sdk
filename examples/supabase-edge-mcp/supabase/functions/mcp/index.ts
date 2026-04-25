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
 *   runtime never falls back to `node:fs/promises`.
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

Deno.serve(
  createSolvaPayMcpFetchHandler({
    server,
    publicBaseUrl,
    apiBaseUrl,
    productRef,
  }),
)
