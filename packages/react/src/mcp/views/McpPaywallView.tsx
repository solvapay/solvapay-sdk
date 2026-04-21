'use client'

/**
 * `<McpPaywallView>` — the paywall screen surfaced by the `open_paywall`
 * MCP tool. Thin shell around `<PaywallNotice>` with `solvapay-mcp-*`
 * class names and `useStripeProbe` gating.
 *
 * Decides "embedded vs hosted" based on the Stripe probe; all actual UX
 * lives in the `<PaywallNotice>` primitive so web-app integrators can
 * reuse it verbatim.
 */

import React from 'react'
import type { PaywallStructuredContent } from '@solvapay/server'
import { useCopy } from '../../hooks/useCopy'
import { PaywallNotice } from '../../primitives/PaywallNotice'
import { useStripeProbe } from '../useStripeProbe'
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
}

export function McpPaywallView({
  content,
  publishableKey = null,
  returnUrl,
  classNames,
  onResolved,
}: McpPaywallViewProps) {
  const cx = resolveMcpClassNames(classNames)
  const copy = useCopy()
  const probe = useStripeProbe(publishableKey)

  const showEmbeddedCheckout = probe === 'ready' && content.kind === 'payment_required'
  const isLoading = probe === 'loading'

  return (
    <div className={cx.card}>
      <PaywallNotice.Root
        content={content}
        onResolved={onResolved}
        classNames={{
          heading: cx.heading,
          message: cx.muted,
          productContext: cx.muted,
          balance: cx.notice,
          retryButton: cx.button,
          hostedLink: cx.button,
        }}
      >
        <PaywallNotice.Heading />
        <PaywallNotice.ProductContext />
        <PaywallNotice.Message />
        <PaywallNotice.Balance />

        {content.kind === 'activation_required' && (
          <PaywallNotice.Plans className="solvapay-mcp-paywall-plans" />
        )}

        {isLoading ? (
          <div className={cx.muted}>{copy.paywall.hostedCheckoutLoading}</div>
        ) : showEmbeddedCheckout ? (
          <PaywallNotice.EmbeddedCheckout
            returnUrl={returnUrl}
            className="solvapay-mcp-paywall-embedded-checkout"
          />
        ) : (
          <PaywallNotice.HostedCheckoutLink />
        )}

        <PaywallNotice.Retry />
      </PaywallNotice.Root>
    </div>
  )
}
