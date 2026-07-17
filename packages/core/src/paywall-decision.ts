/**
 * Pure paywall decision cores (Step 32).
 *
 * Cache Map/TTL, ensureCustomer, checkLimits HTTP, and trackUsage stay in
 * `@solvapay/server`. Gate assembly reuses the host's `buildPaywallGate`
 * (injected) so `@solvapay/core` does not depend on `@solvapay/server`.
 */

/** Limits subset consumed by gate assembly / fallback synthesis. */
export type PaywallDecisionLimits = {
  withinLimits?: boolean
  remaining?: number
  plan?: string
  checkoutUrl?: string
  confirmationUrl?: string
  activationRequired?: boolean
  plans?: unknown
  balance?: unknown
  product?: unknown
  creditBalance?: number
}

/** Cache-hit path evaluation (host applies `evict` to the Map). */
export type CachedLimitsEvaluation = {
  withinLimits: boolean
  remaining: number
  evict: boolean
}

/** Cache-miss path evaluation after `checkLimits` returns. */
export type FreshLimitsEvaluation = {
  withinLimits: boolean
  remaining: number
  shouldCache: boolean
}

/** Decision-point outcome (gate body built via injected `buildGate`). */
export type PaywallOutcome<TGate = unknown> =
  | { outcome: 'allow' }
  | { outcome: 'gate'; gate: TGate }

/**
 * Resolve product ref with JS `||` falsy semantics (empty string falls through).
 * Env read stays host-side; both candidates are passed in.
 */
export function resolveProductRef(
  metadataProduct?: string | null,
  envProduct?: string | null,
): string {
  return metadataProduct || envProduct || 'default-product'
}

/**
 * Evaluate a fresh cache-hit `remaining` value.
 *
 * - `remaining > 0` → allow, decrement; `evict` when post-decrement `<= 0`
 * - `remaining <= 0` → block once and evict (forces re-check next time)
 */
export function evaluateCachedLimits(remaining: number): CachedLimitsEvaluation {
  if (remaining > 0) {
    const next = remaining - 1
    return { withinLimits: true, remaining: next, evict: next <= 0 }
  }
  return { withinLimits: false, remaining: 0, evict: true }
}

/**
 * Evaluate a fresh `checkLimits` response (pre-request allowance).
 *
 * Consumes one unit only when `withinLimits && remaining > 0`; caches only
 * in that same case.
 */
export function evaluateFreshLimits(
  withinLimits: boolean,
  remaining: number,
): FreshLimitsEvaluation {
  const consumedAllowance = withinLimits && remaining > 0
  if (consumedAllowance) {
    return {
      withinLimits: true,
      remaining: Math.max(0, remaining - 1),
      shouldCache: true,
    }
  }
  return { withinLimits, remaining, shouldCache: false }
}

/**
 * Synthesize fallback limits when `lastLimitsCheck` is absent on a gate path.
 * `checkoutUrl` is skip-absent (`!== undefined`); empty string is preserved.
 */
export function resolveFallbackGateLimits(
  checkoutUrl?: string,
): PaywallDecisionLimits {
  return {
    withinLimits: false,
    remaining: 0,
    plan: '',
    ...(checkoutUrl !== undefined ? { checkoutUrl } : {}),
  }
}

/**
 * Produce allow vs gate at the decision point.
 *
 * `buildGate` is injected so core stays free of a server dependency; Rust
 * calls in-crate `build_paywall_gate` instead.
 */
export function decidePaywallOutcome<TGate>(input: {
  withinLimits: boolean
  product: string
  limits: PaywallDecisionLimits | null
  checkoutUrl?: string
  buildGate: (product: string, limits: PaywallDecisionLimits) => TGate
}): PaywallOutcome<TGate> {
  if (input.withinLimits) {
    return { outcome: 'allow' }
  }
  const limitsForGate = input.limits ?? resolveFallbackGateLimits(input.checkoutUrl)
  return {
    outcome: 'gate',
    gate: input.buildGate(input.product, limitsForGate),
  }
}
