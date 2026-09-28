/**
 * @vitest-environment jsdom
 *
 * Vault checkout (`captureMode: 'vault'`): PaymentForm renders CardFields on
 * a fake VGS Collect, never loads Stripe, and on submit runs grant → capture
 * (stamped with the payment id) → server-side confirm → reconcile.
 */
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import React from 'react'
import { createFakeCollect, type FakeCollectHandle } from '../../../test-utils/src/fake-collect'
import { PaymentForm } from './PaymentForm'
import { SolvaPayContext } from '../SolvaPayProvider'
import { configureCollect } from '../vault/collect'
import { plansCache } from '../hooks/usePlans'
import { productCache } from '../hooks/useProduct'
import { merchantCache } from '../hooks/useMerchant'
import type { Plan, SolvaPayContextValue, SucceededPayment } from '../types'
import { mockBalanceStatus } from '../test-helpers/mockBalanceStatus'

const loadStripe = vi.fn()
vi.mock('@stripe/stripe-js', () => ({ loadStripe: (...args: unknown[]) => loadStripe(...args) }))

const reconcilePayment = vi.fn()
vi.mock('../utils/processPaymentResult', () => ({
  reconcilePayment: (...args: unknown[]) => reconcilePayment(...args),
}))

// The buyer-address gate is exercised by PaymentForm.businessDetails.test;
// here it is satisfied so the card step alone decides `canSubmit`.
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

