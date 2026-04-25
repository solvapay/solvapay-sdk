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
   * Optional session-id generator for the underlying
   * `WebStandardStreamableHTTPServerTransport`. Defaults to
   * `crypto.randomUUID`. Set to `undefined` for stateless mode.
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
 *    `McpServer`.
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
    sessionIdGenerator = defaultSessionIdGenerator,
  } = options

  const oauthRouter = createOAuthFetchRouter({
    publicBaseUrl,
    apiBaseUrl,
    productRef,
    protectedResourcePath,
    authorizationServerPath,
    oauthPaths,
  })

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

    // 6) Spin up a fresh transport per request and connect the server.
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator,
    })
    await server.connect(transport)

    try {
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
    }
  }
}
