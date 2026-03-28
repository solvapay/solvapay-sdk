import { describe, expect, it } from 'vitest'
import { parseAllowedOrigins, validateOrigin } from './utils'

describe('origin validation', () => {
  it('allows requests without an Origin header', () => {
    expect(validateOrigin(undefined, ['http://localhost:3003'])).toBe(true)
  })

  it('allows only explicitly configured origins', () => {
    const allowedOrigins = parseAllowedOrigins('http://localhost:3003, http://127.0.0.1:3003')

    expect(validateOrigin('http://localhost:3003', allowedOrigins)).toBe(true)
    expect(validateOrigin('http://localhost:5173', allowedOrigins)).toBe(false)
  })

  it('rejects malformed Origin values', () => {
    const allowedOrigins = parseAllowedOrigins('http://localhost:3003')

    expect(validateOrigin('not-a-url', allowedOrigins)).toBe(false)
  })
})
