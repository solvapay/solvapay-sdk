import { renderHook, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { useProduct, productCache } from './useProduct'
import { SolvaPayProvider } from '../SolvaPayProvider'

const product = { reference: 'prd_x', name: 'Widget API' }

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
  productCache.clear()
})

describe('useProduct', () => {
  it('returns null without fetching when productRef is missing', async () => {
    const fetchFn = makeFetch(product)
    const { result } = renderHook(() => useProduct(undefined), {
      wrapper: wrapper({ fetch: fetchFn as unknown as typeof fetch }),
    })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.product).toBeNull()
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('fetches via /api/get-product with productRef query', async () => {
    const fetchFn = makeFetch(product)
    const { result } = renderHook(() => useProduct('prd_x'), {
      wrapper: wrapper({ fetch: fetchFn as unknown as typeof fetch }),
    })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.product).toEqual(product)
    expect(fetchFn).toHaveBeenCalledWith(
      '/api/get-product?productRef=prd_x',
      expect.any(Object),
    )
  })

  it('dedupes concurrent lookups by productRef', async () => {
    const fetchFn = makeFetch(product)
    const cfg = { fetch: fetchFn as unknown as typeof fetch }
    renderHook(() => useProduct('prd_x'), { wrapper: wrapper(cfg) })
    renderHook(() => useProduct('prd_x'), { wrapper: wrapper(cfg) })

    await waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(1))
  })

  it('honours config.api.getProduct override', async () => {
    const fetchFn = makeFetch(product)
    renderHook(() => useProduct('prd_x'), {
      wrapper: wrapper({
        api: { getProduct: '/my/product' },
        fetch: fetchFn as unknown as typeof fetch,
      }),
    })

    await waitFor(() =>
      expect(fetchFn).toHaveBeenCalledWith(
        '/my/product?productRef=prd_x',
        expect.any(Object),
      ),
    )
  })
})
