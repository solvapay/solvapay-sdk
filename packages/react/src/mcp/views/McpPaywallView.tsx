'use client'

/**
 * `<McpPaywallView>` — the paywall screen surfaced by the `open_paywall`
 * MCP tool. Thin shell that picks between embedded and hosted paths,
 * then renders the shared checkout state machine (plan → amount →
 * payment → success) when Stripe is reachable. The state machine is
 * the same one `<McpCheckoutView>` uses for `activate_plan`, so the
 * paywall's PAYG step-UX matches the rest of the SDK exactly.
 *
 * ## Layout
 *
 * The paywall composes three layers, each with a single responsibility:
 *
 * 1. `ShellHeader` (from `McpAppShell`, above this view) owns merchant
 *    branding + product name + description.
 * 2. `PaywallNotice.Root` renders flat (no card) and owns the paywall
 *    reason copy — heading, message, balance. The `root` slot uses
 *    `cx.stack` so its children flow with a consistent gap.
 * 3. `EmbeddedCheckout` owns the *single* step card (plan → amount →
 *    payment → success). Its state-machine `UpgradeBanner` is
 *    suppressed via `hideUpgradeBanner` to avoid duplicating the
 *    reason copy that `PaywallNotice` already shows above.
 */

import React from 'react'
import type { PaywallStructuredContent } from '@solvapay/server'
import { useCopy } from '../../hooks/useCopy'
import { PaywallNotice } from '../../primitives/PaywallNotice'
import { useStripeProbe } from '../useStripeProbe'
import { EmbeddedCheckout } from './checkout'
import type { BootstrapPlanLike } from './checkout'
import { resolveMcpClassNames, type McpViewClassNames } from './types'

export interface McpPaywallViewProps {
  content: PaywallStructuredContent
  /**
   * Stripe publishable key. Passing a key enables the embedded checkout
   * path once `useStripeProbe` reports `'ready'`. `null` forces the
   * hosted-link fallback.
   */
  publishableKey?: string | null
  returnUrl: string
  classNames?: McpViewClassNames
  /** Consumers typically pass a function that dismisses the view after resolution. */
  onResolved?: () => void
  /**
   * Product plans snapshot from `bootstrap.plans`. Threaded through to
   * the shared `EmbeddedCheckout` so the paywall surfaces the same
   * PAYG-first sorted grid and `popular` tag as `McpCheckoutView`.
   */
  plans?: readonly BootstrapPlanLike[]
  /**
   * Secondary "Upgrade to <plan> — <price>" CTA rendered below the
   * paywall's primary (top-up) flow. When set, the paywall view
   * exposes two routes out of the gate — stay on usage-based by
   * topping up, or switch to a recurring plan.
   *
   * `onClick` fires with the plan the shell derived from
   * `bootstrap.plans` (first recurring, non-usage-based plan);
   * consumers typically open `<McpCheckoutView>` for that plan.
   */
  upgradeCta?: {
    label: string
    onClick: () => void
  }
}

export function McpPaywallView({
  content,
  publishableKey = null,
  returnUrl,
  classNames,
  onResolved,
  plans,
  upgradeCta,
}: McpPaywallViewProps) {
  const cx = resolveMcpClassNames(classNames)
  const copy = useCopy()
  const probe = useStripeProbe(publishableKey)

  const productRef = content.product
  const embeddedReady = probe === 'ready' && Boolean(productRef)
  const isLoading = probe === 'loading'

  return (
    <PaywallNotice.Root
      content={content}
      onResolved={onResolved}
      classNames={{
        // Flat flex-column stack — no outer card. `EmbeddedCheckout`
        // provides the single card below.
        root: cx.stack,
        heading: cx.heading,
        message: cx.muted,
        balance: cx.notice,
        hostedLink: cx.button,
      }}
    >
      <PaywallNotice.Heading />
      <PaywallNotice.Message />
      <PaywallNotice.Balance />

      {isLoading ? (
        <div className={cx.muted}>{copy.paywall.hostedCheckoutLoading}</div>
      ) : embeddedReady ? (
        <EmbeddedCheckout
          productRef={productRef}
          returnUrl={returnUrl}
          fromPaywall
          paywallKind={content.kind}
          // PaywallNotice above already renders the heading +
          // message for the paywall kind, so skip the inline
          // banner to avoid duplicate "Upgrade to continue" copy.
          hideUpgradeBanner
          plans={plans}
          onRefreshBootstrap={onResolved}
          onClose={onResolved}
          cx={cx}
        />
      ) : (
        <PaywallNotice.HostedCheckoutLink />
      )}

      {upgradeCta ? (
        <button
          type="button"
          className={`${cx.button} solvapay-mcp-paywall-upgrade-cta`.trim()}
          data-variant="secondary"
          onClick={upgradeCta.onClick}
        >
          {upgradeCta.label}
        </button>
      ) : null}
    </PaywallNotice.Root>
  )
}
