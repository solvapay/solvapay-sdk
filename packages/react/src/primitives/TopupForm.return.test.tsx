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
import type { SolvaPayContextValue, SucceededPayment } from '../types'
import type { PaymentIntent } from '@stripe/stripe-js'
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

type HarnessSpies = {
  onSuccess: ReturnType<typeof vi.fn>
  onError: ReturnType<typeof vi.fn>
  processTopupPayment: ReturnType<typeof vi.fn>
}

function makeSpies(): HarnessSpies {
  return {
    onSuccess: vi.fn(),
    onError: vi.fn(),
    processTopupPayment: vi.fn().mockResolvedValue({ status: 'succeeded', creditsAdded: 2500 }),
  }
}

function ReturnHarness({ spies }: { spies: HarnessSpies }) {
  const { onSuccess, onError, processTopupPayment } = spies

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
        onError={onError}
      >
        <TopupForm.PaymentElement />
        <TopupForm.Error data-testid="topup-error" />
        <TopupForm.SubmitButton data-testid="submit" />
      </TopupForm.Root>
    </SolvaPayContext.Provider>
  )
}

const errorText = () => screen.queryByTestId('topup-error')?.textContent ?? null
const submit = () => screen.getByTestId('submit')

describe('TopupForm return-path resume', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    retrievePaymentIntent.mockResolvedValue({
      paymentIntent: { id: 'pi_async', status: 'processing' },
    })
  })

  it('surfaces pending copy when the return PI is processing (async SEPA/iDEAL)', async () => {
    const spies = makeSpies()
    render(<ReturnHarness spies={spies} />)

    await waitFor(() => expect(errorText()).toBe(enCopy.errors.paymentPending))
    expect(errorText()).toBe('Your payment is being confirmed. You will be notified once it completes.')
    expect(retrievePaymentIntent).toHaveBeenCalledTimes(1)
    expect(retrievePaymentIntent).toHaveBeenCalledWith('pi_return_secret')
    expect(handleNextAction).not.toHaveBeenCalled()
    expect(stripHistory).toHaveBeenCalledTimes(1)
    expect(spies.processTopupPayment).not.toHaveBeenCalled()
    expect(spies.onSuccess).not.toHaveBeenCalled()
    expect(spies.onError).not.toHaveBeenCalled()
    await waitFor(() => expect(submit()).toHaveAttribute('aria-busy', 'false'))
  })

  it('settles a succeeded return PI through the backend and reports the credits delta', async () => {
    retrievePaymentIntent.mockResolvedValueOnce({
      paymentIntent: { id: 'pi_card_ok', status: 'succeeded' },
    })
    const spies = makeSpies()
    render(<ReturnHarness spies={spies} />)

    await waitFor(() => expect(spies.onSuccess).toHaveBeenCalledTimes(1))
    expect(stripHistory).toHaveBeenCalledTimes(1)
    expect(handleNextAction).not.toHaveBeenCalled()
    expect(spies.processTopupPayment).toHaveBeenCalledTimes(1)
    expect(spies.processTopupPayment).toHaveBeenCalledWith({ paymentIntentId: 'pi_card_ok' })
    expect(spies.onSuccess).toHaveBeenCalledWith({ id: 'pi_card_ok', status: 'succeeded' }, { creditsAdded: 2500 })
    expect(spies.onError).not.toHaveBeenCalled()
    expect(errorText()).toBeNull()
    await waitFor(() => expect(submit()).toHaveAttribute('aria-busy', 'false'))
  })

  it('runs handleNextAction when the return PI still requires_action, then settles', async () => {
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
    expect(spies.processTopupPayment).toHaveBeenCalledWith({ paymentIntentId: 'pi_action' })
    expect(spies.onSuccess).toHaveBeenCalledWith({ id: 'pi_action', status: 'succeeded' }, { creditsAdded: 2500 })
    expect(errorText()).toBeNull()
  })

  it('shows the 3DS copy and does not settle when handleNextAction fails', async () => {
    retrievePaymentIntent.mockResolvedValueOnce({
      paymentIntent: { id: 'pi_action', status: 'requires_action' },
    })
    handleNextAction.mockResolvedValueOnce({ error: { message: 'authentication_failed' } })
    const spies = makeSpies()
    render(<ReturnHarness spies={spies} />)

    await waitFor(() => expect(errorText()).toBe(enCopy.errors.paymentRequires3ds))
    expect(spies.processTopupPayment).not.toHaveBeenCalled()
    expect(spies.onSuccess).not.toHaveBeenCalled()
    expect(spies.onError).not.toHaveBeenCalled()
  })

  it('shows the processing-failed copy for a terminal non-success return PI', async () => {
    retrievePaymentIntent.mockResolvedValueOnce({
      paymentIntent: { id: 'pi_canceled', status: 'canceled' },
    })
    const spies = makeSpies()
    render(<ReturnHarness spies={spies} />)
    await waitFor(() => expect(errorText()).toBe(enCopy.errors.paymentProcessingFailed))
    expect(spies.processTopupPayment).not.toHaveBeenCalled()
    expect(spies.onSuccess).not.toHaveBeenCalled()
  })

  it('shows the unexpected-error copy when the PaymentIntent cannot be retrieved', async () => {
    retrievePaymentIntent.mockResolvedValueOnce({ error: { message: 'No such payment_intent' } })
    const spies = makeSpies()
    render(<ReturnHarness spies={spies} />)
    await waitFor(() => expect(errorText()).toBe(enCopy.errors.paymentUnexpected))
    expect(stripHistory).toHaveBeenCalledTimes(1)
    expect(spies.processTopupPayment).not.toHaveBeenCalled()
    expect(spies.onSuccess).not.toHaveBeenCalled()
  })

  it('holds onSuccess with the pending copy while the backend settle still reports processing', async () => {
    retrievePaymentIntent.mockResolvedValueOnce({
      paymentIntent: { id: 'pi_card_ok', status: 'succeeded' },
    })
    const spies = makeSpies()
    spies.processTopupPayment.mockResolvedValue({ status: 'processing' })
    render(<ReturnHarness spies={spies} />)
    await waitFor(() => expect(errorText()).toBe(enCopy.errors.paymentPending))
    expect(spies.processTopupPayment).toHaveBeenCalledWith({ paymentIntentId: 'pi_card_ok' })
    expect(spies.onSuccess).not.toHaveBeenCalled()
    expect(spies.onError).not.toHaveBeenCalled()
  })

  it('reports a failed settle through onError with the unexpected-error copy', async () => {
    retrievePaymentIntent.mockResolvedValueOnce({
      paymentIntent: { id: 'pi_card_ok', status: 'succeeded' },
    })
    const spies = makeSpies()
    spies.processTopupPayment.mockResolvedValue({ status: 'cancelled' })
    render(<ReturnHarness spies={spies} />)
    await waitFor(() => expect(spies.onError).toHaveBeenCalledTimes(1))
    expect(spies.onError).toHaveBeenCalledWith(new Error('Topup cancelled'))
    expect(errorText()).toBe(enCopy.errors.paymentUnexpected)
    expect(spies.onSuccess).not.toHaveBeenCalled()
  })

  it('passes a thrown settle error through as the message', async () => {
    retrievePaymentIntent.mockResolvedValueOnce({
      paymentIntent: { id: 'pi_card_ok', status: 'succeeded' },
    })
    const spies = makeSpies()
    const boom = new Error('Failed to process topup payment: 502')
    spies.processTopupPayment.mockRejectedValue(boom)
    render(<ReturnHarness spies={spies} />)
    await waitFor(() => expect(spies.onError).toHaveBeenCalledWith(boom))
    expect(errorText()).toBe('Failed to process topup payment: 502')
    expect(spies.onSuccess).not.toHaveBeenCalled()
  })
})
