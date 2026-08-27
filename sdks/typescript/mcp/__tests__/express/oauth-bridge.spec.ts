import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getOAuthAuthorizationServerResponse,
  getOAuthProtectedResourceResponse,
} from '@solvapay/mcp-core'
import {
  createMcpOAuthBridge,
  createOAuthAuthorizeHandler,
  createOAuthRegisterHandler,
  createOAuthRevokeHandler,
  createOAuthTokenHandler,
} from '../../src/express/oauth-bridge'
import { nativeOauthClient, recordingOauthClient, replyOauth } from '../native-oauth-client'

type Headers = Record<string, string | string[] | undefined>

interface MockReqInit {
  method?: string
  path?: string
  url?: string
  headers?: Headers
  body?: unknown
}

function mockReq(init: MockReqInit = {}) {
  const path = init.path ?? '/'
  return {
    method: init.method ?? 'GET',
    path,
    url: init.url ?? path,
    headers: init.headers ?? {},
    body: init.body,
  }
}

interface MockResState {
  statusCode: number
  headers: Record<string, string>
  body: unknown
  bodyText: string | undefined
  ended: boolean
}

function mockRes() {
  const state: MockResState = {
    statusCode: 200,
    headers: {},
    body: undefined,
    bodyText: undefined,
    ended: false,
  }
  const res = {
    status(code: number) {
      state.statusCode = code
      return res
    },
    json(payload: unknown) {
      state.body = payload
      state.bodyText = JSON.stringify(payload)
      state.ended = true
    },
    setHeader(name: string, value: string) {
      state.headers[name.toLowerCase()] = value
    },
    end(body?: string) {
      if (body !== undefined) state.bodyText = body
      state.ended = true
    },
    send(body?: string | Buffer) {
      if (typeof body === 'string') state.bodyText = body
      else if (body) state.bodyText = body.toString('utf8')
      state.ended = true
    },
  }
  return { res, state }
}

const apiBaseUrl = 'https://api.solvapay.com'
const publicBaseUrl = 'https://mcp.example.com'
const productRef = 'prd_test_123'
const oauthClient = nativeOauthClient('http://127.0.0.1:1')

describe('getOAuthAuthorizationServerResponse', () => {
  it('uses publicBaseUrl as issuer and hosts all endpoints on the same origin', () => {
    const doc = getOAuthAuthorizationServerResponse({ publicBaseUrl })

    expect(doc.issuer).toBe(publicBaseUrl)
    expect(doc.authorization_endpoint).toBe(`${publicBaseUrl}/oauth/authorize`)
    expect(doc.token_endpoint).toBe(`${publicBaseUrl}/oauth/token`)
    expect(doc.registration_endpoint).toBe(`${publicBaseUrl}/oauth/register`)
    expect(doc.revocation_endpoint).toBe(`${publicBaseUrl}/oauth/revoke`)
    expect(doc.code_challenge_methods_supported).toContain('S256')
    expect(doc.response_types_supported).toContain('code')
    expect(doc.grant_types_supported).toEqual(
      expect.arrayContaining(['authorization_code', 'refresh_token']),
    )

    // Negative assertion: product_ref must never appear in the discovery JSON —
    // it's a server-side secret injected only into `/oauth/register?product_ref=…`.
    expect(JSON.stringify(doc)).not.toContain('product_ref')
  })

  it('strips trailing slashes from publicBaseUrl', () => {
    const doc = getOAuthAuthorizationServerResponse({ publicBaseUrl: `${publicBaseUrl}/` })
    expect(doc.issuer).toBe(publicBaseUrl)
    expect(doc.token_endpoint).toBe(`${publicBaseUrl}/oauth/token`)
  })

  it('respects custom path overrides', () => {
    const doc = getOAuthAuthorizationServerResponse({
      publicBaseUrl,
      paths: { register: '/auth/dcr', token: '/auth/token' },
    })
    expect(doc.registration_endpoint).toBe(`${publicBaseUrl}/auth/dcr`)
    expect(doc.token_endpoint).toBe(`${publicBaseUrl}/auth/token`)
    expect(doc.authorization_endpoint).toBe(`${publicBaseUrl}/oauth/authorize`)
  })
})

describe('getOAuthProtectedResourceResponse', () => {
  it('points authorization_servers at the MCP origin', () => {
    const doc = getOAuthProtectedResourceResponse(publicBaseUrl)
    expect(doc.resource).toBe(publicBaseUrl)
    expect(doc.authorization_servers).toEqual([publicBaseUrl])
  })
})

