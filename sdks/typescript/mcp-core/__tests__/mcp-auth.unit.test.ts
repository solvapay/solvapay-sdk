import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { buildAuthInfoFromBearer } from '../src/auth-bridge'
import {
  McpBearerAuthError,
  decodeJwtPayload,
  extractBearerToken,
  getCustomerRefFromBearerAuthHeader,
  getCustomerRefFromJwtPayload,
} from '../src/bearer'

const HS256_SECRET = 'solvapay-mcp-fixture-hs256-secret-32b!!'
const VERIFY = {
  hs256Secret: HS256_SECRET,
  expectedIssuer: 'https://mcp.example.com',
  expectedAudience: 'https://mcp.example.com',
  nowUnixSecs: 1_700_000_000,
}

function createUnsignedJwt(payload: Record<string, unknown>) {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${header}.${body}.`
}

function createHs256Jwt(payload: Record<string, unknown>) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256' })).toString('base64url')
  const body = Buffer.from(
    JSON.stringify({
      iss: 'https://mcp.example.com',
      aud: 'https://mcp.example.com',
      exp: 4_102_444_800,
      ...payload,
    }),
  ).toString('base64url')
  const sig = createHmac('sha256', HS256_SECRET).update(`${header}.${body}`).digest('base64url')
  return `${header}.${body}.${sig}`
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
    const token = createHs256Jwt({ customer_ref: 'cust_from_snake_case' })
    const result = getCustomerRefFromBearerAuthHeader(`Bearer ${token}`, VERIFY)
    expect(result).toBe('cust_from_snake_case')
  })

  it('getCustomerRefFromBearerAuthHeader throws for malformed token', () => {
    expect(() => getCustomerRefFromBearerAuthHeader('Bearer broken-token', VERIFY)).toThrow(
      McpBearerAuthError,
    )
  })

  it('decodeJwtPayload handles non-ASCII UTF-8 characters', () => {
    const token = createUnsignedJwt({ sub: 'cust_123', name: 'José García 🎉' })
    const payload = decodeJwtPayload(token)
    expect(payload.name).toBe('José García 🎉')
  })

  it('buildAuthInfoFromBearer treats aud as resource metadata, not client identity', () => {
    const token = createHs256Jwt({
      customer_ref: 'cust_123',
      aud: 'https://mcp.example.com',
      scope: 'tools:read tools:write',
    })

    const authInfo = buildAuthInfoFromBearer(`Bearer ${token}`, VERIFY)

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
      const token = createHs256Jwt(payload)

      expect(buildAuthInfoFromBearer(`Bearer ${token}`, { ...VERIFY, ...options })?.clientId).toBe(
        expected,
      )
    }
  })
})

describe('isFreeMcpMethod', () => {
  it('requires auth only for tools/call', async () => {
    const { isFreeMcpMethod } = await import('../src/is-free-mcp-method')
    expect(isFreeMcpMethod('tools/call')).toBe(false)
    expect(isFreeMcpMethod('TOOLS/CALL')).toBe(false)
    expect(isFreeMcpMethod('initialize')).toBe(true)
    expect(isFreeMcpMethod('tools/list')).toBe(true)
    expect(isFreeMcpMethod('ping')).toBe(true)
    expect(isFreeMcpMethod(undefined)).toBe(true)
  })
})

describe('requiresBearerAuth', () => {
  it('gates tools/call in both modes and initialize only in all', async () => {
    const { requiresBearerAuth } = await import('../src/is-free-mcp-method')
    expect(requiresBearerAuth('tools/call', 'tools-call')).toBe(true)
    expect(requiresBearerAuth('tools/call', 'all')).toBe(true)
    expect(requiresBearerAuth('initialize', 'tools-call')).toBe(false)
    expect(requiresBearerAuth('initialize', 'all')).toBe(true)
  })
})
