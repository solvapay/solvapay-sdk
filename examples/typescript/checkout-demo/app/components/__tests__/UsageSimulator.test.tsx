import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { BalanceStatus, PurchaseInfo, PurchaseStatus, UsePlansReturn } from '@solvapay/react'
import { UsageSimulator } from '../UsageSimulator'

const mockAdjustBalance = vi.fn()
const mockBalanceRefetch = vi.fn()
const mockReconcileAfterUsageDebit = vi.fn()

vi.mock('@solvapay/react', () => ({
  useBalance: vi.fn(),
  usePurchase: vi.fn(),
  usePlans: vi.fn(),
}))

vi.mock('../../lib/supabase', () => ({
  getAccessToken: vi.fn(() => Promise.resolve('test-token')),
}))

import { useBalance, usePurchase, usePlans } from '@solvapay/react'

const fetchMock = vi.fn()
global.fetch = fetchMock

type PurchaseHookValue = PurchaseStatus & { refetch: () => Promise<void> }

function mockBalance(overrides: Partial<BalanceStatus> = {}): BalanceStatus {
  return {
    credits: 5000,
    loading: false,
    displayCurrency: 'USD',
    creditsPerMinorUnit: 100,
    displayExchangeRate: 1,
    display: null,
    refetch: mockBalanceRefetch,
    adjustBalance: mockAdjustBalance,
    reconcileAfterUsageDebit: mockReconcileAfterUsageDebit,
    ...overrides,
  }
}

function mockPurchase(
  overrides: Omit<Partial<PurchaseHookValue>, 'activePurchase'> & {
    activePurchase?: Partial<PurchaseInfo> | null
  } = {},
): PurchaseHookValue {
  const { activePurchase: activePurchaseOverride, ...rest } = overrides
  const activePurchase =
    activePurchaseOverride === null
      ? null
      : ({
          reference: 'pur_TEST',
          productName: 'Test Product',
          productRef: 'prd_TEST',
          status: 'active',
          startDate: '2026-01-01T00:00:00.000Z',
          planSnapshot: { creditsPerUnit: 1000 },
          ...activePurchaseOverride,
        } satisfies PurchaseInfo)

  return {
    loading: false,
    isRefetching: false,
    error: null,
    purchases: activePurchase ? [activePurchase] : [],
    hasProduct: () => Boolean(activePurchase),
    activePurchase,
    hasPaidPurchase: Boolean(activePurchase),
    activePaidPurchase: activePurchase,
    balanceTransactions: [],
    refetch: vi.fn().mockResolvedValue(undefined),
    ...rest,
  }
}

function mockDefaults() {
  vi.mocked(useBalance).mockReturnValue(mockBalance())
  vi.mocked(usePurchase).mockReturnValue(mockPurchase())
  vi.mocked(usePlans).mockReturnValue({
    plans: [{ reference: 'pln_payg', type: 'usage-based', creditsPerUnit: 1000 }],
    loading: false,
    error: null,
    selectedPlanIndex: 0,
    selectedPlan: { reference: 'pln_payg', type: 'usage-based', creditsPerUnit: 1000 },
    setSelectedPlanIndex: vi.fn(),
    selectPlan: vi.fn(),
    refetch: vi.fn().mockResolvedValue(undefined),
    isSelectionReady: true,
  } satisfies UsePlansReturn)
}

