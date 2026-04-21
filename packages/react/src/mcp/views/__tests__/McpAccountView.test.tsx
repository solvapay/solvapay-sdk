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

function renderAccount(ctx: SolvaPayContextValue) {
  return render(
    <SolvaPayContext.Provider value={ctx}>
      <McpAccountView />
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

  it('renders a Manage billing button backed by the customer portal transport', async () => {
    const ctx = buildCtx({}, [], 0)
    renderAccount(ctx)
    const link = await screen.findByRole('link', { name: /manage billing/i })
    expect(link.getAttribute('href')).toBe('https://portal.test')
    expect(link.getAttribute('target')).toBe('_blank')
  })
})