describe('createOAuthRegisterHandler', () => {
  it('dispatches register through the OAuth client', async () => {
    const client = replyOauth(201, { client_id: 'client_abc', client_secret: 'secret' })
    const handler = createOAuthRegisterHandler({ apiBaseUrl, productRef, oauthClient: client })
    const { res, state } = mockRes()
    const req = mockReq({
      method: 'POST',
      path: '/oauth/register',
      headers: { 'content-type': 'application/json' },
      body: { client_name: 'My Client', redirect_uris: ['cursor://callback'] },
    })
    await handler(req, res, vi.fn())
    expect(state.statusCode).toBe(201)
    expect(client.calls[0]).toMatchObject({ path: '/oauth/register', method: 'POST' })
  })

  it('relays 502 when the OAuth client reports upstream unreachable', async () => {
    const handler = createOAuthRegisterHandler({
      apiBaseUrl,
      productRef,
      oauthClient: replyOauth(502, { error: 'upstream_unreachable' }),
    })
    const { res, state } = mockRes()
    await handler(
      mockReq({ method: 'POST', path: '/oauth/register', body: {} }),
      res,
      vi.fn(),
    )
    expect(state.statusCode).toBe(502)
    expect(state.body).toEqual({ error: 'upstream_unreachable' })
  })
})

describe('createOAuthAuthorizeHandler', () => {
  it('302 redirects using the OAuth client location', async () => {
    const location =
      `${apiBaseUrl}/v1/customer/auth/authorize?response_type=code&client_id=c_1`
    const handler = createOAuthAuthorizeHandler({
      apiBaseUrl,
      oauthClient: recordingOauthClient({ status: 302, headers: { location }, body: null }),
    })
    const { res, state } = mockRes()
    await handler(
      mockReq({
        method: 'GET',
        path: '/oauth/authorize',
        url: '/oauth/authorize?response_type=code&client_id=c_1',
      }),
      res,
      vi.fn(),
    )
    expect(state.statusCode).toBe(302)
    expect(state.headers['location']).toBe(location)
  })
})

describe('createOAuthTokenHandler', () => {
  it('dispatches token through the OAuth client', async () => {
    const client = replyOauth(200, { access_token: 'AT', token_type: 'Bearer' })
    const handler = createOAuthTokenHandler({ apiBaseUrl, oauthClient: client })
    const { res, state } = mockRes()
    await handler(
      mockReq({
        method: 'POST',
        path: '/oauth/token',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: 'grant_type=authorization_code&code=abc',
      }),
      res,
      vi.fn(),
    )
    expect(state.statusCode).toBe(200)
    expect(client.calls[0]).toMatchObject({ path: '/oauth/token' })
  })

  it('relays OAuth token errors from the client', async () => {
    const handler = createOAuthTokenHandler({
      apiBaseUrl,
      oauthClient: replyOauth(400, {
        error: 'unsupported_grant_type',
        error_description: 'grant_type',
      }),
    })
    const { res, state } = mockRes()
    await handler(
      mockReq({
        method: 'POST',
        path: '/oauth/token',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: 'grant_type=password',
      }),
      res,
      vi.fn(),
    )
    expect(state.statusCode).toBe(400)
    expect((state.body as { error: string }).error).toBe('unsupported_grant_type')
  })
})

describe('createOAuthRevokeHandler', () => {
  it('dispatches revoke through the OAuth client', async () => {
    const client = recordingOauthClient({ status: 200, headers: {}, body: null })
    const handler = createOAuthRevokeHandler({ apiBaseUrl, oauthClient: client })
    const { res, state } = mockRes()
    await handler(
      mockReq({
        method: 'POST',
        path: '/oauth/revoke',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: 'token=abc',
      }),
      res,
      vi.fn(),
    )
    expect(state.statusCode).toBe(200)
    expect(client.calls[0]).toMatchObject({ path: '/oauth/revoke' })
  })
})

