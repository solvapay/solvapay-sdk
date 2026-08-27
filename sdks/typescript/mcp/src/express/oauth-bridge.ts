/**
 * Node `(req, res, next)` OAuth bridge middleware for the SolvaPay MCP
 * server.
 *
 * Route bodies go through `mcpOauthRequest`. Path matching, CORS
 * preflight, and `mcpAuthMiddleware` stay here — those are transport.
 */

import {
  assertValidProductRef,
  buildAuthInfoFromBearer,
  logMcpConfigOnce,
  mcpAuthGate,
  McpBearerAuthError,
  pathAwareProtectedResourcePath,
  resolveOAuthPaths,
  withoutTrailingSlash,
  type BuildAuthInfoFromBearerOptions,
  type McpAuthMode,
  type OAuthBridgePaths,
} from '@solvapay/mcp-core'
import {
  mcpOauthRequest,
  type McpOauthRequestClient,
  type McpOauthRequestConfig,
  type McpOauthRequestResult,
} from '../internal/mcp-oauth-request'

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

type NextLike = () => void
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
  authInfo?: BuildAuthInfoFromBearerOptions
  protectedResourcePath?: string
  authorizationServerPath?: string
  oauthPaths?: OAuthBridgePaths
  oauthClient?: McpOauthRequestClient | null
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

function getRequestJsonRpcMethod(body: unknown): string | undefined {
  if (body && typeof body === 'object' && 'method' in body) {
    const method = (body as { method?: unknown }).method
    return typeof method === 'string' ? method : undefined
  }
  return undefined
}

function makeUnauthorizedJsonRpc(id: JsonRpcId) {
  return {
    jsonrpc: '2.0',
    id,
    error: {
      code: -32001,
      message: 'Unauthorized',
    },
  }
}

function setMcpChallengeHeader(
  res: ResponseLike,
  publicBaseUrl: string,
  protectedResourcePath: string,
) {
  res.setHeader(
    'WWW-Authenticate',
    `Bearer resource_metadata="${withoutTrailingSlash(publicBaseUrl)}${protectedResourcePath}"`,
  )
}

function getRequestQuery(req: RequestLike): string {
  const raw = req.url ?? req.path ?? ''
  const qIndex = raw.indexOf('?')
  return qIndex === -1 ? '' : raw.slice(qIndex)
}

const NATIVE_CLIENT_ORIGIN_SCHEMES = ['cursor:', 'vscode:', 'vscode-webview:', 'claude:'] as const

function isNativeClientOrigin(origin: string): boolean {
  try {
    const url = new URL(origin)
    return NATIVE_CLIENT_ORIGIN_SCHEMES.includes(
      url.protocol as (typeof NATIVE_CLIENT_ORIGIN_SCHEMES)[number],
    )
  } catch {
    return false
  }
}

