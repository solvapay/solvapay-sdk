/**
 * SolvaPay MCP server — Supabase Edge Function entrypoint.
 *
 * Goldberg demo variant: wires the `@solvapay/mcp-fetch` OAuth bridge
 * + CORS helpers directly to a module-level singleton
 * `WebStandardStreamableHTTPServerTransport` so stateful MCP sessions
 * (initialize → initialized → tools/list) work inside a single warm
 * Supabase edge isolate.
 *
 * Two reasons we don't use `createSolvaPayMcpFetchHandler` directly:
 *
 *  1. The SDK's helper destructures `sessionIdGenerator =
 *     defaultSessionIdGenerator`, which silently swaps our
 *     `sessionIdGenerator: undefined` (stateless-mode intent) back to
 *     `crypto.randomUUID`. The transport therefore emits an
 *     `mcp-session-id` on initialize, but then validates follow-ups
 *     against a per-request fresh transport that never saw the
 *     initialize — every request after initialize 400s with
 *     "Bad Request: Server not initialized".
 *
 *  2. The SDK helper constructs a new transport per request. Even
 *     with true stateless mode that'd be fine, but for clients that
 *     echo `mcp-session-id` back (ChatGPT connector, MCP Inspector)
 *     we need `_initialized` to persist across requests. A module-
 *     level singleton transport does exactly that for the lifetime
 *     of the isolate.
 *
 * Supabase's edge gateway strips `/functions/v1` on the way in, so
 * incoming paths look like `/mcp/…`. We drop that `/mcp` segment
 * before the OAuth router / MCP transport see the request, and serve
 * the MCP transport at the root of the normalised path. The public
 * URL (set in `MCP_PUBLIC_BASE_URL`) points at the Cloudflare Worker
 * proxy (`https://mcp-goldberg.solvapay.com`) which forwards every
 * path verbatim to `/functions/v1/mcp/<path>` on Supabase.
 */

import 'jsr:@supabase/functions-js/edge-runtime.d.ts'

import { createSolvaPay } from '@solvapay/server'
import { createSolvaPayMcpServer } from '@solvapay/mcp'
import {
  applyNativeCors,
  authChallenge,
  buildAuthInfoFromBearer,
  corsPreflight,
  createOAuthFetchRouter,
  McpBearerAuthError,
} from '@solvapay/mcp-fetch'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { demoToolsEnabled, registerDemoTools } from './demo-tools.ts'

function requireEnv(name: string): string {
  const value = Deno.env.get(name)
  if (!value) {
    throw new Error(`${name} is not set — copy .env.example to Supabase secrets`)
  }
  return value
}

const FUNCTION_MOUNT_PREFIX = '/mcp'
const MCP_PATH = '/mcp'

function rewriteRequestPath(req: Request): Request {
  const url = new URL(req.url)
  if (!url.pathname.startsWith(FUNCTION_MOUNT_PREFIX)) return req
  url.pathname = url.pathname.slice(FUNCTION_MOUNT_PREFIX.length) || '/'
  return new Request(url, req)
}

