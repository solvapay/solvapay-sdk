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

/**
 * Mirror the request `Origin` header back on every response so
 * browser-origin MCP clients (ChatGPT Custom Connectors, MCP Inspector
 * web UI, anything served from an `https://…` origin) can connect.
 *
 * `@solvapay/mcp-fetch`'s built-in CORS helper only mirrors native
 * schemes (`cursor://`, `vscode://`, `claude://`) by design. For a
 * public MCP endpoint fronted by Bearer-token auth (no cookies, no
 * `credentials: 'include'`) the safe browser-compat move is to echo
 * `Origin` back + `Vary: Origin`, and keep `Access-Control-Expose-
 * Headers: WWW-Authenticate` so clients see the DCR discovery
 * challenge on 401.
 *
 * OPTIONS preflights also get the mirror + the `Access-Control-Allow-
 * Methods` / `Allow-Headers` / `Max-Age` envelope so the browser's
 * CORS cache warms on the first call.
 */
function applyBrowserCors(req: Request, res: Response): Response {
  const origin = req.headers.get('origin')
  if (!origin) return res

  const headers = new Headers(res.headers)
  if (!headers.has('access-control-allow-origin')) {
    headers.set('Access-Control-Allow-Origin', origin)
    const vary = headers.get('vary')
    headers.set('Vary', vary ? `${vary}, Origin` : 'Origin')
  }
  const exposed = headers.get('access-control-expose-headers')
  if (!exposed || !/www-authenticate/i.test(exposed)) {
    headers.set(
      'Access-Control-Expose-Headers',
      exposed ? `${exposed}, WWW-Authenticate` : 'WWW-Authenticate',
    )
  }
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers })
}

function browserCorsPreflight(req: Request): Response {
  const requestedMethod = req.headers.get('access-control-request-method') ?? 'POST'
  const requestedHeaders =
    req.headers.get('access-control-request-headers') ?? 'authorization, content-type, mcp-session-id'

  const headers = new Headers()
  headers.set('Access-Control-Allow-Methods', `${requestedMethod}, OPTIONS`)
  headers.set('Access-Control-Allow-Headers', requestedHeaders)
  headers.set('Access-Control-Max-Age', '600')
  return applyBrowserCors(req, new Response(null, { status: 204, headers }))
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
  // MCP clients (Inspector, ChatGPT connector) POST the JSON-RPC
  // transport to `<resource>/mcp` by convention. Since we strip the
  // Supabase function's `/mcp` mount prefix before the handler sees
  // the request, `POST https://mcp-goldberg.solvapay.com/mcp` arrives
  // here with pathname `/mcp`, which matches this option. The
  // `.well-known/*` and `/oauth/*` routes are unaffected — they match
  // the OAuth bridge first, before the `pathname !== mcpPath` 404
  // fallthrough.
  mcpPath: '/mcp',
})

Deno.serve(async req => {
  // Short-circuit every browser preflight so the SDK's native-scheme-
  // only CORS helper doesn't swallow `Origin: https://…` requests.
  if (req.method === 'OPTIONS') return browserCorsPreflight(req)

  const res = await handler(rewriteRequestPath(req))
  return applyBrowserCors(req, res)
})
