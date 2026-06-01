import { describe, expect, it, vi } from 'vitest'
import { SolvaPayError } from '@solvapay/core'
import { handleRouteError } from './error'

describe('handleRouteError', () => {
  it('returns 500 for a plain Error', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const result = handleRouteError(new Error('boom'), 'Get something')
    expect(result.status).toBe(500)
    expect(result.error).toBe('Get something failed')
    expect(result.details).toBe('boom')
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
})
