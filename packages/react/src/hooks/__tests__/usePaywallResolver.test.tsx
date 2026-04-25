import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { PaywallStructuredContent } from '@solvapay/server'
import { usePaywallResolver } from '../usePaywallResolver'
import { usePurchase } from '../usePurchase'
import { useBalance } from '../useBalance'

vi.mock('../usePurchase', () => ({
  usePurchase: vi.fn(),
}))
vi.mock('../useBalance', () => ({
  useBalance: vi.fn(),
}))

const mockedUsePurchase = vi.mocked(usePurchase)
const mockedUseBalance = vi.mocked(useBalance)

function setUsePurchase(override: Partial<ReturnType<typeof usePurchase>> = {}) {
  mockedUsePurchase.mockReturnValue({
    purchases: [],
    hasPaidPurchase: false,
    activePurchase: null,
    cancelledPurchase: null,
    loading: false,
    error: null,
    isRefetching: false,
    refetch: vi.fn().mockResolvedValue(undefined),
    ...override,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any)
}

function setUseBalance(override: Partial<ReturnType<typeof useBalance>> = {}) {
  mockedUseBalance.mockReturnValue({
    credits: null,
    displayCurrency: 'USD',
    loading: false,
    error: null,
    refetch: vi.fn().mockResolvedValue(undefined),
    creditsPerMinorUnit: 0,
    displayExchangeRate: 0,
    ...override,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any)
}

describe('usePaywallResolver', () => {
  it('resolves payment_required once the customer has a matching paid purchase', () => {
    setUsePurchase({
      hasPaidPurchase: true,
      activePurchase: {
        reference: 'pur_1',
        productName: 'Widgets',
        productRef: 'prd_widgets',
        status: 'active',
        startDate: '2025-01-01',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
    })
    setUseBalance()
    const content: PaywallStructuredContent = {
      kind: 'payment_required',
      product: 'prd_widgets',
      checkoutUrl: 'https://example.com/checkout',
      message: 'pay up',
    }
    const { result } = renderHook(() => usePaywallResolver(content))
    expect(result.current.resolved).toBe(true)
  })

  it('does not resolve payment_required when no paid purchase exists', () => {
    setUsePurchase({ hasPaidPurchase: false })
    setUseBalance()
    const content: PaywallStructuredContent = {
      kind: 'payment_required',
      product: 'prd_widgets',
      checkoutUrl: 'https://example.com/checkout',
      message: 'pay up',
    }
    const { result } = renderHook(() => usePaywallResolver(content))
    expect(result.current.resolved).toBe(false)
  })

  it('resolves activation_required once an active purchase exists on the product', () => {
    setUsePurchase({
      activePurchase: {
        reference: 'pur_2',
        productName: 'Widgets',
        productRef: 'prd_widgets',
        status: 'active',
        startDate: '2025-01-01',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
    })
    setUseBalance()
    const content: PaywallStructuredContent = {
      kind: 'activation_required',
      product: 'prd_widgets',
      checkoutUrl: '',
      message: 'activate',
    }
    const { result } = renderHook(() => usePaywallResolver(content))
    expect(result.current.resolved).toBe(true)
  })
})
