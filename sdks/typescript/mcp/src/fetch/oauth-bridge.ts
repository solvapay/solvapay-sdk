/**
 * Fetch-first OAuth bridge handlers.
 *
 * Each handler has the signature `(req: Request) => Promise<Response | null>`:
 * it returns `Response` when the request matches the route, `null` when the
 * handler doesn't want to claim the request (so the host can route
 * elsewhere, e.g. to the MCP transport).
 *
 * Route bodies go through `mcpOauthRequest`. Path matching and CORS
 * preflight stay here — those are transport.
 */

import {
  assertValidProductRef,
  logMcpConfigOnce,
  pathAwareProtectedResourcePath,
  resolveOAuthPaths,
  withoutTrailingSlash,
  type OAuthBridgePaths,
} from '@solvapay/mcp-core'
import { corsPreflight } from './cors'
import {
  mcpOauthRequest,
  type McpOauthRequestClient,
  type McpOauthRequestConfig,
  type McpOauthRequestResult,
} from '../internal/mcp-oauth-request'

export interface FetchOAuthOptions {
  publicBaseUrl: string
  apiBaseUrl: string
  productRef: string
  mcpPath?: string
  protectedResourcePath?: string
  authorizationServerPath?: string
  oauthPaths?: OAuthBridgePaths
  oauthClient?: McpOauthRequestClient | null
}

type FetchHandler = (req: Request) => Promise<Response | null>

function pathOf(req: Request): string {
  return new URL(req.url).pathname
}

function queryOf(req: Request): string {
  const search = new URL(req.url).search
  return search || ''
}

function requestHeaders(req: Request): Record<string, string> {
  const out: Record<string, string> = {}
  req.headers.forEach((value, key) => {
    out[key.toLowerCase()] = value
  })
  return out
}

function responseFromResult(result: McpOauthRequestResult): Response {
  const headers = new Headers()
  for (const [name, value] of Object.entries(result.headers)) {
    headers.set(name, value)
  }
  if (result.body === null || result.body === undefined) {
    return new Response(null, { status: result.status, headers })
  }
  if (typeof result.body === 'string') {
    return new Response(result.body, { status: result.status, headers })
  }
  if (!headers.has('content-type')) {
    headers.set('content-type', 'application/json')
  }
  return new Response(JSON.stringify(result.body), { status: result.status, headers })
}

