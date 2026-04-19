import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import React from 'react'
import { useTopup } from '../hooks/useTopup'
import { SolvaPayContext } from '../SolvaPayProvider'
import type { SolvaPayContextValue } from '../types'

vi.mock('@stripe/stripe-js', () => ({
  loadStripe: vi.fn(() => Promise.resolve({ confirmCardPayment: vi.fn() })),
}))

function createMockContext(overrides?: Partial<SolvaPayContextValue>): SolvaPayContextValue {
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
    },
    refetchPurchase: vi.fn(),
    createPayment: vi.fn(),
    createTopupPayment: vi.fn().mockResolvedValue({
      clientSecret: 'pi_topup_secret',
      publishableKey: 'pk_test_123',
      accountId: 'acct_456',
      customerRef: 'cus_789',
    }),
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
    ...overrides,
  }
}

function createWrapper(context: SolvaPayContextValue) {
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(SolvaPayContext.Provider, { value: context }, children)
}

describe('useTopup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns initial state', () => {
    const ctx = createMockContext()
    const { result } = renderHook(() => useTopup({ amount: 1000 }), {
      wrapper: createWrapper(ctx),
    })

    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBeNull()
    expect(result.current.stripePromise).toBeNull()
    expect(result.current.clientSecret).toBeNull()
  })

  it('startTopup sets loading state and then resolves', async () => {
    const ctx = createMockContext()
    const { result } = renderHook(() => useTopup({ amount: 2000 }), {
      wrapper: createWrapper(ctx),
    })

    await act(async () => {
      await result.current.startTopup()
    })

    expect(result.current.loading).toBe(false)
    expect(result.current.clientSecret).toBe('pi_topup_secret')
    expect(result.current.stripePromise).not.toBeNull()
  })

  it('calls createTopupPayment with correct amount and currency', async () => {
    const createTopupPayment = vi.fn().mockResolvedValue({
      clientSecret: 'cs_1',
      publishableKey: 'pk_1',
    })
    const ctx = createMockContext({ createTopupPayment })

    const { result } = renderHook(() => useTopup({ amount: 5000, currency: 'eur' }), {
      wrapper: createWrapper(ctx),
    })

    await act(async () => {
      await result.current.startTopup()
    })

    expect(createTopupPayment).toHaveBeenCalledWith({ amount: 5000, currency: 'eur' })
  })

  it('sets clientSecret from response', async () => {
    const ctx = createMockContext({
      createTopupPayment: vi.fn().mockResolvedValue({
        clientSecret: 'pi_custom_secret',
        publishableKey: 'pk_custom',
      }),
    })

    const { result } = renderHook(() => useTopup({ amount: 1000 }), {
      wrapper: createWrapper(ctx),
    })

    await act(async () => {
      await result.current.startTopup()
    })

    expect(result.current.clientSecret).toBe('pi_custom_secret')
  })

  it('updates customerRef if returned by backend', async () => {
    const updateCustomerRef = vi.fn()
    const ctx = createMockContext({
      updateCustomerRef,
      customerRef: undefined,
      createTopupPayment: vi.fn().mockResolvedValue({
        clientSecret: 'cs',
        publishableKey: 'pk',
        customerRef: 'cus_new_ref',
      }),
    })

    const { result } = renderHook(() => useTopup({ amount: 1000 }), {
      wrapper: createWrapper(ctx),
    })

    await act(async () => {
      await result.current.startTopup()
    })

    expect(updateCustomerRef).toHaveBeenCalledWith('cus_new_ref')
  })

  it('sets error state on failure', async () => {
    const ctx = createMockContext({
      createTopupPayment: vi.fn().mockRejectedValue(new Error('Network error')),
    })

    const { result } = renderHook(() => useTopup({ amount: 1000 }), {
      wrapper: createWrapper(ctx),
    })

    await act(async () => {
      await result.current.startTopup()
    })

    expect(result.current.error).toBeInstanceOf(Error)
    expect(result.current.error?.message).toBe('Network error')
    expect(result.current.loading).toBe(false)
  })

  it('is idempotent — no-ops if already loading', async () => {
    let resolvePromise: () => void
    const hangingPromise = new Promise<void>(resolve => {
      resolvePromise = resolve
    })

    const createTopupPayment = vi.fn().mockImplementation(
      () =>
        hangingPromise.then(() => ({
          clientSecret: 'cs',
          publishableKey: 'pk',
        })),
    )
    const ctx = createMockContext({ createTopupPayment })

    const { result } = renderHook(() => useTopup({ amount: 1000 }), {
      wrapper: createWrapper(ctx),
    })

    // Start first call (will hang)
    act(() => {
      result.current.startTopup()
    })

    // Try starting again while loading — should no-op
    await act(async () => {
      await result.current.startTopup()
    })

    expect(createTopupPayment).toHaveBeenCalledTimes(1)

    // Clean up
    resolvePromise!()
  })

  it('errors when amount is missing or <= 0', async () => {
    const ctx = createMockContext()
    const { result } = renderHook(() => useTopup({ amount: 0 }), {
      wrapper: createWrapper(ctx),
    })

    await act(async () => {
      await result.current.startTopup()
    })

    expect(result.current.error).toBeInstanceOf(Error)
    expect(result.current.error?.message).toMatch(/amount/)
    expect(ctx.createTopupPayment).not.toHaveBeenCalled()
  })

  it('reset() clears all state back to initial', async () => {
    const ctx = createMockContext()
    const { result } = renderHook(() => useTopup({ amount: 1000 }), {
      wrapper: createWrapper(ctx),
    })

    await act(async () => {
      await result.current.startTopup()
    })

    expect(result.current.clientSecret).toBe('pi_topup_secret')

    act(() => {
      result.current.reset()
    })

    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBeNull()
    expect(result.current.stripePromise).toBeNull()
    expect(result.current.clientSecret).toBeNull()
  })
})
