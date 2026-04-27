/**
 * Fetch-first OAuth bridge handlers.
 *
 * Each handler has the signature `(req: Request) => Promise<Response | null>`:
 * it returns `Response` when the request matches the route, `null` when the
 * handler doesn't want to claim the request (so the host can route
 * elsewhere, e.g. to the MCP transport).
 *
 * Pure Web-standards: runs on Deno, Cloudflare Workers, Bun, Next edge,
 * Supabase Edge, Node via the `undici`/`node:http` Web interop bridge —
 * wherever `Request`, `Response`, and global `fetch` exist.
 */

import {
  getOAuthAuthorizationServerResponse,
  getOAuthProtectedResourceResponse,
  resolveOAuthPaths,
  withoutTrailingSlash,
  type OAuthBridgePaths,
} from '@solvapay/mcp-core'
import { toOAuthErrorBody } from '../internal/oauth-error-normalize'
import { applyNativeCors, corsPreflight } from './cors'

export interface FetchOAuthOptions {
  publicBaseUrl: string
  apiBaseUrl: string
  productRef: string
  protectedResourcePath?: string
  authorizationServerPath?: string
  oauthPaths?: OAuthBridgePaths
}

type FetchHandler = (req: Request) => Promise<Response | null>

async function parseUpstreamJson(response: Response): Promise<{ body: unknown; text: string }> {
  const text = await response.text()
  if (!text) return { body: {}, text: '' }
  try {
    return { body: JSON.parse(text), text }
  } catch {
    return { body: text, text }
  }
}

function upstreamUnreachable(req: Request): Response {
  const headers = new Headers({ 'content-type': 'application/json' })
  applyNativeCors(req.headers, headers)
  return new Response(JSON.stringify({ error: 'upstream_unreachable' }), { status: 502, headers })
}

function corsResponse(req: Request, response: Response): Response {
  const headers = new Headers(response.headers)
  applyNativeCors(req.headers, headers)
  return new Response(response.body, { status: response.status, headers })
}

function jsonResponse(req: Request, status: number, body: unknown): Response {
  const headers = new Headers({ 'content-type': 'application/json' })
  applyNativeCors(req.headers, headers)
  return new Response(JSON.stringify(body), { status, headers })
}

function emptyResponse(req: Request, status: number): Response {
  const headers = new Headers()
  applyNativeCors(req.headers, headers)
  return new Response(null, { status, headers })
}

function pathOf(req: Request): string {
  return new URL(req.url).pathname
}

function queryOf(req: Request): string {
  const search = new URL(req.url).search
  return search || ''
}

export function createProtectedResourceHandler(options: {
  publicBaseUrl: string
  protectedResourcePath?: string
}): FetchHandler {
  const path = options.protectedResourcePath ?? '/.well-known/oauth-protected-resource'
  return async req => {
    if (req.method !== 'GET' || pathOf(req) !== path) return null
    return jsonResponse(req, 200, getOAuthProtectedResourceResponse(options.publicBaseUrl))
  }
}

export function createAuthorizationServerHandler(options: {
  publicBaseUrl: string
  authorizationServerPath?: string
  paths?: OAuthBridgePaths
  productRef: string
}): FetchHandler {
  const path = options.authorizationServerPath ?? '/.well-known/oauth-authorization-server'
  const resolvedPaths = resolveOAuthPaths(options.paths)
  return async req => {
    if (req.method !== 'GET' || pathOf(req) !== path) return null
    if (!options.productRef) {
      return jsonResponse(req, 500, { error: 'SOLVAPAY_PRODUCT_REF missing' })
    }
    return jsonResponse(
      req,
      200,
      getOAuthAuthorizationServerResponse({
        publicBaseUrl: options.publicBaseUrl,
        paths: resolvedPaths,
      }),
    )
  }
}

export function createOpenidNotFoundHandler(): FetchHandler {
  return async req => {
    if (req.method !== 'GET' || pathOf(req) !== '/.well-known/openid-configuration') return null
    return emptyResponse(req, 404)
  }
}

export function createOAuthRegisterHandler(options: {
  apiBaseUrl: string
  productRef: string
  path?: string
}): FetchHandler {
  const path = options.path ?? '/oauth/register'
  const api = withoutTrailingSlash(options.apiBaseUrl)
  const upstream = `${api}/v1/customer/auth/register?product_ref=${encodeURIComponent(options.productRef)}`

  return async req => {
    if (pathOf(req) !== path) return null
    if (req.method === 'OPTIONS') return corsPreflight(req)
    if (req.method !== 'POST') return null

    const body = await req.text()
    try {
      const upstreamResponse = await fetch(upstream, {
        method: 'POST',
        headers: { 'content-type': req.headers.get('content-type') ?? 'application/json' },
        body,
      })
      return corsResponse(req, upstreamResponse)
    } catch {
      return upstreamUnreachable(req)
    }
  }
}

