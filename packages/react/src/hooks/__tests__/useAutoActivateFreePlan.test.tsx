import { renderHook, waitFor, act } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { useAutoActivateFreePlan } from '../useAutoActivateFreePlan'
import { useActivation } from '../useActivation'
import { useCustomer } from '../useCustomer'
import { useLimits } from '../useLimits'
import { usePlans } from '../usePlans'
import type { Plan } from '../../types'

vi.mock('../useActivation', () => ({ useActivation: vi.fn() }))
vi.mock('../useCustomer', () => ({ useCustomer: vi.fn() }))
vi.mock('../useLimits', () => ({ useLimits: vi.fn() }))
vi.mock('../usePlans', () => ({ usePlans: vi.fn() }))

const mockedUseActivation = vi.mocked(useActivation)
const mockedUseCustomer = vi.mocked(useCustomer)
const mockedUseLimits = vi.mocked(useLimits)
const mockedUsePlans = vi.mocked(usePlans)

const freePlan: Plan = {
  reference: 'plan_free',
  name: 'Free',
  price: 0,
  requiresPayment: false,
  freeUnits: 3,
}

const paidPlan: Plan = {
  reference: 'plan_pro',
  name: 'Pro',
  price: 1000,
  requiresPayment: true,
}

function setCustomer(customerRef: string | undefined = 'cus_test') {
  mockedUseCustomer.mockReturnValue({
    customerRef,
    email: undefined,
    name: undefined,
    loading: false,
  })
}

interface SetLimitsOpts {
  activationRequired?: boolean | null
  refetch?: () => Promise<void>
}

function setLimits(opts: SetLimitsOpts = {}) {
  const refetch = opts.refetch ?? vi.fn().mockResolvedValue(undefined)
  mockedUseLimits.mockReturnValue({
    remaining: 0,
    withinLimits: false,
    meterName: 'requests',
    activationRequired: opts.activationRequired ?? null,
    loading: false,
    error: null,
    refetch,
    adjustRemaining: vi.fn(),
  })
  return refetch
}

function setPlans(plans: Plan[] = [freePlan]) {
  mockedUsePlans.mockReturnValue({
    plans,
    loading: false,
    error: null,
    selectedPlanIndex: 0,
    selectedPlan: plans[0] ?? null,
    setSelectedPlanIndex: vi.fn(),
    selectPlan: vi.fn(),
    refetch: vi.fn().mockResolvedValue(undefined),
    isSelectionReady: true,
  })
}

type ActivateFn = (params: { productRef: string; planRef: string }) => Promise<void>

interface SetActivationOpts {
  activate?: ActivateFn
  error?: string | null
}

function setActivation(opts: SetActivationOpts = {}) {
  const activate = opts.activate ?? (vi.fn().mockResolvedValue(undefined) as unknown as ActivateFn)
  mockedUseActivation.mockReturnValue({
    activate,
    state: 'idle',
    error: opts.error ?? null,
    result: null,
    reset: vi.fn(),
  })
  return activate
}

beforeEach(() => {
  vi.clearAllMocks()
  setCustomer()
})

