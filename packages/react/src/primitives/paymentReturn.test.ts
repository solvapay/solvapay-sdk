/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  PAYMENT_RETURN_PARAM,
  buildPaymentReturnUrl,
  readPaymentReturn,
  rememberPaymentReturn,
  stripPaymentReturnParams,
  takePaymentReturn,
  withoutPaymentReturnParams,
} from './paymentReturn'

describe('paymentReturn', () => {
  beforeEach(() => sessionStorage.clear())

  it('tags the return URL with the SolvaPay payment id and reads it back', () => {
    const url = buildPaymentReturnUrl('https://app.example/checkout?plan=pro', {
      paymentIntentId: 'pi_sp_1',
    })
    expect(url).toBe('https://app.example/checkout?plan=pro&solvapay_payment=pi_sp_1')
    expect(PAYMENT_RETURN_PARAM).toBe('solvapay_payment')
    expect(readPaymentReturn(new URL(url).search)).toStrictEqual({ paymentIntentId: 'pi_sp_1' })
    // A second build replaces the first tag.
    expect(buildPaymentReturnUrl(url, { paymentIntentId: 'pi_sp_2' })).toBe(
      'https://app.example/checkout?plan=pro&solvapay_payment=pi_sp_2',
    )
  })

  it('reads nothing when the param is absent or empty', () => {
    expect(readPaymentReturn('?foo=bar')).toBeUndefined()
    expect(readPaymentReturn('?solvapay_payment=')).toBeUndefined()
    expect(readPaymentReturn('?payment_intent=pi_rail_1')).toBeUndefined()
  })

  it('remembers the rail reference for the return and hands it out once', () => {
    rememberPaymentReturn({ paymentIntentId: 'pi_sp_1', processorPaymentId: 'pi_rail_1' })
    expect(takePaymentReturn('pi_sp_1')).toStrictEqual({
      paymentIntentId: 'pi_sp_1',
      processorPaymentId: 'pi_rail_1',
    })
    expect(takePaymentReturn('pi_sp_1')).toBeUndefined()
    expect(takePaymentReturn('pi_sp_other')).toBeUndefined()
  })

  it('refuses a corrupt record', () => {
    sessionStorage.setItem('solvapay:payment-return:pi_sp_1', '{"processorPaymentId":""}')
    expect(takePaymentReturn('pi_sp_1')).toBeUndefined()
    sessionStorage.setItem('solvapay:payment-return:pi_sp_2', 'not json')
    expect(takePaymentReturn('pi_sp_2')).toBeUndefined()
  })

  describe('stripPaymentReturnParams', () => {
    const originalLocation = window.location

    beforeEach(() => {
      Object.defineProperty(window, 'location', {
        configurable: true,
        value: new URL(
          'https://example.com/checkout?solvapay_payment=pi_sp_1&payment_intent=pi_1&payment_intent_client_secret=sec&redirect_status=succeeded&keep=1',
        ),
      })
      window.history.replaceState = vi.fn()
    })

    afterEach(() => {
      Object.defineProperty(window, 'location', { configurable: true, value: originalLocation })
    })

    it('removes the SDK param and what the rail appended, and keeps unrelated params', () => {
      expect(withoutPaymentReturnParams(window.location.href)).toBe(
        'https://example.com/checkout?keep=1',
      )
      stripPaymentReturnParams()
      expect(window.history.replaceState).toHaveBeenCalledWith({}, '', '/checkout?keep=1')
    })

    it('does not rewrite history when nothing is to strip', () => {
      Object.defineProperty(window, 'location', {
        configurable: true,
        value: new URL('https://example.com/checkout?keep=1'),
      })
      stripPaymentReturnParams()
      expect(window.history.replaceState).not.toHaveBeenCalled()
    })
  })
})
