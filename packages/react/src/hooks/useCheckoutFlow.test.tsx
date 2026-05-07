/**
 * `useCheckoutFlow` — coverage for the headless state engine that
 * powers `<CheckoutSteps.*>`, `<PaywallNotice.EmbeddedCheckout>`,
 * and `<McpCheckoutView>`. The hook owns step state, transitions,
 * and lifecycle callbacks; UI/layout decisions live in the
 * consuming part components.
 *
 * Coverage:
 *   - stepped traversal (plan → continue → payment → success)
 *   - PAYG branch (plan → continue [activate_plan] → amount →
 *     continue → payment → success)
 *   - lifecycle callbacks fire at the right transition points
 *     (selection, success, error)
 *   - retry / reset semantics
 *   - status flag transitions
 */

import { act, renderHook, waitFor } from '@testing-library/react'
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useCheckoutFlow } from './useCheckoutFlow'
import { PlanSelector } from '../primitives/PlanSelector'
import { plansCache } from './usePlans'
import { merchantCache } from './useMerchant'
import { SolvaPayContext } from '../SolvaPayProvider'
import type { Plan, PurchaseInfo, SolvaPayConfig, SolvaPayContextValue } from '../types'

const productRef = 'prd_test'

const paygPlan: Plan = {
  reference: 'pln_payg',
  name: 'Pay as you go',
  price: 1,
  currency: 'usd',
  requiresPayment: true,
  type: 'usage-based',
  creditsPerUnit: 1,
}

const proPlan: Plan = {
  reference: 'pln_pro',
  name: 'Pro',
  price: 1800,
  currency: 'usd',
  requiresPayment: true,
  type: 'recurring',
  billingCycle: 'monthly',
  creditsPerUnit: 0,
}

const freePlan: Plan = {
  reference: 'pln_free',
  name: 'Free',
  price: 0,
  currency: 'usd',
  requiresPayment: false,
  type: 'recurring',
  billingCycle: 'monthly',
  creditsPerUnit: 0,
}

