import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import type {
  BalanceStatus,
  PurchaseStatus,
  PurchaseStatusReturn,
  UsePlansReturn,
} from '@solvapay/react'
import { formatCreditCurrencyEquivalent } from '../lib/credit-display'
import HomePage from '../page'

vi.mock('@solvapay/react', () => ({
  usePurchase: vi.fn(),
  usePlans: vi.fn(),
  usePurchaseStatus: vi.fn(),
  useBalance: vi.fn(),
}))

vi.mock('../components/UsageSimulator', () => ({
  UsageSimulator: () => null,
}))

import { usePurchase, usePlans, usePurchaseStatus, useBalance } from '@solvapay/react'

type PurchaseHookValue = PurchaseStatus & { refetch: () => Promise<void> }

function mockBalance(overrides: Partial<BalanceStatus> = {}): BalanceStatus {
  return {
    credits: 31_500,
    loading: false,
    displayCurrency: 'SEK',
    creditsPerMinorUnit: 100,
    displayExchangeRate: 9.46,
    display: null,
    refetch: vi.fn(),
    adjustBalance: vi.fn(),
    reconcileAfterUsageDebit: vi.fn(),
    ...overrides,
  }
}

function mockPurchase(): PurchaseHookValue {
  return {
    loading: false,
    isRefetching: false,
    error: null,
    purchases: [],
    hasProduct: () => false,
    activePurchase: null,
    hasPaidPurchase: false,
    activePaidPurchase: null,
    balanceTransactions: [],
    refetch: vi.fn().mockResolvedValue(undefined),
  }
}

function mockPlans(): UsePlansReturn {
  return {
    loading: false,
    plans: [],
    error: null,
    selectedPlanIndex: -1,
    selectedPlan: null,
    setSelectedPlanIndex: vi.fn(),
    selectPlan: vi.fn(),
    refetch: vi.fn().mockResolvedValue(undefined),
    isSelectionReady: true,
  }
}

function mockPurchaseStatus(): PurchaseStatusReturn {
  return {
    cancelledPurchase: null,
    shouldShowCancelledNotice: false,
    formatDate: (d?: string) => d ?? null,
    getDaysUntilExpiration: () => null,
  }
}

function mockDefaults(balanceOverrides: Partial<BalanceStatus> = {}) {
  vi.mocked(useBalance).mockReturnValue(mockBalance(balanceOverrides))
  vi.mocked(usePurchase).mockReturnValue(mockPurchase())
  vi.mocked(usePlans).mockReturnValue(mockPlans())
  vi.mocked(usePurchaseStatus).mockReturnValue(mockPurchaseStatus())
}

describe('HomePage credit balance card', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDefaults()
  })

  it('shows FX-adjusted SEK equivalent for credits, not the USD value mislabeled as SEK', () => {
    render(<HomePage />)

    const balanceCard = screen.getByText('Credit balance').closest('div')
    expect(balanceCard?.textContent).toMatch(/~/)
    expect(balanceCard?.textContent).toMatch(/29/)
    expect(balanceCard?.textContent).not.toMatch(/3\.15/)
  })

  it('shows USD equivalent when display currency is USD with rate 1', () => {
    mockDefaults({
      credits: 31_500,
      displayCurrency: 'USD',
      displayExchangeRate: 1,
    })

    render(<HomePage />)

    expect(screen.getByText(/~\$3\.15/)).toBeInTheDocument()
  })

  it('shows whole-yen equivalent for JPY (zero-decimal currency)', () => {
    mockDefaults({
      credits: 10_000,
      displayCurrency: 'JPY',
      displayExchangeRate: 150,
    })

    render(<HomePage />)

    const balanceCard = screen.getByText('Credit balance').closest('div')
    const expected = formatCreditCurrencyEquivalent({
      credits: 10_000,
      displayCurrency: 'JPY',
      creditsPerMinorUnit: 100,
      displayExchangeRate: 150,
    })
    expect(expected).not.toMatch(/\.\d/)
    expect(balanceCard?.textContent).toContain(expected)
  })

  it('renders "No credits yet" when credits are zero and omits currency equivalent', () => {
    mockDefaults({ credits: 0 })

    render(<HomePage />)

    expect(screen.getByText('No credits yet')).toBeInTheDocument()
    expect(screen.queryByText(/^~$/)).not.toBeInTheDocument()
  })

  it('renders "No credits yet" when credits are null and omits currency equivalent', () => {
    mockDefaults({ credits: null })

    render(<HomePage />)

    expect(screen.getByText('No credits yet')).toBeInTheDocument()
  })

  it('omits currency equivalent when creditsPerMinorUnit is missing', () => {
    mockDefaults({ creditsPerMinorUnit: null })

    render(<HomePage />)

    const balanceCard = screen.getByText('Credit balance').closest('div')
    expect(balanceCard).not.toBeNull()
    expect(balanceCard?.textContent).toContain('31,500 credits')
    expect(balanceCard?.textContent).not.toMatch(/~/)
  })

  it('falls back to rate 1 when displayExchangeRate is null', () => {
    mockDefaults({
      credits: 10_000,
      displayCurrency: 'USD',
      displayExchangeRate: null,
    })

    render(<HomePage />)

    expect(screen.getByText(/~\$1\.00/)).toBeInTheDocument()
  })
})
