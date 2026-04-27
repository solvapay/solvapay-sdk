/**
 * Turnkey fetch-first MCP handler: composes OAuth routing +
 * `WebStandardStreamableHTTPServerTransport` + an `McpServer` into a
 * single `(req: Request) => Promise<Response>`. Runs on any
 * Web-standards runtime (Deno, Supabase Edge, Cloudflare Workers, Bun,
 * Next edge, Vercel Functions, Node via undici/polyfilled Web APIs).
 */

import {
  buildAuthInfoFromBearer,
  McpBearerAuthError,
  type BuildAuthInfoFromBearerOptions,
  type OAuthBridgePaths,
} from '@solvapay/mcp-core'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { applyNativeCors, authChallenge, corsPreflight } from './cors'
import { createOAuthFetchRouter } from './oauth-bridge'

/**
 * Transport wiring preset.
 *
 * - `'sse-stateful'` — default. SSE streaming + UUID `mcp-session-id`
 *   on initialize. Matches the original helper behaviour and is what
 *   Node / Express / Bun deployments expect.
 * - `'json-stateless'` — `{ sessionIdGenerator: undefined,
 *   enableJsonResponse: true }`. Required on stateless fetch runtimes
 *   (Supabase Edge, Cloudflare Workers, Vercel Edge, Deno Deploy) that
 *   can't keep per-session state across invocations and need a
 *   single-JSON-response wire shape so the response body is assembled
 *   before the per-request transport is closed.
 * - `'sse-stateless'` — SSE streaming without session IDs. Advanced /
 *   hypothetical; provided for symmetry. Most stateless runtimes want
 *   `'json-stateless'` instead (a cut SSE stream drops the response
 *   frame).
 */
export type McpHandlerMode = 'sse-stateful' | 'json-stateless' | 'sse-stateless'

export interface CreateSolvaPayMcpFetchHandlerOptions {
  server: McpServer
  publicBaseUrl: string
  apiBaseUrl: string
  productRef: string
  mcpPath?: string
  requireAuth?: boolean
  authInfo?: BuildAuthInfoFromBearerOptions
  protectedResourcePath?: string
  authorizationServerPath?: string
  oauthPaths?: OAuthBridgePaths
  /**
   * Transport wiring preset. Defaults to `'sse-stateful'` to preserve
   * the Node / Express / Bun behaviour of earlier versions. Stateless
   * fetch runtimes (Supabase Edge, Cloudflare Workers, Vercel Edge)
   * should pass `'json-stateless'`.
   *
   * Ignored when `buildTransport` is provided.
   */
  mode?: McpHandlerMode
  /**
   * Escape hatch: bring your own transport builder. When provided,
   * `mode` and `sessionIdGenerator` are ignored — the caller owns the
   * transport's configuration. The handler still manages
   * `server.connect(transport)` + `transport.close()` per request and
   * serialises concurrent requests through the shared-server mutex.
   */
  buildTransport?: () => WebStandardStreamableHTTPServerTransport
  /**
   * Optional session-id generator for the underlying
   * `WebStandardStreamableHTTPServerTransport`. Only honoured in the
   * default `'sse-stateful'` mode; ignored in stateless modes (which
   * pass `sessionIdGenerator: undefined` to disable session tracking)
   * and when `buildTransport` is provided.
   *
   * Defaults to `crypto.randomUUID`.
   */
  sessionIdGenerator?: () => string
}