function applyCorsHeaders(req: RequestLike, res: ResponseLike) {
  const origin = getHeader(req, 'origin')
  if (!origin) return
  if (isNativeClientOrigin(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Vary', 'Origin')
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

function oauthConfig(options: {
  apiBaseUrl: string
  productRef?: string
  publicBaseUrl?: string
  mcpPath?: string
  oauthPaths?: OAuthBridgePaths
}): McpOauthRequestConfig {
  return {
    publicBaseUrl: options.publicBaseUrl ?? '',
    productRef: options.productRef ?? '',
    apiBaseUrl: options.apiBaseUrl,
    ...(options.mcpPath !== undefined ? { mcpPath: options.mcpPath } : {}),
    ...(options.oauthPaths !== undefined ? { oauthPaths: options.oauthPaths } : {}),
  }
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
      client,
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
        options.oauthClient,
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
        options.oauthClient,
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
    authInfo,
    protectedResourcePath = '/.well-known/oauth-protected-resource',
    authorizationServerPath = '/.well-known/oauth-authorization-server',
    oauthPaths,
    oauthClient,
  } = options

  assertValidProductRef(productRef, 'createMcpOAuthBridge')
  logMcpConfigOnce({
    apiBaseUrl: withoutTrailingSlash(apiBaseUrl),
    productRef,
    publicBaseUrl,
  })

  const paths = resolveOAuthPaths(oauthPaths)
  const config = oauthConfig({
    publicBaseUrl,
    productRef,
    apiBaseUrl,
    mcpPath,
    ...(oauthPaths !== undefined ? { oauthPaths } : {}),
  })
  const metadataPath = pathAwareProtectedResourcePath(mcpPath)

  const openidDiscoveryMiddleware: Middleware = async (req, res, next) => {
    if (req.method !== 'GET' || req.path !== '/.well-known/openid-configuration') {
      next()
      return
    }
    await dispatchOauth(req, res, '/.well-known/openid-configuration', '', config, oauthClient)
  }

  const protectedResourceMiddleware: Middleware = async (req, res, next) => {
    const path = req.path ?? ''
    const matches =
      path === protectedResourcePath ||
      path === metadataPath ||
      path.startsWith('/.well-known/oauth-protected-resource/')
    if (req.method !== 'GET' || !matches) {
      next()
      return
    }
    await dispatchOauth(req, res, path, '', config, oauthClient)
  }

  const authorizationServerMiddleware: Middleware = async (req, res, next) => {
    if (req.method !== 'GET' || req.path !== authorizationServerPath) {
      next()
      return
    }
    await dispatchOauth(req, res, '/.well-known/oauth-authorization-server', '', config, oauthClient)
  }

  const registerMiddleware = createOAuthRegisterHandler({
    apiBaseUrl,
    productRef,
    path: paths.register,
    publicBaseUrl,
    oauthClient,
  })
  const authorizeMiddleware = createOAuthAuthorizeHandler({
    apiBaseUrl,
    path: paths.authorize,
    publicBaseUrl,
    productRef,
    oauthClient,
  })
  const tokenMiddleware = createOAuthTokenHandler({
    apiBaseUrl,
    path: paths.token,
    publicBaseUrl,
    productRef,
    oauthClient,
  })
  const revokeMiddleware = createOAuthRevokeHandler({
    apiBaseUrl,
    path: paths.revoke,
    publicBaseUrl,
    productRef,
    oauthClient,
  })

  const mcpAuthMiddleware: Middleware = (req, res, next) => {
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

    const gate = requireAuth
        ? mcpAuthGate({
          rpcMethod: method,
          authHeader,
          authMode,
          publicBaseUrl,
          mcpPath,
          jsonRpcId: id,
        })
      : { kind: 'allow' as const }
    if (gate.kind === 'challenge') {
      applyCorsHeaders(req, res)
      for (const [key, value] of Object.entries(gate.headers)) {
        res.setHeader(key, value)
      }
      res.status(gate.status).json(gate.body)
      return
    }
    if (!authHeader) {
      next()
      return
    }

    try {
      const auth = buildAuthInfoFromBearer(authHeader, authInfo)
      if (!auth) {
        throw new McpBearerAuthError('Missing bearer token')
      }

      req.auth = auth
      next()
    } catch {
      applyCorsHeaders(req, res)
      res.setHeader('Access-Control-Expose-Headers', 'WWW-Authenticate')
      setMcpChallengeHeader(res, publicBaseUrl, metadataPath)

      if (req.method === 'POST') {
        res.status(401).json(makeUnauthorizedJsonRpc(id))
        return
      }

      res.status(401).json({ error: 'Unauthorized' })
    }
  }

  return [
    openidDiscoveryMiddleware,
    protectedResourceMiddleware,
    authorizationServerMiddleware,
    registerMiddleware,
    authorizeMiddleware,
    tokenMiddleware,
    revokeMiddleware,
    mcpAuthMiddleware,
  ]
}
