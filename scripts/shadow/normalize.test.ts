import { describe, expect, it } from 'vitest'
import {
  VOLATILE_SENTINEL,
  normalizeVolatile,
  type ShadowNormalizeRules,
} from './normalize.js'

const BASE_RULES: ShadowNormalizeRules = {
  globalVolatileKeys: ['createdAt', 'updatedAt', 'id', 'reference', 'idempotencyKey'],
  volatileKeySuffixes: ['Ref'],
  refPrefixes: ['prd_', 'pln_', 'cus_', 'pur_'],
  pointers: [],
}

describe('normalizeVolatile', () => {
  it('strips manifest-listed JSON pointers', () => {
    const input = {
      name: 'Widget',
      secret: 'sk_live_abc',
      nested: { token: 't1', keep: true },
    }
    const out = normalizeVolatile(input, {
      ...BASE_RULES,
      pointers: ['/secret', '/nested/token'],
    })
    expect(out).toEqual({
      name: 'Widget',
      nested: { keep: true },
    })
  })

  it('strips global volatile keys recursively', () => {
    const input = {
      name: 'A',
      createdAt: '2026-01-01T00:00:00Z',
      child: { updatedAt: '2026-01-02T00:00:00Z', id: 'x', ok: 1 },
    }
    expect(normalizeVolatile(input, BASE_RULES)).toEqual({
      name: 'A',
      child: { ok: 1 },
    })
  })

  it('strips keys ending with Ref suffixes', () => {
    const input = { customerRef: 'cus_a', productRef: 'prd_b', name: 'n' }
    expect(normalizeVolatile(input, BASE_RULES)).toEqual({
      name: 'n',
    })
  })

  it('normalizes both sides identically when only volatile fields differ', () => {
    const left = {
      name: 'Widget',
      reference: 'prd_AAAA',
      createdAt: '2026-01-01T00:00:00Z',
      price: 100,
    }
    const right = {
      name: 'Widget',
      // typed Rust side may omit volatile keys entirely
      price: 100,
    }
    expect(normalizeVolatile(left, BASE_RULES)).toEqual(
      normalizeVolatile(right, BASE_RULES),
    )
  })

  it('leaves non-volatile bytes untouched', () => {
    const input = {
      name: 'Widget',
      price: 9.99,
      active: true,
      tags: ['a', 'b'],
      meta: { currency: 'USD' },
    }
    expect(normalizeVolatile(input, BASE_RULES)).toEqual(input)
  })

  it('drops null and undefined so TS null matches Rust omit-empty', () => {
    const withNull = { name: 'A', optional: null as null, skip: undefined }
    const without = { name: 'A' }
    expect(normalizeVolatile(withNull, BASE_RULES)).toEqual({ name: 'A' })
    expect(normalizeVolatile(without, BASE_RULES)).toEqual({ name: 'A' })
  })

  it('normalizes ref tokens inside URLs', () => {
    const input = {
      url: 'https://api.example.com/v1/sdk/products/prd_ABC123/plans/pln_XYZ',
      path: '/v1/sdk/customers/cus_hello/balance',
    }
    expect(normalizeVolatile(input, BASE_RULES)).toEqual({
      url: `https://api.example.com/v1/sdk/products/${VOLATILE_SENTINEL}/plans/${VOLATILE_SENTINEL}`,
      path: `/v1/sdk/customers/${VOLATILE_SENTINEL}/balance`,
    })
  })

  it('normalizes timestamps, emails, and session id query params in strings', () => {
    const input = {
      message:
        'failed at 2026-07-17T13:01:21.082Z for user shadow-ts@example.com path=/x',
      checkoutUrl:
        'https://jack-local.ngrok.app/customer/checkout?id=6ef05a85b897ab52defe4f41f7e7831f',
    }
    expect(normalizeVolatile(input, BASE_RULES)).toEqual({
      message: `failed at ${VOLATILE_SENTINEL} for user ${VOLATILE_SENTINEL} path=/x`,
      checkoutUrl: `https://jack-local.ngrok.app/customer/checkout?id=${VOLATILE_SENTINEL}`,
    })
  })

  it('no-ops for missing JSON pointers', () => {
    const input = { name: 'A' }
    expect(
      normalizeVolatile(input, { ...BASE_RULES, pointers: ['/missing/path'] }),
    ).toEqual({ name: 'A' })
  })
})
