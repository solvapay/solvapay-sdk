import { describe, expect, it } from 'vitest'
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
import { nativeOauthClient, recordingOauthClient, replyOauth } from '../native-oauth-client'

const publicBaseUrl = 'https://mcp.example.com'
const apiBaseUrl = 'https://api.solvapay.com'
const productRef = 'prd_test_123'
const oauthClient = nativeOauthClient('http://127.0.0.1:1')

describe('createProtectedResourceHandler', () => {
  it('returns the discovery JSON on GET /.well-known/oauth-protected-resource', async () => {
    const handler = createProtectedResourceHandler({ publicBaseUrl, oauthClient })
    const res = await handler(new Request(`${publicBaseUrl}/.well-known/oauth-protected-resource`))
    expect(res).toBeInstanceOf(Response)
    expect(res!.status).toBe(200)
    const body = (await res!.json()) as { resource: string; authorization_servers: string[] }
    expect(body.resource).toBe(publicBaseUrl)
    expect(body.authorization_servers).toEqual([publicBaseUrl])
  })

  it('returns null for non-matching paths', async () => {
    const handler = createProtectedResourceHandler({ publicBaseUrl, oauthClient })
    const res = await handler(new Request(`${publicBaseUrl}/mcp`))
    expect(res).toBeNull()
  })

  it('returns null for non-GET methods', async () => {
    const handler = createProtectedResourceHandler({ publicBaseUrl, oauthClient })
    const res = await handler(
      new Request(`${publicBaseUrl}/.well-known/oauth-protected-resource`, { method: 'POST' }),
    )
    expect(res).toBeNull()
  })
})

describe('createAuthorizationServerHandler', () => {
  it('returns the AS discovery JSON with same-origin endpoints', async () => {
    const handler = createAuthorizationServerHandler({ publicBaseUrl, productRef, oauthClient })
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
    const handler = createAuthorizationServerHandler({ publicBaseUrl, productRef, oauthClient })
    const res = await handler(
      new Request(`${publicBaseUrl}/.well-known/oauth-authorization-server`),
    )
    const text = await res!.text()
    expect(text).not.toContain('product_ref')
    expect(text).not.toContain(productRef)
  })

  it('500s when productRef is missing', async () => {
    const handler = createAuthorizationServerHandler({
      publicBaseUrl,
      productRef: '',
      oauthClient,
    })
    const res = await handler(
      new Request(`${publicBaseUrl}/.well-known/oauth-authorization-server`),
    )
    expect(res!.status).toBe(200)
  })
})

describe('createOpenidNotFoundHandler', () => {
  it('returns 404 for /.well-known/openid-configuration', async () => {
    const handler = createOpenidNotFoundHandler({ oauthClient })
    const res = await handler(new Request(`${publicBaseUrl}/.well-known/openid-configuration`))
    expect(res!.status).toBe(404)
  })
})

