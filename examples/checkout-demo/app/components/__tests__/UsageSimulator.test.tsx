import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { UsageSimulator } from '../UsageSimulator'

const mockAdjustBalance = vi.fn()
const mockBalanceRefetch = vi.fn()

vi.mock('@solvapay/react', () => ({
  useBalance: vi.fn(),
  usePurchase: vi.fn(),
}))

vi.mock('../../lib/supabase', () => ({
  getAccessToken: vi.fn(() => Promise.resolve('test-token')),
}))

import { useBalance, usePurchase } from '@solvapay/react'

const fetchMock = vi.fn()
global.fetch = fetchMock

function mockDefaults() {
  vi.mocked(useBalance).mockReturnValue({
    credits: 5000,
    loading: false,
    displayCurrency: 'USD',
    creditsPerMinorUnit: 100,
    refetch: mockBalanceRefetch,
    adjustBalance: mockAdjustBalance,
  })
  vi.mocked(usePurchase).mockReturnValue({
    activePurchase: {
      productRef: 'prd_TEST',
      productName: 'Test Product',
      planSnapshot: { creditsPerUnit: 1000 },
    },
    loading: false,
  } as any)
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

  it('calls POST /api/track-usage and adjusts balance on Run Query click', async () => {
    render(<UsageSimulator />)

    const button = screen.getByRole('button', { name: /run query/i })
    fireEvent.click(button)

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/track-usage', expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          'Authorization': 'Bearer test-token',
        }),
      }))
    })

    expect(mockAdjustBalance).toHaveBeenCalledWith(-1000)
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
    vi.mocked(useBalance).mockReturnValue({
      credits: 0,
      loading: false,
      displayCurrency: 'USD',
      creditsPerMinorUnit: 100,
      refetch: mockBalanceRefetch,
      adjustBalance: mockAdjustBalance,
    })

    render(<UsageSimulator />)

    expect(screen.getByText(/no credits remaining/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /top up/i })).toHaveAttribute('href', '/topup')
  })

  it('disables run query button when credits are zero', () => {
    vi.mocked(useBalance).mockReturnValue({
      credits: 0,
      loading: false,
      displayCurrency: 'USD',
      creditsPerMinorUnit: 100,
      refetch: mockBalanceRefetch,
      adjustBalance: mockAdjustBalance,
    })

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