/**
 * Mirror the request `Origin` header back on every response so
 * browser-origin MCP clients (ChatGPT Custom Connectors, MCP Inspector
 * web UI) can connect. Safe without `Allow-Credentials: true` because
 * auth is bearer-token only.
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

const solvaPay = createSolvaPay({
  apiKey: requireEnv('SOLVAPAY_SECRET_KEY'),
  apiBaseUrl: Deno.env.get('SOLVAPAY_API_BASE_URL'),
})
const productRef = requireEnv('SOLVAPAY_PRODUCT_REF')
const publicBaseUrl = requireEnv('MCP_PUBLIC_BASE_URL')
const apiBaseUrl = Deno.env.get('SOLVAPAY_API_BASE_URL') ?? 'https://api.solvapay.com'

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

// Hide UI-only virtual tools from `tools/list` for text-host MCP
// clients (Claude Haiku via MCPJam, ChatGPT connector, etc.) that
// don't mount the SolvaPay iframe surface. These tools stay
// callable so the iframe can still invoke them for server-side
// work (e.g. `create_topup_payment_intent` when the user clicks
// "Pay $10" in the top-up view) — we just filter them out of the
// default `tools/list` shape so the LLM's tool catalogue only
// surfaces the four intent tools
// (`upgrade` / `manage_account` / `activate_plan` / `topup`) + the
// merchant-registered data tools (`predict_price_chart`,
// `predict_direction`).
//
// Wrap the SDK's built-in tools/list handler instead of replacing
// it: the built-in one does the zod → JSON-schema conversion via
// `toJsonSchemaCompat`, and reimplementing that here would
// duplicate SDK internals. We read the existing handler out of the
// protocol's `_requestHandlers` map, call it, then drop entries
// with `_meta.audience === 'ui'` from the response.
{
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const innerServer = (server as any).server
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handlers = innerServer._requestHandlers as Map<string, (req: unknown, extra: unknown) => Promise<{ tools: Array<{ _meta?: { audience?: unknown } }> }>>
  const method = 'tools/list'
  const original = handlers.get(method)
  if (original) {
    handlers.set(method, async (req, extra) => {
      const response = await original(req, extra)
      const filtered = (response.tools ?? []).filter(
        t => (t._meta as { audience?: unknown } | undefined)?.audience !== 'ui',
      )
      return { ...response, tools: filtered }
    })
  }
}

const oauthRouter = createOAuthFetchRouter({
  publicBaseUrl,
  apiBaseUrl,
  productRef,
})

// Serialize server connect/close cycles so two concurrent requests
// don't race on the shared server's `_transport` slot. The protocol
// guard throws on double-connect, so we queue each request behind
// the previous one's close. Fine for low-throughput demo traffic;
// a production deployment would partition by session or fan out to
// multiple server instances.
let serverMutex: Promise<void> = Promise.resolve()

async function handleMcpRequest(req: Request): Promise<Response> {
  // Bearer auth guard — rejects with a 401 + WWW-Authenticate
  // `resource_metadata="…"` hint so MCP clients know where to do
  // DCR + OAuth discovery.
  const authHeader = req.headers.get('authorization')
  let authInfo: ReturnType<typeof buildAuthInfoFromBearer> = null
  try {
    authInfo = buildAuthInfoFromBearer(authHeader)
    if (!authInfo) throw new McpBearerAuthError('Missing bearer token')
  } catch {
    return authChallenge(req, { publicBaseUrl })
  }

  // Wait for any in-flight request to finish its connect/close cycle.
  const previous = serverMutex
  let resolveThis: (() => void) | null = null
  serverMutex = new Promise<void>(resolve => {
    resolveThis = resolve
  })
  await previous

  // Fresh transport per request in stateless mode — the SDK's guard
  // at webStandardStreamableHttp.js:139 refuses to reuse a stateless
  // transport because messages from concurrent clients would
  // collide on shared JSON-RPC ids. `sessionIdGenerator: undefined`
  // also puts the validator into the early-return branch at
  // validateSession():585, so follow-up requests from clients that
  // skip `mcp-session-id` (stateless-friendly) pass straight through.
  //
  // `enableJsonResponse: true` switches the transport from SSE
  // streaming to single-JSON-response mode — `handleRequest` returns
  // a Promise that resolves once the full JSON-RPC response is
  // assembled. Without this the SSE stream would be cut off by our
  // `transport.close()` in the finally block before the actual
  // tool-result frame is written.
  //
  // `server.connect(transport)` takes ownership of the server's
  // `_transport` slot; `transport.close()` in the finally block
  // triggers the protocol's `_onclose` which nulls the slot so the
  // next request's `connect(...)` call doesn't throw "Already
  // connected to a transport".
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  })
  try {
    await server.connect(transport)
    const response = await transport.handleRequest(
      req,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { authInfo: authInfo as any },
    )
    const merged = new Headers(response.headers)
    applyNativeCors(req.headers, merged)
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: merged,
    })
  } catch (error) {
    const headers = new Headers({ 'content-type': 'application/json' })
    applyNativeCors(req.headers, headers)
    return new Response(
      JSON.stringify({
        jsonrpc: '2.0',
        id: null,
        error: {
          code: -32603,
          message: error instanceof Error ? error.message : 'internal_error',
        },
      }),
      { status: 500, headers },
    )
  } finally {
    await transport.close().catch(() => {})
    resolveThis?.()
  }
}

Deno.serve(async req => {
  // Browser preflight — mirror Origin back so ChatGPT / Inspector can
  // complete the CORS handshake.
  if (req.method === 'OPTIONS') return browserCorsPreflight(req)

  const rewritten = rewriteRequestPath(req)
  const url = new URL(rewritten.url)

  // 1) OAuth bridge — `.well-known/*` discovery + `/oauth/*` DCR /
  //    authorize / token / revoke routes.
  const oauthResponse = await oauthRouter(rewritten)
  if (oauthResponse) return applyBrowserCors(req, oauthResponse)

  // 2) MCP JSON-RPC transport.
  if (url.pathname === MCP_PATH) {
    if (req.method !== 'POST') {
      const headers = new Headers({ Allow: 'POST, OPTIONS' })
      applyNativeCors(req.headers, headers)
      return applyBrowserCors(req, new Response(null, { status: 405, headers }))
    }
    const res = await handleMcpRequest(rewritten)
    return applyBrowserCors(req, res)
  }

  // 3) Fallback 404.
  return applyBrowserCors(req, new Response('not_found', { status: 404 }))
})
