/**
 * Pure derivation helpers that map a plan / active purchase onto the
 * activation strategy + action-affordance shape the shell renders per
 * plan type.
 *
 * Keeping these in a standalone module lets the hosted manage page
 * share the same matrix as the MCP shell — "one plan-shape matrix,
 * two surfaces" — and makes the 4 × 2 × 3 test matrix from the plan a
 * pure-function target (no RTL needed).
 *
 * The shape is derived from the wire's `options[]` through the
 * `@solvapay/core` readers. These helpers previously keyed off
 * `planType`, `meterRef`, `meterId`, and `limit`, none of which the
 * backend sends: every plan fell through to the unknown branch, so a
 * pay-as-you-go plan (which has no headline `price`) resolved to
 * `'free'` and metered subscriptions were indistinguishable from
 * unlimited ones.
 */

import { charges, type PricingOptionLike } from '@solvapay/core'
import {
  planBillingCycleInterval,
  planCountsUsage,
  planTrialDays,
  type PlanDisplayBlock,
} from '../utils/planDisplay'

export type PlanShape =
  | 'free'
  | 'trial'
  | 'usage-based'
  | 'recurring-unlimited'
  | 'recurring-metered'

/**
 * Strategy the Plan tab uses when the user clicks a plan card:
 *  - `activate` — free / trial / free-priced recurring: instant activation
 *    via `ActivationFlow.Summary` + `ActivateButton`.
 *  - `topup-first` — usage-based: ActivationFlow's `AmountPicker`
 *    branch.
 *  - `paid-checkout` — recurring with a non-zero price: mount
 *    `PaymentFormGate` + `PaymentForm.*` for inline Stripe Elements.
 */
export type ActivationStrategy = 'activate' | 'topup-first' | 'paid-checkout'

/**
 * The subset of a plan — or of the plan snapshot frozen onto a purchase
 * — that the shape derivation reads. A plan carries `requiresPayment`;
 * a snapshot may not. Usage-counting and the rest come out of `options[]`.
 */
export interface PlanLike {
  /** Composable pricing options: charges, billing cycle, limit, trial. */
  options?: PricingOptionLike[] | null
  /** `false` marks a free plan. Only present on a plan, not a snapshot. */
  requiresPayment?: boolean | null
  /** Derived headline amount; only a fallback for snapshots frozen before `options[]`. */
  price?: number | null
  currency?: string | null
  display?: PlanDisplayBlock | null
  pricingOptions?: Array<{ price: number }>
}

export interface PurchaseSnapshotLike {
  planSnapshot?: PlanLike | null
  /** Whether the customer has a payment method on file. */
  hasPaymentMethod?: boolean
}

/**
 * Whether the plan charges anything at all.
 *
 * A plan says so outright with `requiresPayment`. A frozen snapshot has
 * no such field, so fall back to the charges it carries — and, for
 * snapshots frozen before `options[]` existed, to the headline price.
 */
function isPaidPlan(plan: PlanLike): boolean {
  if (plan.requiresPayment === false) return false
  if (plan.pricingOptions?.some(option => option.price > 0)) return true
  if (plan.display) {
    return plan.requiresPayment === true || (plan.price ?? 0) > 0
  }
  if (charges(plan).some(charge => charge.amountMinor > 0)) return true
  return (plan.price ?? 0) > 0
}

/** Whether the plan counts usage: a per-unit charge, a tier, or a limit. */
function isMeteredPlan(plan: PlanLike): boolean {
  return planCountsUsage(plan)
}

/**
 * Map a `BootstrapPlan` / `PlanSnapshot` to its concrete shape. The
 * shapes are distinct in UX: each drives a different summary string, a
 * different set of CTAs, and a different activity-strip variant.
 *
 * A billing cycle is what separates a subscription from a one-off, and
 * metering is what separates capped from unlimited. A paid plan with
 * neither is a one-time purchase, which this matrix has no member for
 * and folds into `'recurring-unlimited'` — the same bucket it landed in
 * before, and the one that routes it to paid checkout.
 */
