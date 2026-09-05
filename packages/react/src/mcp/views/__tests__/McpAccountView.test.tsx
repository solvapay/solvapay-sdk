import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { McpDisplayModeProvider } from '../../hooks/useDisplayMode'
import { McpAccountView } from '../McpAccountView'
import { SolvaPayContext } from '../../../SolvaPayProvider'
import { merchantCache } from '../../../hooks/useMerchant'
import { createTransportCacheKey } from '../../../transport/cache-key'
import type { SolvaPayContextValue, SolvaPayConfig, PurchaseInfo, Merchant } from '../../../types'
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
  overrides: Partial<SolvaPayContextValue> = {},
  purchases: PurchaseInfo[] = [],
  credits: number | null = null,
): SolvaPayContextValue {
  const paid = purchases.find(p => (p.amount ?? 0) > 0) ?? null
  // activePurchase is the primary plan purchase (paid or $0), not "amount > 0".
  const active = purchases[0] ?? null
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
    },
    refetchPurchase: vi.fn(),
    upsertPurchase: vi.fn(),
    createPayment: vi.fn(),
    createTopupPayment: vi.fn(),
    cancelRenewal: vi.fn(),
    reactivateRenewal: vi.fn(),
    activatePlan: vi.fn(),
    balance: mockBalanceStatus({ credits }),
    _config: { transport: makeTransport() },
    ...overrides,
  }
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

