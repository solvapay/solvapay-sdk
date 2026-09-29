'use client'

/**
 * `<McpCheckoutView>` — the paid-plan activation surface for MCP hosts.
 *
 * Renders `<EmbeddedCheckout>`: plan picker, the PAYG amount step, then
 * the payment step with the vault `CardFields`
 * (`PaygPaymentStep` / `RecurringPaymentStep`).
 *
 * The MCP-specific bits (bridge wiring, "Stay on Free" affordance,
 * banner copy) live in this file. The state engine and step layout
 * are shared with the web/chatbot flows via `useCheckoutFlow` +
 * `<CheckoutSteps.*>` — see `./checkout/EmbeddedCheckout.tsx`.
 */

import React from 'react'
import { resolveMcpClassNames, type McpViewClassNames } from './types'
import { EmbeddedCheckout } from './checkout'
import type { BootstrapPlanLike } from './checkout'

export interface McpCheckoutViewProps {
  productRef: string
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
      cx={cx}
      classNames={classNames}
    >
      {children}
    </EmbeddedCheckout>
  )
}
