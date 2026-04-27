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

function jsonFetchResponse(
  status: number,
  body: unknown,
  extraHeaders: Record<string, string> = {},
) {
  const text = JSON.stringify(body)
  return new Response(text, {
    status,
    headers: { 'content-type': 'application/json', ...extraHeaders },
  })
}

const apiBaseUrl = 'https://api.solvapay.com'
const publicBaseUrl = 'https://mcp.example.com'
const productRef = 'prd_test_123'

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
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('forwards JSON body to /v1/customer/auth/register with product_ref injected', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonFetchResponse(201, { client_id: 'client_abc', client_secret: 'secret' }),
    )

    const handler = createOAuthRegisterHandler({ apiBaseUrl, productRef })
    const { res, state } = mockRes()
    const req = mockReq({
      method: 'POST',
      path: '/oauth/register',
      headers: { 'content-type': 'application/json' },
      body: { client_name: 'My Client', redirect_uris: ['cursor://callback'] },
    })

    const next = vi.fn()
    await handler(req, res, next)

    expect(next).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [calledUrl, calledInit] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(calledUrl).toBe(
      `${apiBaseUrl}/v1/customer/auth/register?product_ref=${encodeURIComponent(productRef)}`,
    )
    expect(calledInit.method).toBe('POST')
    expect(calledInit.body).toBe(
      JSON.stringify({ client_name: 'My Client', redirect_uris: ['cursor://callback'] }),
    )
    const headers = calledInit.headers as Record<string, string>
    expect(headers['content-type']).toBe('application/json')

    expect(state.statusCode).toBe(201)
    expect(state.body).toEqual({ client_id: 'client_abc', client_secret: 'secret' })
  })

  it('propagates upstream 400 error payload unchanged', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonFetchResponse(400, { error: 'invalid_redirect_uri', error_description: 'bad uri' }),
    )

    const handler = createOAuthRegisterHandler({ apiBaseUrl, productRef })
    const { res, state } = mockRes()
    await handler(
      mockReq({
        method: 'POST',
        path: '/oauth/register',
        headers: { 'content-type': 'application/json' },
        body: { redirect_uris: ['not-a-url'] },
      }),
      res,
      vi.fn(),
    )

    expect(state.statusCode).toBe(400)
    expect(state.body).toEqual({ error: 'invalid_redirect_uri', error_description: 'bad uri' })
  })

  it('returns 502 when upstream is unreachable', async () => {
    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'))

    const handler = createOAuthRegisterHandler({ apiBaseUrl, productRef })
    const { res, state } = mockRes()
    await handler(
      mockReq({
        method: 'POST',
        path: '/oauth/register',
        headers: { 'content-type': 'application/json' },
        body: { client_name: 'x' },
      }),
      res,
      vi.fn(),
    )

    expect(state.statusCode).toBe(502)
    expect(state.body).toEqual({ error: 'upstream_unreachable' })
  })

  it('responds to CORS preflight for native-scheme origins', async () => {
    const handler = createOAuthRegisterHandler({ apiBaseUrl, productRef })
    const { res, state } = mockRes()
    await handler(
      mockReq({
        method: 'OPTIONS',
        path: '/oauth/register',
        headers: {
          origin: 'cursor://anysession',
          'access-control-request-method': 'POST',
          'access-control-request-headers': 'content-type',
        },
      }),
      res,
      vi.fn(),
    )

    expect(state.statusCode).toBe(204)
    expect(state.headers['access-control-allow-origin']).toBe('cursor://anysession')
    expect(state.headers['access-control-allow-methods']).toContain('POST')
    expect(state.headers['access-control-allow-headers']).toMatch(/content-type/i)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('ignores requests on other paths', async () => {
    const handler = createOAuthRegisterHandler({ apiBaseUrl, productRef })
    const { res, state } = mockRes()
    const next = vi.fn()
    await handler(mockReq({ method: 'POST', path: '/other' }), res, next)

    expect(next).toHaveBeenCalled()
    expect(state.ended).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('createOAuthAuthorizeHandler', () => {
  it('302 redirects to upstream authorize endpoint preserving query string', async () => {
    const handler = createOAuthAuthorizeHandler({ apiBaseUrl })
    const { res, state } = mockRes()
    const query =
      '?response_type=code&client_id=client_abc&redirect_uri=cursor%3A%2F%2Fcb&code_challenge=x&code_challenge_method=S256'
    await handler(
      mockReq({ method: 'GET', path: '/oauth/authorize', url: `/oauth/authorize${query}` }),
      res,
      vi.fn(),
    )

    expect(state.statusCode).toBe(302)
    expect(state.headers['location']).toBe(`${apiBaseUrl}/v1/customer/auth/authorize${query}`)
    expect(state.ended).toBe(true)
  })

  it('passes through when method is not GET', async () => {
    const handler = createOAuthAuthorizeHandler({ apiBaseUrl })
    const { res, state } = mockRes()
    const next = vi.fn()
    await handler(mockReq({ method: 'POST', path: '/oauth/authorize' }), res, next)
    expect(next).toHaveBeenCalled()
    expect(state.ended).toBe(false)
  })
})

describe('createOAuthTokenHandler', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('forwards form-encoded body and Authorization header to upstream /token', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonFetchResponse(200, { access_token: 'tok', token_type: 'Bearer', expires_in: 3600 }),
    )

    const handler = createOAuthTokenHandler({ apiBaseUrl })
    const { res, state } = mockRes()
    await handler(
      mockReq({
        method: 'POST',
        path: '/oauth/token',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          authorization: 'Basic Y2xpZW50OnNlY3JldA==',
        },
        body: 'grant_type=authorization_code&code=abc&redirect_uri=cursor%3A%2F%2Fcb',
      }),
      res,
      vi.fn(),
    )

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [calledUrl, calledInit] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(calledUrl).toBe(`${apiBaseUrl}/v1/customer/auth/token`)
    const headers = calledInit.headers as Record<string, string>
    expect(headers['content-type']).toBe('application/x-www-form-urlencoded')
    expect(headers['authorization']).toBe('Basic Y2xpZW50OnNlY3JldA==')
    expect(calledInit.body).toBe(
      'grant_type=authorization_code&code=abc&redirect_uri=cursor%3A%2F%2Fcb',
    )

    expect(state.statusCode).toBe(200)
    expect(state.body).toEqual({ access_token: 'tok', token_type: 'Bearer', expires_in: 3600 })
  })

  it('re-serializes a parsed form body object when middleware already parsed it', async () => {
    fetchMock.mockResolvedValueOnce(jsonFetchResponse(200, { access_token: 'tok' }))

    const handler = createOAuthTokenHandler({ apiBaseUrl })
    const { res } = mockRes()
    await handler(
      mockReq({
        method: 'POST',
        path: '/oauth/token',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: { grant_type: 'refresh_token', refresh_token: 'rt' },
      }),
      res,
      vi.fn(),
    )

    const [, calledInit] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = String(calledInit.body)
    const parsed = new URLSearchParams(body)
    expect(parsed.get('grant_type')).toBe('refresh_token')
    expect(parsed.get('refresh_token')).toBe('rt')
  })
})

