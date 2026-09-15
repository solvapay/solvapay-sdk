import { afterEach, describe, expect, it } from 'vitest'
import { SolvaPayError } from '@solvapay/core'
import { requireProductRef, resolveProductRef } from './resolve-product-ref'

describe('resolveProductRef', () => {
  const originalProductRef = process.env.SOLVAPAY_PRODUCT_REF

  afterEach(() => {
    if (originalProductRef === undefined) {
      delete process.env.SOLVAPAY_PRODUCT_REF
    } else {
      process.env.SOLVAPAY_PRODUCT_REF = originalProductRef
    }
  })

  it('returns the explicit option when provided', () => {
    process.env.SOLVAPAY_PRODUCT_REF = 'prd_from_env'
    expect(resolveProductRef('prd_explicit')).toBe('prd_explicit')
  })

  it('reads SOLVAPAY_PRODUCT_REF when no explicit option is provided', () => {
    process.env.SOLVAPAY_PRODUCT_REF = 'prd_from_env'
    expect(resolveProductRef()).toBe('prd_from_env')
  })

  it('returns undefined when nothing resolves', () => {
    delete process.env.SOLVAPAY_PRODUCT_REF
    expect(resolveProductRef()).toBeUndefined()
  })
})

describe('requireProductRef', () => {
  const originalProductRef = process.env.SOLVAPAY_PRODUCT_REF

  afterEach(() => {
    if (originalProductRef === undefined) {
      delete process.env.SOLVAPAY_PRODUCT_REF
    } else {
      process.env.SOLVAPAY_PRODUCT_REF = originalProductRef
    }
  })

  it('returns the resolved ref', () => {
    process.env.SOLVAPAY_PRODUCT_REF = 'prd_from_env'
    expect(requireProductRef()).toBe('prd_from_env')
  })

  it('throws a SolvaPayError naming SOLVAPAY_PRODUCT_REF when nothing resolves', () => {
    delete process.env.SOLVAPAY_PRODUCT_REF
    expect(() => requireProductRef()).toThrow(SolvaPayError)
    expect(() => requireProductRef()).toThrow(/SOLVAPAY_PRODUCT_REF/)
    expect(() => requireProductRef()).toThrow(/npx solvapay doctor/)
  })
})