const paidPlan: Plan = {
  reference: 'pln_paid',
  name: 'Pro',
  price: 1999,
  currency: 'usd',
  type: 'recurring',
  interval: 'month',
  requiresPayment: true,
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

const grant = {
  token: 'vgs-collect-token',
  tenantId: 'tntr4ol0cbq',
  environment: 'sandbox' as const,
  expiresAt: Date.now() + 60_000,
  scope: { paymentIntentId: 'pi_sp_1' },
}

type Harness = {
  createCaptureGrant: NonNullable<SolvaPayContextValue['createCaptureGrant']>
  confirmPayment: NonNullable<SolvaPayContextValue['confirmPayment']>
  processPayment: SolvaPayContextValue['processPayment']
  onSuccess: (payment: SucceededPayment) => void
  onError: (error: Error) => void
}

function renderVaultForm(overrides: Partial<Harness> = {}, ctxOverrides: Partial<SolvaPayContextValue> = {}) {
  const h: Harness = {
    createCaptureGrant: vi.fn().mockResolvedValue(grant),
    confirmPayment: vi.fn().mockResolvedValue({
      id: 'pi_sp_1',
      processorPaymentId: 'pi_stripe_1',
      status: 'succeeded',
    }),
    processPayment: vi.fn(),
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
    createPayment: vi.fn().mockResolvedValue({
      id: 'pi_sp_1',
      captureMode: 'vault',
      vault: { tenantId: 'tntr4ol0cbq', environment: 'sandbox' },
      customerRef: 'cus_1',
    }),
    processPayment: h.processPayment,
    createTopupPayment: vi.fn(),
    createCaptureGrant: h.createCaptureGrant,
    confirmPayment: h.confirmPayment,
    cancelRenewal: vi.fn(),
    reactivateRenewal: vi.fn(),
    activatePlan: vi.fn(),
    balance: mockBalanceStatus(),
    ...ctxOverrides,
  }
  const utils = render(
    <SolvaPayContext.Provider value={ctx}>
      <PaymentForm.Root
        planRef="pln_paid"
        productRef="prd_paid"
        returnUrl="https://app.example/return"
        onSuccess={h.onSuccess}
        onError={h.onError}
      >
        <PaymentForm.PaymentElement />
        <PaymentForm.CardFields data-testid="card-fields" />
        <PaymentForm.Error data-testid="payment-error" />
        <PaymentForm.SubmitButton data-testid="submit" />
      </PaymentForm.Root>
    </SolvaPayContext.Provider>,
  )
  return { ...h, ...utils }
}

describe('PaymentForm — vault checkout', () => {
  let collect: FakeCollectHandle
  let restoreCollect: () => void

  beforeEach(() => {
    seedCaches()
    reconcilePayment.mockReset().mockResolvedValue({ status: 'success', result: { status: 'succeeded' } })
    loadStripe.mockReset()
    collect = createFakeCollect()
    restoreCollect = configureCollect(collect.loader)
  })

  afterEach(() => {
    restoreCollect()
  })

  it('mounts hosted card fields on the vault and never loads Stripe', async () => {
    renderVaultForm()

    await waitFor(() => expect(screen.getByTestId('card-fields')).toHaveAttribute('data-state', 'ready'))
    expect(collect.forms).toHaveLength(1)
    expect(collect.forms[0].vaultId).toBe('tntr4ol0cbq')
    expect(collect.forms[0].env).toBe('sandbox')
    expect(collect.forms[0].mounted).toEqual(['card_number', 'card_exp', 'card_cvc'])
    expect(loadStripe).not.toHaveBeenCalled()
    expect(screen.queryByTestId('payment-element')).toBeNull()
    expect(screen.getByText('Card number')).toBeInTheDocument()
    expect(screen.getByText('Expiration date')).toBeInTheDocument()
    expect(screen.getByText('Security code')).toBeInTheDocument()
  })

  it('enables submit only once every hosted field is valid', async () => {
    renderVaultForm()
    await waitFor(() => expect(screen.getByTestId('card-fields')).toHaveAttribute('data-state', 'ready'))
    expect(screen.getByTestId('submit')).toBeDisabled()

    act(() => collect.enter())
    await waitFor(() => expect(screen.getByTestId('submit')).not.toBeDisabled())

    act(() => collect.clear())
    await waitFor(() => expect(screen.getByTestId('submit')).toBeDisabled())
  })

  it('submits: grant → card stamped with the payment id → server confirm → reconcile → onSuccess', async () => {
    const h = renderVaultForm()
    await waitFor(() => expect(screen.getByTestId('card-fields')).toHaveAttribute('data-state', 'ready'))
    act(() => collect.enter())
    await waitFor(() => expect(screen.getByTestId('submit')).not.toBeDisabled())

    fireEvent.click(screen.getByTestId('submit'))

    await waitFor(() => expect(h.onSuccess).toHaveBeenCalledTimes(1))
    expect(h.createCaptureGrant).toHaveBeenCalledWith({ paymentIntentId: 'pi_sp_1' })
    expect(collect.cards).toHaveLength(1)
    expect(collect.cards[0].auth).toBe('vgs-collect-token')
    expect(collect.cards[0].meta).toEqual({ paymentIntentId: 'pi_sp_1' })
    expect(h.confirmPayment).toHaveBeenCalledWith({
      paymentIntentId: 'pi_sp_1',
      cardId: collect.cards[0].id,
      returnUrl: 'https://app.example/return',
    })
    expect(reconcilePayment).toHaveBeenCalledWith(
      expect.objectContaining({ paymentIntentId: 'pi_stripe_1', productRef: 'prd_paid' }),
    )
    expect(h.onSuccess).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'pi_sp_1', processorPaymentId: 'pi_stripe_1', status: 'succeeded' }),
    )
    expect(h.onError).not.toHaveBeenCalled()
  })

  it('shows a card error and does not confirm when the vault rejects the card', async () => {
    const h = renderVaultForm()
    await waitFor(() => expect(screen.getByTestId('card-fields')).toHaveAttribute('data-state', 'ready'))
    act(() => collect.enter())
    collect.options.failWithStatus = 422

    fireEvent.click(screen.getByTestId('submit'))

    await waitFor(() => expect(h.onError).toHaveBeenCalledTimes(1))
    expect(screen.getByTestId('payment-error').textContent).toMatch(/could not save your card/i)
    expect(h.confirmPayment).not.toHaveBeenCalled()
    expect(screen.getByTestId('submit')).not.toBeDisabled()
  })

  it('sends the payer to the 3DS redirect when the backend asks for a customer action', async () => {
    const assign = vi.fn()
    const original = window.location
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...original, assign, search: '', href: 'https://app.example/' },
    })
    try {
      const h = renderVaultForm({
        confirmPayment: vi.fn().mockResolvedValue({
          id: 'pi_sp_1',
          processorPaymentId: 'pi_stripe_1',
          status: 'requires_action',
          redirectUrl: 'https://hooks.stripe.com/3ds/abc',
        }),
      })
      await waitFor(() => expect(screen.getByTestId('card-fields')).toHaveAttribute('data-state', 'ready'))
      act(() => collect.enter())
      fireEvent.click(screen.getByTestId('submit'))

      await waitFor(() => expect(assign).toHaveBeenCalledWith('https://hooks.stripe.com/3ds/abc'))
      expect(reconcilePayment).not.toHaveBeenCalled()
      expect(h.onSuccess).not.toHaveBeenCalled()
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, value: original })
    }
  })

  it('resumes after a 3DS return on the payment_intent query param without Stripe.js', async () => {
    const original = window.location
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...original, search: '?payment_intent=pi_stripe_1&redirect_status=succeeded', href: 'https://app.example/?payment_intent=pi_stripe_1' },
    })
    const replaceState = vi.spyOn(window.history, 'replaceState').mockImplementation(() => {})
    try {
      const h = renderVaultForm()
      await waitFor(() => expect(h.onSuccess).toHaveBeenCalledTimes(1))
      expect(reconcilePayment).toHaveBeenCalledWith(expect.objectContaining({ paymentIntentId: 'pi_stripe_1' }))
      expect(h.createCaptureGrant).not.toHaveBeenCalled()
      expect(loadStripe).not.toHaveBeenCalled()
    } finally {
      replaceState.mockRestore()
      Object.defineProperty(window, 'location', { configurable: true, value: original })
    }
  })

  it('keeps the submit disabled when the transport has no vault methods', async () => {
    renderVaultForm({}, { createCaptureGrant: undefined, confirmPayment: undefined })
    await waitFor(() => expect(screen.getByTestId('card-fields')).toHaveAttribute('data-state', 'ready'))
    act(() => collect.enter())
    await new Promise(r => setTimeout(r, 0))
    expect(screen.getByTestId('submit')).toBeDisabled()
  })
})
