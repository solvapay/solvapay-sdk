'use client'

/**
 * `<EmbeddedCheckout>` — owns the `PlanSelector` root, the step state
 * for the activation flow, and wires both up via
 * `<CheckoutStateMachine>`. Rendered when Stripe's JS is reachable;
 * the hosted-checkout fallback in `McpCheckoutView` handles the
 * CSP-blocked path.
 */

import React, { useMemo, useState } from 'react'
import { PlanSelector } from '../../../primitives/PlanSelector'
import { usePurchase } from '../../../hooks/usePurchase'
import type { Plan } from '../../../types'
import type { McpViewClassNames } from '../types'
import { CheckoutStateMachine } from './CheckoutStateMachine'
import type { BootstrapPlanLike, Cx, Step, SuccessMeta } from './shared'
import { isPayg, planSortByPaygFirstThenAsc } from './shared'

export interface EmbeddedCheckoutProps {
  productRef: string
  returnUrl: string
  onPurchaseSuccess?: () => void
  /**
   * `true` when the view was reached via the paywall takeover. Drives
   * the `UpgradeBanner` and the `"Stay on Free"` dismiss link on the
   * plan-selection step.
   */
  fromPaywall: boolean
  paywallKind?: 'payment_required' | 'activation_required'
  /**
   * Suppress the inline `UpgradeBanner` on the plan step even when
   * `fromPaywall` is true. Set by surfaces that already provide
   * "you hit a paywall" reason copy outside the state machine —
   * custom integrators who wrap the state machine in their own
   * `<PaywallNotice>` chrome set this so the banner doesn't
   * duplicate the heading + message.
   */
  hideUpgradeBanner?: boolean
  /**
   * Product plans snapshot from `bootstrap.plans`. Used to locate the
   * PAYG plan for the `popular` tag and sort the plan cards. Falls
   * back to `PlanSelector`'s own `usePlans` fetch when omitted.
   */
  plans?: readonly BootstrapPlanLike[]
  onRefreshBootstrap?: () => void | Promise<void>
  onClose?: () => void
  /**
   * Called when the user picks "Back to my account" on the plan
   * picker. Forwarded by `<McpCheckoutView>` from the shell when
   * the customer reached checkout via an in-session surface swap.
   */
  onBack?: () => void
  cx: Cx
  /**
   * Accepted for API stability — earlier revisions rendered
   * `<AppHeader>` inside this surface and forwarded slot class names
   * to it. `<McpApp>` now paints `<AppHeader>` once above the shell,
   * so the per-surface `classNames` never need to reach that header
   * from here; the prop is kept on the interface so existing callers
   * (notably `<McpCheckoutView>`) compile without churn and the
   * option stays available for future surface-scoped styling.
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
  onRefreshBootstrap,
  onClose,
  onBack,
  cx,
  // `classNames` is accepted on the interface for API stability but
  // not consumed inside this surface — see the JSDoc on the prop.
  children,
}: EmbeddedCheckoutProps) {
  const { loading, isRefetching, activePurchase } = usePurchase()

  // Keep the customer's current plan in the grid even when it's Free
  // so the picker doubles as a "here's what you have now" summary.
  // The grid marks it `data-state=current` and disables selection.
  const currentPlanRef = activePurchase?.planSnapshot?.reference ?? null

  // Memoised sort + popular resolution over the bootstrap plans so
  // `PlanSelector` gets a stable reference and the PAYG card renders
  // with the `"recommended"` tag without extra round-trips.
  const paidPlans = useMemo(() => {
    const list = (plans ?? []) as BootstrapPlanLike[]
    return list.filter(p => p.requiresPayment !== false)
  }, [plans])
  const paygPlanRef = useMemo(() => {
    const payg = paidPlans.find(p => isPayg(p))
    return payg?.reference
  }, [paidPlans])

  // Filter keeps every paid plan and additionally lets the currently
  // active plan through even when it's Free — the grid renders it
  // disabled with a `Current` badge rather than hiding it outright.
  const planFilter = useMemo(
    () => (plan: Plan) =>
      plan.requiresPayment !== false || plan.reference === currentPlanRef,
    [currentPlanRef],
  )

  const [step, setStep] = useState<Step>('plan')
  const [selectedAmountMinor, setSelectedAmountMinor] = useState<number | null>(null)
  const [successMeta, setSuccessMeta] = useState<SuccessMeta | null>(null)
  const [activationError, setActivationError] = useState<string | null>(null)
  const [isActivating, setIsActivating] = useState(false)

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
        // Paid plans + the current plan (even if Free) so the picker
        // also surfaces "you're on X today" as a disabled card.
        filter={planFilter}
        // PAYG first, then recurring ascending by price.
        sortBy={planSortByPaygFirstThenAsc}
        popularPlanRef={paygPlanRef}
        currentPlanRef={currentPlanRef}
        // Don't auto-select on recurring-only shapes; the brief's
        // wireframe shows a neutral initial state with a
        // "Continue with …" CTA that only lights up once a plan is
        // selected.
        autoSelectFirstPaid={Boolean(paygPlanRef)}
        className="solvapay-plan-selector"
      >
        <CheckoutStateMachine
          step={step}
          setStep={setStep}
          selectedAmountMinor={selectedAmountMinor}
          setSelectedAmountMinor={setSelectedAmountMinor}
          successMeta={successMeta}
          setSuccessMeta={setSuccessMeta}
          activationError={activationError}
          setActivationError={setActivationError}
          isActivating={isActivating}
          setIsActivating={setIsActivating}
          fromPaywall={fromPaywall}
          paywallKind={paywallKind}
          hideUpgradeBanner={hideUpgradeBanner}
          productRef={productRef}
          returnUrl={returnUrl}
          onPurchaseSuccess={onPurchaseSuccess}
          onRefreshBootstrap={onRefreshBootstrap}
          onClose={onClose}
          onBack={onBack}
          cx={cx}
        />
      </PlanSelector.Root>
      {children}
    </div>
  )
}
