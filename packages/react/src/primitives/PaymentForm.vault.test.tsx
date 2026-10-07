/**
 * @vitest-environment jsdom
 *
 * Vault checkout (`captureMode: 'vault'`): PaymentForm renders CardFields on
 * a fake VGS Collect, and on submit runs grant → capture
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
import { TransportError } from '../transport/errors'
import { ExternalLinkProvider, type ExternalLinkOpener } from '../hooks/useExternalLink'
import { rememberPaymentReturn, takePaymentReturn } from './paymentReturn'

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

const RETURN_URL = 'https://app.example/return?solvapay_payment=pi_sp_1'
const BILLING = { email: 'ada@example.com', address: { country: 'SE' } }

function renderVaultForm(
  overrides: Partial<Harness> = {},
  ctxOverrides: Partial<SolvaPayContextValue> = {},
  options: { opener?: ExternalLinkOpener } = {},
) {
  const h: Harness = {
    createCaptureGrant: vi.fn().mockResolvedValue(grant),
    confirmPayment: vi.fn().mockResolvedValue({
      id: 'pi_sp_1',
      processorPaymentId: 'pi_rail_1',
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
      email: 'ada@example.com',
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
  const tree = (
    <SolvaPayContext.Provider value={ctx}>
      <PaymentForm.Root
        planRef="pln_paid"
        productRef="prd_paid"
        returnUrl="https://app.example/return"
        onSuccess={h.onSuccess}
        onError={h.onError}
      >
        <PaymentForm.Loading data-testid="loading" />
        <PaymentForm.CardFields data-testid="card-fields" />
        <PaymentForm.Error data-testid="payment-error" />
        <PaymentForm.Notice data-testid="payment-notice" />
        <PaymentForm.SubmitButton data-testid="submit" />
      </PaymentForm.Root>
    </SolvaPayContext.Provider>
  )
  const utils = render(
    options.opener ? (
      <ExternalLinkProvider opener={options.opener}>{tree}</ExternalLinkProvider>
    ) : (
      tree
    ),
  )
  return { ...h, ctx, ...utils }
}

const succeededPayment = {
  id: 'pi_sp_1',
  processorPaymentId: 'pi_rail_1',
  status: 'succeeded' as const,
}
const ready = () =>
  waitFor(() => expect(screen.getByTestId('card-fields')).toHaveAttribute('data-state', 'ready'))
const submit = () => screen.getByTestId('submit')
const errorText = () => screen.queryByTestId('payment-error')?.textContent ?? null
const noticeText = () => screen.queryByTestId('payment-notice')?.textContent ?? null

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
    sessionStorage.clear()
    reconcilePayment
      .mockReset()
      .mockResolvedValue({ status: 'success', result: { status: 'succeeded' } })
    collect = createFakeCollect()
    restoreCollect = configureCollect(collect.loader)
  })

  afterEach(() => {
    restoreCollect()
  })

  it('mounts hosted card fields on the vault', async () => {
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
    // The form-level Loading slot is hidden once the intent is ready.
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
    // The return URL names the payment so a 3DS return resumes it; the
    // billing details are the customer's email and the buyer address.
    expect(h.confirmPayment).toHaveBeenCalledWith({
      paymentIntentId: 'pi_sp_1',
      cardId: 'CRD_fake_1',
      returnUrl: RETURN_URL,
      billingDetails: BILLING,
    })
    expect(reconcilePayment).toHaveBeenCalledTimes(1)
    expect(reconcilePayment).toHaveBeenCalledWith({
      paymentIntentId: 'pi_rail_1',
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

  it('shows the decline copy by decline code when the confirm answers 402 payment_declined, and keeps the form submittable', async () => {
    const declined = new TransportError('Confirm payment failed (402): Payment card_declined', {
      status: 402,
      code: 'payment_declined',
      reason: 'card_declined',
      declineCode: 'insufficient_funds',
    })
    const h = renderVaultForm({
      confirmPayment: vi.fn().mockRejectedValueOnce(declined).mockResolvedValue(succeededPayment),
    })
    await fillAndArm()
    fireEvent.click(submit())
    await waitFor(() => expect(h.onError).toHaveBeenCalledTimes(1))
    expect(errorText()).toBe('Your card has insufficient funds.')
    expect(errorText()).toBe(enCopy.vaultErrors.declineCodes.insufficientFunds)
    expect(h.onError).toHaveBeenCalledWith(
      new Error(enCopy.vaultErrors.declineCodes.insufficientFunds),
    )
    expect(reconcilePayment).not.toHaveBeenCalled()
    expect(h.onSuccess).not.toHaveBeenCalled()
    await waitFor(() => expect(submit()).not.toBeDisabled())

    // The payment stays confirmable: a new grant, a new capture, a new confirm.
    fireEvent.click(submit())
    await waitFor(() => expect(h.onSuccess).toHaveBeenCalledTimes(1))
    expect(h.createCaptureGrant).toHaveBeenCalledTimes(2)
    expect(h.confirmPayment).toHaveBeenCalledTimes(2)
    expect(errorText()).toBeNull()
  })

  it('shows the keyed copy for a 409 confirm_in_progress and never the raw body', async () => {
    const h = renderVaultForm({
      confirmPayment: vi
        .fn()
        .mockRejectedValue(
          new TransportError(
            'Confirm payment failed (409): {"statusCode":409,"error":"confirm_in_progress"}',
            { status: 409, code: 'confirm_in_progress' },
          ),
        ),
    })
    await fillAndArm()
    fireEvent.click(submit())
    await waitFor(() => expect(h.onError).toHaveBeenCalledTimes(1))
    expect(errorText()).toBe(enCopy.vaultErrors.confirmInProgress)
    expect(errorText()).not.toContain('statusCode')
  })

  it('shows the processing-failed copy when the confirm reports the payment failed', async () => {
    const h = renderVaultForm({
      confirmPayment: vi
        .fn()
        .mockResolvedValue({ id: 'pi_sp_1', processorPaymentId: 'pi_rail_1', status: 'failed' }),
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

  it('reconciles a processing confirm through the backend and shows the pending notice, not an error', async () => {
    reconcilePayment.mockResolvedValue({
      status: 'pending',
      error: new Error(enCopy.errors.paymentPending),
    })
    const h = renderVaultForm({
      confirmPayment: vi.fn().mockResolvedValue({
        id: 'pi_sp_1',
        processorPaymentId: 'pi_rail_1',
        status: 'processing',
      }),
    })
    await fillAndArm()
    fireEvent.click(submit())
    await waitFor(() =>
      expect(noticeText()).toBe(
        'Your payment is being confirmed. You will be notified once it completes.',
      ),
    )
    expect(screen.getByTestId('payment-notice')).toHaveAttribute('role', 'status')
    expect(errorText()).toBeNull()
    expect(reconcilePayment).toHaveBeenCalledTimes(1)
    expect(reconcilePayment).toHaveBeenCalledWith(
      expect.objectContaining({ paymentIntentId: 'pi_rail_1', productRef: 'prd_paid' }),
    )
    expect(h.onSuccess).not.toHaveBeenCalled()
    expect(h.onError).not.toHaveBeenCalled()
    await waitFor(() => expect(submit()).not.toBeDisabled())
  })

  it('settles a processing confirm into onSuccess when the backend reports it succeeded', async () => {
    const h = renderVaultForm({
      confirmPayment: vi.fn().mockResolvedValue({
        id: 'pi_sp_1',
        processorPaymentId: 'pi_rail_1',
        status: 'processing',
      }),
    })
    await fillAndArm()
    fireEvent.click(submit())
    await waitFor(() => expect(h.onSuccess).toHaveBeenCalledTimes(1))
    expect(h.onSuccess).toHaveBeenCalledWith({
      id: 'pi_sp_1',
      processorPaymentId: 'pi_rail_1',
      status: 'processing',
    })
    expect(noticeText()).toBeNull()
    expect(errorText()).toBeNull()
    expect(h.onError).not.toHaveBeenCalled()
  })

  it('reports an unknown confirm status through the status-prefix copy and onError', async () => {
    const h = renderVaultForm({
      confirmPayment: vi.fn().mockResolvedValue({
        id: 'pi_sp_1',
        processorPaymentId: 'pi_rail_1',
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
        confirmPayment: vi.fn().mockResolvedValue({
          id: 'pi_sp_1',
          processorPaymentId: 'pi_rail_1',
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
          processorPaymentId: 'pi_rail_1',
          status: 'requires_action',
          redirectUrl: 'https://acs.bank.test/3ds/abc',
        }),
      })
      await fillAndArm()
      fireEvent.click(submit())

      await waitFor(() => expect(assign).toHaveBeenCalledTimes(1))
      expect(assign).toHaveBeenCalledWith('https://acs.bank.test/3ds/abc')
      expect(h.confirmPayment).toHaveBeenCalledWith({
        paymentIntentId: 'pi_sp_1',
        cardId: 'CRD_fake_1',
        returnUrl: RETURN_URL,
        billingDetails: BILLING,
      })
      // The payment the browser leaves for is remembered for the return.
      expect(takePaymentReturn('pi_sp_1')).toStrictEqual({
        paymentIntentId: 'pi_sp_1',
        processorPaymentId: 'pi_rail_1',
      })
      expect(reconcilePayment).not.toHaveBeenCalled()
      expect(h.onSuccess).not.toHaveBeenCalled()
      expect(h.onError).not.toHaveBeenCalled()
      expect(errorText()).toBeNull()
    } finally {
      restoreLocation()
    }
  })

  it('opens the 3DS page through the host opener, keeps the widget mounted and settles when the bank answers', async () => {
    const assign = vi.fn()
    const restoreLocation = stubLocation({ assign })
    const opener: ExternalLinkOpener = {
      canOpen: () => true,
      open: vi.fn().mockResolvedValue(true),
    }
    let releaseFirstRound: (v: unknown) => void = () => {}
    reconcilePayment
      .mockImplementationOnce(() => new Promise(r => (releaseFirstRound = r)))
      .mockResolvedValueOnce({ status: 'pending', error: new Error(enCopy.errors.paymentPending) })
      .mockResolvedValueOnce({ status: 'success', result: { status: 'succeeded' } })
    try {
      const h = renderVaultForm(
        {
          confirmPayment: vi.fn().mockResolvedValue({
            id: 'pi_sp_1',
            processorPaymentId: 'pi_rail_1',
            status: 'requires_action',
            redirectUrl: 'https://acs.bank.test/3ds/abc',
          }),
        },
        {},
        { opener },
      )
      await fillAndArm()
      fireEvent.click(submit())

      await waitFor(() => expect(opener.open).toHaveBeenCalledWith('https://acs.bank.test/3ds/abc'))
      // The iframe itself is never navigated.
      expect(assign).not.toHaveBeenCalled()
      await waitFor(() => expect(noticeText()).toBe(enCopy.errors.paymentAwaitingAuthentication))
      expect(submit()).toHaveAttribute('aria-busy', 'true')
      releaseFirstRound({ status: 'timeout', error: new Error('still at the bank') })
      await waitFor(() => expect(h.onSuccess).toHaveBeenCalledTimes(1))
      expect(reconcilePayment).toHaveBeenCalledTimes(3)
      expect(reconcilePayment).toHaveBeenNthCalledWith(
        3,
        expect.objectContaining({ paymentIntentId: 'pi_rail_1' }),
      )
      expect(h.onSuccess).toHaveBeenCalledWith({
        id: 'pi_sp_1',
        processorPaymentId: 'pi_rail_1',
        status: 'requires_action',
        redirectUrl: 'https://acs.bank.test/3ds/abc',
      })
      expect(noticeText()).toBeNull()
      expect(errorText()).toBeNull()
      expect(h.onError).not.toHaveBeenCalled()
      await waitFor(() => expect(submit()).toHaveAttribute('aria-busy', 'false'))
    } finally {
      restoreLocation()
    }
  })

  it('reports a refused host open as the authentication-unavailable error', async () => {
    const opener: ExternalLinkOpener = {
      canOpen: () => true,
      open: vi.fn().mockResolvedValue(false),
    }
    const h = renderVaultForm(
      {
        confirmPayment: vi.fn().mockResolvedValue({
          id: 'pi_sp_1',
          processorPaymentId: 'pi_rail_1',
          status: 'requires_action',
          redirectUrl: 'https://acs.bank.test/3ds/abc',
        }),
      },
      {},
      { opener },
    )
    await fillAndArm()
    fireEvent.click(submit())
    await waitFor(() => expect(h.onError).toHaveBeenCalledTimes(1))
    expect(errorText()).toBe(enCopy.errors.authenticationUnavailable)
    expect(reconcilePayment).not.toHaveBeenCalled()
  })

  it('resumes the remembered payment after a 3DS return without creating a new one', async () => {
    const assign = vi.fn()
    const restoreLocation = stubLocation({
      assign,
      search: '?solvapay_payment=pi_sp_prev&redirect_status=succeeded',
      href: 'https://app.example/?solvapay_payment=pi_sp_prev&redirect_status=succeeded',
    })
    const replaceState = vi.spyOn(window.history, 'replaceState').mockImplementation(() => {})
    rememberPaymentReturn({ paymentIntentId: 'pi_sp_prev', processorPaymentId: 'pi_rail_prev' })
    try {
      const h = renderVaultForm()
      await waitFor(() => expect(h.onSuccess).toHaveBeenCalledTimes(1))
      // The returned payment, not a new one: both ids belong to it.
      expect(h.onSuccess).toHaveBeenCalledWith({
        id: 'pi_sp_prev',
        processorPaymentId: 'pi_rail_prev',
        status: 'succeeded',
      })
      expect(h.ctx.createPayment).not.toHaveBeenCalled()
      expect(reconcilePayment).toHaveBeenCalledTimes(1)
      expect(reconcilePayment).toHaveBeenCalledWith({
        paymentIntentId: 'pi_rail_prev',
        productRef: 'prd_paid',
        planRef: 'pln_paid',
        processPayment: h.processPayment,
        refetchPurchase: h.ctx.refetchPurchase,
        copy: enCopy,
      })
      expect(replaceState).toHaveBeenCalledTimes(1)
      expect(replaceState).toHaveBeenCalledWith({}, '', '/')
      expect(takePaymentReturn('pi_sp_prev')).toBeUndefined()
      expect(h.createCaptureGrant).not.toHaveBeenCalled()
      expect(h.confirmPayment).not.toHaveBeenCalled()
      expect(collect.cards).toHaveLength(0)
      expect(assign).not.toHaveBeenCalled()
      expect(h.onError).not.toHaveBeenCalled()
      expect(errorText()).toBeNull()
      const root = document.querySelector('[data-solvapay-payment-form]') as HTMLElement
      expect(root).toHaveAttribute('data-state', 'ready')
    } finally {
      replaceState.mockRestore()
      restoreLocation()
    }
  })

  it('reports an unresolved return when no payment was remembered, and creates nothing', async () => {
    const restoreLocation = stubLocation({
      search: '?solvapay_payment=pi_sp_lost',
      href: 'https://app.example/?solvapay_payment=pi_sp_lost',
    })
    const replaceState = vi.spyOn(window.history, 'replaceState').mockImplementation(() => {})
    try {
      const h = renderVaultForm()
      await waitFor(() => expect(h.onError).toHaveBeenCalledTimes(1))
      expect(h.onError).toHaveBeenCalledWith(new Error(enCopy.errors.paymentReturnUnresolved))
      expect(errorText()).toBe(enCopy.errors.paymentReturnUnresolved)
      expect(h.ctx.createPayment).not.toHaveBeenCalled()
      expect(reconcilePayment).not.toHaveBeenCalled()
      expect(h.onSuccess).not.toHaveBeenCalled()
    } finally {
      replaceState.mockRestore()
      restoreLocation()
    }
  })
})
