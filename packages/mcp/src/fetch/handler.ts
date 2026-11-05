/**
 * Turnkey fetch-first MCP handler: composes OAuth routing +
 * `createMcpHandler` from `@modelcontextprotocol/server` into a
 * single `(req: Request) => Promise<Response>`. Runs on any
 * Web-standards runtime (Deno, Supabase Edge, Cloudflare Workers, Bun,
 * Next edge, Vercel Functions, Node via undici/polyfilled Web APIs).
 */

import {
  buildAuthInfoFromBearer,
  buildAuthInfoFromVerifiedBearer,
  McpBearerAuthError,
  withoutTrailingSlash,
  type BuildAuthInfoFromBearerOptions,
  type McpAuthInfo,
  type OAuthBridgePaths,
  type VerifiedBearer,
} from '@solvapay/mcp-core'
import {
  type CreateMcpHandlerOptions,
  type AuthInfo,
  type McpHandlerRequestOptions,
  type McpRequestContext,
  type McpServerFactory,
} from '@modelcontextprotocol/server'
import { buildMcpHandlerFace } from './legacyJsonFallback'
import {
  applyNativeCors,
  authChallenge,
  corsPreflight,
  resolveBearer,
  type BearerChallengeError,
} from './cors'
import { createExternalDiscoveryRouter, createOAuthFetchRouter } from './oauth-bridge'

/** Response shaping for modern (2026-07-28) request exchanges. */
export type McpResponseMode = NonNullable<CreateMcpHandlerOptions['responseMode']>

/**
 * Verify a bearer token and describe its subject. Return `null` for a
 * token that is well-formed but not acceptable (bad signature, expired,
 * wrong issuer or audience) — the handler answers 401 `invalid_token`.
 * Throw for anything that is not the client's fault (JWKS unreachable,
 * issuer misconfigured) — the handler answers 500 and never masks it.
 */
export type VerifyBearerToken = (token: string, req: Request) => Promise<VerifiedBearer | null>

/**
 * Put a third-party OIDC issuer in front of the MCP instead of SolvaPay's
 * customer OAuth. The handler then serves only the protected-resource
 * document (pointing at `issuers`) and verifies every bearer with
 * `verifyToken`; `/.well-known/oauth-authorization-server` and `/oauth/*`
 * are not mounted.
 */
export interface ExternalAuthorizationServerOptions {
  /**
   * Issuer URLs, emitted verbatim as PRM `authorization_servers`. Must be
   * byte-for-byte the `iss` the verifier expects and the URL the client
   * discovers: Auth0 ends in `/`, Supabase carries `/auth/v1`.
   */
  issuers: string[]
  /**
   * Scopes clients request. MCP clients ask for exactly this list and send
   * no `scope` at all when it is empty, so it is required and non-empty:
   * Auth0 needs `offline_access` for refresh tokens, userinfo-backed
   * issuers need `email` for `email_verified`.
   */
  scopesSupported: string[]
  /**
   * Canonical MCP URL the tokens are bound to; emitted as PRM `resource`
   * and expected as the token `aud`. Defaults to `${publicBaseUrl}${mcpPath}`.
   */
  resource?: string
}

