/**
 * Paywall decision types (Step 32 / Step 52).
 * Helpers are Rust-only facades in `native-helpers.ts`.
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

/** Decision-point outcome (gate body built via injected `buildGate` / Rust). */
export type PaywallOutcome<TGate = unknown> =
  | { outcome: 'allow' }
  | { outcome: 'gate'; gate: TGate }