function makeTransport(
  overrides: Partial<NonNullable<SolvaPayConfig['transport']>> = {},
): NonNullable<SolvaPayConfig['transport']> {
  return {
    checkPurchase: vi.fn().mockResolvedValue({ purchases: [] }),
    createPayment: vi.fn(),
    processPayment: vi.fn(),
    createTopupPayment: vi.fn(),
    getBalance: vi.fn(),
    cancelRenewal: vi.fn(),
    reactivateRenewal: vi.fn(),
    activatePlan: vi.fn().mockResolvedValue({ status: 'activated' }),
    createCheckoutSession: vi.fn(),
    createCustomerSession: vi.fn(),
    getMerchant: vi.fn(),
    getProduct: vi.fn(),
    listPlans: vi.fn().mockResolvedValue([paygPlan, proPlan]),
    getPaymentMethod: vi.fn().mockResolvedValue({ kind: 'none' }),
    ...overrides,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
}

function buildCtx(config: SolvaPayConfig, purchases: PurchaseInfo[] = []): SolvaPayContextValue {
  const active = purchases.find(p => p.status === 'active') ?? null
  return {
    purchase: {
      loading: false,
      isRefetching: false,
      error: null,
      purchases,
      hasProduct: () => purchases.length > 0,
      activePurchase: active,
      hasPaidPurchase: !!active && (active.amount ?? 0) > 0,
      activePaidPurchase: active,
      balanceTransactions: [],
      customerRef: 'cus_test',
      email: 'demo@acme.test',
      name: 'Demo',
    },
    refetchPurchase: vi.fn(),
    createPayment: vi.fn(),
    createTopupPayment: vi.fn(),
    cancelRenewal: vi.fn(),
    reactivateRenewal: vi.fn(),
    activatePlan: vi.fn().mockResolvedValue({ status: 'activated' }),
    balance: {
      loading: false,
      credits: 0,
      displayCurrency: 'USD',
      creditsPerMinorUnit: 100,
      displayExchangeRate: 1,
      refetch: vi.fn(),
      adjustBalance: vi.fn(),
    },
    _config: config,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
}

interface WrapperOptions {
  transport?: NonNullable<SolvaPayConfig['transport']>
  purchases?: PurchaseInfo[]
  /**
   * Override the cached plans. Defaults to `[paygPlan, proPlan]` so the
   * legacy tests keep their two-plan setup; single-plan / free-only
   * scenarios pass an explicit list.
   */
  plans?: Plan[]
}

function makeWrapper(opts: WrapperOptions = {}): {
  Wrapper: React.FC<{ children: React.ReactNode }>
  transport: NonNullable<SolvaPayConfig['transport']>
} {
  const transport = opts.transport ?? makeTransport()
  const config: SolvaPayConfig = { transport }
  const ctx = buildCtx(config, opts.purchases ?? [])
  plansCache.set(productRef, {
    plans: opts.plans ?? [paygPlan, proPlan],
    timestamp: Date.now(),
    promise: null,
  })
  const Wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <SolvaPayContext.Provider value={ctx}>
      <PlanSelector.Root productRef={productRef} autoSelectFirstPaid={false}>
        {children}
      </PlanSelector.Root>
    </SolvaPayContext.Provider>
  )
  Wrapper.displayName = 'TestWrapper'
  return { Wrapper, transport }
}

beforeEach(() => {
  plansCache.clear()
  merchantCache.clear()
})

afterEach(() => {
  vi.clearAllMocks()
})

// ------------------------------------------------------------------
// Initial state
// ------------------------------------------------------------------

describe('useCheckoutFlow — initial state', () => {
  it('starts at step="plan", idle status, and no transient state', () => {
    const { Wrapper } = makeWrapper()
    const { result } = renderHook(() => useCheckoutFlow({ productRef }), {
      wrapper: Wrapper,
    })
    expect(result.current.step).toBe('plan')
    expect(result.current.status).toBe('idle')
    expect(result.current.selectedAmountMinor).toBeNull()
    expect(result.current.successMeta).toBeNull()
    expect(result.current.error).toBeNull()
  })

  it('honours initialStep override (test seam)', () => {
    const { Wrapper } = makeWrapper()
    const { result } = renderHook(() => useCheckoutFlow({ productRef, initialStep: 'amount' }), {
      wrapper: Wrapper,
    })
    expect(result.current.step).toBe('amount')
  })
})

// ------------------------------------------------------------------
// Plan selection
// ------------------------------------------------------------------

describe('useCheckoutFlow — selectPlan', () => {
  it('updates selectedPlan and selectedPlanRef', async () => {
    const { Wrapper } = makeWrapper()
    const { result } = renderHook(() => useCheckoutFlow({ productRef }), {
      wrapper: Wrapper,
    })
    act(() => {
      result.current.selectPlan('pln_payg')
    })
    await waitFor(() => {
      expect(result.current.selectedPlanRef).toBe('pln_payg')
    })
    expect(result.current.selectedPlan?.reference).toBe('pln_payg')
  })

  it('fires onPlanSelect with planRef and plan', async () => {
    const { Wrapper } = makeWrapper()
    const onPlanSelect = vi.fn()
    const { result } = renderHook(() => useCheckoutFlow({ productRef, onPlanSelect }), {
      wrapper: Wrapper,
    })
    act(() => {
      result.current.selectPlan('pln_pro')
    })
    await waitFor(() => {
      expect(onPlanSelect).toHaveBeenCalledTimes(1)
    })
    expect(onPlanSelect).toHaveBeenCalledWith(
      'pln_pro',
      expect.objectContaining({ reference: 'pln_pro' }),
    )
  })
})

// ------------------------------------------------------------------
// PAYG branch — plan → amount → payment → success
// ------------------------------------------------------------------

describe('useCheckoutFlow — PAYG branch', () => {
  it('advance() from plan → amount calls activatePlan and updates step', async () => {
    const activate = vi.fn().mockResolvedValue({ status: 'activated' })
    const { Wrapper, transport } = makeWrapper({
      transport: makeTransport({ activatePlan: activate }),
    })
    const { result } = renderHook(() => useCheckoutFlow({ productRef }), {
      wrapper: Wrapper,
    })
    act(() => {
      result.current.selectPlan('pln_payg')
    })
    await waitFor(() => expect(result.current.selectedPlanRef).toBe('pln_payg'))

    await act(async () => {
      await result.current.advance()
    })

    expect(activate).toHaveBeenCalledWith({
      productRef,
      planRef: 'pln_payg',
    })
    expect(result.current.step).toBe('amount')
    expect(result.current.status).toBe('idle')
    expect(transport.createTopupPayment).not.toHaveBeenCalled()
  })

  it('flips status to "activating" while the plan→amount transition is in flight', async () => {
    let resolveActivate!: (v: { status: 'activated' }) => void
    const activate = vi.fn(
      () =>
        new Promise<{ status: 'activated' }>(resolve => {
          resolveActivate = resolve
        }),
    )
    const { Wrapper } = makeWrapper({
      transport: makeTransport({ activatePlan: activate }),
    })
    const { result } = renderHook(() => useCheckoutFlow({ productRef }), {
      wrapper: Wrapper,
    })
    act(() => {
      result.current.selectPlan('pln_payg')
    })
    await waitFor(() => expect(result.current.selectedPlanRef).toBe('pln_payg'))

    let advancePromise!: Promise<void>
    act(() => {
      advancePromise = result.current.advance()
    })
    await waitFor(() => expect(result.current.status).toBe('activating'))
    expect(result.current.step).toBe('plan')

    await act(async () => {
      resolveActivate({ status: 'activated' })
      await advancePromise
    })
    expect(result.current.step).toBe('amount')
    expect(result.current.status).toBe('idle')
  })

  it('selectAmount() updates selectedAmountMinor and fires onAmountSelect', async () => {
    const { Wrapper } = makeWrapper()
    const onAmountSelect = vi.fn()
    const { result } = renderHook(() => useCheckoutFlow({ productRef, onAmountSelect }), {
      wrapper: Wrapper,
    })
    act(() => {
      result.current.selectPlan('pln_payg')
    })
    await waitFor(() => expect(result.current.selectedPlanRef).toBe('pln_payg'))
    await act(async () => {
      await result.current.advance()
    })
    act(() => {
      result.current.selectAmount(2500)
    })
    expect(result.current.selectedAmountMinor).toBe(2500)
    expect(onAmountSelect).toHaveBeenCalledWith(2500, 'USD')
  })

  it('advance() from amount → payment is a local transition (no transport call)', async () => {
    const { Wrapper, transport } = makeWrapper()
    const { result } = renderHook(() => useCheckoutFlow({ productRef }), {
      wrapper: Wrapper,
    })
    act(() => {
      result.current.selectPlan('pln_payg')
    })
    await waitFor(() => expect(result.current.selectedPlanRef).toBe('pln_payg'))
    await act(async () => {
      await result.current.advance()
    })
    expect(transport.activatePlan).toHaveBeenCalledTimes(1)
    act(() => {
      result.current.selectAmount(1800)
    })
    await act(async () => {
      await result.current.advance()
    })
    expect(result.current.step).toBe('payment')
    expect(transport.activatePlan).toHaveBeenCalledTimes(1)
    expect(transport.createTopupPayment).not.toHaveBeenCalled()
  })

  it('advance() from payment → success records PAYG successMeta and fires onPurchaseSuccess', async () => {
    const { Wrapper } = makeWrapper()
    const onPurchaseSuccess = vi.fn()
    const { result } = renderHook(() => useCheckoutFlow({ productRef, onPurchaseSuccess }), {
      wrapper: Wrapper,
    })
    act(() => {
      result.current.selectPlan('pln_payg')
    })
    await waitFor(() => expect(result.current.selectedPlanRef).toBe('pln_payg'))
    await act(async () => {
      await result.current.advance()
    })
    act(() => {
      result.current.selectAmount(1800)
    })
    await act(async () => {
      await result.current.advance()
    })
    await act(async () => {
      await result.current.advance()
    })
    expect(result.current.step).toBe('success')
    expect(result.current.successMeta).toMatchObject({
      branch: 'payg',
      amountMinor: 1800,
      currency: 'USD',
      // creditsPerMinorUnit (100) * (1800 / displayExchangeRate (1)) = 180_000.
      creditsAdded: 180_000,
    })
    expect(onPurchaseSuccess).toHaveBeenCalledTimes(1)
    expect(onPurchaseSuccess).toHaveBeenCalledWith(expect.objectContaining({ branch: 'payg' }))
  })
})

// ------------------------------------------------------------------
// Recurring branch — plan → payment → success
// ------------------------------------------------------------------

describe('useCheckoutFlow — Recurring branch', () => {
  it('advance() from plan → payment skips amount and does not call activatePlan', async () => {
    const { Wrapper, transport } = makeWrapper()
    const { result } = renderHook(() => useCheckoutFlow({ productRef }), {
      wrapper: Wrapper,
    })
    act(() => {
      result.current.selectPlan('pln_pro')
    })
    await waitFor(() => expect(result.current.selectedPlanRef).toBe('pln_pro'))
    await act(async () => {
      await result.current.advance()
    })
    expect(result.current.step).toBe('payment')
    expect(transport.activatePlan).not.toHaveBeenCalled()
  })

  it('advance() from payment → success records recurring successMeta', async () => {
    const { Wrapper } = makeWrapper()
    const onPurchaseSuccess = vi.fn()
    const { result } = renderHook(() => useCheckoutFlow({ productRef, onPurchaseSuccess }), {
      wrapper: Wrapper,
    })
    act(() => {
      result.current.selectPlan('pln_pro')
    })
    await waitFor(() => expect(result.current.selectedPlanRef).toBe('pln_pro'))
    await act(async () => {
      await result.current.advance()
    })
    await act(async () => {
      await result.current.advance()
    })
    expect(result.current.step).toBe('success')
    expect(result.current.successMeta).toMatchObject({
      branch: 'recurring',
      currency: 'USD',
      chargedTodayMinor: 1800,
    })
    expect(onPurchaseSuccess).toHaveBeenCalledTimes(1)
  })
})

// ------------------------------------------------------------------
// Back / reset
// ------------------------------------------------------------------

describe('useCheckoutFlow — back/reset', () => {
  it('back() from amount returns to plan and clears any error', async () => {
    const { Wrapper } = makeWrapper()
    const { result } = renderHook(() => useCheckoutFlow({ productRef }), {
      wrapper: Wrapper,
    })
    act(() => {
      result.current.selectPlan('pln_payg')
    })
    await waitFor(() => expect(result.current.selectedPlanRef).toBe('pln_payg'))
    await act(async () => {
      await result.current.advance()
    })
    expect(result.current.step).toBe('amount')
    act(() => {
      result.current.back()
    })
    expect(result.current.step).toBe('plan')
    expect(result.current.error).toBeNull()
  })

  it('back() from PAYG payment returns to amount (does not re-fire activate)', async () => {
    const { Wrapper, transport } = makeWrapper()
    const { result } = renderHook(() => useCheckoutFlow({ productRef }), {
      wrapper: Wrapper,
    })
    act(() => {
      result.current.selectPlan('pln_payg')
    })
    await waitFor(() => expect(result.current.selectedPlanRef).toBe('pln_payg'))
    await act(async () => {
      await result.current.advance()
    })
    act(() => {
      result.current.selectAmount(1800)
    })
    await act(async () => {
      await result.current.advance()
    })
    expect(result.current.step).toBe('payment')
    expect(transport.activatePlan).toHaveBeenCalledTimes(1)
    act(() => {
      result.current.back()
    })
    expect(result.current.step).toBe('amount')
    expect(transport.activatePlan).toHaveBeenCalledTimes(1)
  })

  it('back() from recurring payment returns to plan', async () => {
    const { Wrapper } = makeWrapper()
    const { result } = renderHook(() => useCheckoutFlow({ productRef }), {
      wrapper: Wrapper,
    })
    act(() => {
      result.current.selectPlan('pln_pro')
    })
    await waitFor(() => expect(result.current.selectedPlanRef).toBe('pln_pro'))
    await act(async () => {
      await result.current.advance()
    })
    expect(result.current.step).toBe('payment')
    act(() => {
      result.current.back()
    })
    expect(result.current.step).toBe('plan')
  })

  it('reset() returns to plan and clears amount/successMeta/error', async () => {
    const { Wrapper } = makeWrapper()
    const { result } = renderHook(() => useCheckoutFlow({ productRef }), {
      wrapper: Wrapper,
    })
    act(() => {
      result.current.selectPlan('pln_payg')
    })
    await waitFor(() => expect(result.current.selectedPlanRef).toBe('pln_payg'))
    await act(async () => {
      await result.current.advance()
    })
    act(() => {
      result.current.selectAmount(2500)
    })
    act(() => {
      result.current.reset()
    })
    expect(result.current.step).toBe('plan')
    expect(result.current.selectedAmountMinor).toBeNull()
    expect(result.current.successMeta).toBeNull()
    expect(result.current.error).toBeNull()
  })
})

// ------------------------------------------------------------------
// Error / retry
// ------------------------------------------------------------------

describe('useCheckoutFlow — error and retry', () => {
  it('records error + fires onError when activatePlan rejects', async () => {
    const activate = vi.fn().mockRejectedValueOnce(new Error('Activation failed'))
    const onError = vi.fn()
    const { Wrapper } = makeWrapper({
      transport: makeTransport({ activatePlan: activate }),
    })
    const { result } = renderHook(() => useCheckoutFlow({ productRef, onError }), {
      wrapper: Wrapper,
    })
    act(() => {
      result.current.selectPlan('pln_payg')
    })
    await waitFor(() => expect(result.current.selectedPlanRef).toBe('pln_payg'))
    await act(async () => {
      await result.current.advance()
    })
    expect(result.current.step).toBe('plan')
    expect(result.current.status).toBe('error')
    expect(result.current.error).toMatch(/Activation failed/)
    expect(onError).toHaveBeenCalledTimes(1)
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Activation failed' }),
      'activate',
    )
  })

  it('retry() re-attempts the failed transition and succeeds on second try', async () => {
    const activate = vi
      .fn()
      .mockRejectedValueOnce(new Error('Transient'))
      .mockResolvedValue({ status: 'activated' })
    const { Wrapper } = makeWrapper({
      transport: makeTransport({ activatePlan: activate }),
    })
    const { result } = renderHook(() => useCheckoutFlow({ productRef }), {
      wrapper: Wrapper,
    })
    act(() => {
      result.current.selectPlan('pln_payg')
    })
    await waitFor(() => expect(result.current.selectedPlanRef).toBe('pln_payg'))
    await act(async () => {
      await result.current.advance()
    })
    expect(result.current.status).toBe('error')
    await act(async () => {
      await result.current.retry()
    })
    expect(activate).toHaveBeenCalledTimes(2)
    expect(result.current.step).toBe('amount')
    expect(result.current.status).toBe('idle')
    expect(result.current.error).toBeNull()
  })
})

