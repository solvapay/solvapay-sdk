import { McpBearerAuthError } from '../mcp-auth'
import { buildAuthInfoFromBearer, type BuildAuthInfoFromBearerOptions } from './auth-bridge'

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

export interface OAuthBridgePaths {
  register?: string
  authorize?: string
  token?: string
  revoke?: string
}

export interface OAuthAuthorizationServerOptions {
  publicBaseUrl: string
  paths?: OAuthBridgePaths
}

export interface OAuthRegisterHandlerOptions {
  apiBaseUrl: string
  productRef: string
  path?: string
}

export interface OAuthAuthorizeHandlerOptions {
  apiBaseUrl: string
  path?: string
}

export interface OAuthTokenHandlerOptions {
  apiBaseUrl: string
  path?: string
}

export interface OAuthRevokeHandlerOptions {
  apiBaseUrl: string
  path?: string
}

export interface McpOAuthBridgeOptions {
  publicBaseUrl: string
  apiBaseUrl: string
  productRef: string
  mcpPath?: string
  requireAuth?: boolean
  authInfo?: BuildAuthInfoFromBearerOptions
  protectedResourcePath?: string
  authorizationServerPath?: string
  oauthPaths?: OAuthBridgePaths
}

const DEFAULT_OAUTH_PATHS: Required<OAuthBridgePaths> = {
  register: '/oauth/register',
  authorize: '/oauth/authorize',
  token: '/oauth/token',
  revoke: '/oauth/revoke',
}

// Native-scheme origins used by MCP clients during DCR/auth flows. These origins
// don't carry credentials, so we can mirror them back in the Access-Control-Allow-Origin
// header without widening to a bare "*".
const NATIVE_CLIENT_ORIGIN_SCHEMES = ['cursor:', 'vscode:', 'vscode-webview:', 'claude:'] as const

function withoutTrailingSlash(value: string): string {
  return value.replace(/\/$/, '')
}

