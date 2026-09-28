/**
 * @vitest-environment jsdom
 *
 * Return-path resume after Stripe redirect / 3DS — verifies we retrieve the
 * PaymentIntent, skip handleNextAction when already terminal, and reconcile.
 */
import { render, waitFor, screen } from '@testing-library/react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import React from 'react'
import { PaymentForm } from './PaymentForm'
import { SolvaPayContext } from '../SolvaPayProvider'
import { plansCache } from '../hooks/usePlans'
import { productCache } from '../hooks/useProduct'
import { merchantCache } from '../hooks/useMerchant'
import type { Plan, SolvaPayContextValue, SucceededPayment } from '../types'
import type { PaymentIntent } from '@stripe/stripe-js'
import { mockBalanceStatus } from '../test-helpers/mockBalanceStatus'
import { enCopy } from '../i18n/en'

const retrievePaymentIntent = vi.fn()
const handleNextAction = vi.fn()
const stripHistory = vi.fn()

vi.mock('./paymentIntentReturn', async importOriginal => {
  const actual = await importOriginal<typeof import('./paymentIntentReturn')>()
  return {
    ...actual,
    readPaymentIntentClientSecret: vi.fn(() => 'pi_return_secret'),
    stripPaymentIntentParams: () => stripHistory(),
  }
})

vi.mock('@stripe/react-stripe-js', async () => {
  const ReactMod = await import('react')
  return {
    Elements: ({ children }: { children: React.ReactNode }) =>
      ReactMod.createElement('section', { 'data-testid': 'stripe-elements' }, children),
    useStripe: () => ({
      retrievePaymentIntent,
      handleNextAction,
    }),
    useElements: () => ({ getElement: vi.fn(), submit: vi.fn() }),
    PaymentElement: ({
      onChange,
    }: {
      onChange?: (e: { complete: boolean }) => void
    }) => {
      ReactMod.useEffect(() => {
        onChange?.({ complete: true })
      }, [onChange])
      return ReactMod.createElement('section', { 'data-testid': 'payment-element' })
    },
  }
})

vi.mock('@stripe/stripe-js', () => ({
  loadStripe: vi.fn(() => Promise.resolve({})),
}))

vi.mock('../utils/confirmPayment', () => ({
  confirmPayment: vi.fn(),
}))

const reconcilePayment = vi.fn()
vi.mock('../utils/processPaymentResult', () => ({
  reconcilePayment: (...args: unknown[]) => reconcilePayment(...args),
}))

const paidPlan: Plan = {
  reference: 'pln_paid',
  name: 'Pro',
  price: 1999,
  currency: 'usd',
  type: 'recurring',
  interval: 'month',
  requiresPayment: true,
}

function mockBalance(): SolvaPayContextValue['balance'] {
  return mockBalanceStatus()
}

function seedCaches() {
  plansCache.set('prd_paid', { plans: [paidPlan], timestamp: Date.now(), promise: null })
  productCache.set('prd_paid', {
    product: { reference: 'prd_paid', name: 'Widget API' },
    promise: null,
    timestamp: Date.now(),
  })
  merchantCache.set('/api/merchant', {
    merchant: { displayName: 'Acme', legalName: 'Acme Inc' },
    promise: null,
    timestamp: Date.now(),
  })
}

type HarnessSpies = {
  onSuccess: ReturnType<typeof vi.fn>
  onError: ReturnType<typeof vi.fn>
  upsertPurchase: ReturnType<typeof vi.fn>
  refetchPurchase: ReturnType<typeof vi.fn>
  processPayment: ReturnType<typeof vi.fn>
}

function makeSpies(): HarnessSpies {
  return {
    onSuccess: vi.fn(),
    onError: vi.fn(),
    upsertPurchase: vi.fn(),
    refetchPurchase: vi.fn().mockResolvedValue(undefined),
    processPayment: vi.fn(),
  }
}

function ReturnHarness({ spies }: { spies: HarnessSpies }) {
  const { onSuccess, onError, upsertPurchase, refetchPurchase, processPayment } = spies

  const ctx = React.useMemo<SolvaPayContextValue>(
    () => ({
      purchase: {
        loading: false,
        isRefetching: false,
        error: null,
        purchases: [],
        hasProduct: () => false,
        activePurchase: null,
        hasPaidPurchase: false,
        activePaidPurchase: null,
        balanceTransactions: [],
      },
      refetchPurchase,
      upsertPurchase,
      createPayment: vi.fn().mockResolvedValue({
        clientSecret: 'cs_test_123',
        publishableKey: 'pk_test',
      }),
      processPayment,
      createTopupPayment: vi.fn(),
      cancelRenewal: vi.fn(),
      reactivateRenewal: vi.fn(),
      activatePlan: vi.fn(),
      balance: mockBalance(),
    }),
    [processPayment, refetchPurchase, upsertPurchase],
  )

  return (
    <SolvaPayContext.Provider value={ctx}>
      <PaymentForm.Root planRef="pln_paid" productRef="prd_paid" onSuccess={onSuccess} onError={onError}>
        <PaymentForm.PaymentElement />
        <PaymentForm.Error data-testid="payment-error" />
        <PaymentForm.SubmitButton data-testid="submit" />
      </PaymentForm.Root>
    </SolvaPayContext.Provider>
  )
}

