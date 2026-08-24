import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import React from 'react'

import { useCheckout } from './useCheckout'
import { SolvaPayContext } from '../SolvaPayProvider'
import type { SolvaPayContextValue } from '../types'
import { mockBalanceStatus } from '../test-helpers/mockBalanceStatus'

vi.mock('@stripe/stripe-js', () => ({
  loadStripe: vi.fn(() => Promise.resolve(null)),
}))

function createMockContext(overrides?: Partial<SolvaPayContextValue>): SolvaPayContextValue {
  return {
    purchase: {
      loading: false,
      isRefetching: false,
      error: null,
      purchases: [],
      hasProduct: () => false,
      activePurchase: null,
      hasPaidPurchase: false,
      activePaidPurchase: null,
      balanceTransactions: [],
    },
    refetchPurchase: vi.fn(),
    upsertPurchase: vi.fn(),
    createPayment: vi.fn(),
    createTopupPayment: vi.fn(),
    cancelRenewal: vi.fn(),
    reactivateRenewal: vi.fn(),
    activatePlan: vi.fn(),
    balance: mockBalanceStatus(),
    _config: {
      fetch: vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: 'SolvaPay API is unreachable at SOLVAPAY_API_BASE_URL',
          }),
          { status: 500, statusText: 'Internal Server Error' },
        ),
      ),
    },
    ...overrides,
  }
}

function createWrapper(context: SolvaPayContextValue) {
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(SolvaPayContext.Provider, { value: context }, children)
}

describe('useCheckout', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('surfaces server error message when plan resolution fetch fails', async () => {
    const ctx = createMockContext()
    const { result } = renderHook(() => useCheckout({ productRef: 'prd_test' }), {
      wrapper: createWrapper(ctx),
    })

    await act(async () => {
      await result.current.startCheckout()
    })

    expect(result.current.error?.message).toBe(
      'SolvaPay API is unreachable at SOLVAPAY_API_BASE_URL',
    )
  })
})
