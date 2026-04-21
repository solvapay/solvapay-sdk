import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import React from 'react'
import { SolvaPayProvider } from '../SolvaPayProvider'
import { useSolvaPay } from '../hooks/useSolvaPay'

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

const PURCHASE_ACTIVE = {
  customerRef: 'cus_test',
  purchases: [
    {
      reference: 'pur_1',
      productName: 'Pro',
      status: 'active',
      startDate: '2026-01-01',
      planRef: 'pln_pro',
      planSnapshot: { reference: 'pln_pro', planType: 'recurring' },
    },
  ],
}

const PURCHASE_UPDATED = {
  customerRef: 'cus_test',
  purchases: [
    {
      reference: 'pur_1',
      productName: 'Pro',
      status: 'active',
      startDate: '2026-01-01',
      planRef: 'pln_pro_v2',
      planSnapshot: { reference: 'pln_pro_v2', planType: 'recurring' },
    },
  ],
}

describe('SolvaPayProvider - purchase state management', () => {
  let fetchSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers({ shouldAdvanceTime: true })
    localStorage.clear()

    fetchSpy = vi.fn().mockImplementation(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(PURCHASE_ACTIVE),
      }),
    )
    vi.stubGlobal('fetch', fetchSpy)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  function getPurchaseCalls() {
    return fetchSpy.mock.calls.filter(
      (call: unknown[]) =>
        typeof call[0] === 'string' && (call[0] as string).includes('check-purchase'),
    )
  }

  describe('stale-while-revalidate', () => {
    it('does NOT clear purchases to empty array on refetch', async () => {
      const { result } = renderHook(() => useSolvaPay(), { wrapper: createWrapper() })

      await waitFor(() => {
        expect(result.current.purchase.purchases).toHaveLength(1)
      })

      fetchSpy.mockImplementation(() =>
        new Promise(resolve => {
          setTimeout(
            () =>
              resolve({
                ok: true,
                json: () => Promise.resolve(PURCHASE_UPDATED),
              }),
            200,
          )
        }),
      )

      await act(async () => {
        const promise = result.current.refetchPurchase()
        await vi.advanceTimersByTimeAsync(10)
        expect(result.current.purchase.purchases).toHaveLength(1)
        expect(result.current.purchase.activePurchase?.reference).toBe('pur_1')
        await vi.advanceTimersByTimeAsync(300)
        await promise
      })

      await waitFor(() => {
        expect(result.current.purchase.activePurchase?.planRef).toBe('pln_pro_v2')
      })
    })

    it('replaces data with fresh results after refetch completes', async () => {
      const { result } = renderHook(() => useSolvaPay(), { wrapper: createWrapper() })

      await waitFor(() => {
        expect(result.current.purchase.activePurchase?.planRef).toBe('pln_pro')
      })

      fetchSpy.mockImplementation(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve(PURCHASE_UPDATED),
        }),
      )

      await act(async () => {
        await result.current.refetchPurchase()
      })

      await waitFor(() => {
        expect(result.current.purchase.activePurchase?.planRef).toBe('pln_pro_v2')
      })
    })
  })

  describe('error state', () => {
    it('exposes error when fetch returns non-ok', async () => {
      fetchSpy.mockImplementation(() =>
        Promise.resolve({
          ok: false,
          statusText: 'Internal Server Error',
        }),
      )

      const { result } = renderHook(() => useSolvaPay(), { wrapper: createWrapper() })

      await waitFor(() => {
        expect(result.current.purchase.error).not.toBeNull()
      })

      expect(result.current.purchase.error?.message).toContain('Failed to check purchase')
    })

    it('clears error on successful refetch', async () => {
      fetchSpy.mockImplementation(() =>
        Promise.resolve({
          ok: false,
          statusText: 'Internal Server Error',
        }),
      )

      const { result } = renderHook(() => useSolvaPay(), { wrapper: createWrapper() })

      await waitFor(() => {
        expect(result.current.purchase.error).not.toBeNull()
      })

      fetchSpy.mockImplementation(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve(PURCHASE_ACTIVE),
        }),
      )

      await act(async () => {
        await result.current.refetchPurchase()
      })

      await waitFor(() => {
        expect(result.current.purchase.error).toBeNull()
        expect(result.current.purchase.purchases).toHaveLength(1)
      })
    })

    it('preserves stale data when refetch fails', async () => {
      const { result } = renderHook(() => useSolvaPay(), { wrapper: createWrapper() })

      await waitFor(() => {
        expect(result.current.purchase.activePurchase?.reference).toBe('pur_1')
      })

      fetchSpy.mockImplementation(() =>
        Promise.resolve({
          ok: false,
          statusText: 'Server Error',
        }),
      )

      await act(async () => {
        await result.current.refetchPurchase()
      })

      await waitFor(() => {
        expect(result.current.purchase.error).not.toBeNull()
      })
      expect(result.current.purchase.activePurchase?.reference).toBe('pur_1')
    })

    it('starts with null error', () => {
      const { result } = renderHook(() => useSolvaPay(), { wrapper: createWrapper() })
      expect(result.current.purchase.error).toBeNull()
    })
  })

  describe('loading vs isRefetching', () => {
    it('sets loading=true only for initial fetch', async () => {
      const { result } = renderHook(() => useSolvaPay(), { wrapper: createWrapper() })

      await waitFor(() => {
        expect(result.current.purchase.loading).toBe(false)
        expect(result.current.purchase.purchases).toHaveLength(1)
      })

      expect(result.current.purchase.isRefetching).toBe(false)
    })

    it('isRefetching resets to false after refetch completes', async () => {
      const { result } = renderHook(() => useSolvaPay(), { wrapper: createWrapper() })

      await waitFor(() => {
        expect(result.current.purchase.purchases).toHaveLength(1)
      })

      await act(async () => {
        await result.current.refetchPurchase()
      })

      expect(result.current.purchase.isRefetching).toBe(false)
      expect(result.current.purchase.loading).toBe(false)
    })

    it('flips isRefetching (not loading) when refetching an empty-state user', async () => {
      // Empty-state customer: first fetch returns no purchases. A subsequent
      // refetch must report via `isRefetching`, not `loading`, so polling
      // consumers don't remount their UI on every background poll.
      const PURCHASE_EMPTY = { customerRef: 'cus_empty', purchases: [] }
      fetchSpy.mockImplementation(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve(PURCHASE_EMPTY),
        }),
      )

      const { result } = renderHook(() => useSolvaPay(), { wrapper: createWrapper() })

      // Wait for both the initial userId-keyed fetch and the customerRef-keyed
      // follow-up (triggered by the provider discovering `cus_empty`) to settle.
      await waitFor(() => {
        expect(result.current.purchase.loading).toBe(false)
        expect(result.current.purchase.isRefetching).toBe(false)
        expect(result.current.customerRef).toBe('cus_empty')
      })
      expect(result.current.purchase.purchases).toHaveLength(0)

      // Hold the next fetch open via a manual resolver so we can observe the
      // intermediate state cleanly — a setTimeout-based delay races with
      // `shouldAdvanceTime: true`.
      let resolveRefetch: (() => void) | undefined
      const refetchGate = new Promise<void>(resolve => {
        resolveRefetch = resolve
      })
      fetchSpy.mockImplementation(async () => {
        await refetchGate
        return {
          ok: true,
          json: () => Promise.resolve(PURCHASE_EMPTY),
        }
      })

      const refetchPromise = result.current.refetchPurchase()

      await waitFor(() => {
        expect(result.current.purchase.isRefetching).toBe(true)
      })
      expect(result.current.purchase.loading).toBe(false)

      await act(async () => {
        resolveRefetch?.()
        await refetchPromise
      })

      expect(result.current.purchase.loading).toBe(false)
      expect(result.current.purchase.isRefetching).toBe(false)
    })

    it('flips isRefetching (not loading) when refetching a non-empty user', async () => {
      const { result } = renderHook(() => useSolvaPay(), { wrapper: createWrapper() })

      await waitFor(() => {
        expect(result.current.purchase.loading).toBe(false)
        expect(result.current.purchase.isRefetching).toBe(false)
        expect(result.current.customerRef).toBe('cus_test')
        expect(result.current.purchase.purchases).toHaveLength(1)
      })

      let resolveRefetch: (() => void) | undefined
      const refetchGate = new Promise<void>(resolve => {
        resolveRefetch = resolve
      })
      fetchSpy.mockImplementation(async () => {
        await refetchGate
        return {
          ok: true,
          json: () => Promise.resolve(PURCHASE_UPDATED),
        }
      })

      const refetchPromise = result.current.refetchPurchase()

      await waitFor(() => {
        expect(result.current.purchase.isRefetching).toBe(true)
      })
      expect(result.current.purchase.loading).toBe(false)

      await act(async () => {
        resolveRefetch?.()
        await refetchPromise
      })

      expect(result.current.purchase.loading).toBe(false)
      expect(result.current.purchase.isRefetching).toBe(false)
    })
  })

  describe('plan vs balance transaction filtering', () => {
    it('keeps the recurring plan on activePurchase while exposing top-ups on balanceTransactions', async () => {
      const MIXED_PURCHASES = {
        customerRef: 'cus_test',
        purchases: [
          {
            reference: 'pur_plan',
            productName: 'Pro',
            status: 'active',
            startDate: '2026-01-01',
            planRef: 'pln_pro',
            amount: 999,
            planSnapshot: { reference: 'pln_pro', planType: 'recurring', name: 'Pro Monthly' },
          },
          {
            reference: 'pur_topup',
            productName: 'Credits',
            status: 'active',
            startDate: '2026-03-01',
            amount: 10000,
            metadata: { purpose: 'credit_topup' },
          },
        ],
      }
      fetchSpy.mockImplementation(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve(MIXED_PURCHASES),
        }),
      )

      const { result } = renderHook(() => useSolvaPay(), { wrapper: createWrapper() })

      await waitFor(() => {
        expect(result.current.purchase.activePurchase?.reference).toBe('pur_plan')
      })

      expect(result.current.purchase.hasPaidPurchase).toBe(true)
      expect(result.current.purchase.activePaidPurchase?.reference).toBe('pur_plan')
      expect(result.current.purchase.balanceTransactions).toHaveLength(1)
      expect(result.current.purchase.balanceTransactions[0].reference).toBe('pur_topup')
      // Raw purchases still include both rows for integrators that need them
      expect(result.current.purchase.purchases).toHaveLength(2)
    })
  })

  describe('auth polling interval', () => {
    it('polls auth at 30s intervals, not 5s', async () => {
      renderHook(() => useSolvaPay(), { wrapper: createWrapper() })

      await waitFor(() => {
        expect(getPurchaseCalls().length).toBeGreaterThanOrEqual(1)
      })

      const callsAfterMount = mockAdapter.getToken.mock.calls.length

      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000)
      })
      const callsAfter5s = mockAdapter.getToken.mock.calls.length
      expect(callsAfter5s).toBe(callsAfterMount)

      await act(async () => {
        await vi.advanceTimersByTimeAsync(25000)
      })
      const callsAfter30s = mockAdapter.getToken.mock.calls.length
      expect(callsAfter30s).toBeGreaterThan(callsAfterMount)
    })
  })
})