const catalogPlans: PlanLike[] = [
  { reference: 'pln_free', requiresPayment: false, price: 0, options: [cycle()] },
  { reference: 'pln_payg', requiresPayment: true, price: 0, options: [perUnit(2)] },
  { reference: 'pln_monthly', requiresPayment: true, price: 1999, options: [cycle(), flat(1999)] },
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
  status: 'active',
  startDate: '2026-01-01T00:00:00Z',
  createdAt: '2026-01-01T00:00:00Z',
  amount: 0,
  currency: 'USD',
  isRecurring: false,
  planRef: 'pln_free',
  planSnapshot: {
    reference: 'pln_free',
    name: 'Free',
    currency: 'USD',
    price: 0,
    isMetered: false,
  },
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

describe('McpAccountView', () => {
  beforeEach(() => {
    merchantCache.clear()
  })

  it('does not render Seller or Your account cards — identity lives on the shell provenance line', () => {
    const config = seedMerchant({ displayName: 'Acme', legalName: 'Acme Inc.' })
    const ctx = buildCtx({ _config: config }, [], 0)
    renderAccount(ctx)
    expect(screen.queryByRole('heading', { name: 'Seller' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Your account' })).toBeNull()
  })

  it('renders a loading card while purchases are loading', () => {
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
    renderAccount(ctx)
    expect(screen.getByText('Loading account…')).toBeTruthy()
  })

  it('leads with the credit balance strip when there is no plan but credits exist', () => {
    const ctx = buildCtx({}, [], 500)
    renderAccount(ctx)
    expect(screen.getByText('Credit balance')).toBeTruthy()
    expect(screen.getByText('500 credits')).toBeTruthy()
    expect(screen.getByText('Auto-recharge off')).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Credits' })).toBeNull()
    expect(screen.queryByText(/pay-as-you-go credits/i)).toBeNull()
  })

  it('renders the Pick a plan empty state when there are no purchases and no credits', () => {
    const ctx = buildCtx({}, [], 0)
    renderAccount(ctx)
    expect(screen.getByRole('heading', { name: 'Pick a plan' })).toBeTruthy()
    expect(
      screen.getByText(
        'Choose a free, pay-as-you-go, or paid plan to start using this MCP server.',
      ),
    ).toBeTruthy()
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
    const link = await screen.findByRole('link', { name: /manage account/i })
    await waitFor(() => expect(link.getAttribute('href')).toBe('https://portal.test'))
    expect(screen.queryByRole('link', { name: /update card/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /cancel plan/i })).toBeNull()
    const hint = document.querySelector('[data-solvapay-mcp-portal-hint]')
    expect(hint?.textContent).toBe('Click Manage account to update your card or cancel your plan.')
    expect(hint?.nextElementSibling).toBe(link)
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

  it('does not render a product hero or description even when product prop is passed', () => {
    const ctx = buildCtx({}, [paidPurchase], 0)
    renderAccount(ctx, {
      product: { name: 'Acme Pro', description: 'Pro-tier API for Acme.' },
    })
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull()
    expect(screen.queryByText('Pro-tier API for Acme.')).toBeNull()
    expect(document.querySelector('[data-solvapay-mcp-product-header]')).toBeNull()
  })

  it('does not render the Current plan and usage section label', () => {
    const ctx = buildCtx({}, [], 0)
    renderAccount(ctx)
    expect(document.querySelector('[data-solvapay-mcp-section-label]')).toBeNull()
    expect(screen.queryByText('Current plan and usage')).toBeNull()
  })

  it('names active products with plan and since instead of a PLAN / SINCE three-up', () => {
    const ctx = buildCtx({}, [paygPurchase], 500)
    renderAccount(ctx, { plans: catalogPlans })
    expect(screen.getByText('Active products')).toBeTruthy()
    expect(screen.getByText('Widget API')).toBeTruthy()
    expect(screen.getByText('Pay as you go · since Jan 1, 2026')).toBeTruthy()
    expect(screen.getByText('Active')).toBeTruthy()
    expect(document.querySelector('[data-solvapay-current-plan-card]')).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Your plan' })).toBeNull()
    expect(screen.queryByText('Rate')).toBeNull()
  })

  it('lists a Free purchase as an active product even when hasPaidPurchase is false', () => {
    const ctx = buildCtx({}, [freePurchase], 0)
    expect(ctx.purchase.hasPaidPurchase).toBe(false)
    renderAccount(ctx, { plans: catalogPlans })
    expect(screen.getByText('Widget API')).toBeTruthy()
    expect(screen.getByText('Free · since Jan 1, 2026')).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Pick a plan' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Credits' })).toBeNull()
  })

  it('hides per-row plan actions inline and shows Upgrade on a free row in fullscreen', () => {
    const onChangePlan = vi.fn()
    const ctx = buildCtx({}, [freePurchase], 0)
    const { unmount } = renderAccount(ctx, { plans: catalogPlans, onChangePlan })
    expect(screen.queryByRole('button', { name: 'Upgrade' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Change plan' })).toBeNull()
    unmount()

    renderAccount(ctx, { plans: catalogPlans, onChangePlan }, 'fullscreen')
    fireEvent.click(screen.getByRole('button', { name: 'Upgrade' }))
    expect(onChangePlan).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: 'Change plan' })).toBeNull()
  })

  it('shows Change plan on a paid row in fullscreen when the catalog has alternatives', () => {
    const onChangePlan = vi.fn()
    const ctx = buildCtx({}, [paidPurchase], 0)
    renderAccount(ctx, { plans: catalogPlans, onChangePlan }, 'fullscreen')
    fireEvent.click(screen.getByRole('button', { name: 'Change plan' }))
    expect(onChangePlan).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: 'Upgrade' })).toBeNull()
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
    await screen.findByRole('link', { name: /manage account/i })
    expect(screen.queryByRole('button', { name: 'Upgrade' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Change plan' })).toBeNull()
  })

  it('renders Change plan, not Upgrade, for a thin PAYG snapshot in fullscreen', () => {
    const onChangePlan = vi.fn()
    const ctx = buildCtx({}, [paygPurchase], 0)
    renderAccount(ctx, { plans: catalogPlans, onChangePlan }, 'fullscreen')
    fireEvent.click(screen.getByRole('button', { name: 'Change plan' }))
    expect(onChangePlan).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: 'Upgrade' })).toBeNull()
  })

  it('calls onTopup from Add funds', () => {
    const onTopup = vi.fn()
    const ctx = buildCtx({}, [paygPurchase], 500)
    renderAccount(ctx, { onTopup })
    fireEvent.click(screen.getByRole('button', { name: 'Add funds' }))
    expect(onTopup).toHaveBeenCalledTimes(1)
  })
})
