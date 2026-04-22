'use client'

/**
 * Opinionated one-line drop-in checkout built on top of `PlanSelector`,
 * `PaymentForm`, and `ActivationFlow`. Renders the select → pay | activate
 * machine internally, and auto-skips the select step when a product has a
 * single selectable plan.
 *
 * Styling is done entirely via the `solvapay-*` class names documented in
 * PR 5's `styles.css`. No inline styles. Full control (custom layouts,
 * alternate CTAs, multi-step wizards) is available by composing the
 * primitives at `@solvapay/react/primitives` directly.
 */

import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { PaymentForm } from '../PaymentForm'
import { PlanSelector } from './PlanSelector'
import { ActivationFlow } from './ActivationFlow'
import { usePlan } from '../hooks/usePlan'
import { usePlans } from '../hooks/usePlans'
import { defaultListPlans } from '../transport/list-plans'
import { useCopy } from '../hooks/useCopy'
import { SolvaPayContext } from '../SolvaPayProvider'
import type { PaymentIntent } from '@stripe/stripe-js'
import type {
  CheckoutResult,
  Plan,
  PrefillCustomer,
} from '../types'

export type CheckoutLayoutSize = 'chat' | 'mobile' | 'desktop' | 'auto'

export type CheckoutLayoutPlanSelectorOptions = {
  filter?: (plan: Plan, index: number) => boolean
  sortBy?: (a: Plan, b: Plan) => number
  popularPlanRef?: string
}

export type CheckoutLayoutProps = {
  /**
   * Plan reference. When passed, skips plan selection and goes directly to
   * payment or activation (routed based on plan type). Backwards compatible
   * with today's payment-only behavior for non-usage-based plans.
   */
  planRef?: string
  productRef?: string
  prefillCustomer?: PrefillCustomer
  size?: CheckoutLayoutSize
  requireTermsAcceptance?: boolean
  /**
   * Fires on paid completions only — preserved for backwards compatibility.
   * For a unified callback across paid + activated flows, use `onResult`.
   */
  onSuccess?: (paymentIntent: PaymentIntent) => void
  /** Unified completion callback (paid + activated). */
  onResult?: (result: CheckoutResult) => void
  /** Override the default free-plan activation step. Forwarded to PaymentForm. */
  onFreePlan?: (plan: Plan) => Promise<unknown> | void
  onError?: (error: Error) => void
  /** Initial selection when rendering the selector step. */
  initialPlanRef?: string
  /** Callback when the user picks a plan from the selector. */
  onPlanSelect?: (planRef: string, plan: Plan) => void
  /** Controls for the internal `<PlanSelector>`. */
  planSelector?: CheckoutLayoutPlanSelectorOptions
  /** Hide the "← Back to plans" affordance on the pay step. Defaults to true. */
  showBackButton?: boolean
  submitButtonText?: string
  returnUrl?: string
}

type ResolvedSize = 'chat' | 'mobile' | 'desktop'
type Step = 'select' | 'pay' | 'activate'

const BREAKPOINTS = {
  chat: 480,
  desktop: 768,
} as const

function widthToSize(width: number): ResolvedSize {
  if (width < BREAKPOINTS.chat) return 'chat'
  if (width < BREAKPOINTS.desktop) return 'mobile'
  return 'desktop'
}

