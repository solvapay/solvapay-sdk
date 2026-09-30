/**
 * SolvaPay MCP server — Cloudflare Workers entrypoint.
 *
 * Single call into `createSolvaPayMcpFetch` from `@solvapay/mcp/fetch`
 * gives us a paywalled MCP server over the Workers runtime with the
 * full `@modelcontextprotocol/server` wiring, `hideToolsByAudience` for
 * a trim LLM-facing catalogue (with auto-bypass on ChatGPT so the
 * iframe still works), and `responseMode: 'json'` (correct shape for
 * Workers isolates, which don't pin across requests).
 *
 * Two pieces of plumbing sit on top of the SDK handler. A merchant
 * branding lookup feeds SEP-973 `serverInfo.icons`, tool icons, and
 * widget branding; a failed lookup throws and is not cached. Browser-
 * origin CORS mirrors `Origin` and exposes `WWW-Authenticate` plus
 * `Mcp-Session-Id` for browser MCP clients (ChatGPT Custom Connectors,
 * MCP Inspector web UI). Native-scheme clients (Cursor / VS Code /
 * Claude Desktop) are handled by the SDK.
 */

import type { SolvaPayMerchantBranding } from '@solvapay/mcp-core'
import { createSolvaPay, type SolvaPay } from '@solvapay/server'
import { createSolvaPayMcpFetch } from '@solvapay/mcp/fetch'
import { demoToolsEnabled, registerDemoTools } from './demo-tools'
import mcpAppHtml from './assets/mcp-app.html'

interface Env {
  SOLVAPAY_SECRET_KEY: string
  SOLVAPAY_PRODUCT_REF: string
  MCP_PUBLIC_BASE_URL: string
  SOLVAPAY_API_BASE_URL?: string
  DEMO_TOOLS?: string
}

function requireEnv(env: Env, name: keyof Env): string {
  const value = env[name]
  if (!value) {
    throw new Error(
      `${name} is not set — check wrangler.jsonc \`vars\` block or run \`wrangler secret put ${name}\``,
    )
  }
  return value
}

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
      exposed ? `${exposed}, WWW-Authenticate, Mcp-Session-Id` : 'WWW-Authenticate, Mcp-Session-Id',
    )
  }
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers })
}

function browserCorsPreflight(req: Request): Response {
  const requestedMethod = req.headers.get('access-control-request-method') ?? 'POST'
  const requestedHeaders =
    req.headers.get('access-control-request-headers') ??
    'authorization, content-type, mcp-session-id, mcp-protocol-version'
  const headers = new Headers()
  headers.set('Access-Control-Allow-Methods', `${requestedMethod}, OPTIONS`)
  headers.set('Access-Control-Allow-Headers', requestedHeaders)
  headers.set('Access-Control-Max-Age', '600')
  return applyBrowserCors(req, new Response(null, { status: 204, headers }))
}

// Cache the handler at isolate scope so the `McpServer`, OAuth router,
// tool registrations, and merchant branding only build once per Workers
// isolate. A failed branding lookup is not cached, so the next request
// retries instead of pinning an unbranded server until the isolate dies.
// Secret or var rotations trigger a new worker version, which spins up
// a fresh isolate and a fresh cache.
let cachedHandler: ((req: Request) => Promise<Response>) | undefined

async function fetchBranding(solvaPay: SolvaPay): Promise<SolvaPayMerchantBranding> {
  if (!solvaPay.apiClient.getMerchant) {
    throw new Error('[cloudflare-workers-mcp] SolvaPay client cannot fetch the merchant')
  }
  const merchant = await solvaPay.apiClient.getMerchant()
  return {
    brandName: merchant.displayName,
    ...(merchant.iconUrl ? { iconUrl: merchant.iconUrl } : {}),
    ...(merchant.logoUrl ? { logoUrl: merchant.logoUrl } : {}),
  }
}

async function getHandler(env: Env): Promise<(req: Request) => Promise<Response>> {
  if (cachedHandler) return cachedHandler

  const apiBaseUrl = env.SOLVAPAY_API_BASE_URL ?? 'https://api.solvapay.com'
  const solvaPay = createSolvaPay({
    apiKey: requireEnv(env, 'SOLVAPAY_SECRET_KEY'),
    apiBaseUrl,
  })
  const branding = await fetchBranding(solvaPay)
  const handler = createSolvaPayMcpFetch({
    solvaPay,
    branding,
    productRef: requireEnv(env, 'SOLVAPAY_PRODUCT_REF'),
    resourceUri: 'ui://cloudflare-workers-mcp/mcp-app.html',
    readHtml: async () => mcpAppHtml,
    publicBaseUrl: requireEnv(env, 'MCP_PUBLIC_BASE_URL'),
    apiBaseUrl,
    responseMode: 'json',
    // Hide UI-only transport tools from the LLM-facing `tools/list`
    // (text hosts: Claude Desktop, MCPJam, Cursor) — keeps the model's
    // tool catalogue narrow to the two intent tools (`account`,
    // `activate_plan`) plus this worker's
    // demo tools. ChatGPT-originated tools/list requests are
    // auto-detected and receive the full catalog so the iframe's
    // `create_payment_intent` calls (plan + topup via `purpose`)
    // pass ChatGPT's gateway catalogue check.
    hideToolsByAudience: ['ui'],
    ...(demoToolsEnabled(env as unknown as Record<string, string | undefined>)
      ? { additionalTools: registerDemoTools }
      : {}),
  })
  cachedHandler = handler
  return handler
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method === 'OPTIONS') return browserCorsPreflight(req)
    const handler = await getHandler(env)
    return applyBrowserCors(req, await handler(req))
  },
} satisfies ExportedHandler<Env>
