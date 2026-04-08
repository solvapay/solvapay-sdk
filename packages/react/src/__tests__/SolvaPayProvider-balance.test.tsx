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

describe('SolvaPayProvider - balance (single balance)', () => {
  let fetchSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers({ shouldAdvanceTime: true })
    localStorage.clear()

    fetchSpy = vi.fn().mockImplementation((url: string) => {
      if (typeof url === 'string' && url.includes('customer-balance')) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              balances: [{ currency: 'USD', balance: 5000 }],
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

  it('balance context value starts with null balance and currency', async () => {
    const { result } = renderHook(() => useSolvaPay(), { wrapper: createWrapper() })

    expect(result.current.balance.loading).toBe(false)
    expect(result.current.balance.balance).toBeNull()
    expect(result.current.balance.currency).toBeNull()
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

  it('balance.refetch() populates single balance and currency', async () => {
    const { result } = renderHook(() => useSolvaPay(), { wrapper: createWrapper() })

    await waitFor(() => {
      expect(result.current.customerRef).toBe('cus_auto')
    })

    await act(async () => {
      await result.current.balance.refetch()
    })

    expect(result.current.balance.balance).toBe(5000)
    expect(result.current.balance.currency).toBe('USD')
  })

  it('adjustBalance blocks refetch during grace period', async () => {
    const { result } = renderHook(() => useSolvaPay(), { wrapper: createWrapper() })

    await waitFor(() => {
      expect(result.current.customerRef).toBe('cus_auto')
    })

    await act(async () => {
      await result.current.balance.refetch()
    })
    expect(result.current.balance.balance).toBe(5000)
    const callsBefore = getBalanceCalls().length

    act(() => {
      result.current.balance.adjustBalance(1000)
    })

    expect(result.current.balance.balance).toBe(6000)

    await act(async () => {
      await result.current.balance.refetch()
    })

    expect(getBalanceCalls()).toHaveLength(callsBefore)
    expect(result.current.balance.balance).toBe(6000)
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
      result.current.balance.adjustBalance(1000)
    })
    expect(result.current.balance.balance).toBe(6000)

    await act(async () => {
      vi.advanceTimersByTime(8500)
    })

    await waitFor(() => {
      expect(getBalanceCalls().length).toBeGreaterThan(callsBefore)
    })

    expect(result.current.balance.balance).toBe(5000)
  })

  it('keeps balance on fetch error instead of wiping', async () => {
    const { result } = renderHook(() => useSolvaPay(), { wrapper: createWrapper() })

    await waitFor(() => {
      expect(result.current.customerRef).toBe('cus_auto')
    })

    await act(async () => {
      await result.current.balance.refetch()
    })
    expect(result.current.balance.balance).toBe(5000)

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

    expect(result.current.balance.balance).toBe(5000)
    expect(result.current.balance.currency).toBe('USD')
  })
})
