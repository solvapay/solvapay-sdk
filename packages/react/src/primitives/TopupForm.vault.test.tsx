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
        <TopupForm.Loading data-testid="loading" />
        <TopupForm.PaymentElement />
        <TopupForm.CardFields data-testid="card-fields" />
        <TopupForm.Error data-testid="topup-error" />
        <TopupForm.SubmitButton data-testid="submit" />
      </TopupForm.Root>
    </SolvaPayContext.Provider>,
  )
  return { ...h, ctx, ...utils }
}

const succeededPayment = {
  id: 'pi_topup_1',
  processorPaymentId: 'pi_stripe_topup',
  status: 'succeeded' as const,
}
const ready = () =>
  waitFor(() => expect(screen.getByTestId('card-fields')).toHaveAttribute('data-state', 'ready'))
const submit = () => screen.getByTestId('submit')
const errorText = () => screen.queryByTestId('topup-error')?.textContent ?? null

let collect: FakeCollectHandle

async function fillAndArm() {
  await ready()
  act(() => collect.enter())
  await waitFor(() => expect(submit()).not.toBeDisabled())
}

function stubLocation(overrides: Partial<Location> & { assign?: ReturnType<typeof vi.fn> }) {
  const original = window.location
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...original, search: '', href: 'https://example.test/', ...overrides },
  })
  return () => Object.defineProperty(window, 'location', { configurable: true, value: original })
}

