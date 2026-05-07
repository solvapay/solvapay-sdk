'use client'

/**
 * `useCheckoutFlow` — headless state engine for the four-step
 * checkout (`plan` → `amount` [PAYG only] → `payment` → `success`).
 *
 * Owns step state, transitions, lifecycle callbacks, and the
 * `transport.activatePlan` side-effect on the PAYG plan→amount edge.
 * Knows nothing about layout: consumers compose `<CheckoutSteps.*>`
 * parts (or hand-rolled JSX) on top of the returned state.
 *
 * Must be called inside a `<PlanSelector.Root>` — the hook reads
 * the user's current plan selection from `usePlanSelector()` so the
 * plan grid and the flow share state.
 *
 * Lifecycle hooks fire at well-defined points:
 *  - `onPlanSelect(planRef, plan)` — every selectPlan() call
 *  - `onAmountSelect(amountMinor, currency)` — every selectAmount() call
 *  - `onPurchaseSuccess(meta)` — payment → success transition
 *  - `onError(err, phase)` — failed activate or pay step
 *
 * MCP wrappers thread `bridge.notifyModelContext` etc. through these
 * callbacks; web integrators use them for analytics, drawer dismissal,
 * pending-message replays, etc.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PaymentIntent } from '@stripe/stripe-js'
import { usePlanSelector } from '../primitives/PlanSelector'
import { useBalance } from './useBalance'
import { useTransport } from './useTransport'
import { useLocale } from './useCopy'
import type { Plan } from '../types'
import {
  formatPaygRate,
  inferIncludedCredits,
  isPayg,
  type BootstrapPlanLike,
  type CheckoutStep,
  type SuccessMeta,
} from '../primitives/checkout/shared'

export type CheckoutStatus = 'idle' | 'activating' | 'paying' | 'error'

export type CheckoutErrorPhase = 'activate' | 'pay'

export interface UseCheckoutFlowOptions {
  productRef: string
  /**
   * Override the initial step. Test seam — production callers always
   * start at `'plan'`.
   */
  initialStep?: CheckoutStep
  /**
   * Pre-seed the topup amount. Useful when integrators want to skip
   * the amount picker (e.g. resuming a flow where the amount was
   * decided up front). Pure state seed — does not fire `onAmountSelect`.
   */
  initialAmountMinor?: number
  /**
   * When the product exposes only one selectable plan
   * (`requiresPayment !== false`), auto-select it on mount and advance
   * past the plan step — the grid would just be a one-card formality.
   * Defaults to `true`. The MCP wrapper opts out (`false`) so its
   * paywall-entry "Stay on Free" affordance stays reachable when the
   * bootstrap returns `[Free, Paid]`.
   */
  autoSkipSinglePlan?: boolean
  /** Fires when the user picks a plan (via `selectPlan`). */
  onPlanSelect?: (planRef: string, plan: Plan) => void
  /** Fires when the user picks a topup amount (PAYG branch only). */
  onAmountSelect?: (amountMinor: number, currency: string) => void
  /** Fires after the payment → success transition. */
  onPurchaseSuccess?: (meta: SuccessMeta) => void
  /** Fires on activate / pay errors before the hook surfaces them. */
  onError?: (err: Error, phase: CheckoutErrorPhase) => void
}

export interface UseCheckoutFlowReturn {
  step: CheckoutStep
  status: CheckoutStatus
  selectedPlan: Plan | null
  selectedPlanRef: string | null
  selectedAmountMinor: number | null
  successMeta: SuccessMeta | null
  error: string | null
  /** Returns the active branch — `null` when no plan is selected. */
  branch: 'payg' | 'recurring' | null
  /**
   * Whether the current step has a meaningful previous step to return
   * to. `<CheckoutSteps.BackLink>` reads this to suppress itself when
   * a back action would land on a single-card grid the user can't act
   * on (recurring + auto-skipped plan step).
   */
  canGoBack: boolean

  selectPlan: (planRef: string) => void
  selectAmount: (amountMinor: number) => void
  /** Move from current step → next, awaiting any side-effect. */
  advance: () => Promise<void>
  /** Move to the previous step (PAYG payment → amount, recurring → plan). */
  back: () => void
  /** Return to the plan step and clear all transient state. */
  reset: () => void
  /** Re-attempt the last failed transition. */
  retry: () => Promise<void>
  /**
   * Commit a completed payment. Useful when integrators wire the
   * Stripe form directly (bypassing `<CheckoutSteps.Payment>`); the
   * default parts call this internally on the form's `onSuccess`.
   */
  notifyPaymentSuccess: (intent?: PaymentIntent) => void
}

