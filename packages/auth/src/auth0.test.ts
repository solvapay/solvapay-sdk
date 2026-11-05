import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { SignJWT, exportJWK, generateKeyPair, type JWK } from 'jose'

import {
  AUTH0_DEFAULT_CLAIM_NAMESPACE,
  createAuth0AuthAdapter,
  createAuth0BearerVerifier,
  mergeSetCookies,
  type Auth0ClientLike,
} from './auth0'

function makeRequest(path: string): Request {
  return new Request(`https://example.com${path}`)
}

function makeAuth0(overrides?: Partial<Auth0ClientLike>): Auth0ClientLike {
  return {
    middleware: vi.fn(async () => new Response(null, { headers: { 'set-cookie': 'session=abc' } })),
    getSession: vi.fn(async () => ({
      user: { sub: 'auth0|user-1' },
      tokenSet: { idToken: 'id.jwt.token' },
    })),
    ...overrides,
  }
}

describe('createAuth0AuthAdapter', () => {
  it('handleRequest owns /auth routes', async () => {
    const auth0 = makeAuth0()
    const adapter = createAuth0AuthAdapter({ auth0 })

    const result = await adapter.handleRequest?.(makeRequest('/auth/login'))

    expect(result?.ownsRequest).toBe(true)
    expect(result?.response).toBeInstanceOf(Response)
    expect(auth0.middleware).toHaveBeenCalledOnce()
  })

  it('handleRequest returns sessionResponse for non-auth routes', async () => {
    const auth0 = makeAuth0()
    const adapter = createAuth0AuthAdapter({ auth0 })

    const result = await adapter.handleRequest?.(makeRequest('/dashboard'))

    expect(result?.ownsRequest).toBe(false)
    expect(result?.sessionResponse).toBeInstanceOf(Response)
  })

  it('getIdentityFromRequest returns sub and id token', async () => {
    const adapter = createAuth0AuthAdapter({ auth0: makeAuth0() })

    const identity = await adapter.getIdentityFromRequest?.(makeRequest('/api/tasks'))

    expect(identity).toEqual({ userId: 'auth0|user-1', claimsToken: 'id.jwt.token' })
  })

  it('getIdentityFromRequest returns null when unauthenticated', async () => {
    const auth0 = makeAuth0({
      getSession: vi.fn(async () => null),
    })
    const adapter = createAuth0AuthAdapter({ auth0 })

    const identity = await adapter.getIdentityFromRequest?.(makeRequest('/api/tasks'))

    expect(identity).toBeNull()
  })

  it('getUserIdFromRequest returns sub only', async () => {
    const adapter = createAuth0AuthAdapter({ auth0: makeAuth0() })

    const userId = await adapter.getUserIdFromRequest(makeRequest('/api/tasks'))

    expect(userId).toBe('auth0|user-1')
  })
})

describe('mergeSetCookies', () => {
  it('copies set-cookie headers from source to target', () => {
    const target = new Response()
    const source = new Response()
    source.headers.append('set-cookie', 'a=1')
    source.headers.append('set-cookie', 'b=2')

    mergeSetCookies(target, source)

    expect(target.headers.getSetCookie()).toEqual(['a=1', 'b=2'])
  })
})

describe('createAuth0BearerVerifier', () => {
  const CUSTOM_DOMAIN = 'auth.example.com'
  const CANONICAL_DOMAIN = 'tenant.eu.auth0.com'
  const AUDIENCE = 'https://mcp.example.com/mcp'
  const REQ = new Request(AUDIENCE, { method: 'POST' })

  let key: Awaited<ReturnType<typeof generateKeyPair>>
  let jwk: JWK

  beforeAll(async () => {
    key = await generateKeyPair('RS256', { extractable: true })
    jwk = { ...(await exportJWK(key.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' }
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function stubJwks(...domains: string[]) {
    const uris = new Set(domains.map(d => `https://${d}/.well-known/jwks.json`))
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (uris.has(url)) {
        return new Response(JSON.stringify({ keys: [jwk] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      throw new Error(`unexpected fetch ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  async function sign(domain: string, claims: Record<string, unknown> = {}) {
    return new SignJWT(claims)
      .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
      .setIssuer(`https://${domain}/`)
      .setAudience([AUDIENCE, `https://${domain}/userinfo`])
      .setSubject('google-oauth2|123')
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(key.privateKey)
  }

  it('maps the namespaced claims onto the profile', async () => {
    stubJwks(CUSTOM_DOMAIN)
    const verify = createAuth0BearerVerifier({ domain: CUSTOM_DOMAIN, audience: AUDIENCE })
    const ns = AUTH0_DEFAULT_CLAIM_NAMESPACE
    const token = await sign(CUSTOM_DOMAIN, {
      [`${ns}email`]: 'ada@example.com',
      [`${ns}email_verified`]: true,
      [`${ns}name`]: 'Ada',
      scope: 'openid profile email offline_access',
      azp: 'tpc_abc',
    })
    expect(await verify(token, REQ)).toMatchObject({
      subject: 'google-oauth2|123',
      email: 'ada@example.com',
      emailVerified: true,
      name: 'Ada',
      clientId: 'tpc_abc',
      scopes: ['openid', 'profile', 'email', 'offline_access'],
      resource: AUDIENCE,
    })
  })

  it('honours a custom claimNamespace', async () => {
    stubJwks(CUSTOM_DOMAIN)
    const verify = createAuth0BearerVerifier({
      domain: CUSTOM_DOMAIN,
      audience: AUDIENCE,
      claimNamespace: 'https://acme.test/claims/',
    })
    const token = await sign(CUSTOM_DOMAIN, {
      'https://acme.test/claims/email': 'x@acme.test',
      'https://acme.test/claims/email_verified': false,
    })
    expect(await verify(token, REQ)).toMatchObject({ email: 'x@acme.test', emailVerified: false })
  })

  it('rejects a canonical-domain iss when configured with the custom domain', async () => {
    // Auth0 serves the JWKS on both hostnames; only the issuer string differs.
    stubJwks(CUSTOM_DOMAIN, CANONICAL_DOMAIN)
    const verify = createAuth0BearerVerifier({ domain: CUSTOM_DOMAIN, audience: AUDIENCE })
    expect(await verify(await sign(CANONICAL_DOMAIN), REQ)).toBeNull()
    expect(await verify(await sign(CUSTOM_DOMAIN), REQ)).toMatchObject({
      subject: 'google-oauth2|123',
    })
  })

  it('fetches the JWKS from the configured domain', async () => {
    const fetchMock = stubJwks(CANONICAL_DOMAIN)
    const verify = createAuth0BearerVerifier({ domain: CANONICAL_DOMAIN, audience: AUDIENCE })
    await verify(await sign(CANONICAL_DOMAIN), REQ)
    expect(fetchMock).toHaveBeenCalledWith(
      `https://${CANONICAL_DOMAIN}/.well-known/jwks.json`,
      expect.anything(),
    )
  })

  it.each([
    'https://tenant.eu.auth0.com',
    'tenant.eu.auth0.com/',
    'tenant.eu.auth0.com/authorize',
    'localhost',
    '',
  ])('rejects domain %j at construction', domain => {
    expect(() => createAuth0BearerVerifier({ domain, audience: AUDIENCE })).toThrow(/bare hostname/)
  })
})
