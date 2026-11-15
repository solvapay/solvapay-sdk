import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SignJWT, exportJWK, generateKeyPair } from 'jose'
import { getAuthenticatedUserCore } from '../src/helpers/auth'
import { isErrorResult } from '../src/helpers/error'

function base64UrlEncode(input: string): string {
  const base64 =
    typeof btoa === 'function' ? btoa(input) : Buffer.from(input, 'utf-8').toString('base64')
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

// A token anyone can make: the signature segment is garbage.
function forgeJwt(payload: Record<string, unknown>, alg = 'HS256'): string {
  const header = base64UrlEncode(JSON.stringify({ alg, typ: 'JWT' }))
  const body = base64UrlEncode(JSON.stringify(payload))
  return `${header}.${body}.not-a-signature`
}

async function signedHs256(payload: Record<string, unknown>, secret: string): Promise<string> {
  const key = new TextEncoder().encode(secret)
  return await new SignJWT(payload).setProtectedHeader({ alg: 'HS256' }).sign(key)
}

const SECRET = 'server-secret-value-at-least-32-chars'

const ENV_KEYS = [
  'SOLVAPAY_AUTH_STRICT',
  'SOLVAPAY_AUTH_TRUST_GATEWAY',
  'SOLVAPAY_JWT_SECRET',
  'SUPABASE_JWT_SECRET',
  'SOLVAPAY_JWKS_URL',
  'SUPABASE_URL',
] as const
const ORIGINAL_ENV = Object.fromEntries(ENV_KEYS.map(k => [k, process.env[k]]))

beforeEach(() => {
  for (const k of ENV_KEYS) delete process.env[k]
})

afterEach(() => {
  vi.unstubAllGlobals()
  for (const k of ENV_KEYS) {
    if (ORIGINAL_ENV[k] === undefined) delete process.env[k]
    else process.env[k] = ORIGINAL_ENV[k]
  }
})

function bearer(token: string, extra: Record<string, string> = {}): Request {
  return new Request('https://example.com', {
    headers: { authorization: `Bearer ${token}`, ...extra },
  })
}

describe('getAuthenticatedUserCore', () => {
  describe('x-user-id header (set by middleware)', () => {
    it('wins over the Bearer token, taking email from it only when it verifies', async () => {
      process.env.SOLVAPAY_JWT_SECRET = SECRET
      const token = await signedHs256({ sub: 'bearer-user', email: 'bearer@example.com' }, SECRET)

      const result = await getAuthenticatedUserCore(bearer(token, { 'x-user-id': 'middleware-user' }))
      expect(isErrorResult(result)).toBe(false)
      if (isErrorResult(result)) return
      expect(result.userId).toBe('middleware-user')
      expect(result.email).toBe('bearer@example.com')
    })

    it('takes no email or name from a token that does not verify', async () => {
      const token = forgeJwt({ sub: 'x', email: 'forged@example.com', name: 'Forged' })

      const result = await getAuthenticatedUserCore(bearer(token, { 'x-user-id': 'middleware-user' }))
      expect(isErrorResult(result)).toBe(false)
      if (isErrorResult(result)) return
      expect(result.userId).toBe('middleware-user')
      expect(result.email).toBeNull()
      expect(result.name).toBeNull()
    })

    it('extracts userId without a Bearer token', async () => {
      const req = new Request('https://example.com', { headers: { 'x-user-id': 'middleware-user' } })

      const result = await getAuthenticatedUserCore(req)
      expect(isErrorResult(result)).toBe(false)
      if (isErrorResult(result)) return
      expect(result.userId).toBe('middleware-user')
      expect(result.email).toBeNull()
      expect(result.name).toBeNull()
    })
  })

  describe('no way to verify the token configured', () => {
    it('refuses a forged token naming another user, and says how to configure verification', async () => {
      const result = await getAuthenticatedUserCore(bearer(forgeJwt({ sub: 'victim-user' })))
      expect(isErrorResult(result)).toBe(true)
      if (!isErrorResult(result)) return
      expect(result.status).toBe(401)
      expect(result.details).toContain('SOLVAPAY_JWT_SECRET')
      expect(result.details).toContain('SOLVAPAY_JWKS_URL')
      expect(result.details).toContain('SOLVAPAY_AUTH_TRUST_GATEWAY')
    })

    it('refuses a forged ES256 token too', async () => {
      const result = await getAuthenticatedUserCore(bearer(forgeJwt({ sub: 'victim-user' }, 'ES256')))
      expect(isErrorResult(result)).toBe(true)
      if (!isErrorResult(result)) return
      expect(result.status).toBe(401)
    })

    it('refuses alg none', async () => {
      const result = await getAuthenticatedUserCore(bearer(forgeJwt({ sub: 'victim-user' }, 'none')))
      expect(isErrorResult(result)).toBe(true)
      if (!isErrorResult(result)) return
      expect(result.status).toBe(401)
      expect(result.details).toContain('Unsupported')
    })

    it('returns 401 when the token is malformed', async () => {
      const result = await getAuthenticatedUserCore(bearer('not.a.jwt.shape'))
      expect(isErrorResult(result)).toBe(true)
      if (!isErrorResult(result)) return
      expect(result.status).toBe(401)
    })

    it('returns 401 when neither x-user-id nor Authorization is present', async () => {
      const result = await getAuthenticatedUserCore(new Request('https://example.com'))
      expect(isErrorResult(result)).toBe(true)
      if (!isErrorResult(result)) return
      expect(result.status).toBe(401)
    })
  })

  describe('HS256 with a secret', () => {
    it('accepts a correctly signed token', async () => {
      process.env.SUPABASE_JWT_SECRET = SECRET
      const token = await signedHs256(
        { sub: 'supabase-user-123', email: 'user@example.com', user_metadata: { full_name: 'Ada Lovelace' } },
        SECRET,
      )

      const result = await getAuthenticatedUserCore(bearer(token))
      expect(isErrorResult(result)).toBe(false)
      if (isErrorResult(result)) return
      expect(result.userId).toBe('supabase-user-123')
      expect(result.email).toBe('user@example.com')
      expect(result.name).toBe('Ada Lovelace')
    })

    it('rejects a token signed with a different secret', async () => {
      process.env.SUPABASE_JWT_SECRET = SECRET
      const token = await signedHs256({ sub: 'attacker' }, 'a-different-secret-of-32-characters')

      const result = await getAuthenticatedUserCore(bearer(token))
      expect(isErrorResult(result)).toBe(true)
      if (!isErrorResult(result)) return
      expect(result.status).toBe(401)
    })

    it('accepts SOLVAPAY_JWT_SECRET as a provider-neutral alias', async () => {
      process.env.SOLVAPAY_JWT_SECRET = SECRET
      const token = await signedHs256({ sub: 'neutral-user' }, SECRET)

      const result = await getAuthenticatedUserCore(bearer(token))
      expect(isErrorResult(result)).toBe(false)
      if (isErrorResult(result)) return
      expect(result.userId).toBe('neutral-user')
    })

    it('returns 401 when a verified token has no sub claim', async () => {
      process.env.SOLVAPAY_JWT_SECRET = SECRET
      const token = await signedHs256({ email: 'nobody@example.com' }, SECRET)

      const result = await getAuthenticatedUserCore(bearer(token))
      expect(isErrorResult(result)).toBe(true)
      if (!isErrorResult(result)) return
      expect(result.status).toBe(401)
    })
  })

  describe('ES256 against a JWKS', () => {
    async function jwksFixture() {
      const { publicKey, privateKey } = await generateKeyPair('ES256')
      const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'ES256', use: 'sig' }
      const fetchMock = vi.fn(async () => Response.json({ keys: [jwk] }))
      vi.stubGlobal('fetch', fetchMock)
      const sign = (payload: Record<string, unknown>, key = privateKey) =>
        new SignJWT(payload)
          .setProtectedHeader({ alg: 'ES256', kid: 'k1' })
          .setExpirationTime('5m')
          .sign(key)
      return { sign, fetchMock }
    }

    it('accepts a token signed by a key in SOLVAPAY_JWKS_URL', async () => {
      const { sign, fetchMock } = await jwksFixture()
      process.env.SOLVAPAY_JWKS_URL = 'https://auth.example.test/jwks-a.json'

      const result = await getAuthenticatedUserCore(bearer(await sign({ sub: 'es-user' })))
      expect(isErrorResult(result)).toBe(false)
      if (isErrorResult(result)) return
      expect(result.userId).toBe('es-user')
      expect(String(fetchMock.mock.calls[0]?.[0])).toBe('https://auth.example.test/jwks-a.json')
    })

    it("derives Supabase's JWKS from SUPABASE_URL", async () => {
      const { sign, fetchMock } = await jwksFixture()
      process.env.SUPABASE_URL = 'https://proj.supabase.test/'

      const result = await getAuthenticatedUserCore(bearer(await sign({ sub: 'sb-user' })))
      expect(isErrorResult(result)).toBe(false)
      expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
        'https://proj.supabase.test/auth/v1/.well-known/jwks.json',
      )
    })

    it('rejects a token signed by a key that is not in the JWKS', async () => {
      const { sign } = await jwksFixture()
      process.env.SOLVAPAY_JWKS_URL = 'https://auth.example.test/jwks-b.json'
      const other = await generateKeyPair('ES256')

      const result = await getAuthenticatedUserCore(
        bearer(await sign({ sub: 'attacker' }, other.privateKey)),
      )
      expect(isErrorResult(result)).toBe(true)
      if (!isErrorResult(result)) return
      expect(result.status).toBe(401)
    })
  })

  describe('gateway trust (SOLVAPAY_AUTH_TRUST_GATEWAY=true)', () => {
    beforeEach(() => {
      process.env.SOLVAPAY_AUTH_TRUST_GATEWAY = 'true'
    })

    it('reads sub/email/name from a token the gateway verified', async () => {
      const token = forgeJwt({
        sub: 'supabase-user-123',
        email: 'user@example.com',
        user_metadata: { full_name: 'Ada Lovelace' },
      })

      const result = await getAuthenticatedUserCore(bearer(token))
      expect(isErrorResult(result)).toBe(false)
      if (isErrorResult(result)) return
      expect(result.userId).toBe('supabase-user-123')
      expect(result.email).toBe('user@example.com')
      expect(result.name).toBe('Ada Lovelace')
    })

    it('falls back to user_metadata.name when full_name is absent', async () => {
      const result = await getAuthenticatedUserCore(
        bearer(forgeJwt({ sub: 'u2', user_metadata: { name: 'Grace Hopper' } })),
      )
      expect(isErrorResult(result)).toBe(false)
      if (isErrorResult(result)) return
      expect(result.name).toBe('Grace Hopper')
    })

    it('falls back to the top-level name claim', async () => {
      const result = await getAuthenticatedUserCore(bearer(forgeJwt({ sub: 'u3', name: 'Alan Turing' })))
      expect(isErrorResult(result)).toBe(false)
      if (isErrorResult(result)) return
      expect(result.name).toBe('Alan Turing')
    })

    it('still refuses an expired token', async () => {
      const exp = Math.floor(Date.now() / 1000) - 60
      const result = await getAuthenticatedUserCore(bearer(forgeJwt({ sub: 'u4', exp })))
      expect(isErrorResult(result)).toBe(true)
      if (!isErrorResult(result)) return
      expect(result.status).toBe(401)
    })

    it('a secret still wins: a forged HS256 token is refused when the secret is set', async () => {
      process.env.SOLVAPAY_JWT_SECRET = SECRET
      const result = await getAuthenticatedUserCore(bearer(forgeJwt({ sub: 'attacker' })))
      expect(isErrorResult(result)).toBe(true)
    })

    it('refuses everything when SOLVAPAY_AUTH_STRICT=true contradicts it', async () => {
      process.env.SOLVAPAY_AUTH_STRICT = 'true'
      const result = await getAuthenticatedUserCore(bearer(forgeJwt({ sub: 'u5' })))
      expect(isErrorResult(result)).toBe(true)
      if (!isErrorResult(result)) return
      expect(result.status).toBe(401)
      expect(result.details).toContain('SOLVAPAY_AUTH_STRICT')
    })
  })

  describe('includeEmail / includeName options', () => {
    beforeEach(() => {
      process.env.SOLVAPAY_JWT_SECRET = SECRET
    })

    it('skips email extraction when includeEmail is false', async () => {
      const token = await signedHs256({ sub: 'u', email: 'e@example.com', name: 'N' }, SECRET)
      const result = await getAuthenticatedUserCore(bearer(token), { includeEmail: false })
      expect(isErrorResult(result)).toBe(false)
      if (isErrorResult(result)) return
      expect(result.email).toBeNull()
      expect(result.name).toBe('N')
    })

    it('skips name extraction when includeName is false', async () => {
      const token = await signedHs256({ sub: 'u', email: 'e@example.com', name: 'N' }, SECRET)
      const result = await getAuthenticatedUserCore(bearer(token), { includeName: false })
      expect(isErrorResult(result)).toBe(false)
      if (isErrorResult(result)) return
      expect(result.email).toBe('e@example.com')
      expect(result.name).toBeNull()
    })
  })
})
