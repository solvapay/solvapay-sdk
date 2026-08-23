import { describe, expect, it } from 'vitest'
import {
  SOLVAPAY_PRODUCT_REF_PLACEHOLDER,
  assertValidProductRef,
  evaluateProductReadiness,
} from './product-readiness'

describe('evaluateProductReadiness', () => {
  it('is ready when the product is active with at least one active plan', () => {
    const result = evaluateProductReadiness({
      status: 'active',
      plans: [{ isActive: true }, { isActive: false }],
    })
    expect(result).toEqual({
      ready: true,
      issues: [],
      activePlans: 1,
      totalPlans: 2,
    })
  })

  it('reports inactive product status', () => {
    const result = evaluateProductReadiness({
      status: 'draft',
      plans: [{ isActive: true }],
    })
    expect(result.ready).toBe(false)
    expect(result.issues).toContain('product status is "draft"')
    expect(result.activePlans).toBe(1)
  })

  it('reports when there are no plans', () => {
    const result = evaluateProductReadiness({ status: 'active' })
    expect(result.ready).toBe(false)
    expect(result.issues).toContain('no plans defined — customers have nothing to purchase')
    expect(result.totalPlans).toBe(0)
    expect(result.activePlans).toBe(0)
  })

  it('reports when plans exist but none are active', () => {
    const result = evaluateProductReadiness({
      status: 'active',
      plans: [{ isActive: false }, { isActive: false }],
    })
    expect(result.ready).toBe(false)
    expect(result.issues).toContain('none of its 2 plan(s) are active')
    expect(result.activePlans).toBe(0)
    expect(result.totalPlans).toBe(2)
  })

  it('accumulates multiple issues', () => {
    const result = evaluateProductReadiness({
      status: 'archived',
      plans: [],
    })
    expect(result.ready).toBe(false)
    expect(result.issues).toHaveLength(2)
  })
})

describe('assertValidProductRef', () => {
  it('accepts a prd_ shaped ref', () => {
    expect(() => assertValidProductRef('prd_ABC123', 'test')).not.toThrow()
  })

  it('rejects empty or whitespace-only refs', () => {
    expect(() => assertValidProductRef('', 'test')).toThrow(/productRef is required/)
    expect(() => assertValidProductRef('   ', 'test')).toThrow(/productRef is required/)
  })

  it('rejects the scaffolder placeholder', () => {
    expect(() => assertValidProductRef(SOLVAPAY_PRODUCT_REF_PLACEHOLDER, 'test')).toThrow(
      /scaffolder placeholder/,
    )
  })

  it('rejects refs that are not prd_ shaped', () => {
    expect(() => assertValidProductRef('prod_ABC', 'buildSolvaPayDescriptors')).toThrow(
      /buildSolvaPayDescriptors: productRef must look like/,
    )
  })
})
