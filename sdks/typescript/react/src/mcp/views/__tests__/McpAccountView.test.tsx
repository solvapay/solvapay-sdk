import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { McpDisplayModeProvider } from '../../hooks/useDisplayMode'
import { McpAccountView } from '../McpAccountView'
import { SolvaPayContext } from '../../../SolvaPayProvider'
import { merchantCache } from '../../../hooks/useMerchant'
import { limitsCache } from '../../../hooks/useLimits'
import { historyCache } from '../../../hooks/useHistory'
import { paymentMethodCache } from '../../../hooks/usePaymentMethod'
import {
  autoRechargeCache,
  autoRechargeCacheKeyFor,
  writeAutoRechargeCache,
} from '../../../hooks/autoRechargeCache'
import { seedUsageSnapshot } from '../../../hooks/useUsage'
import type { TransportLimitsResult } from '../../../transport/types'
import { createTransportCacheKey } from '../../../transport/cache-key'
import type { AutoRechargeConfig, PaymentMethodInfo } from '@solvapay/server'
import type {
  SolvaPayContextValue,
  SolvaPayConfig,
  PurchaseInfo,
  PurchaseStatus,
  Merchant,
} from '../../../types'
import type { PlanLike } from '../../plan-actions'
import { mockBalanceStatus } from '../../../test-helpers/mockBalanceStatus'