// ------------------------------------------------------------------
// Lifecycle ordering — exercises the full PAYG happy path so that
// callbacks fire in the same order the consuming layer (MCP bridge,
// chat demo, custom integrators) observes.
// ------------------------------------------------------------------

describe('useCheckoutFlow — lifecycle ordering', () => {
  it('fires callbacks in order: onPlanSelect → onAmountSelect → onPurchaseSuccess', async () => {
    const { Wrapper } = makeWrapper()
    const calls: string[] = []
    const onPlanSelect = vi.fn(() => {
      calls.push('plan')
    })
    const onAmountSelect = vi.fn(() => {
      calls.push('amount')
    })
    const onPurchaseSuccess = vi.fn(() => {
      calls.push('success')
    })
    const { result } = renderHook(
      () =>
        useCheckoutFlow({
          productRef,
          onPlanSelect,
          onAmountSelect,
          onPurchaseSuccess,
        }),
      { wrapper: Wrapper },
    )
    act(() => {
      result.current.selectPlan('pln_payg')
    })
    await waitFor(() => expect(result.current.selectedPlanRef).toBe('pln_payg'))
    await act(async () => {
      await result.current.advance()
    })
    act(() => {
      result.current.selectAmount(1800)
    })
    await act(async () => {
      await result.current.advance()
    })
    await act(async () => {
      await result.current.advance()
    })
    expect(calls).toEqual(['plan', 'amount', 'success'])
  })
})

