import { describe, expect, it, vi } from 'vitest'
import { SolvaPayError } from '@solvapay/core'
import { handleRouteError, isErrorResult } from './error'

describe('handleRouteError', () => {
  it('returns 500 for a plain Error', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const result = handleRouteError(new Error('boom'), 'Get something')
    expect(result.status).toBe(500)
    expect(result.error).toBe('Get something failed')
    expect(result.details).toBe('boom')
  })

  it('uses custom defaultMessage for a plain Error', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const result = handleRouteError(
      new Error('Backend exploded'),
      'Get product',
      'Failed to fetch product',
    )
    expect(result.status).toBe(500)
    expect(result.error).toBe('Failed to fetch product')
    expect(result.details).toBe('Backend exploded')
  })

  it('preserves status when SolvaPayError carries an upstream HTTP status', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const err = new SolvaPayError('Get merchant failed (404): not found', {
      status: 404,
    })
    const result = handleRouteError(err, 'Get merchant')
    expect(result.status).toBe(404)
    expect(result.error).toBe('Get merchant failed (404): not found')
    expect(result.details).toBe('Get merchant failed (404): not found')
  })

  it('defaults to 500 for a SolvaPayError without a status', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const err = new SolvaPayError('Missing apiKey')
    const result = handleRouteError(err, 'Create client')
    expect(result.status).toBe(500)
  })

  it('maps unknown non-Error throws to details Unknown error', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const result = handleRouteError(
      'string-throw',
      'Get merchant',
      'Failed to fetch merchant',
    )
    expect(result).toEqual({
      error: 'Failed to fetch merchant',
      status: 500,
      details: 'Unknown error',
    })
  })
})

describe('isErrorResult', () => {
  it('returns true for objects with error and status', () => {
    expect(isErrorResult({ error: 'Unauthorized', status: 401 })).toBe(true)
  })

  it('returns false when error is missing', () => {
    expect(isErrorResult({ status: 500 })).toBe(false)
  })

  it('returns false when status is missing', () => {
    expect(isErrorResult({ error: 'boom' })).toBe(false)
  })

  it('returns false for non-objects and null', () => {
    expect(isErrorResult('not-an-object')).toBe(false)
    expect(isErrorResult(null)).toBe(false)
  })
})
