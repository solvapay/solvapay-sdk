import { renderHook, act, waitFor } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import React from 'react'
import {
  useCustomerSessionUrl,
  __resetCustomerSessionStore,
} from './useCustomerSessionUrl'
import { SolvaPayContext } from '../SolvaPayProvider'
import type { SolvaPayContextValue, SolvaPayConfig } from '../types'

function buildTransport(
  overrides: Partial<NonNullable<SolvaPayConfig['transport']>> = {},
): NonNullable<SolvaPayConfig['transport']> {
  return {
    checkPurchase: vi.fn(),
    createPayment: vi.fn(),
    processPayment: vi.fn(),
    createTopupPayment: vi.fn(),
    getBalance: vi.fn(),
    cancelRenewal: vi.fn(),
    reactivateRenewal: vi.fn(),
    activatePlan: vi.fn(),
    createCheckoutSession: vi.fn(),
    createCustomerSession: vi
      .fn()
      .mockResolvedValue({ customerUrl: 'https://portal.test/default' }),
    getMerchant: vi.fn(),
    getProduct: vi.fn(),
    listPlans: vi.fn(),
    getPaymentMethod: vi.fn(),
    ...overrides,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
}

function buildCtx(transport: NonNullable<SolvaPayConfig['transport']>): SolvaPayContextValue {
  return {
    purchase: {
      loading: false,
      isRefetching: false,
      error: null,
      purchases: [],
      hasProduct: () => false,
      activePurchase: null,
      hasPaidPurchase: false,
      activePaidPurchase: null,
      balanceTransactions: [],
    },
    refetchPurchase: vi.fn(),
    createPayment: vi.fn(),
    createTopupPayment: vi.fn(),
    cancelRenewal: vi.fn(),
    reactivateRenewal: vi.fn(),
    activatePlan: vi.fn(),
    balance: {
      loading: false,
      credits: null,
      displayCurrency: null,
      creditsPerMinorUnit: null,
      displayExchangeRate: null,
      refetch: vi.fn(),
      adjustBalance: vi.fn(),
    },
    _config: { transport },
  }
}

function wrapperFor(transport: NonNullable<SolvaPayConfig['transport']>) {
  const ctx = buildCtx(transport)
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <SolvaPayContext.Provider value={ctx}>{children}</SolvaPayContext.Provider>
  }
}