describe('useAutoActivateFreePlan', () => {
  it('activates exactly once when activationRequired flips to true', async () => {
    const refetch = setLimits({ activationRequired: true })
    setPlans([freePlan])
    const activate = setActivation()

    renderHook(() => useAutoActivateFreePlan({ productRef: 'prd_api' }))

    await waitFor(() => expect(activate).toHaveBeenCalledTimes(1))
    expect(activate).toHaveBeenCalledWith({
      productRef: 'prd_api',
      planRef: 'plan_free',
    })
    await waitFor(() => expect(refetch).toHaveBeenCalledTimes(1))
  })

  it('does not activate when no free plan exists (PAYG-only product)', async () => {
    setLimits({ activationRequired: true })
    setPlans([paidPlan])
    const activate = setActivation()

    const { result } = renderHook(() =>
      useAutoActivateFreePlan({ productRef: 'prd_payg' }),
    )

    // Give any latent effect a tick.
    await act(async () => {
      await Promise.resolve()
    })

    expect(activate).not.toHaveBeenCalled()
    // Without a free plan, `pending` stays false so the consumer
    // commits to the backend value (`0 left` + upgrade CTA).
    expect(result.current.pending).toBe(false)
  })

  it('does not activate when activationRequired is false', async () => {
    setLimits({ activationRequired: false })
    setPlans([freePlan])
    const activate = setActivation()

    const { result } = renderHook(() =>
      useAutoActivateFreePlan({ productRef: 'prd_api' }),
    )

    await act(async () => {
      await Promise.resolve()
    })

    expect(activate).not.toHaveBeenCalled()
    expect(result.current.pending).toBe(false)
  })

  it('does not activate when enabled=false', async () => {
    setLimits({ activationRequired: true })
    setPlans([freePlan])
    const activate = setActivation()

    const { result } = renderHook(() =>
      useAutoActivateFreePlan({ productRef: 'prd_api', enabled: false }),
    )

    await act(async () => {
      await Promise.resolve()
    })

    expect(activate).not.toHaveBeenCalled()
    expect(result.current.pending).toBe(false)
  })

  it('re-arms on productRef change', async () => {
    setLimits({ activationRequired: true })
    setPlans([freePlan])
    const activate = setActivation()

    const { rerender } = renderHook(
      ({ productRef }: { productRef: string }) =>
        useAutoActivateFreePlan({ productRef }),
      { initialProps: { productRef: 'prd_a' } },
    )

    await waitFor(() => expect(activate).toHaveBeenCalledTimes(1))
    expect(activate).toHaveBeenLastCalledWith({
      productRef: 'prd_a',
      planRef: 'plan_free',
    })

    rerender({ productRef: 'prd_b' })

    await waitFor(() => expect(activate).toHaveBeenCalledTimes(2))
    expect(activate).toHaveBeenLastCalledWith({
      productRef: 'prd_b',
      planRef: 'plan_free',
    })
  })

  it('re-arms on customerRef change', async () => {
    setLimits({ activationRequired: true })
    setPlans([freePlan])
    const activate = setActivation()

    const { rerender } = renderHook(() =>
      useAutoActivateFreePlan({ productRef: 'prd_api' }),
    )

    await waitFor(() => expect(activate).toHaveBeenCalledTimes(1))

    setCustomer('cus_other')
    rerender()

    await waitFor(() => expect(activate).toHaveBeenCalledTimes(2))
  })

  it('does not retry on activate rejection', async () => {
    setLimits({ activationRequired: true })
    setPlans([freePlan])
    const activate = vi
      .fn()
      .mockRejectedValue(new Error('activation failed')) as unknown as ActivateFn
    setActivation({ activate })

    const { rerender } = renderHook(() =>
      useAutoActivateFreePlan({ productRef: 'prd_api' }),
    )

    await waitFor(() => expect(activate).toHaveBeenCalledTimes(1))

    rerender()
    rerender()
    rerender()

    await act(async () => {
      await Promise.resolve()
    })

    expect(activate).toHaveBeenCalledTimes(1)
  })

  it('pending flips false after refetch confirms activation', async () => {
    let activationRequired: boolean | null = true
    const refetch = vi.fn().mockImplementation(async () => {
      activationRequired = false
    })
    // Re-evaluate on every render so flipping `activationRequired`
    // takes effect after `refetch`.
    mockedUseLimits.mockImplementation(() => ({
      remaining: 0,
      withinLimits: false,
      meterName: 'requests',
      activationRequired,
      loading: false,
      error: null,
      refetch,
      adjustRemaining: vi.fn(),
    }))
    setPlans([freePlan])
    const activate = setActivation()

    const { result, rerender } = renderHook(() =>
      useAutoActivateFreePlan({ productRef: 'prd_api' }),
    )

    expect(result.current.pending).toBe(true)

    await waitFor(() => expect(activate).toHaveBeenCalled())
    await waitFor(() => expect(refetch).toHaveBeenCalled())

    // The activation-effect's promise chain has resolved — bump the
    // tree once so the new `activationRequired: false` propagates.
    rerender()

    await waitFor(() => expect(result.current.pending).toBe(false))
    expect(result.current.activated).toBe(true)
  })

  it('fires onActivated callback exactly once on success', async () => {
    let activationRequired: boolean | null = true
    const refetch = vi.fn().mockImplementation(async () => {
      activationRequired = false
    })
    mockedUseLimits.mockImplementation(() => ({
      remaining: 0,
      withinLimits: false,
      meterName: 'requests',
      activationRequired,
      loading: false,
      error: null,
      refetch,
      adjustRemaining: vi.fn(),
    }))
    setPlans([freePlan])
    setActivation()

    const onActivated = vi.fn()
    const { rerender } = renderHook(() =>
      useAutoActivateFreePlan({ productRef: 'prd_api', onActivated }),
    )

    await waitFor(() => expect(refetch).toHaveBeenCalled())
    rerender()
    await waitFor(() => expect(onActivated).toHaveBeenCalledTimes(1))
  })
})
