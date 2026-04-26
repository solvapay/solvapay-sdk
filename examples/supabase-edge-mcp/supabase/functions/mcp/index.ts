/**
 * SolvaPay MCP server — Supabase Edge Function entrypoint.
 *
 * Single call into `createSolvaPayMcpFetch` from `@solvapay/mcp/fetch`
 * gives us a paywalled MCP server over Deno with the full
 * `@modelcontextprotocol/sdk` wiring, `hideToolsByAudience` for
 * text-host clients, and the `WebStandardStreamableHTTPServerTransport`
 * stateless-JSON preset. The only things the Edge deployment still
 * hand-rolls are:
 *
 *  1. **Supabase mount-prefix rewrite** — the edge gateway strips
 *     `/functions/v1` but still delivers paths beginning with `/mcp`
 *     (the function name). We drop that `/mcp` segment so the router
 *     inside `createSolvaPayMcpFetch` sees the route at the root.
 *  2. **Browser-origin CORS** — native-scheme clients (Cursor /
 *     VS Code / Claude) are handled by the SDK; we additionally
 *     mirror `Origin` back + expose `WWW-Authenticate` + `Mcp-Session-Id`
 *     for browser MCP clients (ChatGPT Custom Connectors, MCP
 *     Inspector web UI).
 */

import 'jsr:@supabase/functions-js/edge-runtime.d.ts'

import { createSolvaPay } from '@solvapay/server'
import { createSolvaPayMcpFetch } from '@solvapay/mcp/fetch'
import { demoToolsEnabled, registerDemoTools } from './demo-tools.ts'

function requireEnv(name: string): string {
  const value = Deno.env.get(name)
  if (!value) throw new Error(`${name} is not set — copy .env.example to Supabase secrets`)
  return value
}

const FUNCTION_MOUNT_PREFIX = '/mcp'

function rewriteRequestPath(req: Request): Request {
  const url = new URL(req.url)
  if (!url.pathname.startsWith(FUNCTION_MOUNT_PREFIX)) return req
  url.pathname = url.pathname.slice(FUNCTION_MOUNT_PREFIX.length) || '/'
  return new Request(url, req)
}

// Mirror Origin back on every response so browser-origin MCP clients
// (ChatGPT Custom Connectors, MCP Inspector web UI) complete the CORS
// handshake. Safe without `Allow-Credentials: true` because auth is
// bearer-token only.
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

const publicBaseUrl = requireEnv('MCP_PUBLIC_BASE_URL')
const apiBaseUrl = Deno.env.get('SOLVAPAY_API_BASE_URL') ?? 'https://api.solvapay.com'
const htmlUrl = new URL('./mcp-app.html', import.meta.url)
const html = await Deno.readTextFile(htmlUrl)

const handler = createSolvaPayMcpFetch({
  solvaPay: createSolvaPay({
    apiKey: requireEnv('SOLVAPAY_SECRET_KEY'),
    apiBaseUrl: Deno.env.get('SOLVAPAY_API_BASE_URL'),
  }),
  productRef: requireEnv('SOLVAPAY_PRODUCT_REF'),
  resourceUri: 'ui://supabase-edge-mcp/mcp-app.html',
  readHtml: async () => html,
  publicBaseUrl,
  apiBaseUrl,
  mode: 'json-stateless',
  // Hide UI-only virtual tools from `tools/list` for text-host clients
  // (Claude Haiku via MCPJam, ChatGPT connector, etc.) that don't
  // mount the iframe surface. Tools stay callable so the iframe can
  // still invoke them server-side.
  hideToolsByAudience: ['ui'],
  ...(demoToolsEnabled() ? { additionalTools: registerDemoTools } : {}),
})

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return browserCorsPreflight(req)
  const response = await handler(rewriteRequestPath(req))
  return applyBrowserCors(req, response)
})