describe('createOAuthTokenHandler — RFC 6749 §5.2 error normalisation', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  async function invokeToken(body: unknown = 'grant_type=refresh_token&refresh_token=rt') {
    const handler = createOAuthTokenHandler({ apiBaseUrl })
    const { res, state } = mockRes()
    await handler(
      mockReq({
        method: 'POST',
        path: '/oauth/token',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body,
      }),
      res,
      vi.fn(),
    )
    return state
  }

  it('relays a 2xx upstream body verbatim (no rewriting of successful token payloads)', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonFetchResponse(200, { access_token: 'tok', token_type: 'Bearer', expires_in: 3600 }),
    )

    const state = await invokeToken()

    expect(state.statusCode).toBe(200)
    expect(state.body).toEqual({
      access_token: 'tok',
      token_type: 'Bearer',
      expires_in: 3600,
    })
  })

  it('maps a NestJS Zod validation error for missing grant_type to invalid_request', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonFetchResponse(400, {
        statusCode: 400,
        message: 'Validation failed',
        errors: [
          {
            code: 'invalid_type',
            expected: 'string',
            received: 'undefined',
            path: ['grant_type'],
            message: 'Required',
          },
        ],
        timestamp: '2026-04-20T17:35:19.912Z',
        path: '/v1/customer/auth/token',
      }),
    )

    const state = await invokeToken()

    expect(state.statusCode).toBe(400)
    expect(state.body).toEqual({
      error: 'invalid_request',
      error_description: 'grant_type: Required',
    })
    expect(state.headers['content-type']).toBe('application/json')
  })

  it('maps a received-but-unknown grant_type to unsupported_grant_type', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonFetchResponse(400, {
        statusCode: 400,
        message: 'Validation failed',
        errors: [
          {
            code: 'invalid_enum_value',
            received: 'password',
            path: ['grant_type'],
            message: 'grant_type must be authorization_code or refresh_token',
          },
        ],
      }),
    )

    const state = await invokeToken()

    expect(state.body).toMatchObject({ error: 'unsupported_grant_type' })
  })

  it('maps a code-path validation failure to invalid_grant', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonFetchResponse(400, {
        statusCode: 400,
        message: 'Authorization code expired',
        errors: [{ path: ['code'], message: 'Code not found or expired' }],
      }),
    )

    const state = await invokeToken()

    expect(state.body).toMatchObject({
      error: 'invalid_grant',
      error_description: expect.stringContaining('Code not found'),
    })
  })

  it('maps a 401 upstream to invalid_client and preserves the 401 status', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonFetchResponse(401, {
        statusCode: 401,
        message: 'Invalid client credentials',
      }),
    )

    const state = await invokeToken()

    expect(state.statusCode).toBe(401)
    expect(state.body).toEqual({
      error: 'invalid_client',
      error_description: 'Invalid client credentials',
    })
  })

  it('maps a 500 upstream to server_error', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonFetchResponse(500, { statusCode: 500, message: 'Internal error' }),
    )

    const state = await invokeToken()

    expect(state.statusCode).toBe(500)
    expect(state.body).toMatchObject({ error: 'server_error' })
  })

  it('passes an already-OAuth-shaped error body through verbatim', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonFetchResponse(400, {
        error: 'invalid_grant',
        error_description: 'Refresh token revoked',
      }),
    )

    const state = await invokeToken()

    expect(state.body).toEqual({
      error: 'invalid_grant',
      error_description: 'Refresh token revoked',
    })
  })

  it('handles a non-JSON upstream body with a generic invalid_request', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('upstream went sideways', {
        status: 400,
        headers: { 'content-type': 'text/plain' },
      }),
    )

    const state = await invokeToken()

    expect(state.body).toEqual({
      error: 'invalid_request',
      error_description: 'upstream went sideways',
    })
  })

  it('normalizes NestJS 401 bodies with a non-RFC `error` field into invalid_client', async () => {
    // NestJS ExceptionFilter ships `{ error: "Unauthorized", message,
    // statusCode }` on 401. `"Unauthorized"` is a string but NOT an
    // RFC 6749 §5.2 token error code, so the normalizer must map it
    // via deriveOAuthErrorCode rather than pass it through unchanged.
    fetchMock.mockResolvedValueOnce(
      jsonFetchResponse(401, {
        error: 'Unauthorized',
        message: 'Invalid or inactive client',
        statusCode: 401,
      }),
    )

    const state = await invokeToken()

    expect(state.statusCode).toBe(401)
    expect(state.body).toEqual({
      error: 'invalid_client',
      error_description: 'Invalid or inactive client',
    })
  })

  it('preserves upstream bodies whose `error` is in the RFC 6749 allow-list', async () => {
    // Defense against over-normalising — RFC 6749 codes from §5.2 and
    // §4.1.2.1 should pass through verbatim, including `access_denied`
    // which can surface on the token endpoint in practice.
    for (const code of [
      'invalid_request',
      'invalid_client',
      'invalid_grant',
      'unauthorized_client',
      'unsupported_grant_type',
      'invalid_scope',
      'server_error',
      'temporarily_unavailable',
      'access_denied',
    ] as const) {
      fetchMock.mockResolvedValueOnce(
        jsonFetchResponse(400, {
          error: code,
          error_description: `upstream described ${code}`,
        }),
      )
      const state = await invokeToken()
      expect(state.body, `expected ${code} to pass through unchanged`).toEqual({
        error: code,
        error_description: `upstream described ${code}`,
      })
    }
  })
})

