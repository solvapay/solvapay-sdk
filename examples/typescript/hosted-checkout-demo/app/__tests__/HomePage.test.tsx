import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { PurchaseInfo, PurchaseStatus, PurchaseStatusReturn } from '@solvapay/react'
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

type PurchaseHookValue = PurchaseStatus & { refetch: () => Promise<void> }

function mockPurchaseStatus(): PurchaseStatusReturn {
  return {
    cancelledPurchase: null,
    shouldShowCancelledNotice: false,
    formatDate: vi.fn((d?: string) => d ?? null),
    getDaysUntilExpiration: vi.fn(() => null),
  }
}

function mockPurchase(
  overrides: Omit<Partial<PurchaseHookValue>, 'activePurchase'> & {
    activePurchase?: Partial<PurchaseInfo> | null
  } = {},
): PurchaseHookValue {
  const { activePurchase: activePurchaseOverride, hasPaidPurchase, ...rest } = overrides
  const activePurchase =
    activePurchaseOverride === null
      ? null
      : ({
          reference: 'pur_TEST',
          productName: 'Pro Plan',
          productRef: 'prd_TEST',
          status: 'active',
          startDate: '2026-01-01T00:00:00.000Z',
          ...activePurchaseOverride,
        } satisfies PurchaseInfo)

  const paid = hasPaidPurchase ?? Boolean(activePurchase)

  return {
    loading: false,
    isRefetching: false,
    error: null,
    purchases: activePurchase ? [activePurchase] : [],
    hasProduct: () => Boolean(activePurchase),
    activePurchase,
    hasPaidPurchase: paid,
    activePaidPurchase: paid ? activePurchase : null,
    balanceTransactions: [],
    refetch: vi.fn().mockResolvedValue(undefined),
    ...rest,
  }
}

function mockFreeUser() {
  vi.mocked(usePurchase).mockReturnValue(mockPurchase({ activePurchase: null, hasPaidPurchase: false }))
  vi.mocked(usePurchaseStatus).mockReturnValue(mockPurchaseStatus())
}

function mockPaidUser() {
  vi.mocked(usePurchase).mockReturnValue(
    mockPurchase({
      hasPaidPurchase: true,
      activePurchase: { productRef: 'prd_TEST', productName: 'Pro Plan' },
    }),
  )
  vi.mocked(usePurchaseStatus).mockReturnValue(mockPurchaseStatus())
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
