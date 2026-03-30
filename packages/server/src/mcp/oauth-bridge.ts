import { McpBearerAuthError } from '../mcp-auth'
import { buildAuthInfoFromBearer, type BuildAuthInfoFromBearerOptions } from './auth-bridge'

type JsonRpcId = string | number | null

type RequestLike = {
  method?: string
  path?: string
  headers?: Record<string, string | string[] | undefined>
  body?: unknown
  auth?: unknown
}

type ResponseLike = {
  status: (code: number) => ResponseLike
  json: (payload: unknown) => void
  setHeader: (name: string, value: string) => void
}

type NextLike = () => void
type Middleware = (req: RequestLike, res: ResponseLike, next: NextLike) => void

export interface OAuthAuthorizationServerOptions {
  apiBaseUrl: string
  productRef: string
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
}

function withoutTrailingSlash(value: string): string {
  return value.replace(/\/$/, '')
}

function getRequestAuthHeader(req: RequestLike): string | null {
  const header = req.headers?.authorization
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

export function getOAuthProtectedResourceResponse(publicBaseUrl: string) {
  const resource = withoutTrailingSlash(publicBaseUrl)
  return {
    resource,
    authorization_servers: [resource],
    scopes_supported: ['openid', 'profile', 'email'],
  }
}

export function getOAuthAuthorizationServerResponse({
  apiBaseUrl,
  productRef,
}: OAuthAuthorizationServerOptions) {
  const normalizedApiBaseUrl = withoutTrailingSlash(apiBaseUrl)
  const registrationEndpoint = `${normalizedApiBaseUrl}/v1/customer/auth/register?product_ref=${encodeURIComponent(productRef)}`

  return {
    issuer: normalizedApiBaseUrl,
    authorization_endpoint: `${normalizedApiBaseUrl}/v1/customer/auth/authorize`,
    token_endpoint: `${normalizedApiBaseUrl}/v1/customer/auth/token`,
    registration_endpoint: registrationEndpoint,
    token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    scopes_supported: ['openid', 'profile', 'email'],
    code_challenge_methods_supported: ['S256'],
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
  } = options

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
        apiBaseUrl,
        productRef,
      }),
    )
  }

  const mcpAuthMiddleware: Middleware = (req, res, next) => {
    if (req.path !== mcpPath) {
      next()
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
      setMcpChallengeHeader(res, publicBaseUrl, protectedResourcePath)

      if (req.method === 'POST') {
        res.status(401).json(makeUnauthorizedJsonRpc(id))
        return
      }

      res.status(401).json({ error: 'Unauthorized' })
    }
  }

  return [protectedResourceMiddleware, authorizationServerMiddleware, mcpAuthMiddleware]
}
