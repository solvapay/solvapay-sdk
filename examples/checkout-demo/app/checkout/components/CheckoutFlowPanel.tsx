'use client'

import { useCallback, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useBalance, usePlans, useSolvaPay } from '@solvapay/react'
import type { Plan } from '@solvapay/react'
import {
  CheckoutSteps,
  PlanSelector,
  useCheckoutStepsContext,
} from '@solvapay/react/primitives'
import type { SuccessMeta } from '@solvapay/react/primitives'

const buttonClassName =
  'w-full mt-4 px-6 py-3 rounded-lg bg-slate-900 text-white font-semibold disabled:bg-slate-300 disabled:cursor-not-allowed hover:bg-slate-800 transition-colors'

function hasUsableCredits(credits: number | null | undefined): credits is number {
  return credits != null && credits > 0
}

function isPaygPlan(plan: Plan | null | undefined): boolean {
  return plan?.type === 'usage-based'
}

/** Show every paid plan — same filter as Goldberg MCP `EmbeddedCheckout`. */
function showPaidPlans(plan: Plan, currentPlanRef?: string | null): boolean {
  return plan.requiresPayment !== false || plan.reference === currentPlanRef
}

interface PaygExistingCreditsPanelProps {
  productRef: string
  currentPlanRef?: string | null
  credits: number
  onComplete: () => void
  onError?: (err: Error, phase: 'activate' | 'pay') => void
}

/**
 * Customer picked PAYG but already has a credit balance — activate the meter
 * (if needed) and skip the amount/payment steps. Top-ups belong on /topup.
 */
function PaygExistingCreditsPanel({
  productRef,
  currentPlanRef,
  credits,
  onComplete,
  onError,
}: PaygExistingCreditsPanelProps) {
  const flow = useCheckoutStepsContext()
  const { activatePlan } = useSolvaPay()
  const router = useRouter()
  const [activating, setActivating] = useState(false)

  const planRef = flow.selectedPlanRef
  const alreadyOnPayg = currentPlanRef != null && planRef === currentPlanRef

  const finish = useCallback(() => {
    onComplete()
    router.push('/')
  }, [onComplete, router])

  const handleActivate = useCallback(async () => {
    if (!planRef) return
    if (alreadyOnPayg) {
      finish()
      return
    }
    setActivating(true)
    try {
      await activatePlan({ productRef, planRef })
      finish()
    } catch (err) {
      const wrapped = err instanceof Error ? err : new Error('Activation failed')
      onError?.(wrapped, 'activate')
    } finally {
      setActivating(false)
    }
  }, [activatePlan, alreadyOnPayg, finish, onError, planRef, productRef])

  return (
    <div className="mt-4 space-y-3">
      <p className="text-sm text-slate-600">
        {alreadyOnPayg
          ? `You already have ${new Intl.NumberFormat().format(credits)} credits on Pay as you go.`
          : `You have ${new Intl.NumberFormat().format(credits)} credits ready — activate Pay as you go to use them.`}
        {' '}Choose Subscription above to switch plans, or top up if you need more.
      </p>
      <button
        type="button"
        className={buttonClassName}
        disabled={activating || !planRef}
        onClick={() => void handleActivate()}
      >
        {activating
          ? 'Activating…'
          : alreadyOnPayg
            ? 'Back to dashboard'
            : 'Activate Pay as you go'}
      </button>
      <Link
        href="/topup"
        className="block w-full px-6 py-3 rounded-lg border border-slate-900 text-slate-900 text-center font-semibold hover:bg-slate-50 transition-colors"
      >
        Top up credits
      </Link>
    </div>
  )
}

function DemoPlanContinueButton({
  productRef,
  currentPlanRef,
  onComplete,
  onError,
}: {
  productRef: string
  currentPlanRef?: string | null
  onComplete: () => void
  onError?: (err: Error, phase: 'activate' | 'pay') => void
}) {
  const flow = useCheckoutStepsContext()
  const { credits } = useBalance()
  const selectedPlan = flow.selectedPlan

  if (isPaygPlan(selectedPlan) && hasUsableCredits(credits)) {
    return (
      <PaygExistingCreditsPanel
        productRef={productRef}
        currentPlanRef={currentPlanRef}
        credits={credits}
        onComplete={onComplete}
        onError={onError}
      />
    )
  }

  return <CheckoutSteps.PlanContinueButton className={buttonClassName} />
}