// ------------------------------------------------------------------
// Auto-skip single plan — the hook short-circuits the plan step when
// the product exposes only one selectable plan. Web/paywall surfaces
// inherit this default; the MCP wrapper opts out so its
// "Stay on Free" affordance stays reachable.
// ------------------------------------------------------------------

describe('useCheckoutFlow — autoSkipSinglePlan', () => {
  it('single recurring plan: auto-selects + lands on payment, no activatePlan', async () => {
    const onPlanSelect = vi.fn()
    const { Wrapper, transport } = makeWrapper({ plans: [proPlan] })
    const { result } = renderHook(
      () => useCheckoutFlow({ productRef, onPlanSelect }),
      { wrapper: Wrapper },
    )
    await waitFor(() => expect(result.current.step).toBe('payment'))
    expect(result.current.selectedPlanRef).toBe('pln_pro')
    expect(result.current.branch).toBe('recurring')
    expect(transport.activatePlan).not.toHaveBeenCalled()
    expect(onPlanSelect).toHaveBeenCalledTimes(1)
    expect(onPlanSelect).toHaveBeenCalledWith(
      'pln_pro',
      expect.objectContaining({ reference: 'pln_pro' }),
    )
  })

  it('single PAYG plan: auto-selects, calls activatePlan, lands on amount', async () => {
    const activate = vi.fn().mockResolvedValue({ status: 'activated' })
    const onPlanSelect = vi.fn()
    const { Wrapper } = makeWrapper({
      plans: [paygPlan],
      transport: makeTransport({ activatePlan: activate }),
    })
    const { result } = renderHook(
      () => useCheckoutFlow({ productRef, onPlanSelect }),
      { wrapper: Wrapper },
    )
    await waitFor(() => expect(result.current.step).toBe('amount'))
    expect(result.current.selectedPlanRef).toBe('pln_payg')
    expect(activate).toHaveBeenCalledWith({ productRef, planRef: 'pln_payg' })
    expect(activate).toHaveBeenCalledTimes(1)
    expect(onPlanSelect).toHaveBeenCalledTimes(1)
  })

  it('[Free, Paid] still auto-skips — Free is not selectable', async () => {
    const { Wrapper } = makeWrapper({ plans: [freePlan, proPlan] })
    const { result } = renderHook(() => useCheckoutFlow({ productRef }), {
      wrapper: Wrapper,
    })
    await waitFor(() => expect(result.current.step).toBe('payment'))
    expect(result.current.selectedPlanRef).toBe('pln_pro')
  })

  it('all-Free product: stays on plan step (zero selectable plans)', async () => {
    const onPlanSelect = vi.fn()
    const { Wrapper } = makeWrapper({ plans: [freePlan] })
    const { result } = renderHook(
      () => useCheckoutFlow({ productRef, onPlanSelect }),
      { wrapper: Wrapper },
    )
    await act(async () => {
      await Promise.resolve()
    })
    expect(result.current.step).toBe('plan')
    expect(onPlanSelect).not.toHaveBeenCalled()
  })

  it('multiple paid plans: stays on plan step, no auto-skip onPlanSelect', async () => {
    const onPlanSelect = vi.fn()
    const { Wrapper } = makeWrapper({
      plans: [paygPlan, proPlan],
      transport: makeTransport(),
    })
    const { result } = renderHook(
      () => useCheckoutFlow({ productRef, onPlanSelect }),
      { wrapper: Wrapper },
    )
    await act(async () => {
      await Promise.resolve()
    })
    expect(result.current.step).toBe('plan')
    // Auto-skip's `onPlanSelect` MUST NOT fire when more than one plan
    // is selectable, even though `<PlanSelector.Root>` index-0
    // defaults to "selecting" the first plan internally.
    expect(onPlanSelect).not.toHaveBeenCalled()
  })

  it('autoSkipSinglePlan: false disables the behavior', async () => {
    const onPlanSelect = vi.fn()
    const { Wrapper, transport } = makeWrapper({ plans: [proPlan] })
    const { result } = renderHook(
      () =>
        useCheckoutFlow({
          productRef,
          autoSkipSinglePlan: false,
          onPlanSelect,
        }),
      { wrapper: Wrapper },
    )
    await act(async () => {
      await Promise.resolve()
    })
    expect(result.current.step).toBe('plan')
    expect(transport.activatePlan).not.toHaveBeenCalled()
    expect(onPlanSelect).not.toHaveBeenCalled()
  })
})

