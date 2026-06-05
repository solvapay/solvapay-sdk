import { render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import React from 'react'
import { McpAccountView } from '../McpAccountView'
import { SolvaPayContext } from '../../../SolvaPayProvider'
import type { SolvaPayContextValue, SolvaPayConfig, PurchaseInfo } from '../../../types'

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
  return {
    purchase: {
      loading: false,
      isRefetching: false,
      error: null,
      purchases,
      hasProduct: () => purchases.length > 0,
      activePurchase: paid,
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
    balance: {
      loading: false,
      credits,
      displayCurrency: null,
      creditsPerMinorUnit: null,
      displayExchangeRate: null,
      refetch: vi.fn(),
      adjustBalance: vi.fn(),
    },
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

const paidPurchase: PurchaseInfo = {
  reference: 'pur_abc',
  productName: 'Widget API',
  status: 'active',
  startDate: '2026-01-01T00:00:00Z',
  amount: 1999,
  currency: 'USD',
  isRecurring: true,
  planSnapshot: { planType: 'recurring', reference: 'pln_monthly' },
}

describe('McpAccountView', () => {
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

  it('renders the portal hint fine-print under the plan card on a paid plan', async () => {
    const ctx = buildCtx({}, [paidPurchase], 0)
    renderAccount(ctx)
    await screen.findByRole('link', { name: /manage account/i })
    expect(
      screen.getByText('Click Manage account to update your card or cancel your plan.'),
    ).toBeTruthy()
    expect(document.querySelector('[data-solvapay-mcp-portal-hint]')).toBeTruthy()
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

  it('renders Started … and the purchase reference inside the plan card on a paid plan', async () => {
    const ctx = buildCtx({}, [paidPurchase], 0)
    renderAccount(ctx)
    await waitFor(() => {
      expect(document.querySelector('[data-solvapay-current-plan-started-line]')).toBeTruthy()
      expect(document.querySelector('[data-solvapay-current-plan-reference]')?.textContent).toBe(
        'pur_abc',
      )
    })
  })

  it('does not render a standalone Credit balance hero section above the plan card', () => {
    const ctx = buildCtx({}, [], 500)
    renderAccount(ctx)
    expect(screen.queryByRole('region', { name: 'Credit balance' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Credit balance' })).toBeNull()
  })
})
