import { describe, it, expect } from 'vitest'
import {
  SolvaPayError,
  MissingProviderError,
  MissingEnvVarError,
  MissingApiRouteError,
  MissingProductRefError,
  DOCS_BASE_URL,
} from './errors'

describe('SolvaPayError', () => {
  it('all subclasses inherit from SolvaPayError and Error', () => {
    const errors = [
      new MissingProviderError('PlanSelector'),
      new MissingEnvVarError('NEXT_PUBLIC_SOLVAPAY_PRODUCT_REF'),
      new MissingApiRouteError('/api/solvapay/purchase'),
      new MissingProductRefError('PlanSelector'),
    ]
    for (const err of errors) {
      expect(err).toBeInstanceOf(SolvaPayError)
      expect(err).toBeInstanceOf(Error)
      expect(err.docsUrl.startsWith(DOCS_BASE_URL)).toBe(true)
    }
  })

  it('sets a stable error code on every subclass', () => {
    expect(new MissingProviderError('X').code).toBe('MISSING_PROVIDER')
    expect(new MissingEnvVarError('X').code).toBe('MISSING_ENV_VAR')
    expect(new MissingApiRouteError('X').code).toBe('MISSING_API_ROUTE')
    expect(new MissingProductRefError('X').code).toBe('MISSING_PRODUCT_REF')
  })
})

describe('MissingProviderError', () => {
  it('names the primitive and tells the user to wrap with SolvaPayProvider', () => {
    const err = new MissingProviderError('PlanSelector')
    expect(err.message).toContain('PlanSelector')
    expect(err.message).toContain('SolvaPayProvider')
    expect(err.docsUrl).toContain('missing-provider')
  })
})

describe('MissingEnvVarError', () => {
  it('names the env var and points to the setup docs', () => {
    const err = new MissingEnvVarError('NEXT_PUBLIC_SOLVAPAY_API_URL')
    expect(err.message).toContain('NEXT_PUBLIC_SOLVAPAY_API_URL')
    expect(err.docsUrl).toContain('env-vars')
  })
})

describe('MissingApiRouteError', () => {
  it('names the route and points to the setup docs', () => {
    const err = new MissingApiRouteError('/api/solvapay/purchase')
    expect(err.message).toContain('/api/solvapay/purchase')
    expect(err.docsUrl).toContain('api-route')
  })
})

describe('MissingProductRefError', () => {
  it('names the primitive and tells the user to pass a productRef', () => {
    const err = new MissingProductRefError('CheckoutSummary')
    expect(err.message).toContain('CheckoutSummary')
    expect(err.message.toLowerCase()).toContain('productref')
    expect(err.docsUrl).toContain('product-ref')
  })
})
