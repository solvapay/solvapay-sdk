/**
 * Pure derivation helpers that map a plan / active purchase onto the
 * activation strategy + action-affordance shape the shell renders per
 * plan type.
 *
 * Keeping these in a standalone module lets the hosted manage page
 * share the same matrix as the MCP shell — "one plan-shape matrix,
 * two surfaces" — and makes the 4 × 2 × 3 test matrix from the plan a
 * pure-function target (no RTL needed).
 */

export type PlanShape = 'free' | 'trial' | 'usage-based' | 'recurring-unlimited' | 'recurring-metered'

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

export interface PlanLike {
  /** `'free' | 'trial' | 'usage-based' | 'recurring'`. */
  planType?: string | null
  price?: number | null
  currency?: string | null
  meterRef?: string | null
  meterId?: string | null
  limit?: number | null
}

export interface PurchaseSnapshotLike {
  planSnapshot?: PlanLike | null
  /** Whether the customer has a payment method on file. */
  hasPaymentMethod?: boolean
}

/**
 * Map a `BootstrapPlan` / `PlanSnapshot` to its concrete shape. The
 * four shapes are distinct in UX: each drives a different summary
 * string, a different set of CTAs, and a different activity-strip
 * variant.
 */
export function resolvePlanShape(plan: PlanLike | null | undefined): PlanShape | null {
  if (!plan) return null
  const type = plan.planType
  if (type === 'free') return 'free'
  if (type === 'trial') return 'trial'
  if (type === 'usage-based') return 'usage-based'
  if (type === 'recurring') {
    const hasMeter = Boolean(plan.meterRef || plan.meterId)
    const hasLimit = plan.limit != null && plan.limit > 0
    return hasMeter || hasLimit ? 'recurring-metered' : 'recurring-unlimited'
  }
  // Unknown / null planType — treat zero-priced as activate, paid as
  // checkout.
  if ((plan.price ?? 0) === 0) return 'free'
  return 'recurring-unlimited'
}

/**
 * Pick the activation strategy for a plan the user just clicked.
 *
 * Rules match the plan's pressure-test: free / trial activate instantly;
 * usage-based always tops up first; zero-priced recurring activates
 * instantly; paid recurring goes to Stripe checkout.
 */
export function resolveActivationStrategy(plan: PlanLike | null | undefined): ActivationStrategy {
  const shape = resolvePlanShape(plan)
  if (shape === 'usage-based') return 'topup-first'
  if (shape === 'free' || shape === 'trial') return 'activate'
  // recurring-*: zero-priced still activates inline.
  if ((plan?.price ?? 0) === 0) return 'activate'
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

export function resolvePlanActions({ purchase, planCount, paidPlanCount }: PlanActionsInput): PlanActions {
  const shape = resolvePlanShape(purchase?.planSnapshot)
  const hasPaymentMethod = Boolean(purchase?.hasPaymentMethod)
  const canOfferChange = planCount > 1
  const isFree = shape === 'free'
  const canUpgrade = isFree && paidPlanCount > 0

  return {
    topUp: shape === 'usage-based',
    cancel: shape === 'recurring-unlimited' || shape === 'recurring-metered' || shape === 'free' || shape === 'trial',
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

export function resolveActivityStrip(purchase: PurchaseSnapshotLike | null | undefined): ActivityStripKind {
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
