import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSolvaPayMcpFetchHandler } from '../../src/fetch/handler'
import type { McpServerFactory } from '@modelcontextprotocol/server'

const publicBaseUrl = 'https://mcp.example.com'
const apiBaseUrl = 'https://api.solvapay.com'
const productRef = 'prd_test_123'

function mockFactory(): McpServerFactory {
  return vi.fn().mockReturnValue({
    connect: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  })
}

vi.mock('@modelcontextprotocol/server', async importOriginal => {
  const actual = await importOriginal<typeof import('@modelcontextprotocol/server')>()
  return {
    ...actual,
    createMcpHandler: vi.fn((factory: McpServerFactory) => ({
      fetch: vi.fn(async (req: Request) => {
        factory({ era: 'legacy', requestInfo: req })
        return new Response(
          JSON.stringify({ jsonrpc: '2.0', id: 1, result: { ok: true, url: req.url } }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }),
      close: vi.fn().mockResolvedValue(undefined),
      notify: {},
      bus: {},
    })),
  }
})

describe('createSolvaPayMcpFetchHandler', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('responds to CORS preflight on /mcp', async () => {
    const handler = createSolvaPayMcpFetchHandler({
      factory: mockFactory(),
      publicBaseUrl,
      apiBaseUrl,
      productRef,
    })
    const res = await handler(
      new Request(`${publicBaseUrl}/mcp`, {
        method: 'OPTIONS',
        headers: { origin: 'cursor://mcp' },
      }),
    )
    expect(res.status).toBe(204)
    expect(res.headers.get('access-control-allow-origin')).toBe('cursor://mcp')
  })

  it('serves OAuth discovery via the fetch router', async () => {
    const handler = createSolvaPayMcpFetchHandler({
      factory: mockFactory(),
      publicBaseUrl,
      apiBaseUrl,
      productRef,
    })
    const res = await handler(new Request(`${publicBaseUrl}/.well-known/oauth-protected-resource`))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { resource: string }
    expect(body.resource).toBe(publicBaseUrl)
  })

  it('returns 401 + WWW-Authenticate when no bearer is present on /mcp', async () => {
    const handler = createSolvaPayMcpFetchHandler({
      factory: mockFactory(),
      publicBaseUrl,
      apiBaseUrl,
      productRef,
    })
    const res = await handler(
      new Request(`${publicBaseUrl}/mcp`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'ping' }),
      }),
    )
    expect(res.status).toBe(401)
    expect(res.headers.get('www-authenticate')).toMatch(/resource_metadata=/)
    const body = (await res.json()) as { id: number }
    expect(body.id).toBe(7)
  })

  it('forwards authenticated requests to createMcpHandler.fetch', async () => {
    const factory = mockFactory()
    const handler = createSolvaPayMcpFetchHandler({
      factory,
      publicBaseUrl,
      apiBaseUrl,
      productRef,
    })
    const jwt =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
      Buffer.from(JSON.stringify({ sub: 'cust_1', exp: 9_999_999_999 })).toString('base64url') +
      '.sig'

    const res = await handler(
      new Request(`${publicBaseUrl}/mcp`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${jwt}`,
          origin: 'cursor://mcp',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
      }),
    )
    expect(res.status).toBe(200)
    expect(factory).toHaveBeenCalledTimes(1)
    const body = (await res.json()) as { result: { ok: boolean } }
    expect(body.result.ok).toBe(true)
  })

  it('skips auth when requireAuth=false and no Authorization header is present', async () => {
    const handler = createSolvaPayMcpFetchHandler({
      factory: mockFactory(),
      publicBaseUrl,
      apiBaseUrl,
      productRef,
      requireAuth: false,
    })
    const res = await handler(
      new Request(`${publicBaseUrl}/mcp`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'ping' }),
      }),
    )
    expect(res.status).toBe(200)
  })

  it('returns 405 for unsupported methods on /mcp', async () => {
    const handler = createSolvaPayMcpFetchHandler({
      factory: mockFactory(),
      publicBaseUrl,
      apiBaseUrl,
      productRef,
    })
    const res = await handler(new Request(`${publicBaseUrl}/mcp`, { method: 'GET' }))
    expect(res.status).toBe(405)
    expect(res.headers.get('allow')).toBe('POST, OPTIONS')
  })

  it('returns 404 for unknown paths', async () => {
    const handler = createSolvaPayMcpFetchHandler({
      factory: mockFactory(),
      publicBaseUrl,
      apiBaseUrl,
      productRef,
    })
    const res = await handler(new Request(`${publicBaseUrl}/random`))
    expect(res.status).toBe(404)
  })

  describe('SolvaPay-mode bearer path', () => {
    function post(headers: Record<string, string> = {}) {
      return new Request(`${publicBaseUrl}/mcp`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify({ jsonrpc: '2.0', id: 11, method: 'ping' }),
      })
    }

    it('challenges without an error attribute when no token is presented', async () => {
      const handler = createSolvaPayMcpFetchHandler({
        factory: mockFactory(),
        publicBaseUrl,
        apiBaseUrl,
        productRef,
      })
      const res = await handler(post())
      expect(res.status).toBe(401)
      expect(res.headers.get('www-authenticate')).toBe(
        `Bearer resource_metadata="${publicBaseUrl}/.well-known/oauth-protected-resource"`,
      )
    })

    it('maps McpBearerAuthError (malformed token) to 401 invalid_token', async () => {
      const handler = createSolvaPayMcpFetchHandler({
        factory: mockFactory(),
        publicBaseUrl,
        apiBaseUrl,
        productRef,
      })
      const res = await handler(post({ authorization: 'Bearer not-a-jwt' }))
      expect(res.status).toBe(401)
      expect(res.headers.get('www-authenticate')).toContain('error="invalid_token"')
      expect(res.headers.get('www-authenticate')).toContain('resource_metadata=')
    })

    it('maps a token without a customer claim to 401 invalid_token', async () => {
      const handler = createSolvaPayMcpFetchHandler({
        factory: mockFactory(),
        publicBaseUrl,
        apiBaseUrl,
        productRef,
      })
      const res = await handler(post({ authorization: `Bearer ${unsignedJwt({ foo: 'bar' })}` }))
      expect(res.status).toBe(401)
      expect(res.headers.get('www-authenticate')).toContain('error="invalid_token"')
    })

    it('runs verifyToken in SolvaPay mode too and honours its null', async () => {
      const verifyToken = vi.fn(async () => null)
      const handler = createSolvaPayMcpFetchHandler({
        factory: mockFactory(),
        publicBaseUrl,
        apiBaseUrl,
        productRef,
        verifyToken,
      })
      const res = await handler(post({ authorization: `Bearer ${unsignedJwt({ sub: 'cus_1' })}` }))
      expect(res.status).toBe(401)
      expect(res.headers.get('www-authenticate')).toContain('error="invalid_token"')
      expect(verifyToken).toHaveBeenCalledOnce()
      // SolvaPay-mode discovery stays mounted alongside verifyToken.
      const as = await handler(
        new Request(`${publicBaseUrl}/.well-known/oauth-authorization-server`),
      )
      expect(as.status).toBe(200)
    })
  })

  describe('external authorization server mode', () => {
    const issuer = 'https://tenant.eu.auth0.com/'
    const scopesSupported = ['openid', 'profile', 'email', 'offline_access']

    function externalHandler(
      overrides: Partial<Parameters<typeof createSolvaPayMcpFetchHandler>[0]> = {},
    ) {
      return createSolvaPayMcpFetchHandler({
        factory: mockFactory(),
        publicBaseUrl,
        apiBaseUrl,
        productRef,
        verifyToken: async () => ({ subject: 'cus_verified' }),
        authorizationServer: { issuers: [issuer], scopesSupported },
        ...overrides,
      })
    }

    function post(headers: Record<string, string> = {}, id = 21) {
      return new Request(`${publicBaseUrl}/mcp`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify({ jsonrpc: '2.0', id, method: 'ping' }),
      })
    }

    it('serves a PRM pointing at the issuers with resource = publicBaseUrl + mcpPath', async () => {
      const res = await externalHandler()(
        new Request(`${publicBaseUrl}/.well-known/oauth-protected-resource`),
      )
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({
        resource: `${publicBaseUrl}/mcp`,
        authorization_servers: [issuer],
        scopes_supported: scopesSupported,
      })
    })

    it('honours an explicit resource and a custom mcpPath', async () => {
      const handler = externalHandler({
        mcpPath: '/api/mcp',
        authorizationServer: {
          issuers: [issuer],
          scopesSupported,
          resource: 'https://canonical.example.com/mcp',
        },
      })
      const res = await handler(
        new Request(`${publicBaseUrl}/.well-known/oauth-protected-resource`),
      )
      expect(((await res.json()) as { resource: string }).resource).toBe(
        'https://canonical.example.com/mcp',
      )

      const defaulted = externalHandler({ mcpPath: '/api/mcp' })
      const res2 = await defaulted(
        new Request(`${publicBaseUrl}/.well-known/oauth-protected-resource`),
      )
      expect(((await res2.json()) as { resource: string }).resource).toBe(
        `${publicBaseUrl}/api/mcp`,
      )
    })

    it('does not mount the SolvaPay authorization-server metadata or /oauth/* proxy', async () => {
      const handler = externalHandler()
      const routes: Array<[string, string]> = [
        ['GET', '/.well-known/oauth-authorization-server'],
        ['POST', '/oauth/register'],
        ['GET', '/oauth/authorize'],
        ['POST', '/oauth/token'],
        ['POST', '/oauth/revoke'],
      ]
      for (const [method, path] of routes) {
        const res = await handler(new Request(`${publicBaseUrl}${path}`, { method }))
        expect(res.status, `${method} ${path}`).toBe(404)
      }
      expect(fetch).not.toHaveBeenCalled()
      const openid = await handler(new Request(`${publicBaseUrl}/.well-known/openid-configuration`))
      expect(openid.status).toBe(404)
    })

    it('challenges without an error attribute when no token is presented', async () => {
      const res = await externalHandler()(post())
      expect(res.status).toBe(401)
      expect(res.headers.get('www-authenticate')).toBe(
        `Bearer resource_metadata="${publicBaseUrl}/.well-known/oauth-protected-resource"`,
      )
      expect(((await res.json()) as { id: number }).id).toBe(21)
    })

    it('answers 401 invalid_token when verifyToken returns null', async () => {
      const verifyToken = vi.fn(async () => null)
      const res = await externalHandler({ verifyToken })(post({ authorization: 'Bearer opaque' }))
      expect(res.status).toBe(401)
      expect(res.headers.get('www-authenticate')).toBe(
        `Bearer resource_metadata="${publicBaseUrl}/.well-known/oauth-protected-resource", error="invalid_token"`,
      )
      expect(verifyToken).toHaveBeenCalledWith('opaque', expect.any(Request))
    })

    it('answers 500 with the error message when verifyToken throws', async () => {
      const res = await externalHandler({
        verifyToken: async () => {
          throw new Error('JWKS unreachable: https://tenant.eu.auth0.com/.well-known/jwks.json')
        },
      })(post({ authorization: 'Bearer x' }, 33))
      expect(res.status).toBe(500)
      expect(await res.json()).toEqual({
        jsonrpc: '2.0',
        id: 33,
        error: {
          code: -32603,
          message: 'JWKS unreachable: https://tenant.eu.auth0.com/.well-known/jwks.json',
        },
      })
      expect(res.headers.get('www-authenticate')).toBeNull()
    })

    it('forwards the verified bearer as authInfo.extra.customer_ref', async () => {
      const factory = mockFactory()
      const { createMcpHandler } = await import('@modelcontextprotocol/server')
      const handler = externalHandler({
        factory,
        verifyToken: async token => ({
          subject: 'auth0|abc',
          customerRef: 'cus_bridged',
          clientId: 'tpc_1',
          scopes: ['openid'],
          resource: `${publicBaseUrl}/mcp`,
          claims: { sub: 'auth0|abc', tokenSeen: token },
        }),
      })
      const res = await handler(post({ authorization: 'Bearer real-token' }))
      expect(res.status).toBe(200)

      const mocked = vi.mocked(createMcpHandler).mock.results.at(-1)?.value as {
        fetch: ReturnType<typeof vi.fn>
      }
      const [, fetchOptions] = mocked.fetch.mock.calls.at(-1) as [Request, { authInfo?: unknown }]
      expect(fetchOptions.authInfo).toEqual({
        token: 'real-token',
        clientId: 'tpc_1',
        scopes: ['openid'],
        expiresAt: undefined,
        extra: {
          customer_ref: 'cus_bridged',
          resource: `${publicBaseUrl}/mcp`,
          payload: { sub: 'auth0|abc', tokenSeen: 'real-token' },
        },
      })
    })

    describe('config-time validation', () => {
      it('requires verifyToken', () => {
        expect(() => externalHandler({ verifyToken: undefined })).toThrow(/requires verifyToken/)
      })

      it('requires a non-empty scopesSupported', () => {
        expect(() =>
          externalHandler({ authorizationServer: { issuers: [issuer], scopesSupported: [] } }),
        ).toThrow(/scopesSupported must be a non-empty list/)
        expect(() =>
          externalHandler({
            authorizationServer: { issuers: [issuer], scopesSupported: ['openid', ''] },
          }),
        ).toThrow(/scopesSupported/)
      })

      it('requires at least one https issuer (loopback http allowed)', () => {
        expect(() =>
          externalHandler({ authorizationServer: { issuers: [], scopesSupported } }),
        ).toThrow(/at least one issuer/)
        expect(() =>
          externalHandler({
            authorizationServer: { issuers: ['http://tenant.eu.auth0.com/'], scopesSupported },
          }),
        ).toThrow(/https/)
        expect(() =>
          externalHandler({ authorizationServer: { issuers: ['not a url'], scopesSupported } }),
        ).toThrow(/absolute URL/)
        expect(() =>
          externalHandler({
            authorizationServer: { issuers: ['http://localhost:54321/auth/v1'], scopesSupported },
          }),
        ).not.toThrow()
      })

      it('is mutually exclusive with authInfo and the SolvaPay OAuth proxy paths', () => {
        expect(() => externalHandler({ authInfo: { claimPriority: ['sub'] } })).toThrow(/authInfo/)
        expect(() => externalHandler({ oauthPaths: { token: '/t' } })).toThrow(/oauthPaths/)
        expect(() => externalHandler({ authorizationServerPath: '/as' })).toThrow(
          /authorizationServerPath/,
        )
      })
    })
  })
})

function unsignedJwt(payload: Record<string, unknown>): string {
  return (
    'eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.' +
    Buffer.from(JSON.stringify(payload)).toString('base64url') +
    '.'
  )
}
