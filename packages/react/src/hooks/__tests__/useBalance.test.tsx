import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import React from 'react'
import { useBalance } from '../useBalance'
import { SolvaPayContext } from '../../SolvaPayProvider'
import type { SolvaPayContextValue, BalanceStatus } from '../../types'

function createMockContext(
  balanceOverrides?: Partial<BalanceStatus>,
): SolvaPayContextValue {
  return {
    purchase: {
      loading: false,
      purchases: [],
      hasProduct: () => false,
      hasPlan: () => false,
      activePurchase: null,
      hasPaidPurchase: false,
      activePaidPurchase: null,
    },
    refetchPurchase: vi.fn(),
    createPayment: vi.fn(),
    createTopupPayment: vi.fn(),
    balance: {
      loading: false,
      balances: [{ currency: 'USD', balance: 2500 }],
      refetch: vi.fn(),
      ...balanceOverrides,
    },
  }
}

function createWrapper(ctx: SolvaPayContextValue) {
  const Wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(SolvaPayContext.Provider, { value: ctx }, children)
  Wrapper.displayName = 'TestWrapper'
  return Wrapper
}

describe('useBalance', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calls balance.refetch() once on mount', () => {
    const ctx = createMockContext()
    renderHook(() => useBalance(), { wrapper: createWrapper(ctx) })

    expect(ctx.balance.refetch).toHaveBeenCalledTimes(1)
  })

  it('returns balance state from context', () => {
    const ctx = createMockContext({
      loading: true,
      balances: [{ currency: 'GBP', balance: 1000 }],
    })
    const { result } = renderHook(() => useBalance(), { wrapper: createWrapper(ctx) })

    expect(result.current.loading).toBe(true)
    expect(result.current.balances).toEqual([{ currency: 'GBP', balance: 1000 }])
    expect(typeof result.current.refetch).toBe('function')
  })

  it('does not re-fetch on re-render', () => {
    const ctx = createMockContext()
    const { rerender } = renderHook(() => useBalance(), {
      wrapper: createWrapper(ctx),
    })

    rerender()
    rerender()

    expect(ctx.balance.refetch).toHaveBeenCalledTimes(1)
  })
})
