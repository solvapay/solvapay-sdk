import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import React from 'react'
import { useTopup } from '../hooks/useTopup'
import { SolvaPayContext } from '../SolvaPayProvider'
import type { SolvaPayContextValue } from '../types'
import { mockBalanceStatus } from '../test-helpers/mockBalanceStatus'

const vault = { tenantId: 'tntr4ol0cbq', environment: 'sandbox' as const }

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
      balanceTransactions: [],
    },
    refetchPurchase: vi.fn(),
    upsertPurchase: vi.fn(),
    createPayment: vi.fn(),
    createTopupPayment: vi.fn().mockResolvedValue({
      id: 'pi_topup_1',
      captureMode: 'vault',
      vault,
      customerRef: 'cus_789',
    }),
    createCaptureGrant: vi.fn(),
    confirmPayment: vi.fn(),
    cancelRenewal: vi.fn(),
    reactivateRenewal: vi.fn(),
    activatePlan: vi.fn(),
    balance: mockBalanceStatus(),
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
    expect(result.current.paymentIntentId).toBeNull()
    expect(result.current.vault).toBeNull()
    expect(result.current.processorPaymentId).toBeNull()
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
    expect(result.current.error).toBeNull()
    expect(result.current.paymentIntentId).toBe('pi_topup_1')
    expect(result.current.vault).toStrictEqual(vault)
  })

  it('calls createTopupPayment with correct amount and currency', async () => {
    const createTopupPayment = vi.fn().mockResolvedValue({
      id: 'pi_topup_1',
      captureMode: 'vault',
      vault,
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

  it('forwards autoRecharge to createTopupPayment', async () => {
    const createTopupPayment = vi.fn().mockResolvedValue({
      id: 'pi_topup_1',
      captureMode: 'vault',
      vault,
    })
    const autoRecharge = {
      enabled: true,
      triggerType: 'balance' as const,
      thresholdAmountMajor: 5,
      topupAmountMajor: 10,
      currency: 'USD',
    }
    const ctx = createMockContext({ createTopupPayment })

    const { result } = renderHook(
      () => useTopup({ amount: 5000, currency: 'usd', autoRecharge }),
      { wrapper: createWrapper(ctx) },
    )

    await act(async () => {
      await result.current.startTopup()
    })

    expect(createTopupPayment).toHaveBeenCalledWith({ amount: 5000, currency: 'usd', autoRecharge })
  })

  it('sets the payment intent id, vault and processor id from the response', async () => {
    const ctx = createMockContext({
      createTopupPayment: vi.fn().mockResolvedValue({
        id: 'pi_custom_1',
        captureMode: 'vault',
        vault,
        processorPaymentId: 'pi_rail_custom',
      }),
    })

    const { result } = renderHook(() => useTopup({ amount: 1000 }), {
      wrapper: createWrapper(ctx),
    })

    await act(async () => {
      await result.current.startTopup()
    })

    expect(result.current.paymentIntentId).toBe('pi_custom_1')
    expect(result.current.vault).toStrictEqual(vault)
    expect(result.current.processorPaymentId).toBe('pi_rail_custom')
    expect(result.current.error).toBeNull()
  })

  it('updates customerRef if returned by backend', async () => {
    const updateCustomerRef = vi.fn()
    const ctx = createMockContext({
      updateCustomerRef,
      customerRef: undefined,
      createTopupPayment: vi.fn().mockResolvedValue({
        id: 'pi_topup_1',
        captureMode: 'vault',
        vault,
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

  it('rejects a response without a vault as an invalid intent', async () => {
    const ctx = createMockContext({
      createTopupPayment: vi.fn().mockResolvedValue({ id: 'pi_topup_1', captureMode: 'vault' }),
    })

    const { result } = renderHook(() => useTopup({ amount: 1000 }), {
      wrapper: createWrapper(ctx),
    })

    await act(async () => {
      await result.current.startTopup()
    })

    expect(result.current.error?.message).toBe('Invalid vault in topup payment intent response')
    expect(result.current.paymentIntentId).toBeNull()
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
          id: 'pi_topup_1',
          captureMode: 'vault',
          vault,
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

    expect(result.current.paymentIntentId).toBe('pi_topup_1')

    act(() => {
      result.current.reset()
    })

    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBeNull()
    expect(result.current.paymentIntentId).toBeNull()
    expect(result.current.vault).toBeNull()
  })
})