describe('createOAuthRevokeHandler', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('forwards to upstream /revoke and mirrors status', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }))

    const handler = createOAuthRevokeHandler({ apiBaseUrl })
    const { res, state } = mockRes()
    await handler(
      mockReq({
        method: 'POST',
        path: '/oauth/revoke',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          authorization: 'Basic Y2xpZW50OnNlY3JldA==',
        },
        body: 'token=tok&token_type_hint=access_token',
      }),
      res,
      vi.fn(),
    )

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [calledUrl] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(calledUrl).toBe(`${apiBaseUrl}/v1/customer/auth/revoke`)
    expect(state.statusCode).toBe(200)
  })
})

describe('createMcpOAuthBridge integration', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('mounts discovery, register, authorize, token and revoke middlewares', async () => {
    const middlewares = createMcpOAuthBridge({
      publicBaseUrl,
      apiBaseUrl,
      productRef,
    })
    expect(middlewares.length).toBeGreaterThanOrEqual(7)
  })

  it('serves discovery doc hosted on publicBaseUrl — and no product_ref leaks into it', async () => {
    const middlewares = createMcpOAuthBridge({
      publicBaseUrl,
      apiBaseUrl,
      productRef,
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

  it('exposes WWW-Authenticate via CORS on 401 POST /mcp with native origin', async () => {
    const middlewares = createMcpOAuthBridge({
      publicBaseUrl,
      apiBaseUrl,
      productRef,
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
    expect(state.headers['access-control-allow-origin']).toBe('cursor://test')
    expect(state.headers['access-control-expose-headers']).toBe('WWW-Authenticate')
    expect(state.headers['www-authenticate']).toContain('Bearer')
    expect(state.headers['www-authenticate']).toContain('resource_metadata=')
  })

  it('returns 404 on GET /.well-known/openid-configuration (SolvaPay is an OAuth AS, not an OIDC Provider)', async () => {
    const middlewares = createMcpOAuthBridge({
      publicBaseUrl,
      apiBaseUrl,
      productRef,
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

  it('proxies DCR through the mounted register middleware with product_ref injected', async () => {
    fetchMock.mockResolvedValueOnce(jsonFetchResponse(201, { client_id: 'c1' }))

    const middlewares = createMcpOAuthBridge({
      publicBaseUrl,
      apiBaseUrl,
      productRef,
    })
    const { res, state } = mockRes()
    const req = mockReq({
      method: 'POST',
      path: '/oauth/register',
      headers: { 'content-type': 'application/json' },
      body: { client_name: 'c' },
    })

    await runPipeline(middlewares, req, res, state)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [calledUrl] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(calledUrl).toBe(
      `${apiBaseUrl}/v1/customer/auth/register?product_ref=${encodeURIComponent(productRef)}`,
    )
    expect(state.statusCode).toBe(201)
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
