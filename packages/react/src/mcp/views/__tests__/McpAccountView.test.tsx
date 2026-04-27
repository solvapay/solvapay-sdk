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

  it('renders the pay-as-you-go copy when there is no plan but credits exist', () => {
    const ctx = buildCtx({}, [], 500)
    renderAccount(ctx)
    expect(screen.getByText(/pay-as-you-go credits/)).toBeTruthy()
  })

  it('renders the no-plan fallback when there are no purchases and no credits', () => {
    const ctx = buildCtx({}, [], 0)
    renderAccount(ctx)
    expect(screen.getByText("You don't have an active plan")).toBeTruthy()
  })

  it('does not render the fallback copy when there is a paid purchase', async () => {
    const ctx = buildCtx({}, [paidPurchase], 0)
    renderAccount(ctx)
    await waitFor(() => {
      expect(screen.queryByText("You don't have an active plan")).toBeNull()
      expect(screen.queryByText(/pay-as-you-go credits/)).toBeNull()
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
    // Wait for the portal-session fetch to settle so any stragglers
    // would have rendered.
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
    // Defensive case: hasPaidPurchase is true but the active purchase has
    // a zero amount (free plan, edge data). The hint and the button must
    // share the same gate or the hint points at a button that never
    // renders.
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

  it('leads with the product header sourced from the product prop', () => {
    const ctx = buildCtx({}, [paidPurchase], 0)
    renderAccount(ctx, {
      product: { name: 'Acme Pro', description: 'Pro-tier API for Acme.' },
    })
    expect(screen.getByRole('heading', { level: 1, name: 'Acme Pro' })).toBeTruthy()
    expect(screen.getByText('Pro-tier API for Acme.')).toBeTruthy()
  })

  it('falls back to the active purchase product name when no product prop is passed', () => {
    const ctx = buildCtx({}, [paidPurchase], 0)
    renderAccount(ctx)
    expect(screen.getByRole('heading', { level: 1, name: 'Widget API' })).toBeTruthy()
  })

  it('always renders the CURRENT PLAN AND USAGE section label, even with no plan and no credits', () => {
    const ctx = buildCtx({}, [], 0)
    renderAccount(ctx)
    expect(document.querySelector('[data-solvapay-mcp-section-label]')?.textContent).toBe(
      'Current plan and usage',
    )
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
    // The pre-refactor view rendered an `<section aria-label="Credit balance">`
    // hero with a heading and inline Top up. The refactor folds the credit
    // state into the same plan card via the pay-as-you-go branch, so the
    // standalone section is gone. The Customer details sidebar still carries a
    // muted "Credit balance" detail label — that's separate.
    const ctx = buildCtx({}, [], 500)
    renderAccount(ctx)
    expect(screen.queryByRole('region', { name: 'Credit balance' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Credit balance' })).toBeNull()
  })

  it('renders the refresh icon button only when onRefresh is provided', () => {
    const ctx = buildCtx({}, [], 0)
    const { rerender } = renderAccount(ctx)
    expect(screen.queryByRole('button', { name: 'Refresh' })).toBeNull()
    const onRefresh = vi.fn()
    rerender(
      <SolvaPayContext.Provider value={ctx}>
        <McpAccountView onRefresh={onRefresh} />
      </SolvaPayContext.Provider>,
    )
    const button = screen.getByRole('button', { name: 'Refresh' })
    button.click()
    expect(onRefresh).toHaveBeenCalledTimes(1)
  })
})