export interface CreateSolvaPayMcpFetchHandlerOptions {
  /** Per-request factory that builds a fresh `McpServer` instance. */
  factory: McpServerFactory
  publicBaseUrl: string
  apiBaseUrl: string
  productRef: string
  mcpPath?: string
  requireAuth?: boolean
  /** SolvaPay-mode claim mapping for the unverified decode path. Not allowed with `authorizationServer`. */
  authInfo?: BuildAuthInfoFromBearerOptions
  protectedResourcePath?: string
  /** SolvaPay mode only. */
  authorizationServerPath?: string
  /** SolvaPay mode only. */
  oauthPaths?: OAuthBridgePaths
  /**
   * The one bearer-verification seam. Required with `authorizationServer`;
   * usable in SolvaPay mode too. Without it, SolvaPay-issued tokens are
   * decoded unverified.
   */
  verifyToken?: VerifyBearerToken
  authorizationServer?: ExternalAuthorizationServerOptions
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

async function readJsonRpcId(req: Request): Promise<string | number | null> {
  try {
    const clone = req.clone()
    const body = await clone.json()
    return getJsonRpcId(body)
  } catch {
    return null
  }
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
}

/** Issuers must be `https://`; plain `http://` is accepted only on a loopback host (local dev). */
function assertIssuerUrl(issuer: string): void {
  let url: URL
  try {
    url = new URL(issuer)
  } catch {
    throw new Error(
      `[solvapay/mcp] authorizationServer.issuers contains "${issuer}", which is not an absolute URL. Pass the issuer exactly as the authorization server advertises it (e.g. "https://tenant.eu.auth0.com/").`,
    )
  }
  if (url.protocol === 'https:') return
  if (url.protocol === 'http:' && isLoopbackHost(url.hostname)) return
  throw new Error(
    `[solvapay/mcp] authorizationServer.issuers contains "${issuer}". Issuers must use https:// (http:// is allowed only for localhost / 127.0.0.1).`,
  )
}

function assertExternalAuthorizationServerConfig(
  authorizationServer: ExternalAuthorizationServerOptions,
  options: Pick<
    CreateSolvaPayMcpFetchHandlerOptions,
    'verifyToken' | 'authInfo' | 'oauthPaths' | 'authorizationServerPath'
  >,
): void {
  const { verifyToken, authInfo, oauthPaths, authorizationServerPath } = options
  if (typeof verifyToken !== 'function') {
    throw new Error(
      '[solvapay/mcp] authorizationServer requires verifyToken: the handler cannot trust tokens from an external issuer without verifying them. Pass e.g. createJwksBearerVerifier({ issuer, audience, … }) from @solvapay/auth.',
    )
  }
  if (!Array.isArray(authorizationServer.issuers) || authorizationServer.issuers.length === 0) {
    throw new Error(
      '[solvapay/mcp] authorizationServer.issuers must list at least one issuer URL (the value the verifier expects as `iss`).',
    )
  }
  for (const issuer of authorizationServer.issuers) assertIssuerUrl(issuer)
  const scopes = authorizationServer.scopesSupported
  if (!Array.isArray(scopes) || scopes.length === 0 || scopes.some(s => !s)) {
    throw new Error(
      '[solvapay/mcp] authorizationServer.scopesSupported must be a non-empty list. MCP clients request exactly these scopes, so an empty list silently drops refresh tokens (no offline_access) or email_verified (no email). Auth0: ["openid", "profile", "email", "offline_access"].',
    )
  }
  if (authInfo !== undefined) {
    throw new Error(
      '[solvapay/mcp] authInfo configures the unverified SolvaPay decode path and cannot be combined with authorizationServer. Map claims inside verifyToken instead.',
    )
  }
  if (oauthPaths !== undefined || authorizationServerPath !== undefined) {
    throw new Error(
      '[solvapay/mcp] oauthPaths / authorizationServerPath configure the SolvaPay OAuth proxy, which is not mounted when authorizationServer is set. Remove them.',
    )
  }
}

/**
 * Build a `(req: Request) => Promise<Response>` that:
 *
 * 1. Serves `OPTIONS` preflight for native-scheme origins.
 * 2. Serves the OAuth discovery routes. SolvaPay mode: every
 *    `.well-known/*` + `/oauth/*` route via {@link createOAuthFetchRouter}.
 *    External mode (`authorizationServer`): only the protected-resource
 *    document via {@link createExternalDiscoveryRouter}.
 * 3. Enforces bearer-token auth on the MCP path (default `/mcp`):
 *    - no token → `401` + `WWW-Authenticate: Bearer resource_metadata="…"`
 *    - token rejected (`verifyToken` returned `null`, or a SolvaPay token
 *      failed to decode) → `401` with `error="invalid_token"` added
 *    - `verifyToken` threw → `500` JSON-RPC error (never masked)
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
    verifyToken,
    responseMode,
    legacy,
    onerror,
  } = options

  let discoveryRouter: (req: Request) => Promise<Response | null>
  if (options.authorizationServer) {
    assertExternalAuthorizationServerConfig(options.authorizationServer, options)
    const { issuers, scopesSupported, resource } = options.authorizationServer
    discoveryRouter = createExternalDiscoveryRouter({
      publicBaseUrl,
      apiBaseUrl,
      productRef,
      protectedResourcePath,
      issuers,
      scopesSupported,
      resource: resource ?? `${withoutTrailingSlash(publicBaseUrl)}${mcpPath}`,
    })
  } else {
    discoveryRouter = createOAuthFetchRouter({
      publicBaseUrl,
      apiBaseUrl,
      productRef,
      protectedResourcePath,
      authorizationServerPath,
      oauthPaths,
    })
  }

  const mcpHandler = buildMcpHandlerFace(factory, {
    ...(responseMode !== undefined ? { responseMode } : {}),
    ...(legacy !== undefined ? { legacy } : {}),
    ...(onerror !== undefined ? { onerror } : {}),
  })

  const challenge = async (req: Request, error?: BearerChallengeError): Promise<Response> =>
    authChallenge(req, {
      publicBaseUrl,
      protectedResourcePath,
      jsonRpcId: await readJsonRpcId(req),
      ...(error ? { error } : {}),
    })

  const internalError = async (req: Request, error: unknown): Promise<Response> => {
    const headers = new Headers({ 'content-type': 'application/json' })
    applyNativeCors(req.headers, headers)
    return new Response(
      JSON.stringify({
        jsonrpc: '2.0',
        id: await readJsonRpcId(req),
        error: {
          code: -32603,
          message: error instanceof Error ? error.message : 'internal_error',
        },
      }),
      { status: 500, headers },
    )
  }

  /**
   * Resolve the caller's `authInfo`, or a `Response` that ends the request.
   * Throws when verification itself fails for a non-client reason.
   */
  const authenticate = async (req: Request): Promise<McpAuthInfo | Response | null> => {
    const authHeader = req.headers.get('authorization')
    if (!authHeader && !requireAuth) return null

    const token = resolveBearer(req)
    if (!token) return challenge(req)

    if (verifyToken) {
      const verified = await verifyToken(token, req)
      if (!verified) return challenge(req, 'invalid_token')
      return buildAuthInfoFromVerifiedBearer(token, verified)
    }

    try {
      const decoded = buildAuthInfoFromBearer(authHeader, authInfo)
      return decoded ?? challenge(req, 'invalid_token')
    } catch (error) {
      if (error instanceof McpBearerAuthError) return challenge(req, 'invalid_token')
      throw error
    }
  }

  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url)
    const pathname = url.pathname

    if (req.method === 'OPTIONS' && pathname === mcpPath) {
      return corsPreflight(req)
    }

    const discoveryResponse = await discoveryRouter(req)
    if (discoveryResponse) return discoveryResponse

    if (pathname !== mcpPath) {
      return new Response('not_found', { status: 404 })
    }

    if (req.method && req.method !== 'POST' && req.method !== 'OPTIONS') {
      const headers = new Headers({ Allow: 'POST, OPTIONS' })
      applyNativeCors(req.headers, headers)
      return new Response(null, { status: 405, headers })
    }

    try {
      const resolvedAuthInfo = await authenticate(req)
      if (resolvedAuthInfo instanceof Response) return resolvedAuthInfo

      const fetchOptions: McpHandlerRequestOptions | undefined =
        resolvedAuthInfo && typeof resolvedAuthInfo.token === 'string'
          ? { authInfo: resolvedAuthInfo as AuthInfo }
          : undefined

      const response = await mcpHandler.fetch(req, fetchOptions)
      const merged = new Headers(response.headers)
      applyNativeCors(req.headers, merged)
      return new Response(response.body, { status: response.status, headers: merged })
    } catch (error) {
      return internalError(req, error)
    }
  }
}

export type { McpRequestContext, McpServerFactory }
