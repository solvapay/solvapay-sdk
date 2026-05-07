'use client'

/**
 * `<EmbeddedCheckout>` — MCP-flavored layout wrapper around the
 * shared `useCheckoutFlow` state engine.
 *
 * Owns the MCP-specific chrome that doesn't belong in the headless
 * primitive (paywall banner, "Stay on Free" affordance, bridge
 * wiring) and delegates step rendering to the existing MCP step
 * components so the surface keeps its `solvapay-mcp-*` CSS hooks.
 *
 * State (step, transitions, activation, success meta) lives in
 * `useCheckoutFlow`. Bridge calls — `notifyModelContext`,
 * `notifySuccess`, `sendMessage` — fire from the lifecycle callbacks
 * on the hook so non-MCP integrators can reuse the same flow without
 * paying the bridge cost.
 */

import React, { useCallback, useMemo } from 'react'
import { PlanSelector } from '../../../primitives/PlanSelector'
import { useCheckoutFlow } from '../../../hooks/useCheckoutFlow'
import { usePurchase } from '../../../hooks/usePurchase'
import { useMcpBridge } from '../../bridge'
import { formatPrice } from '../../../utils/format'
import { useHostLocale } from '../../useHostLocale'
import type { Plan } from '../../../types'
import type { McpViewClassNames } from '../types'
import { PlanStep } from './steps/PlanStep'
import { AmountStep } from './steps/AmountStep'
import { PaygPaymentStep } from './steps/PaygPaymentStep'
import { RecurringPaymentStep } from './steps/RecurringPaymentStep'
import { SuccessStep } from './steps/SuccessStep'
import type { BootstrapPlanLike, Cx } from './shared'
import { isPayg, planSortByPaygFirstThenAsc } from './shared'

export interface EmbeddedCheckoutProps {
  productRef: string
  returnUrl: string
  onPurchaseSuccess?: () => void
  /**
   * `true` when the view was reached via the paywall takeover.
   * Drives the `UpgradeBanner` and the `"Stay on Free"` dismiss link
   * on the plan-selection step.
   */
  fromPaywall: boolean
  paywallKind?: 'payment_required' | 'activation_required'
  /**
   * Suppress the inline `UpgradeBanner` on the plan step even when
   * `fromPaywall` is true. Set by surfaces that already provide
   * "you hit a paywall" reason copy outside the state machine.
   */
  hideUpgradeBanner?: boolean
  /**
   * Product plans snapshot from `bootstrap.plans`. Used to locate the
   * PAYG plan for the `popular` tag and sort the plan cards. Falls
   * back to `PlanSelector`'s own `usePlans` fetch when omitted.
   */
  plans?: readonly BootstrapPlanLike[]
  onClose?: () => void
  /**
   * Called when the user picks "Back to my account" on the plan
   * picker. Forwarded by `<McpCheckoutView>` from the shell.
   */
  onBack?: () => void
  cx: Cx
  /**
   * Accepted for API stability — earlier revisions rendered
   * `<AppHeader>` inside this surface and forwarded slot class names
   * to it. Today `<McpApp>` paints the header once above the shell.
   */
  classNames?: McpViewClassNames
  children?: React.ReactNode
}

export function EmbeddedCheckout({
  productRef,
  returnUrl,
  onPurchaseSuccess,
  fromPaywall,
  paywallKind,
  hideUpgradeBanner,
  plans,
  onClose,
  onBack,
  cx,
  children,
}: EmbeddedCheckoutProps) {
  const { loading, isRefetching, activePurchase } = usePurchase()

  const currentPlanRef = activePurchase?.planSnapshot?.reference ?? null

  const paidPlans = useMemo(() => {
    const list = (plans ?? []) as BootstrapPlanLike[]
    return list.filter(p => p.requiresPayment !== false)
  }, [plans])
  const paygPlanRef = useMemo(() => {
    const payg = paidPlans.find(p => isPayg(p))
    return payg?.reference
  }, [paidPlans])

  const planFilter = useMemo(
    () => (plan: Plan) => plan.requiresPayment !== false || plan.reference === currentPlanRef,
    [currentPlanRef],
  )

  if (loading) {
    return (
      <div className={cx.card}>
        <p>Loading checkout…</p>
      </div>
    )
  }

  return (
    <div className={cx.card} data-refreshing={isRefetching ? 'true' : undefined}>
      <PlanSelector.Root
        productRef={productRef}
        filter={planFilter}
        sortBy={planSortByPaygFirstThenAsc}
        popularPlanRef={paygPlanRef}
        currentPlanRef={currentPlanRef}
        autoSelectFirstPaid={Boolean(paygPlanRef)}
        className="solvapay-plan-selector"
      >
        <McpCheckoutBody
          productRef={productRef}
          returnUrl={returnUrl}
          onPurchaseSuccess={onPurchaseSuccess}
          fromPaywall={fromPaywall}
          paywallKind={paywallKind}
          hideUpgradeBanner={hideUpgradeBanner}
          onClose={onClose}
          onBack={onBack}
          cx={cx}
        />
      </PlanSelector.Root>
      {children}
    </div>
  )
}

