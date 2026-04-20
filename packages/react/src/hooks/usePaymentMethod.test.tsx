import { renderHook, waitFor, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { usePaymentMethod, paymentMethodCache } from './usePaymentMethod'
import { SolvaPayProvider } from '../SolvaPayProvider'
import type { PaymentMethodInfo } from '@solvapay/server'

const card: PaymentMethodInfo = {
  kind: 'card',
  brand: 'visa',
  last4: '4242',
  expMonth: 12,
  expYear: 2030,
}

function makeFetch(payload: unknown, init: { status?: number } = {}) {
  return vi.fn().mockImplementation(
    async () =>
      new Response(JSON.stringify(payload), {
        status: init.status ?? 200,
        headers: { 'Content-Type': 'application/json' },
      }),
  )
}

function wrapper(config: Parameters<typeof SolvaPayProvider>[0]['config']) {
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <SolvaPayProvider config={config}>{children}</SolvaPayProvider>
  )
  Wrapper.displayName = 'TestWrapper'
  return Wrapper
}

beforeEach(() => {
  paymentMethodCache.clear()
})

describe('usePaymentMethod', () => {
  it('fetches the default payment method from /api/payment-method by default', async () => {
    const fetchFn = makeFetch(card)
    const { result } = renderHook(() => usePaymentMethod(), {
      wrapper: wrapper({ fetch: fetchFn as unknown as typeof fetch }),
    })

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.paymentMethod).toEqual(card)
    expect(result.current.error).toBeNull()
    expect(fetchFn).toHaveBeenCalledWith('/api/payment-method', expect.any(Object))
  })

  it('honours config.api.getPaymentMethod route override', async () => {
    const fetchFn = makeFetch(card)
    renderHook(() => usePaymentMethod(), {
      wrapper: wrapper({
        api: { getPaymentMethod: '/custom/card' },
        fetch: fetchFn as unknown as typeof fetch,
      }),
    })

    await waitFor(() =>
      expect(fetchFn).toHaveBeenCalledWith('/custom/card', expect.any(Object)),
    )
  })

  it('routes through a custom transport when provided', async () => {
    const transport = {
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
      getPaymentMethod: vi.fn().mockResolvedValue(card),
    }
    const fetchFn = makeFetch(card)

    const { result } = renderHook(() => usePaymentMethod(), {
      wrapper: wrapper({
        fetch: fetchFn as unknown as typeof fetch,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        transport: transport as any,
      }),
    })

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(transport.getPaymentMethod).toHaveBeenCalled()
    expect(fetchFn).not.toHaveBeenCalled()
    expect(result.current.paymentMethod).toEqual(card)
  })

  it('surfaces { kind: "none" } from the backend untouched', async () => {
    const fetchFn = makeFetch({ kind: 'none' })
    const { result } = renderHook(() => usePaymentMethod(), {
      wrapper: wrapper({ fetch: fetchFn as unknown as typeof fetch }),
    })

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.paymentMethod).toEqual({ kind: 'none' })
  })

  it('exposes error and leaves paymentMethod null when the fetch fails (graceful hide)', async () => {
    const fetchFn = makeFetch({ error: 'boom' }, { status: 500 })
    const { result } = renderHook(() => usePaymentMethod(), {
      wrapper: wrapper({ fetch: fetchFn as unknown as typeof fetch }),
    })

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.paymentMethod).toBeNull()
    expect(result.current.error).toBeInstanceOf(Error)
  })

  it('deduplicates concurrent callers via single-flight cache', async () => {
    const fetchFn = makeFetch(card)
    const cfg = { fetch: fetchFn as unknown as typeof fetch }
    const { result: r1 } = renderHook(() => usePaymentMethod(), { wrapper: wrapper(cfg) })
    const { result: r2 } = renderHook(() => usePaymentMethod(), { wrapper: wrapper(cfg) })

    await waitFor(() => expect(r1.current.loading).toBe(false))
    await waitFor(() => expect(r2.current.loading).toBe(false))

    expect(fetchFn).toHaveBeenCalledTimes(1)
    expect(r1.current.paymentMethod).toEqual(card)
    expect(r2.current.paymentMethod).toEqual(card)
  })

  it('refetch forces a new request', async () => {
    const fetchFn = makeFetch(card)
    const { result } = renderHook(() => usePaymentMethod(), {
      wrapper: wrapper({ fetch: fetchFn as unknown as typeof fetch }),
    })

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(fetchFn).toHaveBeenCalledTimes(1)

    await act(async () => {
      await result.current.refetch()
    })

    expect(fetchFn).toHaveBeenCalledTimes(2)
  })
})
