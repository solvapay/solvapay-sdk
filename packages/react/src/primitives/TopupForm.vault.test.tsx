/**
 * @vitest-environment jsdom
 *
 * Vault checkout for credit top-ups: TopupForm renders CardFields on a fake
 * VGS Collect, and on submit runs grant → capture →
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
import { TransportError } from '../transport/errors'
import { ExternalLinkProvider, type ExternalLinkOpener } from '../hooks/useExternalLink'
import { rememberPaymentReturn, takePaymentReturn } from './paymentReturn'

const RETURN_URL = 'https://example.test/topup?solvapay_payment=pi_topup_1'
const BILLING = { name: 'Ada Lovelace', email: 'ada@example.com', address: { country: 'SE' } }

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

function renderVaultTopup(
  overrides: Partial<Harness> = {},
  options: { opener?: ExternalLinkOpener } = {},
) {
  const h: Harness = {
    createCaptureGrant: vi.fn().mockResolvedValue(grant),
    confirmPayment: vi.fn().mockResolvedValue({
      id: 'pi_topup_1',
      processorPaymentId: 'pi_rail_topup',
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
      email: 'ada@example.com',
      name: 'Ada Lovelace',
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
  const tree = (
    <SolvaPayContext.Provider value={ctx}>
      <TopupForm.Root
        amount={2500}
        currency="USD"
        returnUrl="https://example.test/topup"
        onSuccess={h.onSuccess}
        onError={h.onError}
      >
        <TopupForm.Loading data-testid="loading" />
        <TopupForm.CardFields data-testid="card-fields" />
        <TopupForm.Error data-testid="topup-error" />
        <TopupForm.Notice data-testid="topup-notice" />
        <TopupForm.SubmitButton data-testid="submit" />
      </TopupForm.Root>
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
  id: 'pi_topup_1',
  processorPaymentId: 'pi_rail_topup',
  status: 'succeeded' as const,
}
const ready = () =>
  waitFor(() => expect(screen.getByTestId('card-fields')).toHaveAttribute('data-state', 'ready'))
const submit = () => screen.getByTestId('submit')
const errorText = () => screen.queryByTestId('topup-error')?.textContent ?? null
const noticeText = () => screen.queryByTestId('topup-notice')?.textContent ?? null

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
    sessionStorage.clear()
    collect = createFakeCollect()
    restoreCollect = configureCollect(collect.loader)
  })
  afterEach(() => restoreCollect())

  it('mounts hosted card fields on the vault and gates submit on validity', async () => {
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
    // The return URL names the top-up so a 3DS return resumes it; the
    // billing details are the customer's name and email with the buyer address.
    expect(h.confirmPayment).toHaveBeenCalledWith({
      paymentIntentId: 'pi_topup_1',
      cardId: 'CRD_fake_1',
      returnUrl: RETURN_URL,
      billingDetails: BILLING,
    })
    expect(h.processTopupPayment).toHaveBeenCalledTimes(1)
    expect(h.processTopupPayment).toHaveBeenCalledWith({ paymentIntentId: 'pi_rail_topup' })
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

  it('holds onSuccess with the pending notice while the backend still reports processing', async () => {
    const h = renderVaultTopup({
      processTopupPayment: vi.fn().mockResolvedValue({ status: 'processing' }),
    })
    await fillAndArm()
    fireEvent.click(submit())
    await waitFor(() =>
      expect(noticeText()).toBe(
        'Your payment is being confirmed. You will be notified once it completes.',
      ),
    )
    expect(noticeText()).toBe(enCopy.errors.paymentPending)
    expect(screen.getByTestId('topup-notice')).toHaveAttribute('role', 'status')
    expect(errorText()).toBeNull()
    expect(h.confirmPayment).toHaveBeenCalledTimes(1)
    expect(h.processTopupPayment).toHaveBeenCalledWith({ paymentIntentId: 'pi_rail_topup' })
    expect(h.onSuccess).not.toHaveBeenCalled()
    expect(h.onError).not.toHaveBeenCalled()
    await waitFor(() => expect(submit()).not.toBeDisabled())
  })

  it('settles a processing confirm through the backend and fires onSuccess when the credit is booked', async () => {
    const h = renderVaultTopup({
      confirmPayment: vi.fn().mockResolvedValue({
        id: 'pi_topup_1',
        processorPaymentId: 'pi_rail_topup',
        status: 'processing',
      }),
    })
    await fillAndArm()
    fireEvent.click(submit())
    await waitFor(() => expect(h.onSuccess).toHaveBeenCalledTimes(1))
    expect(h.processTopupPayment).toHaveBeenCalledWith({ paymentIntentId: 'pi_rail_topup' })
    expect(h.onSuccess).toHaveBeenCalledWith(
      { id: 'pi_topup_1', processorPaymentId: 'pi_rail_topup', status: 'processing' },
      { creditsAdded: 2500 },
    )
    expect(h.onError).not.toHaveBeenCalled()
    expect(errorText()).toBeNull()
    expect(noticeText()).toBeNull()
    await waitFor(() => expect(submit()).not.toBeDisabled())
  })

  it('shows the pending notice, not an error, when a processing confirm is still processing at the backend', async () => {
    const h = renderVaultTopup({
      confirmPayment: vi.fn().mockResolvedValue({
        id: 'pi_topup_1',
        processorPaymentId: 'pi_rail_topup',
        status: 'processing',
      }),
      processTopupPayment: vi.fn().mockResolvedValue({ status: 'processing' }),
    })
    await fillAndArm()
    fireEvent.click(submit())
    await waitFor(() => expect(noticeText()).toBe(enCopy.errors.paymentPending))
    expect(errorText()).toBeNull()
    expect(h.onSuccess).not.toHaveBeenCalled()
    expect(h.onError).not.toHaveBeenCalled()
    await waitFor(() => expect(submit()).not.toBeDisabled())
  })

  it('shows the decline copy by decline code when the confirm answers 402 payment_declined', async () => {
    const h = renderVaultTopup({
      confirmPayment: vi.fn().mockRejectedValue(
        new TransportError('Confirm payment failed (402): Payment card_declined', {
          status: 402,
          code: 'payment_declined',
          reason: 'card_declined',
          declineCode: 'expired_card',
        }),
      ),
    })
    await fillAndArm()
    fireEvent.click(submit())
    await waitFor(() => expect(h.onError).toHaveBeenCalledTimes(1))
    expect(errorText()).toBe(enCopy.vaultErrors.declineCodes.expiredCard)
    expect(h.onError).toHaveBeenCalledWith(new Error(enCopy.vaultErrors.declineCodes.expiredCard))
    expect(h.processTopupPayment).not.toHaveBeenCalled()
    await waitFor(() => expect(submit()).not.toBeDisabled())
  })

  it('reports an unknown confirm status through the status-prefix copy and onError', async () => {
    const h = renderVaultTopup({
      confirmPayment: vi.fn().mockResolvedValue({
        id: 'pi_topup_1',
        processorPaymentId: 'pi_rail_topup',
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
        confirmPayment: vi.fn().mockResolvedValue({
          id: 'pi_topup_1',
          processorPaymentId: 'pi_rail_topup',
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
          processorPaymentId: 'pi_rail_topup',
          status: 'requires_action',
          redirectUrl: 'https://acs.bank.test/3ds/topup',
        }),
      })
      await fillAndArm()
      fireEvent.click(submit())
      await waitFor(() => expect(assign).toHaveBeenCalledTimes(1))
      expect(assign).toHaveBeenCalledWith('https://acs.bank.test/3ds/topup')
      expect(h.confirmPayment).toHaveBeenCalledWith({
        paymentIntentId: 'pi_topup_1',
        cardId: 'CRD_fake_1',
        returnUrl: RETURN_URL,
        billingDetails: BILLING,
      })
      expect(takePaymentReturn('pi_topup_1')).toStrictEqual({
        paymentIntentId: 'pi_topup_1',
        processorPaymentId: 'pi_rail_topup',
      })
      expect(h.processTopupPayment).not.toHaveBeenCalled()
      expect(h.onSuccess).not.toHaveBeenCalled()
      expect(h.onError).not.toHaveBeenCalled()
      expect(errorText()).toBeNull()
    } finally {
      restoreLocation()
    }
  })

  it('opens the 3DS page through the host opener and follows the top-up until the credit is booked', async () => {
    const assign = vi.fn()
    const restoreLocation = stubLocation({ assign })
    const opener: ExternalLinkOpener = {
      canOpen: () => true,
      open: vi.fn().mockResolvedValue(true),
    }
    let releaseFirstRound: (v: unknown) => void = () => {}
    try {
      const h = renderVaultTopup(
        {
          confirmPayment: vi.fn().mockResolvedValue({
            id: 'pi_topup_1',
            processorPaymentId: 'pi_rail_topup',
            status: 'requires_action',
            redirectUrl: 'https://acs.bank.test/3ds/topup',
          }),
          processTopupPayment: vi
            .fn()
            .mockImplementationOnce(() => new Promise(r => (releaseFirstRound = r)))
            .mockResolvedValueOnce({ status: 'processing' })
            .mockResolvedValueOnce({ status: 'succeeded', creditsAdded: 2500 }),
        },
        { opener },
      )
      await fillAndArm()
      fireEvent.click(submit())
      await waitFor(() =>
        expect(opener.open).toHaveBeenCalledWith('https://acs.bank.test/3ds/topup'),
      )
      expect(assign).not.toHaveBeenCalled()
      await waitFor(() => expect(noticeText()).toBe(enCopy.errors.paymentAwaitingAuthentication))
      releaseFirstRound({ status: 'timeout' })
      await waitFor(() => expect(h.onSuccess).toHaveBeenCalledTimes(1))
      expect(h.processTopupPayment).toHaveBeenCalledTimes(3)
      expect(h.onSuccess).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'pi_topup_1', processorPaymentId: 'pi_rail_topup' }),
        { creditsAdded: 2500 },
      )
      expect(noticeText()).toBeNull()
      expect(h.onError).not.toHaveBeenCalled()
    } finally {
      restoreLocation()
    }
  })

  it('resumes the remembered top-up after a 3DS return without creating a new one', async () => {
    const assign = vi.fn()
    const restoreLocation = stubLocation({
      assign,
      search: '?solvapay_payment=pi_topup_prev&redirect_status=succeeded',
      href: 'https://example.test/?solvapay_payment=pi_topup_prev&redirect_status=succeeded',
    })
    const replaceState = vi.spyOn(window.history, 'replaceState').mockImplementation(() => {})
    rememberPaymentReturn({ paymentIntentId: 'pi_topup_prev', processorPaymentId: 'pi_rail_prev' })
    try {
      const h = renderVaultTopup()
      await waitFor(() => expect(h.onSuccess).toHaveBeenCalledTimes(1))
      expect(h.onSuccess).toHaveBeenCalledWith(
        { id: 'pi_topup_prev', processorPaymentId: 'pi_rail_prev', status: 'succeeded' },
        { creditsAdded: 2500 },
      )
      expect(h.ctx.createTopupPayment).not.toHaveBeenCalled()
      expect(h.processTopupPayment).toHaveBeenCalledTimes(1)
      expect(h.processTopupPayment).toHaveBeenCalledWith({ paymentIntentId: 'pi_rail_prev' })
      expect(replaceState).toHaveBeenCalledTimes(1)
      expect(replaceState).toHaveBeenCalledWith({}, '', '/')
      expect(document.querySelector('[data-solvapay-topup-form]')).toHaveAttribute(
        'data-state',
        'ready',
      )
      expect(h.createCaptureGrant).not.toHaveBeenCalled()
      expect(h.confirmPayment).not.toHaveBeenCalled()
      expect(collect.cards).toHaveLength(0)
      expect(assign).not.toHaveBeenCalled()
      expect(h.onError).not.toHaveBeenCalled()
      expect(errorText()).toBeNull()
    } finally {
      replaceState.mockRestore()
      restoreLocation()
    }
  })

  it('reports an unresolved return when no top-up was remembered, and creates nothing', async () => {
    const restoreLocation = stubLocation({
      search: '?solvapay_payment=pi_topup_lost',
      href: 'https://example.test/?solvapay_payment=pi_topup_lost',
    })
    const replaceState = vi.spyOn(window.history, 'replaceState').mockImplementation(() => {})
    try {
      const h = renderVaultTopup()
      await waitFor(() => expect(h.onError).toHaveBeenCalledTimes(1))
      expect(h.onError).toHaveBeenCalledWith(new Error(enCopy.errors.paymentReturnUnresolved))
      expect(errorText()).toBe(enCopy.errors.paymentReturnUnresolved)
      expect(h.ctx.createTopupPayment).not.toHaveBeenCalled()
      expect(h.processTopupPayment).not.toHaveBeenCalled()
      expect(h.onSuccess).not.toHaveBeenCalled()
    } finally {
      replaceState.mockRestore()
      restoreLocation()
    }
  })
})
