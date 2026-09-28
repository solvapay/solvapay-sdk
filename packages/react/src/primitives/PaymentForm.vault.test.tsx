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
import { enCopy } from '../i18n/en'

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

function renderVaultForm(
  overrides: Partial<Harness> = {},
  ctxOverrides: Partial<SolvaPayContextValue> = {},
) {
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
        <PaymentForm.Loading data-testid="loading" />
        <PaymentForm.PaymentElement />
        <PaymentForm.CardFields data-testid="card-fields" />
        <PaymentForm.Error data-testid="payment-error" />
        <PaymentForm.SubmitButton data-testid="submit" />
      </PaymentForm.Root>
    </SolvaPayContext.Provider>,
  )
  return { ...h, ctx, ...utils }
}

const succeededPayment = {
  id: 'pi_sp_1',
  processorPaymentId: 'pi_stripe_1',
  status: 'succeeded' as const,
}
const ready = () =>
  waitFor(() => expect(screen.getByTestId('card-fields')).toHaveAttribute('data-state', 'ready'))
const submit = () => screen.getByTestId('submit')
const errorText = () => screen.queryByTestId('payment-error')?.textContent ?? null

async function fillAndArm() {
  await ready()
  act(() => collect.enter())
  await waitFor(() => expect(submit()).not.toBeDisabled())
}

let collect: FakeCollectHandle

function stubLocation(overrides: Partial<Location> & { assign?: ReturnType<typeof vi.fn> }) {
  const original = window.location
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...original, search: '', href: 'https://app.example/', ...overrides },
  })
  return () => Object.defineProperty(window, 'location', { configurable: true, value: original })
}