function makeTransport(
  overrides: Partial<NonNullable<SolvaPayConfig['transport']>> = {},
): NonNullable<SolvaPayConfig['transport']> {
  return {
    checkPurchase: vi.fn(),
    createPayment: vi.fn(),
    processPayment: vi.fn(),
    createTopupPayment: vi.fn(),
    getBalance: vi.fn(),
    cancelRenewal: vi.fn(),
    reactivateRenewal: vi.fn(),
    activatePlan: vi.fn(),
    createCheckoutSession: vi.fn(),
    createCustomerSession: vi.fn().mockResolvedValue({ customerUrl: 'https://portal.test' }),
    getMerchant: vi.fn(),
    getProduct: vi.fn(),
    listPlans: vi.fn(),
    getPaymentMethod: vi.fn().mockResolvedValue({ kind: 'none' }),
    ...overrides,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
}

function buildCtx(
  overrides: Partial<Omit<SolvaPayContextValue, 'purchase'>> & {
    purchase?: Partial<PurchaseStatus>
  } = {},
  purchases: PurchaseInfo[] = [],
  credits: number | null = null,
): SolvaPayContextValue {
  const paid = purchases.find(p => (p.amount ?? 0) > 0) ?? null
  // activePurchase is the primary plan purchase (paid or $0), not "amount > 0".
  const active = purchases[0] ?? null
  const { purchase: purchaseOverride, ...rest } = overrides
  return {
    purchase: {
      loading: false,
      isRefetching: false,
      error: null,
      purchases,
      hasProduct: () => purchases.length > 0,
      activePurchase: active,
      hasPaidPurchase: !!paid,
      activePaidPurchase: paid,
      balanceTransactions: [],
      customerRef: 'cus_abc',
      ...purchaseOverride,
    },
    customerRef: 'cus_abc',
    refetchPurchase: vi.fn(),
    upsertPurchase: vi.fn(),
    createPayment: vi.fn(),
    createTopupPayment: vi.fn(),
    cancelRenewal: vi.fn(),
    reactivateRenewal: vi.fn(),
    activatePlan: vi.fn(),
    balance: mockBalanceStatus({ credits }),
    _config: { transport: makeTransport() },
    ...rest,
  }
}

function actionRow(name: string | RegExp): HTMLElement {
  const titles = screen
    .getAllByText(name)
    .filter(node => node.classList.contains('solvapay-mcp-plan-action-row-title'))
  const row = titles[0]?.closest('.solvapay-mcp-plan-action-row')
  if (!(row instanceof HTMLElement)) {
    throw new Error(`No ladder action row for ${String(name)}`)
  }
  return row
}

function renderAccount(
  ctx: SolvaPayContextValue,
  props: React.ComponentProps<typeof McpAccountView> = {},
  displayMode: 'inline' | 'fullscreen' = 'inline',
) {
  return render(
    <SolvaPayContext.Provider value={ctx}>
      <McpDisplayModeProvider
        value={{
          displayMode,
          availableDisplayModes: ['inline', 'fullscreen'],
          hostedRail: displayMode === 'fullscreen' ? 'hosted' : 'inline',
        }}
      >
        <McpAccountView {...props} />
      </McpDisplayModeProvider>
    </SolvaPayContext.Provider>,
  )
}

const cycle = (interval = 'month') => ({ kind: 'billingCycle' as const, interval })
const flat = (amountMinor: number, currency = 'usd') => ({
  kind: 'charge' as const,
  per: 'flat' as const,
  amountMinor,
  currency,
})
const perUnit = (amountMinor: number, meter = 'requests') => ({
  kind: 'charge' as const,
  per: 'unit' as const,
  amountMinor,
  currency: 'usd',
  meter,
})

const limit = (cap: number, meter = 'requests') => ({
  kind: 'limit' as const,
  cap,
  meter,
})

const catalogPlans: PlanLike[] = [
  {
    reference: 'pln_free',
    name: 'Free',
    requiresPayment: false,
    price: 0,
    options: [cycle(), limit(3)],
  },
  {
    reference: 'pln_payg',
    name: 'Pay as you go',
    requiresPayment: true,
    price: 0,
    options: [perUnit(2)],
  },
  {
    reference: 'pln_monthly',
    name: 'Monthly',
    requiresPayment: true,
    price: 1999,
    options: [cycle(), flat(1999)],
  },
  {
    reference: 'pln_starter',
    name: 'Starter',
    requiresPayment: true,
    price: 3000,
    currency: 'usd',
    options: [cycle(), flat(3000), limit(10000)],
  },
  {
    reference: 'pln_pro',
    name: 'Pro',
    requiresPayment: true,
    price: 9000,
    currency: 'usd',
    options: [flat(9000)],
  },
]

const paidPurchase: PurchaseInfo = {
  reference: 'pur_abc',
  customerRef: 'cus_abc',
  productName: 'Widget API',
  status: 'active',
  startDate: '2026-01-01T00:00:00Z',
  createdAt: '2026-01-01T00:00:00Z',
  amount: 1999,
  currency: 'USD',
  isRecurring: true,
  planRef: 'pln_monthly',
  planSnapshot: { reference: 'pln_monthly', currency: 'USD', price: 1999, isMetered: false },
}

const freePurchase: PurchaseInfo = {
  reference: 'pur_free',
  customerRef: 'cus_abc',
  productName: 'Widget API',
  productRef: 'prd_widget',
  status: 'active',
  startDate: '2026-09-01T00:00:00Z',
  createdAt: '2026-09-01T00:00:00Z',
  amount: 0,
  currency: 'USD',
  isRecurring: true,
  planRef: 'pln_free',
  planSnapshot: {
    reference: 'pln_free',
    name: 'Free',
    currency: 'USD',
    price: 0,
    isMetered: true,
  },
  usage: { used: 2, overageCost: 0, overageUnits: 0, periodEnd: '2026-10-01T00:00:00Z' },
}

const starterPurchase: PurchaseInfo = {
  reference: 'pur_starter',
  customerRef: 'cus_abc',
  productName: 'Widget API',
  productRef: 'prd_widget',
  status: 'active',
  startDate: '2026-08-12T00:00:00Z',
  createdAt: '2026-08-12T00:00:00Z',
  amount: 3000,
  currency: 'USD',
  isRecurring: true,
  planRef: 'pln_starter',
  planSnapshot: {
    reference: 'pln_starter',
    name: 'Starter',
    currency: 'USD',
    price: 3000,
    isMetered: true,
  },
  usage: { used: 6200, overageCost: 0, overageUnits: 0, periodEnd: '2026-09-12T00:00:00Z' },
}

const unlimitedPurchase: PurchaseInfo = {
  reference: 'pur_pro',
  customerRef: 'cus_abc',
  productName: 'Widget API',
  productRef: 'prd_widget',
  status: 'active',
  startDate: '2026-09-01T00:00:00Z',
  createdAt: '2026-09-01T00:00:00Z',
  amount: 9000,
  currency: 'USD',
  isRecurring: false,
  planRef: 'pln_pro',
  planSnapshot: {
    reference: 'pln_pro',
    name: 'Pro',
    currency: 'USD',
    price: 9000,
    isMetered: false,
  },
}

function seedLimits(partial: Partial<TransportLimitsResult> & { remaining: number }): void {
  limitsCache.set('cus_abc:prd_widget:requests', {
    data: {
      withinLimits: true,
      meterName: 'requests',
      activationRequired: false,
      throttled: undefined,
      overage: undefined,
      needsTopUp: undefined,
      needsUpgrade: undefined,
      upgraded: undefined,
      ...partial,
    },
    timestamp: Date.now(),
    promise: null,
  })
}

const paygPurchase: PurchaseInfo = {
  reference: 'pur_payg',
  customerRef: 'cus_abc',
  productName: 'Widget API',
  status: 'active',
  startDate: '2026-01-01T00:00:00Z',
  createdAt: '2026-01-01T00:00:00Z',
  amount: 0,
  currency: 'USD',
  isRecurring: false,
  productRef: 'prd_widget',
  planRef: 'pln_payg',
  planSnapshot: {
    reference: 'pln_payg',
    name: 'Pay as you go',
    currency: 'USD',
    price: 0,
    isMetered: true,
  },
}

function seedMerchant(merchant: Merchant): SolvaPayConfig {
  const config: SolvaPayConfig = { transport: makeTransport() }
  const key = createTransportCacheKey(config, '/api/merchant')
  merchantCache.set(key, { merchant, promise: null, timestamp: Date.now() })
  return config
}

const reusableCard: PaymentMethodInfo = {
  kind: 'card',
  brand: 'visa',
  last4: '4242',
  expMonth: 12,
  expYear: 2030,
  reusable: true,
}

const nonReusableCard: PaymentMethodInfo = {
  ...reusableCard,
  reusable: false,
}

const enabledAutoRecharge: AutoRechargeConfig = {
  enabled: true,
  trigger: { type: 'balance', thresholdAmountMinor: 500 },
  topup: { mode: 'fixed', amountMinor: 5000, currency: 'USD' },
  fundingSourceType: 'saved_card',
  paymentMethodId: 'pm_123',
  status: 'active',
  failureCount: 0,
  monthlySpendMinor: 0,
  updatedAt: '2026-01-01T00:00:00.000Z',
}

function seedPaymentMethod(config: SolvaPayConfig, paymentMethod: PaymentMethodInfo): void {
  const key = createTransportCacheKey(config, config.api?.getPaymentMethod || '/api/payment-method')
  paymentMethodCache.set(key, { paymentMethod, promise: null, timestamp: Date.now() })
}

function seedAutoRechargeOn(config: SolvaPayConfig): void {
  writeAutoRechargeCache(autoRechargeCacheKeyFor(config), {
    config: enabledAutoRecharge,
    promise: null,
    timestamp: Date.now(),
  })
}

describe('McpAccountView', () => {
  beforeEach(() => {
    merchantCache.clear()
    limitsCache.clear()
    historyCache.clear()
    paymentMethodCache.clear()
    autoRechargeCache.clear()
    seedUsageSnapshot(null)
  })

  it('does not render Seller or Your account cards', () => {
    const config = seedMerchant({ displayName: 'Acme', legalName: 'Acme Inc.' })
    const ctx = buildCtx({ _config: config }, [], 0)
    renderAccount(ctx)
    expect(screen.queryByRole('heading', { name: 'Seller' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Your account' })).toBeNull()
  })

  it('renders a same-height skeleton on state G, not a zero balance', () => {
    const ctx = buildCtx({
      purchase: {
        loading: true,
        isRefetching: false,
        error: null,
        purchases: [],
        hasProduct: () => false,
        activePurchase: null,
        hasPaidPurchase: false,
        activePaidPurchase: null,
        balanceTransactions: [],
      },
    })
    renderAccount(ctx, { productRef: 'prd_widget' })
    const skeleton = document.querySelector('[data-solvapay-mcp-account-skeleton]')
    expect(skeleton).toBeTruthy()
    expect(skeleton).toHaveAttribute('aria-busy', 'true')
    expect(screen.queryByText('Loading account…')).toBeNull()
    expect(screen.queryByText('Credit balance')).toBeNull()
    expect(screen.queryByText('0 credits')).toBeNull()
    expect(screen.queryByText('Remaining')).toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('keeps the skeleton while limits resolve on a loaded purchase', () => {
    const ctx = buildCtx(
      {
        _config: {
          transport: makeTransport({
            getLimits: () => new Promise(() => undefined),
          }),
        },
      },
      [starterPurchase],
      0,
    )
    renderAccount(ctx, {
      plans: catalogPlans,
      product: { name: 'Widget API', description: 'Pro-tier API for Acme.' },
      productRef: 'prd_widget',
    })
    expect(document.querySelector('[data-solvapay-mcp-account-skeleton]')).toBeTruthy()
    expect(screen.queryByText('0 credits')).toBeNull()
    expect(screen.queryByText('Credit balance')).toBeNull()
    expect(screen.queryByText('Unlimited')).toBeNull()
    expect(screen.queryByText('10,000 calls')).toBeNull()
    expect(screen.queryByText('Loading account…')).toBeNull()
  })

  it('hides the credit balance on state A even when credits exist', () => {
    const ctx = buildCtx({}, [], 500)
    renderAccount(ctx, {
      plans: catalogPlans,
      product: { name: 'Widget API', description: 'Pro-tier API for Acme.' },
      productRef: 'prd_widget',
    })
    expect(screen.queryByText('Credit balance')).toBeNull()
    expect(screen.queryByText('500 credits')).toBeNull()
    expect(screen.queryByText('Auto-recharge off')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Add funds' })).toBeNull()
    expect(screen.getByText('Widget API')).toBeTruthy()
    expect(screen.getByText('No plan')).toBeTruthy()
    expect(
      screen.getByText('Choose a plan to start using it. Calls fail until one is active.'),
    ).toBeTruthy()
  })

  it('renders an action-button ladder on state A and emphasizes PAYG', () => {
    const onChangePlan = vi.fn()
    const activatePlan = vi.fn().mockResolvedValue({ status: 'activated' })
    const ctx = buildCtx({ activatePlan }, [], 599_800)
    renderAccount(ctx, {
      plans: catalogPlans,
      product: { name: 'Widget API', description: 'Pro-tier API for Acme.' },
      productRef: 'prd_widget',
      onChangePlan,
    })
    expect(screen.getByText('Plans')).toBeTruthy()
    const paygButton = within(actionRow('Pay as you go')).getByRole('button', { name: 'Activate' })
    expect(paygButton).toHaveAttribute('data-emphasis', 'primary')
    expect(within(actionRow('Free')).getByRole('button', { name: 'Activate' })).toHaveAttribute(
      'data-emphasis',
      'secondary',
    )
    expect(actionRow(/Starter/)).toBeTruthy()
    expect(actionRow(/Pro/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Change plan' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Pick a plan' })).toBeNull()
  })

  it('activates a free plan in place on the A ladder', async () => {
    const onChangePlan = vi.fn()
    const activatePlan = vi.fn().mockResolvedValue({ status: 'activated' })
    const ctx = buildCtx({ activatePlan }, [], 0)
    renderAccount(ctx, {
      plans: catalogPlans,
      productRef: 'prd_widget',
      onChangePlan,
    })
    fireEvent.click(within(actionRow('Free')).getByRole('button', { name: 'Activate' }))
    await waitFor(() => {
      expect(activatePlan).toHaveBeenCalledWith({
        productRef: 'prd_widget',
        planRef: 'pln_free',
      })
    })
    expect(onChangePlan).not.toHaveBeenCalled()
  })

  it('activates a funded PAYG plan in place on the A ladder', async () => {
    const onChangePlan = vi.fn()
    const activatePlan = vi.fn().mockResolvedValue({ status: 'activated' })
    const ctx = buildCtx({ activatePlan }, [], 599_800)
    renderAccount(ctx, {
      plans: catalogPlans,
      productRef: 'prd_widget',
      onChangePlan,
    })
    fireEvent.click(within(actionRow('Pay as you go')).getByRole('button', { name: 'Activate' }))
    await waitFor(() => {
      expect(activatePlan).toHaveBeenCalledWith({
        productRef: 'prd_widget',
        planRef: 'pln_payg',
      })
    })
    expect(onChangePlan).not.toHaveBeenCalled()
  })

  it('sends an empty-wallet PAYG plan to checkout with its ref', () => {
    const onChangePlan = vi.fn()
    const activatePlan = vi.fn()
    const ctx = buildCtx({ activatePlan }, [], 0)
    renderAccount(ctx, {
      plans: catalogPlans,
      productRef: 'prd_widget',
      onChangePlan,
    })
    fireEvent.click(within(actionRow('Pay as you go')).getByRole('button', { name: 'Activate' }))
    expect(onChangePlan).toHaveBeenCalledTimes(1)
    expect(onChangePlan).toHaveBeenCalledWith('pln_payg')
    expect(activatePlan).not.toHaveBeenCalled()
  })

  it('sends a recurring plan to checkout with its ref', () => {
    const onChangePlan = vi.fn()
    const activatePlan = vi.fn()
    const ctx = buildCtx({ activatePlan }, [], 0)
    renderAccount(ctx, {
      plans: catalogPlans,
      productRef: 'prd_widget',
      onChangePlan,
    })
    fireEvent.click(within(actionRow(/Starter/)).getByRole('button', { name: 'Activate' }))
    expect(onChangePlan).toHaveBeenCalledTimes(1)
    expect(onChangePlan).toHaveBeenCalledWith('pln_starter')
    expect(activatePlan).not.toHaveBeenCalled()
  })

  it('shows a busy label on the clicked ladder row only', async () => {
    let resolveActivate: ((value: { status: 'activated' }) => void) | undefined
    const activatePlan = vi.fn(
      () =>
        new Promise<{ status: 'activated' }>(resolve => {
          resolveActivate = resolve
        }),
    )
    const ctx = buildCtx({ activatePlan }, [], 0)
    renderAccount(ctx, {
      plans: catalogPlans,
      productRef: 'prd_widget',
      onChangePlan: vi.fn(),
    })
    fireEvent.click(within(actionRow('Free')).getByRole('button', { name: 'Activate' }))
    expect(within(actionRow('Free')).getByRole('button', { name: 'Activating…' })).toBeTruthy()
    expect(
      within(actionRow('Pay as you go')).queryByRole('button', { name: 'Activating…' }),
    ).toBeNull()
    expect(
      within(actionRow('Pay as you go')).getByRole('button', { name: 'Activate' }),
    ).toBeDisabled()
    await waitFor(() => expect(resolveActivate).toBeDefined())
    resolveActivate?.({ status: 'activated' })
    await waitFor(() => {
      expect(within(actionRow('Free')).queryByRole('button', { name: 'Activating…' })).toBeNull()
    })
  })

  it('escalates to checkout when in-place activate returns payment_required', async () => {
    const onChangePlan = vi.fn()
    const activatePlan = vi.fn().mockResolvedValue({ status: 'payment_required' })
    const ctx = buildCtx({ activatePlan }, [], 0)
    renderAccount(ctx, {
      plans: catalogPlans,
      productRef: 'prd_widget',
      onChangePlan,
    })
    fireEvent.click(within(actionRow('Free')).getByRole('button', { name: 'Activate' }))
    await waitFor(() => {
      expect(onChangePlan).toHaveBeenCalledWith('pln_free')
    })
  })

  it('escalates to checkout when in-place activate returns topup_required', async () => {
    const onChangePlan = vi.fn()
    const activatePlan = vi.fn().mockResolvedValue({ status: 'topup_required' })
    const ctx = buildCtx({ activatePlan }, [], 599_800)
    renderAccount(ctx, {
      plans: catalogPlans,
      productRef: 'prd_widget',
      onChangePlan,
    })
    fireEvent.click(within(actionRow('Pay as you go')).getByRole('button', { name: 'Activate' }))
    await waitFor(() => {
      expect(onChangePlan).toHaveBeenCalledWith('pln_payg')
    })
  })

  it('does not render the fallback copy when there is a paid purchase', async () => {
    const ctx = buildCtx({}, [paidPurchase], 0)
    renderAccount(ctx)
    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: 'Pick a plan' })).toBeNull()
      expect(screen.queryByRole('heading', { name: 'Credits' })).toBeNull()
    })
  })

  it('keeps the customer portal on fullscreen paid plans, not on the inline summary', async () => {
    const ctx = buildCtx({}, [paidPurchase], 0)
    const { unmount } = renderAccount(ctx)
    expect(screen.queryByRole('link', { name: /manage account/i })).toBeNull()
    unmount()

    renderAccount(ctx, {}, 'fullscreen')
    const link = await screen.findByRole('link', { name: /full account/i })
    await waitFor(() => expect(link.getAttribute('href')).toBe('https://portal.test'))
    expect(screen.queryByRole('link', { name: /manage account/i })).toBeNull()
    expect(screen.queryByRole('link', { name: /update card/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /cancel plan/i })).toBeNull()
    expect(document.querySelector('[data-solvapay-mcp-portal-hint]')).toBeNull()
  })

  it('does not render Manage account for a customer without a paid purchase', async () => {
    const ctx = buildCtx({}, [], 0)
    renderAccount(ctx)
    await new Promise(r => setTimeout(r, 0))
    expect(screen.queryByRole('link', { name: /manage account/i })).toBeNull()
  })

  it('hides the portal hint when the Manage account button itself is hidden (zero-amount paid purchase)', async () => {
    const zeroAmountPurchase: PurchaseInfo = { ...paidPurchase, amount: 0 }
    const ctx = buildCtx(
      {
        purchase: {
          loading: false,
          isRefetching: false,
          error: null,
          purchases: [zeroAmountPurchase],
          hasProduct: () => true,
          activePurchase: zeroAmountPurchase,
          hasPaidPurchase: true,
          activePaidPurchase: zeroAmountPurchase,
          balanceTransactions: [],
        },
      },
      [zeroAmountPurchase],
      0,
    )
    renderAccount(ctx)
    await new Promise(r => setTimeout(r, 0))
    expect(screen.queryByRole('link', { name: /manage account/i })).toBeNull()
    expect(document.querySelector('[data-solvapay-mcp-portal-hint]')).toBeNull()
  })

  it('puts the product identity on state A without a page hero', () => {
    const ctx = buildCtx({}, [], 0)
    renderAccount(ctx, {
      plans: catalogPlans,
      product: { name: 'Acme Pro', description: 'Pro-tier API for Acme.' },
      productRef: 'prd_widget',
    })
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull()
    expect(screen.getByText('Acme Pro')).toBeTruthy()
    expect(screen.getByText('Pro-tier API for Acme.')).toBeTruthy()
    expect(document.querySelector('[data-solvapay-mcp-product-header]')).toBeNull()
  })

  it('does not render the Current plan and usage section label', () => {
    const ctx = buildCtx({}, [], 0)
    renderAccount(ctx)
    expect(document.querySelector('[data-solvapay-mcp-section-label]')).toBeNull()
    expect(screen.queryByText('Current plan and usage')).toBeNull()
  })

  it('quotes the credit rate on the plan line when the balance peg is known', () => {
    const ctx = buildCtx({}, [paygPurchase], 599_800)
    ctx.balance = mockBalanceStatus({
      credits: 599_800,
      displayCurrency: 'USD',
      creditsPerMinorUnit: 100,
      displayExchangeRate: 1,
    })
    renderAccount(ctx, {
      plans: catalogPlans,
      product: { name: 'Widget API' },
      productRef: 'prd_widget',
    })
    expect(
      screen.getByText('Pay as you go · 200 credits per call · since Jan 1, 2026'),
    ).toBeTruthy()
  })

  it('puts the plan line above the credit balance on a running PAYG plan', () => {
    const ctx = buildCtx({}, [paygPurchase], 500)
    renderAccount(ctx, {
      plans: catalogPlans,
      product: { name: 'Widget API', description: 'Pro-tier API for Acme.' },
      productRef: 'prd_widget',
    })
    expect(screen.getByText('Widget API')).toBeTruthy()
    expect(screen.getByText('Pro-tier API for Acme.')).toBeTruthy()
    expect(screen.getByText('Pay as you go · since Jan 1, 2026')).toBeTruthy()
    expect(screen.getByText('Active')).toBeTruthy()
    expect(screen.getByText('Credit balance')).toBeTruthy()
    expect(screen.getByText('500 credits')).toBeTruthy()
    expect(screen.getByText('Calls fail the moment the balance runs out.')).toBeTruthy()
    expect(screen.queryByText('Active products')).toBeNull()
    expect(document.querySelector('[data-solvapay-current-plan-card]')).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Your plan' })).toBeNull()
  })

  it('shows the failing pill and reframes auto-recharge when the credit plan is spent', () => {
    limitsCache.set('cus_abc:prd_widget:requests', {
      data: {
        remaining: 0,
        withinLimits: false,
        needsTopUp: true,
        meterName: 'requests',
        activationRequired: false,
        throttled: undefined,
        overage: undefined,
        needsUpgrade: undefined,
        upgraded: undefined,
      },
      timestamp: Date.now(),
      promise: null,
    })
    const onAutoRecharge = vi.fn()
    const config: SolvaPayConfig = {
      transport: makeTransport({
        getPaymentMethod: vi.fn().mockResolvedValue(reusableCard),
      }),
    }
    seedPaymentMethod(config, reusableCard)
    const ctx = buildCtx({ _config: config }, [paygPurchase], 0)
    renderAccount(ctx, {
      plans: catalogPlans,
      product: { name: 'Widget API', description: 'Pro-tier API for Acme.' },
      productRef: 'prd_widget',
      onAutoRecharge,
    })
    const pill = screen.getByText('Calls failing')
    expect(pill).toHaveAttribute('data-tone', 'accent')
    expect(screen.getByText('0 credits')).toBeTruthy()
    expect(
      screen.getByText('The plan is active, but calls fail until you add credits.'),
    ).toBeTruthy()
    expect(screen.getByText('Turning it on stops this happening again.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Turn on →' }))
    expect(onAutoRecharge).toHaveBeenCalledTimes(1)
  })

  it('hides the auto-recharge action when no card is on file', () => {
    const onAutoRecharge = vi.fn()
    const ctx = buildCtx({}, [paygPurchase], 500)
    renderAccount(ctx, {
      plans: catalogPlans,
      productRef: 'prd_widget',
      onAutoRecharge,
    })
    expect(screen.getByText('Auto-recharge off')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Turn on →' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Manage →' })).toBeNull()
  })

  it('hides the auto-recharge action when the card is not reusable', () => {
    const onAutoRecharge = vi.fn()
    const config: SolvaPayConfig = {
      transport: makeTransport({
        getPaymentMethod: vi.fn().mockResolvedValue(nonReusableCard),
      }),
    }
    seedPaymentMethod(config, nonReusableCard)
    const ctx = buildCtx({ _config: config }, [paygPurchase], 500)
    renderAccount(ctx, {
      plans: catalogPlans,
      productRef: 'prd_widget',
      onAutoRecharge,
    })
    expect(screen.getByText('Auto-recharge off')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Turn on →' })).toBeNull()
  })

  it('shows Manage when auto-recharge is already on', () => {
    const onAutoRecharge = vi.fn()
    const config: SolvaPayConfig = {
      transport: makeTransport({
        getAutoRecharge: vi.fn().mockResolvedValue({ config: enabledAutoRecharge }),
      }),
    }
    seedAutoRechargeOn(config)
    const ctx = buildCtx({ _config: config }, [paygPurchase], 500)
    renderAccount(ctx, {
      plans: catalogPlans,
      productRef: 'prd_widget',
      onAutoRecharge,
    })
    expect(screen.getByText('Auto-recharge on')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Manage →' }))
    expect(onAutoRecharge).toHaveBeenCalledTimes(1)
  })

  it('keeps other products off a product-scoped credit plan', () => {
    const other: PurchaseInfo = {
      ...paygPurchase,
      reference: 'pur_other',
      productRef: 'prd_other',
      productName: 'Other MCP',
    }
    const ctx = buildCtx({}, [paygPurchase, other], 500)
    renderAccount(ctx, { plans: catalogPlans, productRef: 'prd_widget' })
    expect(screen.getByText('Widget API')).toBeTruthy()
    expect(screen.queryByText('Other MCP')).toBeNull()
  })

  it('lists a Free purchase as an allowance plan even when hasPaidPurchase is false', () => {
    const ctx = buildCtx({}, [freePurchase], 0)
    expect(ctx.purchase.hasPaidPurchase).toBe(false)
    renderAccount(ctx, { plans: catalogPlans, productRef: 'prd_widget' })
    expect(screen.getByText('Widget API')).toBeTruthy()
    expect(screen.getByText('Free · started Sep 1, 2026')).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Pick a plan' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Credits' })).toBeNull()
    expect(screen.queryByText('Active products')).toBeNull()
  })

  it('keeps Change plan as the header label on free and puts See plans on a link', () => {
    seedLimits({ remaining: 1, withinLimits: true })
    const onChangePlan = vi.fn()
    const ctx = buildCtx({}, [freePurchase], 0)
    renderAccount(ctx, {
      plans: catalogPlans,
      productRef: 'prd_widget',
      onChangePlan,
    })
    expect(screen.queryByRole('button', { name: 'Upgrade' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Change plan' }))
    expect(onChangePlan).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'See plans →' }))
    expect(onChangePlan).toHaveBeenCalledTimes(2)
  })

  it('shows Change plan on a paid allowance plan when the catalog has alternatives', () => {
    seedLimits({ remaining: 3800, withinLimits: true })
    const onChangePlan = vi.fn()
    const ctx = buildCtx({}, [starterPurchase], 0)
    renderAccount(ctx, {
      plans: catalogPlans,
      productRef: 'prd_widget',
      onChangePlan,
    })
    fireEvent.click(screen.getByRole('button', { name: 'Change plan' }))
    expect(onChangePlan).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: 'Upgrade' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'See plans →' })).toBeNull()
  })

  it('hides Upgrade and Change plan in fullscreen when the catalog has only one plan', async () => {
    const ctx = buildCtx({}, [paidPurchase], 0)
    renderAccount(
      ctx,
      {
        plans: [catalogPlans[2]!],
        onChangePlan: vi.fn(),
      },
      'fullscreen',
    )
    await screen.findByRole('link', { name: /full account/i })
    expect(screen.queryByRole('button', { name: 'Upgrade' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Change plan' })).toBeNull()
  })

  it('renders Change plan, not Upgrade, for a thin PAYG snapshot', () => {
    const onChangePlan = vi.fn()
    const ctx = buildCtx({}, [paygPurchase], 500)
    renderAccount(ctx, { plans: catalogPlans, onChangePlan, productRef: 'prd_widget' })
    fireEvent.click(screen.getByRole('button', { name: 'Change plan' }))
    expect(onChangePlan).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: 'Upgrade' })).toBeNull()
  })

  it('calls onTopup from Add funds', () => {
    const onTopup = vi.fn()
    const ctx = buildCtx({}, [paygPurchase], 500)
    renderAccount(ctx, { onTopup, plans: catalogPlans, productRef: 'prd_widget' })
    fireEvent.click(screen.getByRole('button', { name: 'Add funds' }))
    expect(onTopup).toHaveBeenCalledTimes(1)
  })

  it('leads a running subscription with Remaining, Renews, and untouched credits', () => {
    seedLimits({ remaining: 3800, withinLimits: true, used: 6200, limit: 10000 })
    const ctx = buildCtx({}, [starterPurchase], 599_800)
    renderAccount(ctx, {
      plans: catalogPlans,
      product: { name: 'Widget API', description: 'Pro-tier API for Acme.' },
      productRef: 'prd_widget',
      onTopup: vi.fn(),
    })
    expect(screen.getByText('Widget API')).toBeTruthy()
    expect(screen.getByText('Pro-tier API for Acme.')).toBeTruthy()
    expect(screen.getByText('Starter · $30/mo · renews Sep 12, 2026')).toBeTruthy()
    expect(screen.getByText('Remaining')).toBeTruthy()
    expect(screen.getByText('3,800 calls')).toBeTruthy()
    expect(screen.getByText('Of 10,000 this period.')).toBeTruthy()
    expect(screen.getByText('3,800 of 10,000 calls')).toBeTruthy()
    expect(screen.getByText('Renews')).toBeTruthy()
    expect(screen.getByText('Sep 12, 2026')).toBeTruthy()
    expect(screen.getByText('Credits')).toBeTruthy()
    expect(screen.getAllByText('Not used').length).toBeGreaterThan(0)
    expect(screen.getByText('Balance is untouched.')).toBeTruthy()
    expect(screen.getByRole('progressbar')).toHaveAttribute('data-state', 'safe')
    expect(
      screen.getByText(
        '6,200 of 10,000 calls used, 62%. A warning shows at 80%, and calls stop at 100%.',
      ),
    ).toBeTruthy()
    expect(screen.queryByText('Credit balance')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Add funds' })).toBeNull()
    expect(screen.queryByText('Auto-recharge off')).toBeNull()
    expect(screen.queryByText('Active products')).toBeNull()
  })

  it('prints Unlimited on Remaining for an unmetered subscription and omits the meter', () => {
    seedLimits({ remaining: -1, withinLimits: true })
    const ctx = buildCtx({}, [unlimitedPurchase], 599_800)
    renderAccount(ctx, { plans: catalogPlans, productRef: 'prd_widget' })
    expect(screen.getByText('Remaining')).toBeTruthy()
    expect(screen.getByText('Unlimited')).toBeTruthy()
    expect(screen.getByText('Credits')).toBeTruthy()
    expect(screen.getAllByText('Not used').length).toBeGreaterThan(0)
    expect(screen.queryByRole('progressbar')).toBeNull()
    expect(screen.queryByText('Credit balance')).toBeNull()
  })

  it('drops price from the free plan line and warns on the last remaining call', () => {
    seedLimits({ remaining: 1, withinLimits: true, used: 2, limit: 3 })
    const onChangePlan = vi.fn()
    const ctx = buildCtx({}, [freePurchase], 599_800)
    renderAccount(ctx, {
      plans: catalogPlans,
      product: { name: 'Widget API', description: 'Pro-tier API for Acme.' },
      productRef: 'prd_widget',
      onChangePlan,
      onTopup: vi.fn(),
    })
    expect(screen.getByText('Free · started Sep 1, 2026')).toBeTruthy()
    expect(screen.queryByText(/\$/)).toBeNull()
    expect(screen.getByText('1 call')).toBeTruthy()
    expect(screen.getByText('Of 3 this period.')).toBeTruthy()
    expect(screen.getByText('Resets')).toBeTruthy()
    expect(screen.getByText('Oct 1, 2026')).toBeTruthy()
    expect(screen.getAllByText('Not used').length).toBeGreaterThan(0)
    expect(screen.getByText('Balance is untouched.')).toBeTruthy()
    expect(screen.getByRole('progressbar')).toHaveAttribute('data-state', 'warning')
    expect(
      screen.getByText(
        '2 of 3 calls used, 67%. One remaining call is the difference between working and blocked.',
      ),
    ).toBeTruthy()
    expect(screen.getByText('Need more than 3 calls a month?')).toBeTruthy()
    expect(
      screen.getByText('Pay as you go starts without payment and uses your credits.'),
    ).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Add funds' })).toBeNull()
    expect(screen.queryByText('Credit balance')).toBeNull()
  })

  it('keeps After your first call when the allowance has no period yet', () => {
    seedLimits({ remaining: 10000, withinLimits: true })
    const firstRun: PurchaseInfo = {
      ...starterPurchase,
      usage: { used: 0, overageCost: 0, overageUnits: 0 },
    }
    const ctx = buildCtx({}, [firstRun], 0)
    renderAccount(ctx, { plans: catalogPlans, productRef: 'prd_widget' })
    expect(screen.getByText('After your first call')).toBeTruthy()
    expect(screen.getByText('10,000 calls')).toBeTruthy()
  })

  it('promotes the plan ladder on a free plan at cap and states the credit trap', async () => {
    seedLimits({ remaining: 0, withinLimits: false })
    const onChangePlan = vi.fn()
    const activatePlan = vi.fn().mockResolvedValue({ status: 'activated' })
    const ctx = buildCtx({ activatePlan }, [freePurchase], 599_800)
    renderAccount(ctx, {
      plans: catalogPlans,
      product: { name: 'Widget API', description: 'Pro-tier API for Acme.' },
      productRef: 'prd_widget',
      onChangePlan,
      onTopup: vi.fn(),
    })
    const pill = screen.getByText('Free limit reached')
    expect(pill).toHaveAttribute('data-tone', 'accent')
    expect(screen.getByText('Free · 3 calls per month')).toBeTruthy()
    expect(screen.getByText('Your free calls are used up')).toBeTruthy()
    expect(screen.getByText(/Calls fail until the limit resets on Oct 1/)).toBeTruthy()
    expect(
      screen.getByText(
        'You have 599,800 credits. Free does not spend them, so adding funds will not restore calls.',
      ),
    ).toBeTruthy()
    expect(screen.getByText('Carry on with')).toBeTruthy()
    expect(
      screen.queryByText('Free', { selector: '.solvapay-mcp-plan-action-row-title' }),
    ).toBeNull()
    const payg = within(actionRow('Pay as you go')).getByRole('button', { name: 'Switch' })
    expect(payg).toHaveAttribute('data-emphasis', 'primary')
    fireEvent.click(payg)
    await waitFor(() => {
      expect(activatePlan).toHaveBeenCalledWith({
        productRef: 'prd_widget',
        planRef: 'pln_payg',
      })
    })
    expect(onChangePlan).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Change plan' })).toBeNull()
    expect(screen.queryByText('Credit balance')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Add funds' })).toBeNull()
    expect(screen.queryByRole('progressbar')).toBeNull()
  })

  it('uses the same at-cap ladder for a paid allowance and drops the current plan', () => {
    seedLimits({ remaining: 0, withinLimits: false })
    const onChangePlan = vi.fn()
    const ctx = buildCtx({}, [starterPurchase], 0)
    renderAccount(ctx, {
      plans: catalogPlans,
      product: { name: 'Widget API' },
      productRef: 'prd_widget',
      onChangePlan,
    })
    expect(screen.getByText('Starter limit reached')).toBeTruthy()
    expect(screen.getByText('Your Starter calls are used up')).toBeTruthy()
    expect(screen.queryByText(/does not spend them/)).toBeNull()
    expect(
      screen.queryByText('Starter', { selector: '.solvapay-mcp-plan-action-row-title' }),
    ).toBeNull()
    expect(
      within(actionRow('Pay as you go')).getByRole('button', { name: 'Switch' }),
    ).toHaveAttribute('data-emphasis', 'primary')
    fireEvent.click(within(actionRow(/Pro/)).getByRole('button', { name: 'Switch' }))
    expect(onChangePlan).toHaveBeenCalledWith('pln_pro')
    expect(screen.queryByText('Credit balance')).toBeNull()
  })

  it('wires Start free plan on state H and keeps failure language off', () => {
    seedLimits({ remaining: 0, withinLimits: false, activationRequired: true })
    const activatePlan = vi.fn().mockResolvedValue({ status: 'activated' })
    const ctx = buildCtx({ activatePlan }, [], 0)
    renderAccount(ctx, {
      plans: catalogPlans,
      product: { name: 'Widget API', description: 'Pro-tier API for Acme.' },
      productRef: 'prd_widget',
      onChangePlan: vi.fn(),
    })
    expect(screen.getByText('Widget API')).toBeTruthy()
    expect(screen.getByText('Not started')).toBeTruthy()
    expect(screen.getByText('3 free calls a month, ready to claim')).toBeTruthy()
    expect(screen.getByText('No card, no charge. You can change plan later.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Start free plan' }))
    expect(activatePlan).toHaveBeenCalledWith({
      productRef: 'prd_widget',
      planRef: 'pln_free',
    })
    expect(screen.queryByRole('button', { name: 'Change plan' })).toBeNull()
    expect(screen.queryByText('Free limit reached')).toBeNull()
    expect(screen.queryByText('Calls failing')).toBeNull()
    expect(screen.queryByText('Credit balance')).toBeNull()
  })

  it('shows used-of-allowance and a 100% meter on state I without overage money', () => {
    seedLimits({ remaining: 0, withinLimits: true, overage: true })
    const onChangePlan = vi.fn()
    const overagePurchase: PurchaseInfo = {
      ...starterPurchase,
      usage: { used: 11240, overageCost: 0, overageUnits: 0, periodEnd: '2026-09-12T00:00:00Z' },
    }
    const ctx = buildCtx({}, [overagePurchase], 0)
    renderAccount(ctx, {
      plans: catalogPlans,
      product: { name: 'Widget API', description: 'Pro-tier API for Acme.' },
      productRef: 'prd_widget',
      onChangePlan,
    })
    const pill = screen.getByText('Over the allowance')
    expect(pill).toHaveAttribute('data-tone', 'accent')
    expect(screen.getByText('Starter · $30/mo')).toBeTruthy()
    expect(screen.getByText('Used')).toBeTruthy()
    expect(screen.getByText('11,240 of 10,000 calls')).toBeTruthy()
    expect(screen.getByRole('progressbar')).toHaveAttribute('data-state', 'critical')
    expect(screen.getByText('Calls are still working.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'See plans with a higher limit →' }))
    expect(onChangePlan).toHaveBeenCalledTimes(1)
    expect(screen.queryByText(/\$12/)).toBeNull()
    expect(screen.queryByText(/charged at/i)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Change plan' })).toBeNull()
    expect(screen.queryByText('Credit balance')).toBeNull()
  })

  it('restyles cancelled notice on state J with a date status and secondary Reactivate', () => {
    seedLimits({ remaining: 3800, withinLimits: true })
    const reactivateRenewal = vi.fn().mockResolvedValue({ success: true })
    const cancelled: PurchaseInfo = {
      ...starterPurchase,
      cancelledAt: '2026-09-04T00:00:00Z',
      endDate: '2026-10-12T00:00:00Z',
    }
    const ctx = buildCtx({ reactivateRenewal }, [cancelled], 0)
    renderAccount(ctx, {
      plans: catalogPlans,
      product: { name: 'Widget API', description: 'Pro-tier API for Acme.' },
      productRef: 'prd_widget',
      onChangePlan: vi.fn(),
    })
    expect(screen.getByText('Active until Oct 12')).toBeTruthy()
    expect(screen.getByText('Starter · cancelled Sep 4, 2026')).toBeTruthy()
    expect(screen.getByText(/days left on this plan/)).toBeTruthy()
    expect(
      screen.getByText(
        'Calls keep working until Oct 12, then stop. You will not be charged again.',
      ),
    ).toBeTruthy()
    expect(screen.getByText('3,800 of 10,000 calls')).toBeTruthy()
    expect(screen.getByRole('progressbar')).toHaveAttribute('data-state', 'safe')
    const reactivate = screen.getByRole('button', { name: 'Reactivate Starter' })
    expect(reactivate).toHaveAttribute('data-variant', 'secondary')
    fireEvent.click(reactivate)
    expect(reactivateRenewal).toHaveBeenCalledWith({ purchaseRef: 'pur_starter' })
    expect(screen.queryByText('Your purchase has been cancelled')).toBeNull()
    expect(screen.queryByText('Undo Cancellation')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Change plan' })).toBeNull()
  })

  const creditHistory = {
    charges: [],
    creditActivity: {
      entries: [
        {
          type: 'USAGE',
          amount: -200,
          balance: 599_800,
          productName: 'Cool MCP',
          timestamp: '2026-09-05T14:22:00.000Z',
        },
        {
          type: 'USAGE',
          amount: -2500,
          balance: 600_200,
          productName: 'Statement Parser',
          timestamp: '2026-09-04T09:41:00.000Z',
        },
        {
          type: 'TOPUP',
          amount: 500_000,
          balance: 602_700,
          timestamp: '2026-08-31T11:03:00.000Z',
        },
      ],
      hasMore: false,
    },
  }

  const chargeHistory = {
    charges: [
      {
        reference: 'pur_aug',
        customerRef: 'cus_abc',
        productName: 'Widget API',
        status: 'active',
        startDate: '2026-08-12T00:00:00Z',
        createdAt: '2026-08-12T00:00:00Z',
        amount: 3000,
        currency: 'USD',
        isRecurring: true,
        billingCycle: 'monthly',
        planSnapshot: { name: 'Starter' },
      },
      {
        reference: 'pur_jul',
        customerRef: 'cus_abc',
        productName: 'Widget API',
        status: 'expired',
        startDate: '2026-07-12T00:00:00Z',
        createdAt: '2026-07-12T00:00:00Z',
        amount: 3000,
        currency: 'USD',
        isRecurring: true,
        billingCycle: 'monthly',
        planSnapshot: { name: 'Starter' },
      },
    ],
    creditActivity: { entries: [], hasMore: false },
  }

  function historyTransport(history: typeof creditHistory | typeof chargeHistory | Error) {
    return makeTransport({
      getHistory:
        history instanceof Error
          ? vi.fn().mockRejectedValue(history)
          : vi.fn().mockResolvedValue(history),
    })
  }

  function seedMerchantWith(
    merchant: Merchant,
    transport: NonNullable<SolvaPayConfig['transport']>,
  ): SolvaPayConfig {
    const config: SolvaPayConfig = { transport }
    const key = createTransportCacheKey(config, '/api/merchant')
    merchantCache.set(key, { merchant, promise: null, timestamp: Date.now() })
    return config
  }

  it('renders account-wide credit activity on fullscreen B and not on inline', async () => {
    const config = seedMerchantWith(
      { displayName: 'Acme', legalName: 'Acme Inc.' },
      historyTransport(creditHistory),
    )
    const ctx = buildCtx({ _config: config }, [paygPurchase], 599_800)
    const { unmount } = renderAccount(ctx, {
      plans: catalogPlans,
      productRef: 'prd_widget',
    })
    expect(screen.queryByRole('columnheader', { name: 'Event' })).toBeNull()
    expect(screen.queryByText('Every credit event on your account, newest first')).toBeNull()
    unmount()

    renderAccount(
      ctx,
      {
        plans: catalogPlans,
        product: { name: 'Widget API' },
        productRef: 'prd_widget',
      },
      'fullscreen',
    )
    expect(await screen.findByRole('columnheader', { name: 'Event' })).toBeTruthy()
    expect(screen.getByRole('columnheader', { name: 'When' })).toBeTruthy()
    expect(screen.getByRole('columnheader', { name: 'Credits' })).toBeTruthy()
    expect(screen.getByRole('columnheader', { name: 'Balance' })).toBeTruthy()
    expect(screen.getByText('Cool MCP')).toBeTruthy()
    expect(screen.getByText('Statement Parser')).toBeTruthy()
    expect(screen.getByText('Top-up')).toBeTruthy()
    expect(screen.getByText('−200')).toBeTruthy()
    expect(screen.getByText('+500,000')).toBeTruthy()
    expect(screen.getByText('599,800')).toBeTruthy()
    expect(
      screen.getByText(
        'Every credit event on your account, newest first, including other products and top-ups. Credits are shared, so the balance only makes sense account-wide.',
      ),
    ).toBeTruthy()
    expect(screen.getByRole('link', { name: /full history/i })).toBeTruthy()
    expect(screen.queryByRole('columnheader', { name: 'Charge' })).toBeNull()
    expect(screen.queryByText('Receipt')).toBeNull()
  })

  it('keeps empty credit activity distinct from a failed fetch', async () => {
    const emptyConfig = seedMerchantWith(
      { displayName: 'Acme', legalName: 'Acme Inc.' },
      historyTransport({
        charges: [],
        creditActivity: { entries: [], hasMore: false },
      }),
    )
    const emptyCtx = buildCtx({ _config: emptyConfig }, [paygPurchase], 500)
    const { unmount } = renderAccount(
      emptyCtx,
      { plans: catalogPlans, productRef: 'prd_widget' },
      'fullscreen',
    )
    expect(await screen.findByText('No credit activity yet.')).toBeTruthy()
    expect(screen.queryByText("Couldn't load credit activity.")).toBeNull()

    unmount()
    historyCache.clear()
    const failConfig = seedMerchantWith(
      { displayName: 'Acme', legalName: 'Acme Inc.' },
      historyTransport(new Error('history unavailable')),
    )
    const failCtx = buildCtx({ _config: failConfig }, [paygPurchase], 500)
    renderAccount(failCtx, { plans: catalogPlans, productRef: 'prd_widget' }, 'fullscreen')
    expect(await screen.findByText("Couldn't load credit activity.")).toBeTruthy()
    expect(screen.queryByText('No credit activity yet.')).toBeNull()
  })

  it('renders product charges on fullscreen C without a Receipt column', async () => {
    seedLimits({ remaining: 3800, withinLimits: true })
    const config = seedMerchantWith(
      { displayName: 'Acme', legalName: 'Acme Inc.' },
      historyTransport(chargeHistory),
    )
    const ctx = buildCtx({ _config: config }, [starterPurchase], 0)
    renderAccount(
      ctx,
      {
        plans: catalogPlans,
        product: { name: 'Widget API', description: 'Pro-tier API for Acme.' },
        productRef: 'prd_widget',
      },
      'fullscreen',
    )
    expect(await screen.findByRole('columnheader', { name: 'Charge' })).toBeTruthy()
    expect(screen.getAllByText('Starter · monthly')).toHaveLength(2)
    expect(screen.getByText('Aug 12, 2026')).toBeTruthy()
    expect(screen.getAllByText('$30')).toHaveLength(2)
    expect(screen.queryByText('Receipt')).toBeNull()
    expect(screen.getByText('This plan does not spend your balance.')).toBeTruthy()
    expect(screen.queryByText('Balance is untouched.')).toBeNull()
    expect(screen.queryByRole('columnheader', { name: 'Event' })).toBeNull()
  })

  it('keeps empty charges distinct from a failed fetch', async () => {
    seedLimits({ remaining: 3800, withinLimits: true })
    const emptyConfig = seedMerchantWith(
      { displayName: 'Acme', legalName: 'Acme Inc.' },
      historyTransport({
        charges: [],
        creditActivity: { entries: [], hasMore: false },
      }),
    )
    const { unmount } = renderAccount(
      buildCtx({ _config: emptyConfig }, [starterPurchase], 0),
      { plans: catalogPlans, productRef: 'prd_widget' },
      'fullscreen',
    )
    expect(await screen.findByText('No charges yet.')).toBeTruthy()
    expect(screen.queryByText("Couldn't load charges.")).toBeNull()

    unmount()
    historyCache.clear()
    const failConfig = seedMerchantWith(
      { displayName: 'Acme', legalName: 'Acme Inc.' },
      historyTransport(new Error('history unavailable')),
    )
    renderAccount(
      buildCtx({ _config: failConfig }, [starterPurchase], 0),
      { plans: catalogPlans, productRef: 'prd_widget' },
      'fullscreen',
    )
    expect(await screen.findByText("Couldn't load charges.")).toBeTruthy()
    expect(screen.queryByText('No charges yet.')).toBeNull()
  })

  it('uses consequence lines on the A ladder in both layouts', () => {
    const config = seedMerchant({ displayName: 'Test', legalName: 'Test Inc.' })
    const ctx = buildCtx({ _config: config }, [], 599_800)
    ctx.balance = mockBalanceStatus({
      credits: 599_800,
      displayCurrency: 'USD',
      creditsPerMinorUnit: 100,
      displayExchangeRate: 1,
    })
    const { unmount } = renderAccount(ctx, {
      plans: catalogPlans,
      productRef: 'prd_widget',
    })
    expect(screen.getByText('3 calls per month, then calls fail. No card needed.')).toBeTruthy()
    expect(
      screen.getByText(
        'From 200 credits per call, drawn from your credit balance. Credits work across every Test product.',
      ),
    ).toBeTruthy()
    expect(
      screen.getByText('10,000 calls per month. No credits used. Cancel any time.'),
    ).toBeTruthy()
    unmount()

    renderAccount(
      ctx,
      {
        plans: catalogPlans,
        product: { name: 'Widget API', description: 'Pro-tier API for Acme.' },
        productRef: 'prd_widget',
      },
      'fullscreen',
    )
    expect(screen.getByText('3 calls per month, then calls fail. No card needed.')).toBeTruthy()
    expect(
      screen.getByText(
        'From 200 credits per call, drawn from your credit balance. Credits work across every Test product.',
      ),
    ).toBeTruthy()
    expect(
      screen.getByText('10,000 calls per month. No credits used. Cancel any time.'),
    ).toBeTruthy()
    expect(screen.getByText('Unlimited calls, one time. No credits used, no renewal.')).toBeTruthy()
  })

  it('prints merchant place and buyer identity on the fullscreen footer without verified or Stripe', async () => {
    seedLimits({ remaining: 3800, withinLimits: true })
    const config = seedMerchantWith(
      {
        displayName: 'Test',
        legalName: 'Test Inc.',
        city: 'San Francisco',
        stateOrCounty: 'CA',
        websiteUrl: 'https://aaa.com',
      },
      historyTransport(chargeHistory),
    )
    const ctx = buildCtx(
      {
        _config: config,
        purchase: {
          email: 'tommy@solvapay.com',
          name: 'Tommy Berglind',
        },
      },
      [starterPurchase],
      0,
    )
    renderAccount(ctx, { plans: catalogPlans, productRef: 'prd_widget' }, 'fullscreen')
    expect(await screen.findByText('Sold by Test')).toBeTruthy()
    expect(screen.getByText('San Francisco, CA')).toBeTruthy()
    const website = screen.getByRole('link', { name: /aaa.com/ })
    expect(website).toHaveAttribute('href', 'https://aaa.com')
    expect(website).toHaveClass('solvapay-mcp-history-link')
    expect(website.querySelector('.solvapay-mcp-external-glyph')).toBeTruthy()
    expect(website.textContent).not.toMatch('↗')
    expect(screen.getByText('Tommy Berglind')).toBeTruthy()
    expect(screen.getByText('tommy@solvapay.com')).toBeTruthy()
    expect(screen.getByRole('link', { name: /full account/i })).toBeTruthy()
    expect(screen.queryByText(/verified/i)).toBeNull()
    expect(screen.queryByText(/Identity checked by Stripe/)).toBeNull()
  })
})
