/**
 * Node `(req, res, next)` OAuth bridge middleware for the SolvaPay MCP
 * server.
 *
 * Route bodies go through `mcpOauthRequest`. Path matching, CORS
 * preflight, and `mcpAuthMiddleware` stay here — those are transport.
 */

import {
  assertValidProductRef,
  logMcpConfigOnce,
  mcpNativeCors,
  withoutTrailingSlash,
  type McpAuthInfoExtras,
  type McpAuthMode,
  type OAuthBridgePaths,
} from '@solvapay/mcp-core'
import {
  DEFAULT_AUTHORIZATION_SERVER_PATH,
  DEFAULT_PROTECTED_RESOURCE_PATH,
  oauthConfig,
  oauthProxyRoutes,
} from '../internal/oauth-route-table'
import {
  mcpOauthRequest,
  requireOauthClient,
  type McpOauthRequestClient,
  type McpOauthRequestConfig,
  type McpOauthRequestResult,
} from '../internal/mcp-oauth-request'
import {
  mcpResolveAuth,
  requireResolveAuthClient,
  type McpResolveAuthClient,
} from '../internal/mcp-resolve-auth'

type JsonRpcId = string | number | null

type RequestLike = {
  method?: string
  path?: string
  url?: string
  headers?: Record<string, string | string[] | undefined>
  body?: unknown
  auth?: unknown
}

type ResponseLike = {
  status: (code: number) => ResponseLike
  json: (payload: unknown) => void
  setHeader: (name: string, value: string) => void
  end?: (body?: string) => void
  send?: (body?: string | Buffer) => void
}

type NextLike = (err?: unknown) => void
type Middleware = (req: RequestLike, res: ResponseLike, next: NextLike) => void | Promise<void>

export interface OAuthRegisterHandlerOptions {
  apiBaseUrl: string
  productRef: string
  path?: string
  publicBaseUrl?: string
  oauthClient?: McpOauthRequestClient | null
}

export interface OAuthAuthorizeHandlerOptions {
  apiBaseUrl: string
  path?: string
  publicBaseUrl?: string
  productRef?: string
  oauthClient?: McpOauthRequestClient | null
}

export interface OAuthTokenHandlerOptions {
  apiBaseUrl: string
  path?: string
  publicBaseUrl?: string
  productRef?: string
  oauthClient?: McpOauthRequestClient | null
}

export interface OAuthRevokeHandlerOptions {
  apiBaseUrl: string
  path?: string
  publicBaseUrl?: string
  productRef?: string
  oauthClient?: McpOauthRequestClient | null
}

export interface McpOAuthBridgeOptions {
  publicBaseUrl: string
  apiBaseUrl: string
  productRef: string
  mcpPath?: string
  requireAuth?: boolean
  authMode?: McpAuthMode
  authInfo?: McpAuthInfoExtras
  hs256Secret?: string
  jwksJson?: unknown
  protectedResourcePath?: string
  authorizationServerPath?: string
  oauthPaths?: OAuthBridgePaths
  oauthClient?: (McpOauthRequestClient & McpResolveAuthClient) | null
}

function getRequestAuthHeader(req: RequestLike): string | null {
  const header = req.headers?.authorization
  if (typeof header === 'string') return header
  if (Array.isArray(header)) return header[0] || null
  return null
}

function getHeader(req: RequestLike, name: string): string | null {
  const header = req.headers?.[name.toLowerCase()]
  if (typeof header === 'string') return header
  if (Array.isArray(header)) return header[0] || null
  return null
}

function getRequestJsonRpcId(body: unknown): JsonRpcId {
  if (body && typeof body === 'object' && 'id' in body) {
    const id = (body as { id?: JsonRpcId }).id
    return id ?? null
  }
  return null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object'
}

function getRequestJsonRpcMethod(body: unknown): string | undefined {
  if (body && typeof body === 'object' && 'method' in body) {
    const method = (body as { method?: unknown }).method
    return typeof method === 'string' ? method : undefined
  }
  return undefined
}

function getRequestQuery(req: RequestLike): string {
  const raw = req.url ?? req.path ?? ''
  const qIndex = raw.indexOf('?')
  return qIndex === -1 ? '' : raw.slice(qIndex)
}

function applyCorsHeaders(req: RequestLike, res: ResponseLike) {
  const { headers } = mcpNativeCors({ origin: getHeader(req, 'origin') })
  for (const [key, value] of Object.entries(headers)) {
    res.setHeader(key, value)
  }
}

function requestHeaders(req: RequestLike): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(req.headers ?? {})) {
    if (typeof value === 'string') out[key.toLowerCase()] = value
    else if (Array.isArray(value) && value[0]) out[key.toLowerCase()] = value[0]
  }
  return out
}

