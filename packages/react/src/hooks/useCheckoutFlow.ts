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

import { useCallback, useMemo, useRef, useState } from 'react'
import type { PaymentIntent } from '@stripe/stripe-js'
import { usePlanSelector } from '../primitives/PlanSelector'
import { usePlanSelection } from '../components/PlanSelectionContext'
import { useBalance } from './useBalance'
import { useMerchant } from './useMerchant'
import { useSolvaPay } from './useSolvaPay'
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
import { resolvePlanPricingOption } from '../utils/planPricing'

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
   * Currency for the PAYG topup branch (`AmountPicker`, `TopupForm`,
   * order summary, mandate text). Defaults to `merchant.defaultCurrency`
   * — credit topups settle into the merchant-wide wallet, so the
   * currency must come from the merchant, not the selected plan.
   *
   * Pass an explicit value when integrators surface a per-customer
   * picker (multi-currency topup, future). Recurring/one-time plans
   * always settle in their own `plan.currency`; this option only
   * affects the topup branch.
   */
  topupCurrency?: string
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
   * Currency for the PAYG topup branch, resolved in order:
   * top-up step override → plan-picker `preferredCurrency` (when
   * supported) → `topupCurrency` option or `merchant.defaultCurrency`.
   * `null` while the merchant is still loading and no explicit
   * option was passed. Plan `currency` / `selectedCurrency` are never
   * consulted — credit topups are merchant-wide, not plan-specific.
   */
  topupCurrency: string | null
  /**
   * `true` once `topupCurrency` has resolved to a concrete code.
   * Step components gate their UI on this so they never paint a
   * misleading default while the merchant fetch is in flight.
   */
  topupCurrencyReady: boolean
  /**
   * Full set of currencies the customer may pay topups in — the
   * merchant's `supportedTopupCurrencies` (which already includes the
   * default) or, for single-currency merchants, just the resolved
   * `topupCurrency`. Always uppercased and deduped. The amount step
   * renders a switcher only when this has more than one entry.
   */
  topupCurrencies: string[]
  /**
   * Override the topup currency from a picker. Accepts any code in
   * `topupCurrencies`; ignored otherwise. Resets to the merchant default
   * resolution on `reset()`.
   */
  setTopupCurrency: (code: string) => void
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
   *
   * `extras.creditsAdded` (PAYG only) is the wallet delta observed by
   * the backend's post-success balance poll, surfaced through
   * `TopupForm.onSuccess`. When present, the flow prefers it over the
   * locally-computed estimate and bumps `balance.adjustBalance` for
   * an instant UI update.
   */
  notifyPaymentSuccess: (
    intent?: PaymentIntent,
    extras?: { creditsAdded?: number },
  ) => void
}

