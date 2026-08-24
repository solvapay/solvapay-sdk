/**
 * @vitest-environment jsdom
 *
 * Return-path resume for credit topups — async methods (SEPA/iDEAL) land with
 * a processing PaymentIntent and must surface pending, not success.
 */
import { render, waitFor, screen } from '@testing-library/react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import React from 'react'
import { TopupForm } from './TopupForm'
import { SolvaPayContext } from '../SolvaPayProvider'
import type { SolvaPayContextValue } from '../types'
import type { PaymentIntent } from '@stripe/stripe-js'

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
      confirmPayment: vi.fn(),
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

function mockBalance(): SolvaPayContextValue['balance'] {
  return {
    loading: false,
    credits: null,
    displayCurrency: null,
    creditsPerMinorUnit: null,
    displayExchangeRate: null,
    display: null,
    refetch: vi.fn(),
    adjustBalance: vi.fn(),
    reconcileAfterUsageDebit: vi.fn(),
  }
}

function ReturnHarness({
  onSuccess,
}: {
  onSuccess?: (intent: PaymentIntent, extras?: { creditsAdded?: number }) => void
}) {
  const processTopupPayment = vi.fn()

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
      refetchPurchase: vi.fn().mockResolvedValue(undefined),
      upsertPurchase: vi.fn(),
      createPayment: vi.fn(),
      processTopupPayment,
      createTopupPayment: vi.fn().mockResolvedValue({
        clientSecret: 'cs_test_123',
        publishableKey: 'pk_test',
      }),
      cancelRenewal: vi.fn(),
      reactivateRenewal: vi.fn(),
      activatePlan: vi.fn(),
      balance: mockBalance(),
    }),
    [processTopupPayment],
  )

  return (
    <SolvaPayContext.Provider value={ctx}>
      <TopupForm.Root
        amount={2500}
        currency="USD"
        returnUrl="https://example.test/checkout"
        onSuccess={onSuccess}
      >
        <TopupForm.PaymentElement />
        <TopupForm.Error data-testid="topup-error" />
        <TopupForm.SubmitButton data-testid="submit" />
      </TopupForm.Root>
    </SolvaPayContext.Provider>
  )
}

describe('TopupForm return-path resume', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    retrievePaymentIntent.mockResolvedValue({
      paymentIntent: { id: 'pi_async', status: 'processing' },
    })
  })

  it('surfaces pending copy when the return PI is processing (async SEPA/iDEAL)', async () => {
    const onSuccess = vi.fn()
    render(<ReturnHarness onSuccess={onSuccess} />)

    await waitFor(() => {
      expect(retrievePaymentIntent).toHaveBeenCalledWith('pi_return_secret')
    })
    expect(handleNextAction).not.toHaveBeenCalled()
    expect(onSuccess).not.toHaveBeenCalled()
    expect(stripHistory).toHaveBeenCalled()
    await waitFor(() => {
      expect(screen.getByTestId('topup-error')).toHaveTextContent(/being confirmed/i)
    })
  })
})