function DemoAmountStep({
  productRef,
  currentPlanRef,
  onComplete,
  onError,
}: {
  productRef: string
  currentPlanRef?: string | null
  onComplete: () => void
  onError?: (err: Error, phase: 'activate' | 'pay') => void
}) {
  const flow = useCheckoutStepsContext()
  const { credits } = useBalance()
  const selectedPlan = flow.selectedPlan

  if (isPaygPlan(selectedPlan) && hasUsableCredits(credits)) {
    return (
      <>
        <CheckoutSteps.BackLink className="text-sm text-slate-600 hover:text-slate-900 mb-4" />
        <PaygExistingCreditsPanel
          productRef={productRef}
          currentPlanRef={currentPlanRef}
          credits={credits}
          onComplete={onComplete}
          onError={onError}
        />
      </>
    )
  }

  return (
    <>
      <CheckoutSteps.BackLink className="text-sm text-slate-600 hover:text-slate-900 mb-4" />
      <CheckoutSteps.AmountPicker />
      <CheckoutSteps.AmountContinueButton className={buttonClassName} />
    </>
  )
}

export interface CheckoutFlowPanelProps {
  productRef: string
  returnUrl: string
  currentPlanRef?: string | null
  onPurchaseSuccess: (meta: SuccessMeta) => void
  onError?: (err: Error, phase: 'activate' | 'pay') => void
}

/**
 * Stepped checkout (plan → amount → payment → success) via `useCheckoutFlow`.
 * Matches Goldberg MCP and chat-checkout-demo.
 */
export function CheckoutFlowPanel({
  productRef,
  returnUrl,
  currentPlanRef,
  onPurchaseSuccess,
  onError,
}: CheckoutFlowPanelProps) {
  const { plans } = usePlans({ productRef })

  const paygPlanRef = useMemo(() => {
    const payg = plans.find(p => p.type === 'usage-based')
    return payg?.reference
  }, [plans])

  const filter = useMemo(
    () => (plan: Plan) => showPaidPlans(plan, currentPlanRef),
    [currentPlanRef],
  )

  const handleComplete = useCallback(() => {
    onPurchaseSuccess({
      branch: 'payg',
      amountMinor: 0,
      currency: 'USD',
      creditsAdded: 0,
      plan: plans.find(p => p.reference === paygPlanRef) ?? {},
      rateLabel: '',
    })
  }, [onPurchaseSuccess, paygPlanRef, plans])

  return (
    <CheckoutSteps.Root
      productRef={productRef}
      returnUrl={returnUrl}
      filter={filter}
      popularPlanRef={paygPlanRef}
      currentPlanRef={currentPlanRef}
      initialPlanRef={currentPlanRef ?? undefined}
      autoSelectFirstPaid={!currentPlanRef && Boolean(paygPlanRef)}
      onPurchaseSuccess={onPurchaseSuccess}
      onError={onError}
    >
      <CheckoutSteps.StepHeading className="text-xl font-semibold text-slate-900 mb-1" />
      <CheckoutSteps.StepMessage className="text-sm text-slate-600 mb-6" />
      <CheckoutSteps.IfStep step="plan">
        <CheckoutSteps.PlanGrid />
        <PlanSelector.Loading />
        <PlanSelector.Error />
        <DemoPlanContinueButton
          productRef={productRef}
          currentPlanRef={currentPlanRef}
          onComplete={handleComplete}
          onError={onError}
        />
      </CheckoutSteps.IfStep>
      <CheckoutSteps.IfStep step="amount">
        <DemoAmountStep
          productRef={productRef}
          currentPlanRef={currentPlanRef}
          onComplete={handleComplete}
          onError={onError}
        />
      </CheckoutSteps.IfStep>
      <CheckoutSteps.IfStep step="payment">
        <CheckoutSteps.BackLink className="text-sm text-slate-600 hover:text-slate-900 mb-4" />
        <CheckoutSteps.Payment />
      </CheckoutSteps.IfStep>
      <CheckoutSteps.IfStep step="success">
        <CheckoutSteps.Success />
      </CheckoutSteps.IfStep>
    </CheckoutSteps.Root>
  )
}
