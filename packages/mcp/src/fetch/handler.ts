/**
 * Turnkey fetch-first MCP handler: composes OAuth routing +
 * `createMcpHandler` from `@modelcontextprotocol/server` into a
 * single `(req: Request) => Promise<Response>`. Runs on any
 * Web-standards runtime (Deno, Supabase Edge, Cloudflare Workers, Bun,
 * Next edge, Vercel Functions, Node via undici/polyfilled Web APIs).
 */

import {
  buildAuthInfoFromBearer,
  isFreeMcpMethod,
  McpBearerAuthError,
  type BuildAuthInfoFromBearerOptions,
  type OAuthBridgePaths,
} from '@solvapay/mcp-core'
import {
  type CreateMcpHandlerOptions,
  type AuthInfo,
  type McpHandlerRequestOptions,
  type McpRequestContext,
  type McpServerFactory,
} from '@modelcontextprotocol/server'
import { buildMcpHandlerFace } from './legacyJsonFallback'
import { applyNativeCors, authChallenge, corsPreflight } from './cors'
import { createOAuthFetchRouter } from './oauth-bridge'

/** Response shaping for modern (2026-07-28) request exchanges. */
export type McpResponseMode = NonNullable<CreateMcpHandlerOptions['responseMode']>

export interface CreateSolvaPayMcpFetchHandlerOptions {
  /** Per-request factory that builds a fresh `McpServer` instance. */
  factory: McpServerFactory
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
   * Response shaping for modern (2026-07-28) traffic. Edge runtimes that
   * cannot hold a stream should pass `'json'` (single JSON body; mid-call
   * notifications are dropped). Defaults to `'auto'`.
   *
   * Legacy (2025-era) traffic uses single-JSON responses when
   * `responseMode: 'json'` (edge runtimes). Otherwise the SDK's built-in
   * `legacy: 'stateless'` SSE fallback applies.
   */
  responseMode?: McpResponseMode
  /**
   * How 2025-era traffic is served. Defaults to `'stateless'` so today's
   * hosts (Claude Desktop, ChatGPT, Cursor) keep working at zero cost.
   */
  legacy?: CreateMcpHandlerOptions['legacy']
  /** Forwarded to `createMcpHandler` for out-of-band error reporting. */
  onerror?: CreateMcpHandlerOptions['onerror']
}

function getJsonRpcId(body: unknown): string | number | null {
  if (body && typeof body === 'object' && 'id' in body) {
    const id = (body as { id?: string | number | null }).id
    return id ?? null
  }
  return null
}

function getJsonRpcMethod(body: unknown): string | undefined {
  if (body && typeof body === 'object' && 'method' in body) {
    const method = (body as { method?: unknown }).method
    return typeof method === 'string' ? method : undefined
  }
  return undefined
}

async function readJsonRpcEnvelope(
  req: Request,
): Promise<{ id: string | number | null; method?: string }> {
  try {
    const clone = req.clone()
    const body = await clone.json()
    return { id: getJsonRpcId(body), method: getJsonRpcMethod(body) }
  } catch {
    return { id: null }
  }
}

/**
 * Build a `(req: Request) => Promise<Response>` that:
 *
 * 1. Serves `OPTIONS` preflight for native-scheme origins.
 * 2. Serves every `.well-known/*` + `/oauth/*` route via
 *    {@link createOAuthFetchRouter}.
 * 3. Enforces bearer-token auth on `tools/call` when `requireAuth`
 *    is true (default). Handshake / listing methods (`initialize`,
 *    `tools/list`, …) stay open so clients and no-code discovery can
 *    connect without a customer JWT. Missing auth on a gated method
 *    returns `401 + WWW-Authenticate: Bearer resource_metadata="…"`.
 * 4. Forwards authenticated MCP requests to `createMcpHandler`'s
 *    `{ fetch }` face with `{ authInfo }` pass-through.
 */
export function createSolvaPayMcpFetchHandler(
  options: CreateSolvaPayMcpFetchHandlerOptions,
): (req: Request) => Promise<Response> {
  const {
    factory,
    publicBaseUrl,
    apiBaseUrl,
    productRef,
    mcpPath = '/mcp',
    requireAuth = true,
    authInfo,
    protectedResourcePath,
    authorizationServerPath,
    oauthPaths,
    responseMode,
    legacy,
    onerror,
  } = options

  const oauthRouter = createOAuthFetchRouter({
    publicBaseUrl,
    apiBaseUrl,
    productRef,
    protectedResourcePath,
    authorizationServerPath,
    oauthPaths,
  })

  const mcpHandler = buildMcpHandlerFace(factory, {
    ...(responseMode !== undefined ? { responseMode } : {}),
    ...(legacy !== undefined ? { legacy } : {}),
    ...(onerror !== undefined ? { onerror } : {}),
  })

  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url)
    const pathname = url.pathname

    if (req.method === 'OPTIONS' && pathname === mcpPath) {
      return corsPreflight(req)
    }

    const oauthResponse = await oauthRouter(req)
    if (oauthResponse) return oauthResponse

    if (pathname !== mcpPath) {
      return new Response('not_found', { status: 404 })
    }

    if (req.method && req.method !== 'POST' && req.method !== 'OPTIONS') {
      const headers = new Headers({ Allow: 'POST, OPTIONS' })
      applyNativeCors(req.headers, headers)
      return new Response(null, { status: 405, headers })
    }

    const authHeader = req.headers.get('authorization')
    let resolvedAuthInfo: ReturnType<typeof buildAuthInfoFromBearer> = null
    if (authHeader || requireAuth) {
      const envelope = await readJsonRpcEnvelope(req)
      const skipAuth = requireAuth && !authHeader && isFreeMcpMethod(envelope.method)
      if (!skipAuth) {
        try {
          resolvedAuthInfo = buildAuthInfoFromBearer(authHeader, authInfo)
          if (!resolvedAuthInfo) {
            throw new McpBearerAuthError('Missing bearer token')
          }
        } catch {
          return authChallenge(req, {
            publicBaseUrl,
            protectedResourcePath,
            jsonRpcId: envelope.id,
          })
        }
      }
    }

    const fetchOptions: McpHandlerRequestOptions | undefined =
      resolvedAuthInfo && typeof resolvedAuthInfo.token === 'string'
        ? { authInfo: resolvedAuthInfo as AuthInfo }
        : undefined

    try {
      const response = await mcpHandler.fetch(req, fetchOptions)
      const merged = new Headers(response.headers)
      applyNativeCors(req.headers, merged)
      return new Response(response.body, { status: response.status, headers: merged })
    } catch (error) {
      const headers = new Headers({ 'content-type': 'application/json' })
      applyNativeCors(req.headers, headers)
      const jsonRpcId = (await readJsonRpcEnvelope(req)).id
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

export type { McpRequestContext, McpServerFactory }
