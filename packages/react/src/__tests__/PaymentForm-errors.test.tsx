import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import React from 'react'
import { PaymentForm } from '../PaymentForm'
import { SolvaPayContext } from '../SolvaPayProvider'
import type { SolvaPayContextValue } from '../types'

let capturedOnSuccess: ((paymentIntent: unknown) => void | Promise<void>) | undefined
let _capturedOnError: ((error: Error) => void) | undefined

vi.mock('@stripe/react-stripe-js', () => ({
  Elements: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'stripe-elements' }, children),
  useStripe: () => ({ confirmCardPayment: vi.fn() }),
  useElements: () => ({ getElement: vi.fn() }),
  CardElement: () => React.createElement('div', { 'data-testid': 'card-element' }),
}))

vi.mock('@stripe/stripe-js', () => ({
  loadStripe: vi.fn(() => Promise.resolve({ confirmCardPayment: vi.fn() })),
}))

vi.mock('../components/StripePaymentFormWrapper', () => ({
  StripePaymentFormWrapper: (props: {
    onSuccess?: (paymentIntent: unknown) => void | Promise<void>
    onError?: (error: Error) => void
  }) => {
    capturedOnSuccess = props.onSuccess
    _capturedOnError = props.onError
    return React.createElement('div', { 'data-testid': 'stripe-wrapper' }, 'MockWrapper')
  },
}))

function createMockContext(overrides?: Partial<SolvaPayContextValue>): SolvaPayContextValue {
  return {
    purchase: {
      loading: false,
      isRefetching: false,
      error: null,
      purchases: [],
      hasProduct: () => false,
      hasPlan: () => false,
      activePurchase: null,
      hasPaidPurchase: false,
      activePaidPurchase: null,
    },
    refetchPurchase: vi.fn(),
    createPayment: vi.fn().mockResolvedValue({
      clientSecret: 'pi_test_secret',
      publishableKey: 'pk_test_123',
    }),
    createTopupPayment: vi.fn(),
    cancelRenewal: vi.fn(),
    reactivateRenewal: vi.fn(),
    activatePlan: vi.fn(),
    balance: {
      loading: false,
      balance: null,
      currency: null,
      refetch: vi.fn(),
      adjustBalance: vi.fn(),
    },
    ...overrides,
  }
}

function renderPaymentForm(
  context?: Partial<SolvaPayContextValue>,
  props?: Partial<React.ComponentProps<typeof PaymentForm>>,
) {
  const ctx = createMockContext(context)
  return {
    ctx,
    ...render(
      React.createElement(
        SolvaPayContext.Provider,
        { value: ctx },
        React.createElement(PaymentForm, {
          planRef: 'pln_test',
          productRef: 'prd_test',
          onSuccess: vi.fn(),
          onError: vi.fn(),
          ...props,
        }),
      ),
    ),
  }
}

describe('PaymentForm - error/success separation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    capturedOnSuccess = undefined
    _capturedOnError = undefined
  })

  it('calls onSuccess (not onError) when processPayment succeeds', async () => {
    const onSuccess = vi.fn()
    const onError = vi.fn()
    const processPayment = vi.fn().mockResolvedValue({ status: 'completed' })
    const refetchPurchase = vi.fn()

    renderPaymentForm(
      { processPayment, refetchPurchase },
      { onSuccess, onError },
    )

    await waitFor(() => {
      expect(capturedOnSuccess).toBeDefined()
    })

    await capturedOnSuccess!({ id: 'pi_123', status: 'succeeded' })

    expect(processPayment).toHaveBeenCalledWith({
      paymentIntentId: 'pi_123',
      productRef: 'prd_test',
      planRef: 'pln_test',
    })
    expect(refetchPurchase).toHaveBeenCalled()
    expect(onSuccess).toHaveBeenCalled()
    expect(onError).not.toHaveBeenCalled()
  })

  it('calls onError (not onSuccess) when processPayment times out', async () => {
    const onSuccess = vi.fn()
    const onError = vi.fn()
    const processPayment = vi.fn().mockResolvedValue({ status: 'timeout' })
    const refetchPurchase = vi.fn()

    vi.useFakeTimers({ shouldAdvanceTime: true })

    renderPaymentForm(
      { processPayment, refetchPurchase },
      { onSuccess, onError },
    )

    await waitFor(() => {
      expect(capturedOnSuccess).toBeDefined()
    })

    const promise = capturedOnSuccess!({ id: 'pi_timeout', status: 'succeeded' })

    await vi.advanceTimersByTimeAsync(20000)
    await promise

    expect(onError).toHaveBeenCalled()
    expect(onError.mock.calls[0][0].message).toMatch(/timed out/)
    expect(onSuccess).not.toHaveBeenCalled()

    vi.useRealTimers()
  })

  it('calls onError (not onSuccess) when processPayment throws', async () => {
    const onSuccess = vi.fn()
    const onError = vi.fn()
    const processPayment = vi.fn().mockRejectedValue(new Error('Server exploded'))

    renderPaymentForm(
      { processPayment },
      { onSuccess, onError },
    )

    await waitFor(() => {
      expect(capturedOnSuccess).toBeDefined()
    })

    await capturedOnSuccess!({ id: 'pi_fail', status: 'succeeded' })

    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'Server exploded' }))
    expect(onSuccess).not.toHaveBeenCalled()
  })

  it('does not pass _processingTimeout or _processingError to onSuccess', async () => {
    const onSuccess = vi.fn()
    const processPayment = vi.fn().mockResolvedValue({ status: 'completed' })

    renderPaymentForm(
      { processPayment },
      { onSuccess, onError: vi.fn() },
    )

    await waitFor(() => {
      expect(capturedOnSuccess).toBeDefined()
    })

    await capturedOnSuccess!({ id: 'pi_clean', status: 'succeeded' })

    expect(onSuccess).toHaveBeenCalled()
    const arg = onSuccess.mock.calls[0][0]
    expect(arg).not.toHaveProperty('_processingTimeout')
    expect(arg).not.toHaveProperty('_processingError')
    expect(arg).not.toHaveProperty('_processingResult')
  })

  it('calls onSuccess with paymentIntent when no processPayment is available', async () => {
    const onSuccess = vi.fn()
    const onError = vi.fn()
    const refetchPurchase = vi.fn()

    renderPaymentForm(
      { processPayment: undefined, refetchPurchase },
      { onSuccess, onError },
    )

    await waitFor(() => {
      expect(capturedOnSuccess).toBeDefined()
    })

    await capturedOnSuccess!({ id: 'pi_simple', status: 'succeeded' })

    expect(refetchPurchase).toHaveBeenCalled()
    expect(onSuccess).toHaveBeenCalled()
    expect(onError).not.toHaveBeenCalled()
  })
})
