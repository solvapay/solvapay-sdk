import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import React from 'react'

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) =>
    React.createElement('a', { href }, children),
}))

vi.mock('@solvapay/react', () => ({
  usePurchase: vi.fn(),
  ProductBadge: () => React.createElement('span', { 'data-testid': 'product-badge' }),
}))

vi.mock('../../lib/supabase', () => ({
  getAccessToken: vi.fn(() => Promise.resolve('test-token')),
  signOut: vi.fn(() => Promise.resolve({ error: null })),
}))

import { usePurchase } from '@solvapay/react'
import { releaseCheckoutLock } from '../../lib/checkout-guard'
import { Navigation } from '../Navigation'

const fetchMock = vi.fn()
global.fetch = fetchMock

function mockFreeUser() {
  vi.mocked(usePurchase).mockReturnValue({
    loading: false,
    hasPaidPurchase: false,
    activePurchase: null,
    refetch: vi.fn(),
  } as ReturnType<typeof usePurchase>)
}

function mockPaidUser() {
  vi.mocked(usePurchase).mockReturnValue({
    loading: false,
    hasPaidPurchase: true,
    activePurchase: { productRef: 'prd_TEST', productName: 'Pro Plan' },
    refetch: vi.fn(),
  } as ReturnType<typeof usePurchase>)
}

beforeEach(() => {
  vi.clearAllMocks()
  releaseCheckoutLock()
  process.env.NEXT_PUBLIC_PRODUCT_REF = 'prd_smoke'
  mockFreeUser()
  // Never resolves — keeps lock held so window.location is never assigned
  fetchMock.mockReturnValue(new Promise(() => {}))
})

describe('Navigation', () => {
  it('renders upgrade button for free users', () => {
    render(<Navigation />)
    expect(screen.getByRole('button', { name: /upgrade/i })).toBeInTheDocument()
  })

  it('hides upgrade button for paid users', () => {
    mockPaidUser()
    render(<Navigation />)
    expect(screen.queryByRole('button', { name: /upgrade/i })).not.toBeInTheDocument()
  })

  it('calls POST /api/create-checkout-session with productRef on upgrade click', async () => {
    render(<Navigation />)
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

  it('button shows Redirecting and is disabled while fetch is in-flight', async () => {
    render(<Navigation />)
    fireEvent.click(screen.getByRole('button', { name: /upgrade/i }))

    await waitFor(() => expect(screen.getByRole('button', { name: /redirecting/i })).toBeDisabled())
  })

  it('double-click fires only one fetch — shared lock blocks duplicate checkout session', async () => {
    render(<Navigation />)
    const button = screen.getByRole('button', { name: /upgrade/i })

    fireEvent.click(button)
    fireEvent.click(button)

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
  })

  it('shows alert and re-enables button when fetch fails', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: 'Server error' }),
    })
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {})

    render(<Navigation />)
    fireEvent.click(screen.getByRole('button', { name: /upgrade/i }))

    await waitFor(() => expect(alertSpy).toHaveBeenCalled())
    expect(screen.getByRole('button', { name: /upgrade/i })).not.toBeDisabled()
  })
})
