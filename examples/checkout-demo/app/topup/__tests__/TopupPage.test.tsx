import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import {
  displayMajorFromCredits,
  topupDisplayDriftMinorUnits,
} from '../../lib/credit-display'
import TopupPage from '../page'

const mockAdjustBalance = vi.fn()

vi.mock('@solvapay/react', () => ({
  useBalance: vi.fn(),
  AutoRecharge: () => null,
}))

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
  StyledTopupForm: ({ onSuccess }: { onSuccess: () => void }) => (
    <button type="button" onClick={onSuccess}>
      Trigger payment success
    </button>
  ),
}))

import { useBalance } from '@solvapay/react'

function mockBalance(
  overrides: Partial<ReturnType<typeof useBalance>> = {},
) {
  vi.mocked(useBalance).mockReturnValue({
    credits: 0,
    loading: false,
    displayCurrency: 'SEK',
    creditsPerMinorUnit: 100,
    displayExchangeRate: 9.46,
    refetch: vi.fn(),
    adjustBalance: mockAdjustBalance,
    ...overrides,
  })
}

async function completeTopupFlow() {
  render(<TopupPage />)
  fireEvent.click(screen.getByRole('button', { name: 'Pick 100' }))
  fireEvent.click(screen.getByRole('button', { name: 'Continue to payment' }))
  fireEvent.click(screen.getByRole('button', { name: 'Trigger payment success' }))
}

describe('TopupPage optimistic balance adjustment', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockBalance()
  })

  it('adjusts balance by FX-adjusted credits for SEK top-up, not raw minor units', async () => {
    await completeTopupFlow()

    expect(mockAdjustBalance).toHaveBeenCalledWith(105_708)
    expect(mockAdjustBalance).not.toHaveBeenCalledWith(1_000_000)
  })

  it('adjusts balance for USD top-up at rate 1', async () => {
    mockBalance({
      displayCurrency: 'USD',
      displayExchangeRate: 1,
    })

    render(<TopupPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Pick 100' }))
    fireEvent.click(screen.getByRole('button', { name: 'Continue to payment' }))
    fireEvent.click(screen.getByRole('button', { name: 'Trigger payment success' }))

    expect(mockAdjustBalance).toHaveBeenCalledWith(1_000_000)
  })

  it('adjusts balance for JPY zero-decimal top-up using displayExchangeRate', async () => {
    mockBalance({
      displayCurrency: 'JPY',
      displayExchangeRate: 150,
    })

    render(<TopupPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Pick 100' }))
    fireEvent.click(screen.getByRole('button', { name: 'Continue to payment' }))
    fireEvent.click(screen.getByRole('button', { name: 'Trigger payment success' }))

    expect(mockAdjustBalance).toHaveBeenCalledWith(
      Math.floor((10_000 / 150) * 100),
    )
  })

  it('falls back to rate 1 when displayExchangeRate is undefined', async () => {
    mockBalance({
      displayCurrency: 'USD',
      displayExchangeRate: undefined,
    })

    await completeTopupFlow()

    expect(mockAdjustBalance).toHaveBeenCalledWith(1_000_000)
    expect(Number.isNaN(mockAdjustBalance.mock.calls[0][0])).toBe(false)
  })
})

describe('TopupPage topped-up amount vs available balance', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockBalance()
  })

  it('credits added on SEK success display as equivalent to the 100 SEK topped up', async () => {
    await completeTopupFlow()

    const addedCredits = mockAdjustBalance.mock.calls[0][0] as number
    const drift = topupDisplayDriftMinorUnits({
      toppedUpAmountMajor: 100,
      credits: addedCredits,
      displayCurrency: 'SEK',
      creditsPerMinorUnit: 100,
      displayExchangeRate: 9.46,
    })

    expect(drift).not.toBeNull()
    expect(Math.round(drift! * 100) / 100).toBeLessThanOrEqual(1)

    const availableMajor = displayMajorFromCredits({
      credits: addedCredits,
      displayCurrency: 'SEK',
      creditsPerMinorUnit: 100,
      displayExchangeRate: 9.46,
    })
    expect(availableMajor).toBeGreaterThan(99)
    expect(availableMajor).toBeLessThanOrEqual(100)
  })

  it('credits added on USD success display as equivalent to the 100 USD topped up', async () => {
    mockBalance({
      displayCurrency: 'USD',
      displayExchangeRate: 1,
    })

    render(<TopupPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Pick 100' }))
    fireEvent.click(screen.getByRole('button', { name: 'Continue to payment' }))
    fireEvent.click(screen.getByRole('button', { name: 'Trigger payment success' }))

    const addedCredits = mockAdjustBalance.mock.calls[0][0] as number
    const drift = topupDisplayDriftMinorUnits({
      toppedUpAmountMajor: 100,
      credits: addedCredits,
      displayCurrency: 'USD',
      creditsPerMinorUnit: 100,
      displayExchangeRate: 1,
    })

    expect(drift).toBe(0)
    expect(displayMajorFromCredits({
      credits: addedCredits,
      displayCurrency: 'USD',
      creditsPerMinorUnit: 100,
      displayExchangeRate: 1,
    })).toBe(100)
  })
})