describe('createOAuthRegisterHandler', () => {
  it('dispatches register through the native OAuth client', async () => {
    const client = replyOauth(
      201,
      { client_id: 'c_1' },
      { 'access-control-allow-origin': 'cursor://mcp', vary: 'Origin' },
    )
    const handler = createOAuthRegisterHandler({ apiBaseUrl, productRef, oauthClient: client })
    const res = await handler(
      new Request(`${publicBaseUrl}/oauth/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'cursor://mcp' },
        body: JSON.stringify({ redirect_uris: ['cursor://cb'] }),
      }),
    )

    expect(res!.status).toBe(201)
    expect(res!.headers.get('access-control-allow-origin')).toBe('cursor://mcp')
    expect(client.calls[0]).toMatchObject({ path: '/oauth/register', method: 'POST' })
  })

  it('handles OPTIONS with CORS preflight', async () => {
    const handler = createOAuthRegisterHandler({ apiBaseUrl, productRef, oauthClient })
    const res = await handler(
      new Request(`${publicBaseUrl}/oauth/register`, {
        method: 'OPTIONS',
        headers: { origin: 'cursor://mcp', 'access-control-request-method': 'POST' },
      }),
    )
    expect(res!.status).toBe(204)
    expect(res!.headers.get('access-control-allow-origin')).toBe('cursor://mcp')
  })

  it('relays 502 when the OAuth client reports upstream unreachable', async () => {
    const handler = createOAuthRegisterHandler({
      apiBaseUrl,
      productRef,
      oauthClient: replyOauth(502, { error: 'upstream_unreachable' }),
    })
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

  it('relays a non-2xx register result from the OAuth client', async () => {
    const handler = createOAuthRegisterHandler({
      apiBaseUrl,
      productRef,
      oauthClient: replyOauth(400, {
        message:
          'Invalid identifier. Use mcp_server_id for hosted MCP, or product_ref for non-hosted MCP.',
      }),
    })
    const res = await handler(
      new Request(`${publicBaseUrl}/oauth/register`, {
        method: 'POST',
        body: '{}',
      }),
    )
    expect(res!.status).toBe(400)
  })
})

describe('createOAuthAuthorizeHandler', () => {
  it('302 redirects to upstream preserving query string', async () => {
    const query =
      'response_type=code&client_id=c_1&code_challenge=abc&code_challenge_method=S256&redirect_uri=' +
      encodeURIComponent('cursor://cb')
    const location = `${apiBaseUrl}/v1/customer/auth/authorize?${query}`
    const handler = createOAuthAuthorizeHandler({
      apiBaseUrl,
      oauthClient: recordingOauthClient({ status: 302, headers: { location }, body: null }),
    })
    const res = await handler(new Request(`${publicBaseUrl}/oauth/authorize?${query}`))
    expect(res!.status).toBe(302)
    expect(res!.headers.get('location')).toBe(location)
  })

  it('preserves resource in the upstream authorize redirect', async () => {
    const resource = 'https://mcp.example.com'
    const query =
      `response_type=code&client_id=c_1&redirect_uri=${encodeURIComponent('cursor://cb')}` +
      `&resource=${encodeURIComponent(resource)}`
    const location = `${apiBaseUrl}/v1/customer/auth/authorize?${query}`
    const handler = createOAuthAuthorizeHandler({
      apiBaseUrl,
      oauthClient: recordingOauthClient({ status: 302, headers: { location }, body: null }),
    })
    const res = await handler(new Request(`${publicBaseUrl}/oauth/authorize?${query}`))
    expect(res!.status).toBe(302)
    expect(res!.headers.get('location')).toBe(location)
  })
})

describe('createOAuthTokenHandler', () => {
  it('forwards the token request through the OAuth client', async () => {
    const client = recordingOauthClient({
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: { access_token: 'AT', token_type: 'Bearer' },
    })
    const handler = createOAuthTokenHandler({ apiBaseUrl, oauthClient: client })
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
    expect(client.calls[0]).toMatchObject({ path: '/oauth/token', body })
  })

  it('relays OAuth token errors from the client', async () => {
    const handler = createOAuthTokenHandler({
      apiBaseUrl,
      oauthClient: replyOauth(400, {
        error: 'unsupported_grant_type',
        error_description: 'grant_type',
      }),
    })
    const res = await handler(
      new Request(`${publicBaseUrl}/oauth/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: 'grant_type=password',
      }),
    )
    expect(res!.status).toBe(400)
    const payload = (await res!.json()) as { error: string }
    expect(payload.error).toBe('unsupported_grant_type')
  })
})

describe('createOAuthRevokeHandler', () => {
  it('dispatches revoke through the OAuth client', async () => {
    const client = recordingOauthClient({ status: 200, headers: {}, body: null })
    const handler = createOAuthRevokeHandler({ apiBaseUrl, oauthClient: client })
    const res = await handler(
      new Request(`${publicBaseUrl}/oauth/revoke`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: 'token=abc&token_type_hint=access_token',
      }),
    )
    expect(res!.status).toBe(200)
    expect(client.calls[0]).toMatchObject({ path: '/oauth/revoke' })
  })
})

describe('createOAuthFetchRouter', () => {
  it('rejects invalid productRef at construction', () => {
    expect(() =>
      createOAuthFetchRouter({
        publicBaseUrl,
        apiBaseUrl,
        productRef: '__SOLVAPAY_PRODUCT_REF__',
      }),
    ).toThrow(/scaffolder placeholder/)
    expect(() =>
      createOAuthFetchRouter({ publicBaseUrl, apiBaseUrl, productRef: '' }),
    ).toThrow(/productRef is required/)
  })

  it('routes each well-known + /oauth path, returns null otherwise', async () => {
    const router = createOAuthFetchRouter({ publicBaseUrl, apiBaseUrl, productRef, oauthClient })

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

  it('puts mcpPath on the protected-resource identifier', async () => {
    const mcpPath = '/agents'
    const router = createOAuthFetchRouter({
      publicBaseUrl,
      apiBaseUrl,
      productRef,
      oauthClient,
      mcpPath,
    })

    const defaultPath = await router(
      new Request(`${publicBaseUrl}/.well-known/oauth-protected-resource`),
    )
    expect(defaultPath!.status).toBe(200)
    expect(((await defaultPath!.json()) as { resource: string }).resource).toBe(
      `${publicBaseUrl}${mcpPath}`,
    )

    const pathAware = await router(
      new Request(`${publicBaseUrl}/.well-known/oauth-protected-resource${mcpPath}`),
    )
    expect(pathAware!.status).toBe(200)
    expect(((await pathAware!.json()) as { resource: string }).resource).toBe(
      `${publicBaseUrl}${mcpPath}`,
    )
  })
})