describe('PaymentForm — vault checkout', () => {
  let restoreCollect: () => void

  beforeEach(() => {
    seedCaches()
    reconcilePayment
      .mockReset()
      .mockResolvedValue({ status: 'success', result: { status: 'succeeded' } })
    loadStripe.mockReset()
    collect = createFakeCollect()
    restoreCollect = configureCollect(collect.loader)
  })

  afterEach(() => {
    restoreCollect()
  })

  it('mounts hosted card fields on the vault and never loads Stripe', async () => {
    const { ctx } = renderVaultForm()

    await ready()
    expect(ctx.createPayment).toHaveBeenCalledTimes(1)
    expect(ctx.createPayment).toHaveBeenCalledWith({
      planRef: 'pln_paid',
      productRef: 'prd_paid',
      customer: undefined,
    })
    expect(collect.forms).toHaveLength(1)
    expect(collect.forms[0].vaultId).toBe('tntr4ol0cbq')
    expect(collect.forms[0].env).toBe('sandbox')
    expect(collect.forms[0].mounted).toEqual(['pan', 'exp-date', 'cvc'])
    expect(collect.forms[0].fieldOptions.pan).toMatchObject({
      name: 'pan',
      validations: ['required', 'validCardNumber'],
      autoComplete: 'cc-number',
      showCardIcon: true,
    })
    expect(loadStripe).not.toHaveBeenCalled()
    expect(screen.queryByTestId('payment-element')).toBeNull()
    expect(document.querySelector('[data-solvapay-payment-form-payment-element]')).toBeNull()
    // The form-level Loading slot is hidden in vault mode (no client secret needed).
    expect(screen.queryByTestId('loading')).toBeNull()
    const root = document.querySelector('[data-solvapay-payment-form]') as HTMLElement
    expect(root).toHaveAttribute('data-state', 'ready')
    expect(root).toHaveAttribute('data-variant', 'paid')
    expect(screen.getByTestId('card-fields')).toHaveAttribute(
      'data-solvapay-payment-form-card-fields',
      '',
    )
    expect(screen.getByText('Card number').tagName).toBe('SPAN')
    expect(screen.getByText('Expiration date')).toHaveAttribute(
      'data-solvapay-card-field-label',
      '',
    )
    expect(screen.getByText('Security code')).toHaveAttribute('data-solvapay-card-field-label', '')
    expect(errorText()).toBeNull()
  })

  it('enables submit only once every hosted field is valid', async () => {
    renderVaultForm()
    await ready()
    expect(submit()).toBeDisabled()
    expect(submit()).toHaveAttribute('data-state', 'disabled')
    expect(submit()).toHaveAttribute('aria-disabled', 'true')
    expect(submit()).toHaveAttribute('data-variant', 'paid')
    expect(submit()).toHaveAttribute('aria-busy', 'false')

    act(() => collect.enter())
    await waitFor(() => expect(submit()).not.toBeDisabled())
    expect(submit()).toHaveAttribute('data-state', 'idle')
    expect(submit()).toHaveAttribute('aria-disabled', 'false')

    act(() => collect.clear())
    await waitFor(() => expect(submit()).toBeDisabled())
    expect(submit()).toHaveAttribute('data-state', 'disabled')
  })

  it('submits: grant → card stamped with the payment id → server confirm → reconcile → onSuccess', async () => {
    const h = renderVaultForm()
    await fillAndArm()

    fireEvent.click(submit())
    // While the grant/capture/confirm chain runs the button is busy and locked.
    expect(submit()).toHaveAttribute('data-state', 'processing')
    expect(submit()).toHaveAttribute('aria-busy', 'true')
    expect(submit()).toBeDisabled()
    expect(submit().textContent).toBe('Processing...')

    await waitFor(() => expect(h.onSuccess).toHaveBeenCalledTimes(1))
    expect(h.createCaptureGrant).toHaveBeenCalledTimes(1)
    expect(h.createCaptureGrant).toHaveBeenCalledWith({ paymentIntentId: 'pi_sp_1' })
    expect(collect.cards).toHaveLength(1)
    expect(collect.cards[0]).toStrictEqual({
      id: 'CRD_fake_1',
      options: { auth: 'vgs-collect-token', data: {} },
      attributes: { last4: '4242', card_brand: 'VISA', exp_month: 12, exp_year: 30 },
    })
    expect(h.confirmPayment).toHaveBeenCalledTimes(1)
    expect(h.confirmPayment).toHaveBeenCalledWith({
      paymentIntentId: 'pi_sp_1',
      cardId: 'CRD_fake_1',
      returnUrl: 'https://app.example/return',
    })
    expect(reconcilePayment).toHaveBeenCalledTimes(1)
    expect(reconcilePayment).toHaveBeenCalledWith({
      paymentIntentId: 'pi_stripe_1',
      productRef: 'prd_paid',
      planRef: 'pln_paid',
      processPayment: h.processPayment,
      refetchPurchase: h.ctx.refetchPurchase,
      copy: enCopy,
    })
    // A reconcile result without a purchase payload falls back to a refetch.
    expect(h.ctx.refetchPurchase).toHaveBeenCalledTimes(1)
    expect(h.ctx.upsertPurchase).not.toHaveBeenCalled()
    expect(h.onSuccess).toHaveBeenCalledWith(succeededPayment)
    expect(h.onError).not.toHaveBeenCalled()
    expect(errorText()).toBeNull()
    await waitFor(() => expect(submit()).toHaveAttribute('aria-busy', 'false'))
    expect(submit()).toHaveAttribute('data-state', 'idle')
  })

  it('merges a recurring purchase from reconcile into provider state instead of refetching', async () => {
    const purchase = { purchaseRef: 'pur_1', planRef: 'pln_paid', status: 'active' }
    reconcilePayment.mockResolvedValue({
      status: 'success',
      result: { status: 'succeeded', type: 'recurring', purchase },
    })
    const h = renderVaultForm()
    await fillAndArm()
    fireEvent.click(submit())
    await waitFor(() => expect(h.onSuccess).toHaveBeenCalledTimes(1))
    expect(h.ctx.upsertPurchase).toHaveBeenCalledTimes(1)
    expect(h.ctx.upsertPurchase).toHaveBeenCalledWith(purchase)
    expect(h.ctx.refetchPurchase).not.toHaveBeenCalled()
  })

  it('ignores a second click while the first submit is still processing', async () => {
    let resolveConfirm: (v: unknown) => void = () => {}
    const h = renderVaultForm({
      confirmPayment: vi.fn().mockImplementation(() => new Promise(r => (resolveConfirm = r))),
    })
    await fillAndArm()
    fireEvent.click(submit())
    fireEvent.click(submit())
    fireEvent.click(submit())
    await waitFor(() => expect(h.confirmPayment).toHaveBeenCalledTimes(1))
    expect(h.createCaptureGrant).toHaveBeenCalledTimes(1)
    expect(collect.cards).toHaveLength(1)
    resolveConfirm(succeededPayment)
    await waitFor(() => expect(h.onSuccess).toHaveBeenCalledTimes(1))
    expect(h.confirmPayment).toHaveBeenCalledTimes(1)
  })

  it('shows a card error and does not confirm when the vault rejects the card', async () => {
    const h = renderVaultForm()
    await fillAndArm()
    collect.options.failWithStatus = 422

    fireEvent.click(submit())

    await waitFor(() => expect(h.onError).toHaveBeenCalledTimes(1))
    expect(h.onError).toHaveBeenCalledWith(
      new Error('We could not save your card details. Please check them and try again.'),
    )
    expect(errorText()).toBe(enCopy.errors.cardCaptureFailed)
    expect(screen.getByTestId('payment-error')).toHaveAttribute('role', 'alert')
    expect(h.createCaptureGrant).toHaveBeenCalledTimes(1)
    expect(collect.cards).toHaveLength(0)
    expect(h.confirmPayment).not.toHaveBeenCalled()
    expect(reconcilePayment).not.toHaveBeenCalled()
    expect(h.onSuccess).not.toHaveBeenCalled()
    await waitFor(() => expect(submit()).not.toBeDisabled())
    expect(submit()).toHaveAttribute('data-state', 'idle')
    expect(submit()).toHaveAttribute('aria-busy', 'false')

    // Fixing the card and resubmitting clears the error and goes through.
    collect.options.failWithStatus = undefined
    fireEvent.click(submit())
    await waitFor(() => expect(h.onSuccess).toHaveBeenCalledTimes(1))
    expect(errorText()).toBeNull()
    expect(h.createCaptureGrant).toHaveBeenCalledTimes(2)
    expect(h.confirmPayment).toHaveBeenCalledTimes(1)
    expect(h.onError).toHaveBeenCalledTimes(1)
  })

  it('surfaces a grant failure verbatim and never touches the vault', async () => {
    const h = renderVaultForm({
      createCaptureGrant: vi.fn().mockRejectedValue(new Error('Capture grant limit reached')),
    })
    await fillAndArm()
    fireEvent.click(submit())
    await waitFor(() => expect(h.onError).toHaveBeenCalledTimes(1))
    expect(h.onError).toHaveBeenCalledWith(new Error('Capture grant limit reached'))
    expect(errorText()).toBe('Capture grant limit reached')
    expect(collect.cards).toHaveLength(0)
    expect(h.confirmPayment).not.toHaveBeenCalled()
    expect(reconcilePayment).not.toHaveBeenCalled()
    expect(h.onSuccess).not.toHaveBeenCalled()
    await waitFor(() => expect(submit()).not.toBeDisabled())
  })

  it('shows the processing-failed copy when the backend declines the confirmed payment', async () => {
    const h = renderVaultForm({
      confirmPayment: vi
        .fn()
        .mockResolvedValue({ id: 'pi_sp_1', processorPaymentId: 'pi_stripe_1', status: 'failed' }),
    })
    await fillAndArm()
    fireEvent.click(submit())
    await waitFor(() => expect(h.onError).toHaveBeenCalledTimes(1))
    expect(h.onError).toHaveBeenCalledWith(new Error(enCopy.errors.paymentProcessingFailed))
    expect(errorText()).toBe('Payment processing failed. Please try again or contact support.')
    expect(reconcilePayment).not.toHaveBeenCalled()
    expect(h.onSuccess).not.toHaveBeenCalled()
    await waitFor(() => expect(submit()).not.toBeDisabled())
  })

  it('holds the payer with the pending copy while the backend still reports processing', async () => {
    const h = renderVaultForm({
      confirmPayment: vi
        .fn()
        .mockResolvedValue({
          id: 'pi_sp_1',
          processorPaymentId: 'pi_stripe_1',
          status: 'processing',
        }),
    })
    await fillAndArm()
    fireEvent.click(submit())
    await waitFor(() =>
      expect(errorText()).toBe(
        'Your payment is being confirmed. You will be notified once it completes.',
      ),
    )
    expect(errorText()).toBe(enCopy.errors.paymentPending)
    expect(h.onSuccess).not.toHaveBeenCalled()
    expect(h.onError).toHaveBeenCalledTimes(1)
    expect(h.onError).toHaveBeenCalledWith(
      new Error('Your payment is being confirmed. You will be notified once it completes.'),
    )
    expect(reconcilePayment).not.toHaveBeenCalled()
    await waitFor(() => expect(submit()).not.toBeDisabled())
  })

  it('reports an unknown confirm status through the status-prefix copy and onError', async () => {
    const h = renderVaultForm({
      confirmPayment: vi
        .fn()
        .mockResolvedValue({
          id: 'pi_sp_1',
          processorPaymentId: 'pi_stripe_1',
          status: 'canceled',
        }),
    })
    await fillAndArm()
    fireEvent.click(submit())
    await waitFor(() => expect(errorText()).toBe('Payment status: canceled'))
    expect(h.onSuccess).not.toHaveBeenCalled()
    expect(h.onError).toHaveBeenCalledTimes(1)
    expect(h.onError).toHaveBeenCalledWith(new Error('Payment status: canceled'))
    expect(reconcilePayment).not.toHaveBeenCalled()
    await waitFor(() => expect(submit()).not.toBeDisabled())
  })

  it('fails the form when the backend asks for a customer action without a redirect url', async () => {
    const assign = vi.fn()
    const restoreLocation = stubLocation({ assign })
    try {
      const h = renderVaultForm({
        confirmPayment: vi
          .fn()
          .mockResolvedValue({
            id: 'pi_sp_1',
            processorPaymentId: 'pi_stripe_1',
            status: 'requires_action',
          }),
      })
      await fillAndArm()
      fireEvent.click(submit())
      await waitFor(() => expect(h.onError).toHaveBeenCalledTimes(1))
      expect(h.onError).toHaveBeenCalledWith(new Error(enCopy.errors.authenticationUnavailable))
      expect(errorText()).toBe(
        'Your bank asked for additional authentication, but no authentication page was provided. Please try another card or contact support.',
      )
      expect(assign).not.toHaveBeenCalled()
      expect(reconcilePayment).not.toHaveBeenCalled()
      expect(h.onSuccess).not.toHaveBeenCalled()
      await waitFor(() => expect(submit()).not.toBeDisabled())
    } finally {
      restoreLocation()
    }
  })

  it('reports a failed reconcile through onError with the processing-failed copy', async () => {
    const reconcileError = new Error('process-payment 500')
    reconcilePayment.mockResolvedValue({ status: 'error', error: reconcileError })
    const h = renderVaultForm()
    await fillAndArm()
    fireEvent.click(submit())
    await waitFor(() => expect(h.onError).toHaveBeenCalledTimes(1))
    expect(h.onError).toHaveBeenCalledWith(reconcileError)
    expect(errorText()).toBe(enCopy.errors.paymentProcessingFailed)
    expect(h.confirmPayment).toHaveBeenCalledTimes(1)
    expect(h.onSuccess).not.toHaveBeenCalled()

    reconcilePayment.mockResolvedValue({
      status: 'timeout',
      error: new Error('Timed out waiting for webhook'),
    })
    fireEvent.click(submit())
    await waitFor(() => expect(h.onError).toHaveBeenCalledTimes(2))
    expect(errorText()).toBe('Timed out waiting for webhook')
  })

  it('sends the payer to the 3DS redirect when the backend asks for a customer action', async () => {
    const assign = vi.fn()
    const restoreLocation = stubLocation({ assign })
    try {
      const h = renderVaultForm({
        confirmPayment: vi.fn().mockResolvedValue({
          id: 'pi_sp_1',
          processorPaymentId: 'pi_stripe_1',
          status: 'requires_action',
          redirectUrl: 'https://hooks.stripe.com/3ds/abc',
        }),
      })
      await fillAndArm()
      fireEvent.click(submit())

      await waitFor(() => expect(assign).toHaveBeenCalledTimes(1))
      expect(assign).toHaveBeenCalledWith('https://hooks.stripe.com/3ds/abc')
      expect(h.confirmPayment).toHaveBeenCalledWith({
        paymentIntentId: 'pi_sp_1',
        cardId: 'CRD_fake_1',
        returnUrl: 'https://app.example/return',
      })
      expect(reconcilePayment).not.toHaveBeenCalled()
      expect(h.onSuccess).not.toHaveBeenCalled()
      expect(h.onError).not.toHaveBeenCalled()
      expect(errorText()).toBeNull()
    } finally {
      restoreLocation()
    }
  })

  it('resumes after a 3DS return on the payment_intent query param without Stripe.js', async () => {
    const assign = vi.fn()
    const restoreLocation = stubLocation({
      assign,
      search: '?payment_intent=pi_stripe_1&redirect_status=succeeded',
      href: 'https://app.example/?payment_intent=pi_stripe_1&redirect_status=succeeded',
    })
    const replaceState = vi.spyOn(window.history, 'replaceState').mockImplementation(() => {})
    try {
      const h = renderVaultForm()
      await waitFor(() => expect(h.onSuccess).toHaveBeenCalledTimes(1))
      expect(h.onSuccess).toHaveBeenCalledWith({
        id: 'pi_sp_1',
        processorPaymentId: 'pi_stripe_1',
        status: 'succeeded',
      })
      expect(reconcilePayment).toHaveBeenCalledTimes(1)
      expect(reconcilePayment).toHaveBeenCalledWith({
        paymentIntentId: 'pi_stripe_1',
        productRef: 'prd_paid',
        planRef: 'pln_paid',
        processPayment: h.processPayment,
        refetchPurchase: h.ctx.refetchPurchase,
        copy: enCopy,
      })
      expect(replaceState).toHaveBeenCalledTimes(1)
      expect(replaceState).toHaveBeenCalledWith({}, '', '/')
      expect(h.createCaptureGrant).not.toHaveBeenCalled()
      expect(h.confirmPayment).not.toHaveBeenCalled()
      expect(collect.cards).toHaveLength(0)
      expect(assign).not.toHaveBeenCalled()
      expect(loadStripe).not.toHaveBeenCalled()
      expect(h.onError).not.toHaveBeenCalled()
      expect(errorText()).toBeNull()
    } finally {
      replaceState.mockRestore()
      restoreLocation()
    }
  })

  it('keeps the submit disabled when the transport has no vault methods', async () => {
    const h = renderVaultForm({}, { createCaptureGrant: undefined, confirmPayment: undefined })
    await ready()
    act(() => collect.enter())
    await new Promise(r => setTimeout(r, 0))
    expect(submit()).toBeDisabled()
    expect(submit()).toHaveAttribute('data-state', 'disabled')
    fireEvent.click(submit())
    await new Promise(r => setTimeout(r, 0))
    expect(collect.cards).toHaveLength(0)
    expect(h.onError).not.toHaveBeenCalled()
    expect(errorText()).toBeNull()
  })
})
