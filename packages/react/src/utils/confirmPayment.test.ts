import { describe, it, expect, vi } from 'vitest'
import { confirmPayment } from './confirmPayment'
import { enCopy } from '../i18n/en'
import type { Stripe, StripeElements } from '@stripe/stripe-js'

function makeStripe(overrides: Partial<Stripe>): Stripe {
  return {
    confirmPayment: vi.fn(),
    confirmCardPayment: vi.fn(),
    ...overrides,
  } as unknown as Stripe
}

function makeElements(element: unknown, submitResult: unknown = {}): StripeElements {
  return {
    getElement: vi.fn().mockReturnValue(element),
    submit: vi.fn().mockResolvedValue(submitResult),
  } as unknown as StripeElements
}

describe('confirmPayment', () => {
  it('uses confirmPayment for payment-element mode', async () => {
    const confirmPaymentFn = vi.fn().mockResolvedValue({
      paymentIntent: { status: 'succeeded', id: 'pi_1' },
    })
    const stripe = makeStripe({ confirmPayment: confirmPaymentFn })
    const elements = makeElements({ __tag: 'payment' })

    const result = await confirmPayment({
      stripe,
      elements,
      clientSecret: 'cs_1',
      mode: 'payment-element',
      returnUrl: 'https://example.com/return',
      copy: enCopy,
    })

    expect(result.status).toBe('succeeded')
    expect(elements.submit).toHaveBeenCalledTimes(1)
    expect(confirmPaymentFn).toHaveBeenCalledWith(
      expect.objectContaining({
        elements,
        clientSecret: 'cs_1',
        redirect: 'if_required',
      }),
    )
  })

  it('calls elements.submit() before stripe.confirmPayment() for payment-element mode', async () => {
    const callOrder: string[] = []
    const submitFn = vi.fn(async () => {
      callOrder.push('submit')
      return {}
    })
    const confirmPaymentFn = vi.fn(async () => {
      callOrder.push('confirm')
      return { paymentIntent: { status: 'succeeded', id: 'pi_order' } }
    })
    const stripe = makeStripe({ confirmPayment: confirmPaymentFn })
    const elements = {
      getElement: vi.fn().mockReturnValue({ __tag: 'payment' }),
      submit: submitFn,
    } as unknown as StripeElements

    const result = await confirmPayment({
      stripe,
      elements,
      clientSecret: 'cs_order',
      mode: 'payment-element',
      returnUrl: 'https://example.com/return',
      copy: enCopy,
    })

    expect(result.status).toBe('succeeded')
    expect(callOrder).toEqual(['submit', 'confirm'])
  })

  it('returns error when elements.submit() fails and does not call confirmPayment', async () => {
    const confirmPaymentFn = vi.fn()
    const stripe = makeStripe({ confirmPayment: confirmPaymentFn })
    const elements = makeElements(
      { __tag: 'payment' },
      { error: { message: 'Your postal code is incomplete.' } },
    )

    const result = await confirmPayment({
      stripe,
      elements,
      clientSecret: 'cs_submit_err',
      mode: 'payment-element',
      returnUrl: 'https://example.com/return',
      copy: enCopy,
    })

    expect(result).toEqual({
      status: 'error',
      message: 'Your postal code is incomplete.',
    })
    expect(confirmPaymentFn).not.toHaveBeenCalled()
  })

  it('uses confirmCardPayment for card-element mode', async () => {
    const confirmCardFn = vi.fn().mockResolvedValue({
      paymentIntent: { status: 'succeeded', id: 'pi_2' },
    })
    const stripe = makeStripe({ confirmCardPayment: confirmCardFn })
    const cardEl = { __tag: 'card' }
    const elements = makeElements(cardEl)

    const result = await confirmPayment({
      stripe,
      elements,
      clientSecret: 'cs_2',
      mode: 'card-element',
      returnUrl: 'https://example.com/return',
      billingDetails: { email: 'a@b.com' },
      copy: enCopy,
    })

    expect(result.status).toBe('succeeded')
    expect(confirmCardFn).toHaveBeenCalledWith(
      'cs_2',
      expect.objectContaining({
        payment_method: expect.objectContaining({
          card: cardEl,
          billing_details: { email: 'a@b.com' },
        }),
      }),
    )
  })

  it('maps requires_action status', async () => {
    const stripe = makeStripe({
      confirmPayment: vi
        .fn()
        .mockResolvedValue({ paymentIntent: { status: 'requires_action' } }),
    })
    const elements = makeElements({})
    const result = await confirmPayment({
      stripe,
      elements,
      clientSecret: 'cs',
      mode: 'payment-element',
      returnUrl: 'https://example.com',
      copy: enCopy,
    })
    expect(result.status).toBe('requires_action')
  })

  it('returns error when Stripe returns an error', async () => {
    const stripe = makeStripe({
      confirmPayment: vi
        .fn()
        .mockResolvedValue({ error: { message: 'card declined' } }),
    })
    const elements = makeElements({})
    const result = await confirmPayment({
      stripe,
      elements,
      clientSecret: 'cs',
      mode: 'payment-element',
      returnUrl: 'https://example.com',
      copy: enCopy,
    })
    expect(result).toEqual({ status: 'error', message: 'card declined' })
  })

  it('returns error when no element is mounted', async () => {
    const stripe = makeStripe({ confirmPayment: vi.fn() })
    const elements = makeElements(null)
    const result = await confirmPayment({
      stripe,
      elements,
      clientSecret: 'cs',
      mode: 'payment-element',
      returnUrl: 'https://example.com',
      copy: enCopy,
    })
    expect(result.status).toBe('error')
  })
})