export function useCheckoutFlow(opts: UseCheckoutFlowOptions): UseCheckoutFlowReturn {
  const {
    productRef,
    initialStep = 'plan',
    initialAmountMinor = null,
    autoSkipSinglePlan = true,
  } = opts
  const onPlanSelectRef = useRef(opts.onPlanSelect)
  const onAmountSelectRef = useRef(opts.onAmountSelect)
  const onPurchaseSuccessRef = useRef(opts.onPurchaseSuccess)
  const onErrorRef = useRef(opts.onError)
  onPlanSelectRef.current = opts.onPlanSelect
  onAmountSelectRef.current = opts.onAmountSelect
  onPurchaseSuccessRef.current = opts.onPurchaseSuccess
  onErrorRef.current = opts.onError

  const planCtx = usePlanSelector()
  const transport = useTransport()
  const locale = useLocale()
  const { creditsPerMinorUnit, displayExchangeRate } = useBalance()

  const [step, setStep] = useState<CheckoutStep>(initialStep)
  const [status, setStatus] = useState<CheckoutStatus>('idle')
  const [selectedAmountMinor, setSelectedAmountMinor] = useState<number | null>(initialAmountMinor)
  const [successMeta, setSuccessMeta] = useState<SuccessMeta | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Mirror the latest amount on a ref so transitions called
  // synchronously after `selectAmount(...)` (e.g. inside an
  // `AmountPicker.Confirm.onConfirm` handler that pairs them) read
  // the post-update value instead of the closed-over null.
  const selectedAmountMinorRef = useRef<number | null>(initialAmountMinor)
  // One-shot guard so the auto-skip effect doesn't re-trigger after
  // the user navigates back to the plan step manually.
  const hasAutoSkippedRef = useRef(false)

  const selectedPlan = planCtx.selectedPlan
  const selectedPlanRef = planCtx.selectedPlanRef
  const selectedPlanShape = selectedPlan as unknown as BootstrapPlanLike | null

  const branch: 'payg' | 'recurring' | null = selectedPlanShape
    ? isPayg(selectedPlanShape)
      ? 'payg'
      : 'recurring'
    : null

  // Defensive against partial `usePlanSelector()` mocks in tests
  // (e.g. PaywallNotice.test omits `plans`) — treat missing as empty.
  const selectablePlans = useMemo(
    () => (planCtx.plans ?? []).filter(p => p.requiresPayment !== false),
    [planCtx.plans],
  )

  // Recurring `payment → plan` only has a useful target when there's
  // a real plan choice to return to. PAYG `payment → amount` is
  // always useful (change the topup amount).
  const canGoBack =
    step === 'amount' ||
    (step === 'payment' && branch === 'payg') ||
    (step === 'payment' &&
      branch === 'recurring' &&
      !(autoSkipSinglePlan && selectablePlans.length <= 1))

  const selectPlan = useCallback(
    (ref: string) => {
      planCtx.select(ref)
      const plan = planCtx.plans.find(p => p.reference === ref) ?? null
      if (plan) {
        onPlanSelectRef.current?.(ref, plan)
      }
    },
    [planCtx],
  )

  const selectAmount = useCallback(
    (amountMinor: number) => {
      selectedAmountMinorRef.current = amountMinor
      setSelectedAmountMinor(amountMinor)
      const currency = (selectedPlanShape?.currency ?? 'USD').toUpperCase()
      onAmountSelectRef.current?.(amountMinor, currency)
    },
    [selectedPlanShape?.currency],
  )

  const runActivate = useCallback(async (): Promise<boolean> => {
    if (!selectedPlanShape || !selectedPlanRef) return false
    setError(null)
    setStatus('activating')
    try {
      await transport.activatePlan({ productRef, planRef: selectedPlanRef })
      setStatus('idle')
      setStep('amount')
      return true
    } catch (err) {
      const wrapped = err instanceof Error ? err : new Error('Activation failed')
      setError(wrapped.message)
      setStatus('error')
      onErrorRef.current?.(wrapped, 'activate')
      return false
    }
  }, [productRef, selectedPlanRef, selectedPlanShape, transport])

  const advanceFromPlan = useCallback(async () => {
    if (!selectedPlanShape || !selectedPlanRef) return
    if (branch === 'payg') {
      await runActivate()
      return
    }
    setError(null)
    setStep('payment')
  }, [branch, runActivate, selectedPlanRef, selectedPlanShape])

  // Auto-skip the plan step when the product exposes only one
  // selectable plan. Two-phase via early return: phase 1 commits the
  // selection if `<PlanSelector.Root>` hasn't already (waits for the
  // next render so `selectedPlan` propagates through `usePlans`),
  // phase 2 fires `onPlanSelect` and advances. Firing `onPlanSelect`
  // in phase 2 (not phase 1) keeps it consistent across both paths —
  // PlanSelector's default index-0 selection means phase 1 is often a
  // no-op. The `hasAutoSkippedRef` guard prevents re-triggering after
  // the user navigates back.
  useEffect(() => {
    if (!autoSkipSinglePlan) return
    if (hasAutoSkippedRef.current) return
    if (planCtx.loading || selectablePlans.length !== 1) return
    if (step !== 'plan' || status === 'activating') return

    const single = selectablePlans[0]
    if (planCtx.selectedPlanRef !== single.reference) {
      planCtx.select(single.reference)
      return
    }

    hasAutoSkippedRef.current = true
    onPlanSelectRef.current?.(single.reference, single)
    void advanceFromPlan()
  }, [
    autoSkipSinglePlan,
    planCtx,
    selectablePlans,
    step,
    status,
    advanceFromPlan,
  ])

  const recordPaygSuccess = useCallback(() => {
    if (!selectedPlanShape || selectedAmountMinor == null) return
    const currency = (selectedPlanShape.currency ?? 'USD').toUpperCase()
    const creditsAdded =
      creditsPerMinorUnit != null && creditsPerMinorUnit > 0
        ? Math.floor((selectedAmountMinor / (displayExchangeRate ?? 1)) * creditsPerMinorUnit)
        : 0
    const meta: SuccessMeta = {
      branch: 'payg',
      amountMinor: selectedAmountMinor,
      currency,
      creditsAdded,
      plan: selectedPlanShape,
      rateLabel: formatPaygRate(selectedPlanShape, locale),
    }
    setSuccessMeta(meta)
    setStep('success')
    onPurchaseSuccessRef.current?.(meta)
  }, [creditsPerMinorUnit, displayExchangeRate, locale, selectedAmountMinor, selectedPlanShape])

  const recordRecurringSuccess = useCallback(() => {
    if (!selectedPlanShape) return
    const currency = (selectedPlanShape.currency ?? 'USD').toUpperCase()
    const meta: SuccessMeta = {
      branch: 'recurring',
      plan: selectedPlanShape,
      creditsIncluded: inferIncludedCredits(selectedPlanShape),
      chargedTodayMinor: selectedPlanShape.price ?? 0,
      currency,
      nextRenewalLabel: null,
    }
    setSuccessMeta(meta)
    setStep('success')
    onPurchaseSuccessRef.current?.(meta)
  }, [selectedPlanShape])

  const advance = useCallback(async () => {
    if (step === 'plan') {
      await advanceFromPlan()
      return
    }
    if (step === 'amount') {
      // Read from the ref so a synchronous `selectAmount(...)` →
      // `advance()` pair works without forcing the caller to await
      // a render. Fall back to the React state for the slow path.
      const amount = selectedAmountMinorRef.current ?? selectedAmountMinor
      if (amount == null) return
      setStep('payment')
      return
    }
    if (step === 'payment') {
      if (branch === 'payg') {
        recordPaygSuccess()
      } else if (branch === 'recurring') {
        recordRecurringSuccess()
      }
      return
    }
  }, [
    advanceFromPlan,
    branch,
    recordPaygSuccess,
    recordRecurringSuccess,
    selectedAmountMinor,
    step,
  ])

  const back = useCallback(() => {
    setError(null)
    if (step === 'amount') {
      setStep('plan')
      return
    }
    if (step === 'payment') {
      setStep(branch === 'payg' ? 'amount' : 'plan')
      return
    }
  }, [branch, step])

  const reset = useCallback(() => {
    setStep('plan')
    selectedAmountMinorRef.current = null
    setSelectedAmountMinor(null)
    setSuccessMeta(null)
    setError(null)
    setStatus('idle')
  }, [])

  const retry = useCallback(async () => {
    if (status !== 'error') return
    if (step === 'plan' && branch === 'payg') {
      await runActivate()
    }
  }, [branch, runActivate, status, step])

  const notifyPaymentSuccess = useCallback(
    (_intent?: PaymentIntent) => {
      if (branch === 'payg') {
        recordPaygSuccess()
      } else if (branch === 'recurring') {
        recordRecurringSuccess()
      }
    },
    [branch, recordPaygSuccess, recordRecurringSuccess],
  )

  return useMemo<UseCheckoutFlowReturn>(
    () => ({
      step,
      status,
      selectedPlan,
      selectedPlanRef,
      selectedAmountMinor,
      successMeta,
      error,
      branch,
      canGoBack,
      selectPlan,
      selectAmount,
      advance,
      back,
      reset,
      retry,
      notifyPaymentSuccess,
    }),
    [
      step,
      status,
      selectedPlan,
      selectedPlanRef,
      selectedAmountMinor,
      successMeta,
      error,
      branch,
      canGoBack,
      selectPlan,
      selectAmount,
      advance,
      back,
      reset,
      retry,
      notifyPaymentSuccess,
    ],
  )
}
