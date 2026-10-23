import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { SignJWT, exportJWK, generateKeyPair, type JWK, type JWTPayload } from 'jose'

import { createJwksBearerVerifier, type JwksBearerVerifierOptions } from './jwks-bearer'

const ISSUER = 'https://issuer.example.com'
const AUDIENCE = 'https://mcp.example.com/mcp'
const REQ = new Request('https://mcp.example.com/mcp', { method: 'POST' })

type KeyPair = Awaited<ReturnType<typeof generateKeyPair>>

let rsa: KeyPair
let rsaJwk: JWK
let ec: KeyPair
let ecJwk: JWK
let otherRsa: KeyPair

beforeAll(async () => {
  rsa = await generateKeyPair('RS256', { extractable: true })
  rsaJwk = { ...(await exportJWK(rsa.publicKey)), kid: 'rsa-1', alg: 'RS256', use: 'sig' }
  ec = await generateKeyPair('ES256', { extractable: true })
  ecJwk = { ...(await exportJWK(ec.publicKey)), kid: 'ec-1', alg: 'ES256', use: 'sig' }
  otherRsa = await generateKeyPair('RS256', { extractable: true })
})

interface SignOptions {
  key?: KeyPair
  kid?: string
  alg?: 'RS256' | 'ES256'
  issuer?: string | null
  audience?: string | string[] | null
  subject?: string | null
  expiresIn?: number
}

async function sign(claims: JWTPayload = {}, options: SignOptions = {}): Promise<string> {
  const {
    key = rsa,
    kid = 'rsa-1',
    alg = 'RS256',
    issuer = ISSUER,
    audience = AUDIENCE,
    subject = 'auth0|user-1',
    expiresIn = 3600,
  } = options
  let jwt = new SignJWT(claims)
    .setProtectedHeader({ alg, kid })
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + expiresIn)
  if (issuer !== null) jwt = jwt.setIssuer(issuer)
  if (audience !== null) jwt = jwt.setAudience(audience)
  if (subject !== null) jwt = jwt.setSubject(subject)
  return jwt.sign(key.privateKey)
}

interface FetchStub {
  jwks?: JWK[]
  jwksUri?: string
  userinfo?: { status: number; body: unknown }
  userinfoUri?: string
  jwksError?: Error
}

