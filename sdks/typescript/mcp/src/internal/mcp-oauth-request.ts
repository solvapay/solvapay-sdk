/**
 * Host-side `mcpOauthRequest`: one JSON contract for discovery + OAuth
 * proxy routes. When a native client implements the composite op, that
 * path is used; otherwise the same contract is served with `fetch` so
 * unit tests that stub `globalThis.fetch` stay characterization-stable.
 */

import {
  getOAuthAuthorizationServerResponse,
  getOAuthProtectedResourceResponse,
  logDcrFailureDiagnostic,
  toOAuthErrorBody,
  withoutTrailingSlash,
  type OAuthBridgePaths,
} from '@solvapay/mcp-core'

export type McpOauthRequestConfig = {
  publicBaseUrl: string
  productRef: string
  apiBaseUrl: string
  mcpPath?: string
  oauthPaths?: OAuthBridgePaths
}

export type McpOauthRequestParams = {
  method: string
  path: string
  headers: Record<string, string>
  body: string
  config: McpOauthRequestConfig
}

export type McpOauthRequestResult = {
  status: number
  headers: Record<string, string>
  body: unknown
}

export type McpOauthRequestClient = {
  mcpOauthRequest: (params: {
    method: string
    path: string
    headers: Record<string, string>
    body: string
    config: {
      publicBaseUrl: string
      productRef: string
      mcpPath?: string
      oauthPaths?: OAuthBridgePaths
    }
  }) => Promise<unknown>
}

const NATIVE_CLIENT_ORIGIN_SCHEMES = ['cursor:', 'vscode:', 'vscode-webview:', 'claude:'] as const

function pathOnly(path: string): string {
  return path.split('?')[0] ?? path
}

