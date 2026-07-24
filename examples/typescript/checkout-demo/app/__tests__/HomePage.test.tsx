import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
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

function mockDefaults(balanceOverrides: Partial<ReturnType<typeof useBalance>> = {}) {
  vi.mocked(useBalance).mockReturnValue({
    credits: 31_500,
    loading: false,
    displayCurrency: 'SEK',
    creditsPerMinorUnit: 100,
    displayExchangeRate: 9.46,
    refetch: vi.fn(),
    adjustBalance: vi.fn(),
    ...balanceOverrides,
  })
  vi.mocked(usePurchase).mockReturnValue({
    loading: false,
    activePurchase: null,
  } as ReturnType<typeof usePurchase>)
  vi.mocked(usePlans).mockReturnValue({
    loading: false,
    plans: [],
  } as ReturnType<typeof usePlans>)
  vi.mocked(usePurchaseStatus).mockReturnValue({
    cancelledPurchase: null,
    shouldShowCancelledNotice: false,
    formatDate: (d: string) => d,
    getDaysUntilExpiration: () => null,
  } as ReturnType<typeof usePurchaseStatus>)
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

  it('falls back to rate 1 when displayExchangeRate is undefined', () => {
    mockDefaults({
      credits: 10_000,
      displayCurrency: 'USD',
      displayExchangeRate: undefined,
    })

    render(<HomePage />)

    expect(screen.getByText(/~\$1\.00/)).toBeInTheDocument()
  })
})