const errorText = () => screen.queryByTestId('payment-error')?.textContent ?? null
const submit = () => screen.getByTestId('submit')

function expectedReconcileArgs(spies: HarnessSpies, paymentIntentId: string) {
  return {
    paymentIntentId,
    productRef: 'prd_paid',
    planRef: 'pln_paid',
    processPayment: spies.processPayment,
    refetchPurchase: spies.refetchPurchase,
    copy: enCopy,
  }
}

describe('PaymentForm return-path resume', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    seedCaches()
    reconcilePayment.mockResolvedValue({
      status: 'success',
      result: { status: 'succeeded' },
    })
    retrievePaymentIntent.mockResolvedValue({
      paymentIntent: { id: 'pi_frictionless_3055', status: 'succeeded' },
    })
  })

  it('resumes frictionless 3DS (card 4000000000003055) without handleNextAction', async () => {
    const spies = makeSpies()
    render(<ReturnHarness spies={spies} />)

    await waitFor(() => expect(spies.onSuccess).toHaveBeenCalledTimes(1))
    expect(retrievePaymentIntent).toHaveBeenCalledTimes(1)
    expect(retrievePaymentIntent).toHaveBeenCalledWith('pi_return_secret')
    expect(handleNextAction).not.toHaveBeenCalled()
    expect(stripHistory).toHaveBeenCalledTimes(1)
    expect(reconcilePayment).toHaveBeenCalledTimes(1)
    expect(reconcilePayment).toHaveBeenCalledWith(expectedReconcileArgs(spies, 'pi_frictionless_3055'))
    // A reconcile result without a purchase payload falls back to a refetch.
    expect(spies.refetchPurchase).toHaveBeenCalledTimes(1)
    expect(spies.upsertPurchase).not.toHaveBeenCalled()
    expect(spies.onSuccess).toHaveBeenCalledWith({ id: 'pi_frictionless_3055', status: 'succeeded' })
    expect(spies.onError).not.toHaveBeenCalled()
    expect(errorText()).toBeNull()
    await waitFor(() => expect(submit()).toHaveAttribute('aria-busy', 'false'))
  })

  it('merges the recurring purchase from a successful reconcile into provider state', async () => {
    const purchase = { purchaseRef: 'pur_1', planRef: 'pln_paid', status: 'active' }
    reconcilePayment.mockResolvedValue({ status: 'success', result: { status: 'succeeded', type: 'recurring', purchase } })
    const spies = makeSpies()
    render(<ReturnHarness spies={spies} />)
    await waitFor(() => expect(spies.onSuccess).toHaveBeenCalledTimes(1))
    expect(spies.upsertPurchase).toHaveBeenCalledTimes(1)
    expect(spies.upsertPurchase).toHaveBeenCalledWith(purchase)
    expect(spies.refetchPurchase).not.toHaveBeenCalled()
  })

  it('calls handleNextAction when the return PI is still requires_action', async () => {
    retrievePaymentIntent.mockResolvedValueOnce({
      paymentIntent: { id: 'pi_action', status: 'requires_action' },
    })
    handleNextAction.mockResolvedValueOnce({
      paymentIntent: { id: 'pi_action', status: 'succeeded' },
    })

    const spies = makeSpies()
    render(<ReturnHarness spies={spies} />)

    await waitFor(() => expect(spies.onSuccess).toHaveBeenCalledTimes(1))
    expect(handleNextAction).toHaveBeenCalledTimes(1)
    expect(handleNextAction).toHaveBeenCalledWith({ clientSecret: 'pi_return_secret' })
    expect(reconcilePayment).toHaveBeenCalledTimes(1)
    expect(reconcilePayment).toHaveBeenCalledWith(expectedReconcileArgs(spies, 'pi_action'))
    expect(spies.onSuccess).toHaveBeenCalledWith({ id: 'pi_action', status: 'succeeded' })
    expect(spies.onError).not.toHaveBeenCalled()
    expect(errorText()).toBeNull()
  })

  it('shows the 3DS copy and stops when handleNextAction fails', async () => {
    retrievePaymentIntent.mockResolvedValueOnce({
      paymentIntent: { id: 'pi_action', status: 'requires_action' },
    })
    handleNextAction.mockResolvedValueOnce({ error: { message: 'authentication_failed' } })

    const spies = makeSpies()
    render(<ReturnHarness spies={spies} />)

    await waitFor(() => expect(errorText()).toBe(enCopy.errors.paymentRequires3ds))
    expect(errorText()).toBe('Payment requires additional authentication. Please complete the verification.')
    expect(handleNextAction).toHaveBeenCalledWith({ clientSecret: 'pi_return_secret' })
    expect(reconcilePayment).not.toHaveBeenCalled()
    expect(spies.onSuccess).not.toHaveBeenCalled()
    expect(spies.onError).not.toHaveBeenCalled()
    await waitFor(() => expect(submit()).toHaveAttribute('aria-busy', 'false'))
  })

  it('surfaces pending copy when the return PI is still processing (async methods)', async () => {
    retrievePaymentIntent.mockResolvedValueOnce({
      paymentIntent: { id: 'pi_sepa_ideal', status: 'processing' },
    })

    const spies = makeSpies()
    render(<ReturnHarness spies={spies} />)

    await waitFor(() => expect(errorText()).toBe(enCopy.errors.paymentPending))
    expect(errorText()).toBe('Your payment is being confirmed. You will be notified once it completes.')
    expect(retrievePaymentIntent).toHaveBeenCalledTimes(1)
    expect(retrievePaymentIntent).toHaveBeenCalledWith('pi_return_secret')
    expect(stripHistory).toHaveBeenCalledTimes(1)
    expect(handleNextAction).not.toHaveBeenCalled()
    expect(reconcilePayment).not.toHaveBeenCalled()
    expect(spies.onSuccess).not.toHaveBeenCalled()
    expect(spies.onError).not.toHaveBeenCalled()
    await waitFor(() => expect(submit()).toHaveAttribute('aria-busy', 'false'))
  })

  it('shows the processing-failed copy when the return PI landed in a terminal non-success state', async () => {
    retrievePaymentIntent.mockResolvedValueOnce({
      paymentIntent: { id: 'pi_canceled', status: 'canceled' },
    })
    const spies = makeSpies()
    render(<ReturnHarness spies={spies} />)
    await waitFor(() => expect(errorText()).toBe(enCopy.errors.paymentProcessingFailed))
    expect(reconcilePayment).not.toHaveBeenCalled()
    expect(spies.onSuccess).not.toHaveBeenCalled()
  })

  it('shows the unexpected-error copy when the PaymentIntent cannot be retrieved', async () => {
    retrievePaymentIntent.mockResolvedValueOnce({ error: { message: 'No such payment_intent' } })
    const spies = makeSpies()
    render(<ReturnHarness spies={spies} />)
    await waitFor(() => expect(errorText()).toBe(enCopy.errors.paymentUnexpected))
    expect(stripHistory).toHaveBeenCalledTimes(1)
    expect(handleNextAction).not.toHaveBeenCalled()
    expect(reconcilePayment).not.toHaveBeenCalled()
    expect(spies.onSuccess).not.toHaveBeenCalled()
  })

  it('reports a failed reconcile through onError with the processing-failed copy', async () => {
    const reconcileError = new Error('process-payment 500')
    reconcilePayment.mockResolvedValue({ status: 'error', error: reconcileError })
    const spies = makeSpies()
    render(<ReturnHarness spies={spies} />)
    await waitFor(() => expect(spies.onError).toHaveBeenCalledTimes(1))
    expect(spies.onError).toHaveBeenCalledWith(reconcileError)
    expect(errorText()).toBe(enCopy.errors.paymentProcessingFailed)
    expect(spies.onSuccess).not.toHaveBeenCalled()
    expect(spies.upsertPurchase).not.toHaveBeenCalled()
  })

  it('shows the reconcile timeout message verbatim', async () => {
    const timeoutError = new Error('Payment processing timed out — webhooks may not be configured')
    reconcilePayment.mockResolvedValue({ status: 'timeout', error: timeoutError })
    const spies = makeSpies()
    render(<ReturnHarness spies={spies} />)
    await waitFor(() => expect(spies.onError).toHaveBeenCalledWith(timeoutError))
    expect(errorText()).toBe('Payment processing timed out — webhooks may not be configured')
    expect(spies.onSuccess).not.toHaveBeenCalled()
  })
})