function resolvePaths(paths: OAuthBridgePaths = {}): Required<OAuthBridgePaths> {
  return { ...DEFAULT_OAUTH_PATHS, ...paths }
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

function setMcpChallengeHeader(res: ResponseLike, publicBaseUrl: string, protectedResourcePath: string) {
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

function handlePreflight(req: RequestLike, res: ResponseLike) {
  applyCorsHeaders(req, res)
  const requestedMethod = getHeader(req, 'access-control-request-method') ?? 'POST'
  const requestedHeaders =
    getHeader(req, 'access-control-request-headers') ?? 'authorization, content-type'
  res.setHeader('Access-Control-Allow-Methods', `${requestedMethod}, OPTIONS`)
  res.setHeader('Access-Control-Allow-Headers', requestedHeaders)
  res.setHeader('Access-Control-Max-Age', '600')
  res.status(204)
  if (typeof res.end === 'function') {
    res.end()
  } else {
    res.json({})
  }
}

async function readJsonFromResponse(upstream: Response): Promise<{ body: unknown; text: string }> {
  const text = await upstream.text()
  if (!text) return { body: {}, text: '' }
  try {
    return { body: JSON.parse(text), text }
  } catch {
    return { body: text, text }
  }
}

async function relayJsonResponse(upstream: Response, res: ResponseLike): Promise<void> {
  const { body, text } = await readJsonFromResponse(upstream)
  res.status(upstream.status)
  const contentType = upstream.headers.get('content-type')
  if (contentType) res.setHeader('Content-Type', contentType)
  if (text === '' && upstream.status === 204) {
    if (typeof res.end === 'function') {
      res.end()
      return
    }
  }
  res.json(body)
}

function sendUpstreamError(res: ResponseLike, _error: unknown) {
  // 502 Bad Gateway — upstream SolvaPay unreachable or network error.
  res.status(502)
  res.setHeader('Content-Type', 'application/json')
  res.json({ error: 'upstream_unreachable' })
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

export function getOAuthProtectedResourceResponse(publicBaseUrl: string) {
  const resource = withoutTrailingSlash(publicBaseUrl)
  return {
    resource,
    authorization_servers: [resource],
    scopes_supported: ['openid', 'profile', 'email'],
  }
}

export function getOAuthAuthorizationServerResponse({
  publicBaseUrl,
  paths,
}: OAuthAuthorizationServerOptions) {
  const base = withoutTrailingSlash(publicBaseUrl)
  const p = resolvePaths(paths)
  return {
    issuer: base,
    authorization_endpoint: `${base}${p.authorize}`,
    token_endpoint: `${base}${p.token}`,
    registration_endpoint: `${base}${p.register}`,
    revocation_endpoint: `${base}${p.revoke}`,
    token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    scopes_supported: ['openid', 'profile', 'email'],
    code_challenge_methods_supported: ['S256'],
  }
}

export function createOAuthRegisterHandler(options: OAuthRegisterHandlerOptions): Middleware {
  const path = options.path ?? DEFAULT_OAUTH_PATHS.register
  const api = withoutTrailingSlash(options.apiBaseUrl)
  const upstream = `${api}/v1/customer/auth/register?product_ref=${encodeURIComponent(options.productRef)}`

  return async (req, res, next) => {
    if (req.path !== path) {
      next()
      return
    }

    if (req.method === 'OPTIONS') {
      handlePreflight(req, res)
      return
    }

    if (req.method !== 'POST') {
      next()
      return
    }

    try {
      const response = await fetch(upstream, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: serializeRegisterBody(req.body),
      })
      applyCorsHeaders(req, res)
      await relayJsonResponse(response, res)
    } catch (error) {
      applyCorsHeaders(req, res)
      sendUpstreamError(res, error)
    }
  }
}

export function createOAuthAuthorizeHandler(options: OAuthAuthorizeHandlerOptions): Middleware {
  const path = options.path ?? DEFAULT_OAUTH_PATHS.authorize
  const api = withoutTrailingSlash(options.apiBaseUrl)

  return (req, res, next) => {
    if (req.path !== path) {
      next()
      return
    }

    if (req.method === 'OPTIONS') {
      handlePreflight(req, res)
      return
    }

    if (req.method !== 'GET') {
      next()
      return
    }

    const query = getRequestQuery(req)
    const location = `${api}/v1/customer/auth/authorize${query}`
    res.setHeader('Location', location)
    res.status(302)
    if (typeof res.end === 'function') {
      res.end()
      return
    }
    res.json({})
  }
}

export function createOAuthTokenHandler(options: OAuthTokenHandlerOptions): Middleware {
  const path = options.path ?? DEFAULT_OAUTH_PATHS.token
  const api = withoutTrailingSlash(options.apiBaseUrl)
  const upstream = `${api}/v1/customer/auth/token`

  return async (req, res, next) => {
    if (req.path !== path) {
      next()
      return
    }

    if (req.method === 'OPTIONS') {
      handlePreflight(req, res)
      return
    }

    if (req.method !== 'POST') {
      next()
      return
    }

    const contentType =
      getHeader(req, 'content-type') ?? 'application/x-www-form-urlencoded'
    const authorization = getHeader(req, 'authorization')

    const headers: Record<string, string> = { 'content-type': contentType }
    if (authorization) headers['authorization'] = authorization

    try {
      const response = await fetch(upstream, {
        method: 'POST',
        headers,
        body: serializeRequestBody(contentType, req.body),
      })
      applyCorsHeaders(req, res)
      await relayJsonResponse(response, res)
    } catch (error) {
      applyCorsHeaders(req, res)
      sendUpstreamError(res, error)
    }
  }
}

export function createOAuthRevokeHandler(options: OAuthRevokeHandlerOptions): Middleware {
  const path = options.path ?? DEFAULT_OAUTH_PATHS.revoke
  const api = withoutTrailingSlash(options.apiBaseUrl)
  const upstream = `${api}/v1/customer/auth/revoke`

  return async (req, res, next) => {
    if (req.path !== path) {
      next()
      return
    }

    if (req.method === 'OPTIONS') {
      handlePreflight(req, res)
      return
    }

    if (req.method !== 'POST') {
      next()
      return
    }

    const contentType =
      getHeader(req, 'content-type') ?? 'application/x-www-form-urlencoded'
    const authorization = getHeader(req, 'authorization')

    const headers: Record<string, string> = { 'content-type': contentType }
    if (authorization) headers['authorization'] = authorization

    try {
      const response = await fetch(upstream, {
        method: 'POST',
        headers,
        body: serializeRequestBody(contentType, req.body),
      })
      applyCorsHeaders(req, res)
      await relayJsonResponse(response, res)
    } catch (error) {
      applyCorsHeaders(req, res)
      sendUpstreamError(res, error)
    }
  }
}

export function createMcpOAuthBridge(options: McpOAuthBridgeOptions): Middleware[] {
  const {
    publicBaseUrl,
    apiBaseUrl,
    productRef,
    mcpPath = '/mcp',
    requireAuth = true,
    authInfo,
    protectedResourcePath = '/.well-known/oauth-protected-resource',
    authorizationServerPath = '/.well-known/oauth-authorization-server',
    oauthPaths,
  } = options

  const paths = resolvePaths(oauthPaths)

  // SolvaPay is an OAuth 2.0 authorization server (RFC 8414), not an OpenID Provider.
  // We don't issue id_tokens or expose a JWKS endpoint, so advertising an OIDC discovery
  // doc would be a false capability claim. Strict OIDC validators (current Cursor) reject
  // a non-compliant doc and log a noisy Zod error; returning 404 here tells them to fall
  // back to RFC 8414, which we serve correctly on `/.well-known/oauth-authorization-server`.
  const openidDiscoveryMiddleware: Middleware = (req, res, next) => {
    if (req.method !== 'GET' || req.path !== '/.well-known/openid-configuration') {
      next()
      return
    }

    applyCorsHeaders(req, res)
    res.status(404)
    if (typeof res.end === 'function') {
      res.end()
    } else {
      res.json({ error: 'not_found' })
    }
  }

  const protectedResourceMiddleware: Middleware = (req, res, next) => {
    if (req.method !== 'GET' || req.path !== protectedResourcePath) {
      next()
      return
    }

    res.json(getOAuthProtectedResourceResponse(publicBaseUrl))
  }

  const authorizationServerMiddleware: Middleware = (req, res, next) => {
    if (req.method !== 'GET' || req.path !== authorizationServerPath) {
      next()
      return
    }

    if (!productRef) {
      res.status(500).json({ error: 'SOLVAPAY_PRODUCT_REF missing' })
      return
    }

    res.json(
      getOAuthAuthorizationServerResponse({
        publicBaseUrl,
        paths,
      }),
    )
  }

  const registerMiddleware = createOAuthRegisterHandler({
    apiBaseUrl,
    productRef,
    path: paths.register,
  })
  const authorizeMiddleware = createOAuthAuthorizeHandler({
    apiBaseUrl,
    path: paths.authorize,
  })
  const tokenMiddleware = createOAuthTokenHandler({ apiBaseUrl, path: paths.token })
  const revokeMiddleware = createOAuthRevokeHandler({ apiBaseUrl, path: paths.revoke })

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

    if (!authHeader && !requireAuth) {
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
      setMcpChallengeHeader(res, publicBaseUrl, protectedResourcePath)

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
