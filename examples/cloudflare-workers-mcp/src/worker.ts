/**
 * SolvaPay MCP server — Cloudflare Workers entrypoint.
 *
 * Single call into `createSolvaPayMcpFetch` from `@solvapay/mcp/fetch`
 * gives us a paywalled MCP server over the Workers runtime with the
 * full `@modelcontextprotocol/sdk` wiring, `hideToolsByAudience` for
 * text-host clients, and the `WebStandardStreamableHTTPServerTransport`
 * stateless-JSON preset (correct shape for Workers isolates, which
 * don't pin across requests).
 *
 * The only extra plumbing on top of the SDK handler is **browser-origin
 * CORS** — native-scheme clients (Cursor / VS Code / Claude Desktop)
 * are handled by the SDK; we additionally mirror `Origin` back +
 * expose `WWW-Authenticate` + `Mcp-Session-Id` for browser MCP clients
 * (ChatGPT Custom Connectors, MCP Inspector web UI).
 */

import { createSolvaPay } from '@solvapay/server'
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

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method === 'OPTIONS') return browserCorsPreflight(req)

    const apiBaseUrl = env.SOLVAPAY_API_BASE_URL ?? 'https://api-dev.solvapay.com'
    const handler = createSolvaPayMcpFetch({
      solvaPay: createSolvaPay({
        apiKey: requireEnv(env, 'SOLVAPAY_SECRET_KEY'),
        apiBaseUrl,
      }),
      productRef: requireEnv(env, 'SOLVAPAY_PRODUCT_REF'),
      resourceUri: 'ui://cloudflare-workers-mcp/mcp-app.html',
      readHtml: async () => mcpAppHtml,
      publicBaseUrl: requireEnv(env, 'MCP_PUBLIC_BASE_URL'),
      apiBaseUrl,
      mode: 'json-stateless',
      hideToolsByAudience: ['ui'],
      ...(demoToolsEnabled(env as unknown as Record<string, string | undefined>)
        ? { additionalTools: registerDemoTools }
        : {}),
    })

    const response = await handler(req)
    return applyBrowserCors(req, response)
  },
} satisfies ExportedHandler<Env>
