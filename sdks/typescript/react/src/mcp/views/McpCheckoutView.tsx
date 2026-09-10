'use client'

/**
 * `<McpCheckoutView>` — the paid-plan activation surface for MCP hosts.
 *
 * Always renders `<EmbeddedCheckout>` so the plan picker (and the PAYG
 * amount step) stay visible while `useStripeProbe` warms Stripe.js.
 * The probe is a payment-capability check: `EmbeddedCheckout` only
 * branches on it at the payment step.
 *
 *  - `useStripeProbe === 'ready'`   → Payment Element
 *    (`PaygPaymentStep` / `RecurringPaymentStep`).
 *  - `useStripeProbe === 'blocked'` → `<HostedCheckout>` (new-tab
 *    fallback with `check_purchase` polling) after a plan is chosen.
 *  - `useStripeProbe === 'loading'` → interstitial spinner on the
 *    payment step only, if the customer outruns the probe.
 *
 * Pass `publishableKey={null}` to skip the probe. Plans still render;
 * the hosted handoff is forced only at payment.
 *
 * The MCP-specific bits (bridge wiring, "Stay on Free" affordance,
 * banner copy) live in this file. The state engine and step layout
 * are shared with the web/chatbot flows via `useCheckoutFlow` +
 * `<CheckoutSteps.*>` — see `./checkout/EmbeddedCheckout.tsx`.
 */

import React from 'react'
import { useStripeProbe } from '../useStripeProbe'
import { resolveMcpClassNames, type McpViewClassNames } from './types'
import { EmbeddedCheckout } from './checkout'
import type { BootstrapPlanLike } from './checkout'

export interface McpCheckoutViewProps {
  productRef: string
  /**
   * Stripe publishable key used by `useStripeProbe` to detect CSP-blocked
   * hosts. Pass `null` to skip the probe: the plan picker still renders,
   * and the hosted handoff is forced only at the payment step.
   */
  publishableKey?: string | null
  returnUrl: string
  onPurchaseSuccess?: () => void
  /**
   * @deprecated PAYG top-ups happen inline now; retained for backward
   * compatibility with integrators that wired it up.
   */
  onRequestTopup?: () => void
  /**
   * `true` when the view was reached via a paywall takeover. Drives the
   * amber "Upgrade to continue" banner and the `"Stay on Free"` dismiss
   * link on the plan-selection step.
   */
  fromPaywall?: boolean
  paywallKind?: 'payment_required' | 'activation_required'
  plans?: readonly BootstrapPlanLike[]
  /**
   * @deprecated No longer wired — kept on the public type for backward
   * compatibility. The shell-level on-mount refresh is wired separately
   * via `<McpAppShell>`.
   */
  onRefreshBootstrap?: () => void | Promise<void>
  /**
   * Ask the host to unmount the MCP app. Wired by `<McpApp>` to
   * `app.requestTeardown()`. Used by the `"Stay on Free"` dismiss link.
   */
  onClose?: () => void
  /**
   * Called when the user picks "Back to my account" at the top of the
   * plan picker. Wired by `<McpAppShell>` whenever the shell owns
   * surface routing.
   */
  onBack?: () => void
  /**
   * Pre-select this plan and, with `autoAdvance`, skip the plan step
   * by running `flow.advance()` once the selector has that plan.
   */
  initialPlanRef?: string
  /**
   * When set with `initialPlanRef`, fire the plan-step Continue path
   * automatically so a ladder Switch/Activate lands on amount or
   * payment — not a second plan picker.
   */
  autoAdvance?: boolean
  classNames?: McpViewClassNames
  children?: React.ReactNode
}

export function McpCheckoutView({
  productRef,
  publishableKey = null,
  returnUrl,
  onPurchaseSuccess,
  onRequestTopup: _onRequestTopup,
  fromPaywall = false,
  paywallKind,
  plans,
  onClose,
  onBack,
  initialPlanRef,
  autoAdvance,
  classNames,
  children,
}: McpCheckoutViewProps) {
  const cx = resolveMcpClassNames(classNames)
  const probe = useStripeProbe(publishableKey)

  return (
    <EmbeddedCheckout
      productRef={productRef}
      returnUrl={returnUrl}
      onPurchaseSuccess={onPurchaseSuccess}
      fromPaywall={fromPaywall}
      paywallKind={paywallKind}
      plans={plans}
      onClose={onClose}
      onBack={onBack}
      initialPlanRef={initialPlanRef}
      autoAdvance={autoAdvance}
      stripeProbe={probe}
      cx={cx}
      classNames={classNames}
    >
      {children}
    </EmbeddedCheckout>
  )
}