describe('TopupForm — vault checkout', () => {
  let restoreCollect: () => void

  beforeEach(() => {
    loadStripe.mockReset()
    collect = createFakeCollect()
    restoreCollect = configureCollect(collect.loader)
  })
  afterEach(() => restoreCollect())

  it('mounts hosted card fields on the vault, never loads Stripe, and gates submit on validity', async () => {
    const { ctx } = renderVaultTopup()
    await ready()
    expect(ctx.createTopupPayment).toHaveBeenCalledTimes(1)
    expect(ctx.createTopupPayment).toHaveBeenCalledWith({
      amount: 2500,
      currency: 'USD',
      autoRecharge: undefined,
    })
    expect(collect.forms).toHaveLength(1)
    expect(collect.forms[0].vaultId).toBe('tntr4ol0cbq')
    expect(collect.forms[0].env).toBe('sandbox')
    expect(collect.forms[0].mounted).toEqual(['pan', 'exp-date', 'cvc'])
    expect(loadStripe).not.toHaveBeenCalled()
    expect(screen.queryByTestId('payment-element')).toBeNull()
    expect(document.querySelector('[data-solvapay-topup-form-payment-element]')).toBeNull()
    expect(screen.queryByTestId('loading')).toBeNull()
    expect(document.querySelector('[data-solvapay-topup-form]')).toHaveAttribute(
      'data-state',
      'ready',
    )
    expect(screen.getByTestId('card-fields')).toHaveAttribute(
      'data-solvapay-topup-form-card-fields',
      '',
    )
    expect(screen.getByText('Card number')).toHaveAttribute('data-solvapay-card-field-label', '')
    expect(errorText()).toBeNull()

    expect(submit()).toBeDisabled()
    expect(submit()).toHaveAttribute('data-state', 'disabled')
    expect(submit()).toHaveAttribute('aria-disabled', 'true')
    expect(submit()).toHaveAttribute('aria-busy', 'false')
    act(() => collect.enter())
    await waitFor(() => expect(submit()).not.toBeDisabled())
    expect(submit()).toHaveAttribute('data-state', 'idle')
    expect(submit()).toHaveAttribute('aria-disabled', 'false')
    act(() => collect.clear())
    await waitFor(() => expect(submit()).toBeDisabled())
    expect(submit()).toHaveAttribute('data-state', 'disabled')
  })

  it('submits: grant → card stamped with the payment id → confirm → settle → onSuccess with credits', async () => {
    const h = renderVaultTopup()
    await fillAndArm()

    fireEvent.click(submit())
    expect(submit()).toHaveAttribute('data-state', 'processing')
    expect(submit()).toHaveAttribute('aria-busy', 'true')
    expect(submit()).toBeDisabled()
    expect(submit().textContent).toBe('Processing...')

    await waitFor(() => expect(h.onSuccess).toHaveBeenCalledTimes(1))
    expect(h.createCaptureGrant).toHaveBeenCalledTimes(1)
    expect(h.createCaptureGrant).toHaveBeenCalledWith({ paymentIntentId: 'pi_topup_1' })
    expect(collect.cards).toHaveLength(1)
    expect(collect.cards[0]).toStrictEqual({
      id: 'CRD_fake_1',
      options: { auth: 'vgs-collect-token', data: {} },
      attributes: { last4: '4242', card_brand: 'VISA', exp_month: 12, exp_year: 30 },
    })
    expect(h.confirmPayment).toHaveBeenCalledTimes(1)
    expect(h.confirmPayment).toHaveBeenCalledWith({
      paymentIntentId: 'pi_topup_1',
      cardId: 'CRD_fake_1',
      returnUrl: 'https://example.test/topup',
    })
    expect(h.processTopupPayment).toHaveBeenCalledTimes(1)
    expect(h.processTopupPayment).toHaveBeenCalledWith({ paymentIntentId: 'pi_stripe_topup' })
    expect(h.onSuccess).toHaveBeenCalledWith(succeededPayment, { creditsAdded: 2500 })
    expect(h.onError).not.toHaveBeenCalled()
    expect(errorText()).toBeNull()
    await waitFor(() => expect(submit()).toHaveAttribute('aria-busy', 'false'))
    expect(submit()).toHaveAttribute('data-state', 'idle')
  })

  it('fires onSuccess without extras when the backend settles without a credits delta', async () => {
    const h = renderVaultTopup({
      processTopupPayment: vi.fn().mockResolvedValue({ status: 'succeeded' }),
    })
    await fillAndArm()
    fireEvent.click(submit())
    await waitFor(() => expect(h.onSuccess).toHaveBeenCalledTimes(1))
    expect(h.onSuccess).toHaveBeenCalledWith(succeededPayment, undefined)
    expect(h.onError).not.toHaveBeenCalled()
  })

  it('ignores a second click while the first submit is still processing', async () => {
    let resolveConfirm: (v: unknown) => void = () => {}
    const h = renderVaultTopup({
      confirmPayment: vi.fn().mockImplementation(() => new Promise(r => (resolveConfirm = r))),
    })
    await fillAndArm()
    fireEvent.click(submit())
    fireEvent.click(submit())
    await waitFor(() => expect(h.confirmPayment).toHaveBeenCalledTimes(1))
    expect(h.createCaptureGrant).toHaveBeenCalledTimes(1)
    expect(collect.cards).toHaveLength(1)
    resolveConfirm(succeededPayment)
    await waitFor(() => expect(h.onSuccess).toHaveBeenCalledTimes(1))
    expect(h.confirmPayment).toHaveBeenCalledTimes(1)
    expect(h.processTopupPayment).toHaveBeenCalledTimes(1)
  })

  it('holds onSuccess while the backend still reports processing', async () => {
    const h = renderVaultTopup({
      processTopupPayment: vi.fn().mockResolvedValue({ status: 'processing' }),
    })
    await fillAndArm()
    fireEvent.click(submit())
    await waitFor(() =>
      expect(errorText()).toBe(
        'Your payment is being confirmed. You will be notified once it completes.',
      ),
    )
    expect(errorText()).toBe(enCopy.errors.paymentPending)
    expect(h.confirmPayment).toHaveBeenCalledTimes(1)
    expect(h.processTopupPayment).toHaveBeenCalledWith({ paymentIntentId: 'pi_stripe_topup' })
    expect(h.onSuccess).not.toHaveBeenCalled()
    expect(h.onError).not.toHaveBeenCalled()
    await waitFor(() => expect(submit()).not.toBeDisabled())
  })

  it('holds the payer with the pending copy when the confirm itself is still processing', async () => {
    const h = renderVaultTopup({
      confirmPayment: vi
        .fn()
        .mockResolvedValue({
          id: 'pi_topup_1',
          processorPaymentId: 'pi_stripe_topup',
          status: 'processing',
        }),
    })
    await fillAndArm()
    fireEvent.click(submit())
    await waitFor(() => expect(errorText()).toBe(enCopy.errors.paymentPending))
    expect(errorText()).toBe(
      'Your payment is being confirmed. You will be notified once it completes.',
    )
    expect(h.processTopupPayment).not.toHaveBeenCalled()
    expect(h.onSuccess).not.toHaveBeenCalled()
    expect(h.onError).toHaveBeenCalledTimes(1)
    expect(h.onError).toHaveBeenCalledWith(
      new Error('Your payment is being confirmed. You will be notified once it completes.'),
    )
    await waitFor(() => expect(submit()).not.toBeDisabled())
  })

  it('reports an unknown confirm status through the status-prefix copy and onError', async () => {
    const h = renderVaultTopup({
      confirmPayment: vi
        .fn()
        .mockResolvedValue({
          id: 'pi_topup_1',
          processorPaymentId: 'pi_stripe_topup',
          status: 'canceled',
        }),
    })
    await fillAndArm()
    fireEvent.click(submit())
    await waitFor(() => expect(errorText()).toBe('Payment status: canceled'))
    expect(h.processTopupPayment).not.toHaveBeenCalled()
    expect(h.onSuccess).not.toHaveBeenCalled()
    expect(h.onError).toHaveBeenCalledTimes(1)
    expect(h.onError).toHaveBeenCalledWith(new Error('Payment status: canceled'))
    await waitFor(() => expect(submit()).not.toBeDisabled())
  })

  it('fails the topup when the backend asks for a customer action without a redirect url', async () => {
    const assign = vi.fn()
    const restoreLocation = stubLocation({ assign })
    try {
      const h = renderVaultTopup({
        confirmPayment: vi
          .fn()
          .mockResolvedValue({
            id: 'pi_topup_1',
            processorPaymentId: 'pi_stripe_topup',
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
      expect(h.processTopupPayment).not.toHaveBeenCalled()
      expect(h.onSuccess).not.toHaveBeenCalled()
      await waitFor(() => expect(submit()).not.toBeDisabled())
    } finally {
      restoreLocation()
    }
  })

  it('reports a failed or cancelled settle through onError and the unexpected-error copy', async () => {
    const h = renderVaultTopup({
      processTopupPayment: vi.fn().mockResolvedValue({ status: 'failed' }),
    })
    await fillAndArm()
    fireEvent.click(submit())
    await waitFor(() => expect(h.onError).toHaveBeenCalledTimes(1))
    expect(h.onError).toHaveBeenCalledWith(new Error('Topup failed'))
    expect(errorText()).toBe('An unexpected error occurred.')
    expect(errorText()).toBe(enCopy.errors.paymentUnexpected)
    expect(h.onSuccess).not.toHaveBeenCalled()
    await waitFor(() => expect(submit()).not.toBeDisabled())
  })

  it('shows a card error and does not confirm when the vault rejects the card', async () => {
    const h = renderVaultTopup()
    await fillAndArm()
    collect.options.failWithStatus = 422
    fireEvent.click(submit())
    await waitFor(() => expect(h.onError).toHaveBeenCalledTimes(1))
    expect(h.onError).toHaveBeenCalledWith(
      new Error('We could not save your card details. Please check them and try again.'),
    )
    expect(errorText()).toBe(enCopy.errors.cardCaptureFailed)
    expect(screen.getByTestId('topup-error')).toHaveAttribute('role', 'alert')
    expect(h.createCaptureGrant).toHaveBeenCalledTimes(1)
    expect(collect.cards).toHaveLength(0)
    expect(h.confirmPayment).not.toHaveBeenCalled()
    expect(h.processTopupPayment).not.toHaveBeenCalled()
    expect(h.onSuccess).not.toHaveBeenCalled()
    await waitFor(() => expect(submit()).not.toBeDisabled())
    expect(submit()).toHaveAttribute('data-state', 'idle')
    expect(submit()).toHaveAttribute('aria-busy', 'false')
  })

  it('surfaces a grant failure verbatim and never touches the vault', async () => {
    const h = renderVaultTopup({
      createCaptureGrant: vi.fn().mockRejectedValue(new Error('Capture grant limit reached')),
    })
    await fillAndArm()
    fireEvent.click(submit())
    await waitFor(() => expect(h.onError).toHaveBeenCalledTimes(1))
    expect(h.onError).toHaveBeenCalledWith(new Error('Capture grant limit reached'))
    expect(errorText()).toBe('Capture grant limit reached')
    expect(collect.cards).toHaveLength(0)
    expect(h.confirmPayment).not.toHaveBeenCalled()
    expect(h.processTopupPayment).not.toHaveBeenCalled()
    expect(h.onSuccess).not.toHaveBeenCalled()
  })

  it('sends the payer to 3DS without settling', async () => {
    const assign = vi.fn()
    const restoreLocation = stubLocation({ assign })
    try {
      const h = renderVaultTopup({
        confirmPayment: vi.fn().mockResolvedValue({
          id: 'pi_topup_1',
          processorPaymentId: 'pi_stripe_topup',
          status: 'requires_action',
          redirectUrl: 'https://hooks.stripe.com/3ds/topup',
        }),
      })
      await fillAndArm()
      fireEvent.click(submit())
      await waitFor(() => expect(assign).toHaveBeenCalledTimes(1))
      expect(assign).toHaveBeenCalledWith('https://hooks.stripe.com/3ds/topup')
      expect(h.confirmPayment).toHaveBeenCalledWith({
        paymentIntentId: 'pi_topup_1',
        cardId: 'CRD_fake_1',
        returnUrl: 'https://example.test/topup',
      })
      expect(h.processTopupPayment).not.toHaveBeenCalled()
      expect(h.onSuccess).not.toHaveBeenCalled()
      expect(h.onError).not.toHaveBeenCalled()
      expect(errorText()).toBeNull()
    } finally {
      restoreLocation()
    }
  })

  it('resumes after a 3DS return on the payment_intent query param via the backend', async () => {
    const assign = vi.fn()
    const restoreLocation = stubLocation({
      assign,
      search: '?payment_intent=pi_stripe_topup&redirect_status=succeeded',
      href: 'https://example.test/?payment_intent=pi_stripe_topup&redirect_status=succeeded',
    })
    const replaceState = vi.spyOn(window.history, 'replaceState').mockImplementation(() => {})
    try {
      const h = renderVaultTopup()
      await waitFor(() => expect(h.onSuccess).toHaveBeenCalledTimes(1))
      expect(h.onSuccess).toHaveBeenCalledWith(
        { id: 'pi_topup_1', processorPaymentId: 'pi_stripe_topup', status: 'succeeded' },
        { creditsAdded: 2500 },
      )
      expect(h.processTopupPayment).toHaveBeenCalledTimes(1)
      expect(h.processTopupPayment).toHaveBeenCalledWith({ paymentIntentId: 'pi_stripe_topup' })
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
})