function applyOauthResult(res: ResponseLike, result: McpOauthRequestResult): void {
  for (const [name, value] of Object.entries(result.headers)) {
    res.setHeader(name, value)
  }
  res.status(result.status)
  if (result.body === null || result.body === undefined) {
    if (typeof res.end === 'function') {
      res.end()
      return
    }
    res.json({})
    return
  }
  res.json(result.body)
}

function serializeRegisterBody(body: unknown): string {
  if (typeof body === 'string') return body
  if (body instanceof Uint8Array) return Buffer.from(body).toString('utf8')
  return JSON.stringify(body ?? {})
}

function serializeFormBody(body: unknown): string {
  if (typeof body === 'string') return body
  if (body instanceof Uint8Array) return Buffer.from(body).toString('utf8')
  if (body && typeof body === 'object') {
    const params = new URLSearchParams()
    for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
      if (value === undefined || value === null) continue
      if (Array.isArray(value)) {
        for (const entry of value) params.append(key, String(entry))
      } else {
        params.append(key, String(value))
      }
    }
    return params.toString()
  }
  return ''
}

function serializeRequestBody(contentType: string | null, body: unknown): string {
  if (contentType && contentType.includes('application/x-www-form-urlencoded')) {
    return serializeFormBody(body)
  }
  if (typeof body === 'string') return body
  if (body instanceof Uint8Array) return Buffer.from(body).toString('utf8')
  return JSON.stringify(body ?? {})
}

async function dispatchOauth(
  req: RequestLike,
  res: ResponseLike,
  path: string,
  body: string,
  config: McpOauthRequestConfig,
  client: McpOauthRequestClient | null | undefined,
): Promise<void> {
  applyOauthResult(
    res,
    await mcpOauthRequest(
      {
        method: req.method ?? 'GET',
        path,
        headers: requestHeaders(req),
        body,
        config,
      },
      requireOauthClient(client),
    ),
  )
}

export function createOAuthRegisterHandler(options: OAuthRegisterHandlerOptions): Middleware {
  const path = options.path ?? '/oauth/register'
  const config = oauthConfig(options)

  return async (req, res, next) => {
    if (req.path !== path) {
      next()
      return
    }
    if (req.method !== 'OPTIONS' && req.method !== 'POST') {
      next()
      return
    }
    await dispatchOauth(
      req,
      res,
      '/oauth/register',
      serializeRegisterBody(req.body),
      config,
      options.oauthClient,
    )
  }
}

export function createOAuthAuthorizeHandler(options: OAuthAuthorizeHandlerOptions): Middleware {
  const path = options.path ?? '/oauth/authorize'
  const config = oauthConfig(options)

  return async (req, res, next) => {
    if (req.path !== path) {
      next()
      return
    }
    if (req.method !== 'OPTIONS' && req.method !== 'GET') {
      next()
      return
    }
    await dispatchOauth(
      req,
      res,
      `/oauth/authorize${getRequestQuery(req)}`,
      '',
      config,
      options.oauthClient,
    )
  }
}

export function createOAuthTokenHandler(options: OAuthTokenHandlerOptions): Middleware {
  const path = options.path ?? '/oauth/token'
  const config = oauthConfig(options)

  return async (req, res, next) => {
    if (req.path !== path) {
      next()
      return
    }
    if (req.method !== 'OPTIONS' && req.method !== 'POST') {
      next()
      return
    }
    const contentType = getHeader(req, 'content-type') ?? 'application/x-www-form-urlencoded'
    const headers = requestHeaders(req)
    headers['content-type'] = contentType
    applyOauthResult(
      res,
      await mcpOauthRequest(
        {
          method: req.method ?? 'POST',
          path: '/oauth/token',
          headers,
          body: serializeRequestBody(contentType, req.body),
          config,
        },
        requireOauthClient(options.oauthClient),
      ),
    )
  }
}

export function createOAuthRevokeHandler(options: OAuthRevokeHandlerOptions): Middleware {
  const path = options.path ?? '/oauth/revoke'
  const config = oauthConfig(options)

  return async (req, res, next) => {
    if (req.path !== path) {
      next()
      return
    }
    if (req.method !== 'OPTIONS' && req.method !== 'POST') {
      next()
      return
    }
    const contentType = getHeader(req, 'content-type') ?? 'application/x-www-form-urlencoded'
    const headers = requestHeaders(req)
    headers['content-type'] = contentType
    applyOauthResult(
      res,
      await mcpOauthRequest(
        {
          method: req.method ?? 'POST',
          path: '/oauth/revoke',
          headers,
          body: serializeRequestBody(contentType, req.body),
          config,
        },
        requireOauthClient(options.oauthClient),
      ),
    )
  }
}

