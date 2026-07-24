import { describe, it, expect } from 'vitest'
import { resolveReturnUrl, validateCheckoutSessionParams } from './native-helpers'

describe('validateCheckoutSessionParams', () => {
  it('returns null when productRef is present', () => {
    expect(validateCheckoutSessionParams('prd_1')).toBeNull()
  })

  it('rejects empty productRef', () => {
    expect(validateCheckoutSessionParams('')).toEqual({
      error: 'Missing required parameter: productRef is required',
      status: 400,
    })
  })

  it('rejects nullish productRef', () => {
    expect(validateCheckoutSessionParams(null)).toEqual({
      error: 'Missing required parameter: productRef is required',
      status: 400,
    })
    expect(validateCheckoutSessionParams(undefined)).toEqual({
      error: 'Missing required parameter: productRef is required',
      status: 400,
    })
  })
})

describe('resolveReturnUrl', () => {
  it('prefers body returnUrl', () => {
    expect(
      resolveReturnUrl('https://body.example/return', 'https://options.example/return', 'https://origin'),
    ).toBe('https://body.example/return')
  })

  it('falls back to options returnUrl', () => {
    expect(resolveReturnUrl(undefined, 'https://options.example/return', 'https://origin')).toBe(
      'https://options.example/return',
    )
  })

  it('falls back to origin when body and options are absent', () => {
    expect(resolveReturnUrl(undefined, undefined, 'https://origin')).toBe('https://origin')
  })

  it('returns undefined when all are absent', () => {
    expect(resolveReturnUrl(undefined, undefined, undefined)).toBeUndefined()
  })

  it('treats empty-string body/options as falsy and falls through to origin', () => {
    expect(resolveReturnUrl('', '', 'https://origin')).toBe('https://origin')
  })

  it('returns undefined when only empty strings are provided', () => {
    expect(resolveReturnUrl('', '', '')).toBeUndefined()
  })

  it('treats null origin as absent', () => {
    expect(resolveReturnUrl(undefined, undefined, null)).toBeUndefined()
  })
})