export const CheckoutLayout: React.FC<CheckoutLayoutProps> = ({
  planRef,
  productRef,
  prefillCustomer,
  size = 'auto',
  requireTermsAcceptance,
  onSuccess,
  onResult,
  onFreePlan,
  onError,
  initialPlanRef,
  onPlanSelect,
  planSelector,
  showBackButton = true,
  submitButtonText,
  returnUrl,
}) => {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [autoSize, setAutoSize] = useState<ResolvedSize>('desktop')
  const copy = useCopy()

  useEffect(() => {
    if (size !== 'auto') return
    const el = rootRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(entries => {
      for (const entry of entries) {
        setAutoSize(widthToSize(entry.contentRect.width))
      }
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [size])

  const resolvedSize: ResolvedSize = size === 'auto' ? autoSize : size

  // `initialPlanRef` pre-selects inside the selector step — it does not bypass
  // selection. Only an explicit `planRef` skips the selector entirely. This
  // keeps returning users (e.g. with `activePurchase?.planRef` from usePurchase)
  // able to see and switch plans instead of landing straight on payment.
  const [selectedPlanRef, setSelectedPlanRef] = useState<string | null>(planRef ?? null)
  const [userStep, setUserStep] = useState<Step>(planRef ? 'pay' : 'select')

  const effectivePlanRef = planRef ?? selectedPlanRef ?? undefined
  const { plan: resolvedPlan } = usePlan({
    planRef: effectivePlanRef,
    productRef,
  })
  const isUsageBased = resolvedPlan?.type === 'usage-based'

  // Derive the rendered step from the user's intent + the resolved plan type.
  // Auto-flips pay ↔ activate once we know whether the plan is usage-based,
  // without bouncing through setState in an effect.
  const step: Step = useMemo(() => {
    if (userStep === 'pay' && isUsageBased) return 'activate'
    if (userStep === 'activate' && resolvedPlan && !isUsageBased) return 'pay'
    return userStep
  }, [userStep, isUsageBased, resolvedPlan])

  const handlePlanSelect = useCallback(
    (ref: string, plan: Plan) => {
      setSelectedPlanRef(ref)
      onPlanSelect?.(ref, plan)
      setUserStep(plan.type === 'usage-based' ? 'activate' : 'pay')
    },
    [onPlanSelect],
  )

  const handleBack = useCallback(() => {
    if (planRef) return
    setUserStep('select')
  }, [planRef])

  return (
    <div
      ref={rootRef}
      data-solvapay-checkout-layout={resolvedSize}
      data-solvapay-step={step}
      className="solvapay-checkout-layout"
    >
      {!planRef && showBackButton && step !== 'select' && (
        <button
          type="button"
          onClick={handleBack}
          data-solvapay-checkout-back=""
          className="solvapay-back"
        >
          {copy.planSelector.backButton}
        </button>
      )}
      {step === 'select' && (
        <SelectStep
          productRef={productRef ?? ''}
          initialPlanRef={initialPlanRef ?? selectedPlanRef ?? undefined}
          filter={planSelector?.filter}
          sortBy={planSelector?.sortBy}
          popularPlanRef={planSelector?.popularPlanRef}
          onContinue={handlePlanSelect}
        />
      )}
      {step === 'activate' && resolvedPlan && productRef && (
        <ActivationFlow
          productRef={productRef}
          planRef={effectivePlanRef}
          onBack={planRef ? undefined : handleBack}
          onSuccess={result => onResult?.(result)}
          onError={onError}
        />
      )}
      {step === 'pay' && (
        <PaymentForm
          planRef={effectivePlanRef}
          productRef={productRef}
          prefillCustomer={prefillCustomer}
          requireTermsAcceptance={requireTermsAcceptance}
          onSuccess={onSuccess}
          onResult={onResult}
          onFreePlan={onFreePlan}
          onError={onError}
          submitButtonText={submitButtonText}
          returnUrl={returnUrl}
        />
      )}
    </div>
  )
}

/**
 * Plan-selection step: renders the default `<PlanSelector>` tree with a
 * sibling Continue button. Tracks the user's current selection locally so
 * the CTA is gated until they pick a plan. Auto-skips the step when the
 * product has exactly one selectable (paid) plan.
 */
const SelectStep: React.FC<{
  productRef: string
  initialPlanRef?: string
  filter?: (plan: Plan, index: number) => boolean
  sortBy?: (a: Plan, b: Plan) => number
  popularPlanRef?: string
  onContinue: (planRef: string, plan: Plan) => void
}> = ({ productRef, initialPlanRef, filter, sortBy, popularPlanRef, onContinue }) => {
  const copy = useCopy()
  const solva = useContext(SolvaPayContext)
  const config = solva?._config

  const fetcher = useCallback(
    (ref: string) => defaultListPlans(ref, config),
    [config],
  )

  const { plans, selectedPlan } = usePlans({
    productRef,
    fetcher,
    filter,
    sortBy,
    autoSelectFirstPaid: true,
    initialPlanRef,
  })

  const [userSelected, setUserSelected] = useState<{ ref: string; plan: Plan } | null>(null)

  // Fall back to the hook's auto-selected plan until the user picks something
  // explicitly. Keeps the Continue button active immediately when plans load.
  const selected: { ref: string; plan: Plan } | null =
    userSelected ??
    (selectedPlan && selectedPlan.requiresPayment !== false
      ? { ref: selectedPlan.reference, plan: selectedPlan }
      : null)

  const autoSkipRef = useRef(false)
  useEffect(() => {
    if (autoSkipRef.current) return
    const selectable = plans.filter(p => p.requiresPayment !== false)
    if (plans.length === 1 && selectable.length === 1) {
      autoSkipRef.current = true
      onContinue(selectable[0].reference, selectable[0])
    }
  }, [plans, onContinue])

  const handleSelect = useCallback((ref: string, plan: Plan) => {
    setUserSelected({ ref, plan })
  }, [])

  const continueLabel = useMemo(() => copy.planSelector.continueButton, [copy])

  return (
    <>
      <PlanSelector
        productRef={productRef}
        initialPlanRef={initialPlanRef}
        filter={filter}
        sortBy={sortBy}
        popularPlanRef={popularPlanRef}
        autoSelectFirstPaid
        onSelect={handleSelect}
      />
      <button
        type="button"
        className="solvapay-continue"
        data-solvapay-checkout-continue=""
        data-state={selected ? 'idle' : 'disabled'}
        disabled={!selected}
        onClick={() => {
          if (selected) onContinue(selected.ref, selected.plan)
        }}
      >
        {continueLabel}
      </button>
    </>
  )
}