// ------------------------------------------------------------------
// canGoBack — read by `<CheckoutSteps.BackLink>` to suppress itself
// when a back action would land on a step the user can't act on.
// ------------------------------------------------------------------

describe('useCheckoutFlow — canGoBack', () => {
  it('single recurring plan + auto-skip: canGoBack is false on payment', async () => {
    const { Wrapper } = makeWrapper({ plans: [proPlan] })
    const { result } = renderHook(() => useCheckoutFlow({ productRef }), {
      wrapper: Wrapper,
    })
    await waitFor(() => expect(result.current.step).toBe('payment'))
    expect(result.current.canGoBack).toBe(false)
  })

  it('single PAYG plan + auto-skip: canGoBack is true on amount and on payment', async () => {
    const { Wrapper } = makeWrapper({ plans: [paygPlan] })
    const { result } = renderHook(() => useCheckoutFlow({ productRef }), {
      wrapper: Wrapper,
    })
    await waitFor(() => expect(result.current.step).toBe('amount'))
    expect(result.current.canGoBack).toBe(true)
    act(() => {
      result.current.selectAmount(1800)
    })
    await act(async () => {
      await result.current.advance()
    })
    expect(result.current.step).toBe('payment')
    expect(result.current.canGoBack).toBe(true)
  })

  it('multi-plan recurring: canGoBack is true on payment (real plan choice)', async () => {
    const { Wrapper } = makeWrapper({ plans: [paygPlan, proPlan] })
    const { result } = renderHook(() => useCheckoutFlow({ productRef }), {
      wrapper: Wrapper,
    })
    act(() => {
      result.current.selectPlan('pln_pro')
    })
    await waitFor(() => expect(result.current.selectedPlanRef).toBe('pln_pro'))
    await act(async () => {
      await result.current.advance()
    })
    expect(result.current.step).toBe('payment')
    expect(result.current.canGoBack).toBe(true)
  })
})
