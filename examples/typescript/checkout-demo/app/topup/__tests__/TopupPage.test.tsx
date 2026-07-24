import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import TopupPage from '../page'

const mockRefetch = vi.fn().mockResolvedValue(undefined)
const mockRefreshAutoRecharge = vi.fn().mockResolvedValue(undefined)

vi.mock('@solvapay/react', async importOriginal => {
  const actual = await importOriginal<typeof import('@solvapay/react')>()
  return {
    ...actual,
    useBalance: vi.fn(),
    useAutoRecharge: vi.fn(),
    AutoRecharge: ({
      onPendingConfig,
    }: {
      onPendingConfig?: (payload: {
        enabled: boolean
        triggerType: 'balance'
        thresholdAmountMajor: number
        topupAmountMajor: number
        currency: string
      }) => void
    }) => (
      <button
        type="button"
        onClick={() =>
          onPendingConfig?.({
            enabled: true,
            triggerType: 'balance',
            thresholdAmountMajor: 5,
            topupAmountMajor: 10,
            currency: 'SEK',
          })
        }
      >
        Save auto-recharge
      </button>
    ),
  }
})

vi.mock('@solvapay/react/primitives', () => ({
  AmountPicker: {
    Root: ({
      children,
      onChange,
    }: {
      children: React.ReactNode
      onChange: (amount: number | null) => void
    }) => (
      <div data-testid="amount-picker">
        <button type="button" onClick={() => onChange(100)}>
          Pick 100
        </button>
        {children}
      </div>
    ),
    Option: () => null,
    Custom: () => null,
  },
}))

vi.mock('../components/StyledTopupForm', () => ({
  StyledTopupForm: ({
    onSuccess,
    autoRecharge,
  }: {
    onSuccess: () => void
    autoRecharge?: { enabled: boolean; topupAmountMajor?: number }
  }) => (
    <div>
      {autoRecharge?.enabled ? (
        <span data-testid="auto-recharge-payload">auto-recharge-enabled</span>
      ) : null}
      <button type="button" onClick={onSuccess}>
        Trigger payment success
      </button>
    </div>
  ),
}))

import { useAutoRecharge, useBalance } from '@solvapay/react'

function mockAutoRecharge(
  overrides: Partial<ReturnType<typeof useAutoRecharge>> = {},
) {
  vi.mocked(useAutoRecharge).mockReturnValue({
    config: null,
    loading: false,
    saving: false,
    disabling: false,
    error: null,
    refresh: mockRefreshAutoRecharge,
    save: vi.fn(),
    disable: vi.fn(),
    ...overrides,
  })
}

function mockBalance(
  overrides: Partial<ReturnType<typeof useBalance>> = {},
) {
  vi.mocked(useBalance).mockReturnValue({
    credits: 0,
    loading: false,
    displayCurrency: 'SEK',
    creditsPerMinorUnit: 100,
    displayExchangeRate: 9.46,
    refetch: mockRefetch,
    adjustBalance: vi.fn(),
    reconcileAfterUsageDebit: vi.fn(),
    ...overrides,
  })
}

async function completeTopupFlow() {
  render(<TopupPage />)
  fireEvent.click(screen.getByRole('button', { name: 'Save auto-recharge' }))
  fireEvent.click(screen.getByRole('button', { name: 'Pick 100' }))
  fireEvent.click(screen.getByRole('button', { name: 'Continue to payment' }))
  fireEvent.click(screen.getByRole('button', { name: 'Trigger payment success' }))
}

describe('TopupPage payment success', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockBalance()
    mockAutoRecharge()
  })

  it('refetches balance from server on payment success instead of optimistic adjust', async () => {
    await completeTopupFlow()

    await waitFor(() => {
      expect(mockRefetch).toHaveBeenCalledTimes(1)
    })
  })

  it('shows success state after payment', async () => {
    await completeTopupFlow()

    expect(screen.getByText('Top-up successful!')).toBeInTheDocument()
  })

  it('passes pending auto-recharge config to the payment step without a SetupIntent step', async () => {
    render(<TopupPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Save auto-recharge' }))
    fireEvent.click(screen.getByRole('button', { name: 'Pick 100' }))
    fireEvent.click(screen.getByRole('button', { name: 'Continue to payment' }))

    expect(screen.getByTestId('auto-recharge-payload')).toBeInTheDocument()
  })

  it('hydrates auto-recharge on payment from server config when pending state was lost', () => {
    mockAutoRecharge({
      config: {
        enabled: true,
        trigger: { type: 'balance', thresholdAmountMinor: 4500 },
        topup: { mode: 'fixed', amountMinor: 1000, currency: 'SEK' },
        status: 'pending_setup',
        failureCount: 0,
        display: {
          thresholdAmountMajor: 45,
          topupAmountMajor: 10,
          currency: 'SEK',
          formatted: { threshold: 'kr45', topup: 'kr10' },
          exchangeRate: 9.46,
          rateSource: 'db',
        },
      },
    })

    render(<TopupPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Pick 100' }))
    fireEvent.click(screen.getByRole('button', { name: 'Continue to payment' }))

    expect(screen.getByTestId('auto-recharge-payload')).toBeInTheDocument()
  })
})
