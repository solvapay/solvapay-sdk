import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createAuthorizationServerHandler,
  createOAuthAuthorizeHandler,
  createOAuthFetchRouter,
  createOAuthRegisterHandler,
  createOAuthRevokeHandler,
  createOAuthTokenHandler,
  createOpenidNotFoundHandler,
  createProtectedResourceHandler,
} from '../../src/fetch/oauth-bridge'

const publicBaseUrl = 'https://mcp.example.com'
const apiBaseUrl = 'https://api.solvapay.com'
const productRef = 'prd_test_123'

function jsonFetchResponse(status: number, body: unknown, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...extraHeaders },
  })
}

describe('createProtectedResourceHandler', () => {
  it('returns the discovery JSON on GET /.well-known/oauth-protected-resource', async () => {
    const handler = createProtectedResourceHandler({ publicBaseUrl })
    const res = await handler(
      new Request(`${publicBaseUrl}/.well-known/oauth-protected-resource`),
    )
    expect(res).toBeInstanceOf(Response)
    expect(res!.status).toBe(200)
    const body = (await res!.json()) as { resource: string; authorization_servers: string[] }
    expect(body.resource).toBe(publicBaseUrl)
    expect(body.authorization_servers).toEqual([publicBaseUrl])
  })

  it('returns null for non-matching paths', async () => {
    const handler = createProtectedResourceHandler({ publicBaseUrl })
    const res = await handler(new Request(`${publicBaseUrl}/mcp`))
    expect(res).toBeNull()
  })

  it('returns null for non-GET methods', async () => {
    const handler = createProtectedResourceHandler({ publicBaseUrl })
    const res = await handler(
      new Request(`${publicBaseUrl}/.well-known/oauth-protected-resource`, { method: 'POST' }),
    )
    expect(res).toBeNull()
  })
})

describe('createAuthorizationServerHandler', () => {
  it('returns the AS discovery JSON with same-origin endpoints', async () => {
    const handler = createAuthorizationServerHandler({ publicBaseUrl, productRef })
    const res = await handler(
      new Request(`${publicBaseUrl}/.well-known/oauth-authorization-server`),
    )
    expect(res!.status).toBe(200)
    const body = (await res!.json()) as {
      issuer: string
      token_endpoint: string
      authorization_endpoint: string
      registration_endpoint: string
      revocation_endpoint: string
    }
    expect(body.issuer).toBe(publicBaseUrl)
    expect(body.token_endpoint).toBe(`${publicBaseUrl}/oauth/token`)
    expect(body.authorization_endpoint).toBe(`${publicBaseUrl}/oauth/authorize`)
    expect(body.registration_endpoint).toBe(`${publicBaseUrl}/oauth/register`)
    expect(body.revocation_endpoint).toBe(`${publicBaseUrl}/oauth/revoke`)
  })

  it('never leaks product_ref into the discovery document', async () => {
    const handler = createAuthorizationServerHandler({ publicBaseUrl, productRef })
    const res = await handler(
      new Request(`${publicBaseUrl}/.well-known/oauth-authorization-server`),
    )
    const text = await res!.text()
    expect(text).not.toContain('product_ref')
    expect(text).not.toContain(productRef)
  })

  it('500s when productRef is missing', async () => {
    const handler = createAuthorizationServerHandler({ publicBaseUrl, productRef: '' })
    const res = await handler(
      new Request(`${publicBaseUrl}/.well-known/oauth-authorization-server`),
    )
    expect(res!.status).toBe(500)
  })
})

describe('createOpenidNotFoundHandler', () => {
  it('returns 404 for /.well-known/openid-configuration', async () => {
    const handler = createOpenidNotFoundHandler()
    const res = await handler(new Request(`${publicBaseUrl}/.well-known/openid-configuration`))
    expect(res!.status).toBe(404)
  })
})

