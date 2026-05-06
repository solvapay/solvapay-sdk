/**
 * `buildPaywallGate` — pure helper that converts a `LimitResponseWithPlan`
 * (or any subset compatible with `apiClient.checkLimits`) into a
 * `PaywallStructuredContent` ready for transport-specific 402 responses.
 *
 * Extracted from `SolvaPayPaywall.decide()` so streaming / SSE / multi-step
 * handlers can reuse the exact same gate shape without re-implementing
 * the activation-vs-payment branching and `buildGateMessage` wiring.
 *
 * `paywall.decide()` continues to use this internally so the wire shape
 * stays in lockstep across the handler-shaped (`payable.http` /
 * `.next` / `.mcp`) and decision-shaped (`payable.gate`) paths.
 *
 * @since 1.2.0
 */

import type { LimitResponseWithPlan, PaywallStructuredContent } from './types'
import { buildGateMessage, classifyPaywallState } from './paywall-state'

/**
 * Subset of `LimitResponseWithPlan` the helper actually reads. Keeps the
 * signature flexible — callers can pass the raw `apiClient.checkLimits`
 * result without first asserting the `plan` field.
 */
type LimitsLike = Omit<LimitResponseWithPlan, 'plan'> & {
  plan?: LimitResponseWithPlan['plan']
}

export function buildPaywallGate(
  productRef: string,
  limits: LimitsLike,
): PaywallStructuredContent {
  const checkoutUrl = limits.checkoutUrl

  const preMessage: PaywallStructuredContent = limits.activationRequired
    ? {
        kind: 'activation_required',
        product: productRef,
        message: '',
        checkoutUrl: limits.confirmationUrl || checkoutUrl || '',
        ...(limits.confirmationUrl !== undefined
          ? { confirmationUrl: limits.confirmationUrl }
          : {}),
        ...(limits.plans !== undefined ? { plans: limits.plans } : {}),
        ...(limits.balance !== undefined ? { balance: limits.balance } : {}),
        ...(limits.product !== undefined ? { productDetails: limits.product } : {}),
      }
    : {
        kind: 'payment_required',
        product: productRef,
        checkoutUrl: checkoutUrl || '',
        message: '',
        ...(limits.balance !== undefined ? { balance: limits.balance } : {}),
        ...(limits.product !== undefined ? { productDetails: limits.product } : {}),
      }

  // `classifyPaywallState` requires the `plan` field — fall back to the
  // empty string for callers that only have a `LimitResponse` proper
  // (e.g. `payable.gate()` consumers that haven't yet routed through
  // the SDK client wrapper that adds the field).
  const state = classifyPaywallState({ ...limits, plan: limits.plan ?? '' })
  return { ...preMessage, message: buildGateMessage(state, preMessage) }
}