describe('createMcpOAuthBridge integration', () => {
  it('rejects invalid productRef at construction', () => {
    expect(() =>
      createMcpOAuthBridge({
        publicBaseUrl,
        apiBaseUrl,
        productRef: 'not-a-product',
      }),
    ).toThrow(/prd_/)
    expect(() =>
      createMcpOAuthBridge({
        publicBaseUrl,
        apiBaseUrl,
        productRef: '',
      }),
    ).toThrow(/productRef is required/)
  })

  it('mounts discovery, register, authorize, token and revoke middlewares', async () => {
    const middlewares = createMcpOAuthBridge({
    publicBaseUrl,
    apiBaseUrl,
    productRef,
    oauthClient,
    })
    expect(middlewares.length).toBeGreaterThanOrEqual(7)
  })

  it('serves discovery doc hosted on publicBaseUrl — and no product_ref leaks into it', async () => {
    const middlewares = createMcpOAuthBridge({
    publicBaseUrl,
    apiBaseUrl,
    productRef,
    oauthClient,
    })
    const { res, state } = mockRes()
    const req = mockReq({ method: 'GET', path: '/.well-known/oauth-authorization-server' })
    await runPipeline(middlewares, req, res, state)

    const body = state.body as { issuer: string; registration_endpoint: string }
    expect(body.issuer).toBe(publicBaseUrl)
    expect(body.registration_endpoint).toBe(`${publicBaseUrl}/oauth/register`)
    expect(JSON.stringify(body)).not.toContain('product_ref')
  })

  it('returns 405 with Allow: POST, OPTIONS on GET /mcp', async () => {
    const middlewares = createMcpOAuthBridge({
    publicBaseUrl,
    apiBaseUrl,
    productRef,
    oauthClient,
    })
    const { res, state } = mockRes()
    const req = mockReq({
      method: 'GET',
      path: '/mcp',
      headers: { accept: 'text/event-stream' },
    })

    await runPipeline(middlewares, req, res, state)

    expect(state.statusCode).toBe(405)
    expect(state.headers['allow']).toBe('POST, OPTIONS')
    expect(state.ended).toBe(true)
  })

  it('mirrors native-scheme Origin on GET /mcp 405', async () => {
    const middlewares = createMcpOAuthBridge({
    publicBaseUrl,
    apiBaseUrl,
    productRef,
    oauthClient,
    })
    const { res, state } = mockRes()
    const req = mockReq({
      method: 'GET',
      path: '/mcp',
      headers: { origin: 'cursor://test', accept: 'text/event-stream' },
    })

    await runPipeline(middlewares, req, res, state)

    expect(state.statusCode).toBe(405)
    expect(state.headers['allow']).toBe('POST, OPTIONS')
    expect(state.headers['access-control-allow-origin']).toBe('cursor://test')
  })

  it('allows anonymous initialize through mcp auth middleware', async () => {
    const middlewares = createMcpOAuthBridge({
    publicBaseUrl,
    apiBaseUrl,
    productRef,
    oauthClient,
    })
    const { res, state } = mockRes()
    const req = mockReq({
      method: 'POST',
      path: '/mcp',
      headers: { origin: 'cursor://test', 'content-type': 'application/json' },
      body: { jsonrpc: '2.0', id: 1, method: 'initialize' },
    })

    await runPipeline(middlewares, req, res, state)

    // Discovery methods pass through without ending the response.
    expect(state.ended).toBe(false)
    expect(state.statusCode).toBe(200)
  })

  it('challenges anonymous initialize when authMode is all', async () => {
    const middlewares = createMcpOAuthBridge({
    publicBaseUrl,
    apiBaseUrl,
    productRef,
    oauthClient,
      authMode: 'all',
    })
    const { res, state } = mockRes()
    const req = mockReq({
      method: 'POST',
      path: '/mcp',
      headers: { origin: 'cursor://test', 'content-type': 'application/json' },
      body: { jsonrpc: '2.0', id: 1, method: 'initialize' },
    })

    await runPipeline(middlewares, req, res, state)

    expect(state.statusCode).toBe(401)
    expect(state.headers['www-authenticate']).toContain('Bearer')
    expect(state.headers['www-authenticate']).toContain('resource_metadata=')
    expect(state.body).toEqual({
      jsonrpc: '2.0',
      id: 1,
      error: { code: -32001, message: 'Unauthorized' },
    })
  })

  it('exposes WWW-Authenticate via CORS on 401 anonymous tools/call with native origin', async () => {
    const middlewares = createMcpOAuthBridge({
    publicBaseUrl,
    apiBaseUrl,
    productRef,
    oauthClient,
    })
    const { res, state } = mockRes()
    const req = mockReq({
      method: 'POST',
      path: '/mcp',
      headers: { origin: 'cursor://test', 'content-type': 'application/json' },
      body: {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'echo', arguments: {} },
      },
    })

    await runPipeline(middlewares, req, res, state)

    expect(state.statusCode).toBe(401)
    expect(state.headers['access-control-allow-origin']).toBe('cursor://test')
    expect(state.headers['access-control-expose-headers']).toBe('WWW-Authenticate')
    expect(state.headers['www-authenticate']).toContain('Bearer')
    expect(state.headers['www-authenticate']).toContain('resource_metadata=')
    expect(state.body).toEqual({
      jsonrpc: '2.0',
      id: 1,
      error: { code: -32001, message: 'Unauthorized' },
    })
  })

  it('returns 404 on GET /.well-known/openid-configuration (SolvaPay is an OAuth AS, not an OIDC Provider)', async () => {
    const middlewares = createMcpOAuthBridge({
    publicBaseUrl,
    apiBaseUrl,
    productRef,
    oauthClient,
    })
    const { res, state } = mockRes()
    const req = mockReq({
      method: 'GET',
      path: '/.well-known/openid-configuration',
      headers: { origin: 'cursor://test' },
    })

    await runPipeline(middlewares, req, res, state)

    expect(state.statusCode).toBe(404)
    expect(state.ended).toBe(true)
    expect(state.headers['access-control-allow-origin']).toBe('cursor://test')
  })

  it('proxies DCR through the mounted register middleware', async () => {
    const client = replyOauth(201, { client_id: 'c1' })
    const middlewares = createMcpOAuthBridge({
      publicBaseUrl,
      apiBaseUrl,
      productRef,
      oauthClient: client,
    })
    const { res, state } = mockRes()
    const req = mockReq({
      method: 'POST',
      path: '/oauth/register',
      headers: { 'content-type': 'application/json' },
      body: { client_name: 'c' },
    })

    await runPipeline(middlewares, req, res, state)

    expect(state.statusCode).toBe(201)
    expect(client.calls[0]).toMatchObject({ path: '/oauth/register' })
  })

  it('puts mcpPath on the protected-resource identifier and the auth challenge', async () => {
    const mcpPath = '/agents'
    const middlewares = createMcpOAuthBridge({
    publicBaseUrl,
    apiBaseUrl,
    productRef,
    oauthClient,
      mcpPath,
    })

    const discovery = mockRes()
    await runPipeline(
      middlewares,
      mockReq({ method: 'GET', path: '/.well-known/oauth-protected-resource' }),
      discovery.res,
      discovery.state,
    )
    expect(discovery.state.statusCode).toBe(200)
    expect(discovery.state.body).toEqual(
      expect.objectContaining({ resource: `${publicBaseUrl}${mcpPath}` }),
    )

    const pathAware = mockRes()
    await runPipeline(
      middlewares,
      mockReq({ method: 'GET', path: `/.well-known/oauth-protected-resource${mcpPath}` }),
      pathAware.res,
      pathAware.state,
    )
    expect(pathAware.state.statusCode).toBe(200)
    expect(pathAware.state.body).toEqual(
      expect.objectContaining({ resource: `${publicBaseUrl}${mcpPath}` }),
    )

    const challenge = mockRes()
    await runPipeline(
      middlewares,
      mockReq({
        method: 'POST',
        path: mcpPath,
        body: { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'echo' } },
      }),
      challenge.res,
      challenge.state,
    )
    expect(challenge.state.statusCode).toBe(401)
    expect(challenge.state.headers['www-authenticate']).toContain(
      `resource_metadata="${publicBaseUrl}/.well-known/oauth-protected-resource${mcpPath}"`,
    )
  })
})

type AnyMiddleware = (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  req: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  res: any,
  next: () => void,
) => void | Promise<void>

async function runPipeline(
  middlewares: AnyMiddleware[],
  req: ReturnType<typeof mockReq>,
  res: ReturnType<typeof mockRes>['res'],
  state: MockResState,
) {
  for (const mw of middlewares) {
    if (state.ended) return
    let nextCalled = false
    const maybePromise = mw(req, res, () => {
      nextCalled = true
    })
    if (maybePromise && typeof (maybePromise as Promise<void>).then === 'function') {
      await maybePromise
    }
    if (state.ended) return
    if (!nextCalled) return
  }
}