function stubFetch(stub: FetchStub) {
  const jwksUri = stub.jwksUri ?? `${ISSUER}/.well-known/jwks.json`
  const fetchMock = vi.fn(async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (url === jwksUri) {
      if (stub.jwksError) throw stub.jwksError
      return new Response(JSON.stringify({ keys: stub.jwks ?? [rsaJwk] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    if (stub.userinfoUri && url === stub.userinfoUri) {
      const userinfo = stub.userinfo ?? { status: 200, body: {} }
      return new Response(JSON.stringify(userinfo.body), {
        status: userinfo.status,
        headers: { 'content-type': 'application/json' },
      })
    }
    throw new Error(`unexpected fetch ${url}`)
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const CLAIMS = { email: 'email', emailVerified: 'email_verified', name: 'name' }

function verifier(overrides: Partial<JwksBearerVerifierOptions> = {}) {
  return createJwksBearerVerifier({
    issuer: ISSUER,
    audience: AUDIENCE,
    claims: CLAIMS,
    ...overrides,
  })
}

describe('createJwksBearerVerifier', () => {
  beforeEach(() => {
    vi.useRealTimers()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  describe('construction', () => {
    it('requires exactly one profile source', () => {
      expect(() => createJwksBearerVerifier({ issuer: ISSUER, audience: AUDIENCE })).toThrow(
        /profile source/,
      )
      expect(() =>
        createJwksBearerVerifier({
          issuer: ISSUER,
          audience: AUDIENCE,
          claims: CLAIMS,
          userinfoEndpoint: `${ISSUER}/userinfo`,
        }),
      ).toThrow(/not both/)
    })

    it('requires claims.email when claims are used', () => {
      expect(() =>
        createJwksBearerVerifier({
          issuer: ISSUER,
          audience: AUDIENCE,
          // @ts-expect-error -- runtime guard for JS callers
          claims: { name: 'name' },
        }),
      ).toThrow(/claims\.email/)
    })

    it('requires audience', () => {
      expect(() =>
        createJwksBearerVerifier({ issuer: ISSUER, audience: '', claims: CLAIMS }),
      ).toThrow(/audience/)
    })

    it('rejects http:// issuers unless the host is loopback', () => {
      expect(() => verifier({ issuer: 'http://issuer.example.com' })).toThrow(/https/)
      expect(() => verifier({ issuer: 'http://localhost:54321/auth/v1' })).not.toThrow()
      expect(() => verifier({ issuer: 'http://127.0.0.1:54321/auth/v1' })).not.toThrow()
    })

    it('rejects http:// jwksUri and userinfoEndpoint off loopback', () => {
      expect(() => verifier({ jwksUri: 'http://keys.example.com/jwks' })).toThrow(/jwksUri/)
      expect(() =>
        createJwksBearerVerifier({
          issuer: ISSUER,
          audience: AUDIENCE,
          userinfoEndpoint: 'http://issuer.example.com/userinfo',
        }),
      ).toThrow(/userinfoEndpoint/)
    })
  })

  describe('verification', () => {
    it('accepts a valid RS256 token and maps claims', async () => {
      stubFetch({})
      const verify = verifier()
      const token = await sign({
        email: 'a@example.com',
        email_verified: true,
        name: 'Ada',
        scope: 'openid profile email',
        azp: 'tpc_client',
      })
      const result = await verify(token, REQ)
      expect(result).toMatchObject({
        subject: 'auth0|user-1',
        email: 'a@example.com',
        emailVerified: true,
        name: 'Ada',
        clientId: 'tpc_client',
        scopes: ['openid', 'profile', 'email'],
        resource: AUDIENCE,
      })
      expect(result?.customerRef).toBeUndefined()
      expect(result?.expiresAt).toBeTypeOf('number')
      expect(result?.claims?.sub).toBe('auth0|user-1')
    })

    it('returns null for an expired token', async () => {
      stubFetch({})
      const token = await sign({}, { expiresIn: -60 })
      expect(await verifier()(token, REQ)).toBeNull()
    })

    it('returns null for the wrong audience', async () => {
      stubFetch({})
      const token = await sign({}, { audience: 'https://other.example.com/mcp' })
      expect(await verifier()(token, REQ)).toBeNull()
    })

    it('accepts an array aud that contains the audience', async () => {
      stubFetch({})
      const token = await sign({}, { audience: [AUDIENCE, `${ISSUER}/userinfo`] })
      expect(await verifier()(token, REQ)).toMatchObject({ subject: 'auth0|user-1' })
    })

    it('returns null when sub is missing', async () => {
      stubFetch({})
      const token = await sign({}, { subject: null })
      expect(await verifier()(token, REQ)).toBeNull()
    })

    it('returns null for a bad signature (no matching key)', async () => {
      stubFetch({})
      const token = await sign({}, { key: otherRsa, kid: 'rsa-1' })
      expect(await verifier()(token, REQ)).toBeNull()
    })

    it('returns null for garbage that is not a JWT', async () => {
      stubFetch({})
      expect(await verifier()('not-a-jwt', REQ)).toBeNull()
    })

    it('throws when the JWKS is unreachable', async () => {
      stubFetch({ jwksError: new TypeError('fetch failed') })
      await expect(verifier()(await sign(), REQ)).rejects.toThrow(/fetch failed/)
    })

    it('compares the issuer verbatim, both ways', async () => {
      stubFetch({ jwksUri: `${ISSUER}/.well-known/jwks.json` })
      const withSlash = verifier({
        issuer: `${ISSUER}/`,
        jwksUri: `${ISSUER}/.well-known/jwks.json`,
      })
      const withoutSlash = verifier({ issuer: ISSUER })

      const tokenWithoutSlash = await sign({}, { issuer: ISSUER })
      const tokenWithSlash = await sign({}, { issuer: `${ISSUER}/` })

      expect(await withSlash(tokenWithoutSlash, REQ)).toBeNull()
      expect(await withSlash(tokenWithSlash, REQ)).toMatchObject({ subject: 'auth0|user-1' })
      expect(await withoutSlash(tokenWithSlash, REQ)).toBeNull()
      expect(await withoutSlash(tokenWithoutSlash, REQ)).toMatchObject({ subject: 'auth0|user-1' })
    })

    it('verifies a path-component issuer and derives its JWKS URL under the path', async () => {
      const issuer = 'https://ref.supabase.co/auth/v1'
      const fetchMock = stubFetch({ jwksUri: `${issuer}/.well-known/jwks.json`, jwks: [ecJwk] })
      const verify = verifier({ issuer })
      const token = await sign({}, { issuer, key: ec, kid: 'ec-1', alg: 'ES256' })
      expect(await verify(token, REQ)).toMatchObject({ subject: 'auth0|user-1' })
      expect(fetchMock).toHaveBeenCalledWith(`${issuer}/.well-known/jwks.json`, expect.anything())
    })

    it('verifies ES256 through the same JWKS path as RS256', async () => {
      stubFetch({ jwks: [rsaJwk, ecJwk] })
      const verify = verifier()
      const rsToken = await sign()
      const esToken = await sign({}, { key: ec, kid: 'ec-1', alg: 'ES256' })
      expect(await verify(rsToken, REQ)).toMatchObject({ subject: 'auth0|user-1' })
      expect(await verify(esToken, REQ)).toMatchObject({ subject: 'auth0|user-1' })
    })
  })

  describe('audienceMismatchHint', () => {
    it('receives the verified payload on an aud failure and its message is thrown', async () => {
      stubFetch({})
      const hint = vi.fn((payload: JWTPayload) =>
        payload.aud === 'authenticated' ? 'Configure the access token hook.' : undefined,
      )
      const verify = verifier({ audienceMismatchHint: hint })
      const token = await sign({ client_id: 'abc' }, { audience: 'authenticated' })
      await expect(verify(token, REQ)).rejects.toThrow(/Configure the access token hook/)
      expect(hint).toHaveBeenCalledOnce()
      expect(hint.mock.calls[0][0]).toMatchObject({ aud: 'authenticated', client_id: 'abc' })
    })

    it('yields null when the hint returns undefined', async () => {
      stubFetch({})
      const verify = verifier({ audienceMismatchHint: () => undefined })
      const token = await sign({}, { audience: 'authenticated' })
      expect(await verify(token, REQ)).toBeNull()
    })

    it('is never called on a signature failure', async () => {
      stubFetch({})
      const hint = vi.fn(() => 'should not run')
      const verify = verifier({ audienceMismatchHint: hint })
      const token = await sign({}, { key: otherRsa, audience: 'authenticated' })
      expect(await verify(token, REQ)).toBeNull()
      expect(hint).not.toHaveBeenCalled()
    })

    it('is not called for an expired token with the wrong audience', async () => {
      stubFetch({})
      const hint = vi.fn(() => 'should not run')
      const verify = verifier({ audienceMismatchHint: hint })
      const token = await sign({}, { audience: 'authenticated', expiresIn: -60 })
      expect(await verify(token, REQ)).toBeNull()
      expect(hint).not.toHaveBeenCalled()
    })
  })

  describe('userinfoEndpoint', () => {
    const userinfoUri = `${ISSUER}/userinfo`

    function userinfoVerifier() {
      return createJwksBearerVerifier({
        issuer: ISSUER,
        audience: AUDIENCE,
        userinfoEndpoint: userinfoUri,
      })
    }

    it('reads email, email_verified and name from userinfo', async () => {
      const fetchMock = stubFetch({
        userinfoUri,
        userinfo: {
          status: 200,
          body: { sub: 'auth0|user-1', email: 'u@example.com', email_verified: true, name: 'U' },
        },
      })
      const token = await sign()
      const result = await userinfoVerifier()(token, REQ)
      expect(result).toMatchObject({ email: 'u@example.com', emailVerified: true, name: 'U' })
      const userinfoCall = fetchMock.mock.calls.find(([url]) => url === userinfoUri)
      expect(userinfoCall?.[1]).toMatchObject({
        headers: { authorization: `Bearer ${token}` },
      })
    })

    it('memoises userinfo per token until exp', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-10-06T12:00:00Z'))
      const fetchMock = stubFetch({
        userinfoUri,
        userinfo: { status: 200, body: { email: 'u@example.com', email_verified: true } },
      })
      const verify = userinfoVerifier()
      const token = await sign({}, { expiresIn: 600 })
      await verify(token, REQ)
      await verify(token, REQ)
      const userinfoCalls = () => fetchMock.mock.calls.filter(([url]) => url === userinfoUri).length
      expect(userinfoCalls()).toBe(1)

      // Past exp: the token itself is rejected, so userinfo is not consulted again.
      vi.setSystemTime(new Date('2026-10-06T12:11:00Z'))
      expect(await verify(token, REQ)).toBeNull()
      expect(userinfoCalls()).toBe(1)

      // A fresh token for the same user is a new cache entry.
      const second = await sign({}, { expiresIn: 600 })
      await verify(second, REQ)
      expect(userinfoCalls()).toBe(2)
    })

    it('throws on userinfo 401 with the scope hint', async () => {
      stubFetch({ userinfoUri, userinfo: { status: 401, body: { error: 'invalid_token' } } })
      await expect(userinfoVerifier()(await sign(), REQ)).rejects.toThrow(
        /userinfo request to https:\/\/issuer\.example\.com\/userinfo failed with HTTP 401.*scopes/,
      )
    })

    it('throws on userinfo 5xx naming the endpoint', async () => {
      stubFetch({ userinfoUri, userinfo: { status: 503, body: {} } })
      await expect(userinfoVerifier()(await sign(), REQ)).rejects.toThrow(/HTTP 503/)
    })
  })
})
