/**
 * Pure TypeScript body for `paywallErrorToClientPayload` (Step 37R-c).
 *
 * Kept separate from `paywall.ts` so `native-decisions` can import the fallback
 * without pulling in the `PaywallError` class / circular module graph.
 */

import type { PaywallStructuredContent } from './types'

/** Duck-typed error shape — matches `PaywallError` without importing the class. */
export type PaywallErrorLike = {
  message: string
  structuredContent: PaywallStructuredContent
}

/** JSON body shape for HTTP adapters and MCP text content (stable fields for clients). */
export function paywallErrorToClientPayloadTs(
  error: PaywallErrorLike,
): Record<string, unknown> {
  const sc = error.structuredContent
  const base: Record<string, unknown> = {
    success: false,
    error: sc.kind === 'activation_required' ? 'Activation required' : 'Payment required',
    product: sc.product,
    checkoutUrl: sc.checkoutUrl,
    message: sc.message,
  }
  if (sc.kind === 'activation_required') {
    base.kind = 'activation_required'
    if (sc.plans !== undefined) base.plans = sc.plans
    if (sc.balance !== undefined) base.balance = sc.balance
    if (sc.productDetails !== undefined) base.productDetails = sc.productDetails
    if (sc.confirmationUrl !== undefined) base.confirmationUrl = sc.confirmationUrl
  } else {
    base.kind = 'payment_required'
    if (sc.balance !== undefined) base.balance = sc.balance
    if (sc.productDetails !== undefined) base.productDetails = sc.productDetails
  }
  return base
}