function querySuffix(path: string): string {
  const q = path.split('?')[1]
  return q ?? ''
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

function nativeCorsHeaders(origin: string | undefined): Record<string, string> {
  if (!origin || !isNativeClientOrigin(origin)) return {}
  return {
    'access-control-allow-origin': origin,
    vary: 'Origin',
  }
}

function jsonResult(
  status: number,
  body: unknown,
  extra: Record<string, string> = {},
): McpOauthRequestResult {
  return {
    status,
    headers: { 'content-type': 'application/json', ...extra },
    body,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object'
}

function asOauthResult(value: unknown): McpOauthRequestResult {
  if (!isRecord(value) || typeof value.status !== 'number') {
    throw new Error('mcpOauthRequest returned a result without status')
  }
  const headers: Record<string, string> = {}
  if (isRecord(value.headers)) {
    for (const [key, header] of Object.entries(value.headers)) {
      if (typeof header === 'string') headers[key] = header
    }
  }
  return { status: value.status, headers, body: value.body }
}

async function parseUpstream(response: Response): Promise<{ body: unknown; text: string }> {
  const text = await response.text()
  if (!text) return { body: {}, text: '' }
  try {
    return { body: JSON.parse(text), text }
  } catch {
    return { body: text, text }
  }
}

async function proxyCustomerAuth(
  params: McpOauthRequestParams,
  upstreamPath: string,
  normalizeErrors: boolean,
): Promise<McpOauthRequestResult> {
  const api = withoutTrailingSlash(params.config.apiBaseUrl)
  const origin = params.headers.origin
  const cors = nativeCorsHeaders(origin)
  const contentType = params.headers['content-type'] ?? 'application/json'
  const headers: Record<string, string> = { 'content-type': contentType }
  if (params.headers.authorization) headers.authorization = params.headers.authorization

  try {
    const upstream = await fetch(`${api}${upstreamPath}`, {
      method: 'POST',
      headers,
      body: params.body,
    })
    if (upstream.status === 204) {
      const text = await upstream.text()
      if (text === '') {
        return { status: 204, headers: { ...cors }, body: null }
      }
    }
    const { body, text } = await parseUpstream(upstream)
    if (upstreamPath.startsWith('/v1/customer/auth/register') && !upstream.ok) {
      logDcrFailureDiagnostic({
        productRef: params.config.productRef,
        apiBaseUrl: api,
        status: upstream.status,
        bodyText: text,
      })
    }
    const payload =
      normalizeErrors && !upstream.ok && upstream.status !== 204
        ? toOAuthErrorBody(body, text, upstream.status)
        : body
    const contentTypeOut = normalizeErrors
      ? 'application/json'
      : (upstream.headers.get('content-type') ?? 'application/json')
    return {
      status: upstream.status,
      headers: { 'content-type': contentTypeOut, ...cors },
      body: payload,
    }
  } catch {
    return jsonResult(502, { error: 'upstream_unreachable' }, cors)
  }
}

async function mcpOauthRequestLocal(params: McpOauthRequestParams): Promise<McpOauthRequestResult> {
  const method = params.method.toUpperCase()
  const path = pathOnly(params.path)
  const cors = nativeCorsHeaders(params.headers.origin)

  if (method === 'OPTIONS') {
    return {
      status: 204,
      headers: {
        ...cors,
        'access-control-allow-methods': `${params.headers['access-control-request-method'] ?? 'POST'}, OPTIONS`,
        'access-control-allow-headers':
          params.headers['access-control-request-headers'] ?? 'authorization, content-type',
        'access-control-max-age': '600',
      },
      body: null,
    }
  }

  if (path === '/.well-known/openid-configuration') {
    if (method !== 'GET') return jsonResult(405, { error: 'method_not_allowed' }, cors)
    return { status: 404, headers: { ...cors }, body: null }
  }

  if (
    path === '/.well-known/oauth-protected-resource' ||
    path.startsWith('/.well-known/oauth-protected-resource/')
  ) {
    if (method !== 'GET') return jsonResult(405, { error: 'method_not_allowed' }, cors)
    return jsonResult(
      200,
      getOAuthProtectedResourceResponse(params.config.publicBaseUrl, params.config.mcpPath),
      cors,
    )
  }

  if (path === '/.well-known/oauth-authorization-server') {
    if (method !== 'GET') return jsonResult(405, { error: 'method_not_allowed' }, cors)
    if (!params.config.productRef) {
      return jsonResult(500, { error: 'SOLVAPAY_PRODUCT_REF missing' }, cors)
    }
    return jsonResult(
      200,
      getOAuthAuthorizationServerResponse({
        publicBaseUrl: params.config.publicBaseUrl,
        ...(params.config.oauthPaths !== undefined ? { paths: params.config.oauthPaths } : {}),
      }),
      cors,
    )
  }

  if (path === '/oauth/authorize' || path.endsWith('/oauth/authorize')) {
    const qs = querySuffix(params.path)
    const api = withoutTrailingSlash(params.config.apiBaseUrl)
    const location = `${api}/v1/customer/auth/authorize${qs ? `?${qs}` : ''}`
    return { status: 302, headers: { location, ...cors }, body: null }
  }

  if (method !== 'POST') {
    return jsonResult(405, { error: 'method_not_allowed' }, cors)
  }

  if (path === '/oauth/register' || path.endsWith('/oauth/register')) {
    const encoded = encodeURIComponent(params.config.productRef)
    return proxyCustomerAuth(params, `/v1/customer/auth/register?product_ref=${encoded}`, false)
  }
  if (path === '/oauth/token' || path.endsWith('/oauth/token')) {
    return proxyCustomerAuth(params, '/v1/customer/auth/token', true)
  }
  if (path === '/oauth/revoke' || path.endsWith('/oauth/revoke')) {
    return proxyCustomerAuth(params, '/v1/customer/auth/revoke', true)
  }

  return jsonResult(404, { error: 'not_found' }, cors)
}

export async function mcpOauthRequest(
  params: McpOauthRequestParams,
  client?: McpOauthRequestClient | null,
): Promise<McpOauthRequestResult> {
  const path = pathOnly(params.path)
  // The composite rust op historically omits `mcpPath` from this document.
  // Hosts must stay on the path-aware sync discovery op so the resource
  // identifier agrees with `mcpAuthGate`.
  if (
    path === '/.well-known/oauth-protected-resource' ||
    path.startsWith('/.well-known/oauth-protected-resource/')
  ) {
    return mcpOauthRequestLocal(params)
  }
  if (client && typeof client.mcpOauthRequest === 'function') {
    const { apiBaseUrl, ...config } = params.config
    void apiBaseUrl
    return asOauthResult(
      await client.mcpOauthRequest({
        method: params.method,
        path: params.path,
        headers: params.headers,
        body: params.body,
        config,
      }),
    )
  }
  return mcpOauthRequestLocal(params)
}
