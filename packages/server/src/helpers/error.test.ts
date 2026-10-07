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

  it('copies the error key, reason and decline code of a keyed API answer', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const err = new SolvaPayError('Confirm payment failed (402): Payment card_declined', {
      status: 402,
      code: 'payment_declined',
      reason: 'card_declined',
      declineCode: 'insufficient_funds',
    })
    expect(handleRouteError(err, 'Confirm payment')).toStrictEqual({
      error: 'Confirm payment failed (402): Payment card_declined',
      status: 402,
      details: 'Confirm payment failed (402): Payment card_declined',
      code: 'payment_declined',
      reason: 'card_declined',
      declineCode: 'insufficient_funds',
    })
  })

  it('leaves the keyed fields out when the error has none', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const result = handleRouteError(
      new SolvaPayError('Get merchant failed (404): not found', { status: 404 }),
      'Get merchant',
    )
    expect(result).not.toHaveProperty('code')
    expect(result).not.toHaveProperty('reason')
    expect(result).not.toHaveProperty('declineCode')
  })

  it('defaults to 500 for a SolvaPayError without a status', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const err = new SolvaPayError('Missing apiKey')
    const result = handleRouteError(err, 'Create client')
    expect(result.status).toBe(500)
  })
})
