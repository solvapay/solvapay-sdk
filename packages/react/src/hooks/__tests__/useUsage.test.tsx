import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useUsage } from '../useUsage'
import { usePurchase } from '../usePurchase'
import { useTransport } from '../useTransport'

vi.mock('../usePurchase', () => ({
  usePurchase: vi.fn(),
}))
vi.mock('../useTransport', () => ({
  useTransport: vi.fn(),
}))

const mockedUsePurchase = vi.mocked(usePurchase)
const mockedUseTransport = vi.mocked(useTransport)

function setPurchase(override: Partial<ReturnType<typeof usePurchase>> = {}) {
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

function setTransport(override: Record<string, unknown> = {}) {
  mockedUseTransport.mockReturnValue({
    checkPurchase: vi.fn(),
    ...override,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any)
}

describe('useUsage', () => {
  it('derives a snapshot from the active purchase', () => {
    setPurchase({
      activePurchase: {
        reference: 'pur_1',
        productName: 'AI',
        productRef: 'prd_ai',
        status: 'active',
        startDate: '2025-01-01',
        planSnapshot: { limit: 1000, meterRef: 'tokens' },
        usage: { used: 750 },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
    })
    setTransport()
    const { result } = renderHook(() => useUsage())

    expect(result.current.usage).toEqual({
      meterRef: 'tokens',
      total: 1000,
      used: 750,
      remaining: 250,
      percentUsed: 75,
      purchaseRef: 'pur_1',
    })
    expect(result.current.percentUsed).toBe(75)
    expect(result.current.isApproachingLimit).toBe(false)
    expect(result.current.isAtLimit).toBe(false)
  })

  it('flips isApproachingLimit at >= 80%', () => {
    setPurchase({
      activePurchase: {
        reference: 'pur_1',
        productName: 'AI',
        productRef: 'prd_ai',
        status: 'active',
        startDate: '2025-01-01',
        planSnapshot: { limit: 1000, meterRef: 'tokens' },
        usage: { used: 850 },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
    })
    setTransport()
    const { result } = renderHook(() => useUsage())
    expect(result.current.isApproachingLimit).toBe(true)
    expect(result.current.isAtLimit).toBe(false)
  })

  it('flips isAtLimit at >= 100%', () => {
    setPurchase({
      activePurchase: {
        reference: 'pur_1',
        productName: 'AI',
        productRef: 'prd_ai',
        status: 'active',
        startDate: '2025-01-01',
        planSnapshot: { limit: 1000, meterRef: 'tokens' },
        usage: { used: 1000 },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
    })
    setTransport()
    const { result } = renderHook(() => useUsage())
    expect(result.current.isAtLimit).toBe(true)
  })

  it('returns null usage when the active purchase is not usage-based', () => {
    setPurchase({
      activePurchase: {
        reference: 'pur_1',
        productName: 'Static plan',
        productRef: 'prd_static',
        status: 'active',
        startDate: '2025-01-01',
        planSnapshot: { name: 'Basic' },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
    })
    setTransport()
    const { result } = renderHook(() => useUsage())
    expect(result.current.usage).toBeNull()
    expect(result.current.percentUsed).toBeNull()
  })
})
