import { renderHook, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { usePlan } from './usePlan'
import { plansCache } from './usePlans'
import { SolvaPayProvider } from '../SolvaPayProvider'
import type { Plan } from '../types'

const planA: Plan = { reference: 'pln_a', name: 'A', price: 500, currency: 'usd' }
const planB: Plan = { reference: 'pln_b', name: 'B', price: 1500, currency: 'usd' }

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
  plansCache.clear()
})

describe('usePlan', () => {
  it('returns null when planRef is missing', async () => {
    const { result } = renderHook(() => usePlan({}), { wrapper: wrapper({}) })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.plan).toBeNull()
  })

  it('fetches plans via /api/list-plans when productRef is provided', async () => {
    const fetchFn = makeFetch({ plans: [planA, planB] })
    const { result } = renderHook(
      () => usePlan({ planRef: 'pln_b', productRef: 'prd_x' }),
      {
        wrapper: wrapper({ fetch: fetchFn as unknown as typeof fetch }),
      },
    )
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.plan).toEqual(planB)
    expect(fetchFn).toHaveBeenCalledWith(
      '/api/list-plans?productRef=prd_x',
      expect.any(Object),
    )
  })

  it('piggybacks on usePlans cache', async () => {
    plansCache.set('prd_x', {
      plans: [planA, planB],
      timestamp: Date.now(),
      promise: null,
    })
    const fetchFn = makeFetch({ plans: [] })
    const { result } = renderHook(
      () => usePlan({ planRef: 'pln_a', productRef: 'prd_x' }),
      {
        wrapper: wrapper({ fetch: fetchFn as unknown as typeof fetch }),
      },
    )
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.plan).toEqual(planA)
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('exposes error when planRef not found in product', async () => {
    const fetchFn = makeFetch({ plans: [planA] })
    const { result } = renderHook(
      () => usePlan({ planRef: 'pln_missing', productRef: 'prd_x' }),
      {
        wrapper: wrapper({ fetch: fetchFn as unknown as typeof fetch }),
      },
    )
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.plan).toBeNull()
    expect(result.current.error).toBeInstanceOf(Error)
  })
})
