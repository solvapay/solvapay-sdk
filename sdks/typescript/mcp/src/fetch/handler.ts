/**
 * Turnkey fetch-first MCP handler: composes OAuth routing +
 * `createMcpHandler` from `@modelcontextprotocol/server` into a
 * single `(req: Request) => Promise<Response>`. Runs on any
 * Web-standards runtime (Deno, Supabase Edge, Cloudflare Workers, Bun,
 * Next edge, Vercel Functions, Node via undici/polyfilled Web APIs).
 */

import {
  buildAuthInfoFromBearer,
  McpBearerAuthError,
  mcpAuthGate,
  pathAwareProtectedResourcePath,
  runMcpEngineRequest,
  type BuildAuthInfoFromBearerOptions,
  type McpAuthMode,
  type McpEngineConfig,
  type McpEngineHttpResult,
  type McpEnginePayable,
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
import type { McpOauthRequestClient } from '../internal/mcp-oauth-request'

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
  authMode?: McpAuthMode
  authInfo?: BuildAuthInfoFromBearerOptions
  protectedResourcePath?: string
  authorizationServerPath?: string
  oauthPaths?: OAuthBridgePaths
  oauthClient?: McpOauthRequestClient | null
  /**
   * When set, POST `/mcp` in JSON mode is routed through `mcpDispatch`
   * instead of per-tool `McpServer` registration. SSE/streamable HTTP
   * still uses `factory` + `createMcpHandler`.
   */
  engine?: {
    mcpDispatch: (params: {
      rpc: unknown
      config: Record<string, unknown>
      authHeader?: string
    }) => Promise<unknown>
    config: Omit<McpEngineConfig, 'userAgent' | 'payableTools'>
    payables: Map<string, McpEnginePayable>
    onDispatch?: (rpc: unknown) => void
    onDispatched?: (result: McpEngineHttpResult, durationMs: number) => void
  }
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

function engineHttpResponse(
  req: Request,
  result: { status: number; headers: Record<string, string>; body: unknown },
): Response {
  const headers = new Headers(result.headers)
  applyNativeCors(req.headers, headers)
  const body =
    result.body === null || result.body === undefined
      ? null
      : typeof result.body === 'string'
        ? result.body
        : JSON.stringify(result.body)
  return new Response(body, { status: result.status, headers })
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
 * 3. Enforces bearer-token auth when `requireAuth` is true (default).
 *    `authMode: 'tools-call'` (default) gates only `tools/call` so
 *    handshake / listing stay open for discovery. `authMode: 'all'`
 *    challenges every JSON-RPC method so hosts that escalate on the
 *    first 401 prompt at connect. Missing auth on a gated method
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
    authMode = 'tools-call',
    authInfo,
    protectedResourcePath,
    authorizationServerPath,
    oauthPaths,
    oauthClient,
    engine,
    responseMode,
    legacy,
    onerror,
  } = options

  const metadataPath = protectedResourcePath ?? pathAwareProtectedResourcePath(mcpPath)

  const oauthRouter = createOAuthFetchRouter({
    publicBaseUrl,
    apiBaseUrl,
    productRef,
    mcpPath,
    protectedResourcePath,
    authorizationServerPath,
    oauthPaths,
    oauthClient,
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

    const useEngine =
      engine !== undefined && (responseMode === undefined || responseMode === 'json')
    if (useEngine && engine !== undefined && req.method === 'POST') {
      let rpc: unknown
      try {
        rpc = await req.json()
      } catch {
        const headers = new Headers({ 'content-type': 'application/json' })
        applyNativeCors(req.headers, headers)
        return new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: null,
            error: { code: -32700, message: 'Parse error' },
          }),
          { status: 400, headers },
        )
      }
      const payableTools = [...engine.payables.keys()].sort()
      try {
        const result = await runMcpEngineRequest({
          mcpDispatch: engine.mcpDispatch,
          rpc,
          config: {
            ...engine.config,
            payableTools,
            authMode,
            mcpPath,
            userAgent: req.headers.get('user-agent') ?? undefined,
          },
          ...(req.headers.get('authorization')
            ? { authHeader: req.headers.get('authorization') ?? undefined }
            : {}),
          payables: engine.payables,
          ...(engine.onDispatch !== undefined ? { onDispatch: engine.onDispatch } : {}),
          ...(engine.onDispatched !== undefined ? { onDispatched: engine.onDispatched } : {}),
        })
        return engineHttpResponse(req, result)
      } catch (error) {
        const headers = new Headers({ 'content-type': 'application/json' })
        applyNativeCors(req.headers, headers)
        return new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: getJsonRpcId(rpc),
            error: {
              code: -32603,
              message: error instanceof Error ? error.message : 'internal_error',
            },
          }),
          { status: 500, headers },
        )
      }
    }

    const authHeader = req.headers.get('authorization')
    const envelope = await readJsonRpcEnvelope(req)
    if (requireAuth) {
      const gate = mcpAuthGate({
        publicBaseUrl,
        rpcMethod: envelope.method,
        authHeader,
        authMode,
        mcpPath,
        jsonRpcId: envelope.id,
      })
      if (gate.kind === 'challenge') {
        return engineHttpResponse(req, {
          status: gate.status,
          headers: gate.headers,
          body: gate.body,
        })
      }
    }

    let resolvedAuthInfo: ReturnType<typeof buildAuthInfoFromBearer> = null
    if (authHeader) {
      try {
        resolvedAuthInfo = buildAuthInfoFromBearer(authHeader, authInfo)
        if (!resolvedAuthInfo) {
          throw new McpBearerAuthError('Missing bearer token')
        }
      } catch {
        return authChallenge(req, {
          publicBaseUrl,
          protectedResourcePath: metadataPath,
          jsonRpcId: (await readJsonRpcEnvelope(req)).id,
        })
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
