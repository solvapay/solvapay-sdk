import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SignJWT } from 'jose'
import { getUserEmailFromRequest } from './next-utils'
import { TOKEN_NOT_VERIFIABLE, verifyBearerToken } from './verify-token'

const SECRET = 'auth-secret-value-at-least-32-chars!'
const KEYS = ['SOLVAPAY_AUTH_STRICT', 'SOLVAPAY_AUTH_TRUST_GATEWAY', 'SOLVAPAY_JWT_SECRET', 'SUPABASE_JWT_SECRET', 'SOLVAPAY_JWKS_URL', 'SUPABASE_URL']
const saved = Object.fromEntries(KEYS.map(k => [k, process.env[k]]))

beforeEach(() => KEYS.forEach(k => delete process.env[k]))
afterEach(() =>
  KEYS.forEach(k => (saved[k] === undefined ? delete process.env[k] : (process.env[k] = saved[k]))),
)

const forged = (payload: object) =>
  `${Buffer.from(JSON.stringify({ alg: 'HS256' })).toString('base64url')}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.sig`

const withBearer = (token: string) =>
  new Request('https://example.com', { headers: { authorization: `Bearer ${token}` } })

describe('verifyBearerToken', () => {
  it('refuses a token it has no way to verify, naming the three ways to configure it', async () => {
    expect(await verifyBearerToken(forged({ sub: 'victim' }))).toEqual({ ok: false, reason: TOKEN_NOT_VERIFIABLE })
  })

  it('verifies HS256 with an explicit secret', async () => {
    const token = await new SignJWT({ sub: 'u1' }).setProtectedHeader({ alg: 'HS256' }).sign(new TextEncoder().encode(SECRET))
    const result = await verifyBearerToken(token, { jwtSecret: SECRET })
    expect(result.ok && result.payload.sub).toBe('u1')
    expect(result.ok && result.verifiedBy).toBe('secret')
  })

  it('reads a token unverified only when gateway trust is turned on', async () => {
    const result = await verifyBearerToken(forged({ sub: 'u2' }), { trustGateway: true })
    expect(result.ok && result.verifiedBy).toBe('gateway')
  })
})

describe('getUserEmailFromRequest', () => {
  it('returns no email from a forged token', async () => {
    expect(await getUserEmailFromRequest(withBearer(forged({ sub: 'x', email: 'forged@example.com' })))).toBeNull()
  })

  it('returns the email from a verified token', async () => {
    process.env.SOLVAPAY_JWT_SECRET = SECRET
    const token = await new SignJWT({ sub: 'x', email: 'real@example.com' })
      .setProtectedHeader({ alg: 'HS256' })
      .sign(new TextEncoder().encode(SECRET))
    expect(await getUserEmailFromRequest(withBearer(token))).toBe('real@example.com')
  })
})
