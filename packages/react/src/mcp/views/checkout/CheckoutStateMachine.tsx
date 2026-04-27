'use client'

/**
 * `<CheckoutStateMachine>` — four-step activation flow powering
 * `<McpCheckoutView>` (the `upgrade` / `activate_plan` surface).
 *
 * Owns `step`, `selectedAmountMinor`, `successMeta`, `activationError`,
 * and `isActivating` and routes between `PlanStep` → `AmountStep` (PAYG
 * only) → `PaygPaymentStep` / `RecurringPaymentStep` → `SuccessStep`.
 * Transport side-effects (`activate_plan`, `notifyModelContext`,
 * `notifySuccess`) live in the transitions defined here so step
 * components stay presentation-only.
 *
 * The `fromPaywall` / `paywallKind` props are preserved for custom
 * integrators who want to render the "Upgrade to continue" banner
 * when they wire their own gate → checkout redirection; the stock
 * `<McpAppShell>` does not set them any more (paywall responses are
 * text-only in the SDK).
 */

import React, { useCallback } from 'react'
import type { PaymentIntent } from '@stripe/stripe-js'
import { usePlanSelector } from '../../../primitives/PlanSelector'
import { useBalance } from '../../../hooks/useBalance'
import { useTransport } from '../../../hooks/useTransport'
import { useMcpBridge } from '../../bridge'
import { useHostLocale } from '../../useHostLocale'
import { formatPrice } from '../../../utils/format'
import { PlanStep } from './steps/PlanStep'
import { AmountStep } from './steps/AmountStep'
import { PaygPaymentStep } from './steps/PaygPaymentStep'
import { RecurringPaymentStep } from './steps/RecurringPaymentStep'
import { SuccessStep } from './steps/SuccessStep'
import type { BootstrapPlanLike, Cx, Step, SuccessMeta } from './shared'
import { formatPaygRate, inferIncludedCredits, isPayg } from './shared'

export interface StateMachineProps {
  step: Step
  setStep: React.Dispatch<React.SetStateAction<Step>>
  selectedAmountMinor: number | null
  setSelectedAmountMinor: React.Dispatch<React.SetStateAction<number | null>>
  successMeta: SuccessMeta | null
  setSuccessMeta: React.Dispatch<React.SetStateAction<SuccessMeta | null>>
  activationError: string | null
  setActivationError: React.Dispatch<React.SetStateAction<string | null>>
  isActivating: boolean
  setIsActivating: React.Dispatch<React.SetStateAction<boolean>>
  fromPaywall: boolean
  paywallKind?: 'payment_required' | 'activation_required'
  /**
   * Suppress the `PlanStep` `UpgradeBanner` even when `fromPaywall`
   * is true. Retained for custom integrators who render their own
   * paywall reason copy above the embedded checkout; the stock
   * `<McpCheckoutView>` flow leaves it unset so the banner remains
   * the only reason signal.
   */
  hideUpgradeBanner?: boolean
  productRef: string
  returnUrl: string
  onPurchaseSuccess?: () => void
  onRefreshBootstrap?: () => void | Promise<void>
  onClose?: () => void
  /**
   * Called when the user picks "Back to my account" from the plan
   * step. Forwarded by `<McpCheckoutView>` from the shell.
   */
  onBack?: () => void
  cx: Cx
}

