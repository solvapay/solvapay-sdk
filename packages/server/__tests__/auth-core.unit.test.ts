import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SignJWT } from 'jose'
import { getAuthenticatedUserCore } from '../src/helpers/auth'
import { isErrorResult } from '../src/helpers/error'

function base64UrlEncode(input: string): string {
  const base64 =
    typeof btoa === 'function'
      ? btoa(input)
      : Buffer.from(input, 'utf-8').toString('base64')
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

// Forge an unverified JWT (signature segment is not validated by the fallback).
function forgeJwt(payload: Record<string, unknown>): string {
  const header = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body = base64UrlEncode(JSON.stringify(payload))
  return `${header}.${body}.not-a-signature`
}

async function signedHs256(
  payload: Record<string, unknown>,
  secret: string,
): Promise<string> {
  const key = new TextEncoder().encode(secret)
  return await new SignJWT(payload).setProtectedHeader({ alg: 'HS256' }).sign(key)
}

const ORIGINAL_ENV = {
  SOLVAPAY_AUTH_STRICT: process.env.SOLVAPAY_AUTH_STRICT,
  SOLVAPAY_JWT_SECRET: process.env.SOLVAPAY_JWT_SECRET,
  SUPABASE_JWT_SECRET: process.env.SUPABASE_JWT_SECRET,
}

beforeEach(() => {
  delete process.env.SOLVAPAY_AUTH_STRICT
  delete process.env.SOLVAPAY_JWT_SECRET
  delete process.env.SUPABASE_JWT_SECRET
})

afterEach(() => {
  process.env.SOLVAPAY_AUTH_STRICT = ORIGINAL_ENV.SOLVAPAY_AUTH_STRICT
  process.env.SOLVAPAY_JWT_SECRET = ORIGINAL_ENV.SOLVAPAY_JWT_SECRET
  process.env.SUPABASE_JWT_SECRET = ORIGINAL_ENV.SUPABASE_JWT_SECRET
  if (ORIGINAL_ENV.SOLVAPAY_AUTH_STRICT === undefined) delete process.env.SOLVAPAY_AUTH_STRICT
  if (ORIGINAL_ENV.SOLVAPAY_JWT_SECRET === undefined) delete process.env.SOLVAPAY_JWT_SECRET
  if (ORIGINAL_ENV.SUPABASE_JWT_SECRET === undefined) delete process.env.SUPABASE_JWT_SECRET
})

describe('getAuthenticatedUserCore', () => {
  describe('x-user-id header', () => {
    it('wins over Bearer token when both are present', async () => {
      const bearer = forgeJwt({ sub: 'bearer-user', email: 'bearer@example.com' })
      const req = new Request('https://example.com', {
        headers: {
          'x-user-id': 'middleware-user',
          authorization: `Bearer ${bearer}`,
        },
      })

      const result = await getAuthenticatedUserCore(req)
      expect(isErrorResult(result)).toBe(false)
      if (isErrorResult(result)) return

      expect(result.userId).toBe('middleware-user')
      // Email should still be extracted from the Bearer token for syncCustomer.
      expect(result.email).toBe('bearer@example.com')
    })

    it('extracts userId without a Bearer token', async () => {
      const req = new Request('https://example.com', {
        headers: { 'x-user-id': 'middleware-user' },
      })

      const result = await getAuthenticatedUserCore(req)
      expect(isErrorResult(result)).toBe(false)
      if (isErrorResult(result)) return

      expect(result.userId).toBe('middleware-user')
      expect(result.email).toBeNull()
      expect(result.name).toBeNull()
    })
  })

  describe('Bearer JWT fallback (no secret configured)', () => {
    it('decodes sub/email/name from an unverified JWT (platform-gateway trust)', async () => {
      const token = forgeJwt({
        sub: 'supabase-user-123',
        email: 'user@example.com',
        user_metadata: { full_name: 'Ada Lovelace' },
      })
      const req = new Request('https://example.com', {
        headers: { authorization: `Bearer ${token}` },
      })

      const result = await getAuthenticatedUserCore(req)
      expect(isErrorResult(result)).toBe(false)
      if (isErrorResult(result)) return

      expect(result.userId).toBe('supabase-user-123')
      expect(result.email).toBe('user@example.com')
      expect(result.name).toBe('Ada Lovelace')
    })

    it('falls back to user_metadata.name when full_name is absent', async () => {
      const token = forgeJwt({
        sub: 'u2',
        user_metadata: { name: 'Grace Hopper' },
      })
      const req = new Request('https://example.com', {
        headers: { authorization: `Bearer ${token}` },
      })

      const result = await getAuthenticatedUserCore(req)
      expect(isErrorResult(result)).toBe(false)
      if (isErrorResult(result)) return

      expect(result.name).toBe('Grace Hopper')
    })

    it('falls back to top-level name claim', async () => {
      const token = forgeJwt({ sub: 'u3', name: 'Alan Turing' })
      const req = new Request('https://example.com', {
        headers: { authorization: `Bearer ${token}` },
      })

      const result = await getAuthenticatedUserCore(req)
      expect(isErrorResult(result)).toBe(false)
      if (isErrorResult(result)) return

      expect(result.name).toBe('Alan Turing')
    })

    it('returns 401 when Bearer token is malformed', async () => {
      const req = new Request('https://example.com', {
        headers: { authorization: 'Bearer not.a.jwt.shape' },
      })

      const result = await getAuthenticatedUserCore(req)
      expect(isErrorResult(result)).toBe(true)
      if (!isErrorResult(result)) return
      expect(result.status).toBe(401)
    })

    it('returns 401 when token is present but has no sub claim', async () => {
      const token = forgeJwt({ email: 'nobody@example.com' })
      const req = new Request('https://example.com', {
        headers: { authorization: `Bearer ${token}` },
      })

      const result = await getAuthenticatedUserCore(req)
      expect(isErrorResult(result)).toBe(true)
      if (!isErrorResult(result)) return
      expect(result.status).toBe(401)
    })

    it('returns 401 when neither x-user-id nor Authorization is present', async () => {
      const req = new Request('https://example.com')
      const result = await getAuthenticatedUserCore(req)
      expect(isErrorResult(result)).toBe(true)
      if (!isErrorResult(result)) return
      expect(result.status).toBe(401)
    })
  })

  describe('Bearer JWT with HS256 secret configured', () => {
    it('accepts a correctly signed token', async () => {
      const secret = 'test-secret-at-least-32-chars-long-for-hs256'
      process.env.SUPABASE_JWT_SECRET = secret
      const token = await signedHs256(
        { sub: 'signed-user', email: 'signed@example.com' },
        secret,
      )
      const req = new Request('https://example.com', {
        headers: { authorization: `Bearer ${token}` },
      })

      const result = await getAuthenticatedUserCore(req)
      expect(isErrorResult(result)).toBe(false)
      if (isErrorResult(result)) return

      expect(result.userId).toBe('signed-user')
      expect(result.email).toBe('signed@example.com')
    })

    it('rejects a token signed with a different secret', async () => {
      process.env.SUPABASE_JWT_SECRET = 'server-secret-value-32-chars-min'
      const token = await signedHs256(
        { sub: 'signed-user' },
        'attacker-secret-value-32-chars-min',
      )
      const req = new Request('https://example.com', {
        headers: { authorization: `Bearer ${token}` },
      })

      const result = await getAuthenticatedUserCore(req)
      expect(isErrorResult(result)).toBe(true)
      if (!isErrorResult(result)) return
      expect(result.status).toBe(401)
    })

    it('accepts SOLVAPAY_JWT_SECRET as a provider-neutral alias', async () => {
      const secret = 'solvapay-secret-at-least-32-chars-long-xyz'
      process.env.SOLVAPAY_JWT_SECRET = secret
      const token = await signedHs256({ sub: 'neutral-user' }, secret)
      const req = new Request('https://example.com', {
        headers: { authorization: `Bearer ${token}` },
      })

      const result = await getAuthenticatedUserCore(req)
      expect(isErrorResult(result)).toBe(false)
      if (isErrorResult(result)) return
      expect(result.userId).toBe('neutral-user')
    })
  })

  describe('strict mode (SOLVAPAY_AUTH_STRICT=true)', () => {
    it('rejects unverified Bearer tokens when no secret is configured', async () => {
      process.env.SOLVAPAY_AUTH_STRICT = 'true'
      const token = forgeJwt({ sub: 'attacker' })
      const req = new Request('https://example.com', {
        headers: { authorization: `Bearer ${token}` },
      })

      const result = await getAuthenticatedUserCore(req)
      expect(isErrorResult(result)).toBe(true)
      if (!isErrorResult(result)) return
      expect(result.status).toBe(401)
    })

    it('still accepts a correctly signed Bearer token when a secret is set', async () => {
      const secret = 'strict-secret-at-least-32-chars-long-abc'
      process.env.SOLVAPAY_AUTH_STRICT = 'true'
      process.env.SOLVAPAY_JWT_SECRET = secret
      const token = await signedHs256({ sub: 'strict-user' }, secret)
      const req = new Request('https://example.com', {
        headers: { authorization: `Bearer ${token}` },
      })

      const result = await getAuthenticatedUserCore(req)
      expect(isErrorResult(result)).toBe(false)
      if (isErrorResult(result)) return
      expect(result.userId).toBe('strict-user')
    })
  })

  describe('includeEmail / includeName options', () => {
    it('skips email extraction when includeEmail is false', async () => {
      const token = forgeJwt({ sub: 'u', email: 'e@example.com', name: 'N' })
      const req = new Request('https://example.com', {
        headers: { authorization: `Bearer ${token}` },
      })

      const result = await getAuthenticatedUserCore(req, { includeEmail: false })
      expect(isErrorResult(result)).toBe(false)
      if (isErrorResult(result)) return
      expect(result.email).toBeNull()
      expect(result.name).toBe('N')
    })

    it('skips name extraction when includeName is false', async () => {
      const token = forgeJwt({ sub: 'u', email: 'e@example.com', name: 'N' })
      const req = new Request('https://example.com', {
        headers: { authorization: `Bearer ${token}` },
      })

      const result = await getAuthenticatedUserCore(req, { includeName: false })
      expect(isErrorResult(result)).toBe(false)
      if (isErrorResult(result)) return
      expect(result.email).toBe('e@example.com')
      expect(result.name).toBeNull()
    })
  })
})
