import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import React from 'react'
import { BALANCE_RECONCILE_DELAYS_MS } from '@solvapay/server'
import { SolvaPayProvider } from '../SolvaPayProvider'
import { useSolvaPay } from '../hooks/useSolvaPay'
import { autoRechargeCache } from '../hooks/useAutoRecharge'

const mockAdapter = {
  getToken: vi.fn().mockResolvedValue('test-token'),
  getUserId: vi.fn().mockResolvedValue('user-123'),
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createWrapper(props?: Record<string, any>) {
  const Wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(
      SolvaPayProvider,
      {
        config: {
          auth: { adapter: mockAdapter },
        },
        ...props,
        children,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
    )
  Wrapper.displayName = 'TestWrapper'
  return Wrapper
}

describe('SolvaPayProvider - balance (credits)', () => {
  let fetchSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers({ shouldAdvanceTime: true })
    localStorage.clear()
    autoRechargeCache.clear()

    fetchSpy = vi.fn().mockImplementation((url: string) => {
      if (typeof url === 'string' && url.includes('customer-balance')) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              credits: 500000,
              displayCurrency: 'USD',
            }),
        })
      }
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            customerRef: 'cus_auto',
            purchases: [],
          }),
      })
    })
    vi.stubGlobal('fetch', fetchSpy)
  })

  afterEach(() => {
    autoRechargeCache.clear()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  function getBalanceCalls() {
    return fetchSpy.mock.calls.filter(
      (call: unknown[]) => typeof call[0] === 'string' && (call[0] as string).includes('customer-balance'),
    )
  }

  it('does NOT call /api/customer-balance on mount', async () => {
    renderHook(() => useSolvaPay(), { wrapper: createWrapper() })

    await waitFor(() => {
      const purchaseCalls = fetchSpy.mock.calls.filter(
        (call: unknown[]) => typeof call[0] === 'string' && (call[0] as string).includes('check-purchase'),
      )
      expect(purchaseCalls.length).toBeGreaterThanOrEqual(1)
    })

    expect(getBalanceCalls()).toHaveLength(0)
  })

  it('balance context value starts with null credits and displayCurrency', async () => {
    const { result } = renderHook(() => useSolvaPay(), { wrapper: createWrapper() })

    expect(result.current.balance.loading).toBe(false)
    expect(result.current.balance.credits).toBeNull()
    expect(result.current.balance.displayCurrency).toBeNull()
    expect(typeof result.current.balance.refetch).toBe('function')
  })

  it('balance.refetch() triggers the balance fetch', async () => {
    const { result } = renderHook(() => useSolvaPay(), { wrapper: createWrapper() })

    await waitFor(() => {
      expect(result.current.customerRef).toBe('cus_auto')
    })

    expect(getBalanceCalls()).toHaveLength(0)

    await act(async () => {
      await result.current.balance.refetch()
    })

    expect(getBalanceCalls()).toHaveLength(1)
    expect(getBalanceCalls()[0][0]).toBe('/api/customer-balance')
  })

  it('balance.refetch() populates credits and displayCurrency', async () => {
    const { result } = renderHook(() => useSolvaPay(), { wrapper: createWrapper() })

    await waitFor(() => {
      expect(result.current.customerRef).toBe('cus_auto')
    })

    await act(async () => {
      await result.current.balance.refetch()
    })

    expect(result.current.balance.credits).toBe(500000)
    expect(result.current.balance.displayCurrency).toBe('USD')
  })

  it('adjustBalance blocks refetch during grace period', async () => {
    const { result } = renderHook(() => useSolvaPay(), { wrapper: createWrapper() })

    await waitFor(() => {
      expect(result.current.customerRef).toBe('cus_auto')
    })

    await act(async () => {
      await result.current.balance.refetch()
    })
    expect(result.current.balance.credits).toBe(500000)
    const callsBefore = getBalanceCalls().length

    act(() => {
      result.current.balance.adjustBalance(100000)
    })

    expect(result.current.balance.credits).toBe(600000)

    await act(async () => {
      await result.current.balance.refetch()
    })

    expect(getBalanceCalls()).toHaveLength(callsBefore)
    expect(result.current.balance.credits).toBe(600000)
  })

  it('adjustBalance auto-reconciles after grace period', async () => {
    const { result } = renderHook(() => useSolvaPay(), { wrapper: createWrapper() })

    await waitFor(() => {
      expect(result.current.customerRef).toBe('cus_auto')
    })

    await act(async () => {
      await result.current.balance.refetch()
    })
    const callsBefore = getBalanceCalls().length

    act(() => {
      result.current.balance.adjustBalance(100000)
    })
    expect(result.current.balance.credits).toBe(600000)

    await act(async () => {
      vi.advanceTimersByTime(8500)
    })

    await waitFor(() => {
      expect(getBalanceCalls().length).toBeGreaterThan(callsBefore)
    })

    expect(result.current.balance.credits).toBe(500000)
  })

  it('keeps credits on fetch error instead of wiping', async () => {
    const { result } = renderHook(() => useSolvaPay(), { wrapper: createWrapper() })

    await waitFor(() => {
      expect(result.current.customerRef).toBe('cus_auto')
    })

    await act(async () => {
      await result.current.balance.refetch()
    })
    expect(result.current.balance.credits).toBe(500000)

    fetchSpy.mockImplementation((url: string) => {
      if (typeof url === 'string' && url.includes('customer-balance')) {
        return Promise.reject(new Error('Network error'))
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ customerRef: 'cus_auto', purchases: [] }),
      })
    })

    await act(async () => {
      await result.current.balance.refetch()
    })

    expect(result.current.balance.credits).toBe(500000)
    expect(result.current.balance.displayCurrency).toBe('USD')
  })

  it('polls balance until credits increase when server signals auto-recharge triggered', async () => {
    let balanceFetchCount = 0
    fetchSpy.mockImplementation((url: string) => {
      if (typeof url === 'string' && url.includes('customer-balance')) {
        balanceFetchCount += 1
        if (balanceFetchCount === 1) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ credits: 1000, displayCurrency: 'USD' }),
          })
        }
        if (balanceFetchCount <= 3) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ credits: 400, displayCurrency: 'USD' }),
          })
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ credits: 10_000, displayCurrency: 'USD' }),
        })
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ customerRef: 'cus_auto', purchases: [] }),
      })
    })

    const { result } = renderHook(() => useSolvaPay(), { wrapper: createWrapper() })

    await waitFor(() => {
      expect(result.current.customerRef).toBe('cus_auto')
    })

    await act(async () => {
      await result.current.balance.refetch()
    })
    expect(result.current.balance.credits).toBe(1000)

    act(() => {
      result.current.balance.adjustBalance(-600)
      result.current.balance.reconcileAfterUsageDebit({ expectIncrease: true })
    })
    expect(result.current.balance.credits).toBe(400)

    await act(async () => {
      for (const delay of BALANCE_RECONCILE_DELAYS_MS) {
        await vi.advanceTimersByTimeAsync(delay)
      }
    })

    expect(getBalanceCalls().length).toBeGreaterThan(3)

    await waitFor(() => {
      expect(result.current.balance.credits).toBe(10_000)
    })
  })

  it('reconciles every recharge when back-to-back debits each expect auto-recharge', async () => {
    let balanceFetchCount = 0
    fetchSpy.mockImplementation((url: string) => {
      if (typeof url === 'string' && url.includes('customer-balance')) {
        balanceFetchCount += 1
        if (balanceFetchCount === 1) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ credits: 10_000, displayCurrency: 'USD' }),
          })
        }
        if (balanceFetchCount <= 4) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ credits: 8800, displayCurrency: 'USD' }),
          })
        }
        if (balanceFetchCount <= 8) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ credits: 18_800, displayCurrency: 'USD' }),
          })
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ credits: 28_800, displayCurrency: 'USD' }),
        })
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ customerRef: 'cus_auto', purchases: [] }),
      })
    })

    const { result } = renderHook(() => useSolvaPay(), { wrapper: createWrapper() })

    await waitFor(() => {
      expect(result.current.customerRef).toBe('cus_auto')
    })

    await act(async () => {
      await result.current.balance.refetch()
    })
    expect(result.current.balance.credits).toBe(10_000)

    act(() => {
      result.current.balance.adjustBalance(-600)
      result.current.balance.reconcileAfterUsageDebit({ expectIncrease: true })
      result.current.balance.adjustBalance(-600)
      result.current.balance.reconcileAfterUsageDebit({ expectIncrease: true })
    })
    expect(result.current.balance.credits).toBe(8800)

    await act(async () => {
      for (const delay of BALANCE_RECONCILE_DELAYS_MS) {
        await vi.advanceTimersByTimeAsync(delay)
      }
      for (const delay of BALANCE_RECONCILE_DELAYS_MS) {
        await vi.advanceTimersByTimeAsync(delay)
      }
    })

    await waitFor(() => {
      expect(result.current.balance.credits).toBe(28_800)
    })
  })

  it('keeps optimistic debit until grace refetch reconciles with server', async () => {
    fetchSpy.mockImplementation((url: string) => {
      if (typeof url === 'string' && url.includes('customer-balance')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ credits: 10_400, displayCurrency: 'USD' }),
        })
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ customerRef: 'cus_auto', purchases: [] }),
      })
    })

    const { result } = renderHook(() => useSolvaPay(), { wrapper: createWrapper() })

    await waitFor(() => {
      expect(result.current.customerRef).toBe('cus_auto')
    })

    await act(async () => {
      await result.current.balance.refetch()
    })
    expect(result.current.balance.credits).toBe(10_400)

    act(() => {
      result.current.balance.adjustBalance(-1000)
    })
    expect(result.current.balance.credits).toBe(9400)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })

    await waitFor(() => {
      expect(result.current.balance.credits).toBe(10_400)
    })
  })

  it('schedules grace refetch after negative adjustBalance even without reconcile polling', async () => {
    fetchSpy.mockImplementation((url: string) => {
      if (typeof url === 'string' && url.includes('customer-balance')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ credits: 1000, displayCurrency: 'USD' }),
        })
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ customerRef: 'cus_auto', purchases: [] }),
      })
    })

    const { result } = renderHook(() => useSolvaPay(), { wrapper: createWrapper() })

    await waitFor(() => {
      expect(result.current.customerRef).toBe('cus_auto')
    })

    await act(async () => {
      await result.current.balance.refetch()
    })
    const callsBeforeAdjust = getBalanceCalls().length

    act(() => {
      result.current.balance.adjustBalance(-600)
      result.current.balance.reconcileAfterUsageDebit({ expectIncrease: false })
    })
    expect(result.current.balance.credits).toBe(400)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2500)
    })

    expect(getBalanceCalls().length).toBe(callsBeforeAdjust + 1)
    expect(result.current.balance.credits).toBe(1000)
  })
})