export function useCheckoutFlow(opts: UseCheckoutFlowOptions): UseCheckoutFlowReturn {
  const {
    productRef,
    initialStep = 'plan',
    initialAmountMinor = null,
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
  const planSelection = usePlanSelection()
  const transport = useTransport()
  const locale = useLocale()
  const balance = useBalance()
  const { creditsPerMinorUnit, displayExchangeRate, adjustBalance } = balance
  const { refetchPurchase } = useSolvaPay()
  const { merchant } = useMerchant()

  // Resolve PAYG topup currency from (in order): the amount-step override,
  // the plan-picker's `preferredCurrency` (when supported), then the
  // `topupCurrency` option or merchant `defaultCurrency`. Plan `currency` /
  // `selectedCurrency` are intentionally never consulted — credit topups
  // settle into the merchant-wide wallet. While the merchant fetch is in
  // flight (and no explicit prop was passed), `topupCurrency` stays `null`
  // and step components render a skeleton/disabled state.
  const [topupCurrencyOverride, setTopupCurrencyOverride] = useState<string | null>(null)

  // Full set of pay currencies. The merchant payload already includes the
  // default in `supportedTopupCurrencies`; single-currency merchants omit it,
  // so we fall back to the resolved default code.
  const topupCurrencies = useMemo<string[]>(() => {
    const fromMerchant = (merchant?.supportedTopupCurrencies ?? [])
      .map(code => code.toUpperCase())
      .filter(Boolean)
    const fallback =
      opts.topupCurrency?.toUpperCase() ?? merchant?.defaultCurrency?.toUpperCase() ?? null
    const list = fromMerchant.length > 0 ? fromMerchant : fallback ? [fallback] : []
    return Array.from(new Set(list))
  }, [merchant?.supportedTopupCurrencies, merchant?.defaultCurrency, opts.topupCurrency])

  const resolvedDefaultTopupCurrency: string | null =
    opts.topupCurrency?.toUpperCase() ?? merchant?.defaultCurrency?.toUpperCase() ?? null
  const planPickerCurrency = planCtx.preferredCurrency?.toUpperCase() ?? null
  const topupCurrency: string | null =
    (topupCurrencyOverride && topupCurrencies.includes(topupCurrencyOverride)
      ? topupCurrencyOverride
      : null) ??
    (planPickerCurrency && topupCurrencies.includes(planPickerCurrency)
      ? planPickerCurrency
      : null) ??
    resolvedDefaultTopupCurrency
  const topupCurrencyReady = topupCurrency != null

  const setTopupCurrency = useCallback(
    (code: string) => {
      const normalized = code.toUpperCase()
      setTopupCurrencyOverride(normalized)
    },
    [],
  )

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

  const selectedPlan = planCtx.selectedPlan
  const selectedPlanRef = planCtx.selectedPlanRef
  const selectedPlanShape = selectedPlan as unknown as BootstrapPlanLike | null

  const branch: 'payg' | 'recurring' | null = selectedPlanShape
    ? isPayg(selectedPlanShape)
      ? 'payg'
      : 'recurring'
    : null

  // The user reaches `payment` by deliberately picking a plan and
  // pressing Continue, so a back step always lands somewhere they can
  // act on. PAYG `payment → amount` is the topup amount picker;
  // recurring/onetime `payment → plan` is the plan grid they came
  // from.
  const canGoBack = step === 'amount' || step === 'payment'

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
      // Topup amount is denominated in the merchant's wallet currency,
      // not the plan's. Forward the resolved `topupCurrency` to the
      // lifecycle callback; consumers persisting the picked amount
      // (analytics, MCP bridge) need the same code the picker rendered.
      // Falls back to `'USD'` only when the merchant fetch hasn't
      // resolved AND no explicit prop was passed — at which point step
      // components are gated to a skeleton anyway, so the callback
      // shouldn't fire in practice.
      const currency = topupCurrency ?? 'USD'
      onAmountSelectRef.current?.(amountMinor, currency)
    },
    [topupCurrency],
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
      // PAYG re-activation is a no-op on the backend (the plan is
      // already the customer's current plan), and the round-trip
      // adds latency + a transient `status: 'activating'` flicker
      // for no behavior change. Skip the call and step straight to
      // the amount picker so the user can top up.
      if (planCtx.currentPlanRef === selectedPlanRef) {
        setError(null)
        setStep('amount')
        return
      }
      await runActivate()
      return
    }
    setError(null)
    setStep('payment')
  }, [branch, planCtx.currentPlanRef, runActivate, selectedPlanRef, selectedPlanShape])

  const recordPaygSuccess = useCallback(
    (creditsAddedFromBackend?: number) => {
      if (!selectedPlanShape || selectedAmountMinor == null) return
      // PAYG topup currency comes from the merchant (or explicit
      // `topupCurrency` opt) — never from the plan. Plan currency is
      // wallet-irrelevant for credit topups.
      const currency = topupCurrency ?? 'USD'
      // Prefer the backend's authoritative wallet delta over the
      // local price-based estimate. `processTopupPaymentIntentCore`
      // captures a balance baseline before `/process` and polls
      // post-success until the wallet observes the topup — when it
      // does, that delta is the exact credit count the customer was
      // granted, including any merchant-specific rounding or fee
      // adjustments the local estimate can't model. Falls back to
      // the local computation when the backend omits it (legacy
      // adapters, exhausted poll budget).
      const computedCreditsAdded =
        creditsPerMinorUnit != null && creditsPerMinorUnit > 0
          ? Math.floor((selectedAmountMinor / (displayExchangeRate ?? 1)) * creditsPerMinorUnit)
          : 0
      const creditsAdded =
        creditsAddedFromBackend !== undefined ? creditsAddedFromBackend : computedCreditsAdded

      // Instant optimistic UI: when the backend has surfaced the
      // wallet delta, bump the in-memory balance immediately so
      // dependent surfaces (BalanceBadge, useLimits-driven gates)
      // observe the post-topup state on the next render — before the
      // deterministic `refetchPurchase()` round-trip lands. Without a
      // backend delta we skip the optimistic step: a phantom bump
      // computed from price could drift from the true credit count.
      if (creditsAddedFromBackend !== undefined && creditsAddedFromBackend > 0) {
        adjustBalance(creditsAddedFromBackend)
      }
      // Drive `useLimits` (it auto-refetches on `purchases` ref change)
      // and the balance side-effect (it picks up the credit via the
      // `purchases-change` effect inside `useBalance`'s caller). One
      // round-trip, deterministic, no timer chain. `Promise.resolve()`
      // wraps the call so a stub `refetchPurchase` that returns
      // undefined (legacy tests, partial transport mocks) doesn't NPE
      // on `.catch`.
      Promise.resolve(refetchPurchase()).catch(() => {})
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
    },
    [
      adjustBalance,
      creditsPerMinorUnit,
      displayExchangeRate,
      locale,
      refetchPurchase,
      selectedAmountMinor,
      selectedPlanShape,
      topupCurrency,
    ],
  )

  const recordRecurringSuccess = useCallback(() => {
    if (!selectedPlanShape) return
    const pricingOption = selectedPlan
      ? resolvePlanPricingOption(selectedPlan, planSelection?.selectedCurrency)
      : {
          currency: selectedPlanShape.currency ?? 'USD',
          price: selectedPlanShape.price ?? 0,
        }
    const currency = pricingOption.currency.toUpperCase()
    const meta: SuccessMeta = {
      branch: 'recurring',
      plan: selectedPlanShape,
      creditsIncluded: inferIncludedCredits(selectedPlanShape),
      chargedTodayMinor: pricingOption.price ?? 0,
      currency,
      nextRenewalLabel: null,
    }
    setSuccessMeta(meta)
    setStep('success')
    onPurchaseSuccessRef.current?.(meta)
  }, [selectedPlanShape, selectedPlan, planSelection?.selectedCurrency])

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
    setTopupCurrencyOverride(null)
  }, [])

  const retry = useCallback(async () => {
    if (status !== 'error') return
    if (step === 'plan' && branch === 'payg') {
      await runActivate()
    }
  }, [branch, runActivate, status, step])

  const notifyPaymentSuccess = useCallback(
    (_intent?: PaymentIntent, extras?: { creditsAdded?: number }) => {
      if (branch === 'payg') {
        recordPaygSuccess(extras?.creditsAdded)
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
      topupCurrency,
      topupCurrencyReady,
      topupCurrencies,
      setTopupCurrency,
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
      topupCurrency,
      topupCurrencyReady,
      topupCurrencies,
      setTopupCurrency,
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