describe('createOAuthRegisterHandler', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('proxies to /v1/customer/auth/register with product_ref', async () => {
    const fetchMock = vi.mocked(globalThis.fetch)
    fetchMock.mockResolvedValueOnce(jsonFetchResponse(201, { client_id: 'c_1' }))

    const handler = createOAuthRegisterHandler({ apiBaseUrl, productRef })
    const res = await handler(
      new Request(`${publicBaseUrl}/oauth/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'cursor://mcp' },
        body: JSON.stringify({ redirect_uris: ['cursor://cb'] }),
      }),
    )

    expect(res!.status).toBe(201)
    expect(res!.headers.get('access-control-allow-origin')).toBe('cursor://mcp')
    const calledUrl = fetchMock.mock.calls[0]![0] as string
    expect(calledUrl).toBe(
      `${apiBaseUrl}/v1/customer/auth/register?product_ref=${encodeURIComponent(productRef)}`,
    )
  })

  it('handles OPTIONS with CORS preflight', async () => {
    const handler = createOAuthRegisterHandler({ apiBaseUrl, productRef })
    const res = await handler(
      new Request(`${publicBaseUrl}/oauth/register`, {
        method: 'OPTIONS',
        headers: { origin: 'cursor://mcp', 'access-control-request-method': 'POST' },
      }),
    )
    expect(res!.status).toBe(204)
    expect(res!.headers.get('access-control-allow-origin')).toBe('cursor://mcp')
  })

  it('returns 502 when upstream is unreachable', async () => {
    vi.mocked(globalThis.fetch).mockRejectedValueOnce(new Error('ECONNREFUSED'))
    const handler = createOAuthRegisterHandler({ apiBaseUrl, productRef })
    const res = await handler(
      new Request(`${publicBaseUrl}/oauth/register`, {
        method: 'POST',
        body: '{}',
      }),
    )
    expect(res!.status).toBe(502)
    const body = (await res!.json()) as { error: string }
    expect(body.error).toBe('upstream_unreachable')
  })
})

describe('createOAuthAuthorizeHandler', () => {
  it('302 redirects to upstream preserving query string', async () => {
    const handler = createOAuthAuthorizeHandler({ apiBaseUrl })
    const res = await handler(
      new Request(
        `${publicBaseUrl}/oauth/authorize?response_type=code&client_id=c_1&code_challenge=abc&code_challenge_method=S256&redirect_uri=${encodeURIComponent('cursor://cb')}`,
      ),
    )
    expect(res!.status).toBe(302)
    expect(res!.headers.get('location')).toBe(
      `${apiBaseUrl}/v1/customer/auth/authorize?response_type=code&client_id=c_1&code_challenge=abc&code_challenge_method=S256&redirect_uri=${encodeURIComponent('cursor://cb')}`,
    )
  })
})

describe('createOAuthTokenHandler', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('forwards raw form body (preserving + / %20 / PKCE verifier)', async () => {
    const fetchMock = vi.mocked(globalThis.fetch)
    fetchMock.mockResolvedValueOnce(
      jsonFetchResponse(200, { access_token: 'AT', token_type: 'Bearer' }),
    )

    const handler = createOAuthTokenHandler({ apiBaseUrl })
    const body =
      'grant_type=authorization_code&code=abc+def&code_verifier=v%7E-_.~&redirect_uri=cursor%3A%2F%2Fcb'
    const res = await handler(
      new Request(`${publicBaseUrl}/oauth/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body,
      }),
    )

    expect(res!.status).toBe(200)
    const upstreamInit = fetchMock.mock.calls[0]![1] as RequestInit
    expect(upstreamInit.body).toBe(body)
    expect(
      (upstreamInit.headers as Record<string, string>)['content-type'],
    ).toBe('application/x-www-form-urlencoded')
  })

  it('normalizes NestJS validation errors into RFC 6749 shape', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      jsonFetchResponse(400, {
        message: 'Validation failed',
        errors: [
          {
            path: ['grant_type'],
            message: 'Invalid enum value',
            received: 'password',
          },
        ],
      }),
    )

    const handler = createOAuthTokenHandler({ apiBaseUrl })
    const res = await handler(
      new Request(`${publicBaseUrl}/oauth/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: 'grant_type=password',
      }),
    )

    expect(res!.status).toBe(400)
    const body = (await res!.json()) as { error: string; error_description?: string }
    expect(body.error).toBe('unsupported_grant_type')
    expect(body.error_description).toContain('grant_type')
  })

  it('maps 401 upstream to invalid_client', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      jsonFetchResponse(401, { message: 'Client authentication failed' }),
    )
    const handler = createOAuthTokenHandler({ apiBaseUrl })
    const res = await handler(
      new Request(`${publicBaseUrl}/oauth/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: 'grant_type=refresh_token&refresh_token=x',
      }),
    )
    expect(res!.status).toBe(401)
    const body = (await res!.json()) as { error: string }
    expect(body.error).toBe('invalid_client')
  })

  it('preserves RFC-compliant upstream responses verbatim', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      jsonFetchResponse(400, {
        error: 'invalid_grant',
        error_description: 'authorization code expired',
      }),
    )
    const handler = createOAuthTokenHandler({ apiBaseUrl })
    const res = await handler(
      new Request(`${publicBaseUrl}/oauth/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: 'grant_type=authorization_code&code=stale',
      }),
    )
    const body = (await res!.json()) as { error: string; error_description: string }
    expect(body.error).toBe('invalid_grant')
    expect(body.error_description).toBe('authorization code expired')
  })
})

describe('createOAuthRevokeHandler', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('proxies POST body to /v1/customer/auth/revoke', async () => {
    const fetchMock = vi.mocked(globalThis.fetch)
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }))

    const handler = createOAuthRevokeHandler({ apiBaseUrl })
    const res = await handler(
      new Request(`${publicBaseUrl}/oauth/revoke`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: 'token=abc&token_type_hint=access_token',
      }),
    )
    expect(res!.status).toBe(200)
    expect(fetchMock.mock.calls[0]![0]).toBe(`${apiBaseUrl}/v1/customer/auth/revoke`)
  })
})

describe('createOAuthFetchRouter', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('routes each well-known + /oauth path, returns null otherwise', async () => {
    const router = createOAuthFetchRouter({ publicBaseUrl, apiBaseUrl, productRef })

    const protectedRes = await router(
      new Request(`${publicBaseUrl}/.well-known/oauth-protected-resource`),
    )
    expect(protectedRes!.status).toBe(200)

    const asRes = await router(
      new Request(`${publicBaseUrl}/.well-known/oauth-authorization-server`),
    )
    expect(asRes!.status).toBe(200)

    const oidcRes = await router(new Request(`${publicBaseUrl}/.well-known/openid-configuration`))
    expect(oidcRes!.status).toBe(404)

    const mcpRes = await router(new Request(`${publicBaseUrl}/mcp`, { method: 'POST' }))
    expect(mcpRes).toBeNull()
  })
})
