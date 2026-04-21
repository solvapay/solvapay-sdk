import { describe, expect, it } from 'vitest'
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
})
