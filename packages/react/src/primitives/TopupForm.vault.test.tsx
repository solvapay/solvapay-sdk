/**
 * @vitest-environment jsdom
 *
 * Vault checkout for credit top-ups: TopupForm renders CardFields on a fake
 * VGS Collect, never loads Stripe, and on submit runs grant → capture →
 * server-side confirm → backend settle (processTopupPayment) → onSuccess
 * with the credits delta.
 */
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import React from 'react'
import { createFakeCollect, type FakeCollectHandle } from '../../../test-utils/src/fake-collect'
import { TopupForm } from './TopupForm'
import { SolvaPayContext } from '../SolvaPayProvider'
import { configureCollect } from '../vault/collect'
import type { SolvaPayContextValue, SucceededPayment } from '../types'
import { enCopy } from '../i18n/en'

const loadStripe = vi.fn()
vi.mock('@stripe/stripe-js', () => ({ loadStripe: (...args: unknown[]) => loadStripe(...args) }))

vi.mock('../hooks/useBusinessDetailsAttach', () => ({
  defaultBusinessDetails: { isBusiness: false },
  useBusinessDetailsAttach: vi.fn(() => ({
    businessDetails: { isBusiness: false, customerCountry: 'SE' },
    setBusinessDetails: vi.fn(),
    fieldErrors: {},
    taxBreakdown: null,
    businessDetailsAttached: true,
    businessDetailsAttaching: false,
    businessDetailsError: null,
    requiresBusinessAttach: false,
    runAttach: vi.fn().mockResolvedValue(true),
  })),
}))

const grant = {
  token: 'vgs-collect-token',
  tenantId: 'tntr4ol0cbq',
  environment: 'sandbox' as const,
  expiresAt: Date.now() + 60_000,
  scope: { paymentIntentId: 'pi_topup_1' },
}

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
    reconcileBalanceIncrease: vi.fn(),
    reconcileAfterUsageDebit: vi.fn(),
  } as unknown as SolvaPayContextValue['balance']
}

type Harness = {
  createCaptureGrant: NonNullable<SolvaPayContextValue['createCaptureGrant']>
  confirmPayment: NonNullable<SolvaPayContextValue['confirmPayment']>
  processTopupPayment: NonNullable<SolvaPayContextValue['processTopupPayment']>
  onSuccess: (payment: SucceededPayment, extras?: { creditsAdded?: number }) => void
  onError: (error: Error) => void
}

function renderVaultTopup(overrides: Partial<Harness> = {}) {
  const h: Harness = {
    createCaptureGrant: vi.fn().mockResolvedValue(grant),
    confirmPayment: vi.fn().mockResolvedValue({
      id: 'pi_topup_1',
      processorPaymentId: 'pi_stripe_topup',
      status: 'succeeded',
    }),
    processTopupPayment: vi.fn().mockResolvedValue({ status: 'succeeded', creditsAdded: 2500 }),
    onSuccess: vi.fn(),
    onError: vi.fn(),
    ...overrides,
  }
  const ctx: SolvaPayContextValue = {
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
    processPayment: vi.fn(),
    createTopupPayment: vi.fn().mockResolvedValue({
      id: 'pi_topup_1',
      captureMode: 'vault',
      vault: { tenantId: 'tntr4ol0cbq', environment: 'sandbox' },
    }),
    processTopupPayment: h.processTopupPayment,
    createCaptureGrant: h.createCaptureGrant,
    confirmPayment: h.confirmPayment,
    cancelRenewal: vi.fn(),
    reactivateRenewal: vi.fn(),
    activatePlan: vi.fn(),
    balance: mockBalance(),
  }
  const utils = render(
    <SolvaPayContext.Provider value={ctx}>
      <TopupForm.Root
        amount={2500}
        currency="USD"
        returnUrl="https://example.test/topup"
        onSuccess={h.onSuccess}
        onError={h.onError}
      >
        <TopupForm.PaymentElement />
        <TopupForm.CardFields data-testid="card-fields" />
        <TopupForm.Error data-testid="topup-error" />
        <TopupForm.SubmitButton data-testid="submit" />
      </TopupForm.Root>
    </SolvaPayContext.Provider>,
  )
  return { ...h, ...utils }
}