describe('UsageSimulator', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDefaults()
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true }),
    })
  })

  it('renders the simulator with search input and run query button', () => {
    render(<UsageSimulator />)

    expect(screen.getByText('Usage Simulator')).toBeInTheDocument()
    expect(screen.getByRole('textbox')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /run query/i })).toBeInTheDocument()
  })

  it('displays current credit balance', () => {
    render(<UsageSimulator />)

    expect(screen.getByText(/5,000/)).toBeInTheDocument()
  })

  it('calls POST /api/track-usage with outcome success', async () => {
    render(<UsageSimulator />)

    fireEvent.click(screen.getByRole('button', { name: /run query/i }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/track-usage',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            Authorization: 'Bearer test-token',
          }),
        }),
      )
    })

    const callBody = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(callBody.outcome).toBe('success')
  })

  it('adjusts balance after server confirms credit debit, not before fetch', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          success: true,
          creditDebit: { debited: true, amount: 1000, unitsRemaining: 4 },
        }),
    })

    render(<UsageSimulator />)
    fireEvent.click(screen.getByRole('button', { name: /run query/i }))

    expect(mockAdjustBalance).not.toHaveBeenCalled()

    await waitFor(() => {
      expect(mockAdjustBalance).toHaveBeenCalledTimes(1)
      expect(mockAdjustBalance).toHaveBeenCalledWith(-1000)
      expect(mockReconcileAfterUsageDebit).toHaveBeenCalledTimes(1)
      expect(mockReconcileAfterUsageDebit).toHaveBeenCalledWith({ expectIncrease: false })
      expect(mockBalanceRefetch).toHaveBeenCalledTimes(1)
    })
  })

  it('does not invent a balance decrement when the server reports debited:false', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          success: true,
          creditDebit: { debited: false, reason: 'no_active_purchase' },
        }),
    })

    render(<UsageSimulator />)
    fireEvent.click(screen.getByRole('button', { name: /run query/i }))

    await waitFor(() => {
      expect(mockAdjustBalance).not.toHaveBeenCalled()
      expect(mockBalanceRefetch).toHaveBeenCalledTimes(1)
      expect(mockReconcileAfterUsageDebit).not.toHaveBeenCalled()
    })
  })

  it('forwards autoRecharge.triggered to reconcileAfterUsageDebit', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          success: true,
          creditDebit: {
            debited: true,
            amount: 1000,
            unitsRemaining: 4,
            autoRecharge: { triggered: true },
          },
        }),
    })

    render(<UsageSimulator />)
    fireEvent.click(screen.getByRole('button', { name: /run query/i }))

    await waitFor(() => {
      expect(mockAdjustBalance).toHaveBeenCalledWith(-1000)
      expect(mockReconcileAfterUsageDebit).toHaveBeenCalledWith({ expectIncrease: true })
    })
  })

  it('increments session query counter after each run', async () => {
    render(<UsageSimulator />)

    const button = screen.getByRole('button', { name: /run query/i })
    fireEvent.click(button)

    await waitFor(() => {
      expect(screen.getByText(/queries this session/i)).toHaveTextContent('1')
    })
  })

  it('shows paywall state when credits are zero', () => {
    vi.mocked(useBalance).mockReturnValue(mockBalance({ credits: 0 }))

    render(<UsageSimulator />)

    expect(screen.getByText(/no credits remaining/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /top up/i })).toHaveAttribute('href', '/topup')
  })

  it('disables run query button when credits are zero', () => {
    vi.mocked(useBalance).mockReturnValue(mockBalance({ credits: 0 }))

    render(<UsageSimulator />)

    const button = screen.getByRole('button', { name: /run query/i })
    expect(button).toBeDisabled()
  })

  it('sends the query text in metadata', async () => {
    render(<UsageSimulator />)

    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: 'What is vector search?' } })

    const button = screen.getByRole('button', { name: /run query/i })
    fireEvent.click(button)

    await waitFor(() => {
      const callBody = JSON.parse(fetchMock.mock.calls[0][1].body)
      expect(callBody.description).toBe('What is vector search?')
      expect(callBody.metadata.query).toBe('What is vector search?')
    })
  })

  it('falls back to PAYG meter when subscription snapshot has creditsPerUnit 0', () => {
    vi.mocked(usePurchase).mockReturnValue(
      mockPurchase({
        activePurchase: {
          productName: 'Subscription',
          planSnapshot: { creditsPerUnit: 0, planType: 'recurring' },
        },
      }),
    )

    render(<UsageSimulator />)

    expect(screen.getByText('1,000')).toBeInTheDocument()
  })

  it('shows error state when API call fails', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: 'Insufficient credits' }),
    })

    render(<UsageSimulator />)

    const button = screen.getByRole('button', { name: /run query/i })
    fireEvent.click(button)

    await waitFor(() => {
      expect(screen.getByText(/failed/i)).toBeInTheDocument()
    })
  })
})