describe('useCustomerSessionUrl', () => {
  it('starts loading on mount and resolves to the customer portal URL', async () => {
    const transport = buildTransport({
      createCustomerSession: vi
        .fn()
        .mockResolvedValue({ customerUrl: 'https://portal.test/abc' }),
    })

    const { result } = renderHook(() => useCustomerSessionUrl(), {
      wrapper: wrapperFor(transport),
    })

    expect(result.current.status).toBe('loading')

    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(result.current.url).toBe('https://portal.test/abc')
    expect(result.current.error).toBeUndefined()
    __resetCustomerSessionStore(transport)
  })

  it('shares a single in-flight fetch across multiple consumers under the same transport', async () => {
    const createCustomerSession = vi
      .fn()
      .mockResolvedValue({ customerUrl: 'https://portal.test/shared' })
    const transport = buildTransport({ createCustomerSession })

    const wrapper = wrapperFor(transport)
    const { result: first } = renderHook(() => useCustomerSessionUrl(), { wrapper })
    const { result: second } = renderHook(() => useCustomerSessionUrl(), { wrapper })

    await waitFor(() => {
      expect(first.current.status).toBe('ready')
      expect(second.current.status).toBe('ready')
    })

    expect(createCustomerSession).toHaveBeenCalledTimes(1)
    expect(first.current.url).toBe('https://portal.test/shared')
    expect(second.current.url).toBe('https://portal.test/shared')
    __resetCustomerSessionStore(transport)
  })

  it('isolates caches across distinct transports', async () => {
    const aFetch = vi.fn().mockResolvedValue({ customerUrl: 'https://portal.test/a' })
    const bFetch = vi.fn().mockResolvedValue({ customerUrl: 'https://portal.test/b' })
    const transportA = buildTransport({ createCustomerSession: aFetch })
    const transportB = buildTransport({ createCustomerSession: bFetch })

    const { result: a } = renderHook(() => useCustomerSessionUrl(), {
      wrapper: wrapperFor(transportA),
    })
    const { result: b } = renderHook(() => useCustomerSessionUrl(), {
      wrapper: wrapperFor(transportB),
    })

    await waitFor(() => {
      expect(a.current.status).toBe('ready')
      expect(b.current.status).toBe('ready')
    })

    expect(a.current.url).toBe('https://portal.test/a')
    expect(b.current.url).toBe('https://portal.test/b')
    expect(aFetch).toHaveBeenCalledTimes(1)
    expect(bFetch).toHaveBeenCalledTimes(1)
    __resetCustomerSessionStore(transportA)
    __resetCustomerSessionStore(transportB)
  })

  it('records the error and surfaces it on the snapshot when the fetch rejects', async () => {
    const transport = buildTransport({
      createCustomerSession: vi.fn().mockRejectedValue(new Error('boom')),
    })

    const { result } = renderHook(() => useCustomerSessionUrl(), {
      wrapper: wrapperFor(transport),
    })

    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(result.current.error?.message).toBe('boom')
    expect(result.current.url).toBeUndefined()
    __resetCustomerSessionStore(transport)
  })

  it('ensure() returns the cached URL on subsequent calls without re-fetching', async () => {
    const createCustomerSession = vi
      .fn()
      .mockResolvedValue({ customerUrl: 'https://portal.test/cached' })
    const transport = buildTransport({ createCustomerSession })

    const { result } = renderHook(() => useCustomerSessionUrl(), {
      wrapper: wrapperFor(transport),
    })

    await waitFor(() => expect(result.current.status).toBe('ready'))

    const url = await act(async () => result.current.ensure())
    expect(url).toBe('https://portal.test/cached')
    expect(createCustomerSession).toHaveBeenCalledTimes(1)
    __resetCustomerSessionStore(transport)
  })

  it('ensure() resolves with the same URL for late subscribers that join an in-flight fetch', async () => {
    let resolveFetch: (v: { customerUrl: string }) => void = () => {}
    const createCustomerSession = vi.fn(
      () =>
        new Promise<{ customerUrl: string }>(resolve => {
          resolveFetch = resolve
        }),
    )
    const transport = buildTransport({ createCustomerSession })

    const wrapper = wrapperFor(transport)
    const { result: first } = renderHook(() => useCustomerSessionUrl(), { wrapper })
    expect(first.current.status).toBe('loading')

    // Late subscriber joins after the fetch is already in flight.
    const { result: second } = renderHook(() => useCustomerSessionUrl(), { wrapper })
    expect(second.current.status).toBe('loading')

    const ensurePromise = act(async () => second.current.ensure())
    resolveFetch({ customerUrl: 'https://portal.test/late' })
    const url = await ensurePromise

    expect(url).toBe('https://portal.test/late')
    expect(createCustomerSession).toHaveBeenCalledTimes(1)
    await waitFor(() => {
      expect(first.current.status).toBe('ready')
      expect(second.current.status).toBe('ready')
    })
    __resetCustomerSessionStore(transport)
  })

  it('ensure() retries after an error so a transient failure does not strand the button', async () => {
    const createCustomerSession = vi
      .fn()
      .mockRejectedValueOnce(new Error('flaky'))
      .mockResolvedValueOnce({ customerUrl: 'https://portal.test/retry' })
    const transport = buildTransport({ createCustomerSession })

    const { result } = renderHook(() => useCustomerSessionUrl(), {
      wrapper: wrapperFor(transport),
    })

    await waitFor(() => expect(result.current.status).toBe('error'))

    const url = await act(async () => result.current.ensure())
    expect(url).toBe('https://portal.test/retry')
    expect(createCustomerSession).toHaveBeenCalledTimes(2)
    await waitFor(() => expect(result.current.status).toBe('ready'))
    __resetCustomerSessionStore(transport)
  })

  it('refresh() forces a fresh fetch and replaces the cached URL', async () => {
    const createCustomerSession = vi
      .fn()
      .mockResolvedValueOnce({ customerUrl: 'https://portal.test/v1' })
      .mockResolvedValueOnce({ customerUrl: 'https://portal.test/v2' })
    const transport = buildTransport({ createCustomerSession })

    const { result } = renderHook(() => useCustomerSessionUrl(), {
      wrapper: wrapperFor(transport),
    })

    await waitFor(() => expect(result.current.url).toBe('https://portal.test/v1'))

    const refreshed = await act(async () => result.current.refresh())
    expect(refreshed).toBe('https://portal.test/v2')
    expect(createCustomerSession).toHaveBeenCalledTimes(2)
    await waitFor(() => expect(result.current.url).toBe('https://portal.test/v2'))
    __resetCustomerSessionStore(transport)
  })
})