describe('TopupForm — vault checkout', () => {
  let collect: FakeCollectHandle
  let restoreCollect: () => void

  beforeEach(() => {
    loadStripe.mockReset()
    collect = createFakeCollect()
    restoreCollect = configureCollect(collect.loader)
  })
  afterEach(() => restoreCollect())

  it('mounts hosted card fields on the vault, never loads Stripe, and gates submit on validity', async () => {
    renderVaultTopup()
    await waitFor(() => expect(screen.getByTestId('card-fields')).toHaveAttribute('data-state', 'ready'))
    expect(collect.forms[0].vaultId).toBe('tntr4ol0cbq')
    expect(collect.forms[0].mounted).toEqual(['card_number', 'card_exp', 'card_cvc'])
    expect(loadStripe).not.toHaveBeenCalled()
    expect(screen.queryByTestId('payment-element')).toBeNull()
    expect(screen.getByTestId('submit')).toBeDisabled()
    act(() => collect.enter())
    await waitFor(() => expect(screen.getByTestId('submit')).not.toBeDisabled())
  })

  it('submits: grant → card stamped with the payment id → confirm → settle → onSuccess with credits', async () => {
    const h = renderVaultTopup()
    await waitFor(() => expect(screen.getByTestId('card-fields')).toHaveAttribute('data-state', 'ready'))
    act(() => collect.enter())
    await waitFor(() => expect(screen.getByTestId('submit')).not.toBeDisabled())

    fireEvent.click(screen.getByTestId('submit'))

    await waitFor(() => expect(h.onSuccess).toHaveBeenCalledTimes(1))
    expect(h.createCaptureGrant).toHaveBeenCalledWith({ paymentIntentId: 'pi_topup_1' })
    expect(collect.cards[0]).toMatchObject({ auth: 'vgs-collect-token', meta: { paymentIntentId: 'pi_topup_1' } })
    expect(h.confirmPayment).toHaveBeenCalledWith({
      paymentIntentId: 'pi_topup_1',
      cardId: collect.cards[0].id,
      returnUrl: 'https://example.test/topup',
    })
    expect(h.processTopupPayment).toHaveBeenCalledWith({ paymentIntentId: 'pi_stripe_topup' })
    expect(h.onSuccess).toHaveBeenCalledWith(
      expect.objectContaining({ processorPaymentId: 'pi_stripe_topup', status: 'succeeded' }),
      { creditsAdded: 2500 },
    )
    expect(h.onError).not.toHaveBeenCalled()
  })

  it('holds onSuccess while the backend still reports processing', async () => {
    const h = renderVaultTopup({
      processTopupPayment: vi.fn().mockResolvedValue({ status: 'processing' }),
    })
    await waitFor(() => expect(screen.getByTestId('card-fields')).toHaveAttribute('data-state', 'ready'))
    act(() => collect.enter())
    fireEvent.click(screen.getByTestId('submit'))
    await waitFor(() => expect(screen.getByTestId('topup-error').textContent).toBe(enCopy.errors.paymentPending))
    expect(h.onSuccess).not.toHaveBeenCalled()
  })

  it('shows a card error and does not confirm when the vault rejects the card', async () => {
    const h = renderVaultTopup()
    await waitFor(() => expect(screen.getByTestId('card-fields')).toHaveAttribute('data-state', 'ready'))
    act(() => collect.enter())
    collect.options.failWithStatus = 422
    fireEvent.click(screen.getByTestId('submit'))
    await waitFor(() => expect(h.onError).toHaveBeenCalledTimes(1))
    expect(screen.getByTestId('topup-error').textContent).toBe(enCopy.errors.cardCaptureFailed)
    expect(h.confirmPayment).not.toHaveBeenCalled()
  })

  it('sends the payer to 3DS and resumes on return via the backend', async () => {
    const assign = vi.fn()
    const original = window.location
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...original, assign, search: '', href: 'https://example.test/' },
    })
    try {
      const h = renderVaultTopup({
        confirmPayment: vi.fn().mockResolvedValue({
          id: 'pi_topup_1',
          processorPaymentId: 'pi_stripe_topup',
          status: 'requires_action',
          redirectUrl: 'https://hooks.stripe.com/3ds/topup',
        }),
      })
      await waitFor(() => expect(screen.getByTestId('card-fields')).toHaveAttribute('data-state', 'ready'))
      act(() => collect.enter())
      fireEvent.click(screen.getByTestId('submit'))
      await waitFor(() => expect(assign).toHaveBeenCalledWith('https://hooks.stripe.com/3ds/topup'))
      expect(h.processTopupPayment).not.toHaveBeenCalled()
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, value: original })
    }

    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...original, search: '?payment_intent=pi_stripe_topup&redirect_status=succeeded', href: 'https://example.test/?payment_intent=pi_stripe_topup' },
    })
    const replaceState = vi.spyOn(window.history, 'replaceState').mockImplementation(() => {})
    try {
      const h = renderVaultTopup()
      await waitFor(() => expect(h.onSuccess).toHaveBeenCalledTimes(1))
      expect(h.processTopupPayment).toHaveBeenCalledWith({ paymentIntentId: 'pi_stripe_topup' })
      expect(h.createCaptureGrant).not.toHaveBeenCalled()
      expect(loadStripe).not.toHaveBeenCalled()
    } finally {
      replaceState.mockRestore()
      Object.defineProperty(window, 'location', { configurable: true, value: original })
    }
  })
})
