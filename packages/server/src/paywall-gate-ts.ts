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

import type {
  LimitPlanSummary,
  LimitResponseWithPlan,
  PaywallStructuredContent,
} from './types'
import { buildGateMessage, classifyPaywallState } from './paywall-state-ts'

/**
 * Subset of `LimitResponseWithPlan` the helper actually reads. Keeps the
 * signature flexible — callers can pass the raw `apiClient.checkLimits`
 * result without first asserting the `plan` field.
 */
type LimitsLike = Omit<LimitResponseWithPlan, 'plan'> & {
  plan?: LimitResponseWithPlan['plan']
}

/**
 * Detect "the only paid remediation on this product is a topup" — i.e. every
 * plan that requires payment is PAYG (`usage-based` or `hybrid`). Free plans
 * are filtered out before the check because they don't represent a paid
 * remediation path. Returns `false` when no plans are available, when no
 * paid plans exist, or when at least one paid plan is recurring/one-time.
 */
function allPaidPlansArePayg(plans: LimitPlanSummary[] | undefined): boolean {
  if (!plans || plans.length === 0) return false
  const paidPlans = plans.filter(p => p.requiresPayment !== false)
  if (paidPlans.length === 0) return false
  return paidPlans.every(p => p.type === 'usage-based' || p.type === 'hybrid')
}

export function buildPaywallGate(
  productRef: string,
  limits: LimitsLike,
): PaywallStructuredContent {
  const checkoutUrl = limits.checkoutUrl

  // `classifyPaywallState` requires the `plan` field — fall back to the
  // empty string for callers that only have a `LimitResponse` proper
  // (e.g. `payable.gate()` consumers that haven't yet routed through
  // the SDK client wrapper that adds the field).
  const state = classifyPaywallState({ ...limits, plan: limits.plan ?? '' })

  // When the customer is on an active usage-based plan but out of credits
  // (state: `topup_required`) AND the product's only paid remediation is
  // topup, emit `activation_required` with the PAYG plans attached instead
  // of `payment_required`. Lets the React SDK's `isTopupGate` discriminator
  // pick topup-flavored copy ("Add credits to continue" / "You're out of
  // credits…") instead of the generic upgrade copy ("Upgrade to continue" /
  // "Pick a plan below to keep chatting"). Without PAYG plans on the gate
  // we can't promise the user "credits", so we keep the existing
  // `payment_required` shape — `isTopupGate` would fall through to neutral
  // activation copy otherwise, which is worse than the upgrade copy.
  const useActivationForTopup =
    !limits.activationRequired &&
    state.kind === 'topup_required' &&
    allPaidPlansArePayg(limits.plans)

  const preMessage: PaywallStructuredContent =
    limits.activationRequired || useActivationForTopup
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

  return { ...preMessage, message: buildGateMessage(state, preMessage) }
}
