import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import React from 'react'

vi.mock('@solvapay/react', () => ({
  usePurchase: vi.fn(),
  usePurchaseStatus: vi.fn(),
}))

vi.mock('../lib/supabase', () => ({
  getAccessToken: vi.fn(() => Promise.resolve('test-token')),
}))

import { usePurchase, usePurchaseStatus } from '@solvapay/react'
import { releaseCheckoutLock } from '../lib/checkout-guard'
import HomePage from '../page'

const fetchMock = vi.fn()
global.fetch = fetchMock

function mockFreeUser() {
  vi.mocked(usePurchase).mockReturnValue({
    loading: false,
    hasPaidPurchase: false,
    activePurchase: null,
    refetch: vi.fn().mockResolvedValue(undefined),
  } as ReturnType<typeof usePurchase>)
  vi.mocked(usePurchaseStatus).mockReturnValue({
    cancelledPurchase: null,
    shouldShowCancelledNotice: false,
    formatDate: vi.fn((d: string) => d),
    getDaysUntilExpiration: vi.fn(() => null),
  } as ReturnType<typeof usePurchaseStatus>)
}

function mockPaidUser() {
  vi.mocked(usePurchase).mockReturnValue({
    loading: false,
    hasPaidPurchase: true,
    activePurchase: { productRef: 'prd_TEST', productName: 'Pro Plan' },
    refetch: vi.fn().mockResolvedValue(undefined),
  } as ReturnType<typeof usePurchase>)
  vi.mocked(usePurchaseStatus).mockReturnValue({
    cancelledPurchase: null,
    shouldShowCancelledNotice: false,
    formatDate: vi.fn((d: string) => d),
    getDaysUntilExpiration: vi.fn(() => null),
  } as ReturnType<typeof usePurchaseStatus>)
}

beforeEach(() => {
  vi.clearAllMocks()
  releaseCheckoutLock()
  process.env.NEXT_PUBLIC_PRODUCT_REF = 'prd_smoke'
  mockFreeUser()
  // Never resolves — keeps lock held so window.location is never assigned
  fetchMock.mockReturnValue(new Promise(() => {}))
})

describe('HomePage', () => {
  it('renders upgrade button for free users', () => {
    render(<HomePage />)
    expect(screen.getByRole('button', { name: /upgrade/i })).toBeInTheDocument()
  })

  it('renders manage purchase button for paid users', () => {
    mockPaidUser()
    render(<HomePage />)
    expect(screen.getByRole('button', { name: /manage purchase/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^upgrade$/i })).not.toBeInTheDocument()
  })

  it('calls POST /api/create-checkout-session with productRef on upgrade click', async () => {
    render(<HomePage />)
    fireEvent.click(screen.getByRole('button', { name: /upgrade/i }))

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/create-checkout-session',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            Authorization: 'Bearer test-token',
          }),
          body: JSON.stringify({ productRef: 'prd_smoke' }),
        }),
      ),
    )
  })

  it('double-click on upgrade fires only one fetch — shared lock blocks duplicate checkout session', async () => {
    render(<HomePage />)
    const button = screen.getByRole('button', { name: /upgrade/i })

    fireEvent.click(button)
    fireEvent.click(button)

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
  })

  it('shows error message when create-checkout-session fails', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: 'Payment service unavailable' }),
    })
    render(<HomePage />)
    fireEvent.click(screen.getByRole('button', { name: /upgrade/i }))

    await waitFor(() =>
      expect(screen.getByText(/payment service unavailable/i)).toBeInTheDocument(),
    )
  })

  it('re-enables upgrade button after fetch failure — lock is released on error', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: 'Payment service unavailable' }),
    })
    render(<HomePage />)
    fireEvent.click(screen.getByRole('button', { name: /upgrade/i }))

    await waitFor(() => expect(screen.getByRole('button', { name: /upgrade/i })).not.toBeDisabled())
  })

  it('calls POST /api/create-customer-session on manage purchase click', async () => {
    mockPaidUser()
    render(<HomePage />)
    fireEvent.click(screen.getByRole('button', { name: /manage purchase/i }))

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/create-customer-session',
        expect.objectContaining({ method: 'POST' }),
      ),
    )
  })

  it('double-click on manage purchase fires only one fetch — shared lock blocks duplicate session', async () => {
    mockPaidUser()
    render(<HomePage />)
    const button = screen.getByRole('button', { name: /manage purchase/i })

    fireEvent.click(button)
    fireEvent.click(button)

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
  })
})