export function resolvePlanShape(plan: PlanLike | null | undefined): PlanShape | null {
  if (!plan) return null
  if (planTrialDays(plan) > 0) return 'trial'
  if (!isPaidPlan(plan)) return 'free'

  const metered = isMeteredPlan(plan)
  if (planBillingCycleInterval(plan)) return metered ? 'recurring-metered' : 'recurring-unlimited'
  return metered ? 'usage-based' : 'recurring-unlimited'
}

/**
 * Pick the activation strategy for a plan the user just clicked.
 *
 * Free and trial plans activate instantly, usage-based always tops up
 * first, and everything else goes to Stripe checkout. A zero-priced
 * plan needs no separate branch: it resolves to `'free'`, because
 * charging nothing is what makes a plan free.
 */
export function resolveActivationStrategy(plan: PlanLike | null | undefined): ActivationStrategy {
  const shape = resolvePlanShape(plan)
  if (shape === 'usage-based') return 'topup-first'
  if (shape === 'free' || shape === 'trial') return 'activate'
  return 'paid-checkout'
}

/**
 * Per-variant action flags for the Plan-active card. Only flags that
 * are `true` render affordances — this collapses the "should we show
 * Cancel?" boolean maze into a single resolver call.
 *
 * Rules from the plan:
 *  - `topUp` — only on usage-based purchases.
 *  - `cancel` — recurring (paid subscription) and free plans. PAYG
 *    has no renewal to cancel.
 *  - `changePlan` — always, when the product exposes more than one
 *    plan.
 *  - `managePortal` — only when the customer has a payment method on
 *    file. Free plans that never charged a card skip this.
 *  - `upgrade` — shown *instead of* `changePlan` when the active plan
 *    is free AND at least one paid plan exists.
 */
export interface PlanActions {
  topUp: boolean
  cancel: boolean
  changePlan: boolean
  managePortal: boolean
  upgrade: boolean
}

export interface PlanActionsInput {
  purchase: PurchaseSnapshotLike | null | undefined
  /** Total plans exposed on the product. */
  planCount: number
  /** Number of paid plans (price > 0, not free) on the product. */
  paidPlanCount: number
}

export function resolvePlanActions({
  purchase,
  planCount,
  paidPlanCount,
}: PlanActionsInput): PlanActions {
  const shape = resolvePlanShape(purchase?.planSnapshot)
  const hasPaymentMethod = Boolean(purchase?.hasPaymentMethod)
  const canOfferChange = planCount > 1
  const isFree = shape === 'free'
  const canUpgrade = isFree && paidPlanCount > 0

  return {
    topUp: shape === 'usage-based',
    cancel:
      shape === 'recurring-unlimited' ||
      shape === 'recurring-metered' ||
      shape === 'free' ||
      shape === 'trial',
    changePlan: canOfferChange && !canUpgrade,
    managePortal: hasPaymentMethod,
    upgrade: canUpgrade,
  }
}

/**
 * "Your activity" strip variant shown at the top of a surface when a
 * returning customer has an active purchase. Hidden when the customer
 * has no active purchase.
 */
export type ActivityStripKind =
  | 'none'
  | 'payg-balance'
  | 'recurring-unlimited-renew'
  | 'recurring-metered-usage'
  | 'free-usage'

export function resolveActivityStrip(
  purchase: PurchaseSnapshotLike | null | undefined,
): ActivityStripKind {
  const shape = resolvePlanShape(purchase?.planSnapshot)
  if (!shape) return 'none'
  if (shape === 'usage-based') return 'payg-balance'
  if (shape === 'recurring-unlimited') return 'recurring-unlimited-renew'
  if (shape === 'recurring-metered') return 'recurring-metered-usage'
  if (shape === 'free') return 'free-usage'
  // trial → treat as free (shows meter + upgrade).
  if (shape === 'trial') return 'free-usage'
  return 'none'
}
