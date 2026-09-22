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
import type { Plan, SolvaPayContextValue } from '../types'
import type { PaymentIntent } from '@stripe/stripe-js'
import { mockBalanceStatus } from '../test-helpers/mockBalanceStatus'

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
    PaymentElement: ({ onChange }: { onChange?: (e: { complete: boolean }) => void }) => {
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

function ReturnHarness({ onSuccess }: { onSuccess?: (intent: PaymentIntent) => void }) {
  const upsertPurchase = vi.fn()
  const refetchPurchase = vi.fn().mockResolvedValue(undefined)
  const processPayment = vi.fn()

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
      <PaymentForm.Root planRef="pln_paid" productRef="prd_paid" onSuccess={onSuccess}>
        <PaymentForm.PaymentElement />
        <PaymentForm.Error data-testid="payment-error" />
        <PaymentForm.SubmitButton data-testid="submit" />
      </PaymentForm.Root>
    </SolvaPayContext.Provider>
  )
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
    const onSuccess = vi.fn()
    render(<ReturnHarness onSuccess={onSuccess} />)

    await waitFor(() => {
      expect(retrievePaymentIntent).toHaveBeenCalledWith('pi_return_secret')
    })
    expect(handleNextAction).not.toHaveBeenCalled()
    expect(stripHistory).toHaveBeenCalled()
    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'pi_frictionless_3055', status: 'succeeded' }),
      )
    })
  })

  it('calls handleNextAction when the return PI is still requires_action', async () => {
    retrievePaymentIntent.mockResolvedValueOnce({
      paymentIntent: { id: 'pi_action', status: 'requires_action' },
    })
    handleNextAction.mockResolvedValueOnce({
      paymentIntent: { id: 'pi_action', status: 'succeeded' },
    })

    const onSuccess = vi.fn()
    render(<ReturnHarness onSuccess={onSuccess} />)

    await waitFor(() => {
      expect(handleNextAction).toHaveBeenCalledWith({ clientSecret: 'pi_return_secret' })
    })
    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalled()
    })
  })

  it('surfaces pending copy when the return PI is still processing (async methods)', async () => {
    retrievePaymentIntent.mockResolvedValueOnce({
      paymentIntent: { id: 'pi_sepa_ideal', status: 'processing' },
    })

    render(<ReturnHarness />)

    await waitFor(() => {
      expect(retrievePaymentIntent).toHaveBeenCalledWith('pi_return_secret')
    })
    expect(handleNextAction).not.toHaveBeenCalled()
    expect(reconcilePayment).not.toHaveBeenCalled()
    await waitFor(() => {
      expect(screen.getByTestId('payment-error')).toHaveTextContent(/being confirmed/i)
    })
  })
})