function defaultSessionIdGenerator(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto
  if (c?.randomUUID) return c.randomUUID()
  // Fallback: RFC4122-ish v4 (non-cryptographic, last-resort for runtimes
  // without globalThis.crypto — shouldn't happen on any modern Web runtime).
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, ch => {
    const r = Math.floor(Math.random() * 16)
    const v = ch === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

function getJsonRpcId(body: unknown): string | number | null {
  if (body && typeof body === 'object' && 'id' in body) {
    const id = (body as { id?: string | number | null }).id
    return id ?? null
  }
  return null
}

async function readJsonRpcId(req: Request): Promise<string | number | null> {
  try {
    const clone = req.clone()
    const body = await clone.json()
    return getJsonRpcId(body)
  } catch {
    return null
  }
}

/**
 * Build a `(req: Request) => Promise<Response>` that:
 *
 * 1. Serves `OPTIONS` preflight for native-scheme origins.
 * 2. Serves every `.well-known/*` + `/oauth/*` route via
 *    {@link createOAuthFetchRouter}.
 * 3. Enforces bearer-token auth on the MCP path (default `/mcp`) and
 *    returns `401 + WWW-Authenticate: Bearer resource_metadata="…"`
 *    when auth is missing.
 * 4. Forwards the request to a fresh
 *    `WebStandardStreamableHTTPServerTransport` wired to the provided
 *    `McpServer`. The transport's `close()` runs in a `finally` block
 *    so the server's `_transport` slot is released for the next
 *    request; concurrent requests serialise through a shared mutex so
 *    two overlapping calls never double-connect the same `McpServer`.
 *
 * A fresh transport is created per request — that's the recommended
 * pattern for stateless fetch runtimes (Workers, Deno, Supabase Edge).
 * For long-lived session reuse, consume the low-level
 * {@link createOAuthFetchRouter} + instantiate the transport yourself.
 */
export function createSolvaPayMcpFetchHandler(
  options: CreateSolvaPayMcpFetchHandlerOptions,
): (req: Request) => Promise<Response> {
  const {
    server,
    publicBaseUrl,
    apiBaseUrl,
    productRef,
    mcpPath = '/mcp',
    requireAuth = true,
    authInfo,
    protectedResourcePath,
    authorizationServerPath,
    oauthPaths,
    mode = 'sse-stateful',
    buildTransport,
    sessionIdGenerator,
  } = options

  const oauthRouter = createOAuthFetchRouter({
    publicBaseUrl,
    apiBaseUrl,
    productRef,
    protectedResourcePath,
    authorizationServerPath,
    oauthPaths,
  })

  // Construct the per-request transport based on `mode`. The stateless
  // modes pass `sessionIdGenerator: undefined` explicitly so the
  // transport's `validateSession()` early-return branch is reachable
  // for clients that don't echo `mcp-session-id` back. `json-stateless`
  // also flips the response wire shape to a single JSON body, which is
  // what makes the `transport.close()` in the finally block safe for
  // stateless fetch runtimes (an SSE stream would otherwise be cut off
  // before the final tool-result frame is written).
  const makeTransport = (): WebStandardStreamableHTTPServerTransport => {
    if (buildTransport) return buildTransport()
    if (mode === 'json-stateless') {
      return new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      })
    }
    if (mode === 'sse-stateless') {
      return new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      })
    }
    return new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: sessionIdGenerator ?? defaultSessionIdGenerator,
    })
  }

  // Serialise server connect/close cycles. `McpServer._transport` is a
  // single slot — the protocol's `connect()` throws "Already connected
  // to a transport" if it's set, and only `transport.close()` (which
  // fires the protocol's `_onclose` handler) nulls it. Two overlapping
  // requests would therefore race on this slot; we queue each request
  // behind the previous one's close to sidestep the race entirely.
  // Fine for the low-throughput edge-function case; high-throughput
  // deployments should fan out to multiple `McpServer` instances.
  let serverMutex: Promise<void> = Promise.resolve()

  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url)
    const pathname = url.pathname

    // 1) Root-level OPTIONS preflight for native origins outside OAuth paths.
    if (req.method === 'OPTIONS' && pathname === mcpPath) {
      return corsPreflight(req)
    }

    // 2) OAuth routes.
    const oauthResponse = await oauthRouter(req)
    if (oauthResponse) return oauthResponse

    // 3) Only handle the MCP path.
    if (pathname !== mcpPath) {
      return new Response('not_found', { status: 404 })
    }

    // 4) GET /mcp — Cursor-style SSE back-channel probe. Stateless
    //    servers can't serve it; respond 405 so the client doesn't
    //    transition to failed on a 400.
    if (req.method && req.method !== 'POST' && req.method !== 'OPTIONS') {
      const headers = new Headers({ Allow: 'POST, OPTIONS' })
      applyNativeCors(req.headers, headers)
      return new Response(null, { status: 405, headers })
    }

    // 5) Bearer auth guard.
    const authHeader = req.headers.get('authorization')
    let resolvedAuthInfo: ReturnType<typeof buildAuthInfoFromBearer> = null
    if (authHeader || requireAuth) {
      try {
        resolvedAuthInfo = buildAuthInfoFromBearer(authHeader, authInfo)
        if (!resolvedAuthInfo) {
          throw new McpBearerAuthError('Missing bearer token')
        }
      } catch {
        const jsonRpcId = await readJsonRpcId(req)
        return authChallenge(req, {
          publicBaseUrl,
          protectedResourcePath,
          jsonRpcId,
        })
      }
    }

    // 6) Serialise behind the previous in-flight request's close cycle.
    const previous = serverMutex
    let releaseMutex: () => void = () => {}
    serverMutex = new Promise<void>(resolve => {
      releaseMutex = resolve
    })
    await previous

    // 7) Spin up a fresh transport per request and connect the server.
    const transport = makeTransport()
    try {
      await server.connect(transport)
      const response = await transport.handleRequest(
        req,
        resolvedAuthInfo
          ? {
              // `AuthInfo` from the SDK is structurally identical to our
              // envelope — cast away the brand so the types line up.
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              authInfo: resolvedAuthInfo as any,
            }
          : undefined,
      )

      const merged = new Headers(response.headers)
      applyNativeCors(req.headers, merged)
      return new Response(response.body, { status: response.status, headers: merged })
    } catch (error) {
      const headers = new Headers({ 'content-type': 'application/json' })
      applyNativeCors(req.headers, headers)
      const jsonRpcId = await readJsonRpcId(req)
      return new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id: jsonRpcId,
          error: {
            code: -32603,
            message: error instanceof Error ? error.message : 'internal_error',
          },
        }),
        { status: 500, headers },
      )
    } finally {
      // `close()` is idempotent on every mode (see
      // `webStandardStreamableHttp.js` — `close()` walks the stream
      // map and calls `_onclose`, which triggers the protocol's
      // `_onclose` to null the server's `_transport` slot). Swallow
      // errors so a failed close never masks the real response /
      // error above.
      await transport.close().catch(() => {})
      releaseMutex()
    }
  }
}
