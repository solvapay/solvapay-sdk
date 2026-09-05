import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
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
) {
  return render(
    <SolvaPayContext.Provider value={ctx}>
      <McpAccountView {...props} />
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

  it('renders the Credits heading when there is no plan but credits exist', () => {
    const ctx = buildCtx({}, [], 500)
    renderAccount(ctx)
    expect(screen.getByRole('heading', { name: 'Credits' })).toBeTruthy()
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

  it('renders a Manage account button backed by the customer portal transport when the customer has a paid purchase', async () => {
    const ctx = buildCtx({}, [paidPurchase], 0)
    renderAccount(ctx)
    const link = await screen.findByRole('link', { name: /manage account/i })
    await waitFor(() => expect(link.getAttribute('href')).toBe('https://portal.test'))
    expect(link.getAttribute('target')).toBe('_blank')
  })

  it('does not render the inline "Update card" button on a paid plan (the portal handles card updates)', async () => {
    const ctx = buildCtx({}, [paidPurchase], 0)
    renderAccount(ctx)
    await screen.findByRole('link', { name: /manage account/i })
    expect(screen.queryByRole('link', { name: /update card/i })).toBeNull()
  })

  it('does not render the inline "Cancel plan" button on a paid plan (cancel runs through the portal)', async () => {
    const ctx = buildCtx({}, [paidPurchase], 0)
    renderAccount(ctx)
    await screen.findByRole('link', { name: /manage account/i })
    expect(screen.queryByRole('button', { name: /cancel plan/i })).toBeNull()
  })

  it('renders the portal hint fine-print immediately above the Manage account button', async () => {
    const ctx = buildCtx({}, [paidPurchase], 0)
    renderAccount(ctx)
    const portalLink = await screen.findByRole('link', { name: /manage account/i })
    const hint = document.querySelector('[data-solvapay-mcp-portal-hint]')
    expect(hint?.textContent).toBe('Click Manage account to update your card or cancel your plan.')
    // The hint names the button, so nothing may come between them.
    expect(hint?.nextElementSibling).toBe(portalLink)
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

  it('renders Started … on a paid plan but hides the purchase reference and payment-method line', async () => {
    const card = {
      kind: 'card' as const,
      brand: 'visa',
      last4: '4242',
      expMonth: 4,
      expYear: 2028,
    }
    const ctx = buildCtx(
      {
        _config: {
          transport: makeTransport({ getPaymentMethod: vi.fn().mockResolvedValue(card) }),
        },
      },
      [paidPurchase],
      0,
    )
    renderAccount(ctx)
    await waitFor(() => {
      expect(document.querySelector('[data-solvapay-current-plan-started-line]')).toBeTruthy()
    })
    expect(document.querySelector('[data-solvapay-current-plan-reference]')).toBeNull()
    expect(document.querySelector('[data-solvapay-current-plan-payment-method]')).toBeNull()
    expect(screen.queryByText(/Visa|•••• 4242/)).toBeNull()
  })

  it('does not render a standalone Credit balance hero section above the plan card', () => {
    const ctx = buildCtx({}, [], 500)
    renderAccount(ctx)
    expect(screen.queryByRole('region', { name: 'Credit balance' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Credit balance' })).toBeNull()
  })

  it('titles the surface with Your plan and captions the plan facts', async () => {
    const ctx = buildCtx({}, [paygPurchase], 500)
    renderAccount(ctx, { plans: catalogPlans })
    await waitFor(() => {
      expect(document.querySelector('[data-solvapay-current-plan-card]')).toBeTruthy()
    })
    // Mirrors `Choose a plan` on checkout — same slot, same heading class.
    const title = screen.getByRole('heading', { name: 'Your plan' })
    expect(title.className).toContain('solvapay-mcp-heading')
    expect(screen.getByText('Rate')).toBeTruthy()
    expect(screen.getByText('Balance')).toBeTruthy()
  })

  it('renders CurrentPlanCard for a $0 Free purchase even when hasPaidPurchase is false', async () => {
    const ctx = buildCtx({}, [freePurchase], 0)
    expect(ctx.purchase.hasPaidPurchase).toBe(false)
    expect(ctx.purchase.activePurchase).toBe(freePurchase)
    renderAccount(ctx, { plans: catalogPlans })
    await waitFor(() => {
      expect(document.querySelector('[data-solvapay-current-plan-card]')).toBeTruthy()
    })
    expect(screen.getByRole('heading', { name: 'Free' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Pick a plan' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Credits' })).toBeNull()
  })

  it('renders Upgrade for a Free purchase with paid catalog alternatives and calls onChangePlan', async () => {
    const onChangePlan = vi.fn()
    const ctx = buildCtx({}, [freePurchase], 0)
    renderAccount(ctx, { plans: catalogPlans, onChangePlan })
    const button = await screen.findByRole('button', { name: 'Upgrade' })
    fireEvent.click(button)
    expect(onChangePlan).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: 'Change plan' })).toBeNull()
  })

  it('renders Change plan for a paid recurring purchase when the catalog has more than one plan', async () => {
    const onChangePlan = vi.fn()
    const ctx = buildCtx({}, [paidPurchase], 0)
    renderAccount(ctx, { plans: catalogPlans, onChangePlan })
    const button = await screen.findByRole('button', { name: 'Change plan' })
    fireEvent.click(button)
    expect(onChangePlan).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: 'Upgrade' })).toBeNull()
  })

  it('hides Upgrade and Change plan when the catalog has only one plan', async () => {
    const ctx = buildCtx({}, [paidPurchase], 0)
    renderAccount(ctx, {
      plans: [catalogPlans[2]!],
      onChangePlan: vi.fn(),
    })
    await screen.findByRole('link', { name: /manage account/i })
    expect(screen.queryByRole('button', { name: 'Upgrade' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Change plan' })).toBeNull()
  })

  it('renders Change plan, not Upgrade, for a thin PAYG snapshot matched to the catalog', async () => {
    const onChangePlan = vi.fn()
    const ctx = buildCtx({}, [paygPurchase], 0)
    renderAccount(ctx, { plans: catalogPlans, onChangePlan })
    const button = await screen.findByRole('button', { name: 'Change plan' })
    fireEvent.click(button)
    expect(onChangePlan).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: 'Upgrade' })).toBeNull()
  })
})
