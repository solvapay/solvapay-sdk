import { renderHook, waitFor, act } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadStripe } from '@stripe/stripe-js'
import { useStripeProbe } from '../useStripeProbe'

vi.mock('@stripe/stripe-js', () => ({
  loadStripe: vi.fn(),
}))

const loadStripeMock = loadStripe as unknown as ReturnType<typeof vi.fn>

type ListenerMap = Record<string, Array<(err?: unknown) => void>>

interface MockElementHandle {
  element: {
    on: ReturnType<typeof vi.fn>
    mount: ReturnType<typeof vi.fn>
    unmount: ReturnType<typeof vi.fn>
  }
  elements: { create: ReturnType<typeof vi.fn> }
  stripe: { elements: ReturnType<typeof vi.fn> }
  fire: (evt: 'ready' | 'loaderror', err?: unknown) => void
}

function createStripeMock(): MockElementHandle {
  const listeners: ListenerMap = {}
  const element = {
    on: vi.fn((evt: string, fn: (err?: unknown) => void) => {
      ;(listeners[evt] ??= []).push(fn)
    }),
    mount: vi.fn(),
    unmount: vi.fn(),
  }
  const elements = { create: vi.fn(() => element) }
  const stripe = { elements: vi.fn(() => elements) }
  const fire = (evt: 'ready' | 'loaderror', err?: unknown) => {
    for (const fn of listeners[evt] ?? []) fn(err)
  }
  return { element, elements, stripe, fire }
}

const PROBE_HOST_SELECTOR = '[data-solvapay-stripe-probe]'

describe('useStripeProbe', () => {
  beforeEach(() => {
    loadStripeMock.mockReset()
    // Ensure prior tests' probe hosts can't leak into the next assert.
    document.body
      .querySelectorAll(PROBE_HOST_SELECTOR)
      .forEach((el) => el.remove())
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("returns 'blocked' synchronously when publishableKey is null", () => {
    const { result } = renderHook(() => useStripeProbe(null))
    expect(result.current).toBe('blocked')
    expect(loadStripeMock).not.toHaveBeenCalled()
  })

  it("returns 'blocked' when loadStripe rejects", async () => {
    loadStripeMock.mockRejectedValueOnce(new Error('blocked by CSP'))
    const { result } = renderHook(() => useStripeProbe('pk_test_123'))
    expect(result.current).toBe('loading')
    await waitFor(() => expect(result.current).toBe('blocked'))
  })

  it("returns 'blocked' when loadStripe resolves null (invalid key)", async () => {
    loadStripeMock.mockResolvedValueOnce(null)
    const { result } = renderHook(() => useStripeProbe('pk_test_123'))
    await waitFor(() => expect(result.current).toBe('blocked'))
  })

  it("returns 'blocked' when loadStripe does not resolve within the load timeout", async () => {
    // `loadStripe` never resolves → the 3s load timeout wins.
    loadStripeMock.mockImplementationOnce(() => new Promise(() => {}))
    vi.useFakeTimers()
    const { result } = renderHook(() => useStripeProbe('pk_test_123'))
    expect(result.current).toBe('loading')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000)
    })
    expect(result.current).toBe('blocked')
    expect(document.body.querySelector(PROBE_HOST_SELECTOR)).toBeNull()
  })

  it("returns 'ready' when the mounted paymentElement fires `ready` + tears down the host node", async () => {
    const mock = createStripeMock()
    loadStripeMock.mockResolvedValueOnce(mock.stripe)

    const { result } = renderHook(() => useStripeProbe('pk_test_123'))

    await waitFor(() => {
      expect(mock.element.mount).toHaveBeenCalledTimes(1)
    })
    expect(document.body.querySelector(PROBE_HOST_SELECTOR)).not.toBeNull()
    expect(mock.stripe.elements).toHaveBeenCalledWith({
      mode: 'setup',
      currency: 'usd',
    })
    expect(mock.elements.create).toHaveBeenCalledWith('payment')

    act(() => {
      mock.fire('ready')
    })
    await waitFor(() => expect(result.current).toBe('ready'))
    expect(mock.element.unmount).toHaveBeenCalledTimes(1)
    expect(document.body.querySelector(PROBE_HOST_SELECTOR)).toBeNull()
  })

  it("returns 'blocked' when the element fires `loaderror` + tears down the host node", async () => {
    const mock = createStripeMock()
    loadStripeMock.mockResolvedValueOnce(mock.stripe)

    const { result } = renderHook(() => useStripeProbe('pk_test_123'))

    await waitFor(() => expect(mock.element.mount).toHaveBeenCalled())
    act(() => {
      mock.fire('loaderror', { error: { type: 'invalid_request_error' } })
    })

    await waitFor(() => expect(result.current).toBe('blocked'))
    expect(mock.element.unmount).toHaveBeenCalledTimes(1)
    expect(document.body.querySelector(PROBE_HOST_SELECTOR)).toBeNull()
  })

  it("returns 'blocked' when neither `ready` nor `loaderror` fires within the element timeout", async () => {
    const mock = createStripeMock()
    loadStripeMock.mockResolvedValueOnce(mock.stripe)

    // Install fake timers *before* `renderHook` so the element-mount
    // `setTimeout` registered inside the `loadStripe.then` callback
    // uses the fake clock. Microtasks still run under fake timers, so
    // `advanceTimersByTimeAsync(0)` flushes the `loadStripe` promise
    // resolution and lets the element mount.
    vi.useFakeTimers()
    const { result } = renderHook(() => useStripeProbe('pk_test_123'))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(mock.element.mount).toHaveBeenCalled()
    expect(document.body.querySelector(PROBE_HOST_SELECTOR)).not.toBeNull()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000)
    })

    expect(result.current).toBe('blocked')
    expect(mock.element.unmount).toHaveBeenCalledTimes(1)
    expect(document.body.querySelector(PROBE_HOST_SELECTOR)).toBeNull()
  })

  it('tears down element + host node on unmount before resolution (no orphan DOM, no setState-on-unmounted)', async () => {
    const mock = createStripeMock()
    loadStripeMock.mockResolvedValueOnce(mock.stripe)

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const { unmount } = renderHook(() => useStripeProbe('pk_test_123'))

    await waitFor(() => expect(mock.element.mount).toHaveBeenCalled())
    expect(document.body.querySelector(PROBE_HOST_SELECTOR)).not.toBeNull()

    unmount()

    expect(mock.element.unmount).toHaveBeenCalledTimes(1)
    expect(document.body.querySelector(PROBE_HOST_SELECTOR)).toBeNull()

    // Fire events post-unmount — they must not trigger state updates
    // or React's "can't set state on unmounted component" warning.
    act(() => {
      mock.fire('ready')
      mock.fire('loaderror')
    })
    expect(errorSpy).not.toHaveBeenCalled()
    errorSpy.mockRestore()
  })
})
