import { renderHook, waitFor, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { useMerchant, merchantCache } from './useMerchant'
import { SolvaPayProvider } from '../SolvaPayProvider'

const merchantData = {
  displayName: 'Acme',
  legalName: 'Acme Inc.',
  supportEmail: 'support@acme.com',
  termsUrl: 'https://acme.com/terms',
}

function makeFetch(payload: unknown, status = 200) {
  return vi.fn().mockResolvedValue(
    new Response(JSON.stringify(payload), {
      status,
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
  merchantCache.clear()
})

describe('useMerchant', () => {
  it('fetches merchant from /api/merchant by default', async () => {
    const fetchFn = makeFetch(merchantData)
    const { result } = renderHook(() => useMerchant(), {
      wrapper: wrapper({ fetch: fetchFn as unknown as typeof fetch }),
    })

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.merchant).toEqual(merchantData)
    expect(result.current.error).toBeNull()
    expect(fetchFn).toHaveBeenCalledWith('/api/merchant', expect.any(Object))
  })

  it('uses config.api.getMerchant override', async () => {
    const fetchFn = makeFetch(merchantData)
    renderHook(() => useMerchant(), {
      wrapper: wrapper({
        api: { getMerchant: '/custom/merchant' },
        fetch: fetchFn as unknown as typeof fetch,
      }),
    })

    await waitFor(() =>
      expect(fetchFn).toHaveBeenCalledWith('/custom/merchant', expect.any(Object)),
    )
  })

  it('deduplicates concurrent callers via single-flight cache', async () => {
    const fetchFn = makeFetch(merchantData)
    const cfg = { fetch: fetchFn as unknown as typeof fetch }
    const { result: r1 } = renderHook(() => useMerchant(), { wrapper: wrapper(cfg) })
    const { result: r2 } = renderHook(() => useMerchant(), { wrapper: wrapper(cfg) })

    await waitFor(() => expect(r1.current.loading).toBe(false))
    await waitFor(() => expect(r2.current.loading).toBe(false))

    expect(fetchFn).toHaveBeenCalledTimes(1)
    expect(r1.current.merchant).toEqual(merchantData)
    expect(r2.current.merchant).toEqual(merchantData)
  })

  it('exposes error when fetch fails', async () => {
    const fetchFn = makeFetch({ error: 'boom' }, 500)
    const { result } = renderHook(() => useMerchant(), {
      wrapper: wrapper({ fetch: fetchFn as unknown as typeof fetch }),
    })

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.merchant).toBeNull()
    expect(result.current.error).toBeInstanceOf(Error)
  })

  it('refetch forces a new request', async () => {
    const fetchFn = makeFetch(merchantData)
    const { result } = renderHook(() => useMerchant(), {
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
