import { render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { CurrentPlanCard } from './CurrentPlanCard'
import { SolvaPayContext } from '../SolvaPayProvider'
import { paymentMethodCache } from '../hooks/usePaymentMethod'
import type { PurchaseInfo, SolvaPayContextValue, SolvaPayConfig } from '../types'
import type { PaymentMethodInfo } from '@solvapay/server'

function buildCtx(
  activePurchase: PurchaseInfo | null,
  overrides: Partial<SolvaPayContextValue & { config?: SolvaPayConfig }> = {},
): SolvaPayContextValue {
  const { config, ...rest } = overrides
  return {
    purchase: {
      loading: false,
      isRefetching: false,
      error: null,
      purchases: activePurchase ? [activePurchase] : [],
      hasProduct: () => false,
      activePurchase,
      hasPaidPurchase: !!activePurchase && (activePurchase.amount ?? 0) > 0,
      activePaidPurchase: activePurchase,
      balanceTransactions: [],
    },
    refetchPurchase: vi.fn(),
    createPayment: vi.fn(),
    createTopupPayment: vi.fn(),
    cancelRenewal: vi.fn(),
    reactivateRenewal: vi.fn(),
    activatePlan: vi.fn(),
    balance: {
      loading: false,
      credits: null,
      displayCurrency: null,
      creditsPerMinorUnit: null,
      displayExchangeRate: null,
      refetch: vi.fn(),
      adjustBalance: vi.fn(),
    },
    _config: config,
    ...rest,
  }
}

function makeTransport(
  overrides: Partial<SolvaPayConfig['transport']> = {},
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
    getPaymentMethod: vi
      .fn<[], Promise<PaymentMethodInfo>>()
      .mockResolvedValue({ kind: 'none' }),
    ...overrides,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
}

function Renderer({
  ctx,
  props,
}: {
  ctx: SolvaPayContextValue
  props?: Parameters<typeof CurrentPlanCard>[0]
}) {
  return (
    <SolvaPayContext.Provider value={ctx}>
      <CurrentPlanCard {...(props ?? {})} />
    </SolvaPayContext.Provider>
  )
}

const recurringPurchase: PurchaseInfo = {
  reference: 'purchase_abc',
  productName: 'Widget API',
  status: 'active',
  startDate: '2026-01-01T00:00:00Z',
  nextBillingDate: '2026-05-01T00:00:00Z',
  amount: 1999,
  currency: 'USD',
  planRef: 'plan_monthly',
  billingCycle: 'month',
  isRecurring: true,
  planSnapshot: { planType: 'recurring', reference: 'plan_monthly' },
}

const oneTimePurchase: PurchaseInfo = {
  reference: 'purchase_ot',
  productName: 'Widget API',
  status: 'active',
  startDate: '2026-01-01T00:00:00Z',
  endDate: '2026-12-31T00:00:00Z',
  amount: 9900,
  currency: 'USD',
  planRef: 'plan_lifetime',
  planSnapshot: { planType: 'one-time', reference: 'plan_lifetime' },
}

const usageBasedPurchase: PurchaseInfo = {
  reference: 'purchase_ub',
  productName: 'Widget API',
  status: 'active',
  startDate: '2026-01-01T00:00:00Z',
  amount: 0,
  currency: 'USD',
  planRef: 'plan_usage',
  planSnapshot: { planType: 'usage-based', reference: 'plan_usage' },
}

beforeEach(() => {
  paymentMethodCache.clear()
})

describe('CurrentPlanCard', () => {
  it('returns null when no active purchase exists', () => {
    const ctx = buildCtx(null, { config: { transport: makeTransport() } })
    const { container } = render(<Renderer ctx={ctx} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders recurring plan line with next billing date', async () => {
    const ctx = buildCtx(recurringPurchase, { config: { transport: makeTransport() } })
    render(<Renderer ctx={ctx} />)

    await screen.findByText('Your plan')
    expect(screen.getByText(/Next billing:/)).toBeTruthy()
    // Date formatted via toLocaleDateString — only assert it's not the literal "{date}" placeholder
    expect(screen.queryByText('Next billing: {date}')).toBeNull()
    // Legacy purchase (no planSnapshot.name) falls back to productName — never to planRef
    expect(screen.getByText('Widget API')).toBeTruthy()
    expect(screen.queryByText('plan_monthly')).toBeNull()
  })

  it('renders one-time plan line with Expires {date}', async () => {
    const ctx = buildCtx(oneTimePurchase, { config: { transport: makeTransport() } })
    render(<Renderer ctx={ctx} />)

    await screen.findByText(/Expires/)
  })

  it('renders usage-based plan without a date line', async () => {
    const ctx = buildCtx(usageBasedPurchase, {
      config: { transport: makeTransport() },
      balance: {
        loading: false,
        credits: 500,
        displayCurrency: 'USD',
        creditsPerMinorUnit: 1,
        displayExchangeRate: 1,
        refetch: vi.fn(),
        adjustBalance: vi.fn(),
      },
    })
    render(<Renderer ctx={ctx} />)

    await screen.findByText('Your plan')
    expect(screen.queryByText(/Next billing|Expires/)).toBeNull()
    // BalanceBadge container rendered
    expect(
      document.querySelector('[data-solvapay-current-plan-balance-line]'),
    ).toBeTruthy()
  })

  it('renders card payment-method line when the hook returns a card', async () => {
    const card: PaymentMethodInfo = {
      kind: 'card',
      brand: 'visa',
      last4: '4242',
      expMonth: 12,
      expYear: 2030,
    }
    const ctx = buildCtx(recurringPurchase, {
      config: { transport: makeTransport({ getPaymentMethod: vi.fn().mockResolvedValue(card) }) },
    })
    render(<Renderer ctx={ctx} />)

    await waitFor(() => {
      expect(screen.getByText(/•••• 4242/)).toBeTruthy()
    })
    expect(screen.getByText(/expires 12\/2030/)).toBeTruthy()
  })

  it('shows "No payment method on file" when the hook returns kind: none', async () => {
    const ctx = buildCtx(recurringPurchase, {
      config: {
        transport: makeTransport({
          getPaymentMethod: vi.fn().mockResolvedValue({ kind: 'none' }),
        }),
      },
    })
    render(<Renderer ctx={ctx} />)

    await screen.findByText('No payment method on file')
  })

  it('hides the payment-method line entirely when the transport method throws', async () => {
    const ctx = buildCtx(recurringPurchase, {
      config: {
        transport: makeTransport({
          getPaymentMethod: vi.fn().mockRejectedValue(new Error('endpoint unavailable')),
        }),
      },
    })
    render(<Renderer ctx={ctx} />)

    await screen.findByText('Your plan')
    // Wait a tick so the hook has time to flip to error state
    await waitFor(() => {
      expect(
        document.querySelector('[data-solvapay-current-plan-payment-method]'),
      ).toBeNull()
    })
  })

  it('renders the customer-currency price when originalAmount differs from amount', async () => {
    // 500 SEK charge: backend sends amount as USD cents (5426) and
    // originalAmount as SEK öre (50000). Without `originalAmount` the card
    // would render "SEK 54.26" (USD cents labelled SEK).
    const sekPurchase: PurchaseInfo = {
      reference: 'purchase_sek',
      productName: 'MCP pro',
      status: 'active',
      startDate: '2026-04-20T00:00:00Z',
      amount: 5426,
      originalAmount: 50000,
      currency: 'SEK',
      exchangeRate: 0.1085,
      planRef: 'plan_sek_monthly',
      billingCycle: 'month',
      isRecurring: true,
      planSnapshot: { planType: 'recurring', reference: 'plan_sek_monthly' },
    }
    const ctx = buildCtx(sekPurchase, { config: { transport: makeTransport() } })
    render(<Renderer ctx={ctx} />)

    await screen.findByText('Your plan')
    const price = document.querySelector('[data-solvapay-current-plan-price]')
    expect(price).toBeTruthy()
    const priceText = price?.textContent ?? ''
    expect(priceText).toContain('500')
    expect(priceText).not.toContain('54.26')
  })

  it('renders the SEK billing cycle as "/ month" rather than "/ monthly"', async () => {
    const sekPurchase: PurchaseInfo = {
      reference: 'purchase_sek_cycle',
      productName: 'MCP pro',
      status: 'active',
      startDate: '2026-04-20T00:00:00Z',
      amount: 5426,
      originalAmount: 50000,
      currency: 'SEK',
      planRef: 'pln_sek_m',
      billingCycle: 'monthly',
      isRecurring: true,
      planSnapshot: {
        planType: 'recurring',
        reference: 'pln_sek_m',
        name: 'Pro Monthly',
      },
    }
    const ctx = buildCtx(sekPurchase, { config: { transport: makeTransport() } })
    render(<Renderer ctx={ctx} />)

    await screen.findByText('Your plan')
    const price = document.querySelector('[data-solvapay-current-plan-price]')
    expect(price?.textContent).toContain('/ month')
    expect(price?.textContent).not.toContain('/ monthly')
  })

  it('falls back to planSnapshot.billingCycle when the top-level cycle is missing', async () => {
    // Bootstrap stamps the cycle on `planSnapshot.billingCycle` only — the
    // top-level field can be absent. Without the snapshot fallback the
    // price line would render "SEK 500" instead of "SEK 500 / month".
    const snapshotOnlyCycle: PurchaseInfo = {
      reference: 'purchase_snapshot_cycle',
      productName: 'MCP pro',
      status: 'active',
      startDate: '2026-04-20T00:00:00Z',
      amount: 5426,
      originalAmount: 50000,
      currency: 'SEK',
      planRef: 'pln_sek_m',
      isRecurring: true,
      planSnapshot: {
        planType: 'recurring',
        reference: 'pln_sek_m',
        name: 'Pro Monthly',
        billingCycle: 'month',
      },
    }
    const ctx = buildCtx(snapshotOnlyCycle, { config: { transport: makeTransport() } })
    render(<Renderer ctx={ctx} />)

    await screen.findByText('Your plan')
    const price = document.querySelector('[data-solvapay-current-plan-price]')
    expect(price?.textContent).toContain('/ month')
  })

  it('renders planSnapshot.name when present and falls back to productName when absent', async () => {
    const named: PurchaseInfo = {
      ...recurringPurchase,
      productName: 'Widget API',
      planSnapshot: {
        planType: 'recurring',
        reference: 'plan_monthly',
        name: 'Pro Monthly',
      },
    }
    const ctx = buildCtx(named, { config: { transport: makeTransport() } })
    const { rerender } = render(<Renderer ctx={ctx} />)

    await screen.findByText('Pro Monthly')
    // Opaque planRef must never appear in visible text
    expect(screen.queryByText('plan_monthly')).toBeNull()
    // When plan name differs from product name, product name renders as context
    expect(screen.getByText('Widget API')).toBeTruthy()
    const root = document.querySelector('[data-solvapay-current-plan-card]')
    expect(root?.getAttribute('data-solvapay-current-plan-ref')).toBe('plan_monthly')

    // Legacy purchase — no snapshot name — falls back to productName
    const legacyCtx = buildCtx(recurringPurchase, {
      config: { transport: makeTransport() },
    })
    rerender(<Renderer ctx={legacyCtx} />)
    await screen.findByText('Widget API')
    expect(screen.queryByText('plan_monthly')).toBeNull()
  })

  it('renders the plan-name line unconditionally for every plan type', async () => {
    for (const p of [recurringPurchase, oneTimePurchase, usageBasedPurchase]) {
      const ctx = buildCtx(p, { config: { transport: makeTransport() } })
      const { unmount } = render(<Renderer ctx={ctx} />)
      await screen.findByText('Your plan')
      expect(document.querySelector('[data-solvapay-current-plan-name]')).toBeTruthy()
      unmount()
    }
  })

  it('does not render when the only purchase is a credit top-up', () => {
    const topup: PurchaseInfo = {
      reference: 'pur_topup',
      productName: 'Credits',
      status: 'active',
      startDate: '2026-01-01T00:00:00Z',
      amount: 10000,
      currency: 'SEK',
      metadata: { purpose: 'credit_topup' },
    }
    // Simulate provider-level filtering: balance transactions never become
    // the activePurchase, so the card receives null.
    const ctx = buildCtx(null, {
      config: { transport: makeTransport() },
      purchase: {
        loading: false,
        isRefetching: false,
        error: null,
        purchases: [topup],
        hasProduct: () => false,
        activePurchase: null,
        hasPaidPurchase: false,
        activePaidPurchase: null,
        balanceTransactions: [topup],
      },
    })
    const { container } = render(<Renderer ctx={ctx} />)
    expect(container.firstChild).toBeNull()
  })

  it('honours hidePaymentMethod and hideCancelButton / hideUpdatePaymentButton', async () => {
    const card: PaymentMethodInfo = {
      kind: 'card',
      brand: 'visa',
      last4: '4242',
      expMonth: 12,
      expYear: 2030,
    }
    const ctx = buildCtx(recurringPurchase, {
      config: { transport: makeTransport({ getPaymentMethod: vi.fn().mockResolvedValue(card) }) },
    })
    render(
      <Renderer
        ctx={ctx}
        props={{
          hidePaymentMethod: true,
          hideCancelButton: true,
          hideUpdatePaymentButton: true,
        }}
      />,
    )

    await screen.findByText('Your plan')
    expect(screen.queryByText(/•••• 4242/)).toBeNull()
    expect(screen.queryByText('Cancel plan')).toBeNull()
    expect(screen.queryByText('Update card')).toBeNull()
  })
})
