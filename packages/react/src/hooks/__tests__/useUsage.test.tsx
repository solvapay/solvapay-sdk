import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useUsage } from '../useUsage'
import { usePurchase } from '../usePurchase'
import { useTransport } from '../useTransport'
import { useLimits } from '../useLimits'

vi.mock('../usePurchase', () => ({
  usePurchase: vi.fn(),
}))
vi.mock('../useTransport', () => ({
  useTransport: vi.fn(),
}))
vi.mock('../useLimits', () => ({
  useLimits: vi.fn(),
}))

const mockedUsePurchase = vi.mocked(usePurchase)
const mockedUseTransport = vi.mocked(useTransport)
const mockedUseLimits = vi.mocked(useLimits)

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

/**
 * Cap side of the snapshot. Defaults to a finite allowance on `tokens`;
 * pass `{ remaining: -1, unlimited: true }` for an uncapped meter or
 * `{ remaining: null, unlimited: null }` for "not resolved yet".
 */
function setLimits(override: Partial<ReturnType<typeof useLimits>> = {}) {
  mockedUseLimits.mockReturnValue({
    remaining: 250,
    unlimited: false,
    withinLimits: true,
    meterName: 'tokens',
    activationRequired: false,
    loading: false,
    error: null,
    refetch: vi.fn().mockResolvedValue(undefined),
    adjustRemaining: vi.fn(),
    ...override,
  })
}

/** Active metered purchase in the current wire shape. */
function meteredPurchase(overrides: Record<string, unknown> = {}) {
  return {
    reference: 'pur_1',
    customerRef: 'cus_1',
    productName: 'AI',
    productRef: 'prd_ai',
    status: 'active',
    startDate: '2025-01-01',
    createdAt: '2025-01-01',
    amount: 0,
    currency: 'USD',
    isRecurring: true,
    planSnapshot: { currency: 'USD', price: 0, isMetered: true },
    usage: { used: 750 },
    ...overrides,
  }
}

describe('useUsage', () => {
  it('combines purchase usage with the allowance from useLimits', () => {
    setPurchase({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      activePurchase: meteredPurchase() as any,
    })
    setTransport()
    setLimits()
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      activePurchase: meteredPurchase({ usage: { used: 850 } }) as any,
    })
    setTransport()
    setLimits({ remaining: 150 })
    const { result } = renderHook(() => useUsage())
    expect(result.current.isApproachingLimit).toBe(true)
    expect(result.current.isAtLimit).toBe(false)
  })

  it('flips isAtLimit at >= 100%', () => {
    setPurchase({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      activePurchase: meteredPurchase({ usage: { used: 1000 } }) as any,
    })
    setTransport()
    setLimits({ remaining: 0 })
    const { result } = renderHook(() => useUsage())
    expect(result.current.isAtLimit).toBe(true)
  })

  it('reports the meter name resolved by the backend', () => {
    setPurchase({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      activePurchase: meteredPurchase({ usage: { used: 100 } }) as any,
    })
    setTransport()
    setLimits({ remaining: 900 })
    const { result } = renderHook(() => useUsage())

    expect(result.current.usage?.meterRef).toBe('tokens')
    expect(result.current.meterRef).toBe('tokens')
  })

  it('leaves the cap null while the allowance is still unresolved', () => {
    setPurchase({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      activePurchase: meteredPurchase({ usage: { used: 40 } }) as any,
    })
    setTransport()
    setLimits({ remaining: null, unlimited: null, meterName: null, loading: true })
    const { result } = renderHook(() => useUsage())

    // Cap unknown is not cap absent: no total, and crucially not "unlimited".
    expect(result.current.usage?.used).toBe(40)
    expect(result.current.usage?.total).toBeNull()
    expect(result.current.percentUsed).toBeNull()
    expect(result.current.isUnlimited).toBe(false)
  })

  it('reports an uncapped meter as unlimited', () => {
    setPurchase({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      activePurchase: meteredPurchase({ usage: { used: 5000 } }) as any,
    })
    setTransport()
    setLimits({ remaining: -1, unlimited: true })
    const { result } = renderHook(() => useUsage())

    expect(result.current.isUnlimited).toBe(true)
    expect(result.current.usage?.total).toBeNull()
    expect(result.current.isAtLimit).toBe(false)
  })

  it('returns null usage when the active purchase is not metered', () => {
    setPurchase({
      activePurchase: {
        reference: 'pur_1',
        customerRef: 'cus_1',
        productName: 'Static plan',
        productRef: 'prd_static',
        status: 'active',
        startDate: '2025-01-01',
        createdAt: '2025-01-01',
        amount: 9900,
        currency: 'USD',
        isRecurring: false,
        planSnapshot: { currency: 'USD', price: 9900, name: 'Basic', isMetered: false },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
    })
    setTransport()
    setLimits({ remaining: null, unlimited: null, meterName: null })
    const { result } = renderHook(() => useUsage())
    expect(result.current.usage).toBeNull()
    expect(result.current.percentUsed).toBeNull()
  })

  it('does not report credit-gated pay-as-you-go as unlimited', () => {
    setPurchase({
      activePurchase: meteredPurchase({
        reference: 'pur_payg',
        productName: 'API',
        productRef: 'prd_api',
        isRecurring: false,
        planSnapshot: {
          currency: 'USD',
          price: 0,
          name: 'Pay as you go',
          isMetered: true,
        },
        usage: { used: 0 },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any,
    })
    setTransport()
    // Credits buy a finite number of metered items, so the backend
    // answers with a real count — never the unlimited sentinel.
    setLimits({ remaining: 25, meterName: 'requests' })
    const { result } = renderHook(() => useUsage())

    expect(result.current.usage).not.toBeNull()
    expect(result.current.isUnlimited).toBe(false)
  })
})
