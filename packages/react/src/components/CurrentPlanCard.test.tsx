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
    expect(screen.getByText('plan_monthly')).toBeTruthy()
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
