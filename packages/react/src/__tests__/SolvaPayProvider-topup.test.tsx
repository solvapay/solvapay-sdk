import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import React from 'react'
import { SolvaPayProvider } from '../SolvaPayProvider'
import { useSolvaPay } from '../hooks/useSolvaPay'
import type { TopupPaymentResult } from '../types'

// Minimal mock for auth adapter
const mockAdapter = {
  getToken: vi.fn().mockResolvedValue('test-token'),
  getUserId: vi.fn().mockResolvedValue('user-123'),
}

function createWrapper(props?: Record<string, unknown>) {
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

describe('SolvaPayProvider - createTopupPayment', () => {
  let fetchSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()

    fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          clientSecret: 'pi_topup_secret',
          publishableKey: 'pk_test_123',
          accountId: 'acct_456',
          customerRef: 'cus_789',
        } satisfies TopupPaymentResult),
    })
    vi.stubGlobal('fetch', fetchSpy)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('posts to default route /api/create-topup-payment-intent', async () => {
    const { result } = renderHook(() => useSolvaPay(), {
      wrapper: createWrapper(),
    })

    await act(async () => {
      await result.current.createTopupPayment({ amount: 5000, currency: 'usd' })
    })

    const topupCalls = fetchSpy.mock.calls.filter(
      (call: unknown[]) => typeof call[0] === 'string' && call[0].includes('topup'),
    )
    expect(topupCalls).toHaveLength(1)
    expect(topupCalls[0][0]).toBe('/api/create-topup-payment-intent')
    expect(topupCalls[0][1].method).toBe('POST')

    const body = JSON.parse(topupCalls[0][1].body)
    expect(body).toEqual({ amount: 5000, currency: 'usd' })
  })

  it('posts to custom route when configured', async () => {
    const { result } = renderHook(() => useSolvaPay(), {
      wrapper: createWrapper({
        config: {
          auth: { adapter: mockAdapter },
          api: { createTopupPayment: '/custom/topup' },
        },
      }),
    })

    await act(async () => {
      await result.current.createTopupPayment({ amount: 3000 })
    })

    const topupCalls = fetchSpy.mock.calls.filter(
      (call: unknown[]) => typeof call[0] === 'string' && call[0].includes('topup'),
    )
    expect(topupCalls).toHaveLength(1)
    expect(topupCalls[0][0]).toBe('/custom/topup')
  })

  it('includes auth headers', async () => {
    const { result } = renderHook(() => useSolvaPay(), {
      wrapper: createWrapper(),
    })

    await act(async () => {
      await result.current.createTopupPayment({ amount: 1000 })
    })

    const topupCalls = fetchSpy.mock.calls.filter(
      (call: unknown[]) => typeof call[0] === 'string' && call[0].includes('topup'),
    )
    expect(topupCalls).toHaveLength(1)
    expect(topupCalls[0][1].headers['Authorization']).toBe('Bearer test-token')
  })

  it('includes cached customerRef header', async () => {
    // Pre-populate the cache
    localStorage.setItem('solvapay_customerRef', 'cus_cached')
    localStorage.setItem('solvapay_customerRef_expiry', String(Date.now() + 86400000))
    localStorage.setItem('solvapay_customerRef_userId', 'user-123')

    const { result } = renderHook(() => useSolvaPay(), {
      wrapper: createWrapper(),
    })

    await act(async () => {
      await result.current.createTopupPayment({ amount: 2000 })
    })

    const topupCalls = fetchSpy.mock.calls.filter(
      (call: unknown[]) => typeof call[0] === 'string' && call[0].includes('topup'),
    )
    expect(topupCalls).toHaveLength(1)
    expect(topupCalls[0][1].headers['x-solvapay-customer-ref']).toBe('cus_cached')
  })

  it('custom createTopupPayment prop overrides default implementation', async () => {
    const customFn = vi.fn().mockResolvedValue({
      clientSecret: 'cs_custom',
      publishableKey: 'pk_custom',
    })

    const { result } = renderHook(() => useSolvaPay(), {
      wrapper: createWrapper({ createTopupPayment: customFn }),
    })

    await act(async () => {
      const res = await result.current.createTopupPayment({ amount: 7000, currency: 'gbp' })
      expect(res.clientSecret).toBe('cs_custom')
    })

    expect(customFn).toHaveBeenCalledWith({ amount: 7000, currency: 'gbp' })

    // Default fetch should NOT have been called with topup route
    const topupFetchCalls = fetchSpy.mock.calls.filter(
      (call: unknown[]) => typeof call[0] === 'string' && call[0].includes('topup'),
    )
    expect(topupFetchCalls).toHaveLength(0)
  })
})
