/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readPaymentIntentId, stripPaymentIntentParams } from './paymentIntentReturn'

describe('paymentIntentReturn', () => {
  describe('readPaymentIntentId', () => {
    it('reads payment_intent from the query string', () => {
      expect(readPaymentIntentId('?payment_intent=pi_rail_123&redirect_status=succeeded')).toBe(
        'pi_rail_123',
      )
    })

    it('returns undefined when the param is absent or empty', () => {
      expect(readPaymentIntentId('?foo=bar')).toBeUndefined()
      expect(readPaymentIntentId('?payment_intent=')).toBeUndefined()
    })
  })

  describe('stripPaymentIntentParams', () => {
    const originalLocation = window.location

    beforeEach(() => {
      Object.defineProperty(window, 'location', {
        configurable: true,
        value: new URL('https://example.com/checkout?payment_intent=pi_1&payment_intent_client_secret=sec&redirect_status=succeeded&keep=1'),
      })
      window.history.replaceState = vi.fn()
    })

    afterEach(() => {
      Object.defineProperty(window, 'location', {
        configurable: true,
        value: originalLocation,
      })
    })

    it('removes the return params and preserves unrelated query params', () => {
      stripPaymentIntentParams()
      expect(window.history.replaceState).toHaveBeenCalledWith(
        {},
        '',
        '/checkout?keep=1',
      )
    })
  })
})