function oauthConfig(options: {
  publicBaseUrl?: string
  apiBaseUrl: string
  productRef?: string
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
  req: Request,
  path: string,
  body: string,
  config: McpOauthRequestConfig,
  client: McpOauthRequestClient | null | undefined,
): Promise<Response> {
  return responseFromResult(
    await mcpOauthRequest(
      {
        method: req.method,
        path,
        headers: requestHeaders(req),
        body,
        config,
      },
      client,
    ),
  )
}

export function createProtectedResourceHandler(options: {
  publicBaseUrl: string
  protectedResourcePath?: string
  mcpPath?: string
  oauthClient?: McpOauthRequestClient | null
}): FetchHandler {
  const path = options.protectedResourcePath ?? '/.well-known/oauth-protected-resource'
  const metadataPath = options.mcpPath
    ? pathAwareProtectedResourcePath(options.mcpPath)
    : path
  const config = oauthConfig({
    publicBaseUrl: options.publicBaseUrl,
    apiBaseUrl: '',
    productRef: '',
    ...(options.mcpPath !== undefined ? { mcpPath: options.mcpPath } : {}),
  })
  return async req => {
    const pathname = pathOf(req)
    const matches =
      pathname === path ||
      pathname === metadataPath ||
      pathname.startsWith('/.well-known/oauth-protected-resource/')
    if (req.method !== 'GET' || !matches) return null
    return dispatchOauth(req, pathname, '', config, options.oauthClient)
  }
}

export function createAuthorizationServerHandler(options: {
  publicBaseUrl: string
  authorizationServerPath?: string
  paths?: OAuthBridgePaths
  productRef: string
  oauthClient?: McpOauthRequestClient | null
}): FetchHandler {
  const path = options.authorizationServerPath ?? '/.well-known/oauth-authorization-server'
  const config = oauthConfig({
    publicBaseUrl: options.publicBaseUrl,
    apiBaseUrl: '',
    productRef: options.productRef,
    ...(options.paths !== undefined ? { oauthPaths: options.paths } : {}),
  })
  return async req => {
    if (req.method !== 'GET' || pathOf(req) !== path) return null
    return dispatchOauth(
      req,
      '/.well-known/oauth-authorization-server',
      '',
      config,
      options.oauthClient,
    )
  }
}

export function createOpenidNotFoundHandler(
  options: { oauthClient?: McpOauthRequestClient | null } = {},
): FetchHandler {
  const config = oauthConfig({ publicBaseUrl: '', apiBaseUrl: '', productRef: '' })
  return async req => {
    if (req.method !== 'GET' || pathOf(req) !== '/.well-known/openid-configuration') return null
    return dispatchOauth(req, '/.well-known/openid-configuration', '', config, options.oauthClient)
  }
}

export function createOAuthRegisterHandler(options: {
  apiBaseUrl: string
  productRef: string
  path?: string
  publicBaseUrl?: string
  oauthClient?: McpOauthRequestClient | null
}): FetchHandler {
  const path = options.path ?? '/oauth/register'
  const config = oauthConfig(options)

  return async req => {
    if (pathOf(req) !== path) return null
    if (req.method === 'OPTIONS') return corsPreflight(req)
    if (req.method !== 'POST') return null
    return dispatchOauth(req, '/oauth/register', await req.text(), config, options.oauthClient)
  }
}

export function createOAuthAuthorizeHandler(options: {
  apiBaseUrl: string
  path?: string
  publicBaseUrl?: string
  productRef?: string
  oauthClient?: McpOauthRequestClient | null
}): FetchHandler {
  const path = options.path ?? '/oauth/authorize'
  const config = oauthConfig(options)

  return async req => {
    if (pathOf(req) !== path) return null
    if (req.method === 'OPTIONS') return corsPreflight(req)
    if (req.method !== 'GET') return null
    return dispatchOauth(
      req,
      `/oauth/authorize${queryOf(req)}`,
      '',
      config,
      options.oauthClient,
    )
  }
}

export function createOAuthTokenHandler(options: {
  apiBaseUrl: string
  path?: string
  publicBaseUrl?: string
  productRef?: string
  oauthClient?: McpOauthRequestClient | null
}): FetchHandler {
  const path = options.path ?? '/oauth/token'
  const config = oauthConfig(options)

  return async req => {
    if (pathOf(req) !== path) return null
    if (req.method === 'OPTIONS') return corsPreflight(req)
    if (req.method !== 'POST') return null
    const headers = requestHeaders(req)
    if (!headers['content-type']) headers['content-type'] = 'application/x-www-form-urlencoded'
    return responseFromResult(
      await mcpOauthRequest(
        {
          method: req.method,
          path: '/oauth/token',
          headers,
          body: await req.text(),
          config,
        },
        options.oauthClient,
      ),
    )
  }
}

export function createOAuthRevokeHandler(options: {
  apiBaseUrl: string
  path?: string
  publicBaseUrl?: string
  productRef?: string
  oauthClient?: McpOauthRequestClient | null
}): FetchHandler {
  const path = options.path ?? '/oauth/revoke'
  const config = oauthConfig(options)

  return async req => {
    if (pathOf(req) !== path) return null
    if (req.method === 'OPTIONS') return corsPreflight(req)
    if (req.method !== 'POST') return null
    const headers = requestHeaders(req)
    if (!headers['content-type']) headers['content-type'] = 'application/x-www-form-urlencoded'
    return responseFromResult(
      await mcpOauthRequest(
        {
          method: req.method,
          path: '/oauth/revoke',
          headers,
          body: await req.text(),
          config,
        },
        options.oauthClient,
      ),
    )
  }
}

/**
 * Compose every OAuth handler into a single `(req) => Response | null`
 * chain. Returns `null` when no handler matches so the caller can route
 * to the MCP transport.
 */
export function createOAuthFetchRouter(options: FetchOAuthOptions): FetchHandler {
  assertValidProductRef(options.productRef, 'createOAuthFetchRouter')
  logMcpConfigOnce({
    apiBaseUrl: withoutTrailingSlash(options.apiBaseUrl),
    productRef: options.productRef,
    publicBaseUrl: options.publicBaseUrl,
  })

  const paths = resolveOAuthPaths(options.oauthPaths)
  const handlers: FetchHandler[] = [
    createOpenidNotFoundHandler({ oauthClient: options.oauthClient }),
    createProtectedResourceHandler({
      publicBaseUrl: options.publicBaseUrl,
      protectedResourcePath: options.protectedResourcePath,
      mcpPath: options.mcpPath,
      oauthClient: options.oauthClient,
    }),
    createAuthorizationServerHandler({
      publicBaseUrl: options.publicBaseUrl,
      authorizationServerPath: options.authorizationServerPath,
      paths,
      productRef: options.productRef,
      oauthClient: options.oauthClient,
    }),
    createOAuthRegisterHandler({
      apiBaseUrl: options.apiBaseUrl,
      productRef: options.productRef,
      path: paths.register,
      publicBaseUrl: options.publicBaseUrl,
      oauthClient: options.oauthClient,
    }),
    createOAuthAuthorizeHandler({
      apiBaseUrl: options.apiBaseUrl,
      path: paths.authorize,
      publicBaseUrl: options.publicBaseUrl,
      productRef: options.productRef,
      oauthClient: options.oauthClient,
    }),
    createOAuthTokenHandler({
      apiBaseUrl: options.apiBaseUrl,
      path: paths.token,
      publicBaseUrl: options.publicBaseUrl,
      productRef: options.productRef,
      oauthClient: options.oauthClient,
    }),
    createOAuthRevokeHandler({
      apiBaseUrl: options.apiBaseUrl,
      path: paths.revoke,
      publicBaseUrl: options.publicBaseUrl,
      productRef: options.productRef,
      oauthClient: options.oauthClient,
    }),
  ]

  return async req => {
    for (const handler of handlers) {
      const response = await handler(req)
      if (response) return response
    }
    return null
  }
}
