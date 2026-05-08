import { renderHook, waitFor, act } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { useLimits, limitsCache, OPTIMISTIC_GRACE_MS } from '../useLimits'
import { useCustomer } from '../useCustomer'
import { useTransport } from '../useTransport'

vi.mock('../useCustomer', () => ({
  useCustomer: vi.fn(),
}))
vi.mock('../useTransport', () => ({
  useTransport: vi.fn(),
}))

const mockedUseCustomer = vi.mocked(useCustomer)
const mockedUseTransport = vi.mocked(useTransport)

function setCustomer(customerRef: string | undefined = 'cus_test') {
  mockedUseCustomer.mockReturnValue({
    customerRef,
    email: undefined,
    name: undefined,
    loading: false,
  })
}

function setTransport(override: Record<string, unknown> = {}) {
  mockedUseTransport.mockReturnValue({
    checkPurchase: vi.fn(),
    createPayment: vi.fn(),
    processPayment: vi.fn(),
    createTopupPayment: vi.fn(),
    getBalance: vi.fn(),
    cancelRenewal: vi.fn(),
    reactivateRenewal: vi.fn(),
    activatePlan: vi.fn(),
    createCheckoutSession: vi.fn(),
    createCustomerSession: vi.fn(),
    getMerchant: vi.fn(),
    getProduct: vi.fn(),
    listPlans: vi.fn(),
    getPaymentMethod: vi.fn(),
    ...override,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any)
}

beforeEach(() => {
  limitsCache.clear()
  vi.clearAllMocks()
  setCustomer()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useLimits', () => {
  describe('basic fetching', () => {
    it('fetches limits via transport.getLimits and exposes the projection', async () => {
      const getLimits = vi.fn().mockResolvedValue({
        withinLimits: true,
        remaining: 12,
        meterName: 'requests',
        activationRequired: false,
      })
      setTransport({ getLimits })

      const { result } = renderHook(() =>
        useLimits({ productRef: 'prd_api', meterName: 'requests' }),
      )

      await waitFor(() => expect(result.current.loading).toBe(false))
      expect(result.current.remaining).toBe(12)
      expect(result.current.withinLimits).toBe(true)
      expect(result.current.meterName).toBe('requests')
      expect(result.current.activationRequired).toBe(false)
      expect(result.current.error).toBeNull()
      expect(getLimits).toHaveBeenCalledWith({ productRef: 'prd_api', meterName: 'requests' })
    })

    it('surfaces `activationRequired: true` from the transport result', async () => {
      const getLimits = vi.fn().mockResolvedValue({
        withinLimits: false,
        remaining: 0,
        meterName: 'requests',
        activationRequired: true,
      })
      setTransport({ getLimits })

      const { result } = renderHook(() => useLimits({ productRef: 'prd_api' }))

      await waitFor(() => expect(result.current.loading).toBe(false))
      expect(result.current.activationRequired).toBe(true)
      expect(result.current.withinLimits).toBe(false)
      expect(result.current.remaining).toBe(0)
    })

    it('defaults meterName to "requests" when omitted', async () => {
      const getLimits = vi
        .fn()
        .mockResolvedValue({
          withinLimits: true,
          remaining: 3,
          meterName: 'requests',
          activationRequired: false,
        })
      setTransport({ getLimits })

      renderHook(() => useLimits({ productRef: 'prd_api' }))

      await waitFor(() => expect(getLimits).toHaveBeenCalled())
      expect(getLimits).toHaveBeenCalledWith({
        productRef: 'prd_api',
        meterName: 'requests',
      })
    })

    it('skips the network when productRef is undefined', () => {
      const getLimits = vi.fn()
      setTransport({ getLimits })

      const { result } = renderHook(() => useLimits({ productRef: undefined }))

      expect(getLimits).not.toHaveBeenCalled()
      expect(result.current.remaining).toBeNull()
      expect(result.current.withinLimits).toBeNull()
    })

    it('skips the network when enabled=false', () => {
      const getLimits = vi.fn()
      setTransport({ getLimits })

      renderHook(() => useLimits({ productRef: 'prd_api', enabled: false }))

      expect(getLimits).not.toHaveBeenCalled()
    })

    it('surfaces transport errors via the error field', async () => {
      const getLimits = vi.fn().mockRejectedValue(new Error('Network down'))
      setTransport({ getLimits })

      const { result } = renderHook(() => useLimits({ productRef: 'prd_api' }))

      await waitFor(() => expect(result.current.loading).toBe(false))
      expect(result.current.error?.message).toBe('Network down')
      expect(result.current.remaining).toBeNull()
    })
  })

  describe('graceful fallback when transport.getLimits is undefined', () => {
    it('returns null fields without surfacing an error', async () => {
      // MCP-style transport that intentionally omits getLimits.
      setTransport({ getLimits: undefined })

      const { result } = renderHook(() => useLimits({ productRef: 'prd_api' }))

      await waitFor(() => expect(result.current.loading).toBe(false))
      expect(result.current.remaining).toBeNull()
      expect(result.current.withinLimits).toBeNull()
      expect(result.current.meterName).toBeNull()
      expect(result.current.error).toBeNull()
    })
  })

  describe('cache', () => {
    it('reuses cached values for repeat mounts within the TTL', async () => {
      const getLimits = vi.fn().mockResolvedValue({
        withinLimits: true,
        remaining: 7,
        meterName: 'requests',
        activationRequired: false,
      })
      setTransport({ getLimits })

      const first = renderHook(() => useLimits({ productRef: 'prd_api' }))
      await waitFor(() => expect(first.result.current.loading).toBe(false))
      expect(getLimits).toHaveBeenCalledTimes(1)

      const second = renderHook(() => useLimits({ productRef: 'prd_api' }))
      await waitFor(() => expect(second.result.current.remaining).toBe(7))

      // No second network call — cached value is hot.
      expect(getLimits).toHaveBeenCalledTimes(1)
    })

    it('refetch() forces a network round-trip even with a fresh cache entry', async () => {
      const getLimits = vi
        .fn()
        .mockResolvedValueOnce({
          withinLimits: true,
          remaining: 7,
          meterName: 'requests',
          activationRequired: false,
        })
        .mockResolvedValueOnce({
          withinLimits: true,
          remaining: 6,
          meterName: 'requests',
          activationRequired: false,
        })
      setTransport({ getLimits })

      const { result } = renderHook(() => useLimits({ productRef: 'prd_api' }))
      await waitFor(() => expect(result.current.remaining).toBe(7))

      await act(async () => {
        await result.current.refetch()
      })

      expect(getLimits).toHaveBeenCalledTimes(2)
      expect(result.current.remaining).toBe(6)
    })

    it('coalesces a fresh mount onto an in-flight cache entry without flashing 0', async () => {
      // Regression: a fresh mount in StrictMode (or any second
      // sibling) can land on a cache entry seeded by mount #1 that
      // carries `{ data: null, promise }`. The hook must reflect
      // `loading: true, remaining: null` and await the in-flight
      // promise — never kick a second `getLimits` call, never flash a
      // misleading value mid-fetch.
      let resolveFetch: (value: {
        withinLimits: boolean
        remaining: number
        meterName: string | null
        activationRequired: boolean
      }) => void = () => {}
      const pending = new Promise<{
        withinLimits: boolean
        remaining: number
        meterName: string | null
        activationRequired: boolean
      }>(resolve => {
        resolveFetch = resolve
      })

      // Pre-seed the cache the way `fetchLimits` does on the first
      // mount with no prior value: `data: null` + pending promise +
      // fresh timestamp.
      limitsCache.set('cus_test:prd_api:requests', {
        data: null,
        timestamp: Date.now(),
        promise: pending,
      })

      const getLimits = vi.fn().mockReturnValue(pending)
      setTransport({ getLimits })

      const { result } = renderHook(() => useLimits({ productRef: 'prd_api' }))

      expect(result.current.remaining).toBeNull()
      expect(result.current.loading).toBe(true)

      // Resolving the pending promise lands the real value with no
      // intermediate "0" render.
      await act(async () => {
        resolveFetch({
          withinLimits: true,
          remaining: 3,
          meterName: 'requests',
          activationRequired: false,
        })
        await pending
      })

      await waitFor(() => expect(result.current.remaining).toBe(3))
      // The transport's `getLimits` should have been awaited via the
      // cached promise — never a second call kicked off because the
      // in-flight branch coalesced.
      expect(getLimits).not.toHaveBeenCalled()
    })

    it('clears stale data on cache miss while a new fetch is in flight', async () => {
      // Regression: on a productRef switch with no cache hit, the hook
      // must clear `data` synchronously so the consumer doesn't see
      // the previous key's value.
      let resolveFetch: (value: {
        withinLimits: boolean
        remaining: number
        meterName: string | null
        activationRequired: boolean
      }) => void = () => {}
      const pending = new Promise<{
        withinLimits: boolean
        remaining: number
        meterName: string | null
        activationRequired: boolean
      }>(resolve => {
        resolveFetch = resolve
      })
      const getLimits = vi
        .fn()
        .mockResolvedValueOnce({
          withinLimits: true,
          remaining: 7,
          meterName: 'requests',
          activationRequired: false,
        })
        .mockReturnValueOnce(pending)
      setTransport({ getLimits })

      const { result, rerender } = renderHook(
        ({ productRef }: { productRef: string }) => useLimits({ productRef }),
        { initialProps: { productRef: 'prd_first' } },
      )
      await waitFor(() => expect(result.current.remaining).toBe(7))

      // Switch to a different productRef — no cache hit, fetch in
      // flight. `remaining` must immediately drop to null instead of
      // leaking the old key's value.
      rerender({ productRef: 'prd_second' })

      await waitFor(() => expect(result.current.loading).toBe(true))
      expect(result.current.remaining).toBeNull()

      await act(async () => {
        resolveFetch({
          withinLimits: true,
          remaining: 4,
          meterName: 'requests',
          activationRequired: false,
        })
        await pending
      })

      await waitFor(() => expect(result.current.remaining).toBe(4))
    })

    it('keys the cache by customerRef so identity changes refetch', async () => {
      const getLimits = vi
        .fn()
        .mockResolvedValueOnce({
          withinLimits: true,
          remaining: 5,
          meterName: 'requests',
          activationRequired: false,
        })
        .mockResolvedValueOnce({
          withinLimits: true,
          remaining: 9,
          meterName: 'requests',
          activationRequired: false,
        })
      setTransport({ getLimits })

      const { result, rerender } = renderHook(() => useLimits({ productRef: 'prd_api' }))
      await waitFor(() => expect(result.current.remaining).toBe(5))

      setCustomer('cus_other')
      rerender()

      await waitFor(() => expect(result.current.remaining).toBe(9))
      expect(getLimits).toHaveBeenCalledTimes(2)
    })
  })

  describe('adjustRemaining', () => {
    it('optimistically decrements remaining without a network call', async () => {
      const getLimits = vi.fn().mockResolvedValue({
        withinLimits: true,
        remaining: 5,
        meterName: 'requests',
        activationRequired: false,
      })
      setTransport({ getLimits })

      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

      const { result } = renderHook(() => useLimits({ productRef: 'prd_api' }))
      await vi.waitFor(() => expect(result.current.remaining).toBe(5))

      act(() => {
        result.current.adjustRemaining(-1)
      })

      expect(result.current.remaining).toBe(4)
      // Still only the initial fetch — the trailing refetch happens on the timer.
      expect(getLimits).toHaveBeenCalledTimes(1)
    })

    it('schedules a trailing refetch after the optimistic grace window', async () => {
      const getLimits = vi
        .fn()
        .mockResolvedValueOnce({
          withinLimits: true,
          remaining: 5,
          meterName: 'requests',
          activationRequired: false,
        })
        .mockResolvedValueOnce({
          withinLimits: true,
          remaining: 4,
          meterName: 'requests',
          activationRequired: false,
        })
      setTransport({ getLimits })

      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

      const { result } = renderHook(() => useLimits({ productRef: 'prd_api' }))
      await vi.waitFor(() => expect(result.current.remaining).toBe(5))

      act(() => {
        result.current.adjustRemaining(-1)
      })

      await act(async () => {
        await vi.advanceTimersByTimeAsync(OPTIMISTIC_GRACE_MS + 50)
      })

      expect(getLimits).toHaveBeenCalledTimes(2)
    })

    it('clamps remaining at 0', async () => {
      const getLimits = vi.fn().mockResolvedValue({
        withinLimits: true,
        remaining: 1,
        meterName: 'requests',
        activationRequired: false,
      })
      setTransport({ getLimits })

      const { result } = renderHook(() => useLimits({ productRef: 'prd_api' }))
      await waitFor(() => expect(result.current.remaining).toBe(1))

      act(() => {
        result.current.adjustRemaining(-5)
      })

      expect(result.current.remaining).toBe(0)
    })

    it('keeps adjustRemaining referentially stable across data changes', async () => {
      const getLimits = vi
        .fn()
        .mockResolvedValueOnce({
          withinLimits: true,
          remaining: 5,
          meterName: 'requests',
          activationRequired: false,
        })
        .mockResolvedValueOnce({
          withinLimits: true,
          remaining: 4,
          meterName: 'requests',
          activationRequired: false,
        })
      setTransport({ getLimits })

      const { result } = renderHook(() => useLimits({ productRef: 'prd_api' }))
      await waitFor(() => expect(result.current.remaining).toBe(5))

      const firstRef = result.current.adjustRemaining

      // Optimistic decrement mutates `data`. The callback identity
      // must NOT change — `useBalance.adjustBalance` and other
      // setter-callback patterns rely on this so consumers'
      // `useCallback`s with `[..., adjustRemaining]` deps don't
      // rebuild on every counter tick.
      act(() => {
        result.current.adjustRemaining(-1)
      })
      expect(result.current.remaining).toBe(4)

      const secondRef = result.current.adjustRemaining
      expect(secondRef).toBe(firstRef)

      // A forced refetch lands a new value too — still stable.
      await act(async () => {
        await result.current.refetch()
      })
      expect(result.current.adjustRemaining).toBe(firstRef)
    })
  })

  describe('loading initial state', () => {
    it('starts with loading: true on first render with no cache', () => {
      const getLimits = vi.fn().mockReturnValue(new Promise(() => {}))
      setTransport({ getLimits })

      const { result } = renderHook(() => useLimits({ productRef: 'prd_api' }))

      // Regression: previously initialised to `false`, leaving a
      // one-render gap where consumers read `loading=false, data=null`
      // and committed to a misleading "no data yet" state.
      expect(result.current.loading).toBe(true)
      expect(result.current.remaining).toBeNull()
    })

    it('starts with loading: false on first render with a fresh cache hit', async () => {
      // Pre-warm the cache with a fresh entry.
      limitsCache.set('cus_test:prd_api:requests', {
        data: {
          withinLimits: true,
          remaining: 7,
          meterName: 'requests',
          activationRequired: false,
        },
        timestamp: Date.now(),
        promise: null,
      })
      const getLimits = vi.fn().mockResolvedValue({
        withinLimits: true,
        remaining: 7,
        meterName: 'requests',
        activationRequired: false,
      })
      setTransport({ getLimits })

      const { result } = renderHook(() => useLimits({ productRef: 'prd_api' }))

      // Cache is fresh — no flicker through `loading: true`.
      expect(result.current.loading).toBe(false)
      expect(result.current.remaining).toBe(7)
    })

    it('starts with loading: false when productRef is undefined', () => {
      const getLimits = vi.fn()
      setTransport({ getLimits })

      const { result } = renderHook(() => useLimits({ productRef: undefined }))

      expect(result.current.loading).toBe(false)
    })

    it('starts with loading: true when cache entry is in-flight', () => {
      // Seed the cache with an in-flight slot — the second mount
      // should reflect that the value is still resolving.
      limitsCache.set('cus_test:prd_api:requests', {
        data: null,
        timestamp: Date.now(),
        promise: new Promise(() => {}),
      })
      const getLimits = vi.fn().mockReturnValue(new Promise(() => {}))
      setTransport({ getLimits })

      const { result } = renderHook(() => useLimits({ productRef: 'prd_api' }))

      expect(result.current.loading).toBe(true)
      expect(result.current.remaining).toBeNull()
    })
  })
})
