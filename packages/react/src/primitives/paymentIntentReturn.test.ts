/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  readPaymentIntentClientSecret,
  stripPaymentIntentParams,
} from './paymentIntentReturn'

describe('paymentIntentReturn', () => {
  describe('readPaymentIntentClientSecret', () => {
    it('reads payment_intent_client_secret from the query string', () => {
      expect(
        readPaymentIntentClientSecret('?payment_intent_client_secret=pi_secret_123'),
      ).toBe('pi_secret_123')
    })

    it('returns undefined when the param is absent', () => {
      expect(readPaymentIntentClientSecret('?foo=bar')).toBeUndefined()
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

    it('removes Stripe return params and preserves unrelated query params', () => {
      stripPaymentIntentParams()
      expect(window.history.replaceState).toHaveBeenCalledWith(
        {},
        '',
        '/checkout?keep=1',
      )
    })
  })
})