export function createMcpOAuthBridge(options: McpOAuthBridgeOptions): Middleware[] {
  const {
    publicBaseUrl,
    apiBaseUrl,
    productRef,
    mcpPath = '/mcp',
    requireAuth = true,
    authMode = 'tools-call',
    hs256Secret,
    jwksJson,
    protectedResourcePath = DEFAULT_PROTECTED_RESOURCE_PATH,
    authorizationServerPath = DEFAULT_AUTHORIZATION_SERVER_PATH,
    oauthPaths,
    oauthClient,
  } = options

  assertValidProductRef(productRef, 'createMcpOAuthBridge')
  logMcpConfigOnce({
    apiBaseUrl: withoutTrailingSlash(apiBaseUrl),
    productRef,
    publicBaseUrl,
  })

  const config = oauthConfig({
    publicBaseUrl,
    productRef,
    apiBaseUrl,
    mcpPath,
    ...(oauthPaths !== undefined ? { oauthPaths } : {}),
  })
  const routes = oauthProxyRoutes({
    mcpPath,
    protectedResourcePath,
    authorizationServerPath,
    ...(oauthPaths !== undefined ? { oauthPaths } : {}),
  })

  const oauthMiddlewares: Middleware[] = routes.map(route => async (req, res, next) => {
    const pathname = req.path ?? ''
    if (!route.match(pathname)) {
      next()
      return
    }
    const method = req.method ?? 'GET'
    if (method === 'OPTIONS' && route.corsPreflight) {
      // OPTIONS is claimed by the OAuth table; native CORS lives in the op.
    }
    const dispatchPath = route.dispatchPath(pathname, getRequestQuery(req))
    if (route.defaultFormContentType) {
      const contentType = getHeader(req, 'content-type') ?? 'application/x-www-form-urlencoded'
      const headers = requestHeaders(req)
      headers['content-type'] = contentType
      applyOauthResult(
        res,
        await mcpOauthRequest(
          {
            method,
            path: dispatchPath,
            headers,
            body: serializeRequestBody(contentType, req.body),
            config,
          },
          requireOauthClient(oauthClient),
        ),
      )
      return
    }
    const body = dispatchPath === '/oauth/register' ? serializeRegisterBody(req.body) : ''
    await dispatchOauth(req, res, dispatchPath, body, config, oauthClient)
  })

  const mcpAuthMiddleware: Middleware = async (req, res, next) => {
    if (req.path !== mcpPath) {
      next()
      return
    }

    // Streamable HTTP clients (Cursor, etc.) probe GET /mcp for a server-initiated
    // SSE back-channel. Stateless MCP servers can't serve it; respond 405 so the
    // client stays connected instead of transitioning to failed on a 400.
    if (req.method && req.method !== 'POST' && req.method !== 'OPTIONS') {
      applyCorsHeaders(req, res)
      res.setHeader('Allow', 'POST, OPTIONS')
      res.status(405)
      if (typeof res.end === 'function') {
        res.end()
      } else {
        res.json({ error: 'method_not_allowed' })
      }
      return
    }

    const authHeader = getRequestAuthHeader(req)
    const id = getRequestJsonRpcId(req.body)
    const method = getRequestJsonRpcMethod(req.body)

    if (!requireAuth) {
      next()
      return
    }
    const resolved = await mcpResolveAuth(
      {
        publicBaseUrl,
        authMode,
        mcpPath,
        jsonRpcId: id,
        ...(method !== undefined ? { rpcMethod: method } : {}),
        ...(authHeader ? { authHeader } : {}),
        ...(hs256Secret !== undefined ? { hs256Secret } : {}),
        ...(jwksJson !== undefined ? { jwksJson } : {}),
      },
      requireResolveAuthClient(oauthClient),
    )
    if (resolved.kind !== 'allow') {
      applyCorsHeaders(req, res)
      const status = resolved.status
      if (typeof status !== 'number') {
        throw new Error('mcpResolveAuth non-allow result missing status')
      }
      if (isRecord(resolved.headers)) {
        for (const [key, value] of Object.entries(resolved.headers)) {
          if (typeof value === 'string') res.setHeader(key, value)
        }
      }
      res.status(status).json(resolved.body)
      return
    }
    if (isRecord(resolved.authInfo)) {
      req.auth = resolved.authInfo
    }
    next()
  }

  return [...oauthMiddlewares, mcpAuthMiddleware]
}
