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