interface McpCheckoutBodyProps {
  productRef: string
  returnUrl: string
  onPurchaseSuccess?: () => void
  fromPaywall: boolean
  paywallKind?: 'payment_required' | 'activation_required'
  hideUpgradeBanner?: boolean
  onClose?: () => void
  onBack?: () => void
  cx: Cx
}

function McpCheckoutBody({
  productRef,
  returnUrl,
  onPurchaseSuccess,
  fromPaywall,
  paywallKind,
  hideUpgradeBanner,
  onClose,
  onBack,
  cx,
}: McpCheckoutBodyProps) {
  const bridge = useMcpBridge()
  const locale = useHostLocale()

  const flow = useCheckoutFlow({
    productRef,
    // Opt out of `useCheckoutFlow`'s single-plan auto-skip. MCP
    // bootstraps routinely return `[Free, Paid]` — that's one
    // selectable plan, so the default would auto-advance and bury
    // the paywall-entry "Stay on Free" affordance rendered on the
    // plan step below. Web/paywall surfaces compose `CheckoutSteps`
    // directly and keep the default.
    autoSkipSinglePlan: false,
    // `notifyModelContext` for plan commit fires from the explicit
    // Continue handler below — not on `selectPlan` — so auto-selected
    // plans don't burn a host emit before the user opts in.
    onPurchaseSuccess: meta => {
      if (meta.branch === 'payg') {
        void bridge.notifyModelContext({
          text: `Activated ${meta.plan.name ?? 'plan'} with ${formatPrice(
            meta.amountMinor,
            meta.currency,
            { locale },
          )} in credits.`,
        })
        void bridge.notifySuccess({
          kind: 'topup',
          amountMinor: meta.amountMinor,
          currency: meta.currency,
        })
      } else {
        void bridge.notifyModelContext({
          text: `Activated ${meta.plan.name ?? 'plan'}.`,
        })
        void bridge.notifySuccess({
          kind: 'plan-activated',
          planName: meta.plan.name ?? null,
        })
      }
      onPurchaseSuccess?.()
    },
  })

  const onStayOnFree = useCallback(() => {
    void bridge.sendMessage({ text: 'Sticking with the free tier for now.' })
    onClose?.()
  }, [bridge, onClose])

  const selectedPlanShape = flow.selectedPlan as unknown as BootstrapPlanLike | null

  const onPlanContinue = useCallback(() => {
    if (selectedPlanShape) {
      void bridge.notifyModelContext({
        text: `User selected ${selectedPlanShape.name ?? 'a plan'}.`,
      })
    }
    void flow.advance()
  }, [bridge, flow, selectedPlanShape])

  if (flow.step === 'plan') {
    return (
      <PlanStep
        fromPaywall={fromPaywall}
        paywallKind={paywallKind}
        hideUpgradeBanner={hideUpgradeBanner}
        // Plan-step Continue: triggers `flow.advance()`, which fires
        // `transport.activatePlan` for PAYG and routes recurring
        // straight to the payment step. We emit the model-context
        // signal first so the host always sees the plan commit even
        // if `activatePlan` is slow.
        onContinue={onPlanContinue}
        // Per brief invariant: "Stay on Free" is paywall-entry only.
        // Re-entries from `<McpAccountView>` leave it hidden so
        // "switching plans" doesn't double as "downgrade to Free."
        onStayOnFree={fromPaywall && onClose ? onStayOnFree : undefined}
        onBack={onBack}
        isActivating={flow.status === 'activating'}
        activationError={flow.error}
        cx={cx}
      />
    )
  }

  if (flow.step === 'amount') {
    if (!selectedPlanShape) {
      return null
    }
    return (
      <AmountStep
        plan={selectedPlanShape}
        onBack={() => flow.back()}
        onContinue={amountMinor => {
          flow.selectAmount(amountMinor)
          void flow.advance()
        }}
        cx={cx}
      />
    )
  }

  if (flow.step === 'payment') {
    if (flow.branch === 'payg' && selectedPlanShape && flow.selectedAmountMinor != null) {
      return (
        <PaygPaymentStep
          plan={selectedPlanShape}
          amountMinor={flow.selectedAmountMinor}
          returnUrl={returnUrl}
          onBack={() => flow.back()}
          onSuccess={() => flow.notifyPaymentSuccess()}
          cx={cx}
        />
      )
    }
    if (flow.branch === 'recurring' && selectedPlanShape && flow.selectedPlanRef) {
      return (
        <RecurringPaymentStep
          plan={selectedPlanShape}
          planRef={flow.selectedPlanRef}
          productRef={productRef}
          returnUrl={returnUrl}
          onBack={() => flow.back()}
          onSuccess={intent => flow.notifyPaymentSuccess(intent)}
          cx={cx}
        />
      )
    }
    return null
  }

  if (flow.step === 'success' && flow.successMeta) {
    return <SuccessStep meta={flow.successMeta} cx={cx} />
  }

  return null
}
