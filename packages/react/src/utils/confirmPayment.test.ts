import { describe, it, expect, vi } from 'vitest'
import { confirmPayment } from './confirmPayment'
import { enCopy } from '../i18n/en'
import type { Stripe, StripeElements } from '@stripe/stripe-js'

function makeStripe(overrides: Record<string, unknown>): Stripe {
  return {
    confirmPayment: vi.fn(),
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
  it('uses confirmPayment for the Payment Element', async () => {
    const confirmPaymentFn = vi.fn().mockResolvedValue({
      paymentIntent: { status: 'succeeded', id: 'pi_1' },
    })
    const stripe = makeStripe({ confirmPayment: confirmPaymentFn })
    const elements = makeElements({ __tag: 'payment' })

    const result = await confirmPayment({
      stripe,
      elements,
      clientSecret: 'cs_1',
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

  it('calls elements.submit() before stripe.confirmPayment()', async () => {
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
      returnUrl: 'https://example.com/return',
      copy: enCopy,
    })

    expect(result).toEqual({
      status: 'error',
      message: 'Your postal code is incomplete.',
    })
    expect(confirmPaymentFn).not.toHaveBeenCalled()
  })

  it('resolves frictionless 3DS in-page to succeeded without requires_action (card 4000000000003055)', async () => {
    const handleNextAction = vi.fn()
    const confirmPaymentFn = vi.fn().mockResolvedValue({
      paymentIntent: { status: 'succeeded', id: 'pi_frictionless_3055' },
    })
    const stripe = makeStripe({ confirmPayment: confirmPaymentFn, handleNextAction })
    const elements = makeElements({ __tag: 'payment' })

    const result = await confirmPayment({
      stripe,
      elements,
      clientSecret: 'cs_frictionless',
      returnUrl: 'https://example.com/return',
      copy: enCopy,
    })

    expect(result.status).toBe('succeeded')
    expect(confirmPaymentFn).toHaveBeenCalledWith(
      expect.objectContaining({ redirect: 'if_required' }),
    )
    expect(handleNextAction).not.toHaveBeenCalled()
  })

  it('maps processing status to pending', async () => {
    const stripe = makeStripe({
      confirmPayment: vi
        .fn()
        .mockResolvedValue({ paymentIntent: { status: 'processing', id: 'pi_proc' } }),
    })
    const elements = makeElements({ __tag: 'payment' })
    const result = await confirmPayment({
      stripe,
      elements,
      clientSecret: 'cs',
      returnUrl: 'https://example.com',
      copy: enCopy,
    })
    expect(result.status).toBe('pending')
    if (result.status === 'pending') {
      expect(result.message).toBe(enCopy.errors.paymentPending)
    }
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
      returnUrl: 'https://example.com',
      copy: enCopy,
    })
    expect(result).toEqual({ status: 'error', message: 'card declined' })
  })

  it('returns error when no element is mounted', async () => {
    const stripe = makeStripe({ confirmPayment: vi.fn() })
    const elements = makeElements(undefined)
    const result = await confirmPayment({
      stripe,
      elements,
      clientSecret: 'cs',
      returnUrl: 'https://example.com',
      copy: enCopy,
    })
    expect(result.status).toBe('error')
  })
})
