import { describe, expect, it } from 'vitest'
import {
  DEFAULT_MCP_CLIENT_ID,
  buildAuthInfoFromBearer,
  buildAuthInfoFromVerifiedBearer,
  toAuthInfo,
  type VerifiedBearer,
} from '../src/auth-bridge'
import {
  McpBearerAuthError,
  decodeJwtPayload,
  extractBearerToken,
  getCustomerRefFromBearerAuthHeader,
  getCustomerRefFromJwtPayload,
} from '../src/bearer'

function createUnsignedJwt(payload: Record<string, unknown>) {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${header}.${body}.`
}

describe('mcp-auth helpers', () => {
  it('extractBearerToken returns token for valid header', () => {
    expect(extractBearerToken('Bearer abc.def.ghi')).toBe('abc.def.ghi')
  })

  it('extractBearerToken returns null for invalid header', () => {
    expect(extractBearerToken(undefined)).toBeNull()
    expect(extractBearerToken('Basic abc')).toBeNull()
  })

  it('decodeJwtPayload parses payload', () => {
    const token = createUnsignedJwt({ sub: 'cust_123' })
    expect(decodeJwtPayload(token).sub).toBe('cust_123')
  })

  it('getCustomerRefFromJwtPayload prefers customerRef over sub', () => {
    const customerRef = getCustomerRefFromJwtPayload({
      sub: 'sub_user',
      customerRef: 'customer_user',
    })
    expect(customerRef).toBe('customer_user')
  })

  it('getCustomerRefFromJwtPayload throws when claims missing', () => {
    expect(() => getCustomerRefFromJwtPayload({})).toThrow(McpBearerAuthError)
  })

  it('getCustomerRefFromBearerAuthHeader resolves customerRef', () => {
    const token = createUnsignedJwt({ customer_ref: 'cust_from_snake_case' })
    const result = getCustomerRefFromBearerAuthHeader(`Bearer ${token}`)
    expect(result).toBe('cust_from_snake_case')
  })

  it('getCustomerRefFromBearerAuthHeader throws for malformed token', () => {
    expect(() => getCustomerRefFromBearerAuthHeader('Bearer broken-token')).toThrow(
      McpBearerAuthError,
    )
  })

  it('decodeJwtPayload handles non-ASCII UTF-8 characters', () => {
    const token = createUnsignedJwt({ sub: 'cust_123', name: 'José García 🎉' })
    const payload = decodeJwtPayload(token)
    expect(payload.name).toBe('José García 🎉')
  })

  it('buildAuthInfoFromBearer treats aud as resource metadata, not client identity', () => {
    const token = createUnsignedJwt({
      customer_ref: 'cust_123',
      aud: 'https://mcp.example.com',
      scope: 'tools:read tools:write',
    })

    const authInfo = buildAuthInfoFromBearer(`Bearer ${token}`)

    expect(authInfo?.clientId).toBe('solvapay-mcp-client')
    expect(authInfo?.scopes).toEqual(['tools:read', 'tools:write'])
    expect(authInfo?.extra?.customer_ref).toBe('cust_123')
    expect(authInfo?.extra?.resource).toBe('https://mcp.example.com')
  })

  it('buildAuthInfoFromBearer keeps explicit client identity ahead of resource claims', () => {
    const cases = [
      {
        payload: { customer_ref: 'cust_123', aud: 'https://mcp.example.com' },
        options: { clientId: 'client_from_options' },
        expected: 'client_from_options',
      },
      {
        payload: {
          customer_ref: 'cust_123',
          client_id: 'client_from_payload',
          azp: 'client_from_azp',
          aud: 'https://mcp.example.com',
        },
        options: {},
        expected: 'client_from_payload',
      },
      {
        payload: {
          customer_ref: 'cust_123',
          azp: 'client_from_azp',
          aud: 'https://mcp.example.com',
        },
        options: {},
        expected: 'client_from_azp',
      },
    ]

    for (const { payload, options, expected } of cases) {
      const token = createUnsignedJwt(payload)

      expect(buildAuthInfoFromBearer(`Bearer ${token}`, options)?.clientId).toBe(expected)
    }
  })

  it('buildAuthInfoFromBearer produces the pre-refactor envelope byte-for-byte', () => {
    const payload = {
      customer_ref: 'cust_123',
      aud: 'https://mcp.example.com',
      scp: ['tools:read', 7, 'tools:write'],
      exp: 1_900_000_000,
    }
    const token = createUnsignedJwt(payload)

    expect(buildAuthInfoFromBearer(`Bearer ${token}`, { includePayload: true })).toEqual({
      token,
      clientId: DEFAULT_MCP_CLIENT_ID,
      scopes: ['tools:read', 'tools:write'],
      expiresAt: 1_900_000_000,
      extra: {
        customer_ref: 'cust_123',
        resource: 'https://mcp.example.com',
        payload,
      },
    })

    const minimal = createUnsignedJwt({ sub: 'cust_9' })
    expect(buildAuthInfoFromBearer(`Bearer ${minimal}`)).toEqual({
      token: minimal,
      clientId: DEFAULT_MCP_CLIENT_ID,
      scopes: [],
      expiresAt: undefined,
      extra: { customer_ref: 'cust_9' },
    })
  })

  it('toAuthInfo defaults clientId and scopes and omits absent resource/payload', () => {
    expect(toAuthInfo('tok', { customerRef: 'cus_1' })).toEqual({
      token: 'tok',
      clientId: DEFAULT_MCP_CLIENT_ID,
      scopes: [],
      expiresAt: undefined,
      extra: { customer_ref: 'cus_1' },
    })
  })

  it('buildAuthInfoFromVerifiedBearer prefers customerRef over subject and carries claims as payload', () => {
    const verified: VerifiedBearer = {
      subject: 'auth0|abc',
      customerRef: 'cus_bridged',
      email: 'a@example.com',
      emailVerified: true,
      clientId: 'tpc_client',
      scopes: ['openid', 'offline_access'],
      expiresAt: 1_900_000_000,
      resource: 'https://mcp.example.com/mcp',
      claims: { sub: 'auth0|abc', aud: ['https://mcp.example.com/mcp', 'https://t/userinfo'] },
    }

    expect(buildAuthInfoFromVerifiedBearer('tok', verified)).toEqual({
      token: 'tok',
      clientId: 'tpc_client',
      scopes: ['openid', 'offline_access'],
      expiresAt: 1_900_000_000,
      extra: {
        customer_ref: 'cus_bridged',
        resource: 'https://mcp.example.com/mcp',
        payload: verified.claims,
      },
    })
  })

  it('buildAuthInfoFromVerifiedBearer falls back to the subject when no customerRef was resolved', () => {
    const authInfo = buildAuthInfoFromVerifiedBearer('tok', { subject: 'auth0|abc' })
    expect(authInfo.extra?.customer_ref).toBe('auth0|abc')
    expect(authInfo.clientId).toBe(DEFAULT_MCP_CLIENT_ID)
    expect(authInfo.scopes).toEqual([])
  })
})