export function createOAuthAuthorizeHandler(options: {
  apiBaseUrl: string
  path?: string
}): FetchHandler {
  const path = options.path ?? '/oauth/authorize'
  const api = withoutTrailingSlash(options.apiBaseUrl)

  return async req => {
    if (pathOf(req) !== path) return null
    if (req.method === 'OPTIONS') return corsPreflight(req)
    if (req.method !== 'GET') return null

    const query = queryOf(req)
    const location = `${api}/v1/customer/auth/authorize${query}`
    const headers = new Headers({ Location: location })
    applyNativeCors(req.headers, headers)
    return new Response(null, { status: 302, headers })
  }
}

async function proxyFormEndpoint(
  req: Request,
  upstreamUrl: string,
  normalizeErrors: boolean,
): Promise<Response> {
  // IMPORTANT: read body as raw text via `req.text()` so `+`/`%20` survive
  // verbatim. Routing through URLSearchParams here would rewrite them and
  // break RFC 6749 §4.1.3 + RFC 7636 PKCE verifiers.
  const rawBody = await req.text()
  const contentType = req.headers.get('content-type') ?? 'application/x-www-form-urlencoded'
  const headers: Record<string, string> = { 'content-type': contentType }
  const authorization = req.headers.get('authorization')
  if (authorization) headers.authorization = authorization

  try {
    const upstreamResponse = await fetch(upstreamUrl, {
      method: 'POST',
      headers,
      body: rawBody,
    })

    if (!normalizeErrors || upstreamResponse.ok || upstreamResponse.status === 204) {
      return corsResponse(req, upstreamResponse)
    }

    const { body, text } = await parseUpstreamJson(upstreamResponse)
    const normalized = toOAuthErrorBody(body, text, upstreamResponse.status)
    return jsonResponse(req, upstreamResponse.status, normalized)
  } catch {
    return upstreamUnreachable(req)
  }
}

export function createOAuthTokenHandler(options: {
  apiBaseUrl: string
  path?: string
}): FetchHandler {
  const path = options.path ?? '/oauth/token'
  const upstream = `${withoutTrailingSlash(options.apiBaseUrl)}/v1/customer/auth/token`

  return async req => {
    if (pathOf(req) !== path) return null
    if (req.method === 'OPTIONS') return corsPreflight(req)
    if (req.method !== 'POST') return null
    return proxyFormEndpoint(req, upstream, /* normalizeErrors */ true)
  }
}

export function createOAuthRevokeHandler(options: {
  apiBaseUrl: string
  path?: string
}): FetchHandler {
  const path = options.path ?? '/oauth/revoke'
  const upstream = `${withoutTrailingSlash(options.apiBaseUrl)}/v1/customer/auth/revoke`

  return async req => {
    if (pathOf(req) !== path) return null
    if (req.method === 'OPTIONS') return corsPreflight(req)
    if (req.method !== 'POST') return null
    return proxyFormEndpoint(req, upstream, /* normalizeErrors */ true)
  }
}

/**
 * Compose every OAuth handler into a single `(req) => Response | null`
 * chain. Returns `null` when no handler matches so the caller can route
 * to the MCP transport.
 */
export function createOAuthFetchRouter(options: FetchOAuthOptions): FetchHandler {
  const paths = resolveOAuthPaths(options.oauthPaths)
  const handlers: FetchHandler[] = [
    createOpenidNotFoundHandler(),
    createProtectedResourceHandler({
      publicBaseUrl: options.publicBaseUrl,
      protectedResourcePath: options.protectedResourcePath,
    }),
    createAuthorizationServerHandler({
      publicBaseUrl: options.publicBaseUrl,
      authorizationServerPath: options.authorizationServerPath,
      paths,
      productRef: options.productRef,
    }),
    createOAuthRegisterHandler({
      apiBaseUrl: options.apiBaseUrl,
      productRef: options.productRef,
      path: paths.register,
    }),
    createOAuthAuthorizeHandler({ apiBaseUrl: options.apiBaseUrl, path: paths.authorize }),
    createOAuthTokenHandler({ apiBaseUrl: options.apiBaseUrl, path: paths.token }),
    createOAuthRevokeHandler({ apiBaseUrl: options.apiBaseUrl, path: paths.revoke }),
  ]

  return async req => {
    for (const handler of handlers) {
      const response = await handler(req)
      if (response) return response
    }
    return null
  }
}