export function CheckoutStateMachine(props: StateMachineProps) {
  const {
    step,
    setStep,
    selectedAmountMinor,
    setSelectedAmountMinor,
    successMeta,
    setSuccessMeta,
    activationError,
    setActivationError,
    isActivating,
    setIsActivating,
    fromPaywall,
    paywallKind,
    hideUpgradeBanner,
    productRef,
    returnUrl,
    onPurchaseSuccess,
    onRefreshBootstrap,
    onClose,
    onBack,
    cx,
  } = props

  const { selectedPlan, selectedPlanRef, plans } = usePlanSelector()
  const transport = useTransport()
  const locale = useHostLocale()
  const { notifyModelContext, notifySuccess } = useMcpBridge()
  const { creditsPerMinorUnit, displayExchangeRate } = useBalance()

  const selectedPlanShape = selectedPlan as unknown as BootstrapPlanLike | null
  const branch: 'payg' | 'recurring' | null = selectedPlanShape
    ? isPayg(selectedPlanShape)
      ? 'payg'
      : 'recurring'
    : null

  // Transition: plan → (amount or payment). Emits
  // `ui/update-model-context` so the model sees the committed plan
  // selection before the customer finishes paying.
  //
  // For PAYG plans this is the activation step: firing `activate_plan`
  // here means the customer's active plan is live before any topup
  // intent is created. Post backend fix (see solvapay-backend PR #112),
  // `activate_plan` on a usage-based plan succeeds regardless of the
  // customer's current credit balance, so "Continue with Pay as you
  // go" is a single user-visible activation click. If the subsequent
  // topup later fails, the plan purchase stays live with zero balance
  // and the next tool call routes to `topup` via the paywall-state
  // classifier — not back to `activation_required`.
  //
  // Recurring plans skip activation here and activate server-side on
  // webhook (same as today); the Continue button flows straight to
  // the payment step.
  const onPlanContinue = useCallback(async () => {
    if (!selectedPlanShape || !selectedPlanRef) return
    setActivationError(null)
    void notifyModelContext({
      text: `User selected ${selectedPlanShape.name ?? 'a plan'}.`,
    })
    if (branch === 'payg') {
      setIsActivating(true)
      try {
        await transport.activatePlan({ productRef, planRef: selectedPlanRef })
        setStep('amount')
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Activation failed'
        setActivationError(msg)
      } finally {
        setIsActivating(false)
      }
      return
    }
    setStep('payment')
  }, [
    branch,
    notifyModelContext,
    productRef,
    selectedPlanRef,
    selectedPlanShape,
    setActivationError,
    setIsActivating,
    setStep,
    transport,
  ])

  // Transition: amount → payment. Activation already happened at the
  // plan step; this transition just commits the topup amount and
  // hands off to `TopupForm` for a plain `credit_topup`.
  const onAmountContinue = useCallback(
    (amountMinor: number) => {
      if (!selectedPlanRef) return
      setSelectedAmountMinor(amountMinor)
      setStep('payment')
    },
    [selectedPlanRef, setSelectedAmountMinor, setStep],
  )

  // Transition: payment → success (PAYG branch).
  const onPaygPaymentSuccess = useCallback(() => {
    if (!selectedPlanShape || selectedAmountMinor == null) return
    const currency = (selectedPlanShape.currency ?? 'USD').toUpperCase()
    // `creditsPerMinorUnit` is the mint rate surfaced on the balance
    // DTO — the right input for "how many credits landed." The
    // plan's `creditsPerUnit` is a usage-debit rate and is NOT
    // interchangeable. Fall back to 0 when the balance hasn't
    // loaded so the receipt stays coherent.
    const creditsAdded =
      creditsPerMinorUnit != null && creditsPerMinorUnit > 0
        ? Math.floor((selectedAmountMinor / (displayExchangeRate ?? 1)) * creditsPerMinorUnit)
        : 0
    setSuccessMeta({
      branch: 'payg',
      amountMinor: selectedAmountMinor,
      currency,
      creditsAdded,
      plan: selectedPlanShape,
      rateLabel: formatPaygRate(selectedPlanShape, locale),
    })
    setStep('success')
    void notifyModelContext({
      text: `Activated ${selectedPlanShape.name ?? 'plan'} with ${formatPrice(
        selectedAmountMinor,
        currency,
        { locale },
      )} in credits.`,
    })
    // Phase 5 — user-visible follow-up for topup+activation success.
    void notifySuccess({ kind: 'topup', amountMinor: selectedAmountMinor, currency })
    onPurchaseSuccess?.()
  }, [
    creditsPerMinorUnit,
    displayExchangeRate,
    locale,
    notifyModelContext,
    notifySuccess,
    onPurchaseSuccess,
    selectedAmountMinor,
    selectedPlanShape,
    setStep,
    setSuccessMeta,
  ])

  // Transition: payment → success (Recurring branch).
  const onRecurringPaymentSuccess = useCallback(
    (_intent: PaymentIntent) => {
      if (!selectedPlanShape) return
      const currency = (selectedPlanShape.currency ?? 'USD').toUpperCase()
      setSuccessMeta({
        branch: 'recurring',
        plan: selectedPlanShape,
        creditsIncluded: inferIncludedCredits(selectedPlanShape),
        chargedTodayMinor: selectedPlanShape.price ?? 0,
        currency,
        nextRenewalLabel: null, // server-provided — surfaced as null until wired.
      })
      setStep('success')
      void notifyModelContext({
        text: `Activated ${selectedPlanShape.name ?? 'plan'}.`,
      })
      void notifySuccess({
        kind: 'plan-activated',
        planName: selectedPlanShape.name ?? null,
      })
      onPurchaseSuccess?.()
    },
    [
      notifyModelContext,
      notifySuccess,
      onPurchaseSuccess,
      selectedPlanShape,
      setStep,
      setSuccessMeta,
    ],
  )

  // BackLink handlers.
  const onBackFromAmount = useCallback(() => {
    setActivationError(null)
    setStep('plan')
  }, [setActivationError, setStep])

  const onBackFromRecurringPayment = useCallback(() => {
    setStep('plan')
  }, [setStep])

  const onBackFromPaygPayment = useCallback(() => {
    setStep('amount')
  }, [setStep])

  // Success → unmount.
  const onBackToChat = useCallback(async () => {
    try {
      await Promise.resolve(onRefreshBootstrap?.())
    } catch {
      /* best-effort; the close path still fires. */
    }
    onClose?.()
  }, [onClose, onRefreshBootstrap])

  // "Stay on Free" dismiss.
  const onStayOnFree = useCallback(() => {
    onClose?.()
  }, [onClose])

  // No paid plans configured — defensive fallback; the server throws
  // in this case (see brief §2), but render a clear error anyway.
  if (plans.length === 0) {
    return (
      <>
        <h2 className={cx.heading}>Checkout unavailable</h2>
        <p className={cx.muted}>No paid plans are configured on this product.</p>
      </>
    )
  }

  switch (step) {
    case 'plan':
      return (
        <PlanStep
          fromPaywall={fromPaywall}
          paywallKind={paywallKind}
          hideUpgradeBanner={hideUpgradeBanner}
          onContinue={onPlanContinue}
          // Per brief §6 invariant: `"Stay on Free"` lives on the
          // paywall-entry flow only. Change-plan re-entries from
          // `McpAccountView` leave it hidden so "switching plans"
          // doesn't double as "downgrade to Free."
          onStayOnFree={fromPaywall && onClose ? onStayOnFree : undefined}
          onBack={onBack}
          isActivating={isActivating}
          activationError={activationError}
          cx={cx}
        />
      )
    case 'amount':
      return (
        <AmountStep
          plan={selectedPlanShape!}
          onBack={onBackFromAmount}
          onContinue={onAmountContinue}
          cx={cx}
        />
      )
    case 'payment':
      if (branch === 'payg' && selectedPlanShape && selectedAmountMinor != null) {
        return (
          <PaygPaymentStep
            plan={selectedPlanShape}
            amountMinor={selectedAmountMinor}
            returnUrl={returnUrl}
            onBack={onBackFromPaygPayment}
            onSuccess={onPaygPaymentSuccess}
            cx={cx}
          />
        )
      }
      if (branch === 'recurring' && selectedPlanShape && selectedPlanRef) {
        return (
          <RecurringPaymentStep
            plan={selectedPlanShape}
            planRef={selectedPlanRef}
            productRef={productRef}
            returnUrl={returnUrl}
            onBack={onBackFromRecurringPayment}
            onSuccess={onRecurringPaymentSuccess}
            cx={cx}
          />
        )
      }
      // Shouldn't happen — fall back to plan.
      return (
        <PlanStep
          fromPaywall={fromPaywall}
          paywallKind={paywallKind}
          hideUpgradeBanner={hideUpgradeBanner}
          onContinue={onPlanContinue}
          onStayOnFree={fromPaywall && onClose ? onStayOnFree : undefined}
          onBack={onBack}
          isActivating={isActivating}
          activationError={activationError}
          cx={cx}
        />
      )
    case 'success':
      if (!successMeta) return null
      return <SuccessStep meta={successMeta} onBackToChat={onBackToChat} cx={cx} />
  }
}
